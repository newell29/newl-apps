import {
  JobStatus,
  WebsiteInboundAttributionChannel,
  WebsiteInboundStatus,
  WebsitePaidCampaignSignalStatus,
  WebsitePaidCampaignSignalType,
  Prisma
} from "@prisma/client";

import { attributionCompleteness, hasPaidClickId } from "@/modules/website-inbound/attribution";
import { calculatePaidFunnel, groupPaidRows } from "@/modules/website-growth/paid-campaigns";
import { prisma } from "@/server/db";

export const PAID_HEALTH_JOB = "WEBSITE_GROWTH_PAID_HEALTH";
export const PAID_WEEKLY_REVIEW_JOB = "WEBSITE_GROWTH_PAID_WEEKLY_REVIEW";
export const GOOGLE_ADS_SYNC_JOB = "WEBSITE_GROWTH_GOOGLE_ADS_SYNC";

export type PaidScoutThresholds = {
  stopWindowHours: number;
  baselineDays: number;
  minimumBaselineLeads: number;
  minimumRecentPaidLeadsForClickIdCheck: number;
  missingCampaignAlertCount: number;
  minimumLandingPageLeads: number;
  lowQualifiedRate: number;
  scaleQualifiedRate: number;
  wastedSpendAmount: number;
  dailyBudget: number | null;
  pacingRatio: number;
};

export type PaidLeadEvidence = {
  id?: string;
  status: WebsiteInboundStatus;
  submittedAt: Date | null;
  createdAt: Date;
  attributionChannel: WebsiteInboundAttributionChannel;
  utmSource: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  campaignId: string | null;
  landingPage: string | null;
  landingPath: string | null;
  pageUrl: string | null;
  attributionLocation: string | null;
  device: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  isTest: boolean;
  marketingExcludedReason: string | null;
};

export type PaidCostEvidence = {
  campaignId: string | null;
  campaignName: string | null;
  keyword: string | null;
  searchTerm: string | null;
  device: string | null;
  location: string | null;
  cost: Prisma.Decimal | null;
  currency: string | null;
  impressions: number;
  clicks: number;
};

export type ProposedPaidSignal = {
  dedupeKey: string;
  type: WebsitePaidCampaignSignalType;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
};

export function paidScoutThresholds(
  env: Record<string, string | undefined> = process.env
): PaidScoutThresholds {
  return {
    stopWindowHours: boundedNumber(env.PAID_SCOUT_STOP_WINDOW_HOURS, 24, 1, 168),
    baselineDays: boundedNumber(env.PAID_SCOUT_BASELINE_DAYS, 7, 2, 90),
    minimumBaselineLeads: boundedNumber(env.PAID_SCOUT_MIN_BASELINE_LEADS, 3, 1, 1_000),
    minimumRecentPaidLeadsForClickIdCheck: boundedNumber(
      env.PAID_SCOUT_MIN_CLICK_ID_SAMPLE,
      3,
      1,
      1_000
    ),
    missingCampaignAlertCount: boundedNumber(
      env.PAID_SCOUT_MISSING_CAMPAIGN_ALERT_COUNT,
      1,
      1,
      1_000
    ),
    minimumLandingPageLeads: boundedNumber(env.PAID_SCOUT_MIN_LANDING_LEADS, 5, 2, 10_000),
    lowQualifiedRate: boundedNumber(env.PAID_SCOUT_LOW_QUALIFIED_RATE, 0.1, 0, 1),
    scaleQualifiedRate: boundedNumber(env.PAID_SCOUT_SCALE_QUALIFIED_RATE, 0.4, 0, 1),
    wastedSpendAmount: boundedNumber(env.PAID_SCOUT_WASTED_SPEND_AMOUNT, 250, 0, 1_000_000),
    dailyBudget: optionalNumber(env.PAID_SCOUT_DAILY_BUDGET, 0, 1_000_000),
    pacingRatio: boundedNumber(env.PAID_SCOUT_PACING_RATIO, 1.2, 0.1, 10)
  };
}

