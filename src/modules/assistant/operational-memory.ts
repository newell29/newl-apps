import { JobStatus, ModuleKey, PlatformRole, Prisma } from "@prisma/client";

import { groupDevelopmentFeedback } from "@/modules/assistant/development-issue-grouping";
import { GARLAND_WORKFLOW_KEY } from "@/modules/assistant/garland-artifacts";
import {
  createRivetDevelopmentJob,
  RIVET_DEVELOPMENT_JOB_TYPE,
  summarizeRivetDevelopmentJob
} from "@/modules/assistant/rivet-development-jobs";
import type { GarlandTeamshipOrderReview } from "@/modules/shipment-documents/teamship-review-types";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

const FEEDBACK_STATUSES = new Set(["REPORTED", "INVESTIGATING", "CONFIRMED", "REJECTED", "RESOLVED"]);
const SUGGESTION_STATUSES = new Set(["AWAITING_APPROVAL", "APPROVED", "REJECTED"]);

export class OperationalMemoryError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "OperationalMemoryError";
    this.status = status;
  }
}

export async function explainGarlandCheck(tenantId: string, reference: string) {
  const normalized = normalizeGarlandReference(reference);
  const order = await prisma.teamshipReviewOrder.findFirst({
    where: {
      tenantId,
      ...(normalized.startsWith("PS") ? { psNumber: normalized } : { srNumber: normalized })
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      runId: true,
      psNumber: true,
      srNumber: true,
      status: true,
      mismatchCount: true,
      review: true,
      createdAt: true,
      run: { select: { documentLabel: true, shipmentDate: true, sourcePdfFileName: true } }
    }
  });
  if (!order) {
    throw new OperationalMemoryError(`No saved Garland check was found for ${normalized}.`, 404);
  }

  const review = parseOrderReview(order.review);
  const issues = review.fields
    .filter((field) => field.status !== "MATCH" && field.status !== "INFO")
    .map((field) => ({
      key: field.key,
      label: field.label,
      status: field.status,
      pdfValue: field.pdfValue,
      teamshipValue: field.teamshipValue,
      message: field.message
    }));
  const lessons = await prisma.approvedOperationalLesson.findMany({
    where: {
      tenantId,
      workflowKey: GARLAND_WORKFLOW_KEY,
      status: "ACTIVE",
      OR: [
        { subjectId: null },
        { subjectId: order.psNumber },
        { subjectId: order.srNumber }
      ]
    },
    orderBy: { approvedAt: "desc" },
    take: 20,
    select: { id: true, title: true, ruleText: true, subjectType: true, subjectId: true, approvedAt: true }
  });

  return {
    reviewOrderId: order.id,
    reviewRunId: order.runId,
    psNumber: order.psNumber,
    srNumber: order.srNumber,
    status: order.status,
    mismatchCount: order.mismatchCount,
    checkedAt: order.createdAt,
    document: order.run,
    explanation:
      issues.length === 0
        ? `${order.psNumber} / ${order.srNumber} passed the saved deterministic Garland comparison.`
        : `${order.psNumber} / ${order.srNumber} ${describeStatus(order.status)} because ${issues
            .map((issue) => `${issue.label}: ${issue.message}`)
            .join("; ")}`,
    issues,
    approvedLessons: lessons
  };
}

