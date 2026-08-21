import { describe, expect, it, vi } from "vitest";

import {
  buildTmgTeamshipCreatePlan,
  executeApprovedTmgTeamshipCreatePlan,
  type TmgTeamshipPlanOrder,
  type TmgTeamshipProfile
} from "@/modules/shipment-documents/tmg-teamship-create";

const profile: TmgTeamshipProfile = {
  customerId: "1001",
  customerName: "Synthetic TMG Customer",
  warehouseId: "2001",
  warehouseName: "Synthetic Warehouse",
  inventoryUserId: "1001",
  inventoryLocationId: "3001",
  carrierName: "Synthetic LTL"
};

const order: TmgTeamshipPlanOrder = {
  customerReference: "US19999",
  fulfillmentType: "FREIGHT",
  orderDate: "2026-08-18",
  proNumber: "010-1234567",
  packetHash: "a".repeat(64),
  shipTo: {
    name: "Synthetic Recipient",
    address: "123 Example Way",
    city: "Example City",
    state: "NY",
    postalCode: "12345",
    countryCode: "US",
    phone: "+1 212-555-0100",
    email: "user@example.com"
  },
  items: [{ sku: "TMG-EXAMPLE-1", quantity: 2 }]
};

describe("TMG Teamship create planning", () => {
  it("freezes an exact unit-order payload without trucking delivery notes", async () => {
    const plan = await buildPlan();

    expect(plan.payload).toMatchObject({
      customer_id: 1001,
      warehouse_id: 2001,
      status: "requested",
      orderType: "unit",
      selectedProducts: { "4001-5001": { stock_id: 5001, quantity: 2 } },
      shippingMethod: "ltl",
      ltlShipmentID: "US19999",
      poNumber: "US19999",
      proNumber: "010-1234567",
      pickETA_date: "08/18/2026",
      ship_first_name: "Synthetic Recipient",
      ship_address: "123 Example Way"
    });
    expect(plan.payload).not.toHaveProperty("shippingServiceLevel");
    expect(plan.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds a self-pickup plan with no freight PRO number", async () => {
    const plan = await buildTmgTeamshipCreatePlan({
      tenantId: "tenant-example",
      order: { ...order, fulfillmentType: "SELF_PICKUP", proNumber: null },
      profile,
      searchProducts: vi.fn(async () => [productRow(5001)])
    });

    expect(plan).toMatchObject({ fulfillmentType: "SELF_PICKUP" });
    expect(plan.payload).toMatchObject({
      shippingMethod: "ltl",
      carrier_value: "P/U",
      proNumber: "",
      ltlShipmentID: "US19999",
      poNumber: "US19999"
    });
  });

  it("continues to require a PRO number for freight orders", async () => {
    await expect(buildTmgTeamshipCreatePlan({
      tenantId: "tenant-example",
      order: { ...order, proNumber: null },
      profile,
      searchProducts: vi.fn(async () => [productRow(5001)])
    })).rejects.toThrow("requires a BOL PRO number");
  });

  it("rejects ambiguous exact stock matches", async () => {
    await expect(buildTmgTeamshipCreatePlan({
      tenantId: "tenant-example",
      order,
      profile,
      searchProducts: vi.fn(async () => [productRow(5001), productRow(5002)])
    })).rejects.toThrow("found 2");
  });

  it("requires approval of the current immutable request before any external write", async () => {
    const plan = await buildPlan();
    const findExistingOrders = vi.fn(async () => []);
    const fetchImpl = vi.fn();

    await expect(executeApprovedTmgTeamshipCreatePlan({
      tenantId: "tenant-example",
      plan,
      approval: {
        approvedByUserId: "user-example",
        approvedAt: "2026-08-18T12:00:00.000Z",
        requestHash: "b".repeat(64)
      },
      credentials: credentials(),
      findExistingOrders,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).rejects.toThrow("no longer matches");

    expect(findExistingOrders).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates once, then verifies the exact customer reference", async () => {
    const plan = await buildPlan();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/login")) return jsonResponse({ data: { token: "test-token" } });
      if (url.endsWith("/v1/ship-inventories") && init?.method === "POST") {
        return jsonResponse({ data: { id: 812345, order_number: 612345 } }, 201);
      }
      if (url.endsWith("/v1/ship-inventories/812345")) {
        return jsonResponse({ data: { id: 812345, poNumber: "US19999", ltlShipmentID: "US19999" } });
      }
      throw new Error(`Unexpected test URL ${url}`);
    });

    const evidence = await executeApprovedTmgTeamshipCreatePlan({
      tenantId: "tenant-example",
      plan,
      approval: approval(plan.requestHash),
      credentials: credentials(),
      findExistingOrders: vi.fn(async () => []),
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(evidence).toMatchObject({
      teamshipOrderId: "812345",
      teamshipOrderNumber: "612345",
      responseStatus: 201,
      requestHash: plan.requestHash
    });
    expect(fetchImpl.mock.calls.filter(([input, init]) => String(input).endsWith("/v1/ship-inventories") && init?.method === "POST")).toHaveLength(1);
  });

  it("blocks an exact duplicate before the create request", async () => {
    const plan = await buildPlan();
    const fetchImpl = vi.fn();

    await expect(executeApprovedTmgTeamshipCreatePlan({
      tenantId: "tenant-example",
      plan,
      approval: approval(plan.requestHash),
      credentials: credentials(),
      findExistingOrders: vi.fn(async () => [{ poNumber: "US19999" }]),
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).rejects.toThrow("already exists");

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

async function buildPlan() {
  return buildTmgTeamshipCreatePlan({
    tenantId: "tenant-example",
    order,
    profile,
    searchProducts: vi.fn(async () => [productRow(5001)])
  });
}

function productRow(stockId: number) {
  return {
    product_id: 4001,
    inventory_stock_id: stockId,
    sku: "TMG-EXAMPLE-1",
    customer_id: 1001,
    warehouse_id: 2001,
    location_id: 3001,
    available_quantity: 5
  };
}

function credentials() {
  return { email: "user@example.com", password: "test-password", apiBaseUrl: "https://teamship.example/api" };
}

function approval(requestHash: string) {
  return {
    approvedByUserId: "user-example",
    approvedAt: "2026-08-18T12:00:00.000Z",
    requestHash
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
