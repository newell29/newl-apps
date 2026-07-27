import { HunterAutomationMode } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  hunterAutomationPolicy: { findUnique: vi.fn() },
  tradeMiningScoringConfig: { findUnique: vi.fn() },
  automationJobRun: {
    findMany: vi.fn(),
    create: vi.fn()
  },
  hunterProspectingDecision: { findMany: vi.fn() },
  auditLog: { create: vi.fn() }
}));
const evaluateHunterOutreachEligibility = vi.hoisted(() => vi.fn());
const isOpenAiDraftGenerationConfigured = vi.hoisted(() => vi.fn());

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
vi.mock("@/server/integrations/apollo", () => ({
  ApolloRateLimitError: class ApolloRateLimitError extends Error {},
  fetchApolloContactsForCompany: vi.fn()
}));

import { enqueueHunterOutreachHandoff } from "@/modules/lead-gen/hunter-outreach-handoff";

describe("Hunter assisted handoff queueing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isOpenAiDraftGenerationConfigured.mockReturnValue(true);
    prisma.tradeMiningScoringConfig.findUnique.mockResolvedValue({
      aiClassificationEnabled: true
    });
    prisma.automationJobRun.findMany.mockResolvedValue([]);
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
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
});
