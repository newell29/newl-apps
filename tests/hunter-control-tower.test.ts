import { describe, expect, it } from "vitest";

import {
  readRecoveryState,
  resolveTowerLocalDayRun,
  resolveTowerResearchSelection,
  resolveTowerResearchSelectionForRun,
  resolveTowerSelectedCompanyCount
} from "@/modules/lead-gen/hunter-control-tower";

describe("Hunter control tower research selection", () => {
  it("uses the normalized selection from the latest successful research run", () => {
    expect(resolveTowerResearchSelection(
      { selectedCompanyCount: 30, newCompanyCount: 27 },
      { selection: null }
    )).toMatchObject({
      selectedCompanyCount: 30,
      newCompanyCount: 27
    });
  });

  it("falls back to raw run input for legacy research runs", () => {
    expect(resolveTowerResearchSelection(null, {
      selection: { selectedCompanyCount: 12 }
    })).toMatchObject({ selectedCompanyCount: 12 });
  });

  it("counts the exact prepared cohort when a legacy run has no selection audit", () => {
    expect(resolveTowerSelectedCompanyCount(
      null,
      { candidateCompanyIds: Array.from({ length: 30 }, (_, index) => `company-${index}`) },
      { researchedCount: 30, missingCompanyCount: 0 }
    )).toBe(30);
  });

  it("falls back to completed and missing totals when only legacy output remains", () => {
    expect(resolveTowerSelectedCompanyCount(
      null,
      null,
      { researchedCount: 28, missingCompanyCount: 2 }
    )).toBe(30);
  });

  it("does not reuse a prior successful run's selection for today's run", () => {
    expect(resolveTowerResearchSelectionForRun(
      {
        id: "today-running",
        input: { selection: { selectedCompanyCount: 50, newCompanyCount: 48 } }
      },
      "yesterday-success",
      { selectedCompanyCount: 30, newCompanyCount: 0 }
    )).toMatchObject({ selectedCompanyCount: 50, newCompanyCount: 48 });
  });
});

describe("Hunter control tower local-day runs", () => {
  const now = new Date("2026-08-05T13:00:00.000Z");

  it("includes an outreach handoff from the current Toronto day", () => {
    const run = { id: "today", startedAt: new Date("2026-08-05T12:15:00.000Z") };

    expect(resolveTowerLocalDayRun(run, now, "America/Toronto")).toBe(run);
  });

  it("does not carry yesterday's outreach contacts into today's production", () => {
    const run = { id: "yesterday", startedAt: new Date("2026-08-05T03:59:59.000Z") };

    expect(resolveTowerLocalDayRun(run, now, "America/Toronto")).toBeNull();
  });
});

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
