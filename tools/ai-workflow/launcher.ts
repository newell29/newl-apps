#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Interface } from "node:readline/promises";

import {
  DEFAULT_USER_MODEL_CONFIG_FILE,
  loadModelConfiguration,
  saveUserModelConfiguration
} from "./config";
import {
  answerOwnerQuestion,
  confirmedDecisionMap,
  effectivePhaseRisk,
  hashJson,
  questionsFromPlan,
  unresolvedBlockingQuestions
} from "./decisions";
import {
  createFeatureState,
  generatePhaseRequest,
  generatePlanningRequest,
  importFeatureArtifact,
  phaseRecordsFromPlan,
  reconcilePhaseQuestionGates
} from "./feature";
import {
  findCoordinationRoot,
  findRepositoryRoot,
  inspectGitWorktree,
  inspectRecoveryGitIdentity
} from "./git";
import { importLegacyOwnerQuestions } from "./legacy-questions";
import { OpenCodeCliInspector, OpenCodeCliRunner } from "./opencode";
import { createOperatorInput } from "./operator-input";
import { PlanPhase, recoverPlanFromSession, WorkflowPlan } from "./planner";
import {
  authenticatedModelIds,
  runPreflight,
  validateOpenCodeCatalog
} from "./preflight";
import { createProgressReporter } from "./progress";
import { loadReviewRecovery, runReviewCurrentDiff } from "./recovery";
import {
  acquireFeatureRun,
  featureDirectory,
  featureEventsPath,
  FeatureState,
  loadFeatureState,
  saveFeatureState,
  transitionFeatureState,
  validateFeatureSlug,
  WorkflowStage
} from "./state";
import { LocalCommandRunner } from "./verification";
import {
  runWorkflow,
  WorkflowCancelledError,
  WorkflowOptions
} from "./workflow";

function command(cwd: string, executable: string, args: string[]): Promise<void> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveCommand();
      else reject(new Error(`${executable} ${args.join(" ")} failed with exit ${code ?? "unknown"}.`));
    });
  });
}

async function ask(readline: Interface, prompt: string, required = true): Promise<string> {
  const answer = (await readline.question(prompt)).trim();
  if (required && !answer) throw new Error("A response is required.");
  return answer;
}