export async function createOperationalFeedback(
  context: AuthenticatedContext,
  input: {
    workflowKey?: string;
    subjectType: string;
    subjectId?: string | null;
    teamshipReviewRunId?: string | null;
    teamshipReviewOrderId?: string | null;
    artifactId?: string | null;
    reporterStatement: string;
    expectedOutcome?: string | null;
    observedOutcome?: string | null;
    classification?: string | null;
    evidence?: Prisma.InputJsonValue;
  }
) {
  const statement = normalizeRequiredText(input.reporterStatement, "reporterStatement", 4000);
  const workflowKey = normalizeRequiredText(input.workflowKey || GARLAND_WORKFLOW_KEY, "workflowKey", 100);
  const subjectType = normalizeRequiredText(input.subjectType, "subjectType", 100);
  const subjectId = normalizeOptionalText(input.subjectId, 200);

  await validateFeedbackReferences(context.tenantId, input);

  return prisma.$transaction(async (tx) => {
    const feedback = await tx.operationalFeedback.create({
      data: {
        tenantId: context.tenantId,
        moduleKey: ModuleKey.SHIPMENT_DOCUMENTS,
        workflowKey,
        subjectType,
        subjectId,
        teamshipReviewRunId: normalizeOptionalText(input.teamshipReviewRunId, 100),
        teamshipReviewOrderId: normalizeOptionalText(input.teamshipReviewOrderId, 100),
        artifactId: normalizeOptionalText(input.artifactId, 100),
        reporterUserId: context.userId,
        reporterStatement: statement,
        expectedOutcome: normalizeOptionalText(input.expectedOutcome, 100),
        observedOutcome: normalizeOptionalText(input.observedOutcome, 100),
        classification: normalizeClassification(input.classification),
        evidence: input.evidence ?? Prisma.JsonNull
      },
      select: feedbackSelect
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.operational_feedback.create",
        entityType: "OperationalFeedback",
        entityId: feedback.id,
        after: {
          workflowKey,
          subjectType,
          subjectId,
          classification: feedback.classification,
          status: feedback.status
        } satisfies Prisma.InputJsonValue
      }
    });
    return feedback;
  });
}

export async function listOperationalFeedback(
  context: AuthenticatedContext,
  input: { status?: string | null; limit?: number }
) {
  const status = input.status?.trim().toUpperCase();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  return prisma.operationalFeedback.findMany({
    where: {
      tenantId: context.tenantId,
      ...(status && status !== "ALL" ? { status } : {}),
      ...(context.role === PlatformRole.ADMIN ? {} : { reporterUserId: context.userId })
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: feedbackSelect
  });
}

export async function reviewOperationalFeedback(
  context: AuthenticatedContext,
  feedbackId: string,
  input: { status: string; resolutionNotes?: string | null }
) {
  const status = input.status.trim().toUpperCase();
  if (!FEEDBACK_STATUSES.has(status)) {
    throw new OperationalMemoryError("Unsupported feedback status.");
  }
  const existing = await prisma.operationalFeedback.findFirst({
    where: { tenantId: context.tenantId, id: feedbackId },
    select: { id: true, status: true, resolutionNotes: true }
  });
  if (!existing) throw new OperationalMemoryError("Feedback was not found.", 404);

  const resolutionNotes = normalizeOptionalText(input.resolutionNotes, 4000);
  return prisma.$transaction(async (tx) => {
    const feedback = await tx.operationalFeedback.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: feedbackId } },
      data: {
        status,
        resolutionNotes,
        reviewedByUserId: context.userId,
        reviewedAt: new Date()
      },
      select: feedbackSelect
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.operational_feedback.review",
        entityType: "OperationalFeedback",
        entityId: feedbackId,
        before: {
          status: existing.status,
          resolutionNotes: existing.resolutionNotes
        } satisfies Prisma.InputJsonValue,
        after: { status, resolutionNotes } satisfies Prisma.InputJsonValue
      }
    });
    return feedback;
  });
}

