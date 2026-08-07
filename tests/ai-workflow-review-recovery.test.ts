import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getWorkflowDiffHash, RecoveryGitIdentity } from "../tools/ai-workflow/git";
import {
  AgentRunRequest,
  AgentRunResult,
  AgentRunner,
  extractStructuredResult,
  parseOpenCodeOutput
} from "../tools/ai-workflow/opencode";
import { PlanPhase, WorkflowPlan } from "../tools/ai-workflow/planner";
import {
  assertRecoveryGitIdentity,
  loadReviewRecovery,
  LoadedReviewRecovery,
  ReviewRecoveryRecord,
  runReviewCurrentDiff,
  writeReviewRecoveryMetadata
} from "../tools/ai-workflow/recovery";
import {
  validateReviewDecision,
  writeReviewerFailureDiagnostic
} from "../tools/ai-workflow/reviewer";
import { CommandRunner } from "../tools/ai-workflow/verification";
import { runWorkflow } from "../tools/ai-workflow/workflow";

const temporaryDirectories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "newl-review-recovery-"));
  temporaryDirectories.push(root);
  git(root, "init");
  git(root, "config", "user.name", "AI Workflow Test");
  git(root, "config", "user.email", "ai-workflow@example.com");
  writeFileSync(join(root, ".gitignore"), "tmp/\n");
  writeFileSync(join(root, "README.md"), "synthetic fixture\n");
  git(root, "add", ".gitignore", "README.md");
  git(root, "commit", "-m", "Initial fixture");
  git(root, "branch", "-M", "main");
  git(root, "switch", "-c", "codex/recovery-test");
  return root;
}

function envelope(value: unknown): string {
  return `<AI_WORKFLOW_RESULT>${JSON.stringify(value)}</AI_WORKFLOW_RESULT>`;
}

function finding(requiredCorrection = "Make the exact correction.") {
  return {
    severity: "high",
    file: "README.md",
    line: 1,
    evidence: "The current value is incorrect.",
    requiredCorrection
  } as const;
}

function decision(status: string, findings: unknown[] = []) {
  return {
    status,
    summary: "Independent review result.",
    findings,
    missingTests: [],
    scopeConcerns: [],
    escalationReason: status.toLowerCase() === "escalate" ? "Owner judgment is required." : null
  };
}

const phaseOne: PlanPhase = {
  id: "phase-1",
  title: "Phase one",
  objective: "Change the synthetic fixture.",
  requirements: ["Keep the change deterministic."],
  expectedFiles: ["README.md", "tests/recovery.test.ts"],
  testFiles: ["tests/recovery.test.ts"],
  definitionOfDone: ["The fixture and its test are complete."],
  risk: "low",
  requiresOwnerApproval: false
};

const phaseTwo: PlanPhase = {
  ...phaseOne,
  id: "phase-2",
  title: "Owner-gated phase",
  objective: "Wait for an unresolved owner decision.",
  requiresOwnerApproval: true
};

const plan: WorkflowPlan = {
  summary: "Synthetic two-phase plan.",
  assumptions: [],
  openQuestions: ["Owner must decide Phase 2 behavior."],
  globalRisks: [],
  expectedAreas: ["README.md", "tests/recovery.test.ts"],
  ownerQuestions: [
    {
      id: "PHASE-2-OWNER-DECISION",
      phaseId: "phase-2",
      text: "Which synthetic owner policy is approved?",
      type: "yes_no",
      choices: [],
      evidence: ["The synthetic fixture has no default policy."],
      whyItMatters: "Phase 2 cannot infer owner intent.",
      blocking: true
    }
  ],
  phases: [phaseOne, phaseTwo]
};