export function evaluatePaidHealth(input: {
  recentForms: PaidLeadEvidence[];
  baselineForms: PaidLeadEvidence[];
  recentPaid: PaidLeadEvidence[];
  baselinePaid: PaidLeadEvidence[];
  inconsistentTests: PaidLeadEvidence[];
  latestSyncStatus: JobStatus | null;
  recentCost: PaidCostEvidence[];
  thresholds: PaidScoutThresholds;
}) {
  const { thresholds } = input;
  const signals: ProposedPaidSignal[] = [];

  if (
    input.baselineForms.length >= thresholds.minimumBaselineLeads &&
    input.recentForms.length === 0
  ) {
    signals.push({
      dedupeKey: "health:forms-stopped",
      type: WebsitePaidCampaignSignalType.PAID_TRACKING_ISSUE,
      title: "Website form submissions stopped",
      detail: `No genuine website submissions arrived in the last ${thresholds.stopWindowHours} hours after ${input.baselineForms.length} in the baseline window.`,
      evidence: {
        recentForms: 0,
        baselineForms: input.baselineForms.length,
        stopWindowHours: thresholds.stopWindowHours,
        baselineDays: thresholds.baselineDays
      }
    });
  }

  if (
    input.baselinePaid.length >= thresholds.minimumBaselineLeads &&
    input.recentPaid.length === 0 &&
    input.recentForms.length > 0
  ) {
    signals.push({
      dedupeKey: "health:paid-leads-stopped",
      type: WebsitePaidCampaignSignalType.PAID_TRACKING_ISSUE,
      title: "Paid form submissions stopped",
      detail: `No paid-search submissions arrived in the last ${thresholds.stopWindowHours} hours after ${input.baselinePaid.length} in the baseline window.`,
      evidence: {
        recentPaidLeads: 0,
        baselinePaidLeads: input.baselinePaid.length,
        stopWindowHours: thresholds.stopWindowHours,
        baselineDays: thresholds.baselineDays
      }
    });
  }

  const missingCampaign = input.recentPaid.filter(
    (row) => !row.campaignId && !row.utmCampaign
  ).length;
  if (missingCampaign >= thresholds.missingCampaignAlertCount) {
    signals.push({
      dedupeKey: "health:missing-campaign-attribution",
      type: WebsitePaidCampaignSignalType.PAID_TRACKING_ISSUE,
      title: "Paid leads are missing campaign attribution",
      detail: `${missingCampaign} recent paid-search submission${missingCampaign === 1 ? "" : "s"} had neither campaignId nor utmCampaign.`,
      evidence: { missingCampaign, recentPaidLeads: input.recentPaid.length }
    });
  }

  const baselineClickIds = input.baselinePaid.filter(hasPaidClickId).length;
  const recentClickIds = input.recentPaid.filter(hasPaidClickId).length;
  if (
    baselineClickIds >= thresholds.minimumRecentPaidLeadsForClickIdCheck &&
    input.recentPaid.length >= thresholds.minimumRecentPaidLeadsForClickIdCheck &&
    recentClickIds === 0
  ) {
    signals.push({
      dedupeKey: "health:click-id-capture-stopped",
      type: WebsitePaidCampaignSignalType.PAID_TRACKING_ISSUE,
      title: "Google Ads click ID capture stopped",
      detail: `Recent paid submissions contain no GCLID, GBRAID, or WBRAID although ${baselineClickIds} baseline submissions did.`,
      evidence: {
        recentPaidLeads: input.recentPaid.length,
        recentClickIds,
        baselineClickIds
      }
    });
  }

  if (input.inconsistentTests.length) {
    signals.push({
      dedupeKey: "health:test-exclusion-drift",
      type: WebsitePaidCampaignSignalType.PAID_TRACKING_ISSUE,
      title: "Test exclusion needs review",
      detail: `${input.inconsistentTests.length} recent internal/test submission${input.inconsistentTests.length === 1 ? " is" : "s are"} not consistently marked with the Test workflow status.`,
      evidence: { inconsistentTestRecords: input.inconsistentTests.length }
    });
  }

  if (input.latestSyncStatus === JobStatus.ERROR) {
    signals.push({
      dedupeKey: "health:google-ads-sync-failure",
      type: WebsitePaidCampaignSignalType.PAID_SYNC_FAILURE,
      title: "Google Ads synchronization failed",
      detail: "The latest configured Google Ads synchronization job failed. Lead reporting remains available without cost data.",
      evidence: { latestSyncStatus: input.latestSyncStatus }
    });
  }

  const costRows = input.recentCost.filter((row) => row.cost !== null);
  const currencies = [...new Set(costRows.map((row) => row.currency).filter(Boolean))];
  const costComparable =
    costRows.length > 0 &&
    currencies.length === 1 &&
    costRows.every((row) => row.currency === currencies[0]);
  const spend = costComparable
    ? costRows.reduce((sum, row) => sum + Number(row.cost), 0)
    : 0;
  if (costComparable && spend >= thresholds.wastedSpendAmount && input.recentPaid.length === 0) {
    signals.push({
      dedupeKey: "health:spend-without-leads",
      type: WebsitePaidCampaignSignalType.WASTED_SPEND,
      title: "Paid spend has no attributed leads",
      detail: "Connected cost data crossed the configured wasted-spend threshold without an attributed paid lead in the same health window.",
      evidence: {
        spend,
        threshold: thresholds.wastedSpendAmount,
        recentPaidLeads: 0,
        currency: currencies[0]
      }
    });
  }

  if (
    thresholds.dailyBudget !== null &&
    costComparable &&
    spend > thresholds.dailyBudget * thresholds.pacingRatio
  ) {
    signals.push({
      dedupeKey: "health:budget-pacing",
      type: WebsitePaidCampaignSignalType.BUDGET_PACING,
      title: "Spend is pacing above the configured budget",
      detail: "Connected cost data exceeded the configured pacing ratio. Scout cannot change the budget.",
      evidence: {
        spend,
        dailyBudget: thresholds.dailyBudget,
        pacingRatio: thresholds.pacingRatio,
        currency: currencies[0]
      }
    });
  }

  return signals;
}

