import {
  ContactStatus,
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
import { assertLiveSyncEnabled } from "@/modules/customer-intelligence/enablement";
import {
  ingestQuickBooksCustomers,
  type QuickBooksCustomerIngestionReport
} from "@/modules/customer-intelligence/quickbooks-ingestion";
import {
  materializeCustomerFinancials,
  type FinancialMaterializationReport
} from "@/modules/customer-intelligence/financial-materialization";
import {
  reconcileQuickBooksIdentityMatches,
  type IdentityReconciliationReport
} from "@/modules/customer-intelligence/reconciliation";
import { quickBooksLegalEntityToSlug } from "@/server/integrations/quickbooks";
import { QuickBooksAssociationError } from "@/modules/customer-intelligence/quickbooks-association-error";

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

/** Existing canonical Company key format used by seed and ingestion paths. */
function normalizeCanonicalCompanyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    throw new QuickBooksAssociationError(
      "REALM_INPUT_MISSING",
      "quickBooksRealmId is required."
    );
  }

  const operatingCompany = await prisma.operatingCompany.findFirst({
    where: tenantWhere(ctx, { id: input.operatingCompanyId })
  });
  if (!operatingCompany) {
    throw new QuickBooksAssociationError(
      "OPERATING_COMPANY_NOT_FOUND",
      "Operating company does not exist in this tenant."
    );
  }

  const credential = await prisma.integrationCredential.findFirst({
    where: tenantWhere(ctx, { id: input.quickBooksCredentialId })
  });
  if (!credential) {
    throw new QuickBooksAssociationError(
      "CREDENTIAL_NOT_FOUND",
      "QuickBooks credential does not exist in this tenant."
    );
  }
  if (credential.provider !== IntegrationProvider.QUICKBOOKS) {
    throw new QuickBooksAssociationError(
      "CREDENTIAL_PROVIDER_INVALID",
      "The selected credential is not a QuickBooks credential."
    );
  }
  if (credential.status !== IntegrationStatus.ACTIVE) {
    throw new QuickBooksAssociationError(
      "CREDENTIAL_INACTIVE",
      "The QuickBooks credential must be ACTIVE before it can be associated."
    );
  }

  const credentialRealmId = readCredentialRealmId(credential.publicConfig);
  if (!credentialRealmId) {
    throw new QuickBooksAssociationError(
      "CREDENTIAL_REALM_MISSING",
      "The QuickBooks credential does not store a realm ID."
    );
  }
  if (credentialRealmId !== realmId) {
    throw new QuickBooksAssociationError(
      "CREDENTIAL_REALM_MISMATCH",
      "quickBooksRealmId does not match the realm stored on the QuickBooks credential."
    );
  }
  const credentialOperatingCompanySlug = readCredentialOperatingCompanySlug(
    credential.publicConfig
  );
  if (!credentialOperatingCompanySlug) {
    throw new QuickBooksAssociationError(
      "CREDENTIAL_LEGAL_ENTITY_INVALID",
      "The QuickBooks credential does not store a supported legal entity."
    );
  }
  if (credentialOperatingCompanySlug !== operatingCompany.slug) {
    throw new QuickBooksAssociationError(
      "CREDENTIAL_LEGAL_ENTITY_MISMATCH",
      "The QuickBooks credential legal entity does not match the selected operating company."
    );
  }

  const before = {
    quickBooksRealmId: operatingCompany.quickBooksRealmId,
    quickBooksCredentialId: operatingCompany.quickBooksCredentialId
  };

  const associationLockKeys = [
    `customer-intelligence.quickbooks-credential:${ctx.tenantId}:${credential.id}`,
    `customer-intelligence.quickbooks-realm:${ctx.tenantId}:${credentialRealmId}`
  ].sort();

  try {
    return await prisma.$transaction(async (transaction) => {
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
        throw new QuickBooksAssociationError(
          "CONFLICT",
          "This QuickBooks credential or realm is already associated with another operating company in this tenant."
        );
      }

      const updated = await transaction.operatingCompany.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: operatingCompany.id } },
        data: {
          quickBooksRealmId: credentialRealmId,
          quickBooksCredentialId: credential.id
        }
      });
      try {
        await auditEntry({
          actor: ctx,
          action: "customer-intelligence.operating-company.quickbooks-associated",
          entityType: "OperatingCompany",
          entityId: operatingCompany.id,
          before,
          after: {
            quickBooksRealmId: updated.quickBooksRealmId,
            quickBooksCredentialId: updated.quickBooksCredentialId
          },
          client: transaction
        });
      } catch {
        throw new QuickBooksAssociationError(
          "AUDIT_FAILED",
          "The association audit record could not be written."
        );
      }

      return updated;
    });
  } catch (error) {
    if (error instanceof QuickBooksAssociationError) {
      throw error;
    }
    throw new QuickBooksAssociationError(
      "DATABASE_WRITE_FAILED",
      "The association transaction could not be completed."
    );
  }
}

