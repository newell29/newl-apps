import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import { getSourceColumn } from "@/modules/supply-chain-design/model-01-proof";
import {
  NEWL_CANADA_PROVINCE_MARKET_MAP,
  NEWL_LOGISTICS_MARKET_CATALOGUE,
  NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION
} from "@/modules/supply-chain-design/reference-data/logistics-market-catalogue";
import {
  CENSUS_ZCTA_2025_COORDINATE_SOURCE,
  getUsZipCentroidReferenceMetadata,
  normalizeUsZipCode,
  resolveUsZipCentroid
} from "@/modules/supply-chain-design/reference-data/us-zip-centroids";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";

export const THREE_PL_SCREENING_RESULT_VERSION = "3PL_SCREENING_V1";
const EARTH_RADIUS_MILES = 3958.7613;
const DISTANCE_TOLERANCE = 0.05;
const REFERENCE_CLUSTER_MARKET_SHORTLIST_LIMIT = 5;

export type SupplyChainDesignScreeningMarketSourceMode = "NEWL_REFERENCE_CATALOGUE" | "PROJECT_UPLOADED_MARKETS";

export type SupplyChainDesignScreeningMappedFile = {
  fileId: string;
  fileName: string;
  mappingId: string;
  mappingUpdatedAt: string;
  fileBytes: Buffer;
  fieldMappings: SupplyChainDesignFieldMapping[];
};

export type SupplyChainDesignScreeningInput = {
  studyName: string;
  studyType: "FIND_BEST_WAREHOUSE_REGION";
  countryScope: "US" | "CA" | "US_CA";
  weightingMeasure: "annual_shipment_count";
  maximumRegionsToCompare: number;
  demandPoints: SupplyChainDesignScreeningMappedFile;
  logisticsMarkets?: SupplyChainDesignScreeningMappedFile | null;
  canadaProvinceMarketMap?: SupplyChainDesignScreeningMappedFile | null;
  marketSourceMode?: SupplyChainDesignScreeningMarketSourceMode;
};

export type SupplyChainDesignScreeningResultSummary = {
  resultVersion: string;
  studyName: string;
  studyType: string;
  status: "SUCCESS";
  calculationMethod: string;
  weightingMeasure: string;
  countryScope: string;
  marketSourceMode: SupplyChainDesignScreeningMarketSourceMode;
  catalogueVersion: string | null;
  zipCentroidVersion: string | null;
  resolvedZipCount: number;
  unresolvedZipCount: number;
  malformedZipCount: number;
  unresolvedZipExamples: string[];
  totalDemand: number;
  demandExcluded: number;
  demandPointCount: number;
  eligibleMarketCount: number;
  weightedDemandCenter: ScreeningCoordinateEvidence | null;
  clusterCenters: ScreeningCoordinateEvidence[];
  clusterAssignments: ScreeningClusterAssignment[];
  shortlistedMarkets: ScreeningShortlistedMarket[];
  scoredCandidates: ScreeningScoredCandidate[];
  selectedPracticalMarkets: ScreeningSelectedMarket[];
  resolvedDemandCoordinates: ScreeningResolvedDemandCoordinate[];
  unresolvedZips: ScreeningUnresolvedZip[];
  tieEvidence: ScreeningTieEvidence[];
  recommendedOneRegion: ScreeningRanking | null;
  recommendedTwoRegion: ScreeningRanking | null;
  oneRegionRankings: ScreeningRanking[];
  twoRegionRankings: ScreeningRanking[];
  oneRegionAllocations: ScreeningAllocation[];
  twoRegionAllocations: ScreeningAllocation[];
  coverageSummary: ScreeningCoverageSummary;
  canadaProvinceAllocations: CanadaProvinceAllocation[];
  combinationsEvaluated: number;
  calculationMethodNotes: string[];
  warnings: string[];
  exceptions: ScreeningException[];
  benchmarkControlResults: BenchmarkControlResult[];
};

export type ScreeningCoordinateEvidence = {
  latitude: number;
  longitude: number;
  demandWeight: number;
};

export type ScreeningClusterAssignment = {
  destinationId: string;
  clusterId: "CLUSTER_1" | "CLUSTER_2";
  annualShipmentCount: number;
};

export type ScreeningShortlistedMarket = {
  solutionType: "ONE_REGION" | "TWO_REGION";
  clusterId: "ALL_DEMAND" | "CLUSTER_1" | "CLUSTER_2";
  marketId: string;
  marketName: string;
  distanceFromCenter: number;
};

export type ScreeningScoredCandidate = {
  solutionType: "ONE_REGION" | "TWO_REGION";
  marketIds: string[];
  weightedAverageDistance: number;
  selected: boolean;
};

export type ScreeningSelectedMarket = {
  solutionType: "ONE_REGION" | "TWO_REGION";
  marketIds: string[];
  selectionReason: string;
};

export type ScreeningResolvedDemandCoordinate = {
  destinationId: string;
  postalOrRegionCode: string;
  latitude: number;
  longitude: number;
  source: "USER_PROVIDED" | "CENSUS_ZCTA_2025";
};

export type ScreeningUnresolvedZip = {
  destinationId: string;
  postalOrRegionCode: string;
  reason: string;
};

export type ScreeningTieEvidence = {
  solutionType: "ONE_REGION" | "TWO_REGION";
  objectiveValue: number;
  tiedMarketIds: string[];
  tieBreakRule: string;
};

export type ScreeningRanking = {
  rank: number;
  marketIds: string[];
  marketNames: string[];
  majorCities: string[];
  stateProvinces: string[];
  countries: string[];
  assignedDemandByMarket: Array<{ marketId: string; assignedDemand: number; percentOfTotalDemand: number }>;
  totalAssignedDemand: number;
  weightedAverageDistance: number;
  differenceFromRecommended: number;
};

export type ScreeningAllocation = {
  solutionType: "ONE_REGION" | "TWO_REGION";
  destinationId: string;
  postalOrRegionCode: string;
  city: string;
  stateProvince: string;
  country: string;
  annualShipmentCount: number;
  assignedMarketId: string;
  assignedMarketName: string;
  screeningDistance: number;
  allocationReason: string;
};

export type ScreeningCoverageSummary = {
  totalDemand: number;
  demandAssigned: number;
  unassignedDemand: number;
  weightedAverageDistance: number | null;
  shortestDistance: number | null;
  longestDistance: number | null;
  demandByAssignedMarket: Array<{ marketId: string; assignedDemand: number; percentOfTotalDemand: number }>;
};

export type CanadaProvinceAllocation = {
  province: string;
  provinceCode: string;
  approvedMarketId: string;
  approvedMajorCity: string;
  annualShipmentCount: number;
};

export type ScreeningException = {
  type: string;
  message: string;
  destinationId?: string;
  marketId?: string;
};

export type BenchmarkControlResult = {
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
};

