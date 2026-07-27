import crypto from "node:crypto";

import { JobStatus, type Prisma } from "@prisma/client";

import {
  describeDevelopmentIssue,
  getDevelopmentContextPaths,
  type DevelopmentFeedbackCandidate
} from "@/modules/assistant/development-issue-grouping";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const RIVET_DEVELOPMENT_JOB_TYPE = "ASSISTANT_RIVET_DEVELOPMENT";

const DEFAULT_REPOSITORY = "newell29/newl-apps";
const DEFAULT_BASE_BRANCH = "main";
const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_REASONING_EFFORT = "high";
const LEASE_DURATION_MS = 75 * 60 * 1000;
const REVIEW_VERDICTS = new Set(["PASS", "NEEDS_CHANGES", "BLOCKED"]);
const REVIEW_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const REVIEW_FINDING_CATEGORIES = new Set([
  "TICKET_COVERAGE",
  "BUSINESS_SCOPE",
  "PRIVACY",
  "SECRETS",
  "TENANT_ISOLATION",
  "AUTHORIZATION",
  "APPROVAL_BOUNDARY",
  "CORRECTNESS",
  "REGRESSION_TEST",
  "DOCUMENTATION",
  "MERGEABILITY",
  "SIBLING_CONFLICT",
  "PR_BODY_ACCURACY"
]);

type DevelopmentSuggestionForJob = {
  id: string;
  moduleKey: string;
  workflowKey: string;
  title: string;
  summary: string;
  rationale: string;
  riskLevel: string;
  sourceFeedbackIds: Prisma.JsonValue;
  proposedScope: Prisma.JsonValue | null;
};

type SourceFeedbackForJob = DevelopmentFeedbackCandidate & {
  subjectType: string;
  subjectId: string | null;
};

type RivetJobInput = {
  version: 1;
  suggestionId: string;
  approvedByUserId: string;
  moduleKey: string;
  workflowKey: string;
  issueKey: string;
  title: string;
  summary: string;
  rationale: string;
  riskLevel: string;
  repository: string;
  baseBranch: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  requiredContextPaths: string[];
  sourceFeedback: Array<{
    id: string;
    classification: string;
    subjectType: string;
    subjectId: string | null;
    reporterStatement: string;
    expectedOutcome: string | null;
    observedOutcome: string | null;
  }>;
  allowedActions: string[];
  forbiddenActions: string[];
};

type RivetJobOutput = {
  phase?: string;
  attempt?: number;
  leaseTokenHash?: string;
  leaseExpiresAt?: string;
  claimedAt?: string;
  progressMessage?: string;
  branchName?: string;
  commitSha?: string;
  pullRequestUrls?: string[];
  summary?: string;
  tests?: string[];
  knownLimitations?: string[];
  completedAt?: string;
  failedAt?: string;
  errorCode?: string;
  reviewVerdict?: string;
  reviewAttempt?: number;
  reviewRiskLevel?: string;
  reviewSummary?: string;
  reviewedCommitSha?: string;
  unresolvedFindingCount?: number;
};

type RivetReviewFinding = {
  severity: string;
  category: string;
  file: string | null;
  line: number | null;
  summary: string;
  requiredFix: string;
  autoFixable: boolean;
  businessDecisionRequired: boolean;
};

