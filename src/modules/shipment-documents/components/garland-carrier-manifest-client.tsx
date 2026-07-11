"use client";

import { useEffect, useMemo, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import type {
  GarlandCarrierKey,
  GarlandCarrierManifestHistoryResponse,
  GarlandCarrierManifestRow
} from "@/modules/shipment-documents/carrier-manifest-types";
import { formatHumanDateFromIso } from "@/modules/shipment-documents/ps-number";

type PdfJsModule = typeof import("pdfjs-dist");

type GeneratedWorkbook = {
  carrier: GarlandCarrierKey;
  fileName: string;
  downloadUrl: string;
  base64: string;
  rowCount: number;
  skidCount: number;
};

type ExtractionResponse = {
  rows: GarlandCarrierManifestRow[];
  error?: string;
};

type EditableManifestField = "srNumber" | "psNumber" | "cityProvince" | "skids";

const TARGET_CARRIERS: Array<{ key: GarlandCarrierKey; label: string }> = [
  { key: "MIDLAND", label: "Midland" },
  { key: "SPEEDY", label: "Speedy" },
  { key: "SURETRACK", label: "Suretrack" }
];
const EXTRACTION_BATCH_SIZE = 1;
const MANIFEST_CROP_IMAGE_WIDTH = 1800;
const MANIFEST_CROP_IMAGE_JPEG_QUALITY = 0.9;

const MANIFEST_CROP_BOXES = [
  { label: "Carrier box", x: 0.025, y: 0.12, width: 0.37, height: 0.06 },
  { label: "References / PS box", x: 0.615, y: 0.12, width: 0.34, height: 0.06 },
  { label: "Shipment ID", x: 0.78, y: 0.075, width: 0.19, height: 0.055 },
  { label: "Consignee city/province", x: 0.49, y: 0.24, width: 0.43, height: 0.105 },
  { label: "Total pallets", x: 0.025, y: 0.61, width: 0.26, height: 0.065 }
];

let pdfJsLoader: Promise<PdfJsModule> | null = null;

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function GarlandCarrierManifestClient({
  initialHistory
}: {
  initialHistory: GarlandCarrierManifestHistoryResponse;
}) {
  const [shipmentDate, setShipmentDate] = useState(getTodayIsoDate);
  const [documentLabel, setDocumentLabel] = useState(() => formatHumanDateFromIso(getTodayIsoDate()));
  const [labelManuallyEdited, setLabelManuallyEdited] = useState(false);
  const [bolFile, setBolFile] = useState<File | null>(null);
  const [rows, setRows] = useState<GarlandCarrierManifestRow[]>([]);
  const [workbooks, setWorkbooks] = useState<GeneratedWorkbook[]>([]);
  const [history, setHistory] = useState(initialHistory);
  const [status, setStatus] = useState("Upload the daily Garland BOL bundle to build carrier manifests.");
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingSignedCopyRunId, setUploadingSignedCopyRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!labelManuallyEdited) {
      setDocumentLabel(formatHumanDateFromIso(shipmentDate));
    }
  }, [shipmentDate, labelManuallyEdited]);

  useEffect(() => {
    return () => {
      for (const workbook of workbooks) {
        URL.revokeObjectURL(workbook.downloadUrl);
      }
    };
  }, [workbooks]);

  const carrierCounts = useMemo(() => buildCarrierCounts(rows), [rows]);

  function acceptBolFile(file: File | null) {
    if (!file) {
      return;
    }

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose, paste, or drop a PDF file.");
      return;
    }

    setBolFile(file);
    setError(null);
    setStatus(`${file.name} is ready to process.`);
  }

  async function handleBuildManifests() {
    if (!bolFile) {
      return;
    }

    setIsProcessing(true);
    setError(null);
    setRows([]);
    setWorkbooks((current) => {
      current.forEach((workbook) => URL.revokeObjectURL(workbook.downloadUrl));
      return [];
    });

    try {
      const fileBytes = await readFileAsUint8Array(bolFile);
      const pdf = await loadPdf(fileBytes);
      const detectedRows: GarlandCarrierManifestRow[] = [];

      for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += EXTRACTION_BATCH_SIZE) {
        const images = [];
        const lastPageIndex = Math.min(pdf.numPages, pageIndex + EXTRACTION_BATCH_SIZE);

        for (let batchPageIndex = pageIndex; batchPageIndex < lastPageIndex; batchPageIndex += 1) {
          const page = await pdf.getPage(batchPageIndex + 1);
          const imageDataUrl = await renderManifestCropSheet(page);
          images.push({ pageNumber: batchPageIndex + 1, imageDataUrl });
        }

        setStatus(`Reading BOL pages ${pageIndex + 1}-${lastPageIndex} of ${pdf.numPages}...`);
        detectedRows.push(...(await extractManifestRows(images)));
      }

      const sortedRows = sortManifestRows(mergeMultiPageBolRows(detectedRows));

      const nextWorkbooks = buildWorkbooksForRows(sortedRows, documentLabel, shipmentDate);

      setRows(sortedRows);
      setWorkbooks(nextWorkbooks);
      setStatus(
        nextWorkbooks.length > 0
          ? `Built ${nextWorkbooks.length} carrier manifest workbook${nextWorkbooks.length === 1 ? "" : "s"}.`
          : "No Midland, Speedy, or Suretrack BOLs were found in this upload."
      );
    } catch (buildError) {
      const message = buildError instanceof Error ? buildError.message : "Unable to build carrier manifests.";
      setError(message);
      setStatus("Carrier manifest build stopped before workbooks were created.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleSaveRun() {
    if (!bolFile || rows.length === 0 || workbooks.length === 0) {
      return;
    }

    setIsSaving(true);
    setHistoryError(null);

    try {
      const response = await fetch("/api/shipment-documents/carrier-manifest/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shipmentDate,
          documentLabel,
          sourceBolFileName: bolFile.name,
          rows,
          workbooks: Object.fromEntries(
            workbooks.map((workbook) => [workbook.carrier, { fileName: workbook.fileName, base64: workbook.base64 }])
          )
        })
      });
      const json = (await response.json().catch(() => null)) as GarlandCarrierManifestHistoryResponse | { error?: string } | null;

      if (!response.ok || !json || !("runs" in json)) {
        throw new Error((json && "error" in json && typeof json.error === "string" ? json.error : null) ?? "Unable to save carrier manifest run.");
      }

      setHistory(json);
      setStatus("Carrier manifests were saved to history.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save carrier manifest run.";
      setHistoryError(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteRun(runId: string) {
    if (!window.confirm("Delete this saved carrier manifest run? This cannot be undone from the app.")) {
      return;
    }

    setHistoryError(null);

    try {
      const response = await fetch(`/api/shipment-documents/carrier-manifest/runs/${runId}`, {
        method: "DELETE"
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(json?.error ?? "Unable to delete carrier manifest run.");
      }

      await refreshHistory();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Unable to delete carrier manifest run.";
      setHistoryError(message);
    }
  }

  async function handleSignedCopyUpload(runId: string, file: File | null) {
    if (!file) {
      return;
    }

    setUploadingSignedCopyRunId(runId);
    setHistoryError(null);

    try {
      const response = await fetch(`/api/shipment-documents/carrier-manifest/runs/${runId}/signed-copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          base64: bytesToBase64(await readFileAsUint8Array(file))
        })
      });
      const json = (await response.json().catch(() => null)) as GarlandCarrierManifestHistoryResponse | { error?: string } | null;

      if (!response.ok || !json || !("runs" in json)) {
        throw new Error((json && "error" in json && typeof json.error === "string" ? json.error : null) ?? "Unable to upload signed copy.");
      }

      setHistory(json);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Unable to upload signed copy.";
      setHistoryError(message);
    } finally {
      setUploadingSignedCopyRunId(null);
    }
  }

  async function refreshHistory() {
    const response = await fetch("/api/shipment-documents/carrier-manifest/runs", { method: "GET" });
    const json = (await response.json().catch(() => null)) as GarlandCarrierManifestHistoryResponse | { error?: string } | null;

    if (!response.ok || !json || !("runs" in json)) {
      throw new Error((json && "error" in json && typeof json.error === "string" ? json.error : null) ?? "Unable to refresh carrier manifest history.");
    }

    setHistory(json);
  }

  function handleRowChange(index: number, field: EditableManifestField, value: string) {
    setRows((currentRows) => {
      const nextRows = currentRows.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }

        return {
          ...row,
          [field]: field === "skids" ? normalizeEditablePallets(value) : value
        };
      });
      const sortedRows = sortManifestRows(mergeMultiPageBolRows(nextRows));

      setWorkbooks((currentWorkbooks) => {
        currentWorkbooks.forEach((workbook) => URL.revokeObjectURL(workbook.downloadUrl));
        return buildWorkbooksForRows(sortedRows, documentLabel, shipmentDate);
      });

      return sortedRows;
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-foreground">
            Manifest date
            <input
              type="date"
              value={shipmentDate}
              onChange={(event) => setShipmentDate(event.target.value)}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-medium text-foreground">
            Document label
            <input
              value={documentLabel}
              onChange={(event) => {
                setDocumentLabel(event.target.value);
                setLabelManuallyEdited(true);
              }}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="July 10, 2026"
            />
          </label>
          <div
            className="block rounded-md text-sm font-medium text-foreground outline-none ring-primary focus-within:ring-2 focus:ring-2 md:col-span-2"
            tabIndex={0}
            role="group"
            aria-label="Paste or drop Garland BOL PDF"
            onPaste={(event) => {
              const file = Array.from(event.clipboardData.files).find(
                (candidate) => candidate.type === "application/pdf" || candidate.name.toLowerCase().endsWith(".pdf")
              );

              if (file) {
                event.preventDefault();
                acceptBolFile(file);
              }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              acceptBolFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <label htmlFor="garland-bol-pdf">Garland BOL PDF</label>
            <input
              id="garland-bol-pdf"
              type="file"
              accept="application/pdf"
              onChange={(event) => acceptBolFile(event.target.files?.[0] ?? null)}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs font-normal text-mutedForeground">
              Choose a file, drag it here, or paste a copied PDF.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleBuildManifests()}
            disabled={!bolFile || isProcessing}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isProcessing ? "Building manifests..." : "Build carrier manifests"}
          </button>
          <p className="text-sm text-mutedForeground">{status}</p>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
      </section>

      {rows.length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Generated manifests</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                Review the detected rows, download editable Excel files, then save the run to history.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSaveRun()}
              disabled={isSaving || workbooks.length === 0}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save to history"}
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {TARGET_CARRIERS.map((carrier) => (
              <div key={carrier.key} className="rounded-md border border-border bg-muted/20 p-4">
                <p className="text-sm font-semibold text-foreground">{carrier.label}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{carrierCounts[carrier.key]}</p>
                <p className="text-xs text-mutedForeground">rows detected</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {workbooks.map((workbook) => (
              <a
                key={workbook.carrier}
                href={workbook.downloadUrl}
                download={workbook.fileName}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Download {formatCarrier(workbook.carrier)} XLS ({workbook.rowCount} rows)
              </a>
            ))}
          </div>

          <ManifestRowsTable rows={rows} onRowChange={handleRowChange} />
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Saved carrier manifest history</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Download generated Excel files or upload the final signed copy after loading is complete.
            </p>
          </div>
          <div className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
            {history.totalCount} saved run{history.totalCount === 1 ? "" : "s"}
          </div>
        </div>

        <div className="p-5">
          {historyError ? (
            <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {historyError}
            </div>
          ) : null}

          {history.runs.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/20 px-4 py-6 text-sm text-mutedForeground">
              No saved carrier manifest runs yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                  <tr>
                    <th className="px-3 py-2">Run</th>
                    <th className="px-3 py-2">Carriers</th>
                    <th className="px-3 py-2">Signed copy</th>
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
                        <p className="mt-1 text-xs text-mutedForeground">{run.sourceBolFileName ?? "No source file saved"}</p>
                      </td>
                      <td className="px-3 py-3 align-top text-mutedForeground">
                        {TARGET_CARRIERS.map((carrier) => (
                          <p key={carrier.key}>
                            {carrier.label}: {run.carrierCounts[carrier.key] ?? 0}
                          </p>
                        ))}
                      </td>
                      <td className="px-3 py-3 align-top text-mutedForeground">
                        {run.signedCopyFileName ? (
                          <>
                            <a
                              href={`/api/shipment-documents/carrier-manifest/runs/${run.id}?documentType=signed`}
                              className="font-semibold text-primary hover:underline"
                            >
                              {run.signedCopyFileName}
                            </a>
                            <p className="mt-1 text-xs">Uploaded {formatDateTime(run.signedCopyUploadedAt)}</p>
                          </>
                        ) : (
                          <label className="block">
                            <span className="text-xs font-semibold text-mutedForeground">Upload final signed copy</span>
                            <input
                              type="file"
                              accept="application/pdf,image/*"
                              disabled={uploadingSignedCopyRunId === run.id}
                              onChange={(event) => void handleSignedCopyUpload(run.id, event.target.files?.[0] ?? null)}
                              className="mt-2 w-full text-xs"
                            />
                          </label>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          {run.hasMidlandWorkbook ? <DownloadLink runId={run.id} type="midland" label="Midland XLS" /> : null}
                          {run.hasSpeedyWorkbook ? <DownloadLink runId={run.id} type="speedy" label="Speedy XLS" /> : null}
                          {run.hasSuretrackWorkbook ? <DownloadLink runId={run.id} type="suretrack" label="Suretrack XLS" /> : null}
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

function ManifestRowsTable({
  rows,
  onRowChange
}: {
  rows: GarlandCarrierManifestRow[];
  onRowChange: (index: number, field: EditableManifestField, value: string) => void;
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          <tr>
            <th className="px-3 py-2">Carrier</th>
            <th className="px-3 py-2">Page</th>
            <th className="px-3 py-2">SR#</th>
            <th className="px-3 py-2">PS#</th>
            <th className="px-3 py-2">City / Pro</th>
            <th className="px-3 py-2">Pallets</th>
            <th className="px-3 py-2">Confidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, index) => (
            <tr key={`${row.carrier}-${row.pageNumber}-${row.psNumber}-${index}`}>
              <td className="px-3 py-2 font-semibold text-foreground">{formatCarrier(row.carrier)}</td>
              <td className="px-3 py-2 text-mutedForeground">{row.pageNumber}</td>
              <td className="px-3 py-2">
                <input
                  value={row.srNumber}
                  onChange={(event) => onRowChange(index, "srNumber", event.target.value)}
                  className="w-28 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                  aria-label={`SR number for page ${row.pageNumber}`}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  value={row.psNumber}
                  onChange={(event) => onRowChange(index, "psNumber", event.target.value)}
                  className="w-28 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                  aria-label={`PS number for page ${row.pageNumber}`}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  value={row.cityProvince}
                  onChange={(event) => onRowChange(index, "cityProvince", event.target.value)}
                  className="w-44 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                  aria-label={`City and province for page ${row.pageNumber}`}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  value={row.skids ?? ""}
                  inputMode="numeric"
                  onChange={(event) => onRowChange(index, "skids", event.target.value)}
                  className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                  aria-label={`Pallet count for page ${row.pageNumber}`}
                />
              </td>
              <td className="px-3 py-2 text-mutedForeground">{row.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DownloadLink({ runId, type, label }: { runId: string; type: string; label: string }) {
  return (
    <a
      href={`/api/shipment-documents/carrier-manifest/runs/${runId}?documentType=${type}`}
      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
    >
      {label}
    </a>
  );
}

async function extractManifestRows(images: Array<{ pageNumber: number; imageDataUrl: string }>) {
  const response = await fetch("/api/shipment-documents/carrier-manifest/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images })
  });
  const json = (await response.json().catch(() => null)) as ExtractionResponse | null;

  if (!response.ok || !json) {
    throw new Error(json?.error ?? "Unable to extract carrier manifest rows.");
  }

  return Array.isArray(json.rows) ? json.rows : [];
}

function buildWorkbook(carrier: GarlandCarrierKey, documentLabel: string, shipmentDate: string, rows: GarlandCarrierManifestRow[]): GeneratedWorkbook {
  const carrierLabel = formatCarrier(carrier);
  const fileName = `${sanitizeFilename(`${carrierLabel} Manifest ${documentLabel}`)}.xls`;
  const sortedRows = sortManifestRows(rows);
  const rowCount = Math.max(sortedRows.length, 16);
  const palletCount = sortedRows.reduce((total, row) => total + (row.skids ?? 0), 0);
  const html = buildWorkbookHtml(carrierLabel, documentLabel, shipmentDate, sortedRows, rowCount, palletCount);
  const bytes = new TextEncoder().encode(html);
  const blob = new Blob([bytes], { type: "application/vnd.ms-excel" });

  return {
    carrier,
    fileName,
    downloadUrl: URL.createObjectURL(blob),
    base64: bytesToBase64(bytes),
    rowCount: sortedRows.length,
    skidCount: palletCount
  };
}

function buildWorkbooksForRows(rows: GarlandCarrierManifestRow[], documentLabel: string, shipmentDate: string) {
  return TARGET_CARRIERS.flatMap((carrier) => {
    const carrierRows = rows.filter((row) => row.carrier === carrier.key);
    return carrierRows.length > 0 ? [buildWorkbook(carrier.key, documentLabel, shipmentDate, carrierRows)] : [];
  });
}

function buildWorkbookHtml(
  carrierLabel: string,
  documentLabel: string,
  shipmentDate: string,
  rows: GarlandCarrierManifestRow[],
  rowCount: number,
  palletCount: number
) {
  const bodyRows = Array.from({ length: rowCount }, (_, index) => {
    const row = rows[index];
    return [
      '<tr class="manifest-row">',
      `<td class="row-number">${index + 1}</td>`,
      `<td>${escapeHtml(row?.srNumber ?? "")}</td>`,
      `<td>${escapeHtml(row?.psNumber.replace(/^PS/i, "") ?? "")}</td>`,
      `<td>${escapeHtml(row?.cityProvince ?? "")}</td>`,
      `<td class="skids">${row?.skids ?? ""}</td>`,
      "</tr>"
    ].join("");
  }).join("");

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8" />',
    "<style>",
    "@page{size:letter landscape;margin:0.25in;}body{font-family:Arial,sans-serif;margin:0;}table{border-collapse:collapse;width:100%;table-layout:fixed;page-break-inside:avoid;}td,th{border:1px solid #111;padding:4px 8px;font-size:14px;line-height:1.15;}th{font-size:16px;text-align:center;font-weight:700;} .title{font-size:22px;font-weight:700;text-align:center;} .row-number{width:36px;text-align:right;} .sr{width:38%;}.ps{width:15%;}.city{width:34%;}.skids{text-align:right;width:80px;} .manifest-row td{height:24px;} .signature{height:44px;font-weight:700;} .summary{font-weight:700;background:#f2f2f2;}",
    "</style>",
    "</head>",
    "<body>",
    "<table>",
    `<tr><td class="title" colspan="5">${escapeHtml(`${carrierLabel} Manifest ${documentLabel}`)}</td></tr>`,
    '<tr><th></th><th class="sr">SR#</th><th class="ps">PS#</th><th class="city">City / Prov</th><th class="skids">Pallets</th></tr>',
    bodyRows,
    `<tr class="summary"><td colspan="4">Total pallets</td><td class="skids">${palletCount}</td></tr>`,
    `<tr><td class="signature" colspan="2">Driver signature</td><td colspan="2"></td><td>${escapeHtml(shipmentDate)}</td></tr>`,
    "</table>",
    "</body>",
    "</html>"
  ].join("");
}

async function readFileAsUint8Array(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}

async function loadPdf(fileBytes: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(fileBytes.byteLength);
  bytes.set(fileBytes);
  return pdfjs.getDocument({ data: bytes }).promise;
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

async function renderManifestCropSheet(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 3 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Browser canvas rendering is not available for carrier manifest processing.");
  }

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  const cropGap = 24;
  const labelHeight = 34;
  const sheetPadding = 24;
  const cropTargetWidth = MANIFEST_CROP_IMAGE_WIDTH - sheetPadding * 2;
  const renderedCrops = MANIFEST_CROP_BOXES.map((cropBox) => {
    const sourceWidth = Math.max(1, Math.floor(canvas.width * cropBox.width));
    const sourceHeight = Math.max(1, Math.floor(canvas.height * cropBox.height));
    const targetHeight = Math.max(80, Math.round((sourceHeight / sourceWidth) * cropTargetWidth));

    return {
      ...cropBox,
      sourceX: Math.floor(canvas.width * cropBox.x),
      sourceY: Math.floor(canvas.height * cropBox.y),
      sourceWidth,
      sourceHeight,
      targetHeight
    };
  });
  const sheetHeight =
    sheetPadding * 2 +
    renderedCrops.reduce((total, crop) => total + labelHeight + crop.targetHeight + cropGap, -cropGap);
  const sheetCanvas = document.createElement("canvas");
  sheetCanvas.width = MANIFEST_CROP_IMAGE_WIDTH;
  sheetCanvas.height = sheetHeight;
  const sheetContext = sheetCanvas.getContext("2d");

  if (!sheetContext) {
    throw new Error("Unable to create a crop canvas for carrier manifest extraction.");
  }

  sheetContext.fillStyle = "#ffffff";
  sheetContext.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
  sheetContext.font = "700 24px Arial, sans-serif";
  sheetContext.textBaseline = "top";

  let yPosition = sheetPadding;

  for (const crop of renderedCrops) {
    sheetContext.fillStyle = "#111827";
    sheetContext.fillText(crop.label, sheetPadding, yPosition);
    yPosition += labelHeight;
    sheetContext.drawImage(
      canvas,
      crop.sourceX,
      crop.sourceY,
      crop.sourceWidth,
      crop.sourceHeight,
      sheetPadding,
      yPosition,
      cropTargetWidth,
      crop.targetHeight
    );
    sheetContext.strokeStyle = "#ef4444";
    sheetContext.lineWidth = 4;
    sheetContext.strokeRect(sheetPadding, yPosition, cropTargetWidth, crop.targetHeight);
    yPosition += crop.targetHeight + cropGap;
  }

  return sheetCanvas.toDataURL("image/jpeg", MANIFEST_CROP_IMAGE_JPEG_QUALITY);
}

function sortManifestRows(rows: GarlandCarrierManifestRow[]) {
  return [...rows].sort((left, right) => {
    const carrierComparison = left.carrier.localeCompare(right.carrier);
    return carrierComparison !== 0 ? carrierComparison : left.pageNumber - right.pageNumber;
  });
}

function mergeMultiPageBolRows(rows: GarlandCarrierManifestRow[]) {
  const mergedRows: GarlandCarrierManifestRow[] = [];

  for (const row of rows) {
    const existingRow = findMatchingBolRow(mergedRows, row);

    if (!existingRow) {
      mergedRows.push(row);
      continue;
    }

    existingRow.srNumber = existingRow.srNumber || row.srNumber;
    existingRow.psNumber = existingRow.psNumber || row.psNumber;
    existingRow.cityProvince = existingRow.cityProvince || row.cityProvince;
    existingRow.skids = existingRow.skids ?? row.skids;
    existingRow.confidence = combineConfidence(existingRow.confidence, row.confidence);
    existingRow.notes = [existingRow.notes, `Merged page ${row.pageNumber} as the same multi-page BOL.`]
      .filter(Boolean)
      .join(" ");
  }

  return mergedRows;
}

function findMatchingBolRow(rows: GarlandCarrierManifestRow[], candidate: GarlandCarrierManifestRow) {
  return rows.find((row) => {
    if (row.carrier !== candidate.carrier) {
      return false;
    }

    if (row.psNumber && candidate.psNumber) {
      return row.psNumber === candidate.psNumber;
    }

    if (row.srNumber && candidate.srNumber) {
      return row.srNumber === candidate.srNumber;
    }

    return false;
  });
}

function combineConfidence(left: GarlandCarrierManifestRow["confidence"], right: GarlandCarrierManifestRow["confidence"]) {
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return rank[right] > rank[left] ? right : left;
}

function buildCarrierCounts(rows: GarlandCarrierManifestRow[]): Record<GarlandCarrierKey, number> {
  return {
    MIDLAND: rows.filter((row) => row.carrier === "MIDLAND").length,
    SPEEDY: rows.filter((row) => row.carrier === "SPEEDY").length,
    SURETRACK: rows.filter((row) => row.carrier === "SURETRACK").length
  };
}

function normalizeEditablePallets(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(trimmed.replace(/\D+/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCarrier(carrier: GarlandCarrierKey) {
  return carrier === "SURETRACK" ? "Suretrack" : carrier.charAt(0) + carrier.slice(1).toLowerCase();
}

function formatDate(value: string | null) {
  if (!value) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function sanitizeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