export async function approveFeedbackAsLesson(
  context: AuthenticatedContext,
  feedbackId: string,
  input: { title: string; ruleText: string; confidence?: number }
) {
  const feedback = await prisma.operationalFeedback.findFirst({
    where: { tenantId: context.tenantId, id: feedbackId },
    select: {
      id: true,
      moduleKey: true,
      workflowKey: true,
      subjectType: true,
      subjectId: true,
      classification: true,
      status: true
    }
  });
  if (!feedback) throw new OperationalMemoryError("Feedback was not found.", 404);
  if (!new Set(["CONFIRMED", "RESOLVED"]).has(feedback.status)) {
    throw new OperationalMemoryError("Only confirmed or resolved feedback can become an approved lesson.", 409);
  }
  const confidence = Math.min(Math.max(Math.round(input.confidence ?? 100), 1), 100);

  return prisma.$transaction(async (tx) => {
    const lesson = await tx.approvedOperationalLesson.upsert({
      where: {
        tenantId_sourceFeedbackId: { tenantId: context.tenantId, sourceFeedbackId: feedback.id }
      },
      create: {
        tenantId: context.tenantId,
        moduleKey: feedback.moduleKey,
        workflowKey: feedback.workflowKey,
        subjectType: feedback.subjectType,
        subjectId: feedback.subjectId,
        classification: feedback.classification,
        title: normalizeRequiredText(input.title, "title", 240),
        ruleText: normalizeRequiredText(input.ruleText, "ruleText", 4000),
        confidence,
        sourceFeedbackId: feedback.id,
        approvedByUserId: context.userId
      },
      update: {
        subjectType: feedback.subjectType,
        subjectId: feedback.subjectId,
        classification: feedback.classification,
        title: normalizeRequiredText(input.title, "title", 240),
        ruleText: normalizeRequiredText(input.ruleText, "ruleText", 4000),
        confidence,
        status: "ACTIVE",
        approvedByUserId: context.userId,
        approvedAt: new Date(),
        retiredByUserId: null,
        retiredAt: null
      }
    });
    await tx.operationalFeedback.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: feedback.id } },
      data: {
        status: "RESOLVED",
        reviewedByUserId: context.userId,
        reviewedAt: new Date(),
        resolutionNotes: "Promoted to an admin-approved operational lesson."
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.operational_lesson.approve",
        entityType: "ApprovedOperationalLesson",
        entityId: lesson.id,
        before: { feedbackStatus: feedback.status } satisfies Prisma.InputJsonValue,
        after: {
          sourceFeedbackId: feedback.id,
          workflowKey: feedback.workflowKey,
          subjectType: feedback.subjectType,
          subjectId: feedback.subjectId,
          confidence,
          status: "ACTIVE"
        } satisfies Prisma.InputJsonValue
      }
    });
    return lesson;
  });
}