export async function createRivetDevelopmentJob(
  tx: Prisma.TransactionClient,
  context: Pick<AuthenticatedContext, "tenantId" | "userId">,
  suggestion: DevelopmentSuggestionForJob,
  sourceFeedback: SourceFeedbackForJob[]
) {
  const issueKey = readIssueKey(suggestion.proposedScope) ??
    describeDevelopmentIssue(sourceFeedback[0] ?? {
      id: suggestion.id,
      moduleKey: suggestion.moduleKey,
      workflowKey: suggestion.workflowKey,
      classification: "GENERAL",
      reporterStatement: suggestion.summary
    }).key;
  const input: RivetJobInput = {
    version: 1,
    suggestionId: suggestion.id,
    approvedByUserId: context.userId,
    moduleKey: suggestion.moduleKey,
    workflowKey: suggestion.workflowKey,
    issueKey,
    title: suggestion.title,
    summary: suggestion.summary,
    rationale: suggestion.rationale,
    riskLevel: suggestion.riskLevel,
    repository: process.env.RIVET_DEVELOPER_REPOSITORY?.trim() || DEFAULT_REPOSITORY,
    baseBranch: process.env.RIVET_DEVELOPER_BASE_BRANCH?.trim() || DEFAULT_BASE_BRANCH,
    model: process.env.RIVET_DEVELOPER_CODEX_MODEL?.trim() || DEFAULT_MODEL,
    reasoningEffort: normalizeReasoningEffort(process.env.RIVET_DEVELOPER_REASONING_EFFORT),
    requiredContextPaths: getDevelopmentContextPaths(suggestion.workflowKey),
    sourceFeedback: sourceFeedback.map((item) => ({
      id: item.id,
      classification: item.classification,
      subjectType: item.subjectType,
      subjectId: item.subjectId,
      reporterStatement: item.reporterStatement,
      expectedOutcome: item.expectedOutcome ?? null,
      observedOutcome: item.observedOutcome ?? null
    })),
    allowedActions: [
      "READ_REQUIRED_CONTEXT",
      "EDIT_ISOLATED_BRANCH",
      "ADD_REGRESSION_TESTS",
      "UPDATE_DOCUMENTATION",
      "COMMIT",
      "PUSH_FEATURE_BRANCH",
      "OPEN_PULL_REQUEST"
    ],
    forbiddenActions: [
      "MERGE",
      "DEPLOY",
      "PRODUCTION_DATABASE_WRITE",
      "DATABASE_MIGRATION_EXECUTION",
      "TEAMSHIP_WRITE",
      "PRINT",
      "SHIP_OR_RELEASE_ORDER",
      "CUSTOMER_COMMUNICATION",
      "PERMISSION_CHANGE"
    ]
  };

  return tx.automationJobRun.create({
    data: {
      tenantId: context.tenantId,
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.QUEUED,
      input: input as unknown as Prisma.InputJsonValue,
      output: { phase: "QUEUED", attempt: 0 }
    }
  });
}

export async function claimRivetDevelopmentJob(context: AuthenticatedContext) {
  const queued = await prisma.automationJobRun.findFirst({
    where: {
      tenantId: context.tenantId,
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.QUEUED
    },
    orderBy: { createdAt: "asc" }
  });
  if (!queued) {
    const active = await prisma.automationJobRun.findMany({
      where: {
        tenantId: context.tenantId,
        jobType: RIVET_DEVELOPMENT_JOB_TYPE,
        status: JobStatus.RUNNING
      },
      orderBy: { createdAt: "asc" },
      take: 20
    });
    const expired = active.find((job) => {
      const leaseExpiresAt = readJobOutput(job.output).leaseExpiresAt;
      return Boolean(leaseExpiresAt && Date.parse(leaseExpiresAt) < Date.now());
    });
    if (expired) {
      await markExpiredJob(context, expired);
      return { state: "expired" as const, jobId: expired.id };
    }
    return { state: "empty" as const };
  }

  const parsedInput = parseRivetJobInput(queued.input);
  if (!parsedInput) {
    await markInvalidJob(context, queued.id);
    return { state: "invalid" as const, jobId: queued.id };
  }

  const leaseToken = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const output = readJobOutput(queued.output);
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  const branchName = buildBranchName(queued.id, parsedInput.title);
  const nextOutput: RivetJobOutput = {
    phase: "CLAIMED",
    attempt: (output.attempt ?? 0) + 1,
    leaseTokenHash: hashLeaseToken(leaseToken),
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    claimedAt: now.toISOString(),
    branchName
  };

  const claimed = await prisma.automationJobRun.updateMany({
    where: {
      id: queued.id,
      tenantId: context.tenantId,
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.QUEUED
    },
    data: {
      status: JobStatus.RUNNING,
      startedAt: now,
      output: nextOutput as Prisma.InputJsonValue,
      errorMessage: null,
      finishedAt: null
    }
  });
  if (claimed.count !== 1) return { state: "contended" as const };

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "assistant.rivet_development.claim",
      entityType: "AutomationJobRun",
      entityId: queued.id,
      before: { phase: output.phase ?? "QUEUED" },
      after: {
        phase: "CLAIMED",
        suggestionId: parsedInput.suggestionId,
        issueKey: parsedInput.issueKey,
        branchName,
        attempt: nextOutput.attempt
      }
    }
  });

  return {
    state: "claimed" as const,
    jobId: queued.id,
    leaseToken,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    packet: {
      ...parsedInput,
      jobId: queued.id,
      branchName
    }
  };
}

