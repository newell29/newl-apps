"use client";

import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import { UPS_SERVICE_OPTIONS } from "@/modules/ups-tools/constants";
import { parseCsv, toCsv } from "@/modules/ups-tools/csv";
import { roundMoney } from "@/modules/ups-tools/engine";
import { getShipmentReference } from "@/modules/ups-tools/upload";
import type {
  QuoteResult,
  UpsAccountConfig,
  UpsBulkQuoteJobDetail,
  UpsBulkQuoteJobSummary,
  UpsInputRow,
  UpsQuoteIssue,
  UpsServiceName
} from "@/modules/ups-tools/types";
import type { ManagedQuoteSource } from "@/modules/settings/types";

const SAMPLE_CSV = `CustomerOrderNumber,OriginZIP,DestinationZIP,Weight,Length,Width,Height
SO-1001,28273,10001,10,12,8,4
SO-1002,L5T1Z3,M5H2N2,5,10,6,4
`;

const SAMPLE_TEMPLATE_CSV = `CustomerOrderNumber,OriginZIP,DestinationZIP,Weight,Length,Width,Height
SO-1001,28273,10001,10,12,8,4
SO-1002,28273,30301,8,10,8,6
SO-1003,L5T1Z3,M5H2N2,5,10,6,4
`;

type UploadSummary = {
  fileName: string;
  totalRows: number;
  readyRows: number;
  rowsMissingDestination: number;
  rowsMissingWeight: number;
  rowsWithShipmentReference: number;
  rowsWithCompleteDims: number;
  rowsWithoutCompleteDims: number;
  processedAt: string;
};

