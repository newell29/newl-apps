"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { LTL_ACCESSORIAL_LEGEND, LTL_INTERACTIVE_LANE_LIMIT, LTL_SAMPLE_CSV } from "@/modules/ltl-rate-portal/constants";
import { exportLtlResultsCsv, getLtlTemplateCsv, parseLtlCsv } from "@/modules/ltl-rate-portal/csv";
import type {
  LtlBulkQuoteCreateResponsePayload,
  LtlBulkQuoteJobDetail,
  LtlBulkQuoteJobSummary,
  LtlCarrierErrorResult,
  LtlQuoteResult,
  LtlRateQuoteRequestPayload,
  LtlRateQuoteResponsePayload,
  SevenLAccountConfig
} from "@/modules/ltl-rate-portal/types";

export type GroupedLaneResult = {
  customerReference: string;
  originLabel: string;
  destinationLabel: string;
  weightLabel: string;
  carrierResults: Record<string, { total?: number; errorMessage?: string }>;
  cheapestCarrier: string;
  cheapestRate: number | null;
};

type LtlPortalTab = "quote" | "saved";

export function getPreferredAccount(accounts: SevenLAccountConfig[]) {
  return (
    accounts.find((account) => !account.dryRun && account.secretConfigured && account.status === "ACTIVE") ??
    accounts.find((account) => !account.dryRun && account.status === "ACTIVE") ??
    accounts[0]
  );
}

function getVisibleAccountName(account: SevenLAccountConfig) {
  return account.dryRun ? "7L account" : account.name;
}