export async function updateRivetDevelopmentJob(
  context: AuthenticatedContext,
  input: {
    action: "progress" | "review" | "complete" | "fail";
    jobId: string;
    leaseToken: string;
    progressMessage?: string | null;
    branchName?: string | null;
    commitSha?: string | null;
    pullRequestUrls?: string[];
    summary?: string | null;
    tests?: string[];
    knownLimitations?: string[];
    errorCode?: string | null;
    errorMessage?: string | null;
    reviewAttempt?: number | null;
    reviewStartedAt?: string | null;
    reviewVerdict?: string | null;
    reviewRiskLevel?: string | null;
    reviewSummary?: string | null;
    reviewFindings?: unknown;
    ticketCoverage?: unknown;
    reviewChecks?: unknown;
    reviewTests?: unknown;
    businessQuestions?: unknown;
  }
) {
  const job = await prisma.automationJobRun.findFirst({
    where: {
      id: input.jobId,
      tenantId: context.tenantId,
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.RUNNING
    }
  });
  if (!job) throw new RivetDevelopmentJobError("The Rivet development job is not active.", 404);
  const jobInput = parseRivetJobInput(job.input);
  const output = readJobOutput(job.output);
  if (!jobInput || !output.leaseTokenHash || !safeLeaseTokenEquals(input.leaseToken, output.leaseTokenHash)) {
    throw new RivetDevelopmentJobError("The Rivet development lease is invalid.", 403);
  }
  if (output.leaseExpiresAt && Date.parse(output.leaseExpiresAt) < Date.now()) {
    throw new RivetDevelopmentJobError("The Rivet development lease has expired.", 409);
  }

  if (input.action === "progress") {
    const progressMessage = normalizeText(input.progressMessage, 500) || "Rivet is running the approved Codex task.";
    const nextOutput: RivetJobOutput = {
      ...output,
      phase: "RUNNING",
      progressMessage,
      leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS).toISOString()
    };
    await prisma.automationJobRun.update({
      where: { id: job.id },
      data: { output: nextOutput as Prisma.InputJsonValue }
    });
    return { state: "running" as const, jobId: job.id };
  }

  if (input.action === "review") {
    const commitSha = validateCommitSha(input.commitSha);
    const reviewAttempt = normalizeReviewAttempt(input.reviewAttempt);
    const expectedReviewAttempt = (output.reviewAttempt ?? 0) + 1;
    if (reviewAttempt !== expectedReviewAttempt) {
      throw new RivetDevelopmentJobError(
        `Rivet review attempt ${reviewAttempt} is out of sequence; expected ${expectedReviewAttempt}.`,
        409
      );
    }
    const verdict = normalizeReviewVerdict(input.reviewVerdict);
    const riskLevel = normalizeReviewRiskLevel(input.reviewRiskLevel);
    const summary = normalizeText(input.reviewSummary, 4000) ||
      "The independent Codex review did not provide a summary.";
    const findings = normalizeReviewFindings(input.reviewFindings);
    const ticketCoverage = normalizeJsonObject(input.ticketCoverage, 20_000);
    const checks = normalizeJsonObject(input.reviewChecks, 20_000);
    const tests = normalizeJsonObject(input.reviewTests, 20_000);
    const businessQuestions = normalizeStringArray(input.businessQuestions, 30, 500);
    const missingCoverage = normalizeStringArray(ticketCoverage.missing, 50, 500);
    const outOfScopeCoverage = normalizeStringArray(ticketCoverage.outOfScope, 50, 500);
    if (
      verdict === "PASS" &&
      (
        findings.length > 0 ||
        businessQuestions.length > 0 ||
        missingCoverage.length > 0 ||
        outOfScopeCoverage.length > 0
      )
    ) {
      throw new RivetDevelopmentJobError(
        "A passing Rivet review cannot contain unresolved findings, questions, missing coverage, or out-of-scope changes."
      );
    }
    if (verdict !== "PASS" && findings.length === 0 && businessQuestions.length === 0) {
      throw new RivetDevelopmentJobError(
        "A non-passing Rivet review must contain a finding or business question."
      );
    }
    const finishedAt = new Date();
    const startedAt = parseReviewStartedAt(input.reviewStartedAt, finishedAt);
    const phase = verdict === "PASS"
      ? "REVIEW_PASSED"
      : verdict === "NEEDS_CHANGES"
        ? "REVIEW_NEEDS_CHANGES"
        : "BLOCKED";
    const nextOutput: RivetJobOutput = {
      ...output,
      phase,
      progressMessage: summary,
      leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS).toISOString(),
      reviewVerdict: verdict,
      reviewAttempt,
      reviewRiskLevel: riskLevel,
      reviewSummary: summary,
      reviewedCommitSha: commitSha,
      unresolvedFindingCount: findings.length
    };

    await prisma.$transaction(async (tx) => {
      const reviewRun = await tx.codexReviewRun.create({
        data: {
          tenantId: context.tenantId,
          developmentSuggestionId: jobInput.suggestionId,
          developmentJobId: job.id,
          commitSha,
          attempt: reviewAttempt,
          status: verdict === "PASS" ? "PASSED" : verdict,
          verdict,
          riskLevel,
          summary,
          findings: findings as unknown as Prisma.InputJsonValue,
          ticketCoverage,
          checks,
          tests,
          businessQuestions,
          reviewerModel: jobInput.model,
          reviewerReasoningEffort: jobInput.reasoningEffort,
          startedAt,
          finishedAt
        }
      });
      await tx.automationJobRun.update({
        where: { id: job.id },
        data: { output: nextOutput as Prisma.InputJsonValue }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "assistant.rivet_development.review",
          entityType: "CodexReviewRun",
          entityId: reviewRun.id,
          before: {
            phase: output.phase ?? "RUNNING",
            reviewedCommitSha: output.reviewedCommitSha ?? null
          },
          after: {
            phase,
            suggestionId: jobInput.suggestionId,
            commitSha,
            attempt: reviewAttempt,
            verdict,
            riskLevel,
            findingCount: findings.length,
            businessQuestionCount: businessQuestions.length
          }
        }
      });
    });

    return {
      state: "reviewed" as const,
      jobId: job.id,
      verdict,
      reviewAttempt,
      findingCount: findings.length
    };
  }

  if (input.action === "fail") {
    const errorMessage = normalizeText(input.errorMessage, 1000) || "Rivet could not complete the approved Codex task.";
    const errorCode = normalizeCode(input.errorCode) || "RIVET_FAILED";
    const failedAt = new Date();
    const branchName = input.branchName ? validateBranchName(input.branchName) : output.branchName;
    const commitSha = input.commitSha ? validateCommitSha(input.commitSha) : output.commitSha;
    const pullRequestUrls = input.pullRequestUrls?.length
      ? validatePullRequestUrls(input.pullRequestUrls, jobInput.repository)
      : output.pullRequestUrls ?? [];
    const phase = errorCode === "RIVET_REVIEW_BLOCKED" ? "BLOCKED" : "FAILED";
    const nextOutput: RivetJobOutput = {
      ...output,
      phase,
      branchName,
      commitSha,
      pullRequestUrls,
      failedAt: failedAt.toISOString(),
      errorCode
    };
    await prisma.$transaction(async (tx) => {
      await tx.automationJobRun.update({
        where: { id: job.id },
        data: {
          status: JobStatus.ERROR,
          output: nextOutput as Prisma.InputJsonValue,
          errorMessage,
          finishedAt: failedAt
        }
      });
      if (pullRequestUrls[0]) {
        await tx.developmentSuggestion.updateMany({
          where: {
            tenantId: context.tenantId,
            id: jobInput.suggestionId,
            developmentThreadId: job.id
          },
          data: { pullRequestUrl: pullRequestUrls[0] }
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "assistant.rivet_development.failed",
          entityType: "AutomationJobRun",
          entityId: job.id,
          before: { phase: output.phase ?? "RUNNING" },
          after: {
            phase,
            suggestionId: jobInput.suggestionId,
            errorCode,
            branchName: branchName ?? null,
            commitSha: commitSha ?? null,
            pullRequestUrls
          }
        }
      });
    });
    return {
      state: phase === "BLOCKED" ? "blocked" as const : "failed" as const,
      jobId: job.id,
      pullRequestUrls,
      teamsMessage: phase === "BLOCKED"
        ? `Rivet review blocked ${jobInput.title}. Review ${pullRequestUrls.join(", ") || "the Rivet job in Newl Apps"}. Nothing was merged or deployed.`
        : undefined
    };
  }

  const branchName = validateBranchName(input.branchName || output.branchName);
  const commitSha = validateCommitSha(input.commitSha);
  const pullRequestUrls = validatePullRequestUrls(
    input.pullRequestUrls,
    jobInput.repository
  );
  if (output.reviewVerdict !== "PASS" || output.reviewedCommitSha !== commitSha) {
    throw new RivetDevelopmentJobError(
      "Rivet cannot mark a pull request ready until an independent Codex review passes the exact commit.",
      409
    );
  }
  const completedAt = new Date();
  const nextOutput: RivetJobOutput = {
    ...output,
    phase: "READY_FOR_ALEX",
    branchName,
    commitSha,
    pullRequestUrls,
    summary: normalizeText(input.summary, 4000) || "Rivet completed the approved Codex task.",
    tests: normalizeStringArray(input.tests, 20, 500),
    knownLimitations: normalizeStringArray(input.knownLimitations, 20, 500),
    completedAt: completedAt.toISOString()
  };

  await prisma.$transaction(async (tx) => {
    await tx.automationJobRun.update({
      where: { id: job.id },
      data: {
        status: JobStatus.SUCCESS,
        output: nextOutput as Prisma.InputJsonValue,
        errorMessage: null,
        finishedAt: completedAt
      }
    });
    await tx.developmentSuggestion.updateMany({
      where: {
        tenantId: context.tenantId,
        id: jobInput.suggestionId,
        developmentThreadId: job.id
      },
      data: { pullRequestUrl: pullRequestUrls[0] }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.rivet_development.completed",
        entityType: "AutomationJobRun",
        entityId: job.id,
        before: { phase: output.phase ?? "RUNNING" },
        after: {
          phase: "READY_FOR_ALEX",
          suggestionId: jobInput.suggestionId,
          branchName,
          commitSha,
          pullRequestUrls
        }
      }
    });
  });

  return {
    state: "completed" as const,
    jobId: job.id,
    suggestionId: jobInput.suggestionId,
    pullRequestUrls,
    teamsMessage: `Rivet independently reviewed ${jobInput.title} and marked it READY_FOR_ALEX after ${output.reviewAttempt ?? 1} review round(s). Review ${pullRequestUrls.join(", ")}. Nothing was merged or deployed.`
  };
}

