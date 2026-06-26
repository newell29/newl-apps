import { notFound } from "next/navigation";
import type React from "react";
import { CashflowFollowUpStatus, ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { addCashflowFollowUpAction } from "@/modules/customer-cashflow/actions";
import { CashflowTabs, DateValue, EmptyState, formatEnum, Money, Percent, TierPill } from "@/modules/customer-cashflow/components";
import { getCashflowCustomerDetail } from "@/modules/customer-cashflow/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function CashflowCustomerDetailPage({
  params
}: {
  params: Promise<{ customerId: string }>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.CUSTOMER_CASHFLOW);
  const { customerId } = await params;
  const detail = await getCashflowCustomerDetail(context, customerId);

  if (!detail) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer Cashflow"
        title={detail.customer.customerName}
        description="Customer-level profitability, AR aging, billing blockers, and cash conversion exposure."
      />
      <CashflowTabs />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Revenue" value={<Money value={detail.summary.revenue} />} />
        <SummaryCard label="Gross profit" value={<Money value={detail.summary.grossProfit} />} />
        <SummaryCard label="Margin" value={<Percent value={detail.summary.grossMarginPercent} />} />
        <SummaryCard label="Credit exposure" value={<Money value={detail.summary.totalExposure} />} />
        <SummaryCard label="Risk tier" value={<TierPill value={detail.summary.tier} />} />
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Canonical Identity</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Canonical customer</p>
            <p className="mt-2 font-semibold text-foreground">{detail.customer.customerName}</p>
            <p className="mt-1 text-sm text-mutedForeground">Finance label: {detail.customer.financeDisplayName}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">QuickBooks source labels</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.customer.sourceAliases.map((alias) => (
                <span key={`${alias.sourceSystem}-${alias.sourceCustomerName}-${alias.sourceCurrency ?? "base"}`} className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-mutedForeground">
                  {alias.sourceCustomerName}{alias.sourceCurrency ? ` (${alias.sourceCurrency})` : ""}
                </span>
              ))}
              {detail.customer.sourceAliases.length === 0 ? (
                <span className="text-sm text-mutedForeground">No source aliases imported yet.</span>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Cash Conversion Readout</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-mutedForeground">
          This account can be profitable and still consume cash when Newl pays freight at {formatEnum(detail.customer.vendorPaymentTrigger).toLowerCase()},
          bills the customer at {formatEnum(detail.customer.billingTrigger).toLowerCase()}, and then waits {detail.customer.customerTermsDays} days for collection.
          The exposure bridge below separates profitability from working-capital strain.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <BridgeItem label="Open AR" value={detail.summary.openAr} />
          <BridgeItem label="Unbilled revenue" value={detail.summary.unbilledRevenue} />
          <BridgeItem label="Costs not billed" value={detail.summary.vendorCostsNotBilled} />
          <BridgeItem label="Vendor paid/open" value={detail.summary.vendorPaidNotCollected} />
          <BridgeItem label="Credit limit" value={detail.summary.creditLimit} />
          <BridgeItem label="% used" value={detail.summary.percentCreditUsed} percent />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">AR Aging</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <BridgeItem label="Current" value={detail.arAging.current} />
            <BridgeItem label="1-30 days" value={detail.arAging.days1to30} />
            <BridgeItem label="31-60 days" value={detail.arAging.days31to60} />
            <BridgeItem label="61+ days" value={detail.arAging.days61plus} />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Recommended Action</h2>
          <p className="mt-2 text-lg font-semibold text-primary">{detail.recommendedAction}</p>
          <p className="mt-2 text-sm text-mutedForeground">
            Collections owner: {detail.customer.assignedCollectionsOwner ?? "Unassigned"} • Sales owner: {detail.customer.assignedSalesRep ?? "Unassigned"}
          </p>
          <p className="mt-2 text-sm text-mutedForeground">
            Alert at <Percent value={detail.customer.alertThresholdPercent} /> credit use; hard review {detail.customer.requiresApprovalOverLimit ? "is required" : "is not required"} over limit.
          </p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <DataPanel title="Open Invoices">
          {detail.openInvoices.map((invoice) => (
            <div key={invoice.id} className="grid gap-3 border-b border-border py-3 last:border-0 sm:grid-cols-[1fr_auto_auto]">
              <div>
                <p className="font-medium text-foreground">{invoice.invoiceNumber}</p>
                <p className="text-sm text-mutedForeground">{invoice.fileNumber ?? "No file"} • due <DateValue value={invoice.dueDate} /></p>
              </div>
              <span>{invoice.daysPastDue} days past due</span>
              <span className="font-semibold"><Money value={invoice.amountOpen} /></span>
            </div>
          ))}
          {detail.openInvoices.length === 0 ? <EmptyState title="No open invoices" body="Open AR will appear here after invoice import." /> : null}
        </DataPanel>

        <DataPanel title="Unbilled Files">
          {detail.unbilledFiles.map((file) => (
            <div key={file.id} className="grid gap-3 border-b border-border py-3 last:border-0 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="font-medium text-foreground">{file.fileNumber}</p>
                <p className="text-sm text-mutedForeground">{file.shipmentType} • delivered <DateValue value={file.deliveryDate} /></p>
              </div>
              <span className="font-semibold"><Money value={Number(file.estimatedRevenue)} /></span>
            </div>
          ))}
          {detail.unbilledFiles.length === 0 ? <EmptyState title="No unbilled files" body="Delivered or vendor-backed unbilled files appear here." /> : null}
        </DataPanel>
      </section>

      <DataPanel title="File Profitability">
        <div className="overflow-x-auto">
          <table className="min-w-[900px] divide-y divide-border text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr>
                {["File", "Type", "Revenue", "Vendor cost", "GP", "Margin", "Cash gap", "Status", "Action"].map((heading) => (
                  <th key={heading} className="px-3 py-2">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detail.fileProfitability.map((file) => (
                <tr key={file.id}>
                  <td className="px-3 py-2 font-medium">{file.fileNumber}</td>
                  <td className="px-3 py-2">{file.shipmentType}</td>
                  <td className="px-3 py-2"><Money value={file.customerRevenue} /></td>
                  <td className="px-3 py-2"><Money value={file.vendorCost} /></td>
                  <td className="px-3 py-2"><Money value={file.grossProfit} /></td>
                  <td className="px-3 py-2"><Percent value={file.grossMarginPercent} /></td>
                  <td className="px-3 py-2">{file.cashGapDays ?? "n/a"}</td>
                  <td className="px-3 py-2">{formatEnum(file.status)}</td>
                  <td className="px-3 py-2">{file.actionRequired}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataPanel>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <DataPanel title="Follow-Up History">
          {detail.followUps.map((followUp) => (
            <div key={followUp.id} className="border-b border-border py-3 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-medium text-foreground">{formatEnum(followUp.status)}</p>
                <p className="text-sm text-mutedForeground"><DateValue value={followUp.createdAt} /></p>
              </div>
              <p className="mt-1 text-sm text-mutedForeground">{followUp.note}</p>
            </div>
          ))}
          {detail.followUps.length === 0 ? <EmptyState title="No follow-up notes" body="Accounting notes will appear here." /> : null}
        </DataPanel>

        <form action={addCashflowFollowUpAction} className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <input type="hidden" name="customerId" value={detail.customer.id} />
          <h2 className="text-base font-semibold text-foreground">Add Follow-Up</h2>
          <div className="mt-4 space-y-3">
            <select name="status" defaultValue={CashflowFollowUpStatus.CONTACTED} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              {Object.values(CashflowFollowUpStatus).map((status) => <option key={status} value={status}>{formatEnum(status)}</option>)}
            </select>
            <input name="nextFollowUpDate" type="date" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <input name="promisedPaymentDate" type="date" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <input name="note" required placeholder="Note" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <button className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Save note
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <p className="text-sm font-medium text-mutedForeground">{label}</p>
      <div className="mt-3 text-2xl font-semibold text-primary">{value}</div>
    </div>
  );
}

function BridgeItem({ label, value, percent = false }: { label: string; value: number; percent?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 font-semibold text-foreground">{percent ? <Percent value={value} /> : <Money value={value} />}</p>
    </div>
  );
}

function DataPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
