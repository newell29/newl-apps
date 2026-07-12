"use client";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { useEffect, useMemo, useState } from "react";

import { parseGarlandShippingOrderPages, parseTeamshipAlertDigest } from "@/modules/shipment-documents/teamship-review";
import type {
  GarlandPdfShippingOrder,
  GarlandTeamshipOrderReview,
  GarlandTeamshipReviewResponse,
  TeamshipPayloadInspectionMatch,
  TeamshipPayloadInspectionResult,
  TeamshipShippingOrderDetail
} from "@/modules/shipment-documents/teamship-review-types";

type PdfJsModule = typeof import("pdfjs-dist");

type DailyOrdersResponse = {
  orders?: TeamshipShippingOrderDetail[];
  totalCount?: number;
  sync?: {
    runId?: string;
    runIds?: string[];
    status: "SUCCESS" | "FAILED" | "SKIPPED";
    dateFrom?: string;
    dateTo?: string;
    fetchedCount?: number;
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
  status: "PASS" | "FAIL" | "MISSING_TEAMSHIP" | "PENDING_TEAMSHIP" | "NO_PDF" | "SKIPPED_ALREADY_REVIEWED";
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
  noPdfCount: number;
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
  dateFrom: string;
  dateTo: string;
  allDates: boolean;
  error?: string;
};

type TeamshipUpdateOrderSummary = {
  id: string;
  psNumber: string;
  srNumber: string;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  status: "READY" | "BLOCKED" | "SKIPPED" | "APPROVED" | "RUNNING" | "SUCCESS" | "FAILED" | "NEEDS_REVIEW";
  sourceReviewStatus: string;
  plannedFieldUpdateCount: number;
  plannedPalletRowCount: number;
  validationIssues: string[];
  errorMessage: string | null;
  agentEvidence: {
    status: string;
    fieldActionCount: number;
    palletActionCount: number;
    responseStatus: number | null;
    error: string | null;
  } | null;
};

type TeamshipUpdateJobSummary = {
  id: string;
  documentLabel: string;
  shipmentDate: string;
  sourcePdfFileName: string | null;
  status: "DRAFT" | "APPROVED" | "RUNNING" | "SUCCESS" | "FAILED" | "NEEDS_REVIEW" | "CANCELLED";
  agentMode: string;
  dryRun: boolean;
  selectedSrNumbers: string[];
  summary: {
    orderCount: number;
    readyCount: number;
    blockedCount: number;
    skippedCount: number;
    plannedFieldUpdateCount: number;
    plannedPalletRowCount: number;
  };
  errorMessage: string | null;
  agentId: string | null;
  createdAt: string;
  approvedAt: string | null;
  agentClaimedAt: string | null;
  agentStartedAt: string | null;
  agentFinishedAt: string | null;
  lastVerificationAt: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  orders: TeamshipUpdateOrderSummary[];
};

type TeamshipUpdateJobsResponse = {
  jobs: TeamshipUpdateJobSummary[];
  totalCount: number;
  error?: string;
};

type TeamshipUpdateAgentMode = "DRY_RUN" | "LIVE_API";

type PayloadInspectionResponse = TeamshipPayloadInspectionResult | { error: string };

type ShipmentWorkspaceStatus = GarlandTeamshipOrderReview["status"] | "TEAMSHIP_PULLED" | "PDF_READY";

type ShipmentWorkspaceRow = {
  id: string;
  status: ShipmentWorkspaceStatus;
  psNumber: string | null;
  srNumber: string | null;
  pdfPages: number[];
  carrier: string | null;
  shipToName: string | null;
  cityState: string | null;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  issueCount: number;
  review: GarlandTeamshipOrderReview | null;
  pdfOrder: GarlandPdfShippingOrder | null;
  teamshipOrder: TeamshipShippingOrderDetail | null;
};

let pdfJsLoader: Promise<PdfJsModule> | null = null;

export function GarlandTeamshipReviewClient({ canDeleteRuns }: { canDeleteRuns: boolean }) {
  const todayInputValue = getTodayInputValue();
  const [shipmentDate, setShipmentDate] = useState(todayInputValue);
  const [syncDateFrom, setSyncDateFrom] = useState(todayInputValue);
  const [syncDateTo, setSyncDateTo] = useState(todayInputValue);
  const [documentLabel, setDocumentLabel] = useState(formatDateLabel(todayInputValue));
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [orders, setOrders] = useState<GarlandPdfShippingOrder[]>([]);
  const [review, setReview] = useState<GarlandTeamshipReviewResponse | null>(null);
  const [dailyOrders, setDailyOrders] = useState<TeamshipShippingOrderDetail[]>([]);
  const [dailyOrderCount, setDailyOrderCount] = useState<number | null>(null);
  const [dailySyncSummary, setDailySyncSummary] = useState<DailyOrdersResponse["sync"] | null>(null);
  const [alertDigest, setAlertDigest] = useState("");
  const [history, setHistory] = useState<TeamshipReviewHistoryResponse>({
    runs: [],
    totalCount: 0,
    search: "",
    dateFrom: todayInputValue,
    dateTo: todayInputValue,
    allDates: false
  });
  const [updateJobs, setUpdateJobs] = useState<TeamshipUpdateJobSummary[]>([]);
  const [selectedUpdateSrNumbers, setSelectedUpdateSrNumbers] = useState<Set<string>>(new Set());
  const [updateJobMode, setUpdateJobMode] = useState<TeamshipUpdateAgentMode>("DRY_RUN");
  const [updateJobStatus, setUpdateJobStatus] = useState<string | null>(null);
  const [payloadInspections, setPayloadInspections] = useState<Record<string, TeamshipPayloadInspectionResult>>({});
  const [payloadInspectionErrors, setPayloadInspectionErrors] = useState<Record<string, string>>({});
  const [payloadInspectionLoadingSr, setPayloadInspectionLoadingSr] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState(todayInputValue);
  const [historyDateTo, setHistoryDateTo] = useState(todayInputValue);
  const [historyAllDates, setHistoryAllDates] = useState(false);
  const [status, setStatus] = useState("Upload the Garland daily shipping-order PDF to begin.");
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isUpdateJobLoading, setIsUpdateJobLoading] = useState(false);

  useEffect(() => {
    const today = getTodayInputValue();
    void fetchHistory("", today, today, false);
    void fetchUpdateJobs();
  }, []);

  const parsedAlertCount = useMemo(() => parseTeamshipAlertDigest(alertDigest).length, [alertDigest]);
  const workspaceRows = useMemo(
    () => buildShipmentWorkspaceRows({ review, pdfOrders: orders, teamshipOrders: dailyOrders }),
    [review, orders, dailyOrders]
  );

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

  async function runReview({ rescan = false, srNumber = null }: { rescan?: boolean; srNumber?: string | null } = {}) {
    setError(null);
    setUpdateJobStatus(null);
    if (!srNumber) {
      setReview(null);
    }

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

      const ordersToReview = srNumber
        ? extractedOrders.filter((order) => normalizeIdentifier(order.srNumber) === normalizeIdentifier(srNumber))
        : extractedOrders;

      if (ordersToReview.length === 0) {
        throw new Error(`No uploaded Garland PDF order was found for ${srNumber}.`);
      }

      setIsProcessing(true);
      setStatus(srNumber ? `Rescanning Teamship details for ${srNumber}...` : "Fetching Teamship orders and comparing reviewed fields...");

      const response = await fetch("/api/shipment-documents/teamship-review/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate,
          orders: ordersToReview,
          alertDigest,
          rescan: rescan || Boolean(srNumber)
        })
      });
      const json = (await response.json().catch(() => null)) as unknown;

      if (!response.ok || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to run the Teamship review.");
      }

      if (!isReviewResponse(json)) {
        throw new Error("Teamship review returned an unexpected response.");
      }

      const nextReview = srNumber && review ? mergePartialReview(review, json) : json;
      setReview(nextReview);
      setSelectedUpdateSrNumbers(new Set(nextReview.reviews.filter(isUpdateEligibleReview).map((row) => row.srNumber)));
      setStatus(
        `${rescan || srNumber ? "Rescan complete" : "Review complete"}: ${nextReview.summary.passedCount} green, ${nextReview.summary.pendingTeamshipCount} pending Teamship creation, ${nextReview.summary.failedCount} with discrepancies, ${nextReview.summary.missingTeamshipCount} missing without an alert.`
          + (nextReview.summary.noPdfCount > 0 ? ` ${nextReview.summary.noPdfCount} Teamship order(s) had no uploaded PDF.` : "")
          + (nextReview.summary.skippedAlreadyReviewedCount > 0 ? ` ${nextReview.summary.skippedAlreadyReviewedCount} already-reviewed order(s) were skipped.` : "")
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to run the Teamship review.");
      setStatus("Teamship review stopped before results were created.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function fetchUpdateJobs() {
    setIsUpdateJobLoading(true);

    try {
      const response = await fetch("/api/shipment-documents/teamship-review/update-jobs");
      const json = (await response.json().catch(() => null)) as TeamshipUpdateJobsResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to load Teamship update jobs.");
      }

      setUpdateJobs(json.jobs);
    } catch (caught) {
      setUpdateJobStatus(caught instanceof Error ? caught.message : "Unable to load Teamship update jobs.");
    } finally {
      setIsUpdateJobLoading(false);
    }
  }

  async function createUpdateJob(selectedSrNumberOverride?: string[]) {
    setError(null);
    setUpdateJobStatus(null);

    if (!review) {
      setError("Run the Teamship review before creating an update job.");
      return;
    }

    const selectedSrNumbers = selectedSrNumberOverride ?? Array.from(selectedUpdateSrNumbers);

    if (selectedSrNumbers.length === 0) {
      setError("Select at least one shipment before creating an update job.");
      return;
    }

    setIsUpdateJobLoading(true);
    setUpdateJobStatus("Creating Teamship update draft...");

    try {
      const response = await fetch("/api/shipment-documents/teamship-review/update-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentLabel: documentLabel.trim() || formatDateLabel(shipmentDate),
          shipmentDate,
          sourcePdfFileName: pdfFile?.name ?? null,
          review,
          selectedSrNumbers,
          agentMode: updateJobMode
        })
      });
      const json = (await response.json().catch(() => null)) as TeamshipUpdateJobsResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to create Teamship update job.");
      }

      setUpdateJobs(json.jobs);
      setUpdateJobStatus(
        updateJobMode === "LIVE_API"
          ? "Live Teamship update draft created. Review it carefully before approving the VM agent."
          : "Dry-run Teamship update draft created. Review blocked rows before approving the agent."
      );
    } catch (caught) {
      setUpdateJobStatus(null);
      setError(caught instanceof Error ? caught.message : "Unable to create Teamship update job.");
    } finally {
      setIsUpdateJobLoading(false);
    }
  }

  function selectIssueShipments() {
    if (!review) {
      return;
    }

    setSelectedUpdateSrNumbers(new Set(review.reviews.filter(isIssueUpdateEligibleReview).map((row) => row.srNumber)));
  }

  function selectAllEligibleShipments() {
    if (!review) {
      return;
    }

    setSelectedUpdateSrNumbers(new Set(review.reviews.filter(isUpdateEligibleReview).map((row) => row.srNumber)));
  }

  function clearSelectedShipments() {
    setSelectedUpdateSrNumbers(new Set());
  }

  async function createUpdateJobForIssueShipments() {
    if (!review) {
      setError("Run the Teamship review before creating an update job.");
      return;
    }

    const issueSrNumbers = review.reviews.filter(isIssueUpdateEligibleReview).map((row) => row.srNumber);

    if (issueSrNumbers.length === 0) {
      setError("No issue shipments are available for agent update.");
      return;
    }

    setSelectedUpdateSrNumbers(new Set(issueSrNumbers));
    await createUpdateJob(issueSrNumbers);
  }

  async function updateJobAction(jobId: string, action: "approve" | "cancel" | "rescan") {
    setError(null);
    setUpdateJobStatus(action === "approve" ? "Approving job for agent..." : action === "rescan" ? "Rescanning Teamship details..." : "Cancelling job...");
    setIsUpdateJobLoading(true);

    try {
      const response = await fetch(`/api/shipment-documents/teamship-review/update-jobs/${jobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const json = (await response.json().catch(() => null)) as TeamshipUpdateJobsResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to update Teamship update job.");
      }

      setUpdateJobs(json.jobs);
      setUpdateJobStatus(
        action === "approve"
          ? "Job approved. The VM agent can claim it on its next run."
          : action === "rescan"
            ? "Teamship details rescanned for this job."
            : "Job cancelled."
      );
    } catch (caught) {
      setUpdateJobStatus(null);
      setError(caught instanceof Error ? caught.message : "Unable to update Teamship update job.");
    } finally {
      setIsUpdateJobLoading(false);
    }
  }

  async function inspectTeamshipPayload({
    srNumber,
    expectedSerials,
    expectedSkus
  }: {
    srNumber: string;
    expectedSerials: string[];
    expectedSkus: string[];
  }) {
    const srKey = normalizeIdentifier(srNumber);
    setPayloadInspectionLoadingSr(srKey);
    setPayloadInspectionErrors((current) => {
      const next = { ...current };
      delete next[srKey];
      return next;
    });
    setStatus(`Inspecting fetched Teamship payload for ${srNumber}...`);

    try {
      const response = await fetch("/api/shipment-documents/teamship-review/inspect-payload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate,
          srNumber,
          expectedSerials,
          expectedSkus
        })
      });
      const json = (await response.json().catch(() => null)) as PayloadInspectionResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to inspect the Teamship payload.");
      }

      setPayloadInspections((current) => ({ ...current, [srKey]: json }));
      setStatus(json.message);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to inspect the Teamship payload.";
      setPayloadInspectionErrors((current) => ({ ...current, [srKey]: message }));
      setStatus("Teamship payload inspection stopped before results were created.");
    } finally {
      setPayloadInspectionLoadingSr(null);
    }
  }

  async function fetchDailyOrders() {
    setError(null);
    setDailyOrderCount(null);
    setDailySyncSummary(null);
    setDailyOrders([]);
    setIsProcessing(true);
    setStatus(`Pulling missing Garland Teamship orders from ${syncDateFrom} to ${syncDateTo}...`);

    try {
      const response = await fetch("/api/shipment-documents/teamship-review/daily-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDateFrom: syncDateFrom,
          shipmentDateTo: syncDateTo
        })
      });
      const json = (await response.json().catch(() => null)) as DailyOrdersResponse | null;

      if (!response.ok || !json) {
        throw new Error(json?.error ?? "Unable to fetch Teamship daily orders.");
      }

      setDailyOrderCount(json.totalCount ?? json.orders?.length ?? 0);
      setDailySyncSummary(json.sync ?? null);
      setDailyOrders(json.orders ?? []);
      setStatus(
        json.sync
          ? `Pulled ${json.sync.insertedCount} new Teamship Garland order(s) from ${json.sync.dateFrom ?? syncDateFrom} to ${json.sync.dateTo ?? syncDateTo}; ${json.sync.skippedCount} already existed or could not be keyed.`
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
      setHistoryDateFrom(json.dateFrom);
      setHistoryDateTo(json.dateTo);
      setHistoryAllDates(json.allDates);
      setSaveStatus("Teamship review run saved to history.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to save Teamship review run.";
      setError(message);
      setSaveStatus(null);
    } finally {
      setIsSaving(false);
    }
  }

  async function downloadReviewSummaryPdf() {
    setError(null);

    if (!review) {
      setError("Run the Teamship review before generating the summary PDF.");
      return;
    }

    try {
      const pdfBytes = await buildReviewSummaryPdf({
        documentLabel: documentLabel.trim() || formatDateLabel(shipmentDate),
        shipmentDate,
        review,
        rows: workspaceRows
      });
      downloadBlob(
        new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }),
        `Teamship Review Summary - ${documentLabel.trim() || shipmentDate}.pdf`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate the Teamship review summary PDF.");
    }
  }

  function downloadSkuDirectoryCsv() {
    setError(null);

    if (!review) {
      setError("Run the Teamship review before generating the SKU directory.");
      return;
    }

    downloadBlob(
      new Blob([buildSkuDirectoryCsv(review.reviews)], { type: "text/csv;charset=utf-8" }),
      `Garland SKU Dimension Directory - ${documentLabel.trim() || shipmentDate}.csv`
    );
  }

  async function fetchHistory(search: string, dateFrom: string, dateTo: string, allDates: boolean) {
    setHistoryError(null);
    setIsHistoryLoading(true);

    try {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set("search", search.trim());
      }

      if (allDates) {
        params.set("allDates", "true");
      } else {
        if (dateFrom) {
          params.set("dateFrom", dateFrom);
        }
        if (dateTo) {
          params.set("dateTo", dateTo);
        }
      }

      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/shipment-documents/teamship-review/runs${query}`);
      const json = (await response.json().catch(() => null)) as TeamshipReviewHistoryResponse | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to load Teamship review history.");
      }

      setHistory(json);
      setHistorySearch(json.search);
      setHistoryDateFrom(json.dateFrom);
      setHistoryDateTo(json.dateTo);
      setHistoryAllDates(json.allDates);
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
      const json = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok || !json || isErrorResponse(json)) {
        throw new Error(isErrorResponse(json) ? json.error : "Unable to delete Teamship review run.");
      }

      await fetchHistory(historySearch, historyDateFrom, historyDateTo, historyAllDates);
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
            onClick={() => void runReview({ rescan: true })}
            disabled={isProcessing || !pdfFile}
            className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Rescan Teamship details
          </button>
          <button
            type="button"
            onClick={() => void fetchDailyOrders()}
            disabled={isProcessing}
            className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Pull missing Teamship orders
          </button>
          <p className="text-sm text-mutedForeground">{status}</p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-semibold text-foreground">
            Manual sync from
            <input
              type="date"
              value={syncDateFrom}
              onChange={(event) => setSyncDateFrom(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-2 text-sm font-semibold text-foreground">
            Manual sync to
            <input
              type="date"
              value={syncDateTo}
              onChange={(event) => setSyncDateTo(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            {error}
          </div>
        ) : null}
      </section>

      <details className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Teamship alert digest</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              Optional. Paste only when Teamship says orders are blocked or out of stock.
            </p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold uppercase tracking-wide text-mutedForeground">
            {parsedAlertCount} alert order{parsedAlertCount === 1 ? "" : "s"}
          </span>
        </summary>
        <label className="mt-4 block space-y-2 text-sm font-semibold text-foreground">
          Paste alert email text
          <textarea
            value={alertDigest}
            onChange={(event) => setAlertDigest(event.target.value)}
            placeholder="Teamship Alert Digest&#10;&#10;Shipping Orders — Out of Stock (4)&#10;&#10;Order SR811861..."
            className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      </details>

      <ShipmentReviewWorkspace
        rows={workspaceRows}
        review={review}
        pdfOrderCount={orders.length}
        teamshipOrderCount={dailyOrderCount ?? dailyOrders.length}
        syncSummary={dailySyncSummary}
        isSaving={isSaving}
        saveStatus={saveStatus}
        onSave={() => void saveRunToHistory()}
        onDownloadSummary={() => void downloadReviewSummaryPdf()}
        onDownloadSkuDirectory={() => void downloadSkuDirectoryCsv()}
        selectedUpdateSrNumbers={selectedUpdateSrNumbers}
        updateJobMode={updateJobMode}
        updateJobs={updateJobs}
        updateJobStatus={updateJobStatus}
        isUpdateJobLoading={isUpdateJobLoading}
        onSelectIssueShipments={selectIssueShipments}
        onSelectAllEligibleShipments={selectAllEligibleShipments}
        onClearSelectedShipments={clearSelectedShipments}
        onToggleUpdateSelection={(srNumber, selected) => {
          setSelectedUpdateSrNumbers((current) => {
            const next = new Set(current);
            if (selected) {
              next.add(srNumber);
            } else {
              next.delete(srNumber);
            }
            return next;
          });
        }}
        onUpdateJobModeChange={setUpdateJobMode}
        onCreateUpdateJob={() => void createUpdateJob()}
        onCreateIssueUpdateJob={() => void createUpdateJobForIssueShipments()}
        onCreateSingleUpdateJob={(srNumber) => void createUpdateJob([srNumber])}
        onUpdateJobAction={(jobId, action) => void updateJobAction(jobId, action)}
        onRescanShipment={(srNumber) => void runReview({ rescan: true, srNumber })}
        payloadInspections={payloadInspections}
        payloadInspectionErrors={payloadInspectionErrors}
        payloadInspectionLoadingSr={payloadInspectionLoadingSr}
        onInspectPayload={(input) => void inspectTeamshipPayload(input)}
      />
      <TeamshipReviewHistorySection
        history={history}
        historySearch={historySearch}
        historyDateFrom={historyDateFrom}
        historyDateTo={historyDateTo}
        historyAllDates={historyAllDates}
        historyError={historyError}
        isHistoryLoading={isHistoryLoading}
        canDeleteRuns={canDeleteRuns}
        onSearchChange={setHistorySearch}
        onDateFromChange={(value) => {
          setHistoryDateFrom(value);
          setHistoryAllDates(false);
        }}
        onDateToChange={(value) => {
          setHistoryDateTo(value);
          setHistoryAllDates(false);
        }}
        onAllDates={() => {
          setHistoryAllDates(true);
          setHistoryDateFrom("");
          setHistoryDateTo("");
          void fetchHistory(historySearch, "", "", true);
        }}
        onToday={() => {
          const today = getTodayInputValue();
          setHistoryAllDates(false);
          setHistoryDateFrom(today);
          setHistoryDateTo(today);
          void fetchHistory(historySearch, today, today, false);
        }}
        onSearch={() => void fetchHistory(historySearch, historyDateFrom, historyDateTo, historyAllDates)}
        onDelete={(runId) => void deleteRun(runId)}
      />
    </div>
  );
}

