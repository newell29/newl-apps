import crypto from "node:crypto";
import { ModuleKey, type Prisma } from "@prisma/client";

import { hasTeamshipInternalReadAccess } from "@/modules/teamship/access-policy";
import { getConfiguredTeamshipBrowserJobAdapter } from "@/modules/teamship/browser-read-jobs";
import type { TeamshipShippingOrderDetail } from "@/modules/shipment-documents/teamship-review-types";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { findTeamshipShippingOrders } from "@/server/integrations/teamship";
import {
  getTenantTeamshipSettings,
  resolveTenantTeamshipCredentials,
  type TeamshipStoredCredentials
} from "@/server/integrations/teamship-settings";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const TEAMSHIP_PRINT_JOB_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "CLAIMED",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
  "WAITING_BATCH",
  "BLOCKED"
] as const;

export type TeamshipPrintJobStatus = typeof TEAMSHIP_PRINT_JOB_STATUSES[number];

export type TeamshipPrintDocumentPlan = {
  pickingListCopies: 1;
  bolCopies: 1;
  outboundLabelCopies: number;
};

export type TeamshipPrintPrinterPlan = {
  pickingList: {
    transport: "CUPS";
    queue: string;
    displayName: string;
  };
  bol: {
    transport: "TEAMSHIP";
    exactName: string;
  };
  outboundLabels: {
    transport: "TEAMSHIP";
    exactName: string;
  };
};

export type ClaimedTeamshipPrintJob = {
  id: string;
  shippingOrderNumber: string;
  teamshipOrderId: string;
  customerName: string;
  warehouseName: string;
  approvedPalletCount: number;
  documentPlan: TeamshipPrintDocumentPlan;
  printerPlan: TeamshipPrintPrinterPlan;
  credentials: TeamshipStoredCredentials;
};

export type TeamshipPrintExecutionDocument = {
  kind: "PICKING_LIST" | "BOL" | "OUTBOUND_LABELS";
  status: "COMPLETED" | "SUBMITTED";
  printer: string;
  copies: number;
};

export type TeamshipPrintExecutionResult = {
  status: "COMPLETED";
  observedPalletCount: number;
  documents: TeamshipPrintExecutionDocument[];
  completedAt: string;
};

type PrintJobDependencies = {
  findOrders?: typeof findTeamshipShippingOrders;
  preflightPalletCount?: (input: {
    context: AuthenticatedContext;
    teamshipOrderId: string;
    customerName: string;
    warehouseName: string;
  }) => Promise<number>;
  now?: () => Date;
};

type TeamshipPrintBatchChild = {
  batchId: string;
  batchPosition: number;
  reviewOrderId: string;
};

export type TeamshipPrintReviewReference = {
  psNumber: string;
  srNumber: string;
  teamshipOrderId: string;
  teamshipUrl: string | null;
};

type CreateTeamshipPrintPlanInput = {
  requestKey: string;
  batch?: TeamshipPrintBatchChild;
  shippingOrderNumber?: string;
  reviewReference?: TeamshipPrintReviewReference;
};

const APPROVAL_TTL_MS = 15 * 60_000;
const CLAIM_TTL_MS = 15 * 60_000;
const MAX_PALLET_COUNT = 100;
const DEFAULT_LOCAL_QUEUE = "_192_168_1_28";
const DEFAULT_OFFICE_PRINTER = "KONICA MINOLTA bizhub C3350i PCL (192.168.1.28) UPD";
const DEFAULT_LABEL_PRINTER = "BIXOLON SRP-770III";

export class TeamshipPrintJobError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TeamshipPrintJobError";
    this.status = status;
  }
}

