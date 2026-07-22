import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  workflowArtifact: { findFirst: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));
const extractionMock = vi.hoisted(() => vi.fn());
const teamshipFetchMock = vi.hoisted(() => vi.fn());
const dimensionsMock = vi.hoisted(() => vi.fn());
const collectSkusMock = vi.hoisted(() => vi.fn());
const reviewMock = vi.hoisted(() => vi.fn());
const saveReviewMock = vi.hoisted(() => vi.fn());
const prepareUpdateReviewMock = vi.hoisted(() => vi.fn());
const phase2PlanMock = vi.hoisted(() => vi.fn());
const createUpdateJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/modules/shipment-documents/garland-pdf-server-extraction", () => ({
  extractGarlandShippingOrdersFromPdfBytes: extractionMock
}));
vi.mock("@/server/integrations/teamship", () => ({
  fetchTeamshipShippingOrdersForReview: teamshipFetchMock
}));
vi.mock("@/modules/shipment-documents/garland-product-dimension-directory", () => ({
  getGarlandLearnedProductDimensionRecommendations: dimensionsMock
}));
vi.mock("@/modules/shipment-documents/garland-product-dimensions", () => ({
  collectGarlandProductDimensionSkus: collectSkusMock
}));
vi.mock("@/modules/shipment-documents/teamship-review", () => ({
  buildGarlandTeamshipReview: reviewMock
}));
vi.mock("@/modules/shipment-documents/teamship-review-history", () => ({
  saveTeamshipReviewRun: saveReviewMock
}));
vi.mock("@/modules/shipment-documents/teamship-update-review", () => ({
  prepareReviewForTeamshipUpdates: prepareUpdateReviewMock
}));
vi.mock("@/modules/shipment-documents/teamship-phase2-dry-run", () => ({
  buildTeamshipPhase2DryRunPlan: phase2PlanMock
}));
vi.mock("@/modules/shipment-documents/teamship-update-jobs", () => ({
  createTeamshipUpdateJob: createUpdateJobMock,
  approveTeamshipUpdateJob: vi.fn()
}));

import { finalizeGarlandArtifact } from "@/modules/assistant/garland-artifacts";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context: AuthenticatedContext = {
  tenantId: "tenant-1",
  tenantSlug: "newl",
  tenantName: "Newl",
  userId: "user-1",
  userEmail: "employee@newl.ca",
  userName: "Employee",
  role: "OPERATIONS"
};

const pdfBytes = Buffer.from("%PDF-1.4\n%%EOF\n");
const chunkHash = createHash("sha256").update(pdfBytes).digest("hex");
const baseOrders = [
  { psNumber: "PS210235", srNumber: "SR810263", items: [] },
  { psNumber: "PS210236", srNumber: "SR810264", items: [] }
];