export function LtlRatePortalClient({
  accounts,
  recentBulkJobs
}: {
  accounts: SevenLAccountConfig[];
  recentBulkJobs: LtlBulkQuoteJobSummary[];
}) {
  const preferredAccount = getPreferredAccount(accounts);
  const [selectedAccountId, setSelectedAccountId] = useState(preferredAccount?.id ?? "");
  const [selectedCarrierHashes, setSelectedCarrierHashes] = useState(
    () =>
      preferredAccount?.carriers.filter((carrier) => carrier.enabled).map((carrier) => carrier.carrierHash) ?? []
  );
  const [batchName, setBatchName] = useState("");
  const [parsedRows, setParsedRows] = useState(() => [] as ReturnType<typeof parseLtlCsv>);
  const [results, setResults] = useState<LtlQuoteResult[]>([]);
  const [carrierErrors, setCarrierErrors] = useState<LtlCarrierErrorResult[]>([]);
  const [savedBulkJobs, setSavedBulkJobs] = useState<LtlBulkQuoteJobSummary[]>(recentBulkJobs);
  const [currentBulkJob, setCurrentBulkJob] = useState<LtlBulkQuoteJobSummary | null>(null);
  const [currentBulkJobDetail, setCurrentBulkJobDetail] = useState<LtlBulkQuoteJobDetail | null>(null);
  const [activeTab, setActiveTab] = useState<LtlPortalTab>("quote");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingBulkJob, setIsRefreshingBulkJob] = useState(false);
  const [isPending, startTransition] = useTransition();
  const responseRef = useRef<HTMLElement | null>(null);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? preferredAccount;
  const groupedResults = groupResults(results, carrierErrors);
  const validRequests = parsedRows.flatMap((row) => (row.request ? [row.request] : []));
  const shouldUseBatchMode = validRequests.length > LTL_INTERACTIVE_LANE_LIMIT;
  const hasResponse =
    groupedResults.length > 0 ||
    carrierErrors.length > 0 ||
    Boolean(currentBulkJobDetail) ||
    Boolean(currentBulkJob);
  const currentBulkJobId = currentBulkJob?.id ?? null;
  const currentBulkJobStatus = currentBulkJob?.status ?? null;
  const hasSavedBulkJobs = savedBulkJobs.length > 0;

  function scrollToResponse() {
    requestAnimationFrame(() => {
      responseRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }

  function handleAccountChange(nextAccountId: string) {
    setSelectedAccountId(nextAccountId);
    const nextAccount = accounts.find((account) => account.id === nextAccountId);
    setSelectedCarrierHashes(
      nextAccount?.carriers.filter((carrier) => carrier.enabled).map((carrier) => carrier.carrierHash) ?? []
    );
    setResults([]);
    setCarrierErrors([]);
    setCurrentBulkJob(null);
    setCurrentBulkJobDetail(null);
    setError(null);
  }

  function toggleCarrier(carrierHash: string) {
    setSelectedCarrierHashes((current) =>
      current.includes(carrierHash)
        ? current.filter((value) => value !== carrierHash)
        : [...current, carrierHash]
    );
  }

  function upsertSavedBulkJob(job: LtlBulkQuoteJobSummary) {
    setSavedBulkJobs((current) => {
      const next = [job, ...current.filter((item) => item.id !== job.id)];
      return next.slice(0, 10);
    });
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setParsedRows([]);
      setResults([]);
      setCarrierErrors([]);
      return;
    }

    startTransition(async () => {
      const text = await file.text();
      const nextRows = parseLtlCsv(text);
      setParsedRows(nextRows);
      setResults([]);
      setCarrierErrors([]);
      setCurrentBulkJob(null);
      setCurrentBulkJobDetail(null);
      setError(nextRows.some((row) => row.request) ? null : "The upload did not contain any valid LTL lanes.");
    });
  }

  function generateQuotes() {
    if (!selectedAccount) {
      setError("Seed or configure a 7L account before generating quotes.");
      return;
    }

    if (selectedCarrierHashes.length === 0) {
      setError("Select at least one carrier for this pull.");
      return;
    }

    const payload: LtlRateQuoteRequestPayload = {
      accountId: selectedAccount.id,
      carrierHashes: selectedCarrierHashes,
      rows: validRequests
    };

    if (shouldUseBatchMode) {
      void startBulkJob(payload);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setResults([]);
    setCarrierErrors([]);
    setCurrentBulkJob(null);
    setCurrentBulkJobDetail(null);

    void fetch("/api/ltl-rate-portal/rate-quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as
          | Partial<LtlRateQuoteResponsePayload & { error?: string }>
          | null;

        if (!response.ok) {
          throw new Error(json?.error ?? "7L rating failed.");
        }

        const nextResults = Array.isArray(json?.data) ? json.data : [];
        const nextErrors = Array.isArray(json?.errors) ? json.errors : [];
        setResults(nextResults);
        setCarrierErrors(nextErrors);
        setError(nextResults.length > 0 || nextErrors.length > 0 ? null : "No quoteable lanes were found in the upload.");
        scrollToResponse();
      })
      .catch((cause: unknown) => {
        setResults([]);
        setCarrierErrors([]);
        setError(cause instanceof Error ? cause.message : "7L rating failed.");
        scrollToResponse();
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  function startBulkJob(payload: LtlRateQuoteRequestPayload) {
    setIsSubmitting(true);
    setError(null);
    setResults([]);
    setCarrierErrors([]);
    setCurrentBulkJob(null);
    setCurrentBulkJobDetail(null);

    void fetch("/api/ltl-rate-portal/bulk-jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...payload,
        name: batchName.trim() || undefined
      })
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as
          | Partial<LtlBulkQuoteCreateResponsePayload & { error?: string }>
          | null;

        if (!response.ok || !json?.job) {
          throw new Error(json?.error ?? "LTL bulk quote job failed to start.");
        }

        setCurrentBulkJob(json.job);
        upsertSavedBulkJob(json.job);
        scrollToResponse();
        void refreshBulkJob(json.job.id);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "LTL bulk quote job failed to start.");
        scrollToResponse();
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  const refreshBulkJob = useCallback(async (jobId: string) => {
    setIsRefreshingBulkJob(true);

    try {
      const response = await fetch(`/api/ltl-rate-portal/bulk-jobs?jobId=${encodeURIComponent(jobId)}`, {
        cache: "no-store"
      });
      const json = (await response.json().catch(() => null)) as Partial<LtlBulkQuoteJobDetail & { error?: string }> | null;

      if (!response.ok || !json?.job) {
        throw new Error(json?.error ?? "Unable to refresh the LTL bulk quote job.");
      }

      setCurrentBulkJob(json.job);
      upsertSavedBulkJob(json.job);

      if (json.job.status === "SUCCESS" || json.job.status === "ERROR") {
        const detailResponse = await fetch(
          `/api/ltl-rate-portal/bulk-jobs?jobId=${encodeURIComponent(jobId)}&includeLanes=1`,
          { cache: "no-store" }
        );
        const detailJson = (await detailResponse.json().catch(() => null)) as
          | Partial<LtlBulkQuoteJobDetail & { error?: string }>
          | null;

        if (!detailResponse.ok || !detailJson?.job) {
          throw new Error(detailJson?.error ?? "Unable to load the completed LTL bulk quote job.");
        }

        setCurrentBulkJobDetail({
          job: detailJson.job,
          lanes: Array.isArray(detailJson.lanes) ? detailJson.lanes : []
        });
        return;
      }

      setCurrentBulkJobDetail(null);
    } finally {
      setIsRefreshingBulkJob(false);
    }
  }, []);

  useEffect(() => {
    if (!currentBulkJobId || !currentBulkJobStatus || !["QUEUED", "RUNNING"].includes(currentBulkJobStatus)) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshBulkJob(currentBulkJobId).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Unable to refresh the LTL bulk quote job.");
      });
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [currentBulkJobId, currentBulkJobStatus, refreshBulkJob]);

  function downloadTemplate() {
    triggerCsvDownload(getLtlTemplateCsv(), "ltl_rate_portal_template.csv");
  }

  function downloadResults() {
    const csv = exportLtlResultsCsv(
      groupedResults.map((result) => ({
        customerReference: result.customerReference,
        origin: result.originLabel,
        destination: result.destinationLabel,
        totalWeight: result.weightLabel,
        ...Object.fromEntries(
          Object.entries(result.carrierResults).map(([carrier, detail]) => [
            carrier,
            detail.total !== undefined ? detail.total.toFixed(2) : detail.errorMessage ?? ""
          ])
        ),
        cheapestCarrier: result.cheapestCarrier,
        cheapestRate: result.cheapestRate?.toFixed(2) ?? ""
      }))
    );

    triggerCsvDownload(csv, "ltl_rate_results.csv");
  }

  function openSavedBulkJob(jobId: string) {
    const job = savedBulkJobs.find((candidate) => candidate.id === jobId) ?? null;
    setCurrentBulkJob(job);
    setCurrentBulkJobDetail(null);
    setResults([]);
    setCarrierErrors([]);
    setError(null);
    setActiveTab("saved");
    scrollToResponse();
    void refreshBulkJob(jobId).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Unable to load the saved LTL bulk quote job.");
    });
  }

  function deleteSavedBulkJob(jobId: string) {
    const job = savedBulkJobs.find((candidate) => candidate.id === jobId);
    const label = job?.name ?? "this saved quote";
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) {
      return;
    }

    setError(null);
    void fetch(`/api/ltl-rate-portal/bulk-jobs?jobId=${encodeURIComponent(jobId)}`, {
      method: "DELETE"
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as { error?: string; deleted?: { id?: string } } | null;
        if (!response.ok) {
          throw new Error(json?.error ?? "Unable to delete the saved LTL bulk quote job.");
        }

        setSavedBulkJobs((current) => {
          const next = current.filter((item) => item.id !== jobId);
          if (currentBulkJob?.id === jobId) {
            setCurrentBulkJob(next[0] ?? null);
            setCurrentBulkJobDetail(null);
          }
          return next;
        });
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Unable to delete the saved LTL bulk quote job.");
      });
  }

  return (
    <section className="space-y-6">
      {accounts.length === 0 ? (
        <section className="rounded-lg border border-warning/25 bg-warning/10 p-5 text-sm text-foreground shadow-sm">
          No 7L account records are configured for this tenant yet.
        </section>
      ) : null}

      {selectedAccount?.dryRun ? (
        <section className="rounded-lg border border-warning/25 bg-warning/10 p-4 text-sm text-foreground shadow-sm">
          This 7L account is configured and ready for rating.
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-2 shadow-sm">
        <div className="grid gap-2 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setActiveTab("quote")}
            className={`rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors ${
              activeTab === "quote"
                ? "bg-primary text-primaryForeground"
                : "border border-border bg-background text-foreground hover:bg-muted"
            }`}
          >
            New quote
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("saved")}
            className={`rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors ${
              activeTab === "saved"
                ? "bg-primary text-primaryForeground"
                : "border border-border bg-background text-foreground hover:bg-muted"
            }`}
          >
            Saved quotes
            <span className={`ml-2 text-xs font-medium ${activeTab === "saved" ? "text-primaryForeground/85" : "text-mutedForeground"}`}>
              {savedBulkJobs.length.toLocaleString("en-US")}
            </span>
          </button>
        </div>
      </section>

      {activeTab === "quote" ? (
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_260px_200px]">
          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Upload lanes CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>7L account</span>
            <select
              value={selectedAccountId}
              onChange={(event) => handleAccountChange(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {getVisibleAccountName(account)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>Saved quote name</span>
            <input
              type="text"
              value={batchName}
              onChange={(event) => setBatchName(event.target.value)}
              placeholder="Example: June RFQ - Southeast"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="space-y-1 text-sm font-medium text-foreground">
            <span>Template</span>
            <button
              type="button"
              onClick={downloadTemplate}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Download CSV
            </button>
          </div>
        </div>

        {selectedAccount ? (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Carriers for this pull</p>
                <p className="mt-1 text-sm text-mutedForeground">
                  Start with your enabled carrier defaults, then choose the subset you want to rate for this run.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCarrierHashes(selectedAccount.carriers.map((carrier) => carrier.carrierHash))
                  }
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCarrierHashes(
                      selectedAccount.carriers
                        .filter((carrier) => carrier.enabled)
                        .map((carrier) => carrier.carrierHash)
                    )
                  }
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Reset to defaults
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {selectedAccount.carriers.map((carrier) => (
                <label
                  key={carrier.carrierHash}
                  className="flex items-start gap-3 rounded-md border border-border bg-card p-3 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={selectedCarrierHashes.includes(carrier.carrierHash)}
                    onChange={() => toggleCarrier(carrier.carrierHash)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-foreground">{carrier.name}</span>
                    <span className="block text-xs text-mutedForeground">
                      {carrier.code} • {carrier.scac}
                      {carrier.defaulted ? " • default" : ""}
                      {carrier.enabled ? "" : " • disabled in settings"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm leading-6 text-mutedForeground">
            Upload a multi-lane LTL template, choose the carrier subset for this run, and export bulk quote outputs without exposing live credentials in the browser.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={generateQuotes}
              disabled={isSubmitting || isPending || parsedRows.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (shouldUseBatchMode ? "Starting tracked run..." : "Generating rates...") : shouldUseBatchMode ? "Generate rates" : "Generate rates"}
            </button>
            <button
              type="button"
              onClick={downloadResults}
              disabled={results.length === 0}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Export results
            </button>
          </div>
        </div>

        {isSubmitting ? (
          <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
            {shouldUseBatchMode
              ? "Creating a tracked batch run for this upload. Progress and lane counts will update below as 7L responses come back."
              : "Submitting lanes to 7L and waiting on carrier responses. Live pulls can take a little while when multiple carriers are selected."}
          </div>
        ) : null}

        {hasResponse ? (
          <div className="mt-4 rounded-md border border-border bg-background px-3 py-3 text-sm text-foreground">
            <p className="font-semibold text-foreground">
              {currentBulkJob
                ? `Latest batch job: ${currentBulkJob.processedLanes.toLocaleString("en-US")} / ${currentBulkJob.totalLanes.toLocaleString("en-US")} lanes processed.`
                : `Latest response: ${results.length.toLocaleString("en-US")} rates and ${carrierErrors.length.toLocaleString("en-US")} carrier issues.`}
            </p>
            <p className="mt-1 text-mutedForeground">
              {currentBulkJob
                ? currentBulkJob.status === "SUCCESS"
                  ? "The batch job finished and detailed results are ready below."
                  : `Status: ${formatJobStatus(currentBulkJob.status)}. The page will keep updating as more lanes finish.`
                : results.length === 0
                  ? "7L did not return a quote for any selected carrier on this run."
                  : "Detailed carrier comparisons are ready below."}
            </p>
            <button
              type="button"
              onClick={scrollToResponse}
              className="mt-3 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Jump to detailed results
            </button>
          </div>
        ) : null}
      </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {activeTab === "quote" && (error || hasResponse) ? (
        <section ref={responseRef} className="space-y-6">
          {currentBulkJob ? <BulkJobCard job={currentBulkJob} /> : null}
          {currentBulkJobDetail ? <BulkJobLaneSummary detail={currentBulkJobDetail} /> : null}
          {!currentBulkJobDetail && hasResponse ? <RunSummary results={results} carrierErrors={carrierErrors} groupedResults={groupedResults} /> : null}
          {!currentBulkJobDetail && groupedResults.length > 0 ? <ResultsTable results={groupedResults} /> : null}
          {!currentBulkJobDetail && carrierErrors.length > 0 ? <CarrierIssuesPanel carrierErrors={carrierErrors} /> : null}
        </section>
      ) : null}

      {activeTab === "saved" ? (
        <section ref={responseRef} className="space-y-6">
          {hasSavedBulkJobs ? (
            <SavedBulkJobsSection
              jobs={savedBulkJobs}
              currentJobId={currentBulkJob?.id ?? null}
              onOpen={openSavedBulkJob}
              onDelete={deleteSavedBulkJob}
            />
          ) : (
            <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <h2 className="text-base font-semibold text-foreground">Saved bulk quote jobs</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                No saved batch quotes yet. Start a larger lane upload from the New quote tab and it will appear here automatically.
              </p>
            </section>
          )}

          {currentBulkJob ? <BulkJobCard job={currentBulkJob} /> : null}
          {currentBulkJobDetail ? <BulkJobLaneSummary detail={currentBulkJobDetail} /> : null}
          {!currentBulkJobDetail && currentBulkJob ? (
            <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <p className="text-sm leading-6 text-mutedForeground">
                {isRefreshingBulkJob
                  ? "Loading the latest saved quote results."
                  : "Open a completed saved quote job to review lane-by-lane results here. Running jobs will keep updating automatically."}
              </p>
            </section>
          ) : null}
        </section>
      ) : null}

      {activeTab === "quote" ? (
        <>
          {selectedAccount ? <AccountBanner account={selectedAccount} /> : null}
          <TemplateReference />
          {parsedRows.length > 0 ? <UploadSummary parsedRows={parsedRows} /> : null}
        </>
      ) : null}
    </section>
  );
}

function AccountBanner({ account }: { account: SevenLAccountConfig }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{getVisibleAccountName(account)}</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            Carrier set with {account.carriers.length} configured carriers, default UOM {account.defaultUom}, and {account.harmonizedCharges ? "harmonized charges on" : "harmonized charges off"}.
          </p>
        </div>
        <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
          {account.secretConfigured ? "Live bridge ready" : "Ready"}
        </span>
      </div>
    </section>
  );
}

function UploadSummary({ parsedRows }: { parsedRows: ReturnType<typeof parseLtlCsv> }) {
  const validRows = parsedRows.filter((row) => row.request).length;
  const invalidRows = parsedRows.length - validRows;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Upload summary</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            {validRows.toLocaleString("en-US")} valid lanes and {invalidRows.toLocaleString("en-US")} validation issues ready for review.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {parsedRows.map((row, index) => (
          <div key={index} className="rounded-md border border-border bg-muted/40 p-3">
            {row.request ? (
              <div className="space-y-2 text-sm text-mutedForeground">
                <p className="font-medium text-foreground">
                  {row.request.customerReference}: {formatLaneLabel(row.request.originCity, row.request.originState, row.request.originZipcode, row.request.originCountry)} to {formatLaneLabel(row.request.destinationCity, row.request.destinationState, row.request.destinationZipcode, row.request.destinationCountry)}
                </p>
                <p>
                  {row.request.pieces.length} freight pieces • {row.request.accessorialCodes.length} accessorial codes • pickup {row.request.pickupDate}
                </p>
              </div>
            ) : (
              <p className="text-sm text-danger">{row.errors.join(" ")}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function TemplateReference() {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">CSV template</h2>
        <p className="text-sm leading-6 text-mutedForeground">
          Required fields are `originZipcode`, `destinationZipcode`, and `piece1Weight`. City, state, pickup date, accessorials, and dimensions are optional.
        </p>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-border bg-background p-3">
        <pre className="min-w-full whitespace-pre-wrap break-all text-xs leading-6 text-foreground">
          {LTL_SAMPLE_CSV.trim()}
        </pre>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-md border border-border bg-background p-4">
          <h3 className="text-sm font-semibold text-foreground">Accessorial legend</h3>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            Enter multiple accessorial codes in `accessorialCodes` with `|` or commas, like `APPT|LFTG`.
          </p>
          <div className="mt-3 space-y-2 text-sm">
            {LTL_ACCESSORIAL_LEGEND.map((item) => (
              <div key={item.code} className="flex flex-wrap items-start gap-3 rounded-md border border-border bg-card px-3 py-2">
                <span className="min-w-16 font-semibold text-foreground">{item.code}</span>
                <span className="text-mutedForeground">{item.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-mutedForeground">
            These are the common accessorials already used in the portal examples and tests. Additional 7L-supported codes can still be passed through the upload when needed.
          </p>
        </div>

        <div className="rounded-md border border-warning/25 bg-warning/10 p-4">
          <h3 className="text-sm font-semibold text-foreground">Bulk volume guidance</h3>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            Multi-lane uploads now run through a tracked background job so progress, lane counts, and saved results stay visible while 7L is working.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-foreground">
            <li>Single-lane spot checks can still return quickly.</li>
            <li>Multi-lane uploads use the saved batch flow with a live progress bar.</li>
            <li>Runtime grows with `lanes x selected carriers`, so fewer carriers helps a lot.</li>
          </ul>
          <p className="mt-3 text-xs leading-5 text-mutedForeground">
            Very large uploads like `800` lanes can still run here, but they will take longer and are best paired with a smaller carrier subset.
          </p>
        </div>
      </div>
    </section>
  );
}

function BulkJobCard({ job }: { job: LtlBulkQuoteJobSummary }) {
  const percent = job.totalLanes > 0 ? Math.min(100, Math.round((job.processedLanes / job.totalLanes) * 100)) : 0;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{job.name ?? "Bulk quote job"}</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            {job.accountName} • {job.selectedCarrierCount.toLocaleString("en-US")} carriers • started{" "}
            {new Date(job.startedAt).toLocaleString("en-US")}
          </p>
        </div>
        <div className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground">
          {formatJobStatus(job.status)}
        </div>
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Processed" value={`${job.processedLanes}/${job.totalLanes}`} />
        <Metric label="Quoted lanes" value={job.quotedLanes.toLocaleString("en-US")} />
        <Metric label="Issue lanes" value={job.issueLanes.toLocaleString("en-US")} />
        <Metric label="Quotes" value={job.quoteCount.toLocaleString("en-US")} />
        <Metric label="Errors" value={job.errorCount.toLocaleString("en-US")} />
        <Metric label="Progress" value={`${percent}%`} />
      </div>

      {job.status === "SUCCESS" ? (
        <div className="mt-4">
          <a
            href={`/api/ltl-rate-portal/bulk-jobs/${job.id}/results`}
            className="inline-flex rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Download batch CSV
          </a>
        </div>
      ) : null}

      {job.errorMessage ? (
        <p className="mt-4 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-sm text-danger">{job.errorMessage}</p>
      ) : null}
    </section>
  );
}

function SavedBulkJobsSection({
  jobs,
  currentJobId,
  onOpen,
  onDelete
}: {
  jobs: LtlBulkQuoteJobSummary[];
  currentJobId: string | null;
  onOpen: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-foreground">Saved bulk quote jobs</h2>
        <p className="mt-1 text-sm leading-6 text-mutedForeground">
          Batch lists are saved in the app so you can reopen them later and export the results again.
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {jobs.map((job) => (
          <div key={job.id} className="rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {job.name ?? "Unnamed bulk quote"} • {job.totalLanes.toLocaleString("en-US")} lanes
                </p>
                <p className="mt-1 text-sm text-mutedForeground">
                  {job.accountName} • {new Date(job.startedAt).toLocaleString("en-US")} • {formatJobStatus(job.status)} • {job.processedLanes.toLocaleString("en-US")}/{job.totalLanes.toLocaleString("en-US")} processed
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(job.id)}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  {currentJobId === job.id ? "Open now" : "Open job"}
                </button>
                {job.status === "SUCCESS" ? (
                  <a
                    href={`/api/ltl-rate-portal/bulk-jobs/${job.id}/results`}
                    className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Export CSV
                  </a>
                ) : null}
                {job.status === "SUCCESS" || job.status === "ERROR" || job.status === "CANCELLED" ? (
                  <button
                    type="button"
                    onClick={() => onDelete(job.id)}
                    className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BulkJobLaneSummary({ detail }: { detail: LtlBulkQuoteJobDetail }) {
  const grouped = groupResults(
    detail.lanes.flatMap((lane) => lane.quotes),
    detail.lanes.flatMap((lane) => lane.errors)
  );

  return (
    <>
      <RunSummary
        results={detail.lanes.flatMap((lane) => lane.quotes)}
        carrierErrors={detail.lanes.flatMap((lane) => lane.errors)}
        groupedResults={grouped}
      />
      {grouped.length > 0 ? <ResultsTable results={grouped} /> : null}
      {detail.lanes.some((lane) => lane.errors.length > 0) ? (
        <CarrierIssuesPanel carrierErrors={detail.lanes.flatMap((lane) => lane.errors)} />
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatJobStatus(status: LtlBulkQuoteJobSummary["status"]) {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "RUNNING":
      return "Running";
    case "SUCCESS":
      return "Completed";
    case "ERROR":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
  }
}

function RunSummary({
  results,
  carrierErrors,
  groupedResults
}: {
  results: LtlQuoteResult[];
  carrierErrors: LtlCarrierErrorResult[];
  groupedResults: GroupedLaneResult[];
}) {
  const quotedCarrierCount = results.length;
  const carrierIssueCount = carrierErrors.length;
  const laneCount = groupedResults.length;
  const quotedLaneCount = groupedResults.filter((result) =>
    Object.values(result.carrierResults).some((detail) => detail.total !== undefined)
  ).length;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Latest pull</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            Reviewed {laneCount.toLocaleString("en-US")} lanes, returned {quotedCarrierCount.toLocaleString("en-US")} carrier quotes, and captured {carrierIssueCount.toLocaleString("en-US")} carrier issues.
          </p>
        </div>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground">
          {quotedLaneCount.toLocaleString("en-US")} of {laneCount.toLocaleString("en-US")} lanes have at least one rate
        </span>
      </div>

      {quotedCarrierCount === 0 ? (
        <p className="mt-4 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-foreground">
          No carriers returned a rate on this run. Review the carrier issue messages below, then narrow the carrier selection or adjust lane details and rerun.
        </p>
      ) : null}
    </section>
  );
}

function ResultsTable({ results }: { results: GroupedLaneResult[] }) {
  const carrierColumns = Array.from(
    new Set(results.flatMap((result) => Object.keys(result.carrierResults)))
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted px-4 py-3">
        <p className="text-sm font-semibold text-foreground">Carrier comparisons</p>
        <p className="text-xs text-mutedForeground">
          {results.length.toLocaleString("en-US")} lanes with carrier comparison columns
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-card">
            <tr className="text-left text-xs uppercase tracking-wide text-mutedForeground">
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Origin</th>
              <th className="px-4 py-3">Destination</th>
              <th className="px-4 py-3">Weight</th>
              {carrierColumns.map((carrier) => (
                <th key={carrier} className="px-4 py-3">
                  {carrier}
                </th>
              ))}
              <th className="px-4 py-3">Cheapest Carrier</th>
              <th className="px-4 py-3">Cheapest Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {results.map((result) => (
              <tr key={`${result.customerReference}-${result.originLabel}-${result.destinationLabel}`} className="align-top">
                <td className="px-4 py-3 text-foreground">{result.customerReference}</td>
                <td className="px-4 py-3 text-mutedForeground">{result.originLabel}</td>
                <td className="px-4 py-3 text-mutedForeground">{result.destinationLabel}</td>
                <td className="px-4 py-3 text-mutedForeground">{result.weightLabel}</td>
                {carrierColumns.map((carrier) => (
                  <td key={carrier} className="px-4 py-3 text-foreground">
                    {result.carrierResults[carrier]?.total !== undefined ? (
                      `$${result.carrierResults[carrier].total?.toFixed(2)}`
                    ) : result.carrierResults[carrier]?.errorMessage ? (
                      <span className="text-xs leading-5 text-danger">{result.carrierResults[carrier].errorMessage}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                ))}
                <td className="px-4 py-3 font-medium text-foreground">{result.cheapestCarrier || "-"}</td>
                <td className="px-4 py-3 font-semibold text-foreground">
                  {result.cheapestRate !== null ? `$${result.cheapestRate.toFixed(2)}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CarrierIssuesPanel({ carrierErrors }: { carrierErrors: LtlCarrierErrorResult[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-base font-semibold text-foreground">Carrier issues</h2>
        <p className="mt-1 text-sm leading-6 text-mutedForeground">
          These carriers responded with lane-specific errors. They did not block the rest of the pull.
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {carrierErrors.map((error, index) => (
          <div
            key={`${error.customerReference}-${error.carrierHash}-${index}`}
            className="rounded-md border border-danger/20 bg-danger/5 p-3"
          >
            <p className="text-sm font-medium text-foreground">
              {error.customerReference} • {error.carrierName} ({error.scac})
            </p>
            <p className="mt-1 text-sm text-mutedForeground">
              {formatLaneLabel(error.originCity, error.originState, error.originZipcode, error.originCountry)} to{" "}
              {formatLaneLabel(
                error.destinationCity,
                error.destinationState,
                error.destinationZipcode,
                error.destinationCountry
              )}
            </p>
            <p className="mt-2 text-sm text-danger">{error.errorMessage}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function groupResults(results: LtlQuoteResult[], errors: LtlCarrierErrorResult[]): GroupedLaneResult[] {
  const grouped = new Map<string, GroupedLaneResult>();

  for (const result of results) {
    const key = [
      result.customerReference,
      result.originZipcode,
      result.destinationZipcode,
      result.pieces.map((piece) => `${piece.qty}x${piece.weight}`).join("|")
    ].join("::");

    const carrierLabel = `${result.carrierName} (${result.scac})`;
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, {
        customerReference: result.customerReference,
        originLabel: formatLaneLabel(result.originCity, result.originState, result.originZipcode, result.originCountry),
        destinationLabel: formatLaneLabel(
          result.destinationCity,
          result.destinationState,
          result.destinationZipcode,
          result.destinationCountry
        ),
        weightLabel: `${result.pieces.reduce((sum, piece) => sum + piece.qty * piece.weight, 0).toLocaleString("en-US")} lb`,
        carrierResults: { [carrierLabel]: { total: result.total } },
        cheapestCarrier: carrierLabel,
        cheapestRate: result.total
      });
      continue;
    }

    current.carrierResults[carrierLabel] = { total: result.total };
    if (current.cheapestRate === null || result.total < current.cheapestRate) {
      current.cheapestRate = result.total;
      current.cheapestCarrier = carrierLabel;
    }
  }

  for (const error of errors) {
    const key = [
      error.customerReference,
      error.originZipcode,
      error.destinationZipcode,
      error.pieces.map((piece) => `${piece.qty}x${piece.weight}`).join("|")
    ].join("::");
    const carrierLabel = `${error.carrierName} (${error.scac})`;
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, {
        customerReference: error.customerReference,
        originLabel: formatLaneLabel(error.originCity, error.originState, error.originZipcode, error.originCountry),
        destinationLabel: formatLaneLabel(
          error.destinationCity,
          error.destinationState,
          error.destinationZipcode,
          error.destinationCountry
        ),
        weightLabel: `${error.pieces.reduce((sum, piece) => sum + piece.qty * piece.weight, 0).toLocaleString("en-US")} lb`,
        carrierResults: { [carrierLabel]: { errorMessage: error.errorMessage } },
        cheapestCarrier: "",
        cheapestRate: null
      });
      continue;
    }

    if (current.carrierResults[carrierLabel]?.total === undefined) {
      current.carrierResults[carrierLabel] = { errorMessage: error.errorMessage };
    }
  }

  return Array.from(grouped.values());
}

function formatLaneLabel(city: string, state: string, zipcode: string, country: string) {
  const cityState = [city, state].filter(Boolean).join(", ");
  if (cityState) {
    return `${cityState} ${zipcode}`.trim();
  }

  return `${zipcode} ${country}`.trim();
}

function triggerCsvDownload(contents: string, fileName: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
