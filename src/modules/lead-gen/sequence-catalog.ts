import { ContactTier } from "@prisma/client";

export const sequenceCatalog = [
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
] as const;

export type SequenceCatalogItem = (typeof sequenceCatalog)[number];

export function getSequenceById(sequenceId: string) {
  return sequenceCatalog.find((sequence) => sequence.id === sequenceId) ?? null;
}

export function recommendSequenceForContact({
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
      ...sequenceCatalog[0],
      reason: "Tier 1 contact with import/logistics decision-maker signals for a Houston import account."
    };
  }

  if (contactTier === ContactTier.TIER_1 && /charlotte|carolina|warehouse/.test(companyText) && isWarehouseDecisionMaker) {
    return {
      ...sequenceCatalog[1],
      reason: "Tier 1 contact with warehouse/distribution decision-maker signals for a Charlotte warehouse account."
    };
  }

  if (contactTier === ContactTier.TIER_2 && /operations|logistics|supply chain|distribution/.test(titleText)) {
    return {
      ...sequenceCatalog[2],
      reason: "Tier 2 operations/logistics contact; use the standard logistics outreach cadence."
    };
  }

  if (/warehouse|distribution/.test(titleText)) {
    return {
      ...sequenceCatalog[3],
      reason: "Warehouse/distribution title signals make the warehouse capacity cadence a better fit."
    };
  }

  return {
    ...sequenceCatalog[4],
    reason: "Fallback cadence until Apollo enrichment and richer fit scoring are available."
  };
}
