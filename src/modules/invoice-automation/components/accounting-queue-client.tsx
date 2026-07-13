"use client";

import { useMemo, useState } from "react";
import type { InvoiceAutomationType } from "@prisma/client";
import { getInvoiceApprovalBlockingIssues } from "@/modules/invoice-automation/approval";
import { QuickBooksEntitySearchSelect } from "@/modules/invoice-automation/components/quickbooks-entity-search-select";
import {
  defaultDueDateFromInvoiceDate,
  deriveInvoiceTotal,
  getBusinessLineFromInvoiceFileNumber,
  getDefaultProductOrAccount,
  getInvoiceDraftIssueCodes,
  getShipmentTypeFromInvoiceFileNumber,
  normalizeInvoiceAmountsForCurrency
} from "@/modules/invoice-automation/extraction";
import {
  CurrencySelect,
  formatInvoiceMoney,
  formatInvoiceEnum,
  InvoiceStatusPill,
  InvoiceTypePill
} from "@/modules/invoice-automation/components";
import type { InvoiceAutomationEntityOption, InvoiceAutomationRow, InvoiceAutomationUploadDraft } from "@/modules/invoice-automation/types";
import {
  InvoiceAutomationTableControls,
  InvoiceAutomationTablePagination,
  type InvoiceAutomationTablePageSize
} from "@/modules/invoice-automation/components/table-controls";

type EditableAccountingRow = InvoiceAutomationRow & {
  businessLine?: InvoiceAutomationUploadDraft["businessLine"];
};

type QuickBooksPostingResult = {
  invoiceId: string;
  invoiceType: InvoiceAutomationType;
  invoiceNumber: string | null;
  shipmentFileNumber: string | null;
  realmId?: string;
  payload?: unknown;
  quickBooksTxnId?: string;
  quickBooksTxnNumber?: string | null;
  retryAction?: string;
  quickBooksExchangeRate?: number | null;
  quickBooksHomeCurrency?: string | null;
  quickBooksSubtotalHomeAmount?: number | null;
  quickBooksTaxHomeAmount?: number | null;
  quickBooksTotalHomeAmount?: number | null;
  posted?: boolean;
  error?: string;
};

