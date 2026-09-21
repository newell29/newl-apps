import { preflightSevenLQuoteRequest } from "@/modules/ltl-rate-portal/request-preflight";
import type { LtlQuoteRequest, LtlQuoteResult } from "@/modules/ltl-rate-portal/types";
import type { SupplyChainDesignLtlPreparedRequest } from "@/modules/supply-chain-design/candidate-ltl-rate-preparation";
import {
  buildSupplyChainDesignExactLaneRateFingerprint,
  findReusableSupplyChainDesignExactLaneRate
} from "@/modules/supply-chain-design/ltl-rate-batches";
import { normalizeSupplyChainDesignLtlPhysicalProfile } from "@/modules/supply-chain-design/ltl-physical-normalization";
import type { SupplyChainDesignRatingOrigin } from "@/modules/supply-chain-design/rating-origins";

export type SupplyChainDesignNetworkScenarioInput = {
  tenantId: string;
  projectId: string;
  scenarioId: string;
  scenarioName: string;
  selectedOrigins: SupplyChainDesignNetworkScenarioOrigin[];
  shipments: {
    fileId: string;
    fileName: string;
    mappingId: string;
    mappingUpdatedAt: string;
  };
  preparedProfiles: SupplyChainDesignLtlPreparedRequest[];
  ratingConfig: {
    accountId: string;
    accountName: string;
    carrierHashes: string[];
  };
  bypassExactReuse?: boolean;
  completedRateBatchIds?: string[];
};

export type SupplyChainDesignNetworkScenarioOrigin =
  | SupplyChainDesignRatingOrigin
  | {
      sourceType: "CURRENT" | "CANDIDATE";
      facilityId: string;
      facilityName: string;
      postalCode: string | null;
      city: string | null;
      stateProvince: string | null;
      country: "US" | "CA" | "MX" | null;
      sourceFileId?: string;
      sourceFileName?: string;
      sourceMappingId?: string;
      sourceTableType?: string;
      sourceRowNumber?: number;
    };

export type SupplyChainDesignScenarioAlternativeStatus =
  | "REUSED"
  | "LIVE_RATE"
  | "MISSING_RATE"
  | "INVALID_ORIGIN"
  | "INELIGIBLE_PROFILE";

export type SupplyChainDesignNetworkScenarioEvaluationResult = {
  scenarioId: string;
  scenarioName: string;
  selectedWarehouseCount: number;
  eligiblePreparedProfileCount: number;
  maximumOriginProfileCombinations: number;
  reusableExactLaneCount: number;
  missingRateCount: number;
  invalidOriginCount: number;
  ineligibleProfileCount: number;
  distinctSelectedOrigins: Array<{
    sourceType: "CURRENT" | "CANDIDATE";
    facilityId: string;
    facilityName: string;
  }>;
  representedShipmentVolumeCovered: number;
  originSummaries: SupplyChainDesignNetworkScenarioOriginSummary[];
  profileAlternatives: SupplyChainDesignNetworkScenarioProfileAlternatives[];
  missingRateManifest: SupplyChainDesignNetworkScenarioMissingRateRequest[];
};

export type SupplyChainDesignNetworkScenarioOriginSummary = {
  sourceType: "CURRENT" | "CANDIDATE";
  facilityId: string;
  facilityName: string;
  validProfileCombinations: number;
  reusedLaneCount: number;
  missingRateCount: number;
  invalidCombinations: number;
  representedShipmentsEvaluated: number;
};

export type SupplyChainDesignNetworkScenarioProfileAlternatives = {
  profileKey: string;
  sourceReference: string;
  representedShipments: number;
  representativeWeight: number | null;
  destination: string;
  historicalTransportationCost: number | null;
  alternatives: SupplyChainDesignNetworkScenarioAlternative[];
};

