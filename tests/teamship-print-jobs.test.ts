import { PlatformRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamshipPrintJob = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn()
}));
const auditLog = vi.hoisted(() => ({ create: vi.fn() }));
const tenant = vi.hoisted(() => ({ findUnique: vi.fn() }));
const resolveCredentials = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({
  prisma: {
    teamshipPrintJob,
    auditLog,
    tenant,
    $transaction: (callback: (tx: unknown) => unknown) => callback({ teamshipPrintJob, auditLog })
  }
}));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: vi.fn(),
  requireMutationAccess: vi.fn()
}));
vi.mock("@/server/integrations/teamship-settings", () => ({
  resolveTenantTeamshipCredentials: (...args: unknown[]) => resolveCredentials(...args)
}));

import {
  approveTeamshipPrintPlan,
  calculateTeamshipPalletCount,
  createTeamshipPrintPlan,
  getTeamshipPrinterPlan
} from "@/modules/teamship/print-jobs";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "user-1",
  userEmail: "alex.newell@newl.ca",
  userName: "Alex Newell",
  role: PlatformRole.ADMIN
};

describe("Teamship print jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teamshipPrintJob.findUnique.mockResolvedValue(null);
    auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("sums pallet-row quantities instead of counting rows", () => {
    expect(calculateTeamshipPalletCount({ pallet_dims: [{ quantity: 2 }, { quantity: 1 }] })).toBe(3);
  });

  it("uses the corrected exact outbound-label printer", () => {
    const plan = getTeamshipPrinterPlan({});
    expect(plan.outboundLabels.exactName).toBe("BIXOLON SRP-770III");
    expect(plan.outboundLabels.exactName).not.toContain("BPL-Z");
  });

  it("creates a tenant-scoped approval plan for one exact Garland order", async () => {
    const stored = storedJob();
    teamshipPrintJob.create.mockResolvedValue(stored);
    const findOrders = vi.fn().mockResolvedValue([{
      id: 30666,
      customer: { company: "Garland Canada Distribution" },
      warehouse_name: "Annagem",
      pallet_dims: [{ quantity: 1 }, { quantity: 1 }]
    }]);

    const result = await createTeamshipPrintPlan(context, {
      shippingOrderNumber: "30666",
      requestKey: "a".repeat(64)
    }, { findOrders });

    expect(result).toMatchObject({
      shippingOrderNumber: "30666",
      status: "PENDING_APPROVAL",
      approvedPalletCount: 2,
      printerPlan: { outboundLabels: { exactName: "BIXOLON SRP-770III" } }
    });
    expect(teamshipPrintJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant-1", requestedByUserId: "user-1" })
    }));
  });

  it("fails closed when the order is not Garland at Annagem", async () => {
    const findOrders = vi.fn().mockResolvedValue([{
      id: 30666,
      customer: { company: "Another Customer" },
      warehouse_name: "Annagem",
      pallet_dims: [{ quantity: 1 }]
    }]);
    await expect(createTeamshipPrintPlan(context, {
      shippingOrderNumber: "30666",
      requestKey: "b".repeat(64)
    }, { findOrders })).rejects.toMatchObject({ status: 403 });
    expect(teamshipPrintJob.create).not.toHaveBeenCalled();
  });

  it("blocks a second active request for the same shipping order", async () => {
    teamshipPrintJob.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedJob({ status: "COMPLETED" }));
    const findOrders = vi.fn();
    await expect(createTeamshipPrintPlan(context, {
      shippingOrderNumber: "30666",
      requestKey: "c".repeat(64)
    }, { findOrders })).rejects.toMatchObject({ status: 409 });
    expect(findOrders).not.toHaveBeenCalled();
  });

  it("requires the same employee and explicit confirmation to approve", async () => {
    teamshipPrintJob.findFirst.mockResolvedValue(storedJob({ requestedByUserId: "user-2" }));
    await expect(approveTeamshipPrintPlan(context, "cmprintjob12345", true)).rejects.toMatchObject({ status: 403 });
    await expect(approveTeamshipPrintPlan(context, "cmprintjob12345", false)).rejects.toThrow(/explicit/i);
    expect(teamshipPrintJob.update).not.toHaveBeenCalled();
  });
});

function storedJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-07-22T14:00:00.000Z");
  return {
    id: "cmprintjob12345",
    tenantId: "tenant-1",
    shippingOrderNumber: "30666",
    teamshipOrderId: "30666",
    customerName: "Garland Canada Distribution",
    warehouseName: "Annagem",
    status: "PENDING_APPROVAL",
    documentPlan: { pickingListCopies: 1, bolCopies: 1, outboundLabelCopies: 2 },
    printerPlan: {
      pickingList: { transport: "CUPS", queue: "_192_168_1_28", displayName: "192.168.1.28" },
      bol: { transport: "TEAMSHIP", exactName: "KONICA MINOLTA bizhub C3350i PCL (192.168.1.28) UPD" },
      outboundLabels: { transport: "TEAMSHIP", exactName: "BIXOLON SRP-770III" }
    },
    approvedPalletCount: 2,
    requestedByUserId: "user-1",
    approvedByUserId: null,
    approvedAt: null,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
    completedAt: null,
    failedAt: null,
    result: null,
    errorCode: null,
    errorMessage: null,
    ...overrides
  };
}
