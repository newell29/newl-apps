import { isAbsolute } from "node:path";

import { AgentRunner, extractStructuredResult } from "./opencode";

export type PhaseRisk = "low" | "medium" | "high";

export type PlanPhase = {
  id: string;
  title: string;
  objective: string;
  requirements: string[];
  expectedFiles: string[];
  testFiles: string[];
  definitionOfDone: string[];
  risk: PhaseRisk;
  requiresOwnerApproval: boolean;
};

export type WorkflowPlan = {
  summary: string;
  assumptions: string[];
  openQuestions: string[];
  globalRisks: string[];
  expectedAreas: string[];
  phases: PlanPhase[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Planner field ${key} must be a non-empty string.`);
  }
  return value.trim();
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Planner field ${key} must be an array of non-empty strings.`);
  }
  return value.map((item) => (item as string).trim());
}

function validateRepositoryPath(
  value: string,
  label: string,
  options: { allowTrailingSlash?: boolean } = {}
): string {
  const slashNormalized = value.replace(/\\/g, "/");
  const normalized = options.allowTrailingSlash
    ? slashNormalized.replace(/\/+$/, "")
    : slashNormalized;
  const parts = normalized.split("/");
  if (
    isAbsolute(value) ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    parts.some((part) => part === ".." || part === "." || part.length === 0) ||
    parts.some((part) => part === ".env" || part.startsWith(".env."))
  ) {
    throw new Error(`${label} contains an unsafe repository path: ${value}`);
  }
  return normalized;
}

function validatePhase(value: unknown, index: number): PlanPhase {
  if (!isRecord(value)) throw new Error(`Planner phase ${index + 1} must be an object.`);

  const risk = value.risk;
  if (risk !== "low" && risk !== "medium" && risk !== "high") {
    throw new Error(`Planner phase ${index + 1} has an invalid risk classification.`);
  }
  if (typeof value.requiresOwnerApproval !== "boolean") {
    throw new Error(`Planner phase ${index + 1} requires an explicit requiresOwnerApproval boolean.`);
  }

  const expectedFiles = stringArray(value, "expectedFiles").map((path) =>
    validateRepositoryPath(path, `Planner phase ${index + 1}`)
  );
  const testFiles = stringArray(value, "testFiles").map((path) => {
    const safePath = validateRepositoryPath(path, `Planner phase ${index + 1}`);
    if (!/^tests\/.+\.test\.tsx?$/.test(safePath)) {
      throw new Error(
        `Planner test file ${safePath} must be a repository-relative tests/**/*.test.ts or .test.tsx path.`
      );
    }
    return safePath;
  });

  return {
    id: stringValue(value, "id"),
    title: stringValue(value, "title"),
    objective: stringValue(value, "objective"),
    requirements: stringArray(value, "requirements"),
    expectedFiles,
    testFiles,
    definitionOfDone: stringArray(value, "definitionOfDone"),
    risk,
    requiresOwnerApproval: value.requiresOwnerApproval
  };
}

export function validateWorkflowPlan(value: unknown): WorkflowPlan {
  if (!isRecord(value)) throw new Error("Planner output must be an object.");
  if (!Array.isArray(value.phases) || value.phases.length < 1 || value.phases.length > 12) {
    throw new Error("Planner output must contain between 1 and 12 phases.");
  }

  const phases = value.phases.map(validatePhase);
  const ids = new Set(phases.map((phase) => phase.id));
  if (ids.size !== phases.length) throw new Error("Planner phase IDs must be unique.");

  return {
    summary: stringValue(value, "summary"),
    assumptions: stringArray(value, "assumptions"),
    openQuestions: stringArray(value, "openQuestions"),
    globalRisks: stringArray(value, "globalRisks"),
    expectedAreas: stringArray(value, "expectedAreas").map((path) =>
      validateRepositoryPath(path, "Planner expectedAreas", { allowTrailingSlash: true })
    ),
    phases
  };
}

export async function createPlan(
  runner: AgentRunner,
  model: string,
  originalRequest: string
): Promise<{ plan: WorkflowPlan; cost: number | null }> {
  const prompt = `You are planning a Newl Apps feature in read-only mode.

Original feature request:
<FEATURE_REQUEST>
${originalRequest}
</FEATURE_REQUEST>

Inspect the real repository. Read AGENTS.md, docs/README.md, docs/architecture/overview.md, docs/modules/README.md, and the nearest relevant module documentation. Trace the requested behavior across every applicable UI, API, action, service, database, permission, test, and documentation layer. Preserve authenticated tenantId filtering and explicit human approval boundaries. Mark inferred business behavior as an open question.

Create the smallest complete sequence of independently reviewable phases. The controller always runs git diff --check, npm run typecheck, npm run lint, npm run build, and the full npm test suite. Do not propose shell commands. testFiles is advisory review evidence describing the concrete regression test files the phase should add or update; it never controls which commands run and may contain only repository-relative tests/**/*.test.ts or tests/**/*.test.tsx paths. Set requiresOwnerApproval to true for a phase that depends on unresolved owner decisions or would cross a protected human-approval boundary. Such a phase will stop before its builder runs; never place unresolved business decisions inside an automatically executable phase.

Return exactly one JSON object inside these tags, with no text after the closing tag:
<AI_WORKFLOW_RESULT>
{
  "summary": "...",
  "assumptions": [],
  "openQuestions": [],
  "globalRisks": [],
  "expectedAreas": ["src/..."],
  "phases": [
    {
      "id": "phase-1",
      "title": "...",
      "objective": "...",
      "requirements": ["..."],
      "expectedFiles": ["src/...", "tests/example.test.ts", "docs/..."],
      "testFiles": ["tests/example.test.ts"],
      "definitionOfDone": ["..."],
      "risk": "low",
      "requiresOwnerApproval": false
    }
  ]
}
</AI_WORKFLOW_RESULT>`;

  const result = await runner.run({ role: "planner", model, prompt });
  return {
    plan: validateWorkflowPlan(extractStructuredResult(result.text)),
    cost: result.cost
  };
}
