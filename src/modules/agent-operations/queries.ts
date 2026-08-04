import { computeNextAssistantAutomationRunAt } from "@/modules/assistant/automations";
import {
  AGENT_CATALOG,
  filterAgentRuns,
  isNeedsAttention,
  normalizeAgentRunStatus,
  sanitizeOperationalText
} from "@/modules/agent-operations/presentation";
import type {
  AgentKey,
  AgentRosterEntry,
  AgentRun,
  AgentRunHistoryFilters,
  AgentScheduleEntry
} from "@/modules/agent-operations/types";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";

const SOURCE_FETCH_LIMIT = 500;
const DEFAULT_TIMEZONE = "America/Toronto";
const MISSED_RUN_GRACE_MS = 5 * 60 * 1000;

const AUTOMATION_JOB_ASSIGNMENTS: Record<string, { agentKey: AgentKey; assignment: string }> = {
  "trademining.ingestion": { agentKey: "hunter", assignment: "Import TradeMining results" },
  "trademining.run_request": { agentKey: "hunter", assignment: "Request TradeMining search" },
  HUNTER_DAILY_PROSPECTING_PLAN: { agentKey: "hunter", assignment: "Build daily prospecting plan" },
  HUNTER_EXTERNAL_SIGNAL_SCOUT: { agentKey: "hunter", assignment: "Refresh external opportunity signals" },
  HUNTER_COMPANY_DEEP_RESEARCH: { agentKey: "hunter", assignment: "Research qualified WMS companies" },
  HUNTER_OUTREACH_HANDOFF: { agentKey: "hunter", assignment: "Prepare outreach handoff" },
  HUNTER_QUALITY_AUDIT: { agentKey: "rivet", assignment: "Audit Hunter research quality" },
  HUNTER_QUALITY_INCIDENT: { agentKey: "rivet", assignment: "Review Hunter quality incident" },
  ASSISTANT_RIVET_DEVELOPMENT: { agentKey: "rivet", assignment: "Prepare an approved code change" },
  WEBSITE_GROWTH_SCOUT_WEEKLY: { agentKey: "website-scout", assignment: "Refresh growth opportunities" },
  WEBSITE_GROWTH_SCOUT_WEEKDAY_CHECKIN: { agentKey: "website-scout", assignment: "Refresh website growth evidence" },
  WEBSITE_GROWTH_BACKLINK_OUTREACH: { agentKey: "website-scout", assignment: "Process approved backlink outreach" },
  WEBSITE_GROWTH_BACKLINK_EXECUTOR_FAILURE: { agentKey: "website-scout", assignment: "Review backlink delivery failures" },
  WEBSITE_GROWTH_DEVELOPER_BUILD: { agentKey: "website-scout", assignment: "Prepare an approved website change" }
};

const SUPPORTED_AUTOMATION_JOB_TYPES = Object.keys(AUTOMATION_JOB_ASSIGNMENTS);

type AgentOperationData = Awaited<ReturnType<typeof loadAgentOperationData>>;

export async function getAgentOperationsDashboard(tenant: Pick<TenantContext, "tenantId">, now = new Date()) {
  const data = await loadAgentOperationData(tenant.tenantId);
  const runs = buildAgentRuns(data, now);
  const schedules = buildAgentSchedules(data, runs, now);
  const roster = buildAgentRoster(runs, schedules, now);
  const todayKey = localDateKey(now, DEFAULT_TIMEZONE);
  const todayRuns = runs.filter((run) => localDateKey(run.startedAt, DEFAULT_TIMEZONE) === todayKey);
  const recentAttention = runs.filter(
    (run) => isNeedsAttention(run.status) && run.startedAt >= new Date(now.getTime() - 24 * 60 * 60 * 1000)
  );

  return {
    timezone: DEFAULT_TIMEZONE,
    updatedAt: now,
    summary: {
      activeAgentCount: roster.filter((agent) => agent.status !== "NOT_CONFIGURED").length,
      runningCount: roster.filter((agent) => agent.status === "RUNNING").length,
      todayRunCount: todayRuns.length,
      attentionCount: recentAttention.length
    },
    schedules,
    roster,
    liveAgents: roster,
    recentRuns: runs.slice(0, 8)
  };
}

