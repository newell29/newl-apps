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
    update: vi.fn(),
    updateMany: vi.fn()
  },
  developmentSuggestion: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn()
  },
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
  listDevelopmentSuggestions,
  resolveDevelopmentSuggestion,
  retryRivetDevelopmentSuggestion,
  reviewOperationalFeedback,
  updateOperationalFeedbackReviewFields
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
      .mockResolvedValueOnce({
        id: "feedback-1",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        status: "REPORTED",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL",
        resolutionNotes: null
      })
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

  it("lets an administrator correct pending Garland outcomes without resubmitting feedback", async () => {
    prismaMock.operationalFeedback.findFirst.mockResolvedValue({
      id: "feedback-1",
      status: "REPORTED",
      expectedOutcome: "PASS",
      observedOutcome: "PASS"
    });
    prismaMock.operationalFeedback.update.mockResolvedValue({
      id: "feedback-1",
      status: "REPORTED",
      expectedOutcome: "MISSING",
      observedOutcome: "PASS"
    });

    await updateOperationalFeedbackReviewFields(context, "feedback-1", {
      expectedOutcome: "MISSING",
      observedOutcome: "PASS"
    });

    expect(prismaMock.operationalFeedback.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-1",
            id: "feedback-1"
          }
        },
        data: {
          expectedOutcome: "MISSING",
          observedOutcome: "PASS"
        }
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "assistant.operational_feedback.correct_review_fields"
        })
      })
    );
  });

  it("blocks confirmation when a Garland check still has identical observed and expected outcomes", async () => {
    prismaMock.operationalFeedback.findFirst.mockResolvedValue({
      id: "feedback-1",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      classification: "CHECK_RESULT",
      status: "REPORTED",
      expectedOutcome: "PASS",
      observedOutcome: "PASS",
      resolutionNotes: null
    });

    await expect(
      reviewOperationalFeedback(context, "feedback-1", {
        status: "CONFIRMED",
        expectedOutcome: "PASS",
        observedOutcome: "PASS"
      })
    ).rejects.toThrow("must differ");
    expect(prismaMock.operationalFeedback.update).not.toHaveBeenCalled();
  });

  it("creates focused development suggestions with a restricted Rivet scope", async () => {
    prismaMock.operationalFeedback.findMany.mockResolvedValue([
      {
        id: "feedback-1",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        reporterStatement: "This should have passed.",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL",
        status: "CONFIRMED"
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

  it("returns every source and follow-up feedback message for full suggestion review", async () => {
    prismaMock.developmentSuggestion.findMany.mockResolvedValue([
      {
        id: "suggestion-1",
        tenantId: "tenant-1",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        title: "Garland Special Instructions extraction",
        summary: "A shortened summary.",
        rationale: "Review the grouped evidence.",
        status: "AWAITING_APPROVAL",
        riskLevel: "HIGH",
        sourceFeedbackIds: ["feedback-1"],
        feedbackCount: 1,
        proposedScope: {
          issueKey: "GARLAND_SPECIAL_INSTRUCTIONS",
          followUpFeedbackIds: ["feedback-2"]
        },
        developmentThreadId: null,
        generatedAt: new Date("2026-07-29T12:00:00Z")
      }
    ]);
    prismaMock.operationalFeedback.findMany.mockResolvedValue([
      {
        id: "feedback-1",
        subjectId: "PS123456",
        reporterStatement: "The complete source feedback message.",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL",
        classification: "CHECK_RESULT",
        status: "CONFIRMED",
        createdAt: new Date("2026-07-29T12:00:00Z")
      },
      {
        id: "feedback-2",
        subjectId: "PS123457",
        reporterStatement: "The complete follow-up feedback message.",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL",
        classification: "CHECK_RESULT",
        status: "CONFIRMED",
        createdAt: new Date("2026-07-29T12:05:00Z")
      }
    ]);

    const suggestions = await listDevelopmentSuggestions(context);

    expect(prismaMock.operationalFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          id: { in: ["feedback-1", "feedback-2"] }
        }
      })
    );
    expect(suggestions[0]?.feedbackItems).toEqual([
      expect.objectContaining({
        id: "feedback-1",
        reporterStatement: "The complete source feedback message.",
        evidenceRole: "APPROVED_PACKET"
      }),
      expect.objectContaining({
        id: "feedback-2",
        reporterStatement: "The complete follow-up feedback message.",
        evidenceRole: "FOLLOW_UP"
      })
    ]);
  });

  it("does not send unconfirmed employee reports into a Rivet approval packet", async () => {
    prismaMock.operationalFeedback.findMany.mockResolvedValue([
      {
        id: "feedback-reported",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        subjectType: "GARLAND_CHECK",
        subjectId: "PS123456",
        reporterStatement: "The expected result still needs administrator correction.",
        expectedOutcome: "PASS",
        observedOutcome: "PASS",
        status: "REPORTED"
      }
    ]);
    prismaMock.developmentSuggestion.findMany.mockResolvedValue([
      {
        id: "suggestion-unreviewed",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        title: "Unreviewed Garland feedback",
        summary: "The expected result still needs administrator correction.",
        rationale: "Generated before review.",
        status: "AWAITING_APPROVAL",
        riskLevel: "HIGH",
        sourceFeedbackIds: ["feedback-reported"],
        feedbackCount: 1,
        proposedScope: { issueKey: "GENERIC_CHECK_RESULT_OLD" },
        generatedAt: new Date("2026-07-28T12:00:00Z")
      }
    ]);
    prismaMock.developmentSuggestion.update.mockResolvedValue({
      id: "suggestion-unreviewed",
      status: "SUPERSEDED"
    });

    const suggestions = await generateDevelopmentSuggestions(context);

    expect(suggestions).toEqual([]);
    expect(prismaMock.developmentSuggestion.create).not.toHaveBeenCalled();
    expect(prismaMock.developmentSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-1",
            id: "suggestion-unreviewed"
          }
        },
        data: expect.objectContaining({
          status: "SUPERSEDED"
        })
      })
    );
  });

  it("merges later similar feedback into the same awaiting suggestion before approval", async () => {
    prismaMock.operationalFeedback.findMany.mockResolvedValue([
      {
        id: "feedback-1",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        subjectType: "GARLAND_CHECK",
        subjectId: "PS123456",
        reporterStatement: "The Commodity field is missing the Lot/Serial Ref.",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL",
        status: "CONFIRMED"
      },
      {
        id: "feedback-2",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        subjectType: "GARLAND_CHECK",
        subjectId: "PS210492",
        reporterStatement: "Commodity should show SN because the Lot/Serial reference exists.",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL",
        status: "CONFIRMED"
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

  it("attaches later feedback to an approved issue family without changing its approved packet", async () => {
    prismaMock.operationalFeedback.findMany.mockResolvedValue([
      {
        id: "feedback-2",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        subjectType: "GARLAND_CHECK",
        subjectId: "PS123457",
        reporterStatement: "Commodity should show SN because the Lot/Serial reference exists.",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL",
        status: "CONFIRMED"
      }
    ]);
    prismaMock.developmentSuggestion.findMany.mockResolvedValue([
      {
        id: "suggestion-1",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        title: "Garland Lot/Serial and commodity formatting",
        summary: "The Commodity field is missing the Lot/Serial Ref.",
        rationale: "One approved report.",
        status: "APPROVED",
        riskLevel: "HIGH",
        sourceFeedbackIds: ["feedback-1"],
        feedbackCount: 1,
        proposedScope: { issueKey: "GARLAND_LOT_SERIAL_COMMODITY" },
        generatedAt: new Date("2026-07-27T12:00:00Z")
      }
    ]);
    prismaMock.developmentSuggestion.update.mockImplementation(async ({ data }) => ({
      id: "suggestion-1",
      ...data
    }));

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
      data: {
        proposedScope: expect.objectContaining({
          issueKey: "GARLAND_LOT_SERIAL_COMMODITY",
          followUpFeedbackIds: ["feedback-2"],
          followUpFeedbackCount: 1
        })
      }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "assistant.development_suggestion.attach_follow_up",
          after: expect.objectContaining({ approvedPacketChanged: false })
        })
      })
    );
  });

  it("supersedes a duplicate awaiting card and preserves its feedback on the approved family", async () => {
    prismaMock.operationalFeedback.findMany.mockResolvedValue([{
      id: "feedback-2",
      moduleKey: "SHIPMENT_DOCUMENTS",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      classification: "CHECK_RESULT",
      subjectType: "GARLAND_CHECK",
      subjectId: "PS123457",
      reporterStatement: "The Ship to address, city and postal code should be corrected.",
      expectedOutcome: "PASS",
      observedOutcome: "FAIL",
      status: "CONFIRMED"
    }]);
    prismaMock.developmentSuggestion.findMany.mockResolvedValue([
      {
        id: "suggestion-approved",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        title: "Garland ship-to address and location comparison",
        summary: "The Ship to city is missing.",
        rationale: "Approved report.",
        status: "APPROVED",
        riskLevel: "HIGH",
        sourceFeedbackIds: ["feedback-1"],
        feedbackCount: 1,
        proposedScope: { issueKey: "GENERIC_CHECK_RESULT_OLD" },
        generatedAt: new Date("2026-07-27T12:00:00Z")
      },
      {
        id: "suggestion-duplicate",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        title: "Check Result feedback for Garland Teamship Review",
        summary: "The Ship to address, city and postal code should be corrected.",
        rationale: "Later report.",
        status: "AWAITING_APPROVAL",
        riskLevel: "HIGH",
        sourceFeedbackIds: ["feedback-2"],
        feedbackCount: 1,
        proposedScope: { issueKey: "GENERIC_CHECK_RESULT_NEW" },
        generatedAt: new Date("2026-07-28T12:00:00Z")
      }
    ]);
    prismaMock.developmentSuggestion.update.mockResolvedValue({ id: "suggestion-approved" });

    const suggestions = await generateDevelopmentSuggestions(context);

    expect(suggestions).toEqual([]);
    expect(prismaMock.developmentSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-1",
            id: "suggestion-approved"
          }
        },
        data: {
          proposedScope: expect.objectContaining({
            followUpFeedbackIds: ["feedback-2"],
            followUpFeedbackCount: 1
          })
        }
      })
    );
    expect(prismaMock.developmentSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-1",
            id: "suggestion-duplicate"
          }
        },
        data: expect.objectContaining({ status: "SUPERSEDED" })
      })
    );
  });

  it("creates one regression card after an administrator records the earlier fix as deployed", async () => {
    prismaMock.operationalFeedback.findMany.mockResolvedValue([
      {
        id: "feedback-regression",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        subjectType: "GARLAND_CHECK",
        subjectId: "PS123458",
        reporterStatement: "The Commodity field is missing the Lot/Serial Ref.",
        expectedOutcome: "PASS",
        observedOutcome: "FAIL",
        status: "CONFIRMED"
      }
    ]);
    prismaMock.developmentSuggestion.findMany.mockResolvedValue([
      {
        id: "suggestion-fixed",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        title: "Garland Lot/Serial and commodity formatting",
        summary: "The Commodity field is missing the Lot/Serial Ref.",
        rationale: "Deployed fix.",
        status: "RESOLVED",
        riskLevel: "HIGH",
        sourceFeedbackIds: ["feedback-old"],
        feedbackCount: 1,
        proposedScope: {
          issueKey: "GARLAND_LOT_SERIAL_COMMODITY",
          lifecycleState: "FIX_DEPLOYED"
        },
        generatedAt: new Date("2026-07-27T12:00:00Z")
      }
    ]);
    prismaMock.developmentSuggestion.create.mockImplementation(async ({ data }) => ({
      id: "suggestion-regression",
      ...data
    }));

    await generateDevelopmentSuggestions(context);

    expect(prismaMock.developmentSuggestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Garland Lot/Serial and commodity formatting",
        proposedScope: expect.objectContaining({
          issueKey: "GARLAND_LOT_SERIAL_COMMODITY",
          regressionOfSuggestionId: "suggestion-fixed"
        })
      })
    });
  });

  it("screens only feedback with matching outcomes and identical compared values", async () => {
    prismaMock.operationalFeedback.findMany.mockResolvedValue([
      {
        id: "non-actionable",
        moduleKey: "SHIPMENT_DOCUMENTS",
        workflowKey: "GARLAND_TEAMSHIP_REVIEW",
        classification: "CHECK_RESULT",
        subjectType: "GARLAND_CHECK",
        subjectId: "PS123459",
        reporterStatement: "The Commodity field currently displays: SKU: EXAMPLE QTY: 1 It should display: SKU: EXAMPLE QTY: 1",
        expectedOutcome: "PASS",
        observedOutcome: "PASS",
        status: "CONFIRMED"
      }
    ]);
    prismaMock.developmentSuggestion.findMany.mockResolvedValue([]);

    const suggestions = await generateDevelopmentSuggestions(context);

    expect(suggestions).toEqual([]);
    expect(prismaMock.developmentSuggestion.create).not.toHaveBeenCalled();
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
      observedOutcome: "FAIL",
      status: "CONFIRMED"
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
          status: "QUEUED",
          input: expect.objectContaining({
            approvalComments: "Start Rivet."
          })
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

  it("refuses to start Rivet from a stale suggestion containing unconfirmed feedback", async () => {
    prismaMock.developmentSuggestion.findFirst.mockResolvedValue({
      id: "suggestion-1",
      moduleKey: "SHIPMENT_DOCUMENTS",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      title: "Garland Special Instructions extraction",
      summary: "The report has not been reviewed.",
      rationale: "One unreviewed report.",
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
      subjectId: "PS123456",
      reporterStatement: "The report still needs review.",
      expectedOutcome: "PASS",
      observedOutcome: "FAIL",
      status: "REPORTED"
    }]);

    await expect(
      decideDevelopmentSuggestion(context, "suggestion-1", {
        status: "APPROVED",
        decisionNotes: "Start Rivet."
      })
    ).rejects.toThrow("Review and confirm every source feedback item");
    expect(prismaMock.automationJobRun.create).not.toHaveBeenCalled();
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

  it("resolves a reviewed deployed suggestion and its attached feedback after explicit confirmation", async () => {
    prismaMock.developmentSuggestion.findFirst.mockResolvedValue({
      id: "suggestion-1",
      status: "APPROVED",
      title: "Garland parser fix",
      sourceFeedbackIds: ["feedback-1"],
      proposedScope: {
        issueKey: "GARLAND_SPECIAL_INSTRUCTIONS",
        followUpFeedbackIds: ["feedback-2"]
      },
      pullRequestUrl: "https://github.com/example/repository/pull/12",
      developmentThreadId: "rivet-job-1"
    });
    prismaMock.automationJobRun.findFirst.mockResolvedValue({
      id: "rivet-job-1",
      status: "SUCCESS",
      output: { phase: "READY_FOR_ALEX" },
      errorMessage: null
    });
    prismaMock.developmentSuggestion.update.mockResolvedValue({
      id: "suggestion-1",
      status: "RESOLVED"
    });
    prismaMock.operationalFeedback.updateMany.mockResolvedValue({ count: 2 });

    const result = await resolveDevelopmentSuggestion(context, "suggestion-1");

    expect(result).toMatchObject({ status: "RESOLVED" });
    expect(prismaMock.operationalFeedback.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          id: { in: ["feedback-1", "feedback-2"] }
        }),
        data: expect.objectContaining({ status: "RESOLVED" })
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "assistant.development_suggestion.resolve_deployed"
        })
      })
    );
  });
});
