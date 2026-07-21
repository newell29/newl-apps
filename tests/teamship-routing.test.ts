import { describe, expect, it } from "vitest";

import { routeTeamshipQuestion } from "@/modules/teamship/routing";

describe("Teamship question routing", () => {
  it.each([
    ["Where is SKU ABC-100?", "searchTeamshipLpn", ["customerId", "warehouseId"]],
    ["Where is LPN PALLET-42?", "searchTeamshipLpn", ["customerId", "warehouseId"]],
    ["How much of SKU ABC-100 is available?", "searchTeamshipInventoryAll", ["customerId", "warehouseId"]],
    ["What is shipping order SR812500's status?", "getTeamshipShippingOrder", ["customerId", "warehouseId"]],
    ["Has receiving order RO-22 arrived?", "getTeamshipReceivingOrder", ["customerId", "warehouseId"]],
    ["Show product history product ID 123", "getTeamshipProductHistory", ["customerId", "warehouseId"]]
  ])("requests missing scope for: %s", (prompt, intendedTool, missingFields) => {
    expect(routeTeamshipQuestion(prompt)).toMatchObject({
      kind: "CLARIFICATION",
      intendedTool,
      missingFields
    });
  });

  it("routes a fully scoped SKU location request to Ship by LPN", () => {
    expect(routeTeamshipQuestion("Where is SKU ABC-100 customer 420 warehouse 102?")).toEqual({
      kind: "TOOL",
      tool: "searchTeamshipLpn",
      input: {
        queryType: "SKU",
        query: "ABC-100",
        customerId: "420",
        warehouseId: "102"
      }
    });
  });

  it("routes quantity questions to Inventory All and shipping-eligible questions to the API tool", () => {
    expect(routeTeamshipQuestion("How much SKU ABC-100 is on hand customer 420 warehouse 102?")).toMatchObject({
      kind: "TOOL",
      tool: "searchTeamshipInventoryAll",
      input: { sku: "ABC-100", customerId: "420", warehouseId: "102" }
    });
    expect(routeTeamshipQuestion("Is SKU ABC-100 eligible to ship customer 420 warehouse 102?")).toMatchObject({
      kind: "TOOL",
      tool: "searchTeamshipInventory",
      input: { queryType: "SKU", query: "ABC-100", customerId: "420", warehouseId: "102" }
    });
  });

  it("defaults confirmed Garland requests to customer 420 and Annagem warehouse 102", () => {
    expect(routeTeamshipQuestion("How much SKU ABC-100 is on hand for Garland?")).toEqual({
      kind: "TOOL",
      tool: "searchTeamshipInventoryAll",
      input: { sku: "ABC-100", customerId: "420", warehouseId: "102" }
    });
    expect(routeTeamshipQuestion("What is shipping order SR812500 status for Garland?")).toEqual({
      kind: "TOOL",
      tool: "getTeamshipShippingOrder",
      input: { orderId: "SR812500", customerId: "420", warehouseId: "102" }
    });
  });

  it("preserves an explicit warehouse on a Garland request", () => {
    expect(routeTeamshipQuestion("How much SKU ABC-100 is on hand for Garland warehouse 15?")).toMatchObject({
      kind: "TOOL",
      input: { customerId: "420", warehouseId: "15" }
    });
  });

  it("routes procedural questions to curated knowledge", () => {
    expect(routeTeamshipQuestion("What does LPN mean in Teamship?")).toEqual({
      kind: "KNOWLEDGE",
      reason: "PROCEDURAL"
    });
  });

  it("asks for order type when a generic order question is ambiguous", () => {
    expect(routeTeamshipQuestion("Why can order X not proceed?")).toMatchObject({
      kind: "CLARIFICATION",
      intendedTool: null,
      missingFields: ["orderType", "orderId", "customerId", "warehouseId"]
    });
  });
});
