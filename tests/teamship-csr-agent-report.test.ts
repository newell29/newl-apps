import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  teamshipReviewRun: {
    findFirst: vi.fn()
  },
  teamshipUpdateJob: {
    findMany: vi.fn()
  }
}));

const searchTeamshipProductsForShippingMock = vi.hoisted(() => vi.fn());
const getTenantTeamshipSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({
  prisma: prismaMock
}));

vi.mock("@/server/integrations/teamship", () => ({
  searchTeamshipProductsForShipping: searchTeamshipProductsForShippingMock
}));

vi.mock("@/server/integrations/teamship-settings", () => ({
  getTenantTeamshipSettings: getTenantTeamshipSettingsMock
}));

import { buildGarlandCsrAgentReport } from "@/modules/shipment-documents/teamship-csr-agent-report";
import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context = {
  tenantId: "tenant-1",
  userId: "user-1",
  userName: "Alex Newell",
  userEmail: "alex.newell@newl.ca",
  role: "OPERATIONS",
  tenantSlug: "newl",
  tenantName: "Newl"
} satisfies AuthenticatedContext;

describe("Garland CSR agent report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GARLAND_TEAMSHIP_INVENTORY_USER_ID = "562";
    process.env.GARLAND_TEAMSHIP_INVENTORY_LOCATION_ID = "101";
    getTenantTeamshipSettingsMock.mockResolvedValue({
      garlandInventoryUserId: "420",
      garlandInventoryLocationId: "102"
    });
    prismaMock.teamshipReviewRun.findFirst.mockResolvedValue({
      id: "run-1",
      documentLabel: "July 14, 2026",
      shipmentDate: new Date("2026-07-14T00:00:00.000Z"),
      sourcePdfFileName: "12 ORDERS 13 PAGES - PS210235 - PS210246.pdf",
      pdfOrderCount: 3,
      teamshipMatchedCount: 2,
      failedCount: 1,
      missingTeamshipCount: 1,
      pendingTeamshipCount: 0,
      noPdfCount: 0,
      reviewResponse: sampleReview()
    });
    prismaMock.teamshipUpdateJob.findMany.mockResolvedValue([
      {
        id: "job-1",
        status: "SUCCESS",
        agentMode: "LIVE_API",
        orders: [
          {
            srNumber: "SR810263",
            status: "SUCCESS",
            plannedFieldUpdates: [],
            plannedPalletRows: [
              {
                rowNumber: 1,
                sku: "MJ14000053",
                quantity: 2,
                lengthIn: 36,
                widthIn: 22,
                heightIn: 48,
                weightLb: 187,
                weightUnit: "lbs",
                commodity: "SKU: MJ14000053 QTY: 2"
              }
            ],
            validationIssues: [],
            errorMessage: null
          }
        ]
      }
    ]);
    searchTeamshipProductsForShippingMock.mockResolvedValue([
      {
        sku: "C-CLEAN-FORTE",
        custom_attributes: [{ name: "Serial", value: "ALT-SERIAL-1" }]
      }
    ]);
  });

  it("renders the Nemo intro, summary badges, color-coded order table, and inventory guidance", async () => {
    const report = await buildGarlandCsrAgentReport(context, "run-1");

    expect(report.subject).toBe("Garland Teamship Review - July 14, 2026 - 1 updated, 2 need review");
    expect(report.text).toContain("Hello, Nemo reporting for duty.");
    expect(report.text).toContain("[Complete] PS PS210235 / SR SR810263 / Teamship 30385");
    expect(report.text).toContain("Pallet row 1: SKU MJ14000053, qty 2, 36 x 22 x 48, 187 lbs");
    expect(report.text).toContain("Freight terms: PDF has PPADD-CD but Teamship has 3PTYG.");
    expect(report.text).toContain("Possible alternate serials: ALT-SERIAL-1.");
    expect(report.html).toContain("1 completed");
    expect(report.html).toContain("1 need review");
    expect(report.html).toContain("1 not in Teamship");
    expect(report.html).toContain("background:#f6fef9");
    expect(report.html).toContain("background:#fffbfa");
    expect(report.html).toContain("background:#f9fafb");
    expect(report.html).toContain("What Nemo needs from you");
    expect(report.orderTable).toHaveLength(3);
    expect(report.orderTable.map((row) => row.tone)).toEqual(["green", "red", "gray"]);
    expect(searchTeamshipProductsForShippingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "420",
        locationId: "102",
        search: "C-CLEAN-FORTE"
      })
    );
  });
});