export async function getAgentRunHistory(
  tenant: Pick<TenantContext, "tenantId">,
  filters: AgentRunHistoryFilters,
  now = new Date()
) {
  const data = await loadAgentOperationData(tenant.tenantId);
  const allRuns = buildAgentRuns(data, now);
  const filteredRuns = filterAgentRuns(allRuns, filters, now);
  const visibleRuns = filteredRuns.slice(0, filters.limit);
  const selectedRun =
    filteredRuns.find((run) => run.id === filters.selectedRunId) ??
    visibleRuns.find((run) => isNeedsAttention(run.status)) ??
    visibleRuns[0] ??
    null;

  return {
    timezone: DEFAULT_TIMEZONE,
    updatedAt: now,
    filters,
    runs: visibleRuns,
    selectedRun,
    totalMatching: filteredRuns.length,
    hasMore: visibleRuns.length < filteredRuns.length,
    nextLimit: Math.min(filters.limit + 15, 150),
    summary: {
      total: filteredRuns.length,
      successful: filteredRuns.filter((run) => run.status === "SUCCESS").length,
      skipped: filteredRuns.filter((run) => run.status === "SKIPPED").length,
      failed: filteredRuns.filter((run) => run.status === "FAILED" || run.status === "MISSED").length
    }
  };
}

async function loadAgentOperationData(tenantId: string) {
  return Promise.all([
    prisma.automationJobRun.findMany({
      where: { tenantId, jobType: { in: SUPPORTED_AUTOMATION_JOB_TYPES } },
      orderBy: { startedAt: "desc" },
      take: SOURCE_FETCH_LIMIT,
      select: {
        id: true,
        jobType: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        input: true,
        output: true,
        errorMessage: true
      }
    }),
    prisma.assistantAutomationRun.findMany({
      where: { tenantId },
      orderBy: { startedAt: "desc" },
      take: SOURCE_FETCH_LIMIT,
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        responseText: true,
        metadata: true,
        automation: {
          select: { id: true, name: true, scheduleType: true, scheduleTime: true, scheduleTimezone: true }
        }
      }
    }),
    prisma.assistantAutomation.findMany({
      where: { tenantId, status: "ACTIVE" },
      orderBy: [{ nextRunAt: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        scheduleType: true,
        scheduleTime: true,
        scheduleTimezone: true,
        lastRunAt: true,
        nextRunAt: true,
        lastResultSummary: true
      }
    }),
    prisma.garlandEmailSyncRun.findMany({
      where: { tenantId },
      orderBy: { startedAt: "desc" },
      take: SOURCE_FETCH_LIMIT,
      select: {
        id: true,
        triggerSource: true,
        status: true,
        messageCount: true,
        candidateMessageCount: true,
        storedAttachmentCount: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true
      }
    }),
    prisma.teamshipDailySyncRun.findMany({
      where: { tenantId },
      orderBy: { startedAt: "desc" },
      take: SOURCE_FETCH_LIMIT,
      select: {
        id: true,
        triggerSource: true,
        status: true,
        fetchedCount: true,
        insertedCount: true,
        updatedCount: true,
        skippedCount: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true
      }
    }),
    prisma.teamshipBrowserReadJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: SOURCE_FETCH_LIMIT,
      select: {
        id: true,
        status: true,
        operation: true,
        errorCode: true,
        errorMessage: true,
        claimedAt: true,
        completedAt: true,
        failedAt: true,
        createdAt: true,
        result: true
      }
    })
  ]).then(([automationJobs, assistantRuns, assistantAutomations, garlandRuns, dailySyncRuns, browserReadJobs]) => ({
    automationJobs,
    assistantRuns,
    assistantAutomations,
    garlandRuns,
    dailySyncRuns,
    browserReadJobs
  }));
}