export async function generateDevelopmentSuggestions(context: AuthenticatedContext) {
  const feedback = await prisma.operationalFeedback.findMany({
    where: {
      tenantId: context.tenantId,
      status: { in: ["REPORTED", "INVESTIGATING", "CONFIRMED"] }
    },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: {
      id: true,
      moduleKey: true,
      workflowKey: true,
      classification: true,
      subjectType: true,
      subjectId: true,
      reporterStatement: true,
      expectedOutcome: true,
      observedOutcome: true
    }
  });
  const existing = await prisma.developmentSuggestion.findMany({
    where: { tenantId: context.tenantId, status: { in: ["AWAITING_APPROVAL", "APPROVED"] } },
    select: {
      id: true,
      moduleKey: true,
      workflowKey: true,
      title: true,
      summary: true,
      rationale: true,
      status: true,
      riskLevel: true,
      sourceFeedbackIds: true,
      feedbackCount: true,
      proposedScope: true
    }
  });
  const alreadyQueued = new Set(existing.flatMap((item) => jsonStringArray(item.sourceFeedbackIds)));
  const groups = groupDevelopmentFeedback(feedback.filter((item) => !alreadyQueued.has(item.id)));

  const created = [];
  for (const group of groups) {
    const items = group.items;
    const first = items[0];
    const matchingAwaiting = existing.find((item) =>
      item.status === "AWAITING_APPROVAL" &&
      item.moduleKey === first.moduleKey &&
      item.workflowKey === first.workflowKey &&
      readIssueKey(item.proposedScope) === group.issueKey
    );
    created.push(await prisma.$transaction(async (tx) => {
      const sourceFeedbackIds = [
        ...(matchingAwaiting ? jsonStringArray(matchingAwaiting.sourceFeedbackIds) : []),
        ...items.map((item) => item.id)
      ];
      const feedbackCount = sourceFeedbackIds.length;
      const summary = joinDistinctStatements([
        ...(matchingAwaiting ? matchingAwaiting.summary.split(" | ") : []),
        ...items.map((item) => item.reporterStatement)
      ]);
      const suggestion = matchingAwaiting
        ? await tx.developmentSuggestion.update({
            where: {
              tenantId_id: {
                tenantId: context.tenantId,
                id: matchingAwaiting.id
              }
            },
            data: {
              summary,
              rationale: `${feedbackCount} similar employee feedback item${feedbackCount === 1 ? "" : "s"} should be reviewed together before development begins.`,
              sourceFeedbackIds,
              feedbackCount
            }
          })
        : await tx.developmentSuggestion.create({
            data: {
              tenantId: context.tenantId,
              moduleKey: first.moduleKey as ModuleKey,
              workflowKey: first.workflowKey,
              title: group.title,
              summary,
              rationale: `${feedbackCount} similar employee feedback item${feedbackCount === 1 ? "" : "s"} should be reviewed together before development begins.`,
              riskLevel: first.workflowKey === GARLAND_WORKFLOW_KEY ? "HIGH" : "MEDIUM",
              sourceFeedbackIds,
              feedbackCount,
              proposedScope: buildDevelopmentScope(group.issueKey)
            }
          });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: matchingAwaiting
            ? "assistant.development_suggestion.merge_similar"
            : "assistant.development_suggestion.create",
          entityType: "DevelopmentSuggestion",
          entityId: suggestion.id,
          after: {
            workflowKey: first.workflowKey,
            classification: first.classification,
            issueKey: group.issueKey,
            status: "AWAITING_APPROVAL",
            riskLevel: first.workflowKey === GARLAND_WORKFLOW_KEY ? "HIGH" : "MEDIUM",
            feedbackCount,
            sourceFeedbackIds
          } satisfies Prisma.InputJsonValue
        }
      });
      return suggestion;
    }));
  }
  return created;
}

export async function listDevelopmentSuggestions(context: AuthenticatedContext, limit = 100) {
  const suggestions = await prisma.developmentSuggestion.findMany({
    where: { tenantId: context.tenantId },
    orderBy: { generatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200)
  });
  const jobIds = suggestions
    .map((item) => item.developmentThreadId)
    .filter((id): id is string => Boolean(id));
  const jobs = jobIds.length === 0
    ? []
    : await prisma.automationJobRun.findMany({
        where: {
          tenantId: context.tenantId,
          id: { in: jobIds },
          jobType: RIVET_DEVELOPMENT_JOB_TYPE
        },
        select: {
          id: true,
          status: true,
          output: true,
          errorMessage: true
        }
      });
  const jobsById = new Map(jobs.map((job) => [job.id, summarizeRivetDevelopmentJob(job)]));
  return suggestions.map((suggestion) => ({
    ...suggestion,
    developmentJob: suggestion.developmentThreadId
      ? jobsById.get(suggestion.developmentThreadId) ?? null
      : null
  }));
}

