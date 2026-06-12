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
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Recent Job Runs</h2>
          <div className="mt-4 divide-y divide-border">
            {logs.jobs.map((job) => (
              <div key={job.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{job.jobType}</span>
                  <StatusBadge value={job.status} />
                </div>
                <p className="mt-1 text-mutedForeground">{job.startedAt.toLocaleString("en-US")}</p>
              </div>
            ))}
            {logs.jobs.length === 0 ? <p className="py-3 text-sm text-mutedForeground">No job runs yet.</p> : null}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Recent Audit Events</h2>
          <div className="mt-4 divide-y divide-border">
            {logs.auditLogs.map((log) => (
              <div key={log.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{log.action}</span>
                  <span className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
                    {log.entityType}
                  </span>
                </div>
                <p className="mt-1 text-mutedForeground">{log.createdAt.toLocaleString("en-US")}</p>
              </div>
            ))}
            {logs.auditLogs.length === 0 ? <p className="py-3 text-sm text-mutedForeground">No audit events yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const toneClass =
    value === "SUCCESS"
      ? "border-success/25 bg-success/10 text-success"
      : value === "ERROR" || value === "CANCELLED"
        ? "border-danger/25 bg-danger/10 text-danger"
        : value === "RUNNING" || value === "QUEUED"
          ? "border-warning/25 bg-warning/10 text-warning"
          : "border-border bg-muted text-mutedForeground";

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}>{value}</span>;
}
