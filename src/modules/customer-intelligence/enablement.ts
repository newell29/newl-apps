import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { auditEntry } from "@/modules/customer-intelligence/audit";
import {
  requireAdminSettings,
  requireReadAccess,
  requireWrite
} from "@/modules/customer-intelligence/permissions";

/**
 * Owner-controlled activation of live QuickBooks synchronization
 * (CP-PHASE-02B-8).
 *
 * Owner decision CP-02B-8-Q1 (`FEATURE_ENABLEMENT_RECORD`): live QuickBooks
 * synchronization must have a separate tenant-scoped and operating-company-
 * scoped enablement record. It defaults to disabled and requires explicit
 * owner approval recorded for audit. Connecting a QuickBooks company never
 * auto-enables live synchronization, and scheduling remains deferred until the
 * owner separately approves a cadence.
 *
 * The live sync entry points (read-only customer ingestion and financial
 * materialization) refuse to run for an operating company without an enabled
 * enablement record carrying recorded approval evidence. Dry-run verification
 * stays available for every operating company because it performs zero writes:
 * it is the owner's preview tool for building the evidence reviewed before a
 * live run is approved.
 */

/** Shared skip reason for an operating company that is not live-sync enabled. */
export const LIVE_SYNC_NOT_ENABLED_REASON =
  "Live QuickBooks synchronization is not enabled for this operating company; " +
  "an ADMIN must record explicit owner approval before live sync can run (CP-02B-8-Q1).";

/** Explicit human approval token required to enable live sync. */
export const LIVE_SYNC_APPROVAL_CONFIRMATION = "APPROVE_LIVE_SYNC" as const;

type EnablementReadClient = Pick<
  Prisma.TransactionClient,
  "customerIntelligenceEnablement"
>;

/**
 * Deterministic gate predicate over the stored enablement record. A record is
 * "enabled" only when it is explicitly enabled AND carries recorded owner
 * approval (approvedByUserId + approvedAt). The database CHECK constraint
 * makes any other combination impossible; this predicate is the code-level
 * mirror for records read from mocks or earlier states.
 */
export function isLiveSyncEnabled(
  record: { enabled: boolean; approvedByUserId: string | null; approvedAt: Date | null } | null | undefined
): boolean {
  return Boolean(
    record &&
      record.enabled === true &&
      record.approvedByUserId &&
      record.approvedAt
  );
}

/**
 * Read the tenant-scoped enablement record for an operating company. `null`
 * means no record exists yet — the default-off state for every operating
 * company.
 */
export async function getLiveSyncEnablement(
  ctx: AuthenticatedContext,
  operatingCompanyId: string,
  client: EnablementReadClient = prisma
) {
  await requireReadAccess(ctx);
  return client.customerIntelligenceEnablement.findFirst({
    where: tenantWhere(ctx, { operatingCompanyId })
  });
}

/**
 * List the tenant's live-sync enablement records (leadership read). Every
 * operating company is implicitly default-off when no row exists.
 */
export async function listLiveSyncEnablements(ctx: AuthenticatedContext) {
  await requireReadAccess(ctx);
  return prisma.customerIntelligenceEnablement.findMany({
    where: tenantWhere(ctx, {}),
    orderBy: [{ operatingCompanyId: "asc" }]
  });
}

/**
 * The fail-closed live-sync gate (CP-PHASE-02B-8). Returns `true` when the
 * operating company's enablement record is enabled with recorded approval.
 *
 * - `mode: "THROW"` (default) throws before any live sync work so an
 *   explicitly scoped run refuses to run for an unenabled operating company.
 * - `mode: "SKIP"` returns `false` so an unscoped run can skip unenabled
 *   operating companies with an audited `SKIPPED_NOT_ENABLED` section while
 *   continuing over the enabled ones.
 *
 * Dry-run paths never call this gate: they perform zero writes and preview
 * what a live run would do once enabled.
 */
