import Link from "next/link";
import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { CashflowTabs, EmptyState, Money, Percent, PriorityPill } from "@/modules/customer-cashflow/components";
import { getCashflowDashboard } from "@/modules/customer-cashflow/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function CustomerCashflowDashboardPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.CUSTOMER_CASHFLOW);
  const dashboard = await getCashflowDashboard(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Customer Cashflow"
        description="Visibility into open AR, unbilled freight, vendor-paid exposure, and customers that are profitable but cash hungry."
      />
      <CashflowTabs />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Open AR" value={dashboard.kpis.totalOpenAr} caption="Customer invoices" />
        <MetricCard label="Overdue AR" value={dashboard.kpis.totalOverdueAr} caption="Past due balances" />
        <MetricCard label="Unbilled Revenue" value={dashboard.kpis.totalUnbilledRevenue} caption="Estimated file revenue" />
        <MetricCard label="Credit Exposure" value={dashboard.kpis.totalCreditExposure} caption="AR + unbilled + active files" />
        <MetricCard label="Vendor Cost Not Billed" value={dashboard.kpis.vendorCostsNotBilled} caption="Cost received, no invoice" />
        <MetricCard label="Vendor Paid Not Collected" value={dashboard.kpis.vendorPaidNotCollected} caption="Cash already out" />
        <MetricCard label="Over Limit Customers" value={dashboard.kpis.customersOverCreditLimit} caption=">= 100% credit used" />
        <MetricCard label="Above 80% Limit" value={dashboard.kpis.customersAboveWarning} caption="Watch list" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <DashboardTable title="Top customers by exposure" rows={dashboard.topExposure} metric="totalExposure" />
        <DashboardTable title="Profitable but high cash use" rows={dashboard.profitableHighCashUse} metric="totalExposure" />
        <DashboardTable title="Top overdue AR" rows={dashboard.topOverdueAr} metric="overdueAr" />
        <DashboardTable title="Vendor costs not billed" rows={dashboard.topVendorCostsNotBilled} metric="vendorCostsNotBilled" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">File Cash Status Work Queue</h2>
              <p className="mt-1 text-sm text-mutedForeground">Files that need accounting, operations, or collections action.</p>
            </div>
            <Link href="/finance/customer-cashflow/files" className="text-sm font-semibold text-primary hover:text-primaryHover">
              View queue
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {dashboard.fileQueue.map((file) => (
              <div key={file.id} className="grid gap-3 py-3 md:grid-cols-[110px_1fr_auto] md:items-center">
                <PriorityPill value={file.priority} />
                <div>
                  <p className="font-medium text-foreground">{file.customerName} / {file.fileNumber}</p>
                  <p className="mt-1 text-sm text-mutedForeground">{file.actionRequired} • {file.shipmentType}</p>
                </div>
                <p className="text-sm font-semibold text-foreground"><Money value={file.vendorCost} /></p>
              </div>
            ))}
            {dashboard.fileQueue.length === 0 ? (
              <EmptyState title="No file actions" body="Cash status data is clean for the current seeded/imported records." />
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Internal Alerts</h2>
          <p className="mt-1 text-sm text-mutedForeground">App-visible alert structure for future email or Slack routing.</p>
          <div className="mt-4 divide-y divide-border">
            {dashboard.openAlerts.map((alert) => (
              <div key={alert.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-foreground">{alert.title}</p>
                  <PriorityPill value={alert.priority} />
                </div>
                <p className="mt-1 text-sm text-mutedForeground">{alert.message}</p>
              </div>
            ))}
            {dashboard.openAlerts.length === 0 ? (
              <EmptyState title="No open alerts" body="Alerts will appear here once accounting data triggers a rule." />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function DashboardTable({
  title,
  rows,
  metric
}: {
  title: string;
  rows: Awaited<ReturnType<typeof getCashflowDashboard>>["topExposure"];
  metric: "totalExposure" | "overdueAr" | "vendorCostsNotBilled";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-4 divide-y divide-border">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/finance/customer-cashflow/customers/${row.id}`}
            className="grid gap-3 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[1fr_auto_auto]"
          >
            <span className="font-medium text-foreground">{row.customerName}</span>
            <span className="text-sm text-mutedForeground"><Percent value={row.percentCreditUsed} /> used</span>
            <span className="text-sm font-semibold text-foreground"><Money value={row[metric]} /></span>
          </Link>
        ))}
        {rows.length === 0 ? <EmptyState title="No customers yet" body="Seed or import customer cashflow records to populate this view." /> : null}
      </div>
    </div>
  );
}
