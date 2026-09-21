import {
  JobStatus,
  Prisma,
  WebsiteInboundAttributionChannel,
  WebsiteInboundStatus,
  WebsitePaidCampaignSignalType
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildPaidWeeklyReview,
  evaluatePaidHealth,
  paidScoutThresholds,
  type PaidLeadEvidence
} from "@/modules/website-growth/paid-scout";

const now = new Date("2026-09-21T12:00:00Z");
const lead = (overrides: Partial<PaidLeadEvidence> = {}): PaidLeadEvidence => ({
  status: WebsiteInboundStatus.NEW,
  submittedAt: now,
  createdAt: now,
  attributionChannel: WebsiteInboundAttributionChannel.PAID_SEARCH,
  utmSource: "google",
  utmCampaign: "synthetic-search",
  utmTerm: "warehouse",
  campaignId: "campaign-1",
  landingPage: "https://www.newlgroup.com/services/warehousing",
  landingPath: "/services/warehousing",
  pageUrl: "https://www.newlgroup.com/contact",
  attributionLocation: "Toronto, Ontario",
  device: "mobile",
  gclid: "click-1",
  gbraid: null,
  wbraid: null,
  isTest: false,
  marketingExcludedReason: null,
  ...overrides
});

describe("paid campaign Scout", () => {
  it("uses bounded configurable thresholds", () => {
    expect(paidScoutThresholds({
      PAID_SCOUT_MIN_BASELINE_LEADS: "9",
      PAID_SCOUT_LOW_QUALIFIED_RATE: "2",
      PAID_SCOUT_DAILY_BUDGET: "500"
    })).toMatchObject({ minimumBaselineLeads: 9, lowQualifiedRate: 1, dailyBudget: 500 });
  });

  it("does not react to an insignificant empty sample", () => {
    const thresholds = paidScoutThresholds({});
    expect(evaluatePaidHealth({
      recentForms: [],
      baselineForms: [lead()],
      recentPaid: [],
      baselinePaid: [lead()],
      inconsistentTests: [],
      latestSyncStatus: null,
      recentCost: [],
      thresholds
    })).toEqual([]);
  });

  it("generates tracking, sync, test, pacing and wasted-spend signals from aggregate evidence", () => {
    const thresholds = { ...paidScoutThresholds({}), dailyBudget: 100, wastedSpendAmount: 200 };
    const baselinePaid = [lead(), lead(), lead()];
    const recentPaid = [lead({ campaignId: null, utmCampaign: null, gclid: null })];
    const signals = evaluatePaidHealth({
      recentForms: recentPaid,
      baselineForms: baselinePaid,
      recentPaid,
      baselinePaid,
      inconsistentTests: [lead({ isTest: true, status: WebsiteInboundStatus.NEW })],
      latestSyncStatus: JobStatus.ERROR,
      recentCost: [{ campaignId: "campaign-1", campaignName: "Synthetic", keyword: null, searchTerm: null, device: null, location: null, cost: new Prisma.Decimal(250), currency: "CAD", impressions: 1000, clicks: 50 }],
      thresholds
    });
    expect(signals.map((signal) => signal.type)).toEqual(expect.arrayContaining([
      WebsitePaidCampaignSignalType.PAID_TRACKING_ISSUE,
      WebsitePaidCampaignSignalType.PAID_SYNC_FAILURE,
      WebsitePaidCampaignSignalType.BUDGET_PACING
    ]));
    expect(signals.find((signal) => signal.dedupeKey === "health:missing-campaign-attribution")).toBeTruthy();
    expect(signals.find((signal) => signal.dedupeKey === "health:test-exclusion-drift")).toBeTruthy();
  });

  it("alerts when genuine forms stop after a meaningful baseline", () => {
    const baselineForms = [lead(), lead(), lead()];
    const signals = evaluatePaidHealth({
      recentForms: [],
      baselineForms,
      recentPaid: [],
      baselinePaid: baselineForms,
      inconsistentTests: [],
      latestSyncStatus: null,
      recentCost: [],
      thresholds: paidScoutThresholds({})
    });
    expect(signals.filter((signal) => signal.dedupeKey.includes("stopped"))).toMatchObject([
      { dedupeKey: "health:forms-stopped", type: WebsitePaidCampaignSignalType.PAID_TRACKING_ISSUE }
    ]);
  });

  it("keeps spend metrics unavailable and avoids a budget-change recommendation without cost data", () => {
    const review = buildPaidWeeklyReview({
      leads: [lead({ status: WebsiteInboundStatus.QUALIFIED })],
      costs: [],
      openSignals: [],
      thresholds: paidScoutThresholds({}),
      from: "2026-09-15",
      to: "2026-09-21"
    });
    expect(review.costMetrics).toBeNull();
    expect(review.recommendation).toBe("MAINTAIN");
    expect(review.recommendationReason).toContain("Cost data is not connected");
    expect(review.humanApprovalRequired).toBe(true);
  });

  it("does not combine incomplete or mixed-currency cost evidence", () => {
    const costs = [
      { campaignId: "campaign-1", campaignName: "Synthetic", keyword: null, searchTerm: "mixed term", device: null, location: null, cost: new Prisma.Decimal(400), currency: "CAD", impressions: 100, clicks: 10 },
      { campaignId: "campaign-2", campaignName: "Synthetic 2", keyword: null, searchTerm: "mixed term", device: null, location: null, cost: new Prisma.Decimal(400), currency: "USD", impressions: 100, clicks: 10 }
    ];
    const thresholds = { ...paidScoutThresholds({}), dailyBudget: 100 };
    const signals = evaluatePaidHealth({
      recentForms: [],
      baselineForms: [],
      recentPaid: [],
      baselinePaid: [],
      inconsistentTests: [],
      latestSyncStatus: null,
      recentCost: costs,
      thresholds
    });
    expect(signals.some((signal) => ["WASTED_SPEND", "BUDGET_PACING"].includes(signal.type))).toBe(false);
    const review = buildPaidWeeklyReview({
      leads: [],
      costs,
      openSignals: [],
      thresholds,
      from: "2026-09-15",
      to: "2026-09-21"
    });
    expect(review.costMetrics).toBeNull();
    expect(review.negativeKeywordOpportunities).toEqual([]);
  });

  it("recommends investigation when attribution is incomplete", () => {
    const review = buildPaidWeeklyReview({
      leads: [lead({ campaignId: null, utmCampaign: null }), lead({ campaignId: null, utmCampaign: null })],
      costs: [],
      openSignals: [],
      thresholds: paidScoutThresholds({}),
      from: "2026-09-15",
      to: "2026-09-21"
    });
    expect(review.recommendation).toBe("INVESTIGATE");
    expect(review.attribution.partialOrUnavailable).toBe(2);
  });

  it("surfaces search-term and negative-keyword evidence only when synchronized cost rows exist", () => {
    const review = buildPaidWeeklyReview({
      leads: [lead({ utmTerm: "warehouse" })],
      costs: [{ campaignId: "campaign-1", campaignName: "Synthetic", keyword: "warehouse", searchTerm: "free storage jobs", device: "desktop", location: "Toronto", cost: new Prisma.Decimal(300), currency: "CAD", impressions: 1000, clicks: 20 }],
      openSignals: [],
      thresholds: { ...paidScoutThresholds({}), wastedSpendAmount: 250 },
      from: "2026-09-15",
      to: "2026-09-21"
    });
    expect(review.searchTermQuality.status).toBe("AVAILABLE");
    expect(review.negativeKeywordOpportunities).toMatchObject([
      { searchTerm: "free storage jobs", cost: 300, currency: "CAD", hasAttributedLead: false }
    ]);
  });
});
