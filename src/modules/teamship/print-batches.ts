import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";

import {
  createTeamshipPrintPlan,
  requireTeamshipPrintAccess,
  TeamshipPrintJobError
} from "@/modules/teamship/print-jobs";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

const BATCH_APPROVAL_TTL_MS = 15 * 60_000;
const BATCH_EXECUTION_TTL_MS = 4 * 60 * 60_000;
const FIRST_JOB_CLAIM_TTL_MS = 15 * 60_000;
const MAX_BATCH_ORDERS = 50;

export type TeamshipPrintBatchSelection = {
  orderId: string;
  manualCorrectionConfirmed: boolean;
};

export type TeamshipPrintBatchPlannedItem = {
  reviewOrderId: string;
  psNumber: string;
  srNumber: string;
  reviewStatus: "PASS" | "FAIL";
  manualCorrectionConfirmed: boolean;
  shippingOrderNumber: string;
  jobId: string;
  palletCount: number;
};

export type TeamshipPrintBatchExcludedItem = {
  reviewOrderId: string;
  psNumber: string;
  srNumber: string;
  reason: string;
};

export type TeamshipPrintBatchSummary = {
  planned: TeamshipPrintBatchPlannedItem[];
  excluded: TeamshipPrintBatchExcludedItem[];
  totalPickingLists: number;
  totalBols: number;
  totalOutboundLabels: number;
};

export class TeamshipPrintBatchError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TeamshipPrintBatchError";
    this.status = status;
  }
}

