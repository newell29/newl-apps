import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import {
  CENSUS_ZCTA_2025_COORDINATE_SOURCE,
  normalizeUsZipCode,
  resolveUsZipCentroid
} from "@/modules/supply-chain-design/reference-data/us-zip-centroids";
import {
  NEWL_CANADA_PROVINCE_MARKET_MAP,
  NEWL_LOGISTICS_MARKET_CATALOGUE,
  type NewlLogisticsMarketCatalogueRow
} from "@/modules/supply-chain-design/reference-data/logistics-market-catalogue";
import {
  CANADIAN_DELIVERY_LOCATION_SOURCE,
  nearestCanadianDeliveryLocation,
  resolveCanadianDeliveryCity
} from "@/modules/supply-chain-design/reference-data/canadian-delivery-locations";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";

export const WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION = "WAREHOUSE_LOCATION_STRATEGY_V9";
export const WAREHOUSE_LOCATION_STRATEGY_CALCULATION_VERSION = "WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V9";
export const WAREHOUSE_LOCATION_STRATEGY_INCREMENTAL_THRESHOLD = 0.15;
export const WAREHOUSE_LOCATION_STRATEGY_MIN_REGION_DEMAND_SHARE = 0.1;

export type WarehouseLocationStrategyWeightingMethod =
  | "SHIPMENTS_REPRESENTED"
  | "PALLETS"
  | "WEIGHT"
  | "UNITS"
  | "CURRENT_TRANSPORTATION_COST";

export type WarehouseLocationStrategyCountryScope = "ALL" | "US" | "CA" | "SEPARATE_BY_COUNTRY";
type WarehouseLocationStrategyMarketEligibility = "ALL" | "US" | "CA";
type WarehouseLocationStrategyNetworkStructure = "COMBINED" | "SEPARATE";

export type WarehouseLocationStrategyInput = {
  shipments: {
    fileId: string;
    mappingId: string;
    fileName?: string;
    fileBytes: Buffer;
    fieldMappings: SupplyChainDesignFieldMapping[];
  };
  maxRegions: 1 | 2 | 3;
  weightingMethod: WarehouseLocationStrategyWeightingMethod;
  countryScope: WarehouseLocationStrategyCountryScope;
  cadToUsdRate?: number | null;
};

export type WarehouseLocationStrategyResultSummary = {
  resultVersion: typeof WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION | "WAREHOUSE_LOCATION_STRATEGY_V2" | "WAREHOUSE_LOCATION_STRATEGY_V3" | "WAREHOUSE_LOCATION_STRATEGY_V4" | "WAREHOUSE_LOCATION_STRATEGY_V5" | "WAREHOUSE_LOCATION_STRATEGY_V6" | "WAREHOUSE_LOCATION_STRATEGY_V7" | "WAREHOUSE_LOCATION_STRATEGY_V8";
  calculationVersion: typeof WAREHOUSE_LOCATION_STRATEGY_CALCULATION_VERSION | "WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V2" | "WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V3" | "WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V4" | "WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V5" | "WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V6" | "WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V7" | "WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V8";
  coordinateSources: string[];
  maxRegions: 1 | 2 | 3;
  weightingMethod: WarehouseLocationStrategyWeightingMethod;
  countryScope: WarehouseLocationStrategyCountryScope;
  demandInclusion?: "ALL_ELIGIBLE";
  networkStructure?: WarehouseLocationStrategyNetworkStructure;
  marketEligibility?: WarehouseLocationStrategyMarketEligibility;
  selectedDemandCurrency?: string | null;
  spendCurrencyMode?: "SINGLE_CURRENCY" | "CONVERTED_MIXED_CURRENCY" | null;
  originalSpendCurrencies?: string[];
  cadToUsdRate?: number | null;
  recommendationThresholds: {
    minimumIncrementalImprovementPercent: 15;
    minimumSelectedDemandSharePercent: 10;
  };
  eligibleDestinationProfiles: number;
  shipmentsRepresented: number;
  selectedTotalDemandWeight: number;
  excludedDestinationCount: number;
  recommendedRegionCount: number;
  recommendedSolutions: LocationStrategySolution[];
  solutions: LocationStrategySolution[];
  recommendedSolution: LocationStrategySolution;
  rowIssues: LocationStrategyIssue[];
  assumptions: string[];
  performance: {
    eligibleProfiles: number;
    maximumIterations: number;
    practicalScale: string;
  };
};

export type LocationStrategySolution = {
  solutionId: string;
  regionCount: number;
  country: string | null;
  eligibleDestinationProfiles: number;
  shipmentsRepresented: number;
  selectedTotalDemandWeight: number;
  totalWeightedDistance: number;
  averageWeightedDistance: number;
  maximumAssignedDistance: number;
  improvementVersusOneRegion: number | null;
  incrementalImprovement: number | null;
  improvementVersusOneRegionPercent: number | null;
  incrementalImprovementPercent: number | null;
  minimumRegionDemandSharePercent: number;
  recommendationStatus: "Recommended" | "Available";
  recommendationExplanation: string;
  demandWithinDistanceBands: DistanceBandSummary[];
  regions: LocationStrategyRegion[];
  assignments: LocationStrategyAssignment[];
  clusteringDiagnostics: LocationStrategyClusteringDiagnostics;
  complexity: "Lowest operating complexity" | "Moderate operating complexity" | "Highest operating complexity";
};

export type LocationStrategyRegion = {
  regionId: string;
  regionNumber: number;
  label: string;
  recommendedMarketLabel: string;
  recommendedCityStateLabel: string;
  recommendedMarketId: string | null;
  recommendedMarketLatitude: number | null;
  recommendedMarketLongitude: number | null;
  recommendedMarketDistanceMiles: number | null;
  labelSource: "NEWL_LOGISTICS_MARKET_CATALOGUE" | "NEWL_CANADA_PROVINCE_MARKET_MAP";
  precisionCategory: "SUPPORTED_US_MARKET" | "BROAD_CANADIAN_PROVINCE_MARKET";
  country: string;
  stateProvince: string | null;
  broadRegionApproximation: boolean;
  centerLatitude: number;
  centerLongitude: number;
  searchRadiusMiles: number | null;
  radiusNote: string;
  assignedProfileCount: number;
  distinctDestinationCount: number;
  shipmentsRepresented: number;
  pallets: number | null;
  weight: number | null;
  weightUnit: string | null;
  units: number | null;
  currentTransportationCost: number | null;
  selectedMetricWeight: number;
  selectedDemandSharePercent: number;
  supportStatus: "Sufficient demand" | "Insufficient demand share";
  averageAssignedDistance: number;
  maximumAssignedDistance: number;
  distanceBands: DistanceBandSummary[];
};

