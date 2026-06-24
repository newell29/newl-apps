import type {
  ApolloCadenceAutomationMode,
  ApolloSequenceDirectoryEntry,
  ApolloSequenceMappingEntry,
  ApolloSequenceMappingTier
} from "@/modules/settings/types";

const DEFAULT_SEQUENCE_MAPPING_BY_TIER: Record<ApolloSequenceMappingTier, Omit<ApolloSequenceMappingEntry, "apolloSequenceId" | "apolloSequenceName">> = {
  TIER_1: {
    tier: "TIER_1",
    label: "Tier 1 strong-fit custom",
    automationMode: "AI_CUSTOM",
    requiresAiDraft: true,
    requiresRepAssignment: true,
    notes: "Requires AI-generated subject line and email body before any future sequence push."
  },
  TIER_2: {
    tier: "TIER_2",
    label: "Tier 2 AI personalized",
    automationMode: "APOLLO_AI",
    requiresAiDraft: false,
    requiresRepAssignment: true,
    notes: "Use for solid-fit contacts where Apollo AI personalization can carry the cadence."
  },
  TIER_3: {
    tier: "TIER_3",
    label: "Tier 3 email only",
    automationMode: "EMAIL_ONLY",
    requiresAiDraft: false,
    requiresRepAssignment: true,
    notes: "Use for lighter-touch outreach when the contact is viable but not premium."
  }
};

const MAPPING_TIERS = Object.keys(DEFAULT_SEQUENCE_MAPPING_BY_TIER) as ApolloSequenceMappingTier[];

export function parseApolloSequenceDirectory(publicConfig: unknown): ApolloSequenceDirectoryEntry[] {
  if (!publicConfig || typeof publicConfig !== "object") {
    return [];
  }

  const config = publicConfig as Record<string, unknown>;
  const rawEntries = [
    config.apolloSequenceDirectory,
    config.apollo_sequence_directory,
    config.sequences,
    config.apolloSequences
  ].find(Array.isArray);

  if (!Array.isArray(rawEntries)) {
    return [];
  }

  return rawEntries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const id = readString(record, "id") ?? readString(record, "apollo_sequence_id");
    const name = readString(record, "name") ?? readString(record, "apollo_sequence_name");

    if (!id || !name) {
      return [];
    }

    const active = parseBoolean(record.active, true);
    const archived = parseBoolean(record.archived, false);

    return [
      {
        id,
        name,
        active,
        archived,
        description: readString(record, "description"),
        lastUsedAt: readString(record, "last_used_at") ?? readString(record, "lastUsedAt"),
        automationMode: inferAutomationMode(name)
      }
    ];
  });
}

export function parseApolloSequenceMapping(publicConfig: unknown): ApolloSequenceMappingEntry[] {
  return parseApolloSequenceMappingFromConfig(publicConfig);
}

export function parseSearchProfileApolloSequenceMapping(config: unknown) {
  return parseApolloSequenceMappingFromConfig(config);
}

export function buildSearchProfileApolloSequenceConfig(mapping: ApolloSequenceMappingEntry[]) {
  return {
    apolloSequenceMapping: mapping.map((entry) => ({
      tier: entry.tier,
      label: entry.label,
      apollo_sequence_id: entry.apolloSequenceId,
      apollo_sequence_name: entry.apolloSequenceName,
      automation_mode: entry.automationMode,
      requires_ai_draft: entry.requiresAiDraft,
      requires_rep_assignment: entry.requiresRepAssignment,
      notes: entry.notes
    }))
  };
}

export function resolveApolloSequenceMappings({
  existingMappings,
  directory
}: {
  existingMappings: ApolloSequenceMappingEntry[] | null | undefined;
  directory: ApolloSequenceDirectoryEntry[];
}) {
  return buildApolloSequenceMappingsWithDefaults({
    existingMappings: existingMappings ?? [],
    directory
  });
}

function parseApolloSequenceMappingFromConfig(publicConfig: unknown): ApolloSequenceMappingEntry[] {
  if (!publicConfig || typeof publicConfig !== "object") {
    return buildDefaultSequenceMappings();
  }

  const config = publicConfig as Record<string, unknown>;
  const rawEntries = [
    config.apolloSequenceMapping,
    config.apollo_sequence_mapping,
    config.sequenceMapping
  ].find(Array.isArray);

  if (!Array.isArray(rawEntries)) {
    return buildDefaultSequenceMappings();
  }

  const parsedEntries: ApolloSequenceMappingEntry[] = rawEntries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const tier = parseTier(readString(record, "tier"));
    if (!tier) {
      return [];
    }

    const defaults = DEFAULT_SEQUENCE_MAPPING_BY_TIER[tier];
    const apolloSequenceName =
      readString(record, "apollo_sequence_name") ??
      readString(record, "apolloSequenceName") ??
      readString(record, "name");

    return [
      {
        tier,
        label: readString(record, "label") ?? defaults.label,
        apolloSequenceId:
          readString(record, "apollo_sequence_id") ??
          readString(record, "apolloSequenceId") ??
          readString(record, "id"),
        apolloSequenceName,
        automationMode:
          parseAutomationMode(readString(record, "automation_mode") ?? readString(record, "automationMode")) ??
          inferAutomationMode(apolloSequenceName) ??
          defaults.automationMode,
        requiresAiDraft: parseBoolean(record.requiresAiDraft ?? record.requires_ai_draft, defaults.requiresAiDraft),
        requiresRepAssignment: parseBoolean(
          record.requiresRepAssignment ?? record.requires_rep_assignment,
          defaults.requiresRepAssignment
        ),
        notes: readString(record, "notes") ?? defaults.notes
      }
    ];
  });

  const byTier = new Map<ApolloSequenceMappingTier, ApolloSequenceMappingEntry>(
    parsedEntries.map((entry) => [entry.tier, entry])
  );

  return MAPPING_TIERS.map((tier) => byTier.get(tier) ?? buildDefaultSequenceMapping(tier));
}

