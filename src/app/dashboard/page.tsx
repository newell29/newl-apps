import Link from "next/link";
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

      <div className="flex flex-wrap gap-3">
        <Link
          href="/lead-gen/candidates"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primaryForeground shadow-sm transition-colors hover:bg-primary/90"
        >
          Candidate Feed
        </Link>
        <Link
          href="/lead-gen/pipeline"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-muted"
        >
          Pipeline
        </Link>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Candidate Companies" value={summary.companyCount} />
        <MetricCard label="Open Leads" value={summary.openLeadCount} />
        <MetricCard label="Contacts" value={summary.contactCount} />
        <MetricCard label="Recent Jobs" value={summary.recentJobCount} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Module Status</h2>
          <div className="mt-4 divide-y divide-border">
            {summary.modules.map((module) => (
              <div key={module.key} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-foreground">{module.name}</p>
                  <p className="text-sm text-mutedForeground">{module.description}</p>
                </div>
                <span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                  {module.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Implementation Boundary</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-mutedForeground">
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
