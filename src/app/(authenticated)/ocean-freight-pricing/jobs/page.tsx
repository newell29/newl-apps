import { ModuleKey, type Prisma } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { triggerOceanFreightEmailIngestionAction } from "@/modules/ocean-freight-pricing/actions";
import { getOceanFreightJobsShell } from "@/modules/ocean-freight-pricing/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date) : "Running";
}
function readOutput(output: Prisma.JsonValue | null | undefined, key: string) {
  return output && typeof output === "object" && !Array.isArray(output) && typeof output[key as keyof typeof output] === "number" ? String(output[key as keyof typeof output]) : "0";
}

export default async function OceanFreightJobsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const shell = await getOceanFreightJobsShell(context);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ocean Freight Pricing" title="Jobs" description="Microsoft Graph source email ingestion job history for this tenant." />
      <form action={triggerOceanFreightEmailIngestionAction} className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">Run Microsoft 365 email ingestion</button>
        <p className="mt-2 text-sm text-mutedForeground">Requires Ocean Freight Pricing module access, mutation access, and configured Microsoft 365 admin mailbox targets.</p>
      </form>
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Job history</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[1000px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr><th className="px-3 py-3">Started</th><th className="px-3 py-3">Job type</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Messages</th><th className="px-3 py-3">Stored</th><th className="px-3 py-3">Detected</th><th className="px-3 py-3">Attachments</th><th className="px-3 py-3">Finished</th><th className="px-3 py-3">Error</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shell.jobs.length === 0 ? <tr><td className="px-3 py-8 text-center text-mutedForeground" colSpan={9}>No ocean freight pricing email ingestion jobs have run yet.</td></tr> : shell.jobs.map((job) => (
                <tr key={job.id} className="align-top hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-3 text-mutedForeground">{formatDate(job.startedAt)}</td><td className="px-3 py-3 font-medium text-foreground">{job.jobType}</td><td className="px-3 py-3 text-mutedForeground">{job.status}</td><td className="px-3 py-3 text-mutedForeground">{readOutput(job.output, "messageCount")}</td><td className="px-3 py-3 text-mutedForeground">{readOutput(job.output, "storedCount")}</td><td className="px-3 py-3 text-mutedForeground">{readOutput(job.output, "detectedRateEmailCount")}</td><td className="px-3 py-3 text-mutedForeground">{readOutput(job.output, "attachmentsStored")} stored / {readOutput(job.output, "attachmentsFetched")} fetched / {readOutput(job.output, "attachmentErrors")} errors</td><td className="whitespace-nowrap px-3 py-3 text-mutedForeground">{formatDate(job.finishedAt)}</td><td className="max-w-[360px] px-3 py-3 text-mutedForeground">{job.errorMessage || "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
