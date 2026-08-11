export const AGENT_KEYS = [
  "nemo",
  "hunter",
  "rivet",
  "website-scout",
  "teamship-reader",
  "garland-intake"
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_RUN_STATUSES = [
  "SCHEDULED",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "SKIPPED",
  "MISSED"
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export type AgentRunSource =
  | "AUTOMATION_JOB"
  | "ASSISTANT_AUTOMATION"
  | "GARLAND_EMAIL_SYNC"
  | "TEAMSHIP_DAILY_SYNC"
  | "TEAMSHIP_BROWSER_READ"
  | "SCHEDULE_MONITOR";

export type AgentRun = {
  id: string;
  sourceId: string;
  source: AgentRunSource;
  agentKey: AgentKey;
  agentName: string;
  assignment: string;
  status: AgentRunStatus;
  trigger: string;
  summary: string;
  reason: string | null;
  impact: string;
  nextStep: string;
  startedAt: Date;
  finishedAt: Date | null;
};
export type AgentScheduleEntry = {
  id: string;
  agentKey: AgentKey;
  agentName: string;
  assignment: string;
  cadence: string;
  timezone: string;
  nextRunAt: Date | null;
  status: "RUNNING" | "NEXT" | "SCHEDULED" | "NOT_CONFIGURED" | "OVERDUE";
  sourceNote: string;
};

export type AgentRosterEntry = {
  key: AgentKey;
  name: string;
  initials: string;
  status: "RUNNING" | "IDLE" | "SCHEDULED" | "NEEDS_ATTENTION" | "NOT_CONFIGURED";
  currentAssignment: string;
  activitySummary: string;
  scheduleSummary: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
};

export type AgentRunHistoryFilters = {
  range: "1" | "7" | "30" | "all";
  agent: AgentKey | "all";
  status: AgentRunStatus | "all";
  query: string;
  needsAttention: boolean;
  limit: number;
  selectedRunId: string | null;
};
