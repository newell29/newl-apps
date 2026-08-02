import { ModuleKey } from "@prisma/client";
import Link from "next/link";

import { AgentAvatar, AgentStatusBadge, MetricCard } from "@/modules/agent-operations/components/agent-ui";
import { AgentOperationsLiveRefresh } from "@/modules/agent-operations/components/live-refresh";
import {
  AGENT_CATALOG,
  durationMilliseconds,
  formatDuration,
  normalizeRunHistoryFilters
} from "@/modules/agent-operations/presentation";
import { getAgentRunHistory } from "@/modules/agent-operations/queries";
import type { AgentRun, AgentRunHistoryFilters, AgentRunSource } from "@/modules/agent-operations/types";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AgentRunHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);
  const filters = normalizeRunHistoryFilters(await searchParams);
  const history = await getAgentRunHistory(context, filters);

  return (
    <div className="space-y-6">
      <AgentOperationsLiveRefresh />
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-border pb-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Agent Operations / Run History</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Run history</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">
            Review every agent run and see why work failed, skipped, or did not start.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground">{history.timezone}</span>
          <span className="inline-flex items-center gap-2 text-sm text-mutedForeground">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Live
          </span>
          <Link href="/agent-operations" className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">
            Back to dashboard
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Matching runs" value={history.summary.total} />
        <MetricCard label="Successful" value={history.summary.successful} tone="success" />
        <MetricCard label="Skipped" value={history.summary.skipped} tone="warning" />
        <MetricCard label="Failed or missed" value={history.summary.failed} tone="danger" />
      </section>

      <RunHistoryFilters filters={filters} />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Run history</h2>
              <p className="mt-1 text-sm text-mutedForeground">
                Showing {history.runs.length} of {history.totalMatching} matching runs · 15 at a time
              </p>
            </div>
            {history.hasMore ? (
              <Link
                href={buildRunHistoryHref(filters, { limit: String(history.nextLimit), run: history.selectedRun?.id })}
                className="rounded-md border border-primary px-3 py-2 text-sm font-semibold text-primary hover:bg-primary hover:text-primaryForeground"
              >
                Show 15 more
              </Link>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] divide-y divide-border text-sm">
              <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                <tr>
                  <th className="px-5 py-3">Started</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Assignment</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-3 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.runs.map((run) => {
                  const selected = run.id === history.selectedRun?.id;
                  const catalog = AGENT_CATALOG[run.agentKey];
                  return (
                    <tr key={run.id} className={selected ? "bg-primary/5 shadow-[inset_3px_0_0_rgb(var(--color-primary))]" : "hover:bg-muted/30"}>
                      <td className="whitespace-nowrap px-5 py-3 text-mutedForeground">{formatDateTime(run.startedAt, history.timezone)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <AgentAvatar agentKey={run.agentKey} initials={catalog.initials} size="sm" />
                          <span className="font-semibold text-foreground">{run.agentName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{run.assignment}</p>
                        {run.reason ? <p className="mt-1 max-w-md text-xs leading-5 text-danger">{run.reason}</p> : <p className="mt-1 text-xs text-mutedForeground">{run.summary}</p>}
                      </td>
                      <td className="px-4 py-3"><AgentStatusBadge value={run.status} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-mutedForeground">{formatDuration(durationMilliseconds(run, history.updatedAt))}</td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          aria-label={`View ${run.agentName} run details`}
                          href={buildRunHistoryHref(filters, { run: run.id })}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg text-mutedForeground hover:bg-muted hover:text-foreground"
                        >
                          ›
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {history.runs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-mutedForeground">
                      No agent runs match the current search and filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {history.hasMore ? (
            <div className="border-t border-border p-4 text-center">
              <Link
                href={buildRunHistoryHref(filters, { limit: String(history.nextLimit), run: history.selectedRun?.id })}
                className="inline-flex rounded-md border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary hover:text-primaryForeground"
              >
                Show 15 more matching results
              </Link>
            </div>
          ) : null}
        </div>

        <RunDetails run={history.selectedRun} timezone={history.timezone} now={history.updatedAt} />
      </section>
    </div>
  );
}
function RunHistoryFilters({ filters }: { filters: AgentRunHistoryFilters }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <form method="get" className="grid gap-3 xl:grid-cols-[0.7fr_0.9fr_0.9fr_1.5fr_auto_auto] xl:items-center">
        <select name="range" defaultValue={filters.range} className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground">
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="all">All retained runs</option>
        </select>
        <select name="agent" defaultValue={filters.agent} className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground">
          <option value="all">All agents</option>
          {Object.entries(AGENT_CATALOG).map(([key, agent]) => <option key={key} value={key}>{agent.name}</option>)}
        </select>
        <select name="status" defaultValue={filters.status} className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground">
          <option value="all">All statuses</option>
          <option value="SUCCESS">Successful</option>
          <option value="RUNNING">Running</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="SKIPPED">Skipped</option>
          <option value="FAILED">Failed</option>
          <option value="MISSED">Missed</option>
        </select>
        <input
          name="q"
          defaultValue={filters.query}
          placeholder="Search run, assignment, or reason"
          className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground"
        />
        <button className="rounded-md border border-primary px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary hover:text-primaryForeground">Apply filters</button>
        <Link href="/agent-operations/run-history" className="px-2 text-sm font-semibold text-primary hover:text-primaryHover">Clear</Link>
        <label className="flex items-center gap-2 text-sm text-mutedForeground xl:col-span-6">
          <input type="checkbox" name="attention" value="true" defaultChecked={filters.needsAttention} className="h-4 w-4 accent-[rgb(var(--color-primary))]" />
          Show only needs attention
        </label>
      </form>
    </section>
  );
}

function RunDetails({ run, timezone, now }: { run: AgentRun | null; timezone: string; now: Date }) {
  if (!run) {
    return (
      <aside className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Run details</h2>
        <p className="mt-3 text-sm text-mutedForeground">Select a run to review its status, reason, impact, and timeline.</p>
      </aside>
    );
  }

  const catalog = AGENT_CATALOG[run.agentKey];
  const needsReason = run.status === "FAILED" || run.status === "SKIPPED" || run.status === "MISSED";
  return (
    <aside className="self-start rounded-lg border border-border bg-card p-5 shadow-sm xl:sticky xl:top-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Run details</h2>
        <AgentStatusBadge value={run.status} />
      </div>
      <div className="mt-4 flex items-start gap-3">
        <AgentAvatar agentKey={run.agentKey} initials={catalog.initials} />
        <div>
          <p className="font-semibold text-foreground">{run.agentName} · {run.assignment}</p>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">{run.summary}</p>
        </div>
      </div>

      {needsReason ? (
        <div className={`mt-4 rounded-md border p-4 ${run.status === "SKIPPED" ? "border-warning/30 bg-warning/10" : "border-danger/30 bg-danger/10"}`}>
          <p className={`text-sm font-semibold ${run.status === "SKIPPED" ? "text-warning" : "text-danger"}`}>
            {run.status === "SKIPPED" ? "Why it was skipped" : run.status === "MISSED" ? "Why it did not run" : "Why it failed"}
          </p>
          <p className="mt-2 text-sm font-medium leading-6 text-foreground">{run.reason}</p>
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="font-semibold text-foreground">Trigger</dt><dd className="text-mutedForeground">{run.trigger}</dd>
        <dt className="font-semibold text-foreground">Started</dt><dd className="text-mutedForeground">{formatDateTime(run.startedAt, timezone)}</dd>
        <dt className="font-semibold text-foreground">Finished</dt><dd className="text-mutedForeground">{run.finishedAt ? formatDateTime(run.finishedAt, timezone) : "Still running"}</dd>
        <dt className="font-semibold text-foreground">Duration</dt><dd className="text-mutedForeground">{formatDuration(durationMilliseconds(run, now))}</dd>
        <dt className="font-semibold text-foreground">Run ID</dt><dd className="break-all font-mono text-xs text-mutedForeground">{run.sourceId}</dd>
      </dl>

      <DetailSection title="Impact"><p>{run.impact}</p></DetailSection>
      <DetailSection title="What happens next">
        <div className="rounded-md border border-success/25 bg-success/10 p-3 text-sm text-foreground">{run.nextStep}</div>
      </DetailSection>
      <DetailSection title="Activity">
        <ol className="space-y-3 border-l border-primary/30 pl-4">
          <TimelineItem value={run.startedAt} label={run.status === "MISSED" ? "Expected start was not recorded" : "Run started"} timezone={timezone} />
          {run.finishedAt ? <TimelineItem value={run.finishedAt} label={activityEndLabel(run.status)} timezone={timezone} /> : <TimelineItem value={now} label="Run remains active" timezone={timezone} />}
        </ol>
      </DetailSection>

      <details className="mt-5 rounded-md border border-border bg-muted/20">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-primary">View technical details</summary>
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs text-mutedForeground">
          <p>Source: {sourceLabel(run.source)}</p>
          <p>Status: {run.status}</p>
          <p>Run identifier: {run.sourceId}</p>
          <p>Technical details are redacted and tenant-scoped. Raw payloads and secrets are not shown.</p>
        </div>
      </details>
    </aside>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-border pt-4 text-sm text-mutedForeground">
      <h3 className="mb-2 font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function TimelineItem({ value, label, timezone }: { value: Date; label: string; timezone: string }) {
  return (
    <li className="relative grid grid-cols-[90px_1fr] gap-2 text-xs text-mutedForeground">
      <span className="absolute -left-[20.5px] top-1 h-2 w-2 rounded-full bg-primary" />
      <span>{new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(value)}</span>
      <span>{label}</span>
    </li>
  );
}

function buildRunHistoryHref(filters: AgentRunHistoryFilters, overrides: { limit?: string; run?: string | null }) {
  const params = new URLSearchParams();
  if (filters.range !== "7") params.set("range", filters.range);
  if (filters.agent !== "all") params.set("agent", filters.agent);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.query) params.set("q", filters.query);
  if (filters.needsAttention) params.set("attention", "true");
  if (filters.limit > 15 || overrides.limit) params.set("limit", overrides.limit ?? String(filters.limit));
  if (overrides.run) params.set("run", overrides.run);
  const query = params.toString();
  return query ? `/agent-operations/run-history?${query}` : "/agent-operations/run-history";
}

function formatDateTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}

function activityEndLabel(status: AgentRun["status"]) {
  if (status === "SUCCESS") return "Run completed successfully";
  if (status === "SKIPPED") return "Run skipped safely";
  if (status === "MISSED") return "Schedule monitor marked the run missed";
  if (status === "FAILED") return "Run failed safely";
  return "Run status updated";
}

function sourceLabel(source: AgentRunSource) {
  const labels: Record<AgentRunSource, string> = {
    AUTOMATION_JOB: "Automation job",
    ASSISTANT_AUTOMATION: "Assistant automation",
    GARLAND_EMAIL_SYNC: "Garland email sync",
    TEAMSHIP_DAILY_SYNC: "Teamship daily sync",
    TEAMSHIP_BROWSER_READ: "Teamship browser read",
    SCHEDULE_MONITOR: "Schedule monitor"
  };
  return labels[source];
}