export type LocationStrategyAssignment = {
  solutionRegionCount: number;
  solutionRecommendationStatus: "Recommended" | "Available";
  assignedRegion: number;
  sourceReference: string;
  recordType: string;
  transportationMode: string | null;
  destinationLabel: string | null;
  destinationPostalCode: string;
  destinationCountry: string;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  destinationMarketLabel: string | null;
  destinationProvince: string | null;
  destinationBroadApproximation: boolean;
  coordinateSource: string;
  coordinatePrecision: "ZIP_ZCTA_CENTROID" | "CANADIAN_DELIVERY_CITY" | "BROAD_CANADIAN_PROVINCE_MARKET";
  shipmentsRepresented: number;
  pallets: number | null;
  weight: number | null;
  weightUnit: string | null;
  units: number | null;
  currentTransportationCost: number | null;
  currency: string | null;
  selectedMetric: WarehouseLocationStrategyWeightingMethod;
  selectedWeight: number;
  regionCenterLatitude: number;
  regionCenterLongitude: number;
  searchRegionLabel: string;
  recommendedMarketLabel: string;
  recommendedMarketLatitude: number | null;
  recommendedMarketLongitude: number | null;
  recommendedMarketPrecisionCategory: "SUPPORTED_US_MARKET" | "BROAD_CANADIAN_PROVINCE_MARKET";
  labelSource: string;
  precisionCategory: string;
  distanceToCenter: number;
  distanceUnit: "miles";
  regionDemandSharePercent: number;
  regionSupportStatus: string;
};

export type LocationStrategyIssue = {
  sourceReference: string;
  rowNumber: number;
  destinationPostalCode: string;
  country: string;
  reason: string;
};

type DistanceBandSummary = {
  label: string;
  maximumMiles: number | null;
  selectedWeight: number;
  selectedWeightPercent: number;
};

type DemandProfile = {
  sourceReference: string;
  recordType: string;
  transportationMode: string | null;
  destinationLabel: string | null;
  destinationPostalCode: string;
  country: string;
  stateProvince: string | null;
  latitude: number;
  longitude: number;
  marketLabel: string | null;
  coordinateSource: string;
  coordinatePrecision: LocationStrategyAssignment["coordinatePrecision"];
  shipmentsRepresented: number;
  pallets: number | null;
  weight: number | null;
  weightUnit: string | null;
  units: number | null;
  currentTransportationCost: number | null;
  currency: string | null;
  selectedWeight: number;
};

export type LocationStrategyClusteringDiagnostics = {
  seedMethod: "FARTHEST_WEIGHTED_DETERMINISTIC";
  initialSeedCoordinates: Array<{ latitude: number; longitude: number }>;
  finalCenterCoordinates: Array<{ latitude: number; longitude: number }>;
  iterationsPerformed: number;
  converged: boolean;
  convergenceCondition: "ROUNDED_CENTER_COORDINATES_UNCHANGED";
  maximumIterations: 40;
  emptyClusterRecovery: "FARTHEST_UNREPRESENTED_DESTINATION_OR_PREVIOUS_CENTER";
};

const MAX_CLUSTER_ITERATIONS = 40;
const DISTANCE_BANDS = [
  { label: "Within 100 miles", maximumMiles: 100 },
  { label: "Within 250 miles", maximumMiles: 250 },
  { label: "Within 500 miles", maximumMiles: 500 },
  { label: "Beyond 500 miles", maximumMiles: null }
] as const;

export function runSupplyChainDesignWarehouseLocationStrategy(input: WarehouseLocationStrategyInput): WarehouseLocationStrategyResultSummary {
  const parsed = parseDemandProfiles(input);
  if (parsed.profiles.length === 0) {
    throw new Error("No eligible Historical Shipments destinations could be resolved for Warehouse Location Strategy.");
  }
  const scopes = input.countryScope === "SEPARATE_BY_COUNTRY"
    ? [...new Set(parsed.profiles.map((profile) => profile.country))].sort()
    : [null];
  const rawSolutions = scopes.flatMap((country) => {
    const scopedProfiles = country ? parsed.profiles.filter((profile) => profile.country === country) : parsed.profiles;
    const supportedRegionCount = Math.min(input.maxRegions, scopedProfiles.length, distinctDestinationCount(scopedProfiles));
    if (supportedRegionCount < 1) return [];
    return Array.from({ length: supportedRegionCount }, (_, index) => buildSolution(scopedProfiles, index + 1, country, input.weightingMethod, marketEligibilityForCountryScope(input.countryScope, country)));
  });
  const improvedSolutions = attachImprovements(rawSolutions);
  const recommendedSolutions = selectRecommendedSolutions(improvedSolutions);
  const solutions = improvedSolutions.map((solution) => {
    const recommended = recommendedSolutions.some((row) => row.solutionId === solution.solutionId);
    const recommendationStatus = recommended ? "Recommended" as const : "Available" as const;
    return {
      ...solution,
      recommendationStatus,
      recommendationExplanation: recommended ? recommendationSuccessMessage(solution) : recommendationRejectionMessage(solution),
      assignments: solution.assignments.map((assignment) => ({ ...assignment, solutionRecommendationStatus: recommendationStatus }))
    };
  });
  const recommendedSolution = solutions.find((solution) => solution.solutionId === recommendedSolutions[0]?.solutionId) ?? solutions[0];
  const finalRecommendedSolutions = recommendedSolutions
    .map((recommended) => solutions.find((solution) => solution.solutionId === recommended.solutionId))
    .filter((solution): solution is LocationStrategySolution => Boolean(solution));

  return {
    resultVersion: WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION,
    calculationVersion: WAREHOUSE_LOCATION_STRATEGY_CALCULATION_VERSION,
    coordinateSources: [...new Set(parsed.profiles.map((profile) => profile.coordinateSource))].sort(),
    maxRegions: input.maxRegions,
    weightingMethod: input.weightingMethod,
    countryScope: input.countryScope,
    demandInclusion: "ALL_ELIGIBLE",
    networkStructure: input.countryScope === "SEPARATE_BY_COUNTRY" ? "SEPARATE" : "COMBINED",
    marketEligibility: marketEligibilityForCountryScope(input.countryScope, null),
    selectedDemandCurrency: input.weightingMethod === "CURRENT_TRANSPORTATION_COST" ? parsed.currency ?? null : null,
    spendCurrencyMode: input.weightingMethod === "CURRENT_TRANSPORTATION_COST" ? parsed.currencyMode : null,
    originalSpendCurrencies: input.weightingMethod === "CURRENT_TRANSPORTATION_COST" ? parsed.originalCurrencies : [],
    cadToUsdRate: parsed.currencyMode === "CONVERTED_MIXED_CURRENCY" ? input.cadToUsdRate ?? null : null,
    recommendationThresholds: {
      minimumIncrementalImprovementPercent: 15,
      minimumSelectedDemandSharePercent: 10
    },
    eligibleDestinationProfiles: parsed.profiles.length,
    shipmentsRepresented: round2(sum(parsed.profiles.map((profile) => profile.shipmentsRepresented))),
    selectedTotalDemandWeight: round2(sum(parsed.profiles.map((profile) => profile.selectedWeight))),
    excludedDestinationCount: parsed.issues.length,
    recommendedRegionCount: recommendedSolution.regionCount,
    recommendedSolutions: finalRecommendedSolutions,
    solutions,
    recommendedSolution,
    rowIssues: parsed.issues,
    assumptions: [
      "An additional region is recommended when it reduces weighted average distance by at least 15% and every proposed region represents at least 10% of selected demand.",
      "Location Strategy includes all valid delivery activity because every shipment contributes to warehouse demand.",
      "Warehouse network country option controls permitted practical warehouse markets; it does not remove delivery demand except for the separate-country network partition.",
      "Distances are straight-line Haversine miles, not road miles, carrier rates, service commitments, or financial savings.",
      "U.S. destinations use checked-in Census 2025 ZIP/ZCTA centroids.",
      "Canadian destination profiles use checked-in city coordinates where available, with approved province-market fallback only when a city cannot be resolved.",
      "Warehouse Location Strategy does not call 7L and does not evaluate real candidate addresses."
    ],
    performance: {
      eligibleProfiles: parsed.profiles.length,
      maximumIterations: MAX_CLUSTER_ITERATIONS,
      practicalScale: "O(k*n*i) for k <= 3; intended for hundreds or thousands of historical destination profiles."
    }
  };
}

