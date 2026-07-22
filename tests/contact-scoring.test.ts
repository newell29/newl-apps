import { ContactStatus, ContactTier, ReplyStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  getContactSequencePushBlockReason,
  scoreContact
} from "@/modules/lead-gen/contact-scoring";
import { DEFAULT_TRADEMINING_SCORING_SETTINGS } from "@/modules/settings/types";

const strongContact = {
  fullName: "Jordan Demo",
  title: "Director of Supply Chain",
  department: "Logistics",
  seniority: "director",
  email: "jordan@example.com",
  phone: "+1 555 0100",
  linkedinUrl: "https://linkedin.example/jordan",
  contactStatus: ContactStatus.APPROVED,
  replyStatus: ReplyStatus.NO_REPLY,
  companyPriorityScore: 85,
  companyLeadScore: 88,
  isPrimaryContact: true
};

describe("contact scoring safety and fit", () => {
  it.each([ContactStatus.DO_NOT_CONTACT, ContactStatus.REJECTED])(
    "hard-blocks %s contacts from ranking",
    (contactStatus) => {
      const result = scoreContact(
        {
          ...strongContact,
          contactStatus
        },
        DEFAULT_TRADEMINING_SCORING_SETTINGS
      );

      expect(result.score).toBe(0);
      expect(result.tier).toBe(ContactTier.UNRANKED);
      expect(result.summary).toContain("blocked from scoring and outreach");
    }
  );

  it("requires explicit contact approval before an Apollo cadence push", () => {
    expect(getContactSequencePushBlockReason(ContactStatus.REVIEWING)).toContain("must be approved");
    expect(getContactSequencePushBlockReason(ContactStatus.DO_NOT_CONTACT)).toContain("do not contact");
    expect(getContactSequencePushBlockReason(ContactStatus.APPROVED)).toBeNull();
  });

  it("deprioritizes sales roles without penalizing logistics titles that mention sales", () => {
    const salesDirector = scoreContact(
      {
        ...strongContact,
        title: "Sales Director",
        department: "Sales",
        isPrimaryContact: false,
        contactStatus: ContactStatus.REVIEWING
      },
      DEFAULT_TRADEMINING_SCORING_SETTINGS
    );
    const salesAndOperationsDirector = scoreContact(
      {
        ...strongContact,
        title: "Sales and Operations Director",
        department: "Operations"
      },
      DEFAULT_TRADEMINING_SCORING_SETTINGS
    );

    expect(salesDirector.tier).not.toBe(ContactTier.TIER_1);
    expect(salesDirector.summary).toContain("non-core function");
    expect(salesAndOperationsDirector.score).toBeGreaterThan(salesDirector.score);
    expect(salesAndOperationsDirector.summary).toContain("strong logistics decision-maker role");
  });
});
