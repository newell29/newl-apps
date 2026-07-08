"use client";

import { useMemo, useState } from "react";
import type { InvoiceAutomationType } from "@prisma/client";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import {
  buildInvoiceDraftFromText,
  getBusinessLineFromInvoiceFileNumber,
  getDefaultProductOrAccount,
  getInvoiceDraftIssueCodes,
  getShipmentTypeFromInvoiceFileNumber
} from "@/modules/invoice-automation/extraction";
import {
  formatInvoiceEnum,
  formatInvoiceMoney,
  InvoiceStatusPill,
  InvoiceTypePill
} from "@/modules/invoice-automation/components";
import type {
  InvoiceAutomationEntityOption,
  InvoiceAutomationRow,
  InvoiceAutomationUploadDraft,
  InvoiceAutomationUploadResponse
} from "@/modules/invoice-automation/types";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsLoader: Promise<PdfJsModule> | null = null;

export function InvoiceAutomationUploadClient({
  invoices,
  entityOptions
}: {
  invoices: InvoiceAutomationRow[];
  entityOptions: InvoiceAutomationEntityOption[];
}) {
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [modalType, setModalType] = useState<InvoiceAutomationType | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const operationsRows = invoices.filter((invoice) => invoice.status === "OPERATIONS_REVIEW");

  async function sendSelectedToAccounting() {
    setQueueError(null);
    setIsSending(true);
    try {
      const response = await fetch("/api/finance/invoice-automation/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceIds: selectedInvoiceIds })
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? "Unable to send invoices to accounting.");
      }
      window.location.reload();
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : "Unable to send invoices to accounting.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Operations invoice intake</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Upload customer invoices sent to customers or vendor invoices received from carriers and vendors. Review the extracted fields, then send the invoices to accounting.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setModalType("CUSTOMER")}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover"
            >
              Add customer invoices
            </button>
            <button
              type="button"
              onClick={() => setModalType("VENDOR")}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Add vendor invoices
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Previously uploaded invoices</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              {operationsRows.length} invoice{operationsRows.length === 1 ? "" : "s"} waiting in operations review.
            </p>
          </div>
          <button
            type="button"
            onClick={sendSelectedToAccounting}
            disabled={selectedInvoiceIds.length === 0 || isSending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSending ? "Sending..." : `Send selected to accounting (${selectedInvoiceIds.length})`}
          </button>
        </div>
        {queueError ? (
          <div className="m-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {queueError}
          </div>
        ) : null}
        <InvoiceRowsTable
          invoices={invoices}
          selectedInvoiceIds={selectedInvoiceIds}
          onSelectionChange={setSelectedInvoiceIds}
          selectableStatus="OPERATIONS_REVIEW"
        />
      </section>

      {modalType ? (
        <InvoiceUploadModal
          invoiceType={modalType}
          entityOptions={entityOptions}
          onClose={() => setModalType(null)}
        />
      ) : null}
    </div>
  );
}