export async function assertLiveSyncEnabled(
  ctx: AuthenticatedContext,
  operatingCompanyId: string,
  options: { mode?: "THROW" | "SKIP"; client?: EnablementReadClient } = {}
): Promise<boolean> {
  const client = options.client ?? prisma;
  const record = await client.customerIntelligenceEnablement.findFirst({
    where: tenantWhere(ctx, { operatingCompanyId })
  });
  if (isLiveSyncEnabled(record)) {
    return true;
  }
  if (options.mode === "SKIP") {
    return false;
  }
  throw new Error(LIVE_SYNC_NOT_ENABLED_REASON);
}

export type SetLiveSyncEnablementInput = {
  enabled: boolean;
  /**
   * Explicit human approval evidence for enabling live sync. Required (and
   * recorded on the row and in the audit trail) whenever `enabled` is true, so
   * the gate can always point at a recorded approval for the operating company.
   */
  confirmation?: typeof LIVE_SYNC_APPROVAL_CONFIRMATION;
  /** Optional free-form approval note stored as evidence (capped at 500). */
  note?: string;
};

/**
 * ADMIN-only enablement mutation (CP-PHASE-02B-8). Enablement changes are
 * audited and carry explicit approval evidence:
 *
 * - enabling requires the `APPROVE_LIVE_SYNC` confirmation token and records
 *   `approvedByUserId` / `approvedAt` / `approvalNote` on the row;
 * - disabling clears the approval evidence so a later enable always requires a
 *   fresh recorded approval;
 * - every change writes a tenant-scoped AuditLog entry with before/after state.
 *
 * The operating company must exist in the caller's tenant. This action never
 * auto-enables from a QuickBooks connection or any other fallback.
 */
export async function setLiveSyncEnablement(
  ctx: AuthenticatedContext,
  operatingCompanyId: string,
  input: SetLiveSyncEnablementInput
) {
  await requireAdminSettings(ctx);
  await requireWrite(ctx);

  const operatingCompany = await prisma.operatingCompany.findFirst({
    where: tenantWhere(ctx, { id: operatingCompanyId })
  });
  if (!operatingCompany) {
    throw new Error("Operating company does not exist in this tenant.");
  }

  const note = input.note?.trim().slice(0, 500) || null;

  if (input.enabled) {
    if (input.confirmation !== LIVE_SYNC_APPROVAL_CONFIRMATION) {
      throw new Error(
        "Explicit confirmation (APPROVE_LIVE_SYNC) is required to enable live QuickBooks synchronization."
      );
    }
  }

  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.customerIntelligenceEnablement.findFirst({
      where: tenantWhere(ctx, { operatingCompanyId })
    });
    const approvedAt = input.enabled ? new Date() : null;
    const record = await transaction.customerIntelligenceEnablement.upsert({
      where: {
        tenantId_operatingCompanyId: { tenantId: ctx.tenantId, operatingCompanyId }
      },
      update: input.enabled
        ? {
            enabled: true,
            approvedByUserId: ctx.userId,
            approvedAt,
            approvalNote: note,
            updatedByUserId: ctx.userId
          }
        : {
            enabled: false,
            approvedByUserId: null,
            approvedAt: null,
            approvalNote: null,
            updatedByUserId: ctx.userId
          },
      create: {
        tenantId: ctx.tenantId,
        operatingCompanyId,
        enabled: input.enabled,
        approvedByUserId: input.enabled ? ctx.userId : null,
        approvedAt,
        approvalNote: input.enabled ? note : null,
        updatedByUserId: ctx.userId
      }
    });
    await auditEntry({
      actor: ctx,
      action: input.enabled
        ? "customer-intelligence.enablement.enabled"
        : "customer-intelligence.enablement.disabled",
      entityType: "CustomerIntelligenceEnablement",
      entityId: record.id,
      before: existing ?? undefined,
      after: {
        tenantId: record.tenantId,
        operatingCompanyId: record.operatingCompanyId,
        enabled: record.enabled,
        approvedByUserId: input.enabled ? record.approvedByUserId : null,
        approvedAt: input.enabled ? record.approvedAt : null,
        approvalNote: input.enabled ? record.approvalNote : null
      },
      client: transaction
    });
    return record;
  });
}