export function AccountingQueueClient({
  invoices,
  entityOptions
}: {
  invoices: InvoiceAutomationRow[];
  entityOptions: InvoiceAutomationEntityOption[];
}) {
  const [rows, setRows] = useState<EditableAccountingRow[]>(invoices);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [dirtyInvoiceIds, setDirtyInvoiceIds] = useState<string[]>([]);
  const [savingInvoiceId, setSavingInvoiceId] = useState<string | null>(null);
  const [isSavingSelectedEdits, setIsSavingSelectedEdits] = useState(false);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [downloadingReviewPacket, setDownloadingReviewPacket] = useState(false);
  const [quickBooksPostingMode, setQuickBooksPostingMode] = useState<"preview" | "post" | null>(null);
  const [quickBooksResults, setQuickBooksResults] = useState<QuickBooksPostingResult[]>([]);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [currencyFilter, setCurrencyFilter] = useState("ALL");
  const [pageSize, setPageSize] = useState<InvoiceAutomationTablePageSize>(25);
  const [page, setPage] = useState(1);
  const entityOptionsByType = useMemo(
    () => ({
      CUSTOMER: uniqueEntityOptionsById(entityOptions.filter((option) => option.entityType === "CUSTOMER")),
      VENDOR: uniqueEntityOptionsById(entityOptions.filter((option) => option.entityType === "VENDOR"))
    }),
    [entityOptions]
  );
  const statusOptions = useMemo(() => uniqueStrings(rows.map((invoice) => invoice.status)), [rows]);
  const currencyOptions = useMemo(() => uniqueStrings(rows.map((invoice) => invoice.currency)), [rows]);
  const filteredRows = useMemo(() => {
    const query = normalizeSearch(searchQuery);
    return rows.filter((invoice) => {
      if (statusFilter !== "ALL" && invoice.status !== statusFilter) return false;
      if (typeFilter !== "ALL" && invoice.invoiceType !== typeFilter) return false;
      if (currencyFilter !== "ALL" && invoice.currency !== currencyFilter) return false;
      return !query || getAccountingRowSearchText(invoice).includes(query);
    });
  }, [currencyFilter, rows, searchQuery, statusFilter, typeFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const eligibleInvoiceIds = useMemo(
    () =>
      rows
        .filter((invoice) =>
          (invoice.status === "ACCOUNTING_REVIEW" ||
            invoice.status === "APPROVED_FOR_POSTING" ||
            invoice.status === "POSTING_ERROR") &&
          getInvoiceApprovalBlockingIssues(invoice).length === 0
        )
        .map((invoice) => invoice.id),
    [rows]
  );
  const accountingReviewInvoiceIds = useMemo(
    () =>
      rows
        .filter((invoice) => invoice.status === "ACCOUNTING_REVIEW" && getInvoiceApprovalBlockingIssues(invoice).length === 0)
        .map((invoice) => invoice.id),
    [rows]
  );
  const approvedForPostingInvoiceIds = useMemo(
    () =>
      rows
        .filter(
          (invoice) =>
            (invoice.status === "APPROVED_FOR_POSTING" || invoice.status === "POSTING_ERROR") &&
            getInvoiceApprovalBlockingIssues(invoice).length === 0
        )
        .map((invoice) => invoice.id),
    [rows]
  );
  const selectedEligibleCount = selectedInvoiceIds.filter((id) => eligibleInvoiceIds.includes(id)).length;
  const selectedAccountingCount = selectedInvoiceIds.filter((id) => accountingReviewInvoiceIds.includes(id)).length;
  const selectedApprovedCount = selectedInvoiceIds.filter((id) => approvedForPostingInvoiceIds.includes(id)).length;
  const filteredEligibleInvoiceIds = filteredRows
    .filter((invoice) =>
      (invoice.status === "ACCOUNTING_REVIEW" ||
        invoice.status === "APPROVED_FOR_POSTING" ||
        invoice.status === "POSTING_ERROR") &&
      getInvoiceApprovalBlockingIssues(invoice).length === 0
    )
    .map((invoice) => invoice.id);
  const allFilteredEligibleSelected =
    filteredEligibleInvoiceIds.length > 0 &&
    filteredEligibleInvoiceIds.every((id) => selectedInvoiceIds.includes(id));

  function resetToFirstPage() {
    setPage(1);
  }

  function updateRow(invoiceId: string, patch: Partial<EditableAccountingRow>) {
    setDirtyInvoiceIds((current) => uniqueStrings([...current, invoiceId]));
    setRows((current) =>
      current.map((row) => {
        if (row.id !== invoiceId) return row;
        const next = { ...row, ...patch };
        if (patch.shipmentFileNumber !== undefined) {
          next.shipmentType = getShipmentTypeFromInvoiceFileNumber(next.shipmentFileNumber);
          next.businessLine = getBusinessLineFromInvoiceFileNumber(next.shipmentFileNumber);
          next.productOrAccountName = getDefaultProductOrAccount(next.invoiceType, next.shipmentFileNumber);
        }
        if (patch.invoiceDate !== undefined && !next.dueDate) {
          next.dueDate = defaultDueDateFromInvoiceDate(next.invoiceDate);
        }
        const normalizedAmounts = normalizeInvoiceAmountsForCurrency({
          currency: next.currency,
          subtotalAmount: next.subtotalAmount,
          taxAmount: next.taxAmount,
          totalAmount: next.totalAmount,
          preserveNonCadTax: true
        });
        next.subtotalAmount = normalizedAmounts.subtotalAmount;
        next.taxAmount = normalizedAmounts.taxAmount;
        next.totalAmount = normalizedAmounts.totalAmount;
        next.issueCodes = getInvoiceDraftIssueCodes({
          extractedText: "manual accounting edit",
          shipmentFileNumber: next.shipmentFileNumber,
          invoiceNumber: next.invoiceNumber,
          invoiceDate: next.invoiceDate,
          entityNameRaw: next.entityNameRaw,
          quickBooksEntityId: next.quickBooksEntityId,
          totalAmount: next.totalAmount,
          currency: next.currency,
          productOrAccountName: next.productOrAccountName
        });
        return next;
      })
    );
  }

  async function saveRow(invoice: EditableAccountingRow) {
    setSavingInvoiceId(invoice.id);
    setMessage(null);
    try {
      const savedInvoice = await persistInvoiceRow(invoice);
      setRows((current) => current.map((row) => (row.id === invoice.id ? savedInvoice : row)));
      setDirtyInvoiceIds((current) => current.filter((id) => id !== invoice.id));
      setMessage({ kind: "success", text: "Invoice saved. Review and select it when ready for posting approval." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to save invoice." });
    } finally {
      setSavingInvoiceId(null);
    }
  }

  async function persistInvoiceRow(invoice: EditableAccountingRow) {
    const response = await fetch(`/api/finance/invoice-automation/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shipmentFileNumber: invoice.shipmentFileNumber,
        entityNameRaw: invoice.entityNameRaw,
        quickBooksEntityId: invoice.quickBooksEntityId,
        quickBooksEntityDisplayName: invoice.quickBooksEntityDisplayName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        subtotalAmount: invoice.subtotalAmount,
        taxAmount: invoice.taxAmount,
        totalAmount: deriveInvoiceTotal(invoice.subtotalAmount, invoice.taxAmount, invoice.totalAmount),
        productOrAccountName: invoice.productOrAccountName,
        reviewNotes: invoice.reviewNotes
      })
    });
    const json = (await response.json().catch(() => null)) as { invoice?: InvoiceAutomationRow; error?: string } | null;
    if (!response.ok || !json?.invoice) {
      throw new Error(json?.error ?? "Unable to save invoice.");
    }
    return json.invoice;
  }

  async function saveSelectedDirtyRows(invoiceIds: string[]) {
    const dirtyRows = rows.filter((row) => invoiceIds.includes(row.id) && dirtyInvoiceIds.includes(row.id));
    if (dirtyRows.length === 0) {
      return;
    }

    setIsSavingSelectedEdits(true);
    setMessage({ kind: "success", text: `Saving ${dirtyRows.length} edited invoice${dirtyRows.length === 1 ? "" : "s"} before continuing.` });
    try {
      const savedRows = await Promise.all(dirtyRows.map((row) => persistInvoiceRow(row)));
      setRows((current) =>
        current.map((row) => savedRows.find((savedRow) => savedRow.id === row.id) ?? row)
      );
      setDirtyInvoiceIds((current) => current.filter((id) => !savedRows.some((savedRow) => savedRow.id === id)));
    } finally {
      setIsSavingSelectedEdits(false);
    }
  }

  async function approveSelected() {
    const invoiceIdsToApprove = selectedInvoiceIds.filter((id) => accountingReviewInvoiceIds.includes(id));
    setApproving(true);
    setMessage(null);
    try {
      await saveSelectedDirtyRows(invoiceIdsToApprove);
      const response = await fetch("/api/finance/invoice-automation/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceIds: invoiceIdsToApprove })
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? "Unable to approve invoices for posting.");
      }
      setRows((current) =>
        current.map((row) =>
          invoiceIdsToApprove.includes(row.id) ? { ...row, status: "APPROVED_FOR_POSTING", issueCodes: [] } : row
        )
      );
      setSelectedInvoiceIds((current) => current.filter((id) => !invoiceIdsToApprove.includes(id)));
      setMessage({ kind: "success", text: `${invoiceIdsToApprove.length} invoice${invoiceIdsToApprove.length === 1 ? "" : "s"} approved for posting.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to approve invoices for posting." });
    } finally {
      setApproving(false);
    }
  }

  async function downloadReviewPacket() {
    const invoiceIdsForPacket = selectedInvoiceIds.filter((id) => eligibleInvoiceIds.includes(id));
    setDownloadingReviewPacket(true);
    setMessage(null);
    try {
      await saveSelectedDirtyRows(invoiceIdsForPacket);
      const response = await fetch("/api/finance/invoice-automation/review-packet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceIds: invoiceIdsForPacket })
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? "Unable to create review PDF.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = readDownloadFileName(response.headers.get("content-disposition")) ?? "invoice-review-packet.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setMessage({ kind: "success", text: `Review PDF created for ${invoiceIdsForPacket.length} invoice${invoiceIdsForPacket.length === 1 ? "" : "s"}.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to create review PDF." });
    } finally {
      setDownloadingReviewPacket(false);
    }
  }

  async function runQuickBooksPosting(mode: "preview" | "post") {
    const invoiceIdsToPost = selectedInvoiceIds.filter((id) => approvedForPostingInvoiceIds.includes(id));
    let confirmText: string | null = null;
    setMessage(null);
    try {
      await saveSelectedDirtyRows(invoiceIdsToPost);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to save selected edits before QuickBooks posting." });
      return;
    }

    if (mode === "post") {
      confirmText = window.prompt(
        `This will create ${invoiceIdsToPost.length} transaction${invoiceIdsToPost.length === 1 ? "" : "s"} in QuickBooks. Type POST TO QUICKBOOKS to continue.`
      );
      if (confirmText !== "POST TO QUICKBOOKS") {
        setMessage({ kind: "error", text: "QuickBooks posting cancelled." });
        return;
      }
    }

    setQuickBooksPostingMode(mode);
    setQuickBooksResults([]);
    try {
      const response = await fetch("/api/finance/invoice-automation/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invoiceIds: invoiceIdsToPost,
          mode,
          confirmText
        })
      });
      const json = (await response.json().catch(() => null)) as {
        results?: QuickBooksPostingResult[];
        error?: string;
        errorCount?: number;
      } | null;
      if (!response.ok && !json?.results) {
        throw new Error(json?.error ?? "Unable to run QuickBooks posting.");
      }
      setQuickBooksResults(json?.results ?? []);
      const postedInvoiceIds = mode === "post" ? (json?.results ?? []).filter((result) => result.posted).map((result) => result.invoiceId) : [];
      if (postedInvoiceIds.length > 0) {
        setRows((current) => current.filter((row) => !postedInvoiceIds.includes(row.id)));
        setSelectedInvoiceIds((current) => current.filter((id) => !postedInvoiceIds.includes(id)));
        setDirtyInvoiceIds((current) => current.filter((id) => !postedInvoiceIds.includes(id)));
      }
      setMessage({
        kind: (json?.errorCount ?? 0) > 0 ? "error" : "success",
        text:
          mode === "preview"
            ? `QuickBooks preview built for ${json?.results?.length ?? 0} invoice${json?.results?.length === 1 ? "" : "s"}.`
            : `QuickBooks posting finished with ${json?.errorCount ?? 0} error${json?.errorCount === 1 ? "" : "s"}.`
      });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to run QuickBooks posting." });
    } finally {
      setQuickBooksPostingMode(null);
    }
  }

  async function deleteRow(invoice: EditableAccountingRow) {
    const label = invoice.invoiceNumber ?? invoice.shipmentFileNumber ?? invoice.fileName;
    if (!window.confirm(`Delete ${label} from the accounting queue?`)) {
      return;
    }

    setDeletingInvoiceId(invoice.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/finance/invoice-automation/invoices/${invoice.id}`, {
        method: "DELETE"
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? "Unable to delete invoice.");
      }
      setRows((current) => current.filter((row) => row.id !== invoice.id));
      setSelectedInvoiceIds((current) => current.filter((id) => id !== invoice.id));
      setMessage({ kind: "success", text: "Invoice deleted from the accounting queue." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to delete invoice." });
    } finally {
      setDeletingInvoiceId(null);
    }
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedInvoiceIds(uniqueStrings([...selectedInvoiceIds, ...filteredEligibleInvoiceIds]));
    } else {
      setSelectedInvoiceIds((current) => current.filter((id) => !filteredEligibleInvoiceIds.includes(id)));
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Invoices sent by operations</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Testing mode only: edit and review invoice details here. This screen does not post anything to QuickBooks.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void downloadReviewPacket()}
            disabled={selectedEligibleCount === 0 || downloadingReviewPacket || isSavingSelectedEdits}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloadingReviewPacket ? "Building PDF..." : isSavingSelectedEdits ? "Saving..." : `Download review PDF (${selectedEligibleCount})`}
          </button>
          <button
            type="button"
            onClick={() => void approveSelected()}
            disabled={selectedAccountingCount === 0 || approving || isSavingSelectedEdits}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {approving ? "Marking reviewed..." : isSavingSelectedEdits ? "Saving..." : `Mark selected reviewed (${selectedAccountingCount})`}
          </button>
          <button
            type="button"
            onClick={() => void runQuickBooksPosting("preview")}
            disabled={selectedApprovedCount === 0 || quickBooksPostingMode !== null || isSavingSelectedEdits}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {quickBooksPostingMode === "preview" ? "Building preview..." : isSavingSelectedEdits ? "Saving..." : `Preview QB payload (${selectedApprovedCount})`}
          </button>
          <button
            type="button"
            onClick={() => void runQuickBooksPosting("post")}
            disabled={selectedApprovedCount === 0 || quickBooksPostingMode !== null || isSavingSelectedEdits}
            className="rounded-md border border-danger/30 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {quickBooksPostingMode === "post" ? "Posting..." : isSavingSelectedEdits ? "Saving..." : `Post to QB test (${selectedApprovedCount})`}
          </button>
        </div>
      </div>
      {message ? (
        <div
          className={`m-4 rounded-md border px-4 py-3 text-sm ${
            message.kind === "error"
              ? "border-danger/30 bg-danger/10 text-danger"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          {message.text}
        </div>
      ) : null}
      {quickBooksResults.length > 0 ? (
        <div className="m-4 rounded-md border border-border bg-background p-4">
          <h3 className="text-sm font-semibold text-foreground">QuickBooks result preview</h3>
          <div className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground">
            <pre>{JSON.stringify(quickBooksResults, null, 2)}</pre>
          </div>
        </div>
      ) : null}
      <div className="space-y-3 p-4">
        <InvoiceAutomationTableControls
          searchQuery={searchQuery}
          onSearchQueryChange={(value) => {
            setSearchQuery(value);
            resetToFirstPage();
          }}
          statusFilter={statusFilter}
          statusOptions={statusOptions}
          onStatusFilterChange={(value) => {
            setStatusFilter(value);
            resetToFirstPage();
          }}
          typeFilter={typeFilter}
          onTypeFilterChange={(value) => {
            setTypeFilter(value);
            resetToFirstPage();
          }}
          currencyFilter={currencyFilter}
          currencyOptions={currencyOptions}
          onCurrencyFilterChange={(value) => {
            setCurrencyFilter(value);
            resetToFirstPage();
          }}
          pageSize={pageSize}
          onPageSizeChange={(value) => {
            setPageSize(value);
            resetToFirstPage();
          }}
          filteredCount={filteredRows.length}
          totalCount={rows.length}
        />
        <div className="overflow-x-auto">
        <table className="min-w-[2000px] divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            <tr>
              <th className="px-3 py-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allFilteredEligibleSelected}
                    disabled={filteredEligibleInvoiceIds.length === 0}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                  />
                  <span>Select all</span>
                </label>
              </th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Batch</th>
              <th className="px-3 py-3">Sent by</th>
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
              <th className="px-3 py-3">Notes</th>
              <th className="px-3 py-3">Item/account</th>
              <th className="px-3 py-3">Issues</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pageRows.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-mutedForeground" colSpan={20}>
                  {rows.length === 0 ? "No invoices are waiting in accounting." : "No invoices match the current search and filters."}
                </td>
              </tr>
            ) : (
              pageRows.map((invoice) => {
                const blockers = getInvoiceApprovalBlockingIssues(invoice);
                const selectable =
                  (invoice.status === "ACCOUNTING_REVIEW" ||
                    invoice.status === "APPROVED_FOR_POSTING" ||
                    invoice.status === "POSTING_ERROR") &&
                  blockers.length === 0;
                const relevantEntities = entityOptionsByType[invoice.invoiceType];
                return (
                  <tr key={invoice.id} className="align-top hover:bg-muted/30">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        disabled={!selectable}
                        checked={selectedInvoiceIds.includes(invoice.id)}
                        onChange={(event) => {
                          setSelectedInvoiceIds((current) =>
                            event.target.checked
                              ? [...current, invoice.id]
                              : current.filter((id) => id !== invoice.id)
                          );
                        }}
                      />
                    </td>
                    <td className="px-3 py-3"><InvoiceStatusPill value={invoice.status} /></td>
                    <td className="px-3 py-3"><InvoiceTypePill value={invoice.invoiceType} /></td>
                    <td className="px-3 py-3 text-mutedForeground">{invoice.batchNumber}</td>
                    <td className="px-3 py-3 text-mutedForeground">
                      <div>{invoice.sentToAccountingByName ?? "Unknown"}</div>
                      {invoice.sentToAccountingAt ? <div className="mt-1 text-xs">{formatShortDateTime(invoice.sentToAccountingAt)}</div> : null}
                    </td>
                    <td className="px-3 py-3">
                      <a href={`/api/finance/invoice-automation/invoices/${invoice.id}/pdf`} className="font-semibold text-primary hover:underline">
                        Download
                      </a>
                    </td>
                    <td className="px-3 py-3">
                      <SmallInput value={invoice.shipmentFileNumber ?? ""} onChange={(value) => updateRow(invoice.id, { shipmentFileNumber: value || null })} />
                    </td>
                    <td className="px-3 py-3">
                      <SmallInput value={invoice.entityNameRaw ?? ""} onChange={(value) => updateRow(invoice.id, { entityNameRaw: value || null })} />
                    </td>
                    <td className="px-3 py-3">
                      <QuickBooksEntitySearchSelect
                        hasError={!invoice.quickBooksEntityId}
                        invoiceType={invoice.invoiceType}
                        options={relevantEntities}
                        value={invoice.quickBooksEntityId ?? ""}
                        onChange={(option) =>
                          updateRow(invoice.id, {
                            quickBooksEntityId: option?.id ?? null,
                            quickBooksEntityDisplayName: option?.displayName ?? null,
                            quickBooksMatchConfidence: option ? 100 : null,
                            entityNameRaw: option?.displayName ?? invoice.entityNameRaw ?? null
                          })
                        }
                      />
                      {invoice.quickBooksMatchConfidence ? <div className="mt-1 text-xs text-mutedForeground">{invoice.quickBooksMatchConfidence}% confidence</div> : null}
                    </td>
                    <td className="px-3 py-3"><SmallInput value={invoice.invoiceNumber ?? ""} onChange={(value) => updateRow(invoice.id, { invoiceNumber: value || null })} /></td>
                    <td className="px-3 py-3"><DateInput value={invoice.invoiceDate ?? ""} onChange={(value) => updateRow(invoice.id, { invoiceDate: value || null })} /></td>
                    <td className="px-3 py-3"><DateInput value={invoice.dueDate ?? ""} onChange={(value) => updateRow(invoice.id, { dueDate: value || null })} /></td>
                    <td className="px-3 py-3">
                      <CurrencySelect
                        value={invoice.currency}
                        onChange={(value) => updateRow(invoice.id, { currency: value })}
                        className="w-24"
                      />
                    </td>
                    <td className="px-3 py-3"><MoneyInput value={invoice.subtotalAmount} onChange={(value) => updateRow(invoice.id, { subtotalAmount: value })} /></td>
                    <td className="px-3 py-3"><MoneyInput value={invoice.taxAmount} onChange={(value) => updateRow(invoice.id, { taxAmount: value })} /></td>
                    <td className="px-3 py-3 text-right font-semibold text-foreground">{formatInvoiceMoney(deriveInvoiceTotal(invoice.subtotalAmount, invoice.taxAmount, invoice.totalAmount), invoice.currency)}</td>
                    <td className="px-3 py-3"><NotesInput value={invoice.reviewNotes ?? ""} onChange={(value) => updateRow(invoice.id, { reviewNotes: value || null })} /></td>
                    <td className="px-3 py-3"><SmallInput value={invoice.productOrAccountName ?? ""} onChange={(value) => updateRow(invoice.id, { productOrAccountName: value || null })} /></td>
                    <td className="max-w-[280px] px-3 py-3 text-mutedForeground">
                      {blockers.length === 0 ? "Ready" : blockers.join(", ")}
                      {invoice.issueCodes.length > 0 ? (
                        <div className="mt-1 text-xs">{invoice.issueCodes.map(formatInvoiceEnum).join(", ")}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => void saveRow(invoice)}
                          disabled={savingInvoiceId === invoice.id || deletingInvoiceId === invoice.id || isSavingSelectedEdits}
                          className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingInvoiceId === invoice.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteRow(invoice)}
                          disabled={savingInvoiceId === invoice.id || deletingInvoiceId === invoice.id || isSavingSelectedEdits}
                          className="rounded-md border border-danger/30 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingInvoiceId === invoice.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
        <InvoiceAutomationTablePagination
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          filteredCount={filteredRows.length}
          totalCount={rows.length}
          onPageChange={setPage}
        />
      </div>
    </section>
  );
}

function uniqueEntityOptionsById(options: InvoiceAutomationEntityOption[]) {
  return [...new Map(options.map((option) => [option.id, option])).values()];
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function getAccountingRowSearchText(invoice: EditableAccountingRow) {
  return normalizeSearch(
    [
      invoice.status,
      invoice.invoiceType,
      invoice.batchNumber,
      invoice.sentToAccountingByName,
      invoice.fileName,
      invoice.shipmentFileNumber,
      invoice.entityNameRaw,
      invoice.quickBooksEntityDisplayName,
      invoice.invoiceNumber,
      invoice.invoiceDate,
      invoice.dueDate,
      invoice.currency,
      invoice.productOrAccountName,
      invoice.reviewNotes,
      invoice.issueCodes.join(" ")
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function SmallInput({
  value,
  onChange,
  className = "w-40"
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${className} rounded-md border border-input bg-background px-2 py-1.5`}
    />
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="w-36 rounded-md border border-input bg-background px-2 py-1.5" />;
}

function NotesInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={2}
      className="w-52 rounded-md border border-input bg-background px-2 py-1.5"
      placeholder="Optional notes"
    />
  );
}

function MoneyInput({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={value ?? ""}
      onChange={(event) => {
        const next = Number(event.target.value);
        onChange(event.target.value === "" || Number.isNaN(next) ? null : Math.max(0, next));
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

function readDownloadFileName(contentDisposition: string | null) {
  const match = contentDisposition?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? null;
}
