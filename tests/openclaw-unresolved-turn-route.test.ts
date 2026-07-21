import { PlatformRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  requireRole: vi.fn(),
  start: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  list: vi.fn(),
  auditCreate: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    auditLog: {
      create: (...args: unknown[]) => mocks.auditCreate(...args)
    }
  }
}));

vi.mock("@/server/openclaw-assistant-auth", () => ({
  OpenClawAssistantAuthError: class OpenClawAssistantAuthError extends Error {
    status: number;
    constructor(message: string, status = 401) {
      super(message);
      this.status = status;
    }
  },
  authenticateOpenClawAssistantRequest: (...args: unknown[]) => mocks.authenticate(...args)
}));

vi.mock("@/server/auth/authorization", () => ({
  requireRole: (...args: unknown[]) => mocks.requireRole(...args)
}));

vi.mock("@/modules/assistant/openclaw-unresolved-turns", () => ({
  startOpenClawTurn: (...args: unknown[]) => mocks.start(...args),
  completeOpenClawTurn: (...args: unknown[]) => mocks.complete(...args),
  failOpenClawTurn: (...args: unknown[]) => mocks.fail(...args),
  listOpenClawUnresolvedTurns: (...args: unknown[]) => mocks.list(...args)
}));

import { GET, POST } from "@/app/api/assistant/openclaw/unresolved-turns/route";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "admin-1",
  userEmail: "admin@newl.example",
  userName: "Admin",
  role: PlatformRole.ADMIN
};

describe("OpenClaw unresolved-turn route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(context);
    mocks.start.mockResolvedValue({ id: "issue-1", status: "PENDING" });
    mocks.complete.mockResolvedValue({ count: 1 });
    mocks.fail.mockResolvedValue({ id: "issue-1", status: "OPEN" });
    mocks.list.mockResolvedValue([{ id: "issue-1", failureKind: "NO_RESPONSE" }]);
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("dispatches start, fail, and complete actions", async () => {
    const start = await POST(buildPost({ action: "start", runId: "run-1", prompt: "Find order 1" }));
    const fail = await POST(buildPost({
      action: "fail",
      runId: "run-1",
      prompt: "Find order 1",
      failureKind: "TOOL_FAILURE"
    }));
    const complete = await POST(buildPost({ action: "complete", runId: "run-2" }));

    expect(start.status).toBe(200);
    expect(fail.status).toBe(200);
    await expect(complete.json()).resolves.toEqual({ data: { removed: true } });
    expect(mocks.start).toHaveBeenCalledWith(context, expect.objectContaining({ runId: "run-1" }));
    expect(mocks.fail).toHaveBeenCalledWith(context, expect.objectContaining({ failureKind: "TOOL_FAILURE" }));
    expect(mocks.complete).toHaveBeenCalledWith(context, "run-2");
  });

  it("requires Admin role before returning tenant-scoped issues", async () => {
    const response = await GET(new Request(
      "https://newl.test/api/assistant/openclaw/unresolved-turns?limit=20&staleAfterSeconds=600"
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith(context, [PlatformRole.ADMIN]);
    expect(mocks.list).toHaveBeenCalledWith(context, { limit: 20, staleAfterSeconds: 600 });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        actorUserId: "admin-1",
        action: "assistant.openclaw_unresolved.list",
        after: { count: 1 }
      })
    });
  });
});

function buildPost(body: Record<string, unknown>) {
  return new Request("https://newl.test/api/assistant/openclaw/unresolved-turns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
