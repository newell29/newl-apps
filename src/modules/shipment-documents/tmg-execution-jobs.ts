import type { Prisma } from "@prisma/client";

import { hashTmgBatchApproval } from "@/modules/shipment-documents/tmg-email-intake";
import { buildTmgInternalSummaryMessages } from "@/modules/shipment-documents/tmg-internal-summary";
import { getTmgOrderIntakeSettings } from "@/modules/shipment-documents/tmg-settings";
import type {
  TmgTeamshipApproval,
  TmgTeamshipCreateEvidence,
  TmgTeamshipCreatePlan
} from "@/modules/shipment-documents/tmg-teamship-create";
import { hasExactTmgTeamshipReference } from "@/modules/shipment-documents/tmg-teamship-create";
import type { TmgDocumentUploadResult } from "@/modules/shipment-documents/tmg-teamship-document-upload";
import { prisma } from "@/server/db";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import { createAndSendMicrosoftGraphMailboxMessage } from "@/server/integrations/microsoft-graph-mail";
import { findTeamshipShippingOrders } from "@/server/integrations/teamship";
import type { AuthenticatedContext, TenantContext } from "@/server/tenant-context";

export class TmgExecutionError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "TmgExecutionError";
    this.status = status;
  }
}

export async function approveTmgOrderBatch(
  context: AuthenticatedContext,
  input: { batchId: string; confirmed: boolean }
) {
  if (!input.confirmed) throw new TmgExecutionError("Explicit CSR approval is required before Teamship orders can be created.");
  const batch = await prisma.tmgOrderIntakeBatch.findFirst({
    where: { id: requireId(input.batchId), tenantId: context.tenantId },
    include: { orders: true, executionJob: true }
  });
  if (!batch) throw new TmgExecutionError("TMG email batch was not found.", 404);
  if (!batch.executionJob) throw new TmgExecutionError("This batch has no valid orders available for approval.");
  if (batch.executionJob.status !== "PENDING_APPROVAL") {
    if (["APPROVED", "CLAIMED", "RUNNING", "SUCCESS", "PARTIAL_FAILED"].includes(batch.executionJob.status)) return batch;
    throw new TmgExecutionError(`TMG execution job cannot be approved from ${batch.executionJob.status}.`);
  }

  const selectedIds = readStringArray(batch.executionJob.selectedOrderIds);
  const selected = batch.orders.filter((order) => selectedIds.includes(order.id));
  if (selected.length === 0 || selected.length !== selectedIds.length) {
    throw new TmgExecutionError("The approved TMG order selection is incomplete. Scan the email again for review.");
  }
  for (const order of selected) {
    if (
      order.status !== "READY_FOR_APPROVAL" ||
      order.teamshipCreateStatus !== "NOT_STARTED" ||
      !order.teamshipPlan ||
      !order.planRequestHash ||
      !order.combinedPdfHash ||
      !order.combinedPdfBytes
    ) {
      throw new TmgExecutionError(`TMG order ${order.customerReference} changed after preparation and cannot be approved.`);
    }
    const plan = order.teamshipPlan as unknown as TmgTeamshipCreatePlan;
    if (plan.requestHash !== order.planRequestHash || plan.packetHash !== order.combinedPdfHash) {
      throw new TmgExecutionError(`TMG order ${order.customerReference} no longer matches its frozen plan.`);
    }
  }
  const computedHash = hashTmgBatchApproval(selected.map((order) => ({
    id: order.id,
    planRequestHash: order.planRequestHash,
    packetHash: order.combinedPdfHash
  })));
  if (computedHash !== batch.approvalRequestHash || computedHash !== batch.executionJob.requestHash) {
    throw new TmgExecutionError("The TMG approval request changed after review. A fresh batch is required.");
  }
  for (const order of selected) {
    const existing = await findTeamshipShippingOrders({ tenantId: context.tenantId, orderIdentifier: order.customerReference });
    if (existing.some((candidate) => hasExactTmgTeamshipReference(candidate as Record<string, unknown>, order.customerReference))) {
      throw new TmgExecutionError(`Teamship already contains the exact TMG customer reference ${order.customerReference}. Approval was blocked.`);
    }
  }

  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    const claimedApproval = await transaction.tmgTeamshipExecutionJob.updateMany({
      where: {
        id: batch.executionJob!.id,
        tenantId: context.tenantId,
        status: "PENDING_APPROVAL",
        requestHash: computedHash
      },
      data: { status: "APPROVED", approvedByUserId: context.userId, approvedAt: now }
    });
    if (claimedApproval.count !== 1) throw new TmgExecutionError("This TMG batch was already approved or changed.");
    await transaction.tmgOrderIntakeBatch.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: batch.id } },
      data: {
        status: batch.invalidOrderCount > 0 ? "PARTIALLY_APPROVED" : "APPROVED",
        approvedByUserId: context.userId,
        approvedAt: now
      }
    });
    await transaction.tmgOrderIntakeOrder.updateMany({
      where: { tenantId: context.tenantId, batchId: batch.id, id: { in: selectedIds }, status: "READY_FOR_APPROVAL" },
      data: { status: "APPROVED" }
    });
    await transaction.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "TMG_TEAMSHIP_BATCH_APPROVED",
        entityType: "TmgTeamshipExecutionJob",
        entityId: batch.executionJob!.id,
        before: { status: "PENDING_APPROVAL" },
        after: { status: "APPROVED", batchId: batch.id, requestHash: computedHash, selectedOrderIds: selectedIds }
      }
    });
    return transaction.tmgOrderIntakeBatch.findUniqueOrThrow({
      where: { tenantId_id: { tenantId: context.tenantId, id: batch.id } },
      include: { orders: true, executionJob: true }
    });
  });
}

