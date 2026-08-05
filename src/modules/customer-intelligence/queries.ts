import { CustomerIdentityMatchKind, CustomerIdentityMatchStatus, CustomerLifecycle, CustomerSourceAccountStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { rollupCompanyLifecycle } from "@/modules/customer-intelligence/lifecycle";

export async function listOperatingCompanies(tenant: TenantContext) {
  return prisma.operatingCompany.findMany({
    where: tenantWhere(tenant),
    orderBy: [{ active: "desc" }, { displayName: "asc" }]
  });
}

export async function getOperatingCompany(tenant: TenantContext, operatingCompanyId: string) {
  return prisma.operatingCompany.findFirst({
    where: tenantWhere(tenant, { id: operatingCompanyId })
  });
}

export async function listRelationshipsForCompany(tenant: TenantContext, companyId: string) {
  return prisma.companyOperatingRelationship.findMany({
    where: tenantWhere(tenant, { companyId }),
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

export async function getRelationship(tenant: TenantContext, relationshipId: string) {
  return prisma.companyOperatingRelationship.findFirst({
    where: tenantWhere(tenant, { id: relationshipId }),
    include: {
      operatingCompany: true,
      sourceAccounts: true
    }
  });
}

export async function listSourceAccountsForCompany(tenant: TenantContext, companyId: string) {
  return prisma.customerSourceAccount.findMany({
    where: tenantWhere(tenant, { companyId }),
    include: {
      operatingCompany: true,
      relationship: true
    },
    orderBy: [{ displayName: "asc" }]
  });
}

export async function listSourceAccountsForRelationship(
  tenant: TenantContext,
  relationshipId: string
) {
  return prisma.customerSourceAccount.findMany({
    where: tenantWhere(tenant, { companyOperatingRelationshipId: relationshipId }),
    include: {
      operatingCompany: true
    },
    orderBy: [{ currency: "asc" }, { displayName: "asc" }]
  });
}

export async function getSourceAccount(tenant: TenantContext, sourceAccountId: string) {
  return prisma.customerSourceAccount.findFirst({
    where: tenantWhere(tenant, { id: sourceAccountId }),
    include: {
      operatingCompany: true,
      relationship: true
    }
  });
}

export async function listContactPoints(tenant: TenantContext, contactId: string) {
  return prisma.contactPoint.findMany({
    where: tenantWhere(tenant, { contactId }),
    orderBy: [{ primary: "desc" }, { type: "asc" }, { value: "asc" }]
  });
}

export async function listContactEvidence(tenant: TenantContext, contactId: string) {
  return prisma.contactEvidence.findMany({
    where: tenantWhere(tenant, { contactId }),
    orderBy: [{ observedAt: "desc" }]
  });
}

export async function listIdentityMatches(
  tenant: TenantContext,
  input?: {
    status?: CustomerIdentityMatchStatus;
    kind?: CustomerIdentityMatchKind;
    companyId?: string;
  }
) {
  return prisma.customerIdentityMatch.findMany({
    where: tenantWhere(tenant, input ?? {}),
    orderBy: [{ createdAt: "desc" }]
  });
}

export async function getIdentityMatch(tenant: TenantContext, matchId: string) {
  return prisma.customerIdentityMatch.findFirst({
    where: tenantWhere(tenant, { id: matchId })
  });
}

export async function listServiceMappingRules(tenant: TenantContext, operatingCompanyId?: string) {
  return prisma.quickBooksServiceMappingRule.findMany({
    where: tenantWhere(tenant, operatingCompanyId ? { operatingCompanyId } : {}),
    orderBy: [{ operatingCompanyId: "asc" }, { dimension: "asc" }, { priority: "desc" }]
  });
}

export async function listFxRates(tenant: TenantContext, currency?: string) {
  return prisma.customerFxRate.findMany({
    where: tenantWhere(tenant, currency ? { currency } : {}),
    orderBy: [{ currency: "asc" }, { monthKey: "asc" }]
  });
}

export async function listRevenueLines(tenant: TenantContext, companyId?: string) {
  return prisma.customerRevenueLine.findMany({
    where: tenantWhere(tenant, companyId ? { companyId } : {}),
    orderBy: [{ transactionDate: "desc" }]
  });
}

export async function listMonthlyFinancials(tenant: TenantContext, companyId?: string) {
  return prisma.customerMonthlyFinancial.findMany({
    where: tenantWhere(tenant, companyId ? { companyId } : {}),
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
  tenant: TenantContext,
  companyId: string
): Promise<CustomerIntelligenceProfileSummary | null> {
  const company = await prisma.company.findFirst({
    where: tenantWhere(tenant, { id: companyId }),
    select: { id: true, name: true }
  });

  if (!company) {
    return null;
  }

  const relationships = await prisma.companyOperatingRelationship.findMany({
    where: tenantWhere(tenant, { companyId }),
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
    where: tenantWhere(tenant, { companyId })
  });
  const activeSourceAccounts = await prisma.customerSourceAccount.count({
    where: tenantWhere(tenant, {
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
