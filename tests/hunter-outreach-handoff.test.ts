import { ContactStatus, ReplyStatus, SequenceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  isActionableHunterPlanState,
  isContactEligibleForFreshOutreach,
  isContactFitAutoEligible,
  isStrongHunterBuyerRole,
  readCachedContactFitReview,
  rankHunterContacts,
  shouldAdvanceHunterContactReview,
  validateExactContactFitCohort
} from "@/modules/lead-gen/hunter-outreach-handoff";
import {
  HUNTER_CONTACT_FIT_PROMPT_VERSION,
  type HunterContactFitReview
} from "@/modules/lead-gen/outreach-plan";
import type { ApolloContactRecord } from "@/server/integrations/apollo";

function contact(overrides: Partial<ApolloContactRecord>): ApolloContactRecord {
  return {
    recordSource: "SAVED_CONTACT",
    apolloContactId: "contact-1",
    apolloPersonId: "person-1",
    firstName: "Taylor",
    lastName: "Morgan",
    lastNameObfuscated: null,
    fullName: "Taylor Morgan",
    title: "Director of Supply Chain",
    department: "Operations",
    seniority: "director",
    email: "taylor@example.com",
    phone: null,
    linkedinUrl: "https://linkedin.example/taylor",
    hasEmailAvailable: true,
    hasPhoneAvailable: false,
    hasLinkedinAvailable: true,
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
        linkedinUrl: null,
        hasEmailAvailable: false,
        hasLinkedinAvailable: false
      })
    ], null);

    expect(ranked).toEqual([]);
  });

  it("uses People Search availability without treating the person as an enriched contact", () => {
    const ranked = rankHunterContacts([
      contact({
        recordSource: "PEOPLE_SEARCH",
        apolloContactId: null,
        apolloPersonId: "apollo-person-operations",
        fullName: "Jason Co***n",
        lastName: null,
        lastNameObfuscated: "Co***n",
        title: "Director of Operations",
        email: null,
        linkedinUrl: null,
        hasEmailAvailable: true,
        hasLinkedinAvailable: false
      })
    ], "Director of Operations");

    expect(ranked).toEqual([
      expect.objectContaining({
        recordSource: "PEOPLE_SEARCH",
        apolloContactId: null,
        apolloPersonId: "apollo-person-operations",
        hasEmailAvailable: true
      })
    ]);
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

  it("keeps an existing current outreach plan actionable during a contact recheck", () => {
    expect(isActionableHunterPlanState("qa_passed")).toBe(true);
    expect(isActionableHunterPlanState("qa_failed")).toBe(true);
    expect(isActionableHunterPlanState("already_generated")).toBe(true);
    expect(isActionableHunterPlanState("not_required")).toBe(false);
    expect(isActionableHunterPlanState("unranked")).toBe(false);
    expect(isActionableHunterPlanState("ineligible")).toBe(false);
    expect(isActionableHunterPlanState("sequence_missing")).toBe(false);
    expect(isActionableHunterPlanState("evidence_missing")).toBe(false);
  });

  it("keeps obvious buyer roles available for human review when the model is conservative", () => {
    expect(isStrongHunterBuyerRole({
      title: "Supply Chain and Logistics Manager",
      department: "Operations"
    })).toBe(true);
    expect(isStrongHunterBuyerRole({
      title: "Shipping Receiving Manager",
      department: "Operations"
    })).toBe(true);
    expect(isStrongHunterBuyerRole({
      title: "Vice President of Sales",
      department: "Sales"
    })).toBe(false);
    expect(isStrongHunterBuyerRole({
      title: "Warehouse Associate",
      department: "Operations"
    })).toBe(false);
    expect(isStrongHunterBuyerRole({
      title: "Digital Operations Manager",
      department: "Ecommerce"
    })).toBe(false);
    expect(isStrongHunterBuyerRole({
      title: "Franchise Operations Manager",
      department: "Operations"
    })).toBe(false);

    expect(shouldAdvanceHunterContactReview({
      contactId: "contact-1",
      disposition: "REVIEW",
      confidence: 55,
      responsibilityHypothesis: "Role ownership needs human confirmation.",
      rationale: "The model was conservative.",
      recommendedApproach: "Ask whether this person owns the lane.",
      riskFlags: []
    }, {
      title: "Distribution Manager",
      department: "Operations",
      contactStatus: ContactStatus.REVIEWING,
      sequenceStatus: SequenceStatus.FINISHED,
      replyStatus: ReplyStatus.NO_REPLY
    })).toBe(true);

    expect(shouldAdvanceHunterContactReview({
      contactId: "contact-2",
      disposition: "PRIMARY",
      confidence: 95,
      responsibilityHypothesis: "Likely owner.",
      rationale: "Role aligns.",
      recommendedApproach: "Ask a bounded ownership question.",
      riskFlags: []
    }, {
      title: "Supply Chain Director",
      department: "Operations",
      contactStatus: ContactStatus.REVIEWING,
      sequenceStatus: SequenceStatus.FINISHED,
      replyStatus: ReplyStatus.REPLIED
    })).toBe(false);

    expect(shouldAdvanceHunterContactReview({
      contactId: "contact-3",
      disposition: "PRIMARY",
      confidence: 95,
      responsibilityHypothesis: "Role may own operations.",
      rationale: "Title is senior.",
      recommendedApproach: "Ask about the expansion.",
      riskFlags: ["GEOGRAPHY_MISMATCH"]
    }, {
      title: "Franchise Operations Manager",
      department: "Operations",
      contactStatus: ContactStatus.REVIEWING,
      sequenceStatus: SequenceStatus.NOT_STARTED,
      replyStatus: ReplyStatus.NO_REPLY
    })).toBe(false);
  });

  it("allows prior cadence history but hard-excludes replies, bounces, and do-not-contact records", () => {
    expect(isContactEligibleForFreshOutreach({
      contactStatus: ContactStatus.REVIEWING,
      sequenceStatus: SequenceStatus.NOT_STARTED,
      replyStatus: ReplyStatus.NO_REPLY
    })).toBe(true);
    expect(isContactEligibleForFreshOutreach({
      contactStatus: ContactStatus.REVIEWING,
      sequenceStatus: SequenceStatus.READY,
      replyStatus: ReplyStatus.NO_REPLY
    })).toBe(true);
    expect(isContactEligibleForFreshOutreach({
      contactStatus: ContactStatus.REVIEWING,
      sequenceStatus: SequenceStatus.ENROLLED,
      replyStatus: ReplyStatus.NO_REPLY
    })).toBe(true);
    expect(isContactEligibleForFreshOutreach({
      contactStatus: ContactStatus.REVIEWING,
      sequenceStatus: SequenceStatus.FINISHED,
      replyStatus: ReplyStatus.NO_REPLY
    })).toBe(true);
    expect(isContactEligibleForFreshOutreach({
      contactStatus: ContactStatus.REVIEWING,
      sequenceStatus: SequenceStatus.NOT_STARTED,
      replyStatus: ReplyStatus.REPLIED
    })).toBe(false);
    expect(isContactEligibleForFreshOutreach({
      contactStatus: ContactStatus.DO_NOT_CONTACT,
      sequenceStatus: SequenceStatus.FINISHED,
      replyStatus: ReplyStatus.NO_REPLY
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
