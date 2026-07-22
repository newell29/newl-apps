import { describe, expect, it, vi } from "vitest";
import {
  COMPANY_SCORING_MODEL_VERSION,
  fingerprintScoringConfig,
  getLeadScoringHistory,
  recordLeadOutcomeEvent,
  recordLeadScoreSnapshot
} from "@/modules/lead-gen/score-history";

describe("lead scoring history", () => {
  it("creates stable configuration fingerprints and changes them when a setting changes", () => {
    const first = fingerprintScoringConfig({
      momentumWeight: 24,
      preferredOriginCountries: ["italy", "germany"],
      nested: { enabled: true, threshold: 10 }
    });
    const reordered = fingerprintScoringConfig({
      nested: { threshold: 10, enabled: true },
      preferredOriginCountries: ["italy", "germany"],
      momentumWeight: 24
    });
    const changed = fingerprintScoringConfig({
      momentumWeight: 25,
      preferredOriginCountries: ["italy", "germany"],
      nested: { enabled: true, threshold: 10 }
    });

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("persists a tenant-scoped immutable score snapshot", async () => {
    const createSnapshot = vi.fn().mockResolvedValue({ id: "snapshot-1" });
    const client = {
      leadScoreSnapshot: { create: createSnapshot },
      leadOutcomeEvent: { create: vi.fn() }
    };

    await recordLeadScoreSnapshot(
      {
        tenantId: "tenant-a",
        companyId: "company-1",
        scoreType: "COMPANY_OPPORTUNITY",
        score: 71.6,
        modelVersion: COMPANY_SCORING_MODEL_VERSION,
        scoringConfig: { momentumWeight: 24 },
        trigger: "TRADEMINING_INGESTION",
        searchProfileId: "profile-1",
        explanation: "Recent shipment momentum",
        breakdown: { total: 72 }
      },
      client
    );

    expect(createSnapshot).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        companyId: "company-1",
        score: 72,
        scoreType: "COMPANY_OPPORTUNITY",
        trigger: "TRADEMINING_INGESTION",
        configFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    });
  });

  it("persists previous and current outcome values inside the same tenant", async () => {
    const createOutcome = vi.fn().mockResolvedValue({ id: "outcome-1" });
    const findSnapshot = vi.fn().mockResolvedValue({ id: "snapshot-1" });
    const occurredAt = new Date("2026-07-22T19:00:00.000Z");
    const client = {
      leadScoreSnapshot: { create: vi.fn(), findFirst: findSnapshot },
      leadOutcomeEvent: { create: createOutcome }
    };

    await recordLeadOutcomeEvent(
      {
        tenantId: "tenant-a",
        companyId: "company-1",
        leadId: "lead-1",
        outcomeType: "PIPELINE_STAGE_CHANGED",
        previousValue: "NEW",
        currentValue: "QUALIFIED",
        source: "USER_ACTION",
        actorUserId: "user-1",
        occurredAt
      },
      client
    );

    expect(findSnapshot).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        companyId: "company-1",
        contactId: null,
        scoreType: "COMPANY_OPPORTUNITY",
        createdAt: {
          lte: occurredAt
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true
      }
    });
    expect(createOutcome).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        companyId: "company-1",
        leadId: "lead-1",
        previousValue: "NEW",
        currentValue: "QUALIFIED",
        scoreSnapshotId: "snapshot-1"
      })
    });
  });

  it("uses contact-relevance history for Apollo outcomes and allows no earlier snapshot", async () => {
    const createOutcome = vi.fn().mockResolvedValue({ id: "outcome-1" });
    const findSnapshot = vi.fn().mockResolvedValue(null);
    const client = {
      leadScoreSnapshot: { create: vi.fn(), findFirst: findSnapshot },
      leadOutcomeEvent: { create: createOutcome }
    };

    await recordLeadOutcomeEvent(
      {
        tenantId: "tenant-a",
        companyId: "company-1",
        contactId: "contact-1",
        outcomeType: "APOLLO_REPLY_STATUS_CHANGED",
        previousValue: "NO_REPLY",
        currentValue: "POSITIVE",
        source: "APOLLO"
      },
      client
    );

    expect(findSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-a",
          companyId: "company-1",
          contactId: "contact-1",
          scoreType: "CONTACT_RELEVANCE"
        })
      })
    );
    expect(createOutcome).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scoreSnapshotId: null
      })
    });
  });

  it("tenant-scopes both scoring history queries and calculates score deltas", async () => {
    const now = new Date("2026-07-22T19:00:00.000Z");
    const earlier = new Date("2026-07-21T19:00:00.000Z");
    const findSnapshots = vi.fn().mockResolvedValue([
      snapshotRow({ id: "snapshot-new", score: 75, createdAt: now }),
      snapshotRow({ id: "snapshot-old", score: 68, createdAt: earlier })
    ]);
    const findOutcomes = vi.fn().mockResolvedValue([]);

    const history = await getLeadScoringHistory("tenant-a", 25, {
      leadScoreSnapshot: { findMany: findSnapshots },
      leadOutcomeEvent: { findMany: findOutcomes }
    });

    expect(findSnapshots).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant-a" }, take: 25 }));
    expect(findOutcomes).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant-a" }, take: 25 }));
    expect(history.snapshots[0]?.scoreDelta).toBe(7);
    expect(history.snapshots[1]?.scoreDelta).toBeNull();
  });
});

function snapshotRow(overrides: { id: string; score: number; createdAt: Date }) {
  return {
    id: overrides.id,
    companyId: "company-1",
    contactId: null,
    leadId: null,
    scoreType: "COMPANY_OPPORTUNITY",
    score: overrides.score,
    tier: null,
    modelVersion: COMPANY_SCORING_MODEL_VERSION,
    configFingerprint: "fingerprint",
    trigger: "TRADEMINING_INGESTION",
    searchProfileId: "profile-1",
    explanation: "Reason",
    evidenceAsOf: overrides.createdAt,
    createdAt: overrides.createdAt,
    company: { name: "Example Company" }
  };
}