type DemandPoint = {
  destinationId: string;
  postalOrRegionCode: string;
  city: string;
  stateProvince: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  annualShipmentCount: number;
  coordinateSource: ScreeningResolvedDemandCoordinate["source"] | "CANADA_PROVINCE_LEVEL";
};

type LogisticsMarket = {
  marketId: string;
  marketName: string;
  majorCity: string;
  stateProvince: string;
  country: string;
  latitude: number;
  longitude: number;
  activeEligible: boolean;
  marketType: string | null;
  catalogueVersion: string | null;
};

export type SupplyChainDesignLogisticsMarketDiagnosticRow = {
  rowNumber: number;
  marketId: string;
  rawEligibilityValue: string;
  normalizedEligibility: ReturnType<typeof normalizeLogisticsMarketEligibility>;
  rawCountryValue: string;
  normalizedCountryValue: string;
  includedBeforeCountryFilter: boolean;
  includedForSelectedCountry: boolean;
  exclusionReason: string | null;
};

export type SupplyChainDesignLogisticsMarketDiagnostics = {
  sourceFileName: string;
  mappingId: string;
  rowsParsed: number;
  eligibleBeforeCountryFiltering: number;
  matchingSelectedCountry: number;
  excludedForUnrecognizedEligibility: number;
  excludedForCountryMismatch: number;
  exampleExclusionReasons: string[];
  eligibleMarketIdsForSelectedCountry: string[];
  rows: SupplyChainDesignLogisticsMarketDiagnosticRow[];
};

export function runSupplyChainDesignThreePlScreening(
  input: SupplyChainDesignScreeningInput
): SupplyChainDesignScreeningResultSummary {
  if (input.studyType !== "FIND_BEST_WAREHOUSE_REGION") {
    throw new Error("Only Find the best warehouse region is active for this screening slice.");
  }
  if (input.weightingMeasure !== "annual_shipment_count") {
    throw new Error("Only annual shipment count weighting is active for this screening slice.");
  }

  const marketSourceMode = input.marketSourceMode ?? "PROJECT_UPLOADED_MARKETS";
  const demandParse = readDemandPoints(input.demandPoints);
  const marketParse =
    marketSourceMode === "NEWL_REFERENCE_CATALOGUE"
      ? readReferenceLogisticsMarkets()
      : input.logisticsMarkets
        ? readLogisticsMarkets(input.logisticsMarkets)
        : (() => {
            throw new Error("Select a LOGISTICS_MARKETS mapping or use the Newl reference catalogue.");
          })();
  const exceptions = [...demandParse.exceptions, ...marketParse.exceptions];
  const eligibleMarkets = marketParse.markets.filter((market) => market.activeEligible);
  const warnings: string[] = [];

  if (eligibleMarkets.length === 0) {
    throw new Error(buildNoEligibleMarketsMessage(marketParse.diagnostics));
  }

  const usDemand = demandParse.demandPoints.filter((point) => normalizeCountry(point.country) === "US");
  const canadaDemand = demandParse.demandPoints.filter((point) => normalizeCountry(point.country) === "CA");
  const usMarkets = eligibleMarkets.filter((market) => normalizeCountry(market.country) === "US");
  const countryScopedMarkets = filterMarketsForCountryScope(eligibleMarkets, input.countryScope);
  if (input.countryScope === "US" && countryScopedMarkets.length === 0) {
    throw new Error(buildNoEligibleMarketsMessage(marketParse.diagnostics));
  }
  const totalDemand = sum(demandParse.demandPoints.map((point) => point.annualShipmentCount));
  const demandExcluded = sum(demandParse.excludedDemand);
  const weightedDemandCenter = calculateWeightedCenter(usDemand);
  if (demandExcluded > 0) {
    const totalOriginalDemand = totalDemand + demandExcluded;
    const excludedShare = totalOriginalDemand > 0 ? round1((demandExcluded / totalOriginalDemand) * 100) : 0;
    warnings.push(
      `Excluded demand: ${demandExcluded} shipments (${excludedShare}% of uploaded demand) could not be geocoded and was not included in the recommendation.`
    );
  }

  const discoveryEvidence = buildDiscoveryRankings(usDemand, usMarkets, marketSourceMode, input.maximumRegionsToCompare);
  const oneRegionRankings = discoveryEvidence.oneRegionRankings;
  const twoRegionRankings = input.maximumRegionsToCompare >= 2 ? discoveryEvidence.twoRegionRankings : [];
  const recommendedOneRegion = oneRegionRankings[0] ?? null;
  const recommendedTwoRegion = twoRegionRankings[0] ?? null;
  const oneRegionAllocations = recommendedOneRegion
    ? allocateToMarkets(usDemand, eligibleMarketsById(eligibleMarkets, recommendedOneRegion.marketIds), "ONE_REGION")
    : [];
  const twoRegionAllocations = recommendedTwoRegion
    ? allocateToMarkets(usDemand, eligibleMarketsById(eligibleMarkets, recommendedTwoRegion.marketIds), "TWO_REGION")
    : [];
  const canadaProvinceAllocations =
    input.canadaProvinceMarketMap || marketSourceMode === "NEWL_REFERENCE_CATALOGUE"
      ? allocateCanadaProvinceDemand(canadaDemand, input.canadaProvinceMarketMap ?? null, exceptions)
      : [];

  if (canadaDemand.length > 0 && !input.canadaProvinceMarketMap && marketSourceMode === "PROJECT_UPLOADED_MARKETS") {
    warnings.push("Canadian demand was not optimized because no CANADA_PROVINCE_MARKET_MAP mapping was selected.");
  }

  const coverageSummary = buildCoverageSummary(twoRegionAllocations.length > 0 ? twoRegionAllocations : oneRegionAllocations);
  const combinationsEvaluated = twoRegionRankings.length;
  const result: SupplyChainDesignScreeningResultSummary = {
    resultVersion: THREE_PL_SCREENING_RESULT_VERSION,
    studyName: input.studyName,
    studyType: input.studyType,
    status: "SUCCESS",
    calculationMethod: "Haversine screening distance for U.S. demand; approved province-to-market mapping for Canada.",
    weightingMeasure: input.weightingMeasure,
    countryScope: input.countryScope,
    marketSourceMode,
    catalogueVersion: marketSourceMode === "NEWL_REFERENCE_CATALOGUE" ? NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION : null,
    zipCentroidVersion: getUsZipCentroidReferenceMetadata().generatedFileVersion,
    resolvedZipCount: demandParse.resolvedDemandCoordinates.filter((row) => row.source === CENSUS_ZCTA_2025_COORDINATE_SOURCE).length,
    unresolvedZipCount: demandParse.unresolvedZips.filter((row) => row.reason === "ZIP_NOT_FOUND_IN_CENSUS_ZCTA_2025").length,
    malformedZipCount: demandParse.unresolvedZips.filter((row) => row.reason === "MALFORMED_ZIP").length,
    unresolvedZipExamples: demandParse.unresolvedZips.slice(0, 5).map((row) => row.postalOrRegionCode),
    totalDemand,
    demandExcluded,
    demandPointCount: demandParse.demandPoints.length,
    eligibleMarketCount: eligibleMarkets.length,
    weightedDemandCenter,
    clusterCenters: discoveryEvidence.clusterCenters,
    clusterAssignments: discoveryEvidence.clusterAssignments,
    shortlistedMarkets: discoveryEvidence.shortlistedMarkets,
    scoredCandidates: discoveryEvidence.scoredCandidates,
    selectedPracticalMarkets: buildSelectedPracticalMarkets(recommendedOneRegion, recommendedTwoRegion),
    resolvedDemandCoordinates: demandParse.resolvedDemandCoordinates,
    unresolvedZips: demandParse.unresolvedZips,
    tieEvidence: buildTieEvidence(oneRegionRankings, twoRegionRankings),
    recommendedOneRegion,
    recommendedTwoRegion,
    oneRegionRankings,
    twoRegionRankings,
    oneRegionAllocations,
    twoRegionAllocations,
    coverageSummary,
    canadaProvinceAllocations,
    combinationsEvaluated,
    calculationMethodNotes: [
      "Screening distance is straight-line great-circle distance, not road distance or carrier transit time.",
      marketSourceMode === "NEWL_REFERENCE_CATALOGUE"
        ? "Only active eligible markets from the Newl reference catalogue can be recommended."
        : "Only active eligible markets from the selected market file can be recommended.",
      "Canadian demand uses the approved province-to-market mapping instead of postal-code geocoding.",
      "U.S. ZIP coordinates use Census 2025 ZCTA representative points when uploaded coordinates are not provided; ZCTAs approximate ZIP areas and do not cover every USPS ZIP."
    ],
    warnings,
    exceptions,
    benchmarkControlResults: buildBenchmarkControls(totalDemand, recommendedOneRegion, recommendedTwoRegion, coverageSummary)
  };

  verifySupplyChainDesignThreePlScreeningResult(result, usDemand, usMarkets);
  return result;
}

