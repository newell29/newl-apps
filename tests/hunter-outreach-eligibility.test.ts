import {
  HunterDecisionStatus,
  HunterServiceLine
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  evaluateHunterOutreachEligibility,
  type HunterOpportunityTier
} from "@/modules/lead-gen/hunter-outreach-eligibility";

const NOW = new Date("2026-07-27T14:00:00.000Z");

describe("Hunter outreach eligibility", () => {
  it("allows a fresh selected hot opportunity with Kimi confirmation", () => {
    const eligibility = evaluateHunterOutreachEligibility({
      researchSignal: researchSignal("HOT_OPPORTUNITY"),
      prospectingDecision: decision(),
      now: NOW
    });

    expect(eligibility.status).toBe("ELIGIBLE");
    expect(eligibility.directive).toMatchObject({
      opportunityTier: "HOT_OPPORTUNITY",
      requiredServiceLine: HunterServiceLine.WAREHOUSING,
      opportunityType: "Charlotte inventory expansion",
      finalScore: 86,
      finalConfidence: 82
    });
  });

  it("allows a qualified current account when Kimi was not selected", () => {
    const eligibility = evaluateHunterOutreachEligibility({
      researchSignal: researchSignal("QUALIFIED_CURRENT_ACCOUNT", {
        validation: {
          status: "NOT_SELECTED",
          disposition: null
        }
      }),
      prospectingDecision: decision(),
      now: NOW
    });

    expect(eligibility.status).toBe("ELIGIBLE");
  });

  it.each([
    [null, null, "NEEDS_HUNTER_ASSESSMENT"],
    [researchSignal("WATCHLIST"), null, "WATCHLIST"],
    [researchSignal("BLOCKED"), null, "BLOCKED"]
  ] as const)("blocks legacy and non-outreach tiers", (researchSignalValue, decisionValue, expected) => {
    expect(
      evaluateHunterOutreachEligibility({
        researchSignal: researchSignalValue,
        prospectingDecision: decisionValue,
        now: NOW
      }).status
    ).toBe(expected);
  });

  it("requires the current Hunter planner to select the company", () => {
    expect(
      evaluateHunterOutreachEligibility({
        researchSignal: researchSignal("HOT_OPPORTUNITY"),
        prospectingDecision: {
          ...decision(),
          status: HunterDecisionStatus.NEEDS_RESEARCH
        },
        now: NOW
      }).status
    ).toBe("NOT_SELECTED");
  });

  it("requires hot opportunities to have Kimi confirmation", () => {
    expect(
      evaluateHunterOutreachEligibility({
        researchSignal: researchSignal("HOT_OPPORTUNITY", {
          validation: {
            status: "VALIDATED",
            disposition: "DOWNRANK"
          }
        }),
        prospectingDecision: decision(),
        now: NOW
      }).status
    ).toBe("INVALID_HANDOFF");
  });

  it.each([
    {
      label: "Qwen",
      models: {
        synthesis: {
          provider: "OLLAMA",
          name: "llama3.3:70b"
        },
        scoring: {
          provider: "KIMI",
          name: "kimi-k2.6"
        }
      }
    },
    {
      label: "Kimi",
      models: {
        synthesis: {
          provider: "OLLAMA",
          name: "qwen3.5:35b"
        },
        scoring: {
          provider: "KIMI",
          name: "moonshot-v1"
        }
      }
    }
  ])("fails closed when the saved $label model family is missing", ({ models }) => {
    expect(
      evaluateHunterOutreachEligibility({
        researchSignal: researchSignal("QUALIFIED_CURRENT_ACCOUNT", { models }),
        prospectingDecision: decision(),
        now: NOW
      }).status
    ).toBe("INVALID_HANDOFF");
  });

  it("blocks stale research and service-line drift", () => {
    expect(
      evaluateHunterOutreachEligibility({
        researchSignal: researchSignal("HOT_OPPORTUNITY", {
          retrievedAt: "2026-06-01T12:00:00.000Z"
        }),
        prospectingDecision: decision(),
        now: NOW
      }).status
    ).toBe("STALE_RESEARCH");

    expect(
      evaluateHunterOutreachEligibility({
        researchSignal: researchSignal("HOT_OPPORTUNITY"),
        prospectingDecision: {
          ...decision(),
          serviceLine: HunterServiceLine.OCEAN_AIR
        },
        now: NOW
      }).status
    ).toBe("INVALID_HANDOFF");
  });
});

function researchSignal(
  opportunityTier: HunterOpportunityTier,
  overrides: Record<string, unknown> = {}
) {
  const research = {
    retrievedAt: "2026-07-26T12:00:00.000Z",
    opportunityTier,
    finalScore: 86,
    finalConfidence: 82,
    deterministicGate: {
      passed: opportunityTier !== "BLOCKED"
    },
    synthesis: {
      serviceLine: HunterServiceLine.WAREHOUSING
    },
    scoring: {
      serviceLine: HunterServiceLine.WAREHOUSING,
      opportunityType: "Charlotte inventory expansion",
      rationale: "Recent expansion evidence supports a flexible warehousing conversation."
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
    },
    ...overrides
  };
  return {
    id: "signal-1",
    sourceName: "Hunter company research",
    serviceLine: HunterServiceLine.WAREHOUSING,
    observedAt: new Date("2026-07-26T12:05:00.000Z"),
    evidence: {
      research
    }
  };
}

function decision() {
  return {
    id: "decision-1",
    status: HunterDecisionStatus.WOULD_PURSUE,
    serviceLine: HunterServiceLine.WAREHOUSING,
    opportunityType: "Charlotte inventory expansion",
    rationale: "Lead with flexible Charlotte-area warehousing capacity.",
    recommendedPersona: "VP Supply Chain",
    recommendedSender: "Operations leader",
    recommendedCadence: "Warehouse Expansion",
    createdAt: new Date("2026-07-26T12:10:00.000Z")
  };
}
