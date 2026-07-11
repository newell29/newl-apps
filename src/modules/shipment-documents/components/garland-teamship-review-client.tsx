"use client";

import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { useEffect, useMemo, useState } from "react";

import { parseGarlandShippingOrderPages, parseTeamshipAlertDigest } from "@/modules/shipment-documents/teamship-review";
import type {
  GarlandPdfShippingOrder,
  GarlandTeamshipReviewResponse,
  TeamshipShippingOrderDetail
} from "@/modules/shipment-documents/teamship-review-types";

type PdfJsModule = typeof import("pdfjs-dist");

type DailyOrdersResponse = {
  orders?: TeamshipShippingOrderDetail[];
  totalCount?: number;
  sync?: {
    runId: string;
    status: "SUCCESS" | "FAILED" | "SKIPPED";
    insertedCount: number;
    updatedCount: number;
    skippedCount: number;
    storedCount: number;
  };
  error?: string;
};

type TeamshipReviewHistoryOrder = {
  id: string;
  psNumber: string;
  srNumber: string;
  status: "PASS" | "FAIL" | "MISSING_TEAMSHIP" | "PENDING_TEAMSHIP";
  teamshipOrderId: string | null;
  carrier: string | null;
  shipToName: string | null;
  city: string | null;
  state: string | null;
  pageNumbers: number[];
  mismatchCount: number;
};

type TeamshipReviewHistoryRun = {
  id: string;
  documentLabel: string;
  shipmentDate: string;
  sourcePdfFileName: string | null;
  pdfOrderCount: number;
  teamshipMatchedCount: number;
  passedCount: number;
  failedCount: number;
  missingTeamshipCount: number;
  pendingTeamshipCount: number;
  alertDigestOrderCount: number;
  psNumbers: string[];
  srNumbers: string[];
  createdAt: string;
  createdByName: string | null;
  orders: TeamshipReviewHistoryOrder[];
};

type TeamshipReviewHistoryResponse = {
  runs: TeamshipReviewHistoryRun[];
  totalCount: number;
  search: string;
  error?: string;
};

let pdfJsLoader: Promise<PdfJsModule> | null = null;

