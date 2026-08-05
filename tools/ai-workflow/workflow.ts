import { appendFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { implementPhase } from "./builder";
import {
  getSurroundingCode,
  getWorkflowDiff,
  listChangedFiles
} from "./git";
import { AgentRunner } from "./opencode";
import { createPlan, WorkflowPlan } from "./planner";
import { PreflightResult } from "./preflight";
import { ReviewDecision, reviewPhase } from "./reviewer";
import { CommandRunner, runVerification, VerificationResult } from "./verification";

export type WorkflowMetrics = {
  plannerModel: string;
  builderModel: string;
  reviewerModel: string;
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
  branch?: string;
  metricsFile?: string;
  maxReviewCycles?: number;
  maxRetriesPerPhase?: number;
};

export type WorkflowDependencies = {
  agentRunner: AgentRunner;
  commandRunner: CommandRunner;
  preflight: () => Promise<PreflightResult>;
  approvePlan: (plan: WorkflowPlan) => Promise<boolean>;
  onEvent?: (message: string) => void;
  now?: () => Date;
};

export type WorkflowResult = {
  branch: string;
  baseCommit: string;
  plan: WorkflowPlan;
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
  const preflight = await dependencies.preflight();
  const gitState = {
    branch: preflight.branch,
    baseCommit: preflight.baseCommit
  };

  let retryCount = 0;
  let reviewCycles = 0;
  let apiCost = 0;
  let completeCost = true;
  const testsExecuted: string[] = [];
  const addCost = (cost: number | null) => {
    if (cost === null) completeCost = false;
    else apiCost += cost;
  };

  event(`Planning on ${gitState.branch} with ${options.plannerModel}.`);
  const planned = await createPlan(
    dependencies.agentRunner,
    options.plannerModel,
    options.originalRequest
  );
  addCost(planned.cost);

  event(`Plan ready with ${planned.plan.phases.length} phase(s); awaiting one human approval.`);
  if (!(await dependencies.approvePlan(planned.plan))) {
    throw new WorkflowCancelledError("The human reviewer did not approve the overall plan.");
  }

  for (const [phaseIndex, phase] of planned.plan.phases.entries()) {
    if (phase.requiresOwnerApproval) {
      throw new WorkflowEscalationError(
        `${phase.id} requires explicit owner approval and cannot start automatically.`
      );
    }
    let corrections: string[] = [];
    let phaseRetries = 0;
    let phaseReviewCycles = 0;
    event(`Starting phase ${phaseIndex + 1}/${planned.plan.phases.length}: ${phase.title}`);

    while (true) {
      const built = await implementPhase(
        dependencies.agentRunner,
        options.builderModel,
        phase,
        corrections
      );
      addCost(built.cost);

      event(`Running mandatory verification for ${phase.id}.`);
      const verification = await runVerification(
        dependencies.commandRunner,
        options.repositoryRoot,
        gitState.baseCommit
      );
      const testCommand = verification.commands.find((command) => command.name === "tests");
      if (testCommand) testsExecuted.push(`${testCommand.command} ${testCommand.args.join(" ")}`);

      if (!verification.passed) {
        phaseRetries += 1;
        retryCount += 1;
        if (phaseRetries > maxRetriesPerPhase) {
          throw new WorkflowEscalationError(
            `${phase.id} exceeded ${maxRetriesPerPhase} correction retries after mandatory verification failures.`
          );
        }
        corrections = failedVerificationCorrections(verification);
        event(`Verification failed for ${phase.id}; returning exact failures to the builder.`);
        continue;
      }

      if (phaseReviewCycles >= maxReviewCycles) {
        throw new WorkflowEscalationError(
          `${phase.id} reached the ${maxReviewCycles}-cycle independent review limit.`
        );
      }

      event(`Starting fresh independent review ${phaseReviewCycles + 1} for ${phase.id}.`);
      const { writeReviewRecoveryMetadata } = await import("./recovery");
      await writeReviewRecoveryMetadata({
        repositoryRoot: options.repositoryRoot,
        branch: gitState.branch,
        baseCommit: gitState.baseCommit,
        originalRequest: options.originalRequest,
        approvedPlan: planned.plan,
        phaseId: phase.id
      });
      const reviewed = await reviewPhase(dependencies.agentRunner, options.reviewerModel, {
        repositoryRoot: options.repositoryRoot,
        originalRequest: options.originalRequest,
        approvedPlan: planned.plan,
        phase,
        gitDiff: await getWorkflowDiff(options.repositoryRoot, gitState.baseCommit),
        surroundingCode: await getSurroundingCode(options.repositoryRoot),
        verification
      });
      addCost(reviewed.cost);
      phaseReviewCycles += 1;
      reviewCycles += 1;

      if (reviewed.decision.status === "approved") {
        event(`Independent reviewer approved ${phase.id}.`);
        break;
      }
      if (reviewed.decision.status === "escalate") {
        throw new WorkflowEscalationError(
          reviewed.decision.escalationReason ?? `The reviewer escalated ${phase.id}.`
        );
      }

      phaseRetries += 1;
      retryCount += 1;
      if (phaseRetries > maxRetriesPerPhase || phaseReviewCycles >= maxReviewCycles) {
        throw new WorkflowEscalationError(
          `${phase.id} could not be approved within the configured correction and review limits.`
        );
      }
      corrections = reviewerCorrections(reviewed.decision);
      event(`Reviewer requested ${corrections.length} correction(s) for ${phase.id}.`);
    }
  }

  const completedAt = now();
  const metrics: WorkflowMetrics = {
    plannerModel: options.plannerModel,
    builderModel: options.builderModel,
    reviewerModel: options.reviewerModel,
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
  event("All approved phases are complete. Review and finish the branch manually.");

  return {
    branch: gitState.branch,
    baseCommit: gitState.baseCommit,
    plan: planned.plan,
    metrics
  };
}
