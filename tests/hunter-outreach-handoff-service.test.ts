import { HunterAutomationMode } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  apolloCompanyMatch: { findMany: vi.fn() },
  hunterAutomationPolicy: { findUnique: vi.fn() },
  tradeMiningScoringConfig: { findUnique: vi.fn() },
  automationJobRun: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn()
  },
  hunterProspectingDecision: {
    findFirst: vi.fn(),
    findMany: vi.fn()
  },
  auditLog: { create: vi.fn() }
}));
const evaluateHunterOutreachEligibility = vi.hoisted(() => vi.fn());
const isOpenAiDraftGenerationConfigured = vi.hoisted(() => vi.fn());
const runHunterDryPlan = vi.hoisted(() => vi.fn());
const readApolloAccountIdFromMatchQuery = vi.hoisted(() => vi.fn());
const readReviewerConfirmedApolloOrganizationIdFromMatchQuery = vi.hoisted(() => vi.fn());

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
  MANUAL_APOLLO_COMPANY_MAPPING_REASON:
    "manually confirmed from Apollo company URL",
  fetchApolloContactsForCompany: vi.fn(),
  readApolloAccountIdFromMatchQuery,
  readReviewerConfirmedApolloOrganizationIdFromMatchQuery
}));

import {
  enqueueHunterCompanyOutreachHandoff,
  enqueueHunterOutreachHandoff,
  loadReviewerConfirmedApolloCompanyMapping,
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

  it("loads an older reviewer-confirmed mapping independently of bounded retry history", async () => {
    prisma.apolloCompanyMatch.findMany.mockResolvedValue([
      {
        apolloOrganizationId: "54a134c369702d4255de4600",
        matchReason: "automatic direct-company retry",
        queryJson: { source: "automatic-apollo-recheck" }
      },
      {
        // Apollo can persist the reviewed Account identity separately from
        // the canonical global organization later stored on Company.
        apolloOrganizationId: "6888f2e0496bf40001170587",
        matchReason:
          "direct company; manually confirmed from Apollo company URL",
        queryJson: {
          source: "manual-apollo-url",
          resource_type: "ACCOUNT",
          supplied_id: "6888f2e0496bf40001170587"
        }
      }
    ]);
    readApolloAccountIdFromMatchQuery
      .mockReturnValueOnce(null)
      .mockReturnValueOnce("6888f2e0496bf40001170587");
    readReviewerConfirmedApolloOrganizationIdFromMatchQuery
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    await expect(loadReviewerConfirmedApolloCompanyMapping({
      tenantId: "tenant-a",
      companyId: "company-cefla",
      apolloOrganizationId: "54a134c369702d4255de4600"
    })).resolves.toEqual({
      apolloAccountId: "6888f2e0496bf40001170587",
      apolloOrganizationId: "54a134c369702d4255de4600"
    });
    expect(prisma.apolloCompanyMatch.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        companyId: "company-cefla",
        classification: "DIRECT_COMPANY",
        reviewedAt: { not: null },
        reviewedByUserId: { not: null }
      },
      orderBy: { createdAt: "desc" },
      select: {
        apolloOrganizationId: true,
        matchReason: true,
        queryJson: true
      }
    });
  });

  it("uses the reviewed organization row for legacy mappings without typed query metadata", async () => {
    prisma.apolloCompanyMatch.findMany.mockResolvedValue([{
      apolloOrganizationId: "54a134c369702d4255de4600",
      matchReason:
        "direct company; manually confirmed from Apollo company URL",
      queryJson: { source: "manual-apollo-url" }
    }]);
    readApolloAccountIdFromMatchQuery.mockReturnValue(null);
    readReviewerConfirmedApolloOrganizationIdFromMatchQuery.mockReturnValue(
      null
    );

    await expect(loadReviewerConfirmedApolloCompanyMapping({
      tenantId: "tenant-a",
      companyId: "company-legacy",
      apolloOrganizationId: "54a134c369702d4255de4600"
    })).resolves.toEqual({
      apolloAccountId: null,
      apolloOrganizationId: "54a134c369702d4255de4600"
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

  it("queues a forced one-company review and never exceeds the three-contact ceiling", async () => {
    prisma.hunterAutomationPolicy.findUnique.mockResolvedValue({
      mode: HunterAutomationMode.ASSISTED,
      killSwitch: false,
      maxContactsPerCompany: 9
    });
    prisma.hunterProspectingDecision.findFirst.mockResolvedValue({
      id: "decision-target",
      status: "WOULD_PURSUE",
      companyId: "company-target",
      companyName: "Target Importer",
      recommendedPersona: "Director of Supply Chain",
      serviceLine: "WAREHOUSING",
      opportunityType: "Expansion",
      rationale: "Verified warehouse expansion",
      recommendedSender: "Alex",
      recommendedCadence: "Hunter - Email Only",
      createdAt: new Date(),
      jobRunId: "plan-target",
      company: {
        hunterOpportunitySignals: [{
          id: "signal-target",
          sourceName: "Hunter company research",
          serviceLine: "WAREHOUSING",
          observedAt: new Date(),
          evidence: {}
        }]
      }
    });
    evaluateHunterOutreachEligibility.mockReturnValue({
      status: "ELIGIBLE",
      directive: {
        researchSignalId: "signal-target",
        prospectingDecisionId: "decision-target",
        recommendedPersona: "Director of Supply Chain"
      }
    });
    prisma.automationJobRun.create.mockResolvedValue({ id: "handoff-target" });

    await expect(enqueueHunterCompanyOutreachHandoff({
      tenantId: "tenant-a",
      companyId: "company-target",
      authorizePaidEmailEnrichment: true,
      explicitApolloPersonIds: [
        "6138684489ec360001a60945",
        "6107e3c693686100019d55e1"
      ]
    })).resolves.toEqual({
      state: "queued",
      runId: "handoff-target",
      companyCount: 1
    });
    expect(prisma.hunterProspectingDecision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-a",
          companyId: "company-target"
        },
        orderBy: { createdAt: "desc" }
      })
    );
    expect(prisma.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        jobType: "HUNTER_OUTREACH_HANDOFF",
        input: expect.objectContaining({
          source: "MANUAL_APOLLO_MAPPING_OR_RECHECK",
          prospectingPlanRunId: "plan-target",
          maxContactsPerCompany: 3,
          forceContactReview: true,
          authorizePaidEmailEnrichment: true,
          explicitApolloPersonIds: [
            "6138684489ec360001a60945",
            "6107e3c693686100019d55e1"
          ],
          items: [{
            companyId: "company-target",
            companyName: "Target Importer",
            researchSignalId: "signal-target",
            prospectingDecisionId: "decision-target",
            recommendedPersona: "Director of Supply Chain"
          }]
        })
      })
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        after: expect.objectContaining({
          explicitApolloPersonCount: 2
        })
      })
    });
  });

  it("requires explicit paid authorization and caps reviewer-selected Apollo people at three", async () => {
    await expect(enqueueHunterCompanyOutreachHandoff({
      tenantId: "tenant-a",
      companyId: "company-target",
      explicitApolloPersonIds: ["6138684489ec360001a60945"]
    })).rejects.toThrow("Authorize email-only Apollo enrichment");

    await expect(enqueueHunterCompanyOutreachHandoff({
      tenantId: "tenant-a",
      companyId: "company-target",
      authorizePaidEmailEnrichment: true,
      explicitApolloPersonIds: [
        "61718465010e6e0001cf807a",
        "6138684489ec360001a60945",
        "54a230b67468693825efd714",
        "6107e3c693686100019d55e1"
      ]
    })).rejects.toThrow("Select no more than 3");

    expect(prisma.hunterAutomationPolicy.findUnique).not.toHaveBeenCalled();
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
      candidateScope: "CURRENT_RESEARCHED_OUTREACH",
      researchRunId: "research-current"
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