function readCredentialRealmId(value: Prisma.JsonValue | null | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const config = value as Record<string, unknown>;
  return typeof config.realmId === "string" ? config.realmId : null;
}

function readCredentialOperatingCompanySlug(
  value: Prisma.JsonValue | null | undefined
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const legalEntity = (value as Record<string, unknown>).legalEntity;
  return typeof legalEntity === "string" ? quickBooksLegalEntityToSlug(legalEntity) : null;
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
 * Live sync (CP-PHASE-02B-8): a live run for an explicitly scoped operating
 * company refuses to run without an enabled, approval-carrying enablement
 * record for that operating company (`assertLiveSyncEnabled`, owner decision
 * CP-02B-8-Q1 `FEATURE_ENABLEMENT_RECORD`). Unscoped live runs skip unenabled
 * operating companies with an audited `SKIPPED_NOT_ENABLED` section; dry-run
 * verification stays available as the owner's zero-write preview tool.
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
  // Fail closed at the entry point for a live run explicitly scoped to one
  // operating company before any engine work; the engine enforces the same
  // gate per operating company for unscoped runs. The tenant-scoped existence
  // check runs first so a foreign or missing company id still fails with the
  // precise cross-tenant error before any gate evaluation.
  if (input.dryRun !== true && input.operatingCompanyId) {
    const scopedCompany = await prisma.operatingCompany.findFirst({
      where: tenantWhere(ctx, { id: input.operatingCompanyId })
    });
    if (!scopedCompany) {
      throw new Error("Operating company does not exist in this tenant.");
    }
    await assertLiveSyncEnabled(ctx, input.operatingCompanyId);
  }
  return ingestQuickBooksCustomers(ctx, input);
}

/**
 * Leadership-triggered deterministic identity reconciliation (CP-PHASE-02B-3).
 * ADMIN and FINANCE (requireMatchApproval) re-score the tenant's PROPOSED
 * QUICKBOOKS_ACCOUNT matches against canonical companies using only the
 * approved identity.ts scoring rules and route ambiguity to the leadership
 * review queue. The core enforces the same permission guards defensively.
 */
export async function runIdentityReconciliation(
  ctx: AuthenticatedContext,
  input: { operatingCompanyId?: string } = {}
): Promise<IdentityReconciliationReport> {
  await requireMatchApproval(ctx);
  return reconcileQuickBooksIdentityMatches(ctx, input);
}

/**
 * ADMIN-triggered financial materialization (CP-PHASE-02B-5). Materializes the
 * owner-approved GET-only QuickBooks report sources (PNL_DETAIL_PLUS_AGING)
 * into immutable CustomerRevenueLine rows, applies the existing deterministic
 * service-line mapping and Bank of Canada FX, aggregates CustomerMonthlyFinancial
 * under the existing monthly unique key, and refreshes lifecycle through the
 * existing guarded refreshRelationshipLifecycle action. Dry-run performs zero
 * database writes; no QuickBooks posting is performed.
 *
 * Live sync (CP-PHASE-02B-8): a live run for an explicitly scoped operating
 * company refuses to run without an enabled, approval-carrying enablement
 * record for that operating company (`assertLiveSyncEnabled`, owner decision
 * CP-02B-8-Q1 `FEATURE_ENABLEMENT_RECORD`). Unscoped live runs skip unenabled
 * operating companies with an audited `SKIPPED_NOT_ENABLED` section; dry-run
 * verification stays available as the owner's zero-write preview tool.
 */
