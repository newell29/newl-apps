import type {
  SupplyChainDesignNetworkScenarioEvaluationResult,
  SupplyChainDesignNetworkScenarioAlternative
} from "@/modules/supply-chain-design/network-scenario-evaluation";
import {
  calculateCandidateWarehouseCostForPreparedProfile,
  calculateCurrentFacilityWarehouseCostBasis,
  type SupplyChainDesignWarehouseCostCandidateInput,
  type SupplyChainDesignWarehouseCostCurrentFacilityInput,
  type SupplyChainDesignWarehouseCostProfileInput,
  type SupplyChainDesignWarehouseCostResult
} from "@/modules/supply-chain-design/warehouse-cost-engine";

export type SupplyChainDesignCombinedScenarioCompleteness =
  | "COMPLETE"
  | "INCOMPLETE_RATES"
  | "INCOMPLETE_WAREHOUSE_COST"
  | "INCOMPLETE_MIXED_CURRENCY"
  | "INCOMPLETE_NO_SCENARIO_ALTERNATIVES"
  | "INCOMPLETE_MULTIPLE_REASONS";

export type SupplyChainDesignCombinedScenarioFacilityInput =
  | {
      sourceType: "CANDIDATE";
      facilityId: string;
      facilityName: string;
      warehouseCost: SupplyChainDesignWarehouseCostCandidateInput;
    }
  | {
      sourceType: "CURRENT";
      facilityId: string;
      facilityName: string;
      warehouseCost: SupplyChainDesignWarehouseCostCurrentFacilityInput;
    };

export type SupplyChainDesignCombinedScenarioCostInput = {
  scenarioId: string;
  scenarioName: string;
  transportationCurrency: string;
  transportationEvaluation: SupplyChainDesignNetworkScenarioEvaluationResult;
  selectedFacilities: SupplyChainDesignCombinedScenarioFacilityInput[];
  warehouseCostProfilesByProfileKey: Record<string, SupplyChainDesignWarehouseCostProfileInput>;
};

export type SupplyChainDesignCombinedScenarioCostResult = {
  scenarioId: string;
  scenarioName: string;
  status: SupplyChainDesignCombinedScenarioCompleteness;
  currencies: string[];
  currenciesRequiringConversion: string[];
  modeledTransportationCost: number | null;
  variableWarehouseCost: number | null;
  annualAllInWarehouseCost: number | null;
  totalWarehouseCost: number | null;
  totalNetworkCost: number | null;
  assignedRepresentedShipments: number;
  incompleteRepresentedShipments: number;
  missingRateManifest: SupplyChainDesignNetworkScenarioEvaluationResult["missingRateManifest"];
  facilityTotals: SupplyChainDesignCombinedScenarioFacilityTotal[];
  profileResults: SupplyChainDesignCombinedScenarioProfileResult[];
  selectedFacilityCostEvidence: SupplyChainDesignCombinedScenarioSelectedFacilityEvidence[];
};

export type SupplyChainDesignCombinedScenarioSelectedFacilityEvidence = {
  facilityId: string;
  facilityName: string;
  facilitySourceType: "CURRENT" | "CANDIDATE";
  warehouseCostBasis: "ANNUAL_ALL_IN" | "VARIABLE_3PL_RATES";
  status: "COMPLETE" | "ANNUAL_ALL_IN" | "INCOMPLETE_VARIABLE_COST";
  currency: string | null;
  annualAllInCost: number | null;
  missingInputs: string[];
};

export type SupplyChainDesignCombinedScenarioFacilityTotal = {
  facilityId: string;
  facilityName: string;
  facilitySourceType: "CURRENT" | "CANDIDATE";
  representedShipments: number;
  representedPallets: number;
  modeledTransportationCost: number;
  variableWarehouseCost: number;
  annualAllInWarehouseCost: number;
  totalFacilityContribution: number;
};

export type SupplyChainDesignCombinedScenarioProfileResult = {
  profileKey: string;
  sourceReference: string;
  representedShipments: number;
  representedPallets: number | null;
  destination: string;
  historicalTransportationCost: number | null;
  winnerFacilityId: string | null;
  winnerFacilityName: string | null;
  incompleteReason: string | null;
  alternatives: SupplyChainDesignCombinedScenarioAlternative[];
};

