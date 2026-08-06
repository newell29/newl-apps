import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { join } from "node:path";

import { validateWorkflowPlan, WorkflowPlan } from "./planner";
import { validateReviewDecision, type ReviewDecision } from "./reviewer";

export const FEATURE_STATE_SCHEMA_VERSION = 1;

export type WorkflowStage =
  | "registered"
  | "ready"
  | "preflight"
  | "planning"
  | "awaiting_phase_approval"
  | "waiting_questions"
  | "implementing"
  | "verifying"
  | "correcting"
  | "correction_required"
  | "reviewing"
  | "review_failed"
  | "recovering_review"
  | "phase_approved"
  | "awaiting_next_action"
  | "paused"
  | "interrupted"
  | "escalated"
  | "complete";

export type RegisteredArtifact = {
  kind: "handoff_markdown" | "handoff_json" | "review_evidence";
  sourcePath: string;
  registryPath: string;
  worktreePath: string;
  sha256: string;
  size: number;
};

export type OwnerQuestionRecord = {
  id: string;
  phaseId: string | null;
  planHash: string;
  questionHash: string;
  text: string;
  type: "multiple_choice" | "yes_no" | "free_text";
  choices: Array<{ value: string; label: string }>;
  evidence: string[];
  whyItMatters: string;
  blocking: boolean;
  answer: string | null;
  explanation: string | null;
  confirmedAt: string | null;
};

export type PhaseRecord = {
  id: string;
  title: string;
  risk: "low" | "medium" | "high" | "owner_gated";
  status: "pending" | "approved_to_run" | "running" | "approved" | "blocked" | "failed";
  approvedAt: string | null;
  completedAt: string | null;
  startDiffHash: string | null;
  approvedDiffHash: string | null;
  reviewCycles: number;
  retryCount: number;
};

export type CorrectionBoundary = {
  schemaVersion: 1;
  phaseId: string;
  source: "verification" | "review";
  corrections: string[];
  reviewDecision: ReviewDecision | null;
  phaseRetries: number;
  phaseReviewCycles: number;
  escalationUsed: boolean;
  nextModel: "builder" | "escalation";
  ownerActionRequired: boolean;
  branch: string;
  baseCommit: string;
  headCommit: string;
  diffHash: string;
  recordedAt: string;
};

export type FeatureState = {
  schemaVersion: 1;
  featureSlug: string;
  featureTitle: string;
  originalRequest: string;
  originalRequestHash: string;
  branch: string;
  worktree: string;
  baseCommit: string;
  headCommit: string;
  currentDiffHash: string;
  stage: WorkflowStage;
  plan: WorkflowPlan | null;
  planHash: string | null;
  requestPath: string | null;
  requestHash: string | null;
  currentPhaseId: string | null;
  phases: PhaseRecord[];
  questions: OwnerQuestionRecord[];
  artifacts: RegisteredArtifact[];
  selectedModels: {
    plannerModel: string;
    builderModel: string;
    reviewerModel: string;
    escalationModel?: string;
  } | null;
  modelSessions: Array<{
    role: "planner" | "builder" | "reviewer";
    phaseId: string | null;
    sessionId: string | null;
    messageId: string | null;
    textPartIds?: string[];
    finishReason?: string | null;
    cost?: number | null;
    tokens?: {
      input: number;
      output: number;
      reasoning: number;
      cacheRead: number;
    } | null;
    recordedAt: string;
  }>;
  verificationHistory: Array<{
    phaseId: string;
    diffHash: string;
    passed: boolean;
    recordedAt: string;
    commands: Array<{
      name: string;
      passed: boolean;
      exitCode: number | null;
      durationMs: number;
    }>;
  }>;
  phaseMetrics: Array<{
    phaseId: string;
    totalTimeMs: number;
    totalApiCost: number | null;
    retryCount: number;
    reviewCycles: number;
    filesChanged: string[];
    testsExecuted: string[];
    completedAt: string;
  }>;
  retryCount: number;
  reviewCycles: number;
  correctionBoundary: CorrectionBoundary | null;
  diagnosticArtifacts: string[];
  finalOutcome: string | null;
  eventSequence: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowEvent = {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  featureSlug: string;
  phaseId: string | null;
  type: string;
  stage: WorkflowStage;
  message: string;
  data?: Record<string, string | number | boolean | null>;
};

const allowedTransitions: Record<WorkflowStage, WorkflowStage[]> = {
  registered: ["ready", "preflight", "paused"],
  ready: [
    "preflight",
    "planning",
    "awaiting_phase_approval",
    "awaiting_next_action",
    "review_failed",
    "interrupted",
    "paused"
  ],
  preflight: [
    "planning",
    "awaiting_phase_approval",
    "recovering_review",
    "correcting",
    "interrupted"
  ],
  planning: ["awaiting_phase_approval", "waiting_questions", "interrupted", "escalated"],
  awaiting_phase_approval: ["preflight", "implementing", "waiting_questions", "paused", "interrupted"],
  waiting_questions: ["awaiting_phase_approval", "paused", "interrupted"],
  implementing: ["verifying", "interrupted", "escalated"],
  verifying: ["correcting", "correction_required", "reviewing", "interrupted", "escalated"],
  correcting: ["implementing", "verifying", "correction_required", "interrupted", "escalated"],
  correction_required: ["preflight", "correcting", "paused", "interrupted"],
  reviewing: ["correcting", "correction_required", "phase_approved", "review_failed", "interrupted", "escalated"],
  review_failed: ["recovering_review", "paused"],
  recovering_review: ["verifying", "reviewing", "correcting", "phase_approved", "review_failed", "escalated"],
  phase_approved: ["awaiting_next_action", "complete"],
  awaiting_next_action: ["preflight", "awaiting_phase_approval", "complete", "paused"],
  paused: ["ready", "preflight", "awaiting_phase_approval", "waiting_questions", "interrupted"],
  interrupted: ["preflight", "recovering_review", "correction_required", "paused", "escalated"],
  escalated: ["paused"],
  complete: []
};

export function validateFeatureSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new Error("Feature slug must use 2-63 lowercase letters, numbers, or hyphens.");
  }
  return slug;
}

