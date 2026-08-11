import { WebsiteGrowthOpportunityStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { resolveSeoRecoveryOpportunityStatus } from "@/modules/website-growth/evidence-refresh";
import { extractRedirects } from "@/modules/website-growth/newl-website-context-scanner";
import {
  buildWebsiteGrowthSearchConsoleComparisonWindows,
  buildWebsiteGrowthSeoRecoveryOpportunityCandidates,
  buildWebsiteGrowthSeoRecoverySnapshot
} from "@/modules/website-growth/seo-recovery";

const redirects = [
  { source: "/glossary/kitting-services-definition", destination: "/services/fulfillment-services" },
  { source: "/glossary/pick-and-pack-meaning", destination: "/services/fulfillment-services" }
];

describe("Website Growth SEO recovery", () => {
  it("uses complete non-overlapping 28-day periods with the Search Console reporting lag", () => {
    expect(buildWebsiteGrowthSearchConsoleComparisonWindows(new Date("2026-08-04T17:00:00.000Z"))).toEqual({
      current: { startDate: "2026-07-06", endDate: "2026-08-02" },
      previous: { startDate: "2026-06-08", endDate: "2026-07-05" }
    });
  });

  it("combines legacy URLs with their destination before classifying a commercial decline", () => {
    const snapshot = buildWebsiteGrowthSeoRecoverySnapshot({
      currentPeriod: { startDate: "2026-07-06", endDate: "2026-08-02" },
      previousPeriod: { startDate: "2026-06-08", endDate: "2026-07-05" },
      redirects,
      currentPageCountryRows: [
        pageCountry("https://www.newlgroup.com/glossary/kitting-services-definition/", "can", 0, 1_000, 12),
        pageCountry("https://www.newlgroup.com/services/fulfillment-services", "usa", 1, 3_000, 40)
      ],
      previousPageCountryRows: [
        pageCountry("https://www.newlgroup.com/glossary/kitting-services-definition/", "can", 3, 5_000, 12)
      ],
      currentQueryPageRows: [
        queryPage("kitting services", "https://www.newlgroup.com/services/fulfillment-services", 1, 1_500, 20)
      ],
      previousQueryPageRows: [
        queryPage("kitting services", "https://www.newlgroup.com/glossary/kitting-services-definition", 3, 3_700, 11)
      ]
    });

    const route = snapshot.candidates.find((candidate) => candidate.route === "/services/fulfillment-services");
    expect(route).toMatchObject({
      status: "NEEDS_RECOVERY",
      legacySources: ["/glossary/kitting-services-definition"]
    });
    expect(route?.current.impressions).toBe(4_000);
    expect(route?.previous.impressions).toBe(5_000);
    expect(route?.topQueries).toContain("kitting services");
    expect(snapshot.country.canada.current.impressions).toBe(1_000);
    expect(snapshot.country.unitedStates.current.impressions).toBe(3_000);
  });

  it("distinguishes a healthy migration transition and a newly improving destination", () => {
    const snapshot = buildWebsiteGrowthSeoRecoverySnapshot({
      currentPeriod: { startDate: "2026-07-06", endDate: "2026-08-02" },
      previousPeriod: { startDate: "2026-06-08", endDate: "2026-07-05" },
      redirects,
      currentPageCountryRows: [
        pageCountry("https://www.newlgroup.com/glossary/pick-and-pack-meaning/", "can", 1, 500, 20),
        pageCountry("https://www.newlgroup.com/services/fulfillment-services", "can", 3, 2_500, 20),
        pageCountry("https://www.newlgroup.com/locations/mississauga-warehousing", "can", 4, 500, 20)
      ],
      previousPageCountryRows: [
        pageCountry("https://www.newlgroup.com/glossary/pick-and-pack-meaning/", "can", 5, 3_000, 18)
      ],
      currentQueryPageRows: [],
      previousQueryPageRows: []
    });

    expect(snapshot.candidates.find((candidate) => candidate.route === "/services/fulfillment-services")?.status)
      .toBe("MIGRATION_TRANSITION");
    expect(snapshot.candidates.find((candidate) => candidate.route === "/locations/mississauga-warehousing")?.status)
      .toBe("IMPROVING");
  });

  it("does not flag a homepage decline when reported branded clicks remain stable", () => {
    const snapshot = buildWebsiteGrowthSeoRecoverySnapshot({
      currentPeriod: { startDate: "2026-07-06", endDate: "2026-08-02" },
      previousPeriod: { startDate: "2026-06-08", endDate: "2026-07-05" },
      redirects: [],
      currentPageCountryRows: [pageCountry("https://www.newlgroup.com/", "can", 80, 3_300, 8)],
      previousPageCountryRows: [pageCountry("https://www.newlgroup.com/", "can", 94, 4_100, 8)],
      currentQueryPageRows: [queryPage("newl group", "https://www.newlgroup.com/", 16, 44, 4)],
      previousQueryPageRows: [queryPage("newl group", "https://www.newlgroup.com/", 11, 40, 4)]
    });

    expect(snapshot.candidates.find((candidate) => candidate.route === "/")?.status).toBe("MONITOR");
  });

  it("creates bounded high-priority opportunities only for routes that need recovery", () => {
    const snapshot = buildWebsiteGrowthSeoRecoverySnapshot({
      currentPeriod: { startDate: "2026-07-06", endDate: "2026-08-02" },
      previousPeriod: { startDate: "2026-06-08", endDate: "2026-07-05" },
      redirects,
      currentPageCountryRows: [pageCountry("https://www.newlgroup.com/services/fulfillment-services", "can", 1, 2_000, 35)],
      previousPageCountryRows: [pageCountry("https://www.newlgroup.com/services/fulfillment-services", "can", 10, 3_000, 15)],
      currentQueryPageRows: [queryPage("kitting services", "https://www.newlgroup.com/services/fulfillment-services", 1, 1_000, 20)],
      previousQueryPageRows: [queryPage("kitting services", "https://www.newlgroup.com/services/fulfillment-services", 5, 2_000, 11)]
    });
    const opportunities = buildWebsiteGrowthSeoRecoveryOpportunityCandidates(snapshot);

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      targetPage: "https://www.newlgroup.com/services/fulfillment-services",
      score: 70,
      evidence: { seoRecovery: true, seoRecoveryStatus: "NEEDS_RECOVERY" }
    });
    expect(opportunities[0].recommendation).toContain("canonical");
  });

  it("extracts deterministic redirect mappings from the website configuration", () => {
    expect(extractRedirects(`
      redirect("/warehouse-services", "/services/warehousing-services"),
      redirect('/glossary/kitting-services-definition', '/services/fulfillment-services'),
    `)).toEqual([
      { source: "/warehouse-services", destination: "/services/warehousing-services" },
      { source: "/glossary/kitting-services-definition", destination: "/services/fulfillment-services" }
    ]);
  });

  it("moves stale recovery ideas to monitoring and reactivates them when evidence worsens", () => {
    expect(resolveSeoRecoveryOpportunityStatus({
      currentStatus: WebsiteGrowthOpportunityStatus.REVIEWING,
      actionable: false
    })).toBe(WebsiteGrowthOpportunityStatus.MONITORING);
    expect(resolveSeoRecoveryOpportunityStatus({
      currentStatus: WebsiteGrowthOpportunityStatus.MONITORING,
      actionable: true
    })).toBe(WebsiteGrowthOpportunityStatus.NEW);
    expect(resolveSeoRecoveryOpportunityStatus({
      currentStatus: WebsiteGrowthOpportunityStatus.REVIEWING,
      actionable: true
    })).toBeNull();
  });
});

function pageCountry(page: string, country: string, clicks: number, impressions: number, position: number) {
  return { keys: [page, country], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

function queryPage(query: string, page: string, clicks: number, impressions: number, position: number) {
  return { keys: [query, page], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}
