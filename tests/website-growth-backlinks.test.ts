import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus
} from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildWebsiteGrowthBacklinkDedupeKey,
  buildWebsiteGrowthBacklinkTeamsLines,
  getWebsiteGrowthBacklinkQualificationFailure,
  parseWebsiteGrowthBacklinkReview,
  type WebsiteGrowthBacklinkProspect
} from "@/modules/website-growth/backlinks";
import { isWebsiteGrowthBacklinkExecutorClaimable } from "@/modules/website-growth/backlink-executor";
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
