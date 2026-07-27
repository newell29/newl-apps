import { describe, expect, it } from "vitest";

import { selectApolloMailboxForCompany } from "@/modules/settings/apollo-mailbox-routing";
import type { ApolloRepMappingEntry } from "@/modules/settings/types";

const entries: ApolloRepMappingEntry[] = [
  mailbox("alex", "alex@newlgroup.com", 80),
  mailbox("faisal", "faisal@newlgroup.com", 10),
  mailbox("aaron", "aaron@newlgroup.com", 10)
];

describe("Apollo mailbox routing", () => {
  it("keeps the same company on the same mailbox", () => {
    const first = selectApolloMailboxForCompany({
      entries,
      owner: { name: "Alex Newell", email: "alex@newlgroup.com" },
      companyId: "company-sticky"
    });
    const second = selectApolloMailboxForCompany({
      entries,
      owner: { name: "Alex Newell", email: "alex@newlgroup.com" },
      companyId: "company-sticky"
    });

    expect(first?.id).toBe(second?.id);
  });

  it("does not route through inactive or zero-weight mailboxes", () => {
    const result = selectApolloMailboxForCompany({
      entries: [
        { ...mailbox("alex", "alex@newlgroup.com", 100), active: false },
        mailbox("faisal", "faisal@newlgroup.com", 0),
        mailbox("aaron", "aaron@newlgroup.com", 100)
      ],
      owner: { name: "Alex Newell", email: "alex@newlgroup.com" },
      companyId: "company-1"
    });

    expect(result?.id).toBe("aaron");
  });
});

function mailbox(id: string, email: string, routingWeight: number): ApolloRepMappingEntry {
  return {
    id,
    sequenceOwnerName: "Alex Newell",
    senderLabel: id,
    apolloUserId: "apollo-user-alex",
    sendFromEmail: email,
    sendFromEmailAccountId: `email-account-${id}`,
    routingWeight,
    active: true
  };
}