export async function runPaidCampaignHealthCheck(input: {
  tenantId: string;
  now?: Date;
  thresholds?: PaidScoutThresholds;
}) {
  const now = input.now ?? new Date();
  const thresholds = input.thresholds ?? paidScoutThresholds();
  const recentStart = new Date(now.getTime() - thresholds.stopWindowHours * 3_600_000);
  const baselineStart = new Date(
    recentStart.getTime() - thresholds.baselineDays * 86_400_000
  );
  const genuine = {
    tenantId: input.tenantId,
    entryMethod: "WEBSITE_FORM" as const,
    formType: { not: "account_setup" },
    status: { not: WebsiteInboundStatus.TEST },
    isTest: false,
    marketingExcludedReason: null
  };
  const select = {
    id: true,
    status: true,
    submittedAt: true,
    createdAt: true,
    attributionChannel: true,
    utmSource: true,
    utmCampaign: true,
    utmTerm: true,
    campaignId: true,
    landingPage: true,
    landingPath: true,
    pageUrl: true,
    attributionLocation: true,
    device: true,
    gclid: true,
    gbraid: true,
    wbraid: true,
    isTest: true,
    marketingExcludedReason: true
  };
  const [recentForms, baselineForms, recentPaid, baselinePaid, inconsistentTests, latestSync, recentCost] =
    await Promise.all([
      prisma.websiteInboundSubmission.findMany({
        where: { ...genuine, submittedAt: { gte: recentStart, lte: now } },
        select,
        take: 10_000
      }),
      prisma.websiteInboundSubmission.findMany({
        where: { ...genuine, submittedAt: { gte: baselineStart, lt: recentStart } },
        select,
        take: 10_000
      }),
      prisma.websiteInboundSubmission.findMany({
        where: {
          ...genuine,
          attributionChannel: WebsiteInboundAttributionChannel.PAID_SEARCH,
          submittedAt: { gte: recentStart, lte: now }
        },
        select,
        take: 10_000
      }),
      prisma.websiteInboundSubmission.findMany({
        where: {
          ...genuine,
          attributionChannel: WebsiteInboundAttributionChannel.PAID_SEARCH,
          submittedAt: { gte: baselineStart, lt: recentStart }
        },
        select,
        take: 10_000
      }),
      prisma.websiteInboundSubmission.findMany({
        where: {
          tenantId: input.tenantId,
          entryMethod: "WEBSITE_FORM",
          submittedAt: { gte: recentStart, lte: now },
          OR: [
            { isTest: true, status: { not: WebsiteInboundStatus.TEST } },
            { marketingExcludedReason: { not: null }, isTest: false },
            { status: WebsiteInboundStatus.TEST, isTest: false }
          ]
        },
        select,
        take: 1_000
      }),
      prisma.automationJobRun.findFirst({
        where: { tenantId: input.tenantId, jobType: GOOGLE_ADS_SYNC_JOB },
        orderBy: { startedAt: "desc" },
        select: { status: true }
      }),
      prisma.websitePaidCampaignMetric.findMany({
        where: { tenantId: input.tenantId, metricDate: { gte: recentStart, lte: now } },
        select: {
          campaignId: true,
          campaignName: true,
          keyword: true,
          searchTerm: true,
          device: true,
          location: true,
          cost: true,
          currency: true,
          impressions: true,
          clicks: true
        }
      })
    ]);
  const proposed = evaluatePaidHealth({
    recentForms,
    baselineForms,
    recentPaid,
    baselinePaid,
    inconsistentTests,
    latestSyncStatus: latestSync?.status ?? null,
    recentCost,
    thresholds
  });
  const signals = await persistPaidSignals(input.tenantId, proposed, "health:", now);
  const output = {
    version: 1,
    observedAt: now.toISOString(),
    thresholds,
    counts: {
      recentForms: recentForms.length,
      baselineForms: baselineForms.length,
      recentPaid: recentPaid.length,
      baselinePaid: baselinePaid.length,
      openHealthSignals: signals.length
    },
    signals: proposed.map(({ dedupeKey, type, title, detail, evidence }) => ({
      dedupeKey,
      type,
      title,
      detail,
      evidence
    })),
    googleAdsCostConnected: recentCost.some((row) => row.cost !== null),
    googleAdsSyncConfigured: Boolean(latestSync)
  };
  await prisma.automationJobRun.create({
    data: {
      tenantId: input.tenantId,
      jobType: PAID_HEALTH_JOB,
      status: JobStatus.SUCCESS,
      startedAt: now,
      finishedAt: new Date(),
      input: thresholds as unknown as Prisma.InputJsonValue,
      output: output as unknown as Prisma.InputJsonValue
    }
  });
  return output;
}