function buildAgentRuns(data: AgentOperationData, now: Date): AgentRun[] {
  const runs: AgentRun[] = [
    ...data.automationJobs.map((row) => {
      const definition = AUTOMATION_JOB_ASSIGNMENTS[row.jobType];
      const status = normalizeAgentRunStatus(row.status);
      const input = asRecord(row.input);
      const output = asRecord(row.output);
      return createRun({
        id: `automation-job:${row.id}`,
        sourceId: row.id,
        source: "AUTOMATION_JOB",
        agentKey: definition.agentKey,
        assignment: definition.assignment,
        status,
        trigger: readText(input, ["trigger", "source"]) ?? "Scheduled or workflow-triggered",
        summary: summarizeAutomationJob(output, definition.assignment, status),
        reason: reasonForStatus(status, row.errorMessage, output),
        impact: summarizeAutomationImpact(output, status),
        startedAt: row.startedAt,
        finishedAt: row.finishedAt
      });
    }),
    ...data.assistantRuns.map((row) => {
      const status = normalizeAgentRunStatus(row.status);
      const metadata = asRecord(row.metadata);
      return createRun({
        id: `assistant-automation:${row.id}`,
        sourceId: row.id,
        source: "ASSISTANT_AUTOMATION",
        agentKey: "nemo",
        assignment: row.automation.name,
        status,
        trigger: "Scheduled automation",
        summary: sanitizeOperationalText(row.responseText, `${row.automation.name} ${status.toLowerCase()}.`),
        reason: reasonForStatus(status, readText(metadata, ["error", "reason"]), metadata),
        impact: status === "SUCCESS" ? "The scheduled assistant response was completed." : defaultImpact(status),
        startedAt: row.startedAt,
        finishedAt: row.finishedAt
      });
    }),
    ...data.garlandRuns.map((row) => {
      const status = normalizeAgentRunStatus(row.status);
      return createRun({
        id: `garland-email-sync:${row.id}`,
        sourceId: row.id,
        source: "GARLAND_EMAIL_SYNC",
        agentKey: "garland-intake",
        assignment: "Process Garland inbox attachments",
        status,
        trigger: row.triggerSource,
        summary: `${row.messageCount} messages checked · ${row.candidateMessageCount} candidates · ${row.storedAttachmentCount} attachments stored`,
        reason: reasonForStatus(status, row.errorMessage, null),
        impact: status === "SUCCESS"
          ? `${row.storedAttachmentCount} eligible attachments were stored for downstream review.`
          : defaultImpact(status),
        startedAt: row.startedAt,
        finishedAt: row.finishedAt
      });
    }),
    ...data.dailySyncRuns.map((row) => {
      const status = normalizeAgentRunStatus(row.status);
      return createRun({
        id: `teamship-daily-sync:${row.id}`,
        sourceId: row.id,
        source: "TEAMSHIP_DAILY_SYNC",
        agentKey: "teamship-reader",
        assignment: "Sync Teamship daily orders",
        status,
        trigger: row.triggerSource,
        summary: `${row.fetchedCount} orders fetched · ${row.insertedCount} added · ${row.updatedCount} updated`,
        reason: reasonForStatus(status, row.errorMessage, null),
        impact: status === "SUCCESS"
          ? `${row.fetchedCount} orders checked · ${row.skippedCount} unchanged or skipped.`
          : defaultImpact(status),
        startedAt: row.startedAt,
        finishedAt: row.finishedAt
      });
    }),
    ...data.browserReadJobs.map((row) => {
      const status = normalizeAgentRunStatus(row.status);
      return createRun({
        id: `teamship-browser-read:${row.id}`,
        sourceId: row.id,
        source: "TEAMSHIP_BROWSER_READ",
        agentKey: "teamship-reader",
        assignment: browserReadAssignment(row.operation),
        status,
        trigger: "Assistant request",
        summary: browserReadSummary(row.result, status),
        reason: reasonForStatus(status, row.errorMessage ?? row.errorCode, asRecord(row.result)),
        impact: status === "SUCCESS" ? "Read-only Teamship results were returned to the requesting workflow." : defaultImpact(status),
        startedAt: row.claimedAt ?? row.createdAt,
        finishedAt: row.completedAt ?? row.failedAt
      });
    }),
    ...buildMissedAssistantRuns(data, now)
  ];

  return runs.sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
}

