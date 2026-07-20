import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  garlandProductDimensionObservation: {
    createMany: vi.fn(),
    findMany: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  prisma: prismaMock
}));

import {
  getGarlandLearnedProductDimensionRecommendations,
  recordGarlandCsrProductDimensionOverrides,
  recordGarlandProductDimensionObservations
} from "@/modules/shipment-documents/garland-product-dimension-directory";

describe("Garland product dimension directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.garlandProductDimensionObservation.createMany.mockResolvedValue({ count: 1 });
    prismaMock.garlandProductDimensionObservation.findMany.mockResolvedValue([]);
  });

  it("saves complete CSR override dimensions as product directory observations", async () => {
    const result = await recordGarlandCsrProductDimensionOverrides({
      tenantId: "tenant-1",
      documentLabel: "July 11, 2026",
      pdfOrders: [samplePdfOrder()],
      dimensions: [
        {
          sku: "E1SGHMV6XHU3US",
          source: "CSR_OVERRIDE",
          productType: null,
          quantity: 1,
          lengthIn: 48,
          widthIn: 40,
          heightIn: 50,
          weightLb: 500,
          weightUnit: "lbs",
          confidence: "HIGH",
          note: "CSR override entered before Teamship bot update."
        },
        {
          sku: "MISSING-WEIGHT",
          source: "CSR_OVERRIDE",
          productType: null,
          quantity: 1,
          lengthIn: 10,
          widthIn: 10,
          heightIn: 10,
          weightLb: null,
          weightUnit: "lbs",
          confidence: "LOW",
          note: "Incomplete row."
        }
      ]
    });

    expect(result).toEqual({ observedCount: 1, insertedCount: 1 });
    expect(prismaMock.garlandProductDimensionObservation.createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          tenantId: "tenant-1",
          sku: "E1SGHMV6XHU3US",
          source: "CSR_OVERRIDE",
          sourceSrNumber: "SR808478",
          carrier: "MIDLAND",
          quantity: 1,
          lengthIn: 48,
          widthIn: 40,
          heightIn: 50,
          weightLb: 500,
          weightUnit: "lbs"
        })
      ]
    });
  });

  it("does not save CSR placeholder dimensions as product directory observations", async () => {
    const result = await recordGarlandCsrProductDimensionOverrides({
      tenantId: "tenant-1",
      documentLabel: "July 11, 2026",
      pdfOrders: [samplePdfOrder()],
      dimensions: [
        {
          sku: "NO-DIM-SKU",
          source: "CSR_OVERRIDE",
          productType: null,
          quantity: 1,
          lengthIn: 1,
          widthIn: 1,
          heightIn: 1,
          weightLb: 1,
          weightUnit: "lbs",
          confidence: "LOW",
          note: "Missing DIM placeholder for Teamship bot draft."
        }
      ]
    });

    expect(result).toEqual({ observedCount: 0, insertedCount: 0 });
    expect(prismaMock.garlandProductDimensionObservation.createMany).not.toHaveBeenCalled();
  });

  it("returns CSR learned recommendations when CSR overrides exist in the directory", async () => {
    prismaMock.garlandProductDimensionObservation.findMany.mockResolvedValue([
      {
        tenantId: "tenant-1",
        observationKey: "CSR_OVERRIDE|SR808478|E1SGHMV6XHU3US|48|40|50|500|LBS",
        sku: "E1SGHMV6XHU3US",
        source: "CSR_OVERRIDE",
        sourceTeamshipOrderId: null,
        sourceSrNumber: "SR808478",
        carrier: "MIDLAND",
        commodity: null,
        quantity: 1,
        lengthIn: 48,
        widthIn: 40,
        heightIn: 50,
        weightLb: 500,
        weightUnit: "lbs",
        observedAt: new Date("2026-07-11T12:00:00.000Z")
      }
    ]);

    const recommendations = await getGarlandLearnedProductDimensionRecommendations({
      tenantId: "tenant-1",
      skus: ["E1SGHMV6XHU3US"]
    });

    expect(recommendations).toEqual([
      expect.objectContaining({
        sku: "E1SGHMV6XHU3US",
        source: "CSR_LEARNED",
        lengthIn: 48,
        widthIn: 40,
        heightIn: 50,
        weightLb: 500,
        note: expect.stringContaining("CSR-entered Newl Apps override")
      })
    ]);
  });

  it("does not save Teamship placeholder pallet dimensions as product directory observations", async () => {
    const result = await recordGarlandProductDimensionObservations({
      tenantId: "tenant-1",
      orders: [
        {
          id: "30202",
          shipment_id: "SR808478",
          carrier_value: "MIDLAND",
          pallets: [
            {
              quantity: 1,
              length: 1,
              width: 1,
              height: 1,
              weight: 1,
              weight_unit: "lbs",
              commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908"
            }
          ]
        }
      ]
    });

    expect(result).toEqual({ observedCount: 0, insertedCount: 0 });
    expect(prismaMock.garlandProductDimensionObservation.createMany).not.toHaveBeenCalled();
  });

  it("saves real Teamship warehouse pallet dimensions as product directory observations", async () => {
    const result = await recordGarlandProductDimensionObservations({
      tenantId: "tenant-1",
      orders: [
        {
          id: "30202",
          shipment_id: "SR808478",
          carrier_value: "MIDLAND",
          pallets: [
            {
              quantity: 1,
              length: 48,
              width: 40,
              height: 50,
              weight: 500,
              weight_unit: "lbs",
              commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908"
            }
          ]
        }
      ]
    });

    expect(result).toEqual({ observedCount: 1, insertedCount: 1 });
    expect(prismaMock.garlandProductDimensionObservation.createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          tenantId: "tenant-1",
          sku: "E1SGHMV6XHU3US",
          source: "TEAMSHIP_PALLET",
          sourceTeamshipOrderId: "30202",
          sourceSrNumber: "SR808478",
          carrier: "MIDLAND",
          lengthIn: 48,
          widthIn: 40,
          heightIn: 50,
          weightLb: 500,
          weightUnit: "lbs"
        })
      ]
    });
  });
});

function samplePdfOrder() {
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
    instructions: "MIDLAND THIRD PARTY ACCOUNT #129083 GARLAND",
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