export async function runFinancialMaterialization(
  ctx: AuthenticatedContext,
  input: { operatingCompanyId?: string; dryRun?: boolean } = {}
): Promise<FinancialMaterializationReport> {
  await requireIngestionAdmin(ctx);
  // Fail closed at the entry point for a live run explicitly scoped to one
  // operating company before any engine work; the engine enforces the same
  // gate per operating company for unscoped runs. The tenant-scoped existence
  // check runs first so a foreign or missing company id still fails with the
  // precise cross-tenant error before any gate evaluation.
  if (input.dryRun !== true && input.operatingCompanyId) {
    const scopedCompany = await prisma.operatingCompany.findFirst({
      where: tenantWhere(ctx, { id: input.operatingCompanyId })
    });
    if (!scopedCompany) {
      throw new Error("Operating company does not exist in this tenant.");
    }
    await assertLiveSyncEnabled(ctx, input.operatingCompanyId);
  }
  return materializeCustomerFinancials(ctx, input);
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
  relationshipId: string,
  options: { client?: Prisma.TransactionClient } = {}
) {
  await requireMatchApproval(ctx);
  await requireMutationAccess(ctx);

  const client = options.client ?? prisma;

  const relationship = await client.companyOperatingRelationship.findFirst({
    where: tenantWhere(ctx, { id: relationshipId })
  });
  if (!relationship) {
    throw new Error("Relationship does not exist in this tenant.");
  }

  const [recentRevenue, openArEvidence, sourceAccounts, approvedMapping] = await Promise.all([
    client.customerRevenueLine.count({
      where: tenantWhere(ctx, {
        companyId: relationship.companyId,
        operatingCompanyId: relationship.operatingCompanyId,
        transactionType: { in: ["Invoice", "Credit Memo"] },
        transactionDate: { gte: trailingMonthsAgo(12) }
      })
    }),
    client.customerMonthlyFinancial.count({
      where: tenantWhere(ctx, {
        companyOperatingRelationshipId: relationshipId,
        nativeOpenAr: { gt: 0 },
        monthKey: { gte: trailingMonthKey(12) }
      })
    }),
    client.customerSourceAccount.findMany({
      where: tenantWhere(ctx, { companyOperatingRelationshipId: relationshipId })
    }),
    client.customerIdentityMatch.count({
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

  const updated = await client.companyOperatingRelationship.update({
    where: { tenantId_id: { tenantId: ctx.tenantId, id: relationshipId } },
    data: { lifecycle }
  });

  await auditEntry({
    actor: ctx,
    action: "customer-intelligence.relationship.lifecycle-refreshed",
    entityType: "CompanyOperatingRelationship",
    entityId: relationshipId,
    before,
    after: updated,
    client
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

export type IdentityMatchReviewDecision = "APPROVE" | "REJECT" | "DEFER";

export type IdentityMatchReviewInput = {
  /**
   * Canonical target to persist with the review. For APPROVE this is required
   * (falls back to the match's stored companyId) and must exist in the
   * authenticated tenant. For REJECT a provided target is recorded as the
   * considered-but-rejected company after the same tenant validation.
   */
  companyId?: string;
  /**
   * Operating company for a QUICKBOOKS_ACCOUNT approval. Falls back to the
   * match's stored operatingCompanyId; a provided value must belong to the
   * tenant.
   */
  operatingCompanyId?: string;
  /** Human review note recorded in the match evidence. */
  note?: string;
};

/**
 * Manual leadership review of an identity match. Enforces the same shared
 * approval invariants as automatic approval (`identity-approval.ts`):
 *
 * - APPROVE requires a non-null, tenant-valid canonical companyId; a
 *   QUICKBOOKS_ACCOUNT approval requires a tenant-valid operatingCompanyId;
 *   one source can never be approved to two canonical companies. A target
 *   supplied here is persisted with the approval.
 * - REJECT records the reviewed decision (an optional tenant-valid target may
 *   be persisted as the considered-but-rejected company).
 * - DEFER returns the match to PROPOSED (reviewer identity/timestamp cleared)
 *   so it stays in the leadership review queue for a later decision.
 *
 * Every approval, rejection, and deferral writes an AuditLog entry.
 */
export async function reviewIdentityMatch(
  ctx: AuthenticatedContext,
  matchId: string,
  decision: IdentityMatchReviewDecision,
  input: IdentityMatchReviewInput = {}
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  // Read only the source coordinates needed to acquire the same lock as
  // ingestion/reconciliation. The authoritative row is re-read after locking.
  const lockCoordinates = await prisma.customerIdentityMatch.findFirst({
    where: tenantWhere(ctx, { id: matchId })
  });
  if (!lockCoordinates) {
    throw new Error("Identity match does not exist in this tenant.");
  }
  if (
    input.operatingCompanyId &&
    lockCoordinates.operatingCompanyId &&
    input.operatingCompanyId !== lockCoordinates.operatingCompanyId
  ) {
    throw new Error("A QuickBooks identity match cannot be moved to another operating company.");
  }

  return prisma.$transaction(async (transaction) => {
    if (
      lockCoordinates.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT &&
      lockCoordinates.operatingCompanyId &&
      lockCoordinates.sourceRecordKey
    ) {
      const lockKey = [
        "customer-intelligence.quickbooks-proposal",
        ctx.tenantId,
        lockCoordinates.operatingCompanyId,
        lockCoordinates.sourceRecordKey
      ].join(":");
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
      );
    } else {
      const lockKey = [
        "customer-intelligence.identity-match",
        ctx.tenantId,
        matchId
      ].join(":");
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
      );
    }

    const existing = await transaction.customerIdentityMatch.findFirst({
      where: tenantWhere(ctx, { id: matchId })
    });
    if (!existing) {
      throw new Error("Identity match does not exist in this tenant.");
    }
    if (
      input.operatingCompanyId &&
      existing.operatingCompanyId &&
      input.operatingCompanyId !== existing.operatingCompanyId
    ) {
      throw new Error("A QuickBooks identity match cannot be moved to another operating company.");
    }

    const evidenceBase =
      existing.evidence &&
      typeof existing.evidence === "object" &&
      !Array.isArray(existing.evidence)
        ? { ...(existing.evidence as Prisma.JsonObject) }
        : {};
    const evidence = input.note
      ? ({ ...evidenceBase, reviewNote: input.note } as Prisma.InputJsonValue)
      : toInputJson(existing.evidence);

    let updated;
    let action: string;
    if (decision === "APPROVE") {
      const companyId = input.companyId ?? existing.companyId;
      if (!companyId) {
        throw new Error("Cannot approve an identity match without a canonical company.");
      }
      const operatingCompanyId = input.operatingCompanyId ?? existing.operatingCompanyId;
      await assertCanApproveIdentityMatch(
        ctx,
        {
          kind: existing.kind,
          companyId,
          operatingCompanyId,
          candidateCompanyId: existing.candidateCompanyId
        },
        transaction
      );
      const conflicting = await findApprovedConflict(
        ctx,
        {
          kind: existing.kind,
          sourceRecordKey: existing.sourceRecordKey,
          companyId,
          selfId: existing.id
        },
        transaction
      );
      if (conflicting) {
        throw new Error("Source record is already approved to another canonical company.");
      }
      updated = await transaction.customerIdentityMatch.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: matchId } },
        data: {
          status: CustomerIdentityMatchStatus.APPROVED,
          companyId,
          operatingCompanyId,
          reviewerUserId: ctx.userId,
          reviewedAt: new Date(),
          evidence
        }
      });
      action = "customer-intelligence.identity-match.approved";
    } else if (decision === "REJECT") {
      const data: Prisma.CustomerIdentityMatchUncheckedUpdateInput = {
        status: CustomerIdentityMatchStatus.REJECTED,
        reviewerUserId: ctx.userId,
        reviewedAt: new Date(),
        evidence
      };
      if (input.companyId !== undefined) {
        await validateReferencedCompanies(
          ctx,
          {
            companyId: input.companyId,
            operatingCompanyId: input.operatingCompanyId ?? undefined,
            candidateCompanyId: existing.candidateCompanyId
          },
          transaction
        );
        data.companyId = input.companyId;
      }
      updated = await transaction.customerIdentityMatch.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: matchId } },
        data
      });
      action = "customer-intelligence.identity-match.rejected";
    } else {
      updated = await transaction.customerIdentityMatch.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: matchId } },
        data: {
          status: CustomerIdentityMatchStatus.PROPOSED,
          reviewerUserId: null,
          reviewedAt: null,
          evidence
        }
      });
      action = "customer-intelligence.identity-match.deferred";
    }

    await auditEntry({
      actor: ctx,
      action,
      entityType: "CustomerIdentityMatch",
      entityId: matchId,
      before: existing,
      after: updated,
      client: transaction
    });
    return updated;
  });
}

