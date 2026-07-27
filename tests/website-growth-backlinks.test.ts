import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus,
  WebsiteGrowthOutreachConsentBasis
} from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSafeWebsiteGrowthOutreachCopy,
  buildCompliantWebsiteGrowthOutreachBody,
  fetchWebsiteGrowthPublicContactEvidence,
  isWebsiteGrowthOutreachOptOut,
  isWebsiteGrowthOutreachReplyMatch,
  parseWebsiteGrowthOutreachRunStartedAt,
  readWebsiteGrowthOutreachIdentity,
  validateWebsiteGrowthContactSource,
  validateWebsiteGrowthOutreachConsent
} from "@/modules/website-growth/backlink-outreach";
import {
  describeWebsiteGrowthBacklinkBlocker
} from "@/modules/website-growth/backlink-blockers";
import {
  buildWebsiteGrowthBacklinkDedupeKey,
  buildWebsiteGrowthBacklinkTeamsLines,
  getWebsiteGrowthBacklinkQualificationFailure,
  parseWebsiteGrowthBacklinkReview,
  type WebsiteGrowthBacklinkProspect
} from "@/modules/website-growth/backlinks";
import {
  assertWebsiteGrowthBacklinkReportContainsNoSecrets,
  isWebsiteGrowthBacklinkExecutorClaimable,
  reportWebsiteGrowthBacklinkExecution
} from "@/modules/website-growth/backlink-executor";
import {
  authenticateWebsiteGrowthBacklinkExecutorRequest,
  WebsiteGrowthBacklinkExecutorAuthError
} from "@/server/website-growth-backlink-executor-auth";

const originalToken = process.env.OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN;
const originalTenant = process.env.OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG;

afterEach(() => {
  restoreEnv("OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN", originalToken);
  restoreEnv("OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG", originalTenant);
});

describe("Website Growth backlink curation", () => {
  it("parses the bounded structured Scout review", () => {
    const review = parseWebsiteGrowthBacklinkReview({
      queried: true,
      source: "LIVE_MCP",
      observedAt: "2026-07-24T15:00:00.000Z",
      summary: "Three strong logistics prospects remained after review.",
      rawProspectsReviewed: 87,
      duplicatesRejected: 21,
      qualityRejected: 63,
      prospects: [buildProspect()]
    });

    expect(review.rawProspectsReviewed).toBe(87);
    expect(review.prospects).toHaveLength(1);
    expect(review.prospects[0]).toMatchObject({
      sourceDomain: "example.org",
      targetPage: "/services/fulfillment-services",
      category: WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION
    });
  });

  it("refuses an oversized raw-style prospect list", () => {
    expect(() => parseWebsiteGrowthBacklinkReview({
      queried: true,
      source: "LIVE_MCP",
      observedAt: "2026-07-24T15:00:00.000Z",
      summary: "Too many rows",
      rawProspectsReviewed: 16,
      duplicatesRejected: 0,
      qualityRejected: 0,
      prospects: Array.from({ length: 16 }, () => buildProspect())
    })).toThrow("at most 15");
  });

  it("deduplicates hostname variants and target URL variants", () => {
    const left = buildWebsiteGrowthBacklinkDedupeKey({
      sourceDomain: "https://www.Example.org/",
      targetPage: "https://www.newlgroup.com/services/fulfillment-services/"
    });
    const right = buildWebsiteGrowthBacklinkDedupeKey({
      sourceDomain: "example.org",
      targetPage: "/services/fulfillment-services"
    });

    expect(left).toBe(right);
  });

  it("rejects self-links, weak prospects, and high spam risk", () => {
    expect(getWebsiteGrowthBacklinkQualificationFailure(buildProspect({
      sourceDomain: "www.newlgroup.com"
    }))).toContain("own referring domain");
    expect(getWebsiteGrowthBacklinkQualificationFailure(buildProspect({
      relevanceScore: 59
    }))).toContain("Relevance");
    expect(getWebsiteGrowthBacklinkQualificationFailure(buildProspect({
      spamRisk: "HIGH"
    }))).toContain("High-spam-risk");
  });

  it("builds a zero-opportunity Teams result instead of staying silent", () => {
    const lines = buildWebsiteGrowthBacklinkTeamsLines({
      review: {
        queried: true,
        source: "LIVE_MCP",
        observedAt: "2026-07-24T15:00:00.000Z",
        summary: "No prospects met the quality threshold.",
        rawProspectsReviewed: 42,
        duplicatesRejected: 12,
        qualityRejected: 30,
        prospects: []
      },
      persisted: {
        rawProspectsReviewed: 42,
        suppliedByScout: 0,
        created: 0,
        refreshed: 0,
        skippedByQualityGate: 0,
        skippedExistingDecision: 0,
        archivedAsStale: 0,
        activeQueueCount: 0
      },
      reviewBaseUrl: "https://apps.newlgroup.com/"
    });

    expect(lines).toContain("42 prospects reviewed");
    expect(lines).toContain("No new backlink decision is required this week.");
  });

  it("keeps paid placements outside the automated executor", () => {
    expect(isWebsiteGrowthBacklinkExecutorClaimable({
      status: WebsiteGrowthBacklinkStatus.APPROVED,
      category: WebsiteGrowthBacklinkCategory.PAID_PLACEMENT
    })).toBe(false);
    expect(isWebsiteGrowthBacklinkExecutorClaimable({
      status: WebsiteGrowthBacklinkStatus.APPROVED,
      category: WebsiteGrowthBacklinkCategory.LINK_RECLAMATION
    })).toBe(true);
  });

  it("refuses credentials in execution reports", () => {
    expect(() => assertWebsiteGrowthBacklinkReportContainsNoSecrets([
      "Directory profile submitted; username is partnerships@example.com."
    ])).not.toThrow();
    expect(() => assertWebsiteGrowthBacklinkReportContainsNoSecrets([
      "Temporary password: unsafe-value"
    ])).toThrow("cannot contain passwords");
    expect(() => assertWebsiteGrowthBacklinkReportContainsNoSecrets([
      "https://publisher.example/login?access_token=unsafe-value"
    ])).toThrow("cannot contain passwords");
  });

  it("requires a specific reason whenever Scout reports a block", async () => {
    await expect(reportWebsiteGrowthBacklinkExecution({
      tenantId: "tenant-1",
      opportunityId: "opportunity-1",
      status: WebsiteGrowthBacklinkStatus.BLOCKED,
      notes: " "
    })).rejects.toThrow("specific blocker reason");
  });
});

