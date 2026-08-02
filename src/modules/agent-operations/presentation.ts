import {
  AGENT_KEYS,
  AGENT_RUN_STATUSES,
  type AgentKey,
  type AgentRun,
  type AgentRunHistoryFilters,
  type AgentRunStatus
} from "@/modules/agent-operations/types";

export const AGENT_RUN_PAGE_SIZE = 15;
export const AGENT_RUN_MAX_VISIBLE = 150;

export const AGENT_CATALOG: Record<AgentKey, { name: string; initials: string }> = {
  nemo: { name: "Nemo", initials: "NE" },
  hunter: { name: "Hunter", initials: "HU" },
  rivet: { name: "Rivet", initials: "RI" },
  "website-scout": { name: "Website Scout", initials: "WS" },
  "teamship-reader": { name: "Teamship Reader", initials: "TR" },
  "garland-intake": { name: "Garland Intake", initials: "GI" }
};

const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._~+/=-]+/gi,
  /(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  /https?:\/\/[^\s]+/gi
];

export function sanitizeOperationalText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  let normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;

  for (const pattern of SECRET_PATTERNS) {
    normalized = normalized.replace(pattern, "[redacted]");
  }

  return normalized.length > 240 ? `${normalized.slice(0, 237).trimEnd()}...` : normalized;
}
export function normalizeAgentRunStatus(value: string): AgentRunStatus {
  const status = value.trim().toUpperCase();
  if (["SUCCESS", "COMPLETED", "COMPLETE", "SUCCEEDED"].includes(status)) return "SUCCESS";
  if (["ERROR", "FAILED", "FAILURE", "EXPIRED"].includes(status)) return "FAILED";
  if (["CANCELLED", "CANCELED", "SKIPPED", "NO_OP"].includes(status)) return "SKIPPED";
  if (["RUNNING", "CLAIMED", "PROCESSING", "IN_PROGRESS"].includes(status)) return "RUNNING";
  return "SCHEDULED";
}

export function normalizeRunHistoryFilters(input: Record<string, string | string[] | undefined>): AgentRunHistoryFilters {
  const range = readOne(input.range);
  const agent = readOne(input.agent);
  const status = readOne(input.status)?.toUpperCase();
  const requestedLimit = Number(readOne(input.limit));
  const roundedLimit = Number.isFinite(requestedLimit)
    ? Math.ceil(Math.max(AGENT_RUN_PAGE_SIZE, requestedLimit) / AGENT_RUN_PAGE_SIZE) * AGENT_RUN_PAGE_SIZE
    : AGENT_RUN_PAGE_SIZE;

  return {
    range: range === "1" || range === "30" || range === "all" ? range : "7",
    agent: AGENT_KEYS.includes(agent as AgentKey) ? (agent as AgentKey) : "all",
    status: AGENT_RUN_STATUSES.includes(status as AgentRunStatus) ? (status as AgentRunStatus) : "all",
    query: (readOne(input.q) ?? "").trim().slice(0, 120),
    needsAttention: readOne(input.attention) === "true",
    limit: Math.min(AGENT_RUN_MAX_VISIBLE, roundedLimit),
    selectedRunId: (readOne(input.run) ?? "").trim() || null
  };
}

export function filterAgentRuns(runs: AgentRun[], filters: AgentRunHistoryFilters, now: Date) {
  const earliest = filters.range === "all"
    ? null
    : new Date(now.getTime() - Number(filters.range) * 24 * 60 * 60 * 1000);
  const normalizedQuery = filters.query.toLowerCase();

  return runs.filter((run) => {
    if (earliest && run.startedAt < earliest) return false;
    if (filters.agent !== "all" && run.agentKey !== filters.agent) return false;
    if (filters.status !== "all" && run.status !== filters.status) return false;
    if (filters.needsAttention && !isNeedsAttention(run.status)) return false;
    if (!normalizedQuery) return true;

    return [run.id, run.agentName, run.assignment, run.summary, run.reason, run.trigger]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery));
  });
}

export function isNeedsAttention(status: AgentRunStatus) {
  return status === "FAILED" || status === "SKIPPED" || status === "MISSED";
}

export function durationMilliseconds(run: Pick<AgentRun, "startedAt" | "finishedAt">, now = new Date()) {
  const end = run.finishedAt ?? now;
  return Math.max(0, end.getTime() - run.startedAt.getTime());
}

export function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return "<1s";
  const totalSeconds = Math.round(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function readOne(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