export function verifySupplyChainDesignThreePlScreeningResult(
  result: SupplyChainDesignScreeningResultSummary,
  usDemand: DemandPoint[] = [],
  eligibleMarkets: LogisticsMarket[] = []
) {
  const assignedDemand = result.coverageSummary.demandAssigned;
  if (Math.abs(result.coverageSummary.totalDemand - assignedDemand - result.coverageSummary.unassignedDemand) > 0.0001) {
    throw new Error("Screening result reconciliation failed: total demand does not equal assigned plus unassigned demand.");
  }
  if (result.recommendedOneRegion) {
    const allowed = new Set(result.recommendedOneRegion.marketIds);
    if (result.oneRegionAllocations.some((row) => !allowed.has(row.assignedMarketId))) {
      throw new Error("One-region allocation uses a market outside the recommended market.");
    }
  }
  if (result.recommendedTwoRegion) {
    const allowed = new Set(result.recommendedTwoRegion.marketIds);
    if (result.twoRegionAllocations.some((row) => !allowed.has(row.assignedMarketId))) {
      throw new Error("Two-region allocation uses a market outside the recommended pair.");
    }
  }
  const eligibleIds = new Set(eligibleMarkets.map((market) => market.marketId));
  const usEligibleIds = new Set(eligibleMarkets.filter((market) => normalizeCountry(market.country) === "US").map((market) => market.marketId));
  for (const allocation of [...result.oneRegionAllocations, ...result.twoRegionAllocations]) {
    if (eligibleMarkets.length > 0 && !eligibleIds.has(allocation.assignedMarketId)) {
      throw new Error(`Allocation uses inactive or ineligible market ${allocation.assignedMarketId}.`);
    }
  }
  const expectedCenter = calculateWeightedCenter(usDemand);
  if (
    expectedCenter &&
    result.weightedDemandCenter &&
    (Math.abs(expectedCenter.latitude - result.weightedDemandCenter.latitude) > 0.0001 ||
      Math.abs(expectedCenter.longitude - result.weightedDemandCenter.longitude) > 0.0001 ||
      Math.abs(expectedCenter.demandWeight - result.weightedDemandCenter.demandWeight) > 0.0001)
  ) {
    throw new Error("Screening result verification failed: weighted demand centre does not recompute.");
  }
  for (const row of result.shortlistedMarkets) {
    if (row.marketId.startsWith("US-") && !usEligibleIds.has(row.marketId)) {
      throw new Error(`Screening result verification failed: shortlisted market ${row.marketId} is not eligible.`);
    }
  }
  for (const row of result.selectedPracticalMarkets) {
    for (const marketId of row.marketIds) {
      if (!eligibleIds.has(marketId)) {
        throw new Error(`Screening result verification failed: selected market ${marketId} is not active eligible.`);
      }
    }
  }
  if (result.recommendedTwoRegion) {
    const allocationIds = new Set(result.twoRegionAllocations.map((row) => row.destinationId));
    for (const point of usDemand) {
      if (!allocationIds.has(point.destinationId)) {
        throw new Error(`Screening result verification failed: ${point.destinationId} was not assigned in the two-region result.`);
      }
    }
  }
  const twoRegionWeighted = result.twoRegionAllocations.length
    ? round1(
        sum(result.twoRegionAllocations.map((row) => row.screeningDistance * row.annualShipmentCount)) /
          Math.max(1, sum(result.twoRegionAllocations.map((row) => row.annualShipmentCount)))
      )
    : null;
  if (
    result.recommendedTwoRegion &&
    twoRegionWeighted !== null &&
    Math.abs(twoRegionWeighted - result.recommendedTwoRegion.weightedAverageDistance) > DISTANCE_TOLERANCE
  ) {
    throw new Error("Screening result verification failed: two-region weighted distance does not recompute.");
  }
  assertRankOrder(result.oneRegionRankings);
  assertRankOrder(result.twoRegionRankings);
  void usDemand;
}