export function exportWarehouseLocationStrategyCsv(result: WarehouseLocationStrategyResultSummary) {
  const headers = [
    "Solution region count",
    "Solution recommendation status",
    "Assigned region",
    "Recommended warehouse market",
    "Market country",
    "Market province/state",
    "Calculated center latitude",
    "Calculated center longitude",
    "Suggested search radius miles",
    "Region selected-demand share",
    "Region support status",
    "Source reference",
    "Record type",
    "Destination postal code",
    "Destination country",
    "Destination latitude",
    "Destination longitude",
    "Coordinate precision",
    "Shipments represented",
    "Pallets",
    "Weight",
    "Weight unit",
    "Units",
    "Current transportation cost",
    "Currency",
    "Selected weighting method",
    "Selected weighting value",
    "Distance to calculated center miles"
  ];
  const rows = result.solutions.flatMap((solution) =>
    solution.assignments.map((assignment) => [
      String(assignment.solutionRegionCount),
      assignment.solutionRecommendationStatus,
      String(assignment.assignedRegion),
      assignment.recommendedMarketLabel,
      assignment.destinationCountry,
      assignment.destinationMarketLabel ?? assignment.searchRegionLabel,
      String(assignment.regionCenterLatitude),
      String(assignment.regionCenterLongitude),
      assignment.assignedRegion ? String(solution.regions.find((region) => region.regionNumber === assignment.assignedRegion)?.searchRadiusMiles ?? "") : "",
      String(assignment.regionDemandSharePercent),
      assignment.regionSupportStatus,
      assignment.sourceReference,
      assignment.recordType,
      assignment.destinationPostalCode,
      assignment.destinationCountry,
      assignment.destinationLatitude === null ? "" : String(assignment.destinationLatitude),
      assignment.destinationLongitude === null ? "" : String(assignment.destinationLongitude),
      assignment.coordinatePrecision,
      String(assignment.shipmentsRepresented),
      assignment.pallets === null ? "" : String(assignment.pallets),
      assignment.weight === null ? "" : String(assignment.weight),
      assignment.weightUnit ?? "",
      assignment.units === null ? "" : String(assignment.units),
      assignment.currentTransportationCost === null ? "" : String(assignment.currentTransportationCost),
      assignment.currency ?? "",
      assignment.selectedMetric,
      String(assignment.selectedWeight),
      String(assignment.distanceToCenter)
    ])
  );
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function parseDemandProfiles(input: WarehouseLocationStrategyInput) {
  const rows = parseCsvRows(input.shipments.fileBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const indexes = new Map(input.shipments.fieldMappings.map((mapping) => [mapping.standardField, mapping.sourceColumn ? headers.indexOf(mapping.sourceColumn) : -1]));
  const profiles: DemandProfile[] = [];
  const issues: LocationStrategyIssue[] = [];
  const currencies = new Set<string>();
  const weightUnits = new Set<string>();

  for (const [rowIndex, row] of rows.slice(1).entries()) {
    const rowNumber = rowIndex + 2;
    const sourceReference = value(row, indexes, "shipment_reference") || value(row, indexes, "shipment_id") || `row-${rowNumber}`;
    const recordType = value(row, indexes, "record_type") || "Individual Shipment";
    const transportationMode = value(row, indexes, "transportation_mode") || value(row, indexes, "mode") || null;
    const destinationLabel = value(row, indexes, "destination_label") || null;
    const rawDestination = value(row, indexes, "postal_or_region_code") || value(row, indexes, "destination_id");
    const country = normalizeCountry(value(row, indexes, "country") || "US");
    const stateProvince = normalizeStateProvince(value(row, indexes, "state_province"));
    const shipments = parsePositive(value(row, indexes, "shipment_quantity")) ?? (recordType.toUpperCase() === "INDIVIDUAL SHIPMENT" ? 1 : null);
    const pallets = parsePositive(value(row, indexes, "pallets"));
    const weight = parsePositive(value(row, indexes, "weight"));
    const weightUnit = normalizeWeightUnit(value(row, indexes, "weight_unit"), weight);
    const units = parsePositive(value(row, indexes, "units"));
    const currentTransportationCost = parsePositive(value(row, indexes, "transportation_cost"));
    const currencyResult = normalizeCurrency(value(row, indexes, "currency"), currentTransportationCost);
    const currency = currencyResult.currency;

    if (!rawDestination) {
      issues.push(issue(sourceReference, rowNumber, rawDestination, country, "Missing destination postal code."));
      continue;
    }
    if (country !== "US" && country !== "CA") {
      issues.push(issue(sourceReference, rowNumber, rawDestination, country, "Unsupported destination country."));
      continue;
    }
    const coordinate = resolveCoordinate(rawDestination, country, stateProvince ?? "", destinationLabel);
    if (!coordinate) {
      issues.push(issue(sourceReference, rowNumber, rawDestination, country, "Destination could not be resolved to local reference coordinates."));
      continue;
    }
    const selectedWeight = selectWeight(input.weightingMethod, { shipments, pallets, weight, units, currentTransportationCost });
    if (!selectedWeight || !Number.isFinite(selectedWeight) || selectedWeight <= 0) {
      issues.push(issue(sourceReference, rowNumber, rawDestination, country, "Selected weighting value is missing, invalid, or not positive."));
      continue;
    }
    if (input.weightingMethod === "WEIGHT") {
      if (!weightUnit || (weightUnit !== "lb" && weightUnit !== "kg")) {
        issues.push(issue(sourceReference, rowNumber, rawDestination, country, "Weight unit is missing or incompatible for weight-based analysis."));
        continue;
      }
      weightUnits.add(weightUnit);
    }
    if (input.weightingMethod === "CURRENT_TRANSPORTATION_COST" && currencyResult.reason) {
      issues.push(issue(sourceReference, rowNumber, rawDestination, country, currencyResult.reason));
      continue;
    }
    if (input.weightingMethod === "CURRENT_TRANSPORTATION_COST" && currency) currencies.add(currency);
    profiles.push({
      sourceReference,
      recordType,
      transportationMode,
      destinationLabel,
    destinationPostalCode: country === "CA" ? rawDestination.toUpperCase() : coordinate.postalCode,
      country,
      stateProvince: coordinate.stateProvince ?? stateProvince,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      marketLabel: coordinate.marketLabel,
      coordinateSource: coordinate.source,
      coordinatePrecision: coordinate.precision,
      shipmentsRepresented: shipments ?? 1,
      pallets,
      weight: weightUnit === "kg" && weight !== null ? round2(weight * 2.2046226218) : weight,
      weightUnit: weightUnit === "kg" ? "lb" : weightUnit,
      units,
      currentTransportationCost,
      currency,
      selectedWeight: input.weightingMethod === "WEIGHT" && weightUnit === "kg" ? round2(selectedWeight * 2.2046226218) : selectedWeight
    });
  }

  let convertedProfiles = profiles;
  if (input.weightingMethod === "CURRENT_TRANSPORTATION_COST" && currencies.size > 1) {
    if (!currencies.has("USD") || !currencies.has("CAD") || currencies.size !== 2) {
      throw new Error("Historical transportation spend currency mix is not supported for conversion.");
    }
    if (!isValidCadToUsdRate(input.cadToUsdRate)) {
      throw new Error("Enter a CAD to USD conversion rate greater than 0 and no more than 5.");
    }
    convertedProfiles = profiles.map((profile) => ({
      ...profile,
      selectedWeight: convertSpendWeight(profile.selectedWeight, profile.currency, input.cadToUsdRate)
    }));
  }
  if (input.weightingMethod === "WEIGHT" && weightUnits.size > 1) {
    // Parsed rows are normalized to pounds, but this note catches impossible mixed unsupported states in tests.
    weightUnits.clear();
  }
  const originalCurrencies = [...currencies].sort();
  return {
    profiles: convertedProfiles,
    issues,
    currency: input.weightingMethod === "CURRENT_TRANSPORTATION_COST"
      ? originalCurrencies.length > 1 ? "USD" : originalCurrencies[0] ?? null
      : null,
    originalCurrencies,
    currencyMode: input.weightingMethod === "CURRENT_TRANSPORTATION_COST"
      ? originalCurrencies.length > 1 ? "CONVERTED_MIXED_CURRENCY" as const : "SINGLE_CURRENCY" as const
      : null
  };
}

function buildSolution(
  profiles: DemandProfile[],
  regionCount: number,
  country: string | null,
  weightingMethod: WarehouseLocationStrategyWeightingMethod,
  marketEligibility: WarehouseLocationStrategyMarketEligibility
): LocationStrategySolution {
  const orderedProfiles = canonicalProfiles(profiles);
  const clustering = runWeightedSphericalKMeans(orderedProfiles, regionCount);
  const centers = clustering.centers;
  const assignments = assignProfiles(orderedProfiles, centers);
  const regions = centers.map((center, index) =>
    buildRegion(index + 1, center, assignments.filter((row) => row.regionIndex === index), orderedProfiles, marketEligibility)
  ).filter((region) => region.assignedProfileCount > 0);
  const remappedAssignments = assignProfiles(orderedProfiles, regions.map((region) => ({ latitude: region.centerLatitude, longitude: region.centerLongitude })));
  const finalAssignments = remappedAssignments.map((assignment) => toAssignment(regionCount, assignment.profile, regions[assignment.regionIndex], weightingMethod));
  const weightedDistances = finalAssignments.map((assignment) => assignment.distanceToCenter * assignment.selectedWeight);
  const totalWeight = sum(finalAssignments.map((assignment) => assignment.selectedWeight));
  const averageWeightedDistance = totalWeight ? round1(sum(weightedDistances) / totalWeight) : 0;
  return {
    solutionId: `${country ?? "ALL"}-${regionCount}`,
    regionCount,
    country,
    eligibleDestinationProfiles: finalAssignments.length,
    shipmentsRepresented: round2(sum(finalAssignments.map((assignment) => assignment.shipmentsRepresented))),
    selectedTotalDemandWeight: round2(totalWeight),
    totalWeightedDistance: round2(sum(weightedDistances)),
    averageWeightedDistance,
    maximumAssignedDistance: round1(Math.max(0, ...finalAssignments.map((assignment) => assignment.distanceToCenter))),
    improvementVersusOneRegion: null,
    incrementalImprovement: null,
    improvementVersusOneRegionPercent: null,
    incrementalImprovementPercent: null,
    minimumRegionDemandSharePercent: round1(Math.min(...regions.map((region) => region.selectedDemandSharePercent))),
    recommendationStatus: "Available",
    recommendationExplanation: "",
    demandWithinDistanceBands: distanceBands(finalAssignments.map((assignment) => ({ distance: assignment.distanceToCenter, weight: assignment.selectedWeight }))),
    regions,
    assignments: finalAssignments,
    clusteringDiagnostics: {
      ...clustering.diagnostics,
      finalCenterCoordinates: regions.map((region) => ({ latitude: region.centerLatitude, longitude: region.centerLongitude }))
    },
    complexity: complexityLabel(regionCount)
  };
}

function runWeightedSphericalKMeans(profiles: DemandProfile[], regionCount: number) {
  let centers = seedCenters(profiles, regionCount);
  const initialSeedCoordinates = centers.map((center) => ({ ...center }));
  let iterationsPerformed = 0;
  let converged = false;
  for (let iteration = 0; iteration < MAX_CLUSTER_ITERATIONS; iteration += 1) {
    const assignments = assignProfiles(profiles, centers);
    const next = centers.map((center, index) => sphericalWeightedCenter(assignments.filter((row) => row.regionIndex === index).map((row) => row.profile)) ?? farthestUnrepresentedCenter(profiles, centers) ?? center);
    iterationsPerformed = iteration + 1;
    if (centersEqual(next, centers)) {
      converged = true;
      break;
    }
    centers = next;
  }
  return {
    centers,
    diagnostics: {
      seedMethod: "FARTHEST_WEIGHTED_DETERMINISTIC" as const,
      initialSeedCoordinates,
      finalCenterCoordinates: centers.map((center) => ({ ...center })),
      iterationsPerformed,
      converged,
      convergenceCondition: "ROUNDED_CENTER_COORDINATES_UNCHANGED" as const,
      maximumIterations: MAX_CLUSTER_ITERATIONS as 40,
      emptyClusterRecovery: "FARTHEST_UNREPRESENTED_DESTINATION_OR_PREVIOUS_CENTER" as const
    }
  };
}

function seedCenters(profiles: DemandProfile[], regionCount: number) {
  const sorted = canonicalProfiles(profiles);
  const centers = [coordinate(sorted[0])];
  while (centers.length < regionCount) {
    const candidate = sorted
      .filter((profile) => !centers.some((center) => sameCoordinate(center, profile)))
      .map((profile) => ({
        profile,
        score: nearestCenterDistance(profile, centers) * Math.sqrt(profile.selectedWeight)
      }))
      .sort((left, right) => right.score - left.score || compareProfiles(left.profile, right.profile))[0]?.profile;
    if (!candidate) break;
    centers.push(coordinate(candidate));
  }
  return centers;
}

function canonicalProfiles(profiles: DemandProfile[]) {
  return [...profiles].sort(compareProfiles);
}

function compareProfiles(left: DemandProfile, right: DemandProfile) {
  return right.selectedWeight - left.selectedWeight ||
    left.country.localeCompare(right.country) ||
    left.destinationPostalCode.localeCompare(right.destinationPostalCode) ||
    left.latitude - right.latitude ||
    left.longitude - right.longitude ||
    (left.destinationLabel ?? "").localeCompare(right.destinationLabel ?? "") ||
    left.recordType.localeCompare(right.recordType) ||
    (left.transportationMode ?? "").localeCompare(right.transportationMode ?? "") ||
    left.sourceReference.localeCompare(right.sourceReference);
}

function assignProfiles(profiles: DemandProfile[], centers: Array<{ latitude: number; longitude: number }>) {
  return profiles.map((profile) => {
    const nearest = centers
      .map((center, index) => ({ index, distance: haversineMiles(profile.latitude, profile.longitude, center.latitude, center.longitude) }))
      .sort((left, right) => left.distance - right.distance || left.index - right.index)[0];
    return { profile, regionIndex: nearest.index, distance: nearest.distance };
  });
}

function sphericalWeightedCenter(profiles: DemandProfile[]) {
  const total = sum(profiles.map((profile) => profile.selectedWeight));
  if (!total) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const profile of profiles) {
    const lat = radians(profile.latitude);
    const lon = radians(profile.longitude);
    x += Math.cos(lat) * Math.cos(lon) * profile.selectedWeight;
    y += Math.cos(lat) * Math.sin(lon) * profile.selectedWeight;
    z += Math.sin(lat) * profile.selectedWeight;
  }
  x /= total;
  y /= total;
  z /= total;
  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);
  return { latitude: round6(degrees(lat)), longitude: round6(degrees(lon)) };
}

