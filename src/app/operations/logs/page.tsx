import { PageHeader } from "@/components/page-header";
import { getOperationsLogPreview } from "@/modules/operations/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function OperationsLogsPage() {
  const tenant = await getCurrentTenantContext();
  const logs = await getOperationsLogPreview(tenant);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Jobs & Audit Logs"
        description="Placeholder view for scheduler activity, external writes, approvals, and tenant-safe audit trails."
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Recent Job Runs</h2>
          <div className="mt-4 divide-y divide-line">
            {logs.jobs.map((job) => (
              <div key={job.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{job.jobType}</span>
                  <span className="text-slate-500">{job.status}</span>
                </div>
                <p className="mt-1 text-slate-500">{job.startedAt.toLocaleString("en-US")}</p>
              </div>
            ))}
            {logs.jobs.length === 0 ? <p className="py-3 text-sm text-slate-500">No job runs yet.</p> : null}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Recent Audit Events</h2>
          <div className="mt-4 divide-y divide-line">
            {logs.auditLogs.map((log) => (
              <div key={log.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{log.action}</span>
                  <span className="text-slate-500">{log.entityType}</span>
                </div>
                <p className="mt-1 text-slate-500">{log.createdAt.toLocaleString("en-US")}</p>
              </div>
            ))}
            {logs.auditLogs.length === 0 ? <p className="py-3 text-sm text-slate-500">No audit events yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
