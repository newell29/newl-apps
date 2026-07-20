import { PlatformRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  moduleAccessFindFirst: vi.fn(),
  searchInventory: vi.fn(),
  findShippingOrders: vi.fn(),
  searchInventoryAll: vi.fn(),
  searchLpn: vi.fn(),
  getReceivingOrder: vi.fn(),
  getProductHistory: vi.fn(),
  getSettings: vi.fn(),
  resolveCredentials: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    tenantModuleAccess: {
      findFirst: (...args: unknown[]) => mocks.moduleAccessFindFirst(...args)
    },
    auditLog: {
      create: (...args: unknown[]) => mocks.auditCreate(...args)
    }
  }
}));

vi.mock("@/server/integrations/teamship", () => ({
  searchTeamshipProductsForShipping: (...args: unknown[]) => mocks.searchInventory(...args),
  findTeamshipShippingOrders: (...args: unknown[]) => mocks.findShippingOrders(...args)
}));

vi.mock("@/server/integrations/teamship-settings", () => ({
  getTenantTeamshipSettings: (...args: unknown[]) => mocks.getSettings(...args),
  resolveTenantTeamshipCredentials: (...args: unknown[]) => mocks.resolveCredentials(...args)
}));

import {
  getTeamshipProductHistory,
  getTeamshipReceivingOrder,
  getTeamshipShippingOrder,
  searchTeamshipInventory,
  searchTeamshipInventoryAll,
  searchTeamshipLpn
} from "@/modules/teamship/read-tools";
import type { TeamshipBrowserReadAdapter } from "@/modules/teamship/browser-read-contracts";
import type { TeamshipSettings } from "@/server/integrations/teamship-settings";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context = {
  tenantId: "tenant-newl",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "alex-user",
  userEmail: "alex.newell@newl.ca",
  userName: "Alex Newell",
  role: PlatformRole.OPERATIONS
} satisfies AuthenticatedContext;

const settings = {
  email: "integration@example.com",
  apiBaseUrl: "https://teamship.test/api",
  status: "ACTIVE",
  passwordConfigured: true,
  syncEnabled: false,
  syncCadenceMinutes: 15,
  garlandInventoryUserId: null,
  garlandInventoryLocationId: null,
  readOnlySearchEnabled: true,
  readOnlyScopes: [
    {
      customerId: "420",
      customerName: "Garland Canada Distribution",
      warehouseId: "102",
      warehouseName: "Annagem",
      inventoryUserId: "420",
      inventoryLocationId: "102"
    }
  ],
  updatedAt: null
} satisfies TeamshipSettings;

const browserReader = {
  searchInventoryAll: (...args: unknown[]) => mocks.searchInventoryAll(...args),
  searchLpn: (...args: unknown[]) => mocks.searchLpn(...args),
  getReceivingOrder: (...args: unknown[]) => mocks.getReceivingOrder(...args),
  getProductHistory: (...args: unknown[]) => mocks.getProductHistory(...args)
} as TeamshipBrowserReadAdapter;

