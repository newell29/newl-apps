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

  it("creates approval-only development suggestions with forbidden automatic actions", async () => {
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
          forbiddenAutomaticActions: expect.arrayContaining(["BUILD", "MERGE", "DEPLOY", "TEAMSHIP_WRITE", "PRINT"])
        })
      })
    });
    expect(prismaMock.developmentSuggestion.create.mock.calls[0]?.[0]?.data).not.toHaveProperty("status");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "assistant.development_suggestion.create" }) })
    );
  });

  it("audits development suggestion decisions without starting development", async () => {
    prismaMock.developmentSuggestion.findFirst.mockResolvedValue({
      id: "suggestion-1",
      status: "AWAITING_APPROVAL"
    });
    prismaMock.developmentSuggestion.update.mockResolvedValue({ id: "suggestion-1", status: "APPROVED" });

    const result = await decideDevelopmentSuggestion(context, "suggestion-1", {
      status: "APPROVED",
      decisionNotes: "Prepare a separate reviewed task."
    });

    expect(result).toMatchObject({ status: "APPROVED" });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "assistant.development_suggestion.decide",
          after: expect.objectContaining({ status: "APPROVED" })
        })
      })
    );
  });
});
