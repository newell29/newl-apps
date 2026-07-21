import { describe, expect, it, vi } from "vitest";

import {
  assertTeamshipBrowserPageUrlAllowed,
  getConfiguredTeamshipBrowserReadAdapter,
  getTeamshipBrowserReadRuntimeStatus,
  parseInventoryAllTables,
  parseLpnTables,
  parseProductHistoryPage,
  parseReceivingOrderPage,
  submitTeamshipInventorySearch,
  waitForTeamshipInventorySearchResult
} from "@/modules/teamship/browser-read-execution";
import {
  assertTeamshipReadControlAllowed,
  TEAMSHIP_BROWSER_BLOCKED_CONTROL_NAMES
} from "@/modules/teamship/browser-read-contracts";

const cell = (text: string, links: string[] = []) => ({ text, links });

describe("Teamship browser read extraction", () => {
  it("requires both the server runtime gate and an explicit Chrome path", () => {
    expect(getTeamshipBrowserReadRuntimeStatus({})).toEqual({
      enabled: false,
      configured: false,
      reason: "TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED is not true."
    });
    expect(getConfiguredTeamshipBrowserReadAdapter({
      TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED: "true"
    })).toBeUndefined();
    expect(getConfiguredTeamshipBrowserReadAdapter({
      TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED: "true",
      TEAMSHIP_BROWSER_EXECUTABLE_PATH: "/usr/bin/google-chrome"
    })).toMatchObject({
      searchInventoryAll: expect.any(Function),
      searchLpn: expect.any(Function),
      getReceivingOrder: expect.any(Function),
      getProductHistory: expect.any(Function)
    });
  });

  it("normalizes only the allowlisted Inventory All fields", () => {
    const rows = parseInventoryAllTables([{
      headers: ["Product", "SKU", "Available", "Reserved", "On Hand", "Backordered", "Status", "Company Name", "Warehouse", "Quarantine", "Billing Rate"],
      rows: [[
        cell("Sanitized product", ["/view-product/product-1"]),
        cell("ABC-100"),
        cell("7"),
        cell("3"),
        cell("10"),
        cell("0"),
        cell("Active"),
        cell("Garland Canada Distribution"),
        cell("Annagem"),
        cell("No"),
        cell("$999")
      ]]
    }]);

    expect(rows).toEqual([{
      inventoryId: null,
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
      quarantined: false
    }]);
    expect(JSON.stringify(rows)).not.toContain("999");
  });

  it("prefers the refreshed grid surface containing the requested SKU over a stale compatible grid", () => {
    const headers = ["Product", "SKU", "Available", "Reserved", "On Hand", "Backordered", "Status", "Company Name", "Warehouse", "Quarantine"];
    const rows = parseInventoryAllTables([{
      headers,
      rows: [[cell("Stale product"), cell("OLD-100"), cell("0"), cell("0"), cell("0"), cell("0"), cell("out of stock"), cell("Garland Canada Distribution"), cell("Annagem"), cell("No")]]
    }, {
      headers,
      rows: [[cell("Current product"), cell("ABC-100"), cell("37"), cell("0"), cell("37"), cell("0"), cell("available"), cell("Garland Canada Distribution"), cell("Annagem"), cell("No")]]
    }], "ABC-100");

    expect(rows).toMatchObject([{
      sku: "ABC-100",
      available: 37,
      reserved: 0,
      onHand: 37,
      warehouseName: "Annagem"
    }]);
  });

  it("pairs refreshed headerless rows with Teamship's separate accessible header surface", () => {
    const rows = parseInventoryAllTables([{
      headers: [
        "ProductPress Alt Down to open filter Menu. Press Enter to sort. Press Ctrl space to group",
        "SKUPress Alt Down to open filter Menu. Press Enter to sort. Press Ctrl space to group",
        "AvailablePress Enter to sort. Press Ctrl space to group",
        "ReservedPress Alt Down to open filter Menu. Press Enter to sort. Press Ctrl space to group",
        "On HandPress Alt Down to open filter Menu. Press Enter to sort. Press Ctrl space to group",
        "BackorderedPress Alt Down to open filter Menu. Press Enter to sort. Press Ctrl space to group",
        "StatusPress Ctrl space to group",
        "Company NamePress Alt Down to open filter Menu. Press Enter to sort. Press Ctrl space to group",
        "WarehousePress Alt Down to open filter Menu. Press Enter to sort. Press Ctrl space to group",
        "QuarantinePress Alt Down to open filter Menu. Press Enter to sort. Press Ctrl space to group"
      ],
      rows: []
    }, {
      headers: [],
      rows: [[cell("Current product"), cell("ABC-100"), cell("37"), cell("0"), cell("37"), cell("0"), cell("available"), cell("Garland Canada Distribution"), cell("Annagem"), cell("No")]]
    }], "ABC-100");

    expect(rows).toMatchObject([{
      sku: "ABC-100",
      available: 37,
      reserved: 0,
      onHand: 37,
      customerName: "Garland Canada Distribution",
      warehouseName: "Annagem"
    }]);
  });

  it("normalizes LPN rows without equating their quantity to Inventory All Available", () => {
    const rows = parseLpnTables([{
      headers: ["", "Product", "SKU", "Product Value", "Available", "UOM", "Quarantine", "Warehouse", "Company Name", "Customer", "Batch", "Serial", "Status", "Date"],
      rows: [
        [cell("63991 (Annagem, LOC:0802A)")],
        [
          cell(""),
          cell("Sanitized product", ["/view-product/product-1"]),
          cell("ABC-100"),
          cell("500"),
          cell("4"),
          cell("piece"),
          cell("No"),
          cell("Annagem"),
          cell("Garland Canada Distribution"),
          cell("Garland Canada Distribution"),
          cell(""),
          cell("SERIAL-1"),
          cell("Available"),
          cell("")
        ]
      ]
    }]);

    expect(rows).toMatchObject([{
      productId: "product-1",
      sku: "ABC-100",
      lpn: "63991",
      quantity: 4,
      location: "0802A"
    }]);
    expect(rows[0]).not.toHaveProperty("available");
  });

  it("extracts minimized receiving-order and product-history records", () => {
    const receiving = parseReceivingOrderPage({
      requestedOrderId: "RO-22",
      url: "https://app.teamshipos.com/inventory-orders/inventoryOrder/22",
      fields: {
        "Order ID": "RO-22",
        Status: "Complete",
        Customer: "Garland Canada Distribution",
        Warehouse: "Annagem",
        "Pallet Count": "2"
      },
      tables: [{
        headers: ["Product", "SKU", "Incoming", "Received"],
        rows: [[cell("Sanitized product", ["/view-product/product-1"]), cell("ABC-100"), cell("10"), cell("10")]]
      }, {
        headers: ["Location", "LPN", "Received Quantity", "Weight"],
        rows: [[cell("A-01"), cell("LPN-42"), cell("10"), cell("100 lbs")]]
      }]
    });

    expect(receiving).toMatchObject({
      orderId: "RO-22",
      teamshipId: "22",
      status: "Complete",
      palletCount: 2,
      items: [{ productId: "product-1", sku: "ABC-100", incoming: 10, received: 10, lpn: "LPN-42", location: "A-01", weight: 100 }]
    });

    const history = parseProductHistoryPage({
      productId: "product-1",
      fields: { SKU: "ABC-100", Customer: "Garland Canada Distribution" },
      tables: [{
        headers: ["ID", "Date", "Event", "Adjustment", "Available", "Warehouse", "Batch", "Serial", "Status", "Charge"],
        rows: [[cell("h-1"), cell("2026-07-01"), cell("Received"), cell("+5"), cell("5"), cell("Annagem"), cell("B-1"), cell("SERIAL-1"), cell("Complete"), cell("$999")]]
      }]
    });

    expect(history).toMatchObject({
      productId: "product-1",
      sku: "ABC-100",
      customerName: "Garland Canada Distribution",
      rows: [{ historyId: "h-1", event: "Received", adjustment: 5, availableAfter: 5, warehouseName: "Annagem" }]
    });
    expect(JSON.stringify(history)).not.toContain("999");
  });

  it("rejects every known Teamship mutation control", () => {
    expect(() => assertTeamshipReadControlAllowed("Search")).not.toThrow();
    for (const name of TEAMSHIP_BROWSER_BLOCKED_CONTROL_NAMES) {
      expect(() => assertTeamshipReadControlAllowed(name)).toThrow(/not allowlisted/i);
    }
  });

  it("types the query and activates the live Teamship inventory Search control", async () => {
    const input = {
      fill: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined)
    };
    const submit = {
      click: vi.fn().mockResolvedValue(undefined)
    };

    await submitTeamshipInventorySearch(input, submit, "ABC-100");

    expect(input.fill).toHaveBeenCalledWith("");
    expect(input.type).toHaveBeenCalledWith("ABC-100", { delay: 25 });
    expect(submit.click).toHaveBeenCalledOnce();
  });

  it("waits for a visible requested inventory row or explicit Teamship empty state before extraction", async () => {
    const table = { headers: ["SKU"], rows: [[cell("ABC-100")]] };
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ kind: "rows", tables: [table] }))
    };

    await expect(waitForTeamshipInventorySearchResult(page as never, "ABC-100", 45_000)).resolves.toEqual([table]);

    expect(page.evaluate).toHaveBeenCalledOnce();
    const captureExpression = page.evaluate.mock.calls[0]?.[0];
    expect(captureExpression).toEqual(expect.any(String));
    expect(captureExpression).toContain("document.querySelectorAll('table')");
    expect(captureExpression).toContain("document.querySelectorAll('[role=\"grid\"]')");
    expect(captureExpression).not.toContain("matchingRow.closest");
  });

  it("accepts an explicit visible empty state only after the exact-row wait expires", async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ kind: "empty" }))
    };

    await expect(waitForTeamshipInventorySearchResult(page as never, "ABC-100", 45_000)).resolves.toEqual([]);

    expect(page.evaluate).toHaveBeenCalledOnce();
  });

  it("rejects non-HTTPS and non-allowlisted page hosts before browser reads continue", () => {
    const allowedHosts = new Set(["app.teamshipos.com", "members.fulfillit.io"]);
    expect(() => assertTeamshipBrowserPageUrlAllowed("https://app.teamshipos.com/inventory", allowedHosts)).not.toThrow();
    expect(() => assertTeamshipBrowserPageUrlAllowed("https://members.fulfillit.io/login", allowedHosts)).not.toThrow();
    expect(() => assertTeamshipBrowserPageUrlAllowed("http://app.teamshipos.com/inventory", allowedHosts)).toThrow(/allowlisted HTTPS/i);
    expect(() => assertTeamshipBrowserPageUrlAllowed("https://example.test/login", allowedHosts)).toThrow(/allowlisted HTTPS/i);
  });
});
