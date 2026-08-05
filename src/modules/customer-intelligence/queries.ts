import {
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  CustomerLifecycle,
  CustomerSourceAccountStatus
} from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { requireReadAccess } from "@/modules/customer-intelligence/permissions";
import { rollupCompanyLifecycle } from "@/modules/customer-intelligence/lifecycle";

/**
 * Public Customer Intelligence read facade. Every externally consumable read
 * requires the module entitlement and an ADMIN, MANAGER, or FINANCE role
 * (see permissions.ts). Raw database access stays inside these guarded
 * functions; no unguarded model delegates are exported.
 */

export async function listOperatingCompanies(ctx: AuthenticatedContext) {
  await requireReadAccess(ctx);
  return prisma.operatingCompany.findMany({
    where: tenantWhere(ctx),
    orderBy: [{ active: "desc" }, { displayName: "asc" }]
  });
}

export async function getOperatingCompany(ctx: AuthenticatedContext, operatingCompanyId: string) {
  await requireReadAccess(ctx);
  return prisma.operatingCompany.findFirst({
    where: tenantWhere(ctx, { id: operatingCompanyId })
  });
}

export async function listRelationshipsForCompany(ctx: AuthenticatedContext, companyId: string) {
  await requireReadAccess(ctx);
  return prisma.companyOperatingRelationship.findMany({
    where: tenantWhere(ctx, { companyId }),
    include: {
      operatingCompany: true,
      sourceAccounts: {
        include: {
          operatingCompany: true
        }
      }
    },
    orderBy: [{ lifecycle: "asc" }, { operatingCompany: { displayName: "asc" } }]
  });
}

export async function getRelationship(ctx: AuthenticatedContext, relationshipId: string) {
  await requireReadAccess(ctx);
  return prisma.companyOperatingRelationship.findFirst({
    where: tenantWhere(ctx, { id: relationshipId }),
    include: {
      operatingCompany: true,
      sourceAccounts: true
    }
  });
}

export async function listSourceAccountsForCompany(ctx: AuthenticatedContext, companyId: string) {
  await requireReadAccess(ctx);
  return prisma.customerSourceAccount.findMany({
    where: tenantWhere(ctx, { companyId }),
    include: {
      operatingCompany: true,
      relationship: true
    },
    orderBy: [{ displayName: "asc" }]
  });
}

export async function listSourceAccountsForRelationship(
  ctx: AuthenticatedContext,
  relationshipId: string
) {
  await requireReadAccess(ctx);
  return prisma.customerSourceAccount.findMany({
    where: tenantWhere(ctx, { companyOperatingRelationshipId: relationshipId }),
    include: {
      operatingCompany: true
    },
    orderBy: [{ currency: "asc" }, { displayName: "asc" }]
  });
}

export async function getSourceAccount(ctx: AuthenticatedContext, sourceAccountId: string) {
  await requireReadAccess(ctx);
  return prisma.customerSourceAccount.findFirst({
    where: tenantWhere(ctx, { id: sourceAccountId }),
    include: {
      operatingCompany: true,
      relationship: true
    }
  });
}

export async function listContactPoints(ctx: AuthenticatedContext, contactId: string) {
  await requireReadAccess(ctx);
  return prisma.contactPoint.findMany({
    where: tenantWhere(ctx, { contactId }),
    orderBy: [{ primary: "desc" }, { type: "asc" }, { value: "asc" }]
  });
}

export async function listContactEvidence(ctx: AuthenticatedContext, contactId: string) {
  await requireReadAccess(ctx);
  return prisma.contactEvidence.findMany({
    where: tenantWhere(ctx, { contactId }),
    orderBy: [{ observedAt: "desc" }]
  });
}

export async function listIdentityMatches(
  ctx: AuthenticatedContext,
  input?: {
    status?: CustomerIdentityMatchStatus;
    kind?: CustomerIdentityMatchKind;
    companyId?: string;
  }
) {
  await requireReadAccess(ctx);
  return prisma.customerIdentityMatch.findMany({
    where: tenantWhere(ctx, input ?? {}),
    orderBy: [{ createdAt: "desc" }]
  });
}

export async function getIdentityMatch(ctx: AuthenticatedContext, matchId: string) {
  await requireReadAccess(ctx);
  return prisma.customerIdentityMatch.findFirst({
    where: tenantWhere(ctx, { id: matchId })
  });
}