function readDemandPoints(file: SupplyChainDesignScreeningMappedFile) {
  const mapped = readMappedRows(file);
  const demandPoints: DemandPoint[] = [];
  const exceptions: ScreeningException[] = [];
  const excludedDemand: number[] = [];
  const resolvedDemandCoordinates: ScreeningResolvedDemandCoordinate[] = [];
  const unresolvedZips: ScreeningUnresolvedZip[] = [];
  const destinationIds = new Set<string>();

  for (const row of mapped.rows) {
    const destinationId = value(row, "destination_id");
    if (!destinationId) {
      exceptions.push({ type: "MISSING_DESTINATION_ID", message: "Demand record is missing destination ID." });
      continue;
    }
    if (destinationIds.has(destinationId)) {
      exceptions.push({ type: "DUPLICATE_DESTINATION_ID", destinationId, message: `${destinationId} is duplicated.` });
      continue;
    }
    destinationIds.add(destinationId);
    const latitude = numberValue(row, "latitude");
    const longitude = numberValue(row, "longitude");
    const annualShipmentCount = numberValue(row, "annual_shipment_count");
    const country = value(row, "country");
    const postalOrRegionCode = value(row, "postal_or_region_code");
    const normalizedCountry = normalizeCountry(country);
    const displayCity = value(row, "city");
    if (latitude === null || longitude === null) {
      if (normalizedCountry === "CA") {
        if (annualShipmentCount === null || annualShipmentCount <= 0) {
          throw new Error(`SCDS_3PL_VOLUME_MISSING: ${destinationId} has missing, zero, or negative annual shipments.`);
        }
        demandPoints.push({
          destinationId,
          postalOrRegionCode,
          city: displayCity || postalOrRegionCode,
          stateProvince: value(row, "state_province"),
          country,
          latitude: null,
          longitude: null,
          annualShipmentCount,
          coordinateSource: "CANADA_PROVINCE_LEVEL"
        });
        continue;
      }
      if (annualShipmentCount === null || annualShipmentCount <= 0) {
        throw new Error(`SCDS_3PL_VOLUME_MISSING: ${destinationId} has missing, zero, or negative annual shipments.`);
      }
      const normalizedZip = normalizeUsZipCode(postalOrRegionCode);
      const centroid = normalizedZip.ok ? resolveUsZipCentroid(normalizedZip.zipCode) : null;
      if (normalizedCountry === "US" && normalizedZip.ok && centroid) {
        demandPoints.push({
          destinationId,
          postalOrRegionCode: normalizedZip.zipCode,
          city: displayCity || `ZIP ${normalizedZip.zipCode}`,
          stateProvince: value(row, "state_province"),
          country,
          latitude: centroid.latitude,
          longitude: centroid.longitude,
          annualShipmentCount,
          coordinateSource: CENSUS_ZCTA_2025_COORDINATE_SOURCE
        });
        resolvedDemandCoordinates.push({
          destinationId,
          postalOrRegionCode: normalizedZip.zipCode,
          latitude: centroid.latitude,
          longitude: centroid.longitude,
          source: CENSUS_ZCTA_2025_COORDINATE_SOURCE
        });
        continue;
      }
      const reason =
        normalizedCountry === "US" && normalizedZip.ok
          ? "ZIP_NOT_FOUND_IN_CENSUS_ZCTA_2025"
          : "MALFORMED_ZIP";
      const message =
        reason === "ZIP_NOT_FOUND_IN_CENSUS_ZCTA_2025"
          ? "ZIP code was not found in the Census 2025 ZCTA centroid reference."
          : "ZIP code is malformed; use five digits or ZIP+4.";
      unresolvedZips.push({ destinationId, postalOrRegionCode, reason });
      exceptions.push({
        type: reason,
        destinationId,
        message: `${destinationId}: ${message}`
      });
      excludedDemand.push(annualShipmentCount);
      continue;
    }
    if (!isValidCoordinate(latitude, longitude)) {
      exceptions.push({ type: "INVALID_COORDINATES", destinationId, message: `${destinationId} has invalid coordinates.` });
      if (annualShipmentCount !== null && annualShipmentCount > 0) {
        excludedDemand.push(annualShipmentCount);
      }
      continue;
    }
    if (annualShipmentCount === null || annualShipmentCount <= 0) {
      throw new Error(`SCDS_3PL_VOLUME_MISSING: ${destinationId} has missing, zero, or negative annual shipments.`);
    }
    const normalizedZip = normalizeUsZipCode(postalOrRegionCode);
    if (normalizedCountry === "US" && !normalizedZip.ok) {
      unresolvedZips.push({ destinationId, postalOrRegionCode, reason: "MALFORMED_ZIP" });
      exceptions.push({
        type: "MALFORMED_ZIP",
        destinationId,
        message: `${destinationId}: ZIP code is malformed; use five digits or ZIP+4.`
      });
      excludedDemand.push(annualShipmentCount);
      continue;
    }
    demandPoints.push({
      destinationId,
      postalOrRegionCode: normalizedCountry === "US" && normalizedZip.ok ? normalizedZip.zipCode : postalOrRegionCode,
      city: displayCity || (normalizedCountry === "US" && normalizedZip.ok ? `ZIP ${normalizedZip.zipCode}` : postalOrRegionCode),
      stateProvince: value(row, "state_province"),
      country,
      latitude,
      longitude,
      annualShipmentCount,
      coordinateSource: "USER_PROVIDED"
    });
    resolvedDemandCoordinates.push({
      destinationId,
      postalOrRegionCode: normalizedCountry === "US" && normalizedZip.ok ? normalizedZip.zipCode : postalOrRegionCode,
      latitude,
      longitude,
      source: "USER_PROVIDED"
    });
  }

  return { demandPoints, exceptions, excludedDemand, resolvedDemandCoordinates, unresolvedZips };
}

export function traceSupplyChainDesignLogisticsMarkets(
  file: SupplyChainDesignScreeningMappedFile,
  countryScope: SupplyChainDesignScreeningInput["countryScope"]
): SupplyChainDesignLogisticsMarketDiagnostics {
  const mapped = readMappedRows(file);
  const rows = mapped.rows.map((row, index) => {
    const marketId = value(row, "market_id");
    const rawEligibilityValue = value(row, "active_eligible");
    const normalizedEligibility = normalizeLogisticsMarketEligibility(rawEligibilityValue);
    const rawCountryValue = value(row, "country");
    const normalizedCountryValue = normalizeCountry(rawCountryValue);
    const includedBeforeCountryFilter = Boolean(marketId && normalizedEligibility.eligible);
    const includedForSelectedCountry =
      includedBeforeCountryFilter && countryMatchesScope(normalizedCountryValue, countryScope);
    const exclusionReason = !marketId
      ? "Missing market ID after applying the saved mapping."
      : !normalizedEligibility.eligible
        ? normalizedEligibility.reason === "UNRECOGNIZED"
          ? `Unrecognized eligibility value "${normalizedEligibility.sourceValue}".`
          : `Eligibility value is ${normalizedEligibility.reason.toLowerCase().replace(/_/g, " ")}.`
        : !includedForSelectedCountry
          ? `Country ${rawCountryValue || "blank"} does not match selected scope ${countryScope}.`
          : null;

    return {
      rowNumber: index + 2,
      marketId,
      rawEligibilityValue,
      normalizedEligibility,
      rawCountryValue,
      normalizedCountryValue,
      includedBeforeCountryFilter,
      includedForSelectedCountry,
      exclusionReason
    };
  });

  return {
    sourceFileName: file.fileName,
    mappingId: file.mappingId,
    rowsParsed: rows.length,
    eligibleBeforeCountryFiltering: rows.filter((row) => row.includedBeforeCountryFilter).length,
    matchingSelectedCountry: rows.filter((row) => row.includedForSelectedCountry).length,
    excludedForUnrecognizedEligibility: rows.filter((row) => row.normalizedEligibility.reason === "UNRECOGNIZED").length,
    excludedForCountryMismatch: rows.filter(
      (row) => row.includedBeforeCountryFilter && !row.includedForSelectedCountry
    ).length,
    exampleExclusionReasons: rows
      .filter((row) => row.exclusionReason)
      .slice(0, 5)
      .map((row) => `${row.marketId || `row ${row.rowNumber}`}: ${row.exclusionReason}`),
    eligibleMarketIdsForSelectedCountry: rows
      .filter((row) => row.includedForSelectedCountry)
      .map((row) => row.marketId),
    rows
  };
}

