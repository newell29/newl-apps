"use client";

import { useEffect, useMemo, useState } from "react";
import { PDFDocument } from "pdf-lib";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import {
  comparePsNumbers,
  type DetectedShipmentPage,
  extractPsNumberFromText,
  formatHumanDateFromIso,
  groupDetectedShipmentPages,
  normalizePsNumber,
  sanitizeLabelForFilename,
  type ShipmentDocumentType,
  type ShipmentPageDetectionMethod
} from "@/modules/shipment-documents/ps-number";
import type { ShipmentDocumentHistoryResponse, ShipmentDocumentRunSummary } from "@/modules/shipment-documents/types";

type ExtractedPageRecord = {
  pageNumber: number;
  psNumber: string;
  detectionMethod: ShipmentPageDetectionMethod;
  confidence: string;
  notes: string | null;
};

type DocumentResult = {
  fileName: string;
  downloadUrl: string;
  pageCount: number;
  pages: ExtractedPageRecord[];
  pdfBase64: string;
};

type ProcessingResult = {
  bol: DocumentResult;
  pickTickets: DocumentResult;
};

type PdfJsModule = typeof import("pdfjs-dist");

const AI_BATCH_SIZE = 12;

const CROP_BOXES: Record<ShipmentDocumentType, { x: number; y: number; width: number; height: number }> = {
  BOL: { x: 0.6, y: 0.16, width: 0.24, height: 0.15 },
  PICK_TICKET: { x: 0.56, y: 0.06, width: 0.26, height: 0.16 }
};