export type SupplyChainDesignCombinedScenarioAlternative = {
  profileKey: string;
  sourceReference: string;
  representedShipments: number;
  representedPallets: number | null;
  destination: string;
  facilityId: string;
  facilityName: string;
  facilitySourceType: "CURRENT" | "CANDIDATE";
  modeledTransportationCost: number | null;
  transportationCurrency: string;
  warehouseCostBasis: "ANNUAL_ALL_IN" | "VARIABLE_3PL_RATES" | null;
  warehouseCostUsedForAssignment: number | null;
  annualAllInCost: number | null;
  variableWarehouseCost: number | null;
  knownWarehouseSubtotal: number | null;
  combinedAssignmentCost: number | null;
  complete: boolean;
  missingReasons: string[];
  winning: boolean;
  transportationAlternative: SupplyChainDesignNetworkScenarioAlternative;
  warehouseCostEvidence: SupplyChainDesignWarehouseCostResult | null;
};

export function evaluateSupplyChainDesignCombinedScenarioCost(
  input: SupplyChainDesignCombinedScenarioCostInput
): SupplyChainDesignCombinedScenarioCostResult {
  const facilitiesByKey = new Map(input.selectedFacilities.map((facility) => [facilityKey(facility.sourceType, facility.facilityId), facility]));
  const selectedFacilityCostEvidence = input.selectedFacilities.map((facility) => selectedFacilityEvidence(facility));
  const selectedAnnualAllInCostByFacility = new Map<string, number>();
  for (const facility of input.selectedFacilities) {
    const evidence = selectedFacilityEvidence(facility);
    if (evidence.warehouseCostBasis === "ANNUAL_ALL_IN" && evidence.annualAllInCost !== null) {
      selectedAnnualAllInCostByFacility.set(facilityKey(facility.sourceType, facility.facilityId), evidence.annualAllInCost);
    }
  }

  const profileResults = input.transportationEvaluation.profileAlternatives.map((profile) => {
    const profileCostEvidence = input.warehouseCostProfilesByProfileKey[profile.profileKey];
    const alternatives = profile.alternatives.map((alternative) =>
      evaluateAlternative({
        alternative,
        facility: facilitiesByKey.get(facilityKey(alternative.originSourceType, alternative.originFacilityId)) ?? null,
        profileCostEvidence,
        transportationCurrency: input.transportationCurrency
      })
    );
    const winner = selectWinningAlternative(alternatives);
    const markedAlternatives = alternatives.map((alternative) => ({
      ...alternative,
      winning: winner ? sameAlternative(alternative, winner) : false
    }));

    return {
      profileKey: profile.profileKey,
      sourceReference: profile.sourceReference,
      representedShipments: profile.representedShipments,
      representedPallets: profileCostEvidence?.representativePallets === null || profileCostEvidence === undefined
        ? null
        : profileCostEvidence.representativePallets * profileCostEvidence.representedShipments,
      destination: profile.destination,
      historicalTransportationCost: profile.historicalTransportationCost,
      winnerFacilityId: winner?.facilityId ?? null,
      winnerFacilityName: winner?.facilityName ?? null,
      incompleteReason: winner ? null : summarizeIncompleteReasons(markedAlternatives),
      alternatives: markedAlternatives
    };
  });

  const winners = profileResults.flatMap((profile) => profile.alternatives.filter((alternative) => alternative.winning));
  const currencies = collectCurrencies(input.transportationCurrency, selectedFacilityCostEvidence, winners);
  const incompleteness = collectIncompleteness({
    profileResults,
    selectedFacilityCostEvidence,
    currencies
  });
  const status = toScenarioStatus(incompleteness);
  const canTotal = status === "COMPLETE";

  const modeledTransportationCost = sum(winners.map((winner) => winner.modeledTransportationCost));
  const variableWarehouseCost = sum(winners.map((winner) => winner.variableWarehouseCost));
  const annualAllInWarehouseCost = sum([...selectedAnnualAllInCostByFacility.values()]);
  const totalWarehouseCost = variableWarehouseCost + annualAllInWarehouseCost;
  const totalNetworkCost = modeledTransportationCost + totalWarehouseCost;
  const facilityTotals = buildFacilityTotals(input.selectedFacilities, winners, selectedAnnualAllInCostByFacility);
  const assignedRepresentedShipments = sum(winners.map((winner) => winner.representedShipments));
  const totalRepresentedShipments = sum(profileResults.map((profile) => profile.representedShipments));

  return {
    scenarioId: input.scenarioId,
    scenarioName: input.scenarioName,
    status,
    currencies,
    currenciesRequiringConversion: status === "INCOMPLETE_MIXED_CURRENCY" || status === "INCOMPLETE_MULTIPLE_REASONS" ? currencies : [],
    modeledTransportationCost: canTotal ? roundCurrency(modeledTransportationCost) : null,
    variableWarehouseCost: canTotal ? roundCurrency(variableWarehouseCost) : null,
    annualAllInWarehouseCost: canTotal ? roundCurrency(annualAllInWarehouseCost) : null,
    totalWarehouseCost: canTotal ? roundCurrency(totalWarehouseCost) : null,
    totalNetworkCost: canTotal ? roundCurrency(totalNetworkCost) : null,
    assignedRepresentedShipments,
    incompleteRepresentedShipments: roundQuantity(totalRepresentedShipments - assignedRepresentedShipments),
    missingRateManifest: input.transportationEvaluation.missingRateManifest,
    facilityTotals: canTotal ? facilityTotals : facilityTotals.map((facility) => ({ ...facility, totalFacilityContribution: 0 })),
    profileResults,
    selectedFacilityCostEvidence
  };
}

