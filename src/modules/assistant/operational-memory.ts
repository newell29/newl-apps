import { JobStatus, ModuleKey, PlatformRole, Prisma } from "@prisma/client";

import {
  describeDevelopmentIssue,
  groupDevelopmentFeedback,
  isNonActionableDevelopmentFeedback,
  type DevelopmentFeedbackCandidate
} from "@/modules/assistant/development-issue-grouping";
import {
  feedbackRequiresSourceEvidence,
  feedbackUsesFieldValues,
  feedbackUsesOrderDecisions,
  isGarlandFeedbackIssueType
} from "@/modules/assistant/feedback-review-fields";
import { ensureGarlandFeedbackReviewSourceArtifact } from "@/modules/assistant/operational-feedback-evidence";
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
const FEEDBACK_OUTCOMES = new Set(["PASS", "FAIL", "MISSING", "PENDING"]);
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
  const classification = normalizeClassification(input.classification);
  const evidence = normalizeFeedbackEvidence(input.evidence, classification);

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
        expectedOutcome: normalizeFeedbackOutcome(input.expectedOutcome, "expectedOutcome"),
        observedOutcome: normalizeFeedbackOutcome(input.observedOutcome, "observedOutcome"),
        classification,
        evidence
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
  input: {
    status: string;
    resolutionNotes?: string | null;
    expectedOutcome?: string | null;
    observedOutcome?: string | null;
    classification?: string | null;
    evidence?: Prisma.InputJsonValue | null;
    teamshipReviewOrderId?: string | null;
    artifactId?: string | null;
  }
) {
  const status = input.status.trim().toUpperCase();
  if (!FEEDBACK_STATUSES.has(status)) {
    throw new OperationalMemoryError("Unsupported feedback status.");
  }
  const existing = await prisma.operationalFeedback.findFirst({
    where: { tenantId: context.tenantId, id: feedbackId },
    select: {
      id: true,
      workflowKey: true,
      subjectId: true,
      classification: true,
      status: true,
      expectedOutcome: true,
      observedOutcome: true,
      evidence: true,
      teamshipReviewRunId: true,
      teamshipReviewOrderId: true,
      artifactId: true,
      resolutionNotes: true
    }
  });
  if (!existing) throw new OperationalMemoryError("Feedback was not found.", 404);

  const resolutionNotes = normalizeOptionalText(input.resolutionNotes, 4000);
  const changes = await resolveOperationalFeedbackReviewChanges(
    context,
    existing,
    input
  );
  if (status === "CONFIRMED") {
    validateConfirmedFeedback(existing.workflowKey, changes);
  }
  return prisma.$transaction(async (tx) => {
    const feedback = await tx.operationalFeedback.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: feedbackId } },
      data: {
        status,
        expectedOutcome: changes.expectedOutcome,
        observedOutcome: changes.observedOutcome,
        classification: changes.classification,
        evidence: changes.evidence,
        teamshipReviewRunId: changes.teamshipReviewRunId,
        teamshipReviewOrderId: changes.teamshipReviewOrderId,
        artifactId: changes.artifactId,
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
          expectedOutcome: existing.expectedOutcome,
          observedOutcome: existing.observedOutcome,
          classification: existing.classification,
          teamshipReviewRunId: existing.teamshipReviewRunId,
          teamshipReviewOrderId: existing.teamshipReviewOrderId,
          artifactId: existing.artifactId,
          resolutionNotes: existing.resolutionNotes
        } satisfies Prisma.InputJsonValue,
        after: {
          status,
          expectedOutcome: changes.expectedOutcome,
          observedOutcome: changes.observedOutcome,
          classification: changes.classification,
          teamshipReviewRunId: changes.teamshipReviewRunId,
          teamshipReviewOrderId: changes.teamshipReviewOrderId,
          artifactId: changes.artifactId,
          resolutionNotes
        } satisfies Prisma.InputJsonValue
      }
    });
    return feedback;
  });
}