export function buildPaidWeeklyReview(input: {
  leads: PaidLeadEvidence[];
  costs: PaidCostEvidence[];
  openSignals: Array<{ type: WebsitePaidCampaignSignalType }>;
  thresholds: PaidScoutThresholds;
  from: string;
  to: string;
}) {
  const funnel = calculatePaidFunnel(input.leads);
  const partial = input.leads.filter(
    (row) => attributionCompleteness(row) !== "COMPLETE"
  ).length;
  const costRows = input.costs.filter((row) => row.cost !== null);
  const spend = costRows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
  const currency = [...new Set(costRows.map((row) => row.currency).filter(Boolean))];
  const costAvailable =
    costRows.length > 0 &&
    currency.length === 1 &&
    costRows.every((row) => row.currency === currency[0]);
  const divide = (count: number) => (count ? spend / count : null);
  const trackingIssue = input.openSignals.some(
    (signal) =>
      signal.type === WebsitePaidCampaignSignalType.PAID_TRACKING_ISSUE ||
      signal.type === WebsitePaidCampaignSignalType.PAID_SYNC_FAILURE
  );
  const recommendation = trackingIssue || partial > Math.max(1, input.leads.length / 3)
    ? "INVESTIGATE"
    : costAvailable && funnel.formSubmissions === 0 && spend >= input.thresholds.wastedSpendAmount
      ? "REDUCE"
      : costAvailable && funnel.won >= 2 && funnel.leadToWinRate !== null && funnel.leadToWinRate >= 0.15
        ? "INCREASE"
        : "MAINTAIN";
  const recommendationReason = !costAvailable
    ? "Cost data is not connected, so Scout cannot support a budget increase or reduction. The recommendation is based only on lead quality and tracking health."
    : trackingIssue
      ? "Resolve tracking or synchronization evidence before changing spend."
      : recommendation === "REDUCE"
        ? "Connected spend crossed the configured threshold without an attributed form submission."
        : recommendation === "INCREASE"
          ? "Connected cost data and at least two won outcomes support review of a controlled increase; human approval is still required."
          : "Available cost and lead outcomes do not support a material budget change."
  const termGroups = groupPaidRows(input.leads, (row) => row.utmTerm || "Unavailable");
  const landingGroups = groupPaidRows(
    input.leads,
    (row) => row.landingPath || row.landingPage || row.pageUrl || "Unavailable"
  );
  const searchTerms = buildSearchTermQuality(input.leads, input.costs);
  const negativeKeywords = searchTerms.filter(
    (row) =>
      row.cost !== null &&
      row.cost >= input.thresholds.wastedSpendAmount &&
      !row.hasAttributedLead
  );
  return {
    version: 1,
    period: { from: input.from, to: input.to },
    funnel,
    attribution: {
      complete: input.leads.length - partial,
      partialOrUnavailable: partial
    },
    campaignQuality: groupPaidRows(
      input.leads,
      (row) => row.utmCampaign || row.campaignId || "Unavailable"
    ).slice(0, 20),
    keywordQuality: termGroups.slice(0, 20),
    landingPagePerformance: landingGroups.slice(0, 20),
    geographicPerformance: groupPaidRows(
      input.leads,
      (row) => row.attributionLocation || "Unavailable"
    ).slice(0, 20),
    devicePerformance: groupPaidRows(
      input.leads,
      (row) => row.device || "Unavailable"
    ).slice(0, 20),
    searchTermQuality: searchTerms.length
      ? { status: "AVAILABLE", rows: searchTerms.slice(0, 50) }
      : { status: "UNAVAILABLE_UNTIL_GOOGLE_ADS_SYNC", rows: [] },
    negativeKeywordOpportunities: negativeKeywords.slice(0, 20),
    costMetrics: costAvailable
      ? {
          currency: currency[0],
          spend,
          costPerLead: divide(funnel.formSubmissions),
          costPerQualifiedLead: divide(funnel.qualifiedLeads),
          costPerQuote: divide(funnel.quotesSent),
          customerAcquisitionCost: divide(funnel.won)
        }
      : null,
    recommendation,
    recommendationReason,
    humanApprovalRequired: true,
    limitations: [
      "Current statuses are used as cumulative funnel milestones: Quote sent and Won count as having reached Qualified; Won also counts as having reached Quote sent. Confirm this operating interpretation.",
      "Lead attribution is deterministic first-party evidence, not proof that advertising caused an outcome.",
      ...(costAvailable ? [] : ["Spend, CPL, qualified CPL, cost per quote and acquisition cost are unavailable until Google Ads synchronization is connected."])
    ]
  };
}

