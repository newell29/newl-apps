import { lstat, readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { hashJson } from "./decisions";
import { WorkflowPlan } from "./planner";
import { OwnerQuestionRecord, RegisteredArtifact } from "./state";

const MAX_IMPORTED_QUESTIONS = 40;
const stableQuestionId = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/;

function repositoryRelativePath(worktree: string, path: string): string {
  const rel = relative(resolve(worktree), resolve(path));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("Legacy owner-question evidence must remain inside the selected worktree.");
  }
  return rel.replace(/\\/g, "/");
}

function questionRecord(input: {
  id: string;
  phaseId: string | null;
  planHash: string;
  text: string;
  evidence: string[];
  whyItMatters: string;
  blocking: boolean;
}): OwnerQuestionRecord {
  const id = input.id.trim();
  const text = input.text.trim();
  if (!stableQuestionId.test(id)) throw new Error(`Legacy owner question has an unsafe ID: ${id}`);
  if (!text || text.length > 4_000) {
    throw new Error(`Legacy owner question ${id} must contain 1-4,000 characters.`);
  }
  return {
    id,
    phaseId: input.phaseId,
    planHash: input.planHash,
    questionHash: hashJson({
      id,
      phaseId: input.phaseId,
      text,
      type: "free_text",
      choices: []
    }),
    text,
    type: "free_text",
    choices: [],
    evidence: input.evidence,
    whyItMatters: input.whyItMatters,
    blocking: input.blocking,
    answer: null,
    explanation: null,
    confirmedAt: null
  };
}

function deferredQuestionsFromJson(
  contents: string,
  evidencePath: string,
  planHash: string
): OwnerQuestionRecord[] {
  const value = JSON.parse(contents) as Record<string, unknown>;
  const questions = value.open_business_questions;
  if (questions === undefined) return [];
  if (!Array.isArray(questions)) {
    throw new Error(`Legacy handoff ${evidencePath} open_business_questions must be an array.`);
  }
  return questions.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Legacy handoff ${evidencePath} question ${index + 1} must be an object.`);
    }
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.question_id !== "string" || typeof candidate.question !== "string") {
      throw new Error(
        `Legacy handoff ${evidencePath} question ${index + 1} requires question_id and question strings.`
      );
    }
    return questionRecord({
      id: candidate.question_id,
      phaseId: null,
      planHash,
      text: candidate.question,
      evidence: [evidencePath],
      whyItMatters: "The imported handoff identifies this as an unresolved owner decision.",
      blocking: false
    });
  });
}

function blockingQuestionsFromMarkdown(
  contents: string,
  evidencePath: string,
  planHash: string,
  phaseId: string
): OwnerQuestionRecord[] {
  const sections = contents.split(/(?=^##\s+)/m);
  const questions: OwnerQuestionRecord[] = [];
  for (const section of sections) {
    const heading = section.match(/^##\s+(.+)$/m)?.[1]?.trim();
    if (!heading) continue;
    const explicitlyGated =
      /\bblocking\b/i.test(heading) ||
      /\b(?:these|the) questions? gate\b/i.test(section) ||
      /\bthey gate\b/i.test(section);
    if (!explicitlyGated) continue;
    const pattern = /^- \*\*([A-Za-z0-9][A-Za-z0-9._-]{1,79})\s+[—–-]\s+(.+?)\*\*:\s*(.+)$/gm;
    for (const match of section.matchAll(pattern)) {
      const [, id, title, question] = match;
      questions.push(
        questionRecord({
          id,
          phaseId,
          planHash,
          text: `${title.trim()}: ${question.trim()}`,
          evidence: [`${evidencePath} — ${heading}`],
          whyItMatters: `The imported legacy document explicitly gates ${phaseId} on this decision.`,
          blocking: true
        })
      );
    }
  }
  return questions;
}

function mergeQuestions(
  planQuestions: OwnerQuestionRecord[],
  importedQuestions: OwnerQuestionRecord[]
): OwnerQuestionRecord[] {
  const byId = new Map<string, OwnerQuestionRecord>();
  const generatedPlanQuestions = planQuestions.filter(
    (question) =>
      !(
        /^Q-[0-9A-F]{10}$/.test(question.id) &&
        importedQuestions.some(
          (imported) =>
            (imported.text === question.text || question.text.includes(imported.id)) &&
            (imported.phaseId === question.phaseId || question.phaseId === null)
        )
      )
  );
  for (const question of [...generatedPlanQuestions, ...importedQuestions]) {
    const existing = byId.get(question.id);
    if (!existing) {
      byId.set(question.id, question);
      continue;
    }
    if (
      existing.text !== question.text ||
      existing.phaseId !== question.phaseId ||
      existing.blocking !== question.blocking
    ) {
      throw new Error(`Owner question ${question.id} has conflicting imported definitions.`);
    }
  }
  if (byId.size > MAX_IMPORTED_QUESTIONS) {
    throw new Error(`Imported owner questions exceed the ${MAX_IMPORTED_QUESTIONS}-question limit.`);
  }
  return [...byId.values()];
}

export async function importLegacyOwnerQuestions(input: {
  worktree: string;
  plan: WorkflowPlan;
  planHash: string;
  artifacts: RegisteredArtifact[];
  planQuestions: OwnerQuestionRecord[];
}): Promise<OwnerQuestionRecord[]> {
  if (input.plan.ownerQuestions?.length) return input.planQuestions;

  const canonicalWorktree = await realpath(input.worktree);
  const imported: OwnerQuestionRecord[] = [];
  for (const artifact of input.artifacts.filter((candidate) => candidate.kind === "handoff_json")) {
    const canonicalArtifactPath = await realpath(artifact.worktreePath);
    const evidencePath = repositoryRelativePath(canonicalWorktree, canonicalArtifactPath);
    imported.push(
      ...deferredQuestionsFromJson(
        await readFile(canonicalArtifactPath, "utf8"),
        evidencePath,
        input.planHash
      )
    );
  }

  const gatedPhases = input.plan.phases.filter(
    (phase) => phase.requiresOwnerApproval || phase.risk === "owner_gated"
  );
  const candidatePaths = [
    ...new Set(
      input.plan.phases
        .flatMap((phase) => phase.expectedFiles)
        .filter((path) => /(^|\/)open-questions\.md$/i.test(path))
    )
  ];
  if (candidatePaths.length > 0 && gatedPhases.length !== 1) {
    throw new Error(
      "Legacy blocking questions require exactly one owner-gated phase; refusing to infer their phase."
    );
  }
  for (const candidatePath of candidatePaths) {
    const unresolvedPath = resolve(canonicalWorktree, candidatePath);
    repositoryRelativePath(canonicalWorktree, unresolvedPath);
    const metadata = await lstat(unresolvedPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Legacy owner-question evidence ${candidatePath} must be a regular file.`);
    }
    const canonicalPath = await realpath(unresolvedPath);
    const evidencePath = repositoryRelativePath(canonicalWorktree, canonicalPath);
    imported.push(
      ...blockingQuestionsFromMarkdown(
        await readFile(canonicalPath, "utf8"),
        evidencePath,
        input.planHash,
        gatedPhases[0].id
      )
    );
  }

  return mergeQuestions(input.planQuestions, imported);
}
