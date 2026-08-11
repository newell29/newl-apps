import type { ConfirmedOwnerDecisions } from "./decisions";
import { AgentRunner, AgentRunResult, extractStructuredResult } from "./opencode";
import { PlanPhase } from "./planner";

export type BuilderReport = {
  summary: string;
  changedFiles: string[];
  testsChanged: string[];
  limitations: string[];
};

function validateBuilderReport(value: unknown): BuilderReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Builder output must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string" || !record.summary.trim()) {
    throw new Error("Builder summary must be a non-empty string.");
  }

  const readArray = (key: string): string[] => {
    const field = record[key];
    if (!Array.isArray(field) || field.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`Builder field ${key} must be an array of non-empty strings.`);
    }
    return field.map((item) => (item as string).trim());
  };

  return {
    summary: record.summary.trim(),
    changedFiles: readArray("changedFiles"),
    testsChanged: readArray("testsChanged"),
    limitations: readArray("limitations")
  };
}

export async function implementPhase(
  runner: AgentRunner,
  model: string,
  phase: PlanPhase,
  corrections: string[],
  context: { confirmedDecisions?: ConfirmedOwnerDecisions } = {}
): Promise<{ report: BuilderReport; cost: number | null; run: AgentRunResult }> {
  const correctionBlock =
    corrections.length === 0
      ? "This is the initial implementation attempt."
      : `Correct every item below without expanding the approved phase scope:\n${corrections
          .map((correction, index) => `${index + 1}. ${correction}`)
          .join("\n")}`;

  const prompt = `Implement exactly one approved Newl Apps phase.

Current approved phase:
${JSON.stringify(phase, null, 2)}

Confirmed owner decisions for this phase (empty means none were required):
${JSON.stringify(context.confirmedDecisions ?? {}, null, 2)}

${correctionBlock}

Read AGENTS.md and the nearest relevant documentation before editing. Inspect existing patterns. Implement only this phase, preserve tenantId through every shared data path, retain explicit human approval for protected actions, and add or update appropriate regression tests and documentation. Do not modify secrets, production data, Teamship, deployments, permissions, or customer communications. Do not run commands, commit, push, or invoke another agent; the controller owns verification and Git.

After editing, return exactly one JSON object inside these tags, with no text after the closing tag:
<AI_WORKFLOW_RESULT>
{
  "summary": "...",
  "changedFiles": ["repository/relative/path"],
  "testsChanged": ["tests/example.test.ts"],
  "limitations": []
}
</AI_WORKFLOW_RESULT>`;

  const result = await runner.run({ role: "builder", model, prompt });
  return {
    report: validateBuilderReport(extractStructuredResult(result.text)),
    cost: result.cost,
    run: result
  };
}