function ShipmentReviewWorkspace({
  rows,
  review,
  pdfOrderCount,
  teamshipOrderCount,
  syncSummary,
  isSaving,
  saveStatus,
  onSave,
  onDownloadSummary,
  onDownloadSkuDirectory,
  selectedUpdateSrNumbers,
  updateJobMode,
  updateJobs,
  updateJobStatus,
  isUpdateJobLoading,
  onSelectIssueShipments,
  onSelectAllEligibleShipments,
  onClearSelectedShipments,
  onToggleUpdateSelection,
  onUpdateJobModeChange,
  onCreateUpdateJob,
  onCreateIssueUpdateJob,
  onCreateSingleUpdateJob,
  onUpdateJobAction,
  onRescanShipment,
  payloadInspections,
  payloadInspectionErrors,
  payloadInspectionLoadingSr,
  onInspectPayload
}: {
  rows: ShipmentWorkspaceRow[];
  review: GarlandTeamshipReviewResponse | null;
  pdfOrderCount: number;
  teamshipOrderCount: number;
  syncSummary: DailyOrdersResponse["sync"] | null;
  isSaving: boolean;
  saveStatus: string | null;
  onSave: () => void;
  onDownloadSummary: () => void;
  onDownloadSkuDirectory: () => void;
  selectedUpdateSrNumbers: Set<string>;
  updateJobMode: TeamshipUpdateAgentMode;
  updateJobs: TeamshipUpdateJobSummary[];
  updateJobStatus: string | null;
  isUpdateJobLoading: boolean;
  onSelectIssueShipments: () => void;
  onSelectAllEligibleShipments: () => void;
  onClearSelectedShipments: () => void;
  onToggleUpdateSelection: (srNumber: string, selected: boolean) => void;
  onUpdateJobModeChange: (mode: TeamshipUpdateAgentMode) => void;
  onCreateUpdateJob: () => void;
  onCreateIssueUpdateJob: () => void;
  onCreateSingleUpdateJob: (srNumber: string) => void;
  onUpdateJobAction: (jobId: string, action: "approve" | "cancel" | "rescan") => void;
  onRescanShipment: (srNumber: string) => void;
  payloadInspections: Record<string, TeamshipPayloadInspectionResult>;
  payloadInspectionErrors: Record<string, string>;
  payloadInspectionLoadingSr: string | null;
  onInspectPayload: (input: { srNumber: string; expectedSerials: string[]; expectedSkus: string[] }) => void;
}) {
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());
  const selectedCount = selectedUpdateSrNumbers.size;
  const issueEligibleCount = review?.reviews.filter(isIssueUpdateEligibleReview).length ?? 0;
  const eligibleCount = review?.reviews.filter(isUpdateEligibleReview).length ?? 0;

  useEffect(() => {
    setExpandedRowIds(new Set(rows.filter((row) => row.review && row.status !== "PASS").map((row) => row.id)));
  }, [rows]);

  function setRowOpen(rowId: string, isOpen: boolean) {
    setExpandedRowIds((current) => {
      const next = new Set(current);

      if (isOpen) {
        next.add(rowId);
      } else {
        next.delete(rowId);
      }

      return next;
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Shipment review workspace</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Each shipment lives on one expandable line. The line changes color after review, and the details expand
            underneath the shipment instead of running down the page.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide">
            <span className="rounded-full bg-muted px-3 py-1 text-mutedForeground">{teamshipOrderCount} Teamship</span>
            <span className="rounded-full bg-muted px-3 py-1 text-mutedForeground">{pdfOrderCount} PDF</span>
            {syncSummary ? (
              <span className="rounded-full bg-muted px-3 py-1 text-mutedForeground">
                {syncSummary.insertedCount} new / {syncSummary.skippedCount} skipped
              </span>
            ) : null}
            {review ? (
              <>
                <span className="rounded-full bg-success/10 px-3 py-1 text-success">{review.summary.passedCount} green</span>
                <span className="rounded-full bg-warning/15 px-3 py-1 text-warning">
                  {review.summary.pendingTeamshipCount + review.summary.noPdfCount} amber
                </span>
                <span className="rounded-full bg-danger/10 px-3 py-1 text-danger">
                  {review.summary.failedCount + review.summary.missingTeamshipCount} red
                </span>
              </>
            ) : null}
          </div>
          {saveStatus ? <p className="mt-2 text-sm font-medium text-mutedForeground">{saveStatus}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExpandedRowIds(new Set(rows.map((row) => row.id)))}
            disabled={rows.length === 0}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setExpandedRowIds(new Set())}
            disabled={rows.length === 0}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Collapse all
          </button>
          <button
            type="button"
            onClick={onDownloadSummary}
            disabled={!review}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Download summary PDF
          </button>
          <button
            type="button"
            onClick={onDownloadSkuDirectory}
            disabled={!review}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Download SKU directory CSV
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || !review}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save review run"}
          </button>
          <button
            type="button"
            onClick={onSelectIssueShipments}
            disabled={isUpdateJobLoading || issueEligibleCount === 0}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Select issues ({issueEligibleCount})
          </button>
          <button
            type="button"
            onClick={onSelectAllEligibleShipments}
            disabled={isUpdateJobLoading || eligibleCount === 0}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Select all ({eligibleCount})
          </button>
          <button
            type="button"
            onClick={onClearSelectedShipments}
            disabled={isUpdateJobLoading || selectedCount === 0}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Clear selection
          </button>
          <label className="min-w-56 space-y-1 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            Agent mode
            <select
              value={updateJobMode}
              onChange={(event) => onUpdateJobModeChange(event.target.value === "LIVE_API" ? "LIVE_API" : "DRY_RUN")}
              disabled={isUpdateJobLoading || !review}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-semibold normal-case tracking-normal text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="DRY_RUN">Dry run evidence only</option>
              <option value="LIVE_API">Live Teamship update</option>
            </select>
          </label>
          <button
            type="button"
            onClick={onCreateIssueUpdateJob}
            disabled={isUpdateJobLoading || !review || issueEligibleCount === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            Create draft for all issues ({issueEligibleCount})
          </button>
          <button
            type="button"
            onClick={onCreateUpdateJob}
            disabled={isUpdateJobLoading || !review || selectedCount === 0}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            Create update draft ({selectedCount})
          </button>
        </div>
        {updateJobMode === "LIVE_API" ? (
          <p className="mt-3 max-w-3xl rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
            Live mode still requires approving the draft below and running the VM worker with live updates enabled. Use this only for
            selected orders you want the agent to write back to Teamship.
          </p>
        ) : null}
      </div>
      <TeamshipUpdateJobsPanel
        jobs={updateJobs}
        status={updateJobStatus}
        isLoading={isUpdateJobLoading}
        onAction={onUpdateJobAction}
      />
      <div className="divide-y divide-border">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-mutedForeground">
            Pull Teamship orders or upload a Garland PDF to start building the shipment workspace.
          </p>
        ) : null}
        {rows.map((row) => {
          const isExpanded = expandedRowIds.has(row.id);
          const srKey = normalizeIdentifier(row.srNumber);
          const payloadInspection = srKey ? payloadInspections[srKey] ?? null : null;
          const payloadInspectionError = srKey ? payloadInspectionErrors[srKey] ?? null : null;
          const isPayloadInspectionLoading = Boolean(srKey && payloadInspectionLoadingSr === srKey);
          const expectedSerials = row.review ? collectReviewPdfSerials(row.review) : row.pdfOrder ? collectPdfOrderSerials(row.pdfOrder) : [];
          const expectedSkus = row.review ? collectReviewPdfSkus(row.review) : row.pdfOrder ? collectPdfOrderSkus(row.pdfOrder) : [];

          return (
            <details
              key={row.id}
              className={shipmentRowClass(row.status)}
              open={isExpanded}
              onToggle={(event) => setRowOpen(row.id, event.currentTarget.open)}
            >
              <summary className="grid cursor-pointer gap-3 px-5 py-4 lg:grid-cols-[1fr,1fr,auto] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.review && row.srNumber ? (
                      <label className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-mutedForeground">
                        <input
                          type="checkbox"
                          checked={selectedUpdateSrNumbers.has(row.srNumber)}
                          disabled={!isUpdateEligibleReview(row.review)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => onToggleUpdateSelection(row.srNumber!, event.target.checked)}
                        />
                        Agent update
                      </label>
                    ) : null}
                    <span className="font-semibold text-foreground">{row.psNumber ?? "No PS"}</span>
                    <span className="text-sm font-semibold text-mutedForeground">/ {row.srNumber ?? "No SR"}</span>
                    <span className={shipmentStatusPillClass(row.status)}>{formatWorkspaceStatus(row.status, row.issueCount)}</span>
                  </div>
                  <p className="mt-1 text-sm text-mutedForeground">
                    {row.pdfPages.length > 0 ? `PDF page(s) ${row.pdfPages.join(", ")}` : "No PDF page uploaded"}
                  </p>
                </div>

                <div className="text-sm text-mutedForeground">
                  <p className="font-medium text-foreground">{row.shipToName ?? "Missing ship-to"}</p>
                  <p>{[row.carrier, row.cityState].filter(Boolean).join(" · ") || "Carrier/city missing"}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  {row.teamshipUrl ? (
                    <a
                      href={row.teamshipUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      Open shipping order
                    </a>
                  ) : (
                    <span className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-mutedForeground">
                      No Teamship link
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (row.srNumber) {
                        onRescanShipment(row.srNumber);
                      }
                    }}
                    disabled={!row.srNumber || !row.pdfOrder}
                    className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Rescan this shipment
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (row.srNumber) {
                        onInspectPayload({
                          srNumber: row.srNumber,
                          expectedSerials,
                          expectedSkus
                        });
                      }
                    }}
                    disabled={!row.srNumber || isPayloadInspectionLoading || expectedSerials.length === 0}
                    className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPayloadInspectionLoading ? "Inspecting..." : "Inspect payload"}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (row.srNumber) {
                        onCreateSingleUpdateJob(row.srNumber);
                      }
                    }}
                    disabled={!row.review || !row.srNumber || !isUpdateEligibleReview(row.review)}
                    className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Draft this one
                  </button>
                  <span className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-mutedForeground">
                    {isExpanded ? "Collapse" : "Expand"}
                  </span>
                </div>
              </summary>
              <ShipmentWorkspaceDetails
                row={row}
                payloadInspection={payloadInspection}
                payloadInspectionError={payloadInspectionError}
              />
            </details>
          );
        })}
      </div>
    </section>
  );
}