export async function createTeamshipPrintPlan(
  context: AuthenticatedContext,
  input: CreateTeamshipPrintPlanInput,
  dependencies: PrintJobDependencies = {}
) {
  await requireTeamshipPrintAccess(context);
  const requestKey = requireRequestKey(input.requestKey);
  const requestedShippingOrderNumber = input.reviewReference
    ? null
    : requireShippingOrderNumber(input.shippingOrderNumber);
  const now = dependencies.now?.() ?? new Date();
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(`${context.tenantId}:${context.userId}:${requestKey}`)
    .digest("hex");

  const existing = await prisma.teamshipPrintJob.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: context.tenantId, idempotencyKey } }
  });
  if (existing) {
    const reviewRequestMismatch = input.reviewReference
      && existing.reviewOrderId !== input.batch?.reviewOrderId;
    if (
      existing.requestedByUserId !== context.userId
      || (requestedShippingOrderNumber && existing.shippingOrderNumber !== requestedShippingOrderNumber)
      || reviewRequestMismatch
    ) {
      throw new TeamshipPrintJobError("The print request key is already in use.", 409);
    }
    return serializePrintJob(existing);
  }

  await expireTeamshipPrintJobs(context.tenantId, now);

  if (requestedShippingOrderNumber) {
    await requireNoActivePrintJob(context.tenantId, requestedShippingOrderNumber);
  }

  const findOrders = dependencies.findOrders ?? findTeamshipShippingOrders;
  const { shippingOrderNumber, order } = input.reviewReference
    ? await resolveReviewPrintOrder(context, input.reviewReference, findOrders)
    : await resolveDisplayPrintOrder(context, requestedShippingOrderNumber!, findOrders);
  if (!requestedShippingOrderNumber) {
    await requireNoActivePrintJob(context.tenantId, shippingOrderNumber);
  }

  const teamshipOrderId = resolveTeamshipInternalOrderId(order);
  const customerName = readTeamshipCustomerName(order);
  const warehouseName = readTeamshipWarehouseName(order);
  if (!/\bgarland\b/i.test(customerName)) {
    throw new TeamshipPrintJobError("Phase 1 printing is restricted to Garland shipping orders.", 403);
  }
  if (!/\bannagem\b/i.test(warehouseName)) {
    throw new TeamshipPrintJobError("Phase 1 Garland printing is restricted to the Annagem warehouse.", 403);
  }

  const approvedPalletCount = await (dependencies.preflightPalletCount ?? preflightTeamshipShippingOrderPalletCount)({
    context,
    teamshipOrderId,
    customerName,
    warehouseName
  });
  const documentPlan: TeamshipPrintDocumentPlan = {
    pickingListCopies: 1,
    bolCopies: 1,
    outboundLabelCopies: approvedPalletCount
  };
  const printerPlan = getTeamshipPrinterPlan();
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const job = await tx.teamshipPrintJob.create({
        data: {
          tenantId: context.tenantId,
          shippingOrderNumber,
          teamshipOrderId,
          customerName,
          warehouseName,
          documentPlan: documentPlan as unknown as Prisma.InputJsonValue,
          printerPlan: printerPlan as unknown as Prisma.InputJsonValue,
          approvedPalletCount,
          idempotencyKey,
          activeOrderKey: shippingOrderNumber,
          requestedByUserId: context.userId,
          batchId: input.batch?.batchId,
          batchPosition: input.batch?.batchPosition,
          reviewOrderId: input.batch?.reviewOrderId,
          expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS)
        }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "teamship.print.plan.create",
          entityType: "TeamshipPrintJob",
          entityId: job.id,
          after: {
            shippingOrderNumber,
            teamshipOrderId,
            status: "PENDING_APPROVAL",
            approvedPalletCount,
            documentPlan,
            printerPlan,
            batchId: input.batch?.batchId ?? null,
            batchPosition: input.batch?.batchPosition ?? null,
            reviewOrderId: input.batch?.reviewOrderId ?? null
          } as unknown as Prisma.InputJsonValue
        }
      });
      return job;
    });
  } catch (error) {
    if (readPrismaErrorCode(error) === "P2002") {
      throw new TeamshipPrintJobError("A print request for this order was created concurrently. Check its status before trying again.", 409);
    }
    throw error;
  }

  return serializePrintJob(created);
}

export async function approveTeamshipPrintPlan(
  context: AuthenticatedContext,
  jobId: string,
  confirmed: boolean,
  dependencies: Pick<PrintJobDependencies, "now"> = {}
) {
  await requireTeamshipPrintAccess(context);
  if (!confirmed) {
    throw new TeamshipPrintJobError("Explicit print confirmation is required.");
  }
  const id = requireJobId(jobId);
  const now = dependencies.now?.() ?? new Date();
  const current = await prisma.teamshipPrintJob.findFirst({
    where: { id, tenantId: context.tenantId }
  });
  if (!current) throw new TeamshipPrintJobError("Print request was not found.", 404);
  if (current.requestedByUserId !== context.userId) {
    throw new TeamshipPrintJobError("Only the employee who created this print request can approve it.", 403);
  }
  if (current.status !== "PENDING_APPROVAL") {
    return serializePrintJob(current);
  }
  if (current.expiresAt <= now) {
    await prisma.teamshipPrintJob.updateMany({
      where: { id, tenantId: context.tenantId, status: "PENDING_APPROVAL" },
      data: {
        status: "EXPIRED",
        errorCode: "APPROVAL_EXPIRED",
        errorMessage: "The print plan expired before approval.",
        activeOrderKey: null
      }
    });
    throw new TeamshipPrintJobError("The print plan expired. Ask Nemo to create a fresh plan.", 409);
  }

  const approved = await prisma.$transaction(async (tx) => {
    const updated = await tx.teamshipPrintJob.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedByUserId: context.userId,
        approvedAt: now
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "teamship.print.plan.approve",
        entityType: "TeamshipPrintJob",
        entityId: id,
        before: { status: "PENDING_APPROVAL" },
        after: {
          status: "APPROVED",
          shippingOrderNumber: updated.shippingOrderNumber,
          approvedPalletCount: updated.approvedPalletCount
        }
      }
    });
    return updated;
  });
  return serializePrintJob(approved);
}

