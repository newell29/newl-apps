"use client";

import { useActionState } from "react";

import { runCustomerIntelligenceDryRunPreviewAction } from "@/modules/customer-intelligence/dry-run-preview-actions";
import { EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE } from "@/modules/customer-intelligence/dry-run-preview-state";

type OperatingCompanyOption = {
  id: string;
  slug: string;
  displayName: string;
};

export function CustomerIntelligenceDryRunPreviewControl({
  operatingCompanies
}: {
  operatingCompanies: OperatingCompanyOption[];
}) {
  const [state, formAction, pending] = useActionState(
    runCustomerIntelligenceDryRunPreviewAction,
    EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE
  );
  const defaultCompany =
    operatingCompanies.find((company) => company.slug === "newl-usa") ?? operatingCompanies[0];

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-[minmax(15rem,1fr)_auto] md:items-end">
        <label className="grid gap-1 text-sm font-medium text-foreground">
          Operating company
          <select
            name="operatingCompanyId"
            required
            defaultValue={defaultCompany?.id}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {operatingCompanies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.displayName}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending || operatingCompanies.length === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Running read-only preview…" : "Run production preview"}
        </button>
      </div>

      <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm leading-6 text-foreground">
        <input
          type="checkbox"
          name="confirmation"
          value="RUN_READ_ONLY_PREVIEW"
          required
          className="mt-1"
        />
        <span>
          I confirm this is a read-only QuickBooks preview for the selected company. It may write
          one AutomationJobRun and one sanitized AuditLog record, but it must not enable live sync
          or change Customer Intelligence customer or financial data.
        </span>
      </label>

      {pending ? (
        <p className="text-sm text-mutedForeground" role="status">
          QuickBooks is being inspected. This can take several minutes; keep this page open.
        </p>
      ) : null}

      {state.message ? (
        <p
          className={`rounded-md border px-3 py-2 text-sm leading-6 ${
            state.status === "error"
              ? "border-danger/30 bg-danger/10 text-danger"
              : state.status === "warning"
                ? "border-warning/30 bg-warning/10 text-foreground"
                : "border-success/30 bg-success/10 text-foreground"
          }`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}

      {state.report ? <PreviewReport report={state.report} /> : null}
    </form>
  );
}
export function PreviewReport({
  report
}: {
  report: NonNullable<
    typeof EMPTY_CUSTOMER_INTELLIGENCE_DRY_RUN_PREVIEW_STATE.report
  >;
}) {
  return (
    <div className="space-y-4 rounded-md border border-border bg-background p-4">
      <div>
        <h3 className="font-semibold text-foreground">{report.operatingCompanyName}</h3>
        <p className="text-xs text-mutedForeground">
          Run {report.runRecordId} · {report.wouldChangeRecords} records would change
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <PreviewGroup
          title={`Ingestion · ${report.ingestion.status}`}
          rows={[
            ["Customers fetched", report.ingestion.fetchedCustomers],
            ["Already matched", report.ingestion.matched],
            ["New review proposals", report.ingestion.unmatchedProposed],
            ["Refreshed proposals", report.ingestion.unmatchedRefreshed],
            ["Record errors", report.ingestion.recordErrors]
          ]}
        />
        <PreviewGroup
          title="Reconciliation"
          rows={[
            ["Evaluated", report.reconciliation.evaluated],
            ["Would auto-link", report.reconciliation.autoLinked],
            ["Would route to review", report.reconciliation.routedToReview],
            ["Errors", report.reconciliation.errors]
          ]}
        />
        <PreviewGroup
          title={`Financials · ${report.materialization.status}`}
          rows={[
            ["Revenue rows fetched", report.materialization.fetchedRevenueRows],
            ["AR rows fetched", report.materialization.fetchedAgingRows],
            ["Revenue rows would write", report.materialization.revenueMaterialized],
            ["AR rows would write", report.materialization.agingMaterialized],
            ["Incomplete months", report.materialization.incompleteMonths],
            ["Record errors", report.materialization.recordErrors]
          ]}
        />
      </div>
      {report.reconciliation.errorClassifications.length > 0 ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
          <h4 className="text-sm font-semibold text-foreground">
            Safe reconciliation diagnostics
          </h4>
          <p className="mt-1 text-xs leading-5 text-mutedForeground">
            These categories identify the engine boundary that failed. They contain no customer
            names, source records, database messages, or credentials.
          </p>
          <dl className="mt-2 space-y-1 text-xs text-mutedForeground">
            {report.reconciliation.errorClassifications.map(({ code, count }) => (
              <div key={code} className="flex justify-between gap-3">
                <dt>{reconciliationDiagnosticLabel(code)}</dt>
                <dd className="font-medium text-foreground">{count}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <p className="text-xs font-medium text-success">
        Verified dry-run contract: no Customer Intelligence customer or financial data writes.
      </p>
    </div>
  );
}

function reconciliationDiagnosticLabel(code: string): string {
  const labels: Record<string, string> = {
    DATABASE_SCHEMA_TABLE_MISSING: "Required database table is missing",
    DATABASE_SCHEMA_COLUMN_MISSING: "Required database column is missing",
    REVIEWED_DECISION_READ_FAILED: "Reviewed-decision lookup failed",
    OPERATING_RELATIONSHIP_READ_FAILED: "Operating-company relationships unavailable",
    CANONICAL_COMPANY_READ_FAILED: "Canonical-company candidates unavailable",
    APPROVED_MAPPING_READ_FAILED: "Approved identity mappings unavailable",
    EVIDENCE_SCORING_FAILED: "Identity evidence could not be scored",
    APPROVAL_INVARIANT_FAILED: "Automatic-approval safety check failed",
    APPROVED_CONFLICT_READ_FAILED: "Approved-match conflict check failed",
    PROCESSING_FAILED: "Unexpected reconciliation processing failure"
  };
  return labels[code] ?? "Unknown fail-closed reconciliation error";
}

function PreviewGroup({
  title,
  rows
}: {
  title: string;
  rows: Array<[label: string, value: number]>;
}) {
  return (
    <div className="rounded-md bg-muted/60 p-3">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <dl className="mt-2 space-y-1 text-xs text-mutedForeground">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt>{label}</dt>
            <dd className="font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
