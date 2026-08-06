import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hashJson, questionsFromPlan } from "../tools/ai-workflow/decisions";
import { createFeatureState, phaseRecordsFromPlan } from "../tools/ai-workflow/feature";
import type { AgentRunRequest, AgentRunner } from "../tools/ai-workflow/opencode";
import type { WorkflowPlan } from "../tools/ai-workflow/planner";
import {
  acquireFeatureRun,
  featureStatePath,
  loadFeatureState,
  saveFeatureState,
  type CorrectionBoundary,
  type FeatureState
} from "../tools/ai-workflow/state";
import { startOperatorUi } from "../tools/ai-workflow/ui";
import type { CommandRunner } from "../tools/ai-workflow/verification";
import {
  runWorkflow,
  type WorkflowCorrectionBoundary
} from "../tools/ai-workflow/workflow";

const temporaryDirectories: string[] = [];
const baseCommit = "a".repeat(40);
const headCommit = "b".repeat(40);
const diffHash = "c".repeat(64);

const plan: WorkflowPlan = {
  summary: "Small local workflow test.",
  assumptions: [],
  openQuestions: [],
  globalRisks: [],
  expectedAreas: ["tools/ai-workflow", "tests"],
  ownerQuestions: [
    {
      id: "LOCAL-Q1",
      phaseId: "LOCAL-PHASE-01",
      text: "Which safe local behavior is approved?",
      type: "multiple_choice",
      choices: [
        { value: "OPTION_A", label: "Option A" },
        { value: "OPTION_B", label: "Option B" }
      ],
      evidence: ["The repository does not define a default."],
      whyItMatters: "The builder must receive the owner's exact choice.",
      blocking: true
    }
  ],
  phases: [
    {
      id: "LOCAL-PHASE-01",
      title: "Local workflow behavior",
      objective: "Exercise the local operator controller.",
      requirements: ["Keep the behavior local and deterministic."],
      expectedFiles: ["tools/ai-workflow/example.ts"],
      testFiles: ["tests/example.test.ts"],
      definitionOfDone: ["The regression test passes."],
      risk: "owner_gated",
      requiresOwnerApproval: true
    },
    {
      id: "LOCAL-PHASE-02",
      title: "Later phase",
      objective: "Remain blocked until separately approved.",
      requirements: ["Never auto-start."],
      expectedFiles: ["tools/ai-workflow/later.ts"],
      testFiles: ["tests/later.test.ts"],
      definitionOfDone: ["A separate approval exists."],
      risk: "low",
      requiresOwnerApproval: false
    }
  ]
};

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function envelope(value: unknown): string {
  return `<AI_WORKFLOW_RESULT>${JSON.stringify(value)}</AI_WORKFLOW_RESULT>`;
}

function initializeRepository(root: string): string {
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return result.stdout.trim();
  };
  git("init");
  git("config", "user.name", "AI Workflow Test");
  git("config", "user.email", "ai-workflow@example.com");
  writeFileSync(join(root, ".gitignore"), "tmp/\n");
  writeFileSync(join(root, "README.md"), "synthetic local workflow\n");
  git("add", ".gitignore", "README.md");
  git("commit", "-m", "Initial fixture");
  git("branch", "-M", "main");
  git("switch", "-c", "codex/local-feature");
  return git("rev-parse", "HEAD");
}

function fixtureState(coordinationRoot: string): FeatureState {
  const state = createFeatureState({
    featureSlug: "local-feature",
    featureTitle: "Local Feature",
    originalRequest: "Exercise a safe local operator workflow.",
    branch: "codex/local-feature",
    worktree: coordinationRoot,
    baseCommit,
    headCommit,
    diffHash
  });
  const planHash = hashJson(plan);
  return {
    ...state,
    stage: "waiting_questions",
    plan,
    planHash,
    currentPhaseId: "LOCAL-PHASE-01",
    phases: phaseRecordsFromPlan(plan),
    questions: questionsFromPlan(plan, planHash),
    selectedModels: {
      plannerModel: "provider/planner",
      builderModel: "provider/builder",
      reviewerModel: "provider/reviewer",
      escalationModel: "provider/escalation"
    }
  };
}