export type SupplyChainDesignNetworkScenarioAlternative = {
  profileKey: string;
  sourceReference: string;
  representedShipments: number;
  destination: string;
  originFacilityId: string;
  originFacilityName: string;
  originSourceType: "CURRENT" | "CANDIDATE";
  status: SupplyChainDesignScenarioAlternativeStatus;
  laneFingerprint: string | null;
  request: LtlQuoteRequest | null;
  reusedSelectedRate: number | null;
  selectedQuote: LtlQuoteResult | null;
  selectedRateSource: "EXACT_REUSE" | "LIVE_RATE" | null;
  representedModeledTransportationCost: number | null;
  reuseLineage: {
    sourceLaneId: string;
    sourceBatchId: string;
  } | null;
  historicalTransportationCost: number | null;
  issue: string | null;
};

export type SupplyChainDesignNetworkScenarioMissingRateRequest = {
  laneFingerprint: string;
  request: LtlQuoteRequest;
  affectedAlternatives: Array<{
    profileKey: string;
    sourceReference: string;
    originFacilityId: string;
    originSourceType: "CURRENT" | "CANDIDATE";
    representedShipments: number;
  }>;
};

export async function evaluateSupplyChainDesignNetworkScenario(
  input: SupplyChainDesignNetworkScenarioInput
): Promise<SupplyChainDesignNetworkScenarioEvaluationResult> {
  const alternatives: SupplyChainDesignNetworkScenarioAlternative[] = [];
  const missingByFingerprint = new Map<string, SupplyChainDesignNetworkScenarioMissingRateRequest>();
  const eligibleProfiles = input.preparedProfiles.filter(isEligiblePreparedProfile);
  const ineligibleProfiles = input.preparedProfiles.filter((profile) => !isEligiblePreparedProfile(profile));

  for (const profile of input.preparedProfiles) {
    const profileKey = profile.rateRequestKey;
    const sourceReference = profile.shipmentOrderReferences.join(", ") || profile.historicalShipmentRowIds.join(", ") || profile.rateRequestKey;
    if (!isEligiblePreparedProfile(profile)) {
      for (const origin of input.selectedOrigins) {
        alternatives.push({
          profileKey,
          sourceReference,
          representedShipments: profile.representedShipments,
          destination: profile.destinationPostalCode,
          originFacilityId: origin.facilityId,
          originFacilityName: origin.facilityName,
          originSourceType: origin.sourceType,
          status: "INELIGIBLE_PROFILE",
          laneFingerprint: null,
          request: null,
          reusedSelectedRate: null,
          selectedQuote: null,
          selectedRateSource: null,
          representedModeledTransportationCost: null,
          reuseLineage: null,
          historicalTransportationCost: profile.currentTransportationCost,
          issue: profile.missingDataReason ?? "Prepared profile is not eligible for modeled 7L rating."
        });
      }
      continue;
    }

    for (const origin of input.selectedOrigins) {
      const originIssue = validateOrigin(origin);
      if (originIssue) {
        alternatives.push({
          profileKey,
          sourceReference,
          representedShipments: profile.representedShipments,
          destination: profile.destinationPostalCode,
          originFacilityId: origin.facilityId,
          originFacilityName: origin.facilityName,
          originSourceType: origin.sourceType,
          status: "INVALID_ORIGIN",
          laneFingerprint: null,
          request: null,
          reusedSelectedRate: null,
          selectedQuote: null,
          selectedRateSource: null,
          representedModeledTransportationCost: null,
          reuseLineage: null,
          historicalTransportationCost: profile.currentTransportationCost,
          issue: originIssue
        });
        continue;
      }

      const request = buildScenarioRequest(origin, profile);
      const preflight = preflightSevenLQuoteRequest(request);
      if (!preflight.ok) {
        alternatives.push({
          profileKey,
          sourceReference,
          representedShipments: profile.representedShipments,
          destination: profile.destinationPostalCode,
          originFacilityId: origin.facilityId,
          originFacilityName: origin.facilityName,
          originSourceType: origin.sourceType,
          status: "INELIGIBLE_PROFILE",
          laneFingerprint: null,
          request: preflight.request,
          reusedSelectedRate: null,
          selectedQuote: null,
          selectedRateSource: null,
          representedModeledTransportationCost: null,
          reuseLineage: null,
          historicalTransportationCost: profile.currentTransportationCost,
          issue: preflight.message
        });
        continue;
      }

      const laneFingerprint = buildSupplyChainDesignExactLaneRateFingerprint({
        accountId: input.ratingConfig.accountId,
        carrierHashes: input.ratingConfig.carrierHashes,
        request: preflight.request
      });
      const completedLiveRate = input.completedRateBatchIds?.length
        ? await findReusableSupplyChainDesignExactLaneRate({
            tenantId: input.tenantId,
            projectId: input.projectId,
            allowedJobRunIds: input.completedRateBatchIds,
            accountId: input.ratingConfig.accountId,
            carrierHashes: input.ratingConfig.carrierHashes,
            request: preflight.request
          })
        : null;
      const reusable = completedLiveRate ?? (input.bypassExactReuse
        ? null
        : await findReusableSupplyChainDesignExactLaneRate({
            tenantId: input.tenantId,
            projectId: input.projectId,
            accountId: input.ratingConfig.accountId,
            carrierHashes: input.ratingConfig.carrierHashes,
            request: preflight.request
          }));
      if (reusable) {
        const selectedRateSource = completedLiveRate ? "LIVE_RATE" : "EXACT_REUSE";
        alternatives.push({
          profileKey,
          sourceReference,
          representedShipments: profile.representedShipments,
          destination: profile.destinationPostalCode,
          originFacilityId: origin.facilityId,
          originFacilityName: origin.facilityName,
          originSourceType: origin.sourceType,
          status: completedLiveRate ? "LIVE_RATE" : "REUSED",
          laneFingerprint,
          request: preflight.request,
          reusedSelectedRate: reusable.selectedQuote.total,
          selectedQuote: reusable.selectedQuote,
          selectedRateSource,
          representedModeledTransportationCost: roundCurrency(reusable.selectedQuote.total * profile.representedShipments),
          reuseLineage: {
            sourceLaneId: reusable.sourceLaneId,
            sourceBatchId: reusable.sourceBatchId
          },
          historicalTransportationCost: profile.currentTransportationCost,
          issue: null
        });
        continue;
      }

      const missing = {
        profileKey,
        sourceReference,
        representedShipments: profile.representedShipments,
        destination: profile.destinationPostalCode,
        originFacilityId: origin.facilityId,
        originFacilityName: origin.facilityName,
        originSourceType: origin.sourceType,
        status: "MISSING_RATE" as const,
        laneFingerprint,
        request: preflight.request,
        reusedSelectedRate: null,
        selectedQuote: null,
        selectedRateSource: null,
        representedModeledTransportationCost: null,
        reuseLineage: null,
        historicalTransportationCost: profile.currentTransportationCost,
        issue: null
      };
      alternatives.push(missing);
      const manifest = missingByFingerprint.get(laneFingerprint);
      const affected = {
        profileKey,
        sourceReference,
        originFacilityId: origin.facilityId,
        originSourceType: origin.sourceType,
        representedShipments: profile.representedShipments
      };
      if (manifest) {
        manifest.affectedAlternatives.push(affected);
      } else {
        missingByFingerprint.set(laneFingerprint, {
          laneFingerprint,
          request: preflight.request,
          affectedAlternatives: [affected]
        });
      }
    }
  }

  const profileAlternatives = input.preparedProfiles.map((profile) => {
    const profileKey = profile.rateRequestKey;
    const sourceReference = profile.shipmentOrderReferences.join(", ") || profile.historicalShipmentRowIds.join(", ") || profile.rateRequestKey;
    return {
      profileKey,
      sourceReference,
      representedShipments: profile.representedShipments,
      representativeWeight: profile.representativeWeight,
      destination: profile.destinationPostalCode,
      historicalTransportationCost: profile.currentTransportationCost,
      alternatives: alternatives.filter((alternative) => alternative.profileKey === profileKey)
    };
  });

  const originSummaries = input.selectedOrigins.map((origin) => {
    const originAlternatives = alternatives.filter((alternative) =>
      alternative.originFacilityId === origin.facilityId && alternative.originSourceType === origin.sourceType
    );
    return {
      sourceType: origin.sourceType,
      facilityId: origin.facilityId,
      facilityName: origin.facilityName,
      validProfileCombinations: originAlternatives.filter((alternative) => isRatedOrMissingStatus(alternative.status)).length,
      reusedLaneCount: originAlternatives.filter((alternative) => alternative.status === "REUSED").length,
      missingRateCount: originAlternatives.filter((alternative) => alternative.status === "MISSING_RATE").length,
      invalidCombinations: originAlternatives.filter((alternative) => alternative.status === "INVALID_ORIGIN" || alternative.status === "INELIGIBLE_PROFILE").length,
      representedShipmentsEvaluated: roundQuantity(originAlternatives
        .filter((alternative) => isRatedOrMissingStatus(alternative.status))
        .reduce((sum, alternative) => sum + alternative.representedShipments, 0))
    };
  });

  return {
    scenarioId: input.scenarioId,
    scenarioName: input.scenarioName,
    selectedWarehouseCount: input.selectedOrigins.length,
    eligiblePreparedProfileCount: eligibleProfiles.length,
    maximumOriginProfileCombinations: input.selectedOrigins.length * eligibleProfiles.length,
    reusableExactLaneCount: alternatives.filter((alternative) => alternative.status === "REUSED").length,
    missingRateCount: alternatives.filter((alternative) => alternative.status === "MISSING_RATE").length,
    invalidOriginCount: alternatives.filter((alternative) => alternative.status === "INVALID_ORIGIN").length,
    ineligibleProfileCount: ineligibleProfiles.length * input.selectedOrigins.length,
    distinctSelectedOrigins: input.selectedOrigins.map((origin) => ({
      sourceType: origin.sourceType,
      facilityId: origin.facilityId,
      facilityName: origin.facilityName
    })),
    representedShipmentVolumeCovered: roundQuantity(alternatives
      .filter((alternative) => isCompletedRateStatus(alternative.status))
      .reduce((sum, alternative) => sum + alternative.representedShipments, 0)),
    originSummaries,
    profileAlternatives,
    missingRateManifest: [...missingByFingerprint.values()].sort((left, right) => left.laneFingerprint.localeCompare(right.laneFingerprint))
  };
}

