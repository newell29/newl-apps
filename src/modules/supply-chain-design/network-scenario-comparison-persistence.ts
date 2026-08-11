import { createHash } from "node:crypto";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const NETWORK_SCENARIO_COMPARISON_CALCULATION_VERSION = "NETWORK_SCENARIO_COMPARISON_V1";
export const NETWORK_SCENARIO_COMPARISON_TRANSPORTATION_VERSION = "NETWORK_SCENARIO_TRANSPORTATION_V1";
export const NETWORK_SCENARIO_COMPARISON_WAREHOUSE_COST_VERSION = "NETWORK_SCENARIO_WAREHOUSE_COST_V1";
export const NETWORK_SCENARIO_COMPARISON_COMBINED_COST_VERSION = "NETWORK_SCENARIO_COMBINED_COST_V1";

export type SupplyChainDesignNetworkScenarioComparisonStatus =
  | "EVALUATING"
  | "RATES_REQUIRED"
  | "RATING"
  | "READY_FOR_COST_EVALUATION"
  | "COMPLETE"
  | "INCOMPLETE"
  | "FAILED";

export type NetworkScenarioComparisonFileReference = {
  fileId: string;
  fileName: string;
  contentHash: string;
  mappingId: string;
  mappingUpdatedAt?: string | null;
};

export type NetworkScenarioComparisonInputReferences = {
  tenantId: string;
  projectId: string;
  historicalShipments: NetworkScenarioComparisonFileReference;
  currentFacilities: NetworkScenarioComparisonFileReference;
  candidateFacilities: NetworkScenarioComparisonFileReference;
};

export type NetworkScenarioComparisonSelectedFacility = {
  facilityId: string;
  sourceType: "CURRENT" | "CANDIDATE";
  facilityName: string;
  postalCode: string | null;
  city: string | null;
  stateProvince: string | null;
  country: string | null;
  sourceFileId: string;
  sourceMappingId: string;
  sourceContentHash: string;
  warehouseCostEvidence: Record<string, unknown>;
};

export type NetworkScenarioComparisonScenarioInput = {
  scenarioKey: "A" | "B";
  scenarioName: string;
  selectedFacilities: NetworkScenarioComparisonSelectedFacility[];
};

export type NetworkScenarioComparisonScenarioInputs = {
  historicalShipments: NetworkScenarioComparisonFileReference;
  scenarios: [NetworkScenarioComparisonScenarioInput, NetworkScenarioComparisonScenarioInput];
};

export type NetworkScenarioComparisonRatingEvidence = {
  phase: string;
  ratingBatchIds: string[];
  missingRateCount: number;
  reusedLaneCount: number;
  exactLaneFingerprints: string[];
  laneReferences: Array<{
    exactLaneFingerprint: string;
    batchId: string | null;
    laneId: string | null;
    status: string;
  }>;
  reconciliation: Record<string, unknown>;
};

export type NetworkScenarioComparisonFxInput = {
  cadToUsdRate: number;
};

export type NetworkScenarioComparisonResultSummary = {
  completenessStatus: string;
  scenarioA: Record<string, unknown>;
  scenarioB: Record<string, unknown>;
  comparison: Record<string, unknown>;
  warnings: string[];
  rateCoverage: Record<string, unknown>;
  warehouseCostEvidence: Record<string, unknown>;
  historicalBaselineReference?: Record<string, unknown>;
};

export type CreateNetworkScenarioComparisonRunInput = {
  projectId: string;
  status: SupplyChainDesignNetworkScenarioComparisonStatus;
  scenarioAName: string;
  scenarioBName: string;
  inputReferences: NetworkScenarioComparisonInputReferences;
  scenarioInputs: NetworkScenarioComparisonScenarioInputs;
  ratingEvidence: NetworkScenarioComparisonRatingEvidence;
  fxInput?: NetworkScenarioComparisonFxInput | null;
  resultSummary?: NetworkScenarioComparisonResultSummary | null;
  errorMessage?: string | null;
  transportationFingerprint?: string;
  comparisonFingerprint?: string;
};

export type UpdateNetworkScenarioComparisonRunLifecycleInput = {
  status: SupplyChainDesignNetworkScenarioComparisonStatus;
  ratingEvidence?: NetworkScenarioComparisonRatingEvidence;
  fxInput?: NetworkScenarioComparisonFxInput | null;
  resultSummary?: NetworkScenarioComparisonResultSummary | null;
  errorMessage?: string | null;
};