export async function updateOperationalFeedbackReviewFields(
  context: AuthenticatedContext,
  feedbackId: string,
  input: {
    expectedOutcome?: string | null;
    observedOutcome?: string | null;
    classification?: string | null;
    evidence?: Prisma.InputJsonValue | null;
    teamshipReviewOrderId?: string | null;
    artifactId?: string | null;
  }
) {
  const existing = await prisma.operationalFeedback.findFirst({
    where: { tenantId: context.tenantId, id: feedbackId },
    select: {
      id: true,
      workflowKey: true,
      subjectId: true,
      status: true,
      expectedOutcome: true,
      observedOutcome: true,
      classification: true,
      evidence: true,
      teamshipReviewRunId: true,
      teamshipReviewOrderId: true,
      artifactId: true
    }
  });
  if (!existing) throw new OperationalMemoryError("Feedback was not found.", 404);
  if (!new Set(["REPORTED", "INVESTIGATING"]).has(existing.status)) {
    throw new OperationalMemoryError("Only pending feedback can be corrected before review.", 409);
  }
  const changes = await resolveOperationalFeedbackReviewChanges(context, existing, input);

  return prisma.$transaction(async (tx) => {
    const feedback = await tx.operationalFeedback.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: feedbackId } },
      data: {
        expectedOutcome: changes.expectedOutcome,
        observedOutcome: changes.observedOutcome,
        classification: changes.classification,
        evidence: changes.evidence,
        teamshipReviewRunId: changes.teamshipReviewRunId,
        teamshipReviewOrderId: changes.teamshipReviewOrderId,
        artifactId: changes.artifactId
      },
      select: feedbackSelect
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.operational_feedback.correct_review_fields",
        entityType: "OperationalFeedback",
        entityId: feedbackId,
        before: {
          expectedOutcome: existing.expectedOutcome,
          observedOutcome: existing.observedOutcome,
          classification: existing.classification,
          teamshipReviewRunId: existing.teamshipReviewRunId,
          teamshipReviewOrderId: existing.teamshipReviewOrderId,
          artifactId: existing.artifactId
        } satisfies Prisma.InputJsonValue,
        after: {
          expectedOutcome: changes.expectedOutcome,
          observedOutcome: changes.observedOutcome,
          classification: changes.classification,
          teamshipReviewRunId: changes.teamshipReviewRunId,
          teamshipReviewOrderId: changes.teamshipReviewOrderId,
          artifactId: changes.artifactId
        } satisfies Prisma.InputJsonValue
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
      observedOutcome: true,
      status: true
    }
  });
  const existing = await prisma.developmentSuggestion.findMany({
    where: { tenantId: context.tenantId },
    orderBy: { generatedAt: "asc" },
    take: 500,
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
      proposedScope: true,
      generatedAt: true
    }
  });
  await reconcileAwaitingSuggestionReviewState(
    context,
    existing,
    new Map(feedback.map((item) => [item.id, item.status]))
  );
  await reconcileAwaitingSuggestionDuplicates(context, existing);

  const alreadyQueued = new Set(
    existing
      .filter((item) => ["AWAITING_APPROVAL", "APPROVED"].includes(item.status))
      .flatMap((item) => [
        ...jsonStringArray(item.sourceFeedbackIds),
        ...readFollowUpFeedbackIds(item.proposedScope)
      ])
  );
  const groups = groupDevelopmentFeedback(
    feedback.filter((item) =>
      item.status === "CONFIRMED" &&
      !alreadyQueued.has(item.id) &&
      !isNonActionableDevelopmentFeedback(item)
    )
  );

  const created = [];
  for (const group of groups) {
    const items = group.items;
    const first = items[0];
    const family = existing.filter((item) =>
      item.moduleKey === first.moduleKey &&
      item.workflowKey === first.workflowKey &&
      readSuggestionIssueKey(item) === group.issueKey
    );
    const matchingApproved = [...family].reverse().find((item) => item.status === "APPROVED");
    if (matchingApproved) {
      created.push(await attachFollowUpFeedback(context, matchingApproved, items));
      continue;
    }

    const matchingAwaiting = [...family].reverse().find((item) => item.status === "AWAITING_APPROVAL");
    const previousResolved = [...family].reverse().find((item) => item.status === "RESOLVED");
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
              proposedScope: buildDevelopmentScope(group.issueKey, previousResolved?.id)
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
  const feedbackIds = [...new Set(suggestions.flatMap((suggestion) => [
    ...jsonStringArray(suggestion.sourceFeedbackIds),
    ...readFollowUpFeedbackIds(suggestion.proposedScope)
  ]))];
  const feedback = feedbackIds.length === 0
    ? []
    : await prisma.operationalFeedback.findMany({
        where: {
          tenantId: context.tenantId,
          id: { in: feedbackIds }
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          subjectId: true,
          reporterStatement: true,
          expectedOutcome: true,
          observedOutcome: true,
          classification: true,
          evidence: true,
          teamshipReviewRunId: true,
          teamshipReviewOrderId: true,
          artifactId: true,
          status: true,
          createdAt: true
        }
      });
  const feedbackById = new Map(feedback.map((item) => [item.id, item]));
  return suggestions.map((suggestion) => ({
    ...suggestion,
    issueKey: readSuggestionIssueKey(suggestion),
    followUpFeedbackCount: readFollowUpFeedbackIds(suggestion.proposedScope).length,
    regressionOfSuggestionId: readScopeString(suggestion.proposedScope, "regressionOfSuggestionId"),
    feedbackItems: [
      ...jsonStringArray(suggestion.sourceFeedbackIds).flatMap((id) => {
        const item = feedbackById.get(id);
        return item ? [{ ...item, evidenceRole: "APPROVED_PACKET" as const }] : [];
      }),
      ...readFollowUpFeedbackIds(suggestion.proposedScope).flatMap((id) => {
        const item = feedbackById.get(id);
        return item ? [{ ...item, evidenceRole: "FOLLOW_UP" as const }] : [];
      })
    ],
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
          observedOutcome: true,
          evidence: true,
          teamshipReviewRunId: true,
          teamshipReviewOrderId: true,
          artifactId: true,
          status: true
        }
      })
    : [];
  if (
    status === "APPROVED" &&
    (
      sourceFeedback.length !== jsonStringArray(existing.sourceFeedbackIds).length ||
      sourceFeedback.some((item) => item.status !== "CONFIRMED")
    )
  ) {
    throw new OperationalMemoryError(
      "Review and confirm every source feedback item, then refresh the queue before starting Rivet.",
      409
    );
  }
  return prisma.$transaction(async (tx) => {
    const job = status === "APPROVED"
      ? await createRivetDevelopmentJob(tx, context, existing, sourceFeedback, decisionNotes)
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
          developmentQueued: Boolean(job),
          developmentPhase: job
            ? summarizeRivetDevelopmentJob({
                id: job.id,
                status: job.status,
                output: job.output,
                errorMessage: job.errorMessage
              }).phase
            : null
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
      developmentThreadId: true,
      decisionNotes: true
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
      observedOutcome: true,
      evidence: true,
      teamshipReviewRunId: true,
      teamshipReviewOrderId: true,
      artifactId: true
    }
  });

  return prisma.$transaction(async (tx) => {
    const job = await createRivetDevelopmentJob(
      tx,
      context,
      existing,
      sourceFeedback,
      existing.decisionNotes,
      { excludeJobId: failedJob.id }
    );
    await tx.automationJobRun.update({
      where: { id: failedJob.id },
      data: {
        status: JobStatus.CANCELLED,
        errorMessage: "This Rivet job was superseded by an administrator-approved retry."
      }
    });
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

export async function resolveDevelopmentSuggestion(
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
      status: true,
      title: true,
      sourceFeedbackIds: true,
      proposedScope: true,
      pullRequestUrl: true,
      developmentThreadId: true
    }
  });
  if (!existing?.developmentThreadId || !existing.pullRequestUrl) {
    throw new OperationalMemoryError("Only an approved Rivet suggestion with a pull request can be resolved.", 409);
  }
  const job = await prisma.automationJobRun.findFirst({
    where: {
      tenantId: context.tenantId,
      id: existing.developmentThreadId,
      jobType: RIVET_DEVELOPMENT_JOB_TYPE,
      status: JobStatus.SUCCESS
    },
    select: {
      id: true,
      status: true,
      output: true,
      errorMessage: true
    }
  });
  const phase = job ? summarizeRivetDevelopmentJob(job).phase : null;
  if (!job || !new Set(["READY_FOR_ALEX", "PR_OPEN"]).has(phase ?? "")) {
    throw new OperationalMemoryError("The Rivet pull request must be ready for owner review first.", 409);
  }

  const resolvedAt = new Date();
  const feedbackIds = [
    ...jsonStringArray(existing.sourceFeedbackIds),
    ...readFollowUpFeedbackIds(existing.proposedScope)
  ];
  const proposedScope = mergeDevelopmentScope(existing.proposedScope, {
    lifecycleState: "FIX_DEPLOYED",
    resolvedAt: resolvedAt.toISOString(),
    resolvedPullRequestUrl: existing.pullRequestUrl,
    followUpFeedbackIds: []
  });

  return prisma.$transaction(async (tx) => {
    const suggestion = await tx.developmentSuggestion.update({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: existing.id
        }
      },
      data: {
        status: "RESOLVED",
        proposedScope,
        decisionByUserId: context.userId,
        decisionAt: resolvedAt,
        decisionNotes: "Administrator confirmed the reviewed pull request is merged and deployed."
      }
    });
    if (feedbackIds.length > 0) {
      await tx.operationalFeedback.updateMany({
        where: {
          tenantId: context.tenantId,
          id: { in: [...new Set(feedbackIds)] },
          status: { in: ["REPORTED", "INVESTIGATING", "CONFIRMED"] }
        },
        data: {
          status: "RESOLVED",
          resolutionNotes: `Covered by deployed development suggestion ${existing.id}.`,
          reviewedByUserId: context.userId,
          reviewedAt: resolvedAt
        }
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.development_suggestion.resolve_deployed",
        entityType: "DevelopmentSuggestion",
        entityId: existing.id,
        before: { status: existing.status } satisfies Prisma.InputJsonValue,
        after: {
          status: "RESOLVED",
          pullRequestUrl: existing.pullRequestUrl,
          resolvedFeedbackCount: feedbackIds.length
        } satisfies Prisma.InputJsonValue
      }
    });
    return suggestion;
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
  evidence: true,
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

