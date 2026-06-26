import { CashflowFollowUpStatus, ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { addCashflowFollowUpAction } from "@/modules/customer-cashflow/actions";
import { CashflowTabs, DateValue, EmptyState, formatEnum, Money, PriorityPill } from "@/modules/customer-cashflow/components";
import { getCashflowCollectionsQueue } from "@/modules/customer-cashflow/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function CashflowCollectionsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.CUSTOMER_CASHFLOW);
  const rows = await getCashflowCollectionsQueue(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Collections Queue"
        description="Prioritized customer invoices based on overdue dollars, credit exposure, vendor-paid risk, and active shipment exposure."
      />
      <CashflowTabs />

      <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="min-w-[1500px] divide-y divide-border text-sm">
          <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            <tr>
              {[
                "Priority",
                "Customer",
                "Invoice",
                "File",
                "Invoice date",
                "Due date",
                "Open",
                "Past due",
                "Exposure",
                "Credit limit",
                "Owner",
                "Last follow-up",
                "Next follow-up",
                "Status",
                "Notes"
              ].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3"><PriorityPill value={row.priority} /></td>
                <td className="px-4 py-3 font-medium text-foreground">{row.customerName}</td>
                <td className="px-4 py-3">{row.invoiceNumber}</td>
                <td className="px-4 py-3">{row.fileNumber ?? "n/a"}</td>
                <td className="px-4 py-3"><DateValue value={row.invoiceDate} /></td>
                <td className="px-4 py-3"><DateValue value={row.dueDate} /></td>
                <td className="px-4 py-3 font-semibold"><Money value={row.amountOpen} /></td>
                <td className="px-4 py-3">{row.daysPastDue}</td>
                <td className="px-4 py-3"><Money value={row.customerExposure} /></td>
                <td className="px-4 py-3"><Money value={row.creditLimit} /></td>
                <td className="px-4 py-3">{row.assignedOwner ?? "Unassigned"}</td>
                <td className="px-4 py-3"><DateValue value={row.lastFollowUpDate} /></td>
                <td className="px-4 py-3"><DateValue value={row.nextFollowUpDate} /></td>
                <td className="px-4 py-3">{row.followUpStatus ? formatEnum(row.followUpStatus) : "Open"}</td>
                <td className="px-4 py-3 text-mutedForeground">{row.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No open collections work" body="Open customer invoice balances will appear here after import or seed data." />
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Add Follow-Up Note</h2>
        <p className="mt-1 text-sm text-mutedForeground">Use this for collection contact, disputes, promised payment dates, or escalation notes.</p>
        <form action={addCashflowFollowUpAction} className="mt-4 grid gap-3 lg:grid-cols-6">
          <select name="customerId" required className="rounded-md border border-border bg-background px-3 py-2 text-sm lg:col-span-2">
            <option value="">Select customer</option>
            {[...new Map(rows.map((row) => [row.customerId, row.customerName])).entries()].map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select name="invoiceId" className="rounded-md border border-border bg-background px-3 py-2 text-sm lg:col-span-2">
            <option value="">Optional invoice</option>
            {rows.map((row) => <option key={row.id} value={row.id}>{row.invoiceNumber} / {row.customerName}</option>)}
          </select>
          <select name="status" defaultValue={CashflowFollowUpStatus.CONTACTED} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            {Object.values(CashflowFollowUpStatus).map((status) => <option key={status} value={status}>{formatEnum(status)}</option>)}
          </select>
          <input name="nextFollowUpDate" type="date" className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <input name="promisedPaymentDate" type="date" className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <input name="escalatedTo" placeholder="Escalate to" className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <input name="note" required placeholder="Follow-up note" className="rounded-md border border-border bg-background px-3 py-2 text-sm lg:col-span-4" />
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover lg:col-span-2">
            Save follow-up
          </button>
        </form>
      </section>
    </div>
  );
}