export async function claimNextTmgExecutionJob(context: TenantContext, workerId: string) {
  const normalizedWorkerId = workerId.trim();
  if (!normalizedWorkerId) throw new TmgExecutionError("A worker ID is required.", 400);
  const candidate = await prisma.tmgTeamshipExecutionJob.findFirst({
    where: { tenantId: context.tenantId, status: "APPROVED" },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!candidate) return null;
  const now = new Date();
  const claimed = await prisma.tmgTeamshipExecutionJob.updateMany({
    where: { tenantId: context.tenantId, id: candidate.id, status: "APPROVED" },
    data: { status: "CLAIMED", workerId: normalizedWorkerId, claimedAt: now, startedAt: now }
  });
  if (claimed.count !== 1) return null;
  const job = await prisma.tmgTeamshipExecutionJob.findFirstOrThrow({
    where: { tenantId: context.tenantId, id: candidate.id, workerId: normalizedWorkerId },
    include: {
      batch: {
        include: {
          orders: {
            where: { status: "APPROVED" },
            orderBy: { customerReference: "asc" }
          }
        }
      }
    }
  });
  if (!job.approvedByUserId || !job.approvedAt) throw new TmgExecutionError("The claimed TMG job has no approval evidence.");
  return {
    id: job.id,
    tenantId: context.tenantId,
    requestHash: job.requestHash,
    approval: {
      approvedByUserId: job.approvedByUserId,
      approvedAt: job.approvedAt.toISOString()
    },
    orders: job.batch.orders.map((order) => ({
      id: order.id,
      customerReference: order.customerReference,
      plan: order.teamshipPlan as unknown as TmgTeamshipCreatePlan,
      fileName: order.combinedPdfFileName!,
      fileHash: order.combinedPdfHash!,
      fileBytesBase64: Buffer.from(order.combinedPdfBytes!).toString("base64"),
      teamshipCreateStatus: order.teamshipCreateStatus,
      documentUploadStatus: order.documentUploadStatus
    }))
  };
}

export type TmgWorkerCheckpoint =
  | { event: "CREATE_STARTED"; orderId: string }
  | { event: "TEAMSHIP_CREATED"; orderId: string; evidence: TmgTeamshipCreateEvidence }
  | { event: "UPLOAD_STARTED"; orderId: string }
  | { event: "DOCUMENT_UPLOADED"; orderId: string; evidence: TmgDocumentUploadResult }
  | { event: "ORDER_FAILED"; orderId: string; stage: "CREATE" | "UPLOAD"; message: string };

export async function checkpointTmgExecutionJob(
  context: TenantContext,
  input: { jobId: string; workerId: string; checkpoint: TmgWorkerCheckpoint }
) {
  const job = await prisma.tmgTeamshipExecutionJob.findFirst({
    where: { id: requireId(input.jobId), tenantId: context.tenantId, workerId: input.workerId, status: { in: ["CLAIMED", "RUNNING"] } },
    select: { id: true, batchId: true, requestHash: true }
  });
  if (!job) throw new TmgExecutionError("The active TMG worker job was not found.", 404);
  const order = await prisma.tmgOrderIntakeOrder.findFirst({
    where: { id: requireId(input.checkpoint.orderId), tenantId: context.tenantId, batchId: job.batchId },
    select: { id: true, customerReference: true, planRequestHash: true, teamshipCreateStatus: true, documentUploadStatus: true }
  });
  if (!order) throw new TmgExecutionError("The TMG job order was not found.", 404);

  const data: Prisma.TmgOrderIntakeOrderUpdateInput = {};
  const checkpoint = input.checkpoint;
  if (checkpoint.event === "CREATE_STARTED") {
    if (order.teamshipCreateStatus !== "NOT_STARTED") throw new TmgExecutionError("TMG create was already started; automatic retry is blocked.");
    data.teamshipCreateStatus = "IN_PROGRESS";
  } else if (checkpoint.event === "TEAMSHIP_CREATED") {
    if (order.teamshipCreateStatus !== "IN_PROGRESS" || checkpoint.evidence.requestHash !== order.planRequestHash) {
      throw new TmgExecutionError("TMG create evidence does not match the in-progress approved order.");
    }
    data.teamshipCreateStatus = "CREATED";
    data.teamshipOrderId = checkpoint.evidence.teamshipOrderId;
    data.teamshipOrderNumber = checkpoint.evidence.teamshipOrderNumber;
    data.teamshipUrl = checkpoint.evidence.teamshipUrl;
    data.teamshipCreateEvidence = toJson(checkpoint.evidence);
  } else if (checkpoint.event === "UPLOAD_STARTED") {
    if (order.teamshipCreateStatus !== "CREATED" || order.documentUploadStatus !== "NOT_STARTED") {
      throw new TmgExecutionError("TMG upload cannot start before a verified create or after an earlier attempt.");
    }
    data.documentUploadStatus = "IN_PROGRESS";
  } else if (checkpoint.event === "DOCUMENT_UPLOADED") {
    if (order.teamshipCreateStatus !== "CREATED" || order.documentUploadStatus !== "IN_PROGRESS") {
      throw new TmgExecutionError("TMG upload evidence does not match the in-progress order.");
    }
    data.documentUploadStatus = checkpoint.evidence.status;
    data.documentUploadEvidence = toJson(checkpoint.evidence);
    data.status = "COMPLETED";
  } else {
    const message = checkpoint.message.trim().slice(0, 2_000) || "Unknown TMG worker failure.";
    data.status = "NEEDS_REVIEW";
    data.errorMessage = message;
    if (checkpoint.stage === "CREATE") data.teamshipCreateStatus = "NEEDS_REVIEW";
    else data.documentUploadStatus = "NEEDS_REVIEW";
  }
  return prisma.$transaction(async (transaction) => {
    await transaction.tmgTeamshipExecutionJob.update({ where: { tenantId_id: { tenantId: context.tenantId, id: job.id } }, data: { status: "RUNNING" } });
    const updated = await transaction.tmgOrderIntakeOrder.update({ where: { tenantId_id: { tenantId: context.tenantId, id: order.id } }, data });
    await transaction.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: null,
        action: `TMG_WORKER_${checkpoint.event}`,
        entityType: "TmgOrderIntakeOrder",
        entityId: order.id,
        after: { jobId: job.id, customerReference: order.customerReference, event: checkpoint.event }
      }
    });
    return updated;
  });
}