function normalizeFeedbackOutcome(value: string | null | undefined, field: string) {
  const normalized = value?.trim().toUpperCase() || null;
  if (normalized && !FEEDBACK_OUTCOMES.has(normalized)) {
    throw new OperationalMemoryError(`${field} must be PASS, FAIL, MISSING, or PENDING.`);
  }
  return normalized;
}

type OperationalFeedbackReviewRecord = {
  id: string;
  workflowKey: string;
  subjectId: string | null;
  classification: string;
  expectedOutcome: string | null;
  observedOutcome: string | null;
  evidence: Prisma.JsonValue | null;
  teamshipReviewRunId: string | null;
  teamshipReviewOrderId: string | null;
  artifactId: string | null;
};

type OperationalFeedbackReviewChanges = {
  classification: string;
  expectedOutcome: string | null;
  observedOutcome: string | null;
  evidence: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  teamshipReviewRunId: string | null;
  teamshipReviewOrderId: string | null;
  artifactId: string | null;
};

async function resolveOperationalFeedbackReviewChanges(
  context: Pick<AuthenticatedContext, "tenantId" | "userId">,
  existing: OperationalFeedbackReviewRecord,
  input: {
    classification?: string | null;
    expectedOutcome?: string | null;
    observedOutcome?: string | null;
    evidence?: Prisma.InputJsonValue | null;
    teamshipReviewOrderId?: string | null;
    artifactId?: string | null;
  }
): Promise<OperationalFeedbackReviewChanges> {
  const classification = input.classification === undefined
    ? existing.classification
    : normalizeClassification(input.classification);
  const expectedOutcome = input.expectedOutcome === undefined
    ? existing.expectedOutcome
    : normalizeFeedbackOutcome(input.expectedOutcome, "expectedOutcome");
  const observedOutcome = input.observedOutcome === undefined
    ? existing.observedOutcome
    : normalizeFeedbackOutcome(input.observedOutcome, "observedOutcome");
  const evidence = input.evidence === undefined
    ? normalizeFeedbackEvidence(existing.evidence, classification)
    : normalizeFeedbackEvidence(input.evidence, classification);
  const reviewOrderId = input.teamshipReviewOrderId === undefined
    ? existing.teamshipReviewOrderId
    : normalizeOptionalText(input.teamshipReviewOrderId, 100);
  let reviewRunId = reviewOrderId ? existing.teamshipReviewRunId : null;
  let artifactId = input.artifactId === undefined
    ? existing.artifactId
    : normalizeOptionalText(input.artifactId, 100);

  let reviewOrder: {
    id: string;
    runId: string;
    psNumber: string;
    srNumber: string;
  } | null = null;
  if (reviewOrderId) {
    reviewOrder = await prisma.teamshipReviewOrder.findFirst({
      where: {
        tenantId: context.tenantId,
        id: reviewOrderId,
        run: { deletedAt: null }
      },
      select: {
        id: true,
        runId: true,
        psNumber: true,
        srNumber: true
      }
    });
    if (!reviewOrder) {
      throw new OperationalMemoryError("The selected Garland review evidence was not found.", 404);
    }
    const subject = existing.subjectId?.trim().toUpperCase() ?? null;
    if (subject && subject !== reviewOrder.psNumber && subject !== reviewOrder.srNumber) {
      throw new OperationalMemoryError(
        "The selected Garland review does not match this feedback PS or SR number.",
        409
      );
    }
    reviewRunId = reviewOrder.runId;
  }

  let artifact: {
    id: string;
    status: string;
    teamshipReviewRunId: string | null;
    extractionSummary: Prisma.JsonValue | null;
  } | null = null;
  if (artifactId) {
    artifact = await prisma.workflowArtifact.findFirst({
      where: {
        tenantId: context.tenantId,
        id: artifactId,
        workflowKey: GARLAND_WORKFLOW_KEY,
        status: { in: ["REVIEWED", "EVIDENCE_READY"] }
      },
      select: {
        id: true,
        status: true,
        teamshipReviewRunId: true,
        extractionSummary: true
      }
    });
    if (!artifact) {
      throw new OperationalMemoryError("The selected Garland source evidence was not found.", 404);
    }
    const summary = readJsonRecord(artifact.extractionSummary);
    if (
      artifact.status === "EVIDENCE_READY" &&
      summary.purpose === "RIVET_FEEDBACK_EVIDENCE" &&
      summary.feedbackId !== existing.id
    ) {
      throw new OperationalMemoryError("The uploaded evidence belongs to different feedback.", 409);
    }
    if (
      artifact.status === "REVIEWED" &&
      reviewRunId &&
      artifact.teamshipReviewRunId !== reviewRunId
    ) {
      artifactId = null;
      artifact = null;
    }
  }

  if (reviewRunId && !artifactId) {
    const sourceArtifact = reviewOrderId
      ? await ensureGarlandFeedbackReviewSourceArtifact(context, reviewOrderId)
      : null;
    artifactId = sourceArtifact?.id ?? null;
  }

  return {
    classification,
    expectedOutcome,
    observedOutcome,
    evidence,
    teamshipReviewRunId: reviewRunId,
    teamshipReviewOrderId: reviewOrder?.id ?? reviewOrderId,
    artifactId
  };
}