export async function listServiceMappingRules(
  ctx: AuthenticatedContext,
  operatingCompanyId?: string
) {
  await requireReadAccess(ctx);
  return prisma.quickBooksServiceMappingRule.findMany({
    where: tenantWhere(ctx, operatingCompanyId ? { operatingCompanyId } : {}),
    orderBy: [{ operatingCompanyId: "asc" }, { dimension: "asc" }, { priority: "desc" }]
  });
}

export async function listFxRates(ctx: AuthenticatedContext, currency?: string) {
  await requireReadAccess(ctx);
  return prisma.customerFxRate.findMany({
    where: tenantWhere(ctx, currency ? { currency } : {}),
    orderBy: [{ currency: "asc" }, { monthKey: "asc" }]
  });
}

export async function listRevenueLines(ctx: AuthenticatedContext, companyId?: string) {
  await requireReadAccess(ctx);
  return prisma.customerRevenueLine.findMany({
    where: tenantWhere(ctx, companyId ? { companyId } : {}),
    orderBy: [{ transactionDate: "desc" }]
  });
}

export async function listMonthlyFinancials(ctx: AuthenticatedContext, companyId?: string) {
  await requireReadAccess(ctx);
  return prisma.customerMonthlyFinancial.findMany({
    where: tenantWhere(ctx, companyId ? { companyId } : {}),
    orderBy: [{ monthKey: "desc" }]
  });
}

export type CustomerIntelligenceProfileSummary = {
  companyId: string;
  companyName: string;
  lifecycle: CustomerLifecycle;
  relationships: Array<{
    relationshipId: string;
    operatingCompanyId: string;
    operatingCompanySlug: string;
    operatingCompanyName: string;
    lifecycle: CustomerLifecycle;
    sourceAccountCount: number;
    activeSourceAccountCount: number;
  }>;
  sourceAccountCount: number;
  activeSourceAccountCount: number;
  activeRelationships: number;
  hasApprovedMapping: boolean;
};

export async function getCompanyIntelligenceSummary(
  ctx: AuthenticatedContext,
  companyId: string
): Promise<CustomerIntelligenceProfileSummary | null> {
  await requireReadAccess(ctx);

  const company = await prisma.company.findFirst({
    where: tenantWhere(ctx, { id: companyId }),
    select: { id: true, name: true }
  });

  if (!company) {
    return null;
  }

  const relationships = await prisma.companyOperatingRelationship.findMany({
    where: tenantWhere(ctx, { companyId }),
    include: {
      operatingCompany: true,
      sourceAccounts: {
        select: {
          id: true,
          active: true,
          status: true
        }
      }
    },
    orderBy: [{ operatingCompany: { displayName: "asc" } }]
  });

  const lifecycles = relationships.map((relationship) => relationship.lifecycle);
  const relationshipRows = relationships.map((relationship) => ({
    relationshipId: relationship.id,
    operatingCompanyId: relationship.operatingCompanyId,
    operatingCompanySlug: relationship.operatingCompany.slug,
    operatingCompanyName: relationship.operatingCompany.displayName,
    lifecycle: relationship.lifecycle,
    sourceAccountCount: relationship.sourceAccounts.length,
    activeSourceAccountCount: relationship.sourceAccounts.filter(
      (account) => account.active && account.status === CustomerSourceAccountStatus.ACTIVE
    ).length
  }));

  const sourceAccounts = await prisma.customerSourceAccount.count({
    where: tenantWhere(ctx, { companyId })
  });
  const activeSourceAccounts = await prisma.customerSourceAccount.count({
    where: tenantWhere(ctx, {
      companyId,
      active: true,
      status: CustomerSourceAccountStatus.ACTIVE
    })
  });

  return {
    companyId: company.id,
    companyName: company.name,
    lifecycle: rollupCompanyLifecycle(lifecycles),
    relationships: relationshipRows,
    sourceAccountCount: sourceAccounts,
    activeSourceAccountCount: activeSourceAccounts,
    activeRelationships: relationships.filter(
      (relationship) => relationship.status === "ACTIVE"
    ).length,
    hasApprovedMapping: relationships.length > 0
  };
}
