import { PlatformRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tmgOrderIntakeBatch = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() }));
const tmgOrderIntakeOrder = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() }));
const tmgTeamshipExecutionJob = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() }));
const auditLog = vi.hoisted(() => ({ create: vi.fn() }));
const findOrders = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({
  prisma: {
    tmgOrderIntakeBatch,
    tmgOrderIntakeOrder,
    tmgTeamshipExecutionJob,
    auditLog,
    $transaction: (callback: (transaction: unknown) => unknown) => callback({
      tmgOrderIntakeBatch,
      tmgOrderIntakeOrder,
      tmgTeamshipExecutionJob,
      auditLog
    })
  }
}));

vi.mock("@/server/integrations/teamship", () => ({
  findTeamshipShippingOrders: (...args: unknown[]) => findOrders(...args),
  searchTeamshipProductsForShipping: vi.fn()
}));

import { hashTmgBatchApproval } from "@/modules/shipment-documents/tmg-email-intake";
import { approveTmgOrderBatch, checkpointTmgExecutionJob } from "@/modules/shipment-documents/tmg-execution-jobs";

const context = {
  tenantId: "tenant-example",
  tenantSlug: "example",
  tenantName: "Example Tenant",
  userId: "user-example",
  userEmail: "user@example.com",
  userName: "Example User",
  role: PlatformRole.OPERATIONS
};