export async function getTeamshipPrintJobForEmployee(context: AuthenticatedContext, jobId: string) {
  await requireTeamshipPrintAccess(context);
  await expireTeamshipPrintJobs(context.tenantId, new Date());
  const job = await prisma.teamshipPrintJob.findFirst({
    where: { id: requireJobId(jobId), tenantId: context.tenantId, requestedByUserId: context.userId }
  });
  if (!job) throw new TeamshipPrintJobError("Print request was not found.", 404);
  return serializePrintJob(job);
}

export async function claimNextTeamshipPrintJob(
  workerId: string,
  tenantSlug: string,
  dependencies: Pick<PrintJobDependencies, "now"> = {}
): Promise<ClaimedTeamshipPrintJob | null> {
  const now = dependencies.now?.() ?? new Date();
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (!tenant) throw new TeamshipPrintJobError("The print worker tenant was not found.", 404);
  await expireTeamshipPrintJobs(tenant.id, now);

  const pending = await prisma.teamshipPrintJob.findFirst({
    where: { tenantId: tenant.id, status: "APPROVED", expiresAt: { gt: now } },
    orderBy: { approvedAt: "asc" }
  });
  if (!pending) return null;
  const claimed = await prisma.teamshipPrintJob.updateMany({
    where: { id: pending.id, tenantId: tenant.id, status: "APPROVED" },
    data: {
      status: "CLAIMED",
      workerId,
      claimedAt: now,
      expiresAt: new Date(now.getTime() + CLAIM_TTL_MS)
    }
  });
  if (claimed.count !== 1) return null;

  const job = await prisma.teamshipPrintJob.findUniqueOrThrow({ where: { id: pending.id } });
  if (job.batchId) {
    await prisma.teamshipPrintBatch.updateMany({
      where: { id: job.batchId, tenantId: tenant.id, status: "APPROVED" },
      data: { status: "RUNNING" }
    });
  }
  const credentials = await resolveTenantTeamshipCredentials({ tenantId: tenant.id });
  if (!credentials) {
    await failTeamshipPrintJob(job.id, workerId, tenantSlug, {
      errorCode: "CREDENTIALS_NOT_CONFIGURED",
      errorMessage: "Tenant-scoped Teamship credentials are not configured."
    });
    return null;
  }

  return {
    id: job.id,
    shippingOrderNumber: job.shippingOrderNumber,
    teamshipOrderId: job.teamshipOrderId,
    customerName: job.customerName,
    warehouseName: job.warehouseName,
    approvedPalletCount: job.approvedPalletCount,
    documentPlan: parseDocumentPlan(job.documentPlan),
    printerPlan: parsePrinterPlan(job.printerPlan),
    credentials
  };
}

export async function completeTeamshipPrintJob(
  jobId: string,
  workerId: string,
  tenantSlug: string,
  result: unknown
) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (!tenant) return false;
  const job = await prisma.teamshipPrintJob.findFirst({
    where: { id: jobId, tenantId: tenant.id, status: "CLAIMED", workerId }
  });
  if (!job) return false;
  const normalized = parseExecutionResult(result, job);
  const completedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.teamshipPrintJob.updateMany({
      where: { id: jobId, tenantId: tenant.id, status: "CLAIMED", workerId },
      data: {
        status: "COMPLETED",
        completedAt,
        result: normalized as unknown as Prisma.InputJsonValue,
        errorCode: null,
        errorMessage: null
      }
    });
    if (updated.count !== 1) return false;
    if (!job.batchId) return true;

    const batch = await tx.teamshipPrintBatch.findFirst({
      where: { id: job.batchId, tenantId: tenant.id }
    });
    if (!batch) return true;

    if (job.reviewOrderId && batch.reviewRunId) {
      await tx.teamshipReviewOrder.updateMany({
        where: {
          id: job.reviewOrderId,
          tenantId: tenant.id,
          runId: batch.reviewRunId
        },
        data: {
          workflowStatus: "BOL_PRINTED",
          bolPrintedAt: completedAt,
          bolPrintedByUserId: batch.approvedByUserId,
          orderCompletedAt: null,
          orderCompletedByUserId: null
        }
      });
    }

    const next = await tx.teamshipPrintJob.findFirst({
      where: { tenantId: tenant.id, batchId: job.batchId, status: "WAITING_BATCH" },
      orderBy: { batchPosition: "asc" }
    });
    if (next) {
      await tx.teamshipPrintJob.update({
        where: { id: next.id },
        data: {
          status: "APPROVED",
          expiresAt: new Date(completedAt.getTime() + CLAIM_TTL_MS)
        }
      });
    } else {
      await tx.teamshipPrintBatch.updateMany({
        where: { id: job.batchId, tenantId: tenant.id, status: { in: ["APPROVED", "RUNNING"] } },
        data: {
          status: "COMPLETED",
          completedAt,
          errorCode: null,
          errorMessage: null
        }
      });
    }
    return true;
  });
}

