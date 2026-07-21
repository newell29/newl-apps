import { PlatformRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  findMany: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    openClawUnresolvedTurn: {
      upsert: (...args: unknown[]) => mocks.upsert(...args),
      deleteMany: (...args: unknown[]) => mocks.deleteMany(...args),
      findMany: (...args: unknown[]) => mocks.findMany(...args)
    }
  }
}));

import {
  completeOpenClawTurn,
  failOpenClawTurn,
  listOpenClawUnresolvedTurns,
  sanitizeOpenClawIssueText,
  startOpenClawTurn
} from "@/modules/assistant/openclaw-unresolved-turns";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "user-1",
  userEmail: "employee@newl.example",
  userName: "Employee",
  role: PlatformRole.OPERATIONS
};

describe("OpenClaw unresolved turns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ id: "issue-1", status: "PENDING" });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.findMany.mockResolvedValue([]);
  });

  it("stores a sanitized pending turn and hashes external identifiers", async () => {
    await startOpenClawTurn(context, {
      runId: "run-1",
      prompt: "Check SKU ABC password=hunter2 Bearer abc.def.ghi",
      externalMessageId: "teams-message-1",
      externalConversationId: "teams-conversation-1",
      sessionKey: "agent:nemo:session-1"
    });

    const args = mocks.upsert.mock.calls[0]?.[0];
    expect(args.create).toMatchObject({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      status: "PENDING",
      promptText: "Check SKU ABC password=[REDACTED] Bearer [REDACTED]"
    });
    expect(args.create.externalMessageIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain("teams-message-1");
    expect(JSON.stringify(args)).not.toContain("teams-conversation-1");
    expect(JSON.stringify(args)).not.toContain("agent:nemo:session-1");
    expect(JSON.stringify(args)).not.toContain("hunter2");
  });

  it("deletes only the actor's pending successful turn", async () => {
    await completeOpenClawTurn(context, "run-2");

    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        userId: "user-1",
        runId: "run-2",
        status: "PENDING"
      }
    });
  });

  it("retains sanitized failure evidence as open", async () => {
    await failOpenClawTurn(context, {
      runId: "run-3",
      prompt: "Where is LPN 63991?",
      failureKind: "TOOL_FAILURE",
      toolName: "newl_teamship_read",
      errorMessage: "token=secret-value request failed",
      response: "I could not finish the lookup."
    });

    const args = mocks.upsert.mock.calls[0]?.[0];
    expect(args.create).toMatchObject({
      tenantId: "tenant-1",
      status: "OPEN",
      failureKind: "TOOL_FAILURE",
      toolName: "newl_teamship_read",
      errorMessage: "token=[REDACTED] request failed"
    });
    expect(JSON.stringify(args)).not.toContain("secret-value");
  });

  it("lists only open and stale pending rows inside the tenant", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "issue-open",
        runId: "run-open",
        status: "OPEN",
        failureKind: "TOOL_FAILURE"
      },
      {
        id: "issue-stale",
        runId: "run-stale",
        status: "PENDING",
        failureKind: null
      }
    ]);
    const now = new Date("2026-07-21T14:00:00.000Z");

    const rows = await listOpenClawUnresolvedTurns(context, {
      now,
      staleAfterSeconds: 300,
      limit: 25
    });

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: "tenant-1",
        OR: [
          { status: "OPEN" },
          { status: "PENDING", detectedAt: { lte: new Date("2026-07-21T13:55:00.000Z") } }
        ]
      },
      take: 25
    }));
    expect(rows).toEqual([
      expect.objectContaining({ failureKind: "TOOL_FAILURE", stalePending: false }),
      expect.objectContaining({ failureKind: "NO_RESPONSE", stalePending: true })
    ]);
  });

  it("redacts common credentials from bounded issue text", () => {
    expect(sanitizeOpenClawIssueText("api_key=abcdef123456 password:letmein"))
      .toBe("api_key=[REDACTED] password=[REDACTED]");
  });
});
