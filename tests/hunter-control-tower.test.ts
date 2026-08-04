import { describe, expect, it } from "vitest";

import { readRecoveryState } from "@/modules/lead-gen/hunter-control-tower";

describe("Hunter control tower recovery state", () => {
  it("shows a scheduled paid-retrieval retry without exposing local paths", () => {
    expect(readRecoveryState(
      { recoveryAttempt: 1 },
      {
        recovery: {
          retryable: true,
          retryScheduled: true,
          checkpointStage: "RETRIEVAL_COMPLETE"
        }
      }
    )).toEqual({
      recoveryOfRunId: null,
      attempt: 1,
      checkpointStage: "RETRIEVAL_COMPLETE",
      retryable: true,
      retryScheduled: true,
      recovered: false
    });
  });

  it("shows successful exact-cohort recovery", () => {
    expect(readRecoveryState(
      { recoveryOfRunId: "failed-run", recoveryAttempt: 2 },
      {
        phase: "COMPANY_RESEARCH_COMPLETE",
        recovery: { checkpointStage: "SYNTHESIS_COMPLETE" }
      }
    )).toMatchObject({
      recoveryOfRunId: "failed-run",
      attempt: 2,
      checkpointStage: "SYNTHESIS_COMPLETE",
      recovered: true
    });
  });
});
