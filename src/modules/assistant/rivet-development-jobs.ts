import crypto from "node:crypto";

import { JobStatus, type Prisma } from "@prisma/client";
import { PDFDocument } from "pdf-lib";

import {
  describeDevelopmentIssue,
  getDevelopmentContextPaths,
  type DevelopmentFeedbackCandidate
} from "@/modules/assistant/development-issue-grouping";
import { feedbackRequiresSourceEvidence } from "@/modules/assistant/feedback-review-fields";
import { GARLAND_WORKFLOW_KEY } from "@/modules/assistant/garland-artifacts";
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
  teamshipReviewRunId?: string | null;
  teamshipReviewOrderId?: string | null;
  artifactId?: string | null;
  evidence?: Prisma.JsonValue | null;
};

type RivetJobInput = {
  version: 1 | 2;
  suggestionId: string;
  approvedByUserId: string;
  moduleKey: string;
  workflowKey: string;
  issueKey: string;
  scopeKey: string;
  title: string;
  summary: string;
  rationale: string;
  approvalComments: string | null;
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
  evidenceManifests: RivetEvidenceManifest[];
  allowedActions: string[];
  forbiddenActions: string[];
};

type RivetEvidenceManifest = {
  feedbackId: string;
  subjectId: string | null;
  issueType: string;
  evidenceRequired: boolean;
  evidenceStatus: "READY" | "NOT_REQUIRED" | "MISSING";
  structuredFeedback: {
    affectedField: string | null;
    actualValue: string | null;
    expectedValue: string | null;
  };
  reviewOrder: {
    id: string;
    runId: string;
    psNumber: string;
    srNumber: string;
    pageNumbers: number[];
    pdfOrder: Prisma.JsonValue;
    review: Prisma.JsonValue;
  } | null;
  artifacts: Array<{
    artifactId: string;
    kind: "SOURCE_PDF" | "REVIEWER_ATTACHMENT";
    contentType: string;
    sizeBytes: number;
    contentHash: string;
    pageNumbers: number[];
    downloadPath: string;
  }>;
};

type RivetJobOutput = {
  phase?: string;
  attempt?: number;
  blockedByJobId?: string;
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
  sourceFeedback: SourceFeedbackForJob[],
  approvalComments: string | null = null,
  options: { excludeJobId?: string | null } = {}
) {
  const issueKey = readIssueKey(suggestion.proposedScope) ??
    describeDevelopmentIssue(sourceFeedback[0] ?? {
      id: suggestion.id,
      moduleKey: suggestion.moduleKey,
      workflowKey: suggestion.workflowKey,
      classification: "GENERAL",
      reporterStatement: suggestion.summary
    }).key;
  const scopeKey = `${suggestion.moduleKey}:${suggestion.workflowKey}`;
  const overlapping = await tx.automationJobRun.findFirst({
    where: {
      tenantId: context.tenantId,
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      ...(options.excludeJobId ? { id: { not: options.excludeJobId } } : {}),
      input: { path: ["scopeKey"], equals: scopeKey },
      OR: [
        { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
        {
          status: JobStatus.ERROR,
          output: { path: ["phase"], equals: "BLOCKED" }
        }
      ]
    },
    select: { id: true, status: true, output: true }
  });
  const evidenceManifests = await buildRivetEvidenceManifests(
    tx,
    context.tenantId,
    sourceFeedback
  );
  const input: RivetJobInput = {
    version: 2,
    suggestionId: suggestion.id,
    approvedByUserId: context.userId,
    moduleKey: suggestion.moduleKey,
    workflowKey: suggestion.workflowKey,
    issueKey,
    scopeKey,
    title: suggestion.title,
    summary: suggestion.summary,
    rationale: suggestion.rationale,
    approvalComments: normalizeText(approvalComments, 4000),
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
    evidenceManifests,
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
      output: overlapping
        ? {
            phase: "WAITING_FOR_RIVET",
            attempt: 0,
            blockedByJobId: overlapping.id,
            progressMessage:
              "Approved and waiting for the current Rivet job in this workflow to finish or be resolved."
          }
        : {
            phase: "QUEUED",
            attempt: 0,
            progressMessage: "Approved and queued for Rivet."
          }
    }
  });
}

