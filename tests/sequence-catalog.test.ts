import { ContactTier } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { recommendSequenceForContact } from "@/modules/lead-gen/sequence-catalog";

const directory = [
  {
    id: "apollo-email",
    name: "Hunter - Email Only",
    active: true,
    archived: false,
    description: null,
    lastUsedAt: null,
    automationMode: "EMAIL_ONLY" as const
  },
  {
    id: "apollo-executive",
    name: "Hunter - Executive Referral",
    active: true,
    archived: false,
    description: null,
    lastUsedAt: null,
    automationMode: "EMAIL_ONLY" as const
  }
];

describe("Hunter cadence recommendation", () => {
  it("ignores legacy tier mappings and uses the email-only cadence for operating buyers", () => {
    const recommendation = recommendSequenceForContact({
      contactTier: ContactTier.TIER_1,
      title: "Warehouse Operations Manager",
      department: "Operations",
      companyName: "Example Co",
      sequenceMappings: [{
        tier: "TIER_1",
        label: "Legacy",
        apolloSequenceId: "legacy-tier-1",
        apolloSequenceName: "Tier 1 Sequence",
        automationMode: "AI_CUSTOM",
        requiresAiDraft: true,
        requiresRepAssignment: false,
        notes: null
      }],
      sequenceDirectory: directory,
      hunterManaged: true
    });

    expect(recommendation.id).toBe("apollo-email");
    expect(recommendation.name).toBe("Hunter - Email Only");
  });

  it("uses the executive-referral cadence for senior stakeholders", () => {
    const recommendation = recommendSequenceForContact({
      contactTier: ContactTier.TIER_2,
      title: "President and CEO",
      department: null,
      companyName: "Example Co",
      sequenceMappings: [],
      sequenceDirectory: directory,
      hunterManaged: true
    });

    expect(recommendation.id).toBe("apollo-executive");
  });
});
