import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import { getSourceColumn } from "@/modules/supply-chain-design/model-01-proof";
import {
  isAutomaticallyMappedFromNewlTemplate,
  isSupplyChainDesignInternalTableType
} from "@/modules/supply-chain-design/mapping-definitions";
import { SCDS_LTL_RATE_PREPARATION_RESULT_VERSION } from "@/modules/supply-chain-design/candidate-ltl-rate-preparation";
import { getSupplyChainDesignLtlRateBatches } from "@/modules/supply-chain-design/ltl-rate-batches";
import { WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION } from "@/modules/supply-chain-design/warehouse-location-strategy";
import {
  readWarehouseCostFacilityOptions,
  WAREHOUSE_COST_COMPARISON_RESULT_VERSION,
  type WarehouseCostMappedFile
} from "@/modules/supply-chain-design/warehouse-cost-comparison";
import { listNetworkScenarioComparisonRuns } from "@/modules/supply-chain-design/network-scenario-comparison-persistence";
import type {
  SupplyChainDesignFieldMapping,
  SupplyChainDesignFileMappingDetail,
  SupplyChainDesignModel01ProofInputSelection,
  SupplyChainDesignLtlRatePreparationReadiness,
  SupplyChainDesignLtlRatePreparationRunSummary,
  SupplyChainDesignModel01ProofResultSummary,
  SupplyChainDesignModel02ProofReadiness,
  SupplyChainDesignModel02ProofResultSummary,
  SupplyChainDesignModelRunSummary,
  SupplyChainDesignProjectFileDetail,
  SupplyChainDesignProjectFileSummary,
  SupplyChainDesignProjectDetail,
  SupplyChainDesignProjectSummary,
  SupplyChainDesignScenarioSummary,
  SupplyChainDesignScreeningRunSummary,
  SupplyChainDesignThreePlScreeningReadiness,
  SupplyChainDesignWarehouseLocationStrategyReadiness,
  SupplyChainDesignWarehouseLocationStrategyRunSummary,
  SupplyChainDesignWarehouseCostComparisonReadiness,
  SupplyChainDesignWarehouseCostComparisonRunSummary,
  SupplyChainDesignNetworkScenarioComparisonReadiness,
  SupplyChainDesignStudioShell
} from "@/modules/supply-chain-design/types";

export async function getSupplyChainDesignStudioShell(options: {
  hasSavedMapping?: boolean;
  canRunModel?: boolean;
  hasSuccessfulRun?: boolean;
} = {}): Promise<SupplyChainDesignStudioShell> {
  return {
    modelId: "MOD-01",
    modelName: "Current-State Network and Cost Reconstruction",
    status: "SHELL_ONLY",
    workspaceSteps: [
      { label: "Project setup", status: "available" },
      { label: "File intake", status: "available" },
      { label: "Mapping", status: options.hasSavedMapping ? "available" : "deferred" },
      { label: "Validation", status: "deferred" },
      { label: "Snapshot", status: "deferred" },
      { label: "Model run", status: options.canRunModel ? "available" : "deferred" },
      { label: "Results", status: options.hasSuccessfulRun ? "available" : "deferred" }
    ]
  };
}

export async function listSupplyChainDesignProjects(
  context: AuthenticatedContext
): Promise<SupplyChainDesignProjectSummary[]> {
  const projects = await prisma.supplyChainDesignProject.findMany({
    where: {
      tenantId: context.tenantId
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      createdBy: {
        select: {
          name: true,
          email: true
        }
      },
      files: {
        orderBy: {
          createdAt: "desc"
        },
        include: {
          uploadedBy: {
            select: {
              name: true,
              email: true
            }
          },
          mappings: true
        }
      },
      modelRuns: {
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      },
      scenarios: {
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      },
      screeningRuns: {
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      },
      ltlRatePreparationRuns: {
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      }
    }
  });

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    createdByName: project.createdBy?.name ?? project.createdBy?.email ?? null
  }));
}

export async function getSupplyChainDesignProject(
  context: AuthenticatedContext,
  projectId: string
): Promise<SupplyChainDesignProjectDetail | null> {
  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    include: {
      createdBy: {
        select: {
          name: true,
          email: true
        }
      },
      files: {
        orderBy: {
          createdAt: "desc"
        },
        include: {
          uploadedBy: {
            select: {
              name: true,
              email: true
            }
          },
          mappings: true
        }
      },
      modelRuns: {
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      },
      scenarios: {
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      },
      screeningRuns: {
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      },
      ltlRatePreparationRuns: {
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      }
    }
  });

  if (!project) {
    return null;
  }

  const filesWithDuplicateLabels = addDuplicateContentLabels(project.files);
  const model01Proof = getModel01ProofReadiness(filesWithDuplicateLabels);
  const allModelRuns = project.modelRuns ?? [];
  const recentModelRuns = allModelRuns
    .filter((run) => !isWarehouseLocationStrategyResult(run.resultSummary) && !isWarehouseCostComparisonResult(run.resultSummary))
    .map((run) => mapModelRunSummary(run, filesWithDuplicateLabels));
  const recentWarehouseLocationStrategyRuns = allModelRuns.map(mapWarehouseLocationStrategyRunSummary).filter((run) => run.resultSummary);
  const recentWarehouseCostComparisonRuns = allModelRuns.map(mapWarehouseCostComparisonRunSummary).filter((run) => run.resultSummary);
  const latestModelRun = recentModelRuns[0] ?? null;
  const latestWarehouseLocationStrategyRun = recentWarehouseLocationStrategyRuns[0] ?? null;
  const latestSuccessfulRun = recentModelRuns.find((run) => run.status === "SUCCESS" && run.resultSummary) ?? null;
  const model02Proof = getModel02ProofReadiness(filesWithDuplicateLabels, latestSuccessfulRun);
  const candidateLtlRatePreparation = getLtlRatePreparationReadiness(filesWithDuplicateLabels);
  const recentScenarios = project.scenarios?.map(mapScenarioSummary) ?? [];
  const threePlScreening = getThreePlScreeningReadiness(filesWithDuplicateLabels);
  const warehouseLocationStrategy = getWarehouseLocationStrategyReadiness(filesWithDuplicateLabels);
  const warehouseCostComparison = getWarehouseCostComparisonReadiness(filesWithDuplicateLabels);
  const networkScenarioComparison = getNetworkScenarioComparisonReadiness(filesWithDuplicateLabels);
  const recentScreeningRuns = project.screeningRuns?.map(mapScreeningRunSummary) ?? [];
  const recentLtlRatePreparationRuns = project.ltlRatePreparationRuns?.map(mapLtlRatePreparationRunSummary) ?? [];
  const recentLtlRateBatches = await getSupplyChainDesignLtlRateBatches(context, projectId);
  const recentNetworkScenarioComparisonRuns = await listNetworkScenarioComparisonRuns(context, projectId);

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    createdByName: project.createdBy?.name ?? project.createdBy?.email ?? null,
    shell: await getSupplyChainDesignStudioShell({
      hasSavedMapping: filesWithDuplicateLabels.some((file) => file.mappings.length > 0),
      canRunModel: model01Proof.canRun,
      hasSuccessfulRun: latestModelRun?.status === "SUCCESS"
    }),
    files: filesWithDuplicateLabels.map(mapFileSummary),
    model01Proof,
    latestModelRun,
    recentModelRuns,
    model02Proof,
    candidateLtlRatePreparation,
    latestLtlRatePreparationRun: recentLtlRatePreparationRuns[0] ?? null,
    recentLtlRatePreparationRuns,
    latestLtlRateBatch: recentLtlRateBatches[0] ?? null,
    recentLtlRateBatches,
    latestScenario: recentScenarios[0] ?? null,
    recentScenarios,
    threePlScreening,
    latestScreeningRun: recentScreeningRuns[0] ?? null,
    recentScreeningRuns,
    warehouseLocationStrategy,
    latestWarehouseLocationStrategyRun,
    recentWarehouseLocationStrategyRuns,
    warehouseCostComparison,
    latestWarehouseCostComparisonRun: recentWarehouseCostComparisonRuns[0] ?? null,
    recentWarehouseCostComparisonRuns,
    networkScenarioComparison,
    latestNetworkScenarioComparisonRun: recentNetworkScenarioComparisonRuns[0] ?? null,
    recentNetworkScenarioComparisonRuns
  };
}

export async function getSupplyChainDesignProjectFile(
  context: AuthenticatedContext,
  projectId: string,
  fileId: string
): Promise<SupplyChainDesignProjectFileDetail | null> {
  const file = await prisma.supplyChainDesignProjectFile.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: fileId
      }
    },
    include: {
      project: {
        select: {
          id: true,
          name: true
        }
      },
      uploadedBy: {
        select: {
          name: true,
          email: true
        }
      },
      mappings: true
    }
  });

  if (!file || file.projectId !== projectId) {
    return null;
  }

  return {
    ...mapFileSummary(file),
    projectId: file.project.id,
    projectName: file.project.name,
    previewRows: toStringMatrix(file.previewRows),
    mapping: file.mappings[0] ? mapMappingDetail(file.mappings[0]) : null
  };
}