function validateConfirmedFeedback(
  workflowKey: string,
  changes: OperationalFeedbackReviewChanges
) {
  if (workflowKey !== GARLAND_WORKFLOW_KEY) return;
  if (changes.classification === "CHECK_RESULT") {
    throw new OperationalMemoryError(
      "Choose a clearer issue type before confirming this legacy Garland feedback."
    );
  }
  if (feedbackUsesOrderDecisions(changes.classification)) {
    if (!changes.observedOutcome || !changes.expectedOutcome) {
      throw new OperationalMemoryError(
        "Choose both Nemo's original order decision and the correct order decision."
      );
    }
    if (changes.observedOutcome === changes.expectedOutcome) {
      throw new OperationalMemoryError(
        "The original and correct order decisions must differ for an incorrect order-decision issue."
      );
    }
  }
  if (
    feedbackRequiresSourceEvidence(changes.classification) &&
    (!changes.teamshipReviewOrderId || !changes.artifactId)
  ) {
    throw new OperationalMemoryError(
      "Link the exact saved Garland review and attach its source PDF or a supporting screenshot before confirming this field-update issue."
    );
  }
}

function normalizeFeedbackEvidence(
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
  classification: string
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (!isGarlandFeedbackIssueType(classification)) {
    return value === null || value === undefined
      ? Prisma.JsonNull
      : value as Prisma.InputJsonValue;
  }
  const record = readJsonRecord(value);
  const affectedField = normalizeOptionalText(
    typeof record.affectedField === "string" ? record.affectedField : null,
    200
  );
  const actualValue = normalizeOptionalText(
    typeof record.actualValue === "string" ? record.actualValue : null,
    4000
  );
  const expectedValue = normalizeOptionalText(
    typeof record.expectedValue === "string" ? record.expectedValue : null,
    4000
  );
  if (feedbackUsesFieldValues(classification) && !affectedField) {
    throw new OperationalMemoryError("Choose the Teamship field affected by this issue.");
  }
  if (classification === "TEAMSHIP_FIELD_UPDATE" && (!actualValue || !expectedValue)) {
    throw new OperationalMemoryError("Provide both the value Nemo wrote and the correct value.");
  }
  if (classification === "MISSING_TEAMSHIP_UPDATE" && !expectedValue) {
    throw new OperationalMemoryError("Provide the value Nemo should have written.");
  }
  if (
    classification === "TEAMSHIP_FIELD_UPDATE" &&
    actualValue &&
    expectedValue &&
    normalizeComparedFeedbackValue(actualValue) === normalizeComparedFeedbackValue(expectedValue)
  ) {
    throw new OperationalMemoryError("The value Nemo wrote and the correct value must differ.");
  }
  return {
    issueType: classification,
    affectedField,
    actualValue,
    expectedValue
  } satisfies Prisma.InputJsonValue;
}

