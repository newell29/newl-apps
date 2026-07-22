import { describe, expect, it, vi } from "vitest";

import {
  assertTeamshipBrowserPageUrlAllowed,
  collectTeamshipInventorySearchPages,
  getConfiguredTeamshipBrowserReadAdapter,
  getTeamshipBrowserReadRuntimeStatus,
  parseInventoryAllTables,
  parseLpnTables,
  parseProductHistoryPage,
  parseReceivingOrderPage,
  parseTeamshipInventoryPagerLabel,
  parseTeamshipShippingOrderPalletRows,
  parseTeamshipShippingOrderPalletPreflight,
  readTeamshipShippingOrderPalletCount,
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
      getProductHistory: expect.any(Function),
      getShippingOrderPallets: expect.any(Function)
    });
  });

  it("reads one bounded pallet count from the signed-in shipping-order page", () => {
    expect(parseTeamshipShippingOrderPalletPreflight({
      teamshipOrderId: "31064",
      palletCount: "1",
      customerName: "Garland Canada Distribution",
      warehouseName: "Annagem"
    })).toEqual({
      teamshipOrderId: "31064",
      palletCount: 1,
      customerName: "Garland Canada Distribution",
      warehouseName: "Annagem"
    });
    expect(() => parseTeamshipShippingOrderPalletPreflight({
      teamshipOrderId: "31064",
      palletCount: "2.5",
      customerName: "Garland Canada Distribution",
      warehouseName: "Annagem"
    })).toThrow(/whole number/i);
  });

  it("falls back to the signed-in pallet rows when Teamship omits its hidden count", async () => {
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const values: Record<string, string> = {
      "input#pallet_1": "1",
      "input#pallet_1_length": "48",
      "input#pallet_1_width": "40",
      "input#pallet_1_height": "40",
      "input#pallet_1_weight": "250",
      "#pallet_1_weight_unit": "lbs",
      "#pallet_1_commodity": "SKU: A4505560-5001 QTY: 1"
    };
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector === "input#pallets_count,input[id^='pallet_']") {
          return { first: () => ({ waitFor }) };
        }
        const value = values[selector];
        return {
          count: vi.fn().mockResolvedValue(value === undefined ? 0 : 1),
          first: () => ({ inputValue: vi.fn().mockResolvedValue(value) })
        };
      })
    };

    await expect(readTeamshipShippingOrderPalletCount(page as never, 30_000)).resolves.toBe("1");
    expect(waitFor).toHaveBeenCalledWith({ state: "attached", timeout: 30_000 });
  });

  it("ignores default-only ghost rows and sums valid pallet-row quantities", () => {
    expect(parseTeamshipShippingOrderPalletRows([{
      quantity: "2",
      length: "48",
      width: "40",
      height: "40",
      weight: "500",
      weightUnit: "lbs",
      commodity: "Pallet one"
    }, {
      quantity: null,
      length: null,
      width: null,
      height: null,
      weight: null,
      weightUnit: "lbs",
      commodity: null
    }])).toBe(2);
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
    const tables = [{
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
    }];
    const rows = parseLpnTables(tables, "63991");

    expect(rows).toMatchObject([{
      productId: "product-1",
      sku: "ABC-100",
      lpn: "63991",
      quantity: 4,
      location: "0802A"
    }]);
    expect(rows[0]).not.toHaveProperty("available");
    expect(parseLpnTables(tables, "SERIAL-1")).toMatchObject([{ lpn: "63991", serialNumber: "SERIAL-1" }]);
  });

  it("collects every visible Teamship inventory result page with a bounded pager", async () => {
    const firstPage = [{ headers: ["SKU"], rows: [[cell("ABC-100")]] }];
    const secondPage = [{ headers: ["SKU"], rows: [[cell("ABC-100")]] }];
    const thirdPage = [{ headers: ["SKU"], rows: [[cell("ABC-100")]] }];
    const click = vi.fn().mockResolvedValue(undefined);
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const currentPage = {
      count: vi.fn().mockResolvedValue(1),
      getAttribute: vi.fn().mockResolvedValue("Page 1 of 3 Pages")
    };
    const page = {
      locator: vi.fn((selector: string) => selector === 'a.e-currentitem[aria-label^="Page "]:visible'
        ? currentPage
        : selector === 'input[placeholder="Items per page"]:visible'
          ? { count: vi.fn().mockResolvedValue(0) }
        : selector.startsWith('a[aria-label=')
          ? { count: vi.fn().mockResolvedValue(1), click }
          : { waitFor }),
      evaluate: vi.fn()
        .mockResolvedValueOnce(JSON.stringify({ kind: "rows", tables: secondPage }))
        .mockResolvedValueOnce(JSON.stringify({ kind: "rows", tables: thirdPage }))
    };

    await expect(collectTeamshipInventorySearchPages(page as never, "ABC-100", firstPage))
      .resolves.toEqual([firstPage, secondPage, thirdPage]);
    expect(click).toHaveBeenCalledTimes(2);
    expect(waitFor).toHaveBeenCalledTimes(2);
    expect(parseTeamshipInventoryPagerLabel("Page 1 of 3 Pages")).toEqual({ currentPage: 1, totalPages: 3 });
    expect(parseTeamshipInventoryPagerLabel("Page 4 of 3 Pages")).toBeNull();
  });

  it("expands filtered inventory results to 100 rows before falling back to pager clicks", async () => {
    const firstPage = [{ headers: ["SKU"], rows: [[cell("ABC-100")]] }];
    const expandedPage = [{ headers: ["SKU"], rows: Array.from({ length: 37 }, () => [cell("ABC-100")]) }];
    const pageSizeClick = vi.fn().mockResolvedValue(undefined);
    const optionClick = vi.fn().mockResolvedValue(undefined);
    const currentPage = {
      count: vi.fn().mockResolvedValue(1),
      getAttribute: vi.fn()
        .mockResolvedValueOnce("Page 1 of 3 Pages")
        .mockResolvedValue("Page 1 of 1 Pages")
    };
    const page = {
      locator: vi.fn((selector: string) => selector === 'a.e-currentitem[aria-label^="Page "]:visible'
        ? currentPage
        : selector === 'input[placeholder="Items per page"]:visible'
          ? {
              count: vi.fn().mockResolvedValue(1),
              getAttribute: vi.fn().mockResolvedValue("15"),
              locator: vi.fn().mockReturnValue({ click: pageSizeClick })
            }
          : { count: vi.fn().mockResolvedValue(0) }),
      getByRole: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(1), click: optionClick }),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ kind: "rows", tables: expandedPage }))
    };

    await expect(collectTeamshipInventorySearchPages(page as never, "ABC-100", firstPage))
      .resolves.toEqual([expandedPage]);
    expect(pageSizeClick).toHaveBeenCalledOnce();
    expect(optionClick).toHaveBeenCalledOnce();
    expect(page.waitForFunction).toHaveBeenCalledOnce();
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
    expect(() => assertTeamshipReadControlAllowed("Items per page")).not.toThrow();
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
    expect(captureExpression).toContain("groups.every((group) => group.includes(normalizedQuery))");
    expect(captureExpression).toContain(".e-groupcaption,.lpn-heading-style,input.lpn-checkbox");
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
