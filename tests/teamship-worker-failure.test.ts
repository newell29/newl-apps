import { describe, expect, it } from "vitest";

import {
  readTeamshipWorkerFailure,
  readWorkerFailureStage,
  sanitizeWorkerErrorMessage,
  TeamshipWorkerStageError
} from "@/modules/shipment-documents/teamship-worker-failure";

describe("Teamship worker failure reporting", () => {
  it("preserves an explicit stage and redacts secret-looking values", () => {
    expect(
      readTeamshipWorkerFailure({
        failureStage: "TEAMSHIP_API",
        error: "Request failed. Bearer abc123 token=xyz789"
      })
    ).toEqual({
      stage: "TEAMSHIP_API",
      message: "Request failed. Bearer [redacted] token=[redacted]"
    });
  });

  it("infers login failures created by older workers", () => {
    expect(readTeamshipWorkerFailure({ error: "Teamship login failed with status 503." })).toEqual({
      stage: "TEAMSHIP_LOGIN",
      message: "Teamship login failed with status 503."
    });
  });

  it("keeps the assigned cleanup stage on wrapped browser errors", () => {
    const error = new TeamshipWorkerStageError("BOL_CLEANUP", new Error("Browser page closed."));

    expect(readWorkerFailureStage(error, "UNKNOWN")).toBe("BOL_CLEANUP");
    expect(sanitizeWorkerErrorMessage(error.message)).toBe("Browser page closed.");
  });
});