function mapFileSummary(file: {
  id: string;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number;
  contentHash: string;
  rowCount: number;
  detectedHeaders: unknown;
  status: string;
  createdAt: Date;
  uploadedBy: { name: string | null; email: string } | null;
  mappings?: Array<{
    id?: string;
    tableType: string;
    fieldMappings?: unknown;
    updatedAt?: Date;
  }>;
  duplicateContentFileNames?: string[];
}): SupplyChainDesignProjectFileSummary {
  const mapping = file.mappings?.[0] ?? null;
  const detectedHeaders = toStringArray(file.detectedHeaders);
  const missingColumns = mapping ? missingMappedColumns(mapping.fieldMappings, detectedHeaders) : [];
  const isInternal = mapping ? isSupplyChainDesignInternalTableType(mapping.tableType) : false;
  const isAutomaticTemplateMapping = mapping
    ? isAutomaticallyMappedFromNewlTemplate(detectedHeaders, mapping.tableType, mapping.fieldMappings)
    : false;

  return {
    id: file.id,
    originalFileName: file.originalFileName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    contentHash: file.contentHash,
    rowCount: file.rowCount,
    detectedHeaders,
    status: file.status,
    uploadedByName: file.uploadedBy?.name ?? file.uploadedBy?.email ?? null,
    createdAt: file.createdAt,
    hasMapping: Boolean(mapping),
    mappingId: mapping?.id ?? null,
    mappingTableType: mapping?.tableType ?? null,
    mappingUpdatedAt: mapping?.updatedAt ?? null,
    mappingDisplayStatus: !mapping
      ? "Needs mapping"
      : isInternal
        ? "Internal/test only"
        : missingColumns.length > 0
          ? "Needs attention"
          : isAutomaticTemplateMapping
            ? "Ready — automatically mapped"
            : "Ready",
    mappingStatusReason: !mapping
      ? "No logical table has been selected for this file."
      : isInternal
        ? "This table is for internal benchmark or test workflows."
        : missingColumns.length > 0
          ? `Mapped source column(s) missing from current file: ${missingColumns.join(", ")}.`
          : null,
    duplicateContentFileNames: file.duplicateContentFileNames ?? []
  };
}

function missingMappedColumns(fieldMappings: unknown, headers: string[]) {
  const headerSet = new Set(headers.map((header) => header.replace(/^\uFEFF/, "").trim()));
  return toFieldMappings(fieldMappings)
    .map((field) => field.sourceColumn)
    .filter((sourceColumn): sourceColumn is string => Boolean(sourceColumn))
    .filter((sourceColumn, index, columns) => columns.indexOf(sourceColumn) === index)
    .filter((sourceColumn) => !headerSet.has(sourceColumn.replace(/^\uFEFF/, "").trim()));
}

function addDuplicateContentLabels<
  TFile extends {
    id: string;
    contentHash: string;
    originalFileName: string;
  }
>(files: TFile[]) {
  const namesByHash = new Map<string, string[]>();

  for (const file of files) {
    const existing = namesByHash.get(file.contentHash) ?? [];
    existing.push(file.originalFileName);
    namesByHash.set(file.contentHash, existing);
  }

  return files.map((file) => ({
    ...file,
    duplicateContentFileNames: (namesByHash.get(file.contentHash) ?? []).filter((fileName) => fileName !== file.originalFileName)
  }));
}

