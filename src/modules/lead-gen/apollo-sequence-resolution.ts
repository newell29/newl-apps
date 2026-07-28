import type { ApolloSequenceDirectoryEntry } from "@/server/integrations/apollo";

const HUNTER_SEQUENCE_NAME_BY_INTERNAL_ID = new Map([
  ["hunter-email-only", "Hunter - Email Only"],
  ["hunter-executive-referral", "Hunter - Executive Referral"]
]);

export type ApolloSequenceReference = {
  id: string;
  name: string;
};

export type ApolloSequenceResolution =
  | {
      ok: true;
      sequence: ApolloSequenceReference;
      resolvedBy: "ID" | "NAME";
    }
  | {
      ok: false;
      reason: string;
    };

export function resolveLiveApolloSequence({
  requestedSequence,
  directory
}: {
  requestedSequence: ApolloSequenceReference;
  directory: ApolloSequenceDirectoryEntry[];
}): ApolloSequenceResolution {
  const requestedName =
    HUNTER_SEQUENCE_NAME_BY_INTERNAL_ID.get(requestedSequence.id) ??
    requestedSequence.name;
  const normalizedRequestedName = normalizeSequenceName(requestedName);
  const activeDirectory = directory.filter(
    (entry) => entry.active && !entry.archived
  );
  if (activeDirectory.length === 0) {
    const requestedCadenceExists = directory.some(
      (entry) =>
        entry.id === requestedSequence.id ||
        normalizeSequenceName(entry.name) === normalizedRequestedName
    );
    return {
      ok: false,
      reason: requestedCadenceExists
        ? inactiveCadenceReason(requestedName)
        : "Apollo returned no active cadences. Sync Apollo cadences in Settings and retry this approved contact."
    };
  }

  const exactId = activeDirectory.find(
    (entry) => entry.id === requestedSequence.id
  );
  if (exactId) {
    return {
      ok: true,
      sequence: {
        id: exactId.id,
        name: exactId.name
      },
      resolvedBy: "ID"
    };
  }

  const nameMatches = activeDirectory.filter(
    (entry) =>
      normalizeSequenceName(entry.name) === normalizedRequestedName
  );

  if (nameMatches.length === 1) {
    return {
      ok: true,
      sequence: {
        id: nameMatches[0]!.id,
        name: nameMatches[0]!.name
      },
      resolvedBy: "NAME"
    };
  }

  if (nameMatches.length > 1) {
    return {
      ok: false,
      reason:
        `Apollo has multiple active cadences named "${requestedName}". ` +
        "Archive or rename the duplicate before retrying this approved contact."
    };
  }

  return {
    ok: false,
    reason: inactiveCadenceReason(requestedName)
  };
}

function inactiveCadenceReason(name: string) {
  return (
    `The selected cadence "${name}" is not active in Apollo. ` +
    "Sync Apollo cadences in Settings, select an active cadence, and retry this approved contact."
  );
}

function normalizeSequenceName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
