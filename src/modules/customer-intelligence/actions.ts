import {
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  CustomerIntelligenceServiceLine,
  CustomerLifecycle,
  CustomerSourceAccountStatus,
  ModuleKey,
  PlatformRole,
  Prisma,
  QuickBooksServiceMappingDimension
} from "@prisma/client";

import { prisma } from "@/server/db";
import {
  requireModule,
  requireMutationAccess,
  requireRole
} from "@/server/auth/authorization";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { auditEntry } from "@/modules/customer-intelligence/audit";
import {
  computeRelationshipLifecycle,
  type RelationshipActivityInput
} from "@/modules/customer-intelligence/lifecycle";
import { computeIdentityMatchScore, shouldAutoLink, type IdentityEvidenceInput } from "@/modules/customer-intelligence/identity";

const LEADERSHIP_ROLES = [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE];

function toInputJson(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

/** Read access for Customer Intelligence is leadership-only in v1. */
async function requireReadAccess(ctx: AuthenticatedContext): Promise<void> {
  await requireModule(ctx, ModuleKey.CUSTOMER_INTELLIGENCE);
  requireRole(ctx, LEADERSHIP_ROLES);
}

/** Match/service-rule approval is ADMIN or FINANCE. */
async function requireMatchApproval(ctx: AuthenticatedContext): Promise<void> {
  await requireReadAccess(ctx);
  requireRole(ctx, [PlatformRole.ADMIN, PlatformRole.FINANCE]);
}

/** Operating-company, integration, mailbox, retention, and schedule settings are ADMIN. */
async function requireAdminSettings(ctx: AuthenticatedContext): Promise<void> {
  await requireReadAccess(ctx);
  requireRole(ctx, [PlatformRole.ADMIN]);
}

async function requireWrite(ctx: AuthenticatedContext): Promise<void> {
  await requireReadAccess(ctx);
  await requireMutationAccess(ctx);
}

export async function registerOperatingCompany(
  ctx: AuthenticatedContext,
  input: {
    slug: string;
    displayName: string;
    legalName?: string;
    homeCurrency?: string;
    active?: boolean;
    quickBooksRealmId?: string;
    quickBooksCredentialId?: string;
  }
) {
  await requireAdminSettings(ctx);
  await requireWrite(ctx);

  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error("Operating company slug must be lowercase letters, numbers, and hyphens.");
  }
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new Error("Operating company display name is required.");
  }

  const existing = await prisma.operatingCompany.findFirst({
    where: tenantWhere(ctx, { slug })
  });

  const record = await prisma.operatingCompany.upsert({
    where: {
      tenantId_slug: { tenantId: ctx.tenantId, slug }
    },
    update: {
      displayName,
      legalName: input.legalName?.trim() || null,
      homeCurrency: input.homeCurrency ?? "CAD",
      active: input.active ?? true,
      quickBooksRealmId: input.quickBooksRealmId?.trim() || null,
      quickBooksCredentialId: input.quickBooksCredentialId?.trim() || null
    },
    create: {
      tenantId: ctx.tenantId,
      slug,
      displayName,
      legalName: input.legalName?.trim() || null,
      homeCurrency: input.homeCurrency ?? "CAD",
      active: input.active ?? true,
      quickBooksRealmId: input.quickBooksRealmId?.trim() || null,
      quickBooksCredentialId: input.quickBooksCredentialId?.trim() || null
    }
  });

  await auditEntry({
    actor: ctx,
    action: existing ? "customer-intelligence.operating-company.updated" : "customer-intelligence.operating-company.created",
    entityType: "OperatingCompany",
    entityId: record.id,
    after: record
  });

  return record;
}

