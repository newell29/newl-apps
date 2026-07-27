import { ReplyStatus, SequenceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { rankHunterContacts } from "@/modules/lead-gen/hunter-outreach-handoff";
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
});
