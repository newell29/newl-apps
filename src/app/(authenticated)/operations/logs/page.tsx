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
        eyebrow="TradeMining Leads"
        title="Health & Logs"
        description="Monitor profile readiness, recent ingestion outcomes, and the latest tenant-safe audit trail for the TradeMining trial."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Enabled Profiles" value={logs.summary.enabledProfileCount} caption="Ready for trial pulls" />
        <MetricCard label="Recent Runs" value={logs.summary.recentRunCount} caption="Latest TradeMining jobs" />
        <MetricCard label="Successful Runs" value={logs.summary.successCount} caption="Recent completions" />
        <MetricCard
          label="Open Issues"
          value={logs.summary.issueCount}
          caption={
            logs.summary.lastSuccessfulRunAt
              ? `Last success ${logs.summary.lastSuccessfulRunAt.toLocaleString("en-US")}`
              : "No successful run yet"
          }
          tone={logs.summary.issueCount > 0 ? "danger" : "default"}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">TradeMining Data Quality</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              This is the QA pass for the trial mirror. It shows whether the scoring-critical fields are actually
              arriving in the stored records before we finalize ranking rules.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
            Trial QA
          </span>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <MetricCard
            label="Sampled Records"
            value={logs.dataQuality.summary.sampleSize}
            caption="Most recent TradeMining rows checked"
          />
          <MetricCard
            label="Score-Ready Rows"
            value={logs.dataQuality.summary.scoreReadyCount}
            caption="Critical ranking inputs are present"
          />
          <MetricCard
            label="Needs Attention"
            value={logs.dataQuality.summary.attentionCount}
            caption="Missing one or more critical inputs"
            tone={logs.dataQuality.summary.attentionCount > 0 ? "danger" : "default"}
          />
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[780px] divide-y divide-border text-sm">
            <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
              <tr>
                <th className="px-4 py-3">Field</th>
                <th className="px-4 py-3">Coverage</th>
                <th className="px-4 py-3">Missing</th>
                <th className="px-4 py-3">Use in scoring</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.dataQuality.coverage.map((item) => (
                <tr key={item.key}>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{item.label}</p>
                    <p className="mt-1 text-xs text-mutedForeground">{item.description}</p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${item.coveragePercent >= 80 ? "bg-success" : item.coveragePercent >= 50 ? "bg-warning" : "bg-danger"}`}
                          style={{ width: `${item.coveragePercent}%` }}
                        />
                      </div>
                      <span className="font-medium text-foreground">{item.coveragePercent}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-mutedForeground">
                    {item.missingCount.toLocaleString("en-US")} of {logs.dataQuality.summary.sampleSize.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${item.critical ? "border-primary/25 bg-primary/10 text-primary" : "border-border bg-muted text-mutedForeground"}`}
                    >
                      {item.critical ? "Critical" : "Supporting"}
                    </span>
                  </td>
                </tr>
              ))}
              {logs.dataQuality.coverage.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-sm text-mutedForeground" colSpan={4}>
                    No TradeMining import rows are available yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Profile health</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              This is the quickest read on whether each TradeMining trial profile is enabled, when it last ran, and
              whether the most recent status looks healthy.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
            Trial visibility
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[840px] divide-y divide-border text-sm">
            <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
              <tr>
                <th className="px-4 py-3">Profile</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Thresholds</th>
                <th className="px-4 py-3">Last run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.profiles.map((profile) => (
                <tr key={profile.id} className="align-top">
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{profile.name}</p>
                    {profile.description ? <p className="mt-1 text-xs text-mutedForeground">{profile.description}</p> : null}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge value={profile.enabled ? profile.lastRunStatus ?? "Enabled" : "Disabled"} />
                  </td>
                  <td className="px-4 py-4 text-mutedForeground">
                    {profile.scheduleFrequency} / {profile.scheduleTimezone}
                  </td>
                  <td className="px-4 py-4 text-mutedForeground">
                    <p>{profile.minShipmentCount.toLocaleString("en-US")} min shipments</p>
                    <p className="mt-1 text-xs">Volume {profile.minShipmentVolume?.toString() ?? "Not set"}</p>
                  </td>
                  <td className="px-4 py-4 text-mutedForeground">{formatDateTime(profile.lastRunAt, profile.lastRunStatus)}</td>
                </tr>
              ))}
              {logs.profiles.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-sm text-mutedForeground" colSpan={5}>
                    No TradeMining profiles are configured yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Recent Row Samples</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Use this to spot whether the latest stored TradeMining rows are missing any of the inputs we want for
              momentum, lane fit, and industry scoring.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[860px] divide-y divide-border text-sm">
            <thead className="bg-muted text-left text-xs font-semibold uppercase text-mutedForeground">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Arrival</th>
                <th className="px-4 py-3">Missing critical fields</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.dataQuality.samples.map((sample) => (
                <tr key={sample.id}>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{sample.companyName}</p>
                    <p className="mt-1 text-xs text-mutedForeground">{sample.rawRecordKey}</p>
                  </td>
                  <td className="px-4 py-4 text-mutedForeground">{sample.destinationLabel}</td>
                  <td className="px-4 py-4 text-mutedForeground">
                    {sample.arrivalDate ? sample.arrivalDate.toLocaleString("en-US") : "Missing date"}
                  </td>
                  <td className="px-4 py-4">
                    {sample.missingFields.length === 0 ? (
                      <span className="rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                        Score-ready
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {sample.missingFields.map((field) => (
                          <span
                            key={field}
                            className="rounded-full border border-danger/25 bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger"
                          >
                            {field}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {logs.dataQuality.samples.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-sm text-mutedForeground" colSpan={4}>
                    No recent TradeMining samples yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Recent TradeMining runs</h2>
          <div className="mt-4 divide-y divide-border">
            {logs.jobs.map((job) => (
              <div key={job.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{job.jobType}</span>
                  <StatusBadge value={job.status} />
                </div>
                <p className="mt-1 text-mutedForeground">
                  Started {job.startedAt.toLocaleString("en-US")}
                  {job.finishedAt ? ` • Finished ${job.finishedAt.toLocaleString("en-US")}` : ""}
                </p>
                <RunSummary job={job} />
              </div>
            ))}
            {logs.jobs.length === 0 ? (
              <p className="py-3 text-sm text-mutedForeground">No TradeMining trial job runs yet.</p>
            ) : null}
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

function MetricCard({
  label,
  value,
  caption,
  tone = "default"
}: {
  label: string;
  value: number;
  caption: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <p className="text-sm font-medium text-mutedForeground">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${tone === "danger" ? "text-danger" : "text-foreground"}`}>{value}</p>
      <p className="mt-2 text-sm text-mutedForeground">{caption}</p>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const toneClass =
    value === "SUCCESS" || value === "COMPLETED"
      ? "border-success/25 bg-success/10 text-success"
      : value === "ERROR" || value === "FAILED" || value === "CANCELLED"
        ? "border-danger/25 bg-danger/10 text-danger"
        : value === "RUNNING" || value === "QUEUED" || value === "PARTIAL"
          ? "border-warning/25 bg-warning/10 text-warning"
          : "border-border bg-muted text-mutedForeground";

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}>{value}</span>;
}

function formatDateTime(value: Date | null, status: string | null) {
  if (!value) {
    return status ?? "Not run yet";
  }

  return `${status ?? "Completed"} at ${value.toLocaleString("en-US")}`;
}

function RunSummary({
  job
}: {
  job: {
    output: unknown;
    errorMessage: string | null;
  };
}) {
  const output = asObject(job.output);
  const recordsProcessed = readNumber(output, "recordsProcessed");
  const recordsCreated = readNumber(output, "recordsCreated");
  const recordsUpdated = readNumber(output, "recordsUpdated");
  const externalStatus = readString(output, "externalStatus");

  if (recordsProcessed == null && !job.errorMessage && !externalStatus) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1 text-xs text-mutedForeground">
      {externalStatus ? <p>Worker status: {externalStatus}</p> : null}
      {recordsProcessed != null ? (
        <p>
          {recordsProcessed.toLocaleString("en-US")} processed
          {recordsCreated != null ? ` • ${recordsCreated.toLocaleString("en-US")} created` : ""}
          {recordsUpdated != null ? ` • ${recordsUpdated.toLocaleString("en-US")} updated` : ""}
        </p>
      ) : null}
      {job.errorMessage ? <p className="text-danger">Error: {job.errorMessage}</p> : null}
    </div>
  );
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function readNumber(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}