export async function failTeamshipPrintJob(
  jobId: string,
  workerId: string,
  tenantSlug: string,
  failure: { errorCode: string; errorMessage: string; result?: unknown }
) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (!tenant) return false;
  const current = await prisma.teamshipPrintJob.findFirst({
    where: { id: jobId, tenantId: tenant.id, status: "CLAIMED", workerId }
  });
  if (!current) return false;
  const failedAt = new Date();
  const errorCode = sanitizeErrorCode(failure.errorCode);
  const errorMessage = sanitizeErrorMessage(failure.errorMessage);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.teamshipPrintJob.updateMany({
      where: { id: jobId, tenantId: tenant.id, status: "CLAIMED", workerId },
      data: {
        status: "FAILED",
        failedAt,
        errorCode,
        errorMessage,
        result: failure.result ? sanitizeFailureResult(failure.result) as Prisma.InputJsonValue : undefined,
        activeOrderKey: null
      }
    });
    if (updated.count !== 1) return false;
    if (!current.batchId) return true;

    await tx.teamshipPrintJob.updateMany({
      where: { tenantId: tenant.id, batchId: current.batchId, status: "WAITING_BATCH" },
      data: {
        status: "BLOCKED",
        errorCode: "BATCH_STOPPED",
        errorMessage: "The batch stopped after an earlier order failed. Physical output must be checked before creating a new plan.",
        activeOrderKey: null
      }
    });
    await tx.teamshipPrintBatch.updateMany({
      where: { id: current.batchId, tenantId: tenant.id, status: { in: ["APPROVED", "RUNNING"] } },
      data: {
        status: "PARTIAL_FAILED",
        failedAt,
        errorCode,
        errorMessage
      }
    });
    return true;
  });
}

export function getTeamshipPrinterPlan(
  env: Record<string, string | undefined> = process.env
): TeamshipPrintPrinterPlan {
  return {
    pickingList: {
      transport: "CUPS",
      queue: env.TEAMSHIP_PRINT_LOCAL_QUEUE?.trim() || DEFAULT_LOCAL_QUEUE,
      displayName: env.TEAMSHIP_PRINT_LOCAL_DISPLAY_NAME?.trim() || "192.168.1.28"
    },
    bol: {
      transport: "TEAMSHIP",
      exactName: env.TEAMSHIP_PRINT_BOL_PRINTER_NAME?.trim() || DEFAULT_OFFICE_PRINTER
    },
    outboundLabels: {
      transport: "TEAMSHIP",
      exactName: env.TEAMSHIP_PRINT_LABEL_PRINTER_NAME?.trim() || DEFAULT_LABEL_PRINTER
    }
  };
}

export function calculateTeamshipPalletCount(order: TeamshipShippingOrderDetail) {
  const rows = order.pallet_dims?.length ? order.pallet_dims : order.pallets ?? [];
  if (rows.length === 0) {
    throw new TeamshipPrintJobError("Teamship did not return a pallet count; nothing was queued.", 409);
  }
  const quantities = rows.map((row) => Number(row.quantity));
  if (quantities.some((quantity) => !Number.isInteger(quantity) || quantity < 1)) {
    throw new TeamshipPrintJobError("Teamship returned an invalid pallet quantity; nothing was queued.", 409);
  }
  const total = quantities.reduce((sum, quantity) => sum + quantity, 0);
  if (total < 1 || total > MAX_PALLET_COUNT) {
    throw new TeamshipPrintJobError("The calculated pallet-label quantity is outside the allowed range.", 409);
  }
  return total;
}

