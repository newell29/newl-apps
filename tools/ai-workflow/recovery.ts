import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { implementPhase } from "./builder";
import {
  getSurroundingCode,
  getWorkflowDiff,
  inspectRecoveryGitIdentity,
  RecoveryGitIdentity
} from "./git";
import { AgentRunner } from "./opencode";
import { PlanPhase, validateWorkflowPlan, WorkflowPlan } from "./planner";
import { reviewPhase, ReviewDecision } from "./reviewer";
import { CommandRunner, runVerification, VerificationResult } from "./verification";
import { reviewerCorrections, WorkflowEscalationError } from "./workflow";

const RECOVERY_SCHEMA_VERSION = 1;
const DEFAULT_RECOVERY_FILE = "tmp/ai-workflow/review-recovery.json";
const MAX_RECOVERY_BYTES = 512 * 1024;

export type ReviewRecoveryRecord = {
  schemaVersion: 1;
  branch: string;
  baseRef: string;
  baseCommit: string;
  headCommit: string;
  diffHash: string;
  originalRequest: string;
  approvedPlan: WorkflowPlan;
  phaseId: string;
};

export type LoadedReviewRecovery = {
  record: ReviewRecoveryRecord;
  originalRequest: string;
  plan: WorkflowPlan;
  phase: PlanPhase;
};

export type ReviewRecoveryResult = {
  phaseId: string;
  decision: ReviewDecision;
  verification: VerificationResult;
  correctionAttempts: number;
  reviewCycles: number;
  stoppedBeforeNextPhase: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Recovery field ${key} must be a non-empty string.`);
  }
  return value.trim();
}

function validateHash(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Recovery diffHash must be a SHA-256 hash.");
  return value;
}

function recoveryPath(repositoryRoot: string, file: string): string {
  const absolute = resolve(repositoryRoot, file);
  const rel = relative(repositoryRoot, absolute);
  if (!rel.startsWith(`tmp${sep}`) || rel.includes(`..${sep}`)) {
    throw new Error("Review recovery metadata must remain under the ignored tmp/ directory.");
  }
  return absolute;
}

export function validateReviewRecoveryRecord(value: unknown): ReviewRecoveryRecord {
  if (!isRecord(value)) throw new Error("Review recovery metadata must be an object.");
  const expectedKeys = new Set([
    "schemaVersion",
    "branch",
    "baseRef",
    "baseCommit",
    "headCommit",
    "diffHash",
    "originalRequest",
    "approvedPlan",
    "phaseId"
  ]);
  const unexpectedKeys = Object.keys(value).filter((key) => !expectedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Review recovery metadata contains unexpected fields: ${unexpectedKeys.join(", ")}.`);
  }
  if (value.schemaVersion !== RECOVERY_SCHEMA_VERSION) {
    throw new Error(`Review recovery schemaVersion must be ${RECOVERY_SCHEMA_VERSION}.`);
  }

  const branch = requiredString(value, "branch");
  if (!/^codex\/[A-Za-z0-9][A-Za-z0-9._/-]{0,112}$/.test(branch) || branch.includes("..")) {
    throw new Error("Recovery branch must be a safe codex/... branch name.");
  }
  const baseRef = requiredString(value, "baseRef");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(baseRef) || baseRef.includes("..")) {
    throw new Error("Recovery baseRef is unsafe.");
  }
  const baseCommit = requiredString(value, "baseCommit");
  const headCommit = requiredString(value, "headCommit");
  if (!/^[0-9a-f]{40,64}$/.test(baseCommit) || !/^[0-9a-f]{40,64}$/.test(headCommit)) {
    throw new Error("Recovery baseCommit and headCommit must be full Git object IDs.");
  }

  return {
    schemaVersion: 1,
    branch,
    baseRef,
    baseCommit,
    headCommit,
    diffHash: validateHash(requiredString(value, "diffHash")),
    originalRequest: requiredString(value, "originalRequest"),
    approvedPlan: validateWorkflowPlan(value.approvedPlan),
    phaseId: requiredString(value, "phaseId")
  };
}