const passingCommands: CommandRunner = {
  run: async (spec) => ({
    ...spec,
    passed: true,
    exitCode: 0,
    durationMs: 1,
    output: "passed"
  })
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("reviewer status contract", () => {
  it("normalizes only the approved non-approval aliases and preserves findings", () => {
    for (const status of [
      "changes_required",
      "changes-requested",
      "CHANGES_REQUESTED",
      "Changes_Requested"
    ]) {
      const parsed = validateReviewDecision(decision(status, [finding(`Correction for ${status}`)]));
      expect(parsed.status).toBe("changes_requested");
      expect(parsed.findings[0].requiredCorrection).toBe(`Correction for ${status}`);
    }
    expect(validateReviewDecision(decision("ESCALATE")).status).toBe("escalate");
    expect(validateReviewDecision(decision("Escalate")).status).toBe("escalate");
  });

  it("fails closed for approval synonyms, rejection synonyms, and unknown statuses", () => {
    for (const status of [
      "pass",
      "passed",
      "accepted",
      "looks_good",
      "no_issues",
      "rejected",
      "unknown",
      "APPROVED"
    ]) {
      expect(() => validateReviewDecision(decision(status))).toThrow(/status must be/);
    }
  });

  it("rejects contradictory approvals and non-actionable normalized changes", () => {
    expect(() => validateReviewDecision(decision("approved", [finding()]))).toThrow(
      /approval cannot contain unresolved/
    );
    expect(() => validateReviewDecision(decision("changes_required"))).toThrow(
      /actionable finding/
    );
  });

  it("rejects nested, malformed, incomplete, truncated, and ambiguous envelopes", () => {
    expect(() => validateReviewDecision({ decision: decision("approved") })).toThrow(
      /unexpected fields/
    );
    expect(() => validateReviewDecision("not an object")).toThrow(/must be an object/);
    expect(() => validateReviewDecision({ status: "approved" })).toThrow(/summary/);
    expect(() => extractStructuredResult("<AI_WORKFLOW_RESULT>{\"status\":\"approved\""))
      .toThrow(/truncated before the closing envelope/);
    expect(() =>
      validateReviewDecision({ ...decision("approved"), result: decision("changes_requested", [finding()]) })
    ).toThrow(/unexpected fields/);
  });

  it("captures the selected session, message, and text part IDs from multi-message output", () => {
    const output = [
      JSON.stringify({
        type: "text",
        sessionID: "ses_planner0001",
        messageID: "msg_assistant001",
        part: { id: "prt_text000001", text: "working" }
      }),
      JSON.stringify({
        type: "reasoning",
        sessionID: "ses_planner0001",
        messageID: "msg_assistant002",
        part: { id: "prt_reason0001", type: "reasoning", text: "private reasoning" }
      }),
      JSON.stringify({
        type: "text",
        sessionID: "ses_planner0001",
        messageID: "msg_assistant002",
        part: { id: "prt_text000002", text: envelope(decision("approved")) }
      })
    ].join("\n");

    const parsed = parseOpenCodeOutput(output);
    expect(parsed.sessionId).toBe("ses_planner0001");
    expect(parsed.assistantMessageId).toBe("msg_assistant002");
    expect(parsed.textPartIds).toEqual(["prt_text000001", "prt_text000002"]);
    expect(parsed.text).not.toContain("private reasoning");
  });

  it("writes bounded redacted diagnostics with owner-only permissions", async () => {
    const repository = createRepository();
    const path = await writeReviewerFailureDiagnostic(
      repository,
      {
        text: `<reasoning>PRIVATE_CHAIN</reasoning>${"x".repeat(30_000)} API_KEY=super-secret`,
        cost: null,
        sessionId: "ses_diagnostic01",
        assistantMessageId: "msg_diagnostic01",
        textPartIds: ["prt_diagnostic01"]
      },
      new Error("token=another-secret"),
      new Date("2026-08-05T12:00:00.000Z")
    );
    const artifact = readFileSync(path, "utf8");
    expect(artifact).toContain("ses_diagnostic01");
    expect(artifact).toContain("msg_diagnostic01");
    expect(artifact).toContain("prt_diagnostic01");
    expect(artifact).not.toContain("PRIVATE_CHAIN");
    expect(artifact).not.toContain("super-secret");
    expect(artifact).not.toContain("another-secret");
    expect(artifact.length).toBeLessThan(26_000);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(repository, "tmp", "ai-workflow", "failures")).mode & 0o777).toBe(0o700);
  });
});

