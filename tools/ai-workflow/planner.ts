import { isAbsolute } from "node:path";

import { AgentRunner, AgentRunResult, extractStructuredResult } from "./opencode";

export type PhaseRisk = "low" | "medium" | "high" | "owner_gated";

export type OwnerQuestionProposal = {
  id: string;
  phaseId: string | null;
  text: string;
  type: "multiple_choice" | "yes_no" | "free_text";
  choices: Array<{ value: string; label: string }>;
  evidence: string[];
  whyItMatters: string;
  blocking: boolean;
};

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
  ownerQuestions?: OwnerQuestionProposal[];
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
  if (risk !== "low" && risk !== "medium" && risk !== "high" && risk !== "owner_gated") {
    throw new Error(`Planner phase ${index + 1} has an invalid risk classification.`);
  }
  if (typeof value.requiresOwnerApproval !== "boolean") {
    throw new Error(`Planner phase ${index + 1} requires an explicit requiresOwnerApproval boolean.`);
  }
  if (risk === "owner_gated" && value.requiresOwnerApproval !== true) {
    throw new Error(`Planner phase ${index + 1} marked owner_gated must require owner approval.`);
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

function validateOwnerQuestions(value: unknown, phaseIds: Set<string>): OwnerQuestionProposal[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 40) {
    throw new Error("Planner ownerQuestions must be an array with at most 40 questions.");
  }
  const questions = value.map((question, index): OwnerQuestionProposal => {
    if (!isRecord(question)) throw new Error(`Planner owner question ${index + 1} must be an object.`);
    const id = stringValue(question, "id");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(id)) {
      throw new Error(`Planner owner question ${index + 1} has an unsafe stable ID.`);
    }
    const phaseId = question.phaseId;
    if (phaseId !== null && (typeof phaseId !== "string" || !phaseIds.has(phaseId))) {
      throw new Error(`Planner owner question ${id} refers to an unknown phase.`);
    }
    const type = question.type;
    if (type !== "multiple_choice" && type !== "yes_no" && type !== "free_text") {
      throw new Error(`Planner owner question ${id} has an invalid type.`);
    }
    if (!Array.isArray(question.choices)) {
      throw new Error(`Planner owner question ${id} choices must be an array.`);
    }
    const choices = question.choices.map((choice, choiceIndex) => {
      if (!isRecord(choice)) {
        throw new Error(`Planner owner question ${id} choice ${choiceIndex + 1} must be an object.`);
      }
      return { value: stringValue(choice, "value"), label: stringValue(choice, "label") };
    });
    if (type === "multiple_choice" && choices.length < 2) {
      throw new Error(`Planner owner question ${id} requires at least two choices.`);
    }
    if (type !== "multiple_choice" && choices.length > 0) {
      throw new Error(`Planner owner question ${id} may not define choices for ${type}.`);
    }
    if (typeof question.blocking !== "boolean") {
      throw new Error(`Planner owner question ${id} requires a blocking boolean.`);
    }
    return {
      id,
      phaseId,
      text: stringValue(question, "text"),
      type,
      choices,
      evidence: stringArray(question, "evidence"),
      whyItMatters: stringValue(question, "whyItMatters"),
      blocking: question.blocking
    };
  });
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error("Planner owner question IDs must be unique.");
  }
  return questions;
}

export function validateWorkflowPlan(
  value: unknown,
  options: { requireOwnerQuestions?: boolean } = {}
): WorkflowPlan {
  if (!isRecord(value)) throw new Error("Planner output must be an object.");
  if (!Array.isArray(value.phases) || value.phases.length < 1 || value.phases.length > 12) {
    throw new Error("Planner output must contain between 1 and 12 phases.");
  }

  const phases = value.phases.map(validatePhase);
  const ids = new Set(phases.map((phase) => phase.id));
  if (ids.size !== phases.length) throw new Error("Planner phase IDs must be unique.");

  const ownerQuestions = validateOwnerQuestions(value.ownerQuestions, ids);
  for (const phase of phases) {
    if (
      options.requireOwnerQuestions === true &&
      phase.requiresOwnerApproval &&
      !ownerQuestions.some((question) => question.blocking && question.phaseId === phase.id)
    ) {
      throw new Error(
        `Planner owner-gated phase ${phase.id} must include at least one phase-scoped blocking owner question.`
      );
    }
  }

  return {
    summary: stringValue(value, "summary"),
    assumptions: stringArray(value, "assumptions"),
    openQuestions: stringArray(value, "openQuestions"),
    globalRisks: stringArray(value, "globalRisks"),
    expectedAreas: stringArray(value, "expectedAreas").map((path) =>
      validateRepositoryPath(path, "Planner expectedAreas", { allowTrailingSlash: true })
    ),
    ownerQuestions,
    phases
  };
}

export async function createPlan(
  runner: AgentRunner,
  model: string,
  originalRequest: string
): Promise<{ plan: WorkflowPlan; cost: number | null; run: AgentRunResult }> {
  const prompt = `You are planning a Newl Apps feature in read-only mode.

Original feature request:
<FEATURE_REQUEST>
${originalRequest}
</FEATURE_REQUEST>

Inspect the real repository. Read AGENTS.md, docs/README.md, docs/architecture/overview.md, docs/modules/README.md, and the nearest relevant module documentation. Trace the requested behavior across every applicable UI, API, action, service, database, permission, test, and documentation layer. Preserve authenticated tenantId filtering and explicit human approval boundaries. Mark inferred business behavior as an open question.

Create the smallest complete sequence of independently reviewable phases. Preserve stable phase IDs from a validated handoff when they exist. The controller always runs git diff --check, npm run typecheck, npm run lint, npm run build, and the full npm test suite. Do not propose shell commands. testFiles is advisory review evidence describing the concrete regression test files the phase should add or update; it never controls which commands run and may contain only repository-relative tests/**/*.test.ts or tests/**/*.test.tsx paths. Set risk to owner_gated and requiresOwnerApproval to true for a phase that depends on unresolved owner decisions or would cross a protected human-approval boundary. Every owner-gated phase must have at least one phase-scoped blocking ownerQuestions entry. Never place unresolved business decisions inside an automatically executable phase.

Return exactly one JSON object inside these tags, with no text after the closing tag:
<AI_WORKFLOW_RESULT>
{
  "summary": "...",
  "assumptions": [],
  "openQuestions": [],
  "globalRisks": [],
  "expectedAreas": ["src/..."],
  "ownerQuestions": [
    {
      "id": "FEATURE-PHASE-QUESTION-1",
      "phaseId": "phase-2",
      "text": "What exact business rule should be used?",
      "type": "multiple_choice",
      "choices": [{ "value": "OPTION_A", "label": "Option A" }, { "value": "OPTION_B", "label": "Option B" }],
      "evidence": ["Repository evidence that makes this decision necessary."],
      "whyItMatters": "The builder cannot safely infer this rule.",
      "blocking": true
    }
  ],
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
    plan: validateWorkflowPlan(extractStructuredResult(result.text), {
      requireOwnerQuestions: true
    }),
    cost: result.cost,
    run: result
  };
}