export async function runPaidCampaignWeeklyReview(input: {
  tenantId: string;
  now?: Date;
  thresholds?: PaidScoutThresholds;
}) {
  const now = input.now ?? new Date();
  const thresholds = input.thresholds ?? paidScoutThresholds();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000);
  const select = {
    id: true,
    status: true,
    submittedAt: true,
    createdAt: true,
    attributionChannel: true,
    utmSource: true,
    utmCampaign: true,
    utmTerm: true,
    campaignId: true,
    landingPage: true,
    landingPath: true,
    pageUrl: true,
    attributionLocation: true,
    device: true,
    gclid: true,
    gbraid: true,
    wbraid: true,
    isTest: true,
    marketingExcludedReason: true
  };
  const [leads, costs, openSignals] = await Promise.all([
    prisma.websiteInboundSubmission.findMany({
      where: {
        tenantId: input.tenantId,
        entryMethod: "WEBSITE_FORM",
        formType: { not: "account_setup" },
        attributionChannel: WebsiteInboundAttributionChannel.PAID_SEARCH,
        status: { not: WebsiteInboundStatus.TEST },
        isTest: false,
        marketingExcludedReason: null,
        submittedAt: { gte: start, lt: end }
      },
      select,
      take: 25_000
    }),
    prisma.websitePaidCampaignMetric.findMany({
      where: { tenantId: input.tenantId, metricDate: { gte: start, lt: end } },
      select: {
        campaignId: true,
        campaignName: true,
        keyword: true,
        searchTerm: true,
        device: true,
        location: true,
        cost: true,
        currency: true,
        impressions: true,
        clicks: true
      }
    }),
    prisma.websitePaidCampaignSignal.findMany({
      where: { tenantId: input.tenantId, status: WebsitePaidCampaignSignalStatus.OPEN },
      select: { type: true }
    })
  ]);
  const review = buildPaidWeeklyReview({ leads, costs, openSignals, thresholds, from, to });
  const weeklySignals = weeklyOpportunitySignals(leads, costs, thresholds);
  await persistPaidSignals(input.tenantId, weeklySignals, "weekly:", now);
  await prisma.automationJobRun.create({
    data: {
      tenantId: input.tenantId,
      jobType: PAID_WEEKLY_REVIEW_JOB,
      status: JobStatus.SUCCESS,
      startedAt: now,
      finishedAt: new Date(),
      input: { from, to, thresholds } as unknown as Prisma.InputJsonValue,
      output: review as unknown as Prisma.InputJsonValue
    }
  });
  return review;
}

