import type { SupplyChainDesignModel01ProofResultSummary } from "@/modules/supply-chain-design/types";

export type SupplyChainDesignCostAnalysis = {
  totalObservedCost: number;
  costBreakdown: Array<{
    component: string;
    amount: number;
    share: number | null;
  }>;
  facilityOperatingCostShares: Array<{
    facilityId: string;
    facilityName: string;
    facilityOperatingCost: number;
    share: number | null;
  }>;
  facilityCostPerShipment: Array<{
    facilityId: string;
    transportationCostPerShipment: number | null;
    observedCostPerShipment: number | null;
  }>;
  rankings: {
    highestObservedCostFacility: SupplyChainDesignCostRanking | null;
    highestOperatingCostCategory: SupplyChainDesignCostRanking | null;
    highestObservedCostPerShipmentFacility: SupplyChainDesignCostRanking | null;
  };
};

export type SupplyChainDesignCostRanking = {
  labels: string[];
  amount: number;
  isTie: boolean;
};

export function deriveSupplyChainDesignCostAnalysis(
  result: SupplyChainDesignModel01ProofResultSummary
): SupplyChainDesignCostAnalysis {
  const totalObservedCost = (result.totalTransportationCost ?? 0) + (result.totalFacilityOperatingCost ?? 0);
  const categoryCosts = new Map<string, number>();

  for (const item of result.facilityOperatingCostByCategory ?? []) {
    categoryCosts.set(normalizeCostCategory(item.costCategory), (categoryCosts.get(normalizeCostCategory(item.costCategory)) ?? 0) + item.facilityOperatingCost);
  }

  const standardCategories = ["Labour", "Rent", "Utilities"];
  const costBreakdown = [
    {
      component: "Transportation",
      amount: result.totalTransportationCost ?? 0,
      share: percentShare(result.totalTransportationCost ?? 0, totalObservedCost)
    },
    ...standardCategories.map((category) => ({
      component: category,
      amount: categoryCosts.get(category) ?? 0,
      share: percentShare(categoryCosts.get(category) ?? 0, totalObservedCost)
    })),
    ...[...categoryCosts.entries()]
      .filter(([category]) => !standardCategories.includes(category))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([component, amount]) => ({
        component,
        amount,
        share: percentShare(amount, totalObservedCost)
      }))
  ];

  const facilityNames = new Map(result.facilitySummary.map((facility) => [facility.facilityId, facility.facilityName]));
  const facilityCostRows =
    result.facilityOperatingCostByFacility ??
    result.facilitySummary.map((facility) => ({
      facilityId: facility.facilityId,
      facilityOperatingCost: facility.facilityOperatingCost ?? 0
    }));
  const facilityOperatingCostShares = facilityCostRows.map((facility) => {
    const facilityOperatingCost = facility.facilityOperatingCost;

    return {
      facilityId: facility.facilityId,
      facilityName: facilityNames.get(facility.facilityId) ?? "Unmatched facility",
      facilityOperatingCost,
      share: percentShare(facilityOperatingCost, result.totalFacilityOperatingCost ?? 0)
    };
  });

  const facilityCostPerShipment = result.facilitySummary.map((facility) => {
    const transportationCost = facility.transportationCost ?? 0;
    const observedCost = facility.observedCost ?? null;

    return {
      facilityId: facility.facilityId,
      transportationCostPerShipment:
        facility.shipmentCount > 0 && typeof facility.transportationCost === "number"
          ? transportationCost / facility.shipmentCount
          : null,
      observedCostPerShipment:
        facility.shipmentCount > 0 && typeof observedCost === "number" ? observedCost / facility.shipmentCount : null
    };
  });

  return {
    totalObservedCost,
    costBreakdown,
    facilityOperatingCostShares,
    facilityCostPerShipment,
    rankings: {
      highestObservedCostFacility: topRanking(
        result.facilitySummary
          .filter((facility) => typeof facility.observedCost === "number")
          .map((facility) => ({
            label: `${facility.facilityId} - ${facility.facilityName}`,
            amount: facility.observedCost ?? 0
          }))
      ),
      highestOperatingCostCategory: topRanking(
        (result.facilityOperatingCostByCategory ?? []).map((category) => ({
          label: normalizeCostCategory(category.costCategory),
          amount: category.facilityOperatingCost
        }))
      ),
      highestObservedCostPerShipmentFacility: topRanking(
        result.facilitySummary
          .filter((facility) => facility.shipmentCount > 0 && typeof facility.observedCost === "number")
          .map((facility) => ({
            label: `${facility.facilityId} - ${facility.facilityName}`,
            amount: (facility.observedCost ?? 0) / facility.shipmentCount
          }))
      )
    }
  };
}

function percentShare(amount: number, total: number) {
  return total > 0 ? (amount / total) * 100 : null;
}

function topRanking(values: Array<{ label: string; amount: number }>): SupplyChainDesignCostRanking | null {
  if (values.length === 0) {
    return null;
  }

  const highest = Math.max(...values.map((value) => value.amount));
  const labels = values
    .filter((value) => value.amount === highest)
    .map((value) => value.label)
    .sort((left, right) => left.localeCompare(right));

  return {
    labels,
    amount: highest,
    isTie: labels.length > 1
  };
}

function normalizeCostCategory(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Uncategorized";
  }

  const lower = trimmed.toLowerCase();
  if (lower === "labor" || lower === "labour") {
    return "Labour";
  }
  if (lower === "rent") {
    return "Rent";
  }
  if (lower === "utilities") {
    return "Utilities";
  }

  return trimmed;
}