function evaluateAlternative(input: {
  alternative: SupplyChainDesignNetworkScenarioAlternative;
  facility: SupplyChainDesignCombinedScenarioFacilityInput | null;
  profileCostEvidence: SupplyChainDesignWarehouseCostProfileInput | undefined;
  transportationCurrency: string;
}): SupplyChainDesignCombinedScenarioAlternative {
  const missingReasons: string[] = [];
  if (input.alternative.status !== "REUSED" || input.alternative.representedModeledTransportationCost === null) {
    missingReasons.push(input.alternative.status === "MISSING_RATE" ? "modeled_transportation_rate" : input.alternative.status.toLowerCase());
  }
  if (!input.facility) {
    missingReasons.push("selected_facility_cost_input");
  }
  if (!input.profileCostEvidence) {
    missingReasons.push("warehouse_cost_profile_evidence");
  }

  const warehouseCostEvidence = input.facility && input.profileCostEvidence
    ? calculateWarehouseCost(input.facility, input.profileCostEvidence)
    : null;
  if (warehouseCostEvidence?.status === "INCOMPLETE_VARIABLE_COST") {
    missingReasons.push(...warehouseCostEvidence.missingInputs);
  }

  const warehouseCostUsedForAssignment = warehouseCostEvidence?.warehouseCostBasis === "ANNUAL_ALL_IN"
    ? 0
    : warehouseCostEvidence?.completeWarehouseCost ?? null;
  if (warehouseCostEvidence?.warehouseCostBasis === "VARIABLE_3PL_RATES" && warehouseCostUsedForAssignment === null) {
    missingReasons.push("complete_variable_warehouse_cost");
  }
  const warehouseCurrency = warehouseCostEvidence?.currency?.trim() ?? "";
  if (warehouseCostEvidence?.warehouseCostBasis === "VARIABLE_3PL_RATES" && warehouseCurrency && warehouseCurrency !== input.transportationCurrency) {
    missingReasons.push("mixed_currency");
  }

  const complete = missingReasons.length === 0 && input.alternative.representedModeledTransportationCost !== null && warehouseCostUsedForAssignment !== null;
  const combinedAssignmentCost = complete
    ? roundCurrency(input.alternative.representedModeledTransportationCost! + warehouseCostUsedForAssignment!)
    : null;

  return {
    profileKey: input.alternative.profileKey,
    sourceReference: input.alternative.sourceReference,
    representedShipments: input.alternative.representedShipments,
    representedPallets: warehouseCostEvidence?.representedPallets ?? null,
    destination: input.alternative.destination,
    facilityId: input.alternative.originFacilityId,
    facilityName: input.alternative.originFacilityName,
    facilitySourceType: input.alternative.originSourceType,
    modeledTransportationCost: input.alternative.representedModeledTransportationCost,
    transportationCurrency: input.transportationCurrency,
    warehouseCostBasis: warehouseCostEvidence?.warehouseCostBasis ?? null,
    warehouseCostUsedForAssignment,
    annualAllInCost: warehouseCostEvidence?.annualAllInCost ?? null,
    variableWarehouseCost: warehouseCostEvidence?.warehouseCostBasis === "VARIABLE_3PL_RATES" ? warehouseCostEvidence.completeWarehouseCost : null,
    knownWarehouseSubtotal: warehouseCostEvidence?.knownSubtotal ?? null,
    combinedAssignmentCost,
    complete,
    missingReasons: unique(missingReasons),
    winning: false,
    transportationAlternative: input.alternative,
    warehouseCostEvidence
  };
}

