import {
  WebsiteGrowthAction,
  WebsiteGrowthDataSource,
  WebsiteGrowthOpportunityStatus,
  type Prisma
} from "@prisma/client";

import { getWebsiteGrowthIntegrationStatus } from "@/modules/website-growth/integrations";
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
    const key = `${getReviewLane(opportunity.action)}:${normalizeReviewPage(opportunity.targetPage ?? opportunity.sourcePage ?? opportunity.topic)}`;
    const existing = grouped.get(key);

    if (!existing || comparePreparedOpportunity(opportunity, existing) < 0) {
      grouped.set(key, opportunity);
    }
  }

  return Array.from(grouped.values()).sort(comparePreparedOpportunity);
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