function buildRegion(
  regionNumber: number,
  center: { latitude: number; longitude: number },
  rows: Array<{ profile: DemandProfile; distance: number }>,
  allProfiles: DemandProfile[],
  marketEligibility: WarehouseLocationStrategyMarketEligibility
): LocationStrategyRegion {
  const totalWeight = sum(allProfiles.map((profile) => profile.selectedWeight));
  const selectedWeight = sum(rows.map((row) => row.profile.selectedWeight));
  const sharePercent = totalWeight ? round1((selectedWeight / totalWeight) * 100) : 0;
  const shipments = round2(sum(rows.map((row) => row.profile.shipmentsRepresented)));
  const market = nearestSupportedMarket(center, rows, marketEligibility);
  const country = market.country;
  const distances = rows.map((row) => row.distance);
  const supportStatus = sharePercent < 10 ? "Insufficient demand share" : "Sufficient demand";
  const hasOnlyBroadCanadianDestinationCoordinates = rows.every((row) => row.profile.coordinatePrecision === "BROAD_CANADIAN_PROVINCE_MARKET");
  const useBroadCanadianRadiusDeferral = market.broadRegionApproximation && hasOnlyBroadCanadianDestinationCoordinates;
  return {
    regionId: `${country}-${regionNumber}`,
    regionNumber,
    label: market.label,
    recommendedMarketLabel: market.label,
    recommendedCityStateLabel: market.cityStateLabel,
    recommendedMarketId: market.marketId,
    recommendedMarketLatitude: market.latitude,
    recommendedMarketLongitude: market.longitude,
    recommendedMarketDistanceMiles: market.distanceMiles,
    labelSource: market.labelSource,
    precisionCategory: market.precisionCategory,
    country,
    stateProvince: market.stateProvince,
    broadRegionApproximation: market.broadRegionApproximation,
    centerLatitude: round6(center.latitude),
    centerLongitude: round6(center.longitude),
    searchRadiusMiles: useBroadCanadianRadiusDeferral ? null : suggestedSearchRadiusMiles(rows),
    radiusNote: useBroadCanadianRadiusDeferral
      ? "Approximate broad-region recommendation; precise postal-code radius is deferred for Canada."
      : "Weighted 85th percentile of assigned destination distances, rounded up to the nearest 25 miles.",
    assignedProfileCount: rows.length,
    distinctDestinationCount: distinctDestinationCount(rows.map((row) => row.profile)),
    shipmentsRepresented: shipments,
    pallets: nullableSum(rows.map((row) => row.profile.pallets)),
    weight: nullableSum(rows.map((row) => row.profile.weight)),
    weightUnit: uniqueOrNull(rows.map((row) => row.profile.weightUnit).filter((unit): unit is string => Boolean(unit))),
    units: nullableSum(rows.map((row) => row.profile.units)),
    currentTransportationCost: nullableSum(rows.map((row) => row.profile.currentTransportationCost)),
    selectedMetricWeight: round2(selectedWeight),
    selectedDemandSharePercent: sharePercent,
    supportStatus,
    averageAssignedDistance: selectedWeight ? round1(sum(rows.map((row) => row.distance * row.profile.selectedWeight)) / selectedWeight) : 0,
    maximumAssignedDistance: round1(Math.max(0, ...distances)),
    distanceBands: distanceBands(rows.map((row) => ({ distance: row.distance, weight: row.profile.selectedWeight })))
  };
}