export async function completeTmgExecutionJob(
  context: TenantContext,
  input: { jobId: string; workerId: string }
) {
  const job = await prisma.tmgTeamshipExecutionJob.findFirst({
    where: { id: requireId(input.jobId), tenantId: context.tenantId, workerId: input.workerId, status: { in: ["CLAIMED", "RUNNING"] } },
    include: { batch: { include: { orders: true } } }
  });
  if (!job) throw new TmgExecutionError("The active TMG worker job was not found.", 404);
  const selectedIds = readStringArray(job.selectedOrderIds);
  const selected = job.batch.orders.filter((order) => selectedIds.includes(order.id));
  if (selected.some((order) => order.teamshipCreateStatus === "IN_PROGRESS" || order.documentUploadStatus === "IN_PROGRESS")) {
    throw new TmgExecutionError("An uncertain TMG write is still in progress. It must be reviewed before job completion.");
  }
  const completed = selected.filter((order) => order.status === "COMPLETED");
  const status = completed.length === selected.length ? "SUCCESS" : completed.length > 0 ? "PARTIAL_FAILED" : "NEEDS_REVIEW";
  const now = new Date();
  await prisma.$transaction([
    prisma.tmgTeamshipExecutionJob.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: job.id } },
      data: { status, finishedAt: now, result: { completedOrderCount: completed.length, selectedOrderCount: selected.length } }
    }),
    prisma.tmgOrderIntakeBatch.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: job.batchId } },
      data: { status, summaryStatus: completed.length > 0 ? "PENDING" : "NOT_READY" }
    }),
    prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: null,
        action: "TMG_TEAMSHIP_JOB_COMPLETED",
        entityType: "TmgTeamshipExecutionJob",
        entityId: job.id,
        after: { status, completedOrderCount: completed.length, selectedOrderCount: selected.length }
      }
    })
  ]);
  if (completed.length > 0) await sendTmgInternalSummary(context, job.batch, completed);
  return { status, completedOrderCount: completed.length, selectedOrderCount: selected.length };
}