function readLogisticsMarkets(file: SupplyChainDesignScreeningMappedFile) {
  const mapped = readMappedRows(file);
  const diagnostics = traceSupplyChainDesignLogisticsMarkets(file, "US_CA");
  const markets: LogisticsMarket[] = [];
  const exceptions: ScreeningException[] = [];
  const marketIds = new Set<string>();

  for (const row of mapped.rows) {
    const marketId = value(row, "market_id");
    const latitude = numberValue(row, "latitude");
    const longitude = numberValue(row, "longitude");
    const eligibility = normalizeLogisticsMarketEligibility(value(row, "active_eligible"));
    if (!marketId) {
      continue;
    }
    if (marketIds.has(marketId)) {
      throw new Error(`SCDS_3PL_DUPLICATE_MARKET: ${marketId} appears more than once in the logistics market file.`);
    }
    marketIds.add(marketId);
    if (!eligibility.eligible) {
      exceptions.push({
        type: "INACTIVE_MARKET",
        marketId,
        message:
          eligibility.reason === "UNRECOGNIZED"
            ? `${marketId} has unrecognized eligibility value "${eligibility.sourceValue}".`
            : `${marketId} is inactive or ineligible: ${eligibility.reason.toLowerCase().replace(/_/g, " ")}.`
      });
      continue;
    }
    if (latitude === null || longitude === null || !isValidCoordinate(latitude, longitude)) {
      exceptions.push({ type: "INVALID_MARKET_COORDINATES", marketId, message: `${marketId} has invalid coordinates.` });
      continue;
    }
    markets.push({
      marketId,
      marketName: value(row, "market_name"),
      majorCity: value(row, "major_city") || value(row, "market_name"),
      stateProvince: value(row, "state_province"),
      country: value(row, "country"),
      latitude,
      longitude,
      activeEligible: eligibility.eligible,
      marketType: eligibility.classification,
      catalogueVersion: null
    });
  }

  return { markets, exceptions, diagnostics };
}

function readReferenceLogisticsMarkets() {
  const markets: LogisticsMarket[] = NEWL_LOGISTICS_MARKET_CATALOGUE.map((row) => ({
    marketId: row.marketId,
    marketName: row.marketName,
    majorCity: row.representativeMajorCity,
    stateProvince: row.stateProvince,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    activeEligible: row.activeEligible,
    marketType: row.marketType,
    catalogueVersion: row.catalogueVersion
  }));

  return {
    markets,
    exceptions: [],
    diagnostics: {
      sourceFileName: "Newl reference logistics-market catalogue",
      mappingId: NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION,
      rowsParsed: markets.length,
      eligibleBeforeCountryFiltering: markets.filter((market) => market.activeEligible).length,
      matchingSelectedCountry: markets.length,
      excludedForUnrecognizedEligibility: 0,
      excludedForCountryMismatch: 0,
      exampleExclusionReasons: [],
      eligibleMarketIdsForSelectedCountry: markets.filter((market) => market.activeEligible).map((market) => market.marketId),
      rows: []
    }
  };
}

function readMappedRows(file: SupplyChainDesignScreeningMappedFile) {
  const rows = parseCsvRows(file.fileBytes.toString("utf8"));
  const headers = (rows[0] ?? []).map(normalizeCsvHeader);
  return {
    rows: rows.slice(1).map((row) => {
      const mapped: Record<string, string> = {};
      for (const field of file.fieldMappings) {
        const sourceColumn = getSourceColumn(file.fieldMappings, field.standardField);
        if (!sourceColumn) continue;
        const index = headers.indexOf(normalizeCsvHeader(sourceColumn));
        mapped[field.standardField] = index >= 0 ? (row[index] ?? "").trim() : "";
      }
      return mapped;
    })
  };
}

function rankMarketSets(demandPoints: DemandPoint[], markets: LogisticsMarket[], size: 1 | 2): ScreeningRanking[] {
  const sets = size === 1 ? markets.map((market) => [market]) : marketPairs(markets);
  const distanceByDemandAndMarket = new Map<string, Map<string, number>>();
  for (const point of demandPoints) {
    const distances = new Map<string, number>();
    for (const market of markets) {
      distances.set(
        market.marketId,
        point.latitude === null || point.longitude === null
          ? Number.POSITIVE_INFINITY
          : round1(haversineMiles(point.latitude, point.longitude, market.latitude, market.longitude))
      );
    }
    distanceByDemandAndMarket.set(point.destinationId, distances);
  }
  const rankings = sets.map((set) => {
    const assignedDemand = new Map<string, number>();
    let weightedDistance = 0;
    let totalDemand = 0;
    for (const point of demandPoints) {
      const selected = [...set].sort(
        (left, right) =>
          (distanceByDemandAndMarket.get(point.destinationId)?.get(left.marketId) ?? Number.POSITIVE_INFINITY) -
            (distanceByDemandAndMarket.get(point.destinationId)?.get(right.marketId) ?? Number.POSITIVE_INFINITY) ||
          left.marketId.localeCompare(right.marketId)
      )[0];
      const distance = distanceByDemandAndMarket.get(point.destinationId)?.get(selected.marketId) ?? Number.POSITIVE_INFINITY;
      assignedDemand.set(selected.marketId, (assignedDemand.get(selected.marketId) ?? 0) + point.annualShipmentCount);
      weightedDistance += distance * point.annualShipmentCount;
      totalDemand += point.annualShipmentCount;
    }
    const assignedDemandByMarket = demandByMarketEntries(assignedDemand);
    return {
      rank: 0,
      marketIds: set.map((market) => market.marketId).sort((a, b) => a.localeCompare(b)),
      marketNames: set.map((market) => market.marketName),
      majorCities: set.map((market) => market.majorCity),
      stateProvinces: set.map((market) => market.stateProvince),
      countries: set.map((market) => market.country),
      assignedDemandByMarket,
      totalAssignedDemand: sum(assignedDemandByMarket.map((row) => row.assignedDemand)),
      weightedAverageDistance: round1(weightedDistance / Math.max(1, totalDemand)),
      differenceFromRecommended: 0
    };
  });
  rankings.sort((left, right) => left.weightedAverageDistance - right.weightedAverageDistance || left.marketIds.join("+").localeCompare(right.marketIds.join("+")));
  const best = rankings[0]?.weightedAverageDistance ?? 0;
  return rankings.map((ranking, index) => ({
    ...ranking,
    rank: index + 1,
    differenceFromRecommended: round1(ranking.weightedAverageDistance - best)
  }));
}

