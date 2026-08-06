import { VerificationResult } from "./verification";

export type EvaluationContext = {
  repositoryRoot: string;
  featureSlug: string;
  phaseId: string;
  baseCommit: string;
  diffHash: string;
  verification: VerificationResult;
  confirmedDecisions: Record<string, string>;
};

export type EvaluationFinding = {
  code: string;
  message: string;
  blocking: boolean;
};

export type EvaluationResult = {
  schemaVersion: 1;
  evaluatorId: string;
  status: "passed" | "failed" | "error";
  findings: EvaluationFinding[];
  measurements: Record<string, number | string | boolean | null>;
  artifactHashes: string[];
  durationMs: number;
  diffHash: string;
};

export interface WorkflowEvaluator {
  id: string;
  evaluate(context: EvaluationContext): Promise<EvaluationResult>;
}

export function validateEvaluationResult(
  value: EvaluationResult,
  expected: { evaluatorId: string; diffHash: string }
): EvaluationResult {
  if (value.schemaVersion !== 1) throw new Error("Evaluator schemaVersion must be 1.");
  if (value.evaluatorId !== expected.evaluatorId) {
    throw new Error("Evaluator returned an unexpected evaluatorId.");
  }
  if (value.diffHash !== expected.diffHash) {
    throw new Error("Evaluator result does not match the current diff.");
  }
  if (!['passed', 'failed', 'error'].includes(value.status)) {
    throw new Error("Evaluator status must be passed, failed, or error.");
  }
  if (!Array.isArray(value.findings)) throw new Error("Evaluator findings must be an array.");
  for (const finding of value.findings) {
    if (!finding.code?.trim() || !finding.message?.trim() || typeof finding.blocking !== "boolean") {
      throw new Error("Evaluator findings must contain a code, message, and blocking flag.");
    }
  }
  if (value.status === "passed" && value.findings.some((finding) => finding.blocking)) {
    throw new Error("A passing evaluator cannot contain blocking findings.");
  }
  if (!Number.isFinite(value.durationMs) || value.durationMs < 0) {
    throw new Error("Evaluator durationMs must be a non-negative number.");
  }
  return value;
}

export function evaluatorBlocksApproval(result: EvaluationResult): boolean {
  return result.status !== "passed" || result.findings.some((finding) => finding.blocking);
}