export function summarizeRivetDevelopmentJob(job: {
  id: string;
  status: JobStatus;
  output: Prisma.JsonValue | null;
  errorMessage: string | null;
}) {
  const output = readJobOutput(job.output);
  return {
    id: job.id,
    status: job.status,
    phase: output.phase ?? job.status,
    progressMessage: output.progressMessage ?? null,
    branchName: output.branchName ?? null,
    pullRequestUrls: output.pullRequestUrls ?? [],
    summary: output.summary ?? null,
    tests: output.tests ?? [],
    knownLimitations: output.knownLimitations ?? [],
    errorMessage: job.errorMessage,
    reviewVerdict: output.reviewVerdict ?? null,
    reviewAttempt: output.reviewAttempt ?? null,
    reviewRiskLevel: output.reviewRiskLevel ?? null,
    reviewSummary: output.reviewSummary ?? null,
    reviewedCommitSha: output.reviewedCommitSha ?? null,
    unresolvedFindingCount: output.unresolvedFindingCount ?? 0
  };
}

export class RivetDevelopmentJobError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RivetDevelopmentJobError";
    this.status = status;
  }
}

function parseRivetJobInput(value: Prisma.JsonValue | null): RivetJobInput | null {
  const record = readRecord(value);
  const sourceFeedback = Array.isArray(record.sourceFeedback)
    ? record.sourceFeedback.map(readRecord).filter((item) => typeof item.id === "string")
    : [];
  if (
    record.version !== 1 ||
    typeof record.suggestionId !== "string" ||
    typeof record.approvedByUserId !== "string" ||
    typeof record.moduleKey !== "string" ||
    typeof record.workflowKey !== "string" ||
    typeof record.issueKey !== "string" ||
    typeof record.title !== "string" ||
    typeof record.repository !== "string" ||
    typeof record.baseBranch !== "string" ||
    typeof record.model !== "string" ||
    !Array.isArray(record.requiredContextPaths)
  ) return null;
  return {
    version: 1,
    suggestionId: record.suggestionId,
    approvedByUserId: record.approvedByUserId,
    moduleKey: record.moduleKey,
    workflowKey: record.workflowKey,
    issueKey: record.issueKey,
    title: record.title,
    summary: typeof record.summary === "string" ? record.summary : "",
    rationale: typeof record.rationale === "string" ? record.rationale : "",
    riskLevel: typeof record.riskLevel === "string" ? record.riskLevel : "MEDIUM",
    repository: record.repository,
    baseBranch: record.baseBranch,
    model: record.model,
    reasoningEffort: normalizeReasoningEffort(
      typeof record.reasoningEffort === "string" ? record.reasoningEffort : undefined
    ),
    requiredContextPaths: record.requiredContextPaths.filter((item): item is string => typeof item === "string"),
    sourceFeedback: sourceFeedback.map((item) => ({
      id: String(item.id),
      classification: typeof item.classification === "string" ? item.classification : "GENERAL",
      subjectType: typeof item.subjectType === "string" ? item.subjectType : "GENERAL",
      subjectId: typeof item.subjectId === "string" ? item.subjectId : null,
      reporterStatement: typeof item.reporterStatement === "string" ? item.reporterStatement : "",
      expectedOutcome: typeof item.expectedOutcome === "string" ? item.expectedOutcome : null,
      observedOutcome: typeof item.observedOutcome === "string" ? item.observedOutcome : null
    })),
    allowedActions: normalizeStringArray(record.allowedActions, 20, 100),
    forbiddenActions: normalizeStringArray(record.forbiddenActions, 20, 100)
  };
}