function sampleReview(): GarlandTeamshipReviewResponse {
  return {
    summary: {
      pdfOrderCount: 3,
      teamshipMatchedCount: 2,
      passedCount: 1,
      failedCount: 1,
      missingTeamshipCount: 1,
      pendingTeamshipCount: 0,
      noPdfCount: 0,
      skippedAlreadyReviewedCount: 0
    },
    fetchedAt: "2026-07-14T12:00:00.000Z",
    teamshipAlerts: [],
    pdfOrders: [
      {
        pageNumbers: [1],
        psNumber: "PS210235",
        srNumber: "SR810263",
        shipToCode: null,
        shipToName: "GODERICH PLACE",
        shipToAddress1: "30 BALVINA DRIVE EAST",
        shipToCity: "GODERICH",
        shipToState: "ON",
        shipToPostalCode: "N7A 4L5",
        shipToCountry: "Canada",
        shipToPo: "PO-1",
        freightTerms: "PPADD-CD",
        orderDate: null,
        shipVia: "MIDLAND",
        instructions: "ATTN: RECEIVING",
        items: [
          {
            lineNumber: 1,
            sku: "MJ14000053",
            description: "Garland item",
            quantity: 2,
            dueShipDate: null,
            serialNumbers: []
          }
        ],
        rawText: ""
      },
      {
        pageNumbers: [2],
        psNumber: "PS210236",
        srNumber: "SR810465",
        shipToCode: null,
        shipToName: "ACME",
        shipToAddress1: "1 ROAD",
        shipToCity: "TORONTO",
        shipToState: "ON",
        shipToPostalCode: "M1A 1A1",
        shipToCountry: "Canada",
        shipToPo: "PO-2",
        freightTerms: "PPADD-CD",
        orderDate: null,
        shipVia: "SURETRACK",
        instructions: "ATTN: RECEIVING",
        items: [],
        rawText: ""
      },
      {
        pageNumbers: [3],
        psNumber: "PS210237",
        srNumber: "SR812055",
        shipToCode: null,
        shipToName: "SUBWAY",
        shipToAddress1: "2 ROAD",
        shipToCity: "OTTAWA",
        shipToState: "ON",
        shipToPostalCode: "K2C 6Z1",
        shipToCountry: "Canada",
        shipToPo: "PO-3",
        freightTerms: "PPADD-CD",
        orderDate: null,
        shipVia: "SPEEDY",
        instructions: "ATTN: RECEIVING",
        items: [
          {
            lineNumber: 1,
            sku: "C-CLEAN-FORTE",
            description: "Cleaner",
            quantity: 1,
            dueShipDate: null,
            serialNumbers: ["WANTED-SERIAL"]
          }
        ],
        rawText: ""
      }
    ],
    reviews: [
      {
        srNumber: "SR810263",
        psNumber: "PS210235",
        pageNumbers: [1],
        status: "PASS",
        teamshipOrderId: "30385",
        teamshipUrl: "https://app.teamshipos.com/ship-inventories/30385",
        issueCount: 0,
        alert: null,
        fields: [],
        pdfItems: [{ sku: "MJ14000053", quantity: "2", serialNumbers: [] }],
        teamshipItems: [{ sku: "MJ14000053", quantity: "2", serialNumbers: [] }],
        productDimensions: []
      },
      {
        srNumber: "SR810465",
        psNumber: "PS210236",
        pageNumbers: [2],
        status: "FAIL",
        teamshipOrderId: "30391",
        teamshipUrl: "https://app.teamshipos.com/ship-inventories/30391",
        issueCount: 1,
        alert: null,
        fields: [
          {
            key: "freight_terms",
            label: "Freight terms",
            status: "DISCREPANCY",
            pdfValue: "PPADD-CD",
            teamshipValue: "3PTYG",
            message: "PDF has PPADD-CD but Teamship has 3PTYG."
          }
        ],
        pdfItems: [],
        teamshipItems: [],
        productDimensions: []
      },
      {
        srNumber: "SR812055",
        psNumber: "PS210237",
        pageNumbers: [3],
        status: "MISSING_TEAMSHIP",
        teamshipOrderId: null,
        teamshipUrl: null,
        issueCount: 1,
        alert: null,
        fields: [],
        pdfItems: [{ sku: "C-CLEAN-FORTE", quantity: "1", serialNumbers: ["WANTED-SERIAL"] }],
        teamshipItems: [],
        productDimensions: []
      }
    ]
  };
}