function mapMappingDetail(mapping: {
  id: string;
  tableType: string;
  fieldMappings: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): SupplyChainDesignFileMappingDetail {
  return {
    id: mapping.id,
    tableType: mapping.tableType,
    fieldMappings: toFieldMappings(mapping.fieldMappings),
    status: mapping.status,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt
  };
}

function getModel01ProofReadiness(
  files: Array<{
    id: string;
    originalFileName: string;
    fileBytes?: Buffer;
    mappings: Array<{
      id?: string;
      tableType: string;
      updatedAt?: Date;
      fieldMappings?: unknown;
    }>;
  }>
) {
  const candidates = getModel01ProofCandidates(files);
  const mappedTableTypes = new Set([
    ...(candidates.currentNetworkActivity.length > 0 ? ["CURRENT_NETWORK_ACTIVITY"] : []),
    ...(candidates.facilities.length > 0 ? ["FACILITIES"] : []),
    ...(candidates.shipments.length > 0 ? ["SHIPMENTS"] : []),
    ...(candidates.inventory.length > 0 ? ["INVENTORY"] : []),
    ...(candidates.facilityCosts.length > 0 ? ["FACILITY_COSTS"] : []),
    ...(candidates.customers.length > 0 ? ["CUSTOMERS"] : [])
  ]);
  const missingInputs = [
    mappedTableTypes.has("SHIPMENTS") ? null : "Historical Shipments mapping",
    mappedTableTypes.has("FACILITIES") ? null : "Current Facilities and Warehouse Costs mapping"
  ].filter((value): value is string => Boolean(value));
  const inputSelection =
    candidates.facilities[0] && candidates.shipments[0]
      ? {
          currentNetworkActivity: candidates.currentNetworkActivity[0] ? toSelectedInput(candidates.currentNetworkActivity) : null,
          facilities: candidates.facilities[0] ? toSelectedInput(candidates.facilities) : null,
          shipments: candidates.shipments[0] ? toSelectedInput(candidates.shipments) : null,
          inventory: candidates.inventory[0] ? toSelectedInput(candidates.inventory) : null,
          facilityCosts: candidates.facilityCosts[0] ? toSelectedInput(candidates.facilityCosts) : null,
          customers: candidates.customers[0] ? toSelectedInput(candidates.customers) : null
        }
      : null;
  const warnings = [
    candidates.currentNetworkActivity.length > 1
      ? `Legacy Current Network Data mappings exist and are no longer used for new baseline runs: ${candidates.currentNetworkActivity.map((candidate) => candidate.fileName).join(", ")}.`
      : candidates.currentNetworkActivity.length === 1
        ? `Legacy Current Network Data mapping exists and is no longer used for new baseline runs: ${candidates.currentNetworkActivity[0].fileName}.`
      : null,
    candidates.facilities.length > 1
      ? `Multiple Current Facilities and Warehouse Costs mappings exist: ${candidates.facilities.map((candidate) => candidate.fileName).join(", ")}.`
      : null,
    candidates.shipments.length > 1
      ? `Multiple Historical Shipments mappings exist: ${candidates.shipments.map((candidate) => candidate.fileName).join(", ")}.`
      : null,
    candidates.inventory.length > 1
      ? `Multiple INVENTORY mappings exist: ${candidates.inventory.map((candidate) => candidate.fileName).join(", ")}.`
      : null,
    candidates.facilityCosts.length > 1
      ? `Multiple FACILITY_COSTS mappings exist: ${candidates.facilityCosts.map((candidate) => candidate.fileName).join(", ")}.`
      : null,
    candidates.customers.length > 1
      ? `Multiple CUSTOMERS mappings exist: ${candidates.customers.map((candidate) => candidate.fileName).join(", ")}.`
      : null
  ].filter((value): value is string => Boolean(value));

  return {
    canRun: missingInputs.length === 0,
    missingInputs,
    inputSelection,
    warnings
  };
}

function getModel02ProofReadiness(
  files: Array<{
    id: string;
    originalFileName: string;
    fileBytes?: Buffer;
    mappings: Array<{
      id?: string;
      tableType: string;
      updatedAt?: Date;
      fieldMappings?: unknown;
    }>;
  }>,
  latestSuccessfulRun: SupplyChainDesignModelRunSummary | null
): SupplyChainDesignModel02ProofReadiness {
  const candidates = getModel01ProofCandidates(files);
  const missingInputs = [
    candidates.facilities[0] ? null : "FACILITIES mapping",
    candidates.shipments[0] ? null : "SHIPMENTS mapping",
    candidates.candidateFacilities[0] ? null : "CANDIDATE_FACILITIES mapping",
    latestSuccessfulRun?.resultSummary ? null : "successful Model 01 baseline"
  ].filter((value): value is string => Boolean(value));

  if (missingInputs.length > 0 || !latestSuccessfulRun?.resultSummary) {
    return {
      canRun: false,
      missingInputs,
      inputSelection: null
    };
  }

  const candidateFacilities = candidates.candidateFacilities[0];
  return {
    canRun: true,
    missingInputs,
    inputSelection: {
      baselineRunId: latestSuccessfulRun.id,
      baselineObservedCost:
        (latestSuccessfulRun.resultSummary.totalTransportationCost ?? 0) +
        (latestSuccessfulRun.resultSummary.totalFacilityOperatingCost ?? 0),
      facilities: toSelectedInput(candidates.facilities),
      shipments: toSelectedInput(candidates.shipments),
      customers: candidates.customers[0] ? toSelectedInput(candidates.customers) : toSelectedInput(candidates.shipments),
      candidateFacilities: toSelectedInput(candidates.candidateFacilities),
      scenarioLaneCosts: candidates.scenarioLaneCosts[0] ? toSelectedInput(candidates.scenarioLaneCosts) : null,
      facilityCosts: candidates.facilityCosts[0] ? toSelectedInput(candidates.facilityCosts) : null,
      existingFacilityOptions: toExistingFacilityOptions(
        candidates.facilities[0]?.fileBytes,
        toFieldMappings(candidates.facilities[0]?.fieldMappings)
      ),
      existingFacilityOptionsByMappingId: candidates.facilities.map((candidate) => ({
        mappingId: candidate.mappingId,
        options: toExistingFacilityOptions(candidate.fileBytes, toFieldMappings(candidate.fieldMappings))
      })),
      candidateFacilityOptions: toCandidateFacilityOptions(
        candidateFacilities.fileBytes,
        toFieldMappings(candidateFacilities.fieldMappings)
      ),
      candidateFacilityOptionsByMappingId: candidates.candidateFacilities.map((candidate) => ({
        mappingId: candidate.mappingId,
        options: toCandidateFacilityOptions(candidate.fileBytes, toFieldMappings(candidate.fieldMappings))
      }))
    }
  };
}

function getWarehouseLocationStrategyReadiness(
  files: Array<{
    id: string;
    originalFileName: string;
    fileBytes?: Buffer;
    mappings: Array<{
      id?: string;
      tableType: string;
      updatedAt?: Date;
      fieldMappings?: unknown;
    }>;
  }>
): SupplyChainDesignWarehouseLocationStrategyReadiness {
  const candidates = getModel01ProofCandidates(files).shipments.filter((candidate) =>
    candidate.fieldMappings.some((mapping) => mapping.standardField === "postal_or_region_code" || mapping.standardField === "destination_id")
  );
  const missingInputs = candidates[0] ? [] : ["Historical Shipments mapping with destination postal code"];
  return {
    canRun: missingInputs.length === 0,
    missingInputs,
    inputSelection: candidates[0] ? { shipments: toSelectedInput(candidates) } : null
  };
}

function getWarehouseCostComparisonReadiness(
  files: Array<{
    id: string;
    originalFileName: string;
    fileBytes?: Buffer;
    mappings: Array<{
      id?: string;
      tableType: string;
      updatedAt?: Date;
      fieldMappings?: unknown;
    }>;
  }>
): SupplyChainDesignWarehouseCostComparisonReadiness {
  const candidates = getModel01ProofCandidates(files);
  const facilities = candidates.facilities[0] ?? null;
  const candidateFacilities = candidates.candidateFacilities[0] ?? null;
  const missingInputs = [
    facilities ? null : "Current Facilities and Warehouse Costs mapping",
    candidateFacilities ? null : "Candidate Warehouses and Proposed Costs mapping"
  ].filter((value): value is string => Boolean(value));
  const facilityOptions =
    facilities && candidateFacilities
      ? readWarehouseCostFacilityOptions({
          currentFacilities: toWarehouseCostMappedFile(facilities),
          candidateFacilities: toWarehouseCostMappedFile(candidateFacilities)
        })
      : [];
  return {
    canRun: missingInputs.length === 0 && facilityOptions.length >= 2,
    missingInputs: facilityOptions.length < 2 && missingInputs.length === 0 ? ["at least two facilities with saved mappings"] : missingInputs,
    inputSelection:
      facilities && candidateFacilities
        ? {
            facilities: toSelectedInput(candidates.facilities),
            candidateFacilities: toSelectedInput(candidates.candidateFacilities),
            facilityOptions
          }
        : null
  };
}

function getNetworkScenarioComparisonReadiness(
  files: Array<{
    id: string;
    originalFileName: string;
    fileBytes?: Buffer;
    mappings: Array<{
      id?: string;
      tableType: string;
      updatedAt?: Date;
      fieldMappings?: unknown;
    }>;
  }>
): SupplyChainDesignNetworkScenarioComparisonReadiness {
  const candidates = getModel01ProofCandidates(files);
  const shipments = candidates.shipments[0] ?? null;
  const facilities = candidates.facilities[0] ?? null;
  const candidateFacilities = candidates.candidateFacilities[0] ?? null;
  const missingInputs = [
    shipments ? null : "Historical Shipments mapping",
    facilities ? null : "Current Facilities and Warehouse Costs mapping",
    candidateFacilities ? null : "Candidate Warehouses and Proposed Costs mapping"
  ].filter((value): value is string => Boolean(value));
  const facilityOptions =
    facilities && candidateFacilities
      ? readWarehouseCostFacilityOptions({
          currentFacilities: toWarehouseCostMappedFile(facilities),
          candidateFacilities: toWarehouseCostMappedFile(candidateFacilities)
        })
      : [];
  const currentFacilityOptionsByMappingId = candidates.facilities.map((candidate) => ({
    mappingId: candidate.mappingId,
    options: readWarehouseCostFacilityOptions({
      currentFacilities: toWarehouseCostMappedFile(candidate),
      candidateFacilities: null
    })
  }));
  const candidateFacilityOptionsByMappingId = candidates.candidateFacilities.map((candidate) => ({
    mappingId: candidate.mappingId,
    options: readWarehouseCostFacilityOptions({
      currentFacilities: null,
      candidateFacilities: toWarehouseCostMappedFile(candidate)
    })
  }));

  return {
    canRun: missingInputs.length === 0 && facilityOptions.length > 0,
    missingInputs: facilityOptions.length === 0 && missingInputs.length === 0 ? ["at least one current or candidate warehouse"] : missingInputs,
    inputSelection:
      shipments && facilities && candidateFacilities
        ? {
            shipments: toSelectedInput(candidates.shipments),
            facilities: toSelectedInput(candidates.facilities),
            candidateFacilities: toSelectedInput(candidates.candidateFacilities),
            facilityOptions,
            currentFacilityOptionsByMappingId,
            candidateFacilityOptionsByMappingId
          }
        : null
  };
}

function toWarehouseCostMappedFile(candidate: {
  fileBytes?: Buffer;
  fieldMappings: unknown;
}): WarehouseCostMappedFile | null {
  if (!candidate.fileBytes) return null;
  return {
    fileBytes: candidate.fileBytes,
    fieldMappings: toFieldMappings(candidate.fieldMappings)
  };
}

function getLtlRatePreparationReadiness(
  files: Array<{
    id: string;
    originalFileName: string;
    fileBytes?: Buffer;
    mappings: Array<{
      id?: string;
      tableType: string;
      updatedAt?: Date;
      fieldMappings?: unknown;
    }>;
  }>
): SupplyChainDesignLtlRatePreparationReadiness {
  const candidates = getModel01ProofCandidates(files);
  const candidateFacilities = candidates.candidateFacilities.filter((candidate) =>
    ["candidate_facility_id", "candidate_facility_name", "postal_code", "candidate_country"].every((field) =>
      toFieldMappings(candidate.fieldMappings).some((mapping) => mapping.standardField === field && mapping.sourceColumn)
    )
  );
  const missingInputs = [
    candidates.shipments[0] ? null : "Historical Shipments mapping",
    candidates.facilities[0] ? null : "Current Facilities and Warehouse Costs mapping",
    candidateFacilities[0] ? null : "Candidate Warehouses and Proposed Costs mapping with Candidate Country"
  ].filter((value): value is string => Boolean(value));

  return {
    canRun: missingInputs.length === 0,
    missingInputs,
    inputSelection:
      candidates.shipments[0] && candidates.facilities[0] && candidateFacilities[0]
        ? {
            shipments: toSelectedInput(candidates.shipments),
            facilities: toSelectedInput(candidates.facilities),
            candidateFacilities: toSelectedInput(candidateFacilities),
            existingFacilityOptions: toExistingFacilityOptions(
              candidates.facilities[0]?.fileBytes,
              toFieldMappings(candidates.facilities[0]?.fieldMappings)
            ).map((facility) => ({
              facilityId: facility.facilityId,
              facilityName: facility.facilityName,
              annualFacilityCost: facility.annualFacilityCost
            })),
            candidateFacilityOptions: toCandidateFacilityOptions(
              candidateFacilities[0]?.fileBytes,
              toFieldMappings(candidateFacilities[0]?.fieldMappings)
            ).map((facility) => ({
              facilityId: facility.facilityId,
              facilityName: facility.facilityName,
              annualFixedCost: facility.annualFixedCost
            }))
          }
        : null
  };
}

function getModel01ProofCandidates(
  files: Array<{
    id: string;
    originalFileName: string;
    fileBytes?: Buffer;
    mappings: Array<{
      id?: string;
      tableType: string;
      updatedAt?: Date;
      fieldMappings?: unknown;
    }>;
  }>
) {
  const candidates = files.flatMap((file) =>
    file.mappings
      .filter((mapping) => isValidProofMapping(mapping))
      .map((mapping) => ({
        fileId: file.id,
        fileName: file.originalFileName,
        mappingId: mapping.id ?? "",
        tableType: mapping.tableType,
        mappingUpdatedAt: mapping.updatedAt ?? new Date(0),
        fieldMappings: mapping.fieldMappings,
        fileBytes: file.fileBytes
      }))
  );

  return {
    currentNetworkActivity: candidates
      .filter((candidate) => candidate.tableType === "CURRENT_NETWORK_ACTIVITY")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    facilities: candidates
      .filter((candidate) => candidate.tableType === "FACILITIES")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    shipments: candidates
      .filter((candidate) => candidate.tableType === "SHIPMENTS")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    inventory: candidates
      .filter((candidate) => candidate.tableType === "INVENTORY")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    facilityCosts: candidates
      .filter((candidate) => candidate.tableType === "FACILITY_COSTS")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    customers: candidates
      .filter((candidate) => candidate.tableType === "CUSTOMERS")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    candidateFacilities: candidates
      .filter((candidate) => candidate.tableType === "CANDIDATE_FACILITIES")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    scenarioLaneCosts: candidates
      .filter((candidate) => candidate.tableType === "SCENARIO_LANE_COSTS")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    demandPoints: candidates
      .filter((candidate) => candidate.tableType === "DEMAND_POINTS")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    logisticsMarkets: candidates
      .filter((candidate) => candidate.tableType === "LOGISTICS_MARKETS")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    canadaProvinceMarketMap: candidates
      .filter((candidate) => candidate.tableType === "CANADA_PROVINCE_MARKET_MAP")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    providerOptions: candidates
      .filter((candidate) => candidate.tableType === "PROVIDER_OPTIONS")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    shipmentProfiles: candidates
      .filter((candidate) => candidate.tableType === "SHIPMENT_PROFILES")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    outboundRateCache: candidates
      .filter((candidate) => candidate.tableType === "OUTBOUND_RATE_CACHE")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime()),
    expectedProviderResults: candidates
      .filter((candidate) => candidate.tableType === "EXPECTED_PROVIDER_RESULTS")
      .sort((left, right) => right.mappingUpdatedAt.getTime() - left.mappingUpdatedAt.getTime())
  };
}

