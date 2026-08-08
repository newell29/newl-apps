import {
  ContactPointType,
  ContactPointVerificationStatus,
  ContactSource,
  ContactStatus,
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  CustomerLifecycle,
  CustomerSourceAccountStatus,
  HunterServiceLine,
  HunterSignalStatus,
  HunterSignalType,
  LeadPipelineStage
} from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { requireReadAccess } from "@/modules/customer-intelligence/permissions";
import { rollupCompanyLifecycle } from "@/modules/customer-intelligence/lifecycle";
import {
  extractPotentialContactsFromEvidence,
  type PotentialContactEvidence
} from "@/modules/customer-intelligence/profile-evidence";

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

/**
 * Leadership review queue (CP-PHASE-02B-3): PROPOSED QUICKBOOKS_ACCOUNT
 * matches with their suggested canonical company and operating company. Every
 * read is tenant-scoped and leadership-only (requireReadAccess).
 */
export async function getIdentityReviewQueue(
  ctx: AuthenticatedContext,
  input?: { operatingCompanyId?: string }
) {
  await requireReadAccess(ctx);
  return prisma.customerIdentityMatch.findMany({
    where: tenantWhere(ctx, {
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED,
      ...(input?.operatingCompanyId ? { operatingCompanyId: input.operatingCompanyId } : {})
    }),
    include: {
      candidateCompany: true,
      operatingCompany: true
    },
    orderBy: [{ createdAt: "asc" }]
  });
}

export type IdentityReviewMetrics = {
  proposed: number;
  approved: number;
  rejected: number;
};

/** Counts of identity-match review states for the leadership queue page. */
export async function getIdentityReviewMetrics(
  ctx: AuthenticatedContext,
  input?: { operatingCompanyId?: string }
): Promise<IdentityReviewMetrics> {
  await requireReadAccess(ctx);
  const where = tenantWhere(ctx, {
    kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
    ...(input?.operatingCompanyId ? { operatingCompanyId: input.operatingCompanyId } : {})
  });
  const [proposed, approved, rejected] = await Promise.all([
    prisma.customerIdentityMatch.count({
      where: { ...where, status: CustomerIdentityMatchStatus.PROPOSED }
    }),
    prisma.customerIdentityMatch.count({
      where: { ...where, status: CustomerIdentityMatchStatus.APPROVED }
    }),
    prisma.customerIdentityMatch.count({
      where: { ...where, status: CustomerIdentityMatchStatus.REJECTED }
    })
  ]);
  return { proposed, approved, rejected };
}

/**
 * Tenant-scoped canonical companies for the identity-review approve control.
 * Every selectable target must belong to the authenticated tenant; the
 * server-side approval invariant validates the chosen id again before any
 * status update.
 */