export async function createTeamshipPrintBatchPlan(
  context: AuthenticatedContext,
  input: {
    runId: string;
    selections: TeamshipPrintBatchSelection[];
    requestKey: string;
  },
  dependencies: {
    createPrintPlan?: typeof createTeamshipPrintPlan;
    now?: () => Date;
  } = {}
) {
  await requireTeamshipPrintAccess(context);
  const runId = requireRecordId(input.runId, "runId");
  const requestKey = requireRequestKey(input.requestKey);
  const selections = normalizeSelections(input.selections);
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(`${context.tenantId}:${context.userId}:${requestKey}`)
    .digest("hex");

  const existing = await prisma.teamshipPrintBatch.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: context.tenantId, idempotencyKey } },
    include: { jobs: { orderBy: { batchPosition: "asc" } } }
  });
  if (existing) {
    if (existing.requestedByUserId !== context.userId || existing.reviewRunId !== runId) {
      throw new TeamshipPrintBatchError("The batch request key is already in use.", 409);
    }
    return serializeBatch(existing);
  }

  const run = await prisma.teamshipReviewRun.findFirst({
    where: {
      id: runId,
      tenantId: context.tenantId,
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      deletedAt: null
    },
    select: {
      id: true,
      orders: {
        where: { id: { in: selections.map((selection) => selection.orderId) } },
        select: {
          id: true,
          psNumber: true,
          srNumber: true,
          status: true,
          teamshipOrderId: true,
          teamshipUrl: true,
          workflowStatus: true
        }
      }
    }
  });
  if (!run) {
    throw new TeamshipPrintBatchError("The saved Garland review batch was not found.", 404);
  }

  const byId = new Map(run.orders.map((order) => [order.id, order]));
  const now = dependencies.now?.() ?? new Date();
  const batch = await prisma.teamshipPrintBatch.create({
    data: {
      tenantId: context.tenantId,
      reviewRunId: run.id,
      status: "PLANNING",
      summary: emptySummary() as unknown as Prisma.InputJsonValue,
      idempotencyKey,
      requestedByUserId: context.userId,
      expiresAt: new Date(now.getTime() + BATCH_APPROVAL_TTL_MS)
    }
  });

  const planned: TeamshipPrintBatchPlannedItem[] = [];
  const excluded: TeamshipPrintBatchExcludedItem[] = [];

  for (const [position, selection] of selections.entries()) {
    const order = byId.get(selection.orderId);
    if (!order) {
      excluded.push({
        reviewOrderId: selection.orderId,
        psNumber: "Unknown PS",
        srNumber: "Unknown SR",
        reason: "This order was not found in the selected saved batch."
      });
      continue;
    }

    const eligibilityError = getEligibilityError(order, selection.manualCorrectionConfirmed);
    if (eligibilityError) {
      excluded.push(toExcluded(order, eligibilityError));
      continue;
    }

    try {
      const childRequestKey = crypto
        .createHash("sha256")
        .update(`${batch.id}:${order.id}`)
        .digest("hex");
      const job = await (dependencies.createPrintPlan ?? createTeamshipPrintPlan)(context, {
        reviewReference: {
          psNumber: order.psNumber,
          srNumber: order.srNumber,
          teamshipOrderId: order.teamshipOrderId!,
          teamshipUrl: order.teamshipUrl
        },
        requestKey: childRequestKey,
        batch: {
          batchId: batch.id,
          batchPosition: position,
          reviewOrderId: order.id
        }
      });
      planned.push({
        reviewOrderId: order.id,
        psNumber: order.psNumber,
        srNumber: order.srNumber,
        reviewStatus: order.status as "PASS" | "FAIL",
        manualCorrectionConfirmed: order.status === "FAIL",
        shippingOrderNumber: job.shippingOrderNumber,
        jobId: job.id,
        palletCount: job.approvedPalletCount
      });
    } catch (error) {
      excluded.push(toExcluded(order, readablePlanError(error)));
    }
  }

  const summary = buildSummary(planned, excluded);
  const finalStatus = planned.length > 0 ? "PENDING_APPROVAL" : "FAILED";
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.teamshipPrintBatch.update({
      where: { id: batch.id },
      data: {
        status: finalStatus,
        summary: summary as unknown as Prisma.InputJsonValue,
        failedAt: planned.length === 0 ? new Date() : null,
        errorCode: planned.length === 0 ? "NO_PRINTABLE_ORDERS" : null,
        errorMessage: planned.length === 0 ? "No selected order passed batch print preflight." : null
      },
      include: { jobs: { orderBy: { batchPosition: "asc" } } }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "teamship.print.batch.plan.create",
        entityType: "TeamshipPrintBatch",
        entityId: batch.id,
        after: {
          reviewRunId: run.id,
          status: finalStatus,
          planned: summary.planned.map((item) => ({
            reviewOrderId: item.reviewOrderId,
            psNumber: item.psNumber,
            srNumber: item.srNumber,
            reviewStatus: item.reviewStatus,
            manualCorrectionConfirmed: item.manualCorrectionConfirmed,
            shippingOrderNumber: item.shippingOrderNumber,
            palletCount: item.palletCount
          })),
          excluded: summary.excluded
        } as unknown as Prisma.InputJsonValue
      }
    });
    return result;
  });

  return serializeBatch(updated);
}