function normalizeComparedFeedbackValue(value: string) {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

function readJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeClassification(value?: string | null) {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 80);
  return normalized || "UNCLASSIFIED";
}

function jsonStringArray(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

type DevelopmentSuggestionQueueRecord = {
  id: string;
  moduleKey: ModuleKey;
  workflowKey: string;
  title: string;
  summary: string;
  rationale: string;
  status: string;
  riskLevel: string;
  sourceFeedbackIds: Prisma.JsonValue;
  feedbackCount: number;
  proposedScope: Prisma.JsonValue | null;
  generatedAt: Date;
};

async function reconcileAwaitingSuggestionReviewState(
  context: AuthenticatedContext,
  suggestions: DevelopmentSuggestionQueueRecord[],
  feedbackStatuses: Map<string, string>
) {
  for (const suggestion of suggestions) {
    if (suggestion.status !== "AWAITING_APPROVAL") continue;
    const sourceFeedbackIds = jsonStringArray(suggestion.sourceFeedbackIds);
    const hasUnconfirmedEvidence =
      sourceFeedbackIds.length === 0 ||
      sourceFeedbackIds.some((id) => feedbackStatuses.get(id) !== "CONFIRMED");
    if (!hasUnconfirmedEvidence) continue;

    await prisma.$transaction(async (tx) => {
      await tx.developmentSuggestion.update({
        where: {
          tenantId_id: {
            tenantId: context.tenantId,
            id: suggestion.id
          }
        },
        data: {
          status: "SUPERSEDED",
          decisionByUserId: context.userId,
          decisionAt: new Date(),
          decisionNotes:
            "Superseded because its Rivet packet included feedback that had not been administrator-confirmed."
        }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "assistant.development_suggestion.supersede_unreviewed",
          entityType: "DevelopmentSuggestion",
          entityId: suggestion.id,
          before: {
            status: suggestion.status,
            sourceFeedbackIds
          } satisfies Prisma.InputJsonValue,
          after: {
            status: "SUPERSEDED",
            reason: "UNCONFIRMED_SOURCE_FEEDBACK"
          } satisfies Prisma.InputJsonValue
        }
      });
    });
    suggestion.status = "SUPERSEDED";
  }
}

