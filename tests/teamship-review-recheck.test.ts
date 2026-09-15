import { beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceMock = vi.hoisted(() => vi.fn());
const updateReviewMock = vi.hoisted(() => vi.fn());
const reconcileWorkflowMock = vi.hoisted(() => vi.fn());
const fetchTeamshipOrdersMock = vi.hoisted(() => vi.fn());
const getLearnedDimensionsMock = vi.hoisted(() => vi.fn());
const collectSkusMock = vi.hoisted(() => vi.fn());
const buildReviewMock = vi.hoisted(() => vi.fn());
const prepareReviewMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/shipment-documents/teamship-review-history", () => ({
  getTeamshipReviewRunWorkspace: getWorkspaceMock,
  updateTeamshipReviewRunReview: updateReviewMock,
  reconcileRecheckedTeamshipReviewWorkflowStatuses: reconcileWorkflowMock
}));
vi.mock("@/server/integrations/teamship", () => ({
  fetchTeamshipShippingOrdersForReview: fetchTeamshipOrdersMock
}));
vi.mock("@/modules/shipment-documents/garland-product-dimension-directory", () => ({
  getGarlandLearnedProductDimensionRecommendations: getLearnedDimensionsMock
}));
vi.mock("@/modules/shipment-documents/garland-product-dimensions", () => ({
  collectGarlandProductDimensionSkus: collectSkusMock
}));
vi.mock("@/modules/shipment-documents/teamship-review", () => ({
  buildGarlandTeamshipReview: buildReviewMock
}));
vi.mock("@/modules/shipment-documents/teamship-update-review", () => ({
  prepareReviewForTeamshipUpdates: prepareReviewMock
}));

import { recheckCompletelyMissingTeamshipReviewRun } from "@/modules/shipment-documents/teamship-review-recheck";
import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl",
  tenantName: "Newl",
  userId: "user-1",
  userEmail: "user@example.com",
  userName: "Synthetic Operator",
  role: "OPERATIONS"
} satisfies AuthenticatedContext;

describe("saved Garland Teamship recheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectSkusMock.mockReturnValue(["FAKE-SKU"]);
    getLearnedDimensionsMock.mockResolvedValue([]);
    fetchTeamshipOrdersMock.mockResolvedValue([{ id: "12345", record_no: "PS123456", shipment_id: "SR812345" }]);
  });

  it("refreshes only the tenant-scoped saved all-missing batch without creating a Teamship write", async () => {
    const savedReview = reviewFixture({ matched: 0, missing: 1 });
    const refreshedReview = reviewFixture({ matched: 1, missing: 0 });
    getWorkspaceMock.mockResolvedValue({
      id: "run-1",
      documentLabel: "Synthetic Garland batch",
      shipmentDate: "2026-08-11",
      sourcePdfFileName: "synthetic-orders.pdf",
      review: savedReview
    });
    buildReviewMock.mockReturnValue(refreshedReview);
    prepareReviewMock.mockReturnValue(refreshedReview);

    const result = await recheckCompletelyMissingTeamshipReviewRun(context, "run-1");

    expect(result).toBe(refreshedReview);
    expect(fetchTeamshipOrdersMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      shipmentDate: "2026-08-11",
      includeCompletedArchive: true,
      orderReferences: [{ psNumber: "PS123456", srNumber: "SR812345" }]
    });
    expect(updateReviewMock).toHaveBeenCalledWith({ context, runId: "run-1", review: refreshedReview });
    expect(reconcileWorkflowMock).toHaveBeenCalledWith({ context, runId: "run-1", review: refreshedReview });
  });

  it("refuses to overwrite a saved batch that was not a complete zero-match miss", async () => {
    getWorkspaceMock.mockResolvedValue({
      id: "run-1",
      documentLabel: "Synthetic Garland batch",
      shipmentDate: "2026-08-11",
      sourcePdfFileName: "synthetic-orders.pdf",
      review: reviewFixture({ matched: 1, missing: 0 })
    });

    await expect(recheckCompletelyMissingTeamshipReviewRun(context, "run-1")).rejects.toThrow(
      "limited to saved batches where every PDF order was missed"
    );
    expect(fetchTeamshipOrdersMock).not.toHaveBeenCalled();
    expect(updateReviewMock).not.toHaveBeenCalled();
  });
});

function reviewFixture({ matched, missing }: { matched: number; missing: number }): GarlandTeamshipReviewResponse {
  return {
    summary: {
      pdfOrderCount: 1,
      teamshipMatchedCount: matched,
      passedCount: matched,
      failedCount: 0,
      missingTeamshipCount: missing,
      pendingTeamshipCount: 0,
      noPdfCount: 0,
      skippedAlreadyReviewedCount: 0
    },
    pdfOrders: [
      {
        pageNumbers: [1],
        psNumber: "PS123456",
        srNumber: "SR812345",
        shipToCode: null,
        shipToName: "Synthetic Customer",
        shipToAddress1: "1 Example Street",
        shipToCity: "Toronto",
        shipToState: "ON",
        shipToPostalCode: "A1A 1A1",
        shipToCountry: "Canada",
        shipToPo: null,
        orderDate: null,
        freightTerms: null,
        shipVia: null,
        instructions: "",
        items: [],
        rawText: ""
      }
    ],
    reviews: [],
    teamshipAlerts: [],
    fetchedAt: "2026-08-11T12:00:00.000Z"
  };
}