function weeklyOpportunitySignals(
  leads: PaidLeadEvidence[],
  costs: PaidCostEvidence[],
  thresholds: PaidScoutThresholds
) {
  const signals: ProposedPaidSignal[] = [];
  for (const page of groupPaidRows(
    leads,
    (row) => row.landingPath || row.landingPage || row.pageUrl || "Unavailable"
  )) {
    if (page.label === "Unavailable" || page.formSubmissions < thresholds.minimumLandingPageLeads) continue;
    if ((page.leadToQualifiedRate ?? 0) <= thresholds.lowQualifiedRate) {
      signals.push({
        dedupeKey: `weekly:landing:${stableKey(page.label)}`,
        type: WebsitePaidCampaignSignalType.LANDING_PAGE_OPPORTUNITY,
        title: "Paid landing page needs review",
        detail: `${page.label} produced ${page.formSubmissions} leads with a ${(100 * (page.leadToQualifiedRate ?? 0)).toFixed(1)}% qualified-or-later rate.`,
        evidence: page
      });
    } else if ((page.leadToQualifiedRate ?? 0) >= thresholds.scaleQualifiedRate) {
      signals.push({
        dedupeKey: `weekly:scale:${stableKey(page.label)}`,
        type: WebsitePaidCampaignSignalType.SCALE_CANDIDATE,
        title: "Paid landing page is a scale candidate",
        detail: `${page.label} produced ${page.formSubmissions} leads with a ${(100 * (page.leadToQualifiedRate ?? 0)).toFixed(1)}% qualified-or-later rate. Review spend and capacity before increasing budget.`,
        evidence: page
      });
    }
  }
  for (const row of buildSearchTermQuality(leads, costs)) {
    if (
      row.cost !== null &&
      row.cost >= thresholds.wastedSpendAmount &&
      !row.hasAttributedLead
    ) {
      signals.push({
        dedupeKey: `weekly:negative-keyword:${stableKey(row.searchTerm)}`,
        type: WebsitePaidCampaignSignalType.NEGATIVE_KEYWORD,
        title: "Search term needs negative-keyword review",
        detail: "A connected search term crossed the configured spend threshold without a matching attributed lead. Human review is required before changing keywords.",
        evidence: row
      });
    }
  }
  return signals;
}