export async function decideDevelopmentSuggestion(
  context: AuthenticatedContext,
  suggestionId: string,
  input: { status: string; decisionNotes?: string | null }
) {
  const status = input.status.trim().toUpperCase();
  if (!SUGGESTION_STATUSES.has(status) || status === "AWAITING_APPROVAL") {
    throw new OperationalMemoryError("A suggestion can only be approved or rejected.");
  }
  const existing = await prisma.developmentSuggestion.findFirst({
    where: { tenantId: context.tenantId, id: suggestionId },
    select: {
      id: true,
      moduleKey: true,
      workflowKey: true,
      title: true,
      summary: true,
      rationale: true,
      status: true,
      riskLevel: true,
      sourceFeedbackIds: true,
      proposedScope: true,
      developmentThreadId: true
    }
  });
  if (!existing) throw new OperationalMemoryError("Development suggestion was not found.", 404);
  if (existing.status !== "AWAITING_APPROVAL") {
    throw new OperationalMemoryError("This development suggestion already has a decision.", 409);
  }

  const decisionNotes = normalizeOptionalText(input.decisionNotes, 4000);
  const sourceFeedback = status === "APPROVED"
    ? await prisma.operationalFeedback.findMany({
        where: {
          tenantId: context.tenantId,
          id: { in: jsonStringArray(existing.sourceFeedbackIds) }
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          moduleKey: true,
          workflowKey: true,
          classification: true,
          subjectType: true,
          subjectId: true,
          reporterStatement: true,
          expectedOutcome: true,
          observedOutcome: true
        }
      })
    : [];
  return prisma.$transaction(async (tx) => {
    const job = status === "APPROVED"
      ? await createRivetDevelopmentJob(tx, context, existing, sourceFeedback)
      : null;
    const suggestion = await tx.developmentSuggestion.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: suggestionId } },
      data: {
        status,
        decisionByUserId: context.userId,
        decisionAt: new Date(),
        decisionNotes,
        developmentThreadId: job?.id
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.development_suggestion.decide",
        entityType: "DevelopmentSuggestion",
        entityId: suggestionId,
        before: { status: existing.status } satisfies Prisma.InputJsonValue,
        after: {
          status,
          decisionNotes,
          developmentJobId: job?.id ?? null,
          developmentStarted: Boolean(job)
        } satisfies Prisma.InputJsonValue
      }
    });
    return {
      ...suggestion,
      developmentJob: job
        ? summarizeRivetDevelopmentJob({
            id: job.id,
            status: job.status,
            output: job.output,
            errorMessage: job.errorMessage
          })
        : null
    };
  });
}

export async function retryRivetDevelopmentSuggestion(
  context: AuthenticatedContext,
  suggestionId: string
) {
  const existing = await prisma.developmentSuggestion.findFirst({
    where: {
      tenantId: context.tenantId,
      id: suggestionId,
      status: "APPROVED"
    },
    select: {
      id: true,
      moduleKey: true,
      workflowKey: true,
      title: true,
      summary: true,
      rationale: true,
      status: true,
      riskLevel: true,
      sourceFeedbackIds: true,
      proposedScope: true,
      developmentThreadId: true
    }
  });
  if (!existing?.developmentThreadId) {
    throw new OperationalMemoryError("This suggestion does not have a failed Rivet job to retry.", 409);
  }
  const failedJob = await prisma.automationJobRun.findFirst({
    where: {
      id: existing.developmentThreadId,
      tenantId: context.tenantId,
      status: JobStatus.ERROR
    },
    select: { id: true }
  });
  if (!failedJob) {
    throw new OperationalMemoryError("Only a failed Rivet job can be retried.", 409);
  }
  const sourceFeedback = await prisma.operationalFeedback.findMany({
    where: {
      tenantId: context.tenantId,
      id: { in: jsonStringArray(existing.sourceFeedbackIds) }
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      moduleKey: true,
      workflowKey: true,
      classification: true,
      subjectType: true,
      subjectId: true,
      reporterStatement: true,
      expectedOutcome: true,
      observedOutcome: true
    }
  });

  return prisma.$transaction(async (tx) => {
    const job = await createRivetDevelopmentJob(tx, context, existing, sourceFeedback);
    const suggestion = await tx.developmentSuggestion.update({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: suggestionId
        }
      },
      data: {
        developmentThreadId: job.id,
        pullRequestUrl: null
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.rivet_development.retry",
        entityType: "DevelopmentSuggestion",
        entityId: suggestionId,
        before: { developmentJobId: failedJob.id, status: "FAILED" },
        after: { developmentJobId: job.id, status: "QUEUED" }
      }
    });
    return {
      ...suggestion,
      developmentJob: summarizeRivetDevelopmentJob({
        id: job.id,
        status: job.status,
        output: job.output,
        errorMessage: job.errorMessage
      })
    };
  });
}

