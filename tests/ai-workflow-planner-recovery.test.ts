import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentRunRequest, AgentRunResult, AgentRunner } from "../tools/ai-workflow/opencode";
import {
  createPlan,
  recoverPlanFromSession,
  validateWorkflowPlan,
  WorkflowPlan
} from "../tools/ai-workflow/planner";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "newl-planner-recovery-"));
  temporaryDirectories.push(directory);
  return directory;
}

function envelope(value: unknown): string {
  return `<AI_WORKFLOW_RESULT>${JSON.stringify(value)}</AI_WORKFLOW_RESULT>`;
}

const plan: WorkflowPlan = {
  summary: "Compact synthetic roadmap.",
  assumptions: [],
  openQuestions: [],
  globalRisks: [],
  expectedAreas: ["tools/ai-workflow", "tests"],
  ownerQuestions: [],
  phases: [
    {
      id: "SYNTHETIC-PHASE-01",
      title: "Safe planner fixture",
      objective: "Add one isolated test fixture.",
      requirements: ["Do not change production behavior."],
      expectedFiles: ["tools/ai-workflow/example.ts", "tests/example.test.ts"],
      testFiles: ["tests/example.test.ts"],
      definitionOfDone: ["The fixture has regression coverage."],
      risk: "low",
      requiresOwnerApproval: false
    }
  ]
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("bounded planner output", () => {
  it("rejects oversized new model roadmaps without invalidating legacy stored plans", () => {
    const ninePhases = Array.from({ length: 9 }, (_, index) => ({
      ...plan.phases[0],
      id: `SYNTHETIC-PHASE-${index + 1}`
    }));
    expect(() =>
      validateWorkflowPlan(
        { ...plan, phases: ninePhases },
        { requireOwnerQuestions: true, enforceOutputBounds: true }
      )
    ).toThrow(/between 1 and 8 phases/);
    expect(() => validateWorkflowPlan({ ...plan, phases: ninePhases })).not.toThrow();

    expect(() =>
      validateWorkflowPlan(
        {
          ...plan,
          phases: [
            {
              ...plan.phases[0],
              requirements: Array.from({ length: 7 }, (_, index) => `Requirement ${index + 1}`)
            }
          ]
        },
        { enforceOutputBounds: true }
      )
    ).toThrow(/requirements must contain at most 6 items/);
  });

  it("uses one inspection session, repairs one truncated result, and records safe diagnostics", async () => {
    const repositoryRoot = temporaryDirectory();
    const requests: AgentRunRequest[] = [];
    const results: AgentRunResult[] = [
      {
        text: "Repository inspection complete.",
        cost: 0.1,
        sessionId: "ses_planner_recovery_01",
        assistantMessageId: "msg_inspection"
      },
      {
        text: "<reasoning>PRIVATE_CHAIN</reasoning><AI_WORKFLOW_RESULT>{\"summary\":\"unfinished API_KEY=secret",
        cost: 0.2,
        sessionId: "ses_planner_recovery_01",
        assistantMessageId: "msg_truncated",
        textPartIds: ["prt_truncated"],
        finishReason: "length",
        tokens: { input: 100, output: 4000, reasoning: 200, cacheRead: 50 }
      },
      {
        text: envelope(plan),
        cost: 0.3,
        sessionId: "ses_planner_recovery_01",
        assistantMessageId: "msg_repaired",
        textPartIds: ["prt_repaired"]
      }
    ];
    const runner: AgentRunner = {
      run: async (request) => {
        requests.push(request);
        return results.shift() as AgentRunResult;
      }
    };
    const recordedRuns: AgentRunResult[] = [];
    const diagnostics: string[] = [];

    const result = await createPlan(runner, "provider/qwen", "Plan a synthetic fixture.", {
      repositoryRoot,
      onRun: async (run) => void recordedRuns.push(run),
      onDiagnostic: async (path) => void diagnostics.push(path)
    });

    expect(result.plan).toEqual(plan);
    expect(result.cost).toBeCloseTo(0.6);
    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.sessionId)).toEqual([
      undefined,
      "ses_planner_recovery_01",
      "ses_planner_recovery_01"
    ]);
    expect(requests[0].prompt).toContain("Do not emit the roadmap yet");
    expect(requests[1].prompt).toContain("at most 8 phases");
    expect(requests[2].prompt).toContain("Repair the response once");
    expect(recordedRuns).toHaveLength(3);
    expect(diagnostics).toHaveLength(1);
    const artifact = readFileSync(diagnostics[0], "utf8");
    expect(artifact).toContain("msg_truncated");
    expect(artifact).toContain("prt_truncated");
    expect(artifact).toContain('"finishReason": "length"');
    expect(artifact).not.toContain("PRIVATE_CHAIN");
    expect(artifact).not.toContain("API_KEY=secret");
    expect(statSync(diagnostics[0]).mode & 0o777).toBe(0o600);
    expect(statSync(join(repositoryRoot, "tmp", "ai-workflow", "failures")).mode & 0o777).toBe(
      0o700
    );
  });

  it("fails closed after the single repair and preserves both response identities", async () => {
    const repositoryRoot = temporaryDirectory();
    const responses: AgentRunResult[] = [
      {
        text: "Repository inspection complete.",
        cost: null,
        sessionId: "ses_planner_recovery_02"
      },
      {
        text: "<AI_WORKFLOW_RESULT>{\"summary\":\"first truncation",
        cost: null,
        sessionId: "ses_planner_recovery_02",
        assistantMessageId: "msg_first_failure"
      },
      {
        text: "<AI_WORKFLOW_RESULT>{\"summary\":\"second truncation",
        cost: null,
        sessionId: "ses_planner_recovery_02",
        assistantMessageId: "msg_second_failure"
      }
    ];
    const diagnostics: string[] = [];

    await expect(
      createPlan(
        { run: async () => responses.shift() as AgentRunResult },
        "provider/qwen",
        "Plan safely.",
        {
          repositoryRoot,
          onDiagnostic: async (path) => void diagnostics.push(path)
        }
      )
    ).rejects.toThrow(/truncated before the closing envelope.*Diagnostic:/);
    expect(diagnostics).toHaveLength(1);
    const artifact = readFileSync(diagnostics[0], "utf8");
    expect(artifact).toContain("msg_first_failure");
    expect(artifact).toContain("msg_second_failure");
  });

  it("recovers an existing session without starting inspection, a builder, or a reviewer", async () => {
    const requests: AgentRunRequest[] = [];
    const result = await recoverPlanFromSession(
      {
        run: async (request) => {
          requests.push(request);
          return {
            text: envelope(plan),
            cost: 0.25,
            sessionId: request.sessionId,
            assistantMessageId: "msg_recovered"
          };
        }
      },
      "provider/qwen",
      "ses_existing_planner_01",
      { repositoryRoot: temporaryDirectory() }
    );

    expect(result.plan).toEqual(plan);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ role: "planner", sessionId: "ses_existing_planner_01" });
    expect(requests[0].prompt).toContain("Recover the roadmap");
  });
});
