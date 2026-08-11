import { PlatformRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamshipPrintBatch = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn()
}));
const teamshipReviewRun = vi.hoisted(() => ({ findFirst: vi.fn() }));
const teamshipPrintJob = vi.hoisted(() => ({ update: vi.fn(), updateMany: vi.fn() }));
const auditLog = vi.hoisted(() => ({ create: vi.fn() }));
const requirePrintAccess = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({
  prisma: {
    teamshipPrintBatch,
    teamshipReviewRun,
    teamshipPrintJob,
    auditLog,
    $transaction: (input: unknown) => Array.isArray(input)
      ? Promise.all(input)
      : (input as (tx: unknown) => unknown)({ teamshipPrintBatch, teamshipPrintJob, auditLog })
  }
}));

vi.mock("@/modules/teamship/print-jobs", () => ({
  createTeamshipPrintPlan: vi.fn(),
  requireTeamshipPrintAccess: (...args: unknown[]) => requirePrintAccess(...args),
  TeamshipPrintJobError: class TeamshipPrintJobError extends Error {
    status = 400;
  }
}));

import {
  approveTeamshipPrintBatch,
  createTeamshipPrintBatchPlan
} from "@/modules/teamship/print-batches";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "user-1",
  userEmail: "user@example.com",
  userName: "Example User",
  role: PlatformRole.ADMIN
};

