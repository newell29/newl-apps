import { describe, expect, it } from "vitest";

import { resolveConfiguredApolloSender } from "@/modules/lead-gen/apollo-sender-routing";
import type { ApolloRepMappingEntry } from "@/modules/settings/types";

const users = [{
  id: "user-alex",
  email: "alex@newlgroup.com",
  name: "Alex Newell"
}];

describe("Hunter Apollo sender routing", () => {
  it("uses the selected mailbox identity and preserves its first name", () => {
    const result = resolveConfiguredApolloSender({
      entries: [
        mailbox({
          id: "mailbox-alex",
          senderLabel: "Alex Newell",
          sendFromEmail: "alex@newlgroup.com",
          routingWeight: 100,
          active: true
        }),
        mailbox({
          id: "mailbox-faisal",
          senderLabel: "Faisal",
          sendFromEmail: "faisal@newlgroup.com",
          routingWeight: 0,
          active: false
        })
      ],
      users,
      assignedRep: null,
      companyId: "company-1"
    });

    expect(result).toEqual(expect.objectContaining({
      ownerUserId: "user-alex",
      firstName: "Alex",
      senderLabel: "Alex Newell",
      sendFromEmailAccountId: "account-mailbox-alex"
    }));
  });

  it("fails closed when no active positive-weight mailbox maps to the owner", () => {
    expect(resolveConfiguredApolloSender({
      entries: [
        mailbox({
          id: "mailbox-alex",
          senderLabel: "Alex",
          sendFromEmail: "alex@newlgroup.com",
          routingWeight: 0,
          active: true
        })
      ],
      users,
      assignedRep: "user-alex",
      companyId: "company-1"
    })).toBeNull();
  });

  it("extracts only the first name when Apollo exposes an email address as the sender label", () => {
    const result = resolveConfiguredApolloSender({
      entries: [
        mailbox({
          id: "mailbox-alex",
          senderLabel: "Alex.newell@newl.ca",
          sendFromEmail: "Alex.newell@newl.ca",
          routingWeight: 100,
          active: true
        })
      ],
      users,
      assignedRep: null,
      companyId: "company-1"
    });

    expect(result).toEqual(expect.objectContaining({
      firstName: "Alex",
      senderLabel: "Alex.newell@newl.ca"
    }));
  });
});

function mailbox(
  overrides: Partial<ApolloRepMappingEntry> & Pick<ApolloRepMappingEntry, "id">
): ApolloRepMappingEntry {
  return {
    id: overrides.id,
    sequenceOwnerName: "Alex Newell",
    senderLabel: overrides.senderLabel ?? "Alex",
    apolloUserId: "apollo-user-alex",
    sendFromEmail: overrides.sendFromEmail ?? "alex@newlgroup.com",
    sendFromEmailAccountId: `account-${overrides.id}`,
    routingWeight: overrides.routingWeight ?? 100,
    active: overrides.active ?? true
  };
}