function isValidProofMapping(mapping: { tableType: string; fieldMappings?: unknown }) {
  const requiredFields =
    mapping.tableType === "CURRENT_NETWORK_ACTIVITY"
      ? ["origin_facility_id", "facility_name"]
      : mapping.tableType === "FACILITIES"
      ? ["facility_id", "facility_name"]
      : mapping.tableType === "SHIPMENTS"
        ? ["origin_facility_id"]
        : mapping.tableType === "INVENTORY"
          ? ["facility_id", "item_id", "quantity"]
          : mapping.tableType === "FACILITY_COSTS"
            ? ["facility_id", "cost_category", "annual_cost"]
            : mapping.tableType === "CUSTOMERS"
              ? ["customer_id", "customer_name", "city", "country"]
              : mapping.tableType === "CANDIDATE_FACILITIES"
                ? ["candidate_facility_id", "candidate_facility_name"]
                : mapping.tableType === "SCENARIO_LANE_COSTS"
                ? ["origin_facility_id", "destination_id", "cost_per_shipment"]
                  : mapping.tableType === "DEMAND_POINTS"
                      ? [
                          "destination_id",
                          "postal_or_region_code",
                          "country",
                          "annual_shipment_count"
                        ]
                    : mapping.tableType === "LOGISTICS_MARKETS"
                      ? [
                          "market_id",
                          "market_name",
                          "state_province",
                          "country",
                          "latitude",
                          "longitude",
                          "active_eligible"
                        ]
                      : mapping.tableType === "CANADA_PROVINCE_MARKET_MAP"
                        ? ["province_code", "approved_logistics_market_id", "approved_major_city"]
                        : mapping.tableType === "STUDY_CONTROL"
                          ? ["study_name", "study_type", "country_scope"]
                          : mapping.tableType === "PROVIDER_OPTIONS"
                            ? [
                                "provider_option_id",
                                "provider_name",
                                "warehouse_postal_code",
                                "warehouse_city",
                                "warehouse_state_province",
                                "warehouse_country"
                              ]
                            : mapping.tableType === "SHIPMENT_PROFILES"
                              ? ["shipment_profile_id", "mode"]
                              : mapping.tableType === "OUTBOUND_RATE_CACHE"
                                ? ["provider_option_id", "destination_id", "shipment_profile_id", "cost_per_shipment"]
                                : mapping.tableType === "EXPECTED_PROVIDER_RESULTS"
                                  ? [
                                      "rank",
                                      "provider_option_id",
                                      "provider_name",
                                      "outbound_cost",
                                      "warehouse_cost",
                                      "ocean_cost",
                                      "inland_to_warehouse_cost",
                                      "total_annual_cost"
                                    ]
                                  : [];

  if (requiredFields.length === 0) {
    return false;
  }

  const fields = toFieldMappings(mapping.fieldMappings);
  return requiredFields.every((requiredField) =>
    fields.some((field) => field.standardField === requiredField && field.sourceColumn)
  );
}

function toSelectedInput(
  candidates: Array<{
    fileId: string;
    fileName: string;
    mappingId: string;
    mappingUpdatedAt: Date;
  }>
) {
  const selected = candidates[0];

  return {
    fileId: selected.fileId,
    fileName: selected.fileName,
    mappingId: selected.mappingId,
    mappingUpdatedAt: selected.mappingUpdatedAt.toISOString(),
    candidateFiles: candidates.map((candidate, index) => ({
      fileId: candidate.fileId,
      fileName: candidate.fileName,
      mappingId: candidate.mappingId,
      mappingUpdatedAt: candidate.mappingUpdatedAt.toISOString(),
      selected: index === 0
    }))
  };
}

function mapModelRunSummary(run: {
  id: string;
  status: string;
  createdAt: Date;
  errorMessage: string | null;
  inputReferences: unknown;
  resultSummary: unknown;
}, files?: Array<{
  id: string;
  fileBytes?: Buffer;
  mappings: Array<{
    id?: string;
    tableType: string;
    fieldMappings?: unknown;
  }>;
}>): SupplyChainDesignModelRunSummary {
  const inputReferences = toInputSelection(run.inputReferences);
  const weightUnit = getModel01ShipmentWeightUnit(files, inputReferences);
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    errorMessage: run.errorMessage,
    inputReferences,
    resultSummary: toModel01ProofResult(run.resultSummary),
    weightUnit: weightUnit.unit,
    weightUnitWarning: weightUnit.warning
  };
}

function mapWarehouseLocationStrategyRunSummary(run: {
  id: string;
  status: string;
  createdAt: Date;
  errorMessage: string | null;
  inputReferences: unknown;
  resultSummary: unknown;
}): SupplyChainDesignWarehouseLocationStrategyRunSummary {
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    errorMessage: run.errorMessage,
    inputReferences: toWarehouseLocationStrategyInputReferences(run.inputReferences),
    resultSummary: toWarehouseLocationStrategyResult(run.resultSummary)
  };
}

function mapWarehouseCostComparisonRunSummary(run: {
  id: string;
  status: string;
  createdAt: Date;
  errorMessage: string | null;
  inputReferences: unknown;
  resultSummary: unknown;
}): SupplyChainDesignWarehouseCostComparisonRunSummary {
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    errorMessage: run.errorMessage,
    inputReferences: toWarehouseCostComparisonInputReferences(run.inputReferences),
    resultSummary: toWarehouseCostComparisonResult(run.resultSummary)
  };
}

function toWarehouseCostComparisonInputReferences(value: unknown): SupplyChainDesignWarehouseCostComparisonRunSummary["inputReferences"] {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const facilities = toSelectedInputReference(candidate.facilities);
  const candidateFacilities = toSelectedInputReference(candidate.candidateFacilities);
  const selectedFacilityOptionIds = toStringArray(candidate.selectedFacilityOptionIds);
  if (!facilities || !candidateFacilities || selectedFacilityOptionIds.length < 2) return null;
  return {
    facilities,
    candidateFacilities,
    selectedFacilityOptionIds,
    cadToUsdRate: typeof candidate.cadToUsdRate === "number" ? candidate.cadToUsdRate : null
  };
}

function toWarehouseCostComparisonResult(value: unknown): SupplyChainDesignWarehouseCostComparisonRunSummary["resultSummary"] {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return candidate.resultVersion === WAREHOUSE_COST_COMPARISON_RESULT_VERSION
    ? (value as SupplyChainDesignWarehouseCostComparisonRunSummary["resultSummary"])
    : null;
}

function getModel01ShipmentWeightUnit(
  files: Array<{
    id: string;
    fileBytes?: Buffer;
    mappings: Array<{
      id?: string;
      tableType: string;
      fieldMappings?: unknown;
    }>;
  }> | undefined,
  inputReferences: SupplyChainDesignModel01ProofInputSelection | null
) {
  const selectedShipments = inputReferences?.shipments;
  if (!files || !selectedShipments) {
    return { unit: null, warning: null };
  }

  const file = files.find((candidate) => candidate.id === selectedShipments.fileId);
  const mapping = file?.mappings.find((candidate) => candidate.id === selectedShipments.mappingId);
  if (!file?.fileBytes || !mapping) {
    return { unit: null, warning: null };
  }

  const weightUnitColumn = getSourceColumn(toFieldMappings(mapping.fieldMappings), "weight_unit");
  if (!weightUnitColumn) {
    return { unit: null, warning: null };
  }

  const rows = parseCsvRows(file.fileBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const weightUnitIndex = headers.indexOf(weightUnitColumn);
  if (weightUnitIndex < 0) {
    return { unit: null, warning: null };
  }

  const units = new Map<string, string>();
  for (const row of rows.slice(1)) {
    const unit = (row[weightUnitIndex] ?? "").trim();
    if (unit) {
      units.set(unit.toLowerCase(), unit);
    }
  }
  if (units.size === 1) {
    return { unit: [...units.values()][0], warning: null };
  }
  if (units.size > 1) {
    return {
      unit: null,
      warning: `Weight units are mixed in the selected Historical Shipments file: ${[...units.values()].sort().join(", ")}.`
    };
  }
  return { unit: null, warning: null };
}

function mapScenarioSummary(scenario: {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  errorMessage: string | null;
  baselineRunId: string;
  inputReferences: unknown;
  selectedFacilities: unknown;
  resultSummary: unknown;
}): SupplyChainDesignScenarioSummary {
  return {
    id: scenario.id,
    name: scenario.name,
    status: scenario.status,
    createdAt: scenario.createdAt,
    updatedAt: scenario.updatedAt,
    errorMessage: scenario.errorMessage,
    baselineRunId: scenario.baselineRunId,
    inputReferences: toModel02InputSelection(scenario.inputReferences),
    selectedFacilities: toStringArray(scenario.selectedFacilities),
    resultSummary: toModel02ProofResult(scenario.resultSummary)
  };
}

function getThreePlScreeningReadiness(
  files: Array<{
    id: string;
    originalFileName: string;
    fileBytes?: Buffer;
    mappings: Array<{
      id?: string;
      tableType: string;
      updatedAt?: Date;
      fieldMappings?: unknown;
    }>;
  }>
): SupplyChainDesignThreePlScreeningReadiness {
  const candidates = getModel01ProofCandidates(files);
  const missingInputs = [
    candidates.demandPoints[0] ? null : "DEMAND_POINTS mapping"
  ].filter((value): value is string => Boolean(value));

  return {
    canRun: missingInputs.length === 0,
    missingInputs,
    inputSelection:
      candidates.demandPoints[0]
        ? {
            demandPoints: toSelectedInput(candidates.demandPoints),
            logisticsMarkets: candidates.logisticsMarkets[0] ? toSelectedInput(candidates.logisticsMarkets) : null,
            canadaProvinceMarketMap: candidates.canadaProvinceMarketMap[0]
              ? toSelectedInput(candidates.canadaProvinceMarketMap)
              : null,
            providerOptions: candidates.providerOptions[0] ? toSelectedInput(candidates.providerOptions) : null,
            shipmentProfiles: candidates.shipmentProfiles[0] ? toSelectedInput(candidates.shipmentProfiles) : null,
            outboundRateCache: candidates.outboundRateCache[0] ? toSelectedInput(candidates.outboundRateCache) : null,
            expectedProviderResults: candidates.expectedProviderResults[0]
              ? toSelectedInput(candidates.expectedProviderResults)
              : null,
            marketSourceMode: "NEWL_REFERENCE_CATALOGUE"
          }
        : null
  };
}

function mapScreeningRunSummary(run: {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  errorMessage: string | null;
  inputReferences: unknown;
  resultSummary: unknown;
}): SupplyChainDesignScreeningRunSummary {
  const parsedResult = toThreePlScreeningResult(run.resultSummary);
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    errorMessage: run.errorMessage,
    resultReadError: parsedResult.error,
    inputReferences: toThreePlScreeningInputSelection(run.inputReferences),
    resultSummary: parsedResult.result
  };
}

function mapLtlRatePreparationRunSummary(run: {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  errorMessage: string | null;
  inputReferences: unknown;
  resultSummary: unknown;
}): SupplyChainDesignLtlRatePreparationRunSummary {
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    errorMessage: run.errorMessage,
    inputReferences: toLtlRatePreparationInputSelection(run.inputReferences),
    resultSummary: toLtlRatePreparationResult(run.resultSummary)
  };
}