function readJobOutput(value: Prisma.JsonValue | null): RivetJobOutput {
  const record = readRecord(value);
  return {
    phase: typeof record.phase === "string" ? record.phase : undefined,
    attempt: typeof record.attempt === "number" ? record.attempt : undefined,
    leaseTokenHash: typeof record.leaseTokenHash === "string" ? record.leaseTokenHash : undefined,
    leaseExpiresAt: typeof record.leaseExpiresAt === "string" ? record.leaseExpiresAt : undefined,
    claimedAt: typeof record.claimedAt === "string" ? record.claimedAt : undefined,
    progressMessage: typeof record.progressMessage === "string" ? record.progressMessage : undefined,
    branchName: typeof record.branchName === "string" ? record.branchName : undefined,
    commitSha: typeof record.commitSha === "string" ? record.commitSha : undefined,
    pullRequestUrls: normalizeStringArray(record.pullRequestUrls, 5, 500),
    summary: typeof record.summary === "string" ? record.summary : undefined,
    tests: normalizeStringArray(record.tests, 20, 500),
    knownLimitations: normalizeStringArray(record.knownLimitations, 20, 500),
    completedAt: typeof record.completedAt === "string" ? record.completedAt : undefined,
    failedAt: typeof record.failedAt === "string" ? record.failedAt : undefined,
    errorCode: typeof record.errorCode === "string" ? record.errorCode : undefined,
    reviewVerdict: typeof record.reviewVerdict === "string" ? record.reviewVerdict : undefined,
    reviewAttempt: typeof record.reviewAttempt === "number" ? record.reviewAttempt : undefined,
    reviewRiskLevel: typeof record.reviewRiskLevel === "string" ? record.reviewRiskLevel : undefined,
    reviewSummary: typeof record.reviewSummary === "string" ? record.reviewSummary : undefined,
    reviewedCommitSha: typeof record.reviewedCommitSha === "string" ? record.reviewedCommitSha : undefined,
    unresolvedFindingCount: typeof record.unresolvedFindingCount === "number"
      ? record.unresolvedFindingCount
      : undefined
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readIssueKey(value: Prisma.JsonValue | null) {
  const issueKey = readRecord(value).issueKey;
  return typeof issueKey === "string" && issueKey.trim() ? issueKey.trim() : null;
}

function buildBranchName(jobId: string, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "approved-suggestion";
  return `codex/rivet-${jobId.slice(-8)}-${slug}`;
}

function validateBranchName(value: string | null | undefined) {
  const branch = value?.trim();
  if (!branch || !/^codex\/[a-z0-9][a-z0-9._/-]{2,119}$/i.test(branch) || branch.includes("..")) {
    throw new RivetDevelopmentJobError("Rivet returned an invalid feature branch.");
  }
  return branch;
}

function validateCommitSha(value: string | null | undefined) {
  const sha = value?.trim();
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new RivetDevelopmentJobError("Rivet returned an invalid commit SHA.");
  }
  return sha;
}

function validatePullRequestUrls(values: string[] | undefined, repository: string) {
  const normalized = normalizeStringArray(values, 5, 500);
  if (normalized.length === 0) {
    throw new RivetDevelopmentJobError("Rivet must return at least one pull request URL.");
  }
  const expectedPrefix = `https://github.com/${repository}/pull/`;
  for (const value of normalized) {
    if (!value.startsWith(expectedPrefix) || !/\/pull\/\d+$/.test(value)) {
      throw new RivetDevelopmentJobError("Rivet returned a pull request outside the approved repository.");
    }
  }
  return normalized;
}

function hashLeaseToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeLeaseTokenEquals(value: string, expectedHash: string) {
  const actual = Buffer.from(hashLeaseToken(value));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeReasoningEffort(value?: string): RivetJobInput["reasoningEffort"] {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : DEFAULT_REASONING_EFFORT;
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  return value?.replace(/\s+/g, " ").trim().slice(0, maxLength) || null;
}

function normalizeCode(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 80);
  return normalized || null;
}

function normalizeReviewAttempt(value: number | null | undefined) {
  if (!Number.isInteger(value) || !value || value < 1 || value > 10) {
    throw new RivetDevelopmentJobError("Rivet returned an invalid review attempt.");
  }
  return value;
}

function normalizeReviewVerdict(value: string | null | undefined) {
  const verdict = value?.trim().toUpperCase();
  if (!verdict || !REVIEW_VERDICTS.has(verdict)) {
    throw new RivetDevelopmentJobError("Rivet returned an invalid review verdict.");
  }
  return verdict;
}

function normalizeReviewRiskLevel(value: string | null | undefined) {
  const riskLevel = value?.trim().toUpperCase();
  if (!riskLevel || !REVIEW_RISK_LEVELS.has(riskLevel)) {
    throw new RivetDevelopmentJobError("Rivet returned an invalid review risk level.");
  }
  return riskLevel;
}

function normalizeReviewFindings(value: unknown): RivetReviewFinding[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((entry) => {
    const finding = readRecord(entry);
    const severity = normalizeCode(typeof finding.severity === "string" ? finding.severity : null);
    const category = normalizeCode(typeof finding.category === "string" ? finding.category : null);
    const file = normalizeText(typeof finding.file === "string" ? finding.file : null, 500);
    const line = typeof finding.line === "number" && Number.isInteger(finding.line) && finding.line > 0
      ? Math.min(finding.line, 1_000_000)
      : null;
    const summary = normalizeText(typeof finding.summary === "string" ? finding.summary : null, 1000);
    const requiredFix = normalizeText(
      typeof finding.requiredFix === "string" ? finding.requiredFix : null,
      2000
    );
    if (
      !severity ||
      !REVIEW_RISK_LEVELS.has(severity) ||
      !category ||
      !REVIEW_FINDING_CATEGORIES.has(category) ||
      !summary ||
      !requiredFix
    ) {
      throw new RivetDevelopmentJobError("Rivet returned an incomplete review finding.");
    }
    return {
      severity,
      category,
      file,
      line,
      summary,
      requiredFix,
      autoFixable: finding.autoFixable === true,
      businessDecisionRequired: finding.businessDecisionRequired === true
    };
  });
}

function normalizeJsonObject(value: unknown, maxBytes: number): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new RivetDevelopmentJobError("Rivet returned an oversized review payload.");
  }
  return JSON.parse(serialized) as Prisma.InputJsonObject;
}

