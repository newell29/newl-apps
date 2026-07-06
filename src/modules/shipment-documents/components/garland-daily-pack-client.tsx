"use client";

import { useEffect, useMemo, useState } from "react";
import { PDFDocument } from "pdf-lib";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import {
  comparePsNumbers,
  extractPsNumberFromText,
  formatHumanDateFromIso,
  normalizePsNumber,
  sanitizeLabelForFilename,
  type ShipmentDocumentType
} from "@/modules/shipment-documents/ps-number";

type ExtractedPageRecord = {
  pageNumber: number;
  psNumber: string;
  detectionMethod: "TEXT" | "AI";
  confidence: string;
  notes: string | null;
};

type DocumentResult = {
  fileName: string;
  downloadUrl: string;
  pageCount: number;
  pages: ExtractedPageRecord[];
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

export function GarlandDailyPackClient() {
  const [shipmentDate, setShipmentDate] = useState(getTodayIsoDate);
  const [documentLabel, setDocumentLabel] = useState(() => formatHumanDateFromIso(getTodayIsoDate()));
  const [labelManuallyEdited, setLabelManuallyEdited] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [bolFile, setBolFile] = useState<File | null>(null);
  const [pickTicketFile, setPickTicketFile] = useState<File | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Upload the daily BOL and pick-ticket PDFs to begin.");
  const [isProcessing, setIsProcessing] = useState(false);

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
      ) : null}
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
                <td className="px-3 py-2 text-mutedForeground">{page.detectionMethod === "AI" ? "AI" : "Text"}</td>
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
  const extractedPages: ExtractedPageRecord[] = [];
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
      if (!detection.psNumber) {
        throw new Error(
          `Could not find a PS number on ${documentType} page ${detection.pageNumber}. The output PDF was not created so the CSR can review that page first.`
        );
      }

      extractedPages.push({
        pageNumber: detection.pageNumber,
        psNumber: detection.psNumber,
        detectionMethod: "AI",
        confidence: detection.confidence ?? "MEDIUM",
        notes: detection.notes ?? null
      });
    }
  }

  const sortedPages = [...extractedPages].sort((left, right) => {
    const psComparison = comparePsNumbers(left.psNumber, right.psNumber);
    return psComparison !== 0 ? psComparison : left.pageNumber - right.pageNumber;
  });

  const sortedPdfBytes = await rebuildPdfInSortedOrder(fileBytes, sortedPages.map((page) => page.pageNumber - 1));
  const pdfBuffer = new ArrayBuffer(sortedPdfBytes.byteLength);
  new Uint8Array(pdfBuffer).set(sortedPdfBytes);
  const blob = new Blob([pdfBuffer], { type: "application/pdf" });

  return {
    fileName: outputLabel,
    downloadUrl: URL.createObjectURL(blob),
    pageCount: sortedPages.length,
    pages: sortedPages
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
