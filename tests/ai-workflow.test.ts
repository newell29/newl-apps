import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadModelConfiguration,
  saveModelConfiguration,
  validateModelId
} from "../tools/ai-workflow/config";
import { ensureWorkflowBranch } from "../tools/ai-workflow/git";
import {
  AgentRunRequest,
  AgentRunResult,
  AgentRunner,
  extractStructuredResult,
  parseOpenCodeOutput
} from "../tools/ai-workflow/opencode";
import { validateWorkflowPlan } from "../tools/ai-workflow/planner";
import {
  authenticatedModelIds,
  PreflightError,
  providerIsAuthenticated,
  runPreflight,
  validateOpenCodeCatalog
} from "../tools/ai-workflow/preflight";
import { validateReviewDecision } from "../tools/ai-workflow/reviewer";
import {
  CommandResult,
  CommandRunner,
  CommandSpec,
  LocalCommandRunner,
  mandatoryVerificationSpecs,
  sanitizeCommandOutput
} from "../tools/ai-workflow/verification";
import { runWorkflow } from "../tools/ai-workflow/workflow";

const temporaryDirectories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function createRepository(branch = "codex/workflow-test"): string {
  const root = mkdtempSync(join(tmpdir(), "newl-ai-workflow-"));
  temporaryDirectories.push(root);
  git(root, "init");
  git(root, "config", "user.name", "AI Workflow Test");
  git(root, "config", "user.email", "ai-workflow@example.com");
  writeFileSync(join(root, ".gitignore"), "tmp/\n");
  writeFileSync(join(root, "README.md"), "synthetic fixture\n");
  git(root, "add", ".gitignore", "README.md");
  git(root, "commit", "-m", "Initial fixture");
  git(root, "branch", "-M", "main");
  if (branch !== "main") git(root, "switch", "-c", branch);
  return root;
}

function envelope(value: unknown): string {
  return `<AI_WORKFLOW_RESULT>${JSON.stringify(value)}</AI_WORKFLOW_RESULT>`;
}

async function passingPreflight(repository: string) {
  const gitState = await ensureWorkflowBranch(repository);
  return {
    ...gitState,
    openCodeVersion: "test",
    authenticatedProviders: ["provider"],
    selectedModels: {
      plannerModel: "provider/qwen",
      builderModel: "provider/deepseek",
      reviewerModel: "provider/qwen"
    },
    baselineVerification: { passed: true, commands: [] }
  };
}

const plan = {
  summary: "Add a small synthetic feature.",
  assumptions: [],
  openQuestions: [],
  globalRisks: [],
  expectedAreas: ["src/feature.ts", "tests/feature.test.ts"],
  phases: [
    {
      id: "phase-1",
      title: "Implement the feature",
      objective: "Add deterministic behavior and its test.",
      requirements: ["Export the feature value."],
      expectedFiles: ["src/feature.ts", "tests/feature.test.ts"],
      testFiles: ["tests/feature.test.ts"],
      definitionOfDone: ["Feature and regression test exist."],
      risk: "low",
      requiresOwnerApproval: false
    }
  ]
} as const;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("AI workflow structured contracts", () => {
  it("validates safe plans and rejects unsafe test paths", () => {
    expect(validateWorkflowPlan(plan).phases[0].id).toBe("phase-1");
    expect(() =>
      validateWorkflowPlan({
        ...plan,
        phases: [{ ...plan.phases[0], testFiles: ["../outside.test.ts"] }]
      })
    ).toThrow(/unsafe repository path/);
  });

  it("normalizes trailing slashes for safe expected directories only", () => {
    expect(
      validateWorkflowPlan({ ...plan, expectedAreas: ["tools/ai-workflow/"] }).expectedAreas
    ).toEqual(["tools/ai-workflow"]);
    expect(() =>
      validateWorkflowPlan({ ...plan, expectedAreas: ["tools/ai-workflow//nested"] })
    ).toThrow(/unsafe repository path/);
    expect(
      validateWorkflowPlan({
        ...plan,
        phases: [{ ...plan.phases[0], expectedFiles: ["tools/ai-workflow/"] }]
      }).phases[0].expectedFiles
    ).toEqual(["tools/ai-workflow"]);
  });

  it("rejects contradictory reviewer approval", () => {
    expect(() =>
      validateReviewDecision({
        status: "approved",
        summary: "Looks good.",
        findings: [],
        missingTests: ["Add a regression test."],
        scopeConcerns: [],
        escalationReason: null
      })
    ).toThrow(/approval cannot contain unresolved/);
  });

  it("extracts JSON and cost from OpenCode JSON events", () => {
    const stdout = [
      JSON.stringify({ type: "text", part: { text: envelope({ ok: true }) } }),
      JSON.stringify({
        type: "step_finish",
        part: {
          cost: 0.125,
          reason: "length",
          tokens: { input: 100, output: 200, reasoning: 50, cache: { read: 25 } }
        }
      })
    ].join("\n");
    const parsed = parseOpenCodeOutput(stdout);
    expect(extractStructuredResult(parsed.text)).toEqual({ ok: true });
    expect(parsed.cost).toBe(0.125);
    expect(parsed.finishReason).toBe("length");
    expect(parsed.tokens).toEqual({ input: 100, output: 200, reasoning: 50, cacheRead: 25 });
  });
});

