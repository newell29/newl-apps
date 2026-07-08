/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import {
  AccountingInvoiceStatus,
  AccountingInvoiceType,
  CashflowBusinessLine,
  CashflowLegalEntity,
  ModuleKey,
  QuickBooksDirectoryEntityType
} from "@prisma/client";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import {
  approveInvoiceAction,
  createApprovedBatchAction,
  createManualQuickBooksDirectoryEntityAction,
  rejectInvoiceAction,
  removeInvoiceFromBatchAction,
  returnInvoiceToReviewAction,
  saveInvoiceReviewAction,
  saveMappingRuleAction,
  uploadInvoicePdfsAction
} from "@/modules/invoice-automation/actions";
import { directoryOptionsByType, getInvoiceAutomationWorkspace } from "@/modules/invoice-automation/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export default async function InvoiceAutomationPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
  const params = (await searchParams) ?? {};
  const workspace = await getInvoiceAutomationWorkspace(context, { q: value(params.q), status: value(params.status), issue: value(params.issue) });
  const directory = directoryOptionsByType(workspace.directory);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Finance" title="Invoice Automation" description="Upload, review, approve, batch, and monitor invoice-driven shipment profitability. QuickBooks posting is disabled until future PR 4." />
      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="Invoices" value={workspace.metrics.total} />
        <MetricCard label="Needs review" value={workspace.metrics.needsReview} />
        <MetricCard label="Approved" value={workspace.metrics.approved} />
        <MetricCard label="Ready placeholder" value={workspace.metrics.readyToPost} />
        <MetricCard label="Issues" value={workspace.metrics.issueCount} />
      </div>
      <nav className="flex flex-wrap gap-2 text-sm">
        {["Upload", "Staging Review", "Approved", "Batches", "Profitability", "Risk Queue", "Settings / Mappings", "Posted Placeholder"].map((tab) => (
          <a key={tab} href={`#${tab.toLowerCase().replaceAll(" ", "-").replaceAll("/", "")}`} className="rounded-full border border-border px-3 py-1 font-semibold text-muted-foreground hover:text-foreground">{tab}</a>
        ))}
      </nav>

      <section id="upload" className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Upload PDFs</h2>
        <p className="text-sm text-muted-foreground">One invoice per PDF. PDFs are retained in tenant-scoped Postgres Bytes storage for this MVP.</p>
        <form action={uploadInvoicePdfsAction} className="mt-4 grid gap-3 md:grid-cols-3">
          <select name="invoiceType" className="rounded-md border border-border bg-background px-3 py-2">
            <option value="CUSTOMER_INVOICE">Customer invoice</option>
            <option value="VENDOR_INVOICE">Vendor invoice</option>
          </select>
          <input name="files" type="file" multiple accept="application/pdf" className="rounded-md border border-border bg-background px-3 py-2 md:col-span-2" />
          <button className="rounded-md bg-primary px-4 py-2 font-semibold text-primaryForeground">Upload invoice PDFs</button>
        </form>
      </section>

      <section id="staging-review" className="space-y-3">
        <h2 className="text-lg font-semibold">Staging Review</h2>
        <SearchForm />
        <InvoiceTable invoices={workspace.invoices.filter((invoice) => invoice.status !== AccountingInvoiceStatus.APPROVED)} directory={directory} />
      </section>

      <section id="approved" className="space-y-3">
        <h2 className="text-lg font-semibold">Approved</h2>
        <form id="approved-batch-form" action={createApprovedBatchAction} />
        <InvoiceTable invoices={workspace.invoices.filter((invoice) => invoice.status === AccountingInvoiceStatus.APPROVED)} directory={directory} selectable batchFormId="approved-batch-form" />
        <button form="approved-batch-form" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">Create non-posting batch from selected</button>
      </section>

      <section id="batches" className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Batches</h2>
        <div className="mt-3 space-y-3">
          {workspace.batches.map((batch: any) => (
            <details key={batch.id} className="rounded-lg border border-border p-3" open={batch.invoices.length > 0}>
              <summary className="cursor-pointer text-sm font-semibold">
                {batch.batchNumber} · {batch.status} · {batch._count.invoices} invoices
                <button disabled className="ml-3 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">Post to QuickBooks — future PR 4</button>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground"><tr><th>Invoice</th><th>Type</th><th>Entity</th><th>File</th><th>Total</th><th>Action</th></tr></thead>
                  <tbody>
                    {batch.invoices.map((invoice: any) => (
                      <tr key={invoice.id} className="border-t border-border">
                        <td className="py-2 font-semibold">{invoice.invoiceNumber ?? "—"}</td>
                        <td>{invoice.invoiceType ?? "—"}</td>
                        <td>{invoice.qbEntityDisplayName ?? invoice.rawEntityName ?? "—"}</td>
                        <td>{invoice.shipmentFileNumber ?? "—"}</td>
                        <td>{invoice.currency ?? "CAD"} {String(invoice.total ?? "—")}</td>
                        <td>
                          <form action={removeInvoiceFromBatchAction}>
                            <input type="hidden" name="id" value={invoice.id} />
                            <button className="rounded-md border border-border px-2 py-1">Remove from local batch</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section id="profitability" className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Profitability</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-muted-foreground"><th>File</th><th>Revenue</th><th>Cost</th><th>GP</th><th>Margin</th><th>Counts</th><th>FX</th></tr></thead>
            <tbody>{workspace.profitability.map((row) => <tr key={row.shipmentFileNumber} className="border-t border-border"><td className="py-2 font-semibold">{row.shipmentFileNumber}</td><td>{money(row.revenue)}</td><td>{money(row.cost)}</td><td>{money(row.grossProfit)}</td><td>{row.grossMargin == null ? "Not final" : `${(row.grossMargin * 100).toFixed(1)}%`}</td><td>{row.customerInvoiceCount} C / {row.vendorInvoiceCount} V</td><td>{row.fxNeeded ? "FX_NEEDED" : row.currencies.join(", ")}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section id="risk-queue" className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Risk Queue</h2>
        <div className="mt-3 grid gap-2">{workspace.risks.map((risk, index) => <div key={`${risk.shipmentFileNumber}-${risk.code}-${index}`} className="rounded-md border border-border p-2 text-sm"><span className="font-semibold">{risk.code}</span> · {risk.shipmentFileNumber} · <span className="text-muted-foreground">{risk.detail}</span></div>)}</div>
      </section>

      <section id="settings--mappings" className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="text-lg font-semibold">Manual QuickBooks directory cache</h2>
          <p className="text-sm text-muted-foreground">Manual cached dropdown support only. This does not call QuickBooks or create/update anything in QuickBooks.</p>
          <form action={createManualQuickBooksDirectoryEntityAction} className="mt-3 grid gap-2 md:grid-cols-7">
            <input name="displayName" placeholder="Display name" className="rounded-md border border-border bg-background px-2 py-1" />
            <input name="quickBooksId" placeholder="QuickBooks ID" className="rounded-md border border-border bg-background px-2 py-1" />
            <SelectEnum name="entityType" values={Object.values(QuickBooksDirectoryEntityType)} />
            <SelectEnum name="legalEntity" values={Object.values(CashflowLegalEntity)} />
            <input name="currency" placeholder="CAD/USD" className="rounded-md border border-border bg-background px-2 py-1" />
            <label className="flex items-center gap-2 text-sm"><input name="active" type="checkbox" value="on" defaultChecked /> Active</label>
            <button className="rounded-md bg-primary px-3 py-1 text-primaryForeground">Save cached row</button>
          </form>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Settings / Mappings</h2>
          <form action={saveMappingRuleAction} className="mt-3 grid gap-2 md:grid-cols-6">
            <input name="servicePrefix" placeholder="TR / DR" className="rounded-md border border-border bg-background px-2 py-1" />
            <select name="invoiceType" className="rounded-md border border-border bg-background px-2 py-1"><option value="CUSTOMER_INVOICE">Customer</option><option value="VENDOR_INVOICE">Vendor</option></select>
            <SelectEnum name="businessLine" values={Object.values(CashflowBusinessLine)} />
            <input name="customerItemName" placeholder="Customer item" className="rounded-md border border-border bg-background px-2 py-1" />
            <input name="vendorAccountName" placeholder="Vendor account" className="rounded-md border border-border bg-background px-2 py-1" />
            <button className="rounded-md bg-primary px-3 py-1 text-primaryForeground">Save rule</button>
          </form>
          <ul className="mt-3 text-sm text-muted-foreground">{workspace.mappings.map((mapping) => <li key={mapping.id}>{mapping.servicePrefix} · {mapping.invoiceType ?? "Any"} · {mapping.businessLine} · {mapping.customerItemName ?? mapping.vendorAccountName ?? "manual"}</li>)}</ul>
        </div>
      </section>

      <section id="posted-placeholder" className="rounded-xl border border-dashed border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Posted placeholder</h2>
        <p className="text-sm text-muted-foreground">QuickBooks transaction creation, bill/invoice posting, payload builders, and PDF attachment APIs are intentionally out of scope and reserved for future PR 4.</p>
      </section>
    </div>
  );
}

function value(v: string | string[] | undefined) { return Array.isArray(v) ? v[0] : v; }
function money(v: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "CAD" }).format(v); }

function SearchForm() {
  return <form className="flex flex-wrap gap-2"><input name="q" placeholder="Search file, invoice, entity, QuickBooks name" className="min-w-80 rounded-md border border-border bg-background px-3 py-2 text-sm" /><select name="status" className="rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="">Any status</option>{Object.values(AccountingInvoiceStatus).map((status) => <option key={status} value={status}>{status}</option>)}</select><input name="issue" placeholder="Issue code" className="rounded-md border border-border bg-background px-3 py-2 text-sm" /><button className="rounded-md border border-border px-3 py-2 text-sm font-semibold">Filter</button></form>;
}

function SelectEnum({ name, values, value, formId }: { name: string; values: string[]; value?: string | null; formId?: string }) {
  return <select form={formId} name={name} defaultValue={value ?? ""} className="rounded-md border border-border bg-background px-2 py-1"><option value="">—</option>{values.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function TextInput({ name, value, type = "text", formId }: { name: string; value?: unknown; type?: string; formId: string }) {
  return <input form={formId} name={name} type={type} defaultValue={value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "")} className="w-full rounded-md border border-border bg-background px-2 py-1" />;
}

function InvoiceTable({ invoices, directory, selectable = false, batchFormId }: { invoices: any[]; directory: ReturnType<typeof directoryOptionsByType>; selectable?: boolean; batchFormId?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[1400px] text-left text-xs">
        <thead><tr className="text-muted-foreground"><th className="p-2">Invoice</th><th>Type</th><th>Entity</th><th>QB entity</th><th>File</th><th>Amounts</th><th>Items/accounts</th><th>Issues</th><th>Actions</th></tr></thead>
        <tbody>{invoices.map((invoice) => {
          const formId = `save-${invoice.id}`;
          const entityOptions = invoice.invoiceType === "VENDOR_INVOICE" ? directory.vendors : directory.customers;
          return (
            <tr key={invoice.id} className="border-t border-border align-top">
              <td className="p-2">{selectable && <input form={batchFormId} type="checkbox" name="invoiceIds" value={invoice.id} className="mr-2" />}<div className="font-semibold">{invoice.invoiceNumber ?? "Needs invoice #"}</div><Link className="text-primary" href={`/api/invoice-automation/documents/${invoice.documentId}`}>Download PDF</Link><div>{invoice.document?.fileName}</div></td>
              <td><form id={formId} action={saveInvoiceReviewAction}><input type="hidden" name="id" value={invoice.id} /></form><SelectEnum formId={formId} name="invoiceType" values={Object.values(AccountingInvoiceType)} value={invoice.invoiceType} /><SelectEnum formId={formId} name="legalEntity" values={Object.values(CashflowLegalEntity)} value={invoice.legalEntity} /></td>
              <td><TextInput formId={formId} name="rawEntityName" value={invoice.rawEntityName} /><TextInput formId={formId} name="invoiceNumber" value={invoice.invoiceNumber} /><TextInput formId={formId} name="invoiceDate" value={invoice.invoiceDate} type="date" /><TextInput formId={formId} name="dueDate" value={invoice.dueDate} type="date" /></td>
              <td><select form={formId} name="qbEntityId" defaultValue={invoice.qbEntityId ?? ""} className="w-48 rounded-md border border-border bg-background px-2 py-1"><option value="">Needs reviewer choice</option>{entityOptions.map((option: any) => <option key={option.id} value={option.quickBooksId}>{option.displayName} {option.currency ? `(${option.currency})` : ""}</option>)}</select></td>
              <td><TextInput formId={formId} name="shipmentFileNumber" value={invoice.shipmentFileNumber} /><TextInput formId={formId} name="serviceType" value={invoice.serviceType} /><SelectEnum formId={formId} name="businessLine" values={Object.values(CashflowBusinessLine)} value={invoice.businessLine} /></td>
              <td><TextInput formId={formId} name="currency" value={invoice.currency} /><TextInput formId={formId} name="subtotal" value={invoice.subtotal} /><TextInput formId={formId} name="tax" value={invoice.tax} /><TextInput formId={formId} name="total" value={invoice.total} /><label><input form={formId} name="taxApplicable" type="checkbox" defaultChecked={Boolean(invoice.taxApplicable)} /> tax?</label><TextInput formId={formId} name="exchangeRateToCad" value={invoice.exchangeRateToCad} /><TextInput formId={formId} name="fxOverrideReason" value={invoice.fxOverrideReason} /></td>
              <td><select form={formId} name="qbItemId" defaultValue={invoice.qbItemId ?? ""} className="w-48 rounded-md border border-border bg-background px-2 py-1"><option value="">Product/service</option>{directory.items.map((option: any) => <option key={option.id} value={option.quickBooksId}>{option.displayName}</option>)}</select><select form={formId} name="qbExpenseAccountId" defaultValue={invoice.qbExpenseAccountId ?? ""} className="mt-1 w-48 rounded-md border border-border bg-background px-2 py-1"><option value="">Expense account</option>{directory.accounts.map((option: any) => <option key={option.id} value={option.quickBooksId}>{option.displayName}</option>)}</select><TextInput formId={formId} name="reviewNotes" value={invoice.reviewNotes} /></td>
              <td>{Array.isArray(invoice.issues) ? invoice.issues.map((issue: string) => <span key={issue} className="mb-1 block rounded-full bg-warning/10 px-2 py-1 font-semibold text-warning">{issue}</span>) : null}</td>
              <td className="space-y-1"><button form={formId} className="block rounded-md border border-border px-2 py-1">Save</button><form action={approveInvoiceAction}><input type="hidden" name="id" value={invoice.id} /><button className="rounded-md bg-primary px-2 py-1 text-primaryForeground">Approve</button></form><form action={returnInvoiceToReviewAction}><input type="hidden" name="id" value={invoice.id} /><button className="rounded-md border border-border px-2 py-1">Return</button></form><form action={rejectInvoiceAction}><input type="hidden" name="id" value={invoice.id} /><button className="rounded-md border border-destructive px-2 py-1 text-destructive">Reject</button></form></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
