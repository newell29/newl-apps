import { JobStatus, Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { auditEntry } from "@/modules/customer-intelligence/audit";
import {
  materializeCustomerFinancials,
  type FinancialMaterializationDryRunSourceAccount,
  type FinancialMaterializationReport
} from "@/modules/customer-intelligence/financial-materialization";
import { requireIngestionAdmin } from "@/modules/customer-intelligence/permissions";
import {
  ingestQuickBooksCustomers,
  type QuickBooksIngestionDryRunState,
  type QuickBooksCustomerIngestionReport
} from "@/modules/customer-intelligence/quickbooks-ingestion";
import {
  evaluateReconciliationDryRun,
  type ReconciliationDryRunReport
} from "@/modules/customer-intelligence/reconciliation";

/**
 * Consolidated end-to-end dry-run verification (CP-PHASE-02B-7).
 *
 * One ADMIN-triggered entry point runs the three Customer Intelligence engines
 * — read-only QuickBooks customer ingestion, deterministic identity
 * reconciliation, and financial materialization — in dry-run mode and returns
 * a complete would-change report:
 *
 * - ingestion and materialization reuse their existing `dryRun: true` paths
 *   (zero data-model writes by contract);
 * - reconciliation uses the read-only `evaluateReconciliationDryRun`
 *   evaluator, which reports exactly the decision each PROPOSED match would
 *   receive from a live run without writing anything;
 * - the verification run itself is recorded through the existing
 *   tenant-scoped `AutomationJobRun` ledger (created RUNNING, completed
 *   SUCCESS) plus one sanitized `AuditLog` entry, mirroring the bulk-job run
 *   pattern. The job output and audit evidence carry counts and
 *   classifications only — never customer identifiers, source keys,
 *   transaction identifiers, amounts, or provider secrets.
 *
 * No schema change is introduced and the engine executes nothing live: no
 * Customer Intelligence data row is created, updated, upserted, or deleted by
 * any dry-run path. Live verification runs (including any future migration)
 * remain owner-approved operational work per the repository human-approval
 * boundaries and the documented dry-run validation runbook.
 */

/** The AutomationJobRun jobType used to record every consolidated dry-run verification. */
export const CUSTOMER_INTELLIGENCE_DRY_RUN_JOB_TYPE = "customer-intelligence.dry-run";

export type CustomerIntelligenceDryRunScope = {
  operatingCompanyId?: string;
  operatingCompanyCount: number;
};

export type CustomerIntelligenceDryRunReport = {
  tenantId: string;
  dryRun: true;
  startedAt: string;
  completedAt: string;
  scope: CustomerIntelligenceDryRunScope;
  /** The tenant-scoped run record written through the AutomationJobRun ledger. */
  runRecord: {
    jobRunId: string;
    jobType: string;
    status: JobStatus;
  };
  ingestion: QuickBooksCustomerIngestionReport;
  reconciliation: ReconciliationDryRunReport;
  materialization: FinancialMaterializationReport;
  zeroWrites: {
    /**
     * `true` by contract: every engine ran in dry-run mode. The zero-write
     * proof is asserted by the regression suite, which verifies that the only
     * writes ever performed are the run record (AutomationJobRun) and its
     * AuditLog entry.
     */
    provenByContract: true;
    /** Aggregate count of records the engines would change in a live run. */
    wouldChangeRecords: number;
  };
};

/**
 * Tenant-scoped, ADMIN-guarded, end-to-end dry-run verification. Runs the
 * three Customer Intelligence engines in dry-run mode, records the run through
 * the existing AutomationJobRun/AuditLog patterns, and returns the complete
 * would-change report. The guard is enforced here (defense in depth) and the
 * individual engines enforce their own guards.
 */
export async function runCustomerIntelligenceDryRun(
  ctx: AuthenticatedContext,
  input: { operatingCompanyId?: string } = {}
): Promise<CustomerIntelligenceDryRunReport> {
  await requireIngestionAdmin(ctx);

  if (input.operatingCompanyId) {
    const operatingCompany = await prisma.operatingCompany.findFirst({
      where: tenantWhere(ctx, { id: input.operatingCompanyId })
    });
    if (!operatingCompany) {
      throw new Error("Operating company does not exist in this tenant.");
    }
  }

  const startedAt = new Date().toISOString();
  const scoped = input.operatingCompanyId ? { operatingCompanyId: input.operatingCompanyId } : {};

  // Record the verification run first so every dry-run is traceable through
  // the tenant-scoped job ledger even if an engine fails unexpectedly.
  const jobRun = await prisma.automationJobRun.create({
    data: {
      tenantId: ctx.tenantId,
      jobType: CUSTOMER_INTELLIGENCE_DRY_RUN_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: { mode: "dry-run", ...scoped }
    }
  });

  let ingestion: QuickBooksCustomerIngestionReport;
  let reconciliation: ReconciliationDryRunReport;
  let materialization: FinancialMaterializationReport;
  try {
    // Carry would-be state forward in memory. Each engine still performs its
    // own tenant-scoped reads and zero writes, but downstream evaluation sees
    // the exact evidence the preceding live stage would have committed rather
    // than independently re-reading a stale persisted snapshot.
    const virtualIngestionState: QuickBooksIngestionDryRunState = {
      proposals: [],
      sourceAccounts: []
    };
    ingestion = await ingestQuickBooksCustomers(ctx, {
      ...scoped,
      dryRun: true,
      virtualState: virtualIngestionState
    });
    reconciliation = await evaluateReconciliationDryRun(ctx, {
      ...scoped,
      virtualMatches: virtualIngestionState.proposals.map((proposal) => ({
        ...proposal,
        evidence: proposal.evidence as Prisma.JsonValue
      }))
    });
    const virtualSourceAccounts = await buildVirtualSourceAccounts(
      ctx,
      virtualIngestionState,
      reconciliation
    );
    materialization = await materializeCustomerFinancials(ctx, {
      ...scoped,
      dryRun: true,
      virtualSourceAccounts
    });
  } catch {
    // Deterministic classification only; never copy arbitrary exception text
    // (which may carry provider content) into the job record.
    await prisma.automationJobRun.update({
      where: { id: jobRun.id, tenantId: ctx.tenantId },
      data: {
        status: JobStatus.ERROR,
        finishedAt: new Date(),
        errorMessage:
          "Customer Intelligence dry-run verification failed before completing all engines."
      }
    });
    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.dry-run.failed",
      entityType: "AutomationJobRun",
      entityId: jobRun.id,
      after: {
        dryRun: true,
        status: JobStatus.ERROR,
        classification: "ENGINE_EXECUTION_FAILED"
      }
    });
    throw new Error(
      "Customer Intelligence dry-run verification failed before completing all engines."
    );
  }

  const operatingCompanyCount = materialization.operatingCompanies.length;
  const wouldChangeRecords = countWouldChangeRecords(ingestion, reconciliation, materialization);

  const report: CustomerIntelligenceDryRunReport = {
    tenantId: ctx.tenantId,
    dryRun: true,
    startedAt,
    completedAt: new Date().toISOString(),
    scope: { ...scoped, operatingCompanyCount },
    runRecord: {
      jobRunId: jobRun.id,
      jobType: CUSTOMER_INTELLIGENCE_DRY_RUN_JOB_TYPE,
      status: JobStatus.SUCCESS
    },
    ingestion,
    reconciliation,
    materialization,
    zeroWrites: {
      provenByContract: true,
      wouldChangeRecords
    }
  };

  // The AutomationJobRun output and AuditLog evidence carry the sanitized
  // summary only (counts and classifications, never identifiers or secrets).
  const summary = buildDryRunSummary(report);

  await prisma.automationJobRun.update({
    where: { id: jobRun.id, tenantId: ctx.tenantId },
    data: {
      status: JobStatus.SUCCESS,
      finishedAt: new Date(),
      output: summary as Prisma.InputJsonValue
    }
  });

  await auditEntry({
    actor: ctx,
    action: "customer-intelligence.dry-run.completed",
    entityType: "AutomationJobRun",
    entityId: jobRun.id,
    after: summary
  });

  return report;
}

