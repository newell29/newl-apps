"use server";

import { revalidatePath } from "next/cache";

import { runCustomerIntelligenceDryRun } from "@/modules/customer-intelligence/dry-run";
import {
  CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_CONFIRMATION,
  type CustomerIntelligenceDryRunPreviewState
} from "@/modules/customer-intelligence/dry-run-preview-state";
import { getOperatingCompany } from "@/modules/customer-intelligence/queries";
import { getAuthenticatedContext } from "@/server/tenant-context";

const REVIEW_PATH = "/customer-intelligence/review";

function errorState(message: string): CustomerIntelligenceDryRunPreviewState {
  return { status: "error", message };
}

/**
 * Run one explicitly scoped production preview. The consolidated engine
 * re-enforces ADMIN access, the tenant mutation gate, tenant ownership of the
 * operating company, and dry-run semantics. This wrapper never exposes the
 * detailed provider packet: its return value is counts and classifications
 * only.
 */
export async function runCustomerIntelligenceDryRunPreviewAction(
  _previousState: CustomerIntelligenceDryRunPreviewState,
  formData: FormData
): Promise<CustomerIntelligenceDryRunPreviewState> {
  const operatingCompanyId = String(formData.get("operatingCompanyId") ?? "").trim();
  const confirmation = String(formData.get("confirmation") ?? "");

  if (!operatingCompanyId) {
    return errorState("Select one operating company before running the preview.");
  }
  if (confirmation !== CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_CONFIRMATION) {
    return errorState("Confirm the read-only production preview before running it.");
  }

  try {
    const context = await getAuthenticatedContext();
    const operatingCompany = await getOperatingCompany(context, operatingCompanyId);
    if (!operatingCompany || !operatingCompany.active) {
      return errorState("The selected operating company is not active in this tenant.");
    }

    const report = await runCustomerIntelligenceDryRun(context, { operatingCompanyId });
    const ingestion = report.ingestion.operatingCompanies.find(
      (section) => section.operatingCompanyId === operatingCompanyId
    );
    const materialization = report.materialization.operatingCompanies.find(
      (section) => section.operatingCompanyId === operatingCompanyId
    );

    if (!ingestion || !materialization || report.scope.operatingCompanyCount !== 1) {
      return errorState(
        "The preview did not return exactly one operating-company result. No phase was enabled."
      );
    }

    const hasBlockingIssues =
      ingestion.status === "ERROR" ||
      report.ingestion.totals.recordErrors > 0 ||
      materialization.status === "ERROR" ||
      materialization.status === "LIMITATION" ||
      report.materialization.totals.recordErrors > 0 ||
      report.reconciliation.totals.errors > 0;
    const errorClassifications = Object.entries(
      report.reconciliation.totals.errorClassifications ?? {}
    )
      .filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && entry[1] > 0
      )
      .map(([code, count]) => ({ code, count }));

    revalidatePath(REVIEW_PATH);
    return {
      status: hasBlockingIssues ? "warning" : "success",
      message: hasBlockingIssues
        ? "Production preview completed safely but found blocking issues. Live sync remains disabled, and no Customer Intelligence customer or financial data was changed."
        : "Production preview completed. Only the dry-run ledger and audit record were written; no Customer Intelligence customer or financial data was changed.",
      report: {
        operatingCompanyName: operatingCompany.displayName,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        runRecordId: report.runRecord.jobRunId,
        zeroCustomerDataWrites: true,
        wouldChangeRecords: report.zeroWrites.wouldChangeRecords,
        ingestion: {
          status: ingestion.status,
          fetchedCustomers: report.ingestion.totals.fetchedCustomers,
          matched: report.ingestion.totals.matched,
          unmatchedProposed: report.ingestion.totals.unmatchedProposed,
          unmatchedRefreshed: report.ingestion.totals.unmatchedRefreshed,
          reviewedDecisionsPreserved: report.ingestion.totals.reviewedDecisionsPreserved,
          skipped: report.ingestion.totals.skipped,
          recordErrors: report.ingestion.totals.recordErrors
        },
        reconciliation: {
          evaluated: report.reconciliation.totals.evaluated,
          autoLinked: report.reconciliation.totals.autoLinked,
          routedToReview: report.reconciliation.totals.routedToReview,
          reviewedPreserved: report.reconciliation.totals.reviewedPreserved,
          errors: report.reconciliation.totals.errors,
          errorClassifications
        },
        materialization: {
          status: materialization.status,
          fetchedRevenueRows: report.materialization.totals.fetchedRevenueRows,
          fetchedAgingRows: report.materialization.totals.fetchedAgingRows,
          revenueMaterialized: report.materialization.totals.revenueMaterialized,
          agingMaterialized: report.materialization.totals.agingMaterialized,
          monthlyRowsWritten: report.materialization.totals.monthlyRowsWritten,
          incompleteMonths: report.materialization.totals.incompleteMonths,
          recordErrors: report.materialization.totals.recordErrors,
          limitationCompanies: report.materialization.totals.limitationCompanies,
          erroredCompanies: report.materialization.totals.erroredCompanies
        }
      }
    };
  } catch {
    // Fail closed without copying provider or credential error text into the
    // browser. The core dry-run records its own sanitized ERROR classification.
    return errorState(
      "Production preview failed safely. No live sync was enabled and no Customer Intelligence customer or financial data was changed. Reconnect QuickBooks if its access token has expired, then retry."
    );
  }
}