export async function writeReviewRecoveryMetadata(input: {
  repositoryRoot: string;
  branch: string;
  baseRef?: string;
  baseCommit: string;
  originalRequest: string;
  approvedPlan: WorkflowPlan;
  phaseId: string;
  recoveryFile?: string;
}): Promise<string> {
  const baseRef = input.baseRef ?? input.baseCommit;
  const identity = await inspectRecoveryGitIdentity(
    input.repositoryRoot,
    baseRef,
    input.baseCommit
  );
  if (
    identity.branch !== input.branch ||
    identity.baseRefCommit !== input.baseCommit ||
    identity.mergeBaseCommit !== input.baseCommit
  ) {
    throw new Error("Cannot write review recovery metadata for an unexpected branch or base.");
  }
  const record = validateReviewRecoveryRecord({
    schemaVersion: 1,
    branch: input.branch,
    baseRef,
    baseCommit: input.baseCommit,
    headCommit: identity.headCommit,
    diffHash: identity.diffHash,
    originalRequest: input.originalRequest,
    approvedPlan: input.approvedPlan,
    phaseId: input.phaseId
  });
  const path = recoveryPath(
    input.repositoryRoot,
    input.recoveryFile ?? DEFAULT_RECOVERY_FILE
  );
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_RECOVERY_BYTES) {
    throw new Error("Review recovery metadata exceeded the 512 KB safety limit.");
  }
  const temporaryPath = `${path}.new`;
  await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600, flag: "w" });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
  return path;
}

export async function loadReviewRecovery(
  repositoryRoot: string,
  recoveryFile = DEFAULT_RECOVERY_FILE
): Promise<LoadedReviewRecovery> {
  const path = recoveryPath(repositoryRoot, recoveryFile);
  const metadataStat = await stat(path);
  if ((metadataStat.mode & 0o077) !== 0) {
    throw new Error("Review recovery metadata must have owner-only file permissions (0600).");
  }
  if (metadataStat.size > MAX_RECOVERY_BYTES) {
    throw new Error("Review recovery metadata exceeded the 512 KB safety limit.");
  }
  const record = validateReviewRecoveryRecord(JSON.parse(await readFile(path, "utf8")));
  const phase = record.approvedPlan.phases.find((candidate) => candidate.id === record.phaseId);
  if (!phase) throw new Error(`Recovery phase ${record.phaseId} is absent from the approved plan.`);
  if (phase.requiresOwnerApproval) {
    throw new Error(`Recovery phase ${record.phaseId} is owner-gated and cannot enter review recovery.`);
  }
  return {
    record,
    originalRequest: record.originalRequest,
    plan: record.approvedPlan,
    phase
  };
}

export function assertRecoveryGitIdentity(
  expected: ReviewRecoveryRecord,
  actual: RecoveryGitIdentity
): void {
  if (actual.branch !== expected.branch) {
    throw new Error(`Recovery refused: expected branch ${expected.branch}, found ${actual.branch}.`);
  }
  if (actual.baseRefCommit !== expected.baseCommit) {
    throw new Error("Recovery refused: the expected base ref changed.");
  }
  if (actual.headCommit !== expected.headCommit) {
    throw new Error("Recovery refused: HEAD changed after the failed review.");
  }
  if (actual.mergeBaseCommit !== expected.baseCommit) {
    throw new Error("Recovery refused: the branch no longer has the expected merge base.");
  }
  if (actual.diffHash !== expected.diffHash) {
    throw new Error("Recovery refused: the current phase diff changed after the failed review.");
  }
}

function assertReadOnlyReview(before: RecoveryGitIdentity, after: RecoveryGitIdentity): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new WorkflowEscalationError("Recovery reviewer changed Git state; refusing its result.");
  }
}

function failedVerificationCorrections(result: VerificationResult): string[] {
  return result.commands
    .filter((command) => !command.passed)
    .map(
      (command) =>
        `Mandatory verification failed: ${command.command} ${command.args.join(" ")} (exit ${
          command.exitCode ?? "unknown"
        }).\n${command.output || "No command output was captured."}`
    );
}

