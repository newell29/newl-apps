import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ModelConfiguration } from "./config";
import {
  ensureWorkflowBranch,
  inspectGitWorktree,
  inspectRecoveryGitIdentity
} from "./git";
import { OpenCodeCatalog, OpenCodeInspector } from "./opencode";
import { CommandRunner, runVerification, VerificationResult } from "./verification";

const REQUIRED_AGENTS = ["newl-ai-planner", "newl-ai-builder", "newl-ai-reviewer"] as const;
const REQUIRED_PACKAGE_SCRIPTS = ["typecheck", "lint", "build", "test"] as const;

export type PreflightResult = {
  branch: string;
  baseCommit: string;
  openCodeVersion: string;
  authenticatedProviders: string[];
  selectedModels: ModelConfiguration;
  baselineVerification: VerificationResult;
};

export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreflightError";
  }
}

function normalizeProvider(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function providerIsAuthenticated(providerId: string, authenticatedProviders: string[]): boolean {
  const expected = normalizeProvider(providerId);
  return authenticatedProviders.some((provider) => {
    const actual = normalizeProvider(provider);
    return actual === expected || actual.includes(expected) || expected.includes(actual);
  });
}

export function validateOpenCodeCatalog(
  catalog: OpenCodeCatalog,
  configuration: ModelConfiguration
): void {
  if (!catalog.version) throw new PreflightError("OpenCode did not report a version.");

  const missingAgents = REQUIRED_AGENTS.filter((agent) => !catalog.agentNames.includes(agent));
  if (missingAgents.length > 0) {
    throw new PreflightError(`OpenCode is missing required agent profiles: ${missingAgents.join(", ")}.`);
  }

  const selected = [
    configuration.plannerModel,
    configuration.builderModel,
    configuration.reviewerModel,
    ...(configuration.escalationModel ? [configuration.escalationModel] : [])
  ];
  const missingModels = [...new Set(selected.filter((model) => !catalog.modelIds.includes(model)))];
  if (missingModels.length > 0) {
    throw new PreflightError(
      `Selected OpenCode model IDs are unavailable: ${missingModels.join(", ")}. Run npm run ai-workflow:models and choose exact listed IDs.`
    );
  }

  const selectedProviders = [...new Set(selected.map((model) => model.split("/", 1)[0]))];
  const unauthenticated = selectedProviders.filter(
    (provider) => !providerIsAuthenticated(provider, catalog.authenticatedProviders)
  );
  if (unauthenticated.length > 0) {
    throw new PreflightError(
      `OpenCode has no stored credential for selected provider(s): ${unauthenticated.join(", ")}. Run npx opencode auth login; credentials remain outside the repository.`
    );
  }
}

export function authenticatedModelIds(catalog: OpenCodeCatalog): string[] {
  return catalog.modelIds.filter((model) => {
    const provider = model.split("/", 1)[0];
    return providerIsAuthenticated(provider, catalog.authenticatedProviders);
  });
}

function requireExecutable(command: string): void {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    env: {
      NODE_ENV: process.env.NODE_ENV ?? "production",
      PATH: process.env.PATH
    }
  });
  if (result.error || result.status !== 0) {
    throw new PreflightError(`Required command ${command} is unavailable.`);
  }
}

async function validateRepository(repositoryRoot: string): Promise<void> {
  const packagePath = join(repositoryRoot, "package.json");
  const agentsPath = join(repositoryRoot, "AGENTS.md");
  if (!existsSync(packagePath) || !existsSync(agentsPath)) {
    throw new PreflightError("Preflight must run from the Newl Apps repository root.");
  }

  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };
  if (packageJson.name !== "newl-apps") {
    throw new PreflightError("package.json is not the Newl Apps package.");
  }
  const missingScripts = REQUIRED_PACKAGE_SCRIPTS.filter(
    (script) => typeof packageJson.scripts?.[script] !== "string"
  );
  if (missingScripts.length > 0) {
    throw new PreflightError(`package.json is missing required scripts: ${missingScripts.join(", ")}.`);
  }
}

