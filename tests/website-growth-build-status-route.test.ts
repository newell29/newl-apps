import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  update: vi.fn()
}));

vi.mock("@/server/website-growth-build-worker-auth", () => ({
  WebsiteGrowthBuildWorkerAuthError: class WebsiteGrowthBuildWorkerAuthError extends Error {
    status = 401;
  },
  authenticateWebsiteGrowthBuildWorkerRequest: (...args: unknown[]) =>
    mocks.authenticate(...args)
}));

vi.mock("@/modules/website-growth/build-requests", () => ({
  updateWebsiteGrowthBuildRequestFromWorker: (...args: unknown[]) =>
    mocks.update(...args)
}));

import { POST } from "@/app/api/website-growth/build-requests/[requestId]/status/route";

describe("Website Growth build status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockReturnValue({ tenantSlug: "newl-group" });
    mocks.update.mockResolvedValue(true);
  });

  it("accepts the production-published callback from the website worker", async () => {
    const response = await POST(new Request(
      "https://newl-apps.example.com/api/website-growth/build-requests/build-request-1/status",
      {
        method: "POST",
        body: JSON.stringify({
          status: "PUBLISHED",
          previewUrl: "https://www.newlgroup.com/services/fulfillment-services",
          commitSha: "a".repeat(40)
        })
      }
    ), {
      params: Promise.resolve({ requestId: "build-request-1" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { updated: true } });
    expect(mocks.update).toHaveBeenCalledWith({
      requestId: "build-request-1",
      tenantSlug: "newl-group",
      update: {
        status: "PUBLISHED",
        githubRunUrl: undefined,
        pullRequestUrl: undefined,
        pullRequestNumber: undefined,
        previewUrl: "https://www.newlgroup.com/services/fulfillment-services",
        commitSha: "a".repeat(40),
        errorCode: undefined,
        errorMessage: undefined
      }
    });
  });
});