export function GarlandTeamshipReviewClient({ canDeleteRuns }: { canDeleteRuns: boolean }) {
  const [shipmentDate, setShipmentDate] = useState(getTodayInputValue());
  const [documentLabel, setDocumentLabel] = useState(formatDateLabel(getTodayInputValue()));
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [orders, setOrders] = useState<GarlandPdfShippingOrder[]>([]);
  const [review, setReview] = useState<GarlandTeamshipReviewResponse | null>(null);
  const [dailyOrderCount, setDailyOrderCount] = useState<number | null>(null);
  const [dailySyncSummary, setDailySyncSummary] = useState<DailyOrdersResponse["sync"] | null>(null);
  const [alertDigest, setAlertDigest] = useState("");
  const [history, setHistory] = useState<TeamshipReviewHistoryResponse>({ runs: [], totalCount: 0, search: "" });
  const [historySearch, setHistorySearch] = useState("");
  const [status, setStatus] = useState("Upload the Garland daily shipping-order PDF to begin.");
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  useEffect(() => {
    void fetchHistory("");
  }, []);

  const extractedSummary = useMemo(() => {
    if (orders.length === 0) {
      return "No PDF orders extracted yet.";
    }

    return `${orders.length} PDF order${orders.length === 1 ? "" : "s"} extracted: ${orders
      .map((order) => order.srNumber)
      .join(", ")}`;
  }, [orders]);

  const parsedAlertCount = useMemo(() => parseTeamshipAlertDigest(alertDigest).length, [alertDigest]);

  async function handlePdfSelection(file: File | null) {
    setPdfFile(file);
    setOrders([]);
    setReview(null);
    setDailyOrderCount(null);
    setDailySyncSummary(null);
    setError(null);

    if (!file) {
      setStatus("Upload the Garland daily shipping-order PDF to begin.");
      return;
    }

    setIsProcessing(true);
    setStatus("Reading embedded PDF text from Garland shipping orders...");

    try {
      const parsedOrders = await extractOrdersFromPdf(file);
      setOrders(parsedOrders);
      setStatus(
        parsedOrders.length > 0
          ? `Ready to review ${parsedOrders.length} Garland order${parsedOrders.length === 1 ? "" : "s"} against Teamship.`
          : "No Garland PS/SR orders were found in this PDF."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read the Garland PDF.");
      setStatus("PDF extraction stopped before Teamship review.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function runReview() {
    setError(null);
    setReview(null);

    let extractedOrders = orders;

    try {
      if (extractedOrders.length === 0 && pdfFile) {
        setIsProcessing(true);
        setStatus("Extracting PDF orders before Teamship review...");
        extractedOrders = await extractOrdersFromPdf(pdfFile);
        setOrders(extractedOrders);
      }

      if (extractedOrders.length === 0) {
        throw new Error("Upload a Garland shipping-order PDF with at least one PS/SR order before running the review.");
      }

      setIsProcessing(true);
      setStatus("Fetching Teamship orders and comparing reviewed fields...");

      const response = await fetch("/api/shipment-documents/teamship-review/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate,
          orders: extractedOrders,
          alertDigest
        })
      });
      const json = (await response.json().catch(() => null)) as unknown;

      if (!response.ok || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to run the Teamship review.");
      }

      if (!isReviewResponse(json)) {
        throw new Error("Teamship review returned an unexpected response.");
      }

      setReview(json);
      setStatus(
        `Review complete: ${json.summary.passedCount} green, ${json.summary.pendingTeamshipCount} pending Teamship creation, ${json.summary.failedCount} with discrepancies, ${json.summary.missingTeamshipCount} missing without an alert.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to run the Teamship review.");
      setStatus("Teamship review stopped before results were created.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function fetchDailyOrders() {
    setError(null);
    setDailyOrderCount(null);
    setDailySyncSummary(null);
    setIsProcessing(true);
    setStatus("Syncing Garland Canada Distribution orders from Teamship for the selected day...");

    try {
      const response = await fetch("/api/shipment-documents/teamship-review/daily-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate
        })
      });
      const json = (await response.json().catch(() => null)) as DailyOrdersResponse | null;

      if (!response.ok || !json) {
        throw new Error(json?.error ?? "Unable to fetch Teamship daily orders.");
      }

      setDailyOrderCount(json.totalCount ?? json.orders?.length ?? 0);
      setDailySyncSummary(json.sync ?? null);
      setStatus(
        json.sync
          ? `Synced ${json.totalCount ?? json.orders?.length ?? 0} Teamship Garland order(s): ${json.sync.insertedCount} new, ${json.sync.updatedCount} updated, ${json.sync.skippedCount} skipped.`
          : `Fetched ${json.totalCount ?? json.orders?.length ?? 0} Teamship Garland order(s) for ${shipmentDate}.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sync Teamship daily orders.");
      setStatus("Teamship daily-order sync stopped.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function saveRunToHistory() {
    setError(null);
    setSaveStatus(null);

    if (!review) {
      setError("Run the Teamship review before saving it to history.");
      return;
    }

    const trimmedLabel = documentLabel.trim();

    if (!trimmedLabel) {
      setError("Enter a document label before saving the Teamship review run.");
      return;
    }

    setIsSaving(true);
    setSaveStatus("Saving Teamship review run...");

    try {
      const response = await fetch("/api/shipment-documents/teamship-review/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentLabel: trimmedLabel,
          shipmentDate,
          sourcePdfFileName: pdfFile?.name ?? null,
          review,
          alertDigest
        })
      });
      const json = (await response.json().catch(() => null)) as TeamshipReviewHistoryResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to save Teamship review run.");
      }

      setHistory(json);
      setHistorySearch(json.search);
      setSaveStatus("Teamship review run saved to history.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to save Teamship review run.";
      setError(message);
      setSaveStatus(null);
    } finally {
      setIsSaving(false);
    }
  }

  async function fetchHistory(search: string) {
    setHistoryError(null);
    setIsHistoryLoading(true);

    try {
      const params = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const response = await fetch(`/api/shipment-documents/teamship-review/runs${params}`);
      const json = (await response.json().catch(() => null)) as TeamshipReviewHistoryResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to load Teamship review history.");
      }

      setHistory(json);
      setHistorySearch(json.search);
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : "Unable to load Teamship review history.");
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function deleteRun(runId: string) {
    if (!canDeleteRuns) {
      return;
    }

    setHistoryError(null);
    setIsHistoryLoading(true);

    try {
      const response = await fetch(`/api/shipment-documents/teamship-review/runs/${runId}`, {
        method: "DELETE"
      });
      const json = (await response.json().catch(() => null)) as TeamshipReviewHistoryResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to delete Teamship review run.");
      }

      setHistory(json);
      setHistorySearch(json.search);
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : "Unable to delete Teamship review run.");
    } finally {
      setIsHistoryLoading(false);
    }
  }

  function handleShipmentDateChange(nextDate: string) {
    setDocumentLabel((currentLabel) =>
      currentLabel.trim() === formatDateLabel(shipmentDate) ? formatDateLabel(nextDate) : currentLabel
    );
    setShipmentDate(nextDate);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-2 text-sm font-semibold text-foreground">
            Review date
            <input
              type="date"
              value={shipmentDate}
              onChange={(event) => handleShipmentDateChange(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-2 text-sm font-semibold text-foreground">
            Document label
            <input
              type="text"
              value={documentLabel}
              onChange={(event) => setDocumentLabel(event.target.value)}
              placeholder="July 7, 2026"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-1">
          <label className="space-y-2 text-sm font-semibold text-foreground">
            Garland shipping-order PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => void handlePdfSelection(event.target.files?.[0] ?? null)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runReview()}
            disabled={isProcessing || !pdfFile}
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            Run Teamship review
          </button>
          <button
            type="button"
            onClick={() => void fetchDailyOrders()}
            disabled={isProcessing}
            className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sync Teamship daily orders
          </button>
          <p className="text-sm text-mutedForeground">{status}</p>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
          <div>
            <h2 className="text-base font-semibold text-foreground">Teamship alert digest</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Optional: paste the hourly Teamship Alert Digest here. If a Garland PDF order is not in Teamship yet but
              appears in the digest, it will show amber as pending creation instead of red as an unexplained missing
              order.
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              {parsedAlertCount} alert order{parsedAlertCount === 1 ? "" : "s"} detected
            </p>
          </div>
          <label className="space-y-2 text-sm font-semibold text-foreground">
            Paste alert email text
            <textarea
              value={alertDigest}
              onChange={(event) => setAlertDigest(event.target.value)}
              placeholder="Teamship Alert Digest&#10;&#10;Shipping Orders — Out of Stock (4)&#10;&#10;Order SR811861..."
              className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <SummaryCard label="PDF extraction" value={String(orders.length)} detail={extractedSummary} />
        <SummaryCard
          label="Teamship daily sync"
          value={dailyOrderCount === null ? "Not run" : String(dailyOrderCount)}
          detail={
            dailySyncSummary
              ? `${dailySyncSummary.insertedCount} new, ${dailySyncSummary.updatedCount} updated, ${dailySyncSummary.storedCount} stored for this shipment date.`
              : "Manual sync is available here. Scheduled sync is controlled from Settings."
          }
        />
        <SummaryCard
          label="Review result"
          value={review ? `${review.summary.passedCount}/${review.summary.pdfOrderCount} green` : "Not run"}
          detail={
            review
              ? `${review.summary.pendingTeamshipCount} pending, ${review.summary.failedCount} discrepancy, ${review.summary.missingTeamshipCount} missing without alert.`
              : "Run the review after uploading the Garland PDF."
          }
        />
      </section>

      {orders.length > 0 ? <ExtractedOrdersTable orders={orders} /> : null}
      {review ? (
        <ReviewResultsTable
          review={review}
          isSaving={isSaving}
          saveStatus={saveStatus}
          onSave={() => void saveRunToHistory()}
        />
      ) : null}
      <TeamshipReviewHistorySection
        history={history}
        historySearch={historySearch}
        historyError={historyError}
        isHistoryLoading={isHistoryLoading}
        canDeleteRuns={canDeleteRuns}
        onSearchChange={setHistorySearch}
        onSearch={() => void fetchHistory(historySearch)}
        onDelete={(runId) => void deleteRun(runId)}
      />
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-5 text-mutedForeground">{detail}</p>
    </div>
  );
}