export async function approveTeamshipPrintBatch(
  context: AuthenticatedContext,
  input: { batchId: string; runId: string; confirmed: boolean }
) {
  await requireTeamshipPrintAccess(context);
  if (!input.confirmed) {
    throw new TeamshipPrintBatchError("Explicit batch print confirmation is required.");
  }
  const batchId = requireRecordId(input.batchId, "batchId");
  const runId = requireRecordId(input.runId, "runId");
  const now = new Date();
  const current = await prisma.teamshipPrintBatch.findFirst({
    where: { id: batchId, tenantId: context.tenantId, reviewRunId: runId },
    include: { jobs: { orderBy: { batchPosition: "asc" } } }
  });
  if (!current) throw new TeamshipPrintBatchError("The print batch was not found.", 404);
  if (current.requestedByUserId !== context.userId) {
    throw new TeamshipPrintBatchError("Only the employee who prepared this batch can approve it.", 403);
  }
  if (current.status !== "PENDING_APPROVAL") {
    return serializeBatch(current);
  }
  if (current.expiresAt <= now) {
    await prisma.$transaction([
      prisma.teamshipPrintBatch.update({
        where: { id: batchId },
        data: {
          status: "EXPIRED",
          failedAt: now,
          errorCode: "APPROVAL_EXPIRED",
          errorMessage: "The batch plan expired before approval."
        }
      }),
      prisma.teamshipPrintJob.updateMany({
        where: { tenantId: context.tenantId, batchId, status: "PENDING_APPROVAL" },
        data: {
          status: "EXPIRED",
          errorCode: "APPROVAL_EXPIRED",
          errorMessage: "The batch plan expired before approval.",
          activeOrderKey: null
        }
      })
    ]);
    throw new TeamshipPrintBatchError("The print batch expired. Prepare a fresh plan.", 409);
  }
  if (current.jobs.length === 0) {
    throw new TeamshipPrintBatchError("The print batch has no printable orders.", 409);
  }

  const executionExpiresAt = new Date(now.getTime() + BATCH_EXECUTION_TTL_MS);
  const firstJobExpiresAt = new Date(now.getTime() + FIRST_JOB_CLAIM_TTL_MS);
  const approved = await prisma.$transaction(async (tx) => {
    const updated = await tx.teamshipPrintBatch.update({
      where: { id: batchId },
      data: {
        status: "APPROVED",
        approvedByUserId: context.userId,
        approvedAt: now,
        expiresAt: executionExpiresAt
      }
    });
    await tx.teamshipPrintJob.update({
      where: { id: current.jobs[0]!.id },
      data: {
        status: "APPROVED",
        approvedByUserId: context.userId,
        approvedAt: now,
        expiresAt: firstJobExpiresAt
      }
    });
    if (current.jobs.length > 1) {
      await tx.teamshipPrintJob.updateMany({
        where: {
          tenantId: context.tenantId,
          batchId,
          id: { in: current.jobs.slice(1).map((job) => job.id) },
          status: "PENDING_APPROVAL"
        },
        data: {
          status: "WAITING_BATCH",
          approvedByUserId: context.userId,
          approvedAt: now,
          expiresAt: executionExpiresAt
        }
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "teamship.print.batch.approve",
        entityType: "TeamshipPrintBatch",
        entityId: batchId,
        before: { status: "PENDING_APPROVAL" },
        after: {
          status: "APPROVED",
          jobIds: current.jobs.map((job) => job.id),
          manuallyCorrectedOrderIds: readSummary(current.summary).planned
            .filter((item) => item.manualCorrectionConfirmed)
            .map((item) => item.reviewOrderId)
        } as unknown as Prisma.InputJsonValue
      }
    });
    return updated;
  });

  return getTeamshipPrintBatch(context, approved.id);
}

export async function getTeamshipPrintBatch(context: AuthenticatedContext, batchId: string) {
  await requireTeamshipPrintAccess(context);
  const batch = await prisma.teamshipPrintBatch.findFirst({
    where: {
      id: requireRecordId(batchId, "batchId"),
      tenantId: context.tenantId,
      requestedByUserId: context.userId
    },
    include: { jobs: { orderBy: { batchPosition: "asc" } } }
  });
  if (!batch) throw new TeamshipPrintBatchError("The print batch was not found.", 404);
  return serializeBatch(batch);
}

function getEligibilityError(
  order: {
    status: string;
    workflowStatus: string;
    teamshipOrderId: string | null;
  },
  manualCorrectionConfirmed: boolean
) {
  if (!order.teamshipOrderId || !/^\d{1,10}$/.test(order.teamshipOrderId.trim())) {
    return "No exact numeric Teamship shipping-order number is saved.";
  }
  if (order.workflowStatus === "BOL_PRINTED" || order.workflowStatus === "ORDER_COMPLETE") {
    return "This order is already marked printed or complete.";
  }
  if (order.status === "PASS") {
    return order.workflowStatus === "READY_TO_PRINT"
      ? null
      : "This passed order is not marked Ready to print.";
  }
  if (order.status === "FAIL") {
    return manualCorrectionConfirmed
      ? null
      : "Confirm that the failed check was corrected in Teamship before printing.";
  }
  return "Only passed orders or manually corrected failed orders can be printed.";
}