export function featureDirectory(coordinationRoot: string, featureSlug: string): string {
  return join(coordinationRoot, "tmp", "ai-workflow", "features", validateFeatureSlug(featureSlug));
}

export function featureStatePath(coordinationRoot: string, featureSlug: string): string {
  return join(featureDirectory(coordinationRoot, featureSlug), "state.json");
}

export function featureEventsPath(coordinationRoot: string, featureSlug: string): string {
  return join(featureDirectory(coordinationRoot, featureSlug), "events.jsonl");
}

function validateFeatureState(value: unknown): FeatureState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Feature state must be a JSON object.");
  }
  const state = value as FeatureState;
  if (state.schemaVersion !== FEATURE_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported feature state schemaVersion ${String(state.schemaVersion)}.`);
  }
  validateFeatureSlug(state.featureSlug);
  if (!allowedTransitions[state.stage]) throw new Error(`Unknown workflow stage ${String(state.stage)}.`);
  if (!state.featureTitle?.trim() || !state.originalRequest?.trim()) {
    throw new Error("Feature state requires a title and original request.");
  }
  if (!/^codex\/[A-Za-z0-9][A-Za-z0-9._/-]{0,112}$/.test(state.branch)) {
    throw new Error("Feature state branch must be a safe codex/... name.");
  }
  if (
    !/^[0-9a-f]{40,64}$/.test(state.baseCommit) ||
    !/^[0-9a-f]{40,64}$/.test(state.headCommit) ||
    !/^[0-9a-f]{64}$/.test(state.currentDiffHash)
  ) {
    throw new Error("Feature state Git identity is malformed.");
  }
  const requestHash = createHash("sha256")
    .update(JSON.stringify(state.originalRequest), "utf8")
    .digest("hex");
  if (state.originalRequestHash !== requestHash) {
    throw new Error("Feature state's original request hash does not match its request.");
  }
  if (state.plan !== null) {
    state.plan = validateWorkflowPlan(state.plan);
    const planHash = createHash("sha256")
      .update(JSON.stringify(state.plan), "utf8")
      .digest("hex");
    if (state.planHash !== planHash) throw new Error("Feature state plan hash does not match its plan.");
  } else if (state.planHash !== null) {
    throw new Error("Feature state cannot have a plan hash without a plan.");
  }
  if (
    !Array.isArray(state.phases) ||
    !Array.isArray(state.questions) ||
    !Array.isArray(state.artifacts) ||
    !Array.isArray(state.verificationHistory) ||
    !Array.isArray(state.phaseMetrics)
  ) {
    throw new Error("Feature state arrays are malformed.");
  }
  state.correctionBoundary ??= null;
  if (state.correctionBoundary) {
    const boundary = state.correctionBoundary;
    if (
      boundary.schemaVersion !== 1 ||
      !boundary.phaseId?.trim() ||
      !["verification", "review"].includes(boundary.source) ||
      !Array.isArray(boundary.corrections) ||
      boundary.corrections.length < 1 ||
      boundary.corrections.length > 32 ||
      boundary.corrections.some(
        (correction) => typeof correction !== "string" || !correction.trim() || correction.length > 30_000
      ) ||
      !Number.isInteger(boundary.phaseRetries) ||
      boundary.phaseRetries < 0 ||
      !Number.isInteger(boundary.phaseReviewCycles) ||
      boundary.phaseReviewCycles < 0 ||
      !["builder", "escalation"].includes(boundary.nextModel) ||
      boundary.branch !== state.branch ||
      boundary.baseCommit !== state.baseCommit ||
      !/^[0-9a-f]{40,64}$/.test(boundary.headCommit) ||
      !/^[0-9a-f]{64}$/.test(boundary.diffHash) ||
      Number.isNaN(Date.parse(boundary.recordedAt))
    ) {
      throw new Error("Feature correction boundary is malformed.");
    }
    if (boundary.source === "verification" && boundary.reviewDecision !== null) {
      throw new Error("A verification correction boundary cannot contain a reviewer decision.");
    }
    if (boundary.source === "review" && boundary.reviewDecision === null) {
      throw new Error("A reviewer correction boundary must preserve its validated decision.");
    }
    if (boundary.reviewDecision !== null) {
      boundary.reviewDecision = validateReviewDecision(boundary.reviewDecision);
      if (boundary.reviewDecision.status !== "changes_requested") {
        throw new Error("A saved reviewer correction boundary must contain changes_requested.");
      }
    }
    if (state.plan && !state.plan.phases.some((phase) => phase.id === boundary.phaseId)) {
      throw new Error("Feature correction boundary references a phase outside the approved plan.");
    }
  }
  return state;
}

export async function loadFeatureState(
  coordinationRoot: string,
  featureSlug: string
): Promise<FeatureState> {
  const path = featureStatePath(coordinationRoot, featureSlug);
  const metadata = await stat(path);
  if ((metadata.mode & 0o077) !== 0) throw new Error("Feature state must use owner-only permissions.");
  return validateFeatureState(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export async function saveFeatureState(
  coordinationRoot: string,
  state: FeatureState
): Promise<string> {
  validateFeatureState(state);
  const directory = featureDirectory(coordinationRoot, state.featureSlug);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = featureStatePath(coordinationRoot, state.featureSlug);
  const temporary = `${path}.${process.pid}.${randomUUID()}.new`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
  return path;
}

export function transitionFeatureState(
  state: FeatureState,
  stage: WorkflowStage,
  now = new Date()
): FeatureState {
  if (state.stage !== stage && !allowedTransitions[state.stage].includes(stage)) {
    throw new Error(`Illegal workflow transition: ${state.stage} -> ${stage}.`);
  }
  return { ...state, stage, updatedAt: now.toISOString() };
}

export async function appendWorkflowEvent(
  coordinationRoot: string,
  state: FeatureState,
  input: Omit<WorkflowEvent, "schemaVersion" | "sequence" | "timestamp" | "featureSlug" | "stage">,
  now = new Date()
): Promise<FeatureState> {
  const directory = featureDirectory(coordinationRoot, state.featureSlug);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const event: WorkflowEvent = {
    schemaVersion: 1,
    sequence: state.eventSequence + 1,
    timestamp: now.toISOString(),
    featureSlug: state.featureSlug,
    stage: state.stage,
    ...input
  };
  const path = featureEventsPath(coordinationRoot, state.featureSlug);
  await appendFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return { ...state, eventSequence: event.sequence, updatedAt: now.toISOString() };
}

export async function acquireFeatureRun(
  coordinationRoot: string,
  featureSlug: string
): Promise<() => Promise<void>> {
  const directory = featureDirectory(coordinationRoot, featureSlug);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "active-run.json");
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Feature ${featureSlug} already has an active or interrupted run. Inspect ${path}; automatic lock removal is prohibited.`
      );
    }
    throw error;
  }
  await handle.writeFile(
    `${JSON.stringify({ schemaVersion: 1, pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    "utf8"
  );
  await handle.sync();
  await handle.close();
  await chmod(path, 0o600);
  return async () => {
    await unlink(path);
  };
}
