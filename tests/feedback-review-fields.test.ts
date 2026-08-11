import { describe, expect, it } from "vitest";

import {
  feedbackRequiresSourceEvidence,
  feedbackUsesFieldValues,
  feedbackUsesOrderDecisions,
  readGarlandFeedbackEvidence
} from "@/modules/assistant/feedback-review-fields";

describe("Garland feedback review fields", () => {
  it("uses order decisions only for order-decision feedback", () => {
    expect(feedbackUsesOrderDecisions("ORDER_DECISION")).toBe(true);
    expect(feedbackUsesOrderDecisions("TEAMSHIP_FIELD_UPDATE")).toBe(false);
  });

  it("requires source evidence for incorrect or missing Teamship updates", () => {
    expect(feedbackUsesFieldValues("TEAMSHIP_FIELD_UPDATE")).toBe(true);
    expect(feedbackRequiresSourceEvidence("TEAMSHIP_FIELD_UPDATE")).toBe(true);
    expect(feedbackRequiresSourceEvidence("MISSING_TEAMSHIP_UPDATE")).toBe(true);
    expect(feedbackRequiresSourceEvidence("NOTIFICATION_OR_RESPONSE")).toBe(false);
  });

  it("reads bounded structured field evidence from existing JSON storage", () => {
    expect(readGarlandFeedbackEvidence({
      affectedField: "COMMODITY",
      actualValue: "incorrect",
      expectedValue: "correct"
    })).toEqual({
      affectedField: "COMMODITY",
      actualValue: "incorrect",
      expectedValue: "correct"
    });
  });
});
