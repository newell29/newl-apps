import { ModuleKey } from "@prisma/client";
import Link from "next/link";

import { AgentAvatar, AgentStatusBadge, MetricCard } from "@/modules/agent-operations/components/agent-ui";
import { AgentOperationsLiveRefresh } from "@/modules/agent-operations/components/live-refresh";
import { AGENT_CATALOG } from "@/modules/agent-operations/presentation";
import { getAgentOperationsDashboard } from "@/modules/agent-operations/queries";
import type { AgentRosterEntry, AgentScheduleEntry } from "@/modules/agent-operations/types";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function AgentOperationsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);
  const dashboard = await getAgentOperationsDashboard(context);

  return (
    <div className="space-y-6">
      <AgentOperationsLiveRefresh />
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-border pb-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Company Assistant</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Agent Operations</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">
            See what every agent is doing now, when it will run next, and whether recent work needs attention.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-md border border-border bg-card px-3 py-2 font-medium text-foreground">{dashboard.timezone}</span>
          <span className="inline-flex items-center gap-2 text-mutedForeground">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            Live · refreshes every 15 seconds
          </span>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active agents" value={dashboard.summary.activeAgentCount} />
        <MetricCard label="Running now" value={dashboard.summary.runningCount} tone="success" />
        <MetricCard label="Runs today" value={dashboard.summary.todayRunCount} />
        <MetricCard
          label={dashboard.summary.attentionCount === 0 ? "All systems healthy" : "Need attention"}
          value={dashboard.summary.attentionCount === 0 ? "Healthy" : dashboard.summary.attentionCount}
          tone={dashboard.summary.attentionCount === 0 ? "success" : "danger"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Upcoming schedule</h2>
              <p className="mt-1 text-sm text-mutedForeground">Declared application and local-worker schedules.</p>
            </div>
            <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-mutedForeground">
              {formatDate(dashboard.updatedAt, dashboard.timezone)}
            </span>
          </div>
          <div className="divide-y divide-border">
            {dashboard.schedules.map((schedule) => (
              <ScheduleRow key={schedule.id} schedule={schedule} />
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Live activity</h2>
              <p className="mt-1 text-sm text-mutedForeground">Latest tenant-scoped activity for every known agent.</p>
            </div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-mutedForeground">
              <span className="h-2 w-2 rounded-full bg-primary" />
              {dashboard.summary.runningCount} running
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {dashboard.liveAgents.map((agent) => (
              <LiveActivityCard key={agent.key} agent={agent} />
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Agent roster</h2>
            <p className="mt-1 text-sm text-mutedForeground">Current assignment, declared cadence, and latest observed run.</p>
          </div>
          <Link
            href="/agent-operations/run-history"
            className="rounded-md border border-primary px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primaryForeground"
          >
            View run history
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] divide-y divide-border text-sm">
            <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-5 py-3">Agent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Current assignment</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Last run</th>
                <th className="px-5 py-3">Next run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {dashboard.roster.map((agent) => (
                <tr key={agent.key} className="align-top hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <AgentAvatar agentKey={agent.key} initials={agent.initials} size="sm" />
                      <span className="font-semibold text-foreground">{agent.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><AgentStatusBadge value={agent.status} /></td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{agent.currentAssignment}</p>
                    <p className="mt-1 max-w-md text-xs leading-5 text-mutedForeground">{agent.activitySummary}</p>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-mutedForeground">{agent.scheduleSummary}</td>
                  <td className="px-4 py-3 text-mutedForeground">{formatDateTime(agent.lastRunAt, dashboard.timezone)}</td>
                  <td className="px-5 py-3 text-mutedForeground">{formatDateTime(agent.nextRunAt, dashboard.timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
function ScheduleRow({ schedule }: { schedule: AgentScheduleEntry }) {
  const catalog = AGENT_CATALOG[schedule.agentKey];
  return (
    <div className="grid gap-3 px-5 py-3 sm:grid-cols-[100px_1fr_auto] sm:items-center">
      <p className="text-sm font-semibold text-foreground">
        {schedule.nextRunAt ? formatTime(schedule.nextRunAt, schedule.timezone) : "Not declared"}
      </p>
      <div className="flex min-w-0 items-center gap-3">
        <AgentAvatar agentKey={schedule.agentKey} initials={catalog.initials} size="sm" />
        <div className="min-w-0">
          <p className="font-medium text-foreground">{schedule.agentName}</p>
          <p className="truncate text-sm text-mutedForeground">{schedule.assignment}</p>
          <p className="mt-0.5 text-xs text-mutedForeground">{schedule.cadence} · {schedule.sourceNote}</p>
        </div>
      </div>
      <AgentStatusBadge value={schedule.status} />
    </div>
  );
}

function LiveActivityCard({ agent }: { agent: AgentRosterEntry }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-start gap-3">
        <AgentAvatar agentKey={agent.key} initials={agent.initials} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-foreground">{agent.name}</p>
            <AgentStatusBadge value={agent.status} />
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">{agent.currentAssignment}</p>
          <p className={`mt-1 text-xs leading-5 ${agent.status === "NEEDS_ATTENTION" ? "text-danger" : "text-mutedForeground"}`}>
            {agent.activitySummary}
          </p>
        </div>
      </div>
    </div>
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(value);
}

function formatDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" }).format(value);
}

function formatDateTime(value: Date | null, timeZone: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}