export async function listTenantCompanies(ctx: AuthenticatedContext) {
  await requireReadAccess(ctx);
  return prisma.company.findMany({
    where: tenantWhere(ctx),
    select: {
      id: true,
      name: true,
      domain: true
    },
    orderBy: [{ name: "asc" }]
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

/**
 * CP-PHASE-02B-4: leadership-only matched-company directory. A matched company
 * is a canonical `Company` that has at least one operating-company
 * relationship. Every read is tenant-scoped (`tenantWhere`) and guarded by
 * `requireReadAccess`; SALES, OPERATIONS, and READ_ONLY stay excluded.
 */
export type CompanyDirectoryEntry = {
  companyId: string;
  companyName: string;
  domain: string | null;
  lifecycle: CustomerLifecycle;
  operatingCompanies: Array<{ id: string; slug: string; displayName: string }>;
  sourceAccountCount: number;
  activeSourceAccountCount: number;
  contactCount: number;
  leadStage: LeadPipelineStage | null;
  opportunitySignalCount: number;
  lastActivityAt: Date | null;
};

export async function listCompanyDirectory(
  ctx: AuthenticatedContext
): Promise<CompanyDirectoryEntry[]> {
  await requireReadAccess(ctx);

  const companies = await prisma.company.findMany({
    where: tenantWhere(ctx, { operatingRelationships: { some: {} } }),
    include: {
      operatingRelationships: {
        include: {
          operatingCompany: true,
          sourceAccounts: {
            select: {
              id: true,
              active: true,
              status: true
            }
          }
        }
      },
      contacts: { select: { id: true } },
      leads: { select: { stage: true } },
      hunterOpportunitySignals: { select: { id: true } }
    },
    orderBy: [{ name: "asc" }]
  });

  return companies.map((company) => {
    const relationships = company.operatingRelationships;
    const sourceAccounts = relationships.flatMap((relationship) => relationship.sourceAccounts);
    const lastActivityAt = relationships.reduce<Date | null>((latest, relationship) => {
      const candidate = relationship.updatedAt;
      if (!candidate) {
        return latest;
      }
      return !latest || candidate > latest ? candidate : latest;
    }, null);

    return {
      companyId: company.id,
      companyName: company.name,
      domain: company.domain,
      lifecycle: rollupCompanyLifecycle(relationships.map((relationship) => relationship.lifecycle)),
      operatingCompanies: relationships.map((relationship) => ({
        id: relationship.operatingCompany.id,
        slug: relationship.operatingCompany.slug,
        displayName: relationship.operatingCompany.displayName
      })),
      sourceAccountCount: sourceAccounts.length,
      activeSourceAccountCount: sourceAccounts.filter(
        (account) => account.active && account.status === CustomerSourceAccountStatus.ACTIVE
      ).length,
      contactCount: company.contacts.length,
      leadStage: company.leads[0]?.stage ?? null,
      opportunitySignalCount: company.hunterOpportunitySignals.length,
      lastActivityAt
    };
  });
}

/**
 * CP-PHASE-02B-4: leadership-only unmatched-company view. Unmatched rows are
 * PROPOSED `QUICKBOOKS_ACCOUNT` identity matches. A proposal remains unmatched
 * until it is approved, including when a reviewer has selected a non-null
 * companyId before deferring the decision.
 * Potential contacts are derived only from the stored identity-match evidence
 * (never from external calls or invented values) and remain suggestions until a
 * human approves the identity.
 */
export type UnmatchedCustomerEntry = {
  matchId: string;
  sourceLabel: string | null;
  sourceRecordKey: string | null;
  score: number;
  operatingCompany: { id: string; slug: string; displayName: string } | null;
  candidateCompany: { id: string; name: string; domain: string | null } | null;
  potentialContacts: PotentialContactEvidence[];
};

export async function getUnmatchedCustomerDirectory(
  ctx: AuthenticatedContext
): Promise<UnmatchedCustomerEntry[]> {
  await requireReadAccess(ctx);

  const matches = await prisma.customerIdentityMatch.findMany({
    where: tenantWhere(ctx, {
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED
    }),
    include: {
      operatingCompany: true,
      candidateCompany: true
    },
    orderBy: [{ createdAt: "asc" }]
  });

  return matches.map((match) => ({
    matchId: match.id,
    sourceLabel: match.sourceLabel,
    sourceRecordKey: match.sourceRecordKey,
    score: match.score,
    operatingCompany: match.operatingCompany
      ? {
          id: match.operatingCompany.id,
          slug: match.operatingCompany.slug,
          displayName: match.operatingCompany.displayName
        }
      : null,
    candidateCompany: match.candidateCompany
      ? {
          id: match.candidateCompany.id,
          name: match.candidateCompany.name,
          domain: match.candidateCompany.domain
        }
      : null,
    potentialContacts: extractPotentialContactsFromEvidence(match.evidence)
  }));
}

/**
 * CP-PHASE-02B-4: one canonical company profile assembled from existing
 * tenant-scoped foundation data — operating-company relationships and their
 * lifecycle, source accounts, contacts, identity-match status, the existing
 * sales-pipeline `Lead`, stored opportunity signals, and stored TradeMining
 * import-record evidence. Returns null for unknown or cross-tenant company IDs
 * so the detail page renders as not found.
 */
export type CompanyProfileDetail = {
  company: {
    id: string;
    name: string;
    domain: string | null;
    primaryIndustry: string | null;
  };
  lifecycle: CustomerLifecycle;
  relationships: Array<{
    relationshipId: string;
    operatingCompanyId: string;
    operatingCompanySlug: string;
    operatingCompanyName: string;
    lifecycle: CustomerLifecycle;
    status: "ACTIVE" | "INACTIVE";
    firstRevenueDate: Date | null;
    lastRevenueDate: Date | null;
    assignedOwnerUserId: string | null;
    notes: string | null;
    sourceAccounts: Array<{
      id: string;
      displayName: string;
      currency: string;
      active: boolean;
      status: CustomerSourceAccountStatus;
      email: string | null;
      phone: string | null;
      lastSyncedAt: Date | null;
    }>;
    approvedMatchCount: number;
  }>;
  contacts: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    fullName: string;
    title: string | null;
    department: string | null;
    email: string | null;
    phone: string | null;
    contactStatus: ContactStatus;
    source: ContactSource;
    contactPoints: Array<{
      id: string;
      type: ContactPointType;
      value: string;
      displayValue: string | null;
      primary: boolean;
      verificationStatus: ContactPointVerificationStatus;
      source: string | null;
    }>;
    evidenceCount: number;
  }>;
  identityMatches: Array<{
    id: string;
    kind: CustomerIdentityMatchKind;
    status: CustomerIdentityMatchStatus;
    score: number;
    sourceRecordKey: string | null;
    sourceLabel: string | null;
    operatingCompanyId: string | null;
    reviewedAt: Date | null;
  }>;
  lead: {
    id: string;
    stage: LeadPipelineStage;
    score: number;
    ownerUserId: string | null;
    notes: string | null;
    updatedAt: Date;
  } | null;
  opportunitySignals: Array<{
    id: string;
    signalType: HunterSignalType;
    serviceLine: HunterServiceLine;
    status: HunterSignalStatus;
    title: string;
    summary: string;
    observedAt: Date;
    confidence: number;
  }>;
  importRecords: Array<{
    id: string;
    rawRecordKey: string;
    importerName: string | null;
    consigneeName: string | null;
    shipperName: string | null;
    arrivalDate: Date | null;
    originCountry: string | null;
    sourcePort: string | null;
    productDescription: string | null;
  }>;
  sourceAccountCount: number;
};

export async function getCompanyProfileDetail(
  ctx: AuthenticatedContext,
  companyId: string
): Promise<CompanyProfileDetail | null> {
  await requireReadAccess(ctx);

  const company = await prisma.company.findFirst({
    where: tenantWhere(ctx, { id: companyId }),
    select: { id: true, name: true, domain: true, primaryIndustry: true }
  });

  if (!company) {
    return null;
  }

  const [relationships, contacts, identityMatches, lead, opportunitySignals, importRecords, sourceAccountCount] =
    await Promise.all([
      prisma.companyOperatingRelationship.findMany({
        where: tenantWhere(ctx, { companyId }),
        include: {
          operatingCompany: true,
          sourceAccounts: true
        },
        orderBy: [{ operatingCompany: { displayName: "asc" } }]
      }),
      prisma.contact.findMany({
        where: tenantWhere(ctx, { companyId }),
        include: {
          contactPoints: true,
          contactEvidence: {
            select: { id: true }
          }
        },
        orderBy: [{ fullName: "asc" }]
      }),
      prisma.customerIdentityMatch.findMany({
        where: tenantWhere(ctx, { companyId }),
        orderBy: [{ createdAt: "desc" }]
      }),
      prisma.lead.findFirst({
        where: tenantWhere(ctx, { companyId })
      }),
      prisma.hunterOpportunitySignal.findMany({
        where: tenantWhere(ctx, { companyId }),
        orderBy: [{ observedAt: "desc" }]
      }),
      prisma.tradeMiningImportRecord.findMany({
        where: tenantWhere(ctx, { companyId }),
        orderBy: [{ arrivalDate: "desc" }],
        take: 50
      }),
      prisma.customerSourceAccount.count({
        where: tenantWhere(ctx, { companyId })
      })
    ]);

  const approvedMatchCountByOperatingCompany = new Map<string, number>();
  for (const match of identityMatches) {
    if (
      match.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT &&
      match.status === CustomerIdentityMatchStatus.APPROVED &&
      match.operatingCompanyId
    ) {
      approvedMatchCountByOperatingCompany.set(
        match.operatingCompanyId,
        (approvedMatchCountByOperatingCompany.get(match.operatingCompanyId) ?? 0) + 1
      );
    }
  }

  return {
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain,
      primaryIndustry: company.primaryIndustry
    },
    lifecycle: rollupCompanyLifecycle(relationships.map((relationship) => relationship.lifecycle)),
    relationships: relationships.map((relationship) => ({
      relationshipId: relationship.id,
      operatingCompanyId: relationship.operatingCompanyId,
      operatingCompanySlug: relationship.operatingCompany.slug,
      operatingCompanyName: relationship.operatingCompany.displayName,
      lifecycle: relationship.lifecycle,
      status: relationship.status,
      firstRevenueDate: relationship.firstRevenueDate,
      lastRevenueDate: relationship.lastRevenueDate,
      assignedOwnerUserId: relationship.assignedOwnerUserId,
      notes: relationship.notes,
      sourceAccounts: relationship.sourceAccounts.map((account) => ({
        id: account.id,
        displayName: account.displayName,
        currency: account.currency,
        active: account.active,
        status: account.status,
        email: account.email,
        phone: account.phone,
        lastSyncedAt: account.lastSyncedAt
      })),
      approvedMatchCount: approvedMatchCountByOperatingCompany.get(relationship.operatingCompanyId) ?? 0
    })),
    contacts: contacts.map((contact) => ({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName,
      title: contact.title,
      department: contact.department,
      email: contact.email,
      phone: contact.phone,
      contactStatus: contact.contactStatus,
      source: contact.source,
      contactPoints: contact.contactPoints.map((point) => ({
        id: point.id,
        type: point.type,
        value: point.value,
        displayValue: point.displayValue,
        primary: point.primary,
        verificationStatus: point.verificationStatus,
        source: point.source
      })),
      evidenceCount: contact.contactEvidence.length
    })),
    identityMatches: identityMatches.map((match) => ({
      id: match.id,
      kind: match.kind,
      status: match.status,
      score: match.score,
      sourceRecordKey: match.sourceRecordKey,
      sourceLabel: match.sourceLabel,
      operatingCompanyId: match.operatingCompanyId,
      reviewedAt: match.reviewedAt
    })),
    lead: lead
      ? {
          id: lead.id,
          stage: lead.stage,
          score: lead.score,
          ownerUserId: lead.ownerUserId,
          notes: lead.notes,
          updatedAt: lead.updatedAt
        }
      : null,
    opportunitySignals: opportunitySignals.map((signal) => ({
      id: signal.id,
      signalType: signal.signalType,
      serviceLine: signal.serviceLine,
      status: signal.status,
      title: signal.title,
      summary: signal.summary,
      observedAt: signal.observedAt,
      confidence: signal.confidence
    })),
    importRecords: importRecords.map((record) => ({
      id: record.id,
      rawRecordKey: record.rawRecordKey,
      importerName: record.importerName,
      consigneeName: record.consigneeName,
      shipperName: record.shipperName,
      arrivalDate: record.arrivalDate,
      originCountry: record.originCountry,
      sourcePort: record.sourcePort,
      productDescription: record.productDescription
    })),
    sourceAccountCount
  };
}