function correctionBoundary(ownerActionRequired = true): CorrectionBoundary {
  return {
    schemaVersion: 1,
    phaseId: "LOCAL-PHASE-01",
    source: "review",
    corrections: ["HIGH at tools/ai-workflow/example.ts. Required correction: preserve exact evidence."],
    reviewDecision: {
      status: "changes_requested",
      summary: "One exact issue remains.",
      findings: [
        {
          severity: "high",
          file: "tools/ai-workflow/example.ts",
          line: null,
          evidence: "The saved evidence remains unresolved.",
          requiredCorrection: "Preserve exact evidence."
        }
      ],
      missingTests: [],
      scopeConcerns: [],
      escalationReason: null
    },
    phaseRetries: 3,
    phaseReviewCycles: 3,
    escalationUsed: true,
    nextModel: "escalation",
    ownerActionRequired,
    branch: "codex/local-feature",
    baseCommit,
    headCommit,
    diffHash,
    recordedAt: new Date("2026-08-06T12:00:00.000Z").toISOString()
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("durable correction boundaries", () => {
  it("resumes exact saved corrections without planner, initial builder, or phase approval", async () => {
    const repositoryRoot = temporaryDirectory("newl-correction-resume-");
    const repositoryBase = initializeRepository(repositoryRoot);
    const requests: AgentRunRequest[] = [];
    let approvals = 0;
    const runner: AgentRunner = {
      run: async (request) => {
        requests.push(request);
        if (request.role === "builder") {
          return {
            text: envelope({
              summary: "Applied the exact saved correction.",
              changedFiles: ["tools/ai-workflow/example.ts"],
              testsChanged: ["tests/example.test.ts"],
              limitations: []
            }),
            cost: 0
          };
        }
        return {
          text: envelope({
            status: "approved",
            summary: "The corrected diff is complete.",
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
      run: async (spec) => ({
        ...spec,
        passed: true,
        exitCode: 0,
        durationMs: 1,
        output: "passed"
      })
    };

    const result = await runWorkflow(
      {
        repositoryRoot,
        originalRequest: "Use the approved local roadmap.",
        plannerModel: "provider/planner",
        builderModel: "provider/builder",
        reviewerModel: "provider/reviewer",
        escalationModel: "provider/escalation",
        approvedPlan: plan,
        phaseId: "LOCAL-PHASE-01",
        ownerGateSatisfied: true,
        phaseAlreadyApproved: true,
        resumeCorrection: {
          corrections: ["EXACT_SAVED_REVIEW_FINDING"],
          phaseRetries: 0,
          phaseReviewCycles: 0,
          escalationUsed: false,
          useEscalationRemediation: true
        }
      },
      {
        agentRunner: runner,
        commandRunner,
        preflight: async () => ({
          branch: "codex/local-feature",
          baseCommit: repositoryBase,
          openCodeVersion: "test",
          authenticatedProviders: ["provider"],
          selectedModels: {
            plannerModel: "provider/planner",
            builderModel: "provider/builder",
            reviewerModel: "provider/reviewer",
            escalationModel: "provider/escalation"
          },
          baselineVerification: { passed: true, commands: [] }
        }),
        approvePhase: async () => {
          approvals += 1;
          return true;
        }
      }
    );

    expect(approvals).toBe(0);
    expect(requests.map((request) => request.role)).toEqual(["builder", "reviewer"]);
    expect(requests[0]).toMatchObject({ role: "builder", model: "provider/escalation" });
    expect(requests[0].prompt).toContain("EXACT_SAVED_REVIEW_FINDING");
    expect(requests.filter((request) => request.role === "builder")).toHaveLength(1);
    expect(requests[0].prompt).not.toContain("LOCAL-PHASE-02");
    expect(result).toMatchObject({ phaseId: "LOCAL-PHASE-01", stoppedBeforeNextPhase: true });
  });

  it("captures an exact structured reviewer boundary when review closes without approval", async () => {
    const repositoryRoot = temporaryDirectory("newl-correction-capture-");
    const repositoryBase = initializeRepository(repositoryRoot);
    const boundaries: WorkflowCorrectionBoundary[] = [];
    const runner: AgentRunner = {
      run: async (request) =>
        request.role === "builder"
          ? {
              text: envelope({
                summary: "Implemented the phase.",
                changedFiles: ["tools/ai-workflow/example.ts"],
                testsChanged: [],
                limitations: []
              }),
              cost: null
            }
          : {
              text: envelope({
                status: "changes_requested",
                summary: "One exact issue remains.",
                findings: [
                  {
                    severity: "high",
                    file: "tools/ai-workflow/example.ts",
                    line: 12,
                    evidence: "EXACT_REVIEW_EVIDENCE",
                    requiredCorrection: "EXACT_REQUIRED_CORRECTION"
                  }
                ],
                missingTests: ["EXACT_MISSING_TEST"],
                scopeConcerns: [],
                escalationReason: null
              }),
              cost: null
            }
    };

    await expect(
      runWorkflow(
        {
          repositoryRoot,
          originalRequest: "Use the stored roadmap.",
          plannerModel: "provider/planner",
          builderModel: "provider/builder",
          reviewerModel: "provider/reviewer",
          approvedPlan: plan,
          phaseId: "LOCAL-PHASE-01",
          ownerGateSatisfied: true,
          maxReviewCycles: 1
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
            branch: "codex/local-feature",
            baseCommit: repositoryBase,
            openCodeVersion: "test",
            authenticatedProviders: ["provider"],
            selectedModels: {
              plannerModel: "provider/planner",
              builderModel: "provider/builder",
              reviewerModel: "provider/reviewer"
            },
            baselineVerification: { passed: true, commands: [] }
          }),
          approvePhase: async () => true,
          onCorrectionRequired: async (boundary) => {
            boundaries.push(boundary);
          }
        }
      )
    ).rejects.toThrow(/could not be approved/);

    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      phaseId: "LOCAL-PHASE-01",
      source: "review",
      ownerActionRequired: true,
      reviewDecision: { status: "changes_requested" }
    });
    expect(boundaries[0].corrections).toEqual([
      "HIGH at tools/ai-workflow/example.ts:12. Evidence: EXACT_REVIEW_EVIDENCE Required correction: EXACT_REQUIRED_CORRECTION",
      "Missing test coverage: EXACT_MISSING_TEST"
    ]);
  });

  it("captures exact deterministic verification output before stopping", async () => {
    const repositoryRoot = temporaryDirectory("newl-verification-capture-");
    const repositoryBase = initializeRepository(repositoryRoot);
    const boundaries: WorkflowCorrectionBoundary[] = [];
    const runner: AgentRunner = {
      run: async () => ({
        text: envelope({
          summary: "Attempted the phase.",
          changedFiles: ["tools/ai-workflow/example.ts"],
          testsChanged: [],
          limitations: []
        }),
        cost: null
      })
    };

    await expect(
      runWorkflow(
        {
          repositoryRoot,
          originalRequest: "Use the stored roadmap.",
          plannerModel: "provider/planner",
          builderModel: "provider/builder",
          reviewerModel: "provider/reviewer",
          approvedPlan: plan,
          phaseId: "LOCAL-PHASE-01",
          ownerGateSatisfied: true,
          maxRetriesPerPhase: 1
        },
        {
          agentRunner: runner,
          commandRunner: {
            run: async (spec) => ({
              ...spec,
              passed: spec.name !== "typecheck",
              exitCode: spec.name === "typecheck" ? 2 : 0,
              durationMs: 1,
              output: spec.name === "typecheck" ? "EXACT_TYPESCRIPT_FAILURE" : "passed"
            })
          },
          preflight: async () => ({
            branch: "codex/local-feature",
            baseCommit: repositoryBase,
            openCodeVersion: "test",
            authenticatedProviders: ["provider"],
            selectedModels: {
              plannerModel: "provider/planner",
              builderModel: "provider/builder",
              reviewerModel: "provider/reviewer"
            },
            baselineVerification: { passed: true, commands: [] }
          }),
          approvePhase: async () => true,
          onCorrectionRequired: async (boundary) => {
            boundaries.push(boundary);
          }
        }
      )
    ).rejects.toThrow(/failed ordinary builder attempts/);

    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      source: "verification",
      nextModel: "builder",
      ownerActionRequired: true
    });
    expect(boundaries[0].corrections).toHaveLength(1);
    expect(boundaries[0].corrections[0]).toContain("EXACT_TYPESCRIPT_FAILURE");
  });

  it("never chains another automatic correction after an owner-approved extra attempt", async () => {
    const repositoryRoot = temporaryDirectory("newl-single-extra-attempt-");
    const repositoryBase = initializeRepository(repositoryRoot);
    const requests: AgentRunRequest[] = [];
    const boundaries: WorkflowCorrectionBoundary[] = [];
    const runner: AgentRunner = {
      run: async (request) => {
        requests.push(request);
        return request.role === "builder"
          ? {
              text: envelope({
                summary: "Applied the owner-authorized correction.",
                changedFiles: ["tools/ai-workflow/example.ts"],
                testsChanged: ["tests/example.test.ts"],
                limitations: []
              }),
              cost: null
            }
          : {
              text: envelope({
                status: "changes_requested",
                summary: "One issue still remains.",
                findings: [
                  {
                    severity: "medium",
                    file: "tools/ai-workflow/example.ts",
                    line: null,
                    evidence: "SECOND_EXACT_REVIEW_EVIDENCE",
                    requiredCorrection: "SECOND_EXACT_REQUIRED_CORRECTION"
                  }
                ],
                missingTests: [],
                scopeConcerns: [],
                escalationReason: null
              }),
              cost: null
            };
      }
    };

    await expect(
      runWorkflow(
        {
          repositoryRoot,
          originalRequest: "Resume one correction only.",
          plannerModel: "provider/planner",
          builderModel: "provider/builder",
          reviewerModel: "provider/reviewer",
          escalationModel: "provider/escalation",
          approvedPlan: plan,
          phaseId: "LOCAL-PHASE-01",
          ownerGateSatisfied: true,
          phaseAlreadyApproved: true,
          resumeCorrection: {
            corrections: ["FIRST_EXACT_REVIEW_FINDING"],
            phaseRetries: 0,
            phaseReviewCycles: 0,
            escalationUsed: false,
            useEscalationRemediation: true,
            singleAttempt: true
          }
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
            branch: "codex/local-feature",
            baseCommit: repositoryBase,
            openCodeVersion: "test",
            authenticatedProviders: ["provider"],
            selectedModels: {
              plannerModel: "provider/planner",
              builderModel: "provider/builder",
              reviewerModel: "provider/reviewer",
              escalationModel: "provider/escalation"
            },
            baselineVerification: { passed: true, commands: [] }
          }),
          onCorrectionRequired: async (boundary) => {
            boundaries.push(boundary);
          }
        }
      )
    ).rejects.toThrow(/additional owner-approved correction attempt/);

    expect(requests.map((request) => request.role)).toEqual(["builder", "reviewer"]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      source: "review",
      ownerActionRequired: true,
      nextModel: "escalation",
      reviewDecision: { status: "changes_requested" }
    });
    expect(boundaries[0].corrections[0]).toContain("SECOND_EXACT_REQUIRED_CORRECTION");
  });

  it("loads pre-patch state without a correction boundary as a safe null boundary", async () => {
    const coordinationRoot = temporaryDirectory("newl-correction-compat-");
    const state = fixtureState(coordinationRoot);
    await saveFeatureState(coordinationRoot, state);
    const path = featureStatePath(coordinationRoot, state.featureSlug);
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    delete raw.correctionBoundary;
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });

    expect((await loadFeatureState(coordinationRoot, state.featureSlug)).correctionBoundary).toBeNull();
  });
});

