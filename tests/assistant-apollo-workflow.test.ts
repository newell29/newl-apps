import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSourceKind, IntegrationProvider, IntegrationStatus, PlatformRole } from "@prisma/client";

const integrationCredentialFindMany = vi.fn();
const requireModule = vi.fn();
const fetchApolloCallActivitySummary = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    integrationCredential: {
      findMany: (...args: unknown[]) => integrationCredentialFindMany(...args)
    }
  }
}));

vi.mock("@/server/auth/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/authorization")>();

  return {
    ...actual,
    requireModule: (...args: unknown[]) => requireModule(...args)
  };
});

vi.mock("@/server/integrations/apollo", () => ({
  fetchApolloCallActivitySummary: (...args: unknown[]) => fetchApolloCallActivitySummary(...args)
}));

import { maybeRunAssistantApolloActivityRequest } from "@/modules/assistant/apollo-workflow";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "user-1",
  userEmail: "admin@newl.ca",
  userName: "Admin User",
  role: PlatformRole.ADMIN,
  memberships: []
};

function buildApolloCredential() {
  return {
    publicConfig: {
      apolloUserMapping: [
        {
          id: "rep-zalan",
          sequence_owner_name: "Zalan Riaz",
          apollo_user_id: "apollo-user-1",
          send_from_email: "zalan@newl.ca",
          send_from_email_account_id: "email-account-1",
          active: true
        }
      ]
    }
  };
}

describe("maybeRunAssistantApolloActivityRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T14:00:00.000Z"));
    requireModule.mockResolvedValue(undefined);
    integrationCredentialFindMany.mockResolvedValue([buildApolloCredential()]);
    fetchApolloCallActivitySummary.mockResolvedValue({
      userName: "Zalan Riaz",
      apolloUserId: "apollo-user-1",
      dateLabel: "2026-06-26",
      timezone: "America/Toronto",
      callCount: 7,
      connectedCount: 3,
      durationSeconds: 486,
      activities: [],
      rawPayload: {}
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers a natural call-count question from Apollo rep activity", async () => {
    const result = await maybeRunAssistantApolloActivityRequest(context, "how many calls did Zalan make today?");

    expect(requireModule).toHaveBeenCalled();
    expect(integrationCredentialFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        provider: IntegrationProvider.APOLLO,
        status: {
          in: [IntegrationStatus.ACTIVE, IntegrationStatus.DISABLED]
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        publicConfig: true
      }
    });
    expect(fetchApolloCallActivitySummary).toHaveBeenCalledWith({
      apolloUserId: "apollo-user-1",
      userName: "Zalan Riaz",
      date: expect.any(Date),
      timezone: "America/Toronto"
    });
    expect(result?.answer).toContain("Zalan Riaz made 7 Apollo call(s) today");
    expect(result?.answer).toContain("Connected/completed calls: 3");
    expect(result?.sources[0]).toMatchObject({
      sourceKind: AssistantSourceKind.INTEGRATION,
      sourceId: "apollo:apollo-user-1:2026-06-26",
      title: "Apollo call activity for Zalan Riaz"
    });
  });

  it("asks which rep when no mapped rep name is present", async () => {
    const result = await maybeRunAssistantApolloActivityRequest(context, "how many calls were made today?");

    expect(fetchApolloCallActivitySummary).not.toHaveBeenCalled();
    expect(result?.answer).toContain("Which Apollo rep should I check?");
    expect(result?.answer).toContain("Zalan Riaz");
  });

  it("returns a setup answer when Apollo rep mapping is missing", async () => {
    integrationCredentialFindMany.mockResolvedValue([]);

    const result = await maybeRunAssistantApolloActivityRequest(context, "how many calls did Zalan make today?");

    expect(fetchApolloCallActivitySummary).not.toHaveBeenCalled();
    expect(result?.answer).toContain("once Apollo rep mapping is synced in Settings");
    expect(result?.metadata).toMatchObject({
      apolloActivityHandled: true,
      blocked: "missing-rep-mapping"
    });
  });

  it("surfaces Apollo lookup failures in the assistant answer", async () => {
    fetchApolloCallActivitySummary.mockRejectedValue(new Error("Apollo request failed with status 403."));

    const result = await maybeRunAssistantApolloActivityRequest(context, "how many calls did Zalan make today?");

    expect(result?.answer).toContain("Apollo activity lookup failed");
    expect(result?.answer).toContain("Apollo request failed with status 403.");
    expect(result?.metadata).toMatchObject({
      apolloActivityHandled: true,
      apolloActivityError: "Apollo request failed with status 403."
    });
  });
});
