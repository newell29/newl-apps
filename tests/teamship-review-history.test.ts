import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  teamshipReviewRun: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn()
  },
  teamshipReviewOrder: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  prisma: prismaMock
}));

import {
  getReviewedTeamshipSrNumbers,
  getTeamshipReviewHistory,
  updateTeamshipReviewRunReview
} from "@/modules/shipment-documents/teamship-review-history";
import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context = {
  tenantId: "tenant-1",
  userId: "user-1",
  role: "OPERATIONS",
  tenantSlug: "newl",
  tenantName: "Newl"
} satisfies AuthenticatedContext;

describe("Teamship review history", () => {
  beforeEach(() => {
    prismaMock.teamshipReviewRun.findMany.mockResolvedValue([]);
    prismaMock.teamshipReviewRun.count.mockResolvedValue(0);
    prismaMock.teamshipReviewRun.findFirst.mockResolvedValue(null);
    prismaMock.teamshipReviewRun.update.mockResolvedValue({});
    prismaMock.teamshipReviewOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.teamshipReviewOrder.create.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    vi.clearAllMocks();
  });

  it("searches saved runs across the requested shipment date range", async () => {
    const history = await getTeamshipReviewHistory(context, {
      search: "SR808478",
      dateFrom: "2026-07-12",
      dateTo: "2026-07-10",
      take: 500
    });

    expect(history).toMatchObject({
      search: "SR808478",
      dateFrom: "2026-07-10",
      dateTo: "2026-07-12",
      allDates: false,
      totalCount: 0
    });
    expect(prismaMock.teamshipReviewRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        where: expect.objectContaining({
          tenantId: "tenant-1",
          workflowKey: "GARLAND_TEAMSHIP_REVIEW",
          deletedAt: null,
          shipmentDate: {
            gte: new Date("2026-07-10T00:00:00.000Z"),
            lte: new Date("2026-07-12T23:59:59.999Z")
          },
          OR: expect.arrayContaining([
            {
              searchText: {
                contains: "SR808478",
                mode: "insensitive"
              }
            },
            {
              orders: {
                some: {
                  OR: expect.arrayContaining([
                    {
                      srNumber: {
                        contains: "SR808478",
                        mode: "insensitive"
                      }
                    }
                  ])
                }
              }
            }
          ])
        })
      })
    );
  });

  it("can search across all saved run dates without a shipment date filter", async () => {
    const history = await getTeamshipReviewHistory(context, {
      search: "READY_TO_PRINT",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-12",
      allDates: true
    });
    const findManyArgs = prismaMock.teamshipReviewRun.findMany.mock.calls[0]?.[0];

    expect(history).toMatchObject({
      search: "READY_TO_PRINT",
      dateFrom: "",
      dateTo: "",
      allDates: true
    });
    expect(findManyArgs?.where).not.toHaveProperty("shipmentDate");
    expect(findManyArgs?.where).toMatchObject({
      tenantId: "tenant-1",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      deletedAt: null
    });
  });

  it("only treats completed PDF-vs-Teamship matches as already reviewed", async () => {
    prismaMock.teamshipReviewOrder.findMany.mockResolvedValue([{ srNumber: "SR808478" }]);

    const reviewed = await getReviewedTeamshipSrNumbers(context, new Date("2026-07-12T00:00:00.000Z"), [
      "SR808478",
      "SR811861"
    ]);

    expect(reviewed).toEqual(new Set(["SR808478"]));
    expect(prismaMock.teamshipReviewOrder.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        srNumber: {
          in: ["SR808478", "SR811861"]
        },
        status: {
          in: ["PASS", "FAIL"]
        },
        run: {
          tenantId: "tenant-1",
          workflowKey: "GARLAND_TEAMSHIP_REVIEW",
          shipmentDate: new Date("2026-07-12T00:00:00.000Z"),
          deletedAt: null
        }
      },
      select: {
        srNumber: true
      }
    });
  });

  it("autosaves edited review data without resetting saved workflow status", async () => {
    prismaMock.teamshipReviewRun.findFirst.mockResolvedValue({
      id: "run-1",
      documentLabel: "July 13, 2026",
      shipmentDate: new Date("2026-07-13T00:00:00.000Z"),
      sourcePdfFileName: "Garland orders.pdf"
    });

    const review = sampleReview();
    review.reviews[0]!.productDimensions[0]!.lengthIn = 36;
    review.reviews[0]!.productDimensions[0]!.widthIn = 22;
    review.reviews[0]!.productDimensions[0]!.heightIn = 48;
    review.reviews[0]!.productDimensions[0]!.weightLb = 187;

    await updateTeamshipReviewRunReview({
      context,
      runId: "run-1",
      review
    });

    expect(prismaMock.teamshipReviewRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "run-1",
          tenantId: "tenant-1",
          workflowKey: "GARLAND_TEAMSHIP_REVIEW",
          deletedAt: null
        })
      })
    );
    expect(prismaMock.teamshipReviewRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          reviewResponse: review,
          summary: review.summary,
          searchText: expect.stringContaining("SR808478")
        })
      })
    );
    expect(prismaMock.teamshipReviewOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          workflowStatus: expect.anything()
        })
      })
    );
    expect(prismaMock.teamshipReviewOrder.updateMany.mock.calls[0]?.[0].data.review.productDimensions[0]).toMatchObject({
      lengthIn: 36,
      widthIn: 22,
      heightIn: 48,
      weightLb: 187
    });
  });
});

function sampleReview(): GarlandTeamshipReviewResponse {
  return {
    summary: {
      pdfOrderCount: 1,
      teamshipMatchedCount: 1,
      passedCount: 0,
      failedCount: 1,
      missingTeamshipCount: 0,
      pendingTeamshipCount: 0,
      noPdfCount: 0,
      skippedAlreadyReviewedCount: 0
    },
    fetchedAt: "2026-07-13T00:00:00.000Z",
    teamshipAlerts: [],
    pdfOrders: [
      {
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
        instructions: "MIDLAND THIRD PARTY ACCOUNT",
        rawText: "",
        items: [
          {
            lineNumber: 1,
            sku: "E1SGHMV6XHU3US",
            description: "",
            quantity: 1,
            dueShipDate: null,
            serialNumbers: ["2604816191908"]
          }
        ]
      }
    ],
    reviews: [
      {
        psNumber: "PS210206",
        srNumber: "SR808478",
        pageNumbers: [1],
        status: "FAIL",
        teamshipOrderId: "30202",
        teamshipUrl: "https://app.teamshipos.com/ship-inventories/30202",
        issueCount: 1,
        alert: null,
        fields: [
          {
            key: "freight_terms",
            label: "Freight terms",
            status: "MISSING",
            pdfValue: "PPADD-CD",
            teamshipValue: null,
            message: "PDF has a value, but Teamship does not."
          }
        ],
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
            source: "TEAMSHIP_LEARNED",
            productType: null,
            quantity: null,
            lengthIn: 48,
            widthIn: 40,
            heightIn: 50,
            weightLb: 500,
            weightUnit: "lbs",
            confidence: "HIGH",
            note: "Learned from Teamship."
          }
        ]
      }
    ]
  };
}