async function buildRivetEvidenceManifests(
  tx: Prisma.TransactionClient,
  tenantId: string,
  feedback: SourceFeedbackForJob[]
): Promise<RivetEvidenceManifest[]> {
  const manifests: RivetEvidenceManifest[] = [];
  for (const item of feedback) {
    const evidenceRequired =
      item.workflowKey === GARLAND_WORKFLOW_KEY &&
      feedbackRequiresSourceEvidence(item.classification);
    const evidence = readRecord(item.evidence);
    const reviewOrder = item.teamshipReviewOrderId
      ? await tx.teamshipReviewOrder.findFirst({
          where: {
            tenantId,
            id: item.teamshipReviewOrderId,
            run: { deletedAt: null }
          },
          select: {
            id: true,
            runId: true,
            psNumber: true,
            srNumber: true,
            pageNumbers: true,
            pdfOrder: true,
            review: true
          }
        })
      : null;
    if (item.teamshipReviewOrderId && !reviewOrder) {
      throw new RivetDevelopmentJobError(
        "The approved feedback references Garland review evidence that is no longer available.",
        409
      );
    }
    if (
      reviewOrder &&
      item.subjectId &&
      item.subjectId !== reviewOrder.psNumber &&
      item.subjectId !== reviewOrder.srNumber
    ) {
      throw new RivetDevelopmentJobError(
        "The approved feedback evidence does not match its PS or SR number.",
        409
      );
    }

    const sourceArtifact = reviewOrder
      ? await tx.workflowArtifact.findFirst({
          where: {
            tenantId,
            workflowKey: GARLAND_WORKFLOW_KEY,
            teamshipReviewRunId: reviewOrder.runId,
            status: "REVIEWED",
            contentType: "application/pdf",
            contentHash: { not: null }
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            contentType: true,
            sizeBytes: true,
            contentHash: true
          }
        })
      : null;
    const reviewerArtifact = item.artifactId
      ? await tx.workflowArtifact.findFirst({
          where: {
            tenantId,
            id: item.artifactId,
            workflowKey: GARLAND_WORKFLOW_KEY,
            status: { in: ["REVIEWED", "EVIDENCE_READY"] },
            contentHash: { not: null }
          },
          select: {
            id: true,
            status: true,
            contentType: true,
            sizeBytes: true,
            contentHash: true,
            teamshipReviewRunId: true,
            extractionSummary: true
          }
        })
      : null;
    if (item.artifactId && !reviewerArtifact) {
      throw new RivetDevelopmentJobError(
        "The approved feedback attachment is no longer available.",
        409
      );
    }
    if (
      reviewerArtifact?.status === "EVIDENCE_READY" &&
      readRecord(reviewerArtifact.extractionSummary).feedbackId !== item.id
    ) {
      throw new RivetDevelopmentJobError(
        "The approved feedback attachment belongs to another report.",
        409
      );
    }

    const artifactsById = new Map<string, RivetEvidenceManifest["artifacts"][number]>();
    if (sourceArtifact?.contentHash) {
      artifactsById.set(sourceArtifact.id, {
        artifactId: sourceArtifact.id,
        kind: "SOURCE_PDF",
        contentType: sourceArtifact.contentType,
        sizeBytes: sourceArtifact.sizeBytes,
        contentHash: sourceArtifact.contentHash,
        pageNumbers: normalizeEvidencePageNumbers(reviewOrder?.pageNumbers),
        downloadPath: `/api/assistant/openclaw/development-jobs/evidence?feedbackId=${encodeURIComponent(item.id)}&artifactId=${encodeURIComponent(sourceArtifact.id)}`
      });
    }
    if (reviewerArtifact?.contentHash) {
      const kind: RivetEvidenceManifest["artifacts"][number]["kind"] =
        reviewerArtifact.status === "EVIDENCE_READY"
        ? "REVIEWER_ATTACHMENT"
        : "SOURCE_PDF";
      artifactsById.set(reviewerArtifact.id, {
        artifactId: reviewerArtifact.id,
        kind,
        contentType: reviewerArtifact.contentType,
        sizeBytes: reviewerArtifact.sizeBytes,
        contentHash: reviewerArtifact.contentHash,
        pageNumbers: kind === "SOURCE_PDF"
          ? normalizeEvidencePageNumbers(reviewOrder?.pageNumbers)
          : [],
        downloadPath: `/api/assistant/openclaw/development-jobs/evidence?feedbackId=${encodeURIComponent(item.id)}&artifactId=${encodeURIComponent(reviewerArtifact.id)}`
      });
    }
    const artifacts = [...artifactsById.values()];
    const evidenceStatus = reviewOrder && artifacts.length > 0
      ? "READY"
      : evidenceRequired
        ? "MISSING"
        : "NOT_REQUIRED";
    if (evidenceRequired && evidenceStatus !== "READY") {
      throw new RivetDevelopmentJobError(
        "This Garland field-update suggestion needs an exact saved review plus its source PDF or a supporting screenshot before Rivet can start.",
        409
      );
    }

    manifests.push({
      feedbackId: item.id,
      subjectId: item.subjectId,
      issueType: item.classification,
      evidenceRequired,
      evidenceStatus,
      structuredFeedback: {
        affectedField: readBoundedString(evidence.affectedField, 200),
        actualValue: readBoundedString(evidence.actualValue, 4000),
        expectedValue: readBoundedString(evidence.expectedValue, 4000)
      },
      reviewOrder: reviewOrder ? {
        id: reviewOrder.id,
        runId: reviewOrder.runId,
        psNumber: reviewOrder.psNumber,
        srNumber: reviewOrder.srNumber,
        pageNumbers: normalizeEvidencePageNumbers(reviewOrder.pageNumbers),
        pdfOrder: reviewOrder.pdfOrder,
        review: reviewOrder.review
      } : null,
      artifacts
    });
  }
  return manifests;
}

