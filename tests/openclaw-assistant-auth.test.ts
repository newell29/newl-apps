import { ModuleKey, PlatformRole } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  membershipFindFirst: vi.fn(),
  requireModule: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    membership: {
      findFirst: (...args: unknown[]) => mocks.membershipFindFirst(...args)
    }
  }
}));

vi.mock("@/server/auth/authorization", () => ({
  requireModule: (...args: unknown[]) => mocks.requireModule(...args)
}));

import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";

describe("OpenClaw assistant authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENCLAW_ASSISTANT_TOKEN", "assistant-token");
    vi.stubEnv("OPENCLAW_ASSISTANT_TENANT_SLUG", "newl-group");
    vi.stubEnv("OPENCLAW_TEAMSHIP_READ_TOKEN", "teamship-read-token");
    mocks.membershipFindFirst.mockResolvedValue({
      role: PlatformRole.ADMIN,
      tenant: { id: "tenant-1", slug: "newl-group", name: "Newl Group" },
      user: { id: "user-1", email: "admin@newl.example", name: "Admin" }
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses stable Teams identity and enforces the Assistant module", async () => {
    const context = await authenticateOpenClawAssistantRequest(buildRequest("assistant-token"));

    expect(context).toMatchObject({ tenantId: "tenant-1", userId: "user-1" });
    expect(mocks.membershipFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenant: { slug: "newl-group" },
        user: {
          microsoftEntraTenantId: "11111111-1111-4111-8111-111111111111",
          microsoftEntraObjectId: "22222222-2222-4222-8222-222222222222"
        }
      }
    }));
    expect(mocks.requireModule).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
      ModuleKey.ASSISTANT
    );
  });

  it("rejects invalid tokens and malformed Teams identities before lookup", async () => {
    await expect(authenticateOpenClawAssistantRequest(buildRequest("wrong-token")))
      .rejects.toMatchObject({ status: 401 });
    await expect(authenticateOpenClawAssistantRequest(new Request("https://newl.test/api", {
      headers: { authorization: "Bearer assistant-token" }
    }))).rejects.toMatchObject({ status: 400 });
    expect(mocks.membershipFindFirst).not.toHaveBeenCalled();
  });

  it("does not accept email headers in place of trusted Teams identity", async () => {
    const request = new Request("https://newl.test/api/assistant/garland", {
      method: "POST",
      headers: {
        authorization: "Bearer assistant-token",
        "x-newl-user-email": "employee@newl.ca"
      }
    });

    await expect(authenticateOpenClawAssistantRequest(request)).rejects.toMatchObject({
      status: 400
    } satisfies Partial<OpenClawAssistantAuthError>);
  });

  it("never falls back to or reuses the Teamship read credential", async () => {
    vi.stubEnv("OPENCLAW_ASSISTANT_TOKEN", "");
    await expect(authenticateOpenClawAssistantRequest(buildRequest("teamship-read-token")))
      .rejects.toMatchObject({ status: 503 });

    vi.stubEnv("OPENCLAW_ASSISTANT_TOKEN", "same-token");
    vi.stubEnv("OPENCLAW_TEAMSHIP_READ_TOKEN", "same-token");
    await expect(authenticateOpenClawAssistantRequest(buildRequest("same-token")))
      .rejects.toMatchObject({ status: 503 });
    expect(mocks.membershipFindFirst).not.toHaveBeenCalled();
  });
});

function buildRequest(token: string) {
  return new Request("https://newl.test/api/assistant/garland", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-newl-teams-tenant-id": "11111111-1111-4111-8111-111111111111",
      "x-newl-teams-aad-object-id": "22222222-2222-4222-8222-222222222222"
    }
  });
}
