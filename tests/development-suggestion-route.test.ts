import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  requireModule: vi.fn(),
  requireMutationAccess: vi.fn(),
  requireAdmin: vi.fn(),
  decide: vi.fn(),
  resolve: vi.fn(),
  retry: vi.fn()
}));

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: (...args: unknown[]) => mocks.getContext(...args)
}));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: (...args: unknown[]) => mocks.requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => mocks.requireMutationAccess(...args),
  requireAdmin: (...args: unknown[]) => mocks.requireAdmin(...args)
}));
vi.mock("@/modules/assistant/operational-memory", () => ({
  decideDevelopmentSuggestion: (...args: unknown[]) => mocks.decide(...args),
  resolveDevelopmentSuggestion: (...args: unknown[]) => mocks.resolve(...args),
  retryRivetDevelopmentSuggestion: (...args: unknown[]) => mocks.retry(...args)
}));

import { PATCH } from "@/app/api/assistant/development-suggestions/[suggestionId]/route";

describe("development suggestion decision route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getContext.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "admin-1",
      role: "ADMIN"
    });
    mocks.resolve.mockResolvedValue({ id: "suggestion-1", status: "RESOLVED" });
  });

  it("requires the normal admin mutation boundary before recording a deployed fix", async () => {
    const response = await PATCH(
      new Request("https://newl.test/api/assistant/development-suggestions/suggestion-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve_deployed" })
      }),
      { params: Promise.resolve({ suggestionId: "suggestion-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ id: "suggestion-1", status: "RESOLVED" });
    expect(mocks.requireMutationAccess).toHaveBeenCalled();
    expect(mocks.requireAdmin).toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
      "suggestion-1"
    );
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});