function toLtlRatePreparationInputSelection(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const shipments = toSelectedInputReference(candidate.shipments);
  const candidateFacilities = toSelectedInputReference(candidate.candidateFacilities);
  return shipments && candidateFacilities ? { shipments, candidateFacilities } : null;
}

function toLtlRatePreparationResult(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.resultVersion !== SCDS_LTL_RATE_PREPARATION_RESULT_VERSION ||
    !Array.isArray(candidate.preparedRequests)
  ) {
    return null;
  }
  return value as SupplyChainDesignLtlRatePreparationRunSummary["resultSummary"];
}

function toThreePlScreeningInputSelection(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const demandPoints = toSelectedInputReference(candidate.demandPoints);
  const logisticsMarkets = toSelectedInputReference(candidate.logisticsMarkets);
  const providerOptions = toSelectedInputReference(candidate.providerOptions);
  const shipmentProfiles = toSelectedInputReference(candidate.shipmentProfiles);
  const outboundRateCache = toSelectedInputReference(candidate.outboundRateCache);
  if (!demandPoints) {
    return null;
  }
  return {
    demandPoints,
    logisticsMarkets,
    canadaProvinceMarketMap: candidate.canadaProvinceMarketMap
      ? toSelectedInputReference(candidate.canadaProvinceMarketMap)
      : null,
    marketSourceMode:
      candidate.marketSourceMode === "NEWL_REFERENCE_CATALOGUE" || candidate.marketSourceMode === "PROJECT_UPLOADED_MARKETS"
        ? candidate.marketSourceMode
        : logisticsMarkets
          ? "PROJECT_UPLOADED_MARKETS"
          : "NEWL_REFERENCE_CATALOGUE",
    providerOptions,
    shipmentProfiles,
    outboundRateCache,
    expectedProviderResults: candidate.expectedProviderResults
      ? toSelectedInputReference(candidate.expectedProviderResults)
      : null,
    studyType:
      candidate.studyType === "COMPARE_KNOWN_WAREHOUSE_OPTIONS" || candidate.studyType === "FIND_BEST_WAREHOUSE_REGION"
        ? candidate.studyType
        : undefined
  };
}

function toThreePlScreeningResult(value: unknown) {
  if (!value || typeof value !== "object") {
    return { result: null, error: value ? "Saved 3PL screening result could not be read." : null };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.resultVersion === "3PL_PROVIDER_COMPARISON_V1") {
    if (typeof candidate.studyName !== "string" || !Array.isArray(candidate.providerResults)) {
      return { result: null, error: "Saved 3PL provider-comparison result JSON is incomplete or invalid." };
    }
    return { result: value as SupplyChainDesignScreeningRunSummary["resultSummary"], error: null };
  }
  if (
    candidate.resultVersion !== "3PL_SCREENING_V1" ||
    typeof candidate.studyName !== "string" ||
    !Array.isArray(candidate.oneRegionRankings) ||
    !Array.isArray(candidate.twoRegionRankings)
  ) {
    return { result: null, error: "Saved 3PL screening result JSON is incomplete or invalid." };
  }
  return { result: value as SupplyChainDesignScreeningRunSummary["resultSummary"], error: null };
}

function toModel02InputSelection(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const facilities = toSelectedInputReference(candidate.facilities);
  const shipments = toSelectedInputReference(candidate.shipments);
  const customers = toSelectedInputReference(candidate.customers);
  const candidateFacilities = toSelectedInputReference(candidate.candidateFacilities);

  if (!facilities || !shipments || !customers || !candidateFacilities) {
    return null;
  }

  return {
    baselineRunId: String(candidate.baselineRunId ?? ""),
    baselineObservedCost: Number(candidate.baselineObservedCost ?? 0),
    facilities,
    shipments,
    customers,
    candidateFacilities,
    scenarioLaneCosts: candidate.scenarioLaneCosts ? toSelectedInputReference(candidate.scenarioLaneCosts) : null,
    facilityCosts: candidate.facilityCosts ? toSelectedInputReference(candidate.facilityCosts) : null,
    existingFacilityOptions: toExistingOptions(candidate.existingFacilityOptions),
    existingFacilityOptionsByMappingId: toOptionsByMappingId(candidate.existingFacilityOptionsByMappingId, toExistingOptions),
    candidateFacilityOptions: toCandidateOptions(candidate.candidateFacilityOptions),
    candidateFacilityOptionsByMappingId: toOptionsByMappingId(
      candidate.candidateFacilityOptionsByMappingId,
      toCandidateOptions
    )
  };
}

function toWarehouseLocationStrategyInputReferences(value: unknown): SupplyChainDesignWarehouseLocationStrategyRunSummary["inputReferences"] {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const shipments = toSelectedInputReference(candidate.shipments);
  if (!shipments) return null;
  const maxRegions = Number(candidate.maxRegions);
  return {
    shipments,
    maxRegions: maxRegions === 1 || maxRegions === 2 || maxRegions === 3 ? maxRegions : 1,
    weightingMethod: String(candidate.weightingMethod ?? "SHIPMENTS_REPRESENTED"),
    countryScope: String(candidate.countryScope ?? "ALL"),
    reportFingerprint: typeof candidate.reportFingerprint === "string" ? candidate.reportFingerprint : undefined
  };
}

function toWarehouseLocationStrategyResult(value: unknown): SupplyChainDesignWarehouseLocationStrategyRunSummary["resultSummary"] {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return candidate.resultVersion === WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION ||
    candidate.resultVersion === "WAREHOUSE_LOCATION_STRATEGY_V2" ||
    candidate.resultVersion === "WAREHOUSE_LOCATION_STRATEGY_V3" ||
    candidate.resultVersion === "WAREHOUSE_LOCATION_STRATEGY_V4" ||
    candidate.resultVersion === "WAREHOUSE_LOCATION_STRATEGY_V5" ||
    candidate.resultVersion === "WAREHOUSE_LOCATION_STRATEGY_V6" ||
    candidate.resultVersion === "WAREHOUSE_LOCATION_STRATEGY_V7" ||
    candidate.resultVersion === "WAREHOUSE_LOCATION_STRATEGY_V8"
    ? (value as SupplyChainDesignWarehouseLocationStrategyRunSummary["resultSummary"])
    : null;
}

function isWarehouseLocationStrategyResult(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const resultVersion = (value as Record<string, unknown>).resultVersion;
  return typeof resultVersion === "string" && resultVersion.startsWith("WAREHOUSE_LOCATION_STRATEGY_");
}

function isWarehouseCostComparisonResult(value: unknown) {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>).resultVersion === WAREHOUSE_COST_COMPARISON_RESULT_VERSION;
}

function toModel02ProofResult(value: unknown): SupplyChainDesignModel02ProofResultSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const facilitySummary = toScenarioFacilitySummary(candidate.facilitySummary);
  const selectedFacilityIds = toStringArray(candidate.selectedFacilityIds);
  const selectedExistingFacilityIds = toStringArray(candidate.selectedExistingFacilityIds);
  const selectedCandidateFacilityIds = toStringArray(candidate.selectedCandidateFacilityIds);
  return {
    scenarioName: String(candidate.scenarioName ?? ""),
    baselineRunId: String(candidate.baselineRunId ?? ""),
    optimizerType: typeof candidate.optimizerType === "string" ? candidate.optimizerType : null,
    combinationsEvaluated: typeof candidate.combinationsEvaluated === "number" ? candidate.combinationsEvaluated : null,
    feasibleCombinations: typeof candidate.feasibleCombinations === "number" ? candidate.feasibleCombinations : null,
    mandatoryExistingFacilityIds: toStringArray(candidate.mandatoryExistingFacilityIds),
    permittedExistingFacilityIds: toStringArray(candidate.permittedExistingFacilityIds),
    permittedCandidateFacilityIds: toStringArray(candidate.permittedCandidateFacilityIds),
    prohibitedCandidateFacilityIds: toStringArray(candidate.prohibitedCandidateFacilityIds),
    minimumOpenFacilities: typeof candidate.minimumOpenFacilities === "number" ? candidate.minimumOpenFacilities : null,
    maximumOpenFacilities: typeof candidate.maximumOpenFacilities === "number" ? candidate.maximumOpenFacilities : null,
    selectedExistingFacilityIds:
      selectedExistingFacilityIds.length > 0
        ? selectedExistingFacilityIds
        : facilitySummary.filter((facility) => facility.facilityKind === "EXISTING").map((facility) => facility.facilityId),
    selectedCandidateFacilityIds:
      selectedCandidateFacilityIds.length > 0
        ? selectedCandidateFacilityIds
        : facilitySummary.filter((facility) => facility.facilityKind === "CANDIDATE").map((facility) => facility.facilityId),
    closedExistingFacilityIds: toStringArray(candidate.closedExistingFacilityIds),
    unselectedCandidateFacilityIds: toStringArray(candidate.unselectedCandidateFacilityIds),
    selectedFacilityIds,
    enforceCapacity: Boolean(candidate.enforceCapacity),
    customersAllocated: Number(candidate.customersAllocated ?? 0),
    customersUnallocated: Number(candidate.customersUnallocated ?? 0),
    historicalShipmentCount: typeof candidate.historicalShipmentCount === "number" ? candidate.historicalShipmentCount : null,
    assignedShipmentCount: typeof candidate.assignedShipmentCount === "number" ? candidate.assignedShipmentCount : null,
    unallocatedShipmentCount: typeof candidate.unallocatedShipmentCount === "number" ? candidate.unallocatedShipmentCount : null,
    totalFiniteCapacity: typeof candidate.totalFiniteCapacity === "number" ? candidate.totalFiniteCapacity : null,
    facilitiesNearCapacityOrFull:
      typeof candidate.facilitiesNearCapacityOrFull === "number" ? candidate.facilitiesNearCapacityOrFull : null,
    highestFacilityUtilization:
      typeof candidate.highestFacilityUtilization === "number" ? candidate.highestFacilityUtilization : null,
    fullFacilityCount: typeof candidate.fullFacilityCount === "number" ? candidate.fullFacilityCount : null,
    baselineObservedCost: Number(candidate.baselineObservedCost ?? 0),
    proposedTotalTransportationCost: Number(candidate.proposedTotalTransportationCost ?? 0),
    selectedCandidateAnnualFixedCost: Number(candidate.selectedCandidateAnnualFixedCost ?? 0),
    retainedExistingFacilityOperatingCost: Number(candidate.retainedExistingFacilityOperatingCost ?? 0),
    proposedObservedAnnualCost: Number(candidate.proposedObservedAnnualCost ?? 0),
    annualCostDifference: Number(candidate.annualCostDifference ?? 0),
    percentageDifference: typeof candidate.percentageDifference === "number" ? candidate.percentageDifference : null,
    customerAssignments: toCustomerAssignments(candidate.customerAssignments),
    facilitySummary,
    unallocatedCustomerIds: toStringArray(candidate.unallocatedCustomerIds),
    missingScenarioLaneCosts: toMissingLaneCosts(candidate.missingScenarioLaneCosts),
    unmatchedFacilityIds: toStringArray(candidate.unmatchedFacilityIds),
    unmatchedCustomerIds: toStringArray(candidate.unmatchedCustomerIds),
    deferredValidation: toStringArray(candidate.deferredValidation),
    alternatives: toOptimizerAlternatives(candidate.alternatives),
    optimizationExceptions: toOptimizationExceptions(candidate.optimizationExceptions),
    optimizerAudit: toOptimizerAudit(candidate.optimizerAudit),
    solverMetadata: toSolverMetadata(candidate.solverMetadata)
  };
}

