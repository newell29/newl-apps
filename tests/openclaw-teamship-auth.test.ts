import { PlatformRole } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const membershipFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({
  prisma: {
    membership: {
      findFirst: (...args: unknown[]) => membershipFindFirst(...args)
    }
  }
}));

import {
  authenticateOpenClawTeamshipRequest,
  OpenClawTeamshipAuthError
} from "@/server/openclaw-teamship-auth";

describe("OpenClaw Teamship read authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENCLAW_TEAMSHIP_READ_TOKEN", "test-teamship-token");
    vi.stubEnv("OPENCLAW_TEAMSHIP_TENANT_SLUG", "newl-group");
    membershipFindFirst.mockResolvedValue({
      role: PlatformRole.OPERATIONS,
      tenant: { id: "tenant-1", slug: "newl-group", name: "Newl Group" },
      user: { id: "alex-user", email: "alex.newell@newl.ca", name: "Alex Newell" }
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves a fresh tenant membership from the authenticated actor email", async () => {
    const request = buildRequest("test-teamship-token", "alex.newell@newl.ca");

    await expect(authenticateOpenClawTeamshipRequest(request)).resolves.toMatchObject({
      tenantId: "tenant-1",
      userId: "alex-user",
      userEmail: "alex.newell@newl.ca",
      role: PlatformRole.OPERATIONS
    });
    expect(membershipFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenant: { slug: "newl-group" } })
    }));
  });

  it("resolves a Teams sender through the stable Entra tenant and object identity", async () => {
    const request = new Request("https://newl.test/api/assistant/teamship/read", {
      method: "POST",
      headers: {
        authorization: "Bearer test-teamship-token",
        "x-newl-teams-tenant-id": "11111111-1111-4111-8111-111111111111",
        "x-newl-teams-aad-object-id": "22222222-2222-4222-8222-222222222222"
      }
    });

    await expect(authenticateOpenClawTeamshipRequest(request)).resolves.toMatchObject({
      userId: "alex-user",
      userEmail: "alex.newell@newl.ca"
    });
    expect(membershipFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        user: {
          microsoftEntraTenantId: "11111111-1111-4111-8111-111111111111",
          microsoftEntraObjectId: "22222222-2222-4222-8222-222222222222"
        }
      })
    }));
  });

  it("rejects an incomplete or malformed Teams identity before membership lookup", async () => {
    const request = new Request("https://newl.test/api/assistant/teamship/read", {
      method: "POST",
      headers: {
        authorization: "Bearer test-teamship-token",
        "x-newl-teams-aad-object-id": "not-a-valid-object-id"
      }
    });

    await expect(authenticateOpenClawTeamshipRequest(request))
      .rejects.toMatchObject({ status: 400 } satisfies Partial<OpenClawTeamshipAuthError>);
    expect(membershipFindFirst).not.toHaveBeenCalled();
  });

  it("rejects invalid tokens before looking up a membership", async () => {
    await expect(authenticateOpenClawTeamshipRequest(buildRequest("wrong-token", "alex.newell@newl.ca")))
      .rejects.toMatchObject({ status: 401 } satisfies Partial<OpenClawTeamshipAuthError>);
    expect(membershipFindFirst).not.toHaveBeenCalled();
  });

  it("rejects an actor without a matching tenant membership", async () => {
    membershipFindFirst.mockResolvedValue(null);

    await expect(authenticateOpenClawTeamshipRequest(buildRequest("test-teamship-token", "unknown@newl.ca")))
      .rejects.toMatchObject({ status: 403 } satisfies Partial<OpenClawTeamshipAuthError>);
  });

  it("rejects a tenant member outside the approved internal Teamship policy", async () => {
    membershipFindFirst.mockResolvedValue({
      role: PlatformRole.MANAGER,
      tenant: { id: "tenant-1", slug: "newl-group", name: "Newl Group" },
      user: { id: "manager-user", email: "manager@newl.ca", name: "Another Manager" }
    });

    await expect(authenticateOpenClawTeamshipRequest(buildRequest("test-teamship-token", "manager@newl.ca")))
      .rejects.toMatchObject({ status: 403 } satisfies Partial<OpenClawTeamshipAuthError>);
  });
});

function buildRequest(token: string, email: string) {
  return new Request("https://newl.test/api/assistant/teamship/read", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-newl-user-email": email
    }
  });
}
