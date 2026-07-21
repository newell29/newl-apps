"use client";

import { useMemo, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import {
  deriveInvoiceTotal,
  normalizeInvoiceAmountsForCurrency
} from "@/modules/invoice-automation/extraction";
import { CurrencySelect, formatInvoiceEnum, formatInvoiceMoney } from "@/modules/invoice-automation/components";
import { buildVendorInvoiceReviewDraftsFromText } from "@/modules/vendor-invoice-review/extraction";
import {
  findDuplicateVendorInvoiceReviewDraft,
  refreshVendorInvoiceReviewDraftIssues
} from "@/modules/vendor-invoice-review/review";
import type {
  VendorInvoiceReviewDocumentUpload,
  VendorInvoiceReviewDraft,
  VendorInvoiceReviewKind,
  VendorInvoiceReviewPackageDetail,
  VendorInvoiceReviewPackageSummary,
  VendorInvoiceReviewUploadResponse
} from "@/modules/vendor-invoice-review/types";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsLoader: Promise<PdfJsModule> | null = null;

export function VendorInvoiceReviewClient({
  invoiceKind,
  initialPackages,
  uploadUrl
}: {
  invoiceKind: VendorInvoiceReviewKind;
  initialPackages: VendorInvoiceReviewPackageSummary[];
  uploadUrl: string;
}) {
  const [document, setDocument] = useState<VendorInvoiceReviewDocumentUpload | null>(null);
  const [drafts, setDrafts] = useState<VendorInvoiceReviewDraft[]>([]);
  const [savedPackages, setSavedPackages] = useState(initialPackages);
  const [selectedPackage, setSelectedPackage] = useState<VendorInvoiceReviewPackageDetail | VendorInvoiceReviewPackageSummary | null>(null);
  const [status, setStatus] = useState("Upload one PDF package to begin.");
  const [error, setError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpeningPackage, setIsOpeningPackage] = useState(false);
  const [savedResult, setSavedResult] = useState<VendorInvoiceReviewUploadResponse | null>(null);
  const duplicateInUpload = useMemo(() => findDuplicateVendorInvoiceReviewDraft(drafts), [drafts]);
  const hasUnconfirmedTmsFile = drafts.some((draft) => !draft.confirmedTmsFileNumber?.trim());

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError(`${file.name} is not a PDF.`);
      return;
    }

    setError(null);
    setSavedResult(null);
    setIsExtracting(true);
    setStatus(`Reading PDF text from ${file.name}.`);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfBase64 = await bytesToBase64(bytes);
      const extractedText = await extractPdfText(bytes);
      const documentClientId = `${file.name}-${file.size}-${file.lastModified}`;
      const uploadedDocument: VendorInvoiceReviewDocumentUpload = {
        clientDocumentId: documentClientId,
        invoiceKind,
        fileName: file.name,
        contentType: file.type || "application/pdf",
        sizeBytes: file.size,
        pdfBase64,
        extractedText
      };
      const reviewDrafts = buildVendorInvoiceReviewDraftsFromText({
        documentClientId,
        invoiceKind,
        fileName: file.name,
        contentType: file.type || "application/pdf",
        sizeBytes: file.size,
        pdfBase64,
        extractedText
      });

      setDocument(uploadedDocument);
      setDrafts(reviewDrafts);
      setStatus(`${reviewDrafts.length} invoice${reviewDrafts.length === 1 ? "" : "s"} detected. Confirm the TMS file number before saving.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to extract this PDF.");
      setStatus("Extraction stopped.");
    } finally {
      setIsExtracting(false);
    }
  }

  function updateDraft(clientId: string, patch: Partial<VendorInvoiceReviewDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.clientId === clientId ? refreshVendorInvoiceReviewDraftIssues({ ...draft, ...patch }) : draft))
    );
  }

  function removeDraft(clientId: string) {
    setDrafts((current) => current.filter((draft) => draft.clientId !== clientId));
    setStatus("Invoice row removed. The original uploaded PDF package will remain intact if saved.");
  }

  async function saveReview() {
    if (!document || drafts.length === 0) {
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const preparedDrafts = drafts.map((draft) => refreshVendorInvoiceReviewDraftIssues(normalizeDraftAmounts(draft)));
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: { ...document, invoiceKind }, invoices: preparedDrafts, invoiceKind, approveAndStamp: invoiceKind === "Vendor_Invoices" })
      });
      const json = (await response.json().catch(() => null)) as VendorInvoiceReviewUploadResponse | { error?: string } | null;
      if (!response.ok || !json || "error" in json) {
        throw new Error(json && "error" in json ? json.error ?? "Unable to save review." : "Unable to save review.");
      }
      const savedResponse = json as VendorInvoiceReviewUploadResponse;
      setSavedResult(savedResponse);
      setStatus(`${savedResponse.invoiceCount} reviewed invoice${savedResponse.invoiceCount === 1 ? "" : "s"} saved.`);
      setDocument(null);
      setDrafts([]);
      setSavedPackages((current) => [
        {
          id: savedResponse.documentId,
          invoiceKind: savedResponse.invoiceKind,
          fileName: document.fileName,
          createdAt: new Date().toISOString(),
          uploadedByUserId: null,
          uploadedByName: null,
          uploadedByEmail: null,
          approvedAt: invoiceKind === "Vendor_Invoices" ? new Date().toISOString() : null,
          approvedByName: null,
          financeStatus: savedResponse.financeStatus,
          financeError: savedResponse.financeError,
          financeBatchId: savedResponse.financeBatchId,
          invoiceCount: savedResponse.invoiceCount,
          status: "SAVED",
          invoices: savedResponse.invoices
        },
        ...current.filter((item) => item.id !== savedResponse.documentId)
      ]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save vendor invoice review.");
    } finally {
      setIsSaving(false);
    }
  }

  async function openSavedPackage(documentId: string) {
    setError(null);
    setIsOpeningPackage(true);
    try {
      const response = await fetch(`/api/operations/vendor-invoice-review/packages/${documentId}`);
      const json = (await response.json().catch(() => null)) as VendorInvoiceReviewPackageDetail | { error?: string } | null;
      if (!response.ok || !json || "error" in json) {
        throw new Error(json && "error" in json ? json.error ?? "Unable to open saved package." : "Unable to open saved package.");
      }
      setSelectedPackage(json as VendorInvoiceReviewPackageDetail);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to open saved package.");
    } finally {
      setIsOpeningPackage(false);
    }
  }

  async function retryFinanceHandoff(documentId: string) {
    setError(null);
    try {
      const response = await fetch(`/api/operations/vendor-invoice-review/packages/${documentId}/send-to-finance`, { method: "POST" });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok || json?.error) {
        throw new Error(json?.error ?? "Unable to retry Finance handoff.");
      }
      setSavedPackages((current) =>
        current.map((item) =>
          item.id === documentId ? { ...item, financeStatus: "SENT_TO_FINANCE", financeError: null } : item
        )
      );
      setStatus("Finance handoff retried successfully.");
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Unable to retry Finance handoff.");
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <label className="grid gap-2 text-sm font-semibold text-foreground">
            {invoiceKind === "Vendor_Invoices" ? "Vendor invoice PDF package" : "Customer invoice PDF"}
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => void handleFile(event.target.files?.[0])}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
            />
          </label>
          <div className="text-sm text-mutedForeground">{isExtracting ? "Extracting..." : status}</div>
        </div>
        {error ? <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div> : null}
        {duplicateInUpload ? (
          <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            Duplicate warning: invoice {duplicateInUpload.duplicate.invoiceNumber ?? "unknown"} appears more than once in this upload.
          </div>
        ) : null}
        {savedResult ? (
          <div className="mt-3 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            Saved {savedResult.invoiceCount} {invoiceKind === "Vendor_Invoices" ? "vendor" : "customer"} invoice
            {savedResult.invoiceCount === 1 ? "" : "s"}.
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1440px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-3">Action</th>
                <th className="px-3 py-3">Uploaded PDF</th>
                <th className="px-3 py-3">Vendor name</th>
                <th className="px-3 py-3">Invoice #</th>
                <th className="px-3 py-3">Invoice date</th>
                <th className="px-3 py-3">TMS file #</th>
                <th className="px-3 py-3">Reference</th>
                <th className="px-3 py-3">Currency</th>
                <th className="px-3 py-3">Subtotal</th>
                <th className="px-3 py-3">Tax</th>
                <th className="px-3 py-3">Total</th>
                <th className="px-3 py-3">Extraction issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {drafts.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-mutedForeground" colSpan={12}>
                    Upload a vendor invoice PDF package to preview detected invoices.
                  </td>
                </tr>
              ) : (
                drafts.map((draft) => (
                  <tr key={draft.clientId} className="align-top">
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => removeDraft(draft.clientId)}
                        className="rounded-md border border-danger/30 px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
                      >
                        Remove
                      </button>
                    </td>
                    <td className="max-w-[180px] px-3 py-3 font-medium text-foreground">{draft.fileName}</td>
                    <td className="px-3 py-3">
                      <SmallInput value={draft.vendorName ?? ""} onChange={(value) => updateDraft(draft.clientId, { vendorName: value || null })} />
                    </td>
                    <td className="px-3 py-3">
                      <SmallInput value={draft.invoiceNumber ?? ""} onChange={(value) => updateDraft(draft.clientId, { invoiceNumber: value || null })} />
                    </td>
                    <td className="px-3 py-3">
                      <DateInput value={draft.invoiceDate ?? ""} onChange={(value) => updateDraft(draft.clientId, { invoiceDate: value || null })} />
                    </td>
                    <td className="px-3 py-3">
                      <SmallInput
                        value={draft.confirmedTmsFileNumber ?? ""}
                        placeholder={draft.tmsFileNumber ? `Confirm ${draft.tmsFileNumber}` : "Required"}
                        hasError={!draft.confirmedTmsFileNumber?.trim()}
                        onChange={(value) => updateDraft(draft.clientId, { confirmedTmsFileNumber: value || null })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <SmallInput
                        value={draft.vendorReference ?? ""}
                        placeholder="AWB, BOL, PRO, container, ref"
                        onChange={(value) => updateDraft(draft.clientId, { vendorReference: value || null })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <CurrencySelect value={draft.currency} onChange={(value) => updateDraft(draft.clientId, { currency: value })} />
                    </td>
                    <td className="px-3 py-3">
                      <MoneyInput value={draft.subtotalAmount} onChange={(value) => updateDraft(draft.clientId, { subtotalAmount: value })} />
                    </td>
                    <td className="px-3 py-3">
                      <MoneyInput value={draft.taxAmount} onChange={(value) => updateDraft(draft.clientId, { taxAmount: value })} />
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-foreground">
                      {formatInvoiceMoney(deriveInvoiceTotal(draft.subtotalAmount, draft.taxAmount, draft.totalAmount), draft.currency)}
                    </td>
                    <td className="max-w-[260px] px-3 py-3 text-mutedForeground">
                      {draft.issueCodes.length === 0 ? "Ready" : draft.issueCodes.map(formatInvoiceEnum).join(", ")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void saveReview()}
            disabled={!document || drafts.length === 0 || hasUnconfirmedTmsFile || isSaving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : invoiceKind === "Vendor_Invoices" ? "Approve, stamp, and send to Finance" : "Save and send to Finance"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Saved packages</h2>
            <p className="text-sm text-mutedForeground">Previously saved Vendor Invoice Review packages stay separate from accounting and QuickBooks.</p>
          </div>
          {isOpeningPackage ? <div className="text-sm text-mutedForeground">Opening...</div> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-3">Action</th>
                <th className="px-3 py-3">Filename</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Saved date</th>
                <th className="px-3 py-3">Uploaded user</th>
                <th className="px-3 py-3">Invoice count</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Finance</th>
                <th className="px-3 py-3">Vendor</th>
                <th className="px-3 py-3">Invoice #</th>
                <th className="px-3 py-3">TMS file #</th>
                <th className="px-3 py-3">Reference</th>
                <th className="px-3 py-3">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {savedPackages.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-mutedForeground" colSpan={13}>
                    No Vendor Invoice Review packages have been saved yet.
                  </td>
                </tr>
              ) : (
                savedPackages.map((item) => {
                  const firstInvoice = item.invoices[0] ?? null;
                  return (
                    <tr key={item.id} className="align-top">
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void openSavedPackage(item.id)}
                            className="rounded-md border border-input px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            Open
                          </button>
                          <a
                            href={`/api/operations/vendor-invoice-review/packages/${item.id}/pdf`}
                            className="rounded-md border border-input px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            PDF
                          </a>
                        </div>
                      </td>
                      <td className="max-w-[220px] px-3 py-3 font-medium text-foreground">{item.fileName}</td>
                      <td className="px-3 py-3">{formatInvoiceKind(item.invoiceKind)}</td>
                      <td className="px-3 py-3 text-mutedForeground">{formatVendorInvoiceReviewDateTime(item.createdAt)}</td>
                      <td className="px-3 py-3 text-mutedForeground">{item.uploadedByName ?? item.uploadedByEmail ?? "Unknown"}</td>
                      <td className="px-3 py-3 text-right">{item.invoiceCount}</td>
                      <td className="px-3 py-3">{item.status}</td>
                      <td className="px-3 py-3">
                        <div className="space-y-1">
                          <div>{formatFinanceStatus(item.financeStatus, invoiceKind)}</div>
                          {item.financeError ? <div className="max-w-[220px] text-xs text-danger">{item.financeError}</div> : null}
                          {item.financeStatus === "FINANCE_HANDOFF_FAILED" ? (
                            <button
                              type="button"
                              onClick={() => void retryFinanceHandoff(item.id)}
                              className="rounded-md border border-warning/40 px-2 py-1 text-xs font-semibold text-warning hover:bg-warning/10"
                            >
                              Retry
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">{firstInvoice?.vendorName ?? ""}</td>
                      <td className="px-3 py-3">{firstInvoice?.invoiceNumber ?? ""}</td>
                      <td className="px-3 py-3">{firstInvoice?.tmsFileNumber ?? ""}</td>
                      <td className="px-3 py-3">{firstInvoice?.vendorReference ?? ""}</td>
                      <td className="px-3 py-3 text-right">{firstInvoice ? formatInvoiceMoney(firstInvoice.totalAmount, firstInvoice.currency) : ""}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedPackage ? (
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">{selectedPackage.fileName}</h2>
              <p className="text-sm text-mutedForeground">
                {selectedPackage.invoiceCount} stored invoice{selectedPackage.invoiceCount === 1 ? "" : "s"} from this original PDF package.
              </p>
            </div>
            <a
              href={`/api/operations/vendor-invoice-review/packages/${selectedPackage.id}/pdf`}
              className="rounded-md border border-input px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Download original PDF
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[960px] divide-y divide-border text-sm">
              <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                <tr>
                  <th className="px-3 py-3">Vendor</th>
                  <th className="px-3 py-3">Invoice #</th>
                  <th className="px-3 py-3">Invoice date</th>
                  <th className="px-3 py-3">TMS file #</th>
                  <th className="px-3 py-3">Reference</th>
                  <th className="px-3 py-3">Currency</th>
                  <th className="px-3 py-3">Subtotal</th>
                  <th className="px-3 py-3">Tax</th>
                  <th className="px-3 py-3">Total</th>
                  <th className="px-3 py-3">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {selectedPackage.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-3 py-3">{invoice.vendorName ?? ""}</td>
                    <td className="px-3 py-3">{invoice.invoiceNumber ?? ""}</td>
                    <td className="px-3 py-3">{invoice.invoiceDate ?? ""}</td>
                    <td className="px-3 py-3">{invoice.tmsFileNumber}</td>
                    <td className="px-3 py-3">{invoice.vendorReference ?? ""}</td>
                    <td className="px-3 py-3">{invoice.currency ?? ""}</td>
                    <td className="px-3 py-3 text-right">{formatInvoiceMoney(invoice.subtotalAmount, invoice.currency)}</td>
                    <td className="px-3 py-3 text-right">{formatInvoiceMoney(invoice.taxAmount, invoice.currency)}</td>
                    <td className="px-3 py-3 text-right font-semibold">{formatInvoiceMoney(invoice.totalAmount, invoice.currency)}</td>
                    <td className="max-w-[260px] px-3 py-3 text-mutedForeground">
                      {invoice.issueCodes.length === 0 ? "Ready" : invoice.issueCodes.map(formatInvoiceEnum).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function normalizeDraftAmounts(draft: VendorInvoiceReviewDraft): VendorInvoiceReviewDraft {
  const amounts = normalizeInvoiceAmountsForCurrency({
    currency: draft.currency,
    subtotalAmount: draft.subtotalAmount,
    taxAmount: draft.taxAmount,
    totalAmount: draft.totalAmount,
    preserveNonCadTax: true
  });
  return {
    ...draft,
    subtotalAmount: amounts.subtotalAmount,
    taxAmount: amounts.taxAmount,
    totalAmount: amounts.totalAmount
  };
}

async function extractPdfText(bytes: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: cloneBytes(bytes),
    cMapPacked: true,
    cMapUrl: "/pdfjs/cmaps/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/"
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push(await extractPageText(page));
  }
  return pages.join("\n\n").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

async function extractPageText(page: PDFPageProxy) {
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ")
    .trim();
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

export function formatVendorInvoiceReviewDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function formatInvoiceKind(value: VendorInvoiceReviewKind) {
  return value === "Customer_Invoices" ? "Customer invoice" : "Vendor invoice";
}

function formatFinanceStatus(value: string, invoiceKind: VendorInvoiceReviewKind) {
  if (value === "SENT_TO_FINANCE") return "Sent to Finance";
  if (value === "FINANCE_HANDOFF_FAILED") return "Finance handoff failed";
  if (value === "APPROVED") return "Approved";
  if (value === "SAVED") return invoiceKind === "Customer_Invoices" ? "Saved" : "Approved";
  return "Draft";
}

function cloneBytes(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

function bytesToBase64(bytes: Uint8Array) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read PDF bytes."));
    const pdfBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    reader.readAsDataURL(new Blob([pdfBytes], { type: "application/pdf" }));
  });
}

function SmallInput({
  value,
  onChange,
  placeholder,
  hasError
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hasError?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`w-40 rounded-md border bg-background px-2 py-1.5 ${hasError ? "border-danger" : "border-input"}`}
    />
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-36 rounded-md border border-input bg-background px-2 py-1.5"
    />
  );
}

function MoneyInput({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  return (
    <input
      type="number"
      step="0.01"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      className="w-28 rounded-md border border-input bg-background px-2 py-1.5 text-right"
    />
  );
}