export type ApproveIdentityMatchWithNewCompanyInput = {
  /** Explicit reviewer-entered canonical name; source evidence is never used as a fallback. */
  companyName: string;
  domain?: string;
  operatingCompanyId?: string;
  note?: string;
  /** Deliberate human confirmation required by CP-02B-3-Q1. */
  confirmation: "CREATE_AND_APPROVE";
};

/**
 * Narrow MANUAL_ONLY path for an ADMIN/FINANCE reviewer to create a canonical
 * Company and approve an unmatched QuickBooks identity in one transaction.
 * Nothing is derived from the QuickBooks name: the canonical name is explicit
 * reviewer input, and the confirmation token prevents this path from being
 * called as an automatic fallback.
 */
export async function approveIdentityMatchWithNewCompany(
  ctx: AuthenticatedContext,
  matchId: string,
  input: ApproveIdentityMatchWithNewCompanyInput
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  if (input.confirmation !== "CREATE_AND_APPROVE") {
    throw new Error("Explicit confirmation is required to create and approve a canonical company.");
  }
  const companyName = input.companyName.trim();
  if (!companyName || companyName.length > 200) {
    throw new Error("Canonical company name is required and must be 200 characters or fewer.");
  }
  const normalizedName = normalizeCanonicalCompanyName(companyName);
  if (!normalizedName) {
    throw new Error("Canonical company name must contain letters or numbers.");
  }
  const domain = input.domain?.trim().toLowerCase() || null;
  if (domain && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error("Canonical company domain must be a valid hostname.");
  }

  const lockCoordinates = await prisma.customerIdentityMatch.findFirst({
    where: tenantWhere(ctx, { id: matchId })
  });
  if (!lockCoordinates) {
    throw new Error("Identity match does not exist in this tenant.");
  }
  if (
    input.operatingCompanyId &&
    lockCoordinates.operatingCompanyId &&
    input.operatingCompanyId !== lockCoordinates.operatingCompanyId
  ) {
    throw new Error("A QuickBooks identity match cannot be moved to another operating company.");
  }

  return prisma.$transaction(async (transaction) => {
    const operatingCompanyId = input.operatingCompanyId ?? lockCoordinates.operatingCompanyId;
    const lockKey =
      lockCoordinates.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT &&
      lockCoordinates.operatingCompanyId &&
      lockCoordinates.sourceRecordKey
        ? [
            "customer-intelligence.quickbooks-proposal",
            ctx.tenantId,
            lockCoordinates.operatingCompanyId,
            lockCoordinates.sourceRecordKey
          ].join(":")
        : ["customer-intelligence.identity-match", ctx.tenantId, matchId].join(":");
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
    );

    const existing = await transaction.customerIdentityMatch.findFirst({
      where: tenantWhere(ctx, { id: matchId })
    });
    if (!existing) {
      throw new Error("Identity match does not exist in this tenant.");
    }
    if (existing.status !== CustomerIdentityMatchStatus.PROPOSED) {
      throw new Error("Only a PROPOSED identity match can create a new canonical company.");
    }
    if (existing.kind !== CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT) {
      throw new Error("This company-creation approval is limited to QuickBooks identity review.");
    }
    if (
      existing.operatingCompanyId &&
      existing.operatingCompanyId !== operatingCompanyId
    ) {
      throw new Error("A QuickBooks identity match cannot be moved to another operating company.");
    }
    if (!operatingCompanyId) {
      throw new Error("operatingCompanyId is required for QUICKBOOKS_ACCOUNT identity matches.");
    }
    const operatingCompany = await transaction.operatingCompany.findFirst({
      where: tenantWhere(ctx, { id: operatingCompanyId })
    });
    if (!operatingCompany) {
      throw new Error("Operating company does not exist in this tenant.");
    }
    const duplicate = await transaction.company.findFirst({
      where: tenantWhere(ctx, { normalizedName })
    });
    if (duplicate) {
      throw new Error("A canonical company with this normalized name already exists; select it instead.");
    }
    const conflict = existing.sourceRecordKey
      ? await transaction.customerIdentityMatch.findFirst({
          where: tenantWhere(ctx, {
            kind: existing.kind,
            sourceRecordKey: existing.sourceRecordKey,
            status: CustomerIdentityMatchStatus.APPROVED,
            id: { not: existing.id }
          })
        })
      : null;
    if (conflict) {
      throw new Error("Source record is already approved to another canonical company.");
    }

    const company = await transaction.company.create({
      data: {
        tenantId: ctx.tenantId,
        name: companyName,
        normalizedName,
        domain,
        source: "CUSTOMER_INTELLIGENCE_IDENTITY_REVIEW"
      }
    });
    const relationship = await transaction.companyOperatingRelationship.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: company.id,
        operatingCompanyId,
        lifecycle: CustomerLifecycle.PROSPECT,
        status: "ACTIVE"
      }
    });
    const evidenceBase =
      existing.evidence && typeof existing.evidence === "object" && !Array.isArray(existing.evidence)
        ? { ...(existing.evidence as Prisma.JsonObject) }
        : {};
    const evidence = input.note?.trim()
      ? ({ ...evidenceBase, reviewNote: input.note.trim().slice(0, 500) } as Prisma.InputJsonValue)
      : toInputJson(existing.evidence);
    const updated = await transaction.customerIdentityMatch.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: matchId } },
      data: {
        companyId: company.id,
        candidateCompanyId: company.id,
        operatingCompanyId,
        status: CustomerIdentityMatchStatus.APPROVED,
        reviewerUserId: ctx.userId,
        reviewedAt: new Date(),
        evidence
      }
    });

    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.company.created-from-identity-review",
      entityType: "Company",
      entityId: company.id,
      after: { id: company.id, name: company.name, domain: company.domain },
      client: transaction
    });
    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.relationship.created",
      entityType: "CompanyOperatingRelationship",
      entityId: relationship.id,
      after: relationship,
      client: transaction
    });
    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.identity-match.approved",
      entityType: "CustomerIdentityMatch",
      entityId: matchId,
      before: existing,
      after: updated,
      client: transaction
    });
    return { company, relationship, match: updated };
  });
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
  },
  options: { client?: Prisma.TransactionClient } = {}
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const client = options.client ?? prisma;

  const company = await client.company.findFirst({
    where: tenantWhere(ctx, { id: input.companyId })
  });
  if (!company) {
    throw new Error("Company does not exist in this tenant.");
  }
  const operatingCompany = await client.operatingCompany.findFirst({
    where: tenantWhere(ctx, { id: input.operatingCompanyId })
  });
  if (!operatingCompany) {
    throw new Error("Operating company does not exist in this tenant.");
  }
  if (input.sourceAccountId) {
    const account = await client.customerSourceAccount.findFirst({
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

  const existing = await client.customerRevenueLine.findFirst({
    where: tenantWhere(ctx, { sourceKey: input.sourceKey })
  });

  if (existing) {
    return existing;
  }

  const record = await client.customerRevenueLine.create({
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
    // Audits carry classifications and counts only: never customer or
    // transaction identifiers, sourceKeys, amounts, or provider content.
    after: {
      serviceLine: record.serviceLine,
      nativeCurrency: record.nativeCurrency,
      homeCurrency: record.homeCurrency,
      fxSource: record.fxSource ?? undefined
    },
    client
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
    cadOpenAr?: number | null;
    reconciliationStatus?: "RECONCILED" | "INCOMPLETE" | "UNRECONCILED";
    preserveRevenue?: boolean;
  },
  options: { client?: Prisma.TransactionClient } = {}
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const client = options.client ?? prisma;

  const relationship = await client.companyOperatingRelationship.findFirst({
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
    const account = await client.customerSourceAccount.findFirst({
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

  const existing = await client.customerMonthlyFinancial.findFirst({
    where: tenantWhere(ctx, {
      companyOperatingRelationshipId: input.companyOperatingRelationshipId,
      sourceAccountKey,
      serviceLine: input.serviceLine,
      currency: input.currency,
      monthKey: input.monthKey
    })
  });

  const record = await client.customerMonthlyFinancial.upsert({
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
      nativeRevenue: input.preserveRevenue ? existing?.nativeRevenue ?? input.nativeRevenue : input.nativeRevenue,
      nativeCost: input.preserveRevenue
        ? existing?.nativeCost ?? input.nativeCost ?? 0
        : input.nativeCost ?? existing?.nativeCost ?? 0,
      nativeGrossProfit: input.preserveRevenue
        ? existing?.nativeGrossProfit ?? input.nativeGrossProfit ?? 0
        : input.nativeGrossProfit ?? existing?.nativeGrossProfit ?? 0,
      cadRevenue: input.preserveRevenue
        ? existing?.cadRevenue ?? input.cadRevenue ?? null
        : input.cadRevenue ?? existing?.cadRevenue ?? null,
      nativeOpenAr: input.nativeOpenAr ?? existing?.nativeOpenAr ?? 0,
      cadOpenAr: Object.prototype.hasOwnProperty.call(input, "cadOpenAr")
        ? input.cadOpenAr
        : existing?.cadOpenAr ?? null,
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

/** Contact-point value types accepted by the normalized ContactPoint writers. */
type EditableContactPointType = "EMAIL" | "PHONE" | "WEBSITE" | "ADDRESS" | "OTHER";

/**
 * Deterministic normalization shared by every ContactPoint writer so equivalent
 * emails and phone numbers deduplicate against one stored value key. Email is
 * trimmed and lowercased; phone keeps only its digits (a leading country code
 * "1" is stripped when it produces an 11-digit number); other values are
 * lowercased. An empty result means the value is not valid for its type.
 */
function normalizeContactPointValue(type: EditableContactPointType, rawValue: string): string {
  switch (type) {
    case "EMAIL":
      return normalizeEmail(rawValue);
    case "PHONE":
      return normalizePhone(rawValue);
    default:
      return rawValue.toLowerCase();
  }
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
  const value = normalizeContactPointValue(input.type, rawValue);
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

function deriveContactFullName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

/**
 * CP-PHASE-02B-4: guarded manual correction of a contact's details (name,
 * title, department, email, phone, and contact status) on the Customer Profile
 * UI. ADMIN/FINANCE only (requireMatchApproval + requireWrite); the contact and
 * its company must both exist in the caller's tenant or the update fails closed
 * before any write. The authoritative contact is locked and loaded inside the
 * transaction; only submitted fields are written, preventing omitted fields
 * from overwriting a concurrent correction.
 *
 * Email and phone corrections flow through the existing normalized ContactPoint
 * model: submitted values are normalized for deterministic deduplication, a
 * primary point records the corrected value, and the replaced point is retained
 * as prior evidence — never silently overwritten or deleted (design reference
 * `customer-profile-ui-design.md` lines 64-66). The contact row, the
 * contact-point corrections, and the AuditLog entry commit in one Prisma
 * transaction, so a manual correction can never persist unaudited.
 */
export async function updateContactDetails(
  ctx: AuthenticatedContext,
  input: {
    contactId: string;
    companyId: string;
    firstName?: string | null;
    lastName?: string | null;
    title?: string | null;
    department?: string | null;
    email?: string | null;
    phone?: string | null;
    contactStatus?: ContactStatus;
  }
) {
  await requireMatchApproval(ctx);
  await requireWrite(ctx);

  const cleanSubmitted = (value: string | null): string | null => {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  };

  return prisma.$transaction(async (transaction) => {
    // Lock the tenant-owned row before loading decision-critical values. This
    // makes the snapshot used for name derivation, ContactPoint retention, and
    // audit evidence authoritative for the remainder of this transaction.
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Contact" WHERE "tenantId" = ${ctx.tenantId} AND "companyId" = ${input.companyId} AND "id" = ${input.contactId} FOR UPDATE`
    );

    const contact = await transaction.contact.findFirst({
      where: tenantWhere(ctx, { id: input.contactId, companyId: input.companyId })
    });
    if (!contact) {
      throw new Error("Contact does not exist in this tenant for the given company.");
    }

    const firstName =
      input.firstName === undefined ? contact.firstName : cleanSubmitted(input.firstName);
    const lastName =
      input.lastName === undefined ? contact.lastName : cleanSubmitted(input.lastName);
    const email = input.email === undefined ? contact.email : cleanSubmitted(input.email);
    const phone = input.phone === undefined ? contact.phone : cleanSubmitted(input.phone);

    const nameWasSubmitted = input.firstName !== undefined || input.lastName !== undefined;
    const fullName = deriveContactFullName(firstName, lastName);
    if (nameWasSubmitted && !fullName) {
      throw new Error("Contact full name is required; clearing both first and last name is not allowed.");
    }

    const before = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName,
      title: contact.title,
      department: contact.department,
      email: contact.email,
      phone: contact.phone,
      contactStatus: contact.contactStatus
    };

    const updated = await transaction.contact.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: contact.id } },
      data: {
        ...(input.firstName !== undefined ? { firstName } : {}),
        ...(input.lastName !== undefined ? { lastName } : {}),
        ...(nameWasSubmitted ? { fullName } : {}),
        ...(input.title !== undefined ? { title: cleanSubmitted(input.title) } : {}),
        ...(input.department !== undefined
          ? { department: cleanSubmitted(input.department) }
          : {}),
        ...(input.email !== undefined ? { email } : {}),
        ...(input.phone !== undefined ? { phone } : {}),
        ...(input.contactStatus !== undefined ? { contactStatus: input.contactStatus } : {})
      }
    });

    // Submitted email/phone values are recorded as normalized ContactPoints.
    // The prior direct value is retained as evidence (never deleted) while the
    // corrected value becomes the primary point, so a replacement is a
    // reviewable correction rather than a silent rewrite of accepted facts.
    if (input.email !== undefined) {
      await applyContactPointCorrection(
        transaction,
        ctx,
        contact.id,
        contact.companyId,
        "EMAIL",
        contact.email,
        email,
        contact.source
      );
    }
    if (input.phone !== undefined) {
      await applyContactPointCorrection(
        transaction,
        ctx,
        contact.id,
        contact.companyId,
        "PHONE",
        contact.phone,
        phone,
        contact.source
      );
    }

    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.contact.details-updated",
      entityType: "Contact",
      entityId: contact.id,
      before,
      after: updated,
      client: transaction
    });

    return updated;
  });
}

/**
 * Record a corrected email/phone value as a normalized ContactPoint for the
 * contact. Deterministic deduplication uses the same normalized value key as
 * `upsertContactPoint`. A prior nonempty direct Contact value is first retained
 * as a non-primary point when replacement or clearing would otherwise erase
 * its only representation. A cleared value demotes every prior primary point;
 * otherwise the corrected point becomes primary and all other primary points
 * of the same type are demoted. No prior evidence is deleted.
 */
async function applyContactPointCorrection(
  transaction: Prisma.TransactionClient,
  ctx: AuthenticatedContext,
  contactId: string,
  companyId: string,
  type: "EMAIL" | "PHONE",
  priorValue: string | null,
  correctedValue: string | null,
  priorSource: string
): Promise<void> {
  const rawValue = correctedValue?.trim() ?? "";
  const value = rawValue ? normalizeContactPointValue(type, rawValue) : null;
  if (rawValue && !value) {
    throw new Error("Contact point value is not valid for its type.");
  }

  const rawPriorValue = priorValue?.trim() ?? "";
  const priorNormalizedValue = rawPriorValue
    ? normalizeContactPointValue(type, rawPriorValue)
    : null;
  if (rawPriorValue && !priorNormalizedValue) {
    throw new Error("Prior contact point value cannot be normalized and was not replaced.");
  }

  if (priorNormalizedValue && priorNormalizedValue !== value) {
    await transaction.contactPoint.upsert({
      where: {
        tenantId_contactId_type_value: {
          tenantId: ctx.tenantId,
          contactId,
          type,
          value: priorNormalizedValue
        }
      },
      update: { primary: false },
      create: {
        tenantId: ctx.tenantId,
        contactId,
        companyId,
        type,
        value: priorNormalizedValue,
        displayValue: rawPriorValue,
        primary: false,
        verificationStatus: "UNVERIFIED",
        source: priorSource
      }
    });
  }

  if (!value) {
    await transaction.contactPoint.updateMany({
      where: tenantWhere(ctx, { contactId, type, primary: true }),
      data: { primary: false }
    });
    return;
  }

  const existing = await transaction.contactPoint.findFirst({
    where: tenantWhere(ctx, { contactId, type, value })
  });

  const point = await transaction.contactPoint.upsert({
    where: {
      tenantId_contactId_type_value: {
        tenantId: ctx.tenantId,
        contactId,
        type,
        value
      }
    },
    update: {
      displayValue: rawValue,
      primary: true,
      lastSeenAt: new Date(),
      source: existing?.source ?? "MANUAL"
    },
    create: {
      tenantId: ctx.tenantId,
      contactId,
      companyId,
      type,
      value,
      displayValue: rawValue,
      primary: true,
      verificationStatus: "UNVERIFIED",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      source: "MANUAL"
    }
  });

  // Retain the replaced point as evidence: it is never deleted, only demoted.
  await transaction.contactPoint.updateMany({
    where: tenantWhere(ctx, {
      contactId,
      type,
      primary: true,
      id: { not: point.id }
    }),
    data: { primary: false }
  });
}
