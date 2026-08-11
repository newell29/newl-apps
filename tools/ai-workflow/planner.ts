import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { AgentRunner, AgentRunResult, extractStructuredResult } from "./opencode";
import { sanitizeCommandOutput } from "./verification";

const PLANNER_LIMITS = {
  phases: 8,
  ownerQuestions: 8,
  topLevelItems: 8,
  expectedAreas: 12,
  requirements: 6,
  expectedFiles: 10,
  testFiles: 6,
  definitionOfDone: 6,
  choices: 6,
  evidence: 4,
  summaryLength: 1_000,
  objectiveLength: 700,
  textLength: 500,
  pathLength: 240,
  idLength: 80
} as const;

type PlannerValidationOptions = {
  requireOwnerQuestions?: boolean;
  enforceOutputBounds?: boolean;
};

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

function stringValue(
  record: Record<string, unknown>,
  key: string,
  maximumLength?: number
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Planner field ${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (maximumLength !== undefined && trimmed.length > maximumLength) {
    throw new Error(`Planner field ${key} must contain at most ${maximumLength} characters.`);
  }
  return trimmed;
}

function stringArray(
  record: Record<string, unknown>,
  key: string,
  limits: { maximumItems?: number; maximumLength?: number } = {}
): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Planner field ${key} must be an array of non-empty strings.`);
  }
  if (limits.maximumItems !== undefined && value.length > limits.maximumItems) {
    throw new Error(`Planner field ${key} must contain at most ${limits.maximumItems} items.`);
  }
  return value.map((item) => {
    const trimmed = (item as string).trim();
    if (limits.maximumLength !== undefined && trimmed.length > limits.maximumLength) {
      throw new Error(
        `Planner field ${key} items must contain at most ${limits.maximumLength} characters.`
      );
    }
    return trimmed;
  });
}

function rejectUnexpectedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unexpected fields: ${unexpected.join(", ")}.`);
  }
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

function validatePhase(value: unknown, index: number, bounded: boolean): PlanPhase {
  if (!isRecord(value)) throw new Error(`Planner phase ${index + 1} must be an object.`);
  if (bounded) {
    rejectUnexpectedKeys(
      value,
      [
        "id",
        "title",
        "objective",
        "requirements",
        "expectedFiles",
        "testFiles",
        "definitionOfDone",
        "risk",
        "requiresOwnerApproval"
      ],
      `Planner phase ${index + 1}`
    );
  }

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

  const expectedFiles = stringArray(value, "expectedFiles", {
    maximumItems: bounded ? PLANNER_LIMITS.expectedFiles : undefined,
    maximumLength: bounded ? PLANNER_LIMITS.pathLength : undefined
  }).map((path) =>
    validateRepositoryPath(path, `Planner phase ${index + 1}`, { allowTrailingSlash: true })
  );
  const testFiles = stringArray(value, "testFiles", {
    maximumItems: bounded ? PLANNER_LIMITS.testFiles : undefined,
    maximumLength: bounded ? PLANNER_LIMITS.pathLength : undefined
  }).map((path) => {
    const safePath = validateRepositoryPath(path, `Planner phase ${index + 1}`);
    if (!/^tests\/.+\.test\.tsx?$/.test(safePath)) {
      throw new Error(
        `Planner test file ${safePath} must be a repository-relative tests/**/*.test.ts or .test.tsx path.`
      );
    }
    return safePath;
  });

  return {
    id: stringValue(value, "id", bounded ? PLANNER_LIMITS.idLength : undefined),
    title: stringValue(value, "title", bounded ? PLANNER_LIMITS.textLength : undefined),
    objective: stringValue(value, "objective", bounded ? PLANNER_LIMITS.objectiveLength : undefined),
    requirements: stringArray(value, "requirements", {
      maximumItems: bounded ? PLANNER_LIMITS.requirements : undefined,
      maximumLength: bounded ? PLANNER_LIMITS.textLength : undefined
    }),
    expectedFiles,
    testFiles,
    definitionOfDone: stringArray(value, "definitionOfDone", {
      maximumItems: bounded ? PLANNER_LIMITS.definitionOfDone : undefined,
      maximumLength: bounded ? PLANNER_LIMITS.textLength : undefined
    }),
    risk,
    requiresOwnerApproval: value.requiresOwnerApproval
  };
}

