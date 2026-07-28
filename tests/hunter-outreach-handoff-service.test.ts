import { HunterAutomationMode } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  hunterAutomationPolicy: { findUnique: vi.fn() },
  tradeMiningScoringConfig: { findUnique: vi.fn() },
  automationJobRun: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn()
  },
  hunterProspectingDecision: { findMany: vi.fn() },
  auditLog: { create: vi.fn() }
}));
const evaluateHunterOutreachEligibility = vi.hoisted(() => vi.fn());
const isOpenAiDraftGenerationConfigured = vi.hoisted(() => vi.fn());
const runHunterDryPlan = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({ prisma }));
vi.mock("@/server/integrations/openai", () => ({
  isOpenAiDraftGenerationConfigured
}));
vi.mock("@/modules/lead-gen/hunter-outreach-eligibility", () => ({
  evaluateHunterOutreachEligibility,
  getHunterOutreachResearchMaxAgeDays: () => 30
}));
vi.mock("@/modules/lead-gen/outreach-plan-generation", () => ({
  generateOutreachPlanForContact: vi.fn(),
  loadOutreachPlanContactContext: vi.fn()
}));
vi.mock("@/modules/lead-gen/hunter-planner", () => ({
  HUNTER_DRY_RUN_JOB_TYPE: "HUNTER_PROSPECTING_DRY_RUN",
  runHunterDryPlan
}));
vi.mock("@/server/integrations/apollo", () => ({
  ApolloRateLimitError: class ApolloRateLimitError extends Error {},
  fetchApolloContactsForCompany: vi.fn()
}));

import {
  enqueueHunterOutreachHandoff,
  queueCurrentHunterOutreachHandoff
} from "@/modules/lead-gen/hunter-outreach-handoff";