function TeamshipUpdateJobsPanel({
  jobs,
  status,
  isLoading,
  onAction
}: {
  jobs: TeamshipUpdateJobSummary[];
  status: string | null;
  isLoading: boolean;
  onAction: (jobId: string, action: "approve" | "cancel" | "rescan") => void;
}) {
  return (
    <div className="border-b border-border bg-muted/20 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Phase 2 Teamship update jobs</h3>
          <p className="mt-1 text-xs text-mutedForeground">
            Create a dry-run or live draft from selected shipments, approve it for the VM agent, then rescan Teamship after the agent reports completion.
          </p>
          {status ? <p className="mt-2 text-xs font-semibold text-mutedForeground">{status}</p> : null}
        </div>
        <span className="rounded-full bg-background px-3 py-1 text-xs font-bold uppercase tracking-wide text-mutedForeground">
          {jobs.length} job{jobs.length === 1 ? "" : "s"}
        </span>
      </div>

      {jobs.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border bg-background p-3 text-sm text-mutedForeground">
          No Phase 2 update jobs yet. Select reviewed shipments above and create an update draft.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {jobs.slice(0, 5).map((job) => (
            <details key={job.id} className="rounded-md border border-border bg-background">
              <summary className="grid cursor-pointer gap-3 px-4 py-3 lg:grid-cols-[1fr,1fr,auto] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{job.documentLabel}</span>
                    <span className={updateJobStatusClass(job.status)}>{formatUpdateJobStatus(job.status)}</span>
                    <span className={job.dryRun ? "rounded-full bg-warning/15 px-2 py-0.5 text-xs font-bold text-warning" : "rounded-full bg-danger/10 px-2 py-0.5 text-xs font-bold text-danger"}>
                      {job.dryRun ? "Dry run" : "Live update"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-mutedForeground">
                    Created {formatDateTime(job.createdAt)} by {job.createdByName ?? "Unknown"} · {job.selectedSrNumbers.length} selected SRs
                  </p>
                </div>
                <div className="text-xs text-mutedForeground">
                  <p>
                    {job.summary.readyCount} ready · {job.summary.blockedCount} blocked · {job.summary.skippedCount} skipped
                  </p>
                  <p>
                    {job.summary.plannedFieldUpdateCount} field updates · {job.summary.plannedPalletRowCount} pallet/comment rows
                  </p>
                  <p>Agent mode: {job.agentMode === "LIVE_API" ? "Live Teamship API" : "Dry-run evidence"}</p>
                  {job.agentId ? <p>Agent: {job.agentId}</p> : null}
                  {job.lastVerificationAt ? <p>Last rescan {formatDateTime(job.lastVerificationAt)}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      if (!confirmUpdateJobApproval(job)) {
                        return;
                      }
                      onAction(job.id, "approve");
                    }}
                    disabled={isLoading || job.status !== "DRAFT" || job.summary.blockedCount > 0}
                    className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Approve agent
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      onAction(job.id, "rescan");
                    }}
                    disabled={isLoading}
                    className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Rescan
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      onAction(job.id, "cancel");
                    }}
                    disabled={isLoading || ["SUCCESS", "FAILED", "CANCELLED"].includes(job.status)}
                    className="rounded-md border border-danger/30 px-3 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </summary>
              <div className="overflow-x-auto px-4 pb-4">
                <div className="mb-3 grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-mutedForeground md:grid-cols-2 xl:grid-cols-4">
                  <p>
                    <span className="font-semibold text-foreground">Approved:</span>{" "}
                    {job.approvedAt ? `${formatDateTime(job.approvedAt)} by ${job.approvedByName ?? "Unknown"}` : "Not approved yet"}
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">Claimed:</span>{" "}
                    {job.agentClaimedAt ? `${formatDateTime(job.agentClaimedAt)} by ${job.agentId ?? "agent"}` : "Not claimed yet"}
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">Started/finished:</span>{" "}
                    {formatAgentRunWindow(job)}
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">Verification:</span>{" "}
                    {job.lastVerificationAt ? formatDateTime(job.lastVerificationAt) : "Not rescanned yet"}
                  </p>
                </div>
                {job.errorMessage ? (
                  <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger">
                    {job.errorMessage}
                  </div>
                ) : null}
                {job.status === "NEEDS_REVIEW" ? (
                  <div className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
                    This job needs review and cannot be re-approved. Rescan Teamship details or create a new update draft for any follow-up work.
                  </div>
                ) : null}
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-muted/40 uppercase tracking-wide text-mutedForeground">
                    <tr>
                      <th className="px-3 py-2">PS</th>
                      <th className="px-3 py-2">SR</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Planned</th>
                      <th className="px-3 py-2">Agent evidence</th>
                      <th className="px-3 py-2">Issues</th>
                      <th className="px-3 py-2">Teamship</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {job.orders.map((order) => (
                      <tr key={order.id}>
                        <td className="px-3 py-2 font-semibold text-foreground">{order.psNumber}</td>
                        <td className="px-3 py-2 font-semibold text-foreground">{order.srNumber}</td>
                        <td className="px-3 py-2">
                          <span className={updateOrderStatusClass(order.status)}>{formatUpdateOrderStatus(order.status)}</span>
                        </td>
                        <td className="px-3 py-2 text-mutedForeground">
                          {order.plannedFieldUpdateCount} fields · {order.plannedPalletRowCount} pallet/comment rows
                        </td>
                        <td className="max-w-xs px-3 py-2 text-mutedForeground">
                          {order.agentEvidence ? (
                            <div className="space-y-1">
                              <p className="font-semibold text-foreground">
                                {formatStatusLabel(order.agentEvidence.status)}
                                {order.agentEvidence.responseStatus ? ` · HTTP ${order.agentEvidence.responseStatus}` : ""}
                              </p>
                              <p>
                                {order.agentEvidence.fieldActionCount} field action(s) · {order.agentEvidence.palletActionCount} pallet action(s)
                              </p>
                              {order.agentEvidence.error ? <p className="font-semibold text-danger">{order.agentEvidence.error}</p> : null}
                            </div>
                          ) : (
                            "Not run yet"
                          )}
                        </td>
                        <td className="max-w-sm px-3 py-2 text-mutedForeground">
                          {order.validationIssues.length > 0 ? order.validationIssues.join("; ") : order.errorMessage ?? "None"}
                        </td>
                        <td className="px-3 py-2">
                          {order.teamshipUrl ? (
                            <a href={order.teamshipUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                              {order.teamshipOrderId ?? "Open"}
                            </a>
                          ) : (
                            <span className="text-mutedForeground">Not matched</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function ShipmentWorkspaceDetails({
  row,
  payloadInspection,
  payloadInspectionError
}: {
  row: ShipmentWorkspaceRow;
  payloadInspection: TeamshipPayloadInspectionResult | null;
  payloadInspectionError: string | null;
}) {
  if (row.review) {
    return (
      <div className="space-y-4 px-5 pb-5">
        <TeamshipPayloadInspectionPanel inspection={payloadInspection} error={payloadInspectionError} />
        <div className="overflow-x-auto">
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
              {row.review.fields.map((field) => (
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
        <ItemDetailsComparison review={row.review} />
        <ProductDimensionsTable dimensions={row.review.productDimensions} />
      </div>
    );
  }

  return (
    <div className="grid gap-3 px-5 pb-5 text-sm text-mutedForeground md:grid-cols-2">
      <div className="md:col-span-2">
        <TeamshipPayloadInspectionPanel inspection={payloadInspection} error={payloadInspectionError} />
      </div>
      <div className="rounded-md border border-border bg-background p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-mutedForeground">Garland PDF</p>
        <p className="mt-2 text-foreground">{row.pdfOrder ? row.pdfOrder.shipToName ?? "Ship-to missing" : "No PDF order matched yet"}</p>
        <p>{row.pdfOrder ? `Items: ${row.pdfOrder.items.map((item) => item.sku).join(", ") || "none parsed"}` : "Upload PDF to inspect."}</p>
      </div>
      <div className="rounded-md border border-border bg-background p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-mutedForeground">Teamship</p>
        <p className="mt-2 text-foreground">{row.teamshipOrder ? row.teamshipOrderId ?? "Order ID missing" : "No Teamship order matched yet"}</p>
        <p>{row.teamshipOrder ? [row.carrier, row.shipToName, row.cityState].filter(Boolean).join(" · ") : "Pull Teamship orders to inspect."}</p>
      </div>
    </div>
  );
}

function TeamshipPayloadInspectionPanel({
  inspection,
  error
}: {
  inspection: TeamshipPayloadInspectionResult | null;
  error: string | null;
}) {
  if (!inspection && !error) {
    return null;
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">
        Payload inspection failed: {error}
      </div>
    );
  }

  if (!inspection) {
    return null;
  }

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Teamship payload inspection</h3>
          <p className="mt-1 text-xs text-mutedForeground">
            Read-only diagnostic for the fetched Teamship API payload. Raw JSON is not shown, only safe paths and previews.
          </p>
        </div>
        <span className={payloadInspectionPillClass(inspection.conclusion)}>{formatPayloadInspectionConclusion(inspection.conclusion)}</span>
      </div>
      <div className="grid gap-3 px-3 py-3 text-sm md:grid-cols-3">
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-mutedForeground">Expected PDF serials</p>
          <p className="mt-1 font-semibold text-foreground">{inspection.expectedSerials.join(", ") || "None parsed"}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-mutedForeground">Payload searched</p>
          <p className="mt-1 font-semibold text-foreground">{inspection.searchedValueCount} values</p>
          <p className="mt-1 text-xs text-mutedForeground">{inspection.inspectedEndpoints.join(" + ")}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-mutedForeground">Teamship order</p>
          <p className="mt-1 font-semibold text-foreground">{inspection.teamshipOrderId ?? "Not matched"}</p>
          {inspection.teamshipUrl ? (
            <a href={inspection.teamshipUrl} target="_blank" rel="noreferrer" className="mt-1 block text-xs font-semibold text-primary hover:underline">
              Open Teamship order
            </a>
          ) : null}
        </div>
      </div>
      <p className="px-3 pb-3 text-sm font-medium text-mutedForeground">{inspection.message}</p>
      <div className="grid gap-3 px-3 pb-3 xl:grid-cols-3">
        <PayloadInspectionMatchList
          title="Expected serial matches"
          emptyText="No exact PDF serial value found in this payload."
          matches={inspection.exactSerialMatches}
        />
        <PayloadInspectionMatchList
          title="Serial-like paths"
          emptyText="No serial-like key or SN text found."
          matches={inspection.serialLikeMatches}
        />
        <PayloadInspectionMatchList
          title="Expected SKU paths"
          emptyText="No expected SKU value found."
          matches={inspection.skuMatches}
        />
      </div>
    </div>
  );
}

function PayloadInspectionMatchList({
  title,
  emptyText,
  matches
}: {
  title: string;
  emptyText: string;
  matches: TeamshipPayloadInspectionMatch[];
}) {
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-mutedForeground">
          {title} ({matches.length})
        </p>
      </div>
      {matches.length === 0 ? (
        <p className="px-3 py-3 text-xs text-mutedForeground">{emptyText}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-muted/40 uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-2">Path</th>
                <th className="px-3 py-2">Value preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {matches.map((match, index) => (
                <tr key={`${match.path}-${match.reason}-${index}`}>
                  <td className="max-w-xs px-3 py-2 font-mono text-[11px] text-mutedForeground">{match.path}</td>
                  <td className="max-w-xs px-3 py-2 text-mutedForeground">
                    {match.matchedValue ? <span className="mr-2 font-semibold text-foreground">{match.matchedValue}</span> : null}
                    {match.valuePreview}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ItemDetailsComparison({ review }: { review: GarlandTeamshipOrderReview }) {
  const maxRows = Math.max(review.pdfItems.length, review.teamshipItems.length);

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold text-foreground">SKU and serial detail</h3>
        <p className="mt-1 text-xs text-mutedForeground">
          Shows every parsed Garland PDF item beside the item/serial details fetched from Teamship for this shipment.
        </p>
      </div>
      {maxRows === 0 ? (
        <p className="px-3 py-3 text-sm text-mutedForeground">No item detail was parsed from the PDF or Teamship response.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2">Garland SKU</th>
                <th className="px-3 py-2">Garland serial(s)</th>
                <th className="px-3 py-2">Teamship SKU</th>
                <th className="px-3 py-2">Teamship serial(s)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Array.from({ length: maxRows }, (_, index) => {
                const pdfItem = review.pdfItems[index] ?? null;
                const teamshipItem = review.teamshipItems[index] ?? null;

                return (
                  <tr key={`${review.srNumber}-item-${index}`}>
                    <td className="px-3 py-2 font-semibold text-foreground">{index + 1}</td>
                    <td className="px-3 py-2 text-mutedForeground">{formatItemSku(pdfItem)}</td>
                    <td className="px-3 py-2 text-mutedForeground">{formatItemSerials(pdfItem)}</td>
                    <td className="px-3 py-2 text-mutedForeground">{formatItemSku(teamshipItem)}</td>
                    <td className="px-3 py-2 text-mutedForeground">{formatItemSerials(teamshipItem)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProductDimensionsTable({ dimensions }: { dimensions: GarlandTeamshipOrderReview["productDimensions"] }) {
  return (
    <div className="rounded-md border border-border bg-background">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold text-foreground">SKU dimensions for Teamship update bot</h3>
        <p className="mt-1 text-xs text-mutedForeground">
          Combines Teamship pallet rows with Garland&apos;s provided freight dimension sheet. Low confidence usually means
          the Teamship row looks like placeholder pallet data.
        </p>
      </div>
      {dimensions.length === 0 ? (
        <p className="px-3 py-3 text-sm text-mutedForeground">No SKU dimension recommendation found for this shipment.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Dims</th>
                <th className="px-3 py-2">Weight</th>
                <th className="px-3 py-2">Confidence</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {dimensions.map((dimension, index) => (
                <tr key={`${dimension.sku}-${dimension.source}-${index}`}>
                  <td className="px-3 py-2 font-semibold text-foreground">{dimension.sku}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatDimensionSource(dimension.source)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{dimension.quantity ?? "Blank"}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatDimensions(dimension)}</td>
                  <td className="px-3 py-2 text-mutedForeground">{formatWeight(dimension)}</td>
                  <td className="px-3 py-2">
                    <span className={dimensionConfidenceClass(dimension.confidence)}>{dimension.confidence}</span>
                  </td>
                  <td className="max-w-sm px-3 py-2 text-mutedForeground">{dimension.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TeamshipReviewHistorySection({
  history,
  historySearch,
  historyDateFrom,
  historyDateTo,
  historyAllDates,
  historyError,
  isHistoryLoading,
  canDeleteRuns,
  onSearchChange,
  onDateFromChange,
  onDateToChange,
  onAllDates,
  onToday,
  onSearch,
  onDelete
}: {
  history: TeamshipReviewHistoryResponse;
  historySearch: string;
  historyDateFrom: string;
  historyDateTo: string;
  historyAllDates: boolean;
  historyError: string | null;
  isHistoryLoading: boolean;
  canDeleteRuns: boolean;
  onSearchChange: (value: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onAllDates: () => void;
  onToday: () => void;
  onSearch: () => void;
  onDelete: (runId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Saved Teamship review history</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Search by date label, source file, PS/SR number, Teamship order, recipient, carrier, city, PO, item, serial,
            alert text, or review status.
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            {history.allDates
              ? "Viewing all dates"
              : `Viewing shipment dates ${history.dateFrom} to ${history.dateTo}`}
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          {history.totalCount} saved run{history.totalCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="border-b border-border p-5">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr),180px,180px,auto]">
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
          <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            From
            <input
              type="date"
              value={historyDateFrom}
              onChange={(event) => onDateFromChange(event.target.value)}
              disabled={historyAllDates}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground disabled:opacity-60"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            To
            <input
              type="date"
              value={historyDateTo}
              onChange={(event) => onDateToChange(event.target.value)}
              disabled={historyAllDates}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground disabled:opacity-60"
            />
          </label>
          <button
            type="button"
            onClick={onSearch}
            disabled={isHistoryLoading}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isHistoryLoading ? "Searching..." : "Search history"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onToday}
            disabled={isHistoryLoading}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onAllDates}
            disabled={isHistoryLoading}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            All dates
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
                        : run.noPdfCount > 0
                          ? `${run.noPdfCount} no PDF`
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
                    {run.noPdfCount > 0 ? ` · ${run.noPdfCount} no PDF` : ""}
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

function payloadInspectionPillClass(conclusion: TeamshipPayloadInspectionResult["conclusion"]) {
  const base = "rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide";

  if (conclusion === "EXPECTED_SERIAL_FOUND") {
    return `${base} bg-success/10 text-success`;
  }

  if (conclusion === "SERIAL_EVIDENCE_FOUND") {
    return `${base} bg-warning/15 text-warning`;
  }

  return `${base} bg-danger/10 text-danger`;
}

function formatPayloadInspectionConclusion(conclusion: TeamshipPayloadInspectionResult["conclusion"]) {
  if (conclusion === "EXPECTED_SERIAL_FOUND") {
    return "Serial found";
  }

  if (conclusion === "SERIAL_EVIDENCE_FOUND") {
    return "Serial evidence";
  }

  if (conclusion === "TEAMSHIP_ORDER_NOT_FOUND") {
    return "Order not found";
  }

  return "No serial evidence";
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

  if (run.pendingTeamshipCount > 0 || run.noPdfCount > 0) {
    return `${base} bg-warning/15 text-warning`;
  }

  return `${base} bg-success/10 text-success`;
}

function reviewStatusPillClass(status: TeamshipReviewHistoryOrder["status"]) {
  const base = "rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide";

  if (status === "PASS") {
    return `${base} bg-success/10 text-success`;
  }

  if (status === "SKIPPED_ALREADY_REVIEWED") {
    return `${base} bg-muted text-mutedForeground`;
  }

  if (status === "PENDING_TEAMSHIP" || status === "NO_PDF") {
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

  if (status === "NO_PDF") {
    return "No PDF";
  }

  if (status === "SKIPPED_ALREADY_REVIEWED") {
    return "Skipped";
  }

  if (status === "MISSING_TEAMSHIP") {
    return "Missing";
  }

  return `${mismatchCount} issue${mismatchCount === 1 ? "" : "s"}`;
}

function isUpdateEligibleReview(review: GarlandTeamshipOrderReview) {
  return Boolean(review.teamshipOrderId && (review.status === "PASS" || review.status === "FAIL"));
}

function isIssueUpdateEligibleReview(review: GarlandTeamshipOrderReview) {
  return isUpdateEligibleReview(review) && review.issueCount > 0;
}

function mergePartialReview(
  current: GarlandTeamshipReviewResponse,
  partial: GarlandTeamshipReviewResponse
): GarlandTeamshipReviewResponse {
  const partialReviewSrNumbers = new Set(partial.reviews.map((row) => normalizeIdentifier(row.srNumber)));
  const partialPdfSrNumbers = new Set(partial.pdfOrders.map((order) => normalizeIdentifier(order.srNumber)));
  const reviews = [
    ...current.reviews.filter((row) => !partialReviewSrNumbers.has(normalizeIdentifier(row.srNumber))),
    ...partial.reviews
  ];
  const pdfOrders = [
    ...current.pdfOrders.filter((order) => !partialPdfSrNumbers.has(normalizeIdentifier(order.srNumber))),
    ...partial.pdfOrders
  ];

  return {
    ...current,
    pdfOrders,
    reviews,
    summary: summarizeReviewRows(pdfOrders, reviews),
    fetchedAt: partial.fetchedAt,
    teamshipAlerts: mergeTeamshipAlerts(current.teamshipAlerts, partial.teamshipAlerts)
  };
}

function summarizeReviewRows(
  pdfOrders: GarlandPdfShippingOrder[],
  reviews: GarlandTeamshipReviewResponse["reviews"]
): GarlandTeamshipReviewResponse["summary"] {
  return {
    pdfOrderCount: pdfOrders.length,
    teamshipMatchedCount: reviews.filter((row) => Boolean(row.teamshipOrderId)).length,
    passedCount: reviews.filter((row) => row.status === "PASS").length,
    failedCount: reviews.filter((row) => row.status === "FAIL").length,
    missingTeamshipCount: reviews.filter((row) => row.status === "MISSING_TEAMSHIP").length,
    pendingTeamshipCount: reviews.filter((row) => row.status === "PENDING_TEAMSHIP").length,
    noPdfCount: reviews.filter((row) => row.status === "NO_PDF").length,
    skippedAlreadyReviewedCount: reviews.filter((row) => row.status === "SKIPPED_ALREADY_REVIEWED").length
  };
}

function mergeTeamshipAlerts(
  current: GarlandTeamshipReviewResponse["teamshipAlerts"],
  partial: GarlandTeamshipReviewResponse["teamshipAlerts"]
) {
  const alerts = new Map<string, GarlandTeamshipReviewResponse["teamshipAlerts"][number]>();

  for (const alert of [...current, ...partial]) {
    alerts.set(normalizeIdentifier(alert.srNumber), alert);
  }

  return Array.from(alerts.values());
}

function updateJobStatusClass(status: TeamshipUpdateJobSummary["status"]) {
  const base = "rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide";

  if (status === "SUCCESS") {
    return `${base} bg-success/10 text-success`;
  }

  if (status === "FAILED" || status === "NEEDS_REVIEW") {
    return `${base} bg-danger/10 text-danger`;
  }

  if (status === "APPROVED" || status === "RUNNING") {
    return `${base} bg-warning/15 text-warning`;
  }

  if (status === "CANCELLED") {
    return `${base} bg-muted text-mutedForeground`;
  }

  return `${base} bg-primary/10 text-primary`;
}

function updateOrderStatusClass(status: TeamshipUpdateOrderSummary["status"]) {
  const base = "rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide";

  if (status === "SUCCESS") {
    return `${base} bg-success/10 text-success`;
  }

  if (status === "BLOCKED" || status === "FAILED" || status === "NEEDS_REVIEW") {
    return `${base} bg-danger/10 text-danger`;
  }

  if (status === "APPROVED" || status === "RUNNING") {
    return `${base} bg-warning/15 text-warning`;
  }

  if (status === "SKIPPED") {
    return `${base} bg-muted text-mutedForeground`;
  }

  return `${base} bg-primary/10 text-primary`;
}

function formatUpdateJobStatus(status: TeamshipUpdateJobSummary["status"]) {
  return formatStatusLabel(status);
}

function formatUpdateOrderStatus(status: TeamshipUpdateOrderSummary["status"]) {
  return formatStatusLabel(status);
}

function formatAgentRunWindow(job: TeamshipUpdateJobSummary) {
  if (job.agentStartedAt && job.agentFinishedAt) {
    return `${formatDateTime(job.agentStartedAt)} -> ${formatDateTime(job.agentFinishedAt)}`;
  }

  if (job.agentStartedAt) {
    return `Started ${formatDateTime(job.agentStartedAt)}`;
  }

  if (job.agentFinishedAt) {
    return `Finished ${formatDateTime(job.agentFinishedAt)}`;
  }

  return "Not run yet";
}

function confirmUpdateJobApproval(job: TeamshipUpdateJobSummary) {
  const mode = job.agentMode === "LIVE_API" ? "LIVE TEAMSHIP UPDATE" : "dry-run evidence";
  const srList = formatSrConfirmationList(job.selectedSrNumbers);
  const liveWarning =
    job.agentMode === "LIVE_API"
      ? "\n\nThis can write changes to Teamship when the VM worker is running in live mode. Confirm only after you have reviewed the selected orders."
      : "\n\nThis will let the VM worker generate evidence without writing to Teamship.";

  return window.confirm(
    `Approve this ${mode} job for the VM agent?\n\nSelected SRs (${job.selectedSrNumbers.length}): ${srList}${liveWarning}`
  );
}

function formatSrConfirmationList(srNumbers: string[]) {
  const visible = srNumbers.slice(0, 12).join(", ");
  const remaining = srNumbers.length - 12;

  return remaining > 0 ? `${visible}, and ${remaining} more` : visible || "none";
}

function formatStatusLabel(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function collectReviewPdfSerials(review: GarlandTeamshipOrderReview) {
  return uniqueClientStrings(review.pdfItems.flatMap((item) => item.serialNumbers));
}

function collectPdfOrderSerials(order: GarlandPdfShippingOrder) {
  return uniqueClientStrings(order.items.flatMap((item) => item.serialNumbers));
}

function collectReviewPdfSkus(review: GarlandTeamshipOrderReview) {
  return uniqueClientStrings(review.pdfItems.map((item) => item.sku).filter((sku): sku is string => Boolean(sku)));
}

function collectPdfOrderSkus(order: GarlandPdfShippingOrder) {
  return uniqueClientStrings(order.items.map((item) => item.sku).filter((sku): sku is string => Boolean(sku)));
}

function uniqueClientStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildShipmentWorkspaceRows({
  review,
  pdfOrders,
  teamshipOrders
}: {
  review: GarlandTeamshipReviewResponse | null;
  pdfOrders: GarlandPdfShippingOrder[];
  teamshipOrders: TeamshipShippingOrderDetail[];
}) {
  const teamshipBySr = new Map<string, TeamshipShippingOrderDetail>();
  const seenSr = new Set<string>();

  for (const order of teamshipOrders) {
    const srNumber = normalizeIdentifier(readTeamshipShipmentId(order));

    if (srNumber) {
      teamshipBySr.set(srNumber, order);
    }
  }

  if (review) {
    return review.reviews.map((orderReview) => {
      const srNumber = normalizeIdentifier(orderReview.srNumber);
      const teamshipOrder = srNumber ? teamshipBySr.get(srNumber) ?? null : null;

      if (srNumber) {
        seenSr.add(srNumber);
      }

      return mapReviewRow(orderReview, findPdfOrder(pdfOrders, orderReview), teamshipOrder);
    });
  }

  const rows = teamshipOrders.map((teamshipOrder) => {
    const row = mapTeamshipRow(teamshipOrder);
    const srNumber = normalizeIdentifier(row.srNumber);

    if (srNumber) {
      seenSr.add(srNumber);
    }

    return row;
  });

  for (const pdfOrder of pdfOrders) {
    const srNumber = normalizeIdentifier(pdfOrder.srNumber);

    if (srNumber && seenSr.has(srNumber)) {
      continue;
    }

    rows.push(mapPdfRow(pdfOrder));
  }

  return rows;
}

function mapReviewRow(
  review: GarlandTeamshipOrderReview,
  pdfOrder: GarlandPdfShippingOrder | null,
  teamshipOrder: TeamshipShippingOrderDetail | null
): ShipmentWorkspaceRow {
  const teamshipOrderId = review.teamshipOrderId ?? (teamshipOrder ? readTeamshipOrderId(teamshipOrder) : null);
  const city = pdfOrder?.shipToCity ?? readReviewTeamshipValue(review, "ship_to_city") ?? readTeamshipNullable(teamshipOrder, readTeamshipCity);
  const state =
    pdfOrder?.shipToState ?? readReviewTeamshipValue(review, "ship_to_state") ?? readTeamshipNullable(teamshipOrder, readTeamshipState);

  return {
    id: `review-${review.srNumber || review.psNumber}`,
    status: review.status,
    psNumber: review.psNumber || pdfOrder?.psNumber || null,
    srNumber: review.srNumber || pdfOrder?.srNumber || readTeamshipNullable(teamshipOrder, readTeamshipShipmentId),
    pdfPages: review.pageNumbers.length > 0 ? review.pageNumbers : pdfOrder?.pageNumbers ?? [],
    carrier: pdfOrder?.shipVia ?? readReviewTeamshipValue(review, "carrier") ?? readTeamshipNullable(teamshipOrder, readTeamshipCarrier),
    shipToName:
      pdfOrder?.shipToName ??
      readReviewTeamshipValue(review, "ship_to_name") ??
      readTeamshipNullable(teamshipOrder, readTeamshipShipToName),
    cityState: [city, state].filter(Boolean).join(", ") || null,
    teamshipOrderId,
    teamshipUrl: review.teamshipUrl ?? readTeamshipUrl(teamshipOrder) ?? buildTeamshipOrderUrl(teamshipOrderId),
    issueCount: review.issueCount,
    review,
    pdfOrder,
    teamshipOrder
  };
}

function mapTeamshipRow(teamshipOrder: TeamshipShippingOrderDetail): ShipmentWorkspaceRow {
  const teamshipOrderId = readTeamshipOrderId(teamshipOrder);
  const city = readTeamshipCity(teamshipOrder);
  const state = readTeamshipState(teamshipOrder);

  return {
    id: `teamship-${teamshipOrderId ?? readTeamshipShipmentId(teamshipOrder) ?? readTeamshipFallbackIdentifier(teamshipOrder)}`,
    status: "TEAMSHIP_PULLED",
    psNumber: stringifyCustomField(teamshipOrder, "ps") ?? stringifyCustomField(teamshipOrder, "pre") ?? null,
    srNumber: readTeamshipShipmentId(teamshipOrder),
    pdfPages: [],
    carrier: readTeamshipCarrier(teamshipOrder),
    shipToName: readTeamshipShipToName(teamshipOrder),
    cityState: [city, state].filter(Boolean).join(", ") || null,
    teamshipOrderId,
    teamshipUrl: readTeamshipUrl(teamshipOrder) ?? buildTeamshipOrderUrl(teamshipOrderId),
    issueCount: 0,
    review: null,
    pdfOrder: null,
    teamshipOrder
  };
}

function mapPdfRow(pdfOrder: GarlandPdfShippingOrder): ShipmentWorkspaceRow {
  return {
    id: `pdf-${pdfOrder.srNumber || pdfOrder.psNumber}`,
    status: "PDF_READY",
    psNumber: pdfOrder.psNumber,
    srNumber: pdfOrder.srNumber,
    pdfPages: pdfOrder.pageNumbers,
    carrier: pdfOrder.shipVia,
    shipToName: pdfOrder.shipToName,
    cityState: [pdfOrder.shipToCity, pdfOrder.shipToState].filter(Boolean).join(", ") || null,
    teamshipOrderId: null,
    teamshipUrl: null,
    issueCount: 0,
    review: null,
    pdfOrder,
    teamshipOrder: null
  };
}

function findPdfOrder(pdfOrders: GarlandPdfShippingOrder[], review: GarlandTeamshipOrderReview) {
  const reviewSr = normalizeIdentifier(review.srNumber);
  const reviewPs = normalizeIdentifier(review.psNumber);

  return (
    pdfOrders.find((order) => {
      const orderSr = normalizeIdentifier(order.srNumber);
      const orderPs = normalizeIdentifier(order.psNumber);

      return (reviewSr && orderSr === reviewSr) || (reviewPs && orderPs === reviewPs);
    }) ?? null
  );
}

function readTeamshipNullable(
  order: TeamshipShippingOrderDetail | null,
  reader: (teamshipOrder: TeamshipShippingOrderDetail) => string | null
) {
  return order ? reader(order) : null;
}

function readReviewTeamshipValue(review: GarlandTeamshipOrderReview, key: string) {
  return review.fields.find((field) => field.key === key)?.teamshipValue ?? null;
}

function stringifyCustomField(order: TeamshipShippingOrderDetail, needle: string) {
  const lowerNeedle = needle.toLowerCase();
  const field = order.custom_fields?.find((customField) =>
    [customField.label, customField.edi_key].some((value) => value?.toLowerCase().includes(lowerNeedle))
  );

  return stringifyValue(field?.value);
}

function normalizeIdentifier(value: string | null) {
  return value?.replace(/[^A-Z0-9]/gi, "").toUpperCase() ?? "";
}

function readTeamshipUrl(order: TeamshipShippingOrderDetail | null) {
  return stringifyValue(order?.url) ?? buildTeamshipOrderUrl(order ? readTeamshipOrderId(order) : null);
}

function buildTeamshipOrderUrl(orderId: string | null) {
  return orderId ? `https://app.teamshipos.com/view-shipping-order/${encodeURIComponent(orderId)}` : null;
}

function shipmentRowClass(status: ShipmentWorkspaceStatus) {
  const base = "border-l-4";

  if (status === "PASS") {
    return `${base} border-success bg-success/5`;
  }

  if (status === "FAIL" || status === "MISSING_TEAMSHIP") {
    return `${base} border-danger bg-danger/5`;
  }

  if (status === "PENDING_TEAMSHIP" || status === "NO_PDF") {
    return `${base} border-warning bg-warning/10`;
  }

  if (status === "SKIPPED_ALREADY_REVIEWED") {
    return `${base} border-border bg-muted/30`;
  }

  return `${base} border-border bg-card`;
}

function shipmentStatusPillClass(status: ShipmentWorkspaceStatus) {
  const base = "rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide";

  if (status === "PASS") {
    return `${base} bg-success/10 text-success`;
  }

  if (status === "FAIL" || status === "MISSING_TEAMSHIP") {
    return `${base} bg-danger/10 text-danger`;
  }

  if (status === "PENDING_TEAMSHIP" || status === "NO_PDF") {
    return `${base} bg-warning/15 text-warning`;
  }

  if (status === "SKIPPED_ALREADY_REVIEWED") {
    return `${base} bg-muted text-mutedForeground`;
  }

  return `${base} bg-muted text-mutedForeground`;
}

function formatWorkspaceStatus(status: ShipmentWorkspaceStatus, issueCount: number) {
  if (status === "PASS") {
    return "Approved";
  }

  if (status === "FAIL") {
    return `${issueCount} issue${issueCount === 1 ? "" : "s"}`;
  }

  if (status === "MISSING_TEAMSHIP") {
    return "Missing Teamship";
  }

  if (status === "PENDING_TEAMSHIP") {
    return "Pending";
  }

  if (status === "NO_PDF") {
    return "No PDF";
  }

  if (status === "SKIPPED_ALREADY_REVIEWED") {
    return "Skipped";
  }

  if (status === "TEAMSHIP_PULLED") {
    return "Pulled";
  }

  return "PDF ready";
}

function formatDimensionSource(source: GarlandTeamshipOrderReview["productDimensions"][number]["source"]) {
  if (source === "UPS_RULE") {
    return "UPS rule";
  }

  if (source === "TEAMSHIP_LEARNED") {
    return "Teamship learned";
  }

  return source === "TEAMSHIP_PALLET" ? "Teamship pallet" : "Garland sheet";
}

function formatItemSku(item: GarlandTeamshipOrderReview["pdfItems"][number] | null) {
  if (!item?.sku) {
    return "Blank";
  }

  return item.quantity ? `${item.sku} (qty ${item.quantity})` : item.sku;
}

function formatItemSerials(item: GarlandTeamshipOrderReview["pdfItems"][number] | null) {
  if (!item || item.serialNumbers.length === 0) {
    return "Blank";
  }

  return item.serialNumbers.join(", ");
}

function formatDimensions(dimension: GarlandTeamshipOrderReview["productDimensions"][number]) {
  return [dimension.lengthIn, dimension.widthIn, dimension.heightIn].every((value) => value !== null)
    ? `${dimension.lengthIn}" x ${dimension.widthIn}" x ${dimension.heightIn}"`
    : "Blank";
}

function formatWeight(dimension: GarlandTeamshipOrderReview["productDimensions"][number]) {
  return dimension.weightLb === null ? "Blank" : `${dimension.weightLb} ${dimension.weightUnit ?? "lbs"}`;
}

function dimensionConfidenceClass(confidence: GarlandTeamshipOrderReview["productDimensions"][number]["confidence"]) {
  const base = "rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide";

  if (confidence === "HIGH") {
    return `${base} bg-success/10 text-success`;
  }

  if (confidence === "MEDIUM") {
    return `${base} bg-warning/15 text-warning`;
  }

  return `${base} bg-danger/10 text-danger`;
}

function buildSkuDirectoryCsv(reviews: GarlandTeamshipOrderReview[]) {
  const rows = new Map<string, string[]>();

  for (const review of reviews) {
    for (const dimension of review.productDimensions) {
      const key = [
        dimension.sku,
        dimension.source,
        dimension.lengthIn,
        dimension.widthIn,
        dimension.heightIn,
        dimension.weightLb,
        dimension.quantity
      ].join("|");
      const existing = rows.get(key);
      const orderRef = `${review.psNumber}/${review.srNumber}`;

      if (existing) {
        existing[11] = appendUnique(existing[11] ?? "", orderRef);
        continue;
      }

      rows.set(key, [
        dimension.sku,
        formatDimensionSource(dimension.source),
        dimension.productType ?? "",
        dimension.quantity === null ? "" : String(dimension.quantity),
        dimension.lengthIn === null ? "" : String(dimension.lengthIn),
        dimension.widthIn === null ? "" : String(dimension.widthIn),
        dimension.heightIn === null ? "" : String(dimension.heightIn),
        dimension.weightLb === null ? "" : String(dimension.weightLb),
        dimension.weightUnit ?? "lbs",
        dimension.confidence,
        dimension.note,
        orderRef
      ]);
    }
  }

  return toCsv([
    ["SKU", "Source", "Product Type", "Qty", "Length In", "Width In", "Height In", "Weight Lb", "Weight Unit", "Confidence", "Note", "Orders"],
    ...Array.from(rows.values()).sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]))
  ]);
}

function appendUnique(value: string, nextValue: string) {
  const values = new Set(value.split("; ").filter(Boolean));
  values.add(nextValue);
  return Array.from(values).join("; ");
}

function toCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const escaped = value.replace(/"/g, '""');
          return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
        })
        .join(",")
    )
    .join("\n");
}

async function buildReviewSummaryPdf({
  documentLabel,
  shipmentDate,
  review,
  rows
}: {
  documentLabel: string;
  shipmentDate: string;
  review: GarlandTeamshipReviewResponse;
  rows: ShipmentWorkspaceRow[];
}) {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 42;
  const pageWidth = 612;
  const pageHeight = 792;
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 48;

  const drawText = (text: string, x: number, nextY: number, options?: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> }) => {
    page.drawText(text, {
      x,
      y: nextY,
      size: options?.size ?? 9,
      font: options?.bold ? boldFont : regularFont,
      color: options?.color ?? rgb(0.12, 0.14, 0.18)
    });
  };

  const addPageIfNeeded = (heightNeeded: number) => {
    if (y - heightNeeded > 48) {
      return;
    }

    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - 48;
  };

  drawText("Garland Teamship Review Summary", margin, y, { size: 16, bold: true });
  y -= 20;
  drawText(`${documentLabel} · Shipment date ${formatDisplayDate(`${shipmentDate}T00:00:00.000Z`)}`, margin, y, { size: 10 });
  y -= 22;
  drawText(
    `${review.summary.passedCount} approved · ${review.summary.failedCount} failed · ${review.summary.missingTeamshipCount} missing Teamship · ${review.summary.noPdfCount} no PDF`,
    margin,
    y,
    { size: 9 }
  );
  y -= 22;

  for (const row of rows) {
    addPageIfNeeded(58);

    page.drawRectangle({
      x: margin,
      y: y - 29,
      width: 8,
      height: 34,
      color: summaryStatusColor(row.status)
    });
    drawText(
      `${row.psNumber ?? "No PS"} / ${row.srNumber ?? "No SR"} - ${formatWorkspaceStatus(row.status, row.issueCount)}`,
      margin + 14,
      y,
      { size: 10, bold: true }
    );
    y -= 14;
    drawText(
      [row.shipToName, row.carrier, row.cityState, row.pdfPages.length > 0 ? `PDF pages ${row.pdfPages.join(", ")}` : "No PDF page"]
        .filter(Boolean)
        .join(" · "),
      margin + 14,
      y,
      { size: 8 }
    );
    y -= 13;

    if (row.teamshipOrderId) {
      drawText(`Teamship order: ${row.teamshipOrderId}`, margin + 14, y, { size: 8 });
      y -= 13;
    }

    if (row.review?.fields.some((field) => field.status !== "MATCH" && field.status !== "INFO")) {
      const issueSummary = row.review.fields
        .filter((field) => field.status !== "MATCH" && field.status !== "INFO")
        .map((field) => `${field.label}: ${field.message}`)
        .join("; ");

      for (const line of wrapPdfText(issueSummary, 106)) {
        drawText(line, margin + 14, y, { size: 8, color: rgb(0.64, 0.18, 0.25) });
        y -= 11;
      }
    }

    y -= 8;
  }

  return pdfDoc.save();
}

function wrapPdfText(text: string, maxLength: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (candidate.length > maxLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines.length > 0 ? lines : [text];
}

function summaryStatusColor(status: ShipmentWorkspaceStatus) {
  if (status === "PASS") {
    return rgb(0.09, 0.55, 0.28);
  }

  if (status === "FAIL" || status === "MISSING_TEAMSHIP") {
    return rgb(0.86, 0.18, 0.28);
  }

  if (status === "PENDING_TEAMSHIP" || status === "NO_PDF") {
    return rgb(0.88, 0.56, 0.12);
  }

  return rgb(0.48, 0.52, 0.6);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.replace(/[^\w .-]/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function readTeamshipOrderId(order: TeamshipShippingOrderDetail) {
  return stringifyValue(order.id ?? order.order_id);
}

function readTeamshipShipmentId(order: TeamshipShippingOrderDetail) {
  return stringifyValue(order.shipment_id ?? order.amazon_shipment_id1 ?? order.edi_field_1 ?? order.order_number ?? order.display_id);
}

function readTeamshipCarrier(order: TeamshipShippingOrderDetail) {
  return stringifyValue(
    order.carrier ??
      order.ship_method ??
      order.shipping_carrier ??
      order.method ??
      order.carrier_name ??
      order.carrier_value ??
      order.shipping_info?.carrier ??
      order.shipping_info?.method
  );
}

function readTeamshipShipToName(order: TeamshipShippingOrderDetail) {
  const firstLastName = [order.ship_first_name, order.ship_last_name].filter(Boolean).join(" ").trim();
  return stringifyValue(
    order.ship_to_name ??
      (firstLastName || null) ??
      order.shipping_info?.shipping_address?.company ??
      order.shipping_info?.shipping_address?.name ??
      order.customer?.company ??
      order.customer?.name
  );
}

function readTeamshipCity(order: TeamshipShippingOrderDetail) {
  return stringifyValue(order.ship_to_city ?? order.ship_city ?? order.shipping_info?.shipping_address?.city);
}

function readTeamshipState(order: TeamshipShippingOrderDetail) {
  return stringifyValue(order.ship_to_state ?? order.ship_state ?? order.shipping_info?.shipping_address?.state);
}

function readTeamshipFallbackIdentifier(order: TeamshipShippingOrderDetail) {
  return stringifyValue(order.record_no ?? order.display_id ?? order.order_number) ?? "unknown";
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
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
