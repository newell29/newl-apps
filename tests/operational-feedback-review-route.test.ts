import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  requireModule: vi.fn(),
  requireMutationAccess: vi.fn(),
  requireAdmin: vi.fn(),
  approveLesson: vi.fn(),
  review: vi.fn(),
  updateFields: vi.fn()
}));

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: (...args: unknown[]) => mocks.getContext(...args)
}));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: (...args: unknown[]) => mocks.requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => mocks.requireMutationAccess(...args),
  requireAdmin: (...args: unknown[]) => mocks.requireAdmin(...args)
}));
vi.mock("@/modules/assistant/operational-memory", () => ({
  OperationalMemoryError: class OperationalMemoryError extends Error {},
  approveFeedbackAsLesson: (...args: unknown[]) => mocks.approveLesson(...args),
  reviewOperationalFeedback: (...args: unknown[]) => mocks.review(...args),
  updateOperationalFeedbackReviewFields: (...args: unknown[]) => mocks.updateFields(...args)
}));

import { PATCH } from "@/app/api/assistant/operational-feedback/[feedbackId]/route";

describe("operational feedback review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getContext.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "admin-1",
      role: "ADMIN"
    });
    mocks.updateFields.mockResolvedValue({
      id: "feedback-1",
      observedOutcome: "PASS",
      expectedOutcome: "MISSING"
    });
  });

  it("lets an administrator correct review outcomes without resubmitting the report", async () => {
    const response = await PATCH(
      new Request("https://newl.test/api/assistant/operational-feedback/feedback-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update_review_fields",
          observedOutcome: "PASS",
          expectedOutcome: "MISSING"
        })
      }),
      { params: Promise.resolve({ feedbackId: "feedback-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.requireMutationAccess).toHaveBeenCalled();
    expect(mocks.requireAdmin).toHaveBeenCalled();
    expect(mocks.updateFields).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
      "feedback-1",
      {
        observedOutcome: "PASS",
        expectedOutcome: "MISSING"
      }
    );
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("forwards issue-specific field evidence and the exact saved review", async () => {
    const response = await PATCH(
      new Request("https://newl.test/api/assistant/operational-feedback/feedback-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update_review_fields",
          classification: "TEAMSHIP_FIELD_UPDATE",
          evidence: {
            affectedField: "COMMODITY",
            actualValue: "incorrect",
            expectedValue: "correct"
          },
          teamshipReviewOrderId: "review-order-1",
          artifactId: "evidence-1"
        })
      }),
      { params: Promise.resolve({ feedbackId: "feedback-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateFields).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
      "feedback-1",
      {
        observedOutcome: undefined,
        expectedOutcome: undefined,
        classification: "TEAMSHIP_FIELD_UPDATE",
        evidence: {
          affectedField: "COMMODITY",
          actualValue: "incorrect",
          expectedValue: "correct"
        },
        teamshipReviewOrderId: "review-order-1",
        artifactId: "evidence-1"
      }
    );
  });
});