export type NetworkScenarioComparisonRunDetail = {
  id: string;
  tenantId: string;
  projectId: string;
  status: SupplyChainDesignNetworkScenarioComparisonStatus;
  calculationVersion: string;
  comparisonFingerprint: string;
  transportationFingerprint: string;
  scenarioAName: string;
  scenarioBName: string;
  inputReferences: NetworkScenarioComparisonInputReferences;
  scenarioInputs: NetworkScenarioComparisonScenarioInputs;
  ratingEvidence: NetworkScenarioComparisonRatingEvidence;
  fxInput: NetworkScenarioComparisonFxInput | null;
  resultSummary: NetworkScenarioComparisonResultSummary | null;
  errorMessage: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NetworkScenarioComparisonRunListItem = {
  id: string;
  status: SupplyChainDesignNetworkScenarioComparisonStatus;
  createdAt: Date;
  updatedAt: Date;
  scenarioAName: string;
  scenarioBName: string;
  calculationVersion: string;
  comparisonFingerprint: string;
  transportationFingerprint: string;
  inputReferences: NetworkScenarioComparisonInputReferences | null;
  scenarioInputs: NetworkScenarioComparisonScenarioInputs | null;
  ratingEvidence: NetworkScenarioComparisonRatingEvidence | null;
  fxInput: NetworkScenarioComparisonFxInput | null;
  resultSummary: NetworkScenarioComparisonResultSummary | null;
  errorMessage: string | null;
  resultReadError: string | null;
  headline: {
    completenessStatus: string | null;
    totalDifference: unknown;
  };
};

export async function createNetworkScenarioComparisonRun(
  context: AuthenticatedContext,
  input: CreateNetworkScenarioComparisonRunInput
): Promise<NetworkScenarioComparisonRunDetail> {
  await assertProjectOwned(context, input.projectId);
  const inputReferences = validateInputReferences(input.inputReferences, context.tenantId, input.projectId);
  const scenarioInputs = validateScenarioInputs(input.scenarioInputs);
  const ratingEvidence = validateRatingEvidence(input.ratingEvidence);
  const fxInput = input.fxInput === undefined ? null : validateFxInput(input.fxInput);
  const resultSummary = input.resultSummary === undefined ? null : validateResultSummary(input.resultSummary);
  const transportationFingerprint = input.transportationFingerprint ?? buildNetworkScenarioTransportationFingerprint({
    inputReferences,
    scenarioInputs,
    ratingAccountId: (ratingEvidence.reconciliation.ratingAccountId as string | undefined) ?? "",
    carrierHashes: Array.isArray(ratingEvidence.reconciliation.carrierHashes) ? ratingEvidence.reconciliation.carrierHashes as string[] : []
  });
  const comparisonFingerprint = input.comparisonFingerprint ?? buildNetworkScenarioComparisonFingerprint({
    transportationFingerprint,
    scenarioInputs,
    fxInput,
    resultInputs: {
      warehouseCostEvidence: scenarioInputs.scenarios.flatMap((scenario) =>
        scenario.selectedFacilities.map((facility) => ({
          facilityId: facility.facilityId,
          sourceType: facility.sourceType,
          sourceContentHash: facility.sourceContentHash,
          warehouseCostEvidence: facility.warehouseCostEvidence
        }))
      ),
      historicalShipmentsContentHash: inputReferences.historicalShipments.contentHash
    }
  });

  const created = await prisma.supplyChainDesignNetworkScenarioComparisonRun.create({
    data: {
      tenantId: context.tenantId,
      projectId: input.projectId,
      status: input.status,
      calculationVersion: NETWORK_SCENARIO_COMPARISON_CALCULATION_VERSION,
      comparisonFingerprint,
      transportationFingerprint,
      scenarioAName: input.scenarioAName.trim() || "Scenario A",
      scenarioBName: input.scenarioBName.trim() || "Scenario B",
      inputReferences: inputReferences as unknown as object,
      scenarioInputs: scenarioInputs as unknown as object,
      ratingEvidence: ratingEvidence as unknown as object,
      fxInput: fxInput as unknown as object | null,
      resultSummary: resultSummary as unknown as object | null,
      errorMessage: input.errorMessage ?? null,
      createdByUserId: context.userId
    }
  });

  return parseRun(created);
}

export async function getNetworkScenarioComparisonRun(
  context: AuthenticatedContext,
  projectId: string,
  runId: string
): Promise<NetworkScenarioComparisonRunDetail | null> {
  const run = await prisma.supplyChainDesignNetworkScenarioComparisonRun.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: runId
      }
    }
  });
  if (!run || run.projectId !== projectId) return null;
  return parseRun(run);
}

