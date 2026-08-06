import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadModelConfiguration,
  saveUserModelConfiguration
} from "../tools/ai-workflow/config";
import {
  answerOwnerQuestion,
  confirmedDecisionMap,
  effectivePhaseRisk,
  hashJson,
  questionsFromPlan,
  unresolvedBlockingQuestions
} from "../tools/ai-workflow/decisions";
import {
  evaluatorBlocksApproval,
  validateEvaluationResult
} from "../tools/ai-workflow/evaluator";
import {
  createFeatureState,
  generatePhaseRequest,
  generatePlanningRequest,
  importFeatureArtifact,
  phaseRecordsFromPlan,
  reconcilePhaseQuestionGates
} from "../tools/ai-workflow/feature";
import { importLegacyOwnerQuestions } from "../tools/ai-workflow/legacy-questions";
import { AgentRunRequest, AgentRunner } from "../tools/ai-workflow/opencode";
import {
  createOperatorInput,
  withOperatorInput
} from "../tools/ai-workflow/operator-input";
import { PlanPhase, validateWorkflowPlan, WorkflowPlan } from "../tools/ai-workflow/planner";
import { reviewPhase } from "../tools/ai-workflow/reviewer";
import {
  acquireFeatureRun,
  appendWorkflowEvent,
  loadFeatureState,
  saveFeatureState,
  transitionFeatureState
} from "../tools/ai-workflow/state";
import {
  reviewerVerificationEvidence,
  VerificationResult
} from "../tools/ai-workflow/verification";
import { runWorkflow } from "../tools/ai-workflow/workflow";

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function envelope(value: unknown): string {
  return `<AI_WORKFLOW_RESULT>${JSON.stringify(value)}</AI_WORKFLOW_RESULT>`;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function initializeRepository(root: string): string {
  git(root, "init");
  git(root, "config", "user.name", "AI Workflow Test");
  git(root, "config", "user.email", "ai-workflow@example.com");
  writeFileSync(join(root, ".gitignore"), "tmp/\n");
  writeFileSync(join(root, "README.md"), "synthetic\n");
  git(root, "add", ".gitignore", "README.md");
  git(root, "commit", "-m", "Initial fixture");
  git(root, "branch", "-M", "main");
  git(root, "switch", "-c", "codex/synthetic-feature");
  return git(root, "rev-parse", "HEAD");
}

const phaseOne: PlanPhase = {
  id: "FEATURE-PHASE-01",
  title: "Safe tooling phase",
  objective: "Add one isolated tooling behavior.",
  requirements: ["Do not change production behavior."],
  expectedFiles: ["tools/ai-workflow/example.ts", "tests/example.test.ts"],
  testFiles: ["tests/example.test.ts"],
  definitionOfDone: ["The isolated behavior has regression coverage."],
  risk: "low",
  requiresOwnerApproval: false
};

const ownerPhase: PlanPhase = {
  ...phaseOne,
  id: "FEATURE-PHASE-02",
  title: "Owner-gated policy phase",
  objective: "Apply only the explicitly selected policy.",
  risk: "owner_gated",
  requiresOwnerApproval: true
};

const plan: WorkflowPlan = {
  summary: "Synthetic Version 1B.1 roadmap.",
  assumptions: [],
  openQuestions: [],
  globalRisks: [],
  expectedAreas: ["tools/ai-workflow", "tests"],
  ownerQuestions: [
    {
      id: "FEATURE-POLICY-1",
      phaseId: "FEATURE-PHASE-02",
      text: "Which synthetic policy is approved?",
      type: "multiple_choice",
      choices: [
        { value: "POLICY_A", label: "Policy A" },
        { value: "POLICY_B", label: "Policy B" }
      ],
      evidence: ["The repository does not define a default."],
      whyItMatters: "The builder cannot infer policy.",
      blocking: true
    }
  ],
  phases: [phaseOne, ownerPhase]
};

const passingVerification: VerificationResult = {
  passed: true,
  commands: [
    {
      name: "tests",
      command: "npm",
      args: ["run", "test"],
      passed: true,
      exitCode: 0,
      durationMs: 25,
      output: `${"large successful output\n".repeat(2_000)}Tests 20 passed`
    }
  ]
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Version 1B.1 local state", () => {
  it("opens operator input only while a prompt is active", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const operatorInput = createOperatorInput(input, output);

    expect(input.readableFlowing).not.toBe(true);
    const answer = operatorInput.readline.question("Selection: ");
    expect(input.readableFlowing).toBe(true);
    input.write("2\n");
    await expect(answer).resolves.toBe("2");
    expect(input.readableFlowing).toBe(false);

    operatorInput.close();
    expect(input.readableFlowing).toBe(false);
  });

  it("creates a fresh prompt after delayed work and after an earlier prompt", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const operatorInput = createOperatorInput(input, output);

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    expect(input.readableFlowing).not.toBe(true);

    const firstAnswer = operatorInput.readline.question("First: ");
    input.write("one\n");
    await expect(firstAnswer).resolves.toBe("one");
    expect(input.readableFlowing).toBe(false);

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    const secondAnswer = operatorInput.readline.question("Second: ");
    input.write("two\n");
    await expect(secondAnswer).resolves.toBe("two");

    operatorInput.close();
  });

  it("rejects prompts after operator input is explicitly closed", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const operatorInput = createOperatorInput(input, output);

    operatorInput.close();

    await expect(operatorInput.readline.question("Selection: ")).rejects.toThrow(
      "Operator input is closed."
    );
  });

  it("keeps operator input open until a returned asynchronous launcher operation settles", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const operation = withOperatorInput(
      async (readline) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        return readline.question("Approve: ");
      },
      input,
      output
    );

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    expect(input.readableFlowing).toBe(true);
    input.write("CP-PHASE-02B-1\n");

    await expect(operation).resolves.toBe("CP-PHASE-02B-1");
    expect(input.readableFlowing).toBe(false);
  });

  it("keeps a real tsx launcher process alive while an operator prompt is unanswered", async () => {
    const script = `
      import { createOperatorInput } from "./tools/ai-workflow/operator-input.ts";
      const operatorInput = createOperatorInput();
      const answer = await operatorInput.readline.question("Selection: ");
      process.stdout.write("ANSWER=" + answer);
      operatorInput.close();
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let answered = false;
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (!answered && stdout.includes("Selection: ")) {
        answered = true;
        setTimeout(() => child.stdin.end("2\n"), 50);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => {
        child.kill();
        rejectExit(new Error("Operator prompt child process did not finish."));
      }, 3_000);
      child.on("error", rejectExit);
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveExit(code);
      });
    });

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Selection: ANSWER=2");
  });

  it("writes and reloads owner-only atomic feature state and append-only events", async () => {
    const coordinationRoot = temporaryDirectory("newl-v1b1-state-");
    const state = createFeatureState({
      featureSlug: "synthetic-feature",
      featureTitle: "Synthetic Feature",
      originalRequest: "Add a synthetic tooling feature.",
      branch: "codex/synthetic-feature",
      worktree: join(coordinationRoot, "work", "codex", "synthetic-feature"),
      baseCommit: "a".repeat(40),
      headCommit: "a".repeat(40),
      diffHash: "b".repeat(64),
      now: new Date("2026-08-05T12:00:00.000Z")
    });
    const path = await saveFeatureState(coordinationRoot, state);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect((await loadFeatureState(coordinationRoot, "synthetic-feature")).stage).toBe("ready");

    const withEvent = await appendWorkflowEvent(coordinationRoot, state, {
      phaseId: null,
      type: "workflow.ready",
      message: "Feature is ready."
    });
    expect(withEvent.eventSequence).toBe(1);
    const eventsPath = join(coordinationRoot, "tmp", "ai-workflow", "features", "synthetic-feature", "events.jsonl");
    expect(statSync(eventsPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(eventsPath, "utf8")).message).toBe("Feature is ready.");
  });

  it("rejects illegal transitions and concurrent feature runs", async () => {
    const coordinationRoot = temporaryDirectory("newl-v1b1-lock-");
    const state = createFeatureState({
      featureSlug: "synthetic-feature",
      featureTitle: "Synthetic Feature",
      originalRequest: "Synthetic request.",
      branch: "codex/synthetic-feature",
      worktree: coordinationRoot,
      baseCommit: "a".repeat(40),
      headCommit: "a".repeat(40),
      diffHash: "b".repeat(64)
    });
    expect(() => transitionFeatureState(state, "reviewing")).toThrow(/Illegal workflow transition/);
    const release = await acquireFeatureRun(coordinationRoot, state.featureSlug);
    await expect(acquireFeatureRun(coordinationRoot, state.featureSlug)).rejects.toThrow(/active or interrupted run/);
    await release();
    const releaseAgain = await acquireFeatureRun(coordinationRoot, state.featureSlug);
    await releaseAgain();
  });

  it("allows an approved-roadmap feature to re-enter mandatory preflight before phase approval", () => {
    const state = createFeatureState({
      featureSlug: "synthetic-feature",
      featureTitle: "Synthetic Feature",
      originalRequest: "Synthetic request.",
      branch: "codex/synthetic-feature",
      worktree: "/synthetic/worktree",
      baseCommit: "a".repeat(40),
      headCommit: "a".repeat(40),
      diffHash: "b".repeat(64)
    });
    const awaitingApproval = transitionFeatureState(state, "awaiting_phase_approval");

    expect(transitionFeatureState(awaitingApproval, "preflight").stage).toBe("preflight");
  });

  it("rejects unknown state schema versions", async () => {
    const coordinationRoot = temporaryDirectory("newl-v1b1-schema-");
    const directory = join(coordinationRoot, "tmp", "ai-workflow", "features", "synthetic-feature");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "state.json");
    writeFileSync(path, JSON.stringify({ schemaVersion: 99, featureSlug: "synthetic-feature" }), {
      mode: 0o600
    });
    chmodSync(path, 0o600);
    await expect(loadFeatureState(coordinationRoot, "synthetic-feature")).rejects.toThrow(/Unsupported/);
  });
});

describe("Version 1B.1 model defaults and artifact import", () => {
  it("falls back to credential-free user model defaults when a worktree override is absent", async () => {
    const repositoryRoot = temporaryDirectory("newl-v1b1-model-repo-");
    const userConfig = join(temporaryDirectory("newl-v1b1-model-user-"), "models.json");
    const models = {
      plannerModel: "provider/qwen-planner",
      builderModel: "provider/deepseek-builder",
      reviewerModel: "provider/qwen-reviewer"
    };
    await saveUserModelConfiguration(models, userConfig);
    expect(
      await loadModelConfiguration({ repositoryRoot, userConfigFile: userConfig })
    ).toEqual(models);
    expect(statSync(userConfig).mode & 0o777).toBe(0o600);
    expect(readFileSync(userConfig, "utf8")).not.toMatch(/api.?key|password|token/i);
  });

  it("imports bounded artifacts into registry and worktree storage without rewriting them", async () => {
    const coordinationRoot = temporaryDirectory("newl-v1b1-artifacts-");
    const worktree = join(coordinationRoot, "work", "codex", "synthetic-feature");
    mkdirSync(worktree, { recursive: true });
    const source = join(temporaryDirectory("newl-v1b1-source-"), "handoff.md");
    writeFileSync(source, "# Synthetic handoff\nOriginal/path/should/remain\n");
    const artifact = await importFeatureArtifact({
      coordinationRoot,
      worktree,
      featureSlug: "synthetic-feature",
      kind: "handoff_markdown",
      sourcePath: source
    });
    expect(readFileSync(artifact.registryPath, "utf8")).toBe(readFileSync(source, "utf8"));
    expect(readFileSync(artifact.worktreePath, "utf8")).toBe(readFileSync(source, "utf8"));
    expect(statSync(artifact.registryPath).mode & 0o777).toBe(0o600);
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects symlinked handoff artifacts", async () => {
    const coordinationRoot = temporaryDirectory("newl-v1b1-symlink-");
    const worktree = join(coordinationRoot, "worktree");
    mkdirSync(worktree);
    const sourceDirectory = temporaryDirectory("newl-v1b1-symlink-source-");
    const target = join(sourceDirectory, "target.md");
    const link = join(sourceDirectory, "link.md");
    writeFileSync(target, "safe target\n");
    symlinkSync(target, link);
    await expect(
      importFeatureArtifact({
        coordinationRoot,
        worktree,
        featureSlug: "synthetic-feature",
        kind: "handoff_markdown",
        sourcePath: link
      })
    ).rejects.toThrow(/not links/);
  });

  it("generates planning and exact single-phase requests in ignored worktree storage", async () => {
    const worktree = temporaryDirectory("newl-v1b1-request-");
    const planning = await generatePlanningRequest({
      worktree,
      featureSlug: "synthetic-feature",
      featureTitle: "Synthetic Feature",
      originalRequest: "Add the synthetic feature.",
      artifacts: []
    });
    const questions = questionsFromPlan(plan);
    const phaseRequest = await generatePhaseRequest({
      worktree,
      featureSlug: "synthetic-feature",
      featureTitle: "Synthetic Feature",
      originalRequest: "Add the synthetic feature.",
      plan,
      phase: phaseOne,
      artifacts: [],
      questions
    });
    expect(existsSync(planning.path)).toBe(true);
    expect(phaseRequest.contents).toContain("Implement only FEATURE-PHASE-01");
    expect(phaseRequest.contents).toContain("Excluded later phases: FEATURE-PHASE-02");
    expect(phaseRequest.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("preserves the selected answer and exact owner explanation in the phase request", async () => {
    const worktree = temporaryDirectory("newl-v1b1-owner-evidence-");
    const question = questionsFromPlan(plan)[0];
    const answered = answerOwnerQuestion(
      question,
      "POLICY_A",
      "Use the same policy for both existing operating companies; do not infer a third.",
      { planHash: question.planHash, questionHash: question.questionHash }
    );
    const phaseRequest = await generatePhaseRequest({
      worktree,
      featureSlug: "synthetic-feature",
      featureTitle: "Synthetic Feature",
      originalRequest: "Add the synthetic feature.",
      plan,
      phase: ownerPhase,
      artifacts: [],
      questions: [answered]
    });

    expect(confirmedDecisionMap([answered])).toEqual({
      "FEATURE-POLICY-1": {
        answer: "POLICY_A",
        explanation: "Use the same policy for both existing operating companies; do not infer a third."
      }
    });
    expect(phaseRequest.contents).toContain("Selected answer: POLICY_A");
    expect(phaseRequest.contents).toContain(
      "Confirmed owner explanation: Use the same policy for both existing operating companies; do not infer a third."
    );
  });
});

describe("Version 1B.1 phase and owner-decision controls", () => {
  it("validates structured owner questions for owner-gated phases", () => {
    const validated = validateWorkflowPlan(plan, { requireOwnerQuestions: true });
    expect(validated.ownerQuestions?.[0].id).toBe("FEATURE-POLICY-1");
    expect(() =>
      validateWorkflowPlan({ ...plan, ownerQuestions: [] }, { requireOwnerQuestions: true })
    ).toThrow(/phase-scoped blocking owner question/);
  });

  it("ties confirmed answers to exact question and plan hashes", () => {
    const planHash = hashJson(plan);
    const question = questionsFromPlan(plan, planHash)[0];
    expect(unresolvedBlockingQuestions([question], ownerPhase.id)).toHaveLength(1);
    const answered = answerOwnerQuestion(
      question,
      "POLICY_A",
      "Synthetic explanation.",
      { planHash, questionHash: question.questionHash },
      new Date("2026-08-05T12:00:00.000Z")
    );
    expect(unresolvedBlockingQuestions([answered], ownerPhase.id)).toHaveLength(0);
    expect(answered.answer).toBe("POLICY_A");
    expect(() =>
      answerOwnerQuestion(question, "POLICY_A", null, {
        planHash: "changed",
        questionHash: question.questionHash
      })
    ).toThrow(/reconfirmed/);
  });

  it("imports stable legacy handoff and explicitly gated Markdown questions without planning", async () => {
    const coordinationRoot = temporaryDirectory("newl-v1b1-legacy-questions-");
    const worktree = join(coordinationRoot, "work", "codex", "synthetic-feature");
    mkdirSync(join(worktree, "docs", "modules", "synthetic"), { recursive: true });
    writeFileSync(
      join(worktree, "docs", "modules", "synthetic", "open-questions.md"),
      `# Synthetic questions

## Deferred decisions

- **SYNTHETIC-LATER-1 — Later decision**: this question does not gate the owner phase.

## Blocking legacy policy questions

These questions gate the same owner-gated phase.

- **SYNTHETIC-BLOCK-1 — Selection policy**: which exact selection policy is approved?

## Additional compatibility questions

These questions gate the same owner-gated phase.

- **SYNTHETIC-BLOCK-2 — Re-run policy**: how should an existing manually created record be treated?
`
    );
    const source = join(temporaryDirectory("newl-v1b1-legacy-handoff-"), "handoff.json");
    writeFileSync(
      source,
      JSON.stringify({
        open_business_questions: [
          { question_id: "SYNTHETIC-Q-1", question: "Which later display name is approved?" }
        ]
      })
    );
    const artifact = await importFeatureArtifact({
      coordinationRoot,
      worktree,
      featureSlug: "synthetic-feature",
      kind: "handoff_json",
      sourcePath: source
    });
    const legacyPlan: WorkflowPlan = {
      ...plan,
      ownerQuestions: undefined,
      openQuestions: [
        "Which later display name is approved?",
        "BLOCKING (SYNTHETIC-BLOCK-1): Which exact selection policy is approved?"
      ],
      phases: [
        phaseOne,
        {
          ...ownerPhase,
          expectedFiles: ["docs/modules/synthetic/open-questions.md"]
        }
      ]
    };
    const planHash = hashJson(legacyPlan);
    const questions = await importLegacyOwnerQuestions({
      worktree,
      plan: legacyPlan,
      planHash,
      artifacts: [artifact],
      planQuestions: questionsFromPlan(legacyPlan, planHash)
    });

    expect(questions.map((question) => question.id)).toEqual([
      "SYNTHETIC-Q-1",
      "SYNTHETIC-BLOCK-1",
      "SYNTHETIC-BLOCK-2"
    ]);
    expect(questions[0]).toMatchObject({ phaseId: null, blocking: false });
    expect(questions[1]).toMatchObject({ phaseId: ownerPhase.id, blocking: true });
    expect(questions[1].text).toBe(
      "Selection policy: which exact selection policy is approved?"
    );
    expect(unresolvedBlockingQuestions(questions, phaseOne.id)).toHaveLength(0);
    expect(unresolvedBlockingQuestions(questions, ownerPhase.id)).toHaveLength(2);
    const gatedPhases = reconcilePhaseQuestionGates(phaseRecordsFromPlan(legacyPlan), questions);
    expect(gatedPhases.map((phase) => [phase.id, phase.status])).toEqual([
      [phaseOne.id, "pending"],
      [ownerPhase.id, "blocked"]
    ]);
    const answeredQuestions = questions.map((question) =>
      question.blocking
        ? answerOwnerQuestion(
            question,
            "Confirmed synthetic policy.",
            null,
            { planHash: question.planHash, questionHash: question.questionHash }
          )
        : question
    );
    expect(reconcilePhaseQuestionGates(gatedPhases, answeredQuestions)[1].status).toBe("pending");
  });

  it("fails closed when legacy blocking questions cannot map to exactly one gated phase", async () => {
    const worktree = temporaryDirectory("newl-v1b1-legacy-ambiguous-");
    mkdirSync(join(worktree, "docs"), { recursive: true });
    writeFileSync(
      join(worktree, "docs", "open-questions.md"),
      "## Blocking questions\n\n- **SYNTHETIC-BLOCK-1 — Policy**: which policy is approved?\n"
    );
    const ambiguousPlan: WorkflowPlan = {
      ...plan,
      ownerQuestions: undefined,
      openQuestions: [],
      phases: [
        { ...ownerPhase, id: "OWNER-ONE", expectedFiles: ["docs/open-questions.md"] },
        { ...ownerPhase, id: "OWNER-TWO", expectedFiles: ["docs/open-questions.md"] }
      ]
    };
    await expect(
      importLegacyOwnerQuestions({
        worktree,
        plan: ambiguousPlan,
        planHash: hashJson(ambiguousPlan),
        artifacts: [],
        planQuestions: []
      })
    ).rejects.toThrow(/exactly one owner-gated phase/);
  });

  it("only raises deterministic risk and never lowers owner gates", () => {
    expect(effectivePhaseRisk(ownerPhase)).toBe("owner_gated");
    expect(
      effectivePhaseRisk({
        ...phaseOne,
        expectedFiles: ["prisma/migrations/20260101000000_synthetic/migration.sql"]
      })
    ).toBe("high");
    expect(phaseRecordsFromPlan(plan).map((phase) => phase.risk)).toEqual(["low", "owner_gated"]);
  });

  it("uses a stored roadmap without a planner call and stops after one phase", async () => {
    const requests: AgentRunRequest[] = [];
    const evaluatorDecisions: unknown[] = [];
    const confirmedDecisions = {
      "FEATURE-POLICY-1": {
        answer: "POLICY_A",
        explanation: "Preserve this exact owner rationale in every model packet."
      }
    };
    const runner: AgentRunner = {
      run: async (request) => {
        requests.push(request);
        if (request.role === "builder") {
          return {
            text: envelope({
              summary: "Implemented the stored phase.",
              changedFiles: ["tools/ai-workflow/example.ts"],
              testsChanged: ["tests/example.test.ts"],
              limitations: []
            }),
            cost: null
          };
        }
        return {
          text: envelope({
            status: "approved",
            summary: "The stored phase is complete.",
            findings: [],
            missingTests: [],
            scopeConcerns: [],
            escalationReason: null
          }),
          cost: null
        };
      }
    };
    const repositoryRoot = temporaryDirectory("newl-v1b1-stored-plan-");
    const baseCommit = initializeRepository(repositoryRoot);
    const result = await runWorkflow(
      {
        repositoryRoot,
        originalRequest: "Use the stored roadmap.",
        plannerModel: "provider/qwen",
        builderModel: "provider/deepseek",
        reviewerModel: "provider/qwen",
        approvedPlan: plan,
        phaseId: phaseOne.id,
        confirmedDecisions,
        evaluators: [
          {
            id: "owner-evidence",
            evaluate: async (context) => {
              evaluatorDecisions.push(context.confirmedDecisions);
              return {
                schemaVersion: 1,
                evaluatorId: "owner-evidence",
                status: "passed",
                findings: [],
                measurements: {},
                artifactHashes: [],
                durationMs: 1,
                diffHash: context.diffHash
              };
            }
          }
        ]
      },
      {
        agentRunner: runner,
        commandRunner: {
          run: async (spec) => ({
            ...spec,
            passed: true,
            exitCode: 0,
            durationMs: 1,
            output: "passed"
          })
        },
        preflight: async () => ({
          branch: "codex/synthetic-feature",
          baseCommit,
          openCodeVersion: "test",
          authenticatedProviders: ["provider"],
          selectedModels: {
            plannerModel: "provider/qwen",
            builderModel: "provider/deepseek",
            reviewerModel: "provider/qwen"
          },
          baselineVerification: { passed: true, commands: [] }
        }),
        approvePhase: async () => true
      }
    );
    expect(requests.map((request) => request.role)).toEqual(["builder", "reviewer"]);
    expect(requests[0].prompt).toContain('"answer": "POLICY_A"');
    expect(requests[0].prompt).toContain("Preserve this exact owner rationale in every model packet.");
    expect(requests[1].prompt).toContain('"answer": "POLICY_A"');
    expect(requests[1].prompt).toContain("Preserve this exact owner rationale in every model packet.");
    expect(evaluatorDecisions).toEqual([confirmedDecisions]);
    expect(result).toMatchObject({ phaseId: phaseOne.id, stoppedBeforeNextPhase: true });
  });
});

describe("Version 1B.1 evidence packets and evaluators", () => {
  it("compacts successful verification output while preserving hashes and totals", () => {
    const evidence = reviewerVerificationEvidence(passingVerification);
    expect(evidence.commands[0].summary).toContain("Tests 20 passed");
    expect(evidence.commands[0].summary.length).toBeLessThanOrEqual(2_000);
    expect(evidence.commands[0].outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(evidence)).not.toContain("large successful output\n".repeat(100));
  });

  it("sends compact verification evidence rather than full successful logs to the reviewer", async () => {
    let prompt = "";
    await reviewPhase(
      {
        run: async (request) => {
          prompt = request.prompt;
          return {
            text: envelope({
              status: "approved",
              summary: "Complete.",
              findings: [],
              missingTests: [],
              scopeConcerns: [],
              escalationReason: null
            }),
            cost: null
          };
        }
      },
      "provider/qwen",
      {
        repositoryRoot: "/synthetic",
        originalRequest: "Synthetic request.",
        approvedPlan: plan,
        phase: phaseOne,
        gitDiff: "synthetic diff",
        surroundingCode: "synthetic code",
        verification: passingVerification
      }
    );
    expect(prompt).toContain("Tests 20 passed");
    expect(prompt.length).toBeLessThan(20_000);
  });

  it("allows evaluators to block but never to approve a phase", () => {
    const result = validateEvaluationResult(
      {
        schemaVersion: 1,
        evaluatorId: "default-software",
        status: "failed",
        findings: [{ code: "TEST_THRESHOLD", message: "Threshold failed.", blocking: true }],
        measurements: { testsPassed: 19 },
        artifactHashes: [],
        durationMs: 10,
        diffHash: "a".repeat(64)
      },
      { evaluatorId: "default-software", diffHash: "a".repeat(64) }
    );
    expect(evaluatorBlocksApproval(result)).toBe(true);
    expect(() =>
      validateEvaluationResult(
        { ...result, status: "passed" },
        { evaluatorId: "default-software", diffHash: "a".repeat(64) }
      )
    ).toThrow(/passing evaluator/);
  });
});
