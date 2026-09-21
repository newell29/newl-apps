import { createHash } from "node:crypto";

export const MISSION_JOB = "WEBSITE_GROWTH_SCOUT_MISSION";
export const WORK_JOB = "WEBSITE_GROWTH_SCOUT_WORK";
export const STEP_JOB = "WEBSITE_GROWTH_SCOUT_STEP";
export const WAKE_JOB = "WEBSITE_GROWTH_SCOUT_WAKE";
export const LEASE_MS = 30 * 60 * 1000;
export const DAY_MS = 86_400_000;
export const WORK_KINDS = ["PAGE", "RELATIONSHIP", "MEASUREMENT", "RESEARCH"] as const;
export type WorkKind = typeof WORK_KINDS[number];
export type WorkState = "READY" | "WORKING" | "NEEDS_REVIEW" | "WAITING" | "DONE" | "DISMISSED";
export const WAIT_BLOCKER_TYPES = ["DATA_REFRESH", "PUBLIC_RESEARCH", "LOW_VOLUME", "OWNER_INPUT", "EXTERNAL_SYSTEM", "TECHNICAL"] as const;
export type WaitBlocker = {
  type: typeof WAIT_BLOCKER_TYPES[number];
  evidenceNeeded: string;
  resolutionAction: string;
  resolvableByScout: boolean;
};
export type Mission = {
  version: 1; objective: string; priorities: string; qualifiedLead: string;
  enabled: boolean; dailySteps: number; maxActive: number;
};
export const DEFAULT_MISSION: Mission = {
  version: 1, objective: "Grow qualified inbound enquiries through useful content and relevant industry relationships.",
  priorities: "Confirm priority services and markets before prioritizing campaigns.",
  qualifiedLead: "Requires owner definition. Form submissions are enquiries, not qualified leads.",
  enabled: false, dailySteps: 6, maxActive: 3
};
export type Work = {
  version: 1; revision: number; kind: WorkKind; referenceId: string | null;
  title: string; hypothesis: string; route: string | null; state: WorkState;
  nextAction: string; nextReviewAt: string; lease: string | null; leaseUntil: string | null;
  attempts: number; artifact: Record<string, unknown> | null; draftId: string | null;
  evidence: Record<string, unknown>; history: Array<{ at: string; action: string; summary: string }>;
};
export class ScoutWorkError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown, name: string, max = 4000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ScoutWorkError(`${name} is required (maximum ${max} characters).`);
  return value.trim();
}
export function stableId(tenantId: string, key: string) {
  return `scout_${createHash("sha256").update(`${tenantId}:${key}`).digest("hex").slice(0, 40)}`;
}
export function parseMission(value: unknown): Mission {
  const input = record(value);
  const dailySteps = Number(input.dailySteps), maxActive = Number(input.maxActive);
  if (typeof input.enabled !== "boolean" || !Number.isInteger(dailySteps) || dailySteps < 1 || dailySteps > 20 ||
      !Number.isInteger(maxActive) || maxActive < 1 || maxActive > 10) throw new ScoutWorkError("Choose 1–20 daily steps and 1–10 active items.");
  return { version: 1, objective: text(input.objective, "Objective", 1500), priorities: text(input.priorities, "Priorities", 2500),
    qualifiedLead: text(input.qualifiedLead, "Qualified enquiry definition", 1500), enabled: input.enabled, dailySteps, maxActive };
}
export function readWork(value: unknown): Work | null {
  const input = record(value);
  if (input.version !== 1 || !Number.isInteger(input.revision) || !WORK_KINDS.includes(input.kind as WorkKind) ||
      !["READY", "WORKING", "NEEDS_REVIEW", "WAITING", "DONE", "DISMISSED"].includes(String(input.state))) return null;
  return input as unknown as Work;
}
export function routePath(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = text(value, "Route", 500);
  const path = raw.startsWith("https://") ? new URL(raw).pathname : raw;
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\\s]/.test(path)) throw new ScoutWorkError("Use a website route such as /services/warehousing.");
  return path.replace(/\/+$/, "") || "/";
}
export function isDue(work: Work, now = new Date()) {
  if (work.evidence.externalWait === true) return false;
  if (work.state === "WORKING") return Date.parse(work.leaseUntil ?? "") <= now.getTime();
  return (work.state === "READY" || work.state === "WAITING") && Date.parse(work.nextReviewAt) <= now.getTime();
}
export function nextWork(work: Work, changes: Partial<Work>, action: string, summary: string, now = new Date()): Work {
  return { ...work, ...changes, revision: work.revision + 1,
    history: [...work.history, { at: now.toISOString(), action, summary }].slice(-40) };
}
export function newWork(kind: WorkKind, referenceId: string | null, title: string, hypothesis: string,
  route: string | null, evidence: Record<string, unknown> = {}, now = new Date()): Work {
  return { version: 1, revision: 0, kind, referenceId, title, hypothesis, route, state: "READY",
    nextAction: "Investigate the evidence, choose the next useful action, and save a concrete result or a dated reason to wait.",
    nextReviewAt: now.toISOString(), lease: null, leaseUntil: null, attempts: 0, artifact: null, draftId: null,
    evidence, history: [{ at: now.toISOString(), action: "CREATED", summary: hypothesis }] };
}
export function parseResult(value: unknown, now = new Date()) {
  const input = record(value);
  if (!["DELIVER", "WAIT", "DISMISS", "CONTINUE"].includes(String(input.decision))) throw new ScoutWorkError("Choose DELIVER, WAIT, DISMISS, or CONTINUE.");
  const summary = text(input.summary, "Result summary");
  const nextAction = text(input.nextAction, "Next action", 1500);
  const days = input.reviewInDays === undefined ? 7 : Number(input.reviewInDays);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new ScoutWorkError("Review interval must be 1–90 days.");
  const artifact = input.artifact === null || input.artifact === undefined ? null : record(input.artifact);
  if (artifact && JSON.stringify(artifact).length > 90_000) throw new ScoutWorkError("Result artifact is too large.");
  if (input.decision === "DELIVER" && (!artifact || !Object.keys(artifact).length)) throw new ScoutWorkError("Deliver a concrete artifact for review.");
  const blockerInput = record(input.waitBlocker);
  const waitBlocker = input.decision === "WAIT" && WAIT_BLOCKER_TYPES.includes(blockerInput.type as WaitBlocker["type"])
    ? {
        type: blockerInput.type as WaitBlocker["type"],
        evidenceNeeded: text(blockerInput.evidenceNeeded, "Evidence needed", 1500),
        resolutionAction: text(blockerInput.resolutionAction, "Resolution action", 1500),
        resolvableByScout: blockerInput.resolvableByScout === true
      }
    : null;
  const state: WorkState = input.decision === "DELIVER" ? "NEEDS_REVIEW" : input.decision === "DISMISS" ? "DISMISSED" : input.decision === "CONTINUE" ? "READY" : "WAITING";
  return { summary, nextAction, artifact, waitBlocker, state: state as WorkState, nextReviewAt: new Date(now.getTime() + (state === "READY" ? 0 : days * DAY_MS)).toISOString() };
}