function toInputSelection(value: unknown): SupplyChainDesignModel01ProofInputSelection | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const facilities = toSelectedInputReference(candidate.facilities);
  const shipments = toSelectedInputReference(candidate.shipments);
  const inventory = candidate.inventory ? toSelectedInputReference(candidate.inventory) : null;
  const facilityCosts = candidate.facilityCosts ? toSelectedInputReference(candidate.facilityCosts) : null;
  const customers = candidate.customers ? toSelectedInputReference(candidate.customers) : null;

  return facilities && shipments ? { facilities, shipments, inventory, facilityCosts, customers } : null;
}

function toSelectedInputReference(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  return {
    fileId: String(candidate.fileId ?? ""),
    fileName: String(candidate.fileName ?? "Unknown file"),
    mappingId: String(candidate.mappingId ?? ""),
    mappingUpdatedAt: String(candidate.mappingUpdatedAt ?? ""),
    candidateFiles: toCandidateFiles(candidate.candidateFiles)
  };
}

function toCandidateFiles(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const candidate = item as Record<string, unknown>;
    return {
      fileId: String(candidate.fileId ?? ""),
      fileName: String(candidate.fileName ?? "Unknown file"),
      mappingId: String(candidate.mappingId ?? ""),
      mappingUpdatedAt: String(candidate.mappingUpdatedAt ?? ""),
      selected: Boolean(candidate.selected)
    };
  });
}

function toModel01ProofResult(value: unknown): SupplyChainDesignModel01ProofResultSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  return {
    facilityCount: Number(candidate.facilityCount ?? 0),
    shipmentCount: Number(candidate.shipmentCount ?? 0),
    hasTransportationCost: Boolean(candidate.hasTransportationCost),
    totalTransportationCost:
      typeof candidate.totalTransportationCost === "number" ? candidate.totalTransportationCost : null,
    shipmentCountByOrigin: toOriginCounts(candidate.shipmentCountByOrigin),
    transportationCostByOrigin: Array.isArray(candidate.transportationCostByOrigin)
      ? toOriginCosts(candidate.transportationCostByOrigin)
      : null,
    unmatchedShipmentOriginIds: toStringArray(candidate.unmatchedShipmentOriginIds),
    hasInventory: Boolean(candidate.hasInventory),
    inventoryQuantity: typeof candidate.inventoryQuantity === "number" ? candidate.inventoryQuantity : null,
    inventoryQuantityByFacility: Array.isArray(candidate.inventoryQuantityByFacility)
      ? toInventoryQuantities(candidate.inventoryQuantityByFacility)
      : null,
    hasInventoryValue: Boolean(candidate.hasInventoryValue),
    inventoryValue: typeof candidate.inventoryValue === "number" ? candidate.inventoryValue : null,
    inventoryValueByFacility: Array.isArray(candidate.inventoryValueByFacility)
      ? toInventoryValues(candidate.inventoryValueByFacility)
      : null,
    unmatchedInventoryFacilityIds: toStringArray(candidate.unmatchedInventoryFacilityIds),
    hasFacilityCosts: Boolean(candidate.hasFacilityCosts),
    totalFacilityOperatingCost:
      typeof candidate.totalFacilityOperatingCost === "number" ? candidate.totalFacilityOperatingCost : null,
    facilityOperatingCostByFacility: Array.isArray(candidate.facilityOperatingCostByFacility)
      ? toFacilityOperatingCosts(candidate.facilityOperatingCostByFacility)
      : null,
    facilityOperatingCostByCategory: Array.isArray(candidate.facilityOperatingCostByCategory)
      ? toFacilityCostCategories(candidate.facilityOperatingCostByCategory)
      : null,
    unmatchedFacilityCostFacilityIds: toStringArray(candidate.unmatchedFacilityCostFacilityIds),
    hasCustomers: Boolean(candidate.hasCustomers),
    customerCount: typeof candidate.customerCount === "number" ? candidate.customerCount : null,
    shipmentCountByDestination: Array.isArray(candidate.shipmentCountByDestination)
      ? toDestinationCounts(candidate.shipmentCountByDestination)
      : null,
    transportationCostByDestination: Array.isArray(candidate.transportationCostByDestination)
      ? toDestinationCosts(candidate.transportationCostByDestination)
      : null,
    laneShipmentCounts: Array.isArray(candidate.laneShipmentCounts) ? toLaneCounts(candidate.laneShipmentCounts) : null,
    transportationCostByLane: Array.isArray(candidate.transportationCostByLane)
      ? toLaneCosts(candidate.transportationCostByLane)
      : null,
    unmatchedShipmentDestinationIds: toStringArray(candidate.unmatchedShipmentDestinationIds),
    hasCustomerDemand: Boolean(candidate.hasCustomerDemand),
    totalAnnualCustomerDemand:
      typeof candidate.totalAnnualCustomerDemand === "number" ? candidate.totalAnnualCustomerDemand : null,
    annualDemandByCustomer: Array.isArray(candidate.annualDemandByCustomer)
      ? toCustomerDemand(candidate.annualDemandByCustomer)
      : null,
    hasServiceDays: Boolean(candidate.hasServiceDays),
    averageServiceDays: typeof candidate.averageServiceDays === "number" ? candidate.averageServiceDays : null,
    averageServiceDaysByDestination: Array.isArray(candidate.averageServiceDaysByDestination)
      ? toDestinationAverages(candidate.averageServiceDaysByDestination)
      : null,
    averageServiceDaysByLane: Array.isArray(candidate.averageServiceDaysByLane)
      ? toLaneAverages(candidate.averageServiceDaysByLane)
      : null,
    networkLanes: Array.isArray(candidate.networkLanes) ? toNetworkLanes(candidate.networkLanes) : null,
    facilitySummary: toFacilitySummary(candidate.facilitySummary),
    analysisLevels: Array.isArray(candidate.analysisLevels) ? toAnalysisLevels(candidate.analysisLevels) : undefined,
    facilityDataWarnings: toStringArray(candidate.facilityDataWarnings),
    volumeSummary: toVolumeSummary(candidate.volumeSummary),
    currencyWarnings: toStringArray(candidate.currencyWarnings),
    transportationCostByCurrency: toCurrencyCosts(candidate.transportationCostByCurrency, "transportationCost"),
    facilityCostByCurrency: toCurrencyCosts(candidate.facilityCostByCurrency, "facilityOperatingCost"),
    observedNetworkCostByCurrency: toCurrencyCosts(candidate.observedNetworkCostByCurrency, "observedCost"),
    snapshotPalletUtilization: toSnapshotPalletUtilization(candidate.snapshotPalletUtilization),
    modeSummary: toModeSummary(candidate.modeSummary),
    serviceLevelSummary: toServiceLevelSummary(candidate.serviceLevelSummary),
    skuSummary: toSkuSummary(candidate.skuSummary),
    deferredValidation: toStringArray(candidate.deferredValidation)
  };
}

function toOriginCounts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    originFacilityId: String((item as Record<string, unknown>).originFacilityId ?? ""),
    shipmentCount: Number((item as Record<string, unknown>).shipmentCount ?? 0)
  }));
}

function toOriginCosts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    originFacilityId: String((item as Record<string, unknown>).originFacilityId ?? ""),
    transportationCost: Number((item as Record<string, unknown>).transportationCost ?? 0)
  }));
}

function toInventoryQuantities(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    facilityId: String((item as Record<string, unknown>).facilityId ?? ""),
    inventoryQuantity: Number((item as Record<string, unknown>).inventoryQuantity ?? 0)
  }));
}

function toInventoryValues(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    facilityId: String((item as Record<string, unknown>).facilityId ?? ""),
    inventoryValue: Number((item as Record<string, unknown>).inventoryValue ?? 0)
  }));
}

function toFacilityOperatingCosts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    facilityId: String((item as Record<string, unknown>).facilityId ?? ""),
    facilityOperatingCost: Number((item as Record<string, unknown>).facilityOperatingCost ?? 0)
  }));
}

function toFacilityCostCategories(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    costCategory: String((item as Record<string, unknown>).costCategory ?? ""),
    facilityOperatingCost: Number((item as Record<string, unknown>).facilityOperatingCost ?? 0)
  }));
}

function toDestinationCounts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    destinationId: String((item as Record<string, unknown>).destinationId ?? ""),
    shipmentCount: Number((item as Record<string, unknown>).shipmentCount ?? 0)
  }));
}

