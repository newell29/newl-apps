import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantSourceKind,
  ContactSource,
  IntegrationProvider,
  IntegrationStatus,
  PlatformRole,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";

const integrationCredentialFindMany = vi.fn();
const contactCount = vi.fn();
const contactFindMany = vi.fn();
const requireModule = vi.fn();
const fetchApolloActivitySummary = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    integrationCredential: {
      findMany: (...args: unknown[]) => integrationCredentialFindMany(...args)
    },
    contact: {
      count: (...args: unknown[]) => contactCount(...args),
      findMany: (...args: unknown[]) => contactFindMany(...args)
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
  fetchApolloActivitySummary: (...args: unknown[]) => fetchApolloActivitySummary(...args)
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

function buildActivitySummary(overrides: Record<string, unknown> = {}) {
  return {
    userName: "Zalan Riaz",
    apolloUserId: "apollo-user-1",
    startDateLabel: "2026-06-26",
    endDateLabel: "2026-06-26",
    timezone: "America/Toronto",
    counts: {
      CALL: 4,
      CONNECTED_CALL: 3,
      EMAIL_SENT: 0,
      REPLY: 0,
      LEAD_CREATED: 0,
      OTHER: 0
    },
    callCount: 7,
    connectedCount: 3,
    emailSentCount: 0,
    replyCount: 0,
    leadCreatedCount: 0,
    durationSeconds: 486,
    activities: [],
    rawPayload: {},
    ...overrides
  };
}

describe("maybeRunAssistantApolloActivityRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T14:00:00.000Z"));
    requireModule.mockResolvedValue(undefined);
    integrationCredentialFindMany.mockResolvedValue([buildApolloCredential()]);
    contactCount.mockResolvedValue(0);
    contactFindMany.mockResolvedValue([]);
    fetchApolloActivitySummary.mockResolvedValue(buildActivitySummary());
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
    expect(fetchApolloActivitySummary).toHaveBeenCalledWith({
      apolloUserId: "apollo-user-1",
      userName: "Zalan Riaz",
      startDate: expect.any(Date),
      endDate: expect.any(Date),
      timezone: "America/Toronto",
      kinds: ["CALL", "CONNECTED_CALL"]
    });
    expect(result?.answer).toContain("Apollo activity for Zalan Riaz today");
    expect(result?.answer).toContain("Calls: 7.");
    expect(result?.sources[0]).toMatchObject({
      sourceKind: AssistantSourceKind.INTEGRATION,
      sourceId: "apollo:apollo-user-1:2026-06-26:2026-06-26",
      title: "Apollo activity for Zalan Riaz"
    });
  });

  it("answers tenant-wide activity questions when no rep name is present", async () => {
    const result = await maybeRunAssistantApolloActivityRequest(context, "how many calls were made today?");

    expect(fetchApolloActivitySummary).toHaveBeenCalledWith(
      expect.objectContaining({
        apolloUserId: null,
        userName: null
      })
    );
    expect(result?.answer).toContain("Apollo activity for All mapped Apollo reps today");
  });

  it("returns a setup answer when rep-specific Apollo mapping is missing", async () => {
    integrationCredentialFindMany.mockResolvedValue([]);

    const result = await maybeRunAssistantApolloActivityRequest(context, "how many calls by rep today?");

    expect(fetchApolloActivitySummary).not.toHaveBeenCalled();
    expect(result?.answer).toContain("once Apollo rep mapping is synced in Settings");
    expect(result?.metadata).toMatchObject({
      apolloActivityHandled: true,
      blocked: "missing-rep-mapping"
    });
  });

  it("surfaces Apollo lookup failures in the assistant answer", async () => {
    fetchApolloActivitySummary.mockRejectedValue(new Error("Apollo request failed with status 403."));

    const result = await maybeRunAssistantApolloActivityRequest(context, "how many calls did Zalan make today?");

    expect(result?.answer).toContain("Apollo activity lookup failed");
    expect(result?.answer).toContain("Apollo request failed with status 403.");
    expect(result?.metadata).toMatchObject({
      apolloActivityHandled: true,
      apolloActivityError: "Apollo request failed with status 403."
    });
  });

  it("answers replies, sent emails, connected calls, and new leads together", async () => {
    fetchApolloActivitySummary.mockResolvedValue(
      buildActivitySummary({
        userName: null,
        apolloUserId: null,
        counts: {
          CALL: 0,
          CONNECTED_CALL: 5,
          EMAIL_SENT: 22,
          REPLY: 4,
          LEAD_CREATED: 0,
          OTHER: 0
        },
        callCount: 5,
        connectedCount: 5,
        emailSentCount: 22,
        replyCount: 4
      })
    );
    contactCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    contactFindMany.mockResolvedValue([
      {
        fullName: "Jane Buyer",
        company: {
          name: "Acme Imports"
        }
      }
    ]);

    const result = await maybeRunAssistantApolloActivityRequest(
      context,
      "Apollo today how many replies, emails sent, new leads added, and connected calls?"
    );

    expect(result?.answer).toContain("Connected calls: 5.");
    expect(result?.answer).toContain("Emails sent: 22.");
    expect(result?.answer).toContain("Replies: 4.");
    expect(result?.answer).toContain("New Apollo leads/contacts added in Newl: 3.");
    expect(contactCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: ContactSource.APOLLO
        })
      })
    );
  });

  it("summarizes replied Apollo contacts into follow-up leads", async () => {
    contactFindMany.mockResolvedValue([
      {
        id: "contact-1",
        fullName: "Jane Buyer",
        title: "Logistics Manager",
        email: "jane@acme.com",
        contactScore: 82,
        contactTier: "TIER_1",
        replyStatus: ReplyStatus.POSITIVE,
        sequenceStatus: SequenceStatus.REPLIED,
        lastReplyAt: new Date("2026-06-20T12:00:00.000Z"),
        selectedSequenceName: "Tier 1",
        assignedRep: "Zalan Riaz",
        company: {
          id: "company-1",
          name: "Acme Imports",
          priorityScore: 77,
          domain: "acme.com"
        }
      }
    ]);

    const result = await maybeRunAssistantApolloActivityRequest(
      context,
      "summarize list of Apollo replies from last 40 days and determine good follow up leads"
    );

    expect(fetchApolloActivitySummary).not.toHaveBeenCalled();
    expect(result?.answer).toContain("Apollo replies for all Apollo reps in the last 40 days");
    expect(result?.answer).toContain("Acme Imports - Jane Buyer");
    expect(result?.answer).toContain("positive reply");
  });
});
