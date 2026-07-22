import Link from "next/link";
import { ButtonLink } from "@/components/button-link";
import { MetricCard } from "@/components/metric-card";
import { NewlLogo } from "@/components/newl-logo";
import { getDashboardSummary } from "@/modules/dashboard/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const tenant = await getCurrentTenantContext();
  const summary = await getDashboardSummary(tenant);

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-accentSoft px-6 py-3 text-xs font-semibold uppercase tracking-wide text-primary lg:px-7">
          Internal logistics control center
        </div>
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px] lg:p-7">
          <div className="space-y-5">
            <NewlLogo />
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">{tenant.tenantName}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                Logistics operating dashboard
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-mutedForeground">
                Monitor lead generation health, module access, and operational readiness from one
                internal-first control surface.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/lead-gen/candidates">Review Candidates</ButtonLink>
              <ButtonLink href="/lead-gen/pipeline" variant="secondary">
                Open Pipeline
              </ButtonLink>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Today at a glance</p>
            <div className="mt-4 space-y-4">
              <DashboardSignal label="Lead-gen module" value="Enabled" tone="success" />
              <DashboardSignal label="External writes" value="Dry run only" tone="warning" />
              <DashboardSignal label="Tenant mode" value="Authenticated session" tone="success" />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Candidate Companies" value={summary.companyCount} caption="TradeMining feed" />
        <MetricCard label="Open Leads" value={summary.openLeadCount} caption="Active pipeline" />
        <MetricCard label="Contacts" value={summary.contactCount} caption="Apollo-ready records" />
        <MetricCard label="Recent Jobs" value={summary.recentJobCount} caption="Automation history" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Module Status</h2>
              <p className="mt-1 text-sm text-mutedForeground">Tenant-enabled products and internal tools.</p>
            </div>
            <Link href="/settings" className="text-sm font-semibold text-primary hover:text-primaryHover">
              Settings
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {summary.modules.map((module) => (
              <div key={module.key} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-medium text-foreground">{module.name}</p>
                  <p className="text-sm text-mutedForeground">{module.description}</p>
                </div>
                <span className="rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                  {module.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Lead Generation Flow</h2>
          <div className="mt-4 space-y-3">
            <FlowStep number="1" title="Candidate Feed" body="Review scored TradeMining companies before enrichment." />
            <FlowStep number="2" title="Pipeline" body="Track stage, score, owner, and outreach readiness." />
            <FlowStep number="3" title="Integration Gates" body="Keep Apollo and sequence pushes behind tenant-safe service boundaries." />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">TradeMining Trial Health</h2>
              <p className="mt-1 text-sm text-mutedForeground">
                Quick visibility into profile readiness and whether the latest ingestion runs are staying healthy.
              </p>
            </div>
            <Link href="/operations/logs" className="text-sm font-semibold text-primary hover:text-primaryHover">
              View full logs
            </Link>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <DashboardStat
              label="Enabled profiles"
              value={summary.tradeMiningHealth.enabledProfileCount}
              caption="Ready for worker pulls"
            />
            <DashboardStat
              label="Healthy profiles"
              value={summary.tradeMiningHealth.healthyProfileCount}
              caption={
                summary.tradeMiningHealth.lastSuccessfulRunAt
                  ? `Last success ${summary.tradeMiningHealth.lastSuccessfulRunAt.toLocaleString("en-US")}`
                  : "No successful run yet"
              }
            />
            <DashboardStat
              label="Needs attention"
              value={summary.tradeMiningHealth.attentionProfileCount}
              caption="Failed, stale, or never run"
              tone={summary.tradeMiningHealth.attentionProfileCount > 0 ? "warning" : "default"}
            />
          </div>

          <div className="mt-5 divide-y divide-border rounded-md border border-border">
            {summary.tradeMiningHealth.profiles.slice(0, 4).map((profile) => (
              <div key={profile.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium text-foreground">{profile.name}</p>
                  <p className="mt-1 text-sm text-mutedForeground">
                    Daily schedule
                    {profile.lastRunAt ? ` • ${formatLastRun(profile.lastRunAt, profile.lastRunStatus)}` : " • Not run yet"}
                  </p>
                </div>
                <StatusPill value={profile.lastRunStatus} enabled={profile.enabled} />
              </div>
            ))}
            {summary.tradeMiningHealth.profiles.length === 0 ? (
              <div className="p-4 text-sm text-mutedForeground">No TradeMining profiles are configured yet.</div>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Recent Ingestion Runs</h2>
              <p className="mt-1 text-sm text-mutedForeground">Latest TradeMining jobs and record outcomes.</p>
            </div>
            <Link
              href="/lead-gen/search-profiles"
              className="text-sm font-semibold text-primary hover:text-primaryHover"
            >
              Profiles
            </Link>
          </div>

          <div className="mt-4 divide-y divide-border">
            {summary.tradeMiningHealth.recentJobs.map((job) => (
              <div key={job.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{job.startedAt.toLocaleString("en-US")}</p>
                  <StatusPill value={job.status} />
                </div>
                <p className="mt-1 text-sm text-mutedForeground">
                  {formatJobCounts(job.output)}
                  {job.finishedAt ? ` • Finished ${job.finishedAt.toLocaleString("en-US")}` : ""}
                </p>
                {job.errorMessage ? <p className="mt-1 text-xs text-danger">Error: {job.errorMessage}</p> : null}
              </div>
            ))}
            {summary.tradeMiningHealth.recentJobs.length === 0 ? (
              <p className="py-3 text-sm text-mutedForeground">No TradeMining ingestion runs yet.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function DashboardSignal({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/25 bg-success/10 text-success"
      : tone === "warning"
        ? "border-warning/25 bg-warning/10 text-warning"
        : "border-border bg-card text-mutedForeground";

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-mutedForeground">{label}</span>
      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}>{value}</span>
    </div>
  );
}

function FlowStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primaryForeground">
        {number}
      </div>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-5 text-mutedForeground">{body}</p>
      </div>
    </div>
  );
}

function DashboardStat({
  label,
  value,
  caption,
  tone = "default"
}: {
  label: string;
  value: number;
  caption: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone === "warning" ? "text-warning" : "text-foreground"}`}>
        {value.toLocaleString("en-US")}
      </p>
      <p className="mt-2 text-sm text-mutedForeground">{caption}</p>
    </div>
  );
}

function StatusPill({ value, enabled = true }: { value: string; enabled?: boolean }) {
  const toneClass = !enabled
    ? "border-border bg-muted text-mutedForeground"
    : value === "SUCCESS" || value === "COMPLETED"
      ? "border-success/25 bg-success/10 text-success"
      : value === "ERROR" || value === "FAILED" || value === "CANCELLED"
        ? "border-danger/25 bg-danger/10 text-danger"
        : value === "RUNNING" || value === "QUEUED" || value === "PARTIAL"
          ? "border-warning/25 bg-warning/10 text-warning"
          : "border-border bg-muted text-mutedForeground";

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}>{value}</span>;
}

function formatLastRun(lastRunAt: Date, status: string) {
  return `${status} at ${lastRunAt.toLocaleString("en-US")}`;
}

function formatJobCounts(output: unknown) {
  const record = asObject(output);
  const processed = readNumber(record, "recordsProcessed");
  const created = readNumber(record, "recordsCreated");
  const updated = readNumber(record, "recordsUpdated");
  const workerStatus = readString(record, "externalStatus");

  if (processed == null && !workerStatus) {
    return "Awaiting batch details";
  }

  if (processed == null) {
    return `Worker status: ${workerStatus}`;
  }

  const parts = [`${processed.toLocaleString("en-US")} processed`];

  if (created != null) {
    parts.push(`${created.toLocaleString("en-US")} created`);
  }

  if (updated != null) {
    parts.push(`${updated.toLocaleString("en-US")} updated`);
  }

  if (workerStatus) {
    parts.push(workerStatus);
  }

  return parts.join(" • ");
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