function parseReviewStartedAt(value: string | null | undefined, finishedAt: Date) {
  if (!value) return finishedAt;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new RivetDevelopmentJobError("Rivet returned an invalid review start time.");
  }
  const startedAt = new Date(timestamp);
  if (
    startedAt.getTime() > finishedAt.getTime() ||
    finishedAt.getTime() - startedAt.getTime() > LEASE_DURATION_MS
  ) {
    throw new RivetDevelopmentJobError("Rivet returned an invalid review duration.");
  }
  return startedAt;
}

function normalizeStringArray(value: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

async function markInvalidJob(context: AuthenticatedContext, jobId: string) {
  const finishedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.automationJobRun.update({
      where: { id: jobId },
      data: {
        status: JobStatus.ERROR,
        output: { phase: "FAILED", errorCode: "INVALID_JOB_PACKET", failedAt: finishedAt.toISOString() },
        errorMessage: "The stored Rivet development packet is invalid.",
        finishedAt
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.rivet_development.invalid",
        entityType: "AutomationJobRun",
        entityId: jobId,
        after: { phase: "FAILED", errorCode: "INVALID_JOB_PACKET" }
      }
    });
  });
}

async function markExpiredJob(
  context: AuthenticatedContext,
  job: {
    id: string;
    output: Prisma.JsonValue | null;
  }
) {
  const finishedAt = new Date();
  const output = readJobOutput(job.output);
  const nextOutput: RivetJobOutput = {
    ...output,
    phase: "FAILED",
    failedAt: finishedAt.toISOString(),
    errorCode: "LEASE_EXPIRED"
  };
  await prisma.$transaction(async (tx) => {
    await tx.automationJobRun.update({
      where: { id: job.id },
      data: {
        status: JobStatus.ERROR,
        output: nextOutput as Prisma.InputJsonValue,
        errorMessage: "The local Rivet worker stopped before completing this job. Review the preserved worktree, then use Retry Rivet.",
        finishedAt
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.rivet_development.lease_expired",
        entityType: "AutomationJobRun",
        entityId: job.id,
        before: { phase: output.phase ?? "RUNNING" },
        after: { phase: "FAILED", errorCode: "LEASE_EXPIRED" }
      }
    });
  });
}