async function confirm(readline: Interface, prompt: string, defaultYes = false): Promise<boolean> {
  const answer = (await readline.question(`${prompt} ${defaultYes ? "[Y/n]" : "[y/N]"} `))
    .trim()
    .toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

async function listFeatureStates(coordinationRoot: string): Promise<FeatureState[]> {
  const root = join(coordinationRoot, "tmp", "ai-workflow", "features");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const states: FeatureState[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    try {
      states.push(await loadFeatureState(coordinationRoot, entry.name));
    } catch {
      // A corrupt feature remains fail-closed when explicitly selected; it is omitted from the menu.
    }
  }
  return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function selectFeature(
  coordinationRoot: string,
  readline: Interface,
  requested?: string
): Promise<FeatureState> {
  if (requested) return loadFeatureState(coordinationRoot, validateFeatureSlug(requested));
  const states = await listFeatureStates(coordinationRoot);
  if (states.length === 0) throw new Error("No registered features were found. Start a new feature first.");
  console.log("\nSelect feature:\n");
  states.forEach((state, index) => {
    console.log(`${index + 1}. ${state.featureTitle} — ${state.stage}`);
  });
  const selected = Number(await ask(readline, "\nFeature number: "));
  if (!Number.isInteger(selected) || selected < 1 || selected > states.length) {
    throw new Error("Feature selection is invalid.");
  }
  return states[selected - 1];
}

function printModels(models: NonNullable<FeatureState["selectedModels"]>): void {
  console.log(`Planner:  ${models.plannerModel}`);
  console.log(`Builder:  ${models.builderModel}`);
  console.log(`Reviewer: ${models.reviewerModel}`);
}

function printRoadmap(plan: WorkflowPlan, selectedPhaseId: string): void {
  console.log("\nProposed roadmap:\n");
  for (const phase of plan.phases) {
    const marker = phase.id === selectedPhaseId ? ">" : "-";
    console.log(`${marker} ${phase.id} — ${phase.title} [${effectivePhaseRisk(phase).toUpperCase()}]`);
  }
}

function printPhase(phase: PlanPhase): void {
  console.log(`\nNext eligible phase:\n${phase.id} — ${phase.title}`);
  console.log(`\nRisk: ${effectivePhaseRisk(phase).toUpperCase()}`);
  console.log(`\nObjective:\n${phase.objective}`);
  console.log(`\nExpected files:\n- ${phase.expectedFiles.join("\n- ") || "No files named"}`);
  console.log(`\nExpected tests:\n- ${phase.testFiles.join("\n- ") || "Reviewer must assess coverage"}`);
  console.log(`\nDone when:\n- ${phase.definitionOfDone.join("\n- ")}`);
  if (effectivePhaseRisk(phase) === "high" || effectivePhaseRisk(phase) === "owner_gated") {
    console.log(
      "\nRollback consideration:\nThe engine will not reset or delete changes. Preserve the diff for review and prepare a separate human-approved rollback before any protected operational action."
    );
  }
}

function nextPendingPhase(state: FeatureState): PlanPhase | null {
  if (!state.plan) return null;
  const record = state.phases.find((phase) => phase.status === "pending" || phase.status === "blocked");
  return record ? state.plan.phases.find((phase) => phase.id === record.id) ?? null : null;
}

async function gitIdentity(state: FeatureState) {
  return inspectRecoveryGitIdentity(state.worktree, state.baseCommit, state.baseCommit);
}

async function persistStage(
  coordinationRoot: string,
  state: FeatureState,
  stage: WorkflowStage,
  phaseId: string | null
): Promise<FeatureState> {
  let next = transitionFeatureState(state, stage);
  next = { ...next, currentPhaseId: phaseId };
  await saveFeatureState(coordinationRoot, next);
  return next;
}

async function createNewFeature(coordinationRoot: string, readline: Interface): Promise<FeatureState> {
  const slug = validateFeatureSlug(await ask(readline, "Feature slug: "));
  const title = await ask(readline, "Feature name: ");
  const originalRequest = await ask(readline, "Describe the feature request: ");
  const worktree = join(coordinationRoot, "work", "codex", slug);
  console.log("\nThe launcher will create a dedicated worktree from freshly fetched origin/main.");
  if (!(await confirm(readline, `Create codex/${slug} at ${worktree}?`, true))) {
    throw new WorkflowCancelledError("Feature creation was cancelled.");
  }
  await command(coordinationRoot, "npm", ["run", "codex:task:start", "--", slug]);
  await ensureDependencies(worktree, readline);
  const headIdentity = await inspectRecoveryGitIdentity(
    worktree,
    (await readGitHead(worktree)),
    (await readGitHead(worktree))
  );
  const state = createFeatureState({
    featureSlug: slug,
    featureTitle: title,
    originalRequest,
    branch: headIdentity.branch,
    worktree,
    baseCommit: headIdentity.headCommit,
    headCommit: headIdentity.headCommit,
    diffHash: headIdentity.diffHash
  });

  const artifactPrompts: Array<{
    kind: "handoff_markdown" | "handoff_json" | "review_evidence";
    prompt: string;
  }> = [
    { kind: "handoff_markdown", prompt: "Handoff Markdown path (optional): " },
    { kind: "handoff_json", prompt: "Structured handoff JSON path (optional): " },
    { kind: "review_evidence", prompt: "Review evidence path (optional): " }
  ];
  for (const artifact of artifactPrompts) {
    const sourcePath = await ask(readline, artifact.prompt, false);
    if (!sourcePath) continue;
    if (!(await confirm(readline, "Copy this artifact into owner-only ignored workflow storage?", true))) {
      continue;
    }
    state.artifacts.push(
      await importFeatureArtifact({
        coordinationRoot,
        worktree,
        featureSlug: slug,
        kind: artifact.kind,
        sourcePath
      })
    );
  }
  await saveFeatureState(coordinationRoot, state);
  console.log(`\nRegistered ${state.featureTitle}. No model call has been made.`);
  return state;
}

async function ensureDependencies(worktree: string, readline: Interface): Promise<void> {
  const openCodeBinary = join(worktree, "node_modules", ".bin", "opencode");
  if (existsSync(openCodeBinary)) return;
  console.log("\nRequired worktree dependencies are not installed.");
  if (!(await confirm(readline, "Run npm install now?", true))) {
    throw new WorkflowCancelledError("Dependency installation was declined; no model call was made.");
  }
  await command(worktree, "npm", ["install"]);
  if (!existsSync(openCodeBinary)) throw new Error("OpenCode is still unavailable after npm install.");
}

async function adoptExistingFeature(
  coordinationRoot: string,
  readline: Interface,
  requestedSlug?: string
): Promise<FeatureState> {
  const slug = validateFeatureSlug(requestedSlug ?? (await ask(readline, "Feature slug: ")));
  const defaultWorktree = join(coordinationRoot, "work", "codex", slug);
  const enteredWorktree = await ask(
    readline,
    `Existing worktree path [${defaultWorktree}]: `,
    false
  );
  const worktree = resolve(enteredWorktree || defaultWorktree);
  const allowedRoot = `${resolve(coordinationRoot, "work", "codex")}${sep}`;
  if (!worktree.startsWith(allowedRoot)) {
    throw new Error("Existing AI features must use a persistent work/codex/ task worktree.");
  }
  const inspection = await inspectGitWorktree(worktree);
  if (!inspection.isDedicatedWorktree || !inspection.branch.startsWith("codex/")) {
    throw new Error("The selected path is not a dedicated codex/... task worktree.");
  }

  let recovery: Awaited<ReturnType<typeof loadReviewRecovery>> | null = null;
  try {
    recovery = await loadReviewRecovery(worktree);
    console.log(`\nFound an owner-only review boundary for ${recovery.phase.id}.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.log(
        `\nNo importable review boundary was loaded: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const baseCommit = recovery?.record.baseCommit ?? (await ask(readline, "Workflow base commit: "));
  if (!/^[0-9a-f]{40,64}$/.test(baseCommit)) throw new Error("Workflow base commit is invalid.");
  const identity = await inspectRecoveryGitIdentity(worktree, baseCommit, baseCommit);
  const title = await ask(readline, "Feature name: ");
  const originalRequest = recovery?.originalRequest ?? (await ask(readline, "Original feature request: "));
  let state = createFeatureState({
    featureSlug: slug,
    featureTitle: title,
    originalRequest,
    branch: identity.branch,
    worktree,
    baseCommit,
    headCommit: identity.headCommit,
    diffHash: identity.diffHash
  });

  const discoveredDirectory = join(worktree, "tmp", "ai-workflow", "handoffs", slug);
  let discovered: string[] = [];
  try {
    discovered = (await readdir(discoveredDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(md|json|txt)$/i.test(entry.name))
      .map((entry) => join(discoveredDirectory, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (discovered.length > 0) {
    console.log(`\nFound ${discovered.length} handoff artifact(s) in the existing worktree.`);
    if (await confirm(readline, "Import these artifacts into the feature registry?", true)) {
      for (const sourcePath of discovered) {
        const lower = sourcePath.toLowerCase();
        const kind = lower.endsWith(".json")
          ? "handoff_json"
          : lower.includes("review")
            ? "review_evidence"
            : "handoff_markdown";
        state.artifacts.push(
          await importFeatureArtifact({
            coordinationRoot,
            worktree,
            featureSlug: slug,
            kind,
            sourcePath
          })
        );
      }
    }
  }

  if (recovery) {
    const planHash = hashJson(recovery.plan);
    const questions = await importLegacyOwnerQuestions({
      worktree,
      plan: recovery.plan,
      planHash,
      artifacts: state.artifacts,
      planQuestions: questionsFromPlan(recovery.plan, planHash)
    });
    state = {
      ...state,
      plan: recovery.plan,
      planHash,
      phases: reconcilePhaseQuestionGates(phaseRecordsFromPlan(recovery.plan), questions),
      questions,
      currentPhaseId: recovery.phase.id
    };
    const importedBlocking = questions.filter((question) => question.blocking);
    if (importedBlocking.length > 0) {
      console.log(
        `\nImported ${importedBlocking.length} legacy blocking owner question(s); later gated work remains blocked.`
      );
    }
    const approved = await confirm(
      readline,
      `Has ${recovery.phase.id} already received an unambiguous final reviewer approval?`,
      false
    );
    if (approved) {
      state = {
        ...state,
        phases: state.phases.map((phase) =>
          phase.id === recovery?.phase.id
            ? {
                ...phase,
                status: "approved",
                completedAt: new Date().toISOString(),
                approvedDiffHash: identity.diffHash
              }
            : phase
        )
      };
      state = transitionFeatureState(state, "awaiting_next_action");
    } else {
      state = transitionFeatureState(state, "review_failed");
    }
  }
  await saveFeatureState(coordinationRoot, state);
  console.log(`\nAdopted ${state.featureTitle} without changing feature code or making a model call.`);
  return state;
}

async function readGitHead(worktree: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolveHead, reject) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolveHead(stdout.trim());
    });
  });
}

async function runFeature(
  coordinationRoot: string,
  initialState: FeatureState,
  readline: Interface
): Promise<void> {
  const release = await acquireFeatureRun(coordinationRoot, initialState.featureSlug);
  let state = initialState;
  const progress = createProgressReporter(coordinationRoot, state);
  try {
    await ensureDependencies(state.worktree, readline);
    const identity = await gitIdentity(state);
    if (
      identity.branch !== state.branch ||
      identity.headCommit !== state.headCommit ||
      identity.mergeBaseCommit !== state.baseCommit ||
      identity.diffHash !== state.currentDiffHash
    ) {
      throw new Error("Registered branch, base, HEAD, or diff changed. Automatic cleanup is prohibited.");
    }
    const models = await loadModelConfiguration({ repositoryRoot: state.worktree });
    state = { ...state, selectedModels: models, updatedAt: new Date().toISOString() };
    await saveFeatureState(coordinationRoot, state);

    let phase = nextPendingPhase(state);
    if (state.plan && !phase) {
      throw new Error("The stored roadmap has no pending phase. Review the completed feature manually.");
    }
    const planningRequest = state.plan
      ? null
      : await generatePlanningRequest({
          worktree: state.worktree,
          featureSlug: state.featureSlug,
          featureTitle: state.featureTitle,
          originalRequest: state.originalRequest,
          artifacts: state.artifacts
        });
    let requestContents = planningRequest?.contents ?? state.originalRequest;
    const workflowOptions: WorkflowOptions = {
      repositoryRoot: state.worktree,
      originalRequest: requestContents,
      plannerModel: models.plannerModel,
      builderModel: models.builderModel,
      reviewerModel: models.reviewerModel,
      approvedPlan: state.plan ?? undefined,
      phaseId: phase?.id,
      featureSlug: state.featureSlug,
      confirmedDecisions: confirmedDecisionMap(state.questions),
      ownerGateSatisfied: phase
        ? unresolvedBlockingQuestions(state.questions, phase.id).length === 0
        : false
    };
    const commandRunner = new LocalCommandRunner();
    const inspector = new OpenCodeCliInspector(state.worktree);
    const agentRunner = new OpenCodeCliRunner(state.worktree, undefined, (event) => {
      progress.emit({
        stage: state.stage,
        type: `model.${event.type}`,
        message:
          event.type === "heartbeat"
            ? `${event.role} model is still active; no operator input is needed.`
            : `${event.role} model ${event.type}.`,
        phaseId: state.currentPhaseId,
        data: { modelRole: event.role, elapsedMs: event.elapsedMs }
      });
    });

    const result = await runWorkflow(workflowOptions, {
      agentRunner,
      commandRunner,
      preflight: () =>
        runPreflight({
          repositoryRoot: state.worktree,
          models,
          commandRunner,
          openCodeInspector: inspector,
          expectedExistingDiff: {
            branch: state.branch,
            baseCommit: state.baseCommit,
            headCommit: state.headCommit,
            diffHash: state.currentDiffHash
          },
          onEvent: (message) =>
            progress.emit({ stage: state.stage, type: "preflight.progress", message })
        }),
      onPlanCreated: async (plan) => {
        const planHash = hashJson(plan);
        const questions = questionsFromPlan(plan, planHash);
        state = {
          ...state,
          plan,
          planHash,
          phases: reconcilePhaseQuestionGates(phaseRecordsFromPlan(plan), questions),
          questions,
          updatedAt: new Date().toISOString()
        };
        phase = nextPendingPhase(state);
        workflowOptions.phaseId = phase?.id;
        await saveFeatureState(coordinationRoot, state);
      },
      ownerGateSatisfied: async (plan, phaseId) => {
        const blocking = unresolvedBlockingQuestions(state.questions, phaseId);
        if (blocking.length === 0) return true;
        state = await persistStage(coordinationRoot, state, "waiting_questions", phaseId);
        console.log(`\n${blocking.length} blocking owner question(s) must be answered before ${phaseId}.`);
        console.log(`Run: npm run ai:feature -- questions ${state.featureSlug}`);
        return false;
      },
      approvePhase: async (plan, phaseId) => {
        const selected = plan.phases.find((candidate) => candidate.id === phaseId);
        if (!selected) throw new Error(`Phase ${phaseId} disappeared from the approved roadmap.`);
        printRoadmap(plan, phaseId);
        printPhase(selected);
        console.log("\nModels:");
        printModels(models);
        const generated = await generatePhaseRequest({
          worktree: state.worktree,
          featureSlug: state.featureSlug,
          featureTitle: state.featureTitle,
          originalRequest: state.originalRequest,
          plan,
          phase: selected,
          artifacts: state.artifacts,
          questions: state.questions
        });
        requestContents = generated.contents;
        workflowOptions.originalRequest = requestContents;
        workflowOptions.confirmedDecisions = confirmedDecisionMap(state.questions);
        workflowOptions.ownerGateSatisfied = true;

        const risk = effectivePhaseRisk(selected);
        const approved =
          risk === "high" || risk === "owner_gated"
            ? (await ask(readline, `\nType ${phaseId} to approve this phase only: `)) === phaseId
            : await confirm(readline, `\nApprove ${phaseId} only?`, false);
        if (!approved) return false;
        state = {
          ...state,
          requestPath: generated.path,
          requestHash: generated.hash,
          currentPhaseId: phaseId,
          phases: state.phases.map((record) =>
            record.id === phaseId
              ? {
                  ...record,
                  status: "approved_to_run",
                  approvedAt: new Date().toISOString(),
                  startDiffHash: state.currentDiffHash
                }
              : record
          )
        };
        await saveFeatureState(coordinationRoot, state);
        return true;
      },
      onStage: async (stage, phaseId) => {
        state = await persistStage(coordinationRoot, state, stage, phaseId);
        if (phaseId && (stage === "implementing" || stage === "correcting")) {
          state = {
            ...state,
            phases: state.phases.map((record) =>
              record.id === phaseId ? { ...record, status: "running" } : record
            )
          };
          await saveFeatureState(coordinationRoot, state);
        }
        progress.emit({ stage, type: `workflow.${stage}`, message: stage.replaceAll("_", " "), phaseId });
      },
      onModelRun: async (role, phaseId, modelRun) => {
        state = {
          ...state,
          modelSessions: [
            ...state.modelSessions,
            {
              role,
              phaseId,
              sessionId: modelRun.sessionId ?? null,
              messageId: modelRun.assistantMessageId ?? null,
              textPartIds: (modelRun.textPartIds ?? []).slice(0, 64),
              finishReason: modelRun.finishReason ?? null,
              cost: modelRun.cost,
              tokens: modelRun.tokens ?? null,
              recordedAt: new Date().toISOString()
            }
          ]
        };
        await saveFeatureState(coordinationRoot, state);
      },
      onDiagnostic: async (path) => {
        if (!state.diagnosticArtifacts.includes(path)) {
          state = { ...state, diagnosticArtifacts: [...state.diagnosticArtifacts, path] };
          await saveFeatureState(coordinationRoot, state);
        }
      },
      onVerification: async (phaseId, verification) => {
        const identity = await gitIdentity(state);
        state = {
          ...state,
          headCommit: identity.headCommit,
          currentDiffHash: identity.diffHash,
          verificationHistory: [
            ...state.verificationHistory,
            {
              phaseId,
              diffHash: identity.diffHash,
              passed: verification.passed,
              recordedAt: new Date().toISOString(),
              commands: verification.commands.map((commandResult) => ({
                name: commandResult.name,
                passed: commandResult.passed,
                exitCode: commandResult.exitCode,
                durationMs: commandResult.durationMs
              }))
            }
          ]
        };
        await saveFeatureState(coordinationRoot, state);
      },
      onEvent: (message) =>
        progress.emit({ stage: state.stage, type: "workflow.progress", message, phaseId: state.currentPhaseId })
    });

    const completedIdentity = await inspectRecoveryGitIdentity(
      state.worktree,
      state.baseCommit,
      state.baseCommit
    );
    state = {
      ...state,
      headCommit: completedIdentity.headCommit,
      currentDiffHash: completedIdentity.diffHash,
      retryCount: state.retryCount + result.metrics.retryCount,
      reviewCycles: state.reviewCycles + result.metrics.reviewCycles,
      eventSequence: progress.sequence(),
      phases: state.phases.map((record) =>
        record.id === result.phaseId
          ? {
              ...record,
              status: "approved",
              completedAt: new Date().toISOString(),
              approvedDiffHash: completedIdentity.diffHash,
              retryCount: record.retryCount + result.metrics.retryCount,
              reviewCycles: record.reviewCycles + result.metrics.reviewCycles
            }
          : record
      ),
      phaseMetrics: [
        ...state.phaseMetrics,
        {
          phaseId: result.phaseId,
          totalTimeMs: result.metrics.totalTimeMs,
          totalApiCost: result.metrics.totalApiCost,
          retryCount: result.metrics.retryCount,
          reviewCycles: result.metrics.reviewCycles,
          filesChanged: result.metrics.filesChanged,
          testsExecuted: result.metrics.testsExecuted,
          completedAt: result.metrics.completedAt
        }
      ]
    };
    const hasPending = state.phases.some((record) => record.status === "pending" || record.status === "blocked");
    state = transitionFeatureState(state, hasPending ? "awaiting_next_action" : "complete");
    state = {
      ...state,
      finalOutcome: hasPending ? `${result.phaseId} approved; later phases require owner action.` : "Roadmap phases approved; manual branch completion remains."
    };
    await saveFeatureState(coordinationRoot, state);
    console.log(`\n✓ ${result.phaseId} approved.`);
    console.log("⏸ The engine stopped before every later phase.");
  } catch (error) {
    if (error instanceof WorkflowCancelledError) {
      state = { ...state, eventSequence: progress.sequence(), updatedAt: new Date().toISOString() };
      await saveFeatureState(coordinationRoot, state);
      console.log(`\n${error.message}`);
    } else if (state.stage === "waiting_questions") {
      console.log("\nThe feature remains blocked on explicit owner decisions. No phase was approved.");
    } else {
      try {
        const identity = await gitIdentity(state);
        const reviewFailure =
          state.stage === "reviewing" &&
          error instanceof Error &&
          (/Reviewer/.test(error.message) || /Diagnostic:/.test(error.message));
        state = transitionFeatureState(state, reviewFailure ? "review_failed" : "interrupted");
        state = {
          ...state,
          headCommit: identity.headCommit,
          currentDiffHash: identity.diffHash,
          eventSequence: progress.sequence(),
          diagnosticArtifacts:
            error instanceof Error && error.message.match(/Diagnostic:\s+([^\s]+)/)?.[1]
              ? [
                  ...state.diagnosticArtifacts,
                  error.message.match(/Diagnostic:\s+([^\s]+)/)?.[1] as string
                ]
              : state.diagnosticArtifacts
        };
        await saveFeatureState(coordinationRoot, state);
      } catch {
        // Preserve the original failure if state cannot be updated safely.
      }
      throw error;
    }
  } finally {
    await release();
  }
}

async function recoverPlan(
  coordinationRoot: string,
  initialState: FeatureState,
  readline: Interface,
  explicitSessionId?: string
): Promise<void> {
  if (initialState.stage !== "interrupted" || initialState.plan !== null) {
    throw new Error("Plan recovery is available only for an interrupted feature with no validated plan.");
  }
  const savedSessionId = [...initialState.modelSessions]
    .reverse()
    .find((run) => run.role === "planner" && run.sessionId)?.sessionId;
  const sessionId = explicitSessionId ?? savedSessionId;
  if (!sessionId) {
    throw new Error(
      "No saved planner session ID is available. For a pre-patch failure, rerun with --session <OpenCode-session-id>."
    );
  }

  const release = await acquireFeatureRun(coordinationRoot, initialState.featureSlug);
  let state = initialState;
  const progress = createProgressReporter(coordinationRoot, state);
  try {
    await ensureDependencies(state.worktree, readline);
    const identity = await gitIdentity(state);
    if (
      identity.branch !== state.branch ||
      identity.headCommit !== state.headCommit ||
      identity.mergeBaseCommit !== state.baseCommit ||
      identity.diffHash !== state.currentDiffHash
    ) {
      throw new Error("Registered branch, base, HEAD, or diff changed. Planner recovery refused.");
    }

    const models = await loadModelConfiguration({ repositoryRoot: state.worktree });
    state = { ...state, selectedModels: models, updatedAt: new Date().toISOString() };
    await saveFeatureState(coordinationRoot, state);
    state = await persistStage(coordinationRoot, state, "preflight", null);
    const commandRunner = new LocalCommandRunner();
    const inspector = new OpenCodeCliInspector(state.worktree);
    await runPreflight({
      repositoryRoot: state.worktree,
      models,
      commandRunner,
      openCodeInspector: inspector,
      expectedExistingDiff: {
        branch: state.branch,
        baseCommit: state.baseCommit,
        headCommit: state.headCommit,
        diffHash: state.currentDiffHash
      },
      onEvent: (message) => progress.emit({ stage: state.stage, type: "preflight.progress", message })
    });

    state = await persistStage(coordinationRoot, state, "planning", null);
    console.log(`\nRecovering the compact roadmap with ${models.plannerModel}.`);
    console.log("No builder, reviewer, phase approval, or feature-code action will run.");
    const runner = new OpenCodeCliRunner(state.worktree, undefined, (event) => {
      progress.emit({
        stage: state.stage,
        type: `model.${event.type}`,
        message:
          event.type === "heartbeat"
            ? "planner model is still active; no operator input is needed."
            : `planner model ${event.type}.`,
        phaseId: null,
        data: { modelRole: "planner", elapsedMs: event.elapsedMs }
      });
    });
    const recovered = await recoverPlanFromSession(runner, models.plannerModel, sessionId, {
      repositoryRoot: state.worktree,
      onRun: async (modelRun) => {
        state = {
          ...state,
          modelSessions: [
            ...state.modelSessions,
            {
              role: "planner",
              phaseId: null,
              sessionId: modelRun.sessionId ?? sessionId,
              messageId: modelRun.assistantMessageId ?? null,
              textPartIds: (modelRun.textPartIds ?? []).slice(0, 64),
              finishReason: modelRun.finishReason ?? null,
              cost: modelRun.cost,
              tokens: modelRun.tokens ?? null,
              recordedAt: new Date().toISOString()
            }
          ]
        };
        await saveFeatureState(coordinationRoot, state);
      },
      onDiagnostic: async (path) => {
        if (!state.diagnosticArtifacts.includes(path)) {
          state = { ...state, diagnosticArtifacts: [...state.diagnosticArtifacts, path] };
          await saveFeatureState(coordinationRoot, state);
        }
      }
    });

    const planHash = hashJson(recovered.plan);
    const questions = questionsFromPlan(recovered.plan, planHash);
    const phases = reconcilePhaseQuestionGates(phaseRecordsFromPlan(recovered.plan), questions);
    state = {
      ...state,
      plan: recovered.plan,
      planHash,
      phases,
      questions,
      currentPhaseId: null,
      finalOutcome: "Planner roadmap recovered; no phase has been approved.",
      eventSequence: progress.sequence()
    };
    state = transitionFeatureState(state, "awaiting_phase_approval");
    await saveFeatureState(coordinationRoot, state);

    const phase = nextPendingPhase(state);
    if (!phase) throw new Error("The recovered roadmap has no eligible phase.");
    printRoadmap(recovered.plan, phase.id);
    printPhase(phase);
    console.log("\n✓ The roadmap was recovered and validated.");
    console.log("⏸ No phase was approved and no builder was called.");
    console.log(`Continue only when ready: npm run ai:feature -- continue ${state.featureSlug}`);
  } catch (error) {
    try {
      if (state.stage === "preflight" || state.stage === "planning") {
        state = transitionFeatureState(state, "interrupted");
      }
      state = { ...state, eventSequence: progress.sequence() };
      await saveFeatureState(coordinationRoot, state);
    } catch {
      // Preserve the original fail-closed recovery error.
    }
    throw error;
  } finally {
    await release();
  }
}

async function showStatus(state: FeatureState): Promise<void> {
  console.log(`\n${state.featureTitle} (${state.featureSlug})`);
  console.log(`Status:   ${state.stage}`);
  console.log(`Branch:   ${state.branch}`);
  console.log(`Worktree: ${state.worktree}`);
  console.log(`Base:     ${state.baseCommit}`);
  console.log(`HEAD:     ${state.headCommit}`);
  console.log(`Diff:     ${state.currentDiffHash}`);
  if (state.selectedModels) {
    console.log("\nModels:");
    printModels(state.selectedModels);
  }
  if (state.phases.length > 0) {
    console.log("\nPhases:");
    for (const phase of state.phases) {
      console.log(`${phase.status === "approved" ? "✓" : phase.status === "blocked" ? "!" : "-"} ${phase.id} — ${phase.status} [${phase.risk.toUpperCase()}]`);
    }
  }
  const blocking = state.questions.filter((question) => question.blocking && !question.confirmedAt);
  console.log(`\nBlocking questions: ${blocking.length}`);
  const verification = state.verificationHistory.at(-1);
  if (verification) {
    console.log(`Latest verification: ${verification.passed ? "passed" : "failed"}`);
    for (const commandResult of verification.commands) {
      console.log(
        `  ${commandResult.passed ? "✓" : "✗"} ${commandResult.name} (${Math.round(commandResult.durationMs / 1000)}s)`
      );
    }
  }
  const metrics = state.phaseMetrics.at(-1);
  if (metrics) {
    console.log(
      `Latest phase: ${(metrics.totalTimeMs / 60_000).toFixed(1)}m, cost ${metrics.totalApiCost === null ? "unavailable" : `$${metrics.totalApiCost.toFixed(4)}`}, ${metrics.reviewCycles} review cycle(s)`
    );
  }
  if (state.finalOutcome) console.log(`Outcome: ${state.finalOutcome}`);
}

async function showQuestions(state: FeatureState): Promise<void> {
  const blocking = state.questions.filter((question) => question.blocking && !question.confirmedAt);
  const deferred = state.questions.filter((question) => !question.blocking && !question.confirmedAt);
  const answered = state.questions.filter((question) => question.confirmedAt);
  const print = (label: string, questions: FeatureState["questions"]) => {
    console.log(`\n${label} (${questions.length})`);
    for (const question of questions) {
      console.log(`\n${question.id}${question.phaseId ? ` / ${question.phaseId}` : ""}`);
      console.log(question.text);
      if (question.evidence.length) console.log(`Evidence: ${question.evidence.join("; ")}`);
      console.log(`Why it matters: ${question.whyItMatters}`);
      if (question.answer) console.log(`Confirmed answer: ${question.answer}`);
    }
  };
  print("Blocking", blocking);
  print("Deferred", deferred);
  print("Confirmed", answered);
}

async function answerQuestion(
  coordinationRoot: string,
  state: FeatureState,
  questionId: string | undefined,
  readline: Interface
): Promise<void> {
  const question = questionId
    ? state.questions.find((candidate) => candidate.id === questionId)
    : state.questions.find((candidate) => !candidate.confirmedAt);
  if (!question) throw new Error("The requested unanswered owner question was not found.");
  console.log(`\n${question.id}\n${question.text}`);
  if (question.evidence.length) console.log(`\nEvidence:\n- ${question.evidence.join("\n- ")}`);
  console.log(`\nWhy it matters:\n${question.whyItMatters}`);
  let answer: string;
  if (question.type === "multiple_choice") {
    question.choices.forEach((choice, index) => console.log(`${index + 1}. ${choice.label}`));
    const selected = Number(await ask(readline, "Selection: "));
    const choice = question.choices[selected - 1];
    if (!choice) throw new Error("Question selection is invalid.");
    answer = choice.value;
  } else if (question.type === "yes_no") {
    answer = (await confirm(readline, "Answer yes?", false)) ? "yes" : "no";
  } else {
    answer = await ask(readline, "Answer: ");
  }
  const explanation = await ask(readline, "Optional explanation: ", false);
  console.log(`\nInterpreted decision:\n${question.id}: ${answer}`);
  if (!(await confirm(readline, "Confirm this exact decision?", false))) {
    throw new WorkflowCancelledError("Owner decision was not confirmed.");
  }
  const updated = answerOwnerQuestion(
    question,
    answer,
    explanation || null,
    { planHash: question.planHash, questionHash: question.questionHash }
  );
  let next = {
    ...state,
    questions: state.questions.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
    updatedAt: new Date().toISOString()
  };
  next = {
    ...next,
    phases: reconcilePhaseQuestionGates(next.phases, next.questions)
  };
  if (
    next.stage === "waiting_questions" &&
    next.currentPhaseId &&
    unresolvedBlockingQuestions(next.questions, next.currentPhaseId).length === 0
  ) {
    next = transitionFeatureState(next, "awaiting_phase_approval");
  }
  await saveFeatureState(coordinationRoot, next);
  console.log("Decision saved locally and tied to the current plan and question hashes.");
}

async function recoverReview(
  coordinationRoot: string,
  state: FeatureState
): Promise<void> {
  const release = await acquireFeatureRun(coordinationRoot, state.featureSlug);
  try {
    const models = await loadModelConfiguration({ repositoryRoot: state.worktree });
    const inspector = new OpenCodeCliInspector(state.worktree);
    validateOpenCodeCatalog(await inspector.inspect(), models);
    const recovery = await loadReviewRecovery(state.worktree);
    if (state.currentPhaseId && recovery.phase.id !== state.currentPhaseId) {
      throw new Error("Recovery metadata does not match the feature's current phase.");
    }
    state = await persistStage(coordinationRoot, state, "recovering_review", recovery.phase.id);
    const progress = createProgressReporter(coordinationRoot, state);
    const result = await runReviewCurrentDiff({
      repositoryRoot: state.worktree,
      recovery,
      agentRunner: new OpenCodeCliRunner(state.worktree, undefined, (event) =>
        progress.emit({
          stage: state.stage,
          type: `model.${event.type}`,
          message: `${event.role} model ${event.type}.`,
          phaseId: recovery.phase.id,
          data: { elapsedMs: event.elapsedMs }
        })
      ),
      commandRunner: new LocalCommandRunner(),
      builderModel: models.builderModel,
      reviewerModel: models.reviewerModel,
      onEvent: (message) =>
        progress.emit({ stage: state.stage, type: "recovery.progress", message, phaseId: recovery.phase.id })
    });
    const identity = await inspectRecoveryGitIdentity(state.worktree, state.baseCommit, state.baseCommit);
    state = {
      ...state,
      headCommit: identity.headCommit,
      currentDiffHash: identity.diffHash,
      retryCount: state.retryCount + result.correctionAttempts,
      reviewCycles: state.reviewCycles + result.reviewCycles,
      eventSequence: progress.sequence(),
      phases: state.phases.map((phase) =>
        phase.id === result.phaseId
          ? {
              ...phase,
              status: "approved",
              completedAt: new Date().toISOString(),
              approvedDiffHash: identity.diffHash,
              retryCount: phase.retryCount + result.correctionAttempts,
              reviewCycles: phase.reviewCycles + result.reviewCycles
            }
          : phase
      ),
      verificationHistory: [
        ...state.verificationHistory,
        {
          phaseId: result.phaseId,
          diffHash: identity.diffHash,
          passed: result.verification.passed,
          recordedAt: new Date().toISOString(),
          commands: result.verification.commands.map((commandResult) => ({
            name: commandResult.name,
            passed: commandResult.passed,
            exitCode: commandResult.exitCode,
            durationMs: commandResult.durationMs
          }))
        }
      ]
    };
    state = transitionFeatureState(state, "phase_approved");
    state = transitionFeatureState(state, "awaiting_next_action");
    await saveFeatureState(coordinationRoot, state);
    console.log(`\n✓ ${result.phaseId} review recovery completed.`);
    console.log("⏸ No later phase was started. Explicit owner action is required.");
  } finally {
    await release();
  }
}

async function configureModels(repositoryRoot: string, readline: Interface): Promise<void> {
  const inspector = new OpenCodeCliInspector(repositoryRoot);
  const catalog = await inspector.inspect();
  console.log(`\nOpenCode ${catalog.version}`);
  console.log(`Authenticated providers: ${catalog.authenticatedProviders.join(", ") || "none"}`);
  console.log("\nAvailable authenticated model IDs:\n");
  const authenticated = authenticatedModelIds(catalog);
  console.log((authenticated.length ? authenticated : catalog.modelIds).join("\n"));
  const models = {
    plannerModel: await ask(readline, "\nPlanner model ID: "),
    builderModel: await ask(readline, "Builder model ID: "),
    reviewerModel: await ask(readline, "Reviewer model ID: ")
  };
  const escalationModel = await ask(readline, "Optional future escalation model ID: ", false);
  const selectedModels = escalationModel ? { ...models, escalationModel } : models;
  validateOpenCodeCatalog(catalog, selectedModels);
  const path = await saveUserModelConfiguration(selectedModels);
  console.log(`\nSaved credential-free user defaults to ${path}.`);
}

async function watchFeature(coordinationRoot: string, state: FeatureState): Promise<void> {
  const path = featureEventsPath(coordinationRoot, state.featureSlug);
  let delivered = 0;
  const printNew = async () => {
    let lines: string[];
    try {
      lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const line of lines.slice(delivered)) {
      const event = JSON.parse(line) as { timestamp: string; phaseId: string | null; message: string };
      console.log(`${event.timestamp} ${event.phaseId ?? "workflow"} ${event.message}`);
    }
    delivered = lines.length;
  };
  await printNew();
  console.log("\nWatching local workflow events. Press Ctrl+C to stop.\n");
  await new Promise<void>((resolveWatch, reject) => {
    const watcher = watch(featureDirectory(coordinationRoot, state.featureSlug), async (_, filename) => {
      if (filename === "events.jsonl") {
        try {
          await printNew();
        } catch (error) {
          watcher.close();
          reject(error);
        }
      }
    });
    process.once("SIGINT", () => {
      watcher.close();
      resolveWatch();
    });
  });
}

async function interactiveCommand(readline: Interface): Promise<string> {
  console.log(`\nNewl AI Development Engine\n\nWhat would you like to do?\n\n1. Start a new feature\n2. Continue an existing feature\n3. Run the next approved phase\n4. View workflow status\n5. Resume an interrupted workflow\n6. Recover a failed review\n7. Answer blocking questions\n8. Check system readiness\n9. Recover a failed plan\n`);
  const selection = await ask(readline, "Selection: ");
  return (
    {
      "1": "start",
      "2": "continue",
      "3": "next",
      "4": "status",
      "5": "resume",
      "6": "recover-review",
      "7": "questions",
      "8": "readiness",
      "9": "recover-plan"
    } as Record<string, string>
  )[selection] ?? "";
}

export async function runLauncher(): Promise<void> {
  const repositoryRoot = await findRepositoryRoot(process.cwd());
  const coordinationRoot = await findCoordinationRoot(repositoryRoot);
  const operatorInput = createOperatorInput();
  const readline = operatorInput.readline;
  try {
    const args = process.argv.slice(2);
    let action = args[0] ?? "";
    if (!action) action = await interactiveCommand(readline);
    if (!action) throw new Error("Menu selection is invalid.");

    if (action === "models") {
      await ensureDependencies(repositoryRoot, readline);
      const subcommand = args[1] ?? "list";
      if (subcommand === "configure") {
        await configureModels(repositoryRoot, readline);
      } else if (subcommand === "list") {
        const catalog = await new OpenCodeCliInspector(repositoryRoot).inspect();
        console.log(catalog.modelIds.join("\n"));
        console.log(`\nUser defaults: ${DEFAULT_USER_MODEL_CONFIG_FILE}`);
      } else {
        throw new Error("Models command must be list or configure.");
      }
      return;
    }

    let state: FeatureState;
    if (action === "start") {
      state = await createNewFeature(coordinationRoot, readline);
      if (await confirm(readline, "Run planning and show the next phase for approval?", true)) {
        await runFeature(coordinationRoot, state, readline);
      }
      return;
    }

    if (action === "adopt") {
      const state = await adoptExistingFeature(coordinationRoot, readline, args[1]);
      await showStatus(state);
      return;
    }

    if (action === "continue" && (await listFeatureStates(coordinationRoot)).length === 0) {
      console.log("No registered features were found. The launcher can adopt an existing task worktree.");
      const adopted = await adoptExistingFeature(coordinationRoot, readline, args[1]);
      await showStatus(adopted);
      return;
    }

    try {
      state = await selectFeature(coordinationRoot, readline, args[1]);
    } catch (error) {
      if (action === "continue" && (error as NodeJS.ErrnoException).code === "ENOENT") {
        state = await adoptExistingFeature(coordinationRoot, readline, args[1]);
      } else {
        throw error;
      }
    }
    if (action === "status") return showStatus(state);
    if (action === "watch") return watchFeature(coordinationRoot, state);
    if (action === "questions") {
      await showQuestions(state);
      if (!args[1] && state.questions.some((question) => !question.confirmedAt)) {
        if (await confirm(readline, "\nAnswer the next unanswered question now?", false)) {
          await answerQuestion(coordinationRoot, state, undefined, readline);
        }
      }
      return;
    }
    if (action === "answer") return answerQuestion(coordinationRoot, state, args[2], readline);
    if (action === "recover-review") return recoverReview(coordinationRoot, state);
    if (action === "recover-plan") {
      const sessionFlag = args.indexOf("--session");
      const explicitSessionId = sessionFlag >= 0 ? args[sessionFlag + 1] : undefined;
      if (sessionFlag >= 0 && !explicitSessionId) {
        throw new Error("--session requires an OpenCode session ID.");
      }
      return recoverPlan(coordinationRoot, state, readline, explicitSessionId);
    }
    if (action === "readiness") {
      const models = await loadModelConfiguration({ repositoryRoot: state.worktree });
      const result = await runPreflight({
        repositoryRoot: state.worktree,
        models,
        commandRunner: new LocalCommandRunner(),
        openCodeInspector: new OpenCodeCliInspector(state.worktree),
        expectedExistingDiff: {
          branch: state.branch,
          baseCommit: state.baseCommit,
          headCommit: state.headCommit,
          diffHash: state.currentDiffHash
        },
        onEvent: (message) => console.log(`[ai-workflow] ${message}`)
      });
      console.log(`\nReadiness passed on ${result.branch}. No model call was made.`);
      return;
    }
    if (action === "continue") {
      if (state.stage === "complete") {
        await showStatus(state);
        console.log("\nThis roadmap has no pending phase. Manual branch completion is required.");
        return;
      }
      if (state.stage === "review_failed") {
        console.log(`Review recovery is available: npm run ai:feature -- recover-review ${state.featureSlug}`);
        return;
      }
      if (state.stage === "interrupted" && state.plan === null) {
        console.log(`Plan recovery is available: npm run ai:feature -- recover-plan ${state.featureSlug}`);
        return;
      }
      if (state.stage === "waiting_questions") {
        await showQuestions(state);
        return;
      }
      return runFeature(coordinationRoot, state, readline);
    }
    if (action === "next") {
      if (state.stage !== "awaiting_next_action" && state.stage !== "awaiting_phase_approval") {
        throw new Error(`Feature is ${state.stage}; it is not ready for the next phase.`);
      }
      return runFeature(coordinationRoot, state, readline);
    }
    if (action === "resume") {
      if (state.stage !== "interrupted" && state.stage !== "paused") {
        throw new Error(`Feature is ${state.stage}; resume is only available after interruption or pause.`);
      }
      if (state.stage === "interrupted" && state.plan === null) {
        console.log(`Plan recovery is available: npm run ai:feature -- recover-plan ${state.featureSlug}`);
        return;
      }
      return runFeature(coordinationRoot, state, readline);
    }
    throw new Error(`Unknown ai:feature action ${action}.`);
  } finally {
    operatorInput.close();
  }
}
