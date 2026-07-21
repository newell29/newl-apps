import { AssistantSourceKind } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inventory: vi.fn(),
  inventoryAll: vi.fn(),
  lpn: vi.fn(),
  shipping: vi.fn(),
  receiving: vi.fn(),
  productHistory: vi.fn(),
  settings: {
    readOnlyScopes: [] as Array<{
      customerId: string;
      customerName: string;
      warehouseId: string;
      warehouseName: string;
      inventoryUserId: string;
      inventoryLocationId: string;
    }>,
    readOnlySearchEnabled: true
  },
  browserJobAdapter: { marker: "browser-job-adapter" }
}));

vi.mock("@/modules/teamship/browser-read-jobs", () => ({
  getConfiguredTeamshipBrowserJobAdapter: vi.fn(() => mocks.browserJobAdapter)
}));

vi.mock("@/modules/teamship/read-tools", () => ({
  searchTeamshipInventory: (...args: unknown[]) => mocks.inventory(...args),
  searchTeamshipInventoryAll: (...args: unknown[]) => mocks.inventoryAll(...args),
  searchTeamshipLpn: (...args: unknown[]) => mocks.lpn(...args),
  getTeamshipShippingOrder: (...args: unknown[]) => mocks.shipping(...args),
  getTeamshipReceivingOrder: (...args: unknown[]) => mocks.receiving(...args),
  getTeamshipProductHistory: (...args: unknown[]) => mocks.productHistory(...args)
}));

vi.mock("@/server/integrations/teamship-settings", () => ({
  getTenantTeamshipSettings: vi.fn(async () => mocks.settings)
}));

import { maybeRunAssistantTeamshipRequest } from "@/modules/assistant/teamship-workflow";

const context = {
  tenantId: "tenant-newl",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "employee-1",
  userEmail: "employee@example.com",
  userName: "Employee One",
  role: "OPERATIONS" as const
};

