import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  runTeamship: vi.fn()
}));

vi.mock("@/server/openclaw-teamship-auth", () => ({
  OpenClawTeamshipAuthError: class OpenClawTeamshipAuthError extends Error {
    status: number;
    constructor(message: string, status = 401) {
      super(message);
      this.status = status;
    }
  },
  authenticateOpenClawTeamshipRequest: (...args: unknown[]) => mocks.authenticate(...args)
}));

vi.mock("@/modules/assistant/teamship-workflow", () => ({
  maybeRunAssistantTeamshipRequest: (...args: unknown[]) => mocks.runTeamship(...args)
}));

import { POST } from "@/app/api/assistant/teamship/read/route";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "alex-user",
  userEmail: "alex.newell@newl.ca",
  userName: "Alex Newell",
  role: "OPERATIONS"
};

describe("OpenClaw Teamship read route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the minimized deterministic Teamship response", async () => {
    mocks.authenticate.mockResolvedValue(context);
    mocks.runTeamship.mockResolvedValue({
      answer: "LPN 63991 is at 0802A.",
      intent: "TEAMSHIP_LPN_READ",
      provider: "NEWL_TEAMSHIP_READ",
      model: "teamship-read-v1",
      messageMetadata: { auditId: "audit-1" },
      runMetadata: { rawInternalValue: "not returned" },
      sources: [{ title: "Teamship LPN result", excerpt: "Scoped result" }]
    });

    const response = await POST(buildRequest("Where is LPN 63991 customer 420 warehouse 102?"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        answer: "LPN 63991 is at 0802A.",
        intent: "TEAMSHIP_LPN_READ",
        provider: "NEWL_TEAMSHIP_READ",
        model: "teamship-read-v1",
        metadata: { auditId: "audit-1" },
        sources: [{ title: "Teamship LPN result", excerpt: "Scoped result" }]
      }
    });
    expect(JSON.stringify(body)).not.toContain("rawInternalValue");
  });

  it("rejects procedural prompts so OpenClaw uses curated local knowledge", async () => {
    mocks.authenticate.mockResolvedValue(context);
    mocks.runTeamship.mockResolvedValue(null);

    const response = await POST(buildRequest("What does LPN mean?"));

    expect(response.status).toBe(400);
  });

  it("rejects malformed prompts before a Teamship workflow call", async () => {
    mocks.authenticate.mockResolvedValue(context);

    const response = await POST(buildRequest(""));

    expect(response.status).toBe(400);
    expect(mocks.runTeamship).not.toHaveBeenCalled();
  });
});

function buildRequest(prompt: string) {
  return new Request("https://newl.test/api/assistant/teamship/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt })
  });
}