function toAssignment(
  regionCount: number,
  profile: DemandProfile,
  region: LocationStrategyRegion,
  selectedMetric: WarehouseLocationStrategyWeightingMethod
): LocationStrategyAssignment {
  return {
    solutionRegionCount: regionCount,
    solutionRecommendationStatus: "Available",
    assignedRegion: region.regionNumber,
    sourceReference: profile.sourceReference,
    recordType: profile.recordType,
    transportationMode: profile.transportationMode,
    destinationLabel: profile.destinationLabel,
    destinationPostalCode: profile.destinationPostalCode,
    destinationCountry: profile.country,
    destinationLatitude: profile.latitude,
    destinationLongitude: profile.longitude,
    destinationMarketLabel: profile.marketLabel,
    destinationProvince: profile.stateProvince,
    destinationBroadApproximation: profile.coordinatePrecision === "BROAD_CANADIAN_PROVINCE_MARKET",
    coordinateSource: profile.coordinateSource,
    coordinatePrecision: profile.coordinatePrecision,
    shipmentsRepresented: profile.shipmentsRepresented,
    pallets: profile.pallets,
    weight: profile.weight,
    weightUnit: profile.weightUnit,
    units: profile.units,
    currentTransportationCost: profile.currentTransportationCost,
    currency: profile.currency,
    selectedMetric,
    selectedWeight: profile.selectedWeight,
    regionCenterLatitude: region.centerLatitude,
    regionCenterLongitude: region.centerLongitude,
    searchRegionLabel: region.label,
    recommendedMarketLabel: region.recommendedMarketLabel,
    recommendedMarketLatitude: region.recommendedMarketLatitude,
    recommendedMarketLongitude: region.recommendedMarketLongitude,
    recommendedMarketPrecisionCategory: region.precisionCategory,
    labelSource: region.labelSource,
    precisionCategory: profile.coordinatePrecision,
    distanceToCenter: round1(haversineMiles(profile.latitude, profile.longitude, region.centerLatitude, region.centerLongitude)),
    distanceUnit: "miles",
    regionDemandSharePercent: region.selectedDemandSharePercent,
    regionSupportStatus: region.supportStatus
  };
}