function toDestinationCosts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    destinationId: String((item as Record<string, unknown>).destinationId ?? ""),
    transportationCost: Number((item as Record<string, unknown>).transportationCost ?? 0)
  }));
}

function toLaneCounts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      originFacilityId: String(row.originFacilityId ?? ""),
      destinationId: String(row.destinationId ?? ""),
      shipmentCount: Number(row.shipmentCount ?? 0)
    };
  });
}

function toLaneCosts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      originFacilityId: String(row.originFacilityId ?? ""),
      destinationId: String(row.destinationId ?? ""),
      transportationCost: Number(row.transportationCost ?? 0)
    };
  });
}

function toCustomerDemand(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    customerId: String((item as Record<string, unknown>).customerId ?? ""),
    annualDemand: Number((item as Record<string, unknown>).annualDemand ?? 0)
  }));
}

function toDestinationAverages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => ({
    destinationId: String((item as Record<string, unknown>).destinationId ?? ""),
    averageServiceDays: Number((item as Record<string, unknown>).averageServiceDays ?? 0)
  }));
}

function toLaneAverages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      originFacilityId: String(row.originFacilityId ?? ""),
      destinationId: String(row.destinationId ?? ""),
      averageServiceDays: Number(row.averageServiceDays ?? 0)
    };
  });
}

function toNetworkLanes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      originFacilityId: String(row.originFacilityId ?? ""),
      originFacilityName: String(row.originFacilityName ?? ""),
      destinationId: String(row.destinationId ?? ""),
      customerName: typeof row.customerName === "string" ? row.customerName : null,
      shipmentCount: Number(row.shipmentCount ?? 0),
      transportationCost: typeof row.transportationCost === "number" ? row.transportationCost : null,
      averageServiceDays: typeof row.averageServiceDays === "number" ? row.averageServiceDays : null
    };
  });
}

function toCandidateOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      facilityId: String(row.facilityId ?? ""),
      facilityName: String(row.facilityName ?? ""),
      annualFixedCost: Number(row.annualFixedCost ?? 0),
      capacity: typeof row.capacity === "number" ? row.capacity : null
    };
  });
}

function toExistingOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      facilityId: String(row.facilityId ?? ""),
      facilityName: String(row.facilityName ?? ""),
      capacity: typeof row.capacity === "number" ? row.capacity : null
    };
  });
}

function toOptionsByMappingId<TOption>(value: unknown, parseOptions: (value: unknown) => TOption[]) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      mappingId: String(row.mappingId ?? ""),
      options: parseOptions(row.options)
    };
  });
}

function toCustomerAssignments(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      customerId: String(row.customerId ?? ""),
      customerName: String(row.customerName ?? ""),
      historicalShipmentCount: Number(row.historicalShipmentCount ?? 0),
      assignedFacilityId: typeof row.assignedFacilityId === "string" ? row.assignedFacilityId : null,
      assignedFacilityName: typeof row.assignedFacilityName === "string" ? row.assignedFacilityName : null,
      assignedShipmentQuantity: Number(row.assignedShipmentQuantity ?? row.historicalShipmentCount ?? 0),
      costPerShipment: typeof row.costPerShipment === "number" ? row.costPerShipment : null,
      proposedAnnualTransportationCost:
        typeof row.proposedAnnualTransportationCost === "number" ? row.proposedAnnualTransportationCost : null,
      remainingUnallocatedShipmentQuantity: Number(row.remainingUnallocatedShipmentQuantity ?? 0),
      serviceDays: typeof row.serviceDays === "number" ? row.serviceDays : null,
      allocationStatus: toModel02AllocationStatus(row.allocationStatus)
    };
  });
}

function toScenarioFacilitySummary(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      facilityId: String(row.facilityId ?? ""),
      facilityName: String(row.facilityName ?? ""),
      facilityKind: row.facilityKind === "CANDIDATE" ? "CANDIDATE" : "EXISTING",
      assignedCustomers: Number(row.assignedCustomers ?? 0),
      assignedShipments: Number(row.assignedShipments ?? 0),
      transportationCost: Number(row.transportationCost ?? 0),
      fixedOrOperatingCost: Number(row.fixedOrOperatingCost ?? 0),
      proposedObservedCost: Number(row.proposedObservedCost ?? 0),
      capacity: typeof row.capacity === "number" ? row.capacity : null,
      remainingCapacity: typeof row.remainingCapacity === "number" ? row.remainingCapacity : null,
      utilizationPercent: typeof row.utilizationPercent === "number" ? row.utilizationPercent : null,
      capacityStatus: toCapacityStatus(row.capacityStatus)
    };
  });
}

function toModel02AllocationStatus(value: unknown) {
  return value === "FULLY_ALLOCATED" ||
    value === "SPLIT_ACROSS_FACILITIES" ||
    value === "PARTIALLY_ALLOCATED" ||
    value === "UNALLOCATED"
    ? value
    : value === "ALLOCATED"
      ? "FULLY_ALLOCATED"
      : "UNALLOCATED";
}

function toCapacityStatus(value: unknown) {
  return value === "UNLIMITED" || value === "AVAILABLE" || value === "NEAR_CAPACITY" || value === "FULL"
    ? value
    : "NOT_AVAILABLE";
}

function toMissingLaneCosts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      facilityId: String(row.facilityId ?? ""),
      destinationId: String(row.destinationId ?? "")
    };
  });
}

function toOptimizerAlternatives(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      rank: Number(row.rank ?? 0),
      openFacilityIds: toStringArray(row.openFacilityIds),
      unallocatedShipmentCount: Number(row.unallocatedShipmentCount ?? 0),
      proposedTotalTransportationCost: Number(row.proposedTotalTransportationCost ?? 0),
      facilityCost: Number(row.facilityCost ?? 0),
      proposedObservedAnnualCost: Number(row.proposedObservedAnnualCost ?? 0),
      differenceFromRecommended: Number(row.differenceFromRecommended ?? 0)
    };
  });
}

function toOptimizationExceptions(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  return {
    unallocatedShipmentCount: Number(candidate.unallocatedShipmentCount ?? 0),
    customersWithNoUsableLane: toStringArray(candidate.customersWithNoUsableLane),
    missingScenarioLaneCosts: toMissingLaneCosts(candidate.missingScenarioLaneCosts),
    capacityShortfalls: toStringArray(candidate.capacityShortfalls),
    unmatchedFacilityIds: toStringArray(candidate.unmatchedFacilityIds),
    unmatchedCustomerIds: toStringArray(candidate.unmatchedCustomerIds)
  };
}

function toOptimizerAudit(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  return {
    baselineRunId: String(candidate.baselineRunId ?? ""),
    baselineRunCreatedAt: typeof candidate.baselineRunCreatedAt === "string" ? candidate.baselineRunCreatedAt : null,
    baselineObservedCost: Number(candidate.baselineObservedCost ?? 0),
    inputFiles: toOptimizerInputFiles(candidate.inputFiles),
    selectedMappings: toOptimizerSelectedMappings(candidate.selectedMappings),
    facilityCostEvidence: toOptimizerFacilityCostEvidence(candidate.facilityCostEvidence),
    laneCostEvidence: toOptimizerLaneCostEvidence(candidate.laneCostEvidence),
    rankingExplanations: toOptimizerRankingExplanations(candidate.rankingExplanations),
    consistencyChecks: toOptimizerConsistencyChecks(candidate.consistencyChecks)
  };
}

function toOptimizerInputFiles(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      tableType: String(row.tableType ?? ""),
      fileId: String(row.fileId ?? ""),
      fileName: String(row.fileName ?? "Unknown file"),
      mappingId: String(row.mappingId ?? "")
    };
  });
}

function toOptimizerSelectedMappings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      tableType: String(row.tableType ?? ""),
      mappingId: String(row.mappingId ?? ""),
      fields: Array.isArray(row.fields)
        ? row.fields.map((field) => {
            const candidate = field as Record<string, unknown>;
            return {
              standardField: String(candidate.standardField ?? ""),
              sourceColumn: typeof candidate.sourceColumn === "string" ? candidate.sourceColumn : null
            };
          })
        : []
    };
  });
}

function toOptimizerFacilityCostEvidence(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      facilityId: String(row.facilityId ?? ""),
      facilityKind: row.facilityKind === "CANDIDATE" ? "CANDIDATE" : "EXISTING",
      costUsed: Number(row.costUsed ?? 0),
      sourceFileName: String(row.sourceFileName ?? "Unknown file"),
      sourceValue: String(row.sourceValue ?? ""),
      sourceRow: typeof row.sourceRow === "number" ? row.sourceRow : null,
      openStatus: row.openStatus === "OPEN" ? "OPEN" : "CLOSED"
    };
  });
}

function toOptimizerLaneCostEvidence(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      customerId: String(row.customerId ?? ""),
      customerName: String(row.customerName ?? ""),
      selectedFacilityId: typeof row.selectedFacilityId === "string" ? row.selectedFacilityId : null,
      costPerShipment: typeof row.costPerShipment === "number" ? row.costPerShipment : null,
      costSource: toLaneCostSource(row.costSource),
      historicalShipmentQuantity: Number(row.historicalShipmentQuantity ?? 0),
      resultingTransportationCost:
        typeof row.resultingTransportationCost === "number" ? row.resultingTransportationCost : null,
      otherOpenFacilities: Array.isArray(row.otherOpenFacilities)
        ? row.otherOpenFacilities.map((facility) => {
            const candidate = facility as Record<string, unknown>;
            return {
              facilityId: String(candidate.facilityId ?? ""),
              costPerShipment: typeof candidate.costPerShipment === "number" ? candidate.costPerShipment : null,
              costSource: toLaneCostSource(candidate.costSource),
              capacityPreventedAssignment: Boolean(candidate.capacityPreventedAssignment)
            };
          })
        : []
    };
  });
}

function toLaneCostSource(value: unknown) {
  return value === "UPLOADED_SCENARIO_LANE_COST" ||
    value === "HISTORICAL_EXISTING_LANE_AVERAGE" ||
    value === "MISSING_RATE"
    ? value
    : "MISSING_RATE";
}