function calculateWarehouseCost(
  facility: SupplyChainDesignCombinedScenarioFacilityInput,
  profile: SupplyChainDesignWarehouseCostProfileInput
) {
  if (facility.sourceType === "CURRENT") {
    return calculateCurrentFacilityWarehouseCostBasis(facility.warehouseCost);
  }
  return calculateCandidateWarehouseCostForPreparedProfile({
    candidate: facility.warehouseCost,
    profile
  });
}

function selectedFacilityEvidence(facility: SupplyChainDesignCombinedScenarioFacilityInput): SupplyChainDesignCombinedScenarioSelectedFacilityEvidence {
  const evidence = facility.sourceType === "CURRENT"
    ? calculateCurrentFacilityWarehouseCostBasis(facility.warehouseCost)
    : calculateCandidateWarehouseCostForPreparedProfile({
        candidate: facility.warehouseCost,
        profile: {
          profileKey: "__selected_facility_basis__",
          representedShipments: 0,
          representativePallets: 0,
          inventoryDwellTimeDays: 0,
          sourceLineage: []
        }
      });
  return {
    facilityId: facility.facilityId,
    facilityName: facility.facilityName,
    facilitySourceType: facility.sourceType,
    warehouseCostBasis: evidence.warehouseCostBasis,
    status: evidence.status,
    currency: evidence.currency,
    annualAllInCost: evidence.annualAllInCost,
    missingInputs: evidence.warehouseCostBasis === "ANNUAL_ALL_IN" ? evidence.missingInputs : []
  };
}

function selectWinningAlternative(alternatives: SupplyChainDesignCombinedScenarioAlternative[]) {
  return alternatives
    .filter((alternative) => alternative.complete && alternative.combinedAssignmentCost !== null && alternative.modeledTransportationCost !== null)
    .sort((left, right) =>
      left.combinedAssignmentCost! - right.combinedAssignmentCost! ||
      left.modeledTransportationCost! - right.modeledTransportationCost! ||
      left.facilityId.localeCompare(right.facilityId)
    )[0] ?? null;
}

function buildFacilityTotals(
  selectedFacilities: SupplyChainDesignCombinedScenarioFacilityInput[],
  winners: SupplyChainDesignCombinedScenarioAlternative[],
  selectedAnnualAllInCostByFacility: Map<string, number>
) {
  return selectedFacilities.map((facility) => {
    const key = facilityKey(facility.sourceType, facility.facilityId);
    const facilityWinners = winners.filter((winner) => facilityKey(winner.facilitySourceType, winner.facilityId) === key);
    const modeledTransportationCost = sum(facilityWinners.map((winner) => winner.modeledTransportationCost));
    const variableWarehouseCost = sum(facilityWinners.map((winner) => winner.variableWarehouseCost));
    const annualAllInWarehouseCost = selectedAnnualAllInCostByFacility.get(key) ?? 0;
    return {
      facilityId: facility.facilityId,
      facilityName: facility.facilityName,
      facilitySourceType: facility.sourceType,
      representedShipments: sum(facilityWinners.map((winner) => winner.representedShipments)),
      representedPallets: sum(facilityWinners.map((winner) => winner.representedPallets)),
      modeledTransportationCost: roundCurrency(modeledTransportationCost),
      variableWarehouseCost: roundCurrency(variableWarehouseCost),
      annualAllInWarehouseCost: roundCurrency(annualAllInWarehouseCost),
      totalFacilityContribution: roundCurrency(modeledTransportationCost + variableWarehouseCost + annualAllInWarehouseCost)
    };
  });
}

