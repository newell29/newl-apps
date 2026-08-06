import { appendFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { implementPhase } from "./builder";
import type { ConfirmedOwnerDecisions } from "./decisions";
import {
  getSurroundingCode,
  getWorkflowDiff,
  getWorkflowDiffHash,
  listChangedFiles
} from "./git";
import { AgentRole, AgentRunner, AgentRunResult } from "./opencode";
import { createPlan, WorkflowPlan } from "./planner";
import { PreflightResult } from "./preflight";
import { ReviewDecision, reviewPhase } from "./reviewer";
import {
  evaluatorBlocksApproval,
  EvaluationResult,
  validateEvaluationResult,
  WorkflowEvaluator
} from "./evaluator";
import { WorkflowStage } from "./state";
import { CommandRunner, runVerification, VerificationResult } from "./verification";

export type WorkflowMetrics = {
  plannerModel: string;
  builderModel: string;
  reviewerModel: string;
  escalationModel: string | null;
  escalationAttempts: number;
  startedAt: string;
  completedAt: string;
  totalTimeMs: number;
  totalApiCost: number | null;
  retryCount: number;
  reviewCycles: number;
  filesChanged: string[];
  testsExecuted: string[];
};

export type WorkflowOptions = {
  repositoryRoot: string;
  originalRequest: string;
  plannerModel: string;
  builderModel: string;
  reviewerModel: string;
  escalationModel?: string;
  branch?: string;
  metricsFile?: string;
  maxReviewCycles?: number;
  maxRetriesPerPhase?: number;
  approvedPlan?: WorkflowPlan;
  phaseId?: string;
  featureSlug?: string;
  confirmedDecisions?: ConfirmedOwnerDecisions;
  ownerGateSatisfied?: boolean;
  evaluators?: WorkflowEvaluator[];
};

export type WorkflowDependencies = {
  agentRunner: AgentRunner;
  commandRunner: CommandRunner;
  preflight: () => Promise<PreflightResult>;
  approvePlan?: (plan: WorkflowPlan) => Promise<boolean>;
  approvePhase?: (plan: WorkflowPlan, phaseId: string) => Promise<boolean>;
  ownerGateSatisfied?: (plan: WorkflowPlan, phaseId: string) => Promise<boolean>;
  onPlanCreated?: (plan: WorkflowPlan) => Promise<void>;
  onStage?: (stage: WorkflowStage, phaseId: string | null) => Promise<void>;
  onModelRun?: (
    role: AgentRole,
    phaseId: string | null,
    result: AgentRunResult
  ) => Promise<void>;
  onDiagnostic?: (path: string) => Promise<void>;
  onVerification?: (phaseId: string, result: VerificationResult) => Promise<void>;
  onEvent?: (message: string) => void;
  now?: () => Date;
};

export type WorkflowResult = {
  branch: string;
  baseCommit: string;
  plan: WorkflowPlan;
  phaseId: string;
  stoppedBeforeNextPhase: true;
  metrics: WorkflowMetrics;
};

export class WorkflowEscalationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowEscalationError";
  }
}

export class WorkflowCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowCancelledError";
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

export function reviewerCorrections(decision: ReviewDecision): string[] {
  return [
    ...decision.findings.map((finding) => {
      const location = finding.file
        ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
        : "no file reference";
      return `${finding.severity.toUpperCase()} at ${location}. Evidence: ${finding.evidence} Required correction: ${finding.requiredCorrection}`;
    }),
    ...decision.missingTests.map((test) => `Missing test coverage: ${test}`),
    ...decision.scopeConcerns.map((concern) => `Scope concern: ${concern}`)
  ];
}

async function writeMetrics(
  repositoryRoot: string,
  metricsFile: string | undefined,
  metrics: WorkflowMetrics
): Promise<void> {
  const outputPath = resolve(repositoryRoot, metricsFile ?? "tmp/ai-workflow-metrics.jsonl");
  const rel = relative(repositoryRoot, outputPath);
  if (!rel.startsWith(`tmp${sep}`) || rel.includes(`..${sep}`)) {
    throw new Error("Version 1A metrics files must remain under the repository's ignored tmp/ directory.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(metrics)}\n`, "utf8");
}

function validateLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error(`${label} must be an integer from 1 to 10.`);
  }
  return limit;
}