export async function upsertCompanyOperatingRelationship(
  ctx: AuthenticatedContext,
  input: {
    companyId: string;
    operatingCompanyId: string;
    lifecycle?: CustomerLifecycle;
    status?: "ACTIVE" | "INACTIVE";
    firstRevenueDate?: Date;
    lastRevenueDate?: Date;
    assignedOwnerUserId?: string;
    notes?: string;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const [company, operatingCompany] = await Promise.all([
    prisma.company.findFirst({ where: tenantWhere(ctx, { id: input.companyId }) }),
    prisma.operatingCompany.findFirst({
      where: tenantWhere(ctx, { id: input.operatingCompanyId })
    })
  ]);

  if (!company) {
    throw new Error("Company does not exist in this tenant.");
  }
  if (!operatingCompany) {
    throw new Error("Operating company does not exist in this tenant.");
  }

  const existing = await prisma.companyOperatingRelationship.findFirst({
    where: tenantWhere(ctx, {
      companyId: input.companyId,
      operatingCompanyId: input.operatingCompanyId
    })
  });

  const relationship = await prisma.companyOperatingRelationship.upsert({
    where: {
      tenantId_companyId_operatingCompanyId: {
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        operatingCompanyId: input.operatingCompanyId
      }
    },
    update: {
      lifecycle: input.lifecycle ?? existing?.lifecycle,
      status: input.status ?? existing?.status,
      firstRevenueDate: input.firstRevenueDate ?? existing?.firstRevenueDate ?? null,
      lastRevenueDate: input.lastRevenueDate ?? existing?.lastRevenueDate ?? null,
      assignedOwnerUserId: input.assignedOwnerUserId ?? existing?.assignedOwnerUserId ?? null,
      notes: input.notes ?? existing?.notes ?? null
    },
    create: {
      tenantId: ctx.tenantId,
      companyId: input.companyId,
      operatingCompanyId: input.operatingCompanyId,
      lifecycle: input.lifecycle ?? CustomerLifecycle.PROSPECT,
      status: input.status ?? "ACTIVE",
      firstRevenueDate: input.firstRevenueDate ?? null,
      lastRevenueDate: input.lastRevenueDate ?? null,
      assignedOwnerUserId: input.assignedOwnerUserId ?? null,
      notes: input.notes ?? null
    }
  });

  await auditEntry({
    actor: ctx,
    action: existing
      ? "customer-intelligence.relationship.updated"
      : "customer-intelligence.relationship.created",
    entityType: "CompanyOperatingRelationship",
    entityId: relationship.id,
    before: existing ?? undefined,
    after: relationship
  });

  return relationship;
}

/**
 * Deterministic lifecycle refresh for one relationship. Revenue activity comes
 * from tenant-scoped CustomerRevenueLine records; account inactivity comes from
 * the relationship's CustomerSourceAccount rows.
 */
export async function refreshRelationshipLifecycle(
  ctx: AuthenticatedContext,
  relationshipId: string
) {
  await requireMatchApproval(ctx);

  const relationship = await prisma.companyOperatingRelationship.findFirst({
    where: tenantWhere(ctx, { id: relationshipId })
  });
  if (!relationship) {
    throw new Error("Relationship does not exist in this tenant.");
  }

  const [recentRevenue, sourceAccounts, approvedMapping] = await Promise.all([
    prisma.customerRevenueLine.count({
      where: tenantWhere(ctx, {
        companyId: relationship.companyId,
        transactionDate: { gte: trailingMonthsAgo(12) }
      })
    }),
    prisma.customerSourceAccount.findMany({
      where: tenantWhere(ctx, { companyOperatingRelationshipId: relationshipId })
    }),
    prisma.customerIdentityMatch.count({
      where: tenantWhere(ctx, {
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        status: CustomerIdentityMatchStatus.APPROVED,
        companyId: relationship.companyId
      })
    })
  ]);

  const activity: RelationshipActivityInput = {
    hasApprovedMapping: approvedMapping > 0 || sourceAccounts.length > 0,
    hasRevenueOrOpenArInLast12Months: recentRevenue > 0,
    allSourceAccountsInactive:
      sourceAccounts.length > 0 &&
      sourceAccounts.every(
        (account) => !account.active || account.status !== CustomerSourceAccountStatus.ACTIVE
      )
  };

  const lifecycle = computeRelationshipLifecycle(activity);
  const before = relationship;

  const updated = await prisma.companyOperatingRelationship.update({
    where: { tenantId_id: { tenantId: ctx.tenantId, id: relationshipId } },
    data: { lifecycle }
  });

  await auditEntry({
    actor: ctx,
    action: "customer-intelligence.relationship.lifecycle-refreshed",
    entityType: "CompanyOperatingRelationship",
    entityId: relationshipId,
    before,
    after: updated
  });

  return updated;
}

function trailingMonthsAgo(months: number): Date {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

export async function upsertSourceAccount(
  ctx: AuthenticatedContext,
  input: {
    realmId: string;
    quickBooksCustomerId: string;
    companyId: string;
    operatingCompanyId: string;
    companyOperatingRelationshipId: string;
    currency?: string;
    displayName: string;
    active?: boolean;
    status?: CustomerSourceAccountStatus;
    email?: string;
    phone?: string;
    billingAddress?: Prisma.InputJsonValue;
    shippingAddress?: Prisma.InputJsonValue;
    parentQuickBooksCustomerId?: string;
    contactDetails?: Prisma.InputJsonValue;
    lastSyncedAt?: Date;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const relationship = await prisma.companyOperatingRelationship.findFirst({
    where: tenantWhere(ctx, {
      id: input.companyOperatingRelationshipId,
      companyId: input.companyId,
      operatingCompanyId: input.operatingCompanyId
    })
  });

  if (!relationship) {
    throw new Error(
      "Source account must map to a relationship that exists in this tenant for the same company and operating company."
    );
  }

  const existing = await prisma.customerSourceAccount.findFirst({
    where: tenantWhere(ctx, {
      realmId: input.realmId,
      quickBooksCustomerId: input.quickBooksCustomerId
    })
  });

  const record = await prisma.customerSourceAccount.upsert({
    where: {
      tenantId_realmId_quickBooksCustomerId: {
        tenantId: ctx.tenantId,
        realmId: input.realmId,
        quickBooksCustomerId: input.quickBooksCustomerId
      }
    },
    update: {
      companyId: input.companyId,
      operatingCompanyId: input.operatingCompanyId,
      companyOperatingRelationshipId: input.companyOperatingRelationshipId,
      currency: input.currency ?? existing?.currency ?? "CAD",
      displayName: input.displayName,
      active: input.active ?? existing?.active ?? true,
      status: input.status ?? existing?.status ?? CustomerSourceAccountStatus.ACTIVE,
      email: input.email ?? existing?.email ?? null,
      phone: input.phone ?? existing?.phone ?? null,
      billingAddress: input.billingAddress ?? existing?.billingAddress ?? Prisma.JsonNull,
      shippingAddress: input.shippingAddress ?? existing?.shippingAddress ?? Prisma.JsonNull,
      parentQuickBooksCustomerId:
        input.parentQuickBooksCustomerId ?? existing?.parentQuickBooksCustomerId ?? null,
      contactDetails: input.contactDetails ?? existing?.contactDetails ?? Prisma.JsonNull,
      lastSyncedAt: input.lastSyncedAt ?? existing?.lastSyncedAt ?? null
    },
    create: {
      tenantId: ctx.tenantId,
      realmId: input.realmId,
      quickBooksCustomerId: input.quickBooksCustomerId,
      companyId: input.companyId,
      operatingCompanyId: input.operatingCompanyId,
      companyOperatingRelationshipId: input.companyOperatingRelationshipId,
      currency: input.currency ?? "CAD",
      displayName: input.displayName,
      active: input.active ?? true,
      status: input.status ?? CustomerSourceAccountStatus.ACTIVE,
      email: input.email ?? null,
      phone: input.phone ?? null,
      billingAddress: input.billingAddress ?? Prisma.JsonNull,
      shippingAddress: input.shippingAddress ?? Prisma.JsonNull,
      parentQuickBooksCustomerId: input.parentQuickBooksCustomerId ?? null,
      contactDetails: input.contactDetails ?? Prisma.JsonNull,
      lastSyncedAt: input.lastSyncedAt ?? null
    }
  });

  await auditEntry({
    actor: ctx,
    action: existing ? "customer-intelligence.source-account.updated" : "customer-intelligence.source-account.created",
    entityType: "CustomerSourceAccount",
    entityId: record.id,
    before: existing ?? undefined,
    after: record
  });

  return record;
}

/**
 * Propose an identity match. Auto-links only when the deterministic score is at
 * least 90 and there is no conflicting approved canonical company for the same
 * source record. Reviewed decisions are preserved: re-running with the same
 * source record does not overwrite an existing APPROVED or REJECTED match.
 */
export async function proposeIdentityMatch(
  ctx: AuthenticatedContext,
  input: IdentityEvidenceInput & {
    kind: CustomerIdentityMatchKind;
    companyId: string | null;
    sourceRecordKey: string;
    sourceLabel?: string;
    candidateCompanyId?: string;
    evidence?: Prisma.InputJsonValue;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const score = computeIdentityMatchScore(input);
  const existing = await prisma.customerIdentityMatch.findFirst({
    where: tenantWhere(ctx, {
      kind: input.kind,
      companyId: input.companyId,
      sourceRecordKey: input.sourceRecordKey
    })
  });

  if (existing && existing.status !== CustomerIdentityMatchStatus.PROPOSED) {
    return existing;
  }

  const conflicting = input.companyId
    ? await prisma.customerIdentityMatch.findFirst({
        where: tenantWhere(ctx, {
          kind: input.kind,
          sourceRecordKey: input.sourceRecordKey,
          status: CustomerIdentityMatchStatus.APPROVED,
          companyId: { not: input.companyId }
        })
      })
    : null;

  const status =
    shouldAutoLink(score) && !conflicting
      ? CustomerIdentityMatchStatus.APPROVED
      : CustomerIdentityMatchStatus.PROPOSED;

  let record;
  if (existing) {
    record = await prisma.customerIdentityMatch.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: existing.id } },
      data: {
        score,
        status,
        sourceLabel: input.sourceLabel ?? existing.sourceLabel ?? null,
        candidateCompanyId: input.candidateCompanyId ?? existing.candidateCompanyId ?? null,
        evidence: toInputJson(input.evidence ?? existing.evidence)
      }
    });
  } else {
    record = await prisma.customerIdentityMatch.create({
      data: {
        tenantId: ctx.tenantId,
        kind: input.kind,
        companyId: input.companyId,
        sourceRecordKey: input.sourceRecordKey,
        sourceLabel: input.sourceLabel ?? null,
        candidateCompanyId: input.candidateCompanyId ?? null,
        score,
        status,
        evidence: toInputJson(input.evidence)
      }
    });
  }

  if (!existing || existing.status !== record.status) {
    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.identity-match.proposed",
      entityType: "CustomerIdentityMatch",
      entityId: record.id,
      before: existing ?? undefined,
      after: record
    });
  }

  return record;
}