function collectCurrencies(
  transportationCurrency: string,
  selectedFacilityCostEvidence: SupplyChainDesignCombinedScenarioSelectedFacilityEvidence[],
  winners: SupplyChainDesignCombinedScenarioAlternative[]
) {
  const currencies = new Set<string>();
  if (transportationCurrency.trim()) currencies.add(transportationCurrency.trim().toUpperCase());
  for (const facility of selectedFacilityCostEvidence) {
    if (facility.currency?.trim()) {
      currencies.add(facility.currency.trim().toUpperCase());
    }
  }
  for (const winner of winners) {
    if (winner.variableWarehouseCost !== null && winner.warehouseCostEvidence?.currency?.trim()) {
      currencies.add(winner.warehouseCostEvidence.currency.trim().toUpperCase());
    }
  }
  return [...currencies].sort();
}

function collectIncompleteness(input: {
  profileResults: SupplyChainDesignCombinedScenarioProfileResult[];
  selectedFacilityCostEvidence: SupplyChainDesignCombinedScenarioSelectedFacilityEvidence[];
  currencies: string[];
}) {
  const reasons = new Set<"rates" | "warehouse" | "currency" | "no_alternatives">();
  if (input.currencies.length > 1 || input.currencies.some((currency) => !["USD", "CAD"].includes(currency))) {
    reasons.add("currency");
  }
  for (const facility of input.selectedFacilityCostEvidence) {
    if (facility.warehouseCostBasis === "ANNUAL_ALL_IN" && facility.annualAllInCost === null) {
      reasons.add("warehouse");
    }
  }
  for (const profile of input.profileResults) {
    if (!profile.winnerFacilityId) {
      if (profile.alternatives.length === 0) {
        reasons.add("no_alternatives");
        continue;
      }
      const missing = profile.alternatives.flatMap((alternative) => alternative.missingReasons);
      if (missing.some((reason) => reason.includes("rate") || reason === "missing_rate")) reasons.add("rates");
      if (missing.some((reason) => reason.includes("currency"))) reasons.add("currency");
      if (missing.some((reason) => !reason.includes("rate") && !reason.includes("currency"))) reasons.add("warehouse");
    }
  }
  return reasons;
}

function toScenarioStatus(reasons: Set<"rates" | "warehouse" | "currency" | "no_alternatives">): SupplyChainDesignCombinedScenarioCompleteness {
  if (reasons.size === 0) return "COMPLETE";
  if (reasons.size > 1) return "INCOMPLETE_MULTIPLE_REASONS";
  if (reasons.has("no_alternatives")) return "INCOMPLETE_NO_SCENARIO_ALTERNATIVES";
  if (reasons.has("currency")) return "INCOMPLETE_MIXED_CURRENCY";
  if (reasons.has("rates")) return "INCOMPLETE_RATES";
  return "INCOMPLETE_WAREHOUSE_COST";
}

function summarizeIncompleteReasons(alternatives: SupplyChainDesignCombinedScenarioAlternative[]) {
  return unique(alternatives.flatMap((alternative) => alternative.missingReasons)).join(", ") || "No complete scenario alternative.";
}

function sameAlternative(left: SupplyChainDesignCombinedScenarioAlternative, right: SupplyChainDesignCombinedScenarioAlternative) {
  return left.profileKey === right.profileKey && left.facilityId === right.facilityId && left.facilitySourceType === right.facilitySourceType;
}

function facilityKey(sourceType: "CURRENT" | "CANDIDATE", facilityId: string) {
  return `${sourceType}:${facilityId}`;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function sum(values: Array<number | null>) {
  return values.reduce((total, value) => total + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000000) / 1000000;
}
