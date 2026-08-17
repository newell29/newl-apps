import { ModuleKey, type Prisma } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { triggerOceanFreightEmailIngestionAction } from "@/modules/ocean-freight-pricing/actions";
import { OceanFreightIngestionSubmitButton } from "@/modules/ocean-freight-pricing/components/ingestion-submit-button";
import { getOceanFreightJobsShell } from "@/modules/ocean-freight-pricing/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ ingestion?: string; message?: string }>;

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date) : "Running";
}
function readOutput(output: Prisma.JsonValue | null | undefined, key: string) {
  return output && typeof output === "object" && !Array.isArray(output) && typeof output[key as keyof typeof output] === "number" ? String(output[key as keyof typeof output]) : "0";
}
function hasRunningJob(jobs: Array<{ status: string }>) {
  return jobs.some((job) => job.status === "RUNNING" || job.status === "QUEUED");
}
function getStatusBadgeClass(status: string) {
  if (status === "ERROR") return "border-red-200 bg-red-50 text-red-700";
  if (status === "COMPLETED") return "border-green-200 bg-green-50 text-green-700";
  if (status === "RUNNING" || status === "QUEUED") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-border bg-muted text-mutedForeground";
}

export default async function OceanFreightJobsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const params = await searchParams;
  const shell = await getOceanFreightJobsShell(context);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ocean Freight Pricing" title="Jobs" description="Microsoft Graph source email ingestion job history for this tenant." />
      {params.ingestion === "success" ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          Email ingestion completed. Review the latest job row below for counts and attachment status.
        </div>
      ) : null}
      {params.ingestion === "error" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          Email ingestion failed: {params.message || "Review the latest job row below for details."}
        </div>
      ) : null}
      <form action={triggerOceanFreightEmailIngestionAction} className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <OceanFreightIngestionSubmitButton />
        <p className="mt-2 text-sm text-mutedForeground">
          Requires Ocean Freight Pricing module access, mutation access, and configured pricing mailbox targets under Sources.
        </p>
        {hasRunningJob(shell.jobs) ? (
          <p className="mt-2 text-sm font-medium text-amber-700">
            An ingestion job is currently running. Refresh this page for updates. In preview, jobs older than 5 minutes are marked failed because the serverless request likely timed out.
          </p>
        ) : null}
        <p className="mt-2 text-sm text-mutedForeground">
          Preview environments can time out on larger mailbox syncs. If a job errors with a timeout, narrow the mailbox window under Sources or retry from production until ingestion moves to a background worker.
        </p>
      </form>
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Job history</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[1200px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr><th className="px-3 py-3">Started</th><th className="px-3 py-3">Job type</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Messages</th><th className="px-3 py-3">Stored</th><th className="px-3 py-3">Detected</th><th className="px-3 py-3">Attachments</th><th className="px-3 py-3">Finished</th><th className="px-3 py-3">Error</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shell.jobs.length === 0 ? <tr><td className="px-3 py-8 text-center text-mutedForeground" colSpan={9}>No ocean freight pricing email ingestion jobs have run yet.</td></tr> : shell.jobs.map((job) => (
                <tr key={job.id} className="align-top hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-3 text-mutedForeground">{formatDate(job.startedAt)}</td><td className="whitespace-nowrap px-3 py-3 font-mono text-xs font-medium text-foreground">{job.jobType}</td><td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${getStatusBadgeClass(job.status)}`}>{job.status}</span></td><td className="px-3 py-3 text-mutedForeground">{readOutput(job.output, "messageCount")}</td><td className="px-3 py-3 text-mutedForeground">{readOutput(job.output, "storedCount")}</td><td className="px-3 py-3 text-mutedForeground">{readOutput(job.output, "detectedRateEmailCount")}</td><td className="whitespace-nowrap px-3 py-3 text-mutedForeground">{readOutput(job.output, "attachmentsStored")} stored / {readOutput(job.output, "attachmentsFetched")} fetched / {readOutput(job.output, "attachmentErrors")} errors</td><td className="whitespace-nowrap px-3 py-3 text-mutedForeground">{formatDate(job.finishedAt)}</td><td className="px-3 py-3 text-mutedForeground"><span className="block max-w-[420px] truncate" title={job.errorMessage || "None"}>{job.errorMessage || "None"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