export async function runWorkflow(
  options: WorkflowOptions,
  dependencies: WorkflowDependencies
): Promise<WorkflowResult> {
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now();
  const maxReviewCycles = validateLimit(options.maxReviewCycles, 3, "maxReviewCycles");
  const maxRetriesPerPhase = validateLimit(options.maxRetriesPerPhase, 3, "maxRetriesPerPhase");
  const event = dependencies.onEvent ?? (() => undefined);
  await dependencies.onStage?.("preflight", null);
  const preflight = await dependencies.preflight();
  const gitState = {
    branch: preflight.branch,
    baseCommit: preflight.baseCommit
  };

  let retryCount = 0;
  let reviewCycles = 0;
  let escalationAttempts = 0;
  let apiCost = 0;
  let completeCost = true;
  const testsExecuted: string[] = [];
  const addCost = (cost: number | null) => {
    if (cost === null) completeCost = false;
    else apiCost += cost;
  };

  let plan: WorkflowPlan;
  if (options.approvedPlan) {
    plan = options.approvedPlan;
    event(`Using the stored approved roadmap; no planner call is required.`);
  } else {
    await dependencies.onStage?.("planning", null);
    event(`Planning on ${gitState.branch} with ${options.plannerModel}.`);
    const planned = await createPlan(
      dependencies.agentRunner,
      options.plannerModel,
      options.originalRequest,
      {
        repositoryRoot: options.repositoryRoot,
        onRun: (run) => dependencies.onModelRun?.("planner", null, run) ?? Promise.resolve(),
        onDiagnostic: dependencies.onDiagnostic
      }
    );
    addCost(planned.cost);
    plan = planned.plan;
    await dependencies.onPlanCreated?.(plan);
  }

  const phase = options.phaseId
    ? plan.phases.find((candidate) => candidate.id === options.phaseId)
    : plan.phases[0];
  if (!phase) throw new Error(`Selected phase ${options.phaseId ?? "(first)"} is absent from the plan.`);
  const ownerGateSatisfied =
    options.ownerGateSatisfied ||
    (dependencies.ownerGateSatisfied
      ? await dependencies.ownerGateSatisfied(plan, phase.id)
      : false);
  if ((phase.requiresOwnerApproval || phase.risk === "owner_gated") && !ownerGateSatisfied) {
    throw new WorkflowEscalationError(
      `${phase.id} is owner-gated and cannot start until its blocking decisions are confirmed.`
    );
  }

  event(`Roadmap ready with ${plan.phases.length} phase(s); awaiting approval for ${phase.id} only.`);
  await dependencies.onStage?.("awaiting_phase_approval", phase.id);
  const approved = dependencies.approvePhase
    ? await dependencies.approvePhase(plan, phase.id)
    : dependencies.approvePlan
      ? await dependencies.approvePlan(plan)
      : false;
  if (!approved) {
    throw new WorkflowCancelledError(`The operator did not approve ${phase.id}.`);
  }

    let corrections: string[] = [];
    let phaseRetries = 0;
    let phaseReviewCycles = 0;
    let escalationUsed = false;
    let useEscalationRemediation = false;
    event(`Starting approved phase ${phase.id}: ${phase.title}`);

    while (true) {
      await dependencies.onStage?.(corrections.length > 0 ? "correcting" : "implementing", phase.id);
      const isEscalationRemediation = useEscalationRemediation;
      const implementationModel = isEscalationRemediation
        ? options.escalationModel as string
        : options.builderModel;
      if (isEscalationRemediation) {
        event(
          `Builder correction limit reached for ${phase.id}; starting one fresh bounded remediation with ${implementationModel}.`
        );
        useEscalationRemediation = false;
        escalationAttempts += 1;
      }
      const built = await implementPhase(
        dependencies.agentRunner,
        implementationModel,
        phase,
        corrections,
        { confirmedDecisions: options.confirmedDecisions }
      );
      addCost(built.cost);
      await dependencies.onModelRun?.("builder", phase.id, built.run);

      event(`Running mandatory verification for ${phase.id}.`);
      await dependencies.onStage?.("verifying", phase.id);
      const verification = await runVerification(
        dependencies.commandRunner,
        options.repositoryRoot,
        gitState.baseCommit
      );
      await dependencies.onVerification?.(phase.id, verification);
      const testCommand = verification.commands.find((command) => command.name === "tests");
      if (testCommand) testsExecuted.push(`${testCommand.command} ${testCommand.args.join(" ")}`);

      if (!verification.passed) {
        phaseRetries += 1;
        retryCount += 1;
        corrections = failedVerificationCorrections(verification);
        if (isEscalationRemediation) {
          throw new WorkflowEscalationError(
            `${phase.id} still failed mandatory verification after its single escalation remediation attempt.`
          );
        }
        if (phaseRetries >= maxRetriesPerPhase) {
          if (options.escalationModel && !escalationUsed) {
            escalationUsed = true;
            useEscalationRemediation = true;
            event(
              `${phase.id} exhausted ${maxRetriesPerPhase} ordinary builder failures; preserving exact verification failures for escalation remediation.`
            );
            continue;
          }
          throw new WorkflowEscalationError(
            `${phase.id} reached ${maxRetriesPerPhase} failed ordinary builder attempts after mandatory verification failures.`
          );
        }
        event(`Verification failed for ${phase.id}; returning exact failures to the builder.`);
        continue;
      }

      if (phaseReviewCycles >= maxReviewCycles) {
        throw new WorkflowEscalationError(
          `${phase.id} reached the ${maxReviewCycles}-cycle independent review limit.`
        );
      }

      event(`Starting fresh independent review ${phaseReviewCycles + 1} for ${phase.id}.`);
      await dependencies.onStage?.("reviewing", phase.id);
      const { writeReviewRecoveryMetadata } = await import("./recovery");
      await writeReviewRecoveryMetadata({
        repositoryRoot: options.repositoryRoot,
        branch: gitState.branch,
        baseCommit: gitState.baseCommit,
        originalRequest: options.originalRequest,
        approvedPlan: plan,
        phaseId: phase.id,
        confirmedDecisions: options.confirmedDecisions
      });
      const diffHash = await getWorkflowDiffHash(options.repositoryRoot, gitState.baseCommit);
      const evaluations: EvaluationResult[] = [];
      for (const evaluator of options.evaluators ?? []) {
        const result = validateEvaluationResult(
          await evaluator.evaluate({
            repositoryRoot: options.repositoryRoot,
            featureSlug: options.featureSlug ?? "unregistered-feature",
            phaseId: phase.id,
            baseCommit: gitState.baseCommit,
            diffHash,
            verification,
            confirmedDecisions: options.confirmedDecisions ?? {}
          }),
          { evaluatorId: evaluator.id, diffHash }
        );
        if (evaluatorBlocksApproval(result)) {
          throw new WorkflowEscalationError(`Workflow evaluator ${evaluator.id} blocked review.`);
        }
        evaluations.push(result);
      }
      const reviewed = await reviewPhase(dependencies.agentRunner, options.reviewerModel, {
        repositoryRoot: options.repositoryRoot,
        originalRequest: options.originalRequest,
        approvedPlan: plan,
        phase,
        gitDiff: await getWorkflowDiff(options.repositoryRoot, gitState.baseCommit),
        surroundingCode: await getSurroundingCode(options.repositoryRoot),
        verification,
        confirmedDecisions: options.confirmedDecisions,
        evaluations
      });
      addCost(reviewed.cost);
      await dependencies.onModelRun?.("reviewer", phase.id, reviewed.run);
      phaseReviewCycles += 1;
      reviewCycles += 1;

      if (reviewed.decision.status === "approved") {
        event(`Independent reviewer approved ${phase.id}.`);
        await dependencies.onStage?.("phase_approved", phase.id);
        break;
      }
      if (reviewed.decision.status === "escalate") {
        throw new WorkflowEscalationError(
          reviewed.decision.escalationReason ?? `The reviewer escalated ${phase.id}.`
        );
      }

      phaseRetries += 1;
      retryCount += 1;
      corrections = reviewerCorrections(reviewed.decision);
      if (phaseReviewCycles >= maxReviewCycles) {
        throw new WorkflowEscalationError(
          `${phase.id} could not be approved within the configured correction and review limits.`
        );
      }
      if (phaseRetries >= maxRetriesPerPhase) {
        if (options.escalationModel && !escalationUsed) {
          escalationUsed = true;
          useEscalationRemediation = true;
          event(
            `${phase.id} exhausted ${maxRetriesPerPhase} ordinary correction attempts; preserving exact reviewer findings for escalation remediation.`
          );
          continue;
        }
        throw new WorkflowEscalationError(
          `${phase.id} could not be approved within the configured correction limit.`
        );
      }
      event(`Reviewer requested ${corrections.length} correction(s) for ${phase.id}.`);
    }

  const completedAt = now();
  const metrics: WorkflowMetrics = {
    plannerModel: options.plannerModel,
    builderModel: options.builderModel,
    reviewerModel: options.reviewerModel,
    escalationModel: options.escalationModel ?? null,
    escalationAttempts,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    totalTimeMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    totalApiCost: completeCost ? apiCost : null,
    retryCount,
    reviewCycles,
    filesChanged: await listChangedFiles(options.repositoryRoot),
    testsExecuted
  };
  await writeMetrics(options.repositoryRoot, options.metricsFile, metrics);
  event(`${phase.id} is approved. The workflow stopped before every later phase.`);

  return {
    branch: gitState.branch,
    baseCommit: gitState.baseCommit,
    plan,
    phaseId: phase.id,
    stoppedBeforeNextPhase: true,
    metrics
  };
}
