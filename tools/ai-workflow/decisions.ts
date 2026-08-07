import { createHash } from "node:crypto";

import type { OwnerQuestionProposal, PlanPhase, WorkflowPlan } from "./planner";
import type { OwnerQuestionRecord } from "./state";

export type ConfirmedOwnerDecision = {
  answer: string;
  explanation: string | null;
};

export type ConfirmedOwnerDecisions = Record<string, ConfirmedOwnerDecision>;

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function generatedQuestionId(text: string): string {
  return `Q-${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 10).toUpperCase()}`;
}

export function questionsFromPlan(plan: WorkflowPlan, planHash = hashJson(plan)): OwnerQuestionRecord[] {
  const proposals: OwnerQuestionProposal[] =
    (plan.ownerQuestions?.length ?? 0) > 0
      ? (plan.ownerQuestions as OwnerQuestionProposal[])
      : plan.openQuestions.map((text) => ({
          id: generatedQuestionId(text),
          phaseId: null,
          text,
          type: "free_text" as const,
          choices: [],
          evidence: [],
          whyItMatters: "The planner identified this as requiring human judgment.",
          blocking: false
        }));
  return proposals.map((question) => ({
    ...question,
    planHash,
    questionHash: hashJson({
      id: question.id,
      phaseId: question.phaseId,
      text: question.text,
      type: question.type,
      choices: question.choices
    }),
    answer: null,
    explanation: null,
    confirmedAt: null
  }));
}

export function answerOwnerQuestion(
  question: OwnerQuestionRecord,
  answer: string,
  explanation: string | null,
  expected: { planHash: string; questionHash: string },
  now = new Date()
): OwnerQuestionRecord {
  if (question.planHash !== expected.planHash || question.questionHash !== expected.questionHash) {
    throw new Error("The question or plan changed; the answer must be reconfirmed.");
  }
  const value = answer.trim();
  if (!value || value.length > 4_000) throw new Error("Owner answer must contain 1-4,000 characters.");
  if (question.type === "yes_no" && !["yes", "no"].includes(value.toLowerCase())) {
    throw new Error("This question requires yes or no.");
  }
  if (
    question.type === "multiple_choice" &&
    !question.choices.some((choice) => choice.value === value)
  ) {
    throw new Error("The selected answer is not one of the approved choices.");
  }
  return {
    ...question,
    answer: question.type === "yes_no" ? value.toLowerCase() : value,
    explanation: explanation?.trim() || null,
    confirmedAt: now.toISOString()
  };
}

export function unresolvedBlockingQuestions(
  questions: OwnerQuestionRecord[],
  phaseId: string
): OwnerQuestionRecord[] {
  return questions.filter(
    (question) =>
      question.blocking &&
      (question.phaseId === null || question.phaseId === phaseId) &&
      !question.confirmedAt
  );
}

const protectedPatterns = [
  /production\s+(write|deployment|database)/i,
  /deploy(ment)?/i,
  /oauth\s+consent/i,
  /permission\s+change/i,
  /teamship\s+write/i,
  /apollo\s+enroll/i,
  /external\s+communication/i,
  /destructive/i
];

export function effectivePhaseRisk(phase: PlanPhase): PlanPhase["risk"] {
  if (phase.requiresOwnerApproval || phase.risk === "owner_gated") return "owner_gated";
  const evidence = [phase.title, phase.objective, ...phase.requirements, ...phase.expectedFiles].join(" ");
  if (protectedPatterns.some((pattern) => pattern.test(evidence))) return "owner_gated";
  if (
    phase.risk === "high" ||
    phase.expectedFiles.some(
      (path) => path === "prisma/schema.prisma" || path.startsWith("prisma/migrations/")
    )
  ) {
    return "high";
  }
  return phase.risk;
}

export function confirmedDecisionMap(questions: OwnerQuestionRecord[]): ConfirmedOwnerDecisions {
  return Object.fromEntries(
    questions
      .filter((question) => question.confirmedAt && question.answer)
      .map((question) => [
        question.id,
        {
          answer: question.answer as string,
          explanation: question.explanation
        }
      ])
  );
}

export function validateConfirmedOwnerDecisions(value: unknown): ConfirmedOwnerDecisions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Confirmed owner decisions must be an object.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([id, decision]) => {
      if (!id.trim() || !decision || typeof decision !== "object" || Array.isArray(decision)) {
        throw new Error("Each confirmed owner decision must have an ID and structured value.");
      }
      const record = decision as Record<string, unknown>;
      const unexpected = Object.keys(record).filter(
        (key) => key !== "answer" && key !== "explanation"
      );
      if (unexpected.length > 0) {
        throw new Error(`Confirmed owner decision ${id} contains unexpected fields.`);
      }
      if (typeof record.answer !== "string" || !record.answer.trim()) {
        throw new Error(`Confirmed owner decision ${id} must contain an answer.`);
      }
      if (record.explanation !== null && typeof record.explanation !== "string") {
        throw new Error(`Confirmed owner decision ${id} has an invalid explanation.`);
      }
      return [
        id,
        {
          answer: record.answer,
          explanation: record.explanation
        }
      ];
    })
  );
}
