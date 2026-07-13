import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  teamshipUpdateJob: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  teamshipUpdateOrder: {
    updateMany: vi.fn()
  }
}));
const fetchTeamshipShippingOrdersForReviewMock = vi.hoisted(() => vi.fn());
const getGarlandLearnedProductDimensionRecommendationsMock = vi.hoisted(() => vi.fn());
const recordGarlandCsrProductDimensionOverridesMock = vi.hoisted(() => vi.fn());
const collectGarlandProductDimensionSkusMock = vi.hoisted(() => vi.fn());
const buildGarlandTeamshipReviewMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({
  prisma: prismaMock
}));

vi.mock("@/server/integrations/teamship", () => ({
  fetchTeamshipShippingOrdersForReview: fetchTeamshipShippingOrdersForReviewMock
}));

vi.mock("@/modules/shipment-documents/garland-product-dimension-directory", () => ({
  getGarlandLearnedProductDimensionRecommendations: getGarlandLearnedProductDimensionRecommendationsMock,
  recordGarlandCsrProductDimensionOverrides: recordGarlandCsrProductDimensionOverridesMock
}));

vi.mock("@/modules/shipment-documents/garland-product-dimensions", () => ({
  collectGarlandProductDimensionSkus: collectGarlandProductDimensionSkusMock,
  isUpsGarlandOrder: vi.fn(() => false)
}));

vi.mock("@/modules/shipment-documents/teamship-review", () => ({
  buildGarlandTeamshipReview: buildGarlandTeamshipReviewMock
}));

import { completeTeamshipUpdateJobFromAgent, createTeamshipUpdateJob } from "@/modules/shipment-documents/teamship-update-jobs";

describe("Teamship update jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTeamshipShippingOrdersForReviewMock.mockResolvedValue([{ shipment_id: "SR808478" }]);
    getGarlandLearnedProductDimensionRecommendationsMock.mockResolvedValue([]);
    recordGarlandCsrProductDimensionOverridesMock.mockResolvedValue({ observedCount: 1, insertedCount: 1 });
    collectGarlandProductDimensionSkusMock.mockReturnValue(["E1SGHMV6XHU3US"]);
    buildGarlandTeamshipReviewMock.mockReturnValue({
      pdfOrders: [samplePdfOrder()],
      teamshipOrders: [{ shipment_id: "SR808478" }],
      reviews: [],
      summary: {
        pdfOrderCount: 1,
        teamshipMatchedCount: 1,
        passedCount: 1,
        failedCount: 0,
        missingTeamshipCount: 0,
        pendingTeamshipCount: 0,
        noPdfCount: 0,
        skippedAlreadyReviewedCount: 0
      }
    });
  });

  it("rescans Teamship after a partial live agent completion that needs review", async () => {
    const job = sampleJob();
    prismaMock.teamshipUpdateJob.findFirst.mockResolvedValue(job);
    prismaMock.teamshipUpdateJob.update.mockImplementation(async ({ data }) => ({
      ...job,
      ...data,
      errorMessage: data.errorMessage ?? null,
      lastVerificationAt: data.lastVerificationAt ?? null,
      orders: job.orders
    }));
    prismaMock.teamshipUpdateOrder.updateMany.mockResolvedValue({ count: 1 });

    const result = await completeTeamshipUpdateJobFromAgent({
      context: { tenantId: "tenant-1" },
      jobId: "job-1",
      status: "NEEDS_REVIEW",
      agentResult: {
        orders: [
          { srNumber: "SR808478", status: "UPDATED", responseStatus: 200 },
          { srNumber: "SR808479", status: "FAILED", error: "Teamship rejected pallet rows." }
        ]
      }
    });

    expect(fetchTeamshipShippingOrdersForReviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        shipmentDate: "2026-07-11",
        srNumbers: ["SR808478"]
      })
    );
    expect(prismaMock.teamshipUpdateJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "NEEDS_REVIEW",
          verificationResponse: expect.objectContaining({ pdfOrders: [samplePdfOrder()] }),
          lastVerificationAt: expect.any(Date)
        })
      })
    );
    expect(result).toMatchObject({
      status: "NEEDS_REVIEW",
      lastVerificationAt: expect.any(String)
    });
  });

  it("defaults new update drafts to live Teamship mode when no mode is provided", async () => {
    const job = {
      ...sampleCreatedJob(),
      agentMode: "LIVE_API",
      dryRun: false
    };
    prismaMock.teamshipUpdateJob.create.mockResolvedValue(job);

    await createTeamshipUpdateJob(
      {
        tenantId: "tenant-1",
        tenantSlug: "newl",
        tenantName: "Newl",
        userId: "user-1",
        userEmail: "alex.newell@newl.ca",
        userName: "Alex Newell",
        role: "ADMIN"
      },
      {
        documentLabel: "July 11, 2026",
        shipmentDate: "2026-07-11",
        sourcePdfFileName: "garland.pdf",
        selectedSrNumbers: ["SR808478"],
        review: sampleReviewWithCsrOverride()
      }
    );

    expect(prismaMock.teamshipUpdateJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentMode: "LIVE_API",
          dryRun: false
        })
      })
    );
  });

  it("records CSR-entered dimensions in the product directory when creating an update draft", async () => {
    const job = sampleCreatedJob();
    prismaMock.teamshipUpdateJob.create.mockResolvedValue(job);

    await createTeamshipUpdateJob(
      {
        tenantId: "tenant-1",
        tenantSlug: "newl",
        tenantName: "Newl",
        userId: "user-1",
        userEmail: "alex.newell@newl.ca",
        userName: "Alex Newell",
        role: "ADMIN"
      },
      {
        documentLabel: "July 11, 2026",
        shipmentDate: "2026-07-11",
        sourcePdfFileName: "garland.pdf",
        selectedSrNumbers: ["SR808478"],
        agentMode: "DRY_RUN",
        review: sampleReviewWithCsrOverride()
      }
    );

    expect(recordGarlandCsrProductDimensionOverridesMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      documentLabel: "July 11, 2026",
      pdfOrders: [samplePdfOrder()],
      dimensions: expect.arrayContaining([
        expect.objectContaining({
          sku: "E1SGHMV6XHU3US",
          source: "CSR_OVERRIDE",
          lengthIn: 48,
          widthIn: 40,
          heightIn: 50,
          weightLb: 500
        })
      ])
    });
  });
});