function formatVerificationFailure(verification: VerificationResult): string {
  return verification.commands
    .filter((command) => !command.passed)
    .map(
      (command) =>
        `${command.command} ${command.args.join(" ")} failed with exit ${command.exitCode ?? "unknown"}.\n${
          command.output || "No output captured."
        }`
    )
    .join("\n\n");
}

export async function runPreflight(input: {
  repositoryRoot: string;
  requestedBranch?: string;
  models: ModelConfiguration;
  commandRunner: CommandRunner;
  openCodeInspector: OpenCodeInspector;
  onEvent?: (message: string) => void;
  expectedExistingDiff?: {
    branch: string;
    baseCommit: string;
    headCommit: string;
    diffHash: string;
  };
}): Promise<PreflightResult> {
  const repositoryRoot = await realpath(resolve(input.repositoryRoot));
  const event = input.onEvent ?? (() => undefined);
  event("Preflight: validating the Newl Apps repository and dedicated worktree.");
  await validateRepository(repositoryRoot);
  const worktree = await inspectGitWorktree(repositoryRoot);
  if (worktree.repositoryRoot !== repositoryRoot) {
    throw new PreflightError(`Expected repository root ${repositoryRoot}, found ${worktree.repositoryRoot}.`);
  }
  if (!worktree.isDedicatedWorktree) {
    throw new PreflightError(
      "The Newl Apps root checkout is coordination-only. Start a dedicated task with npm run codex:task:start -- <slug>."
    );
  }

  requireExecutable("git");
  requireExecutable("node");
  requireExecutable("npm");
  let gitState: { branch: string; baseCommit: string };
  if (input.expectedExistingDiff) {
    if (input.requestedBranch) {
      throw new PreflightError("A continuing workflow cannot create or switch branches during preflight.");
    }
    const expected = input.expectedExistingDiff;
    const actual = await inspectRecoveryGitIdentity(
      repositoryRoot,
      expected.baseCommit,
      expected.baseCommit
    );
    if (actual.branch !== expected.branch) {
      throw new PreflightError(`Expected branch ${expected.branch}, found ${actual.branch}.`);
    }
    if (actual.headCommit !== expected.headCommit) {
      throw new PreflightError("The continuing workflow HEAD changed unexpectedly.");
    }
    if (actual.mergeBaseCommit !== expected.baseCommit || actual.diffHash !== expected.diffHash) {
      throw new PreflightError("The continuing workflow base or registered diff changed unexpectedly.");
    }
    gitState = { branch: actual.branch, baseCommit: expected.baseCommit };
  } else {
    gitState = await ensureWorkflowBranch(repositoryRoot, input.requestedBranch);
  }

  event("Preflight: validating OpenCode, agent profiles, selected models, and stored provider authentication.");
  const catalog = await input.openCodeInspector.inspect();
  validateOpenCodeCatalog(catalog, input.models);

  event(
    input.expectedExistingDiff
      ? "Preflight: running strict verification of the registered continuing-workflow diff before any model call."
      : "Preflight: running the strict clean-baseline verification before any model call."
  );
  const baselineVerification = await runVerification(
    input.commandRunner,
    repositoryRoot,
    gitState.baseCommit
  );
  if (!baselineVerification.passed) {
    throw new PreflightError(
      `The clean starting baseline is not acceptable. No model was called.\n\n${formatVerificationFailure(
        baselineVerification
      )}`
    );
  }

  event("Preflight passed; paid model calls may begin after this point.");
  return {
    branch: gitState.branch,
    baseCommit: gitState.baseCommit,
    openCodeVersion: catalog.version,
    authenticatedProviders: catalog.authenticatedProviders,
    selectedModels: input.models,
    baselineVerification
  };
}