async function recoveryFixture(repository: string): Promise<LoadedReviewRecovery> {
  writeFileSync(join(repository, "README.md"), "phase one implementation\n");
  const baseCommit = git(repository, "rev-parse", "main");
  const headCommit = git(repository, "rev-parse", "HEAD");
  const record: ReviewRecoveryRecord = {
    schemaVersion: 1,
    branch: "codex/recovery-test",
    baseRef: "main",
    baseCommit,
    headCommit,
    diffHash: await getWorkflowDiffHash(repository, baseCommit),
    originalRequest: "Recover only the current Phase 1 review.",
    approvedPlan: plan,
    phaseId: "phase-1",
    confirmedDecisions: {
      "PHASE-1-OWNER-EVIDENCE": {
        answer: "USE_EXISTING_POLICY",
        explanation: "Retain the exact confirmed owner explanation during recovery."
      }
    }
  };
  return {
    record,
    originalRequest: "Recover only the current Phase 1 review.",
    plan,
    phase: phaseOne
  };
}

describe("review-current-diff recovery", () => {
  it("writes and reloads a bounded owner-only approved review boundary", async () => {
    const repository = createRepository();
    writeFileSync(join(repository, "README.md"), "phase one implementation\n");
    const baseCommit = git(repository, "rev-parse", "main");
    const path = await writeReviewRecoveryMetadata({
      repositoryRoot: repository,
      branch: "codex/recovery-test",
      baseRef: "main",
      baseCommit,
      originalRequest: "Recover only the approved Phase 1 plan.",
      approvedPlan: plan,
      phaseId: "phase-1",
      confirmedDecisions: {
        "PHASE-1-OWNER-EVIDENCE": {
          answer: "USE_EXISTING_POLICY",
          explanation: "Recovery must preserve this exact explanation."
        }
      }
    });

    expect(statSync(path).mode & 0o777).toBe(0o600);
    const loaded = await loadReviewRecovery(repository);
    expect(loaded.phase.id).toBe("phase-1");
    expect(loaded.plan.phases[1].requiresOwnerApproval).toBe(true);
    expect(loaded.record.confirmedDecisions).toEqual({
      "PHASE-1-OWNER-EVIDENCE": {
        answer: "USE_EXISTING_POLICY",
        explanation: "Recovery must preserve this exact explanation."
      }
    });
    chmodSync(path, 0o644);
    await expect(loadReviewRecovery(repository)).rejects.toThrow(/owner-only/);
  });

  it("starts with a reviewer, makes no planner or initial builder call, and never invokes Phase 2", async () => {
    const repository = createRepository();
    const recovery = await recoveryFixture(repository);
    const requests: AgentRunRequest[] = [];
    const runner: AgentRunner = {
      run: async (request) => {
        requests.push(request);
        return { text: envelope(decision("approved")), cost: null };
      }
    };

    const result = await runReviewCurrentDiff({
      repositoryRoot: repository,
      recovery,
      agentRunner: runner,
      commandRunner: passingCommands,
      builderModel: "provider/deepseek",
      reviewerModel: "provider/qwen"
    });

    expect(requests.map((request) => request.role)).toEqual(["reviewer"]);
    expect(requests[0].prompt).toContain('"id": "phase-1"');
    expect(requests[0].prompt).not.toContain("Implement exactly one approved");
    expect(result).toMatchObject({
      phaseId: "phase-1",
      correctionAttempts: 0,
      reviewCycles: 1,
      stoppedBeforeNextPhase: true
    });
  });

  it("preserves exact reviewer findings when entering the existing correction path", async () => {
    const repository = createRepository();
    const recovery = await recoveryFixture(repository);
    const requests: AgentRunRequest[] = [];
    let reviewerCalls = 0;
    const exactCorrection = "Replace the inaccurate BF3 premise with verified schema evidence.";
    const runner: AgentRunner = {
      run: async (request): Promise<AgentRunResult> => {
        requests.push(request);
        if (request.role === "reviewer") {
          reviewerCalls += 1;
          return {
            text: envelope(
              reviewerCalls === 1
                ? decision("changes_required", [finding(exactCorrection)])
                : decision("approved")
            ),
            cost: null
          };
        }
        return {
          text: envelope({
            summary: "Applied the exact correction.",
            changedFiles: ["README.md"],
            testsChanged: ["tests/recovery.test.ts"],
            limitations: []
          }),
          cost: null
        };
      }
    };

    const result = await runReviewCurrentDiff({
      repositoryRoot: repository,
      recovery,
      agentRunner: runner,
      commandRunner: passingCommands,
      builderModel: "provider/deepseek",
      reviewerModel: "provider/qwen"
    });

    expect(requests.map((request) => request.role)).toEqual(["reviewer", "builder", "reviewer"]);
    expect(requests[1].prompt).toContain(exactCorrection);
    for (const request of requests) {
      expect(request.prompt).toContain('"answer": "USE_EXISTING_POLICY"');
      expect(request.prompt).toContain(
        "Retain the exact confirmed owner explanation during recovery."
      );
    }
    expect(result.stoppedBeforeNextPhase).toBe(true);
  });

  it("rejects any changed branch, base, HEAD, or diff identity", () => {
    const expected = {
      schemaVersion: 1,
      branch: "codex/recovery-test",
      baseRef: "main",
      baseCommit: "a".repeat(40),
      headCommit: "b".repeat(40),
      diffHash: "c".repeat(64),
      originalRequest: "Recover Phase 1.",
      approvedPlan: plan,
      phaseId: "phase-1"
    } satisfies ReviewRecoveryRecord;
    const actual: RecoveryGitIdentity = {
      branch: expected.branch,
      baseRefCommit: expected.baseCommit,
      headCommit: expected.headCommit,
      mergeBaseCommit: expected.baseCommit,
      diffHash: expected.diffHash
    };
    expect(() => assertRecoveryGitIdentity(expected, { ...actual, branch: "codex/other" })).toThrow(
      /expected branch/
    );
    expect(() =>
      assertRecoveryGitIdentity(expected, { ...actual, baseRefCommit: "e".repeat(40) })
    ).toThrow(/base ref changed/);
    expect(() =>
      assertRecoveryGitIdentity(expected, { ...actual, mergeBaseCommit: "e".repeat(40) })
    ).toThrow(/merge base/);
    expect(() =>
      assertRecoveryGitIdentity(expected, { ...actual, headCommit: "e".repeat(40) })
    ).toThrow(/HEAD changed/);
    expect(() =>
      assertRecoveryGitIdentity(expected, { ...actual, diffHash: "e".repeat(64) })
    ).toThrow(/diff changed/);
  });

  it("stops after the approved phase and never invokes an owner-gated later phase", async () => {
    const repository = createRepository();
    const requests: AgentRunRequest[] = [];
    const runner: AgentRunner = {
      run: async (request) => {
        requests.push(request);
        if (request.role === "planner") return { text: envelope(plan), cost: null };
        if (request.role === "builder") {
          return {
            text: envelope({
              summary: "Phase one implementation.",
              changedFiles: ["README.md"],
              testsChanged: ["tests/recovery.test.ts"],
              limitations: []
            }),
            cost: null
          };
        }
        return { text: envelope(decision("approved")), cost: null };
      }
    };

    const result = await runWorkflow(
        {
          repositoryRoot: repository,
          originalRequest: "Run only resolved phases.",
          plannerModel: "provider/qwen",
          builderModel: "provider/deepseek",
          reviewerModel: "provider/qwen"
        },
        {
          agentRunner: runner,
          commandRunner: passingCommands,
          preflight: async () => ({
            branch: "codex/recovery-test",
            baseCommit: git(repository, "rev-parse", "HEAD"),
            openCodeVersion: "test",
            authenticatedProviders: ["provider"],
            selectedModels: {
              plannerModel: "provider/qwen",
              builderModel: "provider/deepseek",
              reviewerModel: "provider/qwen"
            },
            baselineVerification: { passed: true, commands: [] }
          }),
          approvePlan: async () => true
        }
      );
    expect(result).toMatchObject({ phaseId: "phase-1", stoppedBeforeNextPhase: true });
    expect(requests.map((request) => request.role)).toEqual(["planner", "builder", "reviewer"]);
    expect(
      requests.filter(
        (request) =>
          request.role === "builder" && request.prompt.includes('"id": "phase-2"')
      )
    ).toHaveLength(0);
  });
});