function sampleJob() {
  return {
    id: "job-1",
    documentLabel: "July 11, 2026",
    shipmentDate: new Date("2026-07-11T00:00:00.000Z"),
    sourcePdfFileName: "garland.pdf",
    status: "RUNNING",
    agentMode: "LIVE_API",
    dryRun: false,
    selectedSrNumbers: ["SR808478"],
    summary: {
      orderCount: 1,
      readyCount: 1,
      blockedCount: 0,
      skippedCount: 0,
      plannedFieldUpdateCount: 1,
      plannedPalletRowCount: 1
    },
    sourceReviewResponse: {},
    sourcePdfOrders: [samplePdfOrder()],
    plan: {},
    errorMessage: null,
    agentId: "teamship-vm-agent",
    agentClaimedAt: new Date("2026-07-11T12:00:00.000Z"),
    agentStartedAt: new Date("2026-07-11T12:01:00.000Z"),
    agentFinishedAt: null,
    approvedAt: new Date("2026-07-11T11:59:00.000Z"),
    lastVerificationAt: null,
    createdAt: new Date("2026-07-11T11:55:00.000Z"),
    createdBy: { name: "Alex Newell", email: "alex.newell@newl.ca" },
    approvedBy: { name: "Alex Newell", email: "alex.newell@newl.ca" },
    orders: [
      {
        id: "order-1",
        psNumber: "PS210206",
        srNumber: "SR808478",
        teamshipOrderId: "30202",
        teamshipUrl: "https://members.fulfillit.io/ship-inventories/30202",
        status: "RUNNING",
        sourceReviewStatus: "FAIL",
        plannedFieldUpdates: [{ field: "freightTerms" }],
        plannedPalletRows: [{ commodity: "SKU: E1SGHMV6XHU3US, SN: 2604816191908" }],
        validationIssues: [],
        agentResult: null,
        errorMessage: null
      }
    ]
  };
}

function sampleCreatedJob() {
  return {
    ...sampleJob(),
    status: "DRAFT",
    agentMode: "DRY_RUN",
    dryRun: true,
    agentId: null,
    agentClaimedAt: null,
    agentStartedAt: null,
    approvedAt: null,
    createdAt: new Date("2026-07-11T11:55:00.000Z"),
    orders: [
      {
        ...sampleJob().orders[0],
        status: "READY",
        plannedFieldUpdates: [],
        plannedPalletRows: []
      }
    ]
  };
}

function sampleReviewWithCsrOverride() {
  return {
    summary: {
      pdfOrderCount: 1,
      teamshipMatchedCount: 1,
      passedCount: 1,
      failedCount: 0,
      missingTeamshipCount: 0,
      pendingTeamshipCount: 0,
      noPdfCount: 0,
      skippedAlreadyReviewedCount: 0
    },
    fetchedAt: "2026-07-11T12:00:00.000Z",
    teamshipAlerts: [],
    pdfOrders: [samplePdfOrder()],
    reviews: [
      {
        psNumber: "PS210206",
        srNumber: "SR808478",
        pageNumbers: [1],
        status: "PASS",
        teamshipOrderId: "30202",
        teamshipUrl: "https://members.fulfillit.io/ship-inventories/30202",
        issueCount: 0,
        alert: null,
        fields: [],
        pdfItems: [
          {
            sku: "E1SGHMV6XHU3US",
            quantity: "1",
            serialNumbers: ["2604816191908"]
          }
        ],
        teamshipItems: [
          {
            sku: "E1SGHMV6XHU3US",
            quantity: "1",
            serialNumbers: ["2604816191908"]
          }
        ],
        productDimensions: [
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
          }
        ]
      }
    ]
  };
}

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