function attachImprovements(solutions: LocationStrategySolution[]) {
  const byCountry = new Map<string, LocationStrategySolution[]>();
  for (const solution of solutions) {
    const key = solution.country ?? "ALL";
    byCountry.set(key, [...(byCountry.get(key) ?? []), solution]);
  }
  return solutions.map((solution) => {
    const group = (byCountry.get(solution.country ?? "ALL") ?? []).sort((left, right) => left.regionCount - right.regionCount);
    const one = group.find((row) => row.regionCount === 1);
    const previous = group.find((row) => row.regionCount === solution.regionCount - 1);
    return {
      ...solution,
      improvementVersusOneRegion: one && solution.regionCount !== 1 ? round1(one.averageWeightedDistance - solution.averageWeightedDistance) : null,
      incrementalImprovement: previous ? round1(previous.averageWeightedDistance - solution.averageWeightedDistance) : null,
      improvementVersusOneRegionPercent: one && solution.regionCount !== 1 ? improvementPercent(one.averageWeightedDistance, solution.averageWeightedDistance) : null,
      incrementalImprovementPercent: previous ? improvementPercent(previous.averageWeightedDistance, solution.averageWeightedDistance) : null
    };
  });
}

function selectRecommendedSolutions(solutions: LocationStrategySolution[]) {
  const byCountry = new Map<string, LocationStrategySolution[]>();
  for (const solution of solutions) {
    const key = solution.country ?? "ALL";
    byCountry.set(key, [...(byCountry.get(key) ?? []), solution]);
  }
  return [...byCountry.values()].map((group) => selectRecommendedSolution(group));
}

function marketEligibilityForCountryScope(
  countryScope: WarehouseLocationStrategyCountryScope,
  partitionCountry: string | null
): WarehouseLocationStrategyMarketEligibility {
  if (countryScope === "US") return "US";
  if (countryScope === "CA") return "CA";
  if (countryScope === "SEPARATE_BY_COUNTRY") return partitionCountry === "CA" ? "CA" : partitionCountry === "US" ? "US" : "ALL";
  return "ALL";
}

function selectRecommendedSolution(solutions: LocationStrategySolution[]) {
  const ordered = [...solutions].sort((left, right) => left.regionCount - right.regionCount);
  let recommended = ordered[0];
  for (const candidate of ordered.slice(1)) {
    const improvement = improvementRatio(recommended.averageWeightedDistance, candidate.averageWeightedDistance);
    if (improvement !== null && improvement >= WAREHOUSE_LOCATION_STRATEGY_INCREMENTAL_THRESHOLD && hasMeaningfulRegions(candidate)) {
      recommended = candidate;
      continue;
    }
    break;
  }
  return recommended;
}

function recommendationSuccessMessage(solution: LocationStrategySolution) {
  if (solution.regionCount === 1) return "Recommended - baseline geography; additional regions did not meet the improvement and demand thresholds.";
  return `Recommended - weighted average straight-line distance improves by ${formatPercentValue(solution.incrementalImprovementPercent)}, and every proposed region represents at least 10% of selected demand.`;
}

function recommendationRejectionMessage(solution: LocationStrategySolution) {
  if (solution.regionCount === 1) return "Available - one-region baseline.";
  if ((solution.incrementalImprovementPercent ?? 0) < 15) {
    return `Not recommended - the additional region improves average distance by only ${formatPercentValue(solution.incrementalImprovementPercent)}.`;
  }
  const weakShare = solution.regions.find((region) => region.selectedDemandSharePercent < 10);
  if (weakShare) return `Not recommended - one region contains only ${formatPercentValue(weakShare.selectedDemandSharePercent)} of selected demand.`;
  return "Available - not selected by the incremental recommendation rule.";
}

function hasMeaningfulRegions(solution: LocationStrategySolution) {
  return solution.regions.every(
    (region) =>
      region.selectedDemandSharePercent >= WAREHOUSE_LOCATION_STRATEGY_MIN_REGION_DEMAND_SHARE * 100
  );
}

function distanceBands(rows: Array<{ distance: number; weight: number }>) {
  const total = sum(rows.map((row) => row.weight));
  return DISTANCE_BANDS.map((band) => {
    const selectedWeight = sum(rows.filter((row) => band.maximumMiles === null ? row.distance > 500 : row.distance <= band.maximumMiles).map((row) => row.weight));
    return { label: band.label, maximumMiles: band.maximumMiles, selectedWeight: round2(selectedWeight), selectedWeightPercent: total ? round1((selectedWeight / total) * 100) : 0 };
  });
}

