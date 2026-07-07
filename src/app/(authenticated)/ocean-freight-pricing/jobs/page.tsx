import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { getOceanFreightPricingShell } from "@/modules/ocean-freight-pricing/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date) : "Running";
}

export default async function OceanFreightJobsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const shell = await getOceanFreightPricingShell(context, { status: "active" });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ocean Freight Pricing"
        title="Jobs"
        description="Recent ocean pricing ingestion and extraction job history for this tenant."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Job history</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[860px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-3">Started</th>
                <th className="px-3 py-3">Job type</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Finished</th>
                <th className="px-3 py-3">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shell.jobs.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-mutedForeground" colSpan={5}>
                    No ocean freight pricing jobs have run yet.
                  </td>
                </tr>
              ) : (
                shell.jobs.map((job) => (
                  <tr key={job.id} className="align-top hover:bg-muted/30">
                    <td className="px-3 py-3 text-mutedForeground">{formatDate(job.startedAt)}</td>
                    <td className="px-3 py-3 font-medium text-foreground">{job.jobType}</td>
                    <td className="px-3 py-3 text-mutedForeground">{job.status}</td>
                    <td className="px-3 py-3 text-mutedForeground">{formatDate(job.finishedAt)}</td>
                    <td className="max-w-[360px] px-3 py-3 text-mutedForeground">{job.errorMessage || "None"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
