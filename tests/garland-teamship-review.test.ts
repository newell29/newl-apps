import { afterEach, describe, expect, it, vi } from "vitest";

import { buildGarlandTeamshipReview, parseGarlandShippingOrderPages } from "@/modules/shipment-documents/teamship-review";
import type { TeamshipShippingOrderDetail } from "@/modules/shipment-documents/teamship-review-types";
import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";

const pageFive = `Ship-To Pre-Shipper Print Date
10018968 PS210210 7/10/2026
Pre-ShipperNELLA TORONTO
P I C K L I S T/P R E - S H I P P E R
433 QUEEN ST. E
TORONTO, ON M5A 1T5
Canada
Order Number SR811861 Ship To PO 2028CTCCONVO Frt Terms PPDg
Order Date 7/9/2026 Ship Via UPS CD STD
PLEASE DELIVER TO ARLEIGH NELLA @ 647-308-0048
TAG: SPIRIT OF YORK
Ln Item Number T Site
Location
Lot/Serial
Ref Ship Qty Qty Open UM Due
 Shipped
3 C-CARE-P 891210
CONVOCARE (2) 10 LITER JUGS PRE MIXED - CCC202
1.00 EA 7/13/2026
NEWLS 1.00 (              )
1 C-CLEAN-FORTE 891210
C-CLEAN STRONG CLEANING STRENGTH (2) 10 LT CONT
1.00 EA 7/13/2026
NEWLS 1.00 (              )
7/10/2026 2:18:19 PM1 / 2`;

const pageSix = `Ship-To Pre-Shipper Print Date
10018968 PS210210 7/10/2026
Pre-ShipperNELLA TORONTO
P I C K L I S T/P R E - S H I P P E R
433 QUEEN ST. E
TORONTO, ON M5A 1T5
Canada
Sales Order SR811861 Order Date 7/9/2026 Ship To PO 2028CTCCONVO
Ln Item Number T Site
Location
Lot/Serial
Ref Ship Qty Qty Open UM Due
 Shipped
2 TUBE KIT - MIXED 891210
(1) Red Tube Kit, (1) Green Tube Kit
1.00 EA 7/10/2026
MACKIE 1.00 (              )
7/10/2026 2:18:19 PM2 / 2`;

const pageOne = `Ship-To Pre-Shipper Print Date
00096658 PS210206 7/10/2026
Pre-ShipperJ.R. MAHONEY LTD.
P I C K L I S T/P R E - S H I P P E R
1810 KINGS ROAD
SYDNEY, NS B1L 1C5
Canada
Order Number SR808478 Ship To PO 0000037656 Frt Terms PPADD-CD
Order Date 5/29/2026 Ship Via MIDLAND
MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND
ATTN. RECEIVING
FREIGHT QUOTE 97068
Ln Item Number T Site
Location
Lot/Serial
Ref Ship Qty Qty Open UM Due
 Shipped
1 E1SGHMV6XHU3US 891210
E1S 208/240/60/1-15 AMP
1.00 EA 7/13/2026
NEWLS 2604816191908 1.00 (              )
7/10/2026 2:18:18 PM1 / 1`;

