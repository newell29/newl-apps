"use client";

import { useMemo, useState } from "react";
import type { InvoiceAutomationType } from "@prisma/client";
import { getInvoiceApprovalBlockingIssues } from "@/modules/invoice-automation/approval";
import {
  defaultDueDateFromInvoiceDate,
  getBusinessLineFromInvoiceFileNumber,
  getDefaultProductOrAccount,
  getInvoiceDraftIssueCodes,
  getShipmentTypeFromInvoiceFileNumber
} from "@/modules/invoice-automation/extraction";
import {
  formatInvoiceEnum,
  InvoiceStatusPill,
  InvoiceTypePill
} from "@/modules/invoice-automation/components";
import type { InvoiceAutomationEntityOption, InvoiceAutomationRow, InvoiceAutomationUploadDraft } from "@/modules/invoice-automation/types";

type EditableAccountingRow = InvoiceAutomationRow & {
  businessLine?: InvoiceAutomationUploadDraft["businessLine"];
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
  const [savingInvoiceId, setSavingInvoiceId] = useState<string | null>(null);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const entityOptionsByType = useMemo(
    () => ({
      CUSTOMER: entityOptions.filter((option) => option.entityType === "CUSTOMER"),
      VENDOR: entityOptions.filter((option) => option.entityType === "VENDOR")
    }),
    [entityOptions]
  );

  const eligibleInvoiceIds = useMemo(
    () =>
      rows
        .filter((invoice) => invoice.status === "ACCOUNTING_REVIEW" && getInvoiceApprovalBlockingIssues(invoice).length === 0)
        .map((invoice) => invoice.id),
    [rows]
  );
  const selectedEligibleCount = selectedInvoiceIds.filter((id) => eligibleInvoiceIds.includes(id)).length;
  const allEligibleSelected = eligibleInvoiceIds.length > 0 && selectedEligibleCount === eligibleInvoiceIds.length;

  function updateRow(invoiceId: string, patch: Partial<EditableAccountingRow>) {
    setSelectedInvoiceIds((current) => current.filter((id) => id !== invoiceId));
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
          totalAmount: invoice.totalAmount,
          productOrAccountName: invoice.productOrAccountName
        })
      });
      const json = (await response.json().catch(() => null)) as { invoice?: InvoiceAutomationRow; error?: string } | null;
      if (!response.ok || !json?.invoice) {
        throw new Error(json?.error ?? "Unable to save invoice.");
      }
      setRows((current) => current.map((row) => (row.id === invoice.id ? json.invoice! : row)));
      setSelectedInvoiceIds((current) => current.filter((id) => id !== invoice.id));
      setMessage({ kind: "success", text: "Invoice saved. Review and select it when ready for posting approval." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to save invoice." });
    } finally {
      setSavingInvoiceId(null);
    }
  }

  async function approveSelected() {
    const invoiceIdsToApprove = selectedInvoiceIds.filter((id) => eligibleInvoiceIds.includes(id));
    setApproving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/finance/invoice-automation/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceIds: invoiceIdsToApprove })
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? "Unable to approve invoices for posting.");
      }
      window.location.reload();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to approve invoices for posting." });
    } finally {
      setApproving(false);
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
      setSelectedInvoiceIds(eligibleInvoiceIds);
    } else {
      setSelectedInvoiceIds([]);
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
        <button
          type="button"
          onClick={() => void approveSelected()}
          disabled={selectedEligibleCount === 0 || approving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {approving ? "Marking reviewed..." : `Mark selected reviewed (${selectedEligibleCount})`}
        </button>
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
      <div className="overflow-x-auto">
        <table className="min-w-[2000px] divide-y divide-border text-sm">
          <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            <tr>
              <th className="px-3 py-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allEligibleSelected}
                    disabled={eligibleInvoiceIds.length === 0}
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
              <th className="px-3 py-3">Item/account</th>
              <th className="px-3 py-3">Issues</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-mutedForeground" colSpan={19}>
                  No invoices are waiting in accounting.
                </td>
              </tr>
            ) : (
              rows.map((invoice) => {
                const blockers = getInvoiceApprovalBlockingIssues(invoice);
                const selectable = invoice.status === "ACCOUNTING_REVIEW" && blockers.length === 0;
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
                      <EntitySelect
                        invoiceType={invoice.invoiceType}
                        options={relevantEntities}
                        value={invoice.quickBooksEntityId ?? ""}
                        onChange={(option) =>
                          updateRow(invoice.id, {
                            quickBooksEntityId: option?.id ?? null,
                            quickBooksEntityDisplayName: option?.displayName ?? null,
                            quickBooksMatchConfidence: option ? 100 : null,
                            entityNameRaw: option?.displayName ?? invoice.entityNameRaw
                          })
                        }
                      />
                      {invoice.quickBooksMatchConfidence ? <div className="mt-1 text-xs text-mutedForeground">{invoice.quickBooksMatchConfidence}% confidence</div> : null}
                    </td>
                    <td className="px-3 py-3"><SmallInput value={invoice.invoiceNumber ?? ""} onChange={(value) => updateRow(invoice.id, { invoiceNumber: value || null })} /></td>
                    <td className="px-3 py-3"><DateInput value={invoice.invoiceDate ?? ""} onChange={(value) => updateRow(invoice.id, { invoiceDate: value || null })} /></td>
                    <td className="px-3 py-3"><DateInput value={invoice.dueDate ?? ""} onChange={(value) => updateRow(invoice.id, { dueDate: value || null })} /></td>
                    <td className="px-3 py-3"><SmallInput value={invoice.currency ?? ""} onChange={(value) => updateRow(invoice.id, { currency: value.toUpperCase() || null })} className="w-24" /></td>
                    <td className="px-3 py-3"><MoneyInput value={invoice.subtotalAmount} onChange={(value) => updateRow(invoice.id, { subtotalAmount: value })} /></td>
                    <td className="px-3 py-3"><MoneyInput value={invoice.taxAmount} onChange={(value) => updateRow(invoice.id, { taxAmount: value })} /></td>
                    <td className="px-3 py-3"><MoneyInput value={invoice.totalAmount} onChange={(value) => updateRow(invoice.id, { totalAmount: value })} /></td>
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
                          disabled={savingInvoiceId === invoice.id || deletingInvoiceId === invoice.id}
                          className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingInvoiceId === invoice.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteRow(invoice)}
                          disabled={savingInvoiceId === invoice.id || deletingInvoiceId === invoice.id}
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
    </section>
  );
}

function EntitySelect({
  invoiceType,
  options,
  value,
  onChange
}: {
  invoiceType: InvoiceAutomationType;
  options: InvoiceAutomationEntityOption[];
  value: string;
  onChange: (option: InvoiceAutomationEntityOption | null) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => {
        const option = options.find((entity) => entity.id === event.target.value);
        onChange(option ?? null);
      }}
      className="w-56 rounded-md border border-input bg-background px-2 py-1.5"
    >
      <option value="">{invoiceType === "CUSTOMER" ? "Match customer" : "Match vendor"}</option>
      {options.map((entity) => (
        <option key={`${entity.entityType}-${entity.id}-${entity.displayName}`} value={entity.id}>
          {entity.displayName}{entity.currency ? ` (${entity.currency})` : ""}
        </option>
      ))}
    </select>
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
