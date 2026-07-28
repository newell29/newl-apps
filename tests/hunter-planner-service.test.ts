import {
  CandidateStatus,
  HunterAutomationMode,
  HunterServiceLine,
  ReplyStatus
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  hunterAutomationPolicy: { findUnique: vi.fn() },
  automationJobRun: {
    create: vi.fn(),
    update: vi.fn()
  },
  company: { findMany: vi.fn() },
  hunterOpportunitySignal: { findMany: vi.fn() },
  hunterOutreachSuppression: { findMany: vi.fn() },
  hunterProspectingDecision: { createMany: vi.fn() },
  auditLog: { create: vi.fn() }
}));

vi.mock("@/server/db", () => ({ prisma }));

import { runHunterDryPlan } from "@/modules/lead-gen/hunter-planner";

describe("Hunter researched outreach planning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.hunterAutomationPolicy.findUnique.mockResolvedValue({
      mode: HunterAutomationMode.ASSISTED,
      killSwitch: false,
      dailyCompanyLimit: 30,
      maxContactsPerCompany: 3,
      warehousingPercent: 60,
      oceanAirPercent: 30,
      truckingPercent: 10,
      minimumPriorityScore: 35,
      minimumSignalConfidence: 50,
      scheduleTimezone: "America/Toronto"
    });
    prisma.automationJobRun.create.mockResolvedValue({ id: "plan-researched" });
    prisma.automationJobRun.update.mockResolvedValue({ id: "plan-researched" });
    prisma.hunterOutreachSuppression.findMany.mockResolvedValue([]);
    prisma.hunterProspectingDecision.createMany.mockResolvedValue({ count: 14 });
    prisma.auditLog.create.mockResolvedValue({ id: "audit-researched" });
  });

  it("selects every current safe Hot or Qualified account instead of filling the cohort with raw TradeMining companies", async () => {
    prisma.company.findMany.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => ({
        id: `raw-company-${index + 1}`,
        name: `Raw TradeMining ${index + 1}`,
        normalizedName: `raw-trademining-${index + 1}`,
        priorityScore: 99 - index,
        primaryIndustry: "Manufacturing",
        candidateStatus: CandidateStatus.NEW,
        importRecords: [{
          arrivalDate: new Date(),
          sourcePort: "Charlotte",
          destinationCity: "Charlotte",
          destinationState: "NC",
          originCountry: "Vietnam",
          productDescription: "Components"
        }]
      }))
    );
    prisma.hunterOpportunitySignal.findMany.mockResolvedValue(
      Array.from({ length: 14 }, (_, index) =>
        researchSignal({
          index,
          tier: index < 2 ? "HOT_OPPORTUNITY" : "QUALIFIED_CURRENT_ACCOUNT",
          serviceLine:
            index === 0
              ? HunterServiceLine.TRUCKING
              : index === 1
                ? HunterServiceLine.OCEAN_AIR
                : HunterServiceLine.WAREHOUSING
        })
      )
    );

    await expect(
      runHunterDryPlan({
        tenantId: "tenant-a",
        actorUserId: "user-a",
        trigger: "MANUAL",
        candidateScope: "CURRENT_RESEARCHED_OUTREACH"
      })
    ).resolves.toMatchObject({
      state: "completed",
      runId: "plan-researched",
      candidateScope: "CURRENT_RESEARCHED_OUTREACH",
      candidatePoolCount: 14,
      selectedCount: 14
    });

    const createManyCall =
      prisma.hunterProspectingDecision.createMany.mock.calls[0]?.[0];
    expect(createManyCall.data).toHaveLength(14);
    expect(
      createManyCall.data.map((decision: { companyId: string }) => decision.companyId)
    ).toEqual(
      expect.arrayContaining(
        Array.from({ length: 14 }, (_, index) => `researched-company-${index + 1}`)
      )
    );
    expect(
      createManyCall.data.some((decision: { companyId: string }) =>
        decision.companyId.startsWith("raw-company-")
      )
    ).toBe(false);
  });
});

function researchSignal({
  index,
  tier,
  serviceLine
}: {
  index: number;
  tier: "HOT_OPPORTUNITY" | "QUALIFIED_CURRENT_ACCOUNT";
  serviceLine: HunterServiceLine;
}) {
  const companyNumber = index + 1;
  const now = new Date();
  return {
    id: `research-signal-${companyNumber}`,
    tenantId: "tenant-a",
    companyId: `researched-company-${companyNumber}`,
    companyName: `Researched Company ${companyNumber}`,
    normalizedCompanyName: `researched-company-${companyNumber}`,
    signalType: tier === "HOT_OPPORTUNITY" ? "EXPANSION" : "CURRENT_FIT",
    serviceLine,
    status: "NEW",
    title: tier === "HOT_OPPORTUNITY" ? "Verified expansion" : "Qualified account",
    summary: "Qwen and Kimi found a grounded logistics opportunity.",
    geography: "Charlotte, NC",
    sourceName: "Hunter company research",
    sourceUrl: `https://example.com/research-${companyNumber}`,
    confidence: 80 - index,
    dedupeKey: `research-${companyNumber}`,
    observedAt: now,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    evidence: {
      research: {
        retrievedAt: now.toISOString(),
        opportunityTier: tier,
        finalScore: 80 - index,
        finalConfidence: 80 - index,
        synthesis: {
          serviceLine,
          opportunityType: "Expansion",
          opportunitySummary: "Grounded company research"
        },
        scoring: {
          serviceLine,
          opportunityType: "Expansion",
          rationale: "Grounded company research"
        },
        validation:
          tier === "HOT_OPPORTUNITY"
            ? { status: "VALIDATED", disposition: "CONFIRM" }
            : { status: "NOT_REQUIRED", disposition: "NOT_RUN" },
        deterministicGate: { passed: true },
        models: {
          synthesis: { provider: "OLLAMA" },
          scoring: { provider: "KIMI" }
        }
      }
    },
    rawJson: {},
    company: {
      doNotProspect: false,
      candidateStatus: CandidateStatus.NEW,
      cashflowCustomers: [],
      contacts: [{ replyStatus: ReplyStatus.NO_REPLY }]
    }
  };
}