describe("Website Growth backlink blocker guidance", () => {
  it.each([
    {
      notes: "The directory requires CAPTCHA and phone verification.",
      category: "MANUAL_SETUP",
      retryWillHelpNow: false
    },
    {
      notes: "No publicly displayed business email or submission method was found.",
      category: "NO_CONTACT_METHOD",
      retryWillHelpNow: false
    },
    {
      notes: "The publisher requires unusual terms and owner confirmation.",
      category: "NEEDS_OWNER_CONFIRMATION",
      retryWillHelpNow: false
    },
    {
      notes: "Microsoft Graph permission check failed before delivery.",
      category: "TECHNICAL",
      retryWillHelpNow: true
    }
  ])("classifies $category blockers and gives retry guidance", ({
    notes,
    category,
    retryWillHelpNow
  }) => {
    const blocker = describeWebsiteGrowthBacklinkBlocker({
      status: WebsiteGrowthBacklinkStatus.BLOCKED,
      category: WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION,
      notes,
      submittedAt: null,
      contactedAt: null,
      directoryLoginUrl: null
    });

    expect(blocker).toMatchObject({
      category,
      reason: notes,
      retryWillHelpNow
    });
    expect(blocker?.nextAction).toBeTruthy();
    expect(blocker?.retryGuidance).toBeTruthy();
  });

  it("blocks automatic retry guidance when external history exists", () => {
    const blocker = describeWebsiteGrowthBacklinkBlocker({
      status: WebsiteGrowthBacklinkStatus.BLOCKED,
      category: WebsiteGrowthBacklinkCategory.CONTENT_CONTRIBUTION,
      notes: "Microsoft Graph did not confirm the response.",
      submittedAt: null,
      contactedAt: new Date("2026-07-27T12:00:00.000Z"),
      directoryLoginUrl: null
    });

    expect(blocker?.retryWillHelpNow).toBe(false);
    expect(blocker?.retryGuidance).toContain("Do not retry automatically");
  });

  it("accepts a recent run start time with a bounded legacy fallback", () => {
    const now = new Date("2026-07-27T16:00:00.000Z");
    expect(parseWebsiteGrowthOutreachRunStartedAt({
      value: "2026-07-27T15:55:00.000Z",
      now
    })).toEqual(new Date("2026-07-27T15:55:00.000Z"));
    expect(() => parseWebsiteGrowthOutreachRunStartedAt({
      value: "2026-07-25T15:55:00.000Z",
      now
    })).toThrow("last 24 hours");
    expect(parseWebsiteGrowthOutreachRunStartedAt({
      value: null,
      now
    })).toEqual(new Date("2026-07-27T14:00:00.000Z"));
  });
});

