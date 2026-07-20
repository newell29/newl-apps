import { CreditCheckStatus, type Prisma } from "@prisma/client";

import type { AuthenticatedContext } from "@/server/tenant-context";
import { prisma } from "@/server/db";

export type CreditCheckStatusFilter = CreditCheckStatus | "ALL";

export async function getCreditCheckShell(
  context: AuthenticatedContext,
  filters: {
    status?: CreditCheckStatusFilter;
    search?: string;
  } = {}
) {
  const where = buildWhere(context.tenantId, filters);
  const [creditChecks, totalCount, newCount, inReviewCount, approvedCount, statusCounts] =
    await Promise.all([
      prisma.creditCheck.findMany({
        where,
        orderBy: {
          createdAt: "desc"
        },
        take: 150
      }),
      prisma.creditCheck.count({
        where: {
          tenantId: context.tenantId
        }
      }),
      prisma.creditCheck.count({
        where: {
          tenantId: context.tenantId,
          status: CreditCheckStatus.NEW
        }
      }),
      prisma.creditCheck.count({
        where: {
          tenantId: context.tenantId,
          status: {
            in: [CreditCheckStatus.IN_REVIEW, CreditCheckStatus.REFERENCES_CONTACTED, CreditCheckStatus.MORE_INFO_NEEDED]
          }
        }
      }),
      prisma.creditCheck.count({
        where: {
          tenantId: context.tenantId,
          status: CreditCheckStatus.APPROVED
        }
      }),
      prisma.creditCheck.groupBy({
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
    creditChecks,
    metrics: {
      totalCount,
      newCount,
      inReviewCount,
      approvedCount,
      visibleCount: creditChecks.length
    },
    statusCounts: statusCounts.map((entry) => ({
      status: entry.status,
      count: entry._count._all
    }))
  };
}

function buildWhere(
  tenantId: string,
  filters: {
    status?: CreditCheckStatusFilter;
    search?: string;
  }
): Prisma.CreditCheckWhereInput {
  const search = filters.search?.trim();

  return {
    tenantId,
    ...(filters.status && filters.status !== "ALL" ? { status: filters.status } : {}),
    ...(search
      ? {
          OR: [
            { legalCompanyName: { contains: search, mode: "insensitive" } },
            { operatingName: { contains: search, mode: "insensitive" } },
            { company: { contains: search, mode: "insensitive" } },
            { primaryContactName: { contains: search, mode: "insensitive" } },
            { primaryContactEmail: { contains: search, mode: "insensitive" } },
            { accountsPayableEmail: { contains: search, mode: "insensitive" } }
          ]
        }
      : {})
  };
}
