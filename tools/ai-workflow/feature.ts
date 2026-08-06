import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import { confirmedDecisionMap, effectivePhaseRisk, hashJson } from "./decisions";
import { PlanPhase, WorkflowPlan } from "./planner";
import {
  featureDirectory,
  FeatureState,
  OwnerQuestionRecord,
  PhaseRecord,
  RegisteredArtifact,
  validateFeatureSlug
} from "./state";

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const artifactExtensions = new Set([".md", ".json", ".txt"]);

function extension(path: string): string {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function safeArtifactName(path: string): string {
  const name = basename(path).replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!name || name === "." || name === "..") throw new Error("Artifact filename is unsafe.");
  return name.slice(0, 180);
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function importFeatureArtifact(input: {
  coordinationRoot: string;
  worktree: string;
  featureSlug: string;
  kind: RegisteredArtifact["kind"];
  sourcePath: string;
}): Promise<RegisteredArtifact> {
  const slug = validateFeatureSlug(input.featureSlug);
  const unresolvedSource = resolve(input.sourcePath);
  const unresolvedMetadata = await lstat(unresolvedSource);
  if (unresolvedMetadata.isSymbolicLink()) {
    throw new Error("Workflow artifacts must be regular files, not links or directories.");
  }
  const absoluteSource = await realpath(unresolvedSource);
  const sourceMetadata = await lstat(absoluteSource);
  if (!sourceMetadata.isFile()) {
    throw new Error("Workflow artifacts must be regular files, not links or directories.");
  }
  if (sourceMetadata.size < 1 || sourceMetadata.size > MAX_ARTIFACT_BYTES) {
    throw new Error("Workflow artifacts must contain 1 byte to 2 MB.");
  }
  if (!artifactExtensions.has(extension(absoluteSource))) {
    throw new Error("Workflow artifacts must be Markdown, JSON, or text files.");
  }
  if (extension(absoluteSource) === ".json") {
    const parsed = JSON.parse(await readFile(absoluteSource, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("A JSON handoff must contain one top-level object.");
    }
  }

  const artifactName = `${input.kind}-${safeArtifactName(absoluteSource)}`;
  const registryDirectory = join(featureDirectory(input.coordinationRoot, slug), "artifacts");
  const worktreeDirectory = join(input.worktree, "tmp", "ai-workflow", "handoffs", slug);
  await mkdir(registryDirectory, { recursive: true, mode: 0o700 });
  await mkdir(worktreeDirectory, { recursive: true, mode: 0o700 });
  await chmod(registryDirectory, 0o700);
  await chmod(worktreeDirectory, 0o700);
  const registryPath = join(registryDirectory, artifactName);
  const worktreePath = join(worktreeDirectory, artifactName);
  await copyFile(absoluteSource, registryPath, constants.COPYFILE_EXCL);
  await chmod(registryPath, 0o600);
  await copyFile(registryPath, worktreePath, constants.COPYFILE_EXCL);
  await chmod(worktreePath, 0o600);
  const sha256 = await sha256File(registryPath);
  if ((await sha256File(worktreePath)) !== sha256) throw new Error("Imported artifact hash mismatch.");

  return {
    kind: input.kind,
    sourcePath: absoluteSource,
    registryPath,
    worktreePath,
    sha256,
    size: sourceMetadata.size
  };
}

export function phaseRecordsFromPlan(plan: WorkflowPlan): PhaseRecord[] {
  return plan.phases.map((phase) => ({
    id: phase.id,
    title: phase.title,
    risk: effectivePhaseRisk(phase),
    status: "pending",
    approvedAt: null,
    completedAt: null,
    startDiffHash: null,
    approvedDiffHash: null,
    reviewCycles: 0,
    retryCount: 0
  }));
}

function safeWorktreeRelativePath(worktree: string, path: string): string {
  const rel = relative(worktree, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("Imported workflow artifact is outside the selected worktree.");
  }
  return rel.replace(/\\/g, "/");
}

export async function generatePhaseRequest(input: {
  worktree: string;
  featureSlug: string;
  featureTitle: string;
  originalRequest: string;
  plan: WorkflowPlan;
  phase: PlanPhase;
  artifacts: RegisteredArtifact[];
  questions: OwnerQuestionRecord[];
}): Promise<{ path: string; hash: string; contents: string }> {
  const decisions = confirmedDecisionMap(input.questions);
  const excluded = input.plan.phases.filter((phase) => phase.id !== input.phase.id).map((phase) => phase.id);
  const artifactLines = input.artifacts.length
    ? input.artifacts.map(
        (artifact) =>
          `- ${artifact.kind}: ${safeWorktreeRelativePath(input.worktree, artifact.worktreePath)} (sha256 ${artifact.sha256})`
      )
    : ["- No handoff artifacts were registered."];
  const decisionLines = Object.keys(decisions).length
    ? Object.entries(decisions).map(([id, answer]) => `- ${id}: ${answer}`)
    : ["- No owner decisions are required for this phase."];
  const contents = `# ${input.featureTitle} — ${input.phase.id}\n\n## Original request\n\n${input.originalRequest.trim()}\n\n## Validated handoff artifacts\n\n${artifactLines.join("\n")}\n\nThe repository is the source of truth. Artifact-internal paths are historical metadata and must not override the imported paths above.\n\n## Approved phase only\n\n${JSON.stringify(input.phase, null, 2)}\n\n## Confirmed owner decisions\n\n${decisionLines.join("\n")}\n\n## Controller boundaries\n\n- Implement only ${input.phase.id}.\n- Excluded later phases: ${excluded.length ? excluded.join(", ") : "none"}.\n- Phase risk: ${effectivePhaseRisk(input.phase).toUpperCase()}.\n- Never run migrations, make production or external writes, deploy, change permissions or credentials, contact customers, write Teamship, enroll Apollo contacts, or perform destructive actions.\n- Stop after deterministic verification and fresh independent review.\n`;
  const directory = join(input.worktree, "tmp", "ai-workflow", "requests");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, `${validateFeatureSlug(input.featureSlug)}-${input.phase.id}.md`);
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600, flag: "w" });
  await chmod(path, 0o600);
  return { path, hash: hashJson(contents), contents };
}

