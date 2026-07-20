import { describe, expect, it, vi } from "vitest";

import type { GarlandPdfShippingOrder, TeamshipShippingOrderDetail } from "@/modules/shipment-documents/teamship-review-types";

const getTeamshipSyncedOrdersForReviewMock = vi.hoisted(() => vi.fn());
const getReviewedTeamshipSrNumbersMock = vi.hoisted(() => vi.fn());
const getGarlandLearnedProductDimensionRecommendationsMock = vi.hoisted(() => vi.fn());
const fetchTeamshipShippingOrdersForReviewMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    role: "OPERATIONS",
    tenantSlug: "newl",
    tenantName: "Newl"
  }))
}));

vi.mock("@/server/auth/authorization", () => ({
  requireModule: vi.fn(async () => undefined)
}));

vi.mock("@/modules/shipment-documents/teamship-daily-sync", () => ({
  getTeamshipSyncedOrdersForReview: getTeamshipSyncedOrdersForReviewMock
}));

vi.mock("@/modules/shipment-documents/garland-product-dimension-directory", () => ({
  getGarlandLearnedProductDimensionRecommendations: getGarlandLearnedProductDimensionRecommendationsMock
}));

vi.mock("@/modules/shipment-documents/teamship-review-history", () => ({
  getReviewedTeamshipSrNumbers: getReviewedTeamshipSrNumbersMock
}));

vi.mock("@/server/integrations/teamship", () => ({
  getTeamshipConfigurationStatus: vi.fn(async () => ({
    configured: true,
    source: "settings",
    apiBaseUrl: "https://app.teamshipos.com/api",
    missing: []
  })),
  fetchTeamshipShippingOrdersForReview: fetchTeamshipShippingOrdersForReviewMock
}));

import { POST } from "@/app/api/shipment-documents/teamship-review/run/route";

describe("Teamship review route", () => {
  it("uses fresh uploaded-SR detail over the daily cache so serials are not missed", async () => {
    const pdfOrder = samplePdfOrder();
    const cachedOrder: TeamshipShippingOrderDetail = {
      ...sampleMatchingTeamshipOrder(),
      custom_fields: [{ label: "Commodity", value: "SKU: E1SGHMV6XHU3US" }]
    };
    const freshOrder = {
      ...sampleMatchingTeamshipOrder(),
      order_items: [
        {
          sku: "E1SGHMV6XHU3US",
          product: {
            serial: "2604816191908"
          }
        }
      ]
    } as unknown as TeamshipShippingOrderDetail;

    getReviewedTeamshipSrNumbersMock.mockResolvedValue(new Set());
    getTeamshipSyncedOrdersForReviewMock.mockResolvedValue([cachedOrder]);
    getGarlandLearnedProductDimensionRecommendationsMock.mockResolvedValue([]);
    fetchTeamshipShippingOrdersForReviewMock.mockResolvedValue([freshOrder]);

    const response = await POST(
      new Request("https://newl.test/api/shipment-documents/teamship-review/run", {
        method: "POST",
        body: JSON.stringify({
          shipmentDate: "2026-07-11",
          orders: [pdfOrder],
          alertDigest: ""
        })
      })
    );
    const json = await response.json();
    const serialField = json.reviews[0].fields.find((field: { key: string }) => field.key === "serialNumbers");

    expect(response.status).toBe(200);
    expect(fetchTeamshipShippingOrdersForReviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        srNumbers: ["SR808478"]
      })
    );
    expect(json.reviews[0]).toMatchObject({
      status: "PASS",
      issueCount: 0
    });
    expect(serialField).toMatchObject({
      status: "MATCH",
      teamshipValue: "2604816191908"
    });
  });
});

function samplePdfOrder(): GarlandPdfShippingOrder {
  return {
    pageNumbers: [1],
    psNumber: "PS210206",
    srNumber: "SR808478",
    shipToCode: null,
    shipToName: "J.R. MAHONEY LTD.",
    shipToAddress1: "1810 KINGS ROAD",
    shipToCity: "SYDNEY",
    shipToState: "NS",
    shipToPostalCode: "B1L 1C5",
    shipToCountry: "Canada",
    shipToPo: "0000037656",
    freightTerms: "PPADD-CD",
    orderDate: null,
    shipVia: "MIDLAND",
    instructions: "MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND ATTN. RECEIVING FREIGHT QUOTE 97068",
    items: [
      {
        lineNumber: 1,
        sku: "E1SGHMV6XHU3US",
        description: "",
        quantity: 1,
        dueShipDate: null,
        serialNumbers: ["2604816191908"]
      }
    ],
    rawText: ""
  };
}

function sampleMatchingTeamshipOrder(): TeamshipShippingOrderDetail {
  return {
    id: "30202",
    shipment_id: "SR808478",
    record_no: "PS210206",
    carrier_value: "MIDLAND",
    poNumber: "0000037656",
    ship_to_name: "J.R. MAHONEY LTD.",
    ship_to_address_1: "1810 KINGS ROAD",
    ship_to_city: "SYDNEY",
    ship_to_state: "NS",
    ship_to_zip: "B1L 1C5",
    ship_to_country: "CA",
    edi_field_2: "PS210206-SR808478",
    custom_fields: [
      { label: "Freight Terms Code", value: "PPADD-CD" },
      { label: "Commodity", value: "SKU: E1SGHMV6XHU3US, SN: 2604816191908" }
    ],
    special_instructions: "MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND ATTN. RECEIVING FREIGHT QUOTE 97068"
  } as unknown as TeamshipShippingOrderDetail;
}
