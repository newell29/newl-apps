import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { getDashboardSummary } from "@/modules/dashboard/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const tenant = await getCurrentTenantContext();
  const summary = await getDashboardSummary(tenant);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tenant.tenantName}
        title="Dashboard"
        description="Operational snapshot for enabled modules, lead generation, and platform activity."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Candidate Companies" value={summary.companyCount} />
        <MetricCard label="Open Leads" value={summary.openLeadCount} />
        <MetricCard label="Contacts" value={summary.contactCount} />
        <MetricCard label="Recent Jobs" value={summary.recentJobCount} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Module Status</h2>
          <div className="mt-4 divide-y divide-line">
            {summary.modules.map((module) => (
              <div key={module.key} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-ink">{module.name}</p>
                  <p className="text-sm text-slate-500">{module.description}</p>
                </div>
                <span className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-slate-600">
                  {module.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Implementation Boundary</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            <p>
              This foundation uses seeded sample data only. Live Apollo, TradeMining, Google
              Sheets, QuickBooks, UPS, and OpenClaw calls are intentionally behind future
              integration boundaries.
            </p>
            <p>
              All server queries in this scaffold start from a tenant context and must preserve
              that pattern as modules grow.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
