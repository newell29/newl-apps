import { ContactTier } from "@prisma/client";
import type {
  ApolloSequenceDirectoryEntry,
  ApolloSequenceMappingEntry
} from "@/modules/settings/types";

export type SequenceCatalogItem = {
  id: string;
  name: string;
};

const fallbackSequenceCatalog: SequenceCatalogItem[] = [
  {
    id: "houston-import-decision-maker",
    name: "Houston Import Decision Maker"
  },
  {
    id: "charlotte-warehouse-decision-maker",
    name: "Charlotte Warehouse Decision Maker"
  },
  {
    id: "standard-logistics-outreach",
    name: "Standard Logistics Outreach"
  },
  {
    id: "warehouse-capacity-outreach",
    name: "Warehouse Capacity Outreach"
  },
  {
    id: "general-newl-group-intro",
    name: "General Newl Group Intro"
  }
];

export function buildSequenceCatalogItems(directory: ApolloSequenceDirectoryEntry[]) {
  const activeSequences = directory
    .filter((entry) => entry.active && !entry.archived)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      id: entry.id,
      name: entry.name
    }));

  return activeSequences.length > 0 ? activeSequences : fallbackSequenceCatalog;
}

export function recommendSequenceForContact({
  contactTier,
  title,
  department,
  companyName,
  sequenceMappings,
  sequenceDirectory
}: {
  contactTier: ContactTier;
  title: string | null;
  department: string | null;
  companyName: string;
  sequenceMappings: ApolloSequenceMappingEntry[];
  sequenceDirectory: ApolloSequenceDirectoryEntry[];
}) {
  const mappedSequence = findMappedApolloSequence(contactTier, sequenceMappings, sequenceDirectory);
  if (mappedSequence) {
    return mappedSequence;
  }

  return recommendFallbackSequence({
    contactTier,
    title,
    department,
    companyName
  });
}

function findMappedApolloSequence(
  contactTier: ContactTier,
  sequenceMappings: ApolloSequenceMappingEntry[],
  sequenceDirectory: ApolloSequenceDirectoryEntry[]
) {
  if (contactTier === ContactTier.UNRANKED) {
    return null;
  }

  const mapping = sequenceMappings.find((entry) => entry.tier === contactTier);
  if (!mapping?.apolloSequenceId || !mapping.apolloSequenceName) {
    return null;
  }

  const activeDirectoryEntry = sequenceDirectory.find(
    (entry) => entry.id === mapping.apolloSequenceId && entry.active && !entry.archived
  );

  if (!activeDirectoryEntry) {
    return null;
  }

  return {
    id: activeDirectoryEntry.id,
    name: activeDirectoryEntry.name,
    reason: `${mapping.label} maps ${formatTier(contactTier)} contacts into "${activeDirectoryEntry.name}". ${
      mapping.requiresAiDraft
        ? "This tier still requires an AI-written subject line and email body before any future sequence push."
        : "This tier can use the mapped Apollo cadence once the contact is ready."
    }`
  };
}

function recommendFallbackSequence({
  contactTier,
  title,
  department,
  companyName
}: {
  contactTier: ContactTier;
  title: string | null;
  department: string | null;
  companyName: string;
}) {
  const titleText = `${title ?? ""} ${department ?? ""}`.toLowerCase();
  const companyText = companyName.toLowerCase();
  const isImportDecisionMaker = /import|logistics|supply chain|operations/.test(titleText);
  const isWarehouseDecisionMaker = /warehouse|distribution|operations|logistics/.test(titleText);

  if (contactTier === ContactTier.TIER_1 && /houston|atlantic|import/.test(companyText) && isImportDecisionMaker) {
    return {
      ...fallbackSequenceCatalog[0],
      reason: "Fallback local cadence for a Tier 1 import/logistics decision-maker."
    };
  }

  if (contactTier === ContactTier.TIER_1 && /charlotte|carolina|warehouse/.test(companyText) && isWarehouseDecisionMaker) {
    return {
      ...fallbackSequenceCatalog[1],
      reason: "Fallback local cadence for a Tier 1 warehouse/distribution decision-maker."
    };
  }

  if (contactTier === ContactTier.TIER_2 && /operations|logistics|supply chain|distribution/.test(titleText)) {
    return {
      ...fallbackSequenceCatalog[2],
      reason: "Fallback local cadence for a Tier 2 logistics contact."
    };
  }

  if (/warehouse|distribution/.test(titleText)) {
    return {
      ...fallbackSequenceCatalog[3],
      reason: "Fallback local cadence for warehouse/distribution contacts."
    };
  }

  return {
    ...fallbackSequenceCatalog[4],
    reason: "Fallback cadence until Apollo tier mapping is fully configured."
  };
}

function formatTier(tier: ContactTier) {
  return tier.replaceAll("_", " ");
}