export async function claimRivetDevelopmentJob(context: AuthenticatedContext) {
  const activeOrBlocked = await prisma.automationJobRun.findMany({
    where: {
      tenantId: context.tenantId,
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      OR: [
        { status: JobStatus.RUNNING },
        {
          status: JobStatus.ERROR,
          output: { path: ["phase"], equals: "BLOCKED" }
        }
      ]
    },
    orderBy: { createdAt: "asc" },
    take: 200
  });
  const expired = activeOrBlocked.find((job) => {
    if (job.status !== JobStatus.RUNNING) return false;
    const leaseExpiresAt = readJobOutput(job.output).leaseExpiresAt;
    return Boolean(leaseExpiresAt && Date.parse(leaseExpiresAt) < Date.now());
  });
  if (expired) {
    await markExpiredJob(context, expired);
    return { state: "expired" as const, jobId: expired.id };
  }

  const blockedScopeKeys = new Set(
    activeOrBlocked.flatMap((job) => {
      const scopeKey = readJobScopeKey(job.input);
      return scopeKey ? [scopeKey] : [];
    })
  );
  const queuedJobs = await prisma.automationJobRun.findMany({
    where: {
      tenantId: context.tenantId,
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.QUEUED
    },
    orderBy: { createdAt: "asc" },
    take: 200
  });
  const queued = queuedJobs.find((job) => {
    const scopeKey = readJobScopeKey(job.input);
    return !scopeKey || !blockedScopeKeys.has(scopeKey);
  });
  if (!queued) {
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

function readJobScopeKey(value: Prisma.JsonValue | null) {
  const record = readRecord(value);
  if (typeof record.scopeKey === "string" && record.scopeKey.trim()) {
    return record.scopeKey.trim();
  }
  return typeof record.moduleKey === "string" && typeof record.workflowKey === "string"
    ? `${record.moduleKey}:${record.workflowKey}`
    : null;
}

export async function getRivetDevelopmentEvidence(
  context: AuthenticatedContext,
  input: {
    jobId: string;
    feedbackId: string;
    artifactId: string;
    leaseToken: string;
  }
) {
  const job = await prisma.automationJobRun.findFirst({
    where: {
      id: input.jobId,
      tenantId: context.tenantId,
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    select: {
      id: true,
      input: true,
      output: true
    }
  });
  if (!job) throw new RivetDevelopmentJobError("The Rivet development job is not active.", 404);
  const packet = parseRivetJobInput(job.input);
  const output = readJobOutput(job.output);
  if (
    !packet ||
    !output.leaseTokenHash ||
    !safeLeaseTokenEquals(input.leaseToken, output.leaseTokenHash)
  ) {
    throw new RivetDevelopmentJobError("The Rivet development evidence lease is invalid.", 403);
  }
  if (output.leaseExpiresAt && Date.parse(output.leaseExpiresAt) < Date.now()) {
    throw new RivetDevelopmentJobError("The Rivet development evidence lease has expired.", 409);
  }
  const manifest = packet.evidenceManifests.find((item) => item.feedbackId === input.feedbackId);
  const approvedArtifact = manifest?.artifacts.find((item) => item.artifactId === input.artifactId);
  if (!manifest || !approvedArtifact) {
    throw new RivetDevelopmentJobError(
      "This artifact is not part of the approved Rivet evidence packet.",
      403
    );
  }
  const artifact = await prisma.workflowArtifact.findFirst({
    where: {
      tenantId: context.tenantId,
      id: approvedArtifact.artifactId,
      workflowKey: GARLAND_WORKFLOW_KEY,
      status: { in: ["REVIEWED", "EVIDENCE_READY"] }
    },
    include: {
      chunks: { orderBy: { chunkIndex: "asc" } }
    }
  });
  if (
    !artifact ||
    !artifact.contentHash ||
    artifact.contentHash !== approvedArtifact.contentHash ||
    artifact.contentType !== approvedArtifact.contentType ||
    artifact.chunks.length !== artifact.chunkCount
  ) {
    throw new RivetDevelopmentJobError("The approved Rivet evidence failed integrity validation.", 409);
  }
  artifact.chunks.forEach((chunk, index) => {
    if (
      chunk.chunkIndex !== index ||
      chunk.contentHash !== hashBytes(chunk.bytes)
    ) {
      throw new RivetDevelopmentJobError("The approved Rivet evidence is incomplete.", 409);
    }
  });
  const sourceBytes = Buffer.concat(artifact.chunks.map((chunk) => Buffer.from(chunk.bytes)));
  if (
    sourceBytes.byteLength !== artifact.sizeBytes ||
    hashBytes(sourceBytes) !== artifact.contentHash
  ) {
    throw new RivetDevelopmentJobError("The approved Rivet evidence does not match its stored hash.", 409);
  }

  let bytes: Uint8Array = new Uint8Array(sourceBytes);
  let contentType = artifact.contentType;
  if (artifact.contentType === "application/pdf" && approvedArtifact.pageNumbers.length > 0) {
    bytes = await selectPdfEvidencePages(bytes, approvedArtifact.pageNumbers);
    contentType = "application/pdf";
  }
  const contentHash = hashBytes(bytes);
  const extension = contentType === "application/pdf"
    ? "pdf"
    : contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : "jpg";
  const fileName = `feedback-${safeFilePart(input.feedbackId)}-${approvedArtifact.kind.toLowerCase()}.${extension}`;

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "assistant.rivet_development.read_evidence",
      entityType: "AutomationJobRun",
      entityId: job.id,
      after: {
        feedbackId: input.feedbackId,
        artifactId: input.artifactId,
        kind: approvedArtifact.kind,
        pageNumbers: approvedArtifact.pageNumbers,
        contentHash
      } satisfies Prisma.InputJsonValue
    }
  });
  return {
    bytes,
    contentType,
    contentHash,
    fileName
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
  const version = record.version === 2 ? 2 : record.version === 1 ? 1 : null;
  const sourceFeedback = Array.isArray(record.sourceFeedback)
    ? record.sourceFeedback.map(readRecord).filter((item) => typeof item.id === "string")
    : [];
  if (
    version === null ||
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
    version,
    suggestionId: record.suggestionId,
    approvedByUserId: record.approvedByUserId,
    moduleKey: record.moduleKey,
    workflowKey: record.workflowKey,
    issueKey: record.issueKey,
    scopeKey: typeof record.scopeKey === "string"
      ? record.scopeKey
      : `${record.moduleKey}:${record.workflowKey}`,
    title: record.title,
    summary: typeof record.summary === "string" ? record.summary : "",
    rationale: typeof record.rationale === "string" ? record.rationale : "",
    approvalComments: typeof record.approvalComments === "string"
      ? normalizeText(record.approvalComments, 4000)
      : null,
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
    evidenceManifests: parseRivetEvidenceManifests(record.evidenceManifests),
    allowedActions: normalizeStringArray(record.allowedActions, 20, 100),
    forbiddenActions: normalizeStringArray(record.forbiddenActions, 20, 100)
  };
}

function parseRivetEvidenceManifests(value: unknown): RivetEvidenceManifest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const record = readRecord(candidate);
    if (
      typeof record.feedbackId !== "string" ||
      typeof record.issueType !== "string"
    ) return [];
    const structured = readRecord(record.structuredFeedback);
    const review = readRecord(record.reviewOrder);
    const reviewOrder =
      typeof review.id === "string" &&
      typeof review.runId === "string" &&
      typeof review.psNumber === "string" &&
      typeof review.srNumber === "string"
        ? {
            id: review.id,
            runId: review.runId,
            psNumber: review.psNumber,
            srNumber: review.srNumber,
            pageNumbers: normalizeEvidencePageNumbers(review.pageNumbers),
            pdfOrder: (review.pdfOrder ?? null) as Prisma.JsonValue,
            review: (review.review ?? null) as Prisma.JsonValue
          }
        : null;
    const artifacts = Array.isArray(record.artifacts)
      ? record.artifacts.flatMap((artifactCandidate) => {
          const artifact = readRecord(artifactCandidate);
          if (
            typeof artifact.artifactId !== "string" ||
            (artifact.kind !== "SOURCE_PDF" && artifact.kind !== "REVIEWER_ATTACHMENT") ||
            typeof artifact.contentType !== "string" ||
            typeof artifact.sizeBytes !== "number" ||
            typeof artifact.contentHash !== "string" ||
            typeof artifact.downloadPath !== "string"
          ) return [];
          return [{
            artifactId: artifact.artifactId,
            kind: artifact.kind as RivetEvidenceManifest["artifacts"][number]["kind"],
            contentType: artifact.contentType,
            sizeBytes: artifact.sizeBytes,
            contentHash: artifact.contentHash,
            pageNumbers: normalizeEvidencePageNumbers(artifact.pageNumbers),
            downloadPath: artifact.downloadPath
          }];
        })
      : [];
    const evidenceStatus =
      record.evidenceStatus === "READY" ||
      record.evidenceStatus === "NOT_REQUIRED" ||
      record.evidenceStatus === "MISSING"
        ? record.evidenceStatus
        : "MISSING";
    return [{
      feedbackId: record.feedbackId,
      subjectId: typeof record.subjectId === "string" ? record.subjectId : null,
      issueType: record.issueType,
      evidenceRequired: record.evidenceRequired === true,
      evidenceStatus,
      structuredFeedback: {
        affectedField: readBoundedString(structured.affectedField, 200),
        actualValue: readBoundedString(structured.actualValue, 4000),
        expectedValue: readBoundedString(structured.expectedValue, 4000)
      },
      reviewOrder,
      artifacts
    }];
  });
}

