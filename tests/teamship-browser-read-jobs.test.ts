import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  jobUpdateMany: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    tenant: { findUnique: (...args: unknown[]) => mocks.tenantFindUnique(...args) },
    teamshipBrowserReadJob: {
      findFirst: (...args: unknown[]) => mocks.jobFindFirst(...args),
      updateMany: (...args: unknown[]) => mocks.jobUpdateMany(...args)
    }
  }
}));

vi.mock("@/server/integrations/teamship-settings", () => ({
  resolveTenantTeamshipCredentials: vi.fn()
}));

import {
  getConfiguredTeamshipBrowserJobAdapter,
  getTeamshipBrowserWorkerRuntimeStatus,
  claimNextTeamshipBrowserJob,
  parseTeamshipBrowserJobResult
} from "@/modules/teamship/browser-read-jobs";

const options = {
  tenantId: "tenant-newl",
  tenantSlug: "newl-group",
  requestedBy: {
    userId: "user-alex",
    userEmail: "authorized.user@newl.example",
    userName: "Authorized User"
  }
};

describe("Teamship browser read job boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantFindUnique.mockResolvedValue({ id: "tenant-newl" });
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("requires a tenant-bound worker configuration", () => {
    expect(getTeamshipBrowserWorkerRuntimeStatus({
      TEAMSHIP_BROWSER_WORKER_QUEUE_ENABLED: "true",
      TEAMSHIP_BROWSER_WORKER_TOKEN: "worker-token"
    })).toEqual({
      enabled: true,
      configured: false,
      reason: "TEAMSHIP_BROWSER_WORKER_TENANT_SLUG is not configured."
    });

    expect(getConfiguredTeamshipBrowserJobAdapter(options, {
      TEAMSHIP_BROWSER_WORKER_QUEUE_ENABLED: "true",
      TEAMSHIP_BROWSER_WORKER_TOKEN: "worker-token",
      TEAMSHIP_BROWSER_WORKER_TENANT_SLUG: "another-tenant"
    })).toBeUndefined();

    expect(getConfiguredTeamshipBrowserJobAdapter(options, {
      TEAMSHIP_BROWSER_WORKER_QUEUE_ENABLED: "true",
      TEAMSHIP_BROWSER_WORKER_TOKEN: "worker-token",
      TEAMSHIP_BROWSER_WORKER_TENANT_SLUG: "newl-group"
    })).toMatchObject({
      searchInventoryAll: expect.any(Function),
      searchLpn: expect.any(Function),
      getReceivingOrder: expect.any(Function),
      getProductHistory: expect.any(Function),
      getShippingOrderPallets: expect.any(Function)
    });
  });

  it("rejects results for a different operation", () => {
    expect(() => parseTeamshipBrowserJobResult(
      { operation: "searchLpn", rows: [] },
      "searchInventoryAll"
    )).toThrow(/did not match/i);
  });

  it("claims only pending jobs belonging to the token-bound tenant", async () => {
    mocks.jobFindFirst.mockResolvedValue(null);

    await expect(claimNextTeamshipBrowserJob("alex-mac-mini", "newl-group")).resolves.toBeNull();

    expect(mocks.tenantFindUnique).toHaveBeenCalledWith({
      where: { slug: "newl-group" },
      select: { id: true }
    });
    expect(mocks.jobFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: "tenant-newl", status: "PENDING" })
    }));
  });

  it("keeps only normalized allowlisted result fields", () => {
    const result = parseTeamshipBrowserJobResult({
      operation: "searchInventoryAll",
      rows: [{
        inventoryId: "inventory-1",
        productId: "product-1",
        productName: "Sanitized product",
        sku: "ABC-100",
        available: 7,
        reserved: 3,
        onHand: 10,
        backordered: 0,
        status: "Active",
        customerName: "Garland Canada Distribution",
        warehouseName: "Annagem",
        quarantined: false,
        billingRate: "$999"
      }]
    }, "searchInventoryAll");

    expect(result).toMatchObject({
      operation: "searchInventoryAll",
      rows: [{ inventoryId: "inventory-1", sku: "ABC-100", available: 7 }]
    });
    expect(JSON.stringify(result)).not.toContain("billingRate");
    expect(JSON.stringify(result)).not.toContain("999");
  });

  it("accepts only a bounded whole pallet count for an exact shipping order", () => {
    expect(parseTeamshipBrowserJobResult({
      operation: "getShippingOrderPallets",
      rows: [{
        teamshipOrderId: "31064",
        palletCount: 1,
        customerName: "Garland Canada Distribution",
        warehouseName: "Annagem",
        editableBolWeights: "secret"
      }]
    }, "getShippingOrderPallets")).toEqual({
      operation: "getShippingOrderPallets",
      rows: [{
        teamshipOrderId: "31064",
        palletCount: 1,
        customerName: "Garland Canada Distribution",
        warehouseName: "Annagem"
      }]
    });

    expect(() => parseTeamshipBrowserJobResult({
      operation: "getShippingOrderPallets",
      rows: [{
        teamshipOrderId: "31064",
        palletCount: 0,
        customerName: "Garland Canada Distribution",
        warehouseName: "Annagem"
      }]
    }, "getShippingOrderPallets")).toThrow(/1 to 100/i);
  });
});