export function buildApolloSequenceConfig({
  directory,
  mapping
}: {
  directory: ApolloSequenceDirectoryEntry[];
  mapping: ApolloSequenceMappingEntry[];
}) {
  return {
    apolloSequenceDirectory: directory.map((entry) => ({
      id: entry.id,
      name: entry.name,
      active: entry.active,
      archived: entry.archived,
      description: entry.description,
      last_used_at: entry.lastUsedAt,
      automation_mode: entry.automationMode
    })),
    apolloSequenceMapping: mapping.map((entry) => ({
      tier: entry.tier,
      label: entry.label,
      apollo_sequence_id: entry.apolloSequenceId,
      apollo_sequence_name: entry.apolloSequenceName,
      automation_mode: entry.automationMode,
      requires_ai_draft: entry.requiresAiDraft,
      requires_rep_assignment: entry.requiresRepAssignment,
      notes: entry.notes
    }))
  };
}

export function buildApolloSequenceMappingsWithDefaults({
  existingMappings,
  directory
}: {
  existingMappings: ApolloSequenceMappingEntry[];
  directory: ApolloSequenceDirectoryEntry[];
}) {
  const byId = new Map(directory.map((entry) => [entry.id, entry]));

  return MAPPING_TIERS.map((tier) => {
    const existing = existingMappings.find((entry) => entry.tier === tier) ?? buildDefaultSequenceMapping(tier);
    const existingDirectoryEntry = existing.apolloSequenceId ? byId.get(existing.apolloSequenceId) : null;
    const matchedDirectoryEntry = existingDirectoryEntry ?? findDefaultApolloSequenceForTier(directory, tier);

    return {
      ...existing,
      apolloSequenceId: existingDirectoryEntry?.id ?? existing.apolloSequenceId ?? matchedDirectoryEntry?.id ?? null,
      apolloSequenceName:
        existingDirectoryEntry?.name ??
        existing.apolloSequenceName ??
        matchedDirectoryEntry?.name ??
        null,
      automationMode: matchedDirectoryEntry?.automationMode ?? existing.automationMode
    };
  });
}

export function mapApolloSequenceOptions(directory: ApolloSequenceDirectoryEntry[]) {
  return directory
    .filter((entry) => entry.active && !entry.archived)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      id: entry.id,
      name: entry.name
    }));
}

function buildDefaultSequenceMappings() {
  return MAPPING_TIERS.map((tier) => buildDefaultSequenceMapping(tier));
}

function buildDefaultSequenceMapping(tier: ApolloSequenceMappingTier): ApolloSequenceMappingEntry {
  return {
    ...DEFAULT_SEQUENCE_MAPPING_BY_TIER[tier],
    apolloSequenceId: null,
    apolloSequenceName: null
  };
}

function findDefaultApolloSequenceForTier(
  directory: ApolloSequenceDirectoryEntry[],
  tier: ApolloSequenceMappingTier
) {
  const activeDirectory = directory.filter((entry) => entry.active && !entry.archived);
  const pattern =
    tier === "TIER_1"
      ? /\btier\s*1\b|strong[\s-]?fit|custom/i
      : tier === "TIER_2"
        ? /\btier\s*2\b|ai personalized|personalized/i
        : /\btier\s*3\b|email only|light touch/i;

  return activeDirectory.find((entry) => pattern.test(entry.name)) ?? null;
}

function inferAutomationMode(name: string | null | undefined): ApolloCadenceAutomationMode {
  const normalized = name?.toLowerCase() ?? "";

  if (/tier\s*1|strong[\s-]?fit|custom/.test(normalized)) {
    return "AI_CUSTOM";
  }

  if (/tier\s*2|ai personalized|personalized/.test(normalized)) {
    return "APOLLO_AI";
  }

  return "EMAIL_ONLY";
}

function parseTier(value: string | null) {
  return value === "TIER_1" || value === "TIER_2" || value === "TIER_3" ? value : null;
}

function parseAutomationMode(value: string | null) {
  return value === "AI_CUSTOM" || value === "APOLLO_AI" || value === "EMAIL_ONLY" ? value : null;
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (["true", "yes", "1", "active"].includes(value.toLowerCase())) {
      return true;
    }

    if (["false", "no", "0", "inactive"].includes(value.toLowerCase())) {
      return false;
    }
  }

  return fallback;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