async function preflightTeamshipShippingOrderPalletCount(input: {
  context: AuthenticatedContext;
  teamshipOrderId: string;
  customerName: string;
  warehouseName: string;
}) {
  const adapter = getConfiguredTeamshipBrowserJobAdapter({
    tenantId: input.context.tenantId,
    tenantSlug: input.context.tenantSlug,
    requestedBy: {
      userId: input.context.userId,
      userEmail: input.context.userEmail,
      userName: input.context.userName
    },
    timeoutMs: 90_000
  });
  if (!adapter?.getShippingOrderPallets) {
    throw new TeamshipPrintJobError(
      "The local Teamship page preflight is not configured; nothing was queued.",
      503
    );
  }

  const settings = await getTenantTeamshipSettings(input.context);
  const matchingScopes = settings.readOnlyScopes.filter((scope) =>
    sameTeamshipName(scope.customerName, input.customerName)
    && sameTeamshipName(scope.warehouseName, input.warehouseName)
  );
  if (matchingScopes.length !== 1) {
    throw new TeamshipPrintJobError(
      "The Garland and Annagem Teamship browser scope was missing or ambiguous; nothing was queued.",
      409
    );
  }

  const credentials = await resolveTenantTeamshipCredentials(input.context);
  if (!credentials) {
    throw new TeamshipPrintJobError("Teamship credentials are not configured; nothing was queued.", 503);
  }

  let rows;
  try {
    rows = await adapter.getShippingOrderPallets({
      credentials,
      scope: matchingScopes[0]!,
      teamshipOrderId: input.teamshipOrderId
    });
  } catch {
    throw new TeamshipPrintJobError(
      "The local Teamship page preflight was unavailable or failed; nothing was queued.",
      503
    );
  }
  if (rows.length !== 1) {
    throw new TeamshipPrintJobError(
      "The local Teamship page preflight did not return one exact shipping order; nothing was queued.",
      409
    );
  }

  const row = rows[0]!;
  if (
    row.teamshipOrderId !== input.teamshipOrderId
    || !sameTeamshipName(row.customerName, input.customerName)
    || !sameTeamshipName(row.warehouseName, input.warehouseName)
  ) {
    throw new TeamshipPrintJobError(
      "The local Teamship page preflight did not match the requested order, customer, and warehouse; nothing was queued.",
      409
    );
  }
  if (!Number.isInteger(row.palletCount) || row.palletCount < 1 || row.palletCount > MAX_PALLET_COUNT) {
    throw new TeamshipPrintJobError(
      "The local Teamship page preflight returned an invalid pallet count; nothing was queued.",
      409
    );
  }
  return row.palletCount;
}