describe("Website Growth backlink executor authentication", () => {
  it("uses a token separate from the read-only Scout token", () => {
    process.env.OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN = "backlink-secret";
    process.env.OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG = "newl";
    const result = authenticateWebsiteGrowthBacklinkExecutorRequest(new Request("https://apps.example/api", {
      headers: { authorization: "Bearer backlink-secret" }
    }));

    expect(result).toEqual({ tenantSlug: "newl" });
  });

  it("rejects a missing or incorrect executor token", () => {
    process.env.OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN = "backlink-secret";
    process.env.OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG = "newl";

    expect(() => authenticateWebsiteGrowthBacklinkExecutorRequest(new Request("https://apps.example/api")))
      .toThrow(WebsiteGrowthBacklinkExecutorAuthError);
  });
});

describe("Website Growth backlink outreach compliance", () => {
  const identity = {
    mailbox: "partnerships@example.com",
    senderName: "Partnerships",
    publicBrandName: "Example Logistics",
    publicPhone: "555-0100",
    website: "https://example.com/",
    canadianLegalName: "Example Logistics Canada Ltd.",
    canadianAddress: "100 Example Road, Toronto, ON A1A 1A1",
    usLegalName: "Example Logistics USA Inc.",
    usAddress: "200 Example Road, Charlotte, NC 28273"
  };

  it("adds the country-specific legal identity, physical address, and opt-out text", () => {
    const canadian = buildCompliantWebsiteGrowthOutreachBody({
      body: "Would your directory consider our public company profile?",
      country: "CA",
      identity
    });
    const american = buildCompliantWebsiteGrowthOutreachBody({
      body: "Would your directory consider our public company profile?",
      country: "US",
      identity
    });

    expect(canadian).toContain(identity.canadianLegalName);
    expect(canadian).toContain(identity.canadianAddress);
    expect(canadian).not.toContain(identity.usAddress);
    expect(american).toContain(identity.usLegalName);
    expect(american).toContain(identity.usAddress);
    expect(american).toContain("reply “unsubscribe”");
  });

  it("requires a CASL-compatible basis for Canadian outreach", () => {
    expect(() => validateWebsiteGrowthOutreachConsent({
      recipientCountry: "CA",
      consentBasis: WebsiteGrowthOutreachConsentBasis.US_BUSINESS_OUTREACH,
      contactSourceUrl: "https://publisher.example/contact"
    })).toThrow("CASL-compatible");

    expect(() => validateWebsiteGrowthOutreachConsent({
      recipientCountry: "CA",
      consentBasis: WebsiteGrowthOutreachConsentBasis.CONSPICUOUSLY_PUBLISHED_BUSINESS,
      contactSourceUrl: "https://publisher.example/contact"
    })).not.toThrow();
  });

  it("rejects private or local contact-source URLs", () => {
    expect(() => validateWebsiteGrowthOutreachConsent({
      recipientCountry: "US",
      consentBasis: WebsiteGrowthOutreachConsentBasis.US_BUSINESS_OUTREACH,
      contactSourceUrl: "http://localhost/contact"
    })).toThrow("local host");
  });

  it("recognizes common opt-out language", () => {
    expect(isWebsiteGrowthOutreachOptOut("Please remove me from this list.")).toBe(true);
    expect(isWebsiteGrowthOutreachOptOut("Thanks, please send the details.")).toBe(false);
  });

  it("matches replies by conversation ID or normalized thread subject", () => {
    const contactedAt = new Date("2026-07-25T12:00:00.000Z");
    const outboundMessages = [{
      conversationId: "conversation-1",
      subject: "Briefing idea: coordinating Canada-U.S. warehouse inventory",
      sentAt: contactedAt
    }];

    expect(isWebsiteGrowthOutreachReplyMatch({
      recipientEmail: "editor@publisher.example",
      contactedAt,
      outboundMessages,
      inboundMessage: {
        id: "reply-by-conversation",
        conversationId: "conversation-1",
        subject: "A rewritten subject",
        receivedDateTime: "2026-07-25T13:00:00.000Z",
        from: {
          emailAddress: {
            address: "editor@publisher.example"
          }
        }
      }
    })).toBe(true);
    expect(isWebsiteGrowthOutreachReplyMatch({
      recipientEmail: "editor@publisher.example",
      contactedAt,
      outboundMessages: outboundMessages.map((message) => ({
        ...message,
        conversationId: null
      })),
      inboundMessage: {
        id: "reply-1",
        subject: "RE: Briefing idea: coordinating Canada-U.S. warehouse inventory",
        receivedDateTime: "2026-07-25T13:00:00.000Z",
        from: {
          emailAddress: {
            address: "editor@publisher.example"
          }
        }
      }
    })).toBe(true);
    expect(isWebsiteGrowthOutreachReplyMatch({
      recipientEmail: "editor@publisher.example",
      contactedAt,
      outboundMessages,
      inboundMessage: {
        id: "unrelated-1",
        subject: "A different topic",
        receivedDateTime: "2026-07-25T13:00:00.000Z",
        from: {
          emailAddress: {
            address: "editor@publisher.example"
          }
        }
      }
    })).toBe(false);
    expect(isWebsiteGrowthOutreachReplyMatch({
      recipientEmail: "editor@publisher.example",
      contactedAt,
      outboundMessages,
      inboundMessage: {
        id: "sender-fallback-1",
        subject: "A different topic",
        receivedDateTime: "2026-07-25T13:00:00.000Z",
        from: {
          emailAddress: {
            address: "editor@publisher.example"
          }
        }
      },
      allowSenderOnlyFallback: true
    })).toBe(true);
    expect(isWebsiteGrowthOutreachReplyMatch({
      recipientEmail: "editor@publisher.example",
      contactedAt,
      outboundMessages,
      inboundMessage: {
        id: "wrong-sender-1",
        subject: "A different topic",
        receivedDateTime: "2026-07-25T13:00:00.000Z",
        from: {
          emailAddress: {
            address: "someone-else@publisher.example"
          }
        }
      },
      allowSenderOnlyFallback: true
    })).toBe(false);
  });

  it("allows only a business contact on the approved referring domain", () => {
    expect(() => validateWebsiteGrowthContactSource({
      sourceDomain: "publisher.example",
      sourceUrl: "https://www.publisher.example/resources",
      contactPage: "https://publisher.example/contact",
      contactSourceUrl: "https://publisher.example/contact",
      recipientEmail: "editor@publisher.example"
    })).not.toThrow();
    expect(() => validateWebsiteGrowthContactSource({
      sourceDomain: "publisher.example",
      contactSourceUrl: "https://unrelated.example/contact",
      recipientEmail: "editor@unrelated.example"
    })).toThrow("human-approved referring organization");
    expect(() => validateWebsiteGrowthContactSource({
      sourceDomain: "publisher.example",
      contactSourceUrl: "https://publisher.example/contact",
      recipientEmail: "publisher@gmail.com"
    })).toThrow("public business email");
  });

  it("allows a publisher-network email only when the exact address is public on the approved site", () => {
    expect(() => validateWebsiteGrowthContactSource({
      sourceDomain: "publication.example",
      contactSourceUrl: "https://publication.example/editors/max",
      recipientEmail: "max@publisher-network.example",
      publicContactEvidence:
        '<a href="mailto:max@publisher-network.example">Email Max</a>'
    })).not.toThrow();
    expect(() => validateWebsiteGrowthContactSource({
      sourceDomain: "supplychaindive.com",
      contactSourceUrl: "https://www.supplychaindive.com/editors/max",
      recipientEmail: "max@industrydive.com",
      publicContactEvidence:
        '<span class="__cf_email__" data-cfemail="6a070b122a03040e1f191e18130e031c0f44090507">[email protected]</span>'
    })).not.toThrow();
    expect(() => validateWebsiteGrowthContactSource({
      sourceDomain: "publication.example",
      contactSourceUrl: "https://publication.example/editors/max",
      recipientEmail: "other@publisher-network.example",
      publicContactEvidence:
        '<a href="mailto:max@publisher-network.example">Email Max</a>'
    })).toThrow("exact public business email");
  });

  it("fetches bounded public contact evidence without following redirects or private hosts", async () => {
    const resolveHostname = vi.fn().mockResolvedValue([
      { address: "203.0.114.10", family: 4 }
    ]);
    const fetcher = vi.fn().mockResolvedValue(
      new Response("editor@publisher-network.example", {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    );
    await expect(fetchWebsiteGrowthPublicContactEvidence(
      "https://publication.example/contact",
      { fetcher, resolveHostname }
    )).resolves.toContain("editor@publisher-network.example");
    expect(fetcher).toHaveBeenCalledWith(
      "https://publication.example/contact",
      expect.objectContaining({ redirect: "manual" })
    );

    await expect(fetchWebsiteGrowthPublicContactEvidence(
      "https://publication.example/contact",
      {
        fetcher,
        resolveHostname: vi.fn().mockResolvedValue([
          { address: "127.0.0.1", family: 4 }
        ])
      }
    )).rejects.toThrow("did not resolve publicly");
  });

  it("blocks customer proof and unbounded claims from outreach copy", () => {
    expect(() => assertSafeWebsiteGrowthOutreachCopy(
      "We would like to suggest a practical warehousing resource."
    )).not.toThrow();
    expect(() => assertSafeWebsiteGrowthOutreachCopy(
      "Our customer names include several national brands."
    )).toThrow("cannot mention customers");
    expect(() => assertSafeWebsiteGrowthOutreachCopy(
      "We are the best and guarantee every result."
    )).toThrow("cannot mention customers");
  });

  it("refuses to start without the complete protected public identity", () => {
    expect(() => readWebsiteGrowthOutreachIdentity({
      NODE_ENV: "test"
    })).toThrow("WEBSITE_GROWTH_OUTREACH_MAILBOX");

    expect(readWebsiteGrowthOutreachIdentity({
      NODE_ENV: "test",
      WEBSITE_GROWTH_OUTREACH_MAILBOX: identity.mailbox,
      WEBSITE_GROWTH_OUTREACH_SENDER_NAME: identity.senderName,
      WEBSITE_GROWTH_OUTREACH_PUBLIC_BRAND: identity.publicBrandName,
      WEBSITE_GROWTH_OUTREACH_PUBLIC_PHONE: identity.publicPhone,
      WEBSITE_GROWTH_OUTREACH_WEBSITE: identity.website,
      WEBSITE_GROWTH_OUTREACH_CANADA_LEGAL_NAME: identity.canadianLegalName,
      WEBSITE_GROWTH_OUTREACH_CANADA_ADDRESS: identity.canadianAddress,
      WEBSITE_GROWTH_OUTREACH_US_LEGAL_NAME: identity.usLegalName,
      WEBSITE_GROWTH_OUTREACH_US_ADDRESS: identity.usAddress
    })).toEqual(identity);
  });
});

function buildProspect(overrides: Partial<WebsiteGrowthBacklinkProspect> = {}) {
  return {
    sourceDomain: "example.org",
    sourceUrl: "https://example.org/logistics-resources",
    contactPage: "https://example.org/contact",
    targetPage: "/services/fulfillment-services",
    category: WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION,
    title: "Relevant logistics resource",
    rationale: "The site lists North American logistics providers.",
    outreachAngle: "Submit Newl's approved public business profile.",
    authorityScore: 55,
    relevanceScore: 84,
    qualityScore: 80,
    spamRisk: "LOW" as const,
    estimatedCostAmount: null,
    currency: null,
    requiresContent: false,
    evidence: ["Competitors are listed and Newl is absent."],
    ...overrides
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