describe("AI workflow deterministic controls", () => {
  it("always builds the fixed verification sequence", () => {
    const commit = "a".repeat(40);
    const specs = mandatoryVerificationSpecs(commit);
    expect(specs.map((spec) => spec.name)).toEqual([
      "diff-check",
      "typecheck",
      "lint",
      "build",
      "tests"
    ]);
    expect(specs.at(-1)?.args).toEqual(["run", "test"]);
  });

  it("uses a test environment for tests and a production environment for builds", async () => {
    const runner = new LocalCommandRunner();
    const environmentCommand = (name: "tests" | "build"): CommandSpec => ({
      name,
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.env.NODE_ENV ?? '')"]
    });

    const tests = await runner.run(environmentCommand("tests"), process.cwd());
    const build = await runner.run(environmentCommand("build"), process.cwd());

    expect(tests).toMatchObject({ passed: true, output: "test" });
    expect(build).toMatchObject({ passed: true, output: "production" });
  });

  it("redacts common secret shapes from command output", () => {
    expect(sanitizeCommandOutput("API_KEY=super-secret ghp_abcdefghijklmnopqrstuvwxyz1234")).toBe(
      "API_KEY=[REDACTED] [REDACTED_TOKEN]"
    );
  });

  it("creates only a new codex-prefixed branch from a clean tree", async () => {
    const repository = createRepository("main");
    const result = await ensureWorkflowBranch(repository, "codex/safe-feature");
    expect(result.branch).toBe("codex/safe-feature");
    expect(git(repository, "branch", "--show-current")).toBe("codex/safe-feature");
    await expect(ensureWorkflowBranch(repository, "feature/unsafe")).rejects.toThrow(/codex\/ prefix/);
  });

  it("validates exact configured model IDs, required agents, and provider authentication", () => {
    const catalog = {
      version: "1.18.13",
      modelIds: ["qwen/qwen-planner", "deepseek/deepseek-builder", "other/unselected"],
      authenticatedProviders: ["Qwen", "DeepSeek"],
      agentNames: ["newl-ai-planner", "newl-ai-builder", "newl-ai-reviewer"]
    };
    const models = {
      plannerModel: "qwen/qwen-planner",
      builderModel: "deepseek/deepseek-builder",
      reviewerModel: "qwen/qwen-planner"
    };

    expect(() => validateOpenCodeCatalog(catalog, models)).not.toThrow();
    expect(authenticatedModelIds(catalog)).toEqual([
      "qwen/qwen-planner",
      "deepseek/deepseek-builder"
    ]);
    expect(providerIsAuthenticated("google-vertex", ["Google Vertex AI"])).toBe(true);
    expect(() =>
      validateOpenCodeCatalog(
        { ...catalog, authenticatedProviders: ["Qwen"] },
        models
      )
    ).toThrow(/no stored credential.*deepseek/i);
    expect(() =>
      validateOpenCodeCatalog(
        { ...catalog, agentNames: catalog.agentNames.slice(0, 2) },
        models
      )
    ).toThrow(/newl-ai-reviewer/);
    expect(() =>
      validateOpenCodeCatalog(catalog, { ...models, reviewerModel: "qwen/not-listed" })
    ).toThrow(/qwen\/not-listed/);
  });

  it("stores only credential-free model IDs in an ignored local configuration", async () => {
    const repository = createRepository();
    const models = {
      plannerModel: "qwen/qwen-planner",
      builderModel: "deepseek/deepseek-builder",
      reviewerModel: "qwen/qwen-reviewer",
      escalationModel: "openai/gpt-5.6-sol"
    };
    const path = await saveModelConfiguration(repository, models);

    expect(await loadModelConfiguration({ repositoryRoot: repository })).toEqual(models);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(models);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(validateModelId("qwen/qwen-planner", "Planner")).toBe("qwen/qwen-planner");
    expect(() => validateModelId("qwen model", "Planner")).toThrow(/provider\/model/);
    await expect(
      saveModelConfiguration(repository, models, "../models.json")
    ).rejects.toThrow(/ignored tmp/);
  });

  it("stops before the planner when preflight fails", async () => {
    const agentRequests: AgentRunRequest[] = [];
    const agentRunner: AgentRunner = {
      run: async (request) => {
        agentRequests.push(request);
        return { text: envelope(plan), cost: null };
      }
    };

    await expect(
      runWorkflow(
        {
          repositoryRoot: "/not-used",
          originalRequest: "A request that must never reach the planner.",
          plannerModel: "qwen/qwen-planner",
          builderModel: "deepseek/deepseek-builder",
          reviewerModel: "qwen/qwen-reviewer"
        },
        {
          agentRunner,
          commandRunner: { run: async () => Promise.reject(new Error("must not run")) },
          preflight: async () => {
            throw new PreflightError("synthetic preflight failure");
          },
          approvePlan: async () => true
        }
      )
    ).rejects.toThrow(/synthetic preflight failure/);
    expect(agentRequests).toEqual([]);
  });

  it("accepts a clean dedicated Newl worktree only after the strict baseline passes", async () => {
    const coordinationRoot = createRepository("main");
    writeFileSync(
      join(coordinationRoot, "package.json"),
      JSON.stringify({
        name: "newl-apps",
        scripts: { typecheck: "tsc", lint: "eslint", build: "next build", test: "vitest" }
      })
    );
    writeFileSync(join(coordinationRoot, "AGENTS.md"), "# Synthetic Newl agent instructions\n");
    git(coordinationRoot, "add", "package.json", "AGENTS.md");
    git(coordinationRoot, "commit", "-m", "Add synthetic Newl metadata");

    const worktree = `${coordinationRoot}-linked`;
    temporaryDirectories.push(worktree);
    git(coordinationRoot, "worktree", "add", "-b", "codex/preflight-test", worktree);
    const executed: string[] = [];
    const result = await runPreflight({
      repositoryRoot: worktree,
      models: {
        plannerModel: "qwen/qwen-planner",
        builderModel: "deepseek/deepseek-builder",
        reviewerModel: "qwen/qwen-reviewer"
      },
      commandRunner: {
        run: async (spec) => {
          executed.push(spec.name);
          return { ...spec, passed: true, exitCode: 0, durationMs: 1, output: "passed" };
        }
      },
      openCodeInspector: {
        inspect: async () => ({
          version: "1.18.13",
          modelIds: ["qwen/qwen-planner", "qwen/qwen-reviewer", "deepseek/deepseek-builder"],
          authenticatedProviders: ["Qwen", "DeepSeek"],
          agentNames: ["newl-ai-planner", "newl-ai-builder", "newl-ai-reviewer"]
        })
      }
    });

    expect(result.branch).toBe("codex/preflight-test");
    expect(result.baselineVerification.passed).toBe(true);
    expect(executed).toEqual(["diff-check", "typecheck", "lint", "build", "tests"]);
  });
});

