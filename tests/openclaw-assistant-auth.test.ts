import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ membership: { findFirst: vi.fn() } }));
vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";

describe("OpenClaw assistant authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENCLAW_ASSISTANT_TOKEN = "assistant-secret";
    process.env.OPENCLAW_ASSISTANT_TENANT_SLUG = "newl";
  });

  afterEach(() => {
    delete process.env.OPENCLAW_ASSISTANT_TOKEN;
    delete process.env.OPENCLAW_ASSISTANT_TENANT_SLUG;
  });

  it("resolves a trusted Teams Entra identity to its tenant membership", async () => {
    prismaMock.membership.findFirst.mockResolvedValue({
      role: "OPERATIONS",
      tenant: { id: "tenant-1", slug: "newl", name: "Newl" },
      user: { id: "user-1", email: "employee@newl.ca", name: "Employee" }
    });
    const request = makeRequest();

    await expect(authenticateOpenClawAssistantRequest(request)).resolves.toMatchObject({
      tenantId: "tenant-1",
      userId: "user-1",
      role: "OPERATIONS"
    });
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant: { slug: "newl" },
          user: {
            microsoftEntraTenantId: "11111111-1111-4111-8111-111111111111",
            microsoftEntraObjectId: "22222222-2222-4222-8222-222222222222"
          }
        }
      })
    );
  });

  it("does not accept an email header in place of trusted Teams identity", async () => {
    const request = new Request("https://newl.test/api/assistant/garland", {
      method: "POST",
      headers: { authorization: "Bearer assistant-secret", "x-newl-user-email": "employee@newl.ca" }
    });
    await expect(authenticateOpenClawAssistantRequest(request)).rejects.toMatchObject({
      status: 400
    } satisfies Partial<OpenClawAssistantAuthError>);
  });
});

function makeRequest() {
  return new Request("https://newl.test/api/assistant/garland", {
    method: "POST",
    headers: {
      authorization: "Bearer assistant-secret",
      "x-newl-teams-tenant-id": "11111111-1111-4111-8111-111111111111",
      "x-newl-teams-aad-object-id": "22222222-2222-4222-8222-222222222222"
    }
  });
}
