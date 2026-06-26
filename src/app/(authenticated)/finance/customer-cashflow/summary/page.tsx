import Link from "next/link";
import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { CashflowTabs, EmptyState, Money, Percent, TierPill } from "@/modules/customer-cashflow/components";
import { getCashflowSummary } from "@/modules/customer-cashflow/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function CashflowSummaryPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.CUSTOMER_CASHFLOW);
  const params = (await searchParams) ?? {};
  const summary = await getCashflowSummary(context);
  const rows = applyFilters(summary.customers, params);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Customer Cashflow Summary"
        description="Customer-level profitability, AR, unbilled freight, credit usage, owners, and next action."
      />
      <CashflowTabs />

      <form className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <input name="customer" defaultValue={single(params.customer)} placeholder="Customer" className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <select name="tier" defaultValue={single(params.tier)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Any tier</option>
            {["A", "B", "C", "D", "REVIEW"].map((tier) => <option key={tier} value={tier}>{tier}</option>)}
          </select>
          <select name="salesRep" defaultValue={single(params.salesRep)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Any sales rep</option>
            {summary.salesReps.map((rep) => <option key={rep} value={rep}>{rep}</option>)}
          </select>
          <select name="collectionsOwner" defaultValue={single(params.collectionsOwner)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Any collections owner</option>
            {summary.collectionsOwners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
          </select>
          <select name="flag" defaultValue={single(params.flag)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Any flag</option>
            <option value="over-limit">Over credit limit</option>
            <option value="above-80">Above 80% limit</option>
            <option value="unbilled">Has unbilled revenue</option>
            <option value="overdue">Has overdue AR</option>
            <option value="cost-not-billed">Has vendor costs not billed</option>
          </select>
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
            Filter
          </button>
        </div>
      </form>

      <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="min-w-[1500px] divide-y divide-border text-sm">
          <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            <tr>
              {[
                "Customer",
                "Tier",
                "Revenue",
                "Gross profit",
                "Margin",
                "Open AR",
                "Overdue AR",
                "Unbilled",
                "Costs not billed",
                "Vendor paid/open",
                "Exposure",
                "Credit limit",
                "% used",
                "Avg collect",
                "Avg cash gap",
                "Owner",
                "Next action"
              ].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-medium text-foreground">
                  <Link href={`/finance/customer-cashflow/customers/${row.id}`} className="text-primary hover:text-primaryHover">
                    {row.customerName}
                  </Link>
                </td>
                <td className="px-4 py-3"><TierPill value={row.tier} /></td>
                <td className="px-4 py-3"><Money value={row.revenue} /></td>
                <td className="px-4 py-3"><Money value={row.grossProfit} /></td>
                <td className="px-4 py-3"><Percent value={row.grossMarginPercent} /></td>
                <td className="px-4 py-3"><Money value={row.openAr} /></td>
                <td className="px-4 py-3"><Money value={row.overdueAr} /></td>
                <td className="px-4 py-3"><Money value={row.unbilledRevenue} /></td>
                <td className="px-4 py-3"><Money value={row.vendorCostsNotBilled} /></td>
                <td className="px-4 py-3"><Money value={row.vendorPaidNotCollected} /></td>
                <td className="px-4 py-3 font-semibold"><Money value={row.totalExposure} /></td>
                <td className="px-4 py-3"><Money value={row.creditLimit} /></td>
                <td className="px-4 py-3"><Percent value={row.percentCreditUsed} /></td>
                <td className="px-4 py-3">{row.averageDaysToCollect ?? "n/a"}</td>
                <td className="px-4 py-3">{row.averageCashGapDays ?? "n/a"}</td>
                <td className="px-4 py-3">{row.assignedCollectionsOwner ?? row.assignedSalesRep ?? "Unassigned"}</td>
                <td className="px-4 py-3">{row.nextAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No matching customers" body="Adjust filters or seed/import customer cashflow records." />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function applyFilters(rows: Awaited<ReturnType<typeof getCashflowSummary>>["customers"], params: Record<string, string | string[] | undefined>) {
  const customer = single(params.customer).toLowerCase();
  const tier = single(params.tier);
  const salesRep = single(params.salesRep);
  const collectionsOwner = single(params.collectionsOwner);
  const flag = single(params.flag);

  return rows.filter((row) => {
    if (customer && !row.customerName.toLowerCase().includes(customer)) return false;
    if (tier && row.tier !== tier) return false;
    if (salesRep && row.assignedSalesRep !== salesRep) return false;
    if (collectionsOwner && row.assignedCollectionsOwner !== collectionsOwner) return false;
    if (flag === "over-limit" && row.percentCreditUsed < 100) return false;
    if (flag === "above-80" && row.percentCreditUsed < 80) return false;
    if (flag === "unbilled" && row.unbilledRevenue <= 0) return false;
    if (flag === "overdue" && row.overdueAr <= 0) return false;
    if (flag === "cost-not-billed" && row.vendorCostsNotBilled <= 0) return false;
    return true;
  });
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
