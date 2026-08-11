import {
  ApolloCompanyMatchClassification,
  HunterAutomationMode,
  HunterDecisionStatus,
  HunterServiceLine
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  hunterAutomationPolicy: { findUnique: vi.fn() },
  automationJobRun: {
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn()
  },
  company: {
    findMany: vi.fn(),
    findFirst: vi.fn()
  }
}));
const evaluateHunterOutreachEligibility = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({ prisma }));
vi.mock("@/modules/lead-gen/hunter-outreach-eligibility", () => ({
  evaluateHunterOutreachEligibility,
  getHunterOutreachResearchMaxAgeDays: () => 30
}));
vi.mock("@/modules/lead-gen/hunter-outreach-handoff", () => ({
  enqueueHunterCompanyOutreachHandoff: vi.fn()
}));
vi.mock("@/server/integrations/apollo", () => ({
  resolveApolloOrganizationForCompany: vi.fn()
}));
vi.mock("@/server/integrations/openai-apollo-identity", () => ({
  APOLLO_IDENTITY_RESOLUTION_MODEL: "gpt-5.6-luna",
  APOLLO_IDENTITY_RESOLUTION_PROMPT_VERSION: "apollo-exception-identity-v1",
  generateApolloIdentityResolution: vi.fn()
}));

import { prepareNextApolloExceptionResolution } from "@/modules/lead-gen/apollo-exception-autopilot";
import { APOLLO_ZERO_CONTACT_REVIEW_REASON } from "@/modules/lead-gen/apollo-contact-discovery-review";

describe("Apollo exception autopilot idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HUNTER_APOLLO_EXCEPTION_AUTOPILOT_ENABLED", "true");
    prisma.hunterAutomationPolicy.findUnique.mockResolvedValue({
      mode: HunterAutomationMode.ASSISTED,
      killSwitch: false
    });
    prisma.automationJobRun.updateMany.mockResolvedValue({ count: 1 });
    prisma.automationJobRun.findFirst.mockResolvedValue(null);
    prisma.automationJobRun.count.mockResolvedValue(0);
    evaluateHunterOutreachEligibility.mockReturnValue({ status: "ELIGIBLE" });
    prisma.company.findMany.mockResolvedValue([companyQueueRow()]);
    prisma.company.findFirst.mockResolvedValue(companyPacketRow());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not repeat the same public-identity packet until the source match or research changes", async () => {
    let createdInput: Record<string, unknown> | null = null;
    prisma.automationJobRun.findMany
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => Promise.resolve(
        createdInput ? [{ input: createdInput }] : []
      ));
    prisma.automationJobRun.create.mockImplementation(async ({ data }) => {
      createdInput = data.input as Record<string, unknown>;
      return { id: "resolution-1", ...data };
    });

    const first = await prepareNextApolloExceptionResolution({ tenantId: "tenant-a" });
    const second = await prepareNextApolloExceptionResolution({ tenantId: "tenant-a" });

    expect(first).toMatchObject({ state: "prepared", runId: "resolution-1" });
    expect(second).toMatchObject({ state: "idle" });
    expect(prisma.automationJobRun.create).toHaveBeenCalledTimes(1);
  });

  it("prepares one fresh resolver pass for a legacy low-score empty Apollo shell", async () => {
    prisma.company.findMany.mockResolvedValue([companyQueueRow({ emptyShell: true })]);
    prisma.company.findFirst.mockResolvedValue(companyPacketRow({ emptyShell: true }));
    prisma.automationJobRun.findMany.mockResolvedValue([]);
    prisma.automationJobRun.create.mockImplementation(async ({ data }) => ({
      id: "resolution-shell",
      ...data
    }));

    await expect(
      prepareNextApolloExceptionResolution({ tenantId: "tenant-a" })
    ).resolves.toMatchObject({
      state: "prepared",
      runId: "resolution-shell"
    });
  });
});

function companyQueueRow({ emptyShell = false } = {}) {
  return {
    id: "company-1",
    name: "EXAMPLE DISTRIBUTION LLC",
    normalizedName: "example-distribution-llc",
    domain: null,
    primaryIndustry: "Retail",
    apolloOrganizationId: emptyShell ? "apollo-empty-shell" : null,
    apolloCompanyMatches: [{
      id: "match-1",
      classification: emptyShell
        ? ApolloCompanyMatchClassification.DIRECT_COMPANY
        : ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW,
      apolloDomain: null,
      score: emptyShell ? 19 : 4,
      matchReason: emptyShell ? APOLLO_ZERO_CONTACT_REVIEW_REASON : "Review required.",
      reviewedAt: null,
      queryJson: { identity_resolver: { candidates: [] } },
      createdAt: new Date("2026-08-02T11:00:00.000Z")
    }],
    hunterOpportunitySignals: [researchSignal()],
    hunterProspectingDecisions: [prospectingDecision()]
  };
}

function companyPacketRow({ emptyShell = false } = {}) {
  return {
    id: "company-1",
    name: "EXAMPLE DISTRIBUTION LLC",
    normalizedName: "example-distribution-llc",
    domain: null,
    primaryIndustry: "Retail",
    apolloOrganizationId: emptyShell ? "apollo-empty-shell" : null,
    importRecords: [{
      destinationCity: "Charlotte",
      destinationState: "North Carolina",
      originCountry: "Vietnam"
    }],
    apolloCompanyMatches: [{
      id: "match-1",
      classification: emptyShell
        ? ApolloCompanyMatchClassification.DIRECT_COMPANY
        : ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW,
      apolloDomain: null,
      score: emptyShell ? 19 : 4,
      matchReason: emptyShell ? APOLLO_ZERO_CONTACT_REVIEW_REASON : "Review required.",
      reviewedAt: null,
      queryJson: { identity_resolver: { candidates: [] } }
    }],
    hunterOpportunitySignals: [researchSignal()],
    hunterProspectingDecisions: [prospectingDecision()]
  };
}

function researchSignal() {
  return {
    id: "signal-1",
    sourceName: "Hunter company research",
    serviceLine: HunterServiceLine.WAREHOUSING,
    observedAt: new Date("2026-08-02T10:00:00.000Z"),
    evidence: {}
  };
}

function prospectingDecision() {
  return {
    id: "decision-1",
    status: HunterDecisionStatus.WOULD_PURSUE,
    companyId: "company-1",
    companyName: "EXAMPLE DISTRIBUTION LLC",
    recommendedPersona: "Director of Supply Chain",
    serviceLine: HunterServiceLine.WAREHOUSING,
    opportunityType: "Expansion",
    rationale: "Verified current demand",
    recommendedSender: "Alex",
    recommendedCadence: "Hunter - Email Only",
    createdAt: new Date("2026-08-02T10:05:00.000Z"),
    jobRunId: "research-run-1"
  };
}