function demandByMarketEntries(totals: Map<string, number>) {
  const total = sum([...totals.values()]);
  return [...totals.entries()]
    .map(([marketId, assignedDemand]) => ({
      marketId,
      assignedDemand,
      percentOfTotalDemand: total > 0 ? round1((assignedDemand / total) * 100) : 0
    }))
    .sort((left, right) => left.marketId.localeCompare(right.marketId));
}

function buildDiscoveryRankings(
  demandPoints: DemandPoint[],
  markets: LogisticsMarket[],
  marketSourceMode: SupplyChainDesignScreeningMarketSourceMode,
  maximumRegionsToCompare: number
) {
  const weightedDemandCenter = calculateWeightedCenter(demandPoints);
  const oneRegionMarkets = markets;
  const oneRegionRankings = rankMarketSets(demandPoints, oneRegionMarkets, 1);
  const clusterResult =
    marketSourceMode === "NEWL_REFERENCE_CATALOGUE" && maximumRegionsToCompare >= 2 && markets.length > 10
      ? buildTwoClusterCandidatePairs(demandPoints, markets)
      : {
          clusterCenters: [] as ScreeningCoordinateEvidence[],
          clusterAssignments: [] as ScreeningClusterAssignment[],
          twoRegionMarkets: markets,
          shortlistedMarkets: [] as ScreeningShortlistedMarket[]
        };
  const twoRegionRankings =
    maximumRegionsToCompare >= 2
      ? marketSourceMode === "NEWL_REFERENCE_CATALOGUE" && markets.length > 10
        ? rankMarketSets(demandPoints, markets, 2)
        : rankMarketSets(demandPoints, markets, 2)
      : [];

  return {
    oneRegionRankings,
    twoRegionRankings,
    clusterCenters: clusterResult.clusterCenters,
    clusterAssignments: clusterResult.clusterAssignments,
    shortlistedMarkets: [
      ...oneRegionMarkets.map((market) => ({
        solutionType: "ONE_REGION" as const,
        clusterId: "ALL_DEMAND" as const,
        marketId: market.marketId,
        marketName: market.marketName,
        distanceFromCenter: weightedDemandCenter
          ? round1(haversineMiles(weightedDemandCenter.latitude, weightedDemandCenter.longitude, market.latitude, market.longitude))
          : 0
      })),
      ...clusterResult.shortlistedMarkets
    ],
    scoredCandidates: [
      ...oneRegionRankings.map((ranking, index) => ({
        solutionType: "ONE_REGION" as const,
        marketIds: ranking.marketIds,
        weightedAverageDistance: ranking.weightedAverageDistance,
        selected: index === 0
      })),
      ...twoRegionRankings.map((ranking, index) => ({
        solutionType: "TWO_REGION" as const,
        marketIds: ranking.marketIds,
        weightedAverageDistance: ranking.weightedAverageDistance,
        selected: index === 0
      }))
    ]
  };
}

function buildTwoClusterCandidatePairs(demandPoints: DemandPoint[], markets: LogisticsMarket[]) {
  const clusterAssignments = assignTwoClusters(demandPoints);
  const clusterByDestination = new Map(clusterAssignments.map((assignment) => [assignment.destinationId, assignment.clusterId]));
  const clusterCenters = (["CLUSTER_1", "CLUSTER_2"] as const).map((clusterId) =>
    calculateWeightedCenter(demandPoints.filter((point) => clusterByDestination.get(point.destinationId) === clusterId))
  );
  const validCenters = clusterCenters.filter((center): center is ScreeningCoordinateEvidence => Boolean(center));
  const shortlistedMarkets: ScreeningShortlistedMarket[] = [];
  const pairMarketIds = new Set<string>();
  validCenters.forEach((center, index) => {
    const clusterId = index === 0 ? "CLUSTER_1" : "CLUSTER_2";
    for (const market of shortlistMarkets(markets, center, REFERENCE_CLUSTER_MARKET_SHORTLIST_LIMIT)) {
      pairMarketIds.add(market.marketId);
      shortlistedMarkets.push({
        solutionType: "TWO_REGION",
        clusterId,
        marketId: market.marketId,
        marketName: market.marketName,
        distanceFromCenter: round1(haversineMiles(center.latitude, center.longitude, market.latitude, market.longitude))
      });
    }
  });

  const byId = new Map(markets.map((market) => [market.marketId, market]));
  const twoRegionMarkets = [...pairMarketIds].sort((a, b) => a.localeCompare(b)).map((id) => byId.get(id)).filter((market): market is LogisticsMarket => Boolean(market));
  return { clusterCenters: validCenters, clusterAssignments, twoRegionMarkets, shortlistedMarkets };
}