describe("local operator UI", () => {
  it("requires its local token and confirms owner questions against exact hashes", async () => {
    const coordinationRoot = temporaryDirectory("newl-ui-question-");
    const state = fixtureState(coordinationRoot);
    await saveFeatureState(coordinationRoot, state);
    const ui = await startOperatorUi({ coordinationRoot, port: 0, token: "test-local-token" });
    try {
      expect((await fetch(`${ui.url.split("?")[0]}api/features`)).status).toBe(401);
      const baseUrl = ui.url.split("?")[0];
      const list = await fetch(`${baseUrl}api/features`, {
        headers: { "x-newl-ui-token": ui.token }
      });
      expect(list.status).toBe(200);
      expect((await list.json()) as unknown[]).toHaveLength(1);

      const question = state.questions[0];
      const answered = await fetch(
        `${baseUrl}api/features/${state.featureSlug}/questions/${question.id}`,
        {
          method: "POST",
          headers: {
            origin: new URL(baseUrl).origin,
            "content-type": "application/json",
            "x-newl-ui-token": ui.token
          },
          body: JSON.stringify({
            answer: "OPTION_A",
            explanation: "Owner-selected local behavior.",
            planHash: question.planHash,
            questionHash: question.questionHash
          })
        }
      );
      expect(answered.status).toBe(200);
      const saved = await loadFeatureState(coordinationRoot, state.featureSlug);
      expect(saved.questions[0]).toMatchObject({
        answer: "OPTION_A",
        explanation: "Owner-selected local behavior."
      });
      expect(saved.stage).toBe("awaiting_phase_approval");

      const stale = await fetch(
        `${baseUrl}api/features/${state.featureSlug}/questions/${question.id}`,
        {
          method: "POST",
          headers: {
            origin: new URL(baseUrl).origin,
            "content-type": "application/json",
            "x-newl-ui-token": ui.token
          },
          body: JSON.stringify({
            answer: "OPTION_B",
            planHash: "d".repeat(64),
            questionHash: question.questionHash
          })
        }
      );
      expect(stale.status).toBe(400);

      const release = await acquireFeatureRun(coordinationRoot, state.featureSlug);
      try {
        const whileRunning = await fetch(
          `${baseUrl}api/features/${state.featureSlug}/questions/${question.id}`,
          {
            method: "POST",
            headers: {
              origin: new URL(baseUrl).origin,
              "content-type": "application/json",
              "x-newl-ui-token": ui.token
            },
            body: JSON.stringify({
              answer: "OPTION_B",
              planHash: question.planHash,
              questionHash: question.questionHash
            })
          }
        );
        expect(whileRunning.status).toBe(400);
        expect((await whileRunning.json()) as { error: string }).toMatchObject({
          error: expect.stringMatching(/already has a workflow running/)
        });
      } finally {
        await release();
      }
    } finally {
      await ui.close();
    }
  });

  it("starts exact phase approval and correction recovery without terminal prompts", async () => {
    const coordinationRoot = temporaryDirectory("newl-ui-actions-");
    let state = fixtureState(coordinationRoot);
    state = {
      ...state,
      stage: "awaiting_phase_approval",
      questions: state.questions.map((question) => ({
        ...question,
        answer: "OPTION_A",
        explanation: null,
        confirmedAt: new Date("2026-08-06T12:00:00.000Z").toISOString()
      }))
    };
    await saveFeatureState(coordinationRoot, state);
    const invocations: Array<{ options: Record<string, unknown> }> = [];
    const ui = await startOperatorUi({
      coordinationRoot,
      port: 0,
      token: "test-local-token",
      dependencies: {
        runFeature: async (_root, _state, _readline, options) => {
          invocations.push({ options: options as unknown as Record<string, unknown> });
        }
      }
    });
    const baseUrl = ui.url.split("?")[0];
    const headers = {
      origin: new URL(baseUrl).origin,
      "content-type": "application/json",
      "x-newl-ui-token": ui.token
    };
    try {
      const approval = await fetch(
        `${baseUrl}api/features/${state.featureSlug}/actions/approve-run`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            phaseId: "LOCAL-PHASE-01",
            planHash: state.planHash,
            diffHash,
            confirmation: "LOCAL-PHASE-01"
          })
        }
      );
      expect(approval.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(invocations[0].options).toEqual({
        phaseApproval: {
          phaseId: "LOCAL-PHASE-01",
          planHash: state.planHash,
          diffHash,
          confirmation: "LOCAL-PHASE-01"
        }
      });

      state = {
        ...(await loadFeatureState(coordinationRoot, state.featureSlug)),
        stage: "correction_required",
        correctionBoundary: correctionBoundary(true)
      };
      await saveFeatureState(coordinationRoot, state);
      const recovery = await fetch(
        `${baseUrl}api/features/${state.featureSlug}/actions/resume-correction`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            phaseId: "LOCAL-PHASE-01",
            diffHash,
            confirmation: "LOCAL-PHASE-01"
          })
        }
      );
      expect(recovery.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(invocations[1].options).toEqual({ allowOwnerCorrectionRetry: true });
    } finally {
      await ui.close();
    }
  });

  it("rejects a changed correction identity and cross-origin actions", async () => {
    const coordinationRoot = temporaryDirectory("newl-ui-reject-");
    const state: FeatureState = {
      ...fixtureState(coordinationRoot),
      stage: "correction_required",
      questions: [],
      correctionBoundary: correctionBoundary(true),
      currentDiffHash: "e".repeat(64)
    };
    await saveFeatureState(coordinationRoot, state);
    const ui = await startOperatorUi({ coordinationRoot, port: 0, token: "test-local-token" });
    const baseUrl = ui.url.split("?")[0];
    try {
      const changed = await fetch(
        `${baseUrl}api/features/${state.featureSlug}/actions/resume-correction`,
        {
          method: "POST",
          headers: {
            origin: new URL(baseUrl).origin,
            "content-type": "application/json",
            "x-newl-ui-token": ui.token
          },
          body: JSON.stringify({
            phaseId: "LOCAL-PHASE-01",
            diffHash,
            confirmation: "LOCAL-PHASE-01"
          })
        }
      );
      expect(changed.status).toBe(400);
      expect((await changed.json()) as { error: string }).toMatchObject({
        error: expect.stringMatching(/branch, base, HEAD, or diff/)
      });

      const crossOrigin = await fetch(`${baseUrl}api/features/${state.featureSlug}/actions/resume-correction`, {
        method: "POST",
        headers: {
          origin: "https://example.com",
          "content-type": "application/json",
          "x-newl-ui-token": ui.token
        },
        body: JSON.stringify({})
      });
      expect(crossOrigin.status).toBe(400);
    } finally {
      await ui.close();
    }
  });
});