function validateOwnerQuestions(
  value: unknown,
  phaseIds: Set<string>,
  bounded: boolean
): OwnerQuestionProposal[] {
  if (value === undefined) return [];
  const maximumQuestions = bounded ? PLANNER_LIMITS.ownerQuestions : 40;
  if (!Array.isArray(value) || value.length > maximumQuestions) {
    throw new Error(`Planner ownerQuestions must be an array with at most ${maximumQuestions} questions.`);
  }
  const questions = value.map((question, index): OwnerQuestionProposal => {
    if (!isRecord(question)) throw new Error(`Planner owner question ${index + 1} must be an object.`);
    if (bounded) {
      rejectUnexpectedKeys(
        question,
        ["id", "phaseId", "text", "type", "choices", "evidence", "whyItMatters", "blocking"],
        `Planner owner question ${index + 1}`
      );
    }
    const id = stringValue(question, "id", bounded ? PLANNER_LIMITS.idLength : undefined);
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
    if (bounded && question.choices.length > PLANNER_LIMITS.choices) {
      throw new Error(`Planner owner question ${id} has too many choices.`);
    }
    const choices = question.choices.map((choice, choiceIndex) => {
      if (!isRecord(choice)) {
        throw new Error(`Planner owner question ${id} choice ${choiceIndex + 1} must be an object.`);
      }
      if (bounded) {
        rejectUnexpectedKeys(choice, ["value", "label"], `Planner owner question ${id} choice`);
      }
      return {
        value: stringValue(choice, "value", bounded ? PLANNER_LIMITS.textLength : undefined),
        label: stringValue(choice, "label", bounded ? PLANNER_LIMITS.textLength : undefined)
      };
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
      text: stringValue(question, "text", bounded ? PLANNER_LIMITS.textLength : undefined),
      type,
      choices,
      evidence: stringArray(question, "evidence", {
        maximumItems: bounded ? PLANNER_LIMITS.evidence : undefined,
        maximumLength: bounded ? PLANNER_LIMITS.textLength : undefined
      }),
      whyItMatters: stringValue(
        question,
        "whyItMatters",
        bounded ? PLANNER_LIMITS.textLength : undefined
      ),
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
  options: PlannerValidationOptions = {}
): WorkflowPlan {
  if (!isRecord(value)) throw new Error("Planner output must be an object.");
  const bounded = options.enforceOutputBounds === true;
  if (bounded) {
    rejectUnexpectedKeys(
      value,
      ["summary", "assumptions", "openQuestions", "globalRisks", "expectedAreas", "ownerQuestions", "phases"],
      "Planner output"
    );
  }
  const maximumPhases = bounded ? PLANNER_LIMITS.phases : 12;
  if (!Array.isArray(value.phases) || value.phases.length < 1 || value.phases.length > maximumPhases) {
    throw new Error(`Planner output must contain between 1 and ${maximumPhases} phases.`);
  }

  const phases = value.phases.map((phase, index) => validatePhase(phase, index, bounded));
  const ids = new Set(phases.map((phase) => phase.id));
  if (ids.size !== phases.length) throw new Error("Planner phase IDs must be unique.");

  const ownerQuestions = validateOwnerQuestions(value.ownerQuestions, ids, bounded);
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
    summary: stringValue(value, "summary", bounded ? PLANNER_LIMITS.summaryLength : undefined),
    assumptions: stringArray(value, "assumptions", {
      maximumItems: bounded ? PLANNER_LIMITS.topLevelItems : undefined,
      maximumLength: bounded ? PLANNER_LIMITS.textLength : undefined
    }),
    openQuestions: stringArray(value, "openQuestions", {
      maximumItems: bounded ? PLANNER_LIMITS.topLevelItems : undefined,
      maximumLength: bounded ? PLANNER_LIMITS.textLength : undefined
    }),
    globalRisks: stringArray(value, "globalRisks", {
      maximumItems: bounded ? PLANNER_LIMITS.topLevelItems : undefined,
      maximumLength: bounded ? PLANNER_LIMITS.textLength : undefined
    }),
    expectedAreas: stringArray(value, "expectedAreas", {
      maximumItems: bounded ? PLANNER_LIMITS.expectedAreas : undefined,
      maximumLength: bounded ? PLANNER_LIMITS.pathLength : undefined
    }).map((path) =>
      validateRepositoryPath(path, "Planner expectedAreas", { allowTrailingSlash: true })
    ),
    ownerQuestions,
    phases
  };
}

type PlannerExecutionOptions = {
  repositoryRoot: string;
  onRun?: (run: AgentRunResult) => Promise<void>;
  onDiagnostic?: (path: string) => Promise<void>;
};

export type PlannedWorkflowResult = {
  plan: WorkflowPlan;
  cost: number | null;
  run: AgentRunResult;
  runs: AgentRunResult[];
  diagnosticPaths: string[];
};

function planningInspectionPrompt(originalRequest: string): string {
  return `You are planning a Newl Apps feature in read-only mode.

Original feature request:
<FEATURE_REQUEST>
${originalRequest}
</FEATURE_REQUEST>

Inspect the real repository. Read AGENTS.md, docs/README.md, docs/architecture/overview.md, docs/modules/README.md, and the nearest relevant module documentation. Trace the requested behavior across every applicable UI, API, action, service, database, permission, test, and documentation layer. Preserve authenticated tenantId filtering and explicit human approval boundaries. Mark inferred business behavior as an open question.

Do not emit the roadmap yet. Use this turn only for repository inspection and scope reconciliation. End with the short sentence "Repository inspection complete." The controller will request the compact structured roadmap in the same session.`;
}

function compactPlanPrompt(recovery = false): string {
  return `${recovery ? "Recover the roadmap from this existing planning session." : "Now emit the roadmap using the repository inspection already completed in this session."}

Create the smallest complete sequence of independently reviewable phases. Preserve stable phase IDs from a validated handoff when they exist. The controller always runs git diff --check, npm run typecheck, npm run lint, npm run build, and the full npm test suite. Do not propose shell commands. testFiles is advisory review evidence and may contain only repository-relative tests/**/*.test.ts or tests/**/*.test.tsx paths. Set risk to owner_gated and requiresOwnerApproval to true for a phase that depends on unresolved owner decisions or a protected human-approval boundary. Every owner-gated phase must have a phase-scoped blocking ownerQuestions entry. Never place unresolved business decisions inside an automatically executable phase.

Keep the complete roadmap compact enough to fit comfortably within 4,000 output tokens. Hard limits: at most 8 phases, 8 owner questions, 8 assumptions, 8 open questions, 8 global risks, and 12 expected areas. Each phase may contain at most 6 requirements, 10 expected files or repository areas, 6 test files, and 6 definition-of-done items. Use concise sentences. Do not repeat requirements across summary, objective, and definitionOfDone. Directory paths may end in /; the controller safely normalizes that trailing separator.

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
}

function compactRepairPrompt(error: unknown): string {
  const message = sanitizeCommandOutput(error instanceof Error ? error.message : String(error));
  return `Your previous structured roadmap could not be validated: ${message}

Repair the response once. Do not inspect more files, explain, or add scope. Return the same roadmap as a smaller complete JSON object inside one <AI_WORKFLOW_RESULT> envelope. Obey every field and item limit from the previous request. Close every JSON string, object, array, and the envelope. No text may follow the closing tag.`;
}

function parseBoundedPlan(result: AgentRunResult): WorkflowPlan {
  return validateWorkflowPlan(extractStructuredResult(result.text), {
    requireOwnerQuestions: true,
    enforceOutputBounds: true
  });
}

function plannerCost(runs: AgentRunResult[]): number | null {
  if (runs.some((run) => run.cost === null)) return null;
  return runs.reduce((total, run) => total + (run.cost ?? 0), 0);
}

function responseWithoutPrivateReasoning(text: string): string {
  return text
    .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, "[PRIVATE_REASONING_OMITTED]")
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, "[PRIVATE_REASONING_OMITTED]");
}

export async function writePlannerFailureDiagnostic(
  repositoryRoot: string,
  attempts: Array<{ run: AgentRunResult; error: unknown; recovered: boolean }>,
  now = new Date()
): Promise<string> {
  const directory = join(repositoryRoot, "tmp", "ai-workflow", "failures");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const path = join(directory, `planner-${timestamp}-${randomUUID()}.json`);
  const artifact = {
    schemaVersion: 1,
    recordedAt: now.toISOString(),
    attempts: attempts.slice(0, 2).map(({ run, error, recovered }) => ({
      recovered,
      error: sanitizeCommandOutput(error instanceof Error ? error.message : String(error)),
      openCode: {
        sessionId: run.sessionId ?? null,
        assistantMessageId: run.assistantMessageId ?? null,
        textPartIds: (run.textPartIds ?? []).slice(0, 64),
        finishReason: run.finishReason ?? null,
        tokens: run.tokens ?? null,
        cost: run.cost
      },
      response: {
        characters: run.text.length,
        openingEnvelopeAt: run.text.indexOf("<AI_WORKFLOW_RESULT>"),
        closingEnvelopeAt: run.text.indexOf("</AI_WORKFLOW_RESULT>"),
        redactedText: sanitizeCommandOutput(responseWithoutPrivateReasoning(run.text))
      }
    }))
  };
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  await chmod(path, 0o600);
  return path;
}

async function runStructuredPlanAttempts(
  runner: AgentRunner,
  model: string,
  sessionId: string,
  options: PlannerExecutionOptions,
  recovery: boolean,
  priorRuns: AgentRunResult[] = []
): Promise<PlannedWorkflowResult> {
  const runs = [...priorRuns];
  const diagnostics: string[] = [];
  const first = await runner.run({
    role: "planner",
    model,
    sessionId,
    prompt: compactPlanPrompt(recovery)
  });
  runs.push(first);
  await options.onRun?.(first);
  try {
    return { plan: parseBoundedPlan(first), cost: plannerCost(runs), run: first, runs, diagnosticPaths: [] };
  } catch (firstError) {
    const repairSessionId = first.sessionId ?? sessionId;
    const repaired = await runner.run({
      role: "planner",
      model,
      sessionId: repairSessionId,
      prompt: compactRepairPrompt(firstError)
    });
    runs.push(repaired);
    await options.onRun?.(repaired);
    try {
      const plan = parseBoundedPlan(repaired);
      const diagnostic = await writePlannerFailureDiagnostic(options.repositoryRoot, [
        { run: first, error: firstError, recovered: true }
      ]);
      diagnostics.push(diagnostic);
      await options.onDiagnostic?.(diagnostic);
      return { plan, cost: plannerCost(runs), run: repaired, runs, diagnosticPaths: diagnostics };
    } catch (repairError) {
      let diagnostic: string | null = null;
      try {
        diagnostic = await writePlannerFailureDiagnostic(options.repositoryRoot, [
          { run: first, error: firstError, recovered: false },
          { run: repaired, error: repairError, recovered: false }
        ]);
        await options.onDiagnostic?.(diagnostic);
      } catch {
        // The planner failure remains fail-closed even when local diagnostic capture fails.
      }
      throw new Error(
        `${repairError instanceof Error ? repairError.message : String(repairError)}${diagnostic ? ` Diagnostic: ${diagnostic}` : ""}`,
        { cause: repairError }
      );
    }
  }
}

export async function createPlan(
  runner: AgentRunner,
  model: string,
  originalRequest: string,
  options: PlannerExecutionOptions
): Promise<PlannedWorkflowResult> {
  const inspection = await runner.run({
    role: "planner",
    model,
    prompt: planningInspectionPrompt(originalRequest)
  });
  await options.onRun?.(inspection);

  // Preserve compatibility with deterministic test runners and older adapters that return the
  // requested structured result immediately and do not expose a resumable session ID.
  try {
    const plan = parseBoundedPlan(inspection);
    return {
      plan,
      cost: inspection.cost,
      run: inspection,
      runs: [inspection],
      diagnosticPaths: []
    };
  } catch {
    // A short inspection acknowledgement is the expected live response.
  }

  if (!inspection.sessionId) {
    const error = new Error("OpenCode did not expose the planner session ID required for structured output recovery.");
    let diagnostic: string | null = null;
    try {
      diagnostic = await writePlannerFailureDiagnostic(options.repositoryRoot, [
        { run: inspection, error, recovered: false }
      ]);
      await options.onDiagnostic?.(diagnostic);
    } catch {
      // Preserve the original error.
    }
    throw new Error(`${error.message}${diagnostic ? ` Diagnostic: ${diagnostic}` : ""}`, { cause: error });
  }

  return runStructuredPlanAttempts(
    runner,
    model,
    inspection.sessionId,
    options,
    false,
    [inspection]
  );
}

export async function recoverPlanFromSession(
  runner: AgentRunner,
  model: string,
  sessionId: string,
  options: PlannerExecutionOptions
): Promise<PlannedWorkflowResult> {
  if (!/^ses_[A-Za-z0-9_-]{6,128}$/.test(sessionId)) {
    throw new Error("Planner recovery requires a valid OpenCode session ID.");
  }
  return runStructuredPlanAttempts(runner, model, sessionId, options, true);
}