function buildMissedAssistantRuns(data: AgentOperationData, now: Date): AgentRun[] {
  return data.assistantAutomations.flatMap((automation) => {
    if (!automation.nextRunAt || automation.nextRunAt.getTime() + MISSED_RUN_GRACE_MS > now.getTime()) return [];
    if (automation.lastRunAt && automation.lastRunAt >= automation.nextRunAt) return [];

    return [createRun({
      id: `schedule-monitor:${automation.id}:${automation.nextRunAt.toISOString()}`,
      sourceId: automation.id,
      source: "SCHEDULE_MONITOR",
      agentKey: "nemo",
      assignment: automation.name,
      status: "MISSED",
      trigger: "Schedule monitor",
      summary: "No run record was received for the expected schedule.",
      reason: "The scheduled time passed without a recorded start. The scheduler or worker did not report a more specific cause.",
      impact: "No result was recorded for this scheduled assistant automation.",
      startedAt: automation.nextRunAt,
      finishedAt: automation.nextRunAt
    })];
  });
}

function buildAgentSchedules(data: AgentOperationData, runs: AgentRun[], now: Date): AgentScheduleEntry[] {
  const activeRunKeys = new Set(runs.filter((run) => run.status === "RUNNING").map((run) => run.agentKey));
  const schedules: AgentScheduleEntry[] = data.assistantAutomations.map((automation) => ({
    id: `nemo:${automation.id}`,
    agentKey: "nemo" as const,
    agentName: AGENT_CATALOG.nemo.name,
    assignment: automation.name,
    cadence: `${formatScheduleType(automation.scheduleType)} at ${automation.scheduleTime}`,
    timezone: automation.scheduleTimezone,
    nextRunAt: automation.nextRunAt,
    status: automation.nextRunAt && automation.nextRunAt < now ? "OVERDUE" : activeRunKeys.has("nemo") ? "RUNNING" : "SCHEDULED",
    sourceNote: "Configured in Newl Apps"
  }));

  if (schedules.length === 0) {
    schedules.push({
      id: "nemo:not-configured",
      agentKey: "nemo",
      agentName: AGENT_CATALOG.nemo.name,
      assignment: "No active assistant automation",
      cadence: "Not configured",
      timezone: DEFAULT_TIMEZONE,
      nextRunAt: null,
      status: "NOT_CONFIGURED",
      sourceNote: "Create an assistant automation to declare a schedule"
    });
  }

  schedules.push(
    declaredSchedule("hunter:signals", "hunter", "Refresh external opportunity signals", "DAILY", "02:30", "Daily at 02:30", now, activeRunKeys),
    declaredSchedule("hunter:imports", "hunter", "Run TradeMining profiles", "DAILY", "04:00", "Daily at 04:00", now, activeRunKeys),
    declaredSchedule("hunter:research", "hunter", "Research qualified companies", "DAILY", "05:45", "After 05:45 once today's TradeMining profiles settle", now, activeRunKeys),
    {
      id: "rivet:developer",
      agentKey: "rivet",
      agentName: AGENT_CATALOG.rivet.name,
      assignment: "Check approved development queue",
      cadence: "Every minute",
      timezone: DEFAULT_TIMEZONE,
      nextRunAt: new Date(Math.ceil(now.getTime() / 60_000) * 60_000),
      status: activeRunKeys.has("rivet") ? "RUNNING" : "NEXT",
      sourceNote: "Declared OpenClaw schedule"
    },
    declaredSchedule("rivet:quality", "rivet", "Audit Hunter research quality", "DAILY", "13:30", "Daily at 13:30", now, activeRunKeys),
    declaredSchedule(
      "website-scout:scan",
      "website-scout",
      "Refresh website growth evidence",
      "WEEKDAYS",
      "09:15",
      "Mon/Wed deep research · Tue/Thu/Fri evidence check-in at 09:15",
      now,
      activeRunKeys
    ),
    declaredSchedule(
      "website-scout:outreach",
      "website-scout",
      "Process approved backlink outreach",
      "WEEKDAYS",
      "11:00",
      "Weekdays at 11:00",
      now,
      activeRunKeys
    ),
    {
      id: "website-scout:build-notifications",
      agentKey: "website-scout",
      agentName: AGENT_CATALOG["website-scout"].name,
      assignment: "Check website-build notifications",
      cadence: "Every 2 minutes",
      timezone: DEFAULT_TIMEZONE,
      nextRunAt: new Date(Math.ceil(now.getTime() / 120_000) * 120_000),
      status: activeRunKeys.has("website-scout") ? "RUNNING" : "NEXT",
      sourceNote: "Declared OpenClaw schedule"
    },
    {
      id: "teamship-reader:poll",
      agentKey: "teamship-reader",
      agentName: AGENT_CATALOG["teamship-reader"].name,
      assignment: "Monitor queued Teamship read requests",
      cadence: "Always on · polls every 2 seconds by default",
      timezone: DEFAULT_TIMEZONE,
      nextRunAt: now,
      status: activeRunKeys.has("teamship-reader") ? "RUNNING" : "NEXT",
      sourceNote: "Declared local worker default"
    },
    {
      id: "garland-intake:external",
      agentKey: "garland-intake",
      agentName: AGENT_CATALOG["garland-intake"].name,
      assignment: "Process Garland inbox attachments",
      cadence: "External scheduler · frequency not declared in Newl Apps",
      timezone: DEFAULT_TIMEZONE,
      nextRunAt: null,
      status: activeRunKeys.has("garland-intake") ? "RUNNING" : "NOT_CONFIGURED",
      sourceNote: "Run records are visible; the external cadence is not centrally declared"
    }
  );

  return schedules.sort((left, right) => {
    if (!left.nextRunAt) return 1;
    if (!right.nextRunAt) return -1;
    return left.nextRunAt.getTime() - right.nextRunAt.getTime();
  });
}