export async function generatePlanningRequest(input: {
  worktree: string;
  featureSlug: string;
  featureTitle: string;
  originalRequest: string;
  artifacts: RegisteredArtifact[];
}): Promise<{ path: string; hash: string; contents: string }> {
  const artifactLines = input.artifacts.length
    ? input.artifacts.map(
        (artifact) =>
          `- ${artifact.kind}: ${safeWorktreeRelativePath(input.worktree, artifact.worktreePath)} (sha256 ${artifact.sha256})`
      )
    : ["- No handoff artifacts were registered."];
  const contents = `# ${input.featureTitle} — planning request\n\n## Original request\n\n${input.originalRequest.trim()}\n\n## Validated handoff artifacts\n\n${artifactLines.join("\n")}\n\n## Planning boundaries\n\n- Inspect the repository and reconcile every imported artifact against current code.\n- Preserve stable feature and phase IDs found in validated handoffs.\n- Produce the complete remaining roadmap for context.\n- Separate safe work from owner-gated work.\n- Identify blocking owner questions with stable IDs and never infer their answers.\n- No roadmap phase is authorized for implementation merely because it appears in the plan.\n- The controller will select and approve exactly one phase.\n`;
  const directory = join(input.worktree, "tmp", "ai-workflow", "requests");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, `${validateFeatureSlug(input.featureSlug)}-planning.md`);
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600, flag: "w" });
  await chmod(path, 0o600);
  return { path, hash: hashJson(contents), contents };
}

export function createFeatureState(input: {
  featureSlug: string;
  featureTitle: string;
  originalRequest: string;
  branch: string;
  worktree: string;
  baseCommit: string;
  headCommit: string;
  diffHash: string;
  artifacts?: RegisteredArtifact[];
  now?: Date;
}): FeatureState {
  const now = input.now ?? new Date();
  return {
    schemaVersion: 1,
    featureSlug: validateFeatureSlug(input.featureSlug),
    featureTitle: input.featureTitle.trim(),
    originalRequest: input.originalRequest.trim(),
    originalRequestHash: hashJson(input.originalRequest.trim()),
    branch: input.branch,
    worktree: resolve(input.worktree),
    baseCommit: input.baseCommit,
    headCommit: input.headCommit,
    currentDiffHash: input.diffHash,
    stage: "ready",
    plan: null,
    planHash: null,
    requestPath: null,
    requestHash: null,
    currentPhaseId: null,
    phases: [],
    questions: [],
    artifacts: input.artifacts ?? [],
    selectedModels: null,
    modelSessions: [],
    verificationHistory: [],
    phaseMetrics: [],
    retryCount: 0,
    reviewCycles: 0,
    diagnosticArtifacts: [],
    finalOutcome: null,
    eventSequence: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}