function sameTeamshipName(left: string, right: string) {
  return left.replace(/\s+/g, " ").trim().toLowerCase() === right.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function requireTeamshipPrintAccess(context: AuthenticatedContext) {
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(context);
  if (!hasTeamshipInternalReadAccess(context)) {
    throw new TeamshipPrintJobError("Teamship printing is not permitted for this employee.", 403);
  }
}

async function expireTeamshipPrintJobs(tenantId: string, now: Date) {
  const expiredBatchJobs = await prisma.teamshipPrintJob.findMany({
    where: {
      tenantId,
      batchId: { not: null },
      status: { in: ["PENDING_APPROVAL", "APPROVED", "CLAIMED"] },
      expiresAt: { lt: now }
    },
    select: { batchId: true }
  });
  await prisma.teamshipPrintJob.updateMany({
    where: { tenantId, status: { in: ["PENDING_APPROVAL", "APPROVED", "CLAIMED"] }, expiresAt: { lt: now } },
    data: {
      status: "EXPIRED",
      errorCode: "JOB_EXPIRED",
      errorMessage: "The print job expired. It was not retried automatically.",
      activeOrderKey: null
    }
  });
  const batchIds = Array.from(new Set(expiredBatchJobs.map((job) => job.batchId).filter((value): value is string => Boolean(value))));
  if (batchIds.length > 0) {
    await prisma.teamshipPrintJob.updateMany({
      where: { tenantId, batchId: { in: batchIds }, status: "WAITING_BATCH" },
      data: {
        status: "BLOCKED",
        errorCode: "BATCH_STOPPED",
        errorMessage: "The batch stopped because an earlier print job expired.",
        activeOrderKey: null
      }
    });
    await prisma.teamshipPrintBatch.updateMany({
      where: { tenantId, id: { in: batchIds }, status: { in: ["PENDING_APPROVAL", "APPROVED", "RUNNING"] } },
      data: {
        status: "PARTIAL_FAILED",
        failedAt: now,
        errorCode: "JOB_EXPIRED",
        errorMessage: "A print job expired. The batch was stopped and was not retried."
      }
    });
  }
}

function parseExecutionResult(value: unknown, job: { approvedPalletCount: number; documentPlan: unknown; printerPlan: unknown }) {
  const record = requireRecord(value, "Print result");
  if (record.status !== "COMPLETED") throw new TeamshipPrintJobError("Print result status must be COMPLETED.");
  if (record.observedPalletCount !== job.approvedPalletCount) {
    throw new TeamshipPrintJobError("The completed print result pallet count does not match the approved count.");
  }
  if (typeof record.completedAt !== "string" || !Number.isFinite(Date.parse(record.completedAt))) {
    throw new TeamshipPrintJobError("Print result completedAt is invalid.");
  }
  const documents = Array.isArray(record.documents) ? record.documents : [];
  if (documents.length !== 3) throw new TeamshipPrintJobError("Print result must contain exactly three document results.");
  const documentPlan = parseDocumentPlan(job.documentPlan);
  const printerPlan = parsePrinterPlan(job.printerPlan);
  const expected = new Map<string, { copies: number; printer: string; statuses: string[] }>([
    ["PICKING_LIST", { copies: documentPlan.pickingListCopies, printer: printerPlan.pickingList.queue, statuses: ["COMPLETED"] }],
    ["BOL", { copies: documentPlan.bolCopies, printer: printerPlan.bol.exactName, statuses: ["SUBMITTED"] }],
    ["OUTBOUND_LABELS", { copies: documentPlan.outboundLabelCopies, printer: printerPlan.outboundLabels.exactName, statuses: ["SUBMITTED"] }]
  ]);
  const normalized = documents.map((item) => {
    const row = requireRecord(item, "Print document result");
    const kind = String(row.kind ?? "");
    const requirement = expected.get(kind);
    if (!requirement || row.copies !== requirement.copies || row.printer !== requirement.printer || !requirement.statuses.includes(String(row.status))) {
      throw new TeamshipPrintJobError(`Print result for ${kind || "unknown document"} does not match the approved plan.`);
    }
    expected.delete(kind);
    return { kind, status: String(row.status), printer: String(row.printer), copies: Number(row.copies) };
  });
  if (expected.size > 0) throw new TeamshipPrintJobError("Print result is missing an approved document.");
  return {
    status: "COMPLETED",
    observedPalletCount: job.approvedPalletCount,
    documents: normalized,
    completedAt: record.completedAt
  };
}

function parseDocumentPlan(value: unknown): TeamshipPrintDocumentPlan {
  const record = requireRecord(value, "Document plan");
  const outboundLabelCopies = Number(record.outboundLabelCopies);
  if (record.pickingListCopies !== 1 || record.bolCopies !== 1 || !Number.isInteger(outboundLabelCopies) || outboundLabelCopies < 1 || outboundLabelCopies > MAX_PALLET_COUNT) {
    throw new TeamshipPrintJobError("Stored print document plan is invalid.");
  }
  return { pickingListCopies: 1, bolCopies: 1, outboundLabelCopies };
}

function parsePrinterPlan(value: unknown): TeamshipPrintPrinterPlan {
  const record = requireRecord(value, "Printer plan");
  const pickingList = requireRecord(record.pickingList, "Picking-list printer plan");
  const bol = requireRecord(record.bol, "BOL printer plan");
  const outboundLabels = requireRecord(record.outboundLabels, "Outbound-label printer plan");
  if (pickingList.transport !== "CUPS" || bol.transport !== "TEAMSHIP" || outboundLabels.transport !== "TEAMSHIP") {
    throw new TeamshipPrintJobError("Stored printer transports are invalid.");
  }
  return {
    pickingList: {
      transport: "CUPS",
      queue: requireStoredString(pickingList.queue, "Picking-list queue"),
      displayName: requireStoredString(pickingList.displayName, "Picking-list printer name")
    },
    bol: { transport: "TEAMSHIP", exactName: requireStoredString(bol.exactName, "BOL printer name") },
    outboundLabels: {
      transport: "TEAMSHIP",
      exactName: requireStoredString(outboundLabels.exactName, "Outbound-label printer name")
    }
  };
}

function serializePrintJob(job: {
  id: string;
  shippingOrderNumber: string;
  teamshipOrderId: string;
  customerName: string;
  warehouseName: string;
  status: string;
  documentPlan: unknown;
  printerPlan: unknown;
  approvedPalletCount: number;
  approvedAt: Date | null;
  expiresAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
}) {
  return {
    id: job.id,
    shippingOrderNumber: job.shippingOrderNumber,
    teamshipOrderId: job.teamshipOrderId,
    customerName: job.customerName,
    warehouseName: job.warehouseName,
    status: readStatus(job.status),
    documentPlan: parseDocumentPlan(job.documentPlan),
    printerPlan: parsePrinterPlan(job.printerPlan),
    approvedPalletCount: job.approvedPalletCount,
    approvedAt: job.approvedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    failedAt: job.failedAt?.toISOString() ?? null,
    result: job.result,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage
  };
}

function readStatus(value: string): TeamshipPrintJobStatus {
  if (!TEAMSHIP_PRINT_JOB_STATUSES.includes(value as TeamshipPrintJobStatus)) {
    throw new TeamshipPrintJobError("Stored print status is invalid.");
  }
  return value as TeamshipPrintJobStatus;
}

function readTeamshipShippingOrderNumbers(order: TeamshipShippingOrderDetail) {
  return [order.display_id, order.order_number, order.record_no, order.id, order.order_id]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

export function teamshipOrderMatchesShippingOrderNumber(
  order: TeamshipShippingOrderDetail,
  shippingOrderNumber: string
) {
  return readTeamshipShippingOrderNumbers(order).includes(shippingOrderNumber);
}

export function resolveTeamshipInternalOrderId(order: TeamshipShippingOrderDetail) {
  const explicit = normalizeInternalOrderId(order.teamship_internal_id);
  const fromUrl = readInternalOrderIdFromUrl(order.url);
  if (explicit && fromUrl && explicit !== fromUrl) {
    throw new TeamshipPrintJobError("Teamship returned conflicting internal shipping-order IDs; nothing was queued.", 409);
  }
  const resolved = explicit ?? fromUrl;
  if (!resolved) {
    throw new TeamshipPrintJobError("Teamship did not return the internal shipping-order ID; nothing was queued.", 409);
  }
  return resolved;
}

export function resolveTeamshipDisplayShippingOrderNumber(order: TeamshipShippingOrderDetail) {
  const internalOrderId = resolveTeamshipInternalOrderId(order);
  const numericCandidates = [order.display_id, order.order_number, order.id, order.order_id]
    .map((value) => String(value ?? "").trim())
    .filter((value) => /^\d{1,10}$/.test(value))
    .filter((value, index, values) => values.indexOf(value) === index);
  const displayCandidates = numericCandidates.filter((value) => value !== internalOrderId);

  if (displayCandidates.length === 1) {
    return displayCandidates[0]!;
  }
  if (displayCandidates.length > 1) {
    throw new TeamshipPrintJobError(
      "Teamship returned conflicting display shipping-order numbers; nothing was queued.",
      409
    );
  }
  if (numericCandidates.includes(internalOrderId)) {
    return internalOrderId;
  }
  throw new TeamshipPrintJobError(
    "Teamship did not return the display shipping-order number; nothing was queued.",
    409
  );
}

async function requireNoActivePrintJob(tenantId: string, shippingOrderNumber: string) {
  const existingOrderJob = await prisma.teamshipPrintJob.findUnique({
    where: { tenantId_activeOrderKey: { tenantId, activeOrderKey: shippingOrderNumber } }
  });
  if (existingOrderJob) {
    throw new TeamshipPrintJobError(
      `Print request ${existingOrderJob.id} already controls shipping order ${shippingOrderNumber} with status ${existingOrderJob.status}. Check that request before printing again.`,
      409
    );
  }
}

async function resolveDisplayPrintOrder(
  context: AuthenticatedContext,
  shippingOrderNumber: string,
  findOrders: typeof findTeamshipShippingOrders
) {
  const orders = await findOrders({
    tenantId: context.tenantId,
    orderIdentifier: shippingOrderNumber
  });
  const exact = orders.filter((order) => teamshipOrderMatchesShippingOrderNumber(order, shippingOrderNumber));
  if (exact.length === 0) {
    throw new TeamshipPrintJobError(`No exact Teamship shipping order ${shippingOrderNumber} was found.`, 404);
  }
  if (exact.length !== 1) {
    throw new TeamshipPrintJobError(
      `Teamship returned more than one exact order ${shippingOrderNumber}; nothing was queued.`,
      409
    );
  }
  return { shippingOrderNumber, order: exact[0]! };
}

async function resolveReviewPrintOrder(
  context: AuthenticatedContext,
  reference: TeamshipPrintReviewReference,
  findOrders: typeof findTeamshipShippingOrders
) {
  const psNumber = requireReviewIdentifier(reference.psNumber, "PS", /^PS\d{6}$/);
  const srNumber = requireReviewIdentifier(reference.srNumber, "SR", /^SR[A-Z0-9-]{1,30}$/);
  const storedOrderId = requireShippingOrderNumber(reference.teamshipOrderId);
  const expectedInternalId = readInternalOrderIdFromUrl(reference.teamshipUrl);
  const orders = await findOrders({
    tenantId: context.tenantId,
    orderIdentifier: psNumber
  });
  const exact = orders.filter((order) =>
    teamshipOrderMatchesReviewReference(order, {
      psNumber,
      srNumber,
      storedOrderId,
      expectedInternalId
    })
  );

  if (exact.length === 0) {
    throw new TeamshipPrintJobError(
      `No exact Teamship shipping order was found for ${psNumber} / ${srNumber}; nothing was queued.`,
      404
    );
  }
  if (exact.length !== 1) {
    throw new TeamshipPrintJobError(
      `Teamship returned more than one exact order for ${psNumber} / ${srNumber}; nothing was queued.`,
      409
    );
  }

  const order = exact[0]!;
  return {
    shippingOrderNumber: resolveTeamshipDisplayShippingOrderNumber(order),
    order
  };
}

function teamshipOrderMatchesReviewReference(
  order: TeamshipShippingOrderDetail,
  reference: {
    psNumber: string;
    srNumber: string;
    storedOrderId: string;
    expectedInternalId: string | null;
  }
) {
  const psMatches = [order.record_no, order.edi_field_2, order.order_number, order.display_id]
    .some((value) => normalizeExactIdentifier(value) === reference.psNumber);
  const srMatches = [order.shipment_id, order.amazon_shipment_id1, order.edi_field_1]
    .some((value) => normalizeExactIdentifier(value) === reference.srNumber);
  if (!psMatches || !srMatches) {
    return false;
  }

  const internalOrderId = resolveTeamshipInternalOrderId(order);
  if (reference.expectedInternalId) {
    return internalOrderId === reference.expectedInternalId;
  }
  return internalOrderId === reference.storedOrderId
    || teamshipOrderMatchesShippingOrderNumber(order, reference.storedOrderId);
}

function requireReviewIdentifier(value: unknown, label: string, pattern: RegExp) {
  const normalized = normalizeExactIdentifier(value);
  if (!pattern.test(normalized)) {
    throw new TeamshipPrintJobError(`${label} review reference is invalid.`);
  }
  return normalized;
}

function normalizeExactIdentifier(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function normalizeInternalOrderId(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^\d{1,10}$/.test(normalized) ? normalized : null;
}

function readInternalOrderIdFromUrl(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  try {
    const match = new URL(normalized).pathname.match(/^\/ship-inventories\/(\d{1,10})(?:\/|$)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function readTeamshipCustomerName(order: TeamshipShippingOrderDetail) {
  return String(order.customer?.company ?? order.customer?.name ?? order.customer_name ?? order.company ?? order.user_company ?? "").trim();
}

export function readTeamshipWarehouseName(order: TeamshipShippingOrderDetail) {
  return String(order.warehouse_name ?? order.location_name ?? "").trim();
}

function requireShippingOrderNumber(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,10}$/.test(normalized)) {
    throw new TeamshipPrintJobError("shippingOrderNumber must be the exact numeric Teamship shipping-order number.");
  }
  return normalized;
}

function requireRequestKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TeamshipPrintJobError("requestKey is invalid.");
  return normalized;
}

function requireJobId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9]{10,40}$/i.test(normalized)) throw new TeamshipPrintJobError("jobId is invalid.");
  return normalized;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TeamshipPrintJobError(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function requireStoredString(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 200) throw new TeamshipPrintJobError(`${label} is invalid.`);
  return normalized;
}

function sanitizeErrorCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80) || "PRINT_FAILED";
}

function sanitizeErrorMessage(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000) || "Print worker failed.";
}

function sanitizeFailureResult(value: unknown) {
  const record = requireRecord(value, "Partial print result");
  return {
    status: "FAILED",
    observedPalletCount: Number.isInteger(record.observedPalletCount) ? record.observedPalletCount : null,
    documents: Array.isArray(record.documents)
      ? record.documents.slice(0, 3).map((item) => {
          const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
          return {
            kind: String(row.kind ?? "UNKNOWN").slice(0, 40),
            status: String(row.status ?? "UNKNOWN").slice(0, 40),
            printer: String(row.printer ?? "").slice(0, 200),
            copies: Number.isInteger(row.copies) ? row.copies : null
          };
        })
      : []
  };
}

function readPrismaErrorCode(value: unknown) {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>).code === "string"
    ? (value as Record<string, string>).code
    : null;
}
