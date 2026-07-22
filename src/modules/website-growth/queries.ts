import {
  WebsiteGrowthAction,
  WebsiteGrowthDataSource,
  WebsiteGrowthOpportunityStatus,
  type Prisma
} from "@prisma/client";

import { getWebsiteGrowthIntegrationStatus } from "@/modules/website-growth/integrations";
import { getWebsiteGrowthDeveloperDispatchStatus } from "@/modules/website-growth/developer-dispatch";
import {
  buildLegacyRebuildEvidence,
  buildLegacyRebuildReason,
  buildLegacyRebuildRecommendation,
  getOpportunityReviewKey,
  legacyPageRebuilds,
  resolveLegacyPageRebuild,
  toNewlUrl
} from "@/modules/website-growth/legacy-rebuilds";
import { weeklyContentRecommendations } from "@/modules/website-growth/opportunities";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { prisma } from "@/server/db";

export type WebsiteGrowthStatusFilter = WebsiteGrowthOpportunityStatus | "ALL";
export type WebsiteGrowthActionFilter = WebsiteGrowthAction | "ALL";

export async function getWebsiteGrowthShell(
  context: AuthenticatedContext,
  filters: {
    status?: WebsiteGrowthStatusFilter;
    action?: WebsiteGrowthActionFilter;
    search?: string;
  } = {}
) {
  await normalizeLegacyRebuildOpportunities(context.tenantId);

  const where = buildOpportunityWhere(context.tenantId, filters);
  const last30Days = new Date();
  last30Days.setDate(last30Days.getDate() - 30);

  const [
    opportunities,
    totalCount,
    reviewQueueCount,
    approvedCount,
    publishedCount,
    monitoringCount,
    recentImports,
    latestMetrics,
    inboundCount,
    inboundLeadPages,
    companyCount,
    contactCount,
    pipelineCount,
    creditCheckCount,
    statusCounts,
    preparedOpportunities
  ] = await Promise.all([
    prisma.websiteGrowthOpportunity.findMany({
      where,
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 200,
      include: {
        contentDrafts: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1
        }
      }
    }),
    prisma.websiteGrowthOpportunity.count({ where: { tenantId: context.tenantId } }),
    prisma.websiteGrowthOpportunity.count({
      where: {
        tenantId: context.tenantId,
        status: {
          in: [
            WebsiteGrowthOpportunityStatus.NEW,
            WebsiteGrowthOpportunityStatus.REVIEWING
          ]
        }
      }
    }),
    prisma.websiteGrowthOpportunity.count({
      where: {
        tenantId: context.tenantId,
        status: {
          in: [
            WebsiteGrowthOpportunityStatus.APPROVED,
            WebsiteGrowthOpportunityStatus.IN_PROGRESS
          ]
        }
      }
    }),
    prisma.websiteGrowthOpportunity.count({
      where: {
        tenantId: context.tenantId,
        status: WebsiteGrowthOpportunityStatus.PUBLISHED
      }
    }),
    prisma.websiteGrowthOpportunity.count({
      where: {
        tenantId: context.tenantId,
        status: WebsiteGrowthOpportunityStatus.MONITORING
      }
    }),
    prisma.websiteGrowthDataImport.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { createdAt: "desc" },
      take: 8
    }),
    prisma.websiteGrowthMetric.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { createdAt: "desc" },
      take: 8
    }),
    prisma.websiteInboundSubmission.count({
      where: {
        tenantId: context.tenantId,
        formType: {
          not: "account_setup"
        },
        createdAt: {
          gte: last30Days
        }
      }
    }),
    prisma.websiteInboundSubmission.groupBy({
      by: ["pageUrl"],
      where: {
        tenantId: context.tenantId,
        formType: {
          not: "account_setup"
        },
        pageUrl: {
          not: null
        }
      },
      _count: {
        _all: true
      },
      orderBy: {
        _count: {
          pageUrl: "desc"
        }
      },
      take: 5
    }),
    prisma.company.count({ where: { tenantId: context.tenantId } }),
    prisma.contact.count({ where: { tenantId: context.tenantId } }),
    prisma.lead.count({ where: { tenantId: context.tenantId } }),
    prisma.creditCheck.count({ where: { tenantId: context.tenantId } }),
    prisma.websiteGrowthOpportunity.groupBy({
      by: ["status"],
      where: { tenantId: context.tenantId },
      _count: {
        _all: true
      }
    }),
    prisma.websiteGrowthOpportunity.findMany({
      where: {
        tenantId: context.tenantId,
        status: WebsiteGrowthOpportunityStatus.REVIEWING
      },
      include: {
        contentDrafts: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1
        }
      },
      orderBy: [{ updatedAt: "desc" }, { score: "desc" }],
      take: 50
    })
  ]);

  const weeklyLaneCounts = await Promise.all(
    weeklyContentRecommendations.map(async (lane) => ({
      lane: lane.lane,
      label: lane.label,
      description: lane.description,
      publishLimit: lane.publishLimit,
    count: await prisma.websiteGrowthOpportunity.count({
        where: {
          tenantId: context.tenantId,
          status: WebsiteGrowthOpportunityStatus.REVIEWING,
          action: {
            in: lane.actions
          }
        }
      })
    }))
  );

  return {
    opportunities,
    recentImports,
    latestMetrics,
    integrations: getWebsiteGrowthIntegrationStatus(),
    developerDispatch: getWebsiteGrowthDeveloperDispatchStatus(),
    metrics: {
      totalCount,
      reviewQueueCount,
      approvedCount,
      publishedCount,
      monitoringCount,
      visibleCount: opportunities.length,
      inboundCount,
      companyCount,
      contactCount,
      pipelineCount,
      creditCheckCount
    },
    inboundLeadPages: inboundLeadPages
      .filter((row) => row.pageUrl)
      .map((row) => ({
        pageUrl: row.pageUrl ?? "",
        count: row._count._all
      })),
    statusCounts: statusCounts.map((entry) => ({
      status: entry.status,
      count: entry._count._all
    })),
    weeklyLaneCounts,
    preparedOpportunities: collapsePreparedOpportunities(preparedOpportunities)
  };
}