export function ShipmentRateQuoteClient({
  accounts,
  liveBridgeEnabled,
  plannedSources,
  recentBulkJobs = []
}: {
  accounts: UpsAccountConfig[];
  liveBridgeEnabled: boolean;
  plannedSources: ManagedQuoteSource[];
  recentBulkJobs?: UpsBulkQuoteJobSummary[];
}) {
  const [activeView, setActiveView] = useState<"quote" | "saved">("quote");
  const [batchName, setBatchName] = useState("");
  const [uploadedRows, setUploadedRows] = useState<UpsInputRow[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(
    accounts.slice(0, 1).map((account) => account.id)
  );
  const [selectedServices, setSelectedServices] = useState<UpsServiceName[]>(["Ground"]);
  const [isResidential, setIsResidential] = useState(false);
  const [results, setResults] = useState<QuoteResult[]>([]);
  const [issues, setIssues] = useState<UpsQuoteIssue[]>([]);
  const [savedBulkJobs, setSavedBulkJobs] = useState<UpsBulkQuoteJobSummary[]>(recentBulkJobs);
  const [loadedJobSummary, setLoadedJobSummary] = useState<UpsBulkQuoteJobSummary | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [isReadingUpload, setIsReadingUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedAccounts = accounts.filter((account) => selectedAccountIds.includes(account.id));
  const comparisonAccounts = getComparisonAccounts(accounts, results, selectedAccountIds);
  const currentRunLabel = loadedJobSummary?.name ?? (batchName.trim().length > 0 ? batchName.trim() : undefined);

  function markDraftDirty() {
    setLoadedJobSummary(null);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setUploadedRows([]);
      setUploadSummary(null);
      markDraftDirty();
      return;
    }

    setIsReadingUpload(true);
    setError(null);
    void file
      .text()
      .then((text) => {
        const rows = parseCsv(text);
        const summary = buildUploadSummary(file.name, rows);
        markDraftDirty();
        setUploadedRows(rows);
        setUploadSummary(summary);
        setError(rows.length > 0 ? null : "The uploaded CSV did not contain any shipment rows.");
      })
      .catch((uploadError: unknown) => {
        setUploadedRows([]);
        setUploadSummary(null);
        setError(uploadError instanceof Error ? uploadError.message : "Unable to read the uploaded CSV.");
      })
      .finally(() => {
        setIsReadingUpload(false);
      });
  }

  function loadSampleRows() {
    const rows = parseCsv(SAMPLE_CSV);
    markDraftDirty();
    setUploadedRows(rows);
    setUploadSummary(buildUploadSummary("sample_shipments.csv", rows));
    setError(null);
  }

  function generateQuotes() {
    if (selectedAccounts.length === 0) {
      setError("Select at least one account before generating quotes.");
      return;
    }

    if (uploadedRows.length === 0) {
      setError("Upload a CSV before generating quotes.");
      return;
    }

    setError(null);
    setResults([]);
    setIssues([]);

    startTransition(() => {
      void fetch("/api/ups/bulk-jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: batchName,
          accountIds: selectedAccounts.map((account) => account.id),
          services: selectedServices,
          isResidential,
          rows: uploadedRows
        })
      })
        .then(async (response) => {
          const json = (await response.json().catch(() => null)) as
            | { job?: UpsBulkQuoteJobSummary; error?: string }
            | null;
          if (!response.ok) {
            throw new Error(json?.error ?? "UPS bulk quote job failed to start.");
          }

          const nextJob = json?.job ?? null;
          setLoadedJobSummary(nextJob);
          if (nextJob) {
            setSavedBulkJobs((current) => [nextJob, ...current.filter((job) => job.id !== nextJob.id)].slice(0, 25));
          }
          setActiveView("quote");
        })
        .catch((fetchError: unknown) => {
          setResults([]);
          setIssues([]);
          setError(fetchError instanceof Error ? fetchError.message : "UPS bulk quote job failed to start.");
        });
    });
  }

  const refreshBulkJob = useCallback(async (jobId: string, includeResults = false) => {
    const response = await fetch(
      `/api/ups/bulk-jobs?jobId=${encodeURIComponent(jobId)}${includeResults ? "&includeResults=1" : ""}`,
      {
        cache: "no-store"
      }
    );
    const json = (await response.json().catch(() => null)) as
      | Partial<UpsBulkQuoteJobDetail & { job: UpsBulkQuoteJobSummary; error?: string }>
      | null;

    if (!response.ok || !json?.job) {
      throw new Error(json?.error ?? "Unable to refresh the UPS bulk quote job.");
    }

    setLoadedJobSummary(json.job);
    setSavedBulkJobs((current) => [json.job!, ...current.filter((job) => job.id !== json.job!.id)].slice(0, 25));

    if (includeResults) {
      setBatchName(json.job.name ?? "");
      setSelectedAccountIds(json.job.accountIds);
      setSelectedServices(json.job.services);
      setIsResidential(json.isResidential === true);
      setUploadedRows(Array.isArray(json.rows) ? json.rows : []);
      setUploadSummary(buildUploadSummary(`${json.job.name ?? "saved_bulk_run"}.csv`, Array.isArray(json.rows) ? json.rows : []));
      setResults(Array.isArray(json.results) ? json.results : []);
      setIssues(Array.isArray(json.issues) ? json.issues : []);
    }

    if (json.job.status === "SUCCESS" || json.job.status === "ERROR") {
      if (!includeResults) {
        await refreshBulkJob(jobId, true);
      }
      return;
    }

    setResults([]);
    setIssues([]);
  }, []);

  useEffect(() => {
    if (!loadedJobSummary || !["QUEUED", "RUNNING"].includes(loadedJobSummary.status)) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshBulkJob(loadedJobSummary.id).catch((fetchError: unknown) => {
        setError(fetchError instanceof Error ? fetchError.message : "Unable to refresh the UPS bulk quote job.");
      });
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadedJobSummary, refreshBulkJob]);

  function openSavedRun(jobId: string) {
    setError(null);
    setResults([]);
    setIssues([]);
    setActiveView("quote");
    startTransition(() => {
      void refreshBulkJob(jobId, true).catch((fetchError: unknown) => {
        setError(fetchError instanceof Error ? fetchError.message : "Unable to load the saved bulk run.");
      });
    });
  }

  function deleteSavedRun(jobId: string) {
    if (!window.confirm("Delete this saved UPS bulk run?")) {
      return;
    }

    startTransition(() => {
      void fetch(`/api/ups/bulk-jobs?jobId=${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        headers: {
          Accept: "application/json"
        }
      })
        .then(async (response) => {
          const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!response.ok || json?.ok !== true) {
            throw new Error(json?.error ?? "Unable to delete the saved bulk run.");
          }

          setSavedBulkJobs((current) => current.filter((job) => job.id !== jobId));
          setLoadedJobSummary((current) => (current?.id === jobId ? null : current));
          setError(null);
        })
        .catch((fetchError: unknown) => {
          setError(fetchError instanceof Error ? fetchError.message : "Unable to delete the saved bulk run.");
        });
    });
  }

  function downloadResults() {
    const csv = toCsv(buildComparisonExportRows(groupResultsByLane(results), comparisonAccounts));

    triggerTextDownload(csv, "shipment-rate-quote.csv", "text/csv;charset=utf-8");
  }

  function downloadExcelResults() {
    const workbook = buildExcelWorkbook(groupResultsByLane(results), comparisonAccounts);
    triggerTextDownload(workbook, "shipment-rate-quote.xls", "application/vnd.ms-excel");
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {[
          { id: "quote", label: "Quote workspace" },
          { id: "saved", label: `Saved bulk runs (${savedBulkJobs.length.toLocaleString("en-US")})` }
        ].map((tab) => {
          const active = activeView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id as "quote" | "saved")}
              className={[
                "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-accentSoft text-primary"
                  : "border-border bg-background text-foreground hover:bg-muted"
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeView === "saved" ? (
        <SavedBulkRunsPanel
          jobs={savedBulkJobs}
          activeJobId={loadedJobSummary?.id ?? null}
          isPending={isPending}
          onOpen={openSavedRun}
          onDelete={deleteSavedRun}
        />
      ) : null}

      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 border-b border-border pb-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Bulk run name</span>
            <input
              type="text"
              value={batchName}
              onChange={(event) => {
                markDraftDirty();
                setBatchName(event.target.value);
              }}
              placeholder="Example: June 16 NC prospect refresh"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Saved run status</p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {currentRunLabel ?? "Unsaved draft"}
            </p>
            <p className="mt-1 text-xs leading-5 text-mutedForeground">
              {loadedJobSummary
                ? `Loaded from ${formatDateTime(loadedJobSummary.startedAt)}`
                : "Each generated bulk quote run is saved automatically for future reference."}
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_280px_220px]">
          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Upload shipments CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              disabled={isReadingUpload}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="space-y-1 text-sm font-medium text-foreground">
            <span>Accounts to compare</span>
            <div className="rounded-md border border-border bg-background p-2">
              <div className="space-y-2">
                {accounts.map((account) => {
                  const checked = selectedAccountIds.includes(account.id);

                  return (
                    <label key={account.id} className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          markDraftDirty();
                          setSelectedAccountIds((current) => {
                            if (event.target.checked) {
                              return current.includes(account.id) ? current : [...current, account.id];
                            }

                            return current.filter((id) => id !== account.id);
                          });
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{account.name}</span>
                        <span className="block text-xs text-mutedForeground">
                          {account.originLabel} • {account.countryCode}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-1 text-sm font-medium text-foreground">
            <span>Sample input</span>
            <div className="space-y-2">
              <button
                type="button"
                onClick={loadSampleRows}
                className="w-full rounded-md border border-accentBorder bg-accentSoft px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-accentSoft/80"
              >
                Load sample rows
              </button>
              <button
                type="button"
                onClick={() => triggerCsvDownload(SAMPLE_TEMPLATE_CSV, "sample_shipments.csv")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Download CSV template
              </button>
            </div>
          </div>
        </div>

        {isReadingUpload ? (
          <div className="mt-4 rounded-md border border-accentBorder bg-accentSoft/60 px-4 py-3 text-sm text-foreground">
            Reading and parsing the shipment CSV now. Large files can take a moment.
          </div>
        ) : null}

        {uploadSummary ? (
          <UploadSummaryPanel
            summary={uploadSummary}
            savedRunName={currentRunLabel ?? null}
            hasSavedJob={loadedJobSummary !== null}
          />
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {UPS_SERVICE_OPTIONS.map((service) => {
            const selected = selectedServices.includes(service);

            return (
              <button
                key={service}
                type="button"
                onClick={() => {
                  markDraftDirty();
                  setSelectedServices((current) =>
                    current.includes(service)
                      ? current.filter((value) => value !== service)
                      : [...current, service]
                  );
                }}
                className={[
                  "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-accentSoft text-primary"
                    : "border-border bg-background text-foreground hover:bg-muted"
                ].join(" ")}
              >
                {service}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isResidential}
              onChange={(event) => {
                markDraftDirty();
                setIsResidential(event.target.checked);
              }}
            />
            Residential delivery
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={generateQuotes}
              disabled={isPending || isReadingUpload || selectedServices.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Starting bulk run..." : "Generate quote"}
            </button>
            <button
              type="button"
              onClick={downloadResults}
              disabled={results.length === 0}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={downloadExcelResults}
              disabled={results.length === 0}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Export Excel
            </button>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-mutedForeground">
          {liveBridgeEnabled
            ? "Live UPS bridge is enabled for locally configured accounts: upload a CSV, choose service levels, and compare real carrier responses without exposing secrets in the browser."
            : "Dry-run mode mirrors the old bulk quote workflow: upload a CSV, choose service levels, and compare one or more tenant-scoped accounts without exposing live UPS secrets in the browser."}
        </p>
        <p className="mt-2 text-xs leading-5 text-mutedForeground">
          Larger UPS uploads are now submitted in paced batches to reduce carrier throttling. Very large runs can still take a while, especially with multiple accounts and services selected.
        </p>
        <p className="mt-2 text-xs font-medium text-mutedForeground">
          {uploadedRows.length > 0
            ? `${uploadedRows.length.toLocaleString("en-US")} shipment rows ready`
            : "No shipment rows loaded yet"}
        </p>
        <p className="mt-1 text-xs text-mutedForeground">
          Include `CustomerOrderNumber`, `ShipmentID`, `OrderNumber`, or `Reference` in the upload if you want your own shipment ID carried into the exports.
        </p>
      </div>

      {loadedJobSummary ? <UpsBulkJobStatusPanel job={loadedJobSummary} /> : null}
      {comparisonAccounts.length > 0 ? <UpsAccountBanner accounts={comparisonAccounts} liveBridgeEnabled={liveBridgeEnabled} /> : null}
      {plannedSources.length > 0 ? <PlannedSourceBanner sources={plannedSources.filter((source) => source.toolTargets.includes("SHIPMENT_RATE_QUOTE"))} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {results.length > 0 ? (
        <QuoteResultsTable
          results={results}
          accounts={comparisonAccounts}
          title={currentRunLabel}
          subtitle={loadedJobSummary ? `Saved bulk run from ${formatDateTime(loadedJobSummary.startedAt)}` : undefined}
        />
      ) : null}
      {issues.length > 0 ? <UpsIssuesPanel issues={issues} /> : null}
    </section>
  );
}

function UpsBulkJobStatusPanel({ job }: { job: UpsBulkQuoteJobSummary }) {
  const progressPercent =
    job.totalRequestCount > 0
      ? Math.max(0, Math.min(100, Math.round((job.processedRequestCount / job.totalRequestCount) * 100)))
      : 0;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {job.name ? `UPS bulk run: ${job.name}` : "UPS bulk run status"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            {job.status === "QUEUED"
              ? "Your bulk quote run is queued and waiting to start."
              : job.status === "RUNNING"
                ? "UPS requests are running in paced batches. This panel refreshes automatically."
                : job.status === "SUCCESS"
                  ? "The bulk quote run finished and the results below are ready."
                  : `The bulk quote run stopped before completion.${job.errorMessage ? ` ${job.errorMessage}` : ""}`}
          </p>
        </div>
        <span
          className={[
            "rounded-full border px-2.5 py-1 text-xs font-semibold",
            job.status === "SUCCESS"
              ? "border-accentBorder bg-accentSoft text-primary"
              : job.status === "ERROR"
                ? "border-danger/25 bg-danger/10 text-danger"
                : "border-warning/25 bg-warning/10 text-warning"
          ].join(" ")}
        >
          {job.status}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <SummaryMetric label="Shipments" value={job.rowCount} tone="primary" />
        <SummaryMetric label="Accounts" value={job.accountCount} />
        <SummaryMetric label="Services" value={job.serviceCount} />
        <SummaryMetric label="Quotes returned" value={job.quoteCount} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <SummaryMetric label="Processed requests" value={job.processedRequestCount} tone="primary" />
        <SummaryMetric label="Issue requests" value={job.issueCount} />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3 text-xs font-medium text-mutedForeground">
          <span>
            {job.processedRequestCount.toLocaleString("en-US")} / {job.totalRequestCount.toLocaleString("en-US")} quote requests processed
          </span>
          <span>{progressPercent}%</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-muted">
          <div
            className="h-2 rounded-full bg-primary transition-[width]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-2 text-xs leading-5 text-mutedForeground">
          Submitted in {job.chunkCount.toLocaleString("en-US")} batches of up to {job.chunkSize.toLocaleString("en-US")} shipment rows with {job.requestConcurrency.toLocaleString("en-US")} UPS requests in flight at a time.
        </p>
      </div>
    </section>
  );
}

function UploadSummaryPanel({
  summary,
  savedRunName,
  hasSavedJob
}: {
  summary: UploadSummary;
  savedRunName: string | null;
  hasSavedJob: boolean;
}) {
  return (
    <section className="mt-4 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Upload summary</p>
          <p className="mt-1 text-xs text-mutedForeground">
            {summary.fileName} processed at {formatDateTime(summary.processedAt)}
          </p>
        </div>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-mutedForeground">
          {summary.totalRows.toLocaleString("en-US")} rows parsed
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <SummaryMetric label="Ready rows" value={summary.readyRows} tone="primary" />
        <SummaryMetric label="Missing destination" value={summary.rowsMissingDestination} />
        <SummaryMetric label="Missing weight" value={summary.rowsMissingWeight} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <SummaryMetric label="With reference" value={summary.rowsWithShipmentReference} tone="primary" />
        <SummaryMetric label="Weight + dims" value={summary.rowsWithCompleteDims} tone="primary" />
        <SummaryMetric label="Weight only" value={summary.rowsWithoutCompleteDims} />
      </div>

      <p className="mt-3 text-xs leading-5 text-mutedForeground">
        {hasSavedJob
          ? `This loaded run is already saved as ${savedRunName ?? "a bulk run"}. Generate quote again if you want to refresh the saved results with this upload.`
          : `This upload is ready for quoting. Rows with all three dimensions will send weight and dimensions to UPS; the rest will send weight only. It will appear in Saved bulk runs after you click Generate quote${savedRunName ? ` for ${savedRunName}` : ""}.`}
      </p>
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: number;
  tone?: "default" | "primary";
}) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className={["mt-2 text-lg font-semibold", tone === "primary" ? "text-primary" : "text-foreground"].join(" ")}>
        {value.toLocaleString("en-US")}
      </p>
    </div>
  );
}

function SavedBulkRunsPanel({
  jobs,
  activeJobId,
  isPending,
  onOpen,
  onDelete
}: {
  jobs: UpsBulkQuoteJobSummary[];
  activeJobId: string | null;
  isPending: boolean;
  onOpen: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Saved UPS bulk quote runs</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            Reopen past quote comparisons, keep the run names tied to the work they supported, and delete them when they are no longer useful.
          </p>
        </div>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-mutedForeground">
          {jobs.length.toLocaleString("en-US")} saved
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {jobs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-mutedForeground">
            No saved UPS bulk runs yet. Generate a quote run and it will appear here automatically.
          </div>
        ) : null}

        {jobs.map((job) => {
          const isActive = activeJobId === job.id;
          return (
            <div key={job.id} className="rounded-md border border-border bg-muted/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{job.name ?? "Untitled bulk run"}</p>
                    <span
                      className={[
                        "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        job.status === "SUCCESS"
                          ? "border-accentBorder bg-accentSoft text-primary"
                          : "border-warning/25 bg-warning/10 text-warning"
                      ].join(" ")}
                    >
                      {job.status === "SUCCESS" ? "Saved" : job.status}
                    </span>
                    {isActive ? (
                      <span className="rounded-full border border-accentBorder bg-accentSoft px-2 py-0.5 text-[11px] font-semibold text-primary">
                        Loaded
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-mutedForeground">
                    {formatDateTime(job.startedAt)} • {job.rowCount.toLocaleString("en-US")} rows •{" "}
                    {job.quoteCount.toLocaleString("en-US")} quotes • {job.issueCount.toLocaleString("en-US")} issues
                  </p>
                  <p className="text-xs leading-5 text-mutedForeground">
                    Accounts: {job.accountNames.join(", ") || "None"} • Services: {job.services.join(", ") || "None"}
                  </p>
                  {job.errorMessage ? <p className="text-xs leading-5 text-warning">{job.errorMessage}</p> : null}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(job.id)}
                    disabled={isPending}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Open run
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(job.id)}
                    disabled={isPending}
                    className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UpsIssuesPanel({ issues }: { issues: UpsQuoteIssue[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">UPS issue log</p>
          <p className="text-xs text-mutedForeground">
            {issues.length.toLocaleString("en-US")} quote requests failed, but the rest of the bulk run continued.
          </p>
        </div>
        <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
          {issues.length.toLocaleString("en-US")} issues
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[980px] divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            <tr>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Origin</th>
              <th className="px-4 py-3">Destination</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Weight</th>
              <th className="px-4 py-3">Dims</th>
              <th className="px-4 py-3">Issue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {issues.map((issue, index) => (
              <tr
                key={`${issue.accountId}-${issue.shipmentReference}-${issue.destinationPostalCode}-${issue.service}-${index}`}
                className="align-top transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3 text-foreground">{issue.shipmentReference || "—"}</td>
                <td className="px-4 py-3 text-foreground">{issue.accountName}</td>
                <td className="px-4 py-3 text-foreground">{issue.originPostalCode}</td>
                <td className="px-4 py-3 text-foreground">{issue.destinationPostalCode}</td>
                <td className="px-4 py-3 text-foreground">{issue.service}</td>
                <td className="px-4 py-3 text-mutedForeground">{issue.weight.toFixed(2)} lb</td>
                <td className="px-4 py-3 text-mutedForeground">
                  {issue.length > 0 && issue.width > 0 && issue.height > 0
                    ? `${issue.length}x${issue.width}x${issue.height}`
                    : "Weight only"}
                </td>
                <td className="px-4 py-3 text-warning">{issue.errorMessage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlannedSourceBanner({ sources }: { sources: ManagedQuoteSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Planned carrier sources</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            These carriers are now part of the quote-source directory and will show here while we wire their pricing integrations.
          </p>
        </div>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-mutedForeground">
          {sources.length.toLocaleString("en-US")} staged
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {sources.map((source) => (
          <div key={source.id} className="rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{source.displayName}</p>
                <p className="mt-1 text-sm text-mutedForeground">
                  {source.carrierName} • {source.carrierCode}
                </p>
              </div>
              <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                Planned
              </span>
            </div>
            {source.notes ? <p className="mt-2 text-sm leading-6 text-mutedForeground">{source.notes}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function UpsAccountBanner({
  accounts,
  liveBridgeEnabled
}: {
  accounts: UpsAccountConfig[];
  liveBridgeEnabled: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Comparison set</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            {liveBridgeEnabled
              ? "Selected accounts are matched to your local UPS credentials file at runtime, so this comparison can use real carrier responses."
              : "Select multiple accounts now, and this surface can later widen into carrier-level comparisons without changing the quoting workflow."}
          </p>
        </div>
        <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
          {accounts.length.toLocaleString("en-US")} selected
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {accounts.map((account) => (
          <div key={account.id} className="rounded-md border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-foreground">{account.name}</p>
              <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                {liveBridgeEnabled ? "Live bridge" : account.dryRun ? "Dry run" : "Live-ready"}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-mutedForeground">
              Origin {account.originLabel} ({account.originPostalCode}) with shipper number {account.shipperNumber}.
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuoteResultsTable({
  results,
  accounts,
  title,
  subtitle
}: {
  results: QuoteResult[];
  accounts: UpsAccountConfig[];
  title?: string;
  subtitle?: string;
}) {
  const totalStandard = roundMoney(results.reduce((sum, result) => sum + result.standardRate, 0));
  const totalNegotiated = roundMoney(results.reduce((sum, result) => sum + result.negotiatedRate, 0));
  const rows = groupResultsByLane(results);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title ? `Quote results: ${title}` : "Quote results"}</p>
          <p className="text-xs text-mutedForeground">
            {results.length.toLocaleString("en-US")} quote combinations across selected accounts and services
          </p>
          {subtitle ? <p className="mt-1 text-xs text-mutedForeground">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full border border-border bg-card px-2.5 py-1 text-foreground">
            Standard ${totalStandard.toFixed(2)}
          </span>
          <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-primary">
            Negotiated ${totalNegotiated.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1280px] divide-y divide-border text-sm">
          <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
            <tr>
              <th className="px-4 py-3" rowSpan={2}>Reference</th>
              <th className="px-4 py-3" rowSpan={2}>Origin</th>
              <th className="px-4 py-3" rowSpan={2}>Destination</th>
              <th className="px-4 py-3" rowSpan={2}>Service</th>
              <th className="px-4 py-3" rowSpan={2}>Weight</th>
              <th className="px-4 py-3" rowSpan={2}>Dims</th>
              {accounts.map((account) => (
                <th key={account.id} className="px-4 py-3 text-center" colSpan={2}>
                  <div className="text-foreground">{account.shipperNumber}</div>
                  <div className="mt-1 text-[11px] normal-case text-mutedForeground">{account.name}</div>
                </th>
              ))}
            </tr>
            <tr>
              {accounts.map((account) => (
                <Fragment key={`${account.id}-subcols`}>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3">Transit</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key} className="transition-colors hover:bg-muted/50">
                <td className="px-4 py-3 text-foreground">{row.shipmentReference || "—"}</td>
                <td className="px-4 py-3 text-foreground">{row.originPostalCode}</td>
                <td className="px-4 py-3 text-foreground">{row.destinationPostalCode}</td>
                <td className="px-4 py-3 text-foreground">{row.service}</td>
                <td className="px-4 py-3 text-mutedForeground">{row.billableWeight.toFixed(2)} lb</td>
                <td className="px-4 py-3 text-mutedForeground">{row.dims}</td>
                {accounts.map((account) => {
                  const quote = row.byAccountId[account.id];

                  return (
                    <Fragment key={`${row.key}-${account.id}`}>
                      <td className="px-4 py-3 font-semibold text-foreground">
                        {quote ? `$${quote.totalWithTax.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-mutedForeground">
                        {quote ? `${quote.transitDays}d` : "—"}
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ComparisonRow = {
  key: string;
  shipmentReference: string;
  originPostalCode: string;
  destinationPostalCode: string;
  service: UpsServiceName;
  weight: number;
  billableWeight: number;
  dims: string;
  byAccountId: Record<string, QuoteResult>;
};

function groupResultsByLane(results: QuoteResult[]): ComparisonRow[] {
  const rows = new Map<string, ComparisonRow>();

  for (const result of results) {
    const key = [
      result.shipmentReference,
      result.originPostalCode,
      result.destinationPostalCode,
      result.service,
      result.weight.toFixed(2),
      result.billableWeight.toFixed(2),
      result.dims
    ].join("|");

    const existing = rows.get(key);
    if (existing) {
      existing.byAccountId[result.accountId] = result;
      continue;
    }

    rows.set(key, {
      key,
      shipmentReference: result.shipmentReference ?? "",
      originPostalCode: result.originPostalCode,
      destinationPostalCode: result.destinationPostalCode,
      service: result.service,
      weight: result.weight,
      billableWeight: result.billableWeight,
      dims: result.dims,
      byAccountId: {
        [result.accountId]: result
      }
    });
  }

  return Array.from(rows.values());
}

function getComparisonAccounts(
  accounts: UpsAccountConfig[],
  results: QuoteResult[],
  selectedAccountIds: string[]
): UpsAccountConfig[] {
  if (results.length === 0) {
    return accounts.filter((account) => selectedAccountIds.includes(account.id));
  }

  const byId = new Map(accounts.map((account) => [account.id, account]));
  const fallbackRows = new Map<string, QuoteResult>();
  for (const result of results) {
    if (!fallbackRows.has(result.accountId)) {
      fallbackRows.set(result.accountId, result);
    }
  }

  return Array.from(fallbackRows.values()).map((result) => {
    const existing = byId.get(result.accountId);
    if (existing) {
      return existing;
    }

    return {
      id: result.accountId,
      name: result.accountName,
      status: "ACTIVE",
      countryCode: "US",
      shipperNumber: result.accountShipperNumber,
      originPostalCode: result.originPostalCode,
      originLabel: result.originPostalCode,
      dryRun: result.mode !== "live",
      secretConfigured: true,
      toolTargets: []
    };
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function buildUploadSummary(fileName: string, rows: UpsInputRow[]): UploadSummary {
  let rowsMissingDestination = 0;
  let rowsMissingWeight = 0;
  let readyRows = 0;
  let rowsWithShipmentReference = 0;
  let rowsWithCompleteDims = 0;
  let rowsWithoutCompleteDims = 0;

  for (const row of rows) {
    const hasDestination = (row.DestinationZIP ?? "").trim().length > 0;
    const hasWeight = (row.Weight ?? "").trim().length > 0;
    const hasLength = (row.Length ?? "").trim().length > 0;
    const hasWidth = (row.Width ?? "").trim().length > 0;
    const hasHeight = (row.Height ?? "").trim().length > 0;
    const hasCompleteDims = hasLength && hasWidth && hasHeight;
    const hasShipmentReference = getShipmentReference(row).length > 0;

    if (!hasDestination) {
      rowsMissingDestination += 1;
    }

    if (!hasWeight) {
      rowsMissingWeight += 1;
    }

    if (hasDestination && hasWeight) {
      readyRows += 1;
      if (hasShipmentReference) {
        rowsWithShipmentReference += 1;
      }
      if (hasCompleteDims) {
        rowsWithCompleteDims += 1;
      } else {
        rowsWithoutCompleteDims += 1;
      }
    }
  }

  return {
    fileName,
    totalRows: rows.length,
    readyRows,
    rowsMissingDestination,
    rowsMissingWeight,
    rowsWithShipmentReference,
    rowsWithCompleteDims,
    rowsWithoutCompleteDims,
    processedAt: new Date().toISOString()
  };
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-foreground shadow-sm">
      {message}
    </section>
  );
}

function triggerCsvDownload(contents: string, fileName: string) {
  triggerTextDownload(contents, fileName, "text/csv;charset=utf-8");
}

function triggerTextDownload(contents: string, fileName: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildExcelWorkbook(rows: ComparisonRow[], accounts: UpsAccountConfig[]) {
  const comparisonHeaders = [
    "Reference",
    "Origin",
    "Destination",
    "Service",
    "Weight",
    "Billable Weight",
    "Dims",
    ...accounts.map((account) => account.shipperNumber),
    "Cheapest Account",
    "Cheapest Rate",
    "Cheapest Transit Days"
  ];

  const comparisonRows = buildComparisonExportRows(rows, accounts).map((row) =>
    comparisonHeaders.map((header) => String(row[header] ?? ""))
  );

  const rawRows = resultsToRawRows(rows);

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Comparison Grid">
    <Table>
      ${worksheetRow(comparisonHeaders, true)}
      ${comparisonRows.map((row) => worksheetRow(row)).join("")}
    </Table>
  </Worksheet>
  <Worksheet ss:Name="Raw Quotes">
    <Table>
      ${worksheetRow([
        "Shipment Reference",
        "Account Number",
        "Account Name",
        "Origin ZIP",
        "Destination ZIP",
        "Service",
        "Weight",
        "Billable Weight",
        "Dims",
        "Standard Rate",
        "Negotiated Rate",
        "Tax Amount",
        "Total With Tax",
        "Transit Days",
        "Mode"
      ], true)}
      ${rawRows.map((row) => worksheetRow(row)).join("")}
    </Table>
  </Worksheet>
</Workbook>`;
}

function worksheetRow(values: string[], header = false) {
  return `<Row>${values
    .map((value) => {
      const style = header ? ' ss:StyleID="Header"' : "";
      return `<Cell${style}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
    })
    .join("")}</Row>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function resultsToRawRows(rows: ComparisonRow[]) {
  const flattened: string[][] = [];

  for (const row of rows) {
    for (const quote of Object.values(row.byAccountId)) {
      flattened.push([
        quote.shipmentReference ?? "",
        quote.accountShipperNumber,
        quote.accountName,
        quote.originPostalCode,
        quote.destinationPostalCode,
        quote.service,
        quote.weight.toFixed(2),
        quote.billableWeight.toFixed(2),
        quote.dims,
        quote.standardRate.toFixed(2),
        quote.negotiatedRate.toFixed(2),
        quote.taxAmount.toFixed(2),
        quote.totalWithTax.toFixed(2),
        String(quote.transitDays),
        quote.mode
      ]);
    }
  }

  return flattened;
}

function buildComparisonExportRows(rows: ComparisonRow[], accounts: UpsAccountConfig[]) {
  return rows.map((row) => {
    const cheapestQuote = getCheapestQuote(row);
    const exportRow: Record<string, string | number> = {
      Reference: row.shipmentReference || "",
      Origin: row.originPostalCode,
      Destination: row.destinationPostalCode,
      Service: row.service,
      Weight: row.weight.toFixed(2),
      "Billable Weight": row.billableWeight.toFixed(2),
      Dims: row.dims
    };

    for (const account of accounts) {
      const quote = row.byAccountId[account.id];
      exportRow[account.shipperNumber] = quote ? quote.totalWithTax.toFixed(2) : "";
    }

    exportRow["Cheapest Account"] = cheapestQuote?.accountShipperNumber ?? "";
    exportRow["Cheapest Rate"] = cheapestQuote ? cheapestQuote.totalWithTax.toFixed(2) : "";
    exportRow["Cheapest Transit Days"] = cheapestQuote ? String(cheapestQuote.transitDays) : "";

    return exportRow;
  });
}

function getCheapestQuote(row: ComparisonRow) {
  const quotes = Object.values(row.byAccountId);
  if (quotes.length === 0) {
    return null;
  }

  return quotes.reduce((best, current) => {
    if (current.totalWithTax < best.totalWithTax) {
      return current;
    }

    if (current.totalWithTax === best.totalWithTax && current.transitDays < best.transitDays) {
      return current;
    }

    return best;
  });
}
