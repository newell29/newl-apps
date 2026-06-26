import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { CashflowTabs, DateValue, EmptyState, formatEnum, Money, Percent, PriorityPill } from "@/modules/customer-cashflow/components";
import { getCashflowFileQueue } from "@/modules/customer-cashflow/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function CashflowFileQueuePage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.CUSTOMER_CASHFLOW);
  const rows = await getCashflowFileQueue(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="File Cash Status Work Queue"
        description="Accounting and operations files requiring billing, collections, margin, or mapping follow-up."
      />
      <CashflowTabs />

      <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="min-w-[1450px] divide-y divide-border text-sm">
          <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            <tr>
              {[
                "Priority",
                "Customer",
                "File",
                "Type",
                "Port arrival",
                "Delivery",
                "Vendor invoice",
                "Vendor cost",
                "Customer invoice",
                "Revenue",
                "GP",
                "Margin",
                "Cash gap",
                "Status",
                "Owner",
                "Action",
                "Notes"
              ].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3"><PriorityPill value={row.priority} /></td>
                <td className="px-4 py-3 font-medium text-foreground">{row.customerName}</td>
                <td className="px-4 py-3">{row.fileNumber}</td>
                <td className="px-4 py-3">{row.shipmentType}</td>
                <td className="px-4 py-3"><DateValue value={row.portArrivalDate} /></td>
                <td className="px-4 py-3"><DateValue value={row.deliveryDate} /></td>
                <td className="px-4 py-3"><DateValue value={row.vendorInvoiceDate} /></td>
                <td className="px-4 py-3"><Money value={row.vendorCost} /></td>
                <td className="px-4 py-3"><DateValue value={row.customerInvoiceDate} /></td>
                <td className="px-4 py-3"><Money value={row.customerRevenue} /></td>
                <td className="px-4 py-3"><Money value={row.grossProfit} /></td>
                <td className="px-4 py-3"><Percent value={row.grossMarginPercent} /></td>
                <td className="px-4 py-3">{row.cashGapDays ?? "n/a"}</td>
                <td className="px-4 py-3">{formatEnum(row.status)}</td>
                <td className="px-4 py-3">{row.owner ?? "Unassigned"}</td>
                <td className="px-4 py-3 font-medium">{row.actionRequired}</td>
                <td className="px-4 py-3 text-mutedForeground">{row.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No file work queued" body="Files will appear here when cash cycle rules require action." />
          </div>
        ) : null}
      </section>
    </div>
  );
}