async function reconcileAwaitingSuggestionDuplicates(
  context: AuthenticatedContext,
  suggestions: DevelopmentSuggestionQueueRecord[]
) {
  const families = new Map<string, DevelopmentSuggestionQueueRecord[]>();
  for (const suggestion of suggestions) {
    const familyKey = [
      suggestion.moduleKey,
      suggestion.workflowKey,
      readSuggestionIssueKey(suggestion)
    ].join(":");
    families.set(familyKey, [...(families.get(familyKey) ?? []), suggestion]);
  }

  for (const family of families.values()) {
    const canonical = [...family].reverse().find((item) => item.status === "APPROVED");
    const duplicates = family.filter((item) => item.status === "AWAITING_APPROVAL");
    if (!canonical || duplicates.length === 0) continue;

    const followUpFeedbackIds = [...new Set([
      ...readFollowUpFeedbackIds(canonical.proposedScope),
      ...duplicates.flatMap((item) => jsonStringArray(item.sourceFeedbackIds))
    ])];
    const proposedScope = mergeDevelopmentScope(canonical.proposedScope, {
      followUpFeedbackIds,
      followUpFeedbackCount: followUpFeedbackIds.length
    });

    await prisma.$transaction(async (tx) => {
      await tx.developmentSuggestion.update({
        where: {
          tenantId_id: {
            tenantId: context.tenantId,
            id: canonical.id
          }
        },
        data: { proposedScope }
      });
      for (const duplicate of duplicates) {
        await tx.developmentSuggestion.update({
          where: {
            tenantId_id: {
              tenantId: context.tenantId,
              id: duplicate.id
            }
          },
          data: {
            status: "SUPERSEDED",
            decisionByUserId: context.userId,
            decisionAt: new Date(),
            decisionNotes: `Superseded by active issue family ${canonical.id}; feedback remains attached as follow-up evidence.`
          }
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "assistant.development_suggestion.supersede_duplicate",
            entityType: "DevelopmentSuggestion",
            entityId: duplicate.id,
            before: { status: duplicate.status } satisfies Prisma.InputJsonValue,
            after: {
              status: "SUPERSEDED",
              canonicalSuggestionId: canonical.id,
              issueKey: readSuggestionIssueKey(canonical)
            } satisfies Prisma.InputJsonValue
          }
        });
        duplicate.status = "SUPERSEDED";
      }
    });
    canonical.proposedScope = proposedScope;
  }
}