function normalizeSelections(value: TeamshipPrintBatchSelection[]) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TeamshipPrintBatchError("Select at least one PS number to print.");
  }
  if (value.length > MAX_BATCH_ORDERS) {
    throw new TeamshipPrintBatchError(`A print batch cannot exceed ${MAX_BATCH_ORDERS} orders.`);
  }
  const seen = new Set<string>();
  return value.map((selection, index) => {
    const orderId = requireRecordId(selection?.orderId, `selections[${index}].orderId`);
    if (seen.has(orderId)) {
      throw new TeamshipPrintBatchError("Each saved order may be selected only once.");
    }
    seen.add(orderId);
    return {
      orderId,
      manualCorrectionConfirmed: selection?.manualCorrectionConfirmed === true
    };
  });
}

function buildSummary(
  planned: TeamshipPrintBatchPlannedItem[],
  excluded: TeamshipPrintBatchExcludedItem[]
): TeamshipPrintBatchSummary {
  return {
    planned,
    excluded,
    totalPickingLists: planned.length,
    totalBols: planned.length,
    totalOutboundLabels: planned.reduce((total, item) => total + item.palletCount, 0)
  };
}

function emptySummary(): TeamshipPrintBatchSummary {
  return buildSummary([], []);
}

function toExcluded(
  order: { id: string; psNumber: string; srNumber: string },
  reason: string
): TeamshipPrintBatchExcludedItem {
  return {
    reviewOrderId: order.id,
    psNumber: order.psNumber,
    srNumber: order.srNumber,
    reason
  };
}

function readablePlanError(error: unknown) {
  if (error instanceof TeamshipPrintJobError || error instanceof TeamshipPrintBatchError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Teamship print preflight failed.";
}

function requireRecordId(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9_-]{8,64}$/i.test(normalized)) {
    throw new TeamshipPrintBatchError(`${label} is invalid.`);
  }
  return normalized;
}

function requireRequestKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9-]{16,128}$/i.test(normalized)) {
    throw new TeamshipPrintBatchError("requestKey is invalid.");
  }
  return normalized;
}

function serializeBatch(batch: {
  id: string;
  reviewRunId: string | null;
  status: string;
  summary: unknown;
  approvedAt: Date | null;
  expiresAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  jobs: Array<{
    id: string;
    shippingOrderNumber: string;
    status: string;
    approvedPalletCount: number;
    printerPlan: unknown;
    batchPosition: number | null;
    completedAt: Date | null;
    failedAt: Date | null;
    errorMessage: string | null;
  }>;
}) {
  return {
    id: batch.id,
    reviewRunId: batch.reviewRunId,
    status: batch.status,
    summary: readSummary(batch.summary),
    approvedAt: batch.approvedAt?.toISOString() ?? null,
    expiresAt: batch.expiresAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? null,
    failedAt: batch.failedAt?.toISOString() ?? null,
    errorCode: batch.errorCode,
    errorMessage: batch.errorMessage,
    jobs: batch.jobs.map((job) => ({
      id: job.id,
      shippingOrderNumber: job.shippingOrderNumber,
      status: job.status,
      palletCount: job.approvedPalletCount,
      printerPlan: job.printerPlan,
      position: job.batchPosition,
      completedAt: job.completedAt?.toISOString() ?? null,
      failedAt: job.failedAt?.toISOString() ?? null,
      errorMessage: job.errorMessage
    }))
  };
}

function readSummary(value: unknown): TeamshipPrintBatchSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptySummary();
  }
  const record = value as Record<string, unknown>;
  const planned = Array.isArray(record.planned) ? record.planned as TeamshipPrintBatchPlannedItem[] : [];
  const excluded = Array.isArray(record.excluded) ? record.excluded as TeamshipPrintBatchExcludedItem[] : [];
  return {
    planned,
    excluded,
    totalPickingLists: Number(record.totalPickingLists) || 0,
    totalBols: Number(record.totalBols) || 0,
    totalOutboundLabels: Number(record.totalOutboundLabels) || 0
  };
}
