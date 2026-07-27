import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRivetDevelopmentJob: vi.fn(),
  automationJobRun: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
  },
  hunterOpportunitySignal: {
    findMany: vi.fn()
  },
  tradeMiningSearchProfile: {
    findMany: vi.fn()
  },
  operationalFeedback: {
    create: vi.fn()
  },
  developmentSuggestion: {
    create: vi.fn(),
    update: vi.fn()
  },
  auditLog: {
    create: vi.fn()
  },
  transaction: vi.fn()
}));

vi.mock("@/modules/assistant/rivet-development-jobs", () => ({
  createRivetDevelopmentJob: (...args: unknown[]) =>
    mocks.createRivetDevelopmentJob(...args)
}));
vi.mock("@/server/db", () => ({
  prisma: {
    automationJobRun: mocks.automationJobRun,
    hunterOpportunitySignal: mocks.hunterOpportunitySignal,
    tradeMiningSearchProfile: mocks.tradeMiningSearchProfile,
    operationalFeedback: mocks.operationalFeedback,
    developmentSuggestion: mocks.developmentSuggestion,
    auditLog: mocks.auditLog,
    $transaction: mocks.transaction
  }
}));

import {
  completeHunterQualityAudit,
  HUNTER_RIVET_APPROVAL_VALUE,
  parseHunterQualityAuditCompletion,
  prepareHunterQualityAudit,
  selectHunterQualitySample,
  type HunterQualityAuditCompletion
} from "@/modules/lead-gen/hunter-quality-audit";

