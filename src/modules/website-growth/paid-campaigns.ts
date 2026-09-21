import {
  WebsiteInboundAttributionChannel,
  WebsiteInboundStatus,
  type Prisma
} from "@prisma/client";

import { attributionCompleteness } from "@/modules/website-inbound/attribution";
import { prisma } from "@/server/db";

const REPORT_LIMIT = 5_001;
const PAGE_SIZE = 100;
const FUNNEL_QUALIFIED = new Set<WebsiteInboundStatus>([
  WebsiteInboundStatus.QUALIFIED,
  WebsiteInboundStatus.QUOTE_SENT,
  WebsiteInboundStatus.WON
]);
const FUNNEL_QUOTED = new Set<WebsiteInboundStatus>([
  WebsiteInboundStatus.QUOTE_SENT,
  WebsiteInboundStatus.WON
]);

export const PAID_REPORT_STATUS_LABELS: Record<WebsiteInboundStatus, string> = {
  NEW: "New",
  REVIEWED: "Reviewed",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  CONVERTED: "Converted (legacy)",
  CLOSED: "Closed (legacy)",
  QUOTE_SENT: "Quote sent",
  WON: "Won",
  LOST: "Lost",
  NURTURE: "Nurture",
  DISQUALIFIED: "Not a fit / Spam",
  TEST: "Test"
};

export type PaidCampaignFilters = {
  from: string;
  to: string;
  campaign: string;
  channel: WebsiteInboundAttributionChannel | "ALL";
  location: string;
  status: WebsiteInboundStatus | "ALL";
  page: number;
};

export function parsePaidCampaignFilters(
  params: Record<string, string | string[] | undefined>,
  now = new Date()
): PaidCampaignFilters {
  const get = (key: string) =>
    (Array.isArray(params[key]) ? params[key]?.[0] : params[key])?.trim() ?? "";
  const defaultTo = now.toISOString().slice(0, 10);
  const defaultFrom = new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  const date = (value: string, fallback: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      ? value
      : fallback;
  const channel = get("channel");
  const status = get("status");
  const page = Number(get("page"));
  return {
    from: date(get("from"), defaultFrom),
    to: date(get("to"), defaultTo),
    campaign: get("campaign").slice(0, 500),
    channel: Object.values(WebsiteInboundAttributionChannel).includes(
      channel as WebsiteInboundAttributionChannel
    )
      ? (channel as WebsiteInboundAttributionChannel)
      : "ALL",
    location: get("location").slice(0, 500),
    status: status !== WebsiteInboundStatus.TEST &&
      Object.values(WebsiteInboundStatus).includes(status as WebsiteInboundStatus)
      ? (status as WebsiteInboundStatus)
      : "ALL",
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1
  };
}

export async function getPaidCampaignReport(tenantId: string, filters: PaidCampaignFilters) {
  const where = buildPaidCampaignWhere(tenantId, filters);
  const [rows, costRows, openSignals, latestReview] = await Promise.all([
    prisma.websiteInboundSubmission.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        createdAt: true,
        submittedAt: true,
        status: true,
        company: true,
        name: true,
        source: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        utmTerm: true,
        campaignId: true,
        adGroupId: true,
        creativeId: true,
        matchType: true,
        network: true,
        device: true,
        landingPage: true,
        landingPath: true,
        pageUrl: true,
        attributionChannel: true,
        attributionLocation: true,
        attributionConfidence: true,
        gclid: true,
        gbraid: true,
        wbraid: true
      },
      take: REPORT_LIMIT
    }),
    prisma.websitePaidCampaignMetric.findMany({
      where: {
        tenantId,
        metricDate: {
          gte: new Date(`${filters.from}T00:00:00Z`),
          lte: new Date(`${filters.to}T00:00:00Z`)
        },
        ...(filters.campaign
          ? {
              OR: [
                { campaignId: { contains: filters.campaign, mode: "insensitive" as const } },
                { campaignName: { contains: filters.campaign, mode: "insensitive" as const } }
              ]
            }
          : {})
      },
      select: { cost: true, currency: true, impressions: true, clicks: true }
    }),
    prisma.websitePaidCampaignSignal.findMany({
      where: { tenantId, status: "OPEN" },
      orderBy: [{ lastSeenAt: "desc" }],
      take: 20
    }),
    prisma.automationJobRun.findFirst({
      where: { tenantId, jobType: "WEBSITE_GROWTH_PAID_WEEKLY_REVIEW", status: "SUCCESS" },
      orderBy: { startedAt: "desc" }
    })
  ]);

  const visibleRows = rows.slice(0, REPORT_LIMIT - 1);
  const metrics = calculatePaidFunnel(visibleRows);
  const grouped = {
    campaign: groupPaidRows(visibleRows, (row) => row.utmCampaign || row.campaignId || "Unavailable"),
    keyword: groupPaidRows(visibleRows, (row) => row.utmTerm || "Unavailable"),
    landingPage: groupPaidRows(
      visibleRows,
      (row) => row.landingPath || row.landingPage || row.pageUrl || "Unavailable"
    ),
    source: groupPaidRows(visibleRows, (row) => row.utmSource || row.source || "Unavailable"),
    location: groupPaidRows(visibleRows, (row) => row.attributionLocation || "Unavailable")
  };
  const pageStart = (filters.page - 1) * PAGE_SIZE;

  return {
    filters,
    metrics,
    grouped,
    campaigns: distinct(visibleRows.map((row) => row.utmCampaign || row.campaignId)),
    locations: distinct(visibleRows.map((row) => row.attributionLocation)),
    rows: visibleRows.slice(pageStart, pageStart + PAGE_SIZE).map((row) => ({
      ...row,
      attributionCompleteness: attributionCompleteness(row),
      campaign: row.utmCampaign || row.campaignId,
      landing: row.landingPath || row.landingPage || row.pageUrl
    })),
    pageSize: PAGE_SIZE,
    totalRows: visibleRows.length,
    truncated: rows.length === REPORT_LIMIT,
    costMetrics: summarizeCost(costRows, metrics),
    openSignals,
    latestReview
  };
}