export async function runReviewCurrentDiff(input: {
  repositoryRoot: string;
  recovery: LoadedReviewRecovery;
  agentRunner: AgentRunner;
  commandRunner: CommandRunner;
  builderModel: string;
  reviewerModel: string;
  maxReviewCycles?: number;
  maxRetries?: number;
  onEvent?: (message: string) => void;
}): Promise<ReviewRecoveryResult> {
  const event = input.onEvent ?? (() => undefined);
  const maxReviewCycles = input.maxReviewCycles ?? 3;
  const maxRetries = input.maxRetries ?? 3;
  if (!Number.isInteger(maxReviewCycles) || maxReviewCycles < 1 || maxReviewCycles > 10) {
    throw new Error("Recovery maxReviewCycles must be an integer from 1 to 10.");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > 10) {
    throw new Error("Recovery maxRetries must be an integer from 1 to 10.");
  }

  const { record, originalRequest, plan, phase } = input.recovery;
  assertRecoveryGitIdentity(
    record,
    await inspectRecoveryGitIdentity(input.repositoryRoot, record.baseRef, record.baseCommit)
  );

  event(`Recovery: running mandatory verification for pinned ${phase.id} diff.`);
  let verification = await runVerification(
    input.commandRunner,
    input.repositoryRoot,
    record.baseCommit
  );
  if (!verification.passed) {
    throw new WorkflowEscalationError(
      `Recovery stopped before any model call because mandatory verification failed.\n${failedVerificationCorrections(
        verification
      ).join("\n\n")}`
    );
  }
  assertRecoveryGitIdentity(
    record,
    await inspectRecoveryGitIdentity(input.repositoryRoot, record.baseRef, record.baseCommit)
  );

  let reviewCycles = 0;
  let correctionAttempts = 0;
  while (reviewCycles < maxReviewCycles) {
    event(`Recovery: starting fresh read-only review ${reviewCycles + 1} for ${phase.id}.`);
    const beforeReview = await inspectRecoveryGitIdentity(
      input.repositoryRoot,
      record.baseRef,
      record.baseCommit
    );
    const reviewed = await reviewPhase(input.agentRunner, input.reviewerModel, {
      repositoryRoot: input.repositoryRoot,
      originalRequest,
      approvedPlan: plan,
      phase,
      gitDiff: await getWorkflowDiff(input.repositoryRoot, record.baseCommit),
      surroundingCode: await getSurroundingCode(input.repositoryRoot),
      verification
    });
    const afterReview = await inspectRecoveryGitIdentity(
      input.repositoryRoot,
      record.baseRef,
      record.baseCommit
    );
    assertReadOnlyReview(beforeReview, afterReview);
    reviewCycles += 1;

    if (reviewed.decision.status === "approved") {
      event(`Recovery: ${phase.id} approved; stopping before every later phase.`);
      return {
        phaseId: phase.id,
        decision: reviewed.decision,
        verification,
        correctionAttempts,
        reviewCycles,
        stoppedBeforeNextPhase: true
      };
    }
    if (reviewed.decision.status === "escalate") {
      throw new WorkflowEscalationError(
        reviewed.decision.escalationReason ?? `The reviewer escalated ${phase.id}.`
      );
    }
    if (correctionAttempts >= maxRetries) {
      throw new WorkflowEscalationError(
        `${phase.id} reached the ${maxRetries}-attempt recovery correction limit.`
      );
    }

    let corrections = reviewerCorrections(reviewed.decision);
    correctionAttempts += 1;
    event(`Recovery: forwarding ${corrections.length} exact correction(s) to the builder.`);
    while (true) {
      await implementPhase(input.agentRunner, input.builderModel, phase, corrections);
      const postBuilder = await inspectRecoveryGitIdentity(
        input.repositoryRoot,
        record.baseRef,
        record.baseCommit
      );
      if (
        postBuilder.branch !== record.branch ||
        postBuilder.baseRefCommit !== record.baseCommit ||
        postBuilder.headCommit !== record.headCommit ||
        postBuilder.mergeBaseCommit !== record.baseCommit
      ) {
        throw new WorkflowEscalationError("Recovery builder changed pinned branch or commit state.");
      }
      verification = await runVerification(
        input.commandRunner,
        input.repositoryRoot,
        record.baseCommit
      );
      if (verification.passed) break;
      if (correctionAttempts >= maxRetries) {
        throw new WorkflowEscalationError(
          `${phase.id} reached the ${maxRetries}-attempt recovery correction limit after verification failed.`
        );
      }
      corrections = failedVerificationCorrections(verification);
      correctionAttempts += 1;
      event("Recovery: forwarding exact mandatory verification failures to the builder.");
    }
  }

  throw new WorkflowEscalationError(
    `${phase.id} reached the ${maxReviewCycles}-cycle independent recovery review limit.`
  );
}