export async function reviewIdentityMatch(
  ctx: AuthenticatedContext,
  matchId: string,
  decision: "APPROVE" | "REJECT",
  note?: string
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const existing = await prisma.customerIdentityMatch.findFirst({
    where: tenantWhere(ctx, { id: matchId })
  });
  if (!existing) {
    throw new Error("Identity match does not exist in this tenant.");
  }

  const status =
    decision === "APPROVE"
      ? CustomerIdentityMatchStatus.APPROVED
      : CustomerIdentityMatchStatus.REJECTED;

  const evidenceBase =
    existing.evidence && typeof existing.evidence === "object" && !Array.isArray(existing.evidence)
      ? { ...(existing.evidence as Prisma.JsonObject) }
      : {};
  const evidence = note
    ? ({ ...evidenceBase, reviewNote: note } as Prisma.InputJsonValue)
    : toInputJson(existing.evidence);

  const updated = await prisma.customerIdentityMatch.update({
    where: { tenantId_id: { tenantId: ctx.tenantId, id: matchId } },
    data: {
      status,
      reviewerUserId: ctx.userId,
      reviewedAt: new Date(),
      evidence
    }
  });

  await auditEntry({
    actor: ctx,
    action:
      decision === "APPROVE"
        ? "customer-intelligence.identity-match.approved"
        : "customer-intelligence.identity-match.rejected",
    entityType: "CustomerIdentityMatch",
    entityId: matchId,
    before: existing,
    after: updated
  });

  return updated;
}

