import { ReplyStatus, SequenceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  isContactEligibleForFreshOutreach,
  isContactFitAutoEligible,
  readCachedContactFitReview,
  rankHunterContacts,
  validateExactContactFitCohort
} from "@/modules/lead-gen/hunter-outreach-handoff";
import {
  HUNTER_CONTACT_FIT_PROMPT_VERSION,
  type HunterContactFitReview
} from "@/modules/lead-gen/outreach-plan";
import type { ApolloContactRecord } from "@/server/integrations/apollo";

function contact(overrides: Partial<ApolloContactRecord>): ApolloContactRecord {
  return {
    apolloContactId: "contact-1",
    apolloPersonId: "person-1",
    firstName: "Taylor",
    lastName: "Morgan",
    fullName: "Taylor Morgan",
    title: "Director of Supply Chain",
    department: "Operations",
    seniority: "director",
    email: "taylor@example.com",
    phone: null,
    linkedinUrl: "https://linkedin.example/taylor",
    city: "Charlotte",
    state: "North Carolina",
    country: "United States",
    sequenceStatus: SequenceStatus.NOT_STARTED,
    replyStatus: ReplyStatus.NO_REPLY,
    sequenceId: null,
    sequenceName: null,
    sequenceOwnerName: null,
    sequenceOwnerUserId: null,
    lastTouchAt: null,
    lastReplyAt: null,
    rawPayload: {},
    ...overrides
  };
}

describe("Hunter assisted outreach handoff", () => {
  it("prioritizes the research persona and excludes seller-side contacts", () => {
    const ranked = rankHunterContacts([
      contact({
        apolloContactId: "seller",
        fullName: "Seller Person",
        title: "VP of Business Development"
      }),
      contact({
        apolloContactId: "warehouse",
        fullName: "Warehouse Buyer",
        title: "Director of Warehousing and Distribution"
      }),
      contact({
        apolloContactId: "manager",
        fullName: "Operations Buyer",
        title: "Operations Manager"
      })
    ], "Director of warehousing and distribution");

    expect(ranked.map((item) => item.apolloContactId)).toEqual(["warehouse", "manager"]);
  });

  it("requires an Apollo identity and a minimum deterministic buyer score", () => {
    const ranked = rankHunterContacts([
      contact({
        apolloContactId: null,
        apolloPersonId: null,
        email: "unmapped@example.com"
      }),
      contact({
        apolloContactId: "weak",
        apolloPersonId: "weak-person",
        title: "Intern",
        department: null,
        email: null,
        linkedinUrl: null
      })
    ], null);

    expect(ranked).toEqual([]);
  });

  it("prefers opportunity geography and penalizes prior cadence history", () => {
    const ranked = rankHunterContacts([
      contact({
        apolloContactId: "old-executive",
        fullName: "Old Executive",
        title: "Vice President of Supply Chain",
        city: "New York",
        state: "New York",
        sequenceStatus: SequenceStatus.FINISHED,
        rawPayload: { stage: { name: "Unresponsive" } }
      }),
      contact({
        apolloContactId: "local-manager",
        fullName: "Local Manager",
        title: "Warehouse Operations Manager",
        city: "Fort Mill",
        state: "South Carolina"
      })
    ], "warehouse operations", "Fort Mill expansion beside Charlotte");

    expect(ranked.map((item) => item.apolloContactId)).toEqual([
      "local-manager",
      "old-executive"
    ]);
  });

  it("automates only confident primary and strong secondary model reviews", () => {
    const review = {
      contactId: "contact-1",
      responsibilityHypothesis: "Likely capacity owner.",
      rationale: "Role aligns.",
      recommendedApproach: "Ask a bounded ownership question.",
      riskFlags: []
    };

    expect(isContactFitAutoEligible({
      ...review,
      disposition: "PRIMARY",
      confidence: 70
    })).toBe(true);
    expect(isContactFitAutoEligible({
      ...review,
      disposition: "PRIMARY",
      confidence: 69
    })).toBe(false);
    expect(isContactFitAutoEligible({
      ...review,
      disposition: "SECONDARY",
      confidence: 80
    })).toBe(true);
    expect(isContactFitAutoEligible({
      ...review,
      disposition: "SECONDARY",
      confidence: 79
    })).toBe(false);
    expect(isContactFitAutoEligible({
      ...review,
      disposition: "REVIEW",
      confidence: 100
    })).toBe(false);
    expect(isContactFitAutoEligible({
      ...review,
      disposition: "REJECT",
      confidence: 100
    })).toBe(false);
  });

  it("hard-excludes replied and previously enrolled contacts from fresh outreach", () => {
    expect(isContactEligibleForFreshOutreach({
      sequenceStatus: SequenceStatus.NOT_STARTED,
      replyStatus: ReplyStatus.NO_REPLY
    })).toBe(true);
    expect(isContactEligibleForFreshOutreach({
      sequenceStatus: SequenceStatus.READY,
      replyStatus: ReplyStatus.NO_REPLY
    })).toBe(true);
    expect(isContactEligibleForFreshOutreach({
      sequenceStatus: SequenceStatus.ENROLLED,
      replyStatus: ReplyStatus.NO_REPLY
    })).toBe(false);
    expect(isContactEligibleForFreshOutreach({
      sequenceStatus: SequenceStatus.NOT_STARTED,
      replyStatus: ReplyStatus.REPLIED
    })).toBe(false);
  });

  it("requires the exact contact cohort and reuses only the current decision review", () => {
    const review: HunterContactFitReview = {
      contactId: "contact-1",
      disposition: "PRIMARY",
      confidence: 88,
      responsibilityHypothesis: "Likely capacity owner.",
      rationale: "Role aligns.",
      recommendedApproach: "Ask a bounded ownership question.",
      riskFlags: []
    };
    expect(() => validateExactContactFitCohort(
      ["contact-1", "contact-2"],
      [review, { ...review, contactId: "contact-1" }]
    )).toThrow("exact tenant contact cohort");
    expect(() => validateExactContactFitCohort(
      ["contact-1"],
      [{ ...review, contactId: "foreign-contact" }]
    )).toThrow("exact tenant contact cohort");

    const rawJson = {
      hunterContactFit: {
        ...review,
        promptVersion: HUNTER_CONTACT_FIT_PROMPT_VERSION,
        prospectingDecisionId: "decision-1"
      }
    };
    expect(readCachedContactFitReview(rawJson, "decision-1")).toEqual(review);
    expect(readCachedContactFitReview(rawJson, "decision-2")).toBeNull();
  });
});
