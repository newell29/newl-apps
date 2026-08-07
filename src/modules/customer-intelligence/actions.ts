import {
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  CustomerIntelligenceServiceLine,
  CustomerLifecycle,
  CustomerSourceAccountStatus,
  IntegrationProvider,
  IntegrationStatus,
  Prisma,
  QuickBooksServiceMappingDimension
} from "@prisma/client";

import { prisma } from "@/server/db";
import { requireMutationAccess } from "@/server/auth/authorization";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { auditEntry } from "@/modules/customer-intelligence/audit";
import {
  computeRelationshipLifecycle,
  type RelationshipActivityInput
} from "@/modules/customer-intelligence/lifecycle";
import {
  computeIdentityMatchScore,
  normalizeEmail,
  normalizePhone,
  shouldAutoLink,
  type IdentityEvidenceInput
} from "@/modules/customer-intelligence/identity";
import {
  assertCanApproveIdentityMatch,
  findApprovedConflict,
  validateReferencedCompanies
} from "@/modules/customer-intelligence/identity-approval";
import {
  requireAdminSettings,
  requireIngestionAdmin,
  requireMatchApproval,
  requireWrite
} from "@/modules/customer-intelligence/permissions";
import {
  ingestQuickBooksCustomers,
  type QuickBooksCustomerIngestionReport
} from "@/modules/customer-intelligence/quickbooks-ingestion";

function toInputJson(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function registerOperatingCompany(
  ctx: AuthenticatedContext,
  input: {
    slug: string;
    displayName: string;
    legalName?: string;
    homeCurrency?: string;
    active?: boolean;
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
      active: input.active ?? true
    },
    create: {
      tenantId: ctx.tenantId,
      slug,
      displayName,
      legalName: input.legalName?.trim() || null,
      homeCurrency: input.homeCurrency ?? "CAD",
      active: input.active ?? true
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

/**
 * Associate a tenant-scoped, ACTIVE QuickBooks credential with an operating
 * company and persist the loose quickBooksCredentialId/quickBooksRealmId
 * references together. Validation is deterministic and tenant-scoped:
 *
 * - the operating company must belong to the caller's tenant;
 * - the credential must belong to the caller's tenant, use the QUICKBOOKS
 *   provider, and be ACTIVE;
 * - the provided quickBooksRealmId must equal the realm stored in the
 *   credential's publicConfig.
 *
 * Cross-tenant or mismatched references are rejected before any write. This is
 * an ADMIN-only settings mutation and every successful association writes an
 * AuditLog. Connecting a QuickBooks company never auto-enables live sync
 * (owner decision CP-02B-8-Q1); this phase only records the association.
 */
export async function associateQuickBooksCredential(
  ctx: AuthenticatedContext,
  input: {
    operatingCompanyId: string;
    quickBooksCredentialId: string;
    quickBooksRealmId: string;
  }
) {
  await requireAdminSettings(ctx);
  await requireWrite(ctx);

  const realmId = input.quickBooksRealmId.trim();
  if (!realmId) {
    throw new Error("quickBooksRealmId is required.");
  }

  const operatingCompany = await prisma.operatingCompany.findFirst({
    where: tenantWhere(ctx, { id: input.operatingCompanyId })
  });
  if (!operatingCompany) {
    throw new Error("Operating company does not exist in this tenant.");
  }

  const credential = await prisma.integrationCredential.findFirst({
    where: tenantWhere(ctx, { id: input.quickBooksCredentialId })
  });
  if (!credential) {
    throw new Error("QuickBooks credential does not exist in this tenant.");
  }
  if (credential.provider !== IntegrationProvider.QUICKBOOKS) {
    throw new Error("The selected credential is not a QuickBooks credential.");
  }
  if (credential.status !== IntegrationStatus.ACTIVE) {
    throw new Error("The QuickBooks credential must be ACTIVE before it can be associated.");
  }

  const credentialRealmId = readCredentialRealmId(credential.publicConfig);
  if (!credentialRealmId) {
    throw new Error("The QuickBooks credential does not store a realm ID.");
  }
  if (credentialRealmId !== realmId) {
    throw new Error("quickBooksRealmId does not match the realm stored on the QuickBooks credential.");
  }

  const before = {
    quickBooksRealmId: operatingCompany.quickBooksRealmId,
    quickBooksCredentialId: operatingCompany.quickBooksCredentialId
  };

  const associationLockKeys = [
    `customer-intelligence.quickbooks-credential:${ctx.tenantId}:${credential.id}`,
    `customer-intelligence.quickbooks-realm:${ctx.tenantId}:${credentialRealmId}`
  ].sort();

  const updated = await prisma.$transaction(async (transaction) => {
    // A credential and its realm identify one QuickBooks company. Serialize
    // association attempts for both keys so two operating companies cannot
    // concurrently claim the same connection without a schema migration.
    for (const lockKey of associationLockKeys) {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
      );
    }

    const conflictingAssociations =
      (await transaction.operatingCompany.findMany({
        where: tenantWhere(ctx, {
          id: { not: operatingCompany.id },
          OR: [
            { quickBooksCredentialId: credential.id },
            { quickBooksRealmId: credentialRealmId }
          ]
        }),
        select: {
          id: true,
          displayName: true,
          quickBooksCredentialId: true,
          quickBooksRealmId: true
        }
      })) ?? [];

    if (conflictingAssociations.length > 0) {
      throw new Error(
        "This QuickBooks credential or realm is already associated with another operating company in this tenant."
      );
    }

    return transaction.operatingCompany.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: operatingCompany.id } },
      data: {
        quickBooksRealmId: credentialRealmId,
        quickBooksCredentialId: credential.id
      }
    });
  });

  await auditEntry({
    actor: ctx,
    action: "customer-intelligence.operating-company.quickbooks-associated",
    entityType: "OperatingCompany",
    entityId: operatingCompany.id,
    before,
    after: {
      quickBooksRealmId: updated.quickBooksRealmId,
      quickBooksCredentialId: updated.quickBooksCredentialId
    }
  });

  return updated;
}

