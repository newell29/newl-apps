import { WebsiteInboundStatus, type Prisma } from "@prisma/client";

import type { AuthenticatedContext } from "@/server/tenant-context";
import { prisma } from "@/server/db";
import type { WebsiteInboundStatusFilter, WebsiteInboundTypeFilter } from "@/modules/website-inbound/types";

export async function getWebsiteInboundShell(
  context: AuthenticatedContext,
  filters: {
    status?: WebsiteInboundStatusFilter;
    formType?: WebsiteInboundTypeFilter;
    search?: string;
  } = {}
) {
  const where = buildWhere(context.tenantId, filters);
  const [submissions, totalCount, newCount, accountSetupCount, formTypes, statusCounts] =
    await Promise.all([
      prisma.websiteInboundSubmission.findMany({
        where,
        orderBy: {
          createdAt: "desc"
        },
        take: 200
      }),
      prisma.websiteInboundSubmission.count({
        where: {
          tenantId: context.tenantId
        }
      }),
      prisma.websiteInboundSubmission.count({
        where: {
          tenantId: context.tenantId,
          status: WebsiteInboundStatus.NEW
        }
      }),
      prisma.websiteInboundSubmission.count({
        where: {
          tenantId: context.tenantId,
          formType: "account_setup"
        }
      }),
      prisma.websiteInboundSubmission.groupBy({
        by: ["formType"],
        where: {
          tenantId: context.tenantId
        },
        _count: {
          _all: true
        },
        orderBy: {
          formType: "asc"
        }
      }),
      prisma.websiteInboundSubmission.groupBy({
        by: ["status"],
        where: {
          tenantId: context.tenantId
        },
        _count: {
          _all: true
        }
      })
    ]);

  return {
    submissions,
    metrics: {
      totalCount,
      newCount,
      accountSetupCount,
      visibleCount: submissions.length
    },
    formTypes: formTypes.map((entry) => ({
      formType: entry.formType,
      count: entry._count._all
    })),
    statusCounts: statusCounts.map((entry) => ({
      status: entry.status,
      count: entry._count._all
    }))
  };
}

function buildWhere(
  tenantId: string,
  filters: {
    status?: WebsiteInboundStatusFilter;
    formType?: WebsiteInboundTypeFilter;
    search?: string;
  }
): Prisma.WebsiteInboundSubmissionWhereInput {
  const search = filters.search?.trim();

  return {
    tenantId,
    ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
    ...(filters.formType && filters.formType !== "ALL" ? { formType: filters.formType } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { company: { contains: search, mode: "insensitive" } },
            { primaryNeed: { contains: search, mode: "insensitive" } },
            { formType: { contains: search, mode: "insensitive" } },
            { source: { contains: search, mode: "insensitive" } }
          ]
        }
      : {})
  };
}