describe("Teamship read-only tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduleAccessFindFirst.mockResolvedValue({ id: "module-access-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    mocks.getSettings.mockResolvedValue(settings);
    mocks.resolveCredentials.mockResolvedValue({
      email: "integration@example.com",
      password: "not-returned-to-model",
      apiBaseUrl: "https://teamship.test/api"
    });
    mocks.searchInventory.mockResolvedValue([]);
    mocks.findShippingOrders.mockResolvedValue([]);
    mocks.searchInventoryAll.mockResolvedValue([]);
    mocks.searchLpn.mockResolvedValue([]);
    mocks.getReceivingOrder.mockResolvedValue([]);
    mocks.getProductHistory.mockResolvedValue([]);
  });

  it("handles zero, one, and multiple inventory results deterministically", async () => {
    const input = { queryType: "SKU" as const, query: "ABC-100", customerId: "420", warehouseId: "102" };

    await expect(searchTeamshipInventory(context, input)).resolves.toMatchObject({
      ok: true,
      cardinality: "ZERO",
      resultCount: 0
    });

    mocks.searchInventory.mockResolvedValue([
      { id: 1, sku: "ABC-100", on_hand: 12, reserved_quantity: 4, is_quarantine: false }
    ]);
    await expect(searchTeamshipInventory(context, input)).resolves.toMatchObject({
      ok: true,
      cardinality: "ONE",
      resultCount: 1,
      data: [{ sku: "ABC-100", onHand: 12, reserved: 4, available: 8, availableSource: "COMPUTED" }]
    });

    mocks.searchInventory.mockResolvedValue([
      { id: 1, sku: "ABC-100", available_quantity: 8 },
      { id: 2, sku: "ABC-100", available_quantity: 2, lpn: "PALLET-2" }
    ]);
    await expect(searchTeamshipInventory(context, input)).resolves.toMatchObject({
      ok: true,
      cardinality: "MULTIPLE",
      resultCount: 2
    });
  });

  it("filters fuzzy API rows to the exact SKU and configured scope", async () => {
    mocks.searchInventory.mockResolvedValue([
      { id: 1, sku: "ABC-100", customer_id: "420", location_id: "102" },
      { id: 2, sku: "ABC-100-ALT", customer_id: "420", location_id: "102" },
      { id: 3, sku: "ABC-100", customer_id: "999", location_id: "102" }
    ]);

    const result = await searchTeamshipInventory(context, {
      queryType: "SKU",
      query: "ABC-100",
      customerId: "420",
      warehouseId: "102"
    });

    expect(result).toMatchObject({ ok: true, resultCount: 1, data: [{ inventoryId: "1" }] });
    expect(mocks.searchInventory).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-newl", userId: "420", locationId: "102", search: "ABC-100" })
    );
  });

  it("returns a minimized shipping order only when response scope is verified", async () => {
    mocks.findShippingOrders.mockResolvedValue([
      {
        id: 88,
        shipment_id: "SR812500",
        shipment_status: "Open",
        customer_id: "420",
        warehouse_id: "102",
        customer: { company: "Garland Canada Distribution", email: "private@example.com" },
        shipping_instructions: "Private instructions",
        items: [{ sku: "ABC-100", quantity: 2, serial_numbers: ["SERIAL-1"] }]
      }
    ]);

    const result = await getTeamshipShippingOrder(context, {
      orderId: "SR812500",
      customerId: "420",
      warehouseId: "102"
    });

    expect(result).toMatchObject({
      ok: true,
      cardinality: "ONE",
      data: [{
        teamshipId: "88",
        orderId: "SR812500",
        status: "Open",
        customer: { id: "420", name: "Garland Canada Distribution" },
        warehouse: { id: "102", name: "Annagem" },
        items: [{ sku: "ABC-100", quantity: 2, serialNumbers: ["SERIAL-1"] }]
      }]
    });
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    expect(JSON.stringify(result)).not.toContain("Private instructions");
    expect(JSON.stringify(result)).not.toContain("not-returned-to-model");
  });

  it("does not return an order when customer or warehouse scope cannot be verified", async () => {
    mocks.findShippingOrders.mockResolvedValue([{ id: 88, shipment_id: "SR812500", status: "Open" }]);

    await expect(
      getTeamshipShippingOrder(context, { orderId: "SR812500", customerId: "420", warehouseId: "102" })
    ).resolves.toMatchObject({ ok: false, error: { code: "SCOPE_UNVERIFIED" } });
  });

  it("denies employees outside the temporary named internal-team policy", async () => {
    const manager = {
      ...context,
      userId: "manager-1",
      userEmail: "manager@newl.ca",
      userName: "Another Manager",
      role: PlatformRole.MANAGER
    };

    await expect(
      searchTeamshipInventory(manager, {
        queryType: "LPN",
        query: "PALLET-1",
        customerId: "420",
        warehouseId: "102"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });
    expect(mocks.searchInventory).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalled();
  });

  it("still requires the tenant Teamship module for an approved internal employee", async () => {
    mocks.moduleAccessFindFirst.mockResolvedValue(null);

    await expect(
      searchTeamshipInventory(context, {
        queryType: "SKU",
        query: "ABC-100",
        customerId: "420",
        warehouseId: "102"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });
    expect(mocks.searchInventory).not.toHaveBeenCalled();
  });

  it("fails closed when the tenant enable flag is off", async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, readOnlySearchEnabled: false });

    await expect(
      searchTeamshipInventory(context, {
        queryType: "SKU",
        query: "ABC-100",
        customerId: "420",
        warehouseId: "102"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "TOOL_DISABLED" } });
    expect(mocks.searchInventory).not.toHaveBeenCalled();
  });

  it("audits every disabled browser reader without starting a browser call", async () => {
    const disabledSettings = { ...settings, readOnlySearchEnabled: false, readOnlyScopes: [] };

    const results = await Promise.all([
      searchTeamshipInventoryAll(
        context,
        { sku: "4531010", customerId: "420", warehouseId: "102" },
        { settings: disabledSettings, browserReader }
      ),
      searchTeamshipLpn(
        context,
        { queryType: "LPN", query: "63991", customerId: "420", warehouseId: "102" },
        { settings: disabledSettings, browserReader }
      ),
      getTeamshipReceivingOrder(
        context,
        { orderId: "4392", customerId: "420", warehouseId: "102" },
        { settings: disabledSettings, browserReader }
      ),
      getTeamshipProductHistory(
        context,
        { productId: "45312", customerId: "420", warehouseId: "102" },
        { settings: disabledSettings, browserReader }
      )
    ]);

    expect(results).toEqual(results.map(() => expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "TOOL_DISABLED" }),
      auditId: "audit-1"
    })));
    expect(mocks.searchInventoryAll).not.toHaveBeenCalled();
    expect(mocks.searchLpn).not.toHaveBeenCalled();
    expect(mocks.getReceivingOrder).not.toHaveBeenCalled();
    expect(mocks.getProductHistory).not.toHaveBeenCalled();

    const auditWrites = mocks.auditCreate.mock.calls.map(([request]) => request.data);
    expect(auditWrites.map((write) => write.action)).toEqual([
      "teamship.read.inventory-all.search",
      "teamship.read.lpn.search",
      "teamship.read.receiving-order.get",
      "teamship.read.product-history.get"
    ]);
    for (const write of auditWrites) {
      expect(write).toMatchObject({
        tenantId: "tenant-newl",
        actorUserId: "alex-user",
        entityType: "TeamshipRead",
        after: {
          customerId: "420",
          warehouseId: "102",
          actorRole: PlatformRole.OPERATIONS,
          accessPolicy: "NEWL_INTERNAL_TEAM_V1",
          status: "ERROR",
          errorCode: "TOOL_DISABLED",
          recordIds: []
        }
      });
    }
    expect(JSON.stringify(auditWrites)).not.toContain("not-returned-to-model");
    expect(JSON.stringify(auditWrites)).not.toContain("password");
  });

  it("reports receiving lookup as unavailable without making a Teamship call", async () => {
    await expect(
      getTeamshipReceivingOrder(context, { orderId: "RO-22", customerId: "420", warehouseId: "102" })
    ).resolves.toMatchObject({ ok: false, error: { code: "CAPABILITY_UNAVAILABLE" } });
    expect(mocks.searchInventory).not.toHaveBeenCalled();
    expect(mocks.findShippingOrders).not.toHaveBeenCalled();
  });

  it("handles zero, one, and multiple Inventory All results from the guarded browser reader", async () => {
    const input = { sku: "ABC-100", customerId: "420", warehouseId: "102" };

    await expect(searchTeamshipInventoryAll(context, input, { browserReader })).resolves.toMatchObject({
      ok: true,
      cardinality: "ZERO",
      resultCount: 0
    });

    mocks.searchInventoryAll.mockResolvedValue([
      {
        inventoryId: "stock-1",
        productId: "product-1",
        productName: "Sanitized product",
        sku: "ABC-100",
        available: 7,
        reserved: 3,
        onHand: 10,
        backordered: 0,
        status: "Active",
        customerName: "Garland Canada Distribution",
        warehouseName: "Mississauga - Annagem",
        quarantined: false
      }
    ]);
    await expect(searchTeamshipInventoryAll(context, input, { browserReader })).resolves.toMatchObject({
      ok: true,
      cardinality: "ONE",
      resultCount: 1,
      data: [{ sku: "ABC-100", available: 7, reserved: 3, onHand: 10, sourceView: "INVENTORY_ALL" }]
    });

    mocks.searchInventoryAll.mockResolvedValue([
      { inventoryId: "stock-1", sku: "ABC-100", customerName: "Garland Canada Distribution", warehouseName: "Annagem" },
      { inventoryId: "stock-2", sku: "ABC-100", customerName: "Garland Canada Distribution", warehouseName: "Annagem" }
    ]);
    await expect(searchTeamshipInventoryAll(context, input, { browserReader })).resolves.toMatchObject({
      ok: true,
      cardinality: "MULTIPLE",
      resultCount: 2
    });
  });

  it("rejects Inventory All rows when exact browser scope evidence is absent", async () => {
    mocks.searchInventoryAll.mockResolvedValue([
      { inventoryId: "stock-1", sku: "ABC-100", customerName: "Another Customer", warehouseName: "Annagem" }
    ]);

    await expect(
      searchTeamshipInventoryAll(
        context,
        { sku: "ABC-100", customerId: "420", warehouseId: "102" },
        { browserReader }
      )
    ).resolves.toMatchObject({ ok: false, error: { code: "SCOPE_UNVERIFIED" } });
  });

  it("returns only exact LPN matches with minimized location evidence", async () => {
    mocks.searchLpn.mockResolvedValue([
      {
        inventoryId: "stock-1",
        productId: "product-1",
        sku: "ABC-100",
        lpn: "LPN-42",
        quantity: 4,
        location: "A-01",
        status: "Available",
        serialNumber: "SERIAL-1",
        customerName: "Garland Canada Distribution",
        warehouseName: "Annagem",
        quarantined: false,
        privateContact: "must not pass through"
      },
      {
        inventoryId: "stock-2",
        sku: "ABC-100",
        lpn: "LPN-420",
        customerName: "Garland Canada Distribution",
        warehouseName: "Annagem"
      }
    ]);

    const result = await searchTeamshipLpn(
      context,
      { queryType: "LPN", query: "LPN-42", customerId: "420", warehouseId: "102" },
      { browserReader }
    );

    expect(result).toMatchObject({
      ok: true,
      cardinality: "ONE",
      data: [{ lpn: "LPN-42", sku: "ABC-100", quantity: 4, location: "A-01", sourceView: "SHIP_BY_LPN" }]
    });
    expect(JSON.stringify(result)).not.toContain("privateContact");
  });

  it("returns a scoped receiving order and never exposes unrestricted browser fields", async () => {
    mocks.getReceivingOrder.mockResolvedValue([
      {
        orderId: "RO-22",
        teamshipId: "22",
        status: "Complete",
        customerName: "Garland Canada Distribution",
        warehouseName: "Annagem",
        createdAt: "2026-07-01",
        eta: "2026-07-03",
        carrier: "Example Carrier",
        bolNumber: "BOL-22",
        palletCount: 2,
        items: [{ productId: "product-1", sku: "ABC-100", incoming: 10, received: 10, lpn: "LPN-42", location: "A-01", weight: 100 }],
        billingDetails: "must not pass through"
      }
    ]);

    const result = await getTeamshipReceivingOrder(
      context,
      { orderId: "RO-22", customerId: "420", warehouseId: "102" },
      { browserReader }
    );

    expect(result).toMatchObject({ ok: true, cardinality: "ONE", data: [{ orderId: "RO-22", status: "Complete" }] });
    expect(JSON.stringify(result)).not.toContain("billingDetails");
  });

  it("filters product history to the configured warehouse", async () => {
    mocks.getProductHistory.mockResolvedValue([
      {
        productId: "product-1",
        sku: "ABC-100",
        productName: "Sanitized product",
        customerName: "Garland Canada Distribution",
        rows: [
          { historyId: "h-1", date: "2026-07-01", event: "Received", adjustment: 5, availableAfter: 5, warehouseName: "Annagem", batch: null, serialNumber: null, status: "Complete" },
          { historyId: "h-2", date: "2026-07-02", event: "Moved", adjustment: 0, availableAfter: 5, warehouseName: "Kestrel", batch: null, serialNumber: null, status: "Complete" }
        ]
      }
    ]);

    await expect(
      getTeamshipProductHistory(
        context,
        { productId: "product-1", customerId: "420", warehouseId: "102" },
        { browserReader }
      )
    ).resolves.toMatchObject({
      ok: true,
      cardinality: "ONE",
      data: [{ productId: "product-1", rows: [{ historyId: "h-1", warehouseName: "Annagem" }] }]
    });
  });

  it("withholds successful data if audit evidence cannot be written", async () => {
    mocks.searchInventory.mockResolvedValue([{ id: 1, sku: "ABC-100", available: 1 }]);
    mocks.auditCreate.mockRejectedValue(new Error("database unavailable"));

    await expect(
      searchTeamshipInventory(context, {
        queryType: "SKU",
        query: "ABC-100",
        customerId: "420",
        warehouseId: "102"
      })
    ).resolves.toMatchObject({ ok: false, auditId: null, error: { code: "AUDIT_FAILED" } });
  });
});