let pdfJsLoader: Promise<PdfJsModule> | null = null;

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function GarlandDailyPackClient({
  initialHistory
}: {
  initialHistory: ShipmentDocumentHistoryResponse;
}) {
  const [shipmentDate, setShipmentDate] = useState(getTodayIsoDate);
  const [documentLabel, setDocumentLabel] = useState(() => formatHumanDateFromIso(getTodayIsoDate()));
  const [labelManuallyEdited, setLabelManuallyEdited] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [bolFile, setBolFile] = useState<File | null>(null);
  const [pickTicketFile, setPickTicketFile] = useState<File | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Upload the daily BOL and pick-ticket PDFs to begin.");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [history, setHistory] = useState<ShipmentDocumentHistoryResponse>(initialHistory);
  const [historySearch, setHistorySearch] = useState(initialHistory.search);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  useEffect(() => {
    if (!labelManuallyEdited) {
      setDocumentLabel(formatHumanDateFromIso(shipmentDate));
    }
  }, [shipmentDate, labelManuallyEdited]);

  useEffect(() => {
    return () => {
      if (result) {
        URL.revokeObjectURL(result.bol.downloadUrl);
        URL.revokeObjectURL(result.pickTickets.downloadUrl);
      }
    };
  }, [result]);

  const canProcess = Boolean(bolFile && pickTicketFile && !isProcessing);
  const emailHref = useMemo(() => {
    if (!result) {
      return null;
    }

    const subject = `Garland Canada shipping documents - ${documentLabel}`;
    const body = [
      "Hi,",
      "",
      `Attached are the BOLs and pick tickets for ${documentLabel}, sorted by PS number from lowest to highest.`,
      "",
      "Please review and let us know if anything else is needed.",
      "",
      "Best regards,"
    ].join("\n");

    const recipient = recipientEmail.trim();
    return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [documentLabel, recipientEmail, result]);

  async function handleProcess() {
    if (!bolFile || !pickTicketFile) {
      return;
    }

    if (result) {
      URL.revokeObjectURL(result.bol.downloadUrl);
      URL.revokeObjectURL(result.pickTickets.downloadUrl);
    }

    setError(null);
    setResult(null);
    setSavedRunId(null);

    setIsProcessing(true);

    try {
      setStatus("Loading PDF tools and reading the uploaded files.");

      const [bolBytes, pickBytes] = await Promise.all([readFileBytes(bolFile), readFileBytes(pickTicketFile)]);
      const [bolResult, pickResult] = await Promise.all([
        processDocument({
          fileBytes: bolBytes,
          sourceFileName: bolFile.name,
          documentType: "BOL",
          outputLabel: `${sanitizeLabelForFilename(documentLabel)} BOLs.pdf`,
          onStatus: setStatus
        }),
        processDocument({
          fileBytes: pickBytes,
          sourceFileName: pickTicketFile.name,
          documentType: "PICK_TICKET",
          outputLabel: `${sanitizeLabelForFilename(documentLabel)} Pick Tickets.pdf`,
          onStatus: setStatus
        })
      ]);

      setResult({
        bol: bolResult,
        pickTickets: pickResult
      });
      setStatus("Sorted PDFs are ready to download.");
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : "Unable to process the PDFs.";
      setError(message);
      setStatus("Processing stopped before the output PDFs were created.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleSaveRun() {
    if (!result || !bolFile || !pickTicketFile) {
      return;
    }

    setIsSaving(true);
    setHistoryError(null);

    try {
      const response = await fetch("/api/shipment-documents/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          shipmentDate,
          documentLabel,
          recipientEmail,
          sourceBolFileName: bolFile.name,
          sourcePickTicketFileName: pickTicketFile.name,
          bol: {
            fileName: result.bol.fileName,
            pageCount: result.bol.pageCount,
            pages: result.bol.pages,
            pdfBase64: result.bol.pdfBase64
          },
          pickTickets: {
            fileName: result.pickTickets.fileName,
            pageCount: result.pickTickets.pageCount,
            pages: result.pickTickets.pages,
            pdfBase64: result.pickTickets.pdfBase64
          }
        })
      });

      const json = (await response.json().catch(() => null)) as
        | { error?: string; run?: ShipmentDocumentRunSummary }
        | null;

      if (!response.ok || !json?.run) {
        throw new Error(json?.error ?? "Unable to save this shipment document run.");
      }

      setSavedRunId(json.run.id);
      setStatus("Sorted PDFs are ready and the run has been saved to history.");
      await fetchHistory(historySearch);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save this shipment document run.";
      setHistoryError(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function fetchHistory(searchValue: string) {
    setIsHistoryLoading(true);
    setHistoryError(null);

    try {
      const response = await fetch(`/api/shipment-documents/runs?search=${encodeURIComponent(searchValue)}`, {
        method: "GET"
      });
      const json = (await response.json().catch(() => null)) as ShipmentDocumentHistoryResponse | { error?: string } | null;

      if (!response.ok || !json || !("runs" in json)) {
        throw new Error((json && "error" in json && typeof json.error === "string" ? json.error : null) ?? "Unable to load shipment document history.");
      }

      setHistory(json);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load shipment document history.";
      setHistoryError(message);
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function handleDeleteRun(runId: string) {
    if (!window.confirm("Delete this saved shipment document run? This cannot be undone.")) {
      return;
    }

    setHistoryError(null);

    try {
      const response = await fetch(`/api/shipment-documents/runs/${runId}`, {
        method: "DELETE"
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(json?.error ?? "Unable to delete this shipment document run.");
      }

      if (savedRunId === runId) {
        setSavedRunId(null);
      }

      await fetchHistory(historySearch);
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Unable to delete this shipment document run.";
      setHistoryError(message);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-2">
          <label className="text-sm font-medium text-foreground">
            Shipment date
            <input
              type="date"
              value={shipmentDate}
              onChange={(event) => setShipmentDate(event.target.value)}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Document label
            <input
              value={documentLabel}
              onChange={(event) => {
                setLabelManuallyEdited(true);
                setDocumentLabel(event.target.value);
              }}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="June 26 2026"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            BOL PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setBolFile(event.target.files?.[0] ?? null)}
              className="mt-2 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            Pick-ticket PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setPickTicketFile(event.target.files?.[0] ?? null)}
              className="mt-2 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleProcess}
            disabled={!canProcess}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isProcessing ? "Processing PDFs..." : "Sort and build PDFs"}
          </button>
          <p className="text-sm text-mutedForeground">{status}</p>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Email prep</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              This first version opens a prefilled draft with subject and body. Browser security does not let us attach
              the generated PDFs automatically yet, so the CSR still adds the two downloaded files.
            </p>
          </div>
          {emailHref ? (
            <a
              href={emailHref}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Open email draft
            </a>
          ) : null}
        </div>

        <label className="mt-4 block text-sm font-medium text-foreground">
          Recipient email
          <input
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="customer@example.com"
          />
        </label>
      </section>

      {result ? (
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Save this run</h2>
                <p className="mt-1 text-sm leading-6 text-mutedForeground">
                  Save the sorted PDFs into searchable Garland history so the team can pull the same package back later.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveRun}
                disabled={isSaving || savedRunId !== null}
                className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savedRunId ? "Saved to history" : isSaving ? "Saving..." : "Save to history"}
              </button>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <ResultCard
              title="BOL output"
              description="Combined BOL document sorted by PS number."
              result={result.bol}
            />
            <ResultCard
              title="Pick-ticket output"
              description="Combined pick-ticket document sorted by PS number."
              result={result.pickTickets}
            />
          </section>
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Saved Garland history</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Search historical runs by date label, recipient, source file name, or PS number. Delete any run that was saved by accident or is no longer needed.
            </p>
          </div>
          <div className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
            {history.totalCount} saved run{history.totalCount === 1 ? "" : "s"}
          </div>
        </div>

        <div className="p-5">
          <form
            className="grid gap-3 md:grid-cols-[1fr,auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void fetchHistory(historySearch);
            }}
          >
            <input
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Search date, recipient, source file, or PS number"
            />
            <button className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              {isHistoryLoading ? "Searching..." : "Search history"}
            </button>
          </form>

          {historyError ? (
            <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {historyError}
            </div>
          ) : null}

          {history.runs.length === 0 ? (
            <div className="mt-4 rounded-md border border-border bg-muted/20 px-4 py-6 text-sm text-mutedForeground">
              No saved Garland shipment-document runs match this search yet.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-md border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                  <tr>
                    <th className="px-3 py-2">Run</th>
                    <th className="px-3 py-2">Recipient</th>
                    <th className="px-3 py-2">BOL/Pick</th>
                    <th className="px-3 py-2">PS order</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.runs.map((run) => (
                    <tr key={run.id}>
                      <td className="px-3 py-3 align-top">
                        <p className="font-medium text-foreground">{run.documentLabel}</p>
                        <p className="mt-1 text-xs text-mutedForeground">
                          Shipment date {formatDate(run.shipmentDate)} · Saved {formatDateTime(run.createdAt)}
                        </p>
                        <p className="mt-1 text-xs text-mutedForeground">
                          {run.createdByName ? `Saved by ${run.createdByName}` : "Saved run"}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top text-mutedForeground">
                        <p>{run.recipientEmail ?? "No recipient saved"}</p>
                        <p className="mt-1 text-xs">{run.sourceBolFileName ?? "No source BOL name"}</p>
                        <p className="text-xs">{run.sourcePickTicketFileName ?? "No source pick name"}</p>
                      </td>
                      <td className="px-3 py-3 align-top text-mutedForeground">
                        <p>{run.bolPageCount} BOL pages</p>
                        <p>{run.pickTicketPageCount} pick pages</p>
                        <p className="mt-1 text-xs">
                          AI fallback: {run.bolAiFallbackPageCount} / {run.pickAiFallbackPageCount}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top text-mutedForeground">
                        <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">BOL</p>
                        <p className="mt-1 text-sm">{formatPsSequence(run.bolPsNumbers)}</p>
                        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-mutedForeground">Pick</p>
                        <p className="mt-1 text-sm">{formatPsSequence(run.pickPsNumbers)}</p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={`/api/shipment-documents/runs/${run.id}?documentType=bol`}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                          >
                            Download BOL
                          </a>
                          <a
                            href={`/api/shipment-documents/runs/${run.id}?documentType=pick`}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                          >
                            Download Pick
                          </a>
                          <button
                            type="button"
                            onClick={() => void handleDeleteRun(run.id)}
                            className="rounded-md border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ResultCard({
  title,
  description,
  result
}: {
  title: string;
  description: string;
  result: DocumentResult;
}) {
  const orderedPsGroups = groupOrderedPsNumbers(
    result.pages.map((page) => ({
      psNumber: page.psNumber,
      detectionMethod: page.detectionMethod
    }))
  );

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">{description}</p>
        </div>
        <a
          href={result.downloadUrl}
          download={result.fileName}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Download PDF
        </a>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Stat label="Pages sorted" value={result.pageCount.toString()} />
        <Stat
          label="AI fallback pages"
          value={result.pages.filter((page) => page.detectionMethod === "AI").length.toString()}
        />
        <Stat label="Lowest PS" value={result.pages[0]?.psNumber ?? "N/A"} />
      </div>

      <div className="mt-4 rounded-md border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">PS sort order</p>
            <p className="mt-1 text-xs text-mutedForeground">
              Quick visual check of the final sequence before you email the PDFs.
            </p>
          </div>
          <div className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
            {orderedPsGroups.length} PS number{orderedPsGroups.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {orderedPsGroups.map((group, index) => (
            <div
              key={`${result.fileName}-${group.psNumber}-${index}`}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground"
            >
              <span className="font-semibold">{index + 1}. {group.psNumber}</span>
              <span className="text-mutedForeground">
                {" "}
                · {group.pageCount} page{group.pageCount === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            <tr>
              <th className="px-3 py-2">Page</th>
              <th className="px-3 py-2">PS number</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {result.pages.map((page) => (
              <tr key={`${result.fileName}-${page.pageNumber}`}>
                <td className="px-3 py-2 text-foreground">{page.pageNumber}</td>
                <td className="px-3 py-2 font-medium text-foreground">{page.psNumber}</td>
                <td className="px-3 py-2 text-mutedForeground">
                  {page.detectionMethod === "AI"
                    ? "AI"
                    : page.detectionMethod === "INHERITED"
                      ? "Grouped"
                      : "Text"}
                </td>
                <td className="px-3 py-2 text-mutedForeground">{page.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function groupOrderedPsNumbers(
  pages: Array<{
    psNumber: string;
  }>
) {
  const groups: Array<{ psNumber: string; pageCount: number }> = [];

  for (const page of pages) {
    const lastGroup = groups.at(-1);

    if (lastGroup && lastGroup.psNumber === page.psNumber) {
      lastGroup.pageCount += 1;
      continue;
    }

    groups.push({
      psNumber: page.psNumber,
      pageCount: 1
    });
  }

  return groups;
}

function formatPsSequence(psNumbers: string[]) {
  if (psNumbers.length === 0) {
    return "No PS numbers saved";
  }

  return psNumbers.join(" -> ");
}

async function processDocument({
  fileBytes,
  sourceFileName,
  documentType,
  outputLabel,
  onStatus
}: {
  fileBytes: Uint8Array;
  sourceFileName: string;
  documentType: ShipmentDocumentType;
  outputLabel: string;
  onStatus: (message: string) => void;
}): Promise<DocumentResult> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: fileBytes });
  const pdf = await loadingTask.promise;
  const extractedPages: DetectedShipmentPage[] = [];
  const missingPages: Array<{ pageNumber: number; imageDataUrl: string }> = [];

  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
    onStatus(`Reading ${documentType} page ${pageIndex + 1} of ${pdf.numPages}.`);
    const page = await pdf.getPage(pageIndex + 1);
    const text = await extractPageText(page);
    const psNumber = extractPsNumberFromText(text);

    if (psNumber) {
      extractedPages.push({
        pageNumber: pageIndex + 1,
        psNumber,
        detectionMethod: "TEXT",
        confidence: "HIGH",
        notes: null
      });
      continue;
    }

    const imageDataUrl = await renderCroppedPageImage(page, CROP_BOXES[documentType]);
    missingPages.push({
      pageNumber: pageIndex + 1,
      imageDataUrl
    });
  }

  if (missingPages.length > 0) {
    onStatus(`Running AI fallback on ${missingPages.length} ${documentType} pages from ${sourceFileName}.`);
    const aiDetections = await detectMissingPsNumbers(documentType, missingPages);

    for (const detection of aiDetections) {
      extractedPages.push({
        pageNumber: detection.pageNumber,
        psNumber: detection.psNumber ?? "",
        detectionMethod: "AI",
        confidence: detection.psNumber ? detection.confidence ?? "MEDIUM" : "LOW",
        notes: detection.notes ?? null
      });
    }
  }

  const groupedDocuments = groupDetectedShipmentPages(
    documentType,
    extractedPages
      .map((page) => ({
        ...page,
        psNumber: page.psNumber ?? null
      }))
      .sort((left, right) => left.pageNumber - right.pageNumber)
  );

  const sortedPages = [...groupedDocuments]
    .sort((left, right) => {
      const psComparison = comparePsNumbers(left.psNumber, right.psNumber);
      return psComparison !== 0 ? psComparison : left.pages[0].pageNumber - right.pages[0].pageNumber;
    })
    .flatMap((group) => group.pages);

  const sortedPdfBytes = await rebuildPdfInSortedOrder(fileBytes, sortedPages.map((page) => page.pageNumber - 1));
  const pdfBuffer = new ArrayBuffer(sortedPdfBytes.byteLength);
  new Uint8Array(pdfBuffer).set(sortedPdfBytes);
  const blob = new Blob([pdfBuffer], { type: "application/pdf" });

  return {
    fileName: outputLabel,
    downloadUrl: URL.createObjectURL(blob),
    pageCount: sortedPages.length,
    pages: sortedPages,
    pdfBase64: bytesToBase64(sortedPdfBytes)
  };
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
  return textContent.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ")
    .trim();
}

async function renderCroppedPageImage(
  page: PDFPageProxy,
  cropBox: { x: number; y: number; width: number; height: number }
) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Browser canvas rendering is not available for shipment document processing.");
  }

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  const cropCanvas = document.createElement("canvas");
  const cropContext = cropCanvas.getContext("2d");

  if (!cropContext) {
    throw new Error("Browser canvas cropping is not available for shipment document processing.");
  }

  const sx = Math.floor(canvas.width * cropBox.x);
  const sy = Math.floor(canvas.height * cropBox.y);
  const sw = Math.max(1, Math.floor(canvas.width * cropBox.width));
  const sh = Math.max(1, Math.floor(canvas.height * cropBox.height));

  cropCanvas.width = sw;
  cropCanvas.height = sh;
  cropContext.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  return cropCanvas.toDataURL("image/png");
}

async function detectMissingPsNumbers(
  documentType: ShipmentDocumentType,
  pages: Array<{ pageNumber: number; imageDataUrl: string }>
) {
  const results: Array<{ pageNumber: number; psNumber: string | null; confidence?: string; notes?: string | null }> = [];

  for (let index = 0; index < pages.length; index += AI_BATCH_SIZE) {
    const batch = pages.slice(index, index + AI_BATCH_SIZE);
    const response = await fetch("/api/shipment-documents/ps-number", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        documentType,
        images: batch
      })
    });

    const json = (await response.json().catch(() => null)) as
      | {
          error?: string;
          entries?: Array<{ pageNumber: number; psNumber: string | null; confidence?: string; notes?: string | null }>;
        }
      | null;

    if (!response.ok || !json?.entries) {
      throw new Error(json?.error ?? `AI fallback failed for ${documentType} pages ${batch[0]?.pageNumber}-${batch.at(-1)?.pageNumber}.`);
    }

    for (const entry of json.entries) {
      results.push({
        pageNumber: entry.pageNumber,
        psNumber: normalizePsNumber(entry.psNumber),
        confidence: entry.confidence,
        notes: entry.notes ?? null
      });
    }
  }

  return results.sort((left, right) => left.pageNumber - right.pageNumber);
}

async function rebuildPdfInSortedOrder(fileBytes: Uint8Array, pageIndexes: number[]) {
  const sourceDocument = await PDFDocument.load(fileBytes);
  const sortedDocument = await PDFDocument.create();
  const copiedPages = await sortedDocument.copyPages(sourceDocument, pageIndexes);

  for (const page of copiedPages) {
    sortedDocument.addPage(page);
  }

  return sortedDocument.save();
}

async function readFileBytes(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return window.btoa(binary);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