function collapsePreparedOpportunities<T extends {
  action: WebsiteGrowthAction;
  targetPage: string | null;
  sourcePage: string | null;
  topic: string;
  score: number;
  updatedAt: Date;
  contentDrafts: unknown[];
}>(opportunities: T[]) {
  const grouped = new Map<string, T>();

  for (const opportunity of opportunities) {
    const reviewKey = getOpportunityReviewKey(opportunity);
    const key = reviewKey.startsWith("legacy-rebuild:")
      ? reviewKey
      : `${getReviewLane(opportunity.action)}:${normalizeReviewPage(opportunity.targetPage ?? opportunity.sourcePage ?? opportunity.topic)}`;
    const existing = grouped.get(key);

    if (!existing || comparePreparedOpportunity(opportunity, existing) < 0) {
      grouped.set(key, opportunity);
    }
  }

  return Array.from(grouped.values()).sort(comparePreparedOpportunity);
}

async function normalizeLegacyRebuildOpportunities(tenantId: string) {
  const opportunities = await prisma.websiteGrowthOpportunity.findMany({
    where: {
      tenantId,
      OR: [
        ...legacyPageRebuilds.flatMap((rebuild) => [
          { targetPage: { contains: rebuild.legacyPath } },
          { sourcePage: { contains: rebuild.legacyPath } },
          { targetPage: { contains: rebuild.currentRedirectPath } },
          { sourcePage: { contains: rebuild.currentRedirectPath } }
        ]),
        { topic: { contains: "3pl" } },
        { topic: { contains: "3PL" } },
        { primaryKeyword: { contains: "3pl" } },
        { primaryKeyword: { contains: "3PL" } }
      ]
    },
    take: 500
  });

  for (const opportunity of opportunities) {
    const rebuild = resolveLegacyPageRebuild(opportunity);

    if (!rebuild) {
      continue;
    }

    const evidence = readRecord(opportunity.evidence);
    const mergedEvidence = {
      impressions: readNumber(evidence?.impressions),
      clicks: readNumber(evidence?.clicks),
      position: readNullableNumber(evidence?.position),
      leadCount: readNumber(evidence?.leadCount),
      source: evidence?.source ?? "legacy_rebuild_normalization",
      ...buildLegacyRebuildEvidence(rebuild, {
        targetPage: opportunity.targetPage,
        sourcePage: opportunity.sourcePage,
        evidence
      })
    };
    const targetPage = toNewlUrl(rebuild.proposedPath);
    const recommendation = buildLegacyRebuildRecommendation(rebuild);
    const reason = buildLegacyRebuildReason({
      rebuild,
      impressions: readNumber(mergedEvidence.impressions),
      clicks: readNumber(mergedEvidence.clicks),
      position: readNullableNumber(mergedEvidence.position),
      leadCount: readNumber(mergedEvidence.leadCount)
    });

    if (
      opportunity.action === WebsiteGrowthAction.CREATE_PAGE &&
      opportunity.targetPage === targetPage &&
      evidence?.legacyRebuild === true &&
      opportunity.recommendation === recommendation
    ) {
      continue;
    }

    await prisma.websiteGrowthOpportunity.update({
      where: { id: opportunity.id },
      data: {
        action: WebsiteGrowthAction.CREATE_PAGE,
        targetPage,
        sourcePage: opportunity.sourcePage ?? opportunity.targetPage ?? toNewlUrl(rebuild.currentRedirectPath),
        recommendation,
        reason,
        supportingKeywords: Array.from(new Set([
          opportunity.primaryKeyword,
          rebuild.primaryKeyword,
          ...rebuild.aliases
        ].filter(Boolean))) as Prisma.InputJsonValue,
        evidence: mergedEvidence as Prisma.InputJsonValue
      }
    });
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function comparePreparedOpportunity(a: { score: number; updatedAt: Date; contentDrafts: unknown[] }, b: { score: number; updatedAt: Date; contentDrafts: unknown[] }) {
  const draftDelta = Number(b.contentDrafts.length > 0) - Number(a.contentDrafts.length > 0);

  if (draftDelta !== 0) {
    return draftDelta;
  }

  const scoreDelta = b.score - a.score;

  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

function getReviewLane(action: WebsiteGrowthAction) {
  return weeklyContentRecommendations.find((lane) => lane.actions.includes(action))?.lane ?? action;
}

function normalizeReviewPage(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.pathname.replace(/\/+$/g, "") || "/";
  } catch {
    return value
      .toLowerCase()
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/\/+$/g, "")
      .trim();
  }
}

export function buildOpportunityWhere(
  tenantId: string,
  filters: {
    status?: WebsiteGrowthStatusFilter;
    action?: WebsiteGrowthActionFilter;
    search?: string;
  }
): Prisma.WebsiteGrowthOpportunityWhereInput {
  const search = filters.search?.trim();

  return {
    tenantId,
    ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
    ...(filters.action && filters.action !== "ALL" ? { action: filters.action } : {}),
    ...(search
      ? {
          OR: [
            { topic: { contains: search, mode: "insensitive" } },
            { primaryKeyword: { contains: search, mode: "insensitive" } },
            { targetPage: { contains: search, mode: "insensitive" } },
            { sourcePage: { contains: search, mode: "insensitive" } },
            { reason: { contains: search, mode: "insensitive" } },
            { recommendation: { contains: search, mode: "insensitive" } }
          ]
        }
      : {})
  };
}

export function parseWebsiteGrowthDataSource(value: FormDataEntryValue | null) {
  if (value === WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_UPLOAD) {
    return WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_UPLOAD;
  }

  if (value === WebsiteGrowthDataSource.GA4_UPLOAD) {
    return WebsiteGrowthDataSource.GA4_UPLOAD;
  }

  if (value === WebsiteGrowthDataSource.SEMRUSH_UPLOAD) {
    return WebsiteGrowthDataSource.SEMRUSH_UPLOAD;
  }

  return WebsiteGrowthDataSource.MANUAL;
}
