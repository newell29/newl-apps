import { describe, expect, it } from "vitest";

import { partitionFeedbackReview } from "@/modules/assistant/feedback-review-display";

describe("Nemo feedback review display", () => {
  it("keeps only undecided feedback in the active review list", () => {
    const feedback = [
      { id: "reported", status: "REPORTED" },
      { id: "investigating", status: "INVESTIGATING" },
      { id: "confirmed", status: "CONFIRMED" },
      { id: "rejected", status: "REJECTED" },
      { id: "resolved", status: "RESOLVED" }
    ];

    const result = partitionFeedbackReview(feedback);

    expect(result.active.map((item) => item.id)).toEqual(["reported", "investigating"]);
    expect(result.archived.map((item) => item.id)).toEqual([
      "confirmed",
      "rejected",
      "resolved"
    ]);
  });

  it("normalizes status casing without changing feedback order", () => {
    const result = partitionFeedbackReview([
      { id: "first", status: "reported" },
      { id: "second", status: "resolved" },
      { id: "third", status: " investigating " }
    ]);

    expect(result.active.map((item) => item.id)).toEqual(["first", "third"]);
    expect(result.archived.map((item) => item.id)).toEqual(["second"]);
  });
});
