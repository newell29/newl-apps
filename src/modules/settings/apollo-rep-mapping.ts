import type { ApolloRepMappingEntry } from "@/modules/settings/types";

export function parseApolloRepMapping(publicConfig: unknown): ApolloRepMappingEntry[] {
  if (!publicConfig || typeof publicConfig !== "object") {
    return [];
  }

  const config = publicConfig as Record<string, unknown>;
  const rawEntries = [
    config.apolloUserMapping,
    config.apollo_user_mapping,
    config.userMapping,
    config.reps
  ].find(Array.isArray);

  if (!Array.isArray(rawEntries)) {
    return [];
  }

  return rawEntries.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const sequenceOwnerName =
      readString(record, "sequence_owner_name") ?? readString(record, "name") ?? readString(record, "ownerName");

    if (!sequenceOwnerName) {
      return [];
    }

    return [
      {
        id: readString(record, "id") ?? `apollo-rep-${index}`,
        sequenceOwnerName,
        apolloUserId: readString(record, "apollo_user_id") ?? readString(record, "apolloUserId") ?? null,
        sendFromEmail:
          readString(record, "send_from_email") ?? readString(record, "email") ?? readString(record, "sendFromEmail") ?? null,
        sendFromEmailAccountId:
          readString(record, "send_from_email_account_id") ??
          readString(record, "sendFromEmailAccountId") ??
          null,
        active: parseActive(record.active)
      }
    ];
  });
}

export function buildApolloRepMappingConfig(entries: ApolloRepMappingEntry[]) {
  return {
    apolloUserMapping: entries.map((entry) => ({
      id: entry.id,
      sequence_owner_name: entry.sequenceOwnerName,
      active: entry.active,
      apollo_user_id: entry.apolloUserId,
      send_from_email: entry.sendFromEmail,
      send_from_email_account_id: entry.sendFromEmailAccountId
    }))
  };
}

export function mapApolloRepOptions(entries: ApolloRepMappingEntry[]) {
  return entries
    .filter((entry) => entry.active)
    .map((entry) => ({
      value: entry.sequenceOwnerName,
      label: entry.sendFromEmail ? `${entry.sequenceOwnerName} (${entry.sendFromEmail})` : entry.sequenceOwnerName
    }));
}

function parseActive(value: unknown) {
  return !(value === false || value === "false" || value === "no" || value === "inactive");
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