describe("Hunter quality audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        automationJobRun: mocks.automationJobRun,
        operationalFeedback: mocks.operationalFeedback,
        developmentSuggestion: mocks.developmentSuggestion,
        auditLog: mocks.auditLog
      })
    );
    mocks.automationJobRun.findFirst.mockResolvedValue({
      id: "audit-run-1",
      input: {
        signalIds: ["signal-1"],
        tradeMiningFindings: [],
        tradeMiningRunState: {
          enabledProfiles: 3,
          completed: 3,
          active: 0,
          failed: 0,
          missing: 0
        }
      }
    });
    mocks.automationJobRun.findMany.mockResolvedValue([]);
    mocks.automationJobRun.create.mockResolvedValue({ id: "incident-1" });
    mocks.operationalFeedback.create.mockResolvedValue({ id: "feedback-1" });
    mocks.developmentSuggestion.create.mockResolvedValue({
      id: "suggestion-1",
      moduleKey: "LEAD_GEN",
      workflowKey: "HUNTER_COMPANY_RESEARCH_QUALITY",
      title: "Fix Hunter company-research quality defect",
      summary: "Hunter missed an expansion article.",
      rationale: "Prepare a reviewed draft PR.",
      riskLevel: "MEDIUM",
      sourceFeedbackIds: ["feedback-1"],
      proposedScope: {}
    });
    mocks.createRivetDevelopmentJob.mockResolvedValue({ id: "rivet-job-1" });
  });

  it("uses a Codex-compatible HTTPS evidence URL schema", () => {
    const schema = JSON.parse(
      readFileSync(
        path.join(
          process.cwd(),
          "ops/openclaw/skills/rivet-developer/hunter-quality-output.schema.json"
        ),
        "utf8"
      )
    ) as {
      properties: {
        findings: {
          items: {
            properties: {
              evidenceUrls: {
                items: Record<string, unknown>;
              };
            };
          };
        };
      };
    };
    const evidenceUrlSchema =
      schema.properties.findings.items.properties.evidenceUrls.items;

    expect(evidenceUrlSchema).toEqual({
      type: "string",
      pattern: "^https://"
    });
    expect(evidenceUrlSchema).not.toHaveProperty("format");
  });

  it("selects one signal from each opportunity tier before filling the fifth slot", () => {
    const signals = [
      signal("hot", "HOT_OPPORTUNITY"),
      signal("qualified", "QUALIFIED_CURRENT_ACCOUNT"),
      signal("watch", "WATCHLIST"),
      signal("blocked", "BLOCKED"),
      signal("extra", "HOT_OPPORTUNITY"),
      signal("sixth", "WATCHLIST")
    ];

    expect(selectHunterQualitySample(signals).map((item) => item.id)).toEqual([
      "hot",
      "qualified",
      "watch",
      "blocked",
      "extra"
    ]);
  });

  it("prepares only tenant-scoped signals, profiles, and TradeMining runs", async () => {
    mocks.automationJobRun.findFirst.mockResolvedValueOnce(null);
    mocks.hunterOpportunitySignal.findMany.mockResolvedValue([]);
    mocks.tradeMiningSearchProfile.findMany.mockResolvedValue([]);
    mocks.automationJobRun.findMany.mockResolvedValueOnce([]);
    mocks.automationJobRun.create.mockResolvedValueOnce({ id: "audit-new" });

    const result = await prepareHunterQualityAudit(
      { tenantId: "tenant-1" },
      new Date("2026-07-26T16:00:00.000Z")
    );

    expect(result).toMatchObject({
      state: "ready",
      runId: "audit-new",
      packet: { sample: [], tradeMiningFindings: [] }
    });
    expect(mocks.hunterOpportunitySignal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-1" })
      })
    );
    expect(mocks.tradeMiningSearchProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-1" }
      })
    );
    expect(mocks.automationJobRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          jobType: "trademining.ingestion"
        })
      })
    );
  });

  it("validates the bounded structured Codex result", () => {
    expect(
      parseHunterQualityAuditCompletion(buildCompletion()).findings[0]
    ).toMatchObject({
      signalId: "signal-1",
      category: "EVIDENCE_RETRIEVAL",
      recommendedTier: "HOT_OPPORTUNITY",
      reproducible: true
    });
    expect(() =>
      parseHunterQualityAuditCompletion({
        ...buildCompletion(),
        findings: [
          {
            ...buildCompletion().findings[0],
            category: "UNKNOWN_CATEGORY"
          }
        ]
      })
    ).toThrow("category is invalid");
  });

  it("queues a restricted Rivet job for a reproducible owner-approved evidence defect", async () => {
    const result = await completeHunterQualityAudit({
      context: { tenantId: "tenant-1", userId: "admin-1" },
      runId: "audit-run-1",
      completion: buildCompletion(),
      env: {
        HUNTER_RIVET_AUTO_TRIAGE_APPROVAL: HUNTER_RIVET_APPROVAL_VALUE
      },
      now: new Date("2026-07-26T16:00:00.000Z")
    });

    expect(mocks.developmentSuggestion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        moduleKey: "LEAD_GEN",
        status: "APPROVED",
        proposedScope: expect.objectContaining({
          requiresHumanMerge: true,
          frozenEvidenceRequired: true,
          forbiddenAutomaticActions: expect.arrayContaining([
            "RECLASSIFY_LEAD",
            "RETRY_TRADEMINING",
            "MERGE",
            "DEPLOY"
          ])
        })
      })
    });
    expect(mocks.createRivetDevelopmentJob).toHaveBeenCalled();
    expect(result.developmentJobIds).toEqual(["rivet-job-1"]);
    expect(result.teamsMessage).toContain("Rivet queued 1 restricted development job");
    expect(result.teamsMessage).toContain("TradeMining status at audit time: 3/3 completed");
    expect(result.teamsMessage).toContain("No lead was reclassified");
  });

  it("notifies but does not queue Rivet for subjective model judgment", async () => {
    const completion = buildCompletion();
    completion.findings[0] = {
      ...completion.findings[0],
      category: "MODEL_JUDGMENT",
      reproducible: false
    };

    const result = await completeHunterQualityAudit({
      context: { tenantId: "tenant-1", userId: "admin-1" },
      runId: "audit-run-1",
      completion,
      env: {
        HUNTER_RIVET_AUTO_TRIAGE_APPROVAL: HUNTER_RIVET_APPROVAL_VALUE
      }
    });

    expect(mocks.createRivetDevelopmentJob).not.toHaveBeenCalled();
    expect(result.teamsMessage).toContain("require human judgment");
  });

  it("does not queue a second Rivet job after an identical incident trips the circuit breaker", async () => {
    mocks.automationJobRun.findMany.mockResolvedValue([
      { id: "incident-prior", output: { phase: "RECORDED" } }
    ]);

    const result = await completeHunterQualityAudit({
      context: { tenantId: "tenant-1", userId: "admin-1" },
      runId: "audit-run-1",
      completion: buildCompletion(),
      env: {
        HUNTER_RIVET_AUTO_TRIAGE_APPROVAL: HUNTER_RIVET_APPROVAL_VALUE
      }
    });

    expect(mocks.createRivetDevelopmentJob).not.toHaveBeenCalled();
    expect(result.teamsMessage).toContain("Circuit breaker");
  });
});

function signal(id: string, tier: string) {
  return {
    id,
    evidence: {
      research: {
        opportunityTier: tier
      }
    }
  };
}

function buildCompletion(): HunterQualityAuditCompletion {
  return {
    auditedAt: "2026-07-26T16:00:00.000Z",
    findings: [
      {
        signalId: "signal-1",
        category: "EVIDENCE_RETRIEVAL" as const,
        severity: "HIGH" as const,
        observedTier: "WATCHLIST" as const,
        recommendedTier: "HOT_OPPORTUNITY" as const,
        reproducible: true,
        summary: "Hunter missed a dated public expansion article.",
        rationale:
          "The article existed before the Hunter run and materially changes freshness.",
        evidenceUrls: ["https://example.com/expansion"]
      }
    ]
  };
}
