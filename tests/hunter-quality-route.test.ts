import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  requireRole: vi.fn(),
  requireModule: vi.fn(),
  requireMutationAccess: vi.fn(),
  prepare: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn()
}));

vi.mock("@/server/openclaw-assistant-auth", () => ({
  OpenClawAssistantAuthError: class OpenClawAssistantAuthError extends Error {
    status = 401;
  },
  authenticateOpenClawAssistantRequest: (...args: unknown[]) =>
    mocks.authenticate(...args)
}));
vi.mock("@/server/auth/authorization", () => ({
  AuthorizationError: class AuthorizationError extends Error {
    status = 403;
  },
  requireRole: (...args: unknown[]) => mocks.requireRole(...args),
  requireModule: (...args: unknown[]) => mocks.requireModule(...args),
  requireMutationAccess: (...args: unknown[]) =>
    mocks.requireMutationAccess(...args)
}));
vi.mock("@/modules/lead-gen/hunter-quality-audit", () => ({
  HunterQualityAuditError: class HunterQualityAuditError extends Error {
    status = 400;
  },
  prepareHunterQualityAudit: (...args: unknown[]) => mocks.prepare(...args),
  completeHunterQualityAudit: (...args: unknown[]) => mocks.complete(...args),
  failHunterQualityAudit: (...args: unknown[]) => mocks.fail(...args)
}));

import { POST } from "@/app/api/assistant/openclaw/hunter-quality/route";

describe("Hunter quality OpenClaw route", () => {
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
    mocks.prepare.mockResolvedValue({ state: "ready", runId: "run-1" });
  });

  it("requires an authenticated administrator with mutation access", async () => {
    const response = await POST(
      request({
        action: "prepare"
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith(context, ["ADMIN"]);
    expect(mocks.requireModule).toHaveBeenCalledWith(context, "LEAD_GEN");
    expect(mocks.requireMutationAccess).toHaveBeenCalledWith(context);
    expect(mocks.prepare).toHaveBeenCalledWith(context);
  });

  it("passes only the bounded run id and structured completion to the service", async () => {
    const completion = {
      auditedAt: "2026-07-26T16:00:00.000Z",
      findings: []
    };
    mocks.complete.mockResolvedValue({
      state: "completed",
      runId: "run-1",
      teamsMessage: "Hunter quality control completed."
    });

    const response = await POST(
      request({
        action: "complete",
        runId: "run-1",
        completion
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith({
      context,
      runId: "run-1",
      completion
    });
  });
});

function request(body: unknown) {
  return new Request(
    "https://newl.test/api/assistant/openclaw/hunter-quality",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}
