import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  teamshipReviewOrder: { findFirst: vi.fn(), count: vi.fn() },
  teamshipReviewRun: { count: vi.fn() },
  workflowArtifact: { count: vi.fn() },
  approvedOperationalLesson: { findMany: vi.fn(), upsert: vi.fn() },
  operationalFeedback: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn()
  },
  developmentSuggestion: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  automationJobRun: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import {
  approveFeedbackAsLesson,
  createOperationalFeedback,
  decideDevelopmentSuggestion,
  explainGarlandCheck,
  generateDevelopmentSuggestions,
  retryRivetDevelopmentSuggestion,
  reviewOperationalFeedback
} from "@/modules/assistant/operational-memory";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context: AuthenticatedContext = {
  tenantId: "tenant-1",
  tenantSlug: "newl",
  tenantName: "Newl",
  userId: "user-1",
  userEmail: "employee@newl.ca",
  userName: "Employee",
  role: "OPERATIONS"
};

describe("operational feedback and approved memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.teamshipReviewOrder.count.mockResolvedValue(1);
    prismaMock.teamshipReviewRun.count.mockResolvedValue(1);
    prismaMock.workflowArtifact.count.mockResolvedValue(1);
    prismaMock.approvedOperationalLesson.findMany.mockResolvedValue([]);
    prismaMock.automationJobRun.findMany.mockResolvedValue([]);
    prismaMock.automationJobRun.create.mockResolvedValue({
      id: "rivet-job-1",
      status: "QUEUED",
      input: {},
      output: { phase: "QUEUED", attempt: 0 },
      errorMessage: null
    });
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
  });

  it("explains the latest tenant-scoped Garland result and keeps approved lessons separate", async () => {
    prismaMock.teamshipReviewOrder.findFirst.mockResolvedValue({
      id: "order-1",
      runId: "run-1",
      psNumber: "PS123456",
      srNumber: "SR812345",
      status: "FAIL",
      mismatchCount: 1,
      createdAt: new Date("2026-07-21T12:00:00Z"),
      run: { documentLabel: "July 21", shipmentDate: new Date("2026-07-21"), sourcePdfFileName: "orders.pdf" },
      review: {
        fields: [
          { key: "carrier", label: "Carrier", status: "DISCREPANCY", pdfValue: "MIDLAND", teamshipValue: "SPEEDY", message: "Carrier differs." }
        ]
      }
    });
    prismaMock.approvedOperationalLesson.findMany.mockResolvedValue([
      { id: "lesson-1", title: "Carrier aliases", ruleText: "Use the approved carrier alias table.", approvedAt: new Date() }
    ]);

    const result = await explainGarlandCheck("tenant-1", "Why did PS123456 fail?");

    expect(prismaMock.teamshipReviewOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-1", psNumber: "PS123456" } })
    );
    expect(result.explanation).toContain("Carrier differs");
    expect(result.approvedLessons).toHaveLength(1);
  });

  it("stores employee feedback as REPORTED evidence without creating a lesson", async () => {
    prismaMock.operationalFeedback.create.mockResolvedValue({ id: "feedback-1", status: "REPORTED" });

    await createOperationalFeedback(context, {
      subjectType: "GARLAND_CHECK",
      subjectId: "PS123456",
      reporterStatement: "This should have passed.",
      expectedOutcome: "PASS",
      observedOutcome: "FAIL"
    });

    expect(prismaMock.operationalFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          reporterUserId: "user-1",
          expectedOutcome: "PASS",
          observedOutcome: "FAIL"
        })
      })
    );
    expect(prismaMock.operationalFeedback.create.mock.calls[0]?.[0]?.data).not.toHaveProperty("status");
    expect(prismaMock.approvedOperationalLesson.upsert).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "assistant.operational_feedback.create" }) })
    );
  });

  it("refuses to promote unconfirmed feedback into Nemo memory", async () => {
    prismaMock.operationalFeedback.findFirst.mockResolvedValue({
      id: "feedback-1",
      moduleKey: "SHIPMENT_DOCUMENTS",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      subjectType: "GARLAND_CHECK",
      subjectId: "PS123456",
      classification: "CHECK_RESULT",
      status: "REPORTED"
    });

    await expect(
      approveFeedbackAsLesson(context, "feedback-1", { title: "Rule", ruleText: "Approved rule" })
    ).rejects.toThrow("Only confirmed or resolved feedback");
  });

  it("audits admin review and approved-memory promotion", async () => {
    prismaMock.operationalFeedback.findFirst
      .mockResolvedValueOnce({ id: "feedback-1", status: "REPORTED", resolutionNotes: null })
      .mockResolvedValueOnce({
        id: "feedback-1",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        subjectType: "GARLAND_CHECK",
        subjectId: "PS123456",
        classification: "CHECK_RESULT",
        status: "CONFIRMED"
      });
    prismaMock.operationalFeedback.update.mockResolvedValue({ id: "feedback-1", status: "CONFIRMED" });
    prismaMock.approvedOperationalLesson.upsert.mockResolvedValue({ id: "lesson-1", status: "ACTIVE" });

    await reviewOperationalFeedback(context, "feedback-1", {
      status: "CONFIRMED",
      resolutionNotes: "Verified against the saved check."
    });
    await approveFeedbackAsLesson(context, "feedback-1", {
      title: "Confirmed Garland rule",
      ruleText: "Use the confirmed deterministic interpretation."
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "assistant.operational_feedback.review" }) })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "assistant.operational_lesson.approve" }) })
    );
  });

  it("creates focused development suggestions with a restricted Rivet scope", async () => {
    prismaMock.operationalFeedback.findMany.mockResolvedValue([
      {
        id: "feedback-1",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        reporterStatement: "This should have passed.",
        expectedOutcome: "PASS"
      }
    ]);
    prismaMock.developmentSuggestion.findMany.mockResolvedValue([]);
    prismaMock.developmentSuggestion.create.mockImplementation(async ({ data }) => ({ id: "suggestion-1", ...data }));

    const created = await generateDevelopmentSuggestions(context);

    expect(created).toHaveLength(1);
    expect(prismaMock.developmentSuggestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        proposedScope: expect.objectContaining({
          requiresHumanApproval: true,
          approvalStartsDevelopment: true,
          issueKey: expect.any(String),
          allowedAutomaticActions: expect.arrayContaining(["EDIT_ISOLATED_BRANCH", "OPEN_PULL_REQUEST"]),
          forbiddenAutomaticActions: expect.arrayContaining(["MERGE", "DEPLOY", "TEAMSHIP_WRITE", "PRINT"])
        })
      })
    });
    expect(prismaMock.developmentSuggestion.create.mock.calls[0]?.[0]?.data).not.toHaveProperty("status");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "assistant.development_suggestion.create" }) })
    );
  });

  it("merges later similar feedback into the same awaiting suggestion before approval", async () => {
    prismaMock.operationalFeedback.findMany.mockResolvedValue([
      {
        id: "feedback-2",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        subjectType: "GARLAND_CHECK",
        subjectId: "PS210492",
        reporterStatement: "Commodity should show SN because the Lot/Serial reference exists.",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL"
      }
    ]);
    prismaMock.developmentSuggestion.findMany.mockResolvedValue([
      {
        id: "suggestion-1",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        title: "Garland Lot/Serial and commodity formatting",
        summary: "The Commodity field is missing the Lot/Serial Ref.",
        rationale: "One similar employee feedback item should be reviewed together before development begins.",
        status: "AWAITING_APPROVAL",
        riskLevel: "HIGH",
        sourceFeedbackIds: ["feedback-1"],
        feedbackCount: 1,
        proposedScope: { issueKey: "GARLAND_LOT_SERIAL_COMMODITY" }
      }
    ]);
    prismaMock.developmentSuggestion.update.mockResolvedValue({
      id: "suggestion-1",
      feedbackCount: 2
    });

    const suggestions = await generateDevelopmentSuggestions(context);

    expect(suggestions).toHaveLength(1);
    expect(prismaMock.developmentSuggestion.create).not.toHaveBeenCalled();
    expect(prismaMock.developmentSuggestion.update).toHaveBeenCalledWith({
      where: {
        tenantId_id: {
          tenantId: "tenant-1",
          id: "suggestion-1"
        }
      },
      data: expect.objectContaining({
        sourceFeedbackIds: ["feedback-1", "feedback-2"],
        feedbackCount: 2,
        summary: expect.stringContaining("Commodity should show SN")
      })
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "assistant.development_suggestion.merge_similar"
        })
      })
    );
  });

  it("atomically queues a Rivet Codex job when an administrator approves a suggestion", async () => {
    prismaMock.developmentSuggestion.findFirst.mockResolvedValue({
      id: "suggestion-1",
      moduleKey: "SHIPMENT_DOCUMENTS",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      title: "Garland Special Instructions extraction",
      summary: "CHEMTREC was omitted.",
      rationale: "One similar report.",
      status: "AWAITING_APPROVAL",
      riskLevel: "HIGH",
      sourceFeedbackIds: ["feedback-1"],
      proposedScope: { issueKey: "GARLAND_SPECIAL_INSTRUCTIONS" },
      developmentThreadId: null
    });
    prismaMock.operationalFeedback.findMany.mockResolvedValue([{
      id: "feedback-1",
      moduleKey: "SHIPMENT_DOCUMENTS",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      classification: "CHECK_RESULT",
      subjectType: "GARLAND_CHECK",
      subjectId: "PS210491",
      reporterStatement: "Special Instructions omitted CHEMTREC.",
      expectedOutcome: "PASS",
      observedOutcome: "FAIL"
    }]);
    prismaMock.developmentSuggestion.update.mockResolvedValue({
      id: "suggestion-1",
      status: "APPROVED",
      developmentThreadId: "rivet-job-1"
    });

    const result = await decideDevelopmentSuggestion(context, "suggestion-1", {
      status: "APPROVED",
      decisionNotes: "Start Rivet."
    });

    expect(result).toMatchObject({ status: "APPROVED" });
    expect(prismaMock.automationJobRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          jobType: "ASSISTANT_RIVET_DEVELOPMENT",
          status: "QUEUED"
        })
      })
    );
    expect(prismaMock.developmentSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "APPROVED",
          developmentThreadId: "rivet-job-1"
        })
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "assistant.development_suggestion.decide",
          after: expect.objectContaining({
            status: "APPROVED",
            developmentJobId: "rivet-job-1",
            developmentStarted: true
          })
        })
      })
    );
  });

  it("requires a failed job before explicitly retrying Rivet", async () => {
    prismaMock.developmentSuggestion.findFirst.mockResolvedValue({
      id: "suggestion-1",
      moduleKey: "SHIPMENT_DOCUMENTS",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      title: "Garland Special Instructions extraction",
      summary: "CHEMTREC was omitted.",
      rationale: "One similar report.",
      status: "APPROVED",
      riskLevel: "HIGH",
      sourceFeedbackIds: ["feedback-1"],
      proposedScope: { issueKey: "GARLAND_SPECIAL_INSTRUCTIONS" },
      developmentThreadId: "failed-job-1"
    });
    prismaMock.automationJobRun.findFirst.mockResolvedValue({ id: "failed-job-1" });
    prismaMock.operationalFeedback.findMany.mockResolvedValue([{
      id: "feedback-1",
      moduleKey: "SHIPMENT_DOCUMENTS",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      classification: "CHECK_RESULT",
      subjectType: "GARLAND_CHECK",
      subjectId: "PS210491",
      reporterStatement: "Special Instructions omitted CHEMTREC.",
      expectedOutcome: "PASS",
      observedOutcome: "FAIL"
    }]);
    prismaMock.developmentSuggestion.update.mockResolvedValue({
      id: "suggestion-1",
      status: "APPROVED",
      developmentThreadId: "rivet-job-1"
    });

    const result = await retryRivetDevelopmentSuggestion(context, "suggestion-1");

    expect(result.developmentJob).toMatchObject({
      id: "rivet-job-1",
      status: "QUEUED",
      phase: "QUEUED"
    });
    expect(prismaMock.developmentSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          developmentThreadId: "rivet-job-1",
          pullRequestUrl: null
        }
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "assistant.rivet_development.retry"
        })
      })
    );
  });
});