async function attachFollowUpFeedback(
  context: AuthenticatedContext,
  suggestion: DevelopmentSuggestionQueueRecord,
  feedback: DevelopmentFeedbackCandidate[]
) {
  const followUpFeedbackIds = [...new Set([
    ...readFollowUpFeedbackIds(suggestion.proposedScope),
    ...feedback.map((item) => item.id)
  ])];
  const proposedScope = mergeDevelopmentScope(suggestion.proposedScope, {
    followUpFeedbackIds,
    followUpFeedbackCount: followUpFeedbackIds.length
  });
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.developmentSuggestion.update({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: suggestion.id
        }
      },
      data: { proposedScope }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.development_suggestion.attach_follow_up",
        entityType: "DevelopmentSuggestion",
        entityId: suggestion.id,
        after: {
          issueKey: readSuggestionIssueKey(suggestion),
          addedFeedbackIds: feedback.map((item) => item.id),
          followUpFeedbackCount: followUpFeedbackIds.length,
          approvedPacketChanged: false
        } satisfies Prisma.InputJsonValue
      }
    });
    return result;
  });
  suggestion.proposedScope = proposedScope;
  return updated;
}

function readIssueKey(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const issueKey = value.issueKey;
  return typeof issueKey === "string" && issueKey.trim() ? issueKey.trim() : null;
}

function readSuggestionIssueKey(
  suggestion: Pick<
    DevelopmentSuggestionQueueRecord,
    "id" | "moduleKey" | "workflowKey" | "title" | "summary" | "proposedScope"
  >
) {
  const stored = readIssueKey(suggestion.proposedScope);
  const derived = describeDevelopmentIssue({
    id: suggestion.id,
    moduleKey: suggestion.moduleKey,
    workflowKey: suggestion.workflowKey,
    classification: "CHECK_RESULT",
    reporterStatement: `${suggestion.title} ${suggestion.summary}`
  }).key;
  return stored?.startsWith("GENERIC_") && !derived.startsWith("GENERIC_")
    ? derived
    : stored ?? derived;
}

function readFollowUpFeedbackIds(value: Prisma.JsonValue | null) {
  const object = readScopeObject(value);
  return jsonStringArray(object.followUpFeedbackIds ?? []);
}

function readScopeString(value: Prisma.JsonValue | null, key: string) {
  const candidate = readScopeObject(value)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function readScopeObject(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, Prisma.JsonValue> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (candidate !== undefined) result[key] = candidate;
  }
  return result;
}

function mergeDevelopmentScope(
  value: Prisma.JsonValue | null,
  patch: Record<string, Prisma.JsonValue>
): Prisma.JsonObject {
  return {
    ...readScopeObject(value),
    ...patch
  };
}

function buildDevelopmentScope(
  issueKey: string,
  regressionOfSuggestionId?: string
): Prisma.InputJsonValue {
  return {
    issueKey,
    lifecycleState: "AWAITING_APPROVAL",
    ...(regressionOfSuggestionId
      ? {
          regressionOfSuggestionId,
          regressionDetectedAt: new Date().toISOString()
        }
      : {}),
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