function nearestSupportedMarket(
  center: { latitude: number; longitude: number },
  rows: Array<{ profile: DemandProfile }>,
  marketEligibility: WarehouseLocationStrategyMarketEligibility
) {
  const country = marketEligibility === "ALL" ? null : marketEligibility;
  const province = country === "CA" ? classifyCanadianCenterProvince(center) : country ? dominantStateProvince(rows, country) : null;
  const candidates = NEWL_LOGISTICS_MARKET_CATALOGUE
    .filter((market) => market.activeEligible && (!country || market.country === country))
    .filter((market) => country !== "CA" || !province || market.stateProvince === province);
  const selected = candidates
    .map((market) => ({ market, distanceMiles: haversineMiles(center.latitude, center.longitude, market.latitude, market.longitude) }))
    .sort((left, right) => left.distanceMiles - right.distanceMiles || left.market.marketId.localeCompare(right.market.marketId))[0];
  if (selected) return marketLabel(selected.market, selected.distanceMiles);
  return {
    label: `Search region near ${center.latitude.toFixed(2)}, ${center.longitude.toFixed(2)}`,
    cityStateLabel: country ?? "US/CA",
    marketId: null,
    latitude: null,
    longitude: null,
    distanceMiles: null,
    stateProvince: province,
    country: country ?? dominantCountry(rows),
    labelSource: "NEWL_LOGISTICS_MARKET_CATALOGUE" as const,
    precisionCategory: country === "CA" ? "BROAD_CANADIAN_PROVINCE_MARKET" as const : "SUPPORTED_US_MARKET" as const,
    broadRegionApproximation: country === "CA"
  };
}

export function selectNearestWarehouseLocationStrategyPracticalMarket(
  center: { latitude: number; longitude: number },
  marketEligibility: WarehouseLocationStrategyMarketEligibility = "ALL"
) {
  return nearestSupportedMarket(center, [], marketEligibility);
}

function marketLabel(market: NewlLogisticsMarketCatalogueRow, distanceMiles: number) {
  return {
    label: market.marketName,
    cityStateLabel: `${market.representativeMajorCity}, ${market.stateProvince}`,
    marketId: market.marketId,
    latitude: market.latitude,
    longitude: market.longitude,
    distanceMiles: round1(distanceMiles),
    stateProvince: market.stateProvince,
    country: market.country,
    labelSource: market.country === "CA" ? "NEWL_CANADA_PROVINCE_MARKET_MAP" as const : "NEWL_LOGISTICS_MARKET_CATALOGUE" as const,
    precisionCategory: market.country === "CA" ? "BROAD_CANADIAN_PROVINCE_MARKET" as const : "SUPPORTED_US_MARKET" as const,
    broadRegionApproximation: market.country === "CA"
  };
}

