import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  requireModule: vi.fn(),
  requireAdmin: vi.fn(),
  requireMutationAccess: vi.fn(),
  generateSuggestions: vi.fn(),
  listSuggestions: vi.fn(),
  listUnresolved: vi.fn()
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
  requireModule: (...args: unknown[]) => mocks.requireModule(...args),
  requireAdmin: (...args: unknown[]) => mocks.requireAdmin(...args),
  requireMutationAccess: (...args: unknown[]) => mocks.requireMutationAccess(...args)
}));
vi.mock("@/modules/assistant/operational-memory", () => ({
  OperationalMemoryError: class OperationalMemoryError extends Error {
    status = 400;
  },
  createOperationalFeedback: vi.fn(),
  explainGarlandCheck: vi.fn(),
  generateDevelopmentSuggestions: (...args: unknown[]) => mocks.generateSuggestions(...args),
  listDevelopmentSuggestions: (...args: unknown[]) => mocks.listSuggestions(...args)
}));
vi.mock("@/modules/assistant/openclaw-unresolved-turns", () => ({
  listOpenClawUnresolvedTurns: (...args: unknown[]) => mocks.listUnresolved(...args)
}));

import { POST } from "@/app/api/assistant/garland/route";

describe("Garland developer digest route", () => {
  const context = { tenantId: "tenant-1", userId: "admin-1", role: "ADMIN" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(context);
    mocks.listSuggestions.mockResolvedValue([
      { id: "suggestion-1", status: "AWAITING_APPROVAL", title: "Improve Garland parser" }
    ]);
    mocks.listUnresolved.mockResolvedValue([
      { id: "issue-1", failureKind: "TOOL_FAILURE", promptText: "Check PS210235" }
    ]);
  });

  it("includes failed or unanswered Nemo queries with approval-gated suggestions", async () => {
    const response = await POST(new Request("https://newl.test/api/assistant/garland", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "suggestion_digest" })
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.awaitingApproval).toHaveLength(1);
    expect(body.data.unresolvedQueries).toEqual([
      expect.objectContaining({ failureKind: "TOOL_FAILURE" })
    ]);
    expect(mocks.listUnresolved).toHaveBeenCalledWith(context, {
      limit: 50,
      staleAfterSeconds: 600
    });
  });
});