export function calculatePaidFunnel(rows: Array<{ status: WebsiteInboundStatus }>) {
  const formSubmissions = rows.length;
  const qualifiedLeads = rows.filter((row) => FUNNEL_QUALIFIED.has(row.status)).length;
  const quotesSent = rows.filter((row) => FUNNEL_QUOTED.has(row.status)).length;
  const won = rows.filter((row) => row.status === WebsiteInboundStatus.WON).length;
  const lost = rows.filter((row) => row.status === WebsiteInboundStatus.LOST).length;
  const rate = (value: number) => (formSubmissions ? value / formSubmissions : null);
  return {
    formSubmissions,
    qualifiedLeads,
    quotesSent,
    won,
    lost,
    leadToQualifiedRate: rate(qualifiedLeads),
    leadToQuoteRate: rate(quotesSent),
    leadToWinRate: rate(won)
  };
}

export function groupPaidRows<T extends { status: WebsiteInboundStatus }>(
  rows: T[],
  key: (row: T) => string
) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const label = key(row).trim() || "Unavailable";
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return Array.from(groups, ([label, items]) => ({ label, ...calculatePaidFunnel(items) }))
    .sort((left, right) => right.formSubmissions - left.formSubmissions || left.label.localeCompare(right.label))
    .slice(0, 100);
}

export function buildPaidCampaignWhere(
  tenantId: string,
  filters: PaidCampaignFilters
): Prisma.WebsiteInboundSubmissionWhereInput {
  const and: Prisma.WebsiteInboundSubmissionWhereInput[] = [
    { submittedAt: { gte: new Date(`${filters.from}T00:00:00Z`) } },
    { submittedAt: { lt: new Date(Date.parse(`${filters.to}T00:00:00Z`) + 86_400_000) } }
  ];
  if (filters.campaign) {
    and.push({
      OR: [
        { campaignId: { contains: filters.campaign, mode: "insensitive" } },
        { utmCampaign: { contains: filters.campaign, mode: "insensitive" } }
      ]
    });
  }
  if (filters.channel !== "ALL") and.push({ attributionChannel: filters.channel });
  if (filters.location) {
    and.push({ attributionLocation: { contains: filters.location, mode: "insensitive" } });
  }
  if (filters.status !== "ALL") and.push({ status: filters.status });
  return {
    tenantId,
    entryMethod: "WEBSITE_FORM",
    formType: { not: "account_setup" },
    attributionChannel: WebsiteInboundAttributionChannel.PAID_SEARCH,
    status: { not: WebsiteInboundStatus.TEST },
    isTest: false,
    marketingExcludedReason: null,
    AND: and
  };
}

function summarizeCost(
  rows: Array<{ cost: Prisma.Decimal | null; currency: string | null; impressions: number; clicks: number }>,
  funnel: ReturnType<typeof calculatePaidFunnel>
) {
  const rowsWithCost = rows.filter((row) => row.cost !== null);
  if (!rowsWithCost.length) return null;
  const currencies = distinct(rowsWithCost.map((row) => row.currency));
  if (
    currencies.length !== 1 ||
    rowsWithCost.some((row) => row.currency !== currencies[0])
  ) {
    return {
      available: false as const,
      reason: "Cost rows do not have one complete, consistent currency."
    };
  }
  const spend = rowsWithCost.reduce((sum, row) => sum + Number(row.cost), 0);
  const divide = (value: number) => (value > 0 ? spend / value : null);
  return {
    available: true as const,
    currency: currencies[0],
    spend,
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    costPerLead: divide(funnel.formSubmissions),
    costPerQualifiedLead: divide(funnel.qualifiedLeads),
    costPerQuote: divide(funnel.quotesSent),
    customerAcquisitionCost: divide(funnel.won)
  };
}

function distinct(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}