function dominantCountry(rows: Array<{ profile: DemandProfile }>) {
  const weightsByCountry = new Map<string, number>();
  for (const row of rows) {
    weightsByCountry.set(row.profile.country, (weightsByCountry.get(row.profile.country) ?? 0) + row.profile.selectedWeight);
  }
  return [...weightsByCountry.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "US";
}

function dominantStateProvince(rows: Array<{ profile: DemandProfile }>, country: string) {
  const weightsByProvince = new Map<string, number>();
  for (const row of rows) {
    if (row.profile.country !== country || !row.profile.stateProvince) continue;
    weightsByProvince.set(row.profile.stateProvince, (weightsByProvince.get(row.profile.stateProvince) ?? 0) + row.profile.selectedWeight);
  }
  return [...weightsByProvince.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function suggestedSearchRadiusMiles(rows: Array<{ distance: number; profile: DemandProfile }>) {
  const percentileDistance = weightedDistancePercentile(rows, 0.85);
  return Math.max(25, Math.ceil(percentileDistance / 25) * 25);
}

function weightedDistancePercentile(rows: Array<{ distance: number; profile: DemandProfile }>, percentile: number) {
  const ordered = [...rows].sort((left, right) => left.distance - right.distance);
  const totalWeight = sum(ordered.map((row) => row.profile.selectedWeight));
  if (!totalWeight) return 0;
  const threshold = totalWeight * percentile;
  let cumulative = 0;
  for (const row of ordered) {
    cumulative += row.profile.selectedWeight;
    if (cumulative >= threshold) return row.distance;
  }
  return ordered.at(-1)?.distance ?? 0;
}

function distinctDestinationCount(profiles: DemandProfile[]) {
  return new Set(profiles.map((profile) => `${profile.country}:${profile.destinationPostalCode}`)).size;
}

function selectWeight(method: WarehouseLocationStrategyWeightingMethod, values: { shipments: number | null; pallets: number | null; weight: number | null; units: number | null; currentTransportationCost: number | null }) {
  if (method === "SHIPMENTS_REPRESENTED") return values.shipments;
  if (method === "PALLETS") return values.pallets;
  if (method === "WEIGHT") return values.weight;
  if (method === "UNITS") return values.units;
  return values.currentTransportationCost;
}

function convertSpendWeight(value: number, currency: string | null, cadToUsdRate?: number | null) {
  if (currency === "CAD" && isValidCadToUsdRate(cadToUsdRate)) return round2(value * cadToUsdRate);
  return value;
}

function isValidCadToUsdRate(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 5;
}

function resolveCoordinate(postalCode: string, country: string, stateProvince: string, destinationLabel: string | null) {
  if (country === "US") {
    const normalized = normalizeUsZipCode(postalCode);
    if (!normalized.ok) return null;
    const centroid = resolveUsZipCentroid(normalized.zipCode);
    return centroid ? {
      postalCode: normalized.zipCode,
      latitude: centroid.latitude,
      longitude: centroid.longitude,
      marketLabel: null,
      source: CENSUS_ZCTA_2025_COORDINATE_SOURCE,
      precision: "ZIP_ZCTA_CENTROID" as const,
      stateProvince: null
    } : null;
  }
  if (country === "CA") {
    const province = stateProvince.trim().toUpperCase();
    const cityLocation = resolveCanadianDeliveryCity(destinationLabel, province);
    if (cityLocation) {
      return {
        postalCode: postalCode.trim().toUpperCase(),
        latitude: cityLocation.latitude,
        longitude: cityLocation.longitude,
        marketLabel: cityLocation.city,
        source: CANADIAN_DELIVERY_LOCATION_SOURCE,
        precision: "CANADIAN_DELIVERY_CITY" as const,
        stateProvince: cityLocation.provinceCode
      };
    }
    const mapped = NEWL_CANADA_PROVINCE_MARKET_MAP.find((row) => row.provinceCode === province || row.province.toUpperCase() === province);
    const market = mapped ? NEWL_LOGISTICS_MARKET_CATALOGUE.find((row) => row.marketId === mapped.approvedLogisticsMarketId) : null;
    return market ? {
      postalCode: mapped!.provinceCode,
      latitude: market.latitude,
      longitude: market.longitude,
      marketLabel: market.marketName,
      source: "NEWL_CANADA_PROVINCE_MARKET",
      precision: "BROAD_CANADIAN_PROVINCE_MARKET" as const,
      stateProvince: mapped!.provinceCode
    } : null;
  }
  return null;
}

const WAREHOUSE_LOCATION_STRATEGY_COUNTRY_BORDER_REFERENCE = [
  { id: "CA-LONDON-ON", country: "CA", latitude: 42.9849, longitude: -81.2453 },
  { id: "CA-TORONTO-ON", country: "CA", latitude: 43.6532, longitude: -79.3832 },
  { id: "CA-WINDSOR-ON", country: "CA", latitude: 42.3149, longitude: -83.0364 },
  { id: "CA-OTTAWA-ON", country: "CA", latitude: 45.4215, longitude: -75.6972 },
  { id: "CA-MONTREAL-QC", country: "CA", latitude: 45.5019, longitude: -73.5674 },
  { id: "CA-VANCOUVER-BC", country: "CA", latitude: 49.2827, longitude: -123.1207 },
  { id: "US-DETROIT-MI", country: "US", latitude: 42.3314, longitude: -83.0458 },
  { id: "US-BUFFALO-NY", country: "US", latitude: 42.8864, longitude: -78.8784 },
  { id: "US-SEATTLE-WA", country: "US", latitude: 47.6062, longitude: -122.3321 },
  { id: "US-CHICAGO-IL", country: "US", latitude: 41.8781, longitude: -87.6298 },
  { id: "US-NEW-YORK-NY", country: "US", latitude: 40.7128, longitude: -74.006 },
  { id: "US-ATLANTA-GA", country: "US", latitude: 33.749, longitude: -84.388 },
  { id: "US-DALLAS-TX", country: "US", latitude: 32.7767, longitude: -96.797 },
  { id: "US-LOS-ANGELES-CA", country: "US", latitude: 34.0522, longitude: -118.2437 }
] as const;

export function classifyWarehouseLocationStrategyCenterCountry(center: { latitude: number; longitude: number }) {
  const nearest = WAREHOUSE_LOCATION_STRATEGY_COUNTRY_BORDER_REFERENCE
    .map((reference) => ({
      reference,
      distanceMiles: haversineMiles(center.latitude, center.longitude, reference.latitude, reference.longitude)
    }))
    .sort((left, right) => left.distanceMiles - right.distanceMiles || left.reference.country.localeCompare(right.reference.country) || left.reference.id.localeCompare(right.reference.id))[0];
  return nearest ? {
    country: nearest.reference.country as "US" | "CA",
    referenceId: nearest.reference.id,
    distanceMiles: round1(nearest.distanceMiles)
  } : {
    country: null,
    referenceId: null,
    distanceMiles: null
  };
}

function classifyCanadianCenterProvince(center: { latitude: number; longitude: number }) {
  return nearestCanadianDeliveryLocation(center.latitude, center.longitude)?.provinceCode ??
    NEWL_LOGISTICS_MARKET_CATALOGUE
      .filter((market) => market.activeEligible && market.country === "CA")
      .map((market) => ({
        market,
        distanceMiles: haversineMiles(center.latitude, center.longitude, market.latitude, market.longitude)
      }))
      .sort((left, right) => left.distanceMiles - right.distanceMiles || left.market.marketId.localeCompare(right.market.marketId))[0]?.market.stateProvince ??
    null;
}

function farthestUnrepresentedCenter(profiles: DemandProfile[], centers: Array<{ latitude: number; longitude: number }>) {
  const profile = profiles
    .filter((profile) => !centers.some((center) => sameCoordinate(center, profile)))
    .map((profile) => ({ profile, distance: nearestCenterDistance(profile, centers) }))
    .sort((left, right) => right.distance - left.distance || left.profile.sourceReference.localeCompare(right.profile.sourceReference))[0]?.profile;
  return profile ? coordinate(profile) : null;
}

function nearestCenterDistance(profile: DemandProfile, centers: Array<{ latitude: number; longitude: number }>) {
  return Math.min(...centers.map((center) => haversineMiles(profile.latitude, profile.longitude, center.latitude, center.longitude)));
}

function coordinate(profile: DemandProfile) {
  return { latitude: profile.latitude, longitude: profile.longitude };
}

function sameCoordinate(center: { latitude: number; longitude: number }, profile: DemandProfile) {
  return center.latitude === profile.latitude && center.longitude === profile.longitude;
}

function centersEqual(left: Array<{ latitude: number; longitude: number }>, right: Array<{ latitude: number; longitude: number }>) {
  return left.length === right.length && left.every((center, index) => center.latitude === right[index]?.latitude && center.longitude === right[index]?.longitude);
}

function complexityLabel(regionCount: number): LocationStrategySolution["complexity"] {
  if (regionCount === 1) return "Lowest operating complexity";
  if (regionCount === 2) return "Moderate operating complexity";
  return "Highest operating complexity";
}

function improvementRatio(previousAverageDistance: number, currentAverageDistance: number) {
  if (!Number.isFinite(previousAverageDistance) || previousAverageDistance <= 0) return null;
  return (previousAverageDistance - currentAverageDistance) / previousAverageDistance;
}

function improvementPercent(previousAverageDistance: number, currentAverageDistance: number) {
  const ratio = improvementRatio(previousAverageDistance, currentAverageDistance);
  return ratio === null ? null : round1(ratio * 100);
}

function issue(sourceReference: string, rowNumber: number, destinationPostalCode: string, country: string, reason: string): LocationStrategyIssue {
  return { sourceReference, rowNumber, destinationPostalCode, country, reason };
}

function value(row: string[], indexes: Map<string, number>, field: string) {
  const index = indexes.get(field) ?? -1;
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

function parsePositive(raw: string) {
  if (!raw.trim()) return null;
  const parsed = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeCountry(country: string) {
  const value = country.trim().toUpperCase();
  if (value === "USA" || value === "UNITED STATES" || value === "UNITED STATES OF AMERICA") return "US";
  if (value === "CANADA") return "CA";
  return value;
}

function normalizeStateProvince(stateProvince: string) {
  const value = stateProvince.trim().toUpperCase();
  return value || null;
}

function normalizeWeightUnit(unit: string, weight: number | null) {
  if (!weight) return null;
  const value = unit.trim().toLowerCase();
  if (value === "lb" || value === "lbs" || value === "pound" || value === "pounds") return "lb";
  if (value === "kg" || value === "kgs" || value === "kilogram" || value === "kilograms") return "kg";
  return unit.trim() || null;
}

function normalizeCurrency(currency: string, cost: number | null) {
  if (!cost) return { currency: null, reason: null };
  const normalized = currency.trim().toUpperCase();
  if (!normalized) {
    return { currency: null, reason: "Historical transportation spend currency is missing." };
  }
  if (normalized !== "USD" && normalized !== "CAD") {
    return { currency: null, reason: `Historical transportation spend currency \"${normalized}\" is not supported.` };
  }
  return { currency: normalized, reason: null };
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusMiles = 3958.7613;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function degrees(value: number) {
  return (value * 180) / Math.PI;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function nullableSum(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? round2(sum(present)) : null;
}

function uniqueOrNull(values: string[]) {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round6(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatPercentValue(value: number | null) {
  return value === null ? "not available" : `${round1(value)}%`;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
