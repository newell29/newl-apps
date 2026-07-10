import {
  WebsiteGrowthAction,
  WebsiteGrowthDataSource,
  WebsiteGrowthOpportunityStatus,
  type Prisma
} from "@prisma/client";

import { getWebsiteGrowthIntegrationStatus } from "@/modules/website-growth/integrations";
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
    approvedCount,
    publishedCount,
    recentImports,
    latestMetrics,
    inboundCount,
    inboundLeadPages,
    companyCount,
    contactCount,
    pipelineCount,
    creditCheckCount,
    statusCounts
  ] = await Promise.all([
    prisma.websiteGrowthOpportunity.findMany({
      where,
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 200
    }),
    prisma.websiteGrowthOpportunity.count({ where: { tenantId: context.tenantId } }),
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
    })
  ]);

  return {
    opportunities,
    recentImports,
    latestMetrics,
    integrations: getWebsiteGrowthIntegrationStatus(),
    metrics: {
      totalCount,
      approvedCount,
      publishedCount,
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
    }))
  };
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