describe("TMG execution approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOrders.mockResolvedValue([]);
    tmgTeamshipExecutionJob.updateMany.mockResolvedValue({ count: 1 });
    tmgOrderIntakeOrder.updateMany.mockResolvedValue({ count: 1 });
    tmgOrderIntakeBatch.update.mockResolvedValue({ id: "batch-example" });
    tmgOrderIntakeBatch.findUniqueOrThrow.mockResolvedValue({ id: "batch-example", status: "PARTIALLY_APPROVED" });
    auditLog.create.mockResolvedValue({ id: "audit-example" });
  });

  it("requires an explicit CSR confirmation before reading or writing", async () => {
    await expect(approveTmgOrderBatch(context, { batchId: "batch-example", confirmed: false })).rejects.toThrow("Explicit CSR approval");
    expect(tmgOrderIntakeBatch.findFirst).not.toHaveBeenCalled();
  });

  it("binds approval to valid selected orders and leaves invalid rows out", async () => {
    const batch = preparedBatch();
    tmgOrderIntakeBatch.findFirst.mockResolvedValue(batch);

    await approveTmgOrderBatch(context, { batchId: batch.id, confirmed: true });

    expect(tmgOrderIntakeBatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: batch.id, tenantId: context.tenantId }
    }));
    expect(tmgOrderIntakeOrder.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: context.tenantId,
        batchId: batch.id,
        id: { in: ["order-ready"] },
        status: "READY_FOR_APPROVAL"
      },
      data: { status: "APPROVED" }
    });
    expect(tmgOrderIntakeBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_id: { tenantId: context.tenantId, id: batch.id } },
      data: expect.objectContaining({ status: "PARTIALLY_APPROVED", approvedByUserId: context.userId })
    }));
  });

  it("blocks a stale approval hash", async () => {
    const batch = preparedBatch();
    batch.executionJob.requestHash = "stale";
    tmgOrderIntakeBatch.findFirst.mockResolvedValue(batch);

    await expect(approveTmgOrderBatch(context, { batchId: batch.id, confirmed: true })).rejects.toThrow("changed after review");
    expect(tmgTeamshipExecutionJob.updateMany).not.toHaveBeenCalled();
  });

  it("rechecks an exact Teamship reference immediately before approval", async () => {
    const batch = preparedBatch();
    tmgOrderIntakeBatch.findFirst.mockResolvedValue(batch);
    findOrders.mockResolvedValue([{ poNumber: "US19999" }]);

    await expect(approveTmgOrderBatch(context, { batchId: batch.id, confirmed: true })).rejects.toThrow("already contains");
    expect(tmgTeamshipExecutionJob.updateMany).not.toHaveBeenCalled();
  });

  it("marks create started before the write and blocks an automatic replay", async () => {
    tmgTeamshipExecutionJob.findFirst.mockResolvedValue({ id: "job-example", batchId: "batch-example", requestHash: "request-hash" });
    tmgOrderIntakeOrder.findFirst
      .mockResolvedValueOnce(storedWorkerOrder("NOT_STARTED", "NOT_STARTED"))
      .mockResolvedValueOnce(storedWorkerOrder("IN_PROGRESS", "NOT_STARTED"));
    tmgTeamshipExecutionJob.update.mockResolvedValue({ id: "job-example" });
    tmgOrderIntakeOrder.update.mockResolvedValue({ id: "order-ready", teamshipCreateStatus: "IN_PROGRESS" });

    await checkpointTmgExecutionJob(context, {
      jobId: "job-example",
      workerId: "worker-example",
      checkpoint: { event: "CREATE_STARTED", orderId: "order-ready" }
    });
    await expect(checkpointTmgExecutionJob(context, {
      jobId: "job-example",
      workerId: "worker-example",
      checkpoint: { event: "CREATE_STARTED", orderId: "order-ready" }
    })).rejects.toThrow("automatic retry is blocked");

    expect(tmgOrderIntakeOrder.update).toHaveBeenCalledTimes(1);
    expect(tmgOrderIntakeOrder.update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: context.tenantId, id: "order-ready" } },
      data: { teamshipCreateStatus: "IN_PROGRESS" }
    });
  });

  it("preserves verified create evidence when document upload needs review", async () => {
    tmgTeamshipExecutionJob.findFirst.mockResolvedValue({ id: "job-example", batchId: "batch-example", requestHash: "request-hash" });
    tmgOrderIntakeOrder.findFirst.mockResolvedValue(storedWorkerOrder("CREATED", "IN_PROGRESS"));
    tmgTeamshipExecutionJob.update.mockResolvedValue({ id: "job-example" });
    tmgOrderIntakeOrder.update.mockResolvedValue({ id: "order-ready", status: "NEEDS_REVIEW" });

    await checkpointTmgExecutionJob(context, {
      jobId: "job-example",
      workerId: "worker-example",
      checkpoint: { event: "ORDER_FAILED", orderId: "order-ready", stage: "UPLOAD", message: "Synthetic upload uncertainty." }
    });

    expect(tmgOrderIntakeOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: "NEEDS_REVIEW",
        errorMessage: "Synthetic upload uncertainty.",
        documentUploadStatus: "NEEDS_REVIEW"
      }
    }));
    expect(tmgOrderIntakeOrder.update.mock.calls[0]?.[0].data).not.toHaveProperty("teamshipCreateStatus");
  });
});

function preparedBatch() {
  const ready = {
    id: "order-ready",
    customerReference: "US19999",
    status: "READY_FOR_APPROVAL",
    teamshipCreateStatus: "NOT_STARTED",
    teamshipPlan: { requestHash: "plan-hash", packetHash: "packet-hash" },
    planRequestHash: "plan-hash",
    combinedPdfHash: "packet-hash",
    combinedPdfBytes: Buffer.from("synthetic-pdf")
  };
  const requestHash = hashTmgBatchApproval([{ id: ready.id, planRequestHash: ready.planRequestHash, packetHash: ready.combinedPdfHash }]);
  return {
    id: "batch-example",
    invalidOrderCount: 1,
    approvalRequestHash: requestHash,
    orders: [ready, { ...ready, id: "order-invalid", customerReference: "US20000", status: "NEEDS_REVIEW" }],
    executionJob: { id: "job-example", status: "PENDING_APPROVAL", selectedOrderIds: [ready.id], requestHash }
  };
}

function storedWorkerOrder(teamshipCreateStatus: string, documentUploadStatus: string) {
  return {
    id: "order-ready",
    customerReference: "US19999",
    planRequestHash: "plan-hash",
    teamshipCreateStatus,
    documentUploadStatus
  };
}