describe("Hunter assisted handoff queueing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isOpenAiDraftGenerationConfigured.mockReturnValue(true);
    prisma.tradeMiningScoringConfig.findUnique.mockResolvedValue({
      aiClassificationEnabled: true
    });
    prisma.automationJobRun.findMany.mockResolvedValue([]);
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
    runHunterDryPlan.mockResolvedValue({
      state: "completed",
      runId: "plan-current"
    });
  });

  it("does nothing unless the administrator explicitly selected Assisted", async () => {
    prisma.hunterAutomationPolicy.findUnique.mockResolvedValue({
      mode: HunterAutomationMode.DRY_RUN,
      killSwitch: false,
      maxContactsPerCompany: 2
    });

    await expect(enqueueHunterOutreachHandoff({
      tenantId: "tenant-a",
      researchRunId: "research-1",
      prospectingPlanRunId: "plan-1"
    })).resolves.toMatchObject({ state: "disabled" });
    expect(prisma.hunterProspectingDecision.findMany).not.toHaveBeenCalled();
    expect(prisma.automationJobRun.create).not.toHaveBeenCalled();
  });

  it("freezes only eligible decisions and the configured contact cap into a durable job", async () => {
    prisma.hunterAutomationPolicy.findUnique.mockResolvedValue({
      mode: HunterAutomationMode.ASSISTED,
      killSwitch: false,
      maxContactsPerCompany: 2
    });
    prisma.hunterProspectingDecision.findMany.mockResolvedValue([{
      id: "decision-1",
      status: "WOULD_PURSUE",
      companyId: "company-1",
      companyName: "Example Importer",
      recommendedPersona: "Director of Supply Chain",
      serviceLine: "WAREHOUSING",
      opportunityType: "Expansion",
      rationale: "Verified expansion",
      recommendedSender: "Alex",
      recommendedCadence: "Warehousing expansion",
      createdAt: new Date(),
      company: {
        hunterOpportunitySignals: [{
          id: "signal-1",
          sourceName: "Hunter company research",
          serviceLine: "WAREHOUSING",
          observedAt: new Date(),
          evidence: {}
        }]
      }
    }]);
    evaluateHunterOutreachEligibility.mockReturnValue({
      status: "ELIGIBLE",
      directive: {
        researchSignalId: "signal-1",
        prospectingDecisionId: "decision-1",
        recommendedPersona: "Director of Supply Chain"
      }
    });
    prisma.automationJobRun.create.mockResolvedValue({ id: "handoff-1" });

    await expect(enqueueHunterOutreachHandoff({
      tenantId: "tenant-a",
      researchRunId: "research-1",
      prospectingPlanRunId: "plan-1"
    })).resolves.toEqual({
      state: "queued",
      runId: "handoff-1",
      companyCount: 1
    });
    expect(prisma.hunterProspectingDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-a",
          jobRunId: "plan-1",
          status: "WOULD_PURSUE"
        })
      })
    );
    expect(prisma.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        jobType: "HUNTER_OUTREACH_HANDOFF",
        input: expect.objectContaining({
          researchRunId: "research-1",
          prospectingPlanRunId: "plan-1",
          maxContactsPerCompany: 2,
          forceContactReview: false,
          items: [{
            companyId: "company-1",
            companyName: "Example Importer",
            researchSignalId: "signal-1",
            prospectingDecisionId: "decision-1",
            recommendedPersona: "Director of Supply Chain"
          }]
        })
      })
    });
  });

  it("refreshes a plan from saved research before queueing current eligible opportunities", async () => {
    prisma.automationJobRun.findFirst.mockResolvedValue({ id: "research-current" });
    prisma.hunterAutomationPolicy.findUnique.mockResolvedValue({
      mode: HunterAutomationMode.ASSISTED,
      killSwitch: false,
      maxContactsPerCompany: 2
    });
    prisma.hunterProspectingDecision.findMany.mockResolvedValue([{
      id: "decision-current",
      status: "WOULD_PURSUE",
      companyId: "company-1",
      companyName: "Example Importer",
      recommendedPersona: "Director of Supply Chain",
      serviceLine: "WAREHOUSING",
      opportunityType: "Expansion",
      rationale: "Verified expansion",
      recommendedSender: "Alex",
      recommendedCadence: "Warehousing expansion",
      createdAt: new Date(),
      company: {
        hunterOpportunitySignals: [{
          id: "signal-1",
          sourceName: "Hunter company research",
          serviceLine: "WAREHOUSING",
          observedAt: new Date(),
          evidence: {}
        }]
      }
    }]);
    evaluateHunterOutreachEligibility.mockReturnValue({
      status: "ELIGIBLE",
      directive: {
        researchSignalId: "signal-1",
        prospectingDecisionId: "decision-current",
        recommendedPersona: "Director of Supply Chain"
      }
    });
    prisma.automationJobRun.create.mockResolvedValue({ id: "handoff-current" });

    await expect(queueCurrentHunterOutreachHandoff({
      tenantId: "tenant-a",
      actorUserId: "user-a"
    })).resolves.toEqual({
      state: "queued",
      runId: "handoff-current",
      companyCount: 1
    });
    expect(prisma.automationJobRun.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        jobType: "HUNTER_COMPANY_DEEP_RESEARCH",
        status: "SUCCESS"
      },
      orderBy: { finishedAt: "desc" },
      select: { id: true }
    });
    expect(runHunterDryPlan).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      actorUserId: "user-a",
      trigger: "MANUAL",
      candidateScope: "CURRENT_RESEARCHED_OUTREACH"
    });
    expect(prisma.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: expect.objectContaining({
          researchRunId: "research-current",
          prospectingPlanRunId: "plan-current",
          forceContactReview: true
        })
      })
    });
  });

  it("freezes the complete researched Hot and Qualified cohort into the Apollo job", async () => {
    prisma.automationJobRun.findFirst.mockResolvedValue({
      id: "research-current"
    });
    prisma.hunterAutomationPolicy.findUnique.mockResolvedValue({
      mode: HunterAutomationMode.ASSISTED,
      killSwitch: false,
      maxContactsPerCompany: 3
    });
    prisma.hunterProspectingDecision.findMany.mockResolvedValue(
      Array.from({ length: 14 }, (_, index) => ({
        id: `decision-${index + 1}`,
        status: "WOULD_PURSUE",
        companyId: `company-${index + 1}`,
        companyName: `Researched Company ${index + 1}`,
        recommendedPersona: "Director of Supply Chain",
        serviceLine: "WAREHOUSING",
        opportunityType: "Qualified logistics opportunity",
        rationale: "Current Qwen/Kimi research passed.",
        recommendedSender: "Alex",
        recommendedCadence: "Warehousing Opportunity",
        createdAt: new Date(),
        company: {
          hunterOpportunitySignals: [{
            id: `signal-${index + 1}`,
            sourceName: "Hunter company research",
            serviceLine: "WAREHOUSING",
            observedAt: new Date(),
            evidence: {}
          }]
        }
      }))
    );
    evaluateHunterOutreachEligibility.mockImplementation(
      ({ researchSignal, prospectingDecision }) => ({
        status: "ELIGIBLE",
        directive: {
          researchSignalId: researchSignal.id,
          prospectingDecisionId: prospectingDecision.id,
          recommendedPersona: "Director of Supply Chain"
        }
      })
    );
    prisma.automationJobRun.create.mockResolvedValue({
      id: "handoff-complete-cohort"
    });

    await expect(
      queueCurrentHunterOutreachHandoff({
        tenantId: "tenant-a",
        actorUserId: "user-a"
      })
    ).resolves.toEqual({
      state: "queued",
      runId: "handoff-complete-cohort",
      companyCount: 14
    });

    const handoffInput =
      prisma.automationJobRun.create.mock.calls[0]?.[0]?.data?.input;
    expect(handoffInput.items).toHaveLength(14);
    expect(
      handoffInput.items.map((item: { companyId: string }) => item.companyId)
    ).toEqual(
      Array.from({ length: 14 }, (_, index) => `company-${index + 1}`)
    );
  });

  it("does not create a plan or handoff without completed company research", async () => {
    prisma.automationJobRun.findFirst.mockResolvedValue(null);

    await expect(queueCurrentHunterOutreachHandoff({
      tenantId: "tenant-a",
      actorUserId: "user-a"
    })).resolves.toMatchObject({ state: "research_required" });
    expect(runHunterDryPlan).not.toHaveBeenCalled();
    expect(prisma.automationJobRun.create).not.toHaveBeenCalled();
  });
});
