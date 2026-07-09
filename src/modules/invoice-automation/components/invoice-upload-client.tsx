"use client";

import { useMemo, useState } from "react";
import type { InvoiceAutomationType } from "@prisma/client";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { getInvoiceApprovalBlockingIssues } from "@/modules/invoice-automation/approval";
import {
  buildInvoiceDraftFromText,
  defaultDueDateFromInvoiceDate,
  deriveInvoiceTotal,
  getBusinessLineFromInvoiceFileNumber,
  getDefaultProductOrAccount,
  getInvoiceDraftIssueCodes,
  getShipmentTypeFromInvoiceFileNumber,
  normalizeInvoiceAmountsForCurrency,
  splitInvoiceTextIntoDocuments
} from "@/modules/invoice-automation/extraction";
import {
  formatInvoiceEnum,
  formatInvoiceMoney,
  InvoiceStatusPill,
  InvoiceTypePill
} from "@/modules/invoice-automation/components";
import type {
  InvoiceAutomationEntityOption,
  InvoiceAutomationOcrInvoice,
  InvoiceAutomationOcrResult,
  InvoiceAutomationQuickBooksSyncSummary,
  InvoiceAutomationRow,
  InvoiceAutomationUploadDraft,
  InvoiceAutomationUploadResponse
} from "@/modules/invoice-automation/types";
import { QuickBooksEntitySearchSelect } from "@/modules/invoice-automation/components/quickbooks-entity-search-select";

type PdfJsModule = typeof import("pdfjs-dist");

const OCR_PAGE_LIMIT = 8;
const OCR_IMAGE_MAX_WIDTH = 1800;
const OCR_IMAGE_JPEG_QUALITY = 0.82;

let pdfJsLoader: Promise<PdfJsModule> | null = null;