export async function upsertServiceMappingRule(
  ctx: AuthenticatedContext,
  input: {
    operatingCompanyId: string;
    dimension: QuickBooksServiceMappingDimension;
    matchValue: string;
    serviceLine: CustomerIntelligenceServiceLine;
    priority?: number;
    active?: boolean;
    notes?: string;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const operatingCompany = await prisma.operatingCompany.findFirst({
    where: tenantWhere(ctx, { id: input.operatingCompanyId })
  });
  if (!operatingCompany) {
    throw new Error("Operating company does not exist in this tenant.");
  }

  const matchValue = input.matchValue.trim();
  if (!matchValue) {
    throw new Error("Rule match value is required.");
  }

  const existing = await prisma.quickBooksServiceMappingRule.findFirst({
    where: tenantWhere(ctx, {
      operatingCompanyId: input.operatingCompanyId,
      dimension: input.dimension,
      matchValue
    })
  });

  const record = await prisma.quickBooksServiceMappingRule.upsert({
    where: {
      tenantId_operatingCompanyId_dimension_matchValue: {
        tenantId: ctx.tenantId,
        operatingCompanyId: input.operatingCompanyId,
        dimension: input.dimension,
        matchValue
      }
    },
    update: {
      serviceLine: input.serviceLine,
      priority: input.priority ?? existing?.priority ?? 0,
      active: input.active ?? existing?.active ?? true,
      notes: input.notes ?? existing?.notes ?? null,
      reviewerUserId: ctx.userId
    },
    create: {
      tenantId: ctx.tenantId,
      operatingCompanyId: input.operatingCompanyId,
      dimension: input.dimension,
      matchValue,
      serviceLine: input.serviceLine,
      priority: input.priority ?? 0,
      active: input.active ?? true,
      reviewerUserId: ctx.userId,
      notes: input.notes ?? null
    }
  });

  await auditEntry({
    actor: ctx,
    action: existing ? "customer-intelligence.service-rule.updated" : "customer-intelligence.service-rule.created",
    entityType: "QuickBooksServiceMappingRule",
    entityId: record.id,
    before: existing ?? undefined,
    after: record
  });

  return record;
}

export async function upsertFxRate(
  ctx: AuthenticatedContext,
  input: {
    currency: string;
    monthKey: string;
    rateToCad: number;
    status?: "PROVISIONAL" | "FINAL";
    source?: string;
    fetchedAt?: Date;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a three-letter code.");
  }
  if (!/^\d{4}-\d{2}$/.test(input.monthKey)) {
    throw new Error("monthKey must use YYYY-MM.");
  }

  const existing = await prisma.customerFxRate.findFirst({
    where: tenantWhere(ctx, { currency, monthKey: input.monthKey })
  });

  const record = await prisma.customerFxRate.upsert({
    where: {
      tenantId_currency_monthKey: { tenantId: ctx.tenantId, currency, monthKey: input.monthKey }
    },
    update: {
      rateToCad: input.rateToCad,
      status: input.status ?? existing?.status ?? "PROVISIONAL",
      source: input.source ?? existing?.source ?? null,
      fetchedAt: input.fetchedAt ?? existing?.fetchedAt ?? new Date()
    },
    create: {
      tenantId: ctx.tenantId,
      currency,
      monthKey: input.monthKey,
      rateToCad: input.rateToCad,
      status: input.status ?? "PROVISIONAL",
      source: input.source ?? null,
      fetchedAt: input.fetchedAt ?? new Date()
    }
  });

  await auditEntry({
    actor: ctx,
    action: existing ? "customer-intelligence.fx-rate.updated" : "customer-intelligence.fx-rate.created",
    entityType: "CustomerFxRate",
    entityId: record.id,
    before: existing ?? undefined,
    after: record
  });

  return record;
}

/**
 * Idempotent immutable revenue-line upsert keyed by tenant-scoped sourceKey.
 * Re-running the same QuickBooks report line updates nothing and returns the
 * existing row, preserving review decisions and preventing silent rewrites.
 */
export async function recordRevenueLine(
  ctx: AuthenticatedContext,
  input: {
    realmId: string;
    sourceKey: string;
    sourceAccountId?: string;
    companyId: string;
    operatingCompanyId: string;
    transactionDate: Date;
    transactionType: string;
    transactionNumber?: string;
    accountRef?: string;
    classRef?: string;
    itemRef?: string;
    fileRef?: string;
    serviceLine: CustomerIntelligenceServiceLine;
    nativeAmount: number;
    nativeCurrency: string;
    homeAmount: number;
    homeCurrency: string;
    cadAmount?: number;
    fxSource?: string;
    syncMetadata?: Prisma.InputJsonValue;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const company = await prisma.company.findFirst({
    where: tenantWhere(ctx, { id: input.companyId })
  });
  if (!company) {
    throw new Error("Company does not exist in this tenant.");
  }
  const operatingCompany = await prisma.operatingCompany.findFirst({
    where: tenantWhere(ctx, { id: input.operatingCompanyId })
  });
  if (!operatingCompany) {
    throw new Error("Operating company does not exist in this tenant.");
  }
  if (input.sourceAccountId) {
    const account = await prisma.customerSourceAccount.findFirst({
      where: tenantWhere(ctx, {
        id: input.sourceAccountId,
        companyId: input.companyId,
        operatingCompanyId: input.operatingCompanyId
      })
    });
    if (!account) {
      throw new Error("Source account does not exist in this tenant for the given company.");
    }
  }

  const existing = await prisma.customerRevenueLine.findFirst({
    where: tenantWhere(ctx, { sourceKey: input.sourceKey })
  });

  if (existing) {
    return existing;
  }

  const record = await prisma.customerRevenueLine.create({
    data: {
      tenantId: ctx.tenantId,
      realmId: input.realmId,
      sourceKey: input.sourceKey,
      sourceAccountId: input.sourceAccountId ?? null,
      companyId: input.companyId,
      operatingCompanyId: input.operatingCompanyId,
      transactionDate: input.transactionDate,
      transactionType: input.transactionType,
      transactionNumber: input.transactionNumber ?? null,
      accountRef: input.accountRef ?? null,
      classRef: input.classRef ?? null,
      itemRef: input.itemRef ?? null,
      fileRef: input.fileRef ?? null,
      serviceLine: input.serviceLine,
      nativeAmount: input.nativeAmount,
      nativeCurrency: input.nativeCurrency,
      homeAmount: input.homeAmount,
      homeCurrency: input.homeCurrency,
      cadAmount: input.cadAmount ?? null,
      fxSource: input.fxSource ?? null,
      syncMetadata: input.syncMetadata ?? Prisma.JsonNull
    }
  });

  await auditEntry({
    actor: ctx,
    action: "customer-intelligence.revenue-line.created",
    entityType: "CustomerRevenueLine",
    entityId: record.id,
    after: record
  });

  return record;
}

export async function upsertMonthlyFinancial(
  ctx: AuthenticatedContext,
  input: {
    monthKey: string;
    companyId: string;
    operatingCompanyId: string;
    companyOperatingRelationshipId: string;
    sourceAccountId?: string;
    sourceAccountKey?: string;
    serviceLine: CustomerIntelligenceServiceLine;
    currency: string;
    nativeRevenue: number;
    nativeCost?: number;
    nativeGrossProfit?: number;
    cadRevenue?: number;
    reconciliationStatus?: "RECONCILED" | "INCOMPLETE" | "UNRECONCILED";
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const relationship = await prisma.companyOperatingRelationship.findFirst({
    where: tenantWhere(ctx, {
      id: input.companyOperatingRelationshipId,
      companyId: input.companyId,
      operatingCompanyId: input.operatingCompanyId
    })
  });
  if (!relationship) {
    throw new Error("Relationship does not exist in this tenant for the given company.");
  }
  if (input.sourceAccountId) {
    const account = await prisma.customerSourceAccount.findFirst({
      where: tenantWhere(ctx, {
        id: input.sourceAccountId,
        companyOperatingRelationshipId: input.companyOperatingRelationshipId
      })
    });
    if (!account) {
      throw new Error("Source account does not exist in this tenant for the relationship.");
    }
  }

  const sourceAccountKey = input.sourceAccountKey ?? input.sourceAccountId ?? "ALL";

  const existing = await prisma.customerMonthlyFinancial.findFirst({
    where: tenantWhere(ctx, {
      companyOperatingRelationshipId: input.companyOperatingRelationshipId,
      sourceAccountKey,
      serviceLine: input.serviceLine,
      currency: input.currency,
      monthKey: input.monthKey
    })
  });

  const record = await prisma.customerMonthlyFinancial.upsert({
    where: {
      tenantId_companyOperatingRelationshipId_sourceAccountKey_serviceLine_currency_monthKey: {
        tenantId: ctx.tenantId,
        companyOperatingRelationshipId: input.companyOperatingRelationshipId,
        sourceAccountKey,
        serviceLine: input.serviceLine,
        currency: input.currency,
        monthKey: input.monthKey
      }
    },
    update: {
      sourceAccountId: input.sourceAccountId ?? existing?.sourceAccountId ?? null,
      nativeRevenue: input.nativeRevenue,
      nativeCost: input.nativeCost ?? existing?.nativeCost ?? 0,
      nativeGrossProfit: input.nativeGrossProfit ?? existing?.nativeGrossProfit ?? 0,
      cadRevenue: input.cadRevenue ?? existing?.cadRevenue ?? null,
      reconciliationStatus:
        input.reconciliationStatus ?? existing?.reconciliationStatus ?? "UNRECONCILED"
    },
    create: {
      tenantId: ctx.tenantId,
      monthKey: input.monthKey,
      companyId: input.companyId,
      operatingCompanyId: input.operatingCompanyId,
      companyOperatingRelationshipId: input.companyOperatingRelationshipId,
      sourceAccountId: input.sourceAccountId ?? null,
      sourceAccountKey,
      serviceLine: input.serviceLine,
      currency: input.currency,
      nativeRevenue: input.nativeRevenue,
      nativeCost: input.nativeCost ?? 0,
      nativeGrossProfit: input.nativeGrossProfit ?? 0,
      cadRevenue: input.cadRevenue ?? null,
      reconciliationStatus: input.reconciliationStatus ?? "UNRECONCILED"
    }
  });

  return record;
}

export async function upsertContactPoint(
  ctx: AuthenticatedContext,
  input: {
    contactId: string;
    companyId: string;
    type: "EMAIL" | "PHONE" | "WEBSITE" | "ADDRESS" | "OTHER";
    value: string;
    displayValue?: string;
    label?: string;
    primary?: boolean;
    verificationStatus?: "UNVERIFIED" | "VERIFIED" | "REJECTED" | "EXPIRED";
    firstSeenAt?: Date;
    lastSeenAt?: Date;
    source?: string;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const contact = await prisma.contact.findFirst({
    where: tenantWhere(ctx, { id: input.contactId, companyId: input.companyId })
  });
  if (!contact) {
    throw new Error("Contact does not exist in this tenant for the given company.");
  }

  const value = input.value.trim();
  if (!value) {
    throw new Error("Contact point value is required.");
  }

  const existing = await prisma.contactPoint.findFirst({
    where: tenantWhere(ctx, {
      contactId: input.contactId,
      type: input.type,
      value
    })
  });

  const record = await prisma.contactPoint.upsert({
    where: {
      tenantId_contactId_type_value: {
        tenantId: ctx.tenantId,
        contactId: input.contactId,
        type: input.type,
        value
      }
    },
    update: {
      displayValue: input.displayValue ?? existing?.displayValue ?? null,
      label: input.label ?? existing?.label ?? null,
      primary: input.primary ?? existing?.primary ?? false,
      verificationStatus:
        input.verificationStatus ?? existing?.verificationStatus ?? "UNVERIFIED",
      firstSeenAt: input.firstSeenAt ?? existing?.firstSeenAt ?? new Date(),
      lastSeenAt: input.lastSeenAt ?? new Date(),
      source: input.source ?? existing?.source ?? null
    },
    create: {
      tenantId: ctx.tenantId,
      contactId: input.contactId,
      companyId: input.companyId,
      type: input.type,
      value,
      displayValue: input.displayValue ?? null,
      label: input.label ?? null,
      primary: input.primary ?? false,
      verificationStatus: input.verificationStatus ?? "UNVERIFIED",
      firstSeenAt: input.firstSeenAt ?? new Date(),
      lastSeenAt: input.lastSeenAt ?? new Date(),
      source: input.source ?? null
    }
  });

  return record;
}

export async function upsertContactEvidence(
  ctx: AuthenticatedContext,
  input: {
    contactId: string;
    companyId: string;
    sourceType: "EMAIL_SIGNATURE" | "QUICKBOOKS" | "MANUAL" | "APOLLO" | "WEBSITE" | "OTHER";
    sourceRecordKey: string;
    fieldName: string;
    fieldValue: string;
    confidence: number;
    parserVersion?: string;
    observedAt: Date;
    evidenceFragment?: string;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const contact = await prisma.contact.findFirst({
    where: tenantWhere(ctx, { id: input.contactId, companyId: input.companyId })
  });
  if (!contact) {
    throw new Error("Contact does not exist in this tenant for the given company.");
  }

  const evidenceFragment = input.evidenceFragment ?? null;
  if (evidenceFragment && evidenceFragment.length > 240) {
    throw new Error("Evidence fragments are capped at 240 characters.");
  }

  const existing = await prisma.contactEvidence.findFirst({
    where: tenantWhere(ctx, {
      contactId: input.contactId,
      sourceRecordKey: input.sourceRecordKey,
      fieldName: input.fieldName
    })
  });

  const record = await prisma.contactEvidence.upsert({
    where: {
      tenantId_contactId_sourceRecordKey_fieldName: {
        tenantId: ctx.tenantId,
        contactId: input.contactId,
        sourceRecordKey: input.sourceRecordKey,
        fieldName: input.fieldName
      }
    },
    update: {
      fieldValue: input.fieldValue,
      confidence: input.confidence,
      parserVersion: input.parserVersion ?? existing?.parserVersion ?? null,
      observedAt: input.observedAt,
      evidenceFragment
    },
    create: {
      tenantId: ctx.tenantId,
      contactId: input.contactId,
      companyId: input.companyId,
      sourceType: input.sourceType,
      sourceRecordKey: input.sourceRecordKey,
      fieldName: input.fieldName,
      fieldValue: input.fieldValue,
      confidence: input.confidence,
      parserVersion: input.parserVersion ?? null,
      observedAt: input.observedAt,
      evidenceFragment
    }
  });

  return record;
}