describe("Garland Teamship review", () => {
  afterEach(() => {
    delete process.env.TEAMSHIP_EMAIL;
    delete process.env.TEAMSHIP_PASSWORD;
    delete process.env.TEAMSHIP_API_BASE_URL;
    delete process.env.TEAMSHIP_MAX_LIST_PAGES;
    vi.restoreAllMocks();
  });

  it("extracts Garland PDF orders and merges multi-page orders by PS/SR", () => {
    const orders = parseGarlandShippingOrderPages([
      { pageNumber: 5, text: pageFive },
      { pageNumber: 6, text: pageSix }
    ]);

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      psNumber: "PS210210",
      srNumber: "SR811861",
      shipToName: "NELLA TORONTO",
      shipToCity: "TORONTO",
      shipToState: "ON",
      shipToPostalCode: "M5A 1T5",
      shipVia: "UPS CD STD",
      pageNumbers: [5, 6]
    });
    expect(orders[0]?.items.map((item) => item.sku)).toEqual(["C-CARE-P", "C-CLEAN-FORTE", "TUBE KIT - MIXED"]);
  });

  it("extracts ship-to details when PDF.js places Pre-Shipper after the name", () => {
    const orders = parseGarlandShippingOrderPages([
      {
        pageNumber: 1,
        text: `Ship-To Pre-Shipper Print Date
00096658 PS210206 7/10/2026
J.R. MAHONEY LTD. Pre-Shipper
1810 KINGS ROAD
SYDNEY, NS B1L 1C5
Canada
P I C K L I S T/P R E - S H I P P E R
Order Number SR808478 Ship To PO 0000037656 Frt Terms PPADD-CD
Order Date 5/29/2026 Ship Via MIDLAND
Ln Item Number T Ship Qty Qty Open UM
1 E1SGHMV6XHU3US 891210
1.00 EA 7/13/2026
NEWLS 2604816191908 1.00 ( )`
      }
    ]);

    expect(orders[0]).toMatchObject({
      psNumber: "PS210206",
      srNumber: "SR808478",
      shipToName: "J.R. MAHONEY LTD.",
      shipToAddress1: "1810 KINGS ROAD",
      shipToCity: "SYDNEY",
      shipToState: "NS",
      shipToPostalCode: "B1L 1C5",
      shipToCountry: "Canada"
    });
  });

  it("marks reviewed orders green when Teamship detail matches the Garland PDF", () => {
    const [pdfOrder] = parseGarlandShippingOrderPages([{ pageNumber: 1, text: pageOne }]);
    const teamshipOrder: TeamshipShippingOrderDetail = {
      id: 123,
      shipment_id: "SR808478",
      record_no: "PS210206",
      carrier: "Midland Transport",
      po_number: "0000037656",
      edi_field_3: "PPADD-CD",
      ship_to_name: "J.R. MAHONEY LTD.",
      ship_to_address_1: "1810 KINGS ROAD",
      ship_to_city: "SYDNEY",
      ship_to_state: "NS",
      ship_to_zip: "B1L 1C5",
      ship_to_country: "CA",
      shipping_instructions: "MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND ATTN. RECEIVING FREIGHT QUOTE 97068",
      items: [{ sku: "E1SGHMV6XHU3US", inventory_count: 1 }],
      custom_fields: [{ label: "Commodity", value: "SKU: E1SGHMV6XHU3US, SN: 2604816191908" }]
    };

    const review = buildGarlandTeamshipReview([pdfOrder!], [teamshipOrder]);

    expect(review.summary).toMatchObject({
      pdfOrderCount: 1,
      teamshipMatchedCount: 1,
      passedCount: 1,
      failedCount: 0,
      missingTeamshipCount: 0
    });
    expect(review.reviews[0]?.status).toBe("PASS");
  });

  it("marks discrepancies red with field-level reasons", () => {
    const [pdfOrder] = parseGarlandShippingOrderPages([{ pageNumber: 1, text: pageOne }]);
    const teamshipOrder: TeamshipShippingOrderDetail = {
      id: 123,
      shipment_id: "SR808478",
      record_no: "PS210206",
      carrier: "Speedy",
      po_number: "WRONG-PO",
      edi_field_3: "PPADD-CD",
      ship_to_name: "J.R. MAHONEY LTD.",
      ship_to_address_1: "1810 KINGS ROAD",
      ship_to_city: "SYDNEY",
      ship_to_state: "NS",
      ship_to_zip: "B1L 1C5",
      ship_to_country: "CA",
      shipping_instructions: "ATTN. RECEIVING",
      items: [{ sku: "DIFFERENT-SKU", inventory_count: 1 }]
    };

    const review = buildGarlandTeamshipReview([pdfOrder!], [teamshipOrder]);

    expect(review.summary.failedCount).toBe(1);
    expect(review.reviews[0]?.status).toBe("FAIL");
    expect(review.reviews[0]?.fields.filter((field) => field.status === "DISCREPANCY").map((field) => field.key)).toEqual(
      expect.arrayContaining(["po_number", "carrier", "items", "serialNumbers"])
    );
  });

  it("compares Teamship UI-style field names and commodity SKU values", () => {
    const [pdfOrder] = parseGarlandShippingOrderPages([{ pageNumber: 1, text: pageOne }]);
    const teamshipOrder: TeamshipShippingOrderDetail = {
      id: 30202,
      amazon_shipment_id1: "SR808478",
      carrier_value: "MIDLAND",
      poNumber: "0000037656",
      ship_first_name: "J.R. MAHONEY LTD.",
      ship_address_1: "1810 KINGS ROAD",
      ship_city: "SYDNEY",
      ship_state: "NS",
      ship_zip: "B1L 1C5",
      ship_country: "CA",
      edi_field_2: "PS210206-SR808478",
      edi_field_3: "PPADD-CD",
      edi_field_4: "MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND ATTN. RECEIVING FREIGHT QUOTE 97068",
      custom_fields: [{ label: "Commodity", value: "SKU: E1SGHMV6XHU3US, SN: 2604816191908" }]
    };

    const review = buildGarlandTeamshipReview([pdfOrder!], [teamshipOrder]);

    expect(review.summary).toMatchObject({
      pdfOrderCount: 1,
      teamshipMatchedCount: 1,
      passedCount: 1,
      failedCount: 0,
      missingTeamshipCount: 0
    });
    expect(review.reviews[0]?.status).toBe("PASS");
  });

  it("fetches Teamship details read-only by Garland SR/shipment ID", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        expect(init?.method).toBe("POST");
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        expect(init?.method ?? "GET").toBe("GET");
        return Response.json({
          data: [
            { id: 10, shipment_id: "SR808478", customer: { company: "Garland Canada Distribution" } },
            { id: 11, shipment_id: "SR000000", customer: { company: "Other Customer" } }
          ]
        });
      }

      if (url.endsWith("/v1/ship-inventories/10")) {
        expect(init?.method ?? "GET").toBe("GET");
        return Response.json({
          data: {
            id: 10,
            record_no: "PS210206"
          }
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      srNumbers: ["SR808478"],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toEqual([
      {
        id: 10,
        shipment_id: "SR808478",
        record_no: "PS210206",
        customer: { company: "Garland Canada Distribution" }
      }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET" || init?.method === "POST")).toBe(
      true
    );
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes("/v1/ship-inventories") && init?.method)).toBe(
      false
    );
  });

  it("pulls Garland daily orders by selected day when no SR filter is provided", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        return Response.json({
          data: [
            {
              id: 10,
              shipment_id: "SR808478",
              created_at_date: "2026-07-10",
              customer: { company: "Garland Canada Distribution" }
            },
            {
              id: 11,
              shipment_id: "SR795656",
              created_at_date: "2026-07-10",
              customer: { company: "Other Customer" }
            },
            {
              id: 12,
              shipment_id: "SR810154",
              created_at_date: "2026-07-09",
              customer: { company: "Garland Canada Distribution" }
            }
          ]
        });
      }

      if (url.endsWith("/v1/ship-inventories/10")) {
        return Response.json({
          data: {
            id: 10,
            record_no: "PS210206"
          }
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      shipmentDate: "2026-07-10",
      srNumbers: [],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 10,
      shipment_id: "SR808478",
      record_no: "PS210206",
      customer: { company: "Garland Canada Distribution" }
    });
  });

  it("uses one-time runtime credentials without requiring Teamship env vars", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "one-time@example.com",
          password: "not-stored"
        });
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        return Response.json({
          data: [{ id: 10, shipment_id: "SR808478", customer: { company: "Garland Canada Distribution" } }]
        });
      }

      if (url.endsWith("/v1/ship-inventories/10")) {
        return Response.json({ data: { id: 10, record_no: "PS210206" } });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      srNumbers: ["SR808478"],
      credentials: {
        email: "one-time@example.com",
        password: "not-stored"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 10,
      shipment_id: "SR808478",
      record_no: "PS210206"
    });
  });

  it("finds Teamship orders when the shipment ID is returned in UI-style fields", async () => {
    process.env.TEAMSHIP_EMAIL = "reviewer@example.com";
    process.env.TEAMSHIP_PASSWORD = "configured-in-env";
    process.env.TEAMSHIP_API_BASE_URL = "https://teamship.test/api";
    process.env.TEAMSHIP_MAX_LIST_PAGES = "1";

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      if (url.endsWith("/v1/login")) {
        return Response.json({ data: { token: "token-1" } });
      }

      if (url.includes("/v1/ship-inventories?")) {
        return Response.json({
          data: [{ id: 30202, amazon_shipment_id1: "SR808478", customer: { company: "Garland Canada Distribution" } }]
        });
      }

      if (url.endsWith("/v1/ship-inventories/30202")) {
        return Response.json({
          data: {
            id: 30202,
            amazon_shipment_id1: "SR808478",
            edi_field_2: "PS210206-SR808478"
          }
        });
      }

      throw new Error(`Unexpected Teamship fetch: ${url}`);
    });

    const orders = await fetchTeamshipShippingOrdersForReview({
      srNumbers: ["SR808478"],
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: 30202,
      amazon_shipment_id1: "SR808478",
      edi_field_2: "PS210206-SR808478"
    });
  });
});