function buildAgentRoster(runs: AgentRun[], schedules: AgentScheduleEntry[], now: Date): AgentRosterEntry[] {
  return (Object.keys(AGENT_CATALOG) as AgentKey[]).map((key) => {
    const latestRun = runs.find((run) => run.agentKey === key) ?? null;
    const agentSchedules = schedules.filter((schedule) => schedule.agentKey === key);
    const nextSchedule = agentSchedules.find((schedule) => schedule.nextRunAt && schedule.nextRunAt >= now) ?? null;
    const isRunning = runs.some((run) => run.agentKey === key && run.status === "RUNNING");
    const needsAttention = latestRun ? isNeedsAttention(latestRun.status) : false;
    const notConfigured = agentSchedules.every((schedule) => schedule.status === "NOT_CONFIGURED");
    const status = isRunning
      ? "RUNNING"
      : needsAttention
        ? "NEEDS_ATTENTION"
        : notConfigured
          ? "NOT_CONFIGURED"
          : nextSchedule
            ? "SCHEDULED"
            : "IDLE";

    return {
      key,
      name: AGENT_CATALOG[key].name,
      initials: AGENT_CATALOG[key].initials,
      status,
      currentAssignment: isRunning
        ? runs.find((run) => run.agentKey === key && run.status === "RUNNING")?.assignment ?? "Working"
        : latestRun?.assignment ?? defaultWaitingAssignment(key),
      activitySummary: latestRun
        ? latestRun.reason ?? latestRun.summary
        : "No tenant-scoped run has been recorded yet.",
      scheduleSummary: agentSchedules.map((schedule) => schedule.cadence).join(" · "),
      lastRunAt: latestRun?.startedAt ?? null,
      nextRunAt: nextSchedule?.nextRunAt ?? null
    };
  });
}

function declaredSchedule(
  id: string,
  agentKey: AgentKey,
  assignment: string,
  scheduleType: "DAILY" | "WEEKDAYS",
  scheduleTime: string,
  cadence: string,
  now: Date,
  activeRunKeys: Set<AgentKey>
): AgentScheduleEntry {
  return {
    id,
    agentKey,
    agentName: AGENT_CATALOG[agentKey].name,
    assignment,
    cadence,
    timezone: DEFAULT_TIMEZONE,
    nextRunAt: computeNextAssistantAutomationRunAt(scheduleType, scheduleTime, DEFAULT_TIMEZONE, now),
    status: activeRunKeys.has(agentKey) ? "RUNNING" : "SCHEDULED",
    sourceNote: "Declared runtime default"
  };
}

function createRun(input: Omit<AgentRun, "agentName" | "nextStep">): AgentRun {
  return {
    ...input,
    agentName: AGENT_CATALOG[input.agentKey].name,
    nextStep: nextStepForStatus(input.status)
  };
}