export async function listNetworkScenarioComparisonRuns(
  context: AuthenticatedContext,
  projectId: string
): Promise<NetworkScenarioComparisonRunListItem[]> {
  await assertProjectOwned(context, projectId);
  const runs = await prisma.supplyChainDesignNetworkScenarioComparisonRun.findMany({
    where: {
      tenantId: context.tenantId,
      projectId
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  return runs.map((run) => {
    const detail = parseRunForList(run);
    return {
      id: detail.id,
      status: detail.status,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      scenarioAName: detail.scenarioAName,
      scenarioBName: detail.scenarioBName,
      calculationVersion: detail.calculationVersion,
      comparisonFingerprint: detail.comparisonFingerprint,
      transportationFingerprint: detail.transportationFingerprint,
      inputReferences: detail.inputReferences,
      scenarioInputs: detail.scenarioInputs,
      ratingEvidence: detail.ratingEvidence,
      fxInput: detail.fxInput,
      resultSummary: detail.resultSummary,
      errorMessage: detail.errorMessage,
      resultReadError: detail.resultReadError,
      headline: {
        completenessStatus: detail.resultSummary?.completenessStatus ?? null,
        totalDifference: detail.resultSummary?.comparison.totalDifference ?? null
      }
    };
  });
}

export async function deleteNetworkScenarioComparisonRun(
  context: AuthenticatedContext,
  projectId: string,
  runId: string
) {
  const deleted = await prisma.supplyChainDesignNetworkScenarioComparisonRun.deleteMany({
    where: {
      tenantId: context.tenantId,
      projectId,
      id: runId
    }
  });
  return deleted.count === 1;
}

export async function updateNetworkScenarioComparisonRunLifecycle(
  context: AuthenticatedContext,
  projectId: string,
  runId: string,
  input: UpdateNetworkScenarioComparisonRunLifecycleInput
): Promise<NetworkScenarioComparisonRunDetail> {
  const existing = await prisma.supplyChainDesignNetworkScenarioComparisonRun.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: runId
      }
    }
  });
  if (!existing || existing.projectId !== projectId) {
    throw new Error("Network Scenario Comparison run was not found.");
  }

  const data: Record<string, unknown> = {
    status: input.status,
    errorMessage: input.errorMessage ?? null
  };
  if (input.ratingEvidence !== undefined) {
    data.ratingEvidence = validateRatingEvidence(input.ratingEvidence) as unknown as object;
  }
  if (input.fxInput !== undefined) {
    data.fxInput = validateFxInput(input.fxInput) as unknown as object | null;
  }
  if (input.resultSummary !== undefined) {
    data.resultSummary = validateResultSummary(input.resultSummary) as unknown as object | null;
  }

  const updated = await prisma.supplyChainDesignNetworkScenarioComparisonRun.update({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: runId
      }
    },
    data
  });
  return parseRun(updated);
}