export function InvoiceRowsTable({
  invoices,
  selectedInvoiceIds,
  onSelectionChange,
  selectableStatus
}: {
  invoices: InvoiceAutomationRow[];
  selectedInvoiceIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  selectableStatus?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1500px] divide-y divide-border text-sm">
        <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          <tr>
            {onSelectionChange ? <th className="px-3 py-3">Select</th> : null}
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Type</th>
            <th className="px-3 py-3">Batch</th>
            <th className="px-3 py-3">PDF</th>
            <th className="px-3 py-3">File</th>
            <th className="px-3 py-3">Customer/Vendor</th>
            <th className="px-3 py-3">QB match</th>
            <th className="px-3 py-3">Invoice #</th>
            <th className="px-3 py-3">Invoice date</th>
            <th className="px-3 py-3">Due date</th>
            <th className="px-3 py-3">Currency</th>
            <th className="px-3 py-3 text-right">Subtotal</th>
            <th className="px-3 py-3 text-right">Tax</th>
            <th className="px-3 py-3 text-right">Total</th>
            <th className="px-3 py-3">Item/account</th>
            <th className="px-3 py-3">Issues</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invoices.length === 0 ? (
            <tr>
              <td colSpan={onSelectionChange ? 17 : 16} className="px-3 py-8 text-center text-mutedForeground">
                No uploaded invoices yet.
              </td>
            </tr>
          ) : (
            invoices.map((invoice) => {
              const selectable = !selectableStatus || invoice.status === selectableStatus;
              return (
                <tr key={invoice.id} className="align-top hover:bg-muted/30">
                  {onSelectionChange ? (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        disabled={!selectable}
                        checked={selectedInvoiceIds?.includes(invoice.id) ?? false}
                        onChange={(event) => {
                          const current = selectedInvoiceIds ?? [];
                          onSelectionChange(
                            event.target.checked
                              ? [...current, invoice.id]
                              : current.filter((id) => id !== invoice.id)
                          );
                        }}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-3"><InvoiceStatusPill value={invoice.status} /></td>
                  <td className="px-3 py-3"><InvoiceTypePill value={invoice.invoiceType} /></td>
                  <td className="px-3 py-3 text-mutedForeground">{invoice.batchNumber}</td>
                  <td className="px-3 py-3">
                    <a href={`/api/finance/invoice-automation/invoices/${invoice.id}/pdf`} className="font-semibold text-primary hover:underline">
                      Download
                    </a>
                  </td>
                  <td className="px-3 py-3 font-medium text-foreground">{invoice.shipmentFileNumber ?? "Missing"}</td>
                  <td className="px-3 py-3 text-foreground">{invoice.entityNameRaw ?? "Missing"}</td>
                  <td className="px-3 py-3 text-mutedForeground">{invoice.quickBooksEntityDisplayName ?? "Needs match"}</td>
                  <td className="px-3 py-3">{invoice.invoiceNumber ?? "Missing"}</td>
                  <td className="px-3 py-3">{invoice.invoiceDate ?? "Missing"}</td>
                  <td className="px-3 py-3">{invoice.dueDate ?? "Missing"}</td>
                  <td className="px-3 py-3">{invoice.currency ?? "Missing"}</td>
                  <td className="px-3 py-3 text-right">{formatInvoiceMoney(invoice.subtotalAmount, invoice.currency)}</td>
                  <td className="px-3 py-3 text-right">{formatInvoiceMoney(invoice.taxAmount, invoice.currency)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-foreground">{formatInvoiceMoney(invoice.totalAmount, invoice.currency)}</td>
                  <td className="px-3 py-3">{invoice.productOrAccountName ?? "Missing"}</td>
                  <td className="max-w-[260px] px-3 py-3 text-mutedForeground">
                    {invoice.issueCodes.length === 0 ? "Ready" : invoice.issueCodes.map(formatInvoiceEnum).join(", ")}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceUploadModal({
  invoiceType,
  entityOptions,
  onClose
}: {
  invoiceType: InvoiceAutomationType;
  entityOptions: InvoiceAutomationEntityOption[];
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<InvoiceAutomationUploadDraft[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Choose one or more PDF invoices.");
  const relevantEntities = useMemo(() => entityOptions.filter((option) => option.entityType === invoiceType), [entityOptions, invoiceType]);
  const title = invoiceType === "CUSTOMER" ? "Add customer invoices" : "Add vendor invoices";

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    setError(null);
    setIsExtracting(true);
    setStatus("Reading PDF text and matching invoices.");

    try {
      const nextDrafts: InvoiceAutomationUploadDraft[] = [];
      for (const file of Array.from(files)) {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          throw new Error(`${file.name} is not a PDF.`);
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const [text, pdfBase64] = await Promise.all([extractPdfText(bytes), bytesToBase64(bytes)]);
        nextDrafts.push(
          buildInvoiceDraftFromText({
            clientId: `${file.name}-${file.size}-${nextDrafts.length}`,
            fileName: file.name,
            contentType: file.type || "application/pdf",
            sizeBytes: file.size,
            pdfBase64,
            text,
            invoiceType,
            entityOptions
          })
        );
      }

      setDrafts(nextDrafts);
      setStatus(`${nextDrafts.length} invoice${nextDrafts.length === 1 ? "" : "s"} extracted. Review the table before saving.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to read these PDFs.");
      setStatus("Invoice extraction stopped.");
    } finally {
      setIsExtracting(false);
    }
  }

  async function saveDrafts(sendToAccounting: boolean) {
    if (drafts.length === 0) {
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch("/api/finance/invoice-automation/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invoiceType,
          sendToAccounting,
          invoices: drafts.map(refreshDraftIssues)
        })
      });
      const json = (await response.json().catch(() => null)) as InvoiceAutomationUploadResponse | { error?: string } | null;
      if (!response.ok || !json || "error" in json) {
        throw new Error((json && "error" in json ? json.error : null) ?? "Unable to save invoices.");
      }
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save invoices.");
    } finally {
      setIsSaving(false);
    }
  }

  function updateDraft(clientId: string, patch: Partial<InvoiceAutomationUploadDraft>) {
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.clientId !== clientId) return draft;
        const next = { ...draft, ...patch };
        if (patch.shipmentFileNumber !== undefined) {
          next.shipmentType = getShipmentTypeFromInvoiceFileNumber(next.shipmentFileNumber);
          next.businessLine = getBusinessLineFromInvoiceFileNumber(next.shipmentFileNumber);
          next.productOrAccountName = getDefaultProductOrAccount(invoiceType, next.shipmentFileNumber);
        }
        return refreshDraftIssues(next);
      })
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
      <div className="mx-auto max-w-7xl rounded-lg border border-border bg-background shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              Upload multiple PDFs. The app extracts text, maps the QuickBooks customer/vendor where possible, and lets you review every invoice in one table.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted">
            Close
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-[1fr_auto] md:items-center">
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Invoice PDFs
              <input
                type="file"
                multiple
                accept="application/pdf"
                onChange={(event) => void handleFiles(event.target.files)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
              />
            </label>
            <div className="text-sm text-mutedForeground">{isExtracting ? "Extracting..." : status}</div>
          </div>

          {error ? (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="min-w-[1600px] divide-y divide-border text-sm">
              <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                <tr>
                  <th className="px-3 py-3">PDF</th>
                  <th className="px-3 py-3">File #</th>
                  <th className="px-3 py-3">Customer/Vendor</th>
                  <th className="px-3 py-3">QB match</th>
                  <th className="px-3 py-3">Invoice #</th>
                  <th className="px-3 py-3">Invoice date</th>
                  <th className="px-3 py-3">Due date</th>
                  <th className="px-3 py-3">Currency</th>
                  <th className="px-3 py-3">Subtotal</th>
                  <th className="px-3 py-3">Tax</th>
                  <th className="px-3 py-3">Total</th>
                  <th className="px-3 py-3">Item/account</th>
                  <th className="px-3 py-3">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {drafts.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-mutedForeground" colSpan={13}>
                      Upload invoice PDFs to preview extracted rows.
                    </td>
                  </tr>
                ) : (
                  drafts.map((draft) => (
                    <tr key={draft.clientId} className="align-top">
                      <td className="max-w-[180px] px-3 py-3 font-medium text-foreground">{draft.fileName}</td>
                      <td className="px-3 py-3"><SmallInput value={draft.shipmentFileNumber ?? ""} onChange={(value) => updateDraft(draft.clientId, { shipmentFileNumber: value || null })} /></td>
                      <td className="px-3 py-3"><SmallInput value={draft.entityNameRaw ?? ""} onChange={(value) => updateDraft(draft.clientId, { entityNameRaw: value || null })} /></td>
                      <td className="px-3 py-3">
                        <select
                          value={draft.quickBooksEntityId ?? ""}
                          onChange={(event) => {
                            const option = relevantEntities.find((entity) => entity.id === event.target.value);
                            updateDraft(draft.clientId, {
                              quickBooksEntityId: option?.id ?? null,
                              quickBooksEntityDisplayName: option?.displayName ?? null,
                              quickBooksMatchConfidence: option ? 100 : null,
                              entityNameRaw: option?.displayName ?? draft.entityNameRaw
                            });
                          }}
                          className="w-52 rounded-md border border-input bg-background px-2 py-1.5"
                        >
                          <option value="">Needs match</option>
                          {relevantEntities.map((entity) => (
                            <option key={`${entity.entityType}-${entity.id}-${entity.displayName}`} value={entity.id}>
                              {entity.displayName}{entity.currency ? ` (${entity.currency})` : ""}
                            </option>
                          ))}
                        </select>
                        {draft.quickBooksMatchConfidence ? <div className="mt-1 text-xs text-mutedForeground">{draft.quickBooksMatchConfidence}% confidence</div> : null}
                      </td>
                      <td className="px-3 py-3"><SmallInput value={draft.invoiceNumber ?? ""} onChange={(value) => updateDraft(draft.clientId, { invoiceNumber: value || null })} /></td>
                      <td className="px-3 py-3"><DateInput value={draft.invoiceDate ?? ""} onChange={(value) => updateDraft(draft.clientId, { invoiceDate: value || null })} /></td>
                      <td className="px-3 py-3"><DateInput value={draft.dueDate ?? ""} onChange={(value) => updateDraft(draft.clientId, { dueDate: value || null })} /></td>
                      <td className="px-3 py-3"><SmallInput value={draft.currency ?? ""} onChange={(value) => updateDraft(draft.clientId, { currency: value.toUpperCase() || null })} /></td>
                      <td className="px-3 py-3"><MoneyInput value={draft.subtotalAmount} onChange={(value) => updateDraft(draft.clientId, { subtotalAmount: value })} /></td>
                      <td className="px-3 py-3"><MoneyInput value={draft.taxAmount} onChange={(value) => updateDraft(draft.clientId, { taxAmount: value })} /></td>
                      <td className="px-3 py-3"><MoneyInput value={draft.totalAmount} onChange={(value) => updateDraft(draft.clientId, { totalAmount: value })} /></td>
                      <td className="px-3 py-3"><SmallInput value={draft.productOrAccountName ?? ""} onChange={(value) => updateDraft(draft.clientId, { productOrAccountName: value || null })} /></td>
                      <td className="max-w-[260px] px-3 py-3 text-mutedForeground">
                        {draft.issueCodes.length === 0 ? "Ready" : draft.issueCodes.map(formatInvoiceEnum).join(", ")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveDrafts(false)}
              disabled={drafts.length === 0 || isSaving}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save to operations list"}
            </button>
            <button
              type="button"
              onClick={() => void saveDrafts(true)}
              disabled={drafts.length === 0 || isSaving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Approve and send accounting"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SmallInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} className="w-40 rounded-md border border-input bg-background px-2 py-1.5" />;
}

function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="w-36 rounded-md border border-input bg-background px-2 py-1.5" />;
}

function MoneyInput({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  return (
    <input
      type="number"
      step="0.01"
      value={value ?? ""}
      onChange={(event) => {
        const next = Number(event.target.value);
        onChange(event.target.value === "" || Number.isNaN(next) ? null : next);
      }}
      className="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-right"
    />
  );
}

function refreshDraftIssues(draft: InvoiceAutomationUploadDraft): InvoiceAutomationUploadDraft {
  return {
    ...draft,
    issueCodes: getInvoiceDraftIssueCodes(draft)
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

async function extractPdfText(bytes: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push(await extractPageText(page));
  }

  return pages.join("\n").replace(/\s+/g, " ").trim();
}

async function extractPageText(page: PDFPageProxy) {
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ")
    .trim();
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return Promise.resolve(btoa(binary));
}