function reasonForStatus(status: AgentRun["status"], errorMessage: unknown, output: Record<string, unknown> | null) {
  if (status !== "FAILED" && status !== "SKIPPED" && status !== "MISSED") return null;
  const outputReason = output ? readText(output, ["skipReason", "reason", "error", "message"]) : null;
  return sanitizeOperationalText(
    errorMessage ?? outputReason,
    status === "SKIPPED"
      ? "The source workflow marked this run as skipped without reporting a more specific reason."
      : "The source workflow did not report a more specific failure reason."
  );
}

function summarizeAutomationJob(output: Record<string, unknown>, assignment: string, status: AgentRun["status"]) {
  return sanitizeOperationalText(
    readText(output, ["summary", "message", "phase", "state"]),
    status === "RUNNING" ? `${assignment} is in progress.` : `${assignment} ${status.toLowerCase()}.`
  );
}

function summarizeAutomationImpact(output: Record<string, unknown>, status: AgentRun["status"]) {
  const counts = [
    ["processed", readNumber(output, ["recordsProcessed", "processedCount", "processed"])],
    ["created", readNumber(output, ["recordsCreated", "createdCount", "created"])],
    ["updated", readNumber(output, ["recordsUpdated", "updatedCount", "updated"])],
    ["failed", readNumber(output, ["failedCount", "errors"])]
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number");

  if (counts.length > 0) return counts.map(([label, count]) => `${count} ${label}`).join(" · ");
  return status === "SUCCESS" ? "The source run completed without a structured impact count." : defaultImpact(status);
}

function defaultImpact(status: AgentRun["status"]) {
  if (status === "SKIPPED") return "The run ended before its assignment was processed.";
  if (status === "MISSED") return "No run result was recorded for the expected schedule.";
  if (status === "FAILED") return "The source run did not report a structured impact summary.";
  if (status === "RUNNING") return "Impact will be available after the run finishes.";
  return "No impact summary was reported.";
}

function nextStepForStatus(status: AgentRun["status"]) {
  if (status === "FAILED") return "Review the reason and source workflow before the next scheduled attempt.";
  if (status === "MISSED") return "Check scheduler and worker health; Newl Apps will continue watching the declared schedule.";
  if (status === "SKIPPED") return "No work was started; the next declared schedule remains available.";
  if (status === "RUNNING") return "The page will refresh while this run is active.";
  if (status === "SCHEDULED") return "The run is waiting for its scheduled or workflow trigger.";
  return "No follow-up is required unless the downstream result needs review.";
}

function browserReadAssignment(operation: string) {
  const labels: Record<string, string> = {
    searchInventoryAll: "Read Teamship inventory",
    searchLpn: "Read Teamship LPN details",
    getReceivingOrder: "Read Teamship receiving order",
    getProductHistory: "Read Teamship product history",
    getShippingOrderPallets: "Read Teamship shipping-order pallets"
  };
  return labels[operation] ?? "Run a read-only Teamship lookup";
}

function browserReadSummary(result: unknown, status: AgentRun["status"]) {
  const record = asRecord(result);
  const rows = Array.isArray(record.rows) ? record.rows.length : null;
  if (rows != null) return `${rows} read-only rows returned.`;
  return status === "RUNNING" ? "The read-only Teamship lookup is in progress." : `Teamship lookup ${status.toLowerCase()}.`;
}

function defaultWaitingAssignment(key: AgentKey) {
  const values: Record<AgentKey, string> = {
    nemo: "Waiting for a configured assistant automation",
    hunter: "Waiting for the next Hunter window",
    rivet: "Waiting for approved development work",
    "website-scout": "Waiting for the next growth scan",
    "teamship-reader": "Monitoring queued Teamship reads",
    "garland-intake": "Monitoring scheduled Garland intake"
  };
  return values[key];
}

function formatScheduleType(value: string) {
  if (value === "WEEKDAYS") return "Weekdays";
  if (value === "MONDAYS") return "Mondays";
  return "Daily";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return null;
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === "number" && Number.isFinite(record[key])) return record[key];
  }
  return null;
}

function localDateKey(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
