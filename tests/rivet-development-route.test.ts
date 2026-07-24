import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  requireRole: vi.fn(),
  requireMutationAccess: vi.fn(),
  claim: vi.fn(),
  update: vi.fn()
}));

vi.mock("@/server/openclaw-assistant-auth", () => ({
  OpenClawAssistantAuthError: class OpenClawAssistantAuthError extends Error {
    status = 401;
  },
  authenticateOpenClawAssistantRequest: (...args: unknown[]) => mocks.authenticate(...args)
}));
vi.mock("@/server/auth/authorization", () => ({
  AuthorizationError: class AuthorizationError extends Error {
    status = 403;
  },
  requireRole: (...args: unknown[]) => mocks.requireRole(...args),
  requireMutationAccess: (...args: unknown[]) => mocks.requireMutationAccess(...args)
}));
vi.mock("@/modules/assistant/rivet-development-jobs", () => ({
  RivetDevelopmentJobError: class RivetDevelopmentJobError extends Error {
    status = 400;
  },
  claimRivetDevelopmentJob: (...args: unknown[]) => mocks.claim(...args),
  updateRivetDevelopmentJob: (...args: unknown[]) => mocks.update(...args)
}));

import { POST } from "@/app/api/assistant/openclaw/development-jobs/route";

describe("Rivet OpenClaw development job route", () => {
  const context = {
    tenantId: "tenant-1",
    tenantSlug: "newl",
    tenantName: "Newl",
    userId: "admin-1",
    userEmail: "admin@example.com",
    userName: "Admin",
    role: "ADMIN"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(context);
    mocks.claim.mockResolvedValue({ state: "empty" });
  });

  it("requires an authenticated administrator with mutation access before claiming a job", async () => {
    const response = await POST(new Request("https://newl.test/api/assistant/openclaw/development-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "claim" })
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { state: "empty" } });
    expect(mocks.requireRole).toHaveBeenCalledWith(context, ["ADMIN"]);
    expect(mocks.requireMutationAccess).toHaveBeenCalledWith(context);
    expect(mocks.claim).toHaveBeenCalledWith(context);
  });

  it("passes only bounded worker completion fields to the service", async () => {
    mocks.update.mockResolvedValue({
      state: "completed",
      jobId: "job-1",
      pullRequestUrls: ["https://github.com/newell29/newl-apps/pull/999"]
    });
    const response = await POST(new Request("https://newl.test/api/assistant/openclaw/development-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        jobId: "job-1",
        leaseToken: "lease-1",
        branchName: "codex/rivet-job-1-fix",
        commitSha: "a".repeat(40),
        pullRequestUrls: ["https://github.com/newell29/newl-apps/pull/999"],
        summary: "Implemented the approved fix.",
        tests: ["Focused tests passed."],
        knownLimitations: []
      })
    }));

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(context, expect.objectContaining({
      action: "complete",
      jobId: "job-1",
      branchName: "codex/rivet-job-1-fix",
      pullRequestUrls: ["https://github.com/newell29/newl-apps/pull/999"]
    }));
  });
});