function toOptimizerRankingExplanations(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      rank: Number(row.rank ?? 0),
      alternativeOpenFacilityIds: toStringArray(row.alternativeOpenFacilityIds),
      reason: String(row.reason ?? "")
    };
  });
}

function toOptimizerConsistencyChecks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      label: String(row.label ?? ""),
      passed: Boolean(row.passed),
      detail: String(row.detail ?? "")
    };
  });
}

function toSolverMetadata(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const problemSize = candidate.problemSize as Record<string, unknown> | null;
  return {
    solverType: candidate.solverType === "MATHEMATICAL_PROGRAMMING" ? "MATHEMATICAL_PROGRAMMING" : "EXACT_ENUMERATION",
    solverName: String(candidate.solverName ?? ""),
    solverVersion: String(candidate.solverVersion ?? ""),
    solverStatus:
      candidate.solverStatus === "FAILED" || candidate.solverStatus === "NOT_CONFIGURED"
        ? candidate.solverStatus
        : "SUCCESS",
    solveDurationMs: Number(candidate.solveDurationMs ?? 0),
    problemSize: {
      facilityCount: Number(problemSize?.facilityCount ?? 0),
      customerCount: Number(problemSize?.customerCount ?? 0),
      validLaneCount: Number(problemSize?.validLaneCount ?? 0),
      estimatedEnumerationCombinationCount: Number(problemSize?.estimatedEnumerationCombinationCount ?? 0)
    },
    objectiveValue: typeof candidate.objectiveValue === "number" ? candidate.objectiveValue : null,
    verificationStatus:
      candidate.verificationStatus === "FAILED" || candidate.verificationStatus === "NOT_RUN"
        ? candidate.verificationStatus
        : "PASSED",
    warnings: toStringArray(candidate.warnings),
    diagnostics: toStringArray(candidate.diagnostics)
  };
}

function toFacilitySummary(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      facilityId: String(row.facilityId ?? ""),
      facilityName: String(row.facilityName ?? ""),
      facilityType: typeof row.facilityType === "string" ? row.facilityType : null,
      shipmentCount: Number(row.shipmentCount ?? 0),
      pallets: typeof row.pallets === "number" ? row.pallets : null,
      units: typeof row.units === "number" ? row.units : null,
      weight: typeof row.weight === "number" ? row.weight : null,
      transportationCost: typeof row.transportationCost === "number" ? row.transportationCost : null,
      inventoryQuantity: typeof row.inventoryQuantity === "number" ? row.inventoryQuantity : null,
      inventoryValue: typeof row.inventoryValue === "number" ? row.inventoryValue : null,
      facilityOperatingCost: typeof row.facilityOperatingCost === "number" ? row.facilityOperatingCost : null,
      observedCost: typeof row.observedCost === "number" ? row.observedCost : null
    };
  });
}

function toAnalysisLevels(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      label: String(row.label ?? ""),
      status: row.status === "AVAILABLE" ? ("AVAILABLE" as const) : ("NOT_CALCULATED" as const),
      explanation: String(row.explanation ?? "")
    };
  });
}

function toVolumeSummary(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const row = value as Record<string, unknown>;
  return {
    totalShipments: Number(row.totalShipments ?? 0),
    totalPallets: typeof row.totalPallets === "number" ? row.totalPallets : null,
    totalUnits: typeof row.totalUnits === "number" ? row.totalUnits : null,
    totalWeight: typeof row.totalWeight === "number" ? row.totalWeight : null,
    averagePalletsPerShipment: typeof row.averagePalletsPerShipment === "number" ? row.averagePalletsPerShipment : null,
    averageUnitsPerShipment: typeof row.averageUnitsPerShipment === "number" ? row.averageUnitsPerShipment : null,
    averageWeightPerShipment: typeof row.averageWeightPerShipment === "number" ? row.averageWeightPerShipment : null,
    transportationCostPerShipment: typeof row.transportationCostPerShipment === "number" ? row.transportationCostPerShipment : null,
    transportationCostPerPallet: typeof row.transportationCostPerPallet === "number" ? row.transportationCostPerPallet : null,
    transportationCostPerUnit: typeof row.transportationCostPerUnit === "number" ? row.transportationCostPerUnit : null,
    transportationCostPerPound: typeof row.transportationCostPerPound === "number" ? row.transportationCostPerPound : null
  };
}

function toCurrencyCosts(value: unknown, amountKey: string) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      currency: String(row.currency ?? ""),
      [amountKey]: Number(row[amountKey] ?? 0)
    };
  });
}

function toSnapshotPalletUtilization(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      facilityId: String(row.facilityId ?? ""),
      facilityName: String(row.facilityName ?? ""),
      facilityType: typeof row.facilityType === "string" ? row.facilityType : null,
      capacityPalletPositions: Number(row.capacityPalletPositions ?? 0),
      inventoryPallets: Number(row.inventoryPallets ?? 0),
      snapshotDate: String(row.snapshotDate ?? ""),
      utilizationPercent: Number(row.utilizationPercent ?? 0),
      latest: Boolean(row.latest),
      warning: typeof row.warning === "string" ? row.warning : null
    };
  });
}

function toModeSummary(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      mode: String(row.mode ?? ""),
      shipmentCount: Number(row.shipmentCount ?? 0),
      transportationCost: typeof row.transportationCost === "number" ? row.transportationCost : null
    };
  });
}

function toServiceLevelSummary(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      serviceLevel: String(row.serviceLevel ?? ""),
      shipmentCount: Number(row.shipmentCount ?? 0)
    };
  });
}

function toSkuSummary(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  return {
    distinctSkuCount: Number(row.distinctSkuCount ?? 0),
    shipmentCountBySku: Array.isArray(row.shipmentCountBySku)
      ? row.shipmentCountBySku.map((item) => {
          const skuRow = item as Record<string, unknown>;
          return {
            itemId: String(skuRow.itemId ?? ""),
            shipmentCount: Number(skuRow.shipmentCount ?? 0)
          };
        })
      : []
  };
}

function toFieldMappings(value: unknown): SupplyChainDesignFieldMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Record<string, unknown>;
      const requirement = candidate.requirement === "OPTIONAL" ? "OPTIONAL" : "REQUIRED";

      return {
        standardField: String(candidate.standardField ?? ""),
        sourceColumn: typeof candidate.sourceColumn === "string" ? candidate.sourceColumn : null,
        requirement
      };
    })
    .filter((item): item is SupplyChainDesignFieldMapping => Boolean(item?.standardField));
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function toStringMatrix(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((row) => (Array.isArray(row) ? row.map((item) => String(item)) : []));
}

function toCandidateFacilityOptions(fileBytes: Buffer | undefined, fieldMappings: SupplyChainDesignFieldMapping[]) {
  if (!fileBytes) {
    return [];
  }

  const rows = parseCsvRows(fileBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const idColumn = getSourceColumn(fieldMappings, "candidate_facility_id");
  const nameColumn = getSourceColumn(fieldMappings, "candidate_facility_name");
  const fixedCostColumn =
    getSourceColumn(fieldMappings, "annual_facility_warehouse_cost") ?? getSourceColumn(fieldMappings, "annual_fixed_cost");
  const capacityColumn = getSourceColumn(fieldMappings, "pallet_capacity") ?? getSourceColumn(fieldMappings, "capacity");
  const idIndex = idColumn ? headers.indexOf(idColumn) : -1;
  const nameIndex = nameColumn ? headers.indexOf(nameColumn) : -1;
  const fixedCostIndex = fixedCostColumn ? headers.indexOf(fixedCostColumn) : -1;
  const capacityIndex = capacityColumn ? headers.indexOf(capacityColumn) : -1;

  if (idIndex === -1 || nameIndex === -1) {
    return [];
  }

  return rows
    .slice(1)
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => ({
      facilityId: row[idIndex]?.trim() ?? "",
      facilityName: row[nameIndex]?.trim() ?? "",
      annualFixedCost:
        fixedCostIndex >= 0 && row[fixedCostIndex]?.trim()
          ? Number((row[fixedCostIndex] ?? "0").replace(/[$,]/g, ""))
          : 0,
      capacity:
        capacityIndex >= 0 && row[capacityIndex]?.trim()
          ? Number((row[capacityIndex] ?? "0").replace(/[$,]/g, ""))
          : null
    }))
    .filter((row) => row.facilityId && row.facilityName);
}

function toExistingFacilityOptions(fileBytes: Buffer | undefined, fieldMappings: SupplyChainDesignFieldMapping[]) {
  if (!fileBytes) {
    return [];
  }

  const rows = parseCsvRows(fileBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const idColumn = getSourceColumn(fieldMappings, "facility_id");
  const nameColumn = getSourceColumn(fieldMappings, "facility_name");
  const annualCostColumn =
    getSourceColumn(fieldMappings, "annual_facility_warehouse_cost") ?? getSourceColumn(fieldMappings, "annual_fixed_cost");
  const capacityColumn = getSourceColumn(fieldMappings, "pallet_capacity") ?? getSourceColumn(fieldMappings, "capacity");
  const idIndex = idColumn ? headers.indexOf(idColumn) : -1;
  const nameIndex = nameColumn ? headers.indexOf(nameColumn) : -1;
  const annualCostIndex = annualCostColumn ? headers.indexOf(annualCostColumn) : -1;
  const capacityIndex = capacityColumn ? headers.indexOf(capacityColumn) : -1;

  if (idIndex === -1 || nameIndex === -1) {
    return [];
  }

  return rows
    .slice(1)
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => ({
      facilityId: row[idIndex]?.trim() ?? "",
      facilityName: row[nameIndex]?.trim() ?? "",
      annualFacilityCost:
        annualCostIndex >= 0 && row[annualCostIndex]?.trim()
          ? Number((row[annualCostIndex] ?? "0").replace(/[$,]/g, ""))
          : 0,
      capacity:
        capacityIndex >= 0 && row[capacityIndex]?.trim()
          ? Number((row[capacityIndex] ?? "0").replace(/[$,]/g, ""))
          : null
    }))
    .filter((row) => row.facilityId && row.facilityName);
}