/**
 * Build the source-account view materialization would have after ingestion and
 * the reconciliation decisions reported in this same dry-run. No row is
 * written. Missing schema-required QuickBooks evidence still fails closed.
 */
async function buildVirtualSourceAccounts(
  ctx: AuthenticatedContext,
  ingestion: QuickBooksIngestionDryRunState,
  reconciliation: ReconciliationDryRunReport
): Promise<FinancialMaterializationDryRunSourceAccount[]> {
  const accounts: FinancialMaterializationDryRunSourceAccount[] = ingestion.sourceAccounts.map(
    (account) => ({ ...account })
  );
  const proposalsById = new Map(ingestion.proposals.map((proposal) => [proposal.id, proposal]));

  for (const outcome of reconciliation.matches) {
    if (outcome.wouldChangeTo !== "AUTO_LINKED" || !outcome.bestCandidateCompanyId) continue;
    const proposal = proposalsById.get(outcome.matchId);
    if (!proposal || proposal.tenantId !== ctx.tenantId) continue;
    const customer = proposal.normalizedCustomer;
    if (!customer.displayName || !customer.currency || customer.active === null) continue;

    const relationship = await prisma.companyOperatingRelationship.findFirst({
      where: tenantWhere(ctx, {
        companyId: outcome.bestCandidateCompanyId,
        operatingCompanyId: proposal.operatingCompanyId
      }),
      select: { id: true }
    });
    if (!relationship) continue;

    accounts.push({
      id: `dry-run-source:${proposal.operatingCompanyId}:${customer.realmId}:${customer.quickBooksCustomerId}`,
      tenantId: ctx.tenantId,
      operatingCompanyId: proposal.operatingCompanyId,
      realmId: customer.realmId,
      quickBooksCustomerId: customer.quickBooksCustomerId,
      companyId: outcome.bestCandidateCompanyId,
      companyOperatingRelationshipId: relationship.id,
      currency: customer.currency,
      displayName: customer.displayName
    });
  }

  return accounts;
}

/**
 * Aggregate count of records the three engines would create/update in a live
 * run. Counts are classifications only; no identifiers, amounts, or secrets
 * are involved.
 */
function countWouldChangeRecords(
  ingestion: QuickBooksCustomerIngestionReport,
  reconciliation: ReconciliationDryRunReport,
  materialization: FinancialMaterializationReport
): number {
  const ingestionChanges =
    ingestion.totals.matched +
    ingestion.totals.unmatchedProposed +
    ingestion.totals.unmatchedRefreshed;
  const reconciliationChanges =
    reconciliation.totals.autoLinked + reconciliation.totals.routedToReview;
  const materializationChanges =
    materialization.totals.revenueMaterialized +
    materialization.totals.monthlyRowsWritten +
    materialization.totals.relationshipsRefreshed;
  return ingestionChanges + reconciliationChanges + materializationChanges;
}

/** Sanitized summary shared by the AutomationJobRun output and the AuditLog. */
function buildDryRunSummary(report: CustomerIntelligenceDryRunReport) {
  return {
    dryRun: true,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    scope: report.scope,
    wouldChangeRecords: report.zeroWrites.wouldChangeRecords,
    engines: {
      ingestion: { totals: report.ingestion.totals },
      reconciliation: { totals: report.reconciliation.totals },
      materialization: { totals: report.materialization.totals }
    }
  };
}