describe("Teamship print batches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teamshipPrintBatch.findUnique.mockResolvedValue(null);
    teamshipPrintBatch.create.mockResolvedValue({
      id: "cmbatch123456",
      tenantId: "tenant-1"
    });
    auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("plans passed orders and explicitly confirmed corrected failures", async () => {
    teamshipReviewRun.findFirst.mockResolvedValue({
      id: "cmrun123456",
      orders: [
        reviewOrder({
          id: "cmorderpass1",
          psNumber: "PS123456",
          srNumber: "SR812345",
          status: "PASS",
          workflowStatus: "READY_TO_PRINT",
          teamshipOrderId: "30202",
          teamshipUrl: "https://members.fulfillit.io/ship-inventories/30202"
        }),
        reviewOrder({
          id: "cmorderfail1",
          psNumber: "PS123457",
          srNumber: "SR812346",
          status: "FAIL",
          workflowStatus: "NEEDS_REVIEW",
          teamshipOrderId: "30203",
          teamshipUrl: "https://members.fulfillit.io/ship-inventories/30203"
        })
      ]
    });
    const createPrintPlan = vi.fn()
      .mockResolvedValueOnce(printJob("cmjobpass123", "30202", 1))
      .mockResolvedValueOnce(printJob("cmjobfail123", "30203", 2));
    teamshipPrintBatch.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      batchRecord: true,
      id: "cmbatch123456",
      reviewRunId: "cmrun123456",
      status: data.status,
      summary: data.summary,
      requestedByUserId: "user-1",
      approvedAt: null,
      expiresAt: new Date("2026-07-29T14:15:00.000Z"),
      completedAt: null,
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      jobs: [
        storedChildJob("cmjobpass123", "30202", 0, 1),
        storedChildJob("cmjobfail123", "30203", 1, 2)
      ]
    }));

    const result = await createTeamshipPrintBatchPlan(context, {
      runId: "cmrun123456",
      requestKey: "batch-request-123456",
      selections: [
        { orderId: "cmorderpass1", manualCorrectionConfirmed: false },
        { orderId: "cmorderfail1", manualCorrectionConfirmed: true }
      ]
    }, {
      createPrintPlan,
      now: () => new Date("2026-07-29T14:00:00.000Z")
    });

    expect(result.status).toBe("PENDING_APPROVAL");
    expect(result.summary.planned).toHaveLength(2);
    expect(result.summary.totalOutboundLabels).toBe(3);
    expect(result.summary.planned[1]).toMatchObject({
      psNumber: "PS123457",
      reviewStatus: "FAIL",
      manualCorrectionConfirmed: true
    });
    expect(createPrintPlan).toHaveBeenNthCalledWith(
      2,
      context,
      expect.objectContaining({
        reviewReference: {
          psNumber: "PS123457",
          srNumber: "SR812346",
          teamshipOrderId: "30203",
          teamshipUrl: "https://members.fulfillit.io/ship-inventories/30203"
        },
        batch: {
          batchId: "cmbatch123456",
          batchPosition: 1,
          reviewOrderId: "cmorderfail1"
        }
      })
    );
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "teamship.print.batch.plan.create",
        tenantId: "tenant-1"
      })
    }));
  });

  it("excludes a failed review until the employee confirms Teamship was corrected", async () => {
    teamshipReviewRun.findFirst.mockResolvedValue({
      id: "cmrun123456",
      orders: [
        reviewOrder({
          id: "cmorderfail1",
          psNumber: "PS123456",
          srNumber: "SR812345",
          status: "FAIL",
          workflowStatus: "NEEDS_REVIEW",
          teamshipOrderId: "30202"
        })
      ]
    });
    const createPrintPlan = vi.fn();
    teamshipPrintBatch.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "cmbatch123456",
      reviewRunId: "cmrun123456",
      status: data.status,
      summary: data.summary,
      requestedByUserId: "user-1",
      approvedAt: null,
      expiresAt: new Date("2026-07-29T14:15:00.000Z"),
      completedAt: null,
      failedAt: new Date("2026-07-29T14:00:00.000Z"),
      errorCode: "NO_PRINTABLE_ORDERS",
      errorMessage: "No selected order passed batch print preflight.",
      jobs: []
    }));

    const result = await createTeamshipPrintBatchPlan(context, {
      runId: "cmrun123456",
      requestKey: "batch-request-123456",
      selections: [{ orderId: "cmorderfail1", manualCorrectionConfirmed: false }]
    }, { createPrintPlan });

    expect(result.status).toBe("FAILED");
    expect(result.summary.planned).toHaveLength(0);
    expect(result.summary.excluded[0]?.reason).toMatch(/confirm.*corrected/i);
    expect(createPrintPlan).not.toHaveBeenCalled();
  });

  it("approves the first child and leaves the rest waiting for sequential execution", async () => {
    const jobs = [
      storedChildJob("cmjobone1234", "30202", 0, 1),
      storedChildJob("cmjobtwo1234", "30203", 1, 2)
    ];
    teamshipPrintBatch.findFirst.mockResolvedValue({
      id: "cmbatch123456",
      tenantId: "tenant-1",
      reviewRunId: "cmrun123456",
      requestedByUserId: "user-1",
      status: "PENDING_APPROVAL",
      summary: {
        planned: [],
        excluded: [],
        totalPickingLists: 2,
        totalBols: 2,
        totalOutboundLabels: 3
      },
      expiresAt: new Date("2026-07-29T14:15:00.000Z"),
      jobs
    });
    teamshipPrintBatch.update.mockResolvedValue({ id: "cmbatch123456" });
    teamshipPrintJob.update.mockResolvedValue({});
    teamshipPrintJob.updateMany.mockResolvedValue({ count: 1 });
    teamshipPrintBatch.findFirst
      .mockResolvedValueOnce({
        id: "cmbatch123456",
        tenantId: "tenant-1",
        reviewRunId: "cmrun123456",
        requestedByUserId: "user-1",
        status: "PENDING_APPROVAL",
        summary: {
          planned: [],
          excluded: [],
          totalPickingLists: 2,
          totalBols: 2,
          totalOutboundLabels: 3
        },
        expiresAt: new Date(Date.now() + 60_000),
        jobs
      })
      .mockResolvedValueOnce({
        id: "cmbatch123456",
        reviewRunId: "cmrun123456",
        status: "APPROVED",
        summary: {
          planned: [],
          excluded: [],
          totalPickingLists: 2,
          totalBols: 2,
          totalOutboundLabels: 3
        },
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        completedAt: null,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        jobs: [
          { ...jobs[0], status: "APPROVED" },
          { ...jobs[1], status: "WAITING_BATCH" }
        ]
      });

    const result = await approveTeamshipPrintBatch(context, {
      runId: "cmrun123456",
      batchId: "cmbatch123456",
      confirmed: true
    });

    expect(result.status).toBe("APPROVED");
    expect(teamshipPrintJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cmjobone1234" },
      data: expect.objectContaining({ status: "APPROVED" })
    }));
    expect(teamshipPrintJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "WAITING_BATCH" })
    }));
  });
});

function reviewOrder(overrides: Record<string, unknown>) {
  return {
    id: "cmorder123456",
    psNumber: "PS123456",
    srNumber: "SR812345",
    status: "PASS",
    workflowStatus: "READY_TO_PRINT",
    teamshipOrderId: "30202",
    teamshipUrl: "https://members.fulfillit.io/ship-inventories/30202",
    ...overrides
  };
}

function printJob(id: string, shippingOrderNumber: string, palletCount: number) {
  return {
    id,
    shippingOrderNumber,
    approvedPalletCount: palletCount
  };
}

function storedChildJob(id: string, shippingOrderNumber: string, batchPosition: number, palletCount: number) {
  return {
    id,
    shippingOrderNumber,
    status: "PENDING_APPROVAL",
    approvedPalletCount: palletCount,
    printerPlan: {
      pickingList: { displayName: "192.168.1.28" },
      bol: { exactName: "Office Printer" },
      outboundLabels: { exactName: "Label Printer" }
    },
    batchPosition,
    completedAt: null,
    failedAt: null,
    errorMessage: null
  };
}