function readCredentialRealmId(value: Prisma.JsonValue | null | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const config = value as Record<string, unknown>;
  return typeof config.realmId === "string" ? config.realmId : null;
}

/**
 * ADMIN-triggered, tenant-scoped, read-only QuickBooks customer ingestion
 * (CP-PHASE-02B-2). GET-only toward QuickBooks: customer records are fetched
 * per associated operating company and persisted idempotently under the
 * owner-approved staging model:
 *
 * - matched customers upsert the tenant-scoped `CustomerSourceAccount` keyed by
 *   `(tenantId, realmId, quickBooksCustomerId)` and refresh `lastSyncedAt`;
 * - unmatched customers stay `PROPOSED` `CustomerIdentityMatch` rows with the
 *   available evidence (owner decision CP-02B-2-Q1, `MATCH_EVIDENCE`); no
 *   `Company` is created or approved (owner decision CP-02B-3-Q1,
 *   `MANUAL_ONLY`);
 * - reviewed identity decisions are never overwritten;
 * - `dryRun` performs zero database writes and returns the would-be report.
 *
 * Operating companies without an associated tenant-scoped, ACTIVE QuickBooks
 * credential are skipped with an audited warning. Every run writes an
 * `AuditLog` entry unless `dryRun` is true.
 */
export async function runQuickBooksCustomerIngestion(
  ctx: AuthenticatedContext,
  input: { operatingCompanyId?: string; dryRun?: boolean } = {}
): Promise<QuickBooksCustomerIngestionReport> {
  await requireIngestionAdmin(ctx);
  return ingestQuickBooksCustomers(ctx, input);
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
 * Deterministic lifecycle refresh for one relationship. Revenue and approved
 * QuickBooks mappings are scoped to the relationship's operating company so
 * activity under one operating company can never activate another. Open AR is
 * read from tenant-scoped, relationship-scoped CustomerMonthlyFinancial rows.
 */
export async function refreshRelationshipLifecycle(
  ctx: AuthenticatedContext,
  relationshipId: string
) {
  await requireMatchApproval(ctx);
  await requireMutationAccess(ctx);

  const relationship = await prisma.companyOperatingRelationship.findFirst({
    where: tenantWhere(ctx, { id: relationshipId })
  });
  if (!relationship) {
    throw new Error("Relationship does not exist in this tenant.");
  }

  const [recentRevenue, openArEvidence, sourceAccounts, approvedMapping] = await Promise.all([
    prisma.customerRevenueLine.count({
      where: tenantWhere(ctx, {
        companyId: relationship.companyId,
        operatingCompanyId: relationship.operatingCompanyId,
        transactionDate: { gte: trailingMonthsAgo(12) }
      })
    }),
    prisma.customerMonthlyFinancial.count({
      where: tenantWhere(ctx, {
        companyOperatingRelationshipId: relationshipId,
        nativeOpenAr: { gt: 0 },
        monthKey: { gte: trailingMonthKey(12) }
      })
    }),
    prisma.customerSourceAccount.findMany({
      where: tenantWhere(ctx, { companyOperatingRelationshipId: relationshipId })
    }),
    prisma.customerIdentityMatch.count({
      where: tenantWhere(ctx, {
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        status: CustomerIdentityMatchStatus.APPROVED,
        companyId: relationship.companyId,
        operatingCompanyId: relationship.operatingCompanyId
      })
    })
  ]);

  const activity: RelationshipActivityInput = {
    hasApprovedMapping: approvedMapping > 0 || sourceAccounts.length > 0,
    hasRevenueOrOpenArInLast12Months: recentRevenue > 0 || openArEvidence > 0,
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

/** Returns the "YYYY-MM" key for the month `months` before the current month. */
function trailingMonthKey(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
    email?: string | null;
    phone?: string | null;
    billingAddress?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    shippingAddress?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    parentQuickBooksCustomerId?: string | null;
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

  const lockKey = [
    "customer-intelligence.quickbooks-source-account",
    ctx.tenantId,
    input.realmId,
    input.quickBooksCustomerId
  ].join(":");

  const { existing, record } = await prisma.$transaction(async (transaction) => {
    // The ownership check and upsert must share one serialized transaction.
    // Otherwise two operating companies can both observe no row and the
    // losing upsert can overwrite the winner's ownership fields.
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
    );

    const existing = await transaction.customerSourceAccount.findFirst({
      where: tenantWhere(ctx, {
        realmId: input.realmId,
        quickBooksCustomerId: input.quickBooksCustomerId
      })
    });
    if (existing && existing.operatingCompanyId !== input.operatingCompanyId) {
      throw new Error(
        "A source account owned by another operating company cannot be moved or updated."
      );
    }

    const record = await transaction.customerSourceAccount.upsert({
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
        email: input.email === undefined ? existing?.email ?? null : input.email,
        phone: input.phone === undefined ? existing?.phone ?? null : input.phone,
        billingAddress: input.billingAddress ?? existing?.billingAddress ?? Prisma.JsonNull,
        shippingAddress: input.shippingAddress ?? existing?.shippingAddress ?? Prisma.JsonNull,
        parentQuickBooksCustomerId:
          input.parentQuickBooksCustomerId === undefined
            ? existing?.parentQuickBooksCustomerId ?? null
            : input.parentQuickBooksCustomerId,
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

    return { existing, record };
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
 * least 90, the input carries a canonical company, and there is no conflicting
 * approved canonical company for the same source record. A high-confidence
 * proposal without a canonical company remains PROPOSED (never APPROVED).
 * Every referenced company ID is validated within the caller's tenant.
 * Reviewed decisions are preserved: re-running with the same source record does
 * not overwrite an existing APPROVED or REJECTED match, and the
 * one-approved-per-source invariant is enforced both in code and by the
 * database backstop index.
 */
export async function proposeIdentityMatch(
  ctx: AuthenticatedContext,
  input: IdentityEvidenceInput & {
    kind: CustomerIdentityMatchKind;
    companyId: string | null;
    operatingCompanyId?: string;
    sourceRecordKey: string;
    sourceLabel?: string;
    candidateCompanyId?: string;
    evidence?: Prisma.InputJsonValue;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const sourceRecordKey = input.sourceRecordKey.trim();
  if (!sourceRecordKey) {
    throw new Error("Identity match sourceRecordKey is required.");
  }

  // QUICKBOOKS_ACCOUNT matches are operating-company-scoped so a mapping under
  // one operating company can never make another operating-company relationship
  // mapped or active.
  if (
    input.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT &&
    !input.operatingCompanyId
  ) {
    throw new Error("operatingCompanyId is required for QUICKBOOKS_ACCOUNT identity matches.");
  }

  // Validate every referenced canonical company within the caller's tenant
  // (PROPOSED matches may carry a null canonical company but never a
  // cross-tenant reference).
  await validateReferencedCompanies(ctx, {
    companyId: input.companyId,
    operatingCompanyId: input.operatingCompanyId,
    candidateCompanyId: input.candidateCompanyId
  });

  const score = computeIdentityMatchScore(input);
  const existing = await prisma.customerIdentityMatch.findFirst({
    where: tenantWhere(ctx, {
      kind: input.kind,
      companyId: input.companyId,
      ...(input.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT
        ? { operatingCompanyId: input.operatingCompanyId }
        : {}),
      sourceRecordKey
    })
  });
  if (
    input.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT &&
    existing &&
    existing.operatingCompanyId !== input.operatingCompanyId
  ) {
    throw new Error(
      "QuickBooks match evidence owned by another operating company cannot be reused or moved."
    );
  }

  if (existing && existing.status !== CustomerIdentityMatchStatus.PROPOSED) {
    return existing;
  }

  // A canonical company is required for approval. Without it, a high-scoring
  // proposal stays PROPOSED so a human can assign the target.
  let status: CustomerIdentityMatchStatus = CustomerIdentityMatchStatus.PROPOSED;
  if (shouldAutoLink(score) && input.companyId) {
    await assertCanApproveIdentityMatch(ctx, {
      kind: input.kind,
      companyId: input.companyId,
      operatingCompanyId: input.operatingCompanyId,
      candidateCompanyId: input.candidateCompanyId
    });
    const conflicting = await findApprovedConflict(ctx, {
      kind: input.kind,
      sourceRecordKey,
      companyId: input.companyId,
      selfId: existing?.id
    });
    if (!conflicting) {
      status = CustomerIdentityMatchStatus.APPROVED;
    }
  }

  let record;
  try {
    if (existing) {
      record = await prisma.customerIdentityMatch.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: existing.id } },
        data: {
          score,
          status,
          operatingCompanyId: input.operatingCompanyId ?? existing.operatingCompanyId ?? null,
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
          operatingCompanyId: input.operatingCompanyId ?? null,
          sourceRecordKey,
          sourceLabel: input.sourceLabel ?? null,
          candidateCompanyId: input.candidateCompanyId ?? null,
          score,
          status,
          evidence: toInputJson(input.evidence)
        }
      });
    }
  } catch (error) {
    // The one-approved-per-source database index rejected a second approved
    // target (concurrent or repeated processing). Re-read the authoritative
    // approved match and return it so no two canonical targets can be approved.
    if (isUniqueConstraintError(error) && status === CustomerIdentityMatchStatus.APPROVED) {
      const approved = await prisma.customerIdentityMatch.findFirst({
        where: tenantWhere(ctx, {
          kind: input.kind,
          sourceRecordKey,
          status: CustomerIdentityMatchStatus.APPROVED
        })
      });
      if (approved) {
        return approved;
      }
    }
    throw error;
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

  // Manual approval enforces the same approval-invariant validator as
  // automatic approval: a canonical company is required, a QUICKBOOKS_ACCOUNT
  // approval requires an operating company, and one source cannot be approved
  // to two canonical companies.
  if (decision === "APPROVE") {
    await assertCanApproveIdentityMatch(ctx, {
      kind: existing.kind,
      companyId: existing.companyId,
      operatingCompanyId: existing.operatingCompanyId,
      candidateCompanyId: existing.candidateCompanyId
    });
    const companyId = existing.companyId;
    if (!companyId) {
      throw new Error("Cannot approve an identity match without a canonical company.");
    }
    const conflicting = await findApprovedConflict(ctx, {
      kind: existing.kind,
      sourceRecordKey: existing.sourceRecordKey,
      companyId,
      selfId: existing.id
    });
    if (conflicting) {
      throw new Error("Source record is already approved to another canonical company.");
    }
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
    nativeOpenAr?: number;
    cadOpenAr?: number;
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
      nativeOpenAr: input.nativeOpenAr ?? existing?.nativeOpenAr ?? 0,
      cadOpenAr: input.cadOpenAr ?? existing?.cadOpenAr ?? null,
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
      nativeOpenAr: input.nativeOpenAr ?? 0,
      cadOpenAr: input.cadOpenAr ?? null,
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

  const rawValue = input.value.trim();
  if (!rawValue) {
    throw new Error("Contact point value is required.");
  }

  // Store a normalized value (the unique key) so equivalent emails and phone
  // numbers deduplicate deterministically, and keep a human display value.
  let value: string;
  switch (input.type) {
    case "EMAIL":
      value = normalizeEmail(rawValue);
      break;
    case "PHONE":
      value = normalizePhone(rawValue);
      break;
    default:
      value = rawValue.toLowerCase();
      break;
  }
  if (!value) {
    throw new Error("Contact point value is not valid for its type.");
  }
  const displayValue = input.displayValue ?? rawValue;

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
      displayValue: input.displayValue ?? existing?.displayValue ?? displayValue,
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
      displayValue,
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

  const fieldValue = input.fieldValue.trim();
  if (!fieldValue) {
    throw new Error("Evidence fieldValue is required; empty extraction never invents a value.");
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

  if (!existing) {
    const record = await prisma.contactEvidence.create({
      data: {
        tenantId: ctx.tenantId,
        contactId: input.contactId,
        companyId: input.companyId,
        sourceType: input.sourceType,
        sourceRecordKey: input.sourceRecordKey,
        fieldName: input.fieldName,
        fieldValue,
        confidence: input.confidence,
        parserVersion: input.parserVersion ?? null,
        observedAt: input.observedAt,
        evidenceFragment
      }
    });
    return record;
  }

  const sameValue = existing.fieldValue === fieldValue;

  // A later extraction must never silently overwrite an accepted or manually
  // approved fact. Conflicting values enter a reviewable CONFLICT state while
  // the accepted fact (fieldValue) and its source evidence are preserved.
  if (existing.reviewStatus === "ACCEPTED" || existing.reviewStatus === "REJECTED") {
    if (sameValue) {
      return prisma.contactEvidence.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: existing.id } },
        data: {
          confidence: input.confidence,
          parserVersion: input.parserVersion ?? existing.parserVersion ?? null,
          observedAt: input.observedAt,
          evidenceFragment
        }
      });
    }
    return prisma.contactEvidence.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: existing.id } },
      data: {
        confidence: input.confidence,
        parserVersion: input.parserVersion ?? existing.parserVersion ?? null,
        observedAt: input.observedAt,
        evidenceFragment,
        reviewStatus: "CONFLICT",
        conflictingValue: fieldValue
      }
    });
  }

  if (existing.reviewStatus === "CONFLICT") {
    return prisma.contactEvidence.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: existing.id } },
      data: {
        confidence: input.confidence,
        parserVersion: input.parserVersion ?? existing.parserVersion ?? null,
        observedAt: input.observedAt,
        evidenceFragment,
        ...(sameValue ? {} : { conflictingValue: fieldValue })
      }
    });
  }

  // UNREVIEWED: a fresh extraction replaces the pending value; nothing was
  // accepted, so nothing is overwritten.
  return prisma.contactEvidence.update({
    where: { tenantId_id: { tenantId: ctx.tenantId, id: existing.id } },
    data: {
      fieldValue,
      confidence: input.confidence,
      parserVersion: input.parserVersion ?? existing.parserVersion ?? null,
      observedAt: input.observedAt,
      evidenceFragment,
      reviewStatus: "UNREVIEWED",
      conflictingValue: null
    }
  });
}