async function sendTmgInternalSummary(
  context: TenantContext,
  batch: { id: string; mailboxAddress: string; subject: string; receivedAt: Date },
  orders: Array<{
    teamshipOrderNumber: string | null;
    customerReference: string;
    packingSlip: Prisma.JsonValue;
    bol: Prisma.JsonValue | null;
    warehouseInstructions: string | null;
    documentUploadStatus: string;
  }>
) {
  const settings = await getTmgOrderIntakeSettings(context.tenantId);
  if (!settings.mailboxAddress || settings.internalSummaryRecipients.length === 0) {
    await prisma.tmgOrderIntakeBatch.update({ where: { tenantId_id: { tenantId: context.tenantId, id: batch.id } }, data: { summaryStatus: "NEEDS_REVIEW", summaryResult: { error: "Internal summary recipients are not configured." } } });
    return;
  }
  const messages = buildTmgInternalSummaryMessages({
    recipients: settings.internalSummaryRecipients,
    receivedAt: batch.receivedAt.toISOString(),
    sourceSubject: batch.subject,
    orders: orders.map((order) => {
      const packing = order.packingSlip as unknown as {
        fulfillmentType?: "FREIGHT" | "SELF_PICKUP";
        shipTo: { name: string; city: string; state: string };
        items: Array<{ sku: string; quantity: number }>;
      };
      const bol = order.bol as unknown as { proNumber?: string } | null;
      return {
        teamshipOrderNumber: order.teamshipOrderNumber!,
        customerReference: order.customerReference,
        shipToName: packing.shipTo.name,
        shipToCity: packing.shipTo.city,
        shipToState: packing.shipTo.state,
        items: packing.items,
        proNumber: packing.fulfillmentType === "SELF_PICKUP" ? "Not required (self-pickup)" : bol?.proNumber ?? "Not available",
        documentUploadStatus: order.documentUploadStatus as "UPLOADED" | "ALREADY_PRESENT",
        warehouseInstructions: order.warehouseInstructions
      };
    })
  });
  try {
    const accessToken = await getMicrosoftGraphApplicationAccessToken();
    for (const message of messages) {
      await createAndSendMicrosoftGraphMailboxMessage(accessToken, settings.mailboxAddress, message);
    }
    await prisma.tmgOrderIntakeBatch.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: batch.id } },
      data: { summaryStatus: "SENT", summaryResult: { recipientCount: messages.length, sentAt: new Date().toISOString() } }
    });
  } catch (error) {
    await prisma.tmgOrderIntakeBatch.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: batch.id } },
      data: { summaryStatus: "NEEDS_REVIEW", summaryResult: { error: error instanceof Error ? error.message : "Unknown summary-send failure." } }
    });
  }
}

export function buildTmgOrderApproval(plan: TmgTeamshipCreatePlan, approval: { approvedByUserId: string; approvedAt: string }): TmgTeamshipApproval {
  return { ...approval, requestHash: plan.requestHash };
}

function readStringArray(value: Prisma.JsonValue) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TmgExecutionError("TMG selected-order evidence is invalid.");
  }
  return value as string[];
}

function requireId(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 191) throw new TmgExecutionError("A valid record ID is required.", 400);
  return normalized;
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