function readJobOutput(value: Prisma.JsonValue | null): RivetJobOutput {
  const record = readRecord(value);
  return {
    phase: typeof record.phase === "string" ? record.phase : undefined,
    attempt: typeof record.attempt === "number" ? record.attempt : undefined,
    blockedByJobId: typeof record.blockedByJobId === "string" ? record.blockedByJobId : undefined,
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

async function selectPdfEvidencePages(bytes: Uint8Array, pageNumbers: number[]) {
  try {
    const source = await PDFDocument.load(bytes);
    const indexes = [...new Set(pageNumbers)]
      .map((pageNumber) => pageNumber - 1)
      .filter((index) => index >= 0 && index < source.getPageCount());
    if (indexes.length === 0) {
      throw new RivetDevelopmentJobError(
        "The approved Garland evidence page numbers do not exist in the source PDF.",
        409
      );
    }
    const selected = await PDFDocument.create();
    const pages = await selected.copyPages(source, indexes);
    pages.forEach((page) => selected.addPage(page));
    return selected.save();
  } catch (error) {
    if (error instanceof RivetDevelopmentJobError) throw error;
    throw new RivetDevelopmentJobError("The approved Garland PDF evidence could not be prepared.", 409);
  }
}

function normalizeEvidencePageNumbers(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is number =>
        typeof item === "number" &&
        Number.isInteger(item) &&
        item > 0 &&
        item <= 10_000
      ))].slice(0, 20)
    : [];
}

function readBoundedString(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength) || null
    : null;
}

function hashBytes(value: Uint8Array) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "evidence";
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
