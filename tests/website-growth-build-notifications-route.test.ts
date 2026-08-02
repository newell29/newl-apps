import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  claim: vi.fn(),
  acknowledge: vi.fn()
}));

vi.mock("@/server/website-growth-scout-auth", () => ({
  WebsiteGrowthScoutAuthError: class WebsiteGrowthScoutAuthError extends Error {
    status = 401;
  },
  authenticateWebsiteGrowthScoutRequest: (...args: unknown[]) =>
    mocks.authenticate(...args)
}));

vi.mock("@/modules/website-growth/build-notifications", () => ({
  claimWebsiteGrowthBuildNotification: (...args: unknown[]) => mocks.claim(...args),
  acknowledgeWebsiteGrowthBuildNotification: (...args: unknown[]) =>
    mocks.acknowledge(...args)
}));

import { POST } from "@/app/api/website-growth/scout/build-notifications/route";

describe("Website Growth build notification worker route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockReturnValue({ tenantSlug: "newl-group" });
  });

  it("claims the next tenant-scoped notification", async () => {
    mocks.claim.mockResolvedValue({
      requestId: "build-1",
      event: "PREVIEW_READY",
      claimToken: "claim-1",
      message: "Preview ready"
    });

    const response = await POST(new Request(
      "https://newl-apps.example.com/api/website-growth/scout/build-notifications",
      {
        method: "POST",
        body: JSON.stringify({ action: "claim", workerId: "scout-notifier" })
      }
    ));

    expect(response.status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith({
      tenantSlug: "newl-group",
      reviewBaseUrl: "https://newl-apps.example.com",
      workerId: "scout-notifier"
    });
  });

  it("acknowledges only a bounded valid event claim", async () => {
    mocks.acknowledge.mockResolvedValue(true);

    const response = await POST(new Request(
      "https://newl-apps.example.com/api/website-growth/scout/build-notifications",
      {
        method: "POST",
        body: JSON.stringify({
          action: "ack",
          requestId: "build-1",
          event: "FAILED",
          claimToken: "claim-1"
        })
      }
    ));

    expect(response.status).toBe(200);
    expect(mocks.acknowledge).toHaveBeenCalledWith({
      tenantSlug: "newl-group",
      requestId: "build-1",
      event: "FAILED",
      claimToken: "claim-1"
    });
  });

  it("rejects an unknown notification action", async () => {
    const response = await POST(new Request(
      "https://newl-apps.example.com/api/website-growth/scout/build-notifications",
      {
        method: "POST",
        body: JSON.stringify({ action: "send-arbitrary-message" })
      }
    ));

    expect(response.status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.acknowledge).not.toHaveBeenCalled();
  });
});
