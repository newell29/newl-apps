#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { loadModelConfiguration, saveModelConfiguration } from "./config";
import { findRepositoryRoot, inspectGitWorktree } from "./git";
import { OpenCodeCliInspector, OpenCodeCliRunner } from "./opencode";
import { WorkflowPlan } from "./planner";
import {
  authenticatedModelIds,
  PreflightError,
  runPreflight,
  validateOpenCodeCatalog
} from "./preflight";
import { LocalCommandRunner } from "./verification";
import { loadReviewRecovery, runReviewCurrentDiff } from "./recovery";
import {
  runWorkflow,
  WorkflowCancelledError,
  WorkflowEscalationError
} from "./workflow";

function numberOption(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer.`);
  return number;
}

async function readRequest(
  repositoryRoot: string,
  inlineRequest: string | undefined,
  requestFile: string | undefined
): Promise<string> {
  if (Boolean(inlineRequest) === Boolean(requestFile)) {
    throw new Error("Supply exactly one of --request or --request-file.");
  }
  if (inlineRequest) return inlineRequest.trim();

  const absolute = resolve(repositoryRoot, requestFile as string);
  const rel = relative(repositoryRoot, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(".env")) {
    throw new Error("The feature request file must be a non-secret file inside the repository.");
  }
  return (await readFile(absolute, "utf8")).trim();
}

function printPlan(plan: WorkflowPlan): void {
  console.log("\nProposed implementation plan\n");
  console.log(plan.summary);
  if (plan.assumptions.length > 0) console.log(`\nAssumptions:\n- ${plan.assumptions.join("\n- ")}`);
  if (plan.openQuestions.length > 0) {
    console.log(`\nOpen questions requiring human judgment:\n- ${plan.openQuestions.join("\n- ")}`);
  }
  for (const [index, phase] of plan.phases.entries()) {
    console.log(`\n${index + 1}. ${phase.title} [${phase.risk}]\n${phase.objective}`);
    console.log(`   Done when: ${phase.definitionOfDone.join("; ")}`);
    console.log(
      `   Expected regression tests: ${phase.testFiles.length > 0 ? phase.testFiles.join(", ") : "none named; Qwen must justify coverage"}`
    );
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      request: { type: "string" },
      "request-file": { type: "string" },
      branch: { type: "string" },
      "planner-model": { type: "string" },
      "builder-model": { type: "string" },
      "reviewer-model": { type: "string" },
      "model-config": { type: "string" },
      "metrics-file": { type: "string" },
      "max-review-cycles": { type: "string" },
      "max-retries": { type: "string" },
      "list-models": { type: "boolean" },
      "validate-models": { type: "boolean" },
      "save-model-config": { type: "boolean" },
      "preflight-only": { type: "boolean" },
      "recovery-file": { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: true
  });

  if (positionals.length > 1 || (positionals[0] && positionals[0] !== "review-current-diff")) {
    throw new Error("The only supported command is review-current-diff.");
  }
  const command = positionals[0];

  if (values.help) {
    console.log(`Usage:
  npm run ai:feature                    Recommended interactive Version 1B.1 launcher
  npm run ai-workflow -- --request "Feature request" [options]
  npm run ai-workflow -- --request-file requests/feature.md [options]
  npm run ai-workflow:models
  npm run ai-workflow:configure -- --planner-model provider/model --builder-model provider/model --reviewer-model provider/model
  npm run ai-workflow:preflight
  npm run ai-workflow -- review-current-diff [--recovery-file tmp/ai-workflow/review-recovery.json]

Models are read from tmp/ai-workflow/models.json by default. CLI flags or matching
AI_WORKFLOW_*_MODEL environment variables may override that local ignored file:
  --planner-model provider/model     Qwen planner model
  --builder-model provider/model     DeepSeek builder model
  --reviewer-model provider/model    Qwen reviewer model

Other options:
  --branch codex/name                Create a new simple feature branch
  --model-config tmp/name.json       Select another ignored model configuration
  --metrics-file tmp/name.jsonl      Ignored local metrics output
  --recovery-file tmp/name.json      Owner-only pinned review recovery metadata
  --max-review-cycles 3              Fresh Qwen reviews allowed per phase
  --max-retries 3                    Builder corrections allowed per phase`);
    return;
  }

  const repositoryRoot = await findRepositoryRoot(process.cwd());
  const inspector = new OpenCodeCliInspector(repositoryRoot);

  if (values["list-models"]) {
    const catalog = await inspector.inspect();
    console.log(`OpenCode ${catalog.version}`);
    console.log(
      `Authenticated providers: ${
        catalog.authenticatedProviders.length > 0
          ? catalog.authenticatedProviders.join(", ")
          : "none (run npx opencode auth login)"
      }`
    );
    const models = authenticatedModelIds(catalog);
    console.log(models.length > 0 ? models.join("\n") : "No models from authenticated providers were found.");
    return;
  }

  if (
    values["save-model-config"] &&
    (!values["planner-model"] || !values["builder-model"] || !values["reviewer-model"])
  ) {
    throw new Error("Saving model configuration requires all three explicit --*-model options.");
  }

  const models = await loadModelConfiguration({
    repositoryRoot,
    configFile: values["model-config"],
    plannerModel: values["planner-model"],
    builderModel: values["builder-model"],
    reviewerModel: values["reviewer-model"]
  });
  const commandRunner = new LocalCommandRunner();
  const agentRunner = new OpenCodeCliRunner(repositoryRoot);

  if (values["save-model-config"] || values["validate-models"]) {
    const catalog = await inspector.inspect();
    validateOpenCodeCatalog(catalog, models);
    if (values["save-model-config"]) {
      const path = await saveModelConfiguration(repositoryRoot, models, values["model-config"]);
      console.log(`Validated model IDs and saved the credential-free local configuration to ${path}.`);
    } else {
      console.log("Selected model IDs, provider authentication, and agent profiles are valid.");
    }
    return;
  }

  if (command === "review-current-diff") {
    const worktree = await inspectGitWorktree(repositoryRoot);
    if (!worktree.isDedicatedWorktree) {
      throw new Error("Review recovery must run inside its existing dedicated task worktree.");
    }
    const catalog = await inspector.inspect();
    validateOpenCodeCatalog(catalog, models);
    const recovery = await loadReviewRecovery(repositoryRoot, values["recovery-file"]);
    const result = await runReviewCurrentDiff({
      repositoryRoot,
      recovery,
      agentRunner,
      commandRunner,
      builderModel: models.builderModel,
      reviewerModel: models.reviewerModel,
      maxReviewCycles: numberOption(values["max-review-cycles"], "--max-review-cycles"),
      maxRetries: numberOption(values["max-retries"], "--max-retries"),
      onEvent: (message) => console.log(`[ai-workflow] ${message}`)
    });
    console.log("\nReview recovery complete. The current phase is the only phase approved.");
    console.log("No later phase was started. Explicit owner approval is required before any continuation.");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const preflight = () =>
    runPreflight({
      repositoryRoot,
      requestedBranch: values.branch,
      models,
      commandRunner,
      openCodeInspector: inspector,
      onEvent: (message) => console.log(`[ai-workflow] ${message}`)
    });

  if (values["preflight-only"]) {
    const result = await preflight();
    console.log("Preflight passed without making a model call.");
    console.log(
      JSON.stringify(
        {
          branch: result.branch,
          baseCommit: result.baseCommit,
          openCodeVersion: result.openCodeVersion,
          authenticatedProviders: result.authenticatedProviders,
          selectedModels: result.selectedModels,
          verification: result.baselineVerification.commands.map((command) => ({
            name: command.name,
            passed: command.passed,
            durationMs: command.durationMs
          }))
        },
        null,
        2
      )
    );
    return;
  }

  const originalRequest = await readRequest(repositoryRoot, values.request, values["request-file"]);
  if (!originalRequest) throw new Error("The feature request cannot be empty.");

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const result = await runWorkflow(
      {
        repositoryRoot,
        originalRequest,
        plannerModel: models.plannerModel,
        builderModel: models.builderModel,
        reviewerModel: models.reviewerModel,
        branch: values.branch,
        metricsFile: values["metrics-file"],
        maxReviewCycles: numberOption(values["max-review-cycles"], "--max-review-cycles"),
        maxRetriesPerPhase: numberOption(values["max-retries"], "--max-retries")
      },
      {
        agentRunner,
        commandRunner,
        preflight,
        approvePhase: async (plan, phaseId) => {
          if (!process.stdin.isTTY || !process.stdout.isTTY) {
            throw new Error("Phase approval requires an interactive terminal.");
          }
          printPlan(plan);
          const answer = await readline.question(
            `\nApprove ${phaseId} only and begin implementation? [y/N] `
          );
          return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
        },
        onEvent: (message) => console.log(`[ai-workflow] ${message}`)
      }
    );

    console.log(
      `\n${result.phaseId} complete. The workflow stopped before every later phase; no commit, push, merge, or deployment was performed.`
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    readline.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof WorkflowCancelledError) {
    console.error(`[ai-workflow] Cancelled: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (error instanceof WorkflowEscalationError) {
    console.error(`[ai-workflow] Manual escalation required: ${error.message}`);
    process.exitCode = 3;
    return;
  }
  if (error instanceof PreflightError) {
    console.error(`[ai-workflow] Preflight failed before any model call: ${error.message}`);
    process.exitCode = 4;
    return;
  }
  console.error(`[ai-workflow] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