function isRatedOrMissingStatus(status: SupplyChainDesignScenarioAlternativeStatus) {
  return status === "REUSED" || status === "LIVE_RATE" || status === "MISSING_RATE";
}

function isCompletedRateStatus(status: SupplyChainDesignScenarioAlternativeStatus) {
  return status === "REUSED" || status === "LIVE_RATE";
}

function isEligiblePreparedProfile(profile: SupplyChainDesignLtlPreparedRequest) {
  return profile.preparationStatus === "Ready for rating" && Boolean(profile.normalizedRequest);
}

function validateOrigin(origin: SupplyChainDesignNetworkScenarioOrigin) {
  if (!origin.postalCode?.trim()) return "Origin ZIP / Postal Code is required for modeled 7L rating.";
  if (!origin.country) return "Origin country is required for modeled 7L rating.";
  return null;
}

function buildScenarioRequest(origin: SupplyChainDesignNetworkScenarioOrigin, profile: SupplyChainDesignLtlPreparedRequest): LtlQuoteRequest {
  const base = profile.normalizedRequest!;
  const physicalProfile =
    profile.representativePallets !== null &&
    profile.representativeWeight !== null &&
    profile.weightUnit &&
    profile.length !== null &&
    profile.width !== null &&
    profile.height !== null &&
    profile.dimensionUnit
      ? normalizeSupplyChainDesignLtlPhysicalProfile({
          pallets: profile.representativePallets,
          weight: profile.representativeWeight,
          weightUnit: profile.weightUnit,
          length: profile.length,
          width: profile.width,
          height: profile.height,
          dimensionUnit: profile.dimensionUnit
        })
      : null;
  return {
    ...base,
    customerReference: `${origin.sourceType}:${origin.facilityId}:${profile.rateRequestKey}`,
    originCity: "",
    originState: "",
    originZipcode: origin.postalCode!,
    originCountry: origin.country!,
    uom: physicalProfile ? "US" : base.uom,
    pieces: physicalProfile ? [physicalProfile.piece] : base.pieces
  };
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000000) / 1000000;
}