export function InvoiceAutomationUploadClient({
  invoices,
  entityOptions,
  quickBooksSync
}: {
  invoices: InvoiceAutomationRow[];
  entityOptions: InvoiceAutomationEntityOption[];
  quickBooksSync: InvoiceAutomationQuickBooksSyncSummary;
}) {
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [modalType, setModalType] = useState<InvoiceAutomationType | null>(null);
  const [confirmSendSelectedOpen, setConfirmSendSelectedOpen] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [quickBooksSyncState, setQuickBooksSyncState] = useState(quickBooksSync);
  const [quickBooksSyncError, setQuickBooksSyncError] = useState<string | null>(null);
  const [isRefreshingQuickBooks, setIsRefreshingQuickBooks] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const operationsRows = invoices.filter((invoice) => invoice.status === "OPERATIONS_REVIEW");

  async function refreshQuickBooksNames() {
    setQuickBooksSyncError(null);
    setIsRefreshingQuickBooks(true);
    try {
      const response = await fetch("/api/finance/invoice-automation/quickbooks-entities/refresh", {
        method: "POST"
      });
      const json = (await response.json().catch(() => null)) as
        | { summary?: InvoiceAutomationQuickBooksSyncSummary; error?: string }
        | null;
      if (!response.ok || !json?.summary) {
        throw new Error(json?.error ?? "Unable to refresh QuickBooks customer/vendor names.");
      }
      setQuickBooksSyncState(json.summary);
      window.location.reload();
    } catch (error) {
      setQuickBooksSyncError(error instanceof Error ? error.message : "Unable to refresh QuickBooks customer/vendor names.");
    } finally {
      setIsRefreshingQuickBooks(false);
    }
  }

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

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">QuickBooks customer/vendor lookup</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              {quickBooksSyncState.connectionCount > 0
                ? `${quickBooksSyncState.customerCount.toLocaleString("en-US")} customers and ${quickBooksSyncState.vendorCount.toLocaleString("en-US")} vendors cached from QuickBooks.`
                : "No active QuickBooks connection was found for this tenant."}
            </p>
            <p className="mt-1 text-xs text-mutedForeground">
              Last refresh: {quickBooksSyncState.lastSyncedAt ? formatShortDateTime(quickBooksSyncState.lastSyncedAt) : "Not synced yet"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshQuickBooksNames()}
            disabled={isRefreshingQuickBooks}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRefreshingQuickBooks ? "Refreshing..." : "Refresh QuickBooks names"}
          </button>
        </div>
        {quickBooksSyncError ? (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {quickBooksSyncError}
          </div>
        ) : null}
        {quickBooksSyncState.warnings.length > 0 ? (
          <div className="mt-3 space-y-2 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {quickBooksSyncState.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
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
            onClick={() => setConfirmSendSelectedOpen(true)}
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

      {confirmSendSelectedOpen ? (
        <ConfirmSendToAccountingDialog
          invoiceCount={selectedInvoiceIds.length}
          onCancel={() => setConfirmSendSelectedOpen(false)}
          onConfirm={() => {
            setConfirmSendSelectedOpen(false);
            void sendSelectedToAccounting();
          }}
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
            <th className="px-3 py-3">Sent by</th>
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
              <td colSpan={onSelectionChange ? 18 : 17} className="px-3 py-8 text-center text-mutedForeground">
                No uploaded invoices yet.
              </td>
            </tr>
          ) : (
            invoices.map((invoice) => {
              const hasApprovalBlockers = getInvoiceApprovalBlockingIssues(invoice).length > 0;
              const selectable = (!selectableStatus || invoice.status === selectableStatus) && !hasApprovalBlockers;
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
                  <td className="px-3 py-3 text-mutedForeground">{invoice.sentToAccountingByName ?? "Not sent"}</td>
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
  const [confirmSendToAccountingOpen, setConfirmSendToAccountingOpen] = useState(false);
  const relevantEntities = useMemo(
    () => uniqueEntityOptionsById(entityOptions.filter((option) => option.entityType === invoiceType)),
    [entityOptions, invoiceType]
  );
  const title = invoiceType === "CUSTOMER" ? "Add customer invoices" : "Add vendor invoices";
  const hasApprovalBlockers = drafts.some((draft) => getInvoiceApprovalBlockingIssues({ ...draft, invoiceType }).length > 0);

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

        setStatus(`Reading PDF text from ${file.name}.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pdfBase64 = await bytesToBase64(bytes);
        const text = await extractPdfText(bytes);
        const textSegments = splitInvoiceTextIntoDocuments(text);
        const fileDrafts = textSegments.map((segmentText, segmentIndex) =>
          buildInvoiceDraftFromText({
            clientId: `${file.name}-${file.size}-${nextDrafts.length}-${segmentIndex}`,
            fileName: textSegments.length > 1 ? `${file.name} - invoice ${segmentIndex + 1}` : file.name,
            contentType: file.type || "application/pdf",
            sizeBytes: file.size,
            pdfBase64,
            text: segmentText,
            invoiceType,
            entityOptions
          })
        );

        if (fileDrafts.length === 1 && shouldRunVisionOcr(fileDrafts[0])) {
          setStatus(`Running OCR on ${file.name}.`);
          const images = await renderInvoicePageImages(bytes);
          const ocrResult = await runInvoiceVisionOcr(invoiceType, file.name, images);
          if (ocrResult.invoices.length === 0) {
            nextDrafts.push(fileDrafts[0]);
            continue;
          }
          nextDrafts.push(
            ...ocrResult.invoices.map((ocrInvoice, ocrIndex) =>
              mergeOcrInvoiceIntoDraft(
                {
                  ...fileDrafts[0],
                  clientId: `${file.name}-${file.size}-${nextDrafts.length}-ocr-${ocrIndex}`,
                  fileName: ocrResult.invoices.length > 1 ? `${file.name} - invoice ${ocrIndex + 1}` : file.name
                },
                ocrInvoice,
                invoiceType,
                entityOptions
              )
            )
          );
          continue;
        }

        nextDrafts.push(...fileDrafts);
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
          invoices: drafts.map((draft) => refreshDraftIssues(normalizeDraftAmounts(draft)))
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
        if (patch.invoiceDate !== undefined && !next.dueDate) {
          next.dueDate = defaultDueDateFromInvoiceDate(next.invoiceDate);
        }
        return refreshDraftIssues(normalizeDraftAmounts(next));
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
              Upload multiple PDFs. The app reads embedded PDF text first, uses OCR when needed, maps the QuickBooks customer/vendor where possible, and lets you review every invoice in one table.
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
                        <QuickBooksEntitySearchSelect
                          hasError={!draft.quickBooksEntityId}
                          invoiceType={invoiceType}
                          options={relevantEntities}
                          value={draft.quickBooksEntityId ?? ""}
                          onChange={(option) => {
                            updateDraft(draft.clientId, {
                              quickBooksEntityId: option?.id ?? null,
                              quickBooksEntityDisplayName: option?.displayName ?? null,
                              quickBooksMatchConfidence: option ? 100 : null,
                              entityNameRaw: option?.displayName ?? draft.entityNameRaw ?? null
                            });
                          }}
                        />
                        {draft.quickBooksMatchConfidence ? <div className="mt-1 text-xs text-mutedForeground">{draft.quickBooksMatchConfidence}% confidence</div> : null}
                      </td>
                      <td className="px-3 py-3"><SmallInput value={draft.invoiceNumber ?? ""} onChange={(value) => updateDraft(draft.clientId, { invoiceNumber: value || null })} /></td>
                      <td className="px-3 py-3"><DateInput value={draft.invoiceDate ?? ""} onChange={(value) => updateDraft(draft.clientId, { invoiceDate: value || null })} /></td>
                      <td className="px-3 py-3"><DateInput value={draft.dueDate ?? ""} onChange={(value) => updateDraft(draft.clientId, { dueDate: value || null })} /></td>
                      <td className="px-3 py-3"><SmallInput value={draft.currency ?? ""} onChange={(value) => updateDraft(draft.clientId, { currency: value.toUpperCase() || null })} /></td>
                      <td className="px-3 py-3"><MoneyInput value={draft.subtotalAmount} onChange={(value) => updateDraft(draft.clientId, { subtotalAmount: value })} /></td>
                      <td className="px-3 py-3"><MoneyInput value={draft.taxAmount} onChange={(value) => updateDraft(draft.clientId, { taxAmount: value })} /></td>
                      <td className="px-3 py-3 text-right font-semibold text-foreground">{formatInvoiceMoney(deriveInvoiceTotal(draft.subtotalAmount, draft.taxAmount, draft.totalAmount), draft.currency)}</td>
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
              onClick={() => setConfirmSendToAccountingOpen(true)}
              disabled={drafts.length === 0 || hasApprovalBlockers || isSaving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Approve and send accounting"}
            </button>
          </div>
        </div>
      </div>
      {confirmSendToAccountingOpen ? (
        <ConfirmSendToAccountingDialog
          invoiceCount={drafts.length}
          onCancel={() => setConfirmSendToAccountingOpen(false)}
          onConfirm={() => {
            setConfirmSendToAccountingOpen(false);
            void saveDrafts(true);
          }}
        />
      ) : null}
    </div>
  );
}

function ConfirmSendToAccountingDialog({
  invoiceCount,
  onCancel,
  onConfirm
}: {
  invoiceCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl">
        <h2 className="text-base font-semibold text-foreground">Confirm invoice details</h2>
        <p className="mt-2 text-sm leading-6 text-mutedForeground">
          Confirm that the file number, customer/vendor, QuickBooks match, invoice number, dates, currency, tax, and totals are correct before sending {invoiceCount} invoice{invoiceCount === 1 ? "" : "s"} to accounting.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
          >
            Go back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover"
          >
            Confirm and send
          </button>
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

function formatShortDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function refreshDraftIssues(draft: InvoiceAutomationUploadDraft): InvoiceAutomationUploadDraft {
  return {
    ...draft,
    issueCodes: getInvoiceDraftIssueCodes(draft)
  };
}

function normalizeDraftAmounts(draft: InvoiceAutomationUploadDraft): InvoiceAutomationUploadDraft {
  return {
    ...draft,
    ...normalizeInvoiceAmountsForCurrency({
      currency: draft.currency,
      subtotalAmount: draft.subtotalAmount,
      taxAmount: draft.taxAmount,
      totalAmount: draft.totalAmount
    })
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
  const loadingTask = pdfjs.getDocument({
    data: cloneBytes(bytes),
    cMapPacked: true,
    cMapUrl: "/pdfjs/cmaps/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/"
  });
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

async function renderInvoicePageImages(bytes: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: cloneBytes(bytes),
    cMapPacked: true,
    cMapUrl: "/pdfjs/cmaps/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/"
  });
  const pdf = await loadingTask.promise;
  const images: Array<{ pageNumber: number; imageDataUrl: string }> = [];
  const pageCount = Math.min(pdf.numPages, OCR_PAGE_LIMIT);

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    images.push({
      pageNumber,
      imageDataUrl: await renderPageImage(page)
    });
  }

  return images;
}

async function renderPageImage(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 2.4 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Browser canvas rendering is not available for invoice OCR.");
  }

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  const scale = Math.min(1, OCR_IMAGE_MAX_WIDTH / canvas.width);
  if (scale >= 1) {
    return canvas.toDataURL("image/jpeg", OCR_IMAGE_JPEG_QUALITY);
  }

  const resizedCanvas = document.createElement("canvas");
  const resizedContext = resizedCanvas.getContext("2d");

  if (!resizedContext) {
    throw new Error("Browser canvas resizing is not available for invoice OCR.");
  }

  resizedCanvas.width = Math.max(1, Math.floor(canvas.width * scale));
  resizedCanvas.height = Math.max(1, Math.floor(canvas.height * scale));
  resizedContext.fillStyle = "#ffffff";
  resizedContext.fillRect(0, 0, resizedCanvas.width, resizedCanvas.height);
  resizedContext.drawImage(canvas, 0, 0, resizedCanvas.width, resizedCanvas.height);

  return resizedCanvas.toDataURL("image/jpeg", OCR_IMAGE_JPEG_QUALITY);
}

async function runInvoiceVisionOcr(
  invoiceType: InvoiceAutomationType,
  fileName: string,
  images: Array<{ pageNumber: number; imageDataUrl: string }>
): Promise<InvoiceAutomationOcrResult> {
  const response = await fetch("/api/finance/invoice-automation/ocr", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      invoiceType,
      fileName,
      images
    })
  });
  const json = (await response.json().catch(() => null)) as InvoiceAutomationOcrResult | { error?: string } | null;

  if (!response.ok || !json) {
    throw new Error("Unable to run invoice OCR.");
  }

  if (isErrorResponse(json)) {
    throw new Error(json.error ?? "Unable to run invoice OCR.");
  }

  return json;
}

function isErrorResponse(value: InvoiceAutomationOcrResult | { error?: string }): value is { error?: string } {
  return "error" in value;
}

function shouldRunVisionOcr(draft: InvoiceAutomationUploadDraft) {
  const blockingIssues = new Set([
    "NO_EXTRACTABLE_TEXT",
    "MISSING_FILE_NUMBER",
    "MISSING_INVOICE_NUMBER",
    "MISSING_INVOICE_DATE",
    "MISSING_CUSTOMER_OR_VENDOR",
    "MISSING_QB_MATCH",
    "MISSING_TOTAL",
    "MISSING_CURRENCY"
  ]);

  return draft.extractedText.length < 80 || draft.issueCodes.some((issue) => blockingIssues.has(issue));
}

function mergeOcrInvoiceIntoDraft(
  draft: InvoiceAutomationUploadDraft,
  ocr: InvoiceAutomationOcrInvoice,
  invoiceType: InvoiceAutomationType,
  entityOptions: InvoiceAutomationEntityOption[]
): InvoiceAutomationUploadDraft {
  const extractedText = [draft.extractedText, ocr.extractedText, ocr.notes ? `OCR notes: ${ocr.notes}` : ""]
    .filter((value) => value.trim().length > 0)
    .join("\n");
  const shipmentFileNumber = draft.shipmentFileNumber ?? ocr.shipmentFileNumber;
  const matchedEntity = ocr.entityName
    ? findBestEntityForOcrName(ocr.entityName, invoiceType, entityOptions, ocr.currency)
    : null;
  const quickBooksEntityId = draft.quickBooksEntityId ?? matchedEntity?.id ?? null;
  const quickBooksEntityDisplayName = draft.quickBooksEntityDisplayName ?? matchedEntity?.displayName ?? null;
  const quickBooksMatchConfidence = draft.quickBooksMatchConfidence ?? (matchedEntity ? 92 : null);
  const invoiceDate = draft.invoiceDate ?? ocr.invoiceDate;
  const dueDate = draft.dueDate ?? ocr.dueDate ?? defaultDueDateFromInvoiceDate(invoiceDate);
  const next: InvoiceAutomationUploadDraft = {
    ...draft,
    extractedText,
    shipmentFileNumber,
    shipmentType: getShipmentTypeFromInvoiceFileNumber(shipmentFileNumber),
    businessLine: getBusinessLineFromInvoiceFileNumber(shipmentFileNumber),
    entityNameRaw: matchedEntity?.displayName ?? draft.entityNameRaw ?? ocr.entityName,
    quickBooksEntityId,
    quickBooksEntityDisplayName,
    quickBooksMatchConfidence,
    invoiceNumber: draft.invoiceNumber ?? ocr.invoiceNumber,
    invoiceDate,
    dueDate,
    currency: draft.currency ?? ocr.currency,
    subtotalAmount: draft.subtotalAmount ?? ocr.subtotalAmount,
    taxAmount: draft.taxAmount ?? ocr.taxAmount,
    totalAmount: draft.totalAmount ?? ocr.totalAmount,
    productOrAccountName: draft.productOrAccountName ?? getDefaultProductOrAccount(invoiceType, shipmentFileNumber)
  };

  return refreshDraftIssues(normalizeDraftAmounts(next));
}

function findBestEntityForOcrName(
  entityName: string,
  invoiceType: InvoiceAutomationType,
  entityOptions: InvoiceAutomationEntityOption[],
  currency: string | null
) {
  const normalizedOcrName = normalizeEntityForClientMatch(entityName);
  const candidates = entityOptions.filter((option) => option.entityType === invoiceType);
  let best: { option: InvoiceAutomationEntityOption; score: number } | null = null;

  for (const option of candidates) {
    const normalizedOption = option.normalizedName || normalizeEntityForClientMatch(option.displayName);
    let score = 0;

    if (normalizedOption === normalizedOcrName) {
      score = 100;
    } else if (normalizedOption.includes(normalizedOcrName) || normalizedOcrName.includes(normalizedOption)) {
      score = 88;
    } else {
      const parts = normalizedOcrName.split(" ").filter((part) => part.length > 2);
      const matchedParts = parts.filter((part) => normalizedOption.includes(part)).length;
      score = parts.length > 0 ? Math.round((matchedParts / parts.length) * 70) : 0;
    }

    if (currency && option.currency === currency) {
      score += 8;
    }

    if (score > (best?.score ?? 0)) {
      best = { option, score };
    }
  }

  return best && best.score >= 90 ? best.option : null;
}

function normalizeEntityForClientMatch(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b(usd|cad|cdn)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueEntityOptionsById(options: InvoiceAutomationEntityOption[]) {
  return [...new Map(options.map((option) => [option.id, option])).values()];
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return Promise.resolve(btoa(binary));
}

function cloneBytes(bytes: Uint8Array) {
  const clone = new Uint8Array(bytes.byteLength);
  clone.set(bytes);
  return clone;
}