describe("Garland artifact target-reference enforcement", () => {
  let targetReference: string;

  beforeEach(() => {
    vi.clearAllMocks();
    targetReference = "PS210236";
    prismaMock.workflowArtifact.findFirst.mockImplementation(async ({ where }) => {
      if (where?.id) {
        return {
          id: "artifact-1",
          tenantId: "tenant-1",
          workflowKey: "GARLAND_TEAMSHIP_REVIEW",
          status: "UPLOADING",
          fileName: "Garland orders.pdf",
          sizeBytes: pdfBytes.byteLength,
          contentHash: null,
          chunkCount: 1,
          extractionSummary: { targetReference },
          chunks: [{ chunkIndex: 0, contentHash: chunkHash, bytes: pdfBytes }]
        };
      }
      return null;
    });
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    extractionMock.mockResolvedValue({
      pageCount: 2,
      orders: baseOrders,
      psNumbers: baseOrders.map((order) => order.psNumber),
      srNumbers: baseOrders.map((order) => order.srNumber)
    });
    teamshipFetchMock.mockResolvedValue([{ shipment_id: "SR810264", record_no: "PS210236" }]);
    dimensionsMock.mockResolvedValue([]);
    collectSkusMock.mockReturnValue([]);
    reviewMock.mockImplementation((orders) => ({
      summary: {
        totalOrders: orders.length,
        passedCount: orders.length,
        failedCount: 0,
        missingTeamshipCount: 0,
        pendingTeamshipCount: 0
      },
      reviews: orders.map((order: { psNumber: string; srNumber: string }) => ({
        psNumber: order.psNumber,
        srNumber: order.srNumber,
        status: "PASS",
        issueCount: 0,
        fields: []
      }))
    }));
    saveReviewMock.mockResolvedValue("review-1");
    prepareUpdateReviewMock.mockImplementation((review) => review);
    phase2PlanMock.mockReturnValue({
      orders: [{
        psNumber: "PS210236",
        srNumber: "SR810264",
        teamshipOrderId: "teamship-1",
        teamshipUrl: null,
        status: "READY",
        sourceReviewStatus: "PASS",
        plannedFieldUpdates: [],
        plannedPalletRows: [{
          rowNumber: 1,
          sku: "ABC",
          quantity: 1,
          lengthIn: 48,
          widthIn: 40,
          heightIn: 50,
          weightLb: 500,
          weightUnit: "lbs",
          commodity: "SKU: ABC",
          hasUsableDimensions: true,
          dimensionSource: "GARLAND_REFERENCE",
          dimensionConfidence: "HIGH",
          sourceNote: "Approved Garland reference.",
          teamshipFields: {}
        }],
        plannedBolCleanup: {
          removeCustomerOrderWeights: true,
          compactSpecialInstructions: false,
          reason: "Remove BOL weights."
        },
        validationIssues: []
      }]
    });
    createUpdateJobMock.mockResolvedValue({ id: "job-1", status: "DRAFT" });
  });

  it("queries and saves only the exact PS selected from a multi-order PDF", async () => {
    const result = await finalizeGarlandArtifact(context, "artifact-1", {
      shipmentDate: "2026-07-21"
    });

    expect(teamshipFetchMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      shipmentDate: "2026-07-21",
      srNumbers: ["SR810264"]
    });
    expect(reviewMock.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ psNumber: "PS210236", srNumber: "SR810264" })
    ]);
    expect(result).toMatchObject({
      extraction: {
        targetReference: "PS210236",
        selectedPsNumber: "PS210236",
        selectedSrNumber: "SR810264",
        totalOrderCount: 2,
        orderCount: 1,
        ignoredOrderCount: 1
      },
      orders: [{ psNumber: "PS210236", srNumber: "SR810264" }],
      updateProposal: {
        jobId: "job-1",
        status: "DRAFT",
        approvalRequired: true,
        proposedActions: expect.arrayContaining([
          expect.stringContaining("48 x 40 x 50"),
          expect.stringContaining("editable BOL")
        ]),
        investigationItems: []
      }
    });
    expect(createUpdateJobMock).toHaveBeenCalledWith(context, expect.objectContaining({
      selectedSrNumbers: ["SR810264"],
      agentMode: "LIVE_API"
    }));
    expect(prismaMock.workflowArtifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          extractionSummary: expect.objectContaining({
            targetReference: "PS210236",
            ignoredOrderCount: 1
          })
        })
      })
    );
  });

  it("stops before Teamship when one SR identifies multiple PDF orders", async () => {
    targetReference = "SR810263";
    extractionMock.mockResolvedValue({
      pageCount: 2,
      orders: [
        { psNumber: "PS210235", srNumber: "SR810263", items: [] },
        { psNumber: "PS210236", srNumber: "SR810263", items: [] }
      ],
      psNumbers: ["PS210235", "PS210236"],
      srNumbers: ["SR810263"]
    });

    await expect(finalizeGarlandArtifact(context, "artifact-1", {
      shipmentDate: "2026-07-21"
    })).rejects.toThrow("Ask the employee for the exact PS number");

    expect(teamshipFetchMock).not.toHaveBeenCalled();
    expect(prismaMock.workflowArtifact.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });
});