function buildSearchTermQuality(leads: PaidLeadEvidence[], costs: PaidCostEvidence[]) {
  const leadTerms = new Set(
    leads.map((lead) => lead.utmTerm?.trim().toLowerCase()).filter(Boolean)
  );
  const grouped = new Map<string, {
    searchTerm: string;
    cost: number;
    clicks: number;
    impressions: number;
    hasCost: boolean;
    incompleteCurrency: boolean;
    currencies: Set<string>;
  }>();
  for (const row of costs) {
    const searchTerm = row.searchTerm?.trim();
    if (!searchTerm) continue;
    const key = searchTerm.toLowerCase();
    const current = grouped.get(key) ?? {
      searchTerm,
      cost: 0,
      clicks: 0,
      impressions: 0,
      hasCost: false,
      incompleteCurrency: false,
      currencies: new Set<string>()
    };
    if (row.cost !== null) {
      current.hasCost = true;
      current.cost += Number(row.cost);
      if (row.currency) current.currencies.add(row.currency);
      else current.incompleteCurrency = true;
    }
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    grouped.set(key, current);
  }
  return Array.from(grouped.entries(), ([key, row]) => {
    const currencies = [...row.currencies];
    const costAvailable =
      row.hasCost && !row.incompleteCurrency && currencies.length === 1;
    return {
      searchTerm: row.searchTerm,
      cost: costAvailable ? row.cost : null,
      currency: costAvailable ? currencies[0] : null,
      costAvailable,
      clicks: row.clicks,
      impressions: row.impressions,
      hasAttributedLead: leadTerms.has(key)
    };
  }).sort(
    (left, right) =>
      (right.cost ?? -1) - (left.cost ?? -1) ||
      left.searchTerm.localeCompare(right.searchTerm)
  );
}

async function persistPaidSignals(
  tenantId: string,
  proposed: ProposedPaidSignal[],
  prefix: string,
  now: Date
) {
  const activeKeys = proposed.map((signal) => signal.dedupeKey);
  await prisma.$transaction([
    prisma.websitePaidCampaignSignal.updateMany({
      where: {
        tenantId,
        status: WebsitePaidCampaignSignalStatus.OPEN,
        dedupeKey: { startsWith: prefix, ...(activeKeys.length ? { notIn: activeKeys } : {}) }
      },
      data: {
        status: WebsitePaidCampaignSignalStatus.RESOLVED,
        resolvedAt: now
      }
    }),
    ...proposed.map((signal) =>
      prisma.websitePaidCampaignSignal.upsert({
        where: { tenantId_dedupeKey: { tenantId, dedupeKey: signal.dedupeKey } },
        create: {
          tenantId,
          ...signal,
          evidence: signal.evidence as Prisma.InputJsonValue,
          firstSeenAt: now,
          lastSeenAt: now
        },
        update: {
          type: signal.type,
          title: signal.title,
          detail: signal.detail,
          evidence: signal.evidence as Prisma.InputJsonValue,
          status: WebsitePaidCampaignSignalStatus.OPEN,
          lastSeenAt: now,
          resolvedAt: null
        }
      })
    )
  ]);
  return proposed;
}

function stableKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function optionalNumber(value: string | undefined, min: number, max: number) {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
}
