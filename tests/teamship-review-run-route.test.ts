import { describe, expect, it, vi } from "vitest";

const recheckMock = vi.hoisted(() => vi.fn());

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
  requireModule: vi.fn(async () => undefined),
  requireMutationAccess: vi.fn(async () => undefined),
  requireAdmin: vi.fn()
}));
vi.mock("@/modules/shipment-documents/teamship-review-history", () => ({
  deleteTeamshipReviewRun: vi.fn(),
  getTeamshipReviewHistory: vi.fn(),
  getTeamshipReviewRunWorkspace: vi.fn(),
  updateTeamshipReviewOrderWorkflow: vi.fn(),
  updateTeamshipReviewRunReview: vi.fn()
}));
vi.mock("@/modules/shipment-documents/teamship-review-recheck", () => ({
  recheckCompletelyMissingTeamshipReviewRun: recheckMock
}));

import { PATCH } from "@/app/api/shipment-documents/teamship-review/runs/[runId]/route";

describe("saved Teamship review run route", () => {
  it("rechecks a completely missed batch and returns the refreshed review", async () => {
    const review = { summary: { pdfOrderCount: 1, teamshipMatchedCount: 1 } };
    recheckMock.mockResolvedValue(review);

    const response = await PATCH(
      new Request("https://newl.test/api/shipment-documents/teamship-review/runs/run-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "recheckTeamship" })
      }),
      { params: Promise.resolve({ runId: "run-1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ review });
    expect(recheckMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1" }), "run-1");
  });
});