function ExtractedOrdersTable({ orders }: { orders: GarlandPdfShippingOrder[] }) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border p-5">
        <h2 className="text-base font-semibold text-foreground">Extracted Garland PDF orders</h2>
        <p className="mt-1 text-sm text-mutedForeground">
          This is the order list the app will use to fetch matching Teamship shipment IDs.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-mutedForeground">
            <tr>
              <th className="px-4 py-3">Pages</th>
              <th className="px-4 py-3">PS</th>
              <th className="px-4 py-3">SR</th>
              <th className="px-4 py-3">Ship via</th>
              <th className="px-4 py-3">Ship to</th>
              <th className="px-4 py-3">Items</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((order) => (
              <tr key={`${order.psNumber}-${order.srNumber}`}>
                <td className="px-4 py-3 text-mutedForeground">{order.pageNumbers.join(", ")}</td>
                <td className="px-4 py-3 font-semibold text-foreground">{order.psNumber}</td>
                <td className="px-4 py-3 font-semibold text-foreground">{order.srNumber}</td>
                <td className="px-4 py-3">{order.shipVia ?? "Missing"}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{order.shipToName ?? "Missing"}</div>
                  <div className="text-mutedForeground">
                    {[order.shipToCity, order.shipToState, order.shipToPostalCode].filter(Boolean).join(", ")}
                  </div>
                </td>
                <td className="px-4 py-3 text-mutedForeground">{order.items.map((item) => item.sku).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReviewResultsTable({
  review,
  isSaving,
  saveStatus,
  onSave
}: {
  review: GarlandTeamshipReviewResponse;
  isSaving: boolean;
  saveStatus: string | null;
  onSave: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Teamship review results</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Green orders have no detected discrepancies. Amber orders are known Teamship alert items that have not been
            pushed into Teamship yet. Red orders need CSR review before Stage 2 automation updates them.
          </p>
          {saveStatus ? <p className="mt-2 text-sm font-medium text-mutedForeground">{saveStatus}</p> : null}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save review run"}
        </button>
      </div>
      <div className="divide-y divide-border">
        {review.reviews.map((orderReview) => (
          <details key={`${orderReview.psNumber}-${orderReview.srNumber}`} open={orderReview.status !== "PASS"}>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <span className="font-semibold text-foreground">
                  {orderReview.psNumber} / {orderReview.srNumber}
                </span>
                <span className="ml-3 text-sm text-mutedForeground">PDF page(s) {orderReview.pageNumbers.join(", ")}</span>
              </div>
              <span
                className={[
                  "rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide",
                  orderReview.status === "PASS"
                    ? "bg-success/10 text-success"
                    : orderReview.status === "MISSING_TEAMSHIP"
                      ? "bg-danger/10 text-danger"
                      : "bg-warning/15 text-warning"
                ].join(" ")}
              >
                {orderReview.status === "PASS"
                  ? "Green"
                  : orderReview.status === "MISSING_TEAMSHIP"
                    ? "Missing Teamship"
                    : orderReview.status === "PENDING_TEAMSHIP"
                      ? "Pending Teamship"
                      : `${orderReview.issueCount} issue${orderReview.issueCount === 1 ? "" : "s"}`}
              </span>
            </summary>
            <div className="overflow-x-auto px-5 pb-5">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-mutedForeground">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Garland PDF</th>
                    <th className="px-3 py-2">Teamship</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orderReview.fields.map((field) => (
                    <tr key={field.key}>
                      <td className="px-3 py-2 font-medium text-foreground">{field.label}</td>
                      <td className="px-3 py-2">
                        <span className={statusPillClass(field.status)}>{formatFieldStatus(field.status)}</span>
                      </td>
                      <td className="max-w-xs px-3 py-2 text-mutedForeground">{field.pdfValue ?? "Blank"}</td>
                      <td className="max-w-xs px-3 py-2 text-mutedForeground">{field.teamshipValue ?? "Blank"}</td>
                      <td className="px-3 py-2 text-mutedForeground">{field.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function TeamshipReviewHistorySection({
  history,
  historySearch,
  historyError,
  isHistoryLoading,
  canDeleteRuns,
  onSearchChange,
  onSearch,
  onDelete
}: {
  history: TeamshipReviewHistoryResponse;
  historySearch: string;
  historyError: string | null;
  isHistoryLoading: boolean;
  canDeleteRuns: boolean;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onDelete: (runId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Saved Teamship review history</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Search by date label, source file, PS/SR number, Teamship order, recipient, carrier, or review status.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          {history.totalCount} saved run{history.totalCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="border-b border-border p-5">
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            value={historySearch}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSearch();
              }
            }}
            placeholder="Search date, source file, PS, SR, Teamship order, or status"
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={onSearch}
            disabled={isHistoryLoading}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isHistoryLoading ? "Searching..." : "Search history"}
          </button>
        </div>

        {historyError ? (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            {historyError}
          </div>
        ) : null}
      </div>

      {history.runs.length === 0 ? (
        <p className="p-5 text-sm text-mutedForeground">No saved Teamship review runs match this search yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {history.runs.map((run) => (
            <details key={run.id} className="group">
              <summary className="grid cursor-pointer gap-4 px-5 py-4 lg:grid-cols-[1fr,1fr,auto] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{run.documentLabel}</span>
                    <span className={historyRunPillClass(run)}>
                      {run.failedCount + run.missingTeamshipCount > 0
                        ? `${run.failedCount + run.missingTeamshipCount} need review`
                        : run.pendingTeamshipCount > 0
                          ? `${run.pendingTeamshipCount} pending`
                          : "Approved"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-mutedForeground">
                    Shipment date {formatDisplayDate(run.shipmentDate)} · Saved {formatDateTime(run.createdAt)}
                  </p>
                  <p className="mt-1 text-sm text-mutedForeground">
                    {run.sourcePdfFileName ?? "No source file saved"} · Saved by {run.createdByName ?? "Unknown user"}
                  </p>
                </div>

                <div className="text-sm text-mutedForeground">
                  <p className="font-medium text-foreground">
                    {run.passedCount}/{run.pdfOrderCount} green · {run.teamshipMatchedCount} matched in Teamship
                  </p>
                  <p className="mt-1">
                    {run.failedCount} discrepancies · {run.pendingTeamshipCount} pending · {run.missingTeamshipCount} missing
                  </p>
                  <p className="mt-1 break-words">SRs: {run.srNumbers.slice(0, 16).join(", ")}</p>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {canDeleteRuns ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        onDelete(run.id);
                      }}
                      className="rounded-md border border-danger/30 px-3 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger/10"
                    >
                      Delete
                    </button>
                  ) : null}
                  <span className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-mutedForeground">
                    Expand
                  </span>
                </div>
              </summary>

              <div className="overflow-x-auto px-5 pb-5">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-mutedForeground">
                    <tr>
                      <th className="px-3 py-2">Pages</th>
                      <th className="px-3 py-2">PS</th>
                      <th className="px-3 py-2">SR</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Ship to</th>
                      <th className="px-3 py-2">Carrier</th>
                      <th className="px-3 py-2">Teamship</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {run.orders.map((order) => (
                      <tr key={order.id}>
                        <td className="px-3 py-2 text-mutedForeground">{order.pageNumbers.join(", ") || "N/A"}</td>
                        <td className="px-3 py-2 font-semibold text-foreground">{order.psNumber}</td>
                        <td className="px-3 py-2 font-semibold text-foreground">{order.srNumber}</td>
                        <td className="px-3 py-2">
                          <span className={reviewStatusPillClass(order.status)}>
                            {formatReviewStatus(order.status, order.mismatchCount)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-mutedForeground">
                          {[order.shipToName, order.city, order.state].filter(Boolean).join(", ") || "Missing"}
                        </td>
                        <td className="px-3 py-2 text-mutedForeground">{order.carrier ?? "Missing"}</td>
                        <td className="px-3 py-2 text-mutedForeground">{order.teamshipOrderId ?? "Not matched"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function statusPillClass(status: string) {
  const base = "rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide";

  if (status === "MATCH") {
    return `${base} bg-success/10 text-success`;
  }

  if (status === "INFO") {
    return `${base} bg-muted text-mutedForeground`;
  }

  if (status === "PENDING") {
    return `${base} bg-warning/15 text-warning`;
  }

  return `${base} bg-danger/10 text-danger`;
}

function formatFieldStatus(status: string) {
  return status === "MATCH"
    ? "Match"
    : status === "INFO"
      ? "Info"
      : status === "MISSING"
        ? "Missing"
        : status === "PENDING"
          ? "Pending"
          : "Issue";
}

function historyRunPillClass(run: TeamshipReviewHistoryRun) {
  const base = "rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide";

  if (run.failedCount + run.missingTeamshipCount > 0) {
    return `${base} bg-danger/10 text-danger`;
  }

  if (run.pendingTeamshipCount > 0) {
    return `${base} bg-warning/15 text-warning`;
  }

  return `${base} bg-success/10 text-success`;
}

function reviewStatusPillClass(status: TeamshipReviewHistoryOrder["status"]) {
  const base = "rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide";

  if (status === "PASS") {
    return `${base} bg-success/10 text-success`;
  }

  if (status === "PENDING_TEAMSHIP") {
    return `${base} bg-warning/15 text-warning`;
  }

  return `${base} bg-danger/10 text-danger`;
}

function formatReviewStatus(status: TeamshipReviewHistoryOrder["status"], mismatchCount: number) {
  if (status === "PASS") {
    return "Approved";
  }

  if (status === "PENDING_TEAMSHIP") {
    return "Pending";
  }

  if (status === "MISSING_TEAMSHIP") {
    return "Missing";
  }

  return `${mismatchCount} issue${mismatchCount === 1 ? "" : "s"}`;
}

function formatDateLabel(dateValue: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${dateValue}T00:00:00.000Z`));
}

function formatDisplayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function isErrorResponse(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === "object" && "error" in value && typeof value.error === "string");
}

function isReviewResponse(value: unknown): value is GarlandTeamshipReviewResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "summary" in value &&
      "reviews" in value &&
      Array.isArray((value as GarlandTeamshipReviewResponse).reviews)
  );
}

async function extractOrdersFromPdf(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await loadPdf(bytes);
  const pages: Array<{ pageNumber: number; text: string }> = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push({
      pageNumber,
      text: await extractPageText(page)
    });
  }

  return parseGarlandShippingOrderPages(pages);
}

async function loadPdf(fileBytes: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(fileBytes.byteLength);
  bytes.set(fileBytes);

  return pdfjs.getDocument({
    data: bytes,
    cMapPacked: true,
    cMapUrl: "/pdfjs/cmaps/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/"
  }).promise;
}

async function loadPdfJs() {
  if (!pdfJsLoader) {
    pdfJsLoader = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return module;
    });
  }

  return pdfJsLoader;
}

async function extractPageText(page: PDFPageProxy) {
  const textContent = await page.getTextContent();
  const items = textContent.items
    .map((item) => {
      if (!("str" in item) || !item.str.trim()) {
        return null;
      }

      const transform = "transform" in item && Array.isArray(item.transform) ? item.transform : [];
      return {
        text: item.str,
        x: Number(transform[4] ?? 0),
        y: Number(transform[5] ?? 0)
      };
    })
    .filter((item): item is { text: string; x: number; y: number } => Boolean(item))
    .sort((left, right) => {
      const yDiff = right.y - left.y;
      return Math.abs(yDiff) > 3 ? yDiff : left.x - right.x;
    });
  const lines: Array<{ y: number; parts: string[] }> = [];

  for (const item of items) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);

    if (line) {
      line.parts.push(item.text);
      continue;
    }

    lines.push({ y: item.y, parts: [item.text] });
  }

  return lines.map((line) => line.parts.join(" ").replace(/\s+/g, " ").trim()).join("\n");
}

function getTodayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
