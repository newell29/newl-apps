import { selectApolloMailboxForCompany } from "@/modules/settings/apollo-mailbox-routing";
import type { ApolloRepMappingEntry } from "@/modules/settings/types";

export type ApolloSenderUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export type ResolvedApolloSenderIdentity = {
  ownerUserId: string;
  firstName: string;
  senderLabel: string;
  sendFromEmail: string | null;
  sendFromEmailAccountId: string | null;
};

export function resolveConfiguredApolloSender({
  entries,
  users,
  assignedRep,
  companyId
}: {
  entries: ApolloRepMappingEntry[];
  users: ApolloSenderUser[];
  assignedRep: string | null;
  companyId: string;
}): ResolvedApolloSenderIdentity | null {
  const normalizedAssignedRep = assignedRep?.trim().toLowerCase() ?? null;
  const eligibleUsers = users
    .filter((user) =>
      !normalizedAssignedRep ||
      user.id.toLowerCase() === normalizedAssignedRep ||
      user.email?.trim().toLowerCase() === normalizedAssignedRep ||
      user.name?.trim().toLowerCase() === normalizedAssignedRep
    )
    .map((user) => ({
      user,
      mailbox: selectApolloMailboxForCompany({
        entries,
        owner: user,
        companyId
      })
    }))
    .filter((candidate): candidate is {
      user: ApolloSenderUser;
      mailbox: ApolloRepMappingEntry;
    } => Boolean(candidate.mailbox))
    .sort((left, right) => {
      const weightDifference =
        totalOwnerWeight(entries, right.user) -
        totalOwnerWeight(entries, left.user);
      return weightDifference || left.user.id.localeCompare(right.user.id);
    });

  const selected = eligibleUsers[0];
  if (!selected) return null;

  const firstName = resolveSenderFirstName(selected.mailbox, selected.user);
  if (!firstName) return null;

  return {
    ownerUserId: selected.user.id,
    firstName,
    senderLabel: selected.mailbox.senderLabel,
    sendFromEmail: selected.mailbox.sendFromEmail,
    sendFromEmailAccountId: selected.mailbox.sendFromEmailAccountId
  };
}

function totalOwnerWeight(entries: ApolloRepMappingEntry[], owner: ApolloSenderUser) {
  const ownerEmail = owner.email?.trim().toLowerCase() ?? null;
  const ownerName = owner.name?.trim().toLowerCase() ?? null;
  return entries
    .filter(
      (entry) =>
        entry.active &&
        entry.routingWeight > 0 &&
        Boolean(entry.apolloUserId) &&
        (
          (ownerEmail && entry.sendFromEmail?.trim().toLowerCase() === ownerEmail) ||
          (ownerName && entry.sequenceOwnerName.trim().toLowerCase() === ownerName)
        )
    )
    .reduce((sum, entry) => sum + entry.routingWeight, 0);
}

function resolveSenderFirstName(
  mailbox: ApolloRepMappingEntry,
  owner: ApolloSenderUser
) {
  const candidates = [
    mailbox.senderLabel,
    mailbox.sendFromEmail?.split("@")[0]?.replace(/[._-]+/g, " "),
    owner.name,
    owner.email?.split("@")[0]?.replace(/[._-]+/g, " ")
  ];

  for (const candidate of candidates) {
    const firstToken = candidate
      ?.trim()
      .split(/\s+/)[0]
      ?.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "");
    if (
      firstToken &&
      firstToken.length >= 2 &&
      !/^(?:sender|newl|group|team|sales)$/i.test(firstToken)
    ) {
      return firstToken.charAt(0).toUpperCase() + firstToken.slice(1);
    }
  }

  return null;
}