describe("assistant Teamship workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.readOnlyScopes = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves procedural questions for curated knowledge retrieval", async () => {
    await expect(maybeRunAssistantTeamshipRequest(context, "What does LPN mean in Teamship?")).resolves.toBeNull();
    expect(mocks.inventory).not.toHaveBeenCalled();
  });

  it("asks for missing exact scope without calling a tool", async () => {
    const result = await maybeRunAssistantTeamshipRequest(context, "Where is SKU ABC-100?");

    expect(result).toMatchObject({
      intent: "TEAMSHIP_CLARIFICATION",
      provider: "NEWL_TEAMSHIP_READ",
      sources: []
    });
    expect(result?.answer).toContain("configured customer name");
    expect(mocks.inventory).not.toHaveBeenCalled();
  });

  it("returns deterministic current inventory with WMS source evidence", async () => {
    mocks.inventory.mockResolvedValue({
      ok: true,
      cardinality: "ONE",
      resultCount: 1,
      auditId: "audit-1",
      data: [
        {
          inventoryId: "stock-1",
          sku: "ABC-100",
          productName: "Sample",
          lpn: "PALLET-1",
          serialNumber: null,
          customer: { id: "420", name: "Garland" },
          warehouse: { id: "102", name: "Annagem" },
          location: { id: "BIN-1", name: "A-01" },
          onHand: 12,
          reserved: 4,
          available: 8,
          availableSource: "COMPUTED",
          quarantined: false
        }
      ]
    });

    const result = await maybeRunAssistantTeamshipRequest(
      context,
      "Is SKU ABC-100 eligible to ship customer 420 warehouse 102?"
    );

    expect(result).toMatchObject({
      intent: "TEAMSHIP_INVENTORY_READ",
      sources: [{ sourceKind: AssistantSourceKind.WMS_RECORD, sourceId: "stock-1" }]
    });
    expect(result?.answer).toContain("available 8 (computed)");
    expect(result?.runMetadata).toMatchObject({ auditId: "audit-1", resultCount: 1 });
  });

  it("keeps Inventory All quantities distinct from Ship by LPN quantities", async () => {
    mocks.inventoryAll.mockResolvedValue({
      ok: true,
      cardinality: "ONE",
      resultCount: 1,
      auditId: "audit-all",
      data: [{
        inventoryId: "stock-1",
        productId: "product-1",
        productName: "Sample",
        sku: "ABC-100",
        customer: { id: "420", name: "Garland" },
        warehouse: { id: "102", name: "Annagem" },
        available: 7,
        reserved: 3,
        onHand: 10,
        backordered: 0,
        status: "Active",
        quarantined: false,
        sourceView: "INVENTORY_ALL"
      }]
    });

    const result = await maybeRunAssistantTeamshipRequest(
      context,
      "How much SKU ABC-100 is on hand customer 420 warehouse 102?"
    );

    expect(result).toMatchObject({
      intent: "TEAMSHIP_INVENTORY_ALL_READ",
      sources: [{ sourceId: "stock-1" }]
    });
    expect(result?.answer).toContain("available 7, reserved 3, on hand 10");
    expect(mocks.inventory).not.toHaveBeenCalled();
    expect(mocks.lpn).not.toHaveBeenCalled();
    expect(mocks.inventoryAll).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ sku: "ABC-100", customerId: "420", warehouseId: "102" }),
      { browserReader: mocks.browserJobAdapter, settings: mocks.settings }
    );
  });

  it("routes SKU LPN-list questions to Ship by LPN and formats handling-unit evidence", async () => {
    mocks.lpn.mockResolvedValue({
      ok: true,
      cardinality: "ONE",
      resultCount: 1,
      auditId: "audit-lpn",
      data: [{
        inventoryId: null,
        productId: null,
        sku: "SR114E00082",
        lpn: "63991",
        quantity: 1,
        location: "0802A",
        status: "GARCAN",
        serialNumber: "2512MF0134",
        customer: { id: "420", name: "Garland Canada Distribution" },
        warehouse: { id: "102", name: "Annagem" },
        quarantined: false,
        sourceView: "SHIP_BY_LPN"
      }]
    });

    const result = await maybeRunAssistantTeamshipRequest(
      context,
      "Which LPNs and locations does Garland have for SKU SR114E00082?"
    );

    expect(mocks.lpn).toHaveBeenCalledWith(
      context,
      { queryType: "SKU", query: "SR114E00082", customerId: "420", warehouseId: "102" },
      { browserReader: mocks.browserJobAdapter, settings: mocks.settings }
    );
    expect(result?.answer).toContain("63991: SKU SR114E00082, quantity 1, location 0802A, warehouse Annagem");
    expect(result?.answer).toContain("serial 2512MF0134");
    expect(mocks.inventoryAll).not.toHaveBeenCalled();
  });

  it("uses the tenant scope reference so employees can ask with names only", async () => {
    mocks.settings.readOnlyScopes = [{
      customerId: "501",
      customerName: "Northstar Lighting",
      warehouseId: "1",
      warehouseName: "Kestrel",
      inventoryUserId: "501",
      inventoryLocationId: "1"
    }];
    mocks.inventoryAll.mockResolvedValue({
      ok: true,
      cardinality: "ZERO",
      resultCount: 0,
      auditId: "audit-reference",
      data: []
    });

    await maybeRunAssistantTeamshipRequest(context, "How much SKU ABC-100 is on hand for Northstar?");

    expect(mocks.inventoryAll).toHaveBeenCalledWith(
      context,
      { sku: "ABC-100", customerId: "501", warehouseId: "1" },
      { browserReader: mocks.browserJobAdapter, settings: mocks.settings }
    );
  });

  it("surfaces normalized disabled/unavailable errors without provider data", async () => {
    mocks.shipping.mockResolvedValue({
      ok: false,
      auditId: "audit-2",
      error: {
        code: "TOOL_DISABLED",
        message: "Teamship read-only search is not enabled for this tenant.",
        retryable: false
      }
    });

    const result = await maybeRunAssistantTeamshipRequest(
      context,
      "What is shipping order SR812500 status customer 420 warehouse 102?"
    );

    expect(result).toMatchObject({
      intent: "TEAMSHIP_READ_UNAVAILABLE",
      sources: [],
      runMetadata: { errorCode: "TOOL_DISABLED", auditId: "audit-2" }
    });
  });
});
