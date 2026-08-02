import {
  ApolloCompanyMatchClassification,
  HunterDecisionStatus,
  HunterServiceLine
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  evaluateCurrentHunterApolloException,
  resolveApolloReviewQueueStatus,
  summarizeApolloIdentityResolutionMetrics
} from "@/modules/lead-gen/queries";

const NOW = new Date("2026-07-28T18:00:00.000Z");

describe("current Hunter Apollo exception filtering", () => {
  it("includes an unresolved match only after the Qwen/Kimi Hunter handoff is eligible", () => {
    const eligibility = evaluateCurrentHunterApolloException({
      classification: ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW,
      researchSignal: researchSignal(),
      prospectingDecision: prospectingDecision(),
      now: NOW
    });

    expect(eligibility).toMatchObject({
      status: "ELIGIBLE",
      label: "Hunter hot opportunity"
    });
  });

  it("removes legacy lead-workflow matches that have no current Hunter assessment", () => {
    expect(
      evaluateCurrentHunterApolloException({
        classification: ApolloCompanyMatchClassification.NO_MATCH,
        researchSignal: null,
        prospectingDecision: null,
        now: NOW
      })
    ).toBeNull();
  });

  it("removes direct matches and companies Hunter did not select", () => {
    expect(
      evaluateCurrentHunterApolloException({
        classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
        researchSignal: researchSignal(),
        prospectingDecision: prospectingDecision(),
        now: NOW
      })
    ).toBeNull();

    expect(
      evaluateCurrentHunterApolloException({
        classification: ApolloCompanyMatchClassification.NO_MATCH,
        researchSignal: researchSignal(),
        prospectingDecision: {
          ...prospectingDecision(),
          status: HunterDecisionStatus.NEEDS_RESEARCH
        },
        now: NOW
      })
    ).toBeNull();
  });

  it("retains a current Hunter company when a direct Apollo match returned zero employees", () => {
    const eligibility = evaluateCurrentHunterApolloException({
      classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
      mappedZeroEmployees: true,
      researchSignal: researchSignal(),
      prospectingDecision: prospectingDecision(),
      now: NOW
    });

    expect(eligibility).toMatchObject({
      status: "ELIGIBLE",
      label: "Hunter hot opportunity"
    });
  });
});

describe("Apollo review queue states", () => {
  it("separates a mapped zero-employee organization from unmapped exceptions", () => {
    expect(
      resolveApolloReviewQueueStatus({
        apolloOrganizationId: "apollo-org-1",
        classification: ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW,
        matchReason:
          "Exact company; Apollo verified the company but returned zero employees. Open the company in Apollo, select its People page, and paste that Apollo company URL for manual verification.",
        reviewedAt: null
      })
    ).toBe("MAPPED_NO_EMPLOYEES");
  });

  it("recognizes the direct-match zero-employee record written by contact discovery", () => {
    expect(
      resolveApolloReviewQueueStatus({
        apolloOrganizationId: "apollo-org-yat",
        classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
        matchReason:
          "direct company; Apollo verified the company but returned zero employees. Open the company in Apollo, select its People page, and paste that Apollo company URL for manual verification.",
        reviewedAt: null
      })
    ).toBe("MAPPED_NO_EMPLOYEES");
  });

  it("moves an archived mapped zero-employee company out of active exceptions", () => {
    expect(
      resolveApolloReviewQueueStatus({
        apolloOrganizationId: "apollo-org-celgard",
        classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
        matchReason:
          "direct company; Apollo verified the company but returned zero employees. Open the company in Apollo, select its People page, and paste that Apollo company URL for manual verification.",
        reviewedAt: new Date("2026-07-30T20:00:00.000Z")
      })
    ).toBe("CONFIRMED_NO_MATCH");
  });

  it("does not offer mapped-company employee recovery for an unresolved match without the zero-employee marker", () => {
    expect(
      resolveApolloReviewQueueStatus({
        apolloOrganizationId: "apollo-org-1",
        classification: ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW,
        matchReason: "Partial name match requires review.",
        reviewedAt: null
      })
    ).toBe("NEEDS_REVIEW");
  });
});

describe("Apollo identity resolution metrics", () => {
  it("measures only versioned resolver outcomes", () => {
    expect(
      summarizeApolloIdentityResolutionMetrics([
        { identity_resolver: { version: 1, confidence_band: "AUTO_MATCH" } },
        { identity_resolver: { version: 1, confidence_band: "AUTO_MATCH" } },
        { identity_resolver: { version: 1, confidence_band: "MANUAL_REVIEW" } },
        { identity_resolver: { version: 1, confidence_band: "REJECT" } },
        { q_organization_name: "legacy match" },
        null
      ])
    ).toEqual({
      evaluated: 4,
      autoMatched: 2,
      manualReview: 1,
      rejected: 1,
      autoMatchRate: 50,
      manualReviewRate: 25
    });
  });
});

function researchSignal() {
  return {
    id: "signal-1",
    sourceName: "Hunter company research",
    serviceLine: HunterServiceLine.WAREHOUSING,
    observedAt: new Date("2026-07-28T16:00:00.000Z"),
    evidence: {
      research: {
        retrievedAt: "2026-07-28T15:55:00.000Z",
        opportunityTier: "HOT_OPPORTUNITY",
        finalScore: 84,
        finalConfidence: 79,
        deterministicGate: {
          passed: true
        },
        synthesis: {
          serviceLine: HunterServiceLine.WAREHOUSING
        },
        scoring: {
          serviceLine: HunterServiceLine.WAREHOUSING,
          opportunityType: "Charlotte-area warehouse expansion",
          rationale: "Verified expansion and active import demand."
        },
        validation: {
          status: "VALIDATED",
          disposition: "CONFIRM"
        },
        models: {
          synthesis: {
            provider: "OLLAMA",
            name: "qwen3.5:35b"
          },
          scoring: {
            provider: "KIMI",
            name: "kimi-k2.6"
          }
        }
      }
    }
  };
}

function prospectingDecision() {
  return {
    id: "decision-1",
    status: HunterDecisionStatus.WOULD_PURSUE,
    serviceLine: HunterServiceLine.WAREHOUSING,
    opportunityType: "Charlotte-area warehouse expansion",
    rationale: "Lead with flexible capacity near Charlotte.",
    recommendedPersona: "VP Supply Chain",
    recommendedSender: "Alex",
    recommendedCadence: "Hunter - Executive Referral",
    createdAt: new Date("2026-07-28T16:05:00.000Z")
  };
}