export async function findCompletedNetworkScenarioComparisonRunByFingerprint(
  context: AuthenticatedContext,
  projectId: string,
  comparisonFingerprint: string
) {
  const run = await prisma.supplyChainDesignNetworkScenarioComparisonRun.findFirst({
    where: {
      tenantId: context.tenantId,
      projectId,
      comparisonFingerprint,
      status: "COMPLETE"
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  return run ? parseRun(run) : null;
}

export async function findActiveNetworkScenarioComparisonRunByFingerprint(
  context: AuthenticatedContext,
  projectId: string,
  comparisonFingerprint: string
) {
  const run = await prisma.supplyChainDesignNetworkScenarioComparisonRun.findFirst({
    where: {
      tenantId: context.tenantId,
      projectId,
      comparisonFingerprint,
      status: {
        in: ["EVALUATING", "RATES_REQUIRED", "RATING", "READY_FOR_COST_EVALUATION"]
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  return run ? parseRun(run) : null;
}

export function buildNetworkScenarioTransportationFingerprint(input: {
  inputReferences: NetworkScenarioComparisonInputReferences;
  scenarioInputs: NetworkScenarioComparisonScenarioInputs;
  ratingAccountId: string;
  carrierHashes: string[];
}) {
  return hashStable({
    version: NETWORK_SCENARIO_COMPARISON_TRANSPORTATION_VERSION,
    historicalShipments: sourceFingerprint(input.inputReferences.historicalShipments),
    rating: {
      accountId: normalizeText(input.ratingAccountId),
      carrierHashes: input.carrierHashes.map(normalizeText).sort()
    },
    scenarios: input.scenarioInputs.scenarios
      .map((scenario) => ({
        scenarioKey: scenario.scenarioKey,
        selectedFacilities: scenario.selectedFacilities
          .map((facility) => ({
            facilityId: normalizeText(facility.facilityId),
            sourceType: facility.sourceType,
            postalCode: normalizeNullableText(facility.postalCode),
            city: normalizeNullableText(facility.city),
            stateProvince: normalizeNullableText(facility.stateProvince),
            country: normalizeNullableText(facility.country),
            sourceFileId: facility.sourceFileId,
            sourceMappingId: facility.sourceMappingId,
            sourceContentHash: facility.sourceContentHash
          }))
          .sort((left, right) => `${left.sourceType}:${left.facilityId}`.localeCompare(`${right.sourceType}:${right.facilityId}`))
      }))
      .sort((left, right) => left.scenarioKey.localeCompare(right.scenarioKey))
  });
}

export function buildNetworkScenarioComparisonFingerprint(input: {
  transportationFingerprint: string;
  scenarioInputs: NetworkScenarioComparisonScenarioInputs;
  fxInput: NetworkScenarioComparisonFxInput | null;
  resultInputs: Record<string, unknown>;
}) {
  return hashStable({
    version: NETWORK_SCENARIO_COMPARISON_CALCULATION_VERSION,
    transportationFingerprint: input.transportationFingerprint,
    warehouseCostVersion: NETWORK_SCENARIO_COMPARISON_WAREHOUSE_COST_VERSION,
    combinedCostVersion: NETWORK_SCENARIO_COMPARISON_COMBINED_COST_VERSION,
    fxInput: input.fxInput,
    warehouseCostEvidence: input.scenarioInputs.scenarios
      .flatMap((scenario) => scenario.selectedFacilities.map((facility) => ({
        scenarioKey: scenario.scenarioKey,
        facilityId: normalizeText(facility.facilityId),
        sourceType: facility.sourceType,
        sourceContentHash: facility.sourceContentHash,
        warehouseCostEvidence: facility.warehouseCostEvidence
      })))
      .sort((left, right) => `${left.scenarioKey}:${left.sourceType}:${left.facilityId}`.localeCompare(`${right.scenarioKey}:${right.sourceType}:${right.facilityId}`)),
    resultInputs: input.resultInputs
  });
}

function parseRun(run: any): NetworkScenarioComparisonRunDetail {
  return {
    id: run.id,
    tenantId: run.tenantId,
    projectId: run.projectId,
    status: parseStatus(run.status),
    calculationVersion: stringValue(run.calculationVersion, "calculationVersion"),
    comparisonFingerprint: stringValue(run.comparisonFingerprint, "comparisonFingerprint"),
    transportationFingerprint: stringValue(run.transportationFingerprint, "transportationFingerprint"),
    scenarioAName: stringValue(run.scenarioAName, "scenarioAName"),
    scenarioBName: stringValue(run.scenarioBName, "scenarioBName"),
    inputReferences: validateInputReferences(run.inputReferences, run.tenantId, run.projectId),
    scenarioInputs: validateScenarioInputs(run.scenarioInputs),
    ratingEvidence: validateRatingEvidence(run.ratingEvidence),
    fxInput: validateFxInput(run.fxInput),
    resultSummary: validateResultSummary(run.resultSummary),
    errorMessage: typeof run.errorMessage === "string" ? run.errorMessage : null,
    createdByUserId: typeof run.createdByUserId === "string" ? run.createdByUserId : null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function parseRunForList(run: any): NetworkScenarioComparisonRunListItem {
  try {
    const detail = parseRun(run);
    return {
      ...detail,
      resultReadError: null,
      headline: {
        completenessStatus: detail.resultSummary?.completenessStatus ?? null,
        totalDifference: detail.resultSummary?.comparison.totalDifference ?? null
      }
    };
  } catch (error) {
    return {
      id: run.id,
      status: parseStatus(run.status),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      scenarioAName: typeof run.scenarioAName === "string" && run.scenarioAName.trim() ? run.scenarioAName : "Scenario A",
      scenarioBName: typeof run.scenarioBName === "string" && run.scenarioBName.trim() ? run.scenarioBName : "Scenario B",
      calculationVersion: typeof run.calculationVersion === "string" ? run.calculationVersion : NETWORK_SCENARIO_COMPARISON_CALCULATION_VERSION,
      comparisonFingerprint: typeof run.comparisonFingerprint === "string" ? run.comparisonFingerprint : "",
      transportationFingerprint: typeof run.transportationFingerprint === "string" ? run.transportationFingerprint : "",
      inputReferences: null,
      scenarioInputs: null,
      ratingEvidence: null,
      fxInput: null,
      resultSummary: null,
      errorMessage: typeof run.errorMessage === "string" ? run.errorMessage : null,
      resultReadError: error instanceof Error ? error.message : "Network Scenario Comparison run could not be read.",
      headline: {
        completenessStatus: null,
        totalDifference: null
      }
    };
  }
}

async function assertProjectOwned(context: AuthenticatedContext, projectId: string) {
  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    select: {
      id: true
    }
  });
  if (!project) throw new Error("Supply Chain Design project was not found.");
}

function validateInputReferences(value: unknown, tenantId: string, projectId: string): NetworkScenarioComparisonInputReferences {
  const object = objectValue(value, "inputReferences");
  if (object.tenantId !== tenantId || object.projectId !== projectId) {
    throw new Error("Network Scenario Comparison input references do not match the requested tenant and project.");
  }
  return {
    tenantId,
    projectId,
    historicalShipments: fileReference(object.historicalShipments, "historicalShipments"),
    currentFacilities: fileReference(object.currentFacilities, "currentFacilities"),
    candidateFacilities: fileReference(object.candidateFacilities, "candidateFacilities")
  };
}

function validateScenarioInputs(value: unknown): NetworkScenarioComparisonScenarioInputs {
  const object = objectValue(value, "scenarioInputs");
  const scenarios = Array.isArray(object.scenarios) ? object.scenarios.map(scenarioInput) : [];
  if (scenarios.length !== 2 || scenarios[0].scenarioKey === scenarios[1].scenarioKey) {
    throw new Error("Network Scenario Comparison requires exactly two scenario inputs.");
  }
  return {
    historicalShipments: fileReference(object.historicalShipments, "scenarioInputs.historicalShipments"),
    scenarios: scenarios.sort((left, right) => left.scenarioKey.localeCompare(right.scenarioKey)) as [NetworkScenarioComparisonScenarioInput, NetworkScenarioComparisonScenarioInput]
  };
}

function validateRatingEvidence(value: unknown): NetworkScenarioComparisonRatingEvidence {
  const object = objectValue(value, "ratingEvidence");
  return {
    phase: stringValue(object.phase, "ratingEvidence.phase"),
    ratingBatchIds: stringArray(object.ratingBatchIds, "ratingEvidence.ratingBatchIds"),
    missingRateCount: numberValue(object.missingRateCount, "ratingEvidence.missingRateCount"),
    reusedLaneCount: numberValue(object.reusedLaneCount, "ratingEvidence.reusedLaneCount"),
    exactLaneFingerprints: stringArray(object.exactLaneFingerprints, "ratingEvidence.exactLaneFingerprints"),
    laneReferences: Array.isArray(object.laneReferences)
      ? object.laneReferences.map((item) => {
          const lane = objectValue(item, "ratingEvidence.laneReferences[]");
          return {
            exactLaneFingerprint: stringValue(lane.exactLaneFingerprint, "exactLaneFingerprint"),
            batchId: nullableString(lane.batchId),
            laneId: nullableString(lane.laneId),
            status: stringValue(lane.status, "status")
          };
        })
      : [],
    reconciliation: objectValue(object.reconciliation ?? {}, "ratingEvidence.reconciliation")
  };
}

function validateFxInput(value: unknown): NetworkScenarioComparisonFxInput | null {
  if (value === null || value === undefined) return null;
  const object = objectValue(value, "fxInput");
  const rate = numberValue(object.cadToUsdRate, "fxInput.cadToUsdRate");
  if (rate <= 0) throw new Error("Network Scenario Comparison CAD to USD rate must be greater than zero.");
  return { cadToUsdRate: rate };
}

function validateResultSummary(value: unknown): NetworkScenarioComparisonResultSummary | null {
  if (value === null || value === undefined) return null;
  const object = objectValue(value, "resultSummary");
  return {
    completenessStatus: stringValue(object.completenessStatus, "resultSummary.completenessStatus"),
    scenarioA: objectValue(object.scenarioA ?? {}, "resultSummary.scenarioA"),
    scenarioB: objectValue(object.scenarioB ?? {}, "resultSummary.scenarioB"),
    comparison: objectValue(object.comparison ?? {}, "resultSummary.comparison"),
    warnings: stringArray(object.warnings ?? [], "resultSummary.warnings"),
    rateCoverage: objectValue(object.rateCoverage ?? {}, "resultSummary.rateCoverage"),
    warehouseCostEvidence: objectValue(object.warehouseCostEvidence ?? {}, "resultSummary.warehouseCostEvidence"),
    historicalBaselineReference: object.historicalBaselineReference === undefined ? undefined : objectValue(object.historicalBaselineReference, "historicalBaselineReference")
  };
}

function scenarioInput(value: unknown): NetworkScenarioComparisonScenarioInput {
  const object = objectValue(value, "scenarioInputs.scenarios[]");
  const scenarioKey = object.scenarioKey === "A" || object.scenarioKey === "B" ? object.scenarioKey : null;
  if (!scenarioKey) throw new Error("Network Scenario Comparison scenario key must be A or B.");
  const selectedFacilities = Array.isArray(object.selectedFacilities) ? object.selectedFacilities.map(selectedFacility) : [];
  if (selectedFacilities.length === 0) throw new Error("Network Scenario Comparison scenario requires at least one selected facility.");
  return {
    scenarioKey,
    scenarioName: stringValue(object.scenarioName, "scenarioName"),
    selectedFacilities: selectedFacilities.sort((left, right) => `${left.sourceType}:${left.facilityId}`.localeCompare(`${right.sourceType}:${right.facilityId}`))
  };
}

function selectedFacility(value: unknown): NetworkScenarioComparisonSelectedFacility {
  const object = objectValue(value, "selectedFacilities[]");
  const sourceType = object.sourceType === "CURRENT" || object.sourceType === "CANDIDATE" ? object.sourceType : null;
  if (!sourceType) throw new Error("Network Scenario Comparison selected facility source type must be CURRENT or CANDIDATE.");
  return {
    facilityId: stringValue(object.facilityId, "facilityId"),
    sourceType,
    facilityName: stringValue(object.facilityName, "facilityName"),
    postalCode: nullableString(object.postalCode),
    city: nullableString(object.city),
    stateProvince: nullableString(object.stateProvince),
    country: nullableString(object.country),
    sourceFileId: stringValue(object.sourceFileId, "sourceFileId"),
    sourceMappingId: stringValue(object.sourceMappingId, "sourceMappingId"),
    sourceContentHash: stringValue(object.sourceContentHash, "sourceContentHash"),
    warehouseCostEvidence: objectValue(object.warehouseCostEvidence ?? {}, "warehouseCostEvidence")
  };
}

function fileReference(value: unknown, label: string): NetworkScenarioComparisonFileReference {
  const object = objectValue(value, label);
  return {
    fileId: stringValue(object.fileId, `${label}.fileId`),
    fileName: stringValue(object.fileName, `${label}.fileName`),
    contentHash: stringValue(object.contentHash, `${label}.contentHash`),
    mappingId: stringValue(object.mappingId, `${label}.mappingId`),
    mappingUpdatedAt: nullableString(object.mappingUpdatedAt)
  };
}

function parseStatus(value: unknown): SupplyChainDesignNetworkScenarioComparisonStatus {
  if (
    value === "EVALUATING" ||
    value === "RATES_REQUIRED" ||
    value === "RATING" ||
    value === "READY_FOR_COST_EVALUATION" ||
    value === "COMPLETE" ||
    value === "INCOMPLETE" ||
    value === "FAILED"
  ) return value;
  throw new Error("Network Scenario Comparison run has an unsupported status.");
}

function sourceFingerprint(value: NetworkScenarioComparisonFileReference) {
  return {
    fileId: value.fileId,
    contentHash: value.contentHash,
    mappingId: value.mappingId,
    mappingUpdatedAt: value.mappingUpdatedAt ?? null
  };
}

function hashStable(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeText(value: string) {
  return value.trim().toUpperCase();
}

function normalizeNullableText(value: string | null) {
  return value?.trim() ? normalizeText(value) : null;
}

function objectValue(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Network Scenario Comparison ${label} is malformed.`);
  return value as Record<string, any>;
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Network Scenario Comparison ${label} is required.`);
  return value;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`Network Scenario Comparison ${label} must be a string array.`);
  return value;
}

function numberValue(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Network Scenario Comparison ${label} must be a number.`);
  return value;
}
