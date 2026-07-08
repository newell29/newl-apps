import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import {
  formatInvoiceEnum,
  formatInvoiceMoney,
  InvoiceAutomationTabs,
  InvoiceStatusPill,
  InvoiceTypePill
} from "@/modules/invoice-automation/components";
import { approveInvoiceAutomationForPostingAction } from "@/modules/invoice-automation/actions";
import { getInvoiceAutomationAccountingShell, type InvoiceAutomationFilters } from "@/modules/invoice-automation/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<InvoiceAutomationFilters>;

export default async function InvoiceAutomationAccountingPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
  const filters = await searchParams;
  const shell = await getInvoiceAutomationAccountingShell(context, filters);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Accounting queue"
        description="Reviewed customer and vendor invoices waiting for accounting approval and future QuickBooks posting."
      />
      <InvoiceAutomationTabs />

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Ready for review" value={shell.summary.accountingReview} />
        <SummaryCard label="Approved for posting" value={shell.summary.approvedForPosting} />
        <SummaryCard label="Posting errors" value={shell.summary.postingErrors} />
      </section>

      <form action={approveInvoiceAutomationForPostingAction} className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Invoices sent by operations</h2>
            <p className="mt-1 text-sm text-mutedForeground">Approve reviewed invoices here before the QuickBooks batch posting workflow is enabled.</p>
          </div>
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover">
            Approve selected for posting
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1500px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-3">Select</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Batch</th>
                <th className="px-3 py-3">PDF</th>
                <th className="px-3 py-3">File</th>
                <th className="px-3 py-3">Customer/Vendor</th>
                <th className="px-3 py-3">QB match</th>
                <th className="px-3 py-3">Invoice #</th>
                <th className="px-3 py-3">Dates</th>
                <th className="px-3 py-3 text-right">Subtotal</th>
                <th className="px-3 py-3 text-right">Tax</th>
                <th className="px-3 py-3 text-right">Total</th>
                <th className="px-3 py-3">Item/account</th>
                <th className="px-3 py-3">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shell.invoices.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-mutedForeground" colSpan={15}>No invoices are waiting in accounting.</td>
                </tr>
              ) : (
                shell.invoices.map((invoice) => (
                  <tr key={invoice.id} className="align-top hover:bg-muted/30">
                    <td className="px-3 py-3">
                      <input name="invoiceId" value={invoice.id} type="checkbox" disabled={invoice.status !== "ACCOUNTING_REVIEW"} />
                    </td>
                    <td className="px-3 py-3"><InvoiceStatusPill value={invoice.status} /></td>
                    <td className="px-3 py-3"><InvoiceTypePill value={invoice.invoiceType} /></td>
                    <td className="px-3 py-3 text-mutedForeground">{invoice.batchNumber}</td>
                    <td className="px-3 py-3">
                      <a href={`/api/finance/invoice-automation/invoices/${invoice.id}/pdf`} className="font-semibold text-primary hover:underline">Download</a>
                    </td>
                    <td className="px-3 py-3 font-medium text-foreground">{invoice.shipmentFileNumber ?? "Missing"}</td>
                    <td className="px-3 py-3">{invoice.entityNameRaw ?? "Missing"}</td>
                    <td className="px-3 py-3 text-mutedForeground">{invoice.quickBooksEntityDisplayName ?? "Needs match"}</td>
                    <td className="px-3 py-3">{invoice.invoiceNumber ?? "Missing"}</td>
                    <td className="px-3 py-3 text-mutedForeground">{invoice.invoiceDate ?? "No invoice date"} / {invoice.dueDate ?? "No due date"}</td>
                    <td className="px-3 py-3 text-right">{formatInvoiceMoney(invoice.subtotalAmount, invoice.currency)}</td>
                    <td className="px-3 py-3 text-right">{formatInvoiceMoney(invoice.taxAmount, invoice.currency)}</td>
                    <td className="px-3 py-3 text-right font-semibold">{formatInvoiceMoney(invoice.totalAmount, invoice.currency)}</td>
                    <td className="px-3 py-3">{invoice.productOrAccountName ?? "Missing"}</td>
                    <td className="max-w-[260px] px-3 py-3 text-mutedForeground">
                      {invoice.issueCodes.length === 0 ? "Ready" : invoice.issueCodes.map(formatInvoiceEnum).join(", ")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-mutedForeground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value.toLocaleString("en-US")}</p>
    </div>
  );
}