const feedbackSelect = {
  id: true,
  moduleKey: true,
  workflowKey: true,
  subjectType: true,
  subjectId: true,
  teamshipReviewRunId: true,
  teamshipReviewOrderId: true,
  artifactId: true,
  reporterUserId: true,
  reporterStatement: true,
  expectedOutcome: true,
  observedOutcome: true,
  classification: true,
  status: true,
  resolutionNotes: true,
  reviewedByUserId: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.OperationalFeedbackSelect;

async function validateFeedbackReferences(
  tenantId: string,
  input: { teamshipReviewRunId?: string | null; teamshipReviewOrderId?: string | null; artifactId?: string | null }
) {
  if (input.teamshipReviewRunId) {
    const count = await prisma.teamshipReviewRun.count({
      where: { tenantId, id: input.teamshipReviewRunId, deletedAt: null }
    });
    if (!count) throw new OperationalMemoryError("The referenced Garland review run was not found.", 404);
  }
  if (input.teamshipReviewOrderId) {
    const count = await prisma.teamshipReviewOrder.count({ where: { tenantId, id: input.teamshipReviewOrderId } });
    if (!count) throw new OperationalMemoryError("The referenced Garland review order was not found.", 404);
  }
  if (input.artifactId) {
    const count = await prisma.workflowArtifact.count({ where: { tenantId, id: input.artifactId } });
    if (!count) throw new OperationalMemoryError("The referenced workflow artifact was not found.", 404);
  }
}

function parseOrderReview(value: Prisma.JsonValue): GarlandTeamshipOrderReview {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.fields)) {
    throw new OperationalMemoryError("The saved Garland review is not readable.", 500);
  }
  return value as unknown as GarlandTeamshipOrderReview;
}

function normalizeGarlandReference(value: string) {
  const match = value.trim().toUpperCase().match(/\b(?:PS\d{6}|SR\d{5,8})\b/);
  if (!match) throw new OperationalMemoryError("Provide a Garland PS or SR number.");
  return match[0];
}

function normalizeRequiredText(value: string, field: string, maxLength: number) {
  const text = value?.trim();
  if (!text || text.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new OperationalMemoryError(`${field} must be between 1 and ${maxLength} printable characters.`);
  }
  return text;
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number) {
  const text = value?.trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeClassification(value?: string | null) {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 80);
  return normalized || "UNCLASSIFIED";
}

function jsonStringArray(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readIssueKey(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const issueKey = value.issueKey;
  return typeof issueKey === "string" && issueKey.trim() ? issueKey.trim() : null;
}

function buildDevelopmentScope(issueKey: string): Prisma.InputJsonValue {
  return {
    issueKey,
    requiresHumanApproval: true,
    approvalStartsDevelopment: true,
    developmentMode: "RIVET_LOCAL_CODEX_REVIEWED_PR",
    allowedAutomaticActions: [
      "READ_REQUIRED_CONTEXT",
      "EDIT_ISOLATED_BRANCH",
      "ADD_REGRESSION_TESTS",
      "UPDATE_DOCUMENTATION",
      "COMMIT",
      "PUSH_FEATURE_BRANCH",
      "OPEN_PULL_REQUEST"
    ],
    forbiddenAutomaticActions: [
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
}

function joinDistinctStatements(values: string[]) {
  const seen = new Set<string>();
  const statements = [];
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    statements.push(normalized);
  }
  return statements.join(" | ").slice(0, 4000);
}

function describeStatus(status: string) {
  if (status === "FAIL") return "failed";
  if (status === "MISSING_TEAMSHIP") return "could not find a Teamship order";
  if (status === "PENDING_TEAMSHIP") return "is still pending in Teamship";
  return status.toLowerCase().replace(/_/g, " ");
}