describe("AI workflow review loop", () => {
  it("uses one fresh escalation remediation after three ordinary builder failures", async () => {
    const repository = createRepository();
    const requests: AgentRunRequest[] = [];
    let verificationAttempt = 0;
    const agentRunner: AgentRunner = {
      run: async (request) => {
        requests.push(request);
        if (request.role === "planner") return { text: envelope(plan), cost: 0 };
        if (request.role === "builder") {
          mkdirSync(join(repository, "src"), { recursive: true });
          writeFileSync(join(repository, "src", "feature.ts"), "export const feature = 1;\n");
          return {
            text: envelope({
              summary: "Applied the requested correction.",
              changedFiles: ["src/feature.ts"],
              testsChanged: [],
              limitations: []
            }),
            cost: 0
          };
        }
        return {
          text: envelope({
            status: "approved",
            summary: "The separately verified phase is complete.",
            findings: [],
            missingTests: [],
            scopeConcerns: [],
            escalationReason: null
          }),
          cost: 0
        };
      }
    };
    const commandRunner: CommandRunner = {
      run: async (spec) => {
        if (spec.name === "diff-check") verificationAttempt += 1;
        const passed = !(verificationAttempt < 4 && spec.name === "typecheck");
        return {
          ...spec,
          passed,
          exitCode: passed ? 0 : 2,
          durationMs: 1,
          output: passed ? "passed" : `ordinary failure ${verificationAttempt}`
        };
      }
    };

    const result = await runWorkflow(
      {
        repositoryRoot: repository,
        originalRequest: "Fix the synthetic phase.",
        plannerModel: "provider/qwen",
        builderModel: "provider/deepseek",
        reviewerModel: "provider/sol",
        escalationModel: "provider/sol",
        maxRetriesPerPhase: 3
      },
      {
        agentRunner,
        commandRunner,
        preflight: () => passingPreflight(repository),
        approvePlan: async () => true
      }
    );

    const builderRequests = requests.filter((request) => request.role === "builder");
    expect(builderRequests.map((request) => request.model)).toEqual([
      "provider/deepseek",
      "provider/deepseek",
      "provider/deepseek",
      "provider/sol"
    ]);
    expect(builderRequests[3].prompt).toContain("ordinary failure 3");
    expect(builderRequests[3].sessionId).toBeUndefined();
    expect(requests.filter((request) => request.role === "reviewer")).toHaveLength(1);
    expect(requests.at(-1)).toMatchObject({ role: "reviewer", model: "provider/sol" });
    expect(requests.at(-1)?.sessionId).toBeUndefined();
    expect(result.metrics).toMatchObject({
      escalationModel: "provider/sol",
      escalationAttempts: 1,
      retryCount: 3,
      reviewCycles: 1
    });
  });

  it("fails closed when the single escalation remediation still fails verification", async () => {
    const repository = createRepository();
    const requests: AgentRunRequest[] = [];
    const agentRunner: AgentRunner = {
      run: async (request) => {
        requests.push(request);
        if (request.role === "planner") return { text: envelope(plan), cost: null };
        return {
          text: envelope({
            summary: "Attempted correction.",
            changedFiles: [],
            testsChanged: [],
            limitations: []
          }),
          cost: null
        };
      }
    };
    const commandRunner: CommandRunner = {
      run: async (spec) => ({
        ...spec,
        passed: spec.name !== "typecheck",
        exitCode: spec.name === "typecheck" ? 2 : 0,
        durationMs: 1,
        output: spec.name === "typecheck" ? "still failing" : "passed"
      })
    };

    await expect(
      runWorkflow(
        {
          repositoryRoot: repository,
          originalRequest: "Fix the synthetic phase.",
          plannerModel: "provider/qwen",
          builderModel: "provider/deepseek",
          reviewerModel: "provider/sol",
          escalationModel: "provider/sol",
          maxRetriesPerPhase: 3
        },
        {
          agentRunner,
          commandRunner,
          preflight: () => passingPreflight(repository),
          approvePlan: async () => true
        }
      )
    ).rejects.toThrow(/single escalation remediation attempt/);

    expect(requests.filter((request) => request.role === "builder").map((request) => request.model)).toEqual([
      "provider/deepseek",
      "provider/deepseek",
      "provider/deepseek",
      "provider/sol"
    ]);
    expect(requests.some((request) => request.role === "reviewer")).toBe(false);
  });

  it("returns mandatory verification failures to the builder before any review", async () => {
    const repository = createRepository();
    const requests: AgentRunRequest[] = [];
    let builderCalls = 0;
    let verificationAttempt = 0;
    const agentRunner: AgentRunner = {
      run: async (request) => {
        requests.push(request);
        if (request.role === "planner") return { text: envelope(plan), cost: null };
        if (request.role === "builder") {
          builderCalls += 1;
          mkdirSync(join(repository, "src"), { recursive: true });
          writeFileSync(join(repository, "src", "feature.ts"), `export const feature = ${builderCalls};\n`);
          return {
            text: envelope({
              summary: "Implemented the current attempt.",
              changedFiles: ["src/feature.ts"],
              testsChanged: [],
              limitations: []
            }),
            cost: null
          };
        }
        return {
          text: envelope({
            status: "approved",
            summary: "Verified and complete.",
            findings: [],
            missingTests: [],
            scopeConcerns: [],
            escalationReason: null
          }),
          cost: null
        };
      }
    };
    const commandRunner: CommandRunner = {
      run: async (spec) => {
        if (spec.name === "diff-check") verificationAttempt += 1;
        const passed = !(verificationAttempt === 1 && spec.name === "typecheck");
        return {
          ...spec,
          passed,
          exitCode: passed ? 0 : 2,
          durationMs: 1,
          output: passed ? "passed" : "synthetic type error"
        };
      }
    };

    await runWorkflow(
      {
        repositoryRoot: repository,
        originalRequest: "Fix the synthetic type error.",
        plannerModel: "provider/qwen",
        builderModel: "provider/deepseek",
        reviewerModel: "provider/qwen"
      },
      {
        agentRunner,
        commandRunner,
        preflight: () => passingPreflight(repository),
        approvePlan: async () => true
      }
    );

    expect(requests.map((request) => request.role)).toEqual([
      "planner",
      "builder",
      "builder",
      "reviewer"
    ]);
    expect(requests[2].prompt).toContain("Mandatory verification failed: npm run typecheck");
    expect(requests[2].prompt).toContain("synthetic type error");
  });

  it("approves once, returns exact findings to the builder, and records metrics", async () => {
    const repository = createRepository();
    const requests: AgentRunRequest[] = [];
    let builderCalls = 0;
    let reviewerCalls = 0;

    const agentRunner: AgentRunner = {
      run: async (request: AgentRunRequest): Promise<AgentRunResult> => {
        requests.push(request);
        if (request.role === "planner") return { text: envelope(plan), cost: 0.1 };
        if (request.role === "builder") {
          builderCalls += 1;
          if (builderCalls === 1) {
            mkdirSync(join(repository, "src"), { recursive: true });
            writeFileSync(join(repository, "src", "feature.ts"), "export const feature = 1;\n");
          } else {
            mkdirSync(join(repository, "tests"), { recursive: true });
            writeFileSync(join(repository, "tests", "feature.test.ts"), "// synthetic test\n");
          }
          return {
            text: envelope({
              summary: "PRIVATE_BUILDER_CHAT",
              changedFiles: [builderCalls === 1 ? "src/feature.ts" : "tests/feature.test.ts"],
              testsChanged: builderCalls === 1 ? [] : ["tests/feature.test.ts"],
              limitations: []
            }),
            cost: 0.2
          };
        }

        reviewerCalls += 1;
        if (reviewerCalls === 1) {
          return {
            text: envelope({
              status: "changes_requested",
              summary: "A regression test is missing.",
              findings: [
                {
                  severity: "medium",
                  file: "tests/feature.test.ts",
                  line: null,
                  evidence: "The exported behavior has no regression test.",
                  requiredCorrection: "Add tests/feature.test.ts for the exported behavior."
                }
              ],
              missingTests: [],
              scopeConcerns: [],
              escalationReason: null
            }),
            cost: 0.3
          };
        }
        return {
          text: envelope({
            status: "approved",
            summary: "The phase is complete and tested.",
            findings: [],
            missingTests: [],
            scopeConcerns: [],
            escalationReason: null
          }),
          cost: 0.3
        };
      }
    };

    const commandSpecs: CommandSpec[] = [];
    const commandRunner: CommandRunner = {
      run: async (spec): Promise<CommandResult> => {
        commandSpecs.push(spec);
        return {
          ...spec,
          passed: true,
          exitCode: 0,
          durationMs: 1,
          output: "passed"
        };
      }
    };

    let approvals = 0;
    const times = [new Date("2026-08-05T12:00:00.000Z"), new Date("2026-08-05T12:00:04.000Z")];
    const result = await runWorkflow(
      {
        repositoryRoot: repository,
        originalRequest: "ORIGINAL_FEATURE_REQUEST",
        plannerModel: "provider/qwen",
        builderModel: "provider/deepseek",
        reviewerModel: "provider/qwen"
      },
      {
        agentRunner,
        commandRunner,
        preflight: () => passingPreflight(repository),
        approvePlan: async () => {
          approvals += 1;
          return true;
        },
        now: () => times.shift() as Date
      }
    );

    expect(approvals).toBe(1);
    expect(requests.map((request) => request.role)).toEqual([
      "planner",
      "builder",
      "reviewer",
      "builder",
      "reviewer"
    ]);
    const initialBuilderPrompt = requests.find((request) => request.role === "builder")?.prompt ?? "";
    expect(initialBuilderPrompt).not.toContain("ORIGINAL_FEATURE_REQUEST");
    const reviewerPrompts = requests.filter((request) => request.role === "reviewer").map((request) => request.prompt);
    expect(reviewerPrompts).toHaveLength(2);
    expect(reviewerPrompts.every((prompt) => prompt.includes("ORIGINAL_FEATURE_REQUEST"))).toBe(true);
    expect(reviewerPrompts.every((prompt) => !prompt.includes("PRIVATE_BUILDER_CHAT"))).toBe(true);
    expect(reviewerPrompts[0]).toContain("export const feature = 1");
    expect(requests.filter((request) => request.role === "builder")[1].prompt).toContain(
      "Required correction: Add tests/feature.test.ts for the exported behavior."
    );
    expect(commandSpecs.map((spec) => spec.name)).toEqual([
      "diff-check",
      "typecheck",
      "lint",
      "build",
      "tests",
      "diff-check",
      "typecheck",
      "lint",
      "build",
      "tests"
    ]);
    expect(result.metrics).toMatchObject({
      plannerModel: "provider/qwen",
      builderModel: "provider/deepseek",
      reviewerModel: "provider/qwen",
      totalTimeMs: 4000,
      retryCount: 1,
      reviewCycles: 2,
      filesChanged: ["src/feature.ts", "tests/feature.test.ts"]
    });
    expect(result.metrics.totalApiCost).toBeCloseTo(1.1);

    const metricsPath = join(repository, "tmp", "ai-workflow-metrics.jsonl");
    expect(existsSync(metricsPath)).toBe(true);
    expect(JSON.parse(readFileSync(metricsPath, "utf8").trim())).toEqual(result.metrics);
  });
});
