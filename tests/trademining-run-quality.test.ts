import { describe, expect, it } from "vitest";

import { evaluateTradeMiningRunQuality } from "@/modules/trademining/run-quality";

const now = new Date("2026-07-26T16:00:00.000Z");

describe("evaluateTradeMiningRunQuality", () => {
  it("requires every enabled profile to complete once per local day", () => {
    const findings = evaluateTradeMiningRunQuality({
      profiles: [
        {
          id: "profile-1",
          name: "Charlotte Warehousing",
          enabled: true,
          scheduleTimezone: "America/Toronto",
          updatedAt: new Date("2026-07-20T12:00:00.000Z")
        }
      ],
      runs: [],
      now
    });

    expect(findings).toEqual([
      expect.objectContaining({
        key: expect.stringContaining("DAILY_RUN_MISSING:profile-1"),
        category: "RUNTIME_TRANSIENT",
        severity: "HIGH"
      })
    ]);
  });

  it("flags a run referencing a removed profile for review without claiming a code defect", () => {
    const findings = evaluateTradeMiningRunQuality({
      profiles: [],
      runs: [
        buildRun({
          id: "run-removed",
          input: { searchProfileId: "removed-profile" }
        })
      ],
      now
    });

    expect(findings).toEqual([
      expect.objectContaining({
        key: "REMOVED_PROFILE_RUN_REFERENCE:removed-profile",
        category: "DATA_OR_CONFIG",
        profileName: "Removed search profile"
      })
    ]);
  });

  it("treats a run started after disablement as a code defect", () => {
    const findings = evaluateTradeMiningRunQuality({
      profiles: [
        {
          id: "profile-disabled",
          name: "Old GTA Leads",
          enabled: false,
          scheduleTimezone: "America/Toronto",
          updatedAt: new Date("2026-07-26T13:00:00.000Z")
        }
      ],
      runs: [
        buildRun({
          id: "run-disabled",
          startedAt: new Date("2026-07-26T14:00:00.000Z"),
          input: { searchProfileId: "profile-disabled" }
        })
      ],
      now
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        key: "DISABLED_PROFILE_RAN:profile-disabled",
        category: "CODE_DEFECT",
        severity: "HIGH"
      })
    );
  });

  it("detects overlap, incomplete adaptive retrieval, and exported/ingested count drift", () => {
    const findings = evaluateTradeMiningRunQuality({
      profiles: [
        {
          id: "profile-1",
          name: "GTA Leads",
          enabled: true,
          scheduleTimezone: "America/Toronto",
          updatedAt: new Date("2026-07-20T12:00:00.000Z")
        }
      ],
      runs: [
        buildRun({
          id: "run-success",
          status: "SUCCESS",
          input: { searchProfileId: "profile-1" },
          output: {
            externalStatus: "PARTIAL",
            recordsProcessed: 90,
            recordsCreated: 70,
            recordsUpdated: 20,
            metadata: {
              coverage: {
                matchedRecords: 100,
                exportedRecords: 100,
                queryCount: 5,
                retrievalComplete: false
              }
            }
          }
        }),
        buildRun({
          id: "run-active-1",
          status: "RUNNING",
          startedAt: new Date("2026-07-26T12:30:00.000Z"),
          input: { searchProfileId: "profile-1" }
        }),
        buildRun({
          id: "run-active-2",
          status: "RUNNING",
          startedAt: new Date("2026-07-26T12:20:00.000Z"),
          input: { searchProfileId: "profile-1" }
        })
      ],
      now
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "OVERLAPPING_RUNS:profile-1" }),
        expect.objectContaining({
          key: "RETRIEVAL_INCOMPLETE:profile-1",
          category: "CODE_DEFECT"
        }),
        expect.objectContaining({
          key: "EXPORTED_INGESTED_MISMATCH:profile-1",
          category: "CODE_DEFECT"
        })
      ])
    );
  });

  it("treats a zero result as an anomaly only when the profile has positive history", () => {
    const findings = evaluateTradeMiningRunQuality({
      profiles: [
        {
          id: "profile-1",
          name: "GTA Leads",
          enabled: true,
          scheduleTimezone: "America/Toronto",
          updatedAt: new Date("2026-07-20T12:00:00.000Z")
        }
      ],
      runs: [
        buildRun({
          id: "run-zero",
          input: { searchProfileId: "profile-1" },
          output: completedOutput(0)
        }),
        buildRun({
          id: "run-prior",
          startedAt: new Date("2026-07-25T13:00:00.000Z"),
          input: { searchProfileId: "profile-1" },
          output: completedOutput(42)
        })
      ],
      now
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        key: "ZERO_RESULT_ANOMALY:profile-1",
        category: "DATA_OR_CONFIG",
        severity: "MEDIUM"
      })
    );
  });
});

function buildRun(
  overrides: Partial<{
    id: string;
    status: "QUEUED" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";
    startedAt: Date;
    finishedAt: Date | null;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    errorMessage: string | null;
  }> = {}
) {
  return {
    id: overrides.id ?? "run-1",
    status: overrides.status ?? ("SUCCESS" as const),
    startedAt: overrides.startedAt ?? new Date("2026-07-26T13:00:00.000Z"),
    finishedAt: overrides.finishedAt ?? new Date("2026-07-26T13:30:00.000Z"),
    input: overrides.input ?? { searchProfileId: "profile-1" },
    output: overrides.output ?? completedOutput(10),
    errorMessage: overrides.errorMessage ?? null
  };
}

function completedOutput(count: number) {
  return {
    externalStatus: "COMPLETED",
    recordsProcessed: count,
    recordsCreated: count,
    recordsUpdated: 0,
    metadata: {
      coverage: {
        matchedRecords: count,
        exportedRecords: count,
        queryCount: 1,
        retrievalComplete: true
      }
    }
  };
}
