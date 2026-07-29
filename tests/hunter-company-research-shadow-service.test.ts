import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateHunterResearchLunaShadow = vi.hoisted(() => vi.fn());
const prisma = vi.hoisted(() => ({
  automationJobRun: {
    findFirst: vi.fn(),
    updateMany: vi.fn()
  },
  company: {
    findMany: vi.fn()
  },
  auditLog: {
    create: vi.fn()
  }
}));

vi.mock("@/server/integrations/openai-hunter-research-shadow", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/integrations/openai-hunter-research-shadow")
  >("@/server/integrations/openai-hunter-research-shadow");
  return {
    ...actual,
    generateHunterResearchLunaShadow
  };
});
vi.mock("@/server/db", () => ({ prisma }));

import {
  HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_MODEL,
  hunterResearchLunaShadowConfiguration,
  runHunterResearchLunaShadowBatch
} from "@/modules/lead-gen/hunter-company-research-shadow";

describe("Hunter Luna company-research shadow service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_ENABLED", "true");
    prisma.automationJobRun.findFirst.mockResolvedValue({
      id: "run-1",
      input: {
        candidateCompanyIds: ["company-1"],
        candidateCompanyKeys: ["example-retailer"]
      },
      output: null
    });
    prisma.company.findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Example Retailer",
        normalizedName: "example-retailer"
      }
    ]);
    prisma.automationJobRun.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({});
    generateHunterResearchLunaShadow.mockResolvedValue({
      rows: [synthesis()],
      usage: {
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 30,
        totalTokens: 130,
        durationMs: 500
      }
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables the trial only when both the explicit flag and server key are present", () => {
    expect(hunterResearchLunaShadowConfiguration()).toMatchObject({
      enabled: true,
      requested: true,
      authoritative: false,
      recommended: HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_MODEL
    });
    vi.stubEnv("OPENAI_API_KEY", "OPENAI_API_KEY_PLACEHOLDER");
    expect(hunterResearchLunaShadowConfiguration()).toMatchObject({
      enabled: false,
      requested: true
    });
  });

  it("stores a non-authoritative tenant-scoped comparison without changing companies", async () => {
    const result = await runHunterResearchLunaShadowBatch({
      tenantId: "tenant-a",
      runId: "run-1",
      packets: [packet()],
      finalBatch: true
    });

    expect(result).toMatchObject({
      state: "completed",
      report: {
        status: "SUCCESS",
        authoritative: false,
        expectedCompanyCount: 1,
        evaluatedCompanyCount: 1,
        firstPassSchemaValidCompanyCount: 1,
        qwenSynthesisCompanyCount: 1,
        qwenMissingCompanyCount: 0,
        categoricalAgreementPercent: 100
      }
    });
    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        id: { in: ["company-1"] }
      },
      select: { id: true, name: true, normalizedName: true }
    });
    expect(prisma.automationJobRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "run-1",
          tenantId: "tenant-a",
          status: "RUNNING"
        }),
        data: {
          output: expect.objectContaining({
            phase: "LUNA_SHADOW_COMPLETE",
            lunaShadow: expect.objectContaining({
              authoritative: false,
              status: "SUCCESS",
              evaluatedCompanyCount: 1
            })
          })
        }
      })
    );
    expect(generateHunterResearchLunaShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        packets: [expect.objectContaining({ companyId: "company-1" })]
      })
    );
  });

  it("rejects a company that is not in the prepared tenant cohort before OpenAI", async () => {
    await expect(
      runHunterResearchLunaShadowBatch({
        tenantId: "tenant-a",
        runId: "run-1",
        packets: [{ ...packet(), companyId: "company-other" }],
        finalBatch: true
      })
    ).rejects.toThrow("outside the prepared tenant cohort");
    expect(generateHunterResearchLunaShadow).not.toHaveBeenCalled();
  });

  it("evaluates evidence even when Qwen omitted the company", async () => {
    const result = await runHunterResearchLunaShadowBatch({
      tenantId: "tenant-a",
      runId: "run-1",
      packets: [{ ...packet(), qwenSynthesis: null }],
      finalBatch: true
    });

    expect(result).toMatchObject({
      state: "completed",
      report: {
        status: "SUCCESS",
        evaluatedCompanyCount: 1,
        qwenSynthesisCompanyCount: 0,
        qwenMissingCompanyCount: 1,
        categoricalAgreementPercent: null
      }
    });
    expect(generateHunterResearchLunaShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        packets: [expect.objectContaining({ qwenSynthesis: null })]
      })
    );
  });
});

function packet() {
  return {
    companyId: "company-1",
    companyKey: "example-retailer",
    companyName: "Example Retailer",
    domain: "example.com",
    priorityScore: 80,
    primaryIndustry: "Retail",
    shipmentEvidence: [],
    existingSignals: [],
    publicEvidence: [{
      evidenceIndex: 0,
      pass: "FRESH_EVENTS",
      query: "Example Retailer expansion",
      title: "Example Retailer opens a distribution center",
      url: "https://example.com/news",
      sourceDomain: "example.com",
      sourceType: "FIRST_PARTY",
      publishedAt: "2026-07-20T00:00:00.000Z",
      excerpt: "Example Retailer opened a North Carolina distribution center.",
      firstParty: true
    }],
    qwenSynthesis: synthesis()
  };
}

function synthesis() {
  return {
    companyKey: "example-retailer",
    identityDisposition: "PASS",
    identityConfidence: 92,
    identityReason: "First-party evidence identifies the operating retailer.",
    logisticsProvider: false,
    namedExternalLogisticsProvider: false,
    stableExclusiveProviderEvidence: false,
    providerDisplacementEvidence: false,
    freshness: "FRESH",
    opportunitySummary: "A new distribution center supports a current warehousing opportunity.",
    triggerEvidenceIndices: [0],
    geography: "North Carolina",
    companyCountry: "United States",
    operatingRegion: "NORTH_AMERICA",
    verifiedUsDivision: false,
    usDivisionName: null,
    usDivisionEvidenceIndices: [],
    serviceLine: "WAREHOUSING",
    signalType: "FACILITY_OPENING",
    confidence: 88,
    rationale: "The dated exact-company facility event is directly relevant.",
    missingEvidence: [],
    followUpQueries: []
  };
}
