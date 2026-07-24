import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus,
  WebsiteGrowthOutreachConsentBasis
} from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSafeWebsiteGrowthOutreachCopy,
  buildCompliantWebsiteGrowthOutreachBody,
  isWebsiteGrowthOutreachOptOut,
  readWebsiteGrowthOutreachIdentity,
  validateWebsiteGrowthContactSource,
  validateWebsiteGrowthOutreachConsent
} from "@/modules/website-growth/backlink-outreach";
import {
  buildWebsiteGrowthBacklinkDedupeKey,
  buildWebsiteGrowthBacklinkTeamsLines,
  getWebsiteGrowthBacklinkQualificationFailure,
  parseWebsiteGrowthBacklinkReview,
  type WebsiteGrowthBacklinkProspect
} from "@/modules/website-growth/backlinks";
import {
  assertWebsiteGrowthBacklinkReportContainsNoSecrets,
  isWebsiteGrowthBacklinkExecutorClaimable
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
