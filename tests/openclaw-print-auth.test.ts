import { PlatformRole } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const membershipFindFirst = vi.hoisted(() => vi.fn());
vi.mock("@/server/db", () => ({
  prisma: { membership: { findFirst: (...args: unknown[]) => membershipFindFirst(...args) } }
}));
vi.mock("@/server/auth/authorization", () => ({ requireModule: vi.fn() }));

import { authenticateOpenClawPrintRequest } from "@/server/openclaw-print-auth";

describe("OpenClaw print authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENCLAW_PRINT_TOKEN", "dedicated-print-token");
    vi.stubEnv("OPENCLAW_PRINT_TENANT_SLUG", "newl-group");
    membershipFindFirst.mockResolvedValue({
      role: PlatformRole.OPERATIONS,
      tenant: { id: "tenant-1", slug: "newl-group", name: "Newl Group" },
      user: { id: "user-1", email: "alex.newell@newl.ca", name: "Alex Newell" }
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("binds the trusted Teams sender to a current membership", async () => {
    await expect(authenticateOpenClawPrintRequest(buildRequest("dedicated-print-token"))).resolves.toMatchObject({
      tenantId: "tenant-1",
      userId: "user-1"
    });
  });

  it("rejects reuse of the Teamship read credential", async () => {
    vi.stubEnv("OPENCLAW_TEAMSHIP_READ_TOKEN", "dedicated-print-token");
    await expect(authenticateOpenClawPrintRequest(buildRequest("dedicated-print-token"))).rejects.toMatchObject({ status: 503 });
    expect(membershipFindFirst).not.toHaveBeenCalled();
  });
});

function buildRequest(token: string) {
  return new Request("https://newl.test/api/assistant/printing", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-newl-teams-tenant-id": "11111111-1111-4111-8111-111111111111",
      "x-newl-teams-aad-object-id": "22222222-2222-4222-8222-222222222222"
    }
  });
}