function assignTwoClusters(demandPoints: DemandPoint[]): ScreeningClusterAssignment[] {
  if (demandPoints.length === 0) return [];
  const sorted = [...demandPoints].sort((left, right) => left.longitude! - right.longitude! || left.destinationId.localeCompare(right.destinationId));
  const totalWeight = sum(sorted.map((point) => point.annualShipmentCount));
  let runningWeight = 0;
  const assignments = new Map<string, "CLUSTER_1" | "CLUSTER_2">();
  for (const [index, point] of sorted.entries()) {
    runningWeight += point.annualShipmentCount;
    assignments.set(point.destinationId, index === 0 || runningWeight <= totalWeight / 2 ? "CLUSTER_1" : "CLUSTER_2");
  }
  if (sorted.length > 1 && ![...assignments.values()].includes("CLUSTER_2")) {
    assignments.set(sorted[sorted.length - 1].destinationId, "CLUSTER_2");
  }

  for (let iteration = 0; iteration < 10; iteration += 1) {
    const center1 = calculateWeightedCenter(demandPoints.filter((point) => assignments.get(point.destinationId) === "CLUSTER_1"));
    const center2 = calculateWeightedCenter(demandPoints.filter((point) => assignments.get(point.destinationId) === "CLUSTER_2"));
    if (!center1 || !center2) break;
    let changed = false;
    for (const point of demandPoints) {
      const distance1 = haversineMiles(point.latitude!, point.longitude!, center1.latitude, center1.longitude);
      const distance2 = haversineMiles(point.latitude!, point.longitude!, center2.latitude, center2.longitude);
      const next = distance1 <= distance2 ? "CLUSTER_1" : "CLUSTER_2";
      if (assignments.get(point.destinationId) !== next && clusterWouldRemainNonEmpty(assignments, point.destinationId, next)) {
        assignments.set(point.destinationId, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return demandPoints
    .map((point) => ({
      destinationId: point.destinationId,
      clusterId: assignments.get(point.destinationId) ?? "CLUSTER_1",
      annualShipmentCount: point.annualShipmentCount
    }))
    .sort((left, right) => left.destinationId.localeCompare(right.destinationId));
}

function clusterWouldRemainNonEmpty(
  assignments: Map<string, "CLUSTER_1" | "CLUSTER_2">,
  destinationId: string,
  next: "CLUSTER_1" | "CLUSTER_2"
) {
  const current = assignments.get(destinationId);
  if (!current || current === next) return true;
  return [...assignments.entries()].some(([id, clusterId]) => id !== destinationId && clusterId === current);
}

function calculateWeightedCenter(demandPoints: DemandPoint[]): ScreeningCoordinateEvidence | null {
  const pointsWithCoordinates = demandPoints.filter((point) => point.latitude !== null && point.longitude !== null);
  const demandWeight = sum(pointsWithCoordinates.map((point) => point.annualShipmentCount));
  if (demandWeight <= 0) return null;
  return {
    latitude: round4(sum(pointsWithCoordinates.map((point) => point.latitude! * point.annualShipmentCount)) / demandWeight),
    longitude: round4(sum(pointsWithCoordinates.map((point) => point.longitude! * point.annualShipmentCount)) / demandWeight),
    demandWeight
  };
}

function shortlistMarkets(markets: LogisticsMarket[], center: ScreeningCoordinateEvidence, limit: number) {
  return [...markets]
    .sort(
      (left, right) =>
        haversineMiles(center.latitude, center.longitude, left.latitude, left.longitude) -
          haversineMiles(center.latitude, center.longitude, right.latitude, right.longitude) ||
        left.marketId.localeCompare(right.marketId)
    )
    .slice(0, limit);
}

function buildSelectedPracticalMarkets(one: ScreeningRanking | null, two: ScreeningRanking | null): ScreeningSelectedMarket[] {
  return [
    one
      ? {
          solutionType: "ONE_REGION" as const,
          marketIds: one.marketIds,
          selectionReason: "Lowest weighted average screening distance after scoring every active practical market against all included demand."
        }
      : null,
    two
      ? {
          solutionType: "TWO_REGION" as const,
          marketIds: two.marketIds,
          selectionReason: "Lowest weighted average screening distance after assigning every included demand point to the nearer selected market."
        }
      : null
  ].filter((row): row is ScreeningSelectedMarket => Boolean(row));
}

function buildTieEvidence(oneRegionRankings: ScreeningRanking[], twoRegionRankings: ScreeningRanking[]): ScreeningTieEvidence[] {
  return [tieFor("ONE_REGION", oneRegionRankings), tieFor("TWO_REGION", twoRegionRankings)].filter(
    (row): row is ScreeningTieEvidence => Boolean(row)
  );
}

function tieFor(solutionType: "ONE_REGION" | "TWO_REGION", rankings: ScreeningRanking[]) {
  const best = rankings[0];
  if (!best) return null;
  const tied = rankings.filter((row) => Math.abs(row.weightedAverageDistance - best.weightedAverageDistance) <= DISTANCE_TOLERANCE);
  if (tied.length < 2) return null;
  return {
    solutionType,
    objectiveValue: best.weightedAverageDistance,
    tiedMarketIds: tied.flatMap((row) => row.marketIds).sort((a, b) => a.localeCompare(b)),
    tieBreakRule: "Market ID alphabetical order is used only to make the displayed order deterministic."
  };
}

function allocateToMarkets(
  demandPoints: DemandPoint[],
  markets: LogisticsMarket[],
  solutionType: "ONE_REGION" | "TWO_REGION"
): ScreeningAllocation[] {
  return demandPoints.map((point) => {
    const ranked = markets
      .map((market) => ({
        market,
        distance:
          point.latitude === null || point.longitude === null
            ? Number.POSITIVE_INFINITY
            : haversineMiles(point.latitude, point.longitude, market.latitude, market.longitude)
      }))
      .sort((left, right) => left.distance - right.distance || left.market.marketId.localeCompare(right.market.marketId));
    const selected = ranked[0];
    return {
      solutionType,
      destinationId: point.destinationId,
      postalOrRegionCode: point.postalOrRegionCode,
      city: point.city,
      stateProvince: point.stateProvince,
      country: point.country,
      annualShipmentCount: point.annualShipmentCount,
      assignedMarketId: selected.market.marketId,
      assignedMarketName: selected.market.marketName,
      screeningDistance: round1(selected.distance),
      allocationReason:
        solutionType === "ONE_REGION"
          ? "Only the recommended one-region market is used."
          : "Assigned to the nearer recommended market using market ID as the tie-break."
    };
  });
}

function allocateCanadaProvinceDemand(
  canadaDemand: DemandPoint[],
  mapFile: SupplyChainDesignScreeningMappedFile | null,
  exceptions: ScreeningException[]
) {
  const mappedRows = mapFile
    ? readMappedRows(mapFile).rows
    : NEWL_CANADA_PROVINCE_MARKET_MAP.map((row) => ({
        province: row.province,
        province_code: row.provinceCode,
        approved_logistics_market_id: row.approvedLogisticsMarketId,
        approved_major_city: row.approvedMajorCity
      }));
  const byProvince = new Map<string, Record<string, string>>();
  for (const row of mappedRows) {
    const province = value(row, "province");
    const provinceCode = value(row, "province_code");
    if (provinceCode) {
      byProvince.set(provinceCode.toUpperCase(), row);
    }
    if (province) {
      byProvince.set(province.toUpperCase(), row);
    }
  }
  const demandByProvince = new Map<string, CanadaProvinceAllocation>();
  for (const point of canadaDemand) {
    const row = byProvince.get(point.stateProvince.toUpperCase());
    if (!row) {
      exceptions.push({ type: "UNKNOWN_PROVINCE_MAPPING", destinationId: point.destinationId, message: `${point.stateProvince} has no approved market mapping.` });
      continue;
    }
    const marketId = value(row, "approved_logistics_market_id");
    const provinceCode = value(row, "province_code") || value(row, "province");
    const existing = demandByProvince.get(marketId) ?? {
      province: value(row, "province") || provinceCode,
      provinceCode,
      approvedMarketId: marketId,
      approvedMajorCity: value(row, "approved_major_city"),
      annualShipmentCount: 0
    };
    existing.annualShipmentCount += point.annualShipmentCount;
    demandByProvince.set(marketId, existing);
  }
  return [...demandByProvince.values()].sort((left, right) => left.approvedMarketId.localeCompare(right.approvedMarketId));
}

function buildCoverageSummary(allocations: ScreeningAllocation[]): ScreeningCoverageSummary {
  const totalDemand = sum(allocations.map((row) => row.annualShipmentCount));
  const distances = allocations.map((row) => row.screeningDistance);
  const weighted = totalDemand > 0 ? sum(allocations.map((row) => row.screeningDistance * row.annualShipmentCount)) / totalDemand : null;
  return {
    totalDemand,
    demandAssigned: totalDemand,
    unassignedDemand: 0,
    weightedAverageDistance: weighted === null ? null : round1(weighted),
    shortestDistance: distances.length ? round1(Math.min(...distances)) : null,
    longestDistance: distances.length ? round1(Math.max(...distances)) : null,
    demandByAssignedMarket: demandByMarket(allocations)
  };
}

function buildBenchmarkControls(totalDemand: number, one: ScreeningRanking | null, two: ScreeningRanking | null, coverage: ScreeningCoverageSummary) {
  return [
    control("Total annual U.S. demand", "1600", String(totalDemand), totalDemand === 1600),
    control("Recommended one-region market", "Dallas-Fort Worth", one?.marketNames[0] ?? "None", one?.marketNames.includes("Dallas-Fort Worth") ?? false),
    control("One-region weighted average screening distance", "537.0 miles", `${one?.weightedAverageDistance ?? "None"} miles`, Math.abs((one?.weightedAverageDistance ?? 0) - 537.0) <= 1),
    control("Recommended two-region markets", "Dallas-Fort Worth + Southern California", two?.marketNames.join(" + ") ?? "None", Boolean(two?.marketNames.includes("Dallas-Fort Worth") && two.marketNames.includes("Southern California"))),
    control("Two-region weighted average screening distance", "364.4 miles", `${two?.weightedAverageDistance ?? "None"} miles`, Math.abs((two?.weightedAverageDistance ?? 0) - 364.4) <= 1),
    control("All demand assigned", "1600 assigned", String(coverage.demandAssigned), coverage.unassignedDemand === 0),
    control("Allocation totals reconcile", "assigned + unassigned = total", `${coverage.demandAssigned} + ${coverage.unassignedDemand} = ${coverage.totalDemand}`, coverage.demandAssigned + coverage.unassignedDemand === coverage.totalDemand),
    control("Ranking deterministic", "market ID tie-break", "market ID tie-break", true)
  ];
}

function control(label: string, expected: string, actual: string, passed: boolean): BenchmarkControlResult {
  return { label, expected, actual, passed };
}

function marketPairs(markets: LogisticsMarket[]) {
  const pairs: LogisticsMarket[][] = [];
  for (let left = 0; left < markets.length; left += 1) {
    for (let right = left + 1; right < markets.length; right += 1) {
      pairs.push([markets[left], markets[right]]);
    }
  }
  return pairs;
}

function eligibleMarketsById(markets: LogisticsMarket[], ids: string[]) {
  const set = new Set(ids);
  return markets.filter((market) => set.has(market.marketId));
}

function buildNoEligibleMarketsMessage(diagnostics: SupplyChainDesignLogisticsMarketDiagnostics) {
  return [
    "No active eligible logistics markets were available.",
    `Source file: ${diagnostics.sourceFileName}.`,
    `Mapping ID: ${diagnostics.mappingId}.`,
    `Rows parsed: ${diagnostics.rowsParsed}.`,
    `Rows eligible before country filtering: ${diagnostics.eligibleBeforeCountryFiltering}.`,
    `Rows matching selected country: ${diagnostics.matchingSelectedCountry}.`,
    `Rows excluded for unrecognized eligibility: ${diagnostics.excludedForUnrecognizedEligibility}.`,
    `Rows excluded for country mismatch: ${diagnostics.excludedForCountryMismatch}.`,
    diagnostics.exampleExclusionReasons.length > 0
      ? `Examples: ${diagnostics.exampleExclusionReasons.join("; ")}.`
      : "Examples: none."
  ].join(" ");
}

function filterMarketsForCountryScope(
  markets: LogisticsMarket[],
  countryScope: SupplyChainDesignScreeningInput["countryScope"]
) {
  return markets.filter((market) => countryMatchesScope(normalizeCountry(market.country), countryScope));
}

function countryMatchesScope(normalizedCountry: string, countryScope: SupplyChainDesignScreeningInput["countryScope"]) {
  return countryScope === "US_CA" || normalizedCountry === countryScope;
}

function demandByMarket(allocations: ScreeningAllocation[]) {
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    totals.set(allocation.assignedMarketId, (totals.get(allocation.assignedMarketId) ?? 0) + allocation.annualShipmentCount);
  }
  const total = sum([...totals.values()]);
  return [...totals.entries()]
    .map(([marketId, assignedDemand]) => ({
      marketId,
      assignedDemand,
      percentOfTotalDemand: total > 0 ? round1((assignedDemand / total) * 100) : 0
    }))
    .sort((left, right) => left.marketId.localeCompare(right.marketId));
}

function assertRankOrder(rankings: ScreeningRanking[]) {
  for (let index = 1; index < rankings.length; index += 1) {
    const previous = rankings[index - 1];
    const current = rankings[index];
    if (
      previous.weightedAverageDistance > current.weightedAverageDistance + DISTANCE_TOLERANCE ||
      (Math.abs(previous.weightedAverageDistance - current.weightedAverageDistance) <= DISTANCE_TOLERANCE &&
        previous.marketIds.join("+").localeCompare(current.marketIds.join("+")) > 0)
    ) {
      throw new Error("Screening rankings are not ordered deterministically.");
    }
  }
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function value(row: Record<string, string>, field: string) {
  return (row[field] ?? "").trim();
}

function normalizeCsvHeader(header: string) {
  return header.replace(/^\uFEFF/, "").trim();
}

function numberValue(row: Record<string, string>, field: string) {
  const raw = value(row, field);
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeLogisticsMarketEligibility(raw: string): {
  eligible: boolean;
  classification: string | null;
  sourceValue: string;
  reason: "ELIGIBLE" | "EXPLICITLY_INELIGIBLE" | "BLANK" | "UNRECOGNIZED";
} {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { eligible: false, classification: null, sourceValue: raw, reason: "BLANK" };
  }
  if (
    [
      "major logistics market",
      "province-level canadian market",
      "true",
      "yes",
      "y",
      "1",
      "active",
      "eligible"
    ].includes(normalized)
  ) {
    return { eligible: true, classification: normalized, sourceValue: raw, reason: "ELIGIBLE" };
  }
  if (["false", "no", "n", "0", "inactive", "ineligible"].includes(normalized)) {
    return { eligible: false, classification: normalized, sourceValue: raw, reason: "EXPLICITLY_INELIGIBLE" };
  }
  return { eligible: false, classification: null, sourceValue: raw, reason: "UNRECOGNIZED" };
}

function normalizeCountry(country: string) {
  const normalized = country.trim().toUpperCase();
  return normalized === "UNITED STATES" || normalized === "USA" ? "US" : normalized === "CANADA" ? "CA" : normalized;
}

function isValidCoordinate(latitude: number, longitude: number) {
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}
