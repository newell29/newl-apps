"use server";

import { createHash } from "node:crypto";

import {
  JobStatus,
  ModuleKey,
  Prisma,
  SupplyChainDesignMappingStatus,
  SupplyChainDesignModelRunStatus,
  SupplyChainDesignScenarioStatus
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/server/db";
import { requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import {
  parseCsvRows,
  parseSupplyChainDesignCsvUpload,
  type ParsedSupplyChainDesignCsv
} from "@/modules/supply-chain-design/csv-intake";
import {
  getSupplyChainDesignMappingDefinition,
  getSupplyChainDesignTableLabel,
  isSupplyChainDesignTableType,
  recognizeSupplyChainDesignOfficialTemplate,
  type SupplyChainDesignTableTypeValue
} from "@/modules/supply-chain-design/mapping-definitions";
import { runSupplyChainDesignModel01Proof } from "@/modules/supply-chain-design/model-01-proof";
import { runSupplyChainDesignModel02Proof } from "@/modules/supply-chain-design/model-02-proof";
import {
  assertSupplyChainDesignModel02OptimizerConsistency,
  runSupplyChainDesignModel02Optimizer
} from "@/modules/supply-chain-design/model-02-optimizer";
import {
  prepareSupplyChainDesignCandidateLtlRateRequests,
  toSupplyChainDesignNetworkScenarioPreparedProfiles
} from "@/modules/supply-chain-design/candidate-ltl-rate-preparation";
import {
  createSupplyChainDesignLtlRateBatch,
  excludeSupplyChainDesignLtlRateRow,
  readSupplyChainDesignLtlBatchInput,
  runSupplyChainDesignLtlRateBatch,
  saveSupplyChainDesignManualLtlRate,
  SCDS_LTL_RATE_BATCH_JOB_TYPE,
  type SupplyChainDesignLtlComparisonSetup
} from "@/modules/supply-chain-design/ltl-rate-batches";
import { pickPreferredLiveSevenLAccount } from "@/modules/ltl-rate-portal/account-selection";
import { getLtlRatePortalAccounts } from "@/modules/ltl-rate-portal/queries";
import {
  normalizeSupplyChainDesignCandidateRatingOrigins,
  normalizeSupplyChainDesignCurrentFacilityRatingOrigins,
  type SupplyChainDesignRatingOrigin
} from "@/modules/supply-chain-design/rating-origins";
import {
  orchestrateSupplyChainDesignNetworkScenarioComparison,
  type SupplyChainDesignNetworkScenarioComparisonOrchestrationInput
} from "@/modules/supply-chain-design/network-scenario-comparison-orchestration";
import {
  deleteNetworkScenarioComparisonRun,
  getNetworkScenarioComparisonRun,
  type NetworkScenarioComparisonScenarioInput
} from "@/modules/supply-chain-design/network-scenario-comparison-persistence";
import { runSupplyChainDesignThreePlScreening } from "@/modules/supply-chain-design/three-pl-screening";
import { runSupplyChainDesignProviderComparison } from "@/modules/supply-chain-design/three-pl-provider-comparison";
import {
  CENSUS_ZCTA_2025_COORDINATE_SOURCE
} from "@/modules/supply-chain-design/reference-data/us-zip-centroids";
import {
  NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION
} from "@/modules/supply-chain-design/reference-data/logistics-market-catalogue";
import {
  WAREHOUSE_LOCATION_STRATEGY_CALCULATION_VERSION,
  WAREHOUSE_LOCATION_STRATEGY_INCREMENTAL_THRESHOLD,
  WAREHOUSE_LOCATION_STRATEGY_MIN_REGION_DEMAND_SHARE,
  WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION,
  runSupplyChainDesignWarehouseLocationStrategy,
  type WarehouseLocationStrategyCountryScope,
  type WarehouseLocationStrategyWeightingMethod
} from "@/modules/supply-chain-design/warehouse-location-strategy";
import {
  readWarehouseCostFacilityOptions,
  runWarehouseCostComparison,
  type WarehouseCostComparisonFacilityOption
} from "@/modules/supply-chain-design/warehouse-cost-comparison";
import {
  buildWarehouseCostProfilesFromPreparedRequests,
  readHistoricalShipmentWarehouseCostContractRows
} from "@/modules/supply-chain-design/warehouse-cost-data-contract";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLocationStrategyWeighting(value: string | null): WarehouseLocationStrategyWeightingMethod {
  return value === "PALLETS" ||
    value === "WEIGHT" ||
    value === "UNITS" ||
    value === "CURRENT_TRANSPORTATION_COST"
    ? value
    : "SHIPMENTS_REPRESENTED";
}

function normalizeLocationStrategyCountryScope(value: string | null): WarehouseLocationStrategyCountryScope {
  return value === "US" || value === "CA" || value === "SEPARATE_BY_COUNTRY" ? value : "ALL";
}

function parseOptionalLocationStrategyRate(value: string | null) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("CAD to USD conversion rate must be a plain positive number.");
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 5) {
    throw new Error("CAD to USD conversion rate must be greater than 0 and no more than 5.");
  }
  return parsed;
}

function createLocationStrategyReportFingerprint(input: {
  shipmentsMappingId: string;
  sourceFileSha256: string;
  mappingUpdatedAt: string;
  maxRegions: 1 | 2 | 3;
  weightingMethod: WarehouseLocationStrategyWeightingMethod;
  countryScope: WarehouseLocationStrategyCountryScope;
  cadToUsdRate?: number | null;
}) {
  return sha256(JSON.stringify({
    resultVersion: WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION,
    calculationVersion: WAREHOUSE_LOCATION_STRATEGY_CALCULATION_VERSION,
    shipmentsMappingId: input.shipmentsMappingId,
    sourceFileSha256: input.sourceFileSha256,
    mappingUpdatedAt: input.mappingUpdatedAt,
    maxRegions: input.maxRegions,
    weightingMethod: input.weightingMethod,
    countryScope: input.countryScope,
    cadToUsdRate: input.weightingMethod === "CURRENT_TRANSPORTATION_COST" ? input.cadToUsdRate ?? null : null,
    assumptions: {
      minimumIncrementalImprovement: WAREHOUSE_LOCATION_STRATEGY_INCREMENTAL_THRESHOLD,
      minimumSelectedDemandShare: WAREHOUSE_LOCATION_STRATEGY_MIN_REGION_DEMAND_SHARE
    },
    references: {
      zcta: CENSUS_ZCTA_2025_COORDINATE_SOURCE,
      logisticsMarkets: NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION
    }
  }));
}

function readLocationStrategyFingerprint(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const fingerprint = (value as Record<string, unknown>).reportFingerprint;
  return typeof fingerprint === "string" ? fingerprint : null;
}

function isCurrentLocationStrategyResult(value: unknown) {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).resultVersion === WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION
  );
}

function isLocationStrategyResult(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const resultVersion = (value as Record<string, unknown>).resultVersion;
  return typeof resultVersion === "string" && resultVersion.startsWith("WAREHOUSE_LOCATION_STRATEGY_");
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim();
}

function jsonReferencesId(value: unknown, id: string): boolean {
  if (!value) {
    return false;
  }
  if (typeof value === "string") {
    return value === id;
  }
  if (Array.isArray(value)) {
    return value.some((item) => jsonReferencesId(item, id));
  }
  if (typeof value === "object") {
    return Object.values(value).some((item) => jsonReferencesId(item, id));
  }
  return false;
}

async function countRunReferences(tenantId: string, projectId: string, id: string) {
  const [modelRuns, scenarios, screeningRuns, ltlRatePreparationRuns] = await Promise.all([
    prisma.supplyChainDesignModelRun.findMany({
      where: { tenantId, projectId },
      select: { inputReferences: true }
    }),
    prisma.supplyChainDesignScenario.findMany({
      where: { tenantId, projectId },
      select: { inputReferences: true }
    }),
    prisma.supplyChainDesignScreeningRun.findMany({
      where: { tenantId, projectId },
      select: { inputReferences: true }
    }),
    prisma.supplyChainDesignLtlRatePreparationRun.findMany({
      where: { tenantId, projectId },
      select: { inputReferences: true }
    })
  ]);

  return [...modelRuns, ...scenarios, ...screeningRuns, ...(ltlRatePreparationRuns ?? [])].filter((run) =>
    jsonReferencesId(run.inputReferences, id)
  ).length;
}

export async function createSupplyChainDesignProjectAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const name = text(formData, "name");

  if (!name) {
    throw new Error("Project name is required.");
  }

  const description = text(formData, "description");

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.supplyChainDesignProject.create({
      data: {
        tenantId: context.tenantId,
        name,
        description,
        createdByUserId: context.userId
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "supply-chain-design.project.created",
        entityType: "SupplyChainDesignProject",
        entityId: created.id,
        after: {
          moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN,
          projectId: created.id,
          name: created.name,
          description: created.description,
          status: created.status
        }
      }
    });

    return created;
  });

  revalidatePath("/supply-chain-design");
  redirect(`/supply-chain-design/${project.id}`);
}

export async function deleteSupplyChainDesignProjectAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const confirmed = formData.get("confirmDelete") === "on";
  if (!projectId) {
    return { ok: false, message: "Missing project ID." };
  }
  if (!confirmed) {
    return { ok: false, message: "Project deletion was not confirmed." };
  }

  try {
    const deleted = await prisma.supplyChainDesignProject.delete({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: projectId
        }
      }
    });
    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "supply-chain-design.project.deleted",
        entityType: "SupplyChainDesignProject",
        entityId: deleted.id,
        before: {
          moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN,
          projectId: deleted.id,
          name: deleted.name,
          status: deleted.status
        }
      }
    });
    revalidatePath("/supply-chain-design");
    return { ok: true, message: `${deleted.name} was deleted.` };
  } catch {
    return { ok: false, message: "Project could not be deleted for this project and tenant." };
  }
}

export async function deleteSupplyChainDesignProjectFormAction(formData: FormData): Promise<void> {
  await deleteSupplyChainDesignProjectAction(formData);
}

export type SupplyChainDesignUploadState = {
  ok: boolean;
  message: string;
};

export type SupplyChainDesignMappingState = {
  ok: boolean;
  message: string;
};

export type SupplyChainDesignModelRunState = {
  ok: boolean;
  message: string;
  runId?: string | null;
  runStatus?: string | null;
  requestTotal?: number | null;
  submittedNetworkScenarioComparison?: {
    shipmentsMappingId: string | null;
    facilitiesMappingId: string | null;
    candidateFacilitiesMappingId: string | null;
    scenarioAName: string;
    scenarioBName: string;
    scenarioAFacilityOptionIds: string[];
    scenarioBFacilityOptionIds: string[];
    cadToUsdRate: string | null;
  };
};

export type SupplyChainDesignScreeningRunState = {
  ok: boolean;
  message: string;
};

export type SupplyChainDesignCleanupState = {
  ok: boolean;
  message: string;
};

type SaveSupplyChainDesignMappingInput = {
  tenantId: string;
  projectId: string;
  fileId: string;
  tableType: SupplyChainDesignTableTypeValue;
  fieldMappings: SupplyChainDesignFieldMapping[];
  status: SupplyChainDesignMappingStatus;
  userId: string;
};

type AutomaticMappingSaveResult =
  | { ok: true; mapping: Awaited<ReturnType<typeof saveSupplyChainDesignMapping>> }
  | { ok: false; recognizedTableType: SupplyChainDesignTableTypeValue | null; reason?: string | null };

export async function uploadSupplyChainDesignProjectFilesAction(
  _previousState: SupplyChainDesignUploadState,
  formData: FormData
): Promise<SupplyChainDesignUploadState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  if (!projectId) {
    return { ok: false, message: "Missing project ID." };
  }

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

  if (!project) {
    return { ok: false, message: "Supply Chain Design project was not found." };
  }

  const files = formData.getAll("files").filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    return { ok: false, message: "Select at least one CSV file to upload." };
  }

  try {
    const parsedFiles: ParsedSupplyChainDesignCsv[] = [];
    const hashesInRequest = new Set<string>();

    for (const file of files) {
      const parsed = await parseSupplyChainDesignCsvUpload(file);
      if (hashesInRequest.has(parsed.contentHash)) {
        return { ok: false, message: `${parsed.safeFileName} duplicates another selected file.` };
      }
      hashesInRequest.add(parsed.contentHash);
      parsedFiles.push(parsed);
    }

    const sameNameFiles = await prisma.supplyChainDesignProjectFile.findMany({
      where: {
        tenantId: context.tenantId,
        projectId,
        originalFileName: {
          in: parsedFiles.map((file) => file.safeFileName)
        }
      },
      include: {
        mappings: true
      }
    });

    if (sameNameFiles.length > 0) {
      return {
        ok: false,
        message: `A file with this name already exists: ${sameNameFiles.map((file) => file.originalFileName).join(", ")}. Rename the file before uploading so existing project evidence is preserved.`
      };
    }

    const duplicate = await prisma.supplyChainDesignProjectFile.findFirst({
      where: {
        tenantId: context.tenantId,
        projectId,
        contentHash: {
          in: parsedFiles.map((file) => file.contentHash)
        }
      },
      select: {
        originalFileName: true
      }
    });

    if (duplicate) {
      return {
        ok: false,
        message: `Duplicate content was already uploaded as ${duplicate.originalFileName}.`
      };
    }

    let automaticallyMappedCount = 0;
    let failedAutomaticTableType: SupplyChainDesignTableTypeValue | null = null;
    let failedAutomaticReason: string | null = null;

    await prisma.$transaction(async (tx) => {
      for (const parsed of parsedFiles) {
        const created = await tx.supplyChainDesignProjectFile.create({
          data: {
            tenantId: context.tenantId,
            projectId,
            originalFileName: parsed.safeFileName,
            contentType: parsed.contentType,
            sizeBytes: parsed.sizeBytes,
            contentHash: parsed.contentHash,
            fileBytes: parsed.bytes,
            rowCount: parsed.rowCount,
            detectedHeaders: parsed.headers,
            previewRows: parsed.previewRows,
            uploadedByUserId: context.userId
          }
        });

        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "supply-chain-design.file.uploaded",
            entityType: "SupplyChainDesignProjectFile",
            entityId: created.id,
            after: {
              moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN,
              projectId,
              fileId: created.id,
              originalFileName: created.originalFileName,
              sizeBytes: created.sizeBytes,
              rowCount: created.rowCount,
              detectedHeaders: parsed.headers
            }
          }
        });
        const automaticMapping = await trySaveAutomaticMappingFromOfficialTemplate(tx, {
          tenantId: context.tenantId,
          projectId,
          fileId: created.id,
          userId: context.userId,
          headers: parsed.headers
        });
        if (automaticMapping.ok) {
          automaticallyMappedCount += 1;
        } else if (automaticMapping.recognizedTableType) {
          failedAutomaticTableType = automaticMapping.recognizedTableType;
          failedAutomaticReason = automaticMapping.reason ?? null;
        }
      }
    });

    revalidatePath(`/supply-chain-design/${projectId}`);
    if (failedAutomaticTableType) {
      return {
        ok: false,
        message: automaticMappingFailureMessage(failedAutomaticTableType, failedAutomaticReason)
      };
    }
    const autoMappedSuffix =
      automaticallyMappedCount > 0
        ? ` ${automaticallyMappedCount} file${automaticallyMappedCount === 1 ? " was" : "s were"} automatically mapped from a Newl template.`
        : "";
    return {
      ok: true,
      message: `${parsedFiles.length} CSV file${parsedFiles.length === 1 ? "" : "s"} uploaded.${autoMappedSuffix}`
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unable to upload CSV files."
    };
  }
}

async function trySaveAutomaticMappingFromOfficialTemplate(
  tx: Prisma.TransactionClient,
  {
    tenantId,
    projectId,
    fileId,
    userId,
    headers
  }: {
    tenantId: string;
    projectId: string;
    fileId: string;
    userId: string;
    headers: string[];
  }
): Promise<AutomaticMappingSaveResult> {
  const recognized = recognizeSupplyChainDesignOfficialTemplate(headers);
  if (!recognized) {
    return { ok: false, recognizedTableType: null };
  }

  try {
    const mapping = await saveSupplyChainDesignMapping(tx, {
      tenantId,
      projectId,
      fileId,
      tableType: recognized.tableType,
      fieldMappings: recognized.fieldMappings,
      status: SupplyChainDesignMappingStatus.DRAFT,
      userId
    });
    return { ok: true, mapping };
  } catch (error) {
    console.error("Supply Chain Design automatic mapping failed", {
      stage: "automatic-mapping-persistence",
      model: "SupplyChainDesignFileMapping",
      method: "upsert",
      where: {
        tenantId_fileId: {
          tenantId,
          fileId
        }
      },
      create: {
        tenantId,
        projectId,
        fileId,
        tableType: recognized.tableType,
        status: SupplyChainDesignMappingStatus.DRAFT,
        createdByUserId: userId,
        fieldMappingCount: recognized.fieldMappings.length
      },
      update: {
        tableType: recognized.tableType,
        status: SupplyChainDesignMappingStatus.DRAFT,
        createdByUserId: userId,
        fieldMappingCount: recognized.fieldMappings.length
      },
      fieldMappings: recognized.fieldMappings,
      error
    });
    return { ok: false, recognizedTableType: recognized.tableType, reason: safeAutomaticMappingFailureReason(error) };
  }
}

function automaticMappingFailureMessage(tableType: SupplyChainDesignTableTypeValue, reason: string | null) {
  return `The file was recognized as ${getSupplyChainDesignTableLabel(tableType)}, but its mapping could not be saved.${reason ? ` Reason: ${reason}` : ""}`;
}

function safeAutomaticMappingFailureReason(error: unknown) {
  if (!(error instanceof Error)) return null;
  const message = error.message.trim();
  if (!message) return null;
  if (message.includes("unknown standardField")) return message;
  if (message.includes("duplicate standardField")) return message;
  if (message.includes("duplicate sourceColumn")) return message;
  if (message.includes("requirement") && message.includes("does not match")) return message;
  if (message.includes("missing standardField") || message.includes("sourceColumn")) return message;
  return "Automatic mapping validation failed.";
}

async function saveSupplyChainDesignMapping(tx: Prisma.TransactionClient, input: SaveSupplyChainDesignMappingInput) {
  validateSupplyChainDesignMappingInput(input);
  return tx.supplyChainDesignFileMapping.upsert({
    where: {
      tenantId_fileId: {
        tenantId: input.tenantId,
        fileId: input.fileId
      }
    },
    create: {
      tenantId: input.tenantId,
      projectId: input.projectId,
      fileId: input.fileId,
      tableType: input.tableType,
      fieldMappings: input.fieldMappings,
      status: input.status,
      createdByUserId: input.userId
    },
    update: {
      tableType: input.tableType,
      fieldMappings: input.fieldMappings,
      status: input.status,
      createdByUserId: input.userId
    }
  });
}

function validateSupplyChainDesignMappingInput(input: SaveSupplyChainDesignMappingInput) {
  const definitionByField = new Map(getSupplyChainDesignMappingDefinition(input.tableType).map((field) => [field.field, field.requirement]));
  const seenStandardFields = new Set<string>();
  const seenSourceColumns = new Set<string>();

  for (const [index, field] of input.fieldMappings.entries()) {
    if (!field || typeof field.standardField !== "string" || !field.standardField.trim()) {
      throw new Error(`Invalid field mapping at index ${index}: missing standardField.`);
    }
    if (seenStandardFields.has(field.standardField)) {
      throw new Error(`Invalid field mapping for ${input.tableType}: duplicate standardField ${field.standardField}.`);
    }
    seenStandardFields.add(field.standardField);

    const expectedRequirement = definitionByField.get(field.standardField);
    if (!expectedRequirement) {
      throw new Error(`Invalid field mapping for ${input.tableType}: unknown standardField ${field.standardField}.`);
    }
    if (field.requirement !== expectedRequirement) {
      throw new Error(
        `Invalid field mapping for ${input.tableType}.${field.standardField}: requirement ${field.requirement} does not match ${expectedRequirement}.`
      );
    }
    if (field.sourceColumn === undefined) {
      throw new Error(`Invalid field mapping for ${input.tableType}.${field.standardField}: sourceColumn is undefined.`);
    }
    if (field.sourceColumn !== null) {
      if (typeof field.sourceColumn !== "string" || !field.sourceColumn.trim()) {
        throw new Error(`Invalid field mapping for ${input.tableType}.${field.standardField}: sourceColumn is blank.`);
      }
      if (seenSourceColumns.has(field.sourceColumn)) {
        throw new Error(`Invalid field mapping for ${input.tableType}: duplicate sourceColumn ${field.sourceColumn}.`);
      }
      seenSourceColumns.add(field.sourceColumn);
    }
  }
}

export async function deleteSupplyChainDesignProjectFileAction(
  _previousState: SupplyChainDesignCleanupState,
  formData: FormData
): Promise<SupplyChainDesignCleanupState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const fileId = text(formData, "fileId");
  const confirmed = formData.get("confirmDelete") === "on";
  if (!projectId || !fileId) {
    return { ok: false, message: "Missing project or file ID." };
  }

  const file = await prisma.supplyChainDesignProjectFile.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: fileId
      }
    },
    include: {
      mappings: true
    }
  });
  if (!file || file.projectId !== projectId) {
    return { ok: false, message: "Uploaded file was not found for this project and tenant." };
  }

  const referencingRuns = await countRunReferences(context.tenantId, projectId, fileId);
  if (!confirmed) {
    const mapping = file.mappings[0];
    return {
      ok: false,
      message: `Confirm delete for ${file.originalFileName}. Logical table: ${mapping?.tableType ?? "Not mapped"}. Saved mapping: ${mapping ? "yes" : "no"}. Referenced by ${referencingRuns} saved run/scenario record(s). Historical runs will not be deleted.`
    };
  }

  await prisma.supplyChainDesignProjectFile.delete({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: fileId
      }
    }
  });
  revalidatePath(`/supply-chain-design/${projectId}`);
  return { ok: true, message: `${file.originalFileName} was deleted. Historical runs were preserved.` };
}

export async function deleteSupplyChainDesignProjectFileFormAction(formData: FormData): Promise<void> {
  await deleteSupplyChainDesignProjectFileAction({ ok: false, message: "" }, formData);
}

export async function deleteSupplyChainDesignFileMappingAction(
  _previousState: SupplyChainDesignCleanupState,
  formData: FormData
): Promise<SupplyChainDesignCleanupState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const mappingId = text(formData, "mappingId");
  const confirmed = formData.get("confirmDelete") === "on";
  if (!projectId || !mappingId) {
    return { ok: false, message: "Missing project or mapping ID." };
  }

  const mapping = await prisma.supplyChainDesignFileMapping.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: mappingId
      }
    },
    include: {
      file: {
        select: {
          originalFileName: true
        }
      }
    }
  });
  if (!mapping || mapping.projectId !== projectId) {
    return { ok: false, message: "Mapping was not found for this project and tenant." };
  }
  if (!confirmed) {
    return {
      ok: false,
      message: `Confirm delete for ${mapping.tableType} mapping on ${mapping.file.originalFileName}. Workflows using this table may become not ready.`
    };
  }

  await prisma.supplyChainDesignFileMapping.delete({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: mappingId
      }
    }
  });
  revalidatePath(`/supply-chain-design/${projectId}`);
  return { ok: true, message: `${mapping.tableType} mapping was deleted.` };
}

export async function deleteSupplyChainDesignFileMappingFormAction(formData: FormData): Promise<void> {
  await deleteSupplyChainDesignFileMappingAction({ ok: false, message: "" }, formData);
}

export async function deleteSupplyChainDesignRunAction(
  _previousState: SupplyChainDesignCleanupState,
  formData: FormData
): Promise<SupplyChainDesignCleanupState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const runId = text(formData, "runId");
  const runType = text(formData, "runType");
  const confirmed = formData.get("confirmDelete") === "on";
  if (!projectId || !runId || !runType) {
    return { ok: false, message: "Missing project, run, or run type." };
  }
  if (!confirmed) {
    return { ok: false, message: `Confirm delete for saved ${runType} record ${runId}. Files and mappings will not be deleted.` };
  }

  if (runType === "MODEL_01") {
    const deleted = await prisma.supplyChainDesignModelRun.deleteMany({
      where: { tenantId: context.tenantId, projectId, id: runId }
    });
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: deleted.count === 1, message: deleted.count === 1 ? "Model 01 run was deleted." : "Model 01 run was not found." };
  }
  if (runType === "WAREHOUSE_COST_COMPARISON") {
    const deleted = await prisma.supplyChainDesignModelRun.deleteMany({
      where: { tenantId: context.tenantId, projectId, id: runId }
    });
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: deleted.count === 1, message: deleted.count === 1 ? "Warehouse Cost Comparison report was deleted." : "Warehouse Cost Comparison report was not found." };
  }
  if (runType === "MODEL_02") {
    const deleted = await prisma.supplyChainDesignScenario.deleteMany({
      where: { tenantId: context.tenantId, projectId, id: runId }
    });
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: deleted.count === 1, message: deleted.count === 1 ? "Model 02 scenario was deleted." : "Model 02 scenario was not found." };
  }
  if (runType === "THREE_PL") {
    const deleted = await prisma.supplyChainDesignScreeningRun.deleteMany({
      where: { tenantId: context.tenantId, projectId, id: runId }
    });
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: deleted.count === 1, message: deleted.count === 1 ? "3PL run was deleted." : "3PL run was not found." };
  }
  if (runType === "NETWORK_DESIGN") {
    const batch = await prisma.automationJobRun.findFirst({
      where: {
        tenantId: context.tenantId,
        id: runId,
        jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE
      },
      select: {
        id: true,
        input: true
      }
    });
    const input = batch?.input && typeof batch.input === "object" && !Array.isArray(batch.input)
      ? batch.input as { projectId?: unknown }
      : null;
    if (!batch || input?.projectId !== projectId) {
      return { ok: false, message: "Network Design report was not found." };
    }
    const deleted = await prisma.automationJobRun.deleteMany({
      where: {
        tenantId: context.tenantId,
        id: runId,
        jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE
      }
    });
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: deleted.count === 1, message: deleted.count === 1 ? "Network Design report was deleted." : "Network Design report was not found." };
  }

  return { ok: false, message: "Unsupported run type." };
}

export async function deleteSupplyChainDesignRunFormAction(formData: FormData): Promise<void> {
  await deleteSupplyChainDesignRunAction({ ok: false, message: "" }, formData);
}

export async function deleteSupplyChainDesignWarehouseLocationStrategyRunAction(
  _previousState: SupplyChainDesignCleanupState,
  formData: FormData
): Promise<SupplyChainDesignCleanupState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const runId = text(formData, "runId");
  const currentRunId = text(formData, "currentRunId");
  const confirmed = formData.get("confirmDelete") === "on";
  if (!projectId || !runId) {
    return { ok: false, message: "Missing project or Location Strategy report." };
  }
  if (!confirmed) {
    return {
      ok: false,
      message: "Delete this saved Location Strategy report? This removes the saved result and download, but does not delete uploaded project data."
    };
  }
  const run = await prisma.supplyChainDesignModelRun.findFirst({
    where: {
      tenantId: context.tenantId,
      projectId,
      id: runId
    },
    select: {
      id: true,
      resultSummary: true
    }
  });
  if (!run || !isLocationStrategyResult(run.resultSummary)) {
    return { ok: false, message: "Saved Location Strategy report was not found." };
  }
  await prisma.supplyChainDesignModelRun.delete({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: runId
      }
    }
  });
  revalidatePath(`/supply-chain-design/${projectId}`);
  if (currentRunId === runId) {
    const remainingRuns = await prisma.supplyChainDesignModelRun.findMany({
      where: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.SUCCESS
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        resultSummary: true
      }
    });
    const nextRun = remainingRuns.find((candidate) => isLocationStrategyResult(candidate.resultSummary));
    redirect(nextRun
      ? `/supply-chain-design/${projectId}?tab=warehouse-location-strategy&locationStrategyRunId=${nextRun.id}`
      : `/supply-chain-design/${projectId}?tab=warehouse-location-strategy`);
  }
  if (currentRunId) {
    redirect(`/supply-chain-design/${projectId}?tab=warehouse-location-strategy&locationStrategyRunId=${currentRunId}`);
  }
  return { ok: true, message: "Saved Location Strategy report was deleted." };
}

export async function deleteSupplyChainDesignWarehouseLocationStrategyRunFormAction(formData: FormData): Promise<void> {
  await deleteSupplyChainDesignWarehouseLocationStrategyRunAction({ ok: false, message: "" }, formData);
}

export async function applySupplyChainDesignAutomaticMappingAction(
  _previousState: SupplyChainDesignMappingState,
  formData: FormData
): Promise<SupplyChainDesignMappingState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const fileId = text(formData, "fileId");
  if (!projectId || !fileId) {
    return { ok: false, message: "Missing project or file ID." };
  }

  const file = await prisma.supplyChainDesignProjectFile.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: fileId
      }
    },
    select: {
      id: true,
      projectId: true,
      detectedHeaders: true,
      mappings: {
        select: {
          id: true,
          status: true
        }
      }
    }
  });

  if (!file || file.projectId !== projectId) {
    return { ok: false, message: "Uploaded file was not found for this project." };
  }
  const existingMapping = file.mappings[0] ?? null;
  if (existingMapping) {
    return { ok: false, message: "This file already has a saved mapping. Review it before replacing it manually." };
  }

  const headers = toStringArray(file.detectedHeaders);
  const recognized = recognizeSupplyChainDesignOfficialTemplate(headers);
  if (!recognized) {
    return { ok: false, message: "This file does not exactly match a current Newl template. Review the field mapping." };
  }

  try {
    const mapping = await prisma.$transaction(async (tx) =>
      saveSupplyChainDesignMapping(tx, {
        tenantId: context.tenantId,
        projectId,
        fileId,
        tableType: recognized.tableType,
        fieldMappings: recognized.fieldMappings,
        status: SupplyChainDesignMappingStatus.DRAFT,
        userId: context.userId
      })
    );

    revalidatePath(`/supply-chain-design/${projectId}`);
    revalidatePath(`/supply-chain-design/${projectId}/files/${fileId}`);
    return { ok: true, message: `${getSupplyChainDesignTableLabel(mapping.tableType)} was automatically mapped.` };
  } catch (error) {
    console.error("Supply Chain Design automatic mapping failed", {
      stage: "apply-automatic-mapping-persistence",
      model: "SupplyChainDesignFileMapping",
      method: "upsert",
      tableType: recognized.tableType,
      fileId,
      projectId,
      tenantId: context.tenantId,
      fieldMappingCount: recognized.fieldMappings.length,
      error
    });
    return {
      ok: false,
      message: automaticMappingFailureMessage(recognized.tableType, safeAutomaticMappingFailureReason(error))
    };
  }
}

export async function saveSupplyChainDesignFileMappingAction(
  _previousState: SupplyChainDesignMappingState,
  formData: FormData
): Promise<SupplyChainDesignMappingState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const fileId = text(formData, "fileId");
  const tableTypeValue = text(formData, "tableType");

  if (!projectId || !fileId) {
    return { ok: false, message: "Missing project or file ID." };
  }

  if (!tableTypeValue || !isSupplyChainDesignTableType(tableTypeValue)) {
    return { ok: false, message: "Select a supported table type." };
  }

  const file = await prisma.supplyChainDesignProjectFile.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: fileId
      }
    },
    select: {
      id: true,
      projectId: true,
      detectedHeaders: true
    }
  });

  if (!file || file.projectId !== projectId) {
    return { ok: false, message: "Uploaded file was not found for this project." };
  }

  const headers = toStringArray(file.detectedHeaders);
  const headerSet = new Set(headers);
  const usedSourceColumns = new Set<string>();
  const definition = getSupplyChainDesignMappingDefinition(tableTypeValue);
  const fieldMappings: SupplyChainDesignFieldMapping[] = [];

  for (const field of definition) {
    const sourceColumn = text(formData, `field:${field.field}`);

    if (!sourceColumn) {
      if (field.requirement === "REQUIRED") {
        return { ok: false, message: `${field.field} is required.` };
      }
      fieldMappings.push({
        standardField: field.field,
        sourceColumn: null,
        requirement: field.requirement
      });
      continue;
    }

    if (!headerSet.has(sourceColumn)) {
      return { ok: false, message: `${sourceColumn} is not a detected CSV header.` };
    }

    if (usedSourceColumns.has(sourceColumn)) {
      return { ok: false, message: `${sourceColumn} is already mapped to another field.` };
    }

    usedSourceColumns.add(sourceColumn);
    fieldMappings.push({
      standardField: field.field,
      sourceColumn,
      requirement: field.requirement
    });
  }

  const saved = await prisma.$transaction(async (tx) => {
    const mapping = await saveSupplyChainDesignMapping(tx, {
      tenantId: context.tenantId,
      projectId,
      fileId,
      tableType: tableTypeValue,
      fieldMappings,
      status: SupplyChainDesignMappingStatus.DRAFT,
      userId: context.userId
    });

    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "supply-chain-design.file-mapping.saved",
        entityType: "SupplyChainDesignFileMapping",
        entityId: mapping.id,
        after: {
          moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN,
          projectId,
          fileId,
          mappingId: mapping.id,
          tableType: tableTypeValue,
          status: mapping.status,
          fieldMappings
        }
      }
    });

    return mapping;
  });

  revalidatePath(`/supply-chain-design/${projectId}`);
  revalidatePath(`/supply-chain-design/${projectId}/files/${fileId}`);

  return {
    ok: true,
    message: `Saved ${saved.tableType.toLowerCase()} mapping.`
  };
}

export async function runSupplyChainDesignModel01ProofAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const currentNetworkActivityMappingId = text(formData, "currentNetworkActivityMappingId");
  const facilitiesMappingId = text(formData, "facilitiesMappingId");
  const shipmentsMappingId = text(formData, "shipmentsMappingId");
  const inventoryMappingId = text(formData, "inventoryMappingId");
  const facilityCostsMappingId = text(formData, "facilityCostsMappingId");
  const customersMappingId = text(formData, "customersMappingId");
  if (!projectId) {
    return { ok: false, message: "Missing project ID." };
  }

  if (!facilitiesMappingId || !shipmentsMappingId) {
    return { ok: false, message: "Select Historical Shipments and Current Facilities and Warehouse Costs before running." };
  }

  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    select: {
      id: true,
      mappings: {
        where: {
          tableType: {
            in: ["CURRENT_NETWORK_ACTIVITY", "FACILITIES", "SHIPMENTS", "INVENTORY", "FACILITY_COSTS", "CUSTOMERS"]
          }
        },
        orderBy: {
          updatedAt: "desc"
        },
        include: {
          file: {
            select: {
              id: true,
              originalFileName: true,
              fileBytes: true
            }
          }
        }
      }
    }
  });

  if (!project) {
    return { ok: false, message: "Supply Chain Design project was not found." };
  }

  const currentNetworkActivityMappings = getValidMappings(project.mappings, "CURRENT_NETWORK_ACTIVITY", [
    "origin_facility_id",
    "facility_name"
  ]);
  const facilitiesMappings = getValidMappings(project.mappings, "FACILITIES", ["facility_id", "facility_name"]);
  const shipmentsMappings = getValidMappings(project.mappings, "SHIPMENTS", ["origin_facility_id"]);
  const inventoryMappings = getValidMappings(project.mappings, "INVENTORY", ["facility_id", "item_id", "quantity"]);
  const facilityCostsMappings = getValidMappings(project.mappings, "FACILITY_COSTS", [
    "facility_id",
    "cost_category",
    "annual_cost"
  ]);
  const customersMappings = getValidMappings(project.mappings, "CUSTOMERS", [
    "customer_id",
    "customer_name",
    "city",
    "country"
  ]);
  const currentNetworkActivityMapping =
    currentNetworkActivityMappingId
      ? currentNetworkActivityMappings.find((mapping) => mapping.id === currentNetworkActivityMappingId) ?? null
      : null;
  const facilitiesMapping = facilitiesMappingId
    ? facilitiesMappings.find((mapping) => mapping.id === facilitiesMappingId) ?? null
    : null;
  const shipmentsMapping = shipmentsMappingId
    ? shipmentsMappings.find((mapping) => mapping.id === shipmentsMappingId) ?? null
    : null;
  const inventoryMapping = inventoryMappingId
    ? inventoryMappings.find((mapping) => mapping.id === inventoryMappingId) ?? null
    : null;
  const facilityCostsMapping = facilityCostsMappingId
    ? facilityCostsMappings.find((mapping) => mapping.id === facilityCostsMappingId) ?? null
    : null;
  const customersMapping = customersMappingId
    ? customersMappings.find((mapping) => mapping.id === customersMappingId) ?? null
    : null;

  const missingInputs = [
    currentNetworkActivityMappingId && !currentNetworkActivityMapping ? "selected legacy Current Network Data mapping" : null,
    !facilitiesMapping ? "selected Current Facilities and Warehouse Costs mapping" : null,
    !shipmentsMapping ? "selected Historical Shipments mapping" : null,
    inventoryMappingId && !inventoryMapping ? "selected INVENTORY mapping" : null,
    facilityCostsMappingId && !facilityCostsMapping ? "selected FACILITY_COSTS mapping" : null,
    customersMappingId && !customersMapping ? "selected CUSTOMERS mapping" : null
  ].filter((value): value is string => Boolean(value));

  if (missingInputs.length > 0) {
    return { ok: false, message: `Missing required Current Network Baseline input: ${missingInputs.join(" and ")}.` };
  }

  const inputReferences = {
    currentNetworkActivity: currentNetworkActivityMapping
      ? {
          fileId: currentNetworkActivityMapping.fileId,
          fileName: currentNetworkActivityMapping.file.originalFileName,
          mappingId: currentNetworkActivityMapping.id,
          mappingUpdatedAt: currentNetworkActivityMapping.updatedAt.toISOString(),
          candidateFiles: currentNetworkActivityMappings.map((mapping) => ({
            fileId: mapping.fileId,
            fileName: mapping.file.originalFileName,
            mappingId: mapping.id,
            mappingUpdatedAt: mapping.updatedAt.toISOString(),
            selected: mapping.id === currentNetworkActivityMapping.id
          }))
        }
      : null,
    facilities: facilitiesMapping
      ? {
          fileId: facilitiesMapping.fileId,
          fileName: facilitiesMapping.file.originalFileName,
          mappingId: facilitiesMapping.id,
          mappingUpdatedAt: facilitiesMapping.updatedAt.toISOString(),
          candidateFiles: facilitiesMappings.map((mapping) => ({
            fileId: mapping.fileId,
            fileName: mapping.file.originalFileName,
            mappingId: mapping.id,
            mappingUpdatedAt: mapping.updatedAt.toISOString(),
            selected: mapping.id === facilitiesMapping.id
          }))
        }
      : null,
    shipments: shipmentsMapping
      ? {
          fileId: shipmentsMapping.fileId,
          fileName: shipmentsMapping.file.originalFileName,
          mappingId: shipmentsMapping.id,
          mappingUpdatedAt: shipmentsMapping.updatedAt.toISOString(),
          candidateFiles: shipmentsMappings.map((mapping) => ({
            fileId: mapping.fileId,
            fileName: mapping.file.originalFileName,
            mappingId: mapping.id,
            mappingUpdatedAt: mapping.updatedAt.toISOString(),
            selected: mapping.id === shipmentsMapping.id
          }))
        }
      : null,
    inventory: inventoryMapping
      ? {
          fileId: inventoryMapping.fileId,
          fileName: inventoryMapping.file.originalFileName,
          mappingId: inventoryMapping.id,
          mappingUpdatedAt: inventoryMapping.updatedAt.toISOString(),
          candidateFiles: inventoryMappings.map((mapping) => ({
            fileId: mapping.fileId,
            fileName: mapping.file.originalFileName,
            mappingId: mapping.id,
            mappingUpdatedAt: mapping.updatedAt.toISOString(),
            selected: mapping.id === inventoryMapping.id
          }))
        }
      : null,
    facilityCosts: facilityCostsMapping
      ? {
          fileId: facilityCostsMapping.fileId,
          fileName: facilityCostsMapping.file.originalFileName,
          mappingId: facilityCostsMapping.id,
          mappingUpdatedAt: facilityCostsMapping.updatedAt.toISOString(),
          candidateFiles: facilityCostsMappings.map((mapping) => ({
            fileId: mapping.fileId,
            fileName: mapping.file.originalFileName,
            mappingId: mapping.id,
            mappingUpdatedAt: mapping.updatedAt.toISOString(),
            selected: mapping.id === facilityCostsMapping.id
          }))
        }
      : null,
    customers: customersMapping
      ? {
          fileId: customersMapping.fileId,
          fileName: customersMapping.file.originalFileName,
          mappingId: customersMapping.id,
          mappingUpdatedAt: customersMapping.updatedAt.toISOString(),
          candidateFiles: customersMappings.map((mapping) => ({
            fileId: mapping.fileId,
            fileName: mapping.file.originalFileName,
            mappingId: mapping.id,
            mappingUpdatedAt: mapping.updatedAt.toISOString(),
            selected: mapping.id === customersMapping.id
          }))
        }
      : null
  };

  try {
    const resultSummary = runSupplyChainDesignModel01Proof({
      currentNetworkActivity: currentNetworkActivityMapping
        ? {
            fileId: currentNetworkActivityMapping.fileId,
            mappingId: currentNetworkActivityMapping.id,
            tableType: currentNetworkActivityMapping.tableType,
            fileBytes: Buffer.from(currentNetworkActivityMapping.file.fileBytes),
            fieldMappings: toFieldMappings(currentNetworkActivityMapping.fieldMappings)
          }
        : null,
      facilities: facilitiesMapping
        ? {
            fileId: facilitiesMapping.fileId,
            mappingId: facilitiesMapping.id,
            tableType: facilitiesMapping.tableType,
            fileBytes: Buffer.from(facilitiesMapping.file.fileBytes),
            fieldMappings: toFieldMappings(facilitiesMapping.fieldMappings)
          }
        : currentNetworkActivityMapping
          ? placeholderMappedFile(currentNetworkActivityMapping, "FACILITIES")
          : null!,
      shipments: shipmentsMapping
        ? {
            fileId: shipmentsMapping.fileId,
            mappingId: shipmentsMapping.id,
            tableType: shipmentsMapping.tableType,
            fileBytes: Buffer.from(shipmentsMapping.file.fileBytes),
            fieldMappings: toFieldMappings(shipmentsMapping.fieldMappings)
          }
        : currentNetworkActivityMapping
          ? placeholderMappedFile(currentNetworkActivityMapping, "SHIPMENTS")
          : null!,
      inventory: inventoryMapping
        ? {
            fileId: inventoryMapping.fileId,
            mappingId: inventoryMapping.id,
            tableType: inventoryMapping.tableType,
            fileBytes: Buffer.from(inventoryMapping.file.fileBytes),
            fieldMappings: toFieldMappings(inventoryMapping.fieldMappings)
          }
        : null,
      facilityCosts: facilityCostsMapping
        ? {
            fileId: facilityCostsMapping.fileId,
            mappingId: facilityCostsMapping.id,
            tableType: facilityCostsMapping.tableType,
            fileBytes: Buffer.from(facilityCostsMapping.file.fileBytes),
            fieldMappings: toFieldMappings(facilityCostsMapping.fieldMappings)
          }
        : null,
      customers: customersMapping
        ? {
            fileId: customersMapping.fileId,
            mappingId: customersMapping.id,
            tableType: customersMapping.tableType,
            fileBytes: Buffer.from(customersMapping.file.fileBytes),
            fieldMappings: toFieldMappings(customersMapping.fieldMappings)
          }
        : null
    });

    const createdRun = await prisma.supplyChainDesignModelRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        inputReferences,
        resultSummary,
        createdByUserId: context.userId
      }
    });

    const savedRun = await prisma.supplyChainDesignModelRun.findUnique({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: createdRun.id
        }
      },
      select: {
        id: true
      }
    });

    if (!savedRun) {
      return { ok: false, message: "Current Network Baseline run was created but could not be retrieved." };
    }

    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: true, message: "Current Network Baseline completed." };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Current Network Baseline failed.";

    await prisma.supplyChainDesignModelRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.FAILED,
        inputReferences,
        errorMessage,
        createdByUserId: context.userId
      }
    });

    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: false, message: errorMessage };
  }
}

export async function runSupplyChainDesignWarehouseLocationStrategyAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const shipmentsMappingId = text(formData, "shipmentsMappingId");
  const maxRegionsValue = Number(text(formData, "maxRegions") || "1");
  const maxRegions = maxRegionsValue === 1 || maxRegionsValue === 2 || maxRegionsValue === 3 ? maxRegionsValue : 1;
  const weightingMethod = normalizeLocationStrategyWeighting(text(formData, "weightingMethod"));
  const countryScope = normalizeLocationStrategyCountryScope(text(formData, "countryScope"));
  let cadToUsdRate: number | null = null;
  try {
    cadToUsdRate = parseOptionalLocationStrategyRate(text(formData, "cadToUsdRate"));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "CAD to USD conversion rate is invalid." };
  }
  if (!projectId) return { ok: false, message: "Missing project ID." };
  if (!shipmentsMappingId) return { ok: false, message: "Select Historical Shipments before running Location Strategy." };
  let createdRunId: string | null = null;

  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    select: {
      id: true,
      mappings: {
        where: {
          tableType: "SHIPMENTS",
          id: shipmentsMappingId
        },
        include: {
          file: {
            select: {
              id: true,
              originalFileName: true,
              fileBytes: true
            }
          }
        }
      }
    }
  });
  if (!project) return { ok: false, message: "Supply Chain Design project was not found." };
  const shipmentsMapping = project.mappings.find(
    (mapping) => mapping.id === shipmentsMappingId && mapping.tableType === "SHIPMENTS"
  ) ?? null;
  const shipmentsFields = shipmentsMapping ? toFieldMappings(shipmentsMapping.fieldMappings) : [];
  const hasDestinationField = shipmentsFields.some(
    (mapping) =>
      (mapping.standardField === "postal_or_region_code" || mapping.standardField === "destination_id") &&
      Boolean(mapping.sourceColumn)
  );
  if (!shipmentsMapping || !hasDestinationField) {
    return {
      ok: false,
      message: "Selected Historical Shipments mapping must include Destination Postal Code or Destination ID."
    };
  }

  const reportFingerprint = createLocationStrategyReportFingerprint({
    shipmentsMappingId: shipmentsMapping.id,
    sourceFileSha256: sha256(Buffer.from(shipmentsMapping.file.fileBytes)),
    mappingUpdatedAt: shipmentsMapping.updatedAt.toISOString(),
    maxRegions,
    weightingMethod,
    countryScope,
    cadToUsdRate
  });
  const inputReferences = {
    shipments: {
      fileId: shipmentsMapping.fileId,
      fileName: shipmentsMapping.file.originalFileName,
      mappingId: shipmentsMapping.id,
      mappingUpdatedAt: shipmentsMapping.updatedAt.toISOString(),
      candidateFiles: [{
        fileId: shipmentsMapping.fileId,
        fileName: shipmentsMapping.file.originalFileName,
        mappingId: shipmentsMapping.id,
        mappingUpdatedAt: shipmentsMapping.updatedAt.toISOString(),
        selected: true
      }]
    },
    maxRegions,
    weightingMethod,
    countryScope,
    cadToUsdRate: weightingMethod === "CURRENT_TRANSPORTATION_COST" ? cadToUsdRate : null,
    reportFingerprint
  };

  const existingRuns = await prisma.supplyChainDesignModelRun.findMany({
    where: {
      tenantId: context.tenantId,
      projectId,
      status: SupplyChainDesignModelRunStatus.SUCCESS
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true,
      inputReferences: true,
      resultSummary: true
    }
  });
  const existingRun = existingRuns.find((run) =>
    isCurrentLocationStrategyResult(run.resultSummary) &&
    readLocationStrategyFingerprint(run.inputReferences) === reportFingerprint
  );
  if (existingRun) {
    revalidatePath(`/supply-chain-design/${projectId}`);
    redirect(`/supply-chain-design/${projectId}?tab=warehouse-location-strategy&locationStrategyRunId=${existingRun.id}&locationStrategyStatus=reused`);
  }

  try {
    const resultSummary = runSupplyChainDesignWarehouseLocationStrategy({
      shipments: {
        fileId: shipmentsMapping.fileId,
        mappingId: shipmentsMapping.id,
        fileName: shipmentsMapping.file.originalFileName,
        fileBytes: Buffer.from(shipmentsMapping.file.fileBytes),
        fieldMappings: toFieldMappings(shipmentsMapping.fieldMappings)
      },
      maxRegions,
      weightingMethod,
      countryScope,
      cadToUsdRate: weightingMethod === "CURRENT_TRANSPORTATION_COST" ? cadToUsdRate : null
    });
    const createdRun = await prisma.supplyChainDesignModelRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        inputReferences,
        resultSummary,
        createdByUserId: context.userId
      }
    });
    createdRunId = createdRun.id;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Warehouse Location Strategy failed.";
    if (
      errorMessage.startsWith("Historical transportation spend weighting cannot combine multiple currencies") ||
      errorMessage.startsWith("Enter a CAD to USD conversion rate")
    ) {
      revalidatePath(`/supply-chain-design/${projectId}`);
      return { ok: false, message: errorMessage };
    }
    await prisma.supplyChainDesignModelRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.FAILED,
        inputReferences,
        errorMessage,
        createdByUserId: context.userId
      }
    });
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: false, message: errorMessage };
  }
  revalidatePath(`/supply-chain-design/${projectId}`);
  redirect(`/supply-chain-design/${projectId}?tab=warehouse-location-strategy&locationStrategyRunId=${createdRunId}`);
}

export async function runSupplyChainDesignWarehouseCostComparisonAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const facilitiesMappingId = text(formData, "facilitiesMappingId");
  const candidateFacilitiesMappingId = text(formData, "candidateFacilitiesMappingId");
  const selectedFacilityOptionIds = stringValues(formData, "facilityOptionIds");
  let cadToUsdRate: number | null = null;
  try {
    cadToUsdRate = parseOptionalLocationStrategyRate(text(formData, "cadToUsdRate"));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "CAD to USD conversion rate is invalid." };
  }

  if (!projectId) return { ok: false, message: "Missing project ID." };
  if (!facilitiesMappingId || !candidateFacilitiesMappingId) {
    return { ok: false, message: "Select Current Facilities and Candidate Warehouses before running Warehouse Cost Comparison." };
  }
  if (selectedFacilityOptionIds.length < 2) {
    return { ok: false, message: "Select at least two facilities to compare warehouse costs." };
  }

  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    select: {
      id: true,
      mappings: {
        where: {
          id: {
            in: [facilitiesMappingId, candidateFacilitiesMappingId]
          },
          tableType: {
            in: ["FACILITIES", "CANDIDATE_FACILITIES"]
          }
        },
        include: {
          file: {
            select: {
              id: true,
              originalFileName: true,
              fileBytes: true
            }
          }
        }
      }
    }
  });
  if (!project) return { ok: false, message: "Supply Chain Design project was not found." };

  const facilitiesMapping = project.mappings.find((mapping) => mapping.id === facilitiesMappingId && mapping.tableType === "FACILITIES") ?? null;
  const candidateFacilitiesMapping = project.mappings.find((mapping) => mapping.id === candidateFacilitiesMappingId && mapping.tableType === "CANDIDATE_FACILITIES") ?? null;
  if (!facilitiesMapping) return { ok: false, message: "Selected Current Facilities and Warehouse Costs mapping was not found or has the wrong table type." };
  if (!candidateFacilitiesMapping) return { ok: false, message: "Selected Candidate Warehouses and Proposed Costs mapping was not found or has the wrong table type." };

  const inputReferences = {
    facilities: toScenarioInputReference(facilitiesMapping, [facilitiesMapping]),
    candidateFacilities: toScenarioInputReference(candidateFacilitiesMapping, [candidateFacilitiesMapping]),
    selectedFacilityOptionIds,
    cadToUsdRate
  };

  try {
    const facilityOptions = readWarehouseCostFacilityOptions({
      currentFacilities: {
        fileBytes: facilitiesMapping.file.fileBytes,
        fieldMappings: toFieldMappings(facilitiesMapping.fieldMappings)
      },
      candidateFacilities: {
        fileBytes: candidateFacilitiesMapping.file.fileBytes,
        fieldMappings: toFieldMappings(candidateFacilitiesMapping.fieldMappings)
      }
    });
    const resultSummary = runWarehouseCostComparison({
      facilities: facilityOptions,
      selectedFacilityOptionIds,
      cadToUsdRate
    });
    const createdRun = await prisma.supplyChainDesignModelRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        inputReferences,
        resultSummary,
        createdByUserId: context.userId
      }
    });
    revalidatePath(`/supply-chain-design/${projectId}`);
    redirect(`/supply-chain-design/${projectId}?tab=warehouse-cost-comparison&warehouseCostComparisonRunId=${createdRun.id}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Warehouse Cost Comparison failed.";
    await prisma.supplyChainDesignModelRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.FAILED,
        inputReferences,
        errorMessage,
        createdByUserId: context.userId
      }
    });
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: false, message: errorMessage };
  }
}

export async function runSupplyChainDesignNetworkScenarioComparisonAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const shipmentsMappingId = text(formData, "shipmentsMappingId");
  const facilitiesMappingId = text(formData, "facilitiesMappingId");
  const candidateFacilitiesMappingId = text(formData, "candidateFacilitiesMappingId");
  const scenarioAName = text(formData, "scenarioAName") ?? "Scenario A";
  const scenarioBName = text(formData, "scenarioBName") ?? "Scenario B";
  const scenarioAFacilityOptionIds = stringValues(formData, "scenarioAFacilityOptionIds");
  const scenarioBFacilityOptionIds = stringValues(formData, "scenarioBFacilityOptionIds");
  const forceNewRun = text(formData, "forceNewRun") === "on";
  const submittedNetworkScenarioComparison = {
    shipmentsMappingId,
    facilitiesMappingId,
    candidateFacilitiesMappingId,
    scenarioAName,
    scenarioBName,
    scenarioAFacilityOptionIds,
    scenarioBFacilityOptionIds,
    cadToUsdRate: text(formData, "cadToUsdRate")
  };
  let cadToUsdRate: number | null = null;
  try {
    cadToUsdRate = parseOptionalLocationStrategyRate(text(formData, "cadToUsdRate"));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "CAD to USD conversion rate is invalid.", submittedNetworkScenarioComparison };
  }

  if (!projectId) return { ok: false, message: "Missing project ID.", submittedNetworkScenarioComparison };
  if (!shipmentsMappingId || !facilitiesMappingId || !candidateFacilitiesMappingId) {
    return { ok: false, message: "Select Historical Shipments, Current Facilities and Candidate Warehouses before running Network Scenario Comparison.", submittedNetworkScenarioComparison };
  }
  if (scenarioAFacilityOptionIds.length === 0) {
    return { ok: false, message: "Select at least one warehouse for Scenario A.", submittedNetworkScenarioComparison };
  }
  if (scenarioBFacilityOptionIds.length === 0) {
    return { ok: false, message: "Select at least one warehouse for Scenario B.", submittedNetworkScenarioComparison };
  }

  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    select: {
      id: true,
      mappings: {
        where: {
          id: {
            in: [shipmentsMappingId, facilitiesMappingId, candidateFacilitiesMappingId]
          },
          tableType: {
            in: ["SHIPMENTS", "FACILITIES", "CANDIDATE_FACILITIES"]
          }
        },
        include: {
          file: true
        }
      }
    }
  });
  if (!project) return { ok: false, message: "Supply Chain Design project was not found.", submittedNetworkScenarioComparison };

  const shipmentsMapping = project.mappings.find((mapping) => mapping.id === shipmentsMappingId && mapping.tableType === "SHIPMENTS") ?? null;
  const facilitiesMapping = project.mappings.find((mapping) => mapping.id === facilitiesMappingId && mapping.tableType === "FACILITIES") ?? null;
  const candidateFacilitiesMapping =
    project.mappings.find((mapping) => mapping.id === candidateFacilitiesMappingId && mapping.tableType === "CANDIDATE_FACILITIES") ?? null;
  if (!shipmentsMapping) return { ok: false, message: "Selected Historical Shipments mapping was not found or has the wrong table type.", submittedNetworkScenarioComparison };
  if (!facilitiesMapping) return { ok: false, message: "Selected Current Facilities and Warehouse Costs mapping was not found or has the wrong table type.", submittedNetworkScenarioComparison };
  if (!candidateFacilitiesMapping) return { ok: false, message: "Selected Candidate Warehouses and Proposed Costs mapping was not found or has the wrong table type.", submittedNetworkScenarioComparison };

  try {
    const orchestrationInput = await buildNetworkScenarioComparisonOrchestrationInput({
      context,
      projectId,
      shipmentsMapping,
      facilitiesMapping,
      candidateFacilitiesMapping,
      scenarioAName,
      scenarioBName,
      scenarioAFacilityOptionIds,
      scenarioBFacilityOptionIds,
      cadToUsdRate,
      submittedNetworkScenarioComparison
    });
    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison({
      ...orchestrationInput,
      forceNewRun
    });

    revalidatePath(`/supply-chain-design/${projectId}`);
    return {
      ok: result.phase !== "FAILED",
      message: networkScenarioComparisonMessage(result.phase),
      runId: result.run.id,
      runStatus: result.phase,
      requestTotal: result.missingRateBatch?.requestCount ?? result.ratingEvidence.missingRateCount,
      submittedNetworkScenarioComparison
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Network Scenario Comparison failed.";
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: false, message: errorMessage, submittedNetworkScenarioComparison };
  }
}

export async function deleteSupplyChainDesignNetworkScenarioComparisonRunAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const runId = text(formData, "runId");
  const confirmed = text(formData, "confirmDelete") === "on";
  if (!projectId || !runId) return { ok: false, message: "Missing Network Scenario Comparison result to delete." };
  if (!confirmed) return { ok: false, message: "Deletion was cancelled." };

  const deleted = await deleteNetworkScenarioComparisonRun(context, projectId, runId);
  revalidatePath(`/supply-chain-design/${projectId}`);
  return deleted
    ? { ok: true, message: "Network Scenario Comparison result deleted." }
    : { ok: false, message: "Network Scenario Comparison result was not found or could not be deleted." };
}

export async function deleteSupplyChainDesignNetworkScenarioComparisonRunFormAction(formData: FormData): Promise<void> {
  await deleteSupplyChainDesignNetworkScenarioComparisonRunAction({ ok: false, message: "" }, formData);
}

export async function resumeSupplyChainDesignNetworkScenarioComparisonAction(input: {
  projectId: string;
  comparisonRunId: string;
}): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const run = await getNetworkScenarioComparisonRun(context, input.projectId, input.comparisonRunId);
  if (!run) return { ok: false, message: "Network Scenario Comparison run was not found." };
  if (run.status === "COMPLETE" || run.status === "INCOMPLETE" || run.status === "FAILED") {
    return { ok: true, message: networkScenarioComparisonMessage(run.status), runId: run.id, runStatus: run.status };
  }

  const mappingIds = [
    run.inputReferences.historicalShipments.mappingId,
    run.inputReferences.currentFacilities.mappingId,
    run.inputReferences.candidateFacilities.mappingId
  ];
  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: input.projectId
      }
    },
    select: {
      id: true,
      mappings: {
        where: {
          id: {
            in: mappingIds
          },
          tableType: {
            in: ["SHIPMENTS", "FACILITIES", "CANDIDATE_FACILITIES"]
          }
        },
        include: {
          file: true
        }
      }
    }
  });
  if (!project) return { ok: false, message: "Supply Chain Design project was not found." };

  const shipmentsMapping = project.mappings.find((mapping) => mapping.id === run.inputReferences.historicalShipments.mappingId && mapping.tableType === "SHIPMENTS") ?? null;
  const facilitiesMapping = project.mappings.find((mapping) => mapping.id === run.inputReferences.currentFacilities.mappingId && mapping.tableType === "FACILITIES") ?? null;
  const candidateFacilitiesMapping =
    project.mappings.find((mapping) => mapping.id === run.inputReferences.candidateFacilities.mappingId && mapping.tableType === "CANDIDATE_FACILITIES") ?? null;
  if (!shipmentsMapping || !facilitiesMapping || !candidateFacilitiesMapping) {
    return { ok: false, message: "Saved Network Scenario Comparison input mappings could not be loaded for this project and tenant." };
  }

  try {
    const scenarioA = run.scenarioInputs.scenarios.find((scenario) => scenario.scenarioKey === "A");
    const scenarioB = run.scenarioInputs.scenarios.find((scenario) => scenario.scenarioKey === "B");
    if (!scenarioA || !scenarioB) return { ok: false, message: "Saved Network Scenario Comparison scenarios could not be read." };
    const scenarioAFacilityOptionIds = scenarioA.selectedFacilities.map((facility) => `${facility.sourceType}:${facility.facilityId}`);
    const scenarioBFacilityOptionIds = scenarioB.selectedFacilities.map((facility) => `${facility.sourceType}:${facility.facilityId}`);
    const orchestrationInput = await buildNetworkScenarioComparisonOrchestrationInput({
      context,
      projectId: input.projectId,
      shipmentsMapping,
      facilitiesMapping,
      candidateFacilitiesMapping,
      scenarioAName: scenarioA.scenarioName,
      scenarioBName: scenarioB.scenarioName,
      scenarioAFacilityOptionIds,
      scenarioBFacilityOptionIds,
      cadToUsdRate: run.fxInput?.cadToUsdRate ?? null
    });
    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison({
      ...orchestrationInput,
      comparisonRunId: run.id,
      submitMissingRates: false,
      finalizeWithMissingRates: true
    });
    revalidatePath(`/supply-chain-design/${input.projectId}`);
    return {
      ok: result.phase !== "FAILED",
      message: networkScenarioComparisonMessage(result.phase),
      runId: result.run.id,
      runStatus: result.phase,
      requestTotal: result.ratingEvidence.missingRateCount
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Network Scenario Comparison reconciliation failed.";
    revalidatePath(`/supply-chain-design/${input.projectId}`);
    return { ok: false, message: errorMessage, runId: run.id, runStatus: "FAILED" };
  }
}

export async function startSupplyChainDesignNetworkScenarioComparisonRateBatchAction(input: {
  projectId: string;
  comparisonRunId: string;
  batchId: string;
}): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const run = await getNetworkScenarioComparisonRun(context, input.projectId, input.comparisonRunId);
  if (!run) return { ok: false, message: "Network Scenario Comparison run was not found." };
  if (!["RATING", "RATES_REQUIRED"].includes(run.status)) {
    return { ok: true, message: networkScenarioComparisonMessage(run.status), runId: run.id, runStatus: run.status };
  }
  if (!run.ratingEvidence.ratingBatchIds.includes(input.batchId)) {
    return { ok: false, message: "Selected rate batch is not linked to this Network Scenario Comparison run.", runId: run.id, runStatus: run.status };
  }

  const job = await prisma.automationJobRun.findUnique({
    where: {
      id: input.batchId
    },
    select: {
      id: true,
      tenantId: true,
      status: true,
      input: true
    }
  });
  if (!job || job.tenantId !== context.tenantId) {
    return { ok: false, message: "Network Scenario Comparison rate batch was not found.", runId: run.id, runStatus: run.status };
  }
  if (job.status === JobStatus.RUNNING) {
    return { ok: true, message: "Network Scenario Comparison rate batch is already running.", runId: run.id, runStatus: run.status };
  }
  if (job.status !== JobStatus.QUEUED) {
    return { ok: true, message: "Network Scenario Comparison rate batch is already terminal.", runId: run.id, runStatus: run.status };
  }

  const batchInput = readSupplyChainDesignLtlBatchInput(job.input);
  if (!batchInput || batchInput.projectId !== input.projectId || batchInput.preparationRunId !== `scenario:comparison:${run.id}`) {
    return { ok: false, message: "Network Scenario Comparison rate batch input is not compatible with this run.", runId: run.id, runStatus: run.status };
  }
  const accountState = await getLtlRatePortalAccounts(context);
  const account = pickPreferredLiveSevenLAccount(accountState.accounts);
  if (!account || account.id !== batchInput.accountId) {
    return { ok: false, message: "The configured live 7L account is not available for this rate batch.", runId: run.id, runStatus: run.status };
  }

  queueMicrotask(() => {
    void runSupplyChainDesignLtlRateBatch(
      { tenantId: context.tenantId, userId: context.userId },
      job.id,
      account,
      batchInput
    );
  });
  revalidatePath(`/supply-chain-design/${input.projectId}`);
  return { ok: true, message: "Network Scenario Comparison rate batch started.", runId: run.id, runStatus: run.status, requestTotal: batchInput.requests.length };
}

export async function runSupplyChainDesignModel02ProofAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const scenarioName = text(formData, "scenarioName");
  const baselineRunId = text(formData, "baselineRunId");
  const facilitiesMappingId = text(formData, "facilitiesMappingId");
  const shipmentsMappingId = text(formData, "shipmentsMappingId");
  const customersMappingId = text(formData, "customersMappingId");
  const candidateFacilitiesMappingId = text(formData, "candidateFacilitiesMappingId");
  const scenarioLaneCostsMappingId = text(formData, "scenarioLaneCostsMappingId");
  const facilityCostsMappingId = text(formData, "facilityCostsMappingId");
  const selectedExistingFacilityIds = formData
    .getAll("selectedExistingFacilityIds")
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
  const selectedCandidateFacilityIds = formData
    .getAll("selectedCandidateFacilityIds")
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
  const enforceCapacity = formData.get("enforceCapacity") === "on";

  if (!projectId) {
    return { ok: false, message: "Missing project ID." };
  }
  if (!scenarioName) {
    return { ok: false, message: "Scenario name is required." };
  }
  if (!baselineRunId) {
    return { ok: false, message: "Select a successful Model 01 baseline before running Model 02." };
  }
  if (selectedExistingFacilityIds.length + selectedCandidateFacilityIds.length === 0) {
    return { ok: false, message: "Select at least one existing or candidate facility to keep open." };
  }

  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    select: {
      id: true,
      mappings: {
        where: {
          tableType: {
            in: [
              "FACILITIES",
              "SHIPMENTS",
              "CUSTOMERS",
              "CANDIDATE_FACILITIES",
              "SCENARIO_LANE_COSTS",
              "FACILITY_COSTS"
            ]
          }
        },
        include: {
          file: {
            select: {
              id: true,
              originalFileName: true,
              fileBytes: true
            }
          }
        }
      },
      modelRuns: {
        where: {
          id: baselineRunId,
          status: SupplyChainDesignModelRunStatus.SUCCESS
        },
        take: 1,
        select: {
          id: true,
          createdAt: true,
          resultSummary: true
        }
      }
    }
  });

  if (!project) {
    return { ok: false, message: "Supply Chain Design project was not found." };
  }

  const facilitiesMappings = getValidMappings(project.mappings, "FACILITIES", ["facility_id", "facility_name"]);
  const shipmentsMappings = getValidMappings(project.mappings, "SHIPMENTS", [
    "shipment_id",
    "origin_facility_id",
    "destination_id"
  ]);
  const customersMappings = getValidMappings(project.mappings, "CUSTOMERS", [
    "customer_id",
    "customer_name",
    "city",
    "country"
  ]);
  const candidateFacilitiesMappings = getValidMappings(project.mappings, "CANDIDATE_FACILITIES", [
    "candidate_facility_id",
    "candidate_facility_name"
  ]);
  const scenarioLaneCostsMappings = getValidMappings(project.mappings, "SCENARIO_LANE_COSTS", [
    "origin_facility_id",
    "destination_id",
    "cost_per_shipment"
  ]);
  const facilityCostsMappings = getValidMappings(project.mappings, "FACILITY_COSTS", [
    "facility_id",
    "cost_category",
    "annual_cost"
  ]);
  const facilitiesMapping = facilitiesMappings.find((mapping) => mapping.id === facilitiesMappingId) ?? null;
  const shipmentsMapping = shipmentsMappings.find((mapping) => mapping.id === shipmentsMappingId) ?? null;
  const customersMapping = customersMappings.find((mapping) => mapping.id === customersMappingId) ?? null;
  const candidateFacilitiesMapping =
    candidateFacilitiesMappings.find((mapping) => mapping.id === candidateFacilitiesMappingId) ?? null;
  const scenarioLaneCostsMapping = scenarioLaneCostsMappingId
    ? scenarioLaneCostsMappings.find((mapping) => mapping.id === scenarioLaneCostsMappingId) ?? null
    : null;
  const facilityCostsMapping = facilityCostsMappingId
    ? facilityCostsMappings.find((mapping) => mapping.id === facilityCostsMappingId) ?? null
    : null;
  const baselineRun = project.modelRuns[0] ?? null;
  const baselineResult = baselineRun?.resultSummary as Record<string, unknown> | null;
  const baselineRunCreatedAt =
    baselineRun && "createdAt" in baselineRun && baselineRun.createdAt instanceof Date
      ? baselineRun.createdAt.toISOString()
      : null;
  const baselineObservedCost =
    Number(baselineResult?.totalTransportationCost ?? 0) + Number(baselineResult?.totalFacilityOperatingCost ?? 0);

  const missingInputs = [
    facilitiesMapping ? null : "selected FACILITIES mapping",
    shipmentsMapping ? null : "selected SHIPMENTS mapping",
    customersMapping ? null : "selected CUSTOMERS mapping",
    candidateFacilitiesMapping ? null : "selected CANDIDATE_FACILITIES mapping",
    baselineRun ? null : "successful Model 01 baseline",
    scenarioLaneCostsMappingId && !scenarioLaneCostsMapping ? "selected SCENARIO_LANE_COSTS mapping" : null,
    facilityCostsMappingId && !facilityCostsMapping ? "selected FACILITY_COSTS mapping" : null
  ].filter((value): value is string => Boolean(value));

  if (missingInputs.length > 0) {
    return { ok: false, message: `Missing required Model 02 proof input: ${missingInputs.join(" and ")}.` };
  }
  if (!facilitiesMapping || !shipmentsMapping || !customersMapping || !candidateFacilitiesMapping || !baselineRun) {
    return { ok: false, message: "Missing required Model 02 proof input." };
  }

  const inputReferences = {
    baselineRunId,
    baselineObservedCost,
    baselineRunCreatedAt,
    facilities: toScenarioInputReference(facilitiesMapping, facilitiesMappings),
    shipments: toScenarioInputReference(shipmentsMapping, shipmentsMappings),
    customers: toScenarioInputReference(customersMapping, customersMappings),
    candidateFacilities: toScenarioInputReference(candidateFacilitiesMapping, candidateFacilitiesMappings),
    scenarioLaneCosts: scenarioLaneCostsMapping
      ? toScenarioInputReference(scenarioLaneCostsMapping, scenarioLaneCostsMappings)
      : null,
    facilityCosts: facilityCostsMapping ? toScenarioInputReference(facilityCostsMapping, facilityCostsMappings) : null,
    existingFacilityOptions: [],
    candidateFacilityOptions: [],
    selectedExistingFacilityIds,
    selectedCandidateFacilityIds,
    enforceCapacity
  };

  try {
    const resultSummary = runSupplyChainDesignModel02Proof({
      scenarioName,
      baselineRunId,
      baselineObservedCost,
      facilities: toMappedScenarioFile(facilitiesMapping),
      shipments: toMappedScenarioFile(shipmentsMapping),
      customers: toMappedScenarioFile(customersMapping),
      candidateFacilities: toMappedScenarioFile(candidateFacilitiesMapping),
      scenarioLaneCosts: scenarioLaneCostsMapping ? toMappedScenarioFile(scenarioLaneCostsMapping) : null,
      facilityCosts: facilityCostsMapping ? toMappedScenarioFile(facilityCostsMapping) : null,
      selectedExistingFacilityIds,
      selectedCandidateFacilityIds,
      enforceCapacity
    });

    await prisma.supplyChainDesignScenario.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        name: scenarioName,
        status: SupplyChainDesignScenarioStatus.SUCCESS,
        inputReferences,
        selectedFacilities: {
          existing: selectedExistingFacilityIds,
          candidates: selectedCandidateFacilityIds
        },
        baselineRunId,
        resultSummary,
        createdByUserId: context.userId
      }
    });

    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: true, message: "Model 02 proof scenario completed." };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Model 02 proof scenario failed.";
    await prisma.supplyChainDesignScenario.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        name: scenarioName,
        status: SupplyChainDesignScenarioStatus.FAILED,
        inputReferences,
        selectedFacilities: {
          existing: selectedExistingFacilityIds,
          candidates: selectedCandidateFacilityIds
        },
        baselineRunId,
        errorMessage,
        createdByUserId: context.userId
      }
    });

    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: false, message: errorMessage };
  }
}

export async function runSupplyChainDesignThreePlScreeningAction(
  _previousState: SupplyChainDesignScreeningRunState,
  formData: FormData
): Promise<SupplyChainDesignScreeningRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const submittedStudyName = text(formData, "studyName");
  const studyType = text(formData, "studyType") ?? "FIND_BEST_WAREHOUSE_REGION";
  const studyName =
    submittedStudyName ??
    `${studyType === "COMPARE_KNOWN_WAREHOUSE_OPTIONS" ? "Warehouse cost comparison" : "Warehouse location strategy"} ${new Date().toISOString()}`;
  const countryScope = text(formData, "countryScope") ?? "US";
  const weightingMeasure = text(formData, "weightingMeasure") ?? "annual_shipment_count";
  const maximumRegionsToCompare = Number(text(formData, "maximumRegionsToCompare") ?? "2");
  const marketSourceMode =
    text(formData, "marketSourceMode") === "PROJECT_UPLOADED_MARKETS" ? "PROJECT_UPLOADED_MARKETS" : "NEWL_REFERENCE_CATALOGUE";
  const demandPointsMappingId = text(formData, "demandPointsMappingId");
  const logisticsMarketsMappingId = text(formData, "logisticsMarketsMappingId");
  const canadaProvinceMarketMapMappingId = text(formData, "canadaProvinceMarketMapMappingId");
  const providerOptionsMappingId = text(formData, "providerOptionsMappingId");
  const shipmentProfilesMappingId = text(formData, "shipmentProfilesMappingId");
  const outboundRateCacheMappingId = text(formData, "outboundRateCacheMappingId");
  const expectedProviderResultsMappingId = text(formData, "expectedProviderResultsMappingId");

  if (!projectId) {
    return { ok: false, message: "Missing project ID." };
  }
  if (studyType !== "FIND_BEST_WAREHOUSE_REGION" && studyType !== "COMPARE_KNOWN_WAREHOUSE_OPTIONS") {
    return { ok: false, message: "Select a supported 3PL study path." };
  }
  if (!demandPointsMappingId) {
    return { ok: false, message: "Select a DEMAND_POINTS mapping before running the 3PL study." };
  }
  if (studyType === "COMPARE_KNOWN_WAREHOUSE_OPTIONS") {
    const missingProviderInputs = [
      providerOptionsMappingId ? null : "PROVIDER_OPTIONS mapping",
      shipmentProfilesMappingId ? null : "SHIPMENT_PROFILES mapping",
      outboundRateCacheMappingId ? null : "OUTBOUND_RATE_CACHE mapping"
    ].filter((value): value is string => Boolean(value));
    if (missingProviderInputs.length > 0) {
      return { ok: false, message: `Select the required provider-comparison inputs: ${missingProviderInputs.join(", ")}.` };
    }
  }
  if (studyType === "FIND_BEST_WAREHOUSE_REGION" && marketSourceMode === "PROJECT_UPLOADED_MARKETS" && !logisticsMarketsMappingId) {
    return { ok: false, message: "Select a LOGISTICS_MARKETS mapping or use the Newl reference catalogue." };
  }
  if (
    studyType === "FIND_BEST_WAREHOUSE_REGION" &&
    marketSourceMode === "PROJECT_UPLOADED_MARKETS" &&
    (countryScope === "CA" || countryScope === "US_CA") &&
    !canadaProvinceMarketMapMappingId
  ) {
    return { ok: false, message: "Select a CANADA_PROVINCE_MARKET_MAP mapping before running a Canadian screening study." };
  }

  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    select: {
      id: true,
      mappings: {
        where: {
          tableType: {
            in: [
              "DEMAND_POINTS",
              "LOGISTICS_MARKETS",
              "CANADA_PROVINCE_MARKET_MAP",
              "PROVIDER_OPTIONS",
              "SHIPMENT_PROFILES",
              "OUTBOUND_RATE_CACHE",
              "EXPECTED_PROVIDER_RESULTS"
            ]
          }
        },
        orderBy: {
          updatedAt: "desc"
        },
        include: {
          file: {
            select: {
              id: true,
              originalFileName: true,
              fileBytes: true
            }
          }
        }
      }
    }
  });

  if (!project) {
    return { ok: false, message: "Supply Chain Design project was not found." };
  }

  const demandMappings = getValidMappings(project.mappings, "DEMAND_POINTS", [
    "destination_id",
    "postal_or_region_code",
    "country",
    "annual_shipment_count"
  ]);
  const providerDemandMappings = getValidMappings(project.mappings, "DEMAND_POINTS", [
    "destination_id",
    "annual_shipment_count",
    "annual_pallets",
    "shipment_profile_id"
  ]);
  const marketMappings = getValidMappings(project.mappings, "LOGISTICS_MARKETS", [
    "market_id",
    "market_name",
    "state_province",
    "country",
    "latitude",
    "longitude",
    "active_eligible"
  ]);
  const canadaMapMappings = getValidMappings(project.mappings, "CANADA_PROVINCE_MARKET_MAP", [
    "province_code",
    "approved_logistics_market_id",
    "approved_major_city"
  ]);
  const providerOptionsMappings = getValidMappings(project.mappings, "PROVIDER_OPTIONS", [
    "provider_option_id",
    "provider_name",
    "warehouse_postal_code",
    "warehouse_city",
    "warehouse_state_province",
    "warehouse_country"
  ]);
  const shipmentProfilesMappings = getValidMappings(project.mappings, "SHIPMENT_PROFILES", [
    "shipment_profile_id",
    "mode"
  ]);
  const outboundRateCacheMappings = getValidMappings(project.mappings, "OUTBOUND_RATE_CACHE", [
    "provider_option_id",
    "destination_id",
    "shipment_profile_id",
    "cost_per_shipment"
  ]);
  const expectedProviderResultsMappings = getValidMappings(project.mappings, "EXPECTED_PROVIDER_RESULTS", [
    "rank",
    "provider_option_id",
    "provider_name",
    "outbound_cost",
    "warehouse_cost",
    "ocean_cost",
    "inland_to_warehouse_cost",
    "total_annual_cost"
  ]);
  const demandMapping =
    studyType === "COMPARE_KNOWN_WAREHOUSE_OPTIONS"
      ? providerDemandMappings.find((mapping) => mapping.id === demandPointsMappingId) ?? null
      : demandMappings.find((mapping) => mapping.id === demandPointsMappingId) ?? null;
  const marketMapping = logisticsMarketsMappingId
    ? marketMappings.find((mapping) => mapping.id === logisticsMarketsMappingId) ?? null
    : null;
  const canadaMapMapping = canadaProvinceMarketMapMappingId
    ? canadaMapMappings.find((mapping) => mapping.id === canadaProvinceMarketMapMappingId) ?? null
    : null;
  const providerOptionsMapping = providerOptionsMappingId
    ? providerOptionsMappings.find((mapping) => mapping.id === providerOptionsMappingId) ?? null
    : null;
  const shipmentProfilesMapping = shipmentProfilesMappingId
    ? shipmentProfilesMappings.find((mapping) => mapping.id === shipmentProfilesMappingId) ?? null
    : null;
  const outboundRateCacheMapping = outboundRateCacheMappingId
    ? outboundRateCacheMappings.find((mapping) => mapping.id === outboundRateCacheMappingId) ?? null
    : null;
  const expectedProviderResultsMapping = expectedProviderResultsMappingId
    ? expectedProviderResultsMappings.find((mapping) => mapping.id === expectedProviderResultsMappingId) ?? null
    : null;

  if (
    studyType === "FIND_BEST_WAREHOUSE_REGION" &&
    (!demandMapping ||
      (marketSourceMode === "PROJECT_UPLOADED_MARKETS" && !marketMapping) ||
      (canadaProvinceMarketMapMappingId && !canadaMapMapping))
  ) {
    return { ok: false, message: "Selected 3PL screening mappings were not found for this project and tenant." };
  }
  if (
    studyType === "COMPARE_KNOWN_WAREHOUSE_OPTIONS" &&
    (!demandMapping ||
      !providerOptionsMapping ||
      !shipmentProfilesMapping ||
      !outboundRateCacheMapping ||
      (expectedProviderResultsMappingId && !expectedProviderResultsMapping))
  ) {
    const preciseError =
      describeSelectedMappingProblem(project.mappings, demandPointsMappingId, "DEMAND_POINTS", [
        "destination_id",
        "annual_shipment_count",
        "annual_pallets",
        "shipment_profile_id"
      ]) ??
      describeSelectedMappingProblem(project.mappings, providerOptionsMappingId, "PROVIDER_OPTIONS", [
        "provider_option_id",
        "provider_name",
        "warehouse_postal_code",
        "warehouse_city",
        "warehouse_state_province",
        "warehouse_country"
      ]) ??
      describeSelectedMappingProblem(project.mappings, shipmentProfilesMappingId, "SHIPMENT_PROFILES", [
        "shipment_profile_id",
        "mode"
      ]) ??
      describeSelectedMappingProblem(project.mappings, outboundRateCacheMappingId, "OUTBOUND_RATE_CACHE", [
        "provider_option_id",
        "destination_id",
        "shipment_profile_id",
        "cost_per_shipment"
      ]) ??
      (expectedProviderResultsMappingId
        ? describeSelectedMappingProblem(project.mappings, expectedProviderResultsMappingId, "EXPECTED_PROVIDER_RESULTS", [
            "rank",
            "provider_option_id",
            "provider_name",
            "outbound_cost",
            "warehouse_cost",
            "ocean_cost",
            "inland_to_warehouse_cost",
            "total_annual_cost"
          ])
        : null);
    return {
      ok: false,
      message: preciseError ?? "Selected provider-comparison mappings were not found for this project and tenant."
    };
  }
  if (!demandMapping) {
    return { ok: false, message: "Selected DEMAND_POINTS mapping was not found for this project and tenant." };
  }
  if (
    studyType === "FIND_BEST_WAREHOUSE_REGION" &&
    (countryScope === "CA" || countryScope === "US_CA") &&
    !hasRequiredProofFields(toFieldMappings(demandMapping.fieldMappings), ["state_province"])
  ) {
    return { ok: false, message: "Map state_province to the Canadian province field before running a Canadian screening study." };
  }

  const inputReferences = {
    studyType,
    marketSourceMode,
    demandPoints: toScenarioInputReference(demandMapping, demandMappings),
    logisticsMarkets: marketMapping ? toScenarioInputReference(marketMapping, marketMappings) : null,
    canadaProvinceMarketMap: canadaMapMapping ? toScenarioInputReference(canadaMapMapping, canadaMapMappings) : null,
    providerOptions: providerOptionsMapping ? toScenarioInputReference(providerOptionsMapping, providerOptionsMappings) : null,
    shipmentProfiles: shipmentProfilesMapping ? toScenarioInputReference(shipmentProfilesMapping, shipmentProfilesMappings) : null,
    outboundRateCache: outboundRateCacheMapping
      ? toScenarioInputReference(outboundRateCacheMapping, outboundRateCacheMappings)
      : null,
    expectedProviderResults: expectedProviderResultsMapping
      ? toScenarioInputReference(expectedProviderResultsMapping, expectedProviderResultsMappings)
      : null
  };

  try {
    const resultSummary =
      studyType === "COMPARE_KNOWN_WAREHOUSE_OPTIONS"
        ? runSupplyChainDesignProviderComparison({
            studyName: studyName || "Compare known warehouse options",
            demandPoints: toMappedScreeningFile(demandMapping),
            providerOptions: toMappedScreeningFile(providerOptionsMapping!),
            shipmentProfiles: toMappedScreeningFile(shipmentProfilesMapping!),
            outboundRateCache: toMappedScreeningFile(outboundRateCacheMapping!),
            expectedProviderResults: expectedProviderResultsMapping
              ? toMappedScreeningFile(expectedProviderResultsMapping)
              : null
          })
        : runSupplyChainDesignThreePlScreening({
            studyName,
            studyType: "FIND_BEST_WAREHOUSE_REGION",
            countryScope: countryScope === "CA" ? "CA" : countryScope === "US_CA" ? "US_CA" : "US",
            weightingMeasure: weightingMeasure === "annual_shipment_count" ? "annual_shipment_count" : "annual_shipment_count",
            maximumRegionsToCompare: Number.isFinite(maximumRegionsToCompare) ? maximumRegionsToCompare : 2,
            marketSourceMode,
            demandPoints: toMappedScreeningFile(demandMapping),
            logisticsMarkets: marketMapping ? toMappedScreeningFile(marketMapping) : null,
            canadaProvinceMarketMap: canadaMapMapping ? toMappedScreeningFile(canadaMapMapping) : null
          });

    const createdRun = await prisma.supplyChainDesignScreeningRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        inputReferences,
        resultSummary,
        createdByUserId: context.userId
      }
    });
    const savedRun = await prisma.supplyChainDesignScreeningRun.findUnique({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: createdRun.id
        }
      },
      select: { id: true }
    });
    if (!savedRun) {
      return { ok: false, message: "3PL screening run was created but could not be retrieved." };
    }
    revalidatePath(`/supply-chain-design/${projectId}`);
    return {
      ok: true,
      message:
        studyType === "COMPARE_KNOWN_WAREHOUSE_OPTIONS"
          ? "3PL warehouse option comparison completed."
          : "3PL location screening completed."
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : studyType === "COMPARE_KNOWN_WAREHOUSE_OPTIONS"
          ? "3PL warehouse option comparison failed."
          : "3PL location screening failed.";
    await prisma.supplyChainDesignScreeningRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.FAILED,
        inputReferences,
        errorMessage,
        createdByUserId: context.userId
      }
    });
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: false, message: errorMessage };
  }
}

export async function generateSupplyChainDesignCandidateLtlRatePreparationAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const shipmentsMappingId = text(formData, "shipmentsMappingId");
  const candidateFacilitiesMappingId = text(formData, "candidateFacilitiesMappingId");

  if (!projectId) {
    return { ok: false, message: "Missing project ID." };
  }
  if (!shipmentsMappingId || !candidateFacilitiesMappingId) {
    return {
      ok: false,
      message: "Select Historical Shipments and Candidate Warehouses and Proposed Costs before preparing LTL rates."
    };
  }

  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    select: {
      id: true,
      mappings: {
        where: {
          tableType: {
            in: ["SHIPMENTS", "CANDIDATE_FACILITIES"]
          }
        },
        orderBy: {
          updatedAt: "desc"
        },
        include: {
          file: {
            select: {
              id: true,
              originalFileName: true,
              fileBytes: true
            }
          }
        }
      }
    }
  });

  if (!project) {
    return { ok: false, message: "Supply Chain Design project was not found." };
  }

  const shipmentsMappings = getValidMappings(project.mappings, "SHIPMENTS", ["origin_facility_id"]);
  const candidateFacilitiesMappings = getValidMappings(project.mappings, "CANDIDATE_FACILITIES", [
    "candidate_facility_id",
    "candidate_facility_name",
    "postal_code",
    "candidate_country"
  ]);
  const shipmentsMapping = shipmentsMappings.find((mapping) => mapping.id === shipmentsMappingId) ?? null;
  const candidateFacilitiesMapping =
    candidateFacilitiesMappings.find((mapping) => mapping.id === candidateFacilitiesMappingId) ?? null;

  const missingInputs = [
    !shipmentsMapping
      ? describeSelectedMappingProblem(project.mappings, shipmentsMappingId, "SHIPMENTS", ["origin_facility_id"])
      : null,
    !candidateFacilitiesMapping
      ? describeSelectedMappingProblem(project.mappings, candidateFacilitiesMappingId, "CANDIDATE_FACILITIES", [
          "candidate_facility_id",
          "candidate_facility_name",
          "postal_code",
          "candidate_country"
        ])
      : null
  ].filter((value): value is string => Boolean(value));

  if (missingInputs.length > 0) {
    return { ok: false, message: missingInputs.join(" ") };
  }
  if (!shipmentsMapping || !candidateFacilitiesMapping) {
    return { ok: false, message: "Missing required Candidate LTL Rate Preparation input." };
  }

  const inputReferences = {
    shipments: toScenarioInputReference(shipmentsMapping, shipmentsMappings),
    candidateFacilities: toScenarioInputReference(candidateFacilitiesMapping, candidateFacilitiesMappings)
  };

  try {
    const resultSummary = prepareSupplyChainDesignCandidateLtlRateRequests({
      tenantId: context.tenantId,
      projectId,
      shipments: toMappedScenarioFile(shipmentsMapping),
      candidateFacilities: toMappedScenarioFile(candidateFacilitiesMapping)
    });

    const createdRun = await prisma.supplyChainDesignLtlRatePreparationRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        inputReferences,
        resultSummary,
        createdByUserId: context.userId
      }
    });

    const savedRun = await prisma.supplyChainDesignLtlRatePreparationRun.findUnique({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: createdRun.id
        }
      },
      select: {
        id: true
      }
    });

    if (!savedRun) {
      return { ok: false, message: "Candidate LTL rate preparation was created but could not be retrieved." };
    }

    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: true, message: "Candidate LTL rate preparation generated.", runId: createdRun.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Candidate LTL rate preparation failed.";

    await prisma.supplyChainDesignLtlRatePreparationRun.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        status: SupplyChainDesignModelRunStatus.FAILED,
        inputReferences,
        errorMessage,
        createdByUserId: context.userId
      }
    });

    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: false, message: errorMessage };
  }
}

export async function startSupplyChainDesignLtlRateBatchAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  let preparationRunId = text(formData, "preparationRunId");
  if (!projectId || !preparationRunId) {
    return { ok: false, message: "Select a reviewed LTL preparation before requesting 7L rates." };
  }

  try {
    const comparisonSetup = await buildSupplyChainDesignLtlComparisonSetup(context, projectId, formData);
    let batch: Awaited<ReturnType<typeof createSupplyChainDesignLtlRateBatch>>;
    try {
      batch = await createSupplyChainDesignLtlRateBatch(context, projectId, preparationRunId, comparisonSetup);
    } catch (error) {
      if (
        preparationRunId &&
        error instanceof Error &&
        error.message === "Selected LTL preparation is incompatible with the current candidate selection."
      ) {
        const preparationResponse = await generateSupplyChainDesignCandidateLtlRatePreparationAction(
          { ok: false, message: "" },
          formData
        );
        if (!preparationResponse.ok || !preparationResponse.runId) {
          return preparationResponse;
        }
        preparationRunId = preparationResponse.runId;
        batch = await createSupplyChainDesignLtlRateBatch(context, projectId, preparationRunId, comparisonSetup);
      } else {
        throw error;
      }
    }
    if (batch.shouldProcess) {
      // This is still in-process work; a server restart can stop the active rate batch until a durable worker is added.
      queueMicrotask(() => {
        void runSupplyChainDesignLtlRateBatch(
          { tenantId: context.tenantId, userId: context.userId },
          batch.jobId,
          batch.account,
          batch.input
        );
      });
    }
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: true, message: networkDesignBatchMessage(batch.disposition), runId: batch.jobId };
  } catch (error) {
    if (error instanceof Error && error.message === "The configured live 7L account is not available.") {
      return { ok: false, message: error.message };
    }
    if (error instanceof Error && error.message === "Select at least one candidate warehouse to evaluate.") {
      return { ok: false, message: error.message };
    }
    console.error(error);
    return { ok: false, message: "Network Design could not be started." };
  }
}

export async function runSupplyChainDesignNetworkDesignAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  if (!projectId) {
    return { ok: false, message: "Missing project ID." };
  }

  let preparationRunId = text(formData, "preparationRunId");
  if (!preparationRunId) {
    const preparationResponse = await generateSupplyChainDesignCandidateLtlRatePreparationAction(
      { ok: false, message: "" },
      formData
    );
    if (!preparationResponse.ok || !preparationResponse.runId) {
      return preparationResponse;
    }
    preparationRunId = preparationResponse.runId;
  }

  try {
    const comparisonSetup = await buildSupplyChainDesignLtlComparisonSetup(context, projectId, formData);
    let batch: Awaited<ReturnType<typeof createSupplyChainDesignLtlRateBatch>>;
    try {
      batch = await createSupplyChainDesignLtlRateBatch(context, projectId, preparationRunId, comparisonSetup);
    } catch (error) {
      if (
        preparationRunId &&
        error instanceof Error &&
        error.message === "Selected LTL preparation is incompatible with the current candidate selection."
      ) {
        const preparationResponse = await generateSupplyChainDesignCandidateLtlRatePreparationAction(
          { ok: false, message: "" },
          formData
        );
        if (!preparationResponse.ok || !preparationResponse.runId) {
          return preparationResponse;
        }
        preparationRunId = preparationResponse.runId;
        batch = await createSupplyChainDesignLtlRateBatch(context, projectId, preparationRunId, comparisonSetup);
      } else {
        throw error;
      }
    }
    if (batch.shouldProcess) {
      queueMicrotask(() => {
        void runSupplyChainDesignLtlRateBatch(
          { tenantId: context.tenantId, userId: context.userId },
          batch.jobId,
          batch.account,
          batch.input
        );
      });
    }
    revalidatePath(`/supply-chain-design/${projectId}`);
    return {
      ok: true,
      message: networkDesignBatchMessage(batch.disposition),
      runId: batch.jobId,
      runStatus: batch.reused ? "SUCCESS" : "QUEUED",
      requestTotal: batch.input.requests.length
    };
  } catch (error) {
    if (error instanceof Error && error.message === "The configured live 7L account is not available.") {
      return { ok: false, message: error.message };
    }
    if (error instanceof Error && error.message === "Select at least one candidate warehouse to evaluate.") {
      return { ok: false, message: error.message };
    }
    console.error(error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2022" || error.message.includes("selectedQuoteJson"))
    ) {
      console.error(error);
      return {
        ok: false,
        message: "The LTL rating data could not be loaded. Confirm that the latest database migration has been applied."
      };
    }
    return { ok: false, message: "Network Design could not be started." };
  }
}

function networkDesignBatchMessage(disposition: "STARTED" | "RESUMED" | "REUSED_COMPLETED") {
  if (disposition === "RESUMED") return "Network Design rate run resumed.";
  if (disposition === "REUSED_COMPLETED") return "Completed rates from the existing Network Design run were reused.";
  return "Network Design rate run started.";
}

function networkScenarioComparisonMessage(phase: string) {
  if (phase === "COMPLETE") return "Network Scenario Comparison completed.";
  if (phase === "INCOMPLETE") return "Network Scenario Comparison needs more input before totals are complete.";
  if (phase === "RATING") return "Network Scenario Comparison rate work started.";
  if (phase === "RATES_REQUIRED") return "Network Scenario Comparison needs missing exact rates.";
  if (phase === "READY_FOR_COST_EVALUATION") return "Network Scenario Comparison is ready for cost evaluation.";
  if (phase === "FAILED") return "Network Scenario Comparison failed.";
  return "Network Scenario Comparison started.";
}

export async function saveSupplyChainDesignManualLtlRateAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);
  const projectId = text(formData, "projectId");
  const batchId = text(formData, "batchId");
  const rateRequestKey = text(formData, "rateRequestKey");
  const reason = text(formData, "reason") ?? "";
  const totalRate = Number.parseFloat(text(formData, "totalRate") ?? "");
  if (!projectId || !batchId || !rateRequestKey || !Number.isFinite(totalRate)) {
    return { ok: false, message: "Manual total rate, batch and row are required." };
  }
  try {
    await saveSupplyChainDesignManualLtlRate(context, batchId, rateRequestKey, totalRate, reason);
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: true, message: "Manual LTL rate saved.", runId: batchId };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Manual LTL rate could not be saved." };
  }
}

export async function excludeSupplyChainDesignLtlRateRowAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);
  const projectId = text(formData, "projectId");
  const batchId = text(formData, "batchId");
  const rateRequestKey = text(formData, "rateRequestKey");
  const reason = text(formData, "reason") ?? "";
  if (!projectId || !batchId || !rateRequestKey) {
    return { ok: false, message: "Batch, row and exclusion reason are required." };
  }
  try {
    await excludeSupplyChainDesignLtlRateRow(context, batchId, rateRequestKey, reason);
    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: true, message: "LTL rate row excluded.", runId: batchId };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "LTL rate row could not be excluded." };
  }
}

export async function runSupplyChainDesignModel02OptimizerAction(
  _previousState: SupplyChainDesignModelRunState,
  formData: FormData
): Promise<SupplyChainDesignModelRunState> {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  await requireMutationAccess(context);

  const projectId = text(formData, "projectId");
  const scenarioName = text(formData, "optimizerName") ?? "Optimized network";
  const baselineRunId = text(formData, "baselineRunId");
  const facilitiesMappingId = text(formData, "facilitiesMappingId");
  const shipmentsMappingId = text(formData, "shipmentsMappingId");
  const customersMappingId = text(formData, "customersMappingId");
  const candidateFacilitiesMappingId = text(formData, "candidateFacilitiesMappingId");
  const scenarioLaneCostsMappingId = text(formData, "scenarioLaneCostsMappingId");
  const facilityCostsMappingId = text(formData, "facilityCostsMappingId");
  const mandatoryExistingFacilityIds = stringValues(formData, "mandatoryExistingFacilityIds");
  const permittedExistingFacilityIds = stringValues(formData, "permittedExistingFacilityIds");
  const permittedCandidateFacilityIds = stringValues(formData, "permittedCandidateFacilityIds");
  const prohibitedCandidateFacilityIds = stringValues(formData, "prohibitedCandidateFacilityIds");
  const minimumOpenFacilities = positiveInteger(text(formData, "minimumOpenFacilities") ?? "1");
  const maximumOpenFacilities = positiveInteger(text(formData, "maximumOpenFacilities") ?? "1");
  const enforceCapacity = formData.get("optimizerEnforceCapacity") === "on";
  const solverTypeValue = text(formData, "solverType");
  const solverType = solverTypeValue === "MATHEMATICAL_PROGRAMMING" ? "MATHEMATICAL_PROGRAMMING" : "EXACT_ENUMERATION";

  if (!projectId) {
    return { ok: false, message: "Missing project ID." };
  }
  if (!baselineRunId) {
    return { ok: false, message: "Select a successful Model 01 baseline before running Model 02 optimizer." };
  }

  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    select: {
      id: true,
      mappings: {
        where: {
          tableType: {
            in: [
              "FACILITIES",
              "SHIPMENTS",
              "CUSTOMERS",
              "CANDIDATE_FACILITIES",
              "SCENARIO_LANE_COSTS",
              "FACILITY_COSTS"
            ]
          }
        },
        include: {
          file: {
            select: {
              id: true,
              originalFileName: true,
              fileBytes: true
            }
          }
        }
      },
      modelRuns: {
        where: {
          id: baselineRunId,
          status: SupplyChainDesignModelRunStatus.SUCCESS
        },
        take: 1
      }
    }
  });

  if (!project) {
    return { ok: false, message: "Supply Chain Design project was not found." };
  }

  const facilitiesMappings = getValidMappings(project.mappings, "FACILITIES", ["facility_id", "facility_name"]);
  const shipmentsMappings = getValidMappings(project.mappings, "SHIPMENTS", [
    "shipment_id",
    "origin_facility_id",
    "destination_id"
  ]);
  const customersMappings = getValidMappings(project.mappings, "CUSTOMERS", [
    "customer_id",
    "customer_name",
    "city",
    "country"
  ]);
  const candidateFacilitiesMappings = getValidMappings(project.mappings, "CANDIDATE_FACILITIES", [
    "candidate_facility_id",
    "candidate_facility_name"
  ]);
  const scenarioLaneCostsMappings = getValidMappings(project.mappings, "SCENARIO_LANE_COSTS", [
    "origin_facility_id",
    "destination_id",
    "cost_per_shipment"
  ]);
  const facilityCostsMappings = getValidMappings(project.mappings, "FACILITY_COSTS", [
    "facility_id",
    "cost_category",
    "annual_cost"
  ]);
  const facilitiesMapping = facilitiesMappings.find((mapping) => mapping.id === facilitiesMappingId) ?? null;
  const shipmentsMapping = shipmentsMappings.find((mapping) => mapping.id === shipmentsMappingId) ?? null;
  const customersMapping = customersMappings.find((mapping) => mapping.id === customersMappingId) ?? null;
  const candidateFacilitiesMapping =
    candidateFacilitiesMappings.find((mapping) => mapping.id === candidateFacilitiesMappingId) ?? null;
  const scenarioLaneCostsMapping = scenarioLaneCostsMappingId
    ? scenarioLaneCostsMappings.find((mapping) => mapping.id === scenarioLaneCostsMappingId) ?? null
    : null;
  const facilityCostsMapping = facilityCostsMappingId
    ? facilityCostsMappings.find((mapping) => mapping.id === facilityCostsMappingId) ?? null
    : null;
  const baselineRun = project.modelRuns[0] ?? null;
  const baselineResult = baselineRun?.resultSummary as Record<string, unknown> | null;
  const baselineRunCreatedAt =
    baselineRun && "createdAt" in baselineRun && baselineRun.createdAt instanceof Date
      ? baselineRun.createdAt.toISOString()
      : null;
  const baselineObservedCost =
    Number(baselineResult?.totalTransportationCost ?? 0) + Number(baselineResult?.totalFacilityOperatingCost ?? 0);
  const missingInputs = [
    facilitiesMapping ? null : "selected FACILITIES mapping",
    shipmentsMapping ? null : "selected SHIPMENTS mapping",
    customersMapping ? null : "selected CUSTOMERS mapping",
    candidateFacilitiesMapping ? null : "selected CANDIDATE_FACILITIES mapping",
    baselineRun ? null : "successful Model 01 baseline",
    scenarioLaneCostsMappingId && !scenarioLaneCostsMapping ? "selected SCENARIO_LANE_COSTS mapping" : null,
    facilityCostsMappingId && !facilityCostsMapping ? "selected FACILITY_COSTS mapping" : null
  ].filter((value): value is string => Boolean(value));

  if (missingInputs.length > 0) {
    return { ok: false, message: `Missing required Model 02 optimizer input: ${missingInputs.join(" and ")}.` };
  }
  if (!facilitiesMapping || !shipmentsMapping || !customersMapping || !candidateFacilitiesMapping || !baselineRun) {
    return { ok: false, message: "Missing required Model 02 optimizer input." };
  }

  const inputReferences = {
    baselineRunId,
    baselineObservedCost,
    baselineRunCreatedAt,
    facilities: toScenarioInputReference(facilitiesMapping, facilitiesMappings),
    shipments: toScenarioInputReference(shipmentsMapping, shipmentsMappings),
    customers: toScenarioInputReference(customersMapping, customersMappings),
    candidateFacilities: toScenarioInputReference(candidateFacilitiesMapping, candidateFacilitiesMappings),
    scenarioLaneCosts: scenarioLaneCostsMapping
      ? toScenarioInputReference(scenarioLaneCostsMapping, scenarioLaneCostsMappings)
      : null,
    facilityCosts: facilityCostsMapping ? toScenarioInputReference(facilityCostsMapping, facilityCostsMappings) : null,
    mandatoryExistingFacilityIds,
    permittedExistingFacilityIds,
    permittedCandidateFacilityIds,
    prohibitedCandidateFacilityIds,
    minimumOpenFacilities,
    maximumOpenFacilities,
    enforceCapacity,
    solverType
  };

  try {
    const resultSummary = runSupplyChainDesignModel02Optimizer({
      scenarioName,
      baselineRunId,
      baselineObservedCost,
      ...(baselineRunCreatedAt ? { baselineRunCreatedAt } : {}),
      facilities: toMappedScenarioFile(facilitiesMapping),
      shipments: toMappedScenarioFile(shipmentsMapping),
      customers: toMappedScenarioFile(customersMapping),
      candidateFacilities: toMappedScenarioFile(candidateFacilitiesMapping),
      scenarioLaneCosts: scenarioLaneCostsMapping ? toMappedScenarioFile(scenarioLaneCostsMapping) : null,
      facilityCosts: facilityCostsMapping ? toMappedScenarioFile(facilityCostsMapping) : null,
      mandatoryExistingFacilityIds,
      permittedExistingFacilityIds,
      permittedCandidateFacilityIds,
      prohibitedCandidateFacilityIds,
      minimumOpenFacilities,
      maximumOpenFacilities,
      enforceCapacity,
      solverType
    });
    assertSupplyChainDesignModel02OptimizerConsistency(resultSummary);

    await prisma.supplyChainDesignScenario.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        name: scenarioName,
        status: SupplyChainDesignScenarioStatus.SUCCESS,
        inputReferences,
        selectedFacilities: {
          existing: resultSummary.selectedExistingFacilityIds,
          candidates: resultSummary.selectedCandidateFacilityIds,
          optimizer: true
        },
        baselineRunId,
        resultSummary,
        createdByUserId: context.userId
      }
    });

    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: true, message: "Model 02 optimizer completed." };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Model 02 optimizer failed.";
    await prisma.supplyChainDesignScenario.create({
      data: {
        tenantId: context.tenantId,
        projectId,
        name: scenarioName,
        status: SupplyChainDesignScenarioStatus.FAILED,
        inputReferences,
        selectedFacilities: {
          existing: [],
          candidates: [],
          optimizer: true
        },
        baselineRunId,
        errorMessage,
        createdByUserId: context.userId
      }
    });

    revalidatePath(`/supply-chain-design/${projectId}`);
    return { ok: false, message: errorMessage };
  }
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function stringValues(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
}

function positiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
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
      const sourceColumn = candidate.sourceColumn;

      return {
        standardField: String(candidate.standardField ?? ""),
        sourceColumn: typeof sourceColumn === "string" ? sourceColumn : null,
        requirement: candidate.requirement === "OPTIONAL" ? "OPTIONAL" : "REQUIRED"
      };
    })
    .filter((item): item is SupplyChainDesignFieldMapping => Boolean(item?.standardField));
}

function toMappedSourceFields(value: unknown): Array<{ standardField: string; sourceColumn: string }> {
  return toFieldMappings(value).filter(
    (mapping): mapping is SupplyChainDesignFieldMapping & { sourceColumn: string } => Boolean(mapping.sourceColumn)
  );
}

function placeholderMappedFile(
  mapping: {
    fileId: string;
    id: string;
    file: { fileBytes: Buffer };
  },
  tableType: "FACILITIES" | "SHIPMENTS"
) {
  return {
    fileId: mapping.fileId,
    mappingId: mapping.id,
    tableType,
    fileBytes: Buffer.from(mapping.file.fileBytes),
    fieldMappings: []
  };
}

function getValidMappings<
  TMapping extends {
    tableType: string;
    fieldMappings: unknown;
  }
>(mappings: TMapping[], tableType: string, standardFields: string[]) {
  return mappings.filter(
    (mapping) =>
      mapping.tableType === tableType && hasRequiredProofFields(toFieldMappings(mapping.fieldMappings), standardFields)
  );
}

function hasRequiredProofFields(fieldMappings: SupplyChainDesignFieldMapping[], standardFields: string[]) {
  return standardFields.every((standardField) =>
    fieldMappings.some((mapping) => mapping.standardField === standardField && mapping.sourceColumn)
  );
}

function describeSelectedMappingProblem<
  TMapping extends {
    id: string;
    tableType: string;
    fieldMappings: unknown;
    file?: unknown;
  }
>(mappings: TMapping[], mappingId: string | null, expectedTableType: string, requiredFields: string[]) {
  if (!mappingId) {
    return `Select a ${expectedTableType} mapping before running provider comparison.`;
  }
  const selected = mappings.find((mapping) => mapping.id === mappingId);
  if (!selected) {
    return `Selected ${expectedTableType} mapping ${mappingId} was not found for this project and tenant.`;
  }
  if (selected.tableType !== expectedTableType) {
    return `Selected mapping ${mappingId} has table type ${selected.tableType}; expected ${expectedTableType}.`;
  }
  if (!selected.file) {
    return `Selected ${expectedTableType} mapping ${mappingId} has no attached uploaded file.`;
  }
  const fields = toFieldMappings(selected.fieldMappings);
  const missingFields = requiredFields.filter(
    (requiredField) => !fields.some((field) => field.standardField === requiredField && field.sourceColumn)
  );
  if (missingFields.length > 0) {
    return `Selected ${expectedTableType} mapping ${mappingId} is missing required mapped field(s): ${missingFields.join(", ")}.`;
  }
  return null;
}

async function buildSupplyChainDesignLtlComparisonSetup(
  context: { tenantId: string },
  projectId: string,
  formData: FormData
): Promise<SupplyChainDesignLtlComparisonSetup> {
  const facilitiesMappingId = text(formData, "facilitiesMappingId");
  const candidateFacilitiesMappingId = text(formData, "candidateFacilitiesMappingId");
  if (!facilitiesMappingId && !candidateFacilitiesMappingId) {
    return {
      scenarioSelections: [],
      currentFacilities: [],
      candidateFacilities: []
    };
  }
  if (!facilitiesMappingId || !candidateFacilitiesMappingId) {
    throw new Error("Select Historical Shipments, Candidate Warehouses and Current Facilities before running Network Design.");
  }

  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: context.tenantId,
        id: projectId
      }
    },
    include: {
      mappings: {
        where: {
          id: {
            in: [facilitiesMappingId, candidateFacilitiesMappingId]
          }
        },
        include: { file: true }
      }
    }
  });

  if (!project) {
    throw new Error("Supply Chain Design project was not found.");
  }

  const facilitiesMapping = project.mappings.find((mapping) => mapping.id === facilitiesMappingId);
  const candidateFacilitiesMapping = project.mappings.find((mapping) => mapping.id === candidateFacilitiesMappingId);
  if (!facilitiesMapping || facilitiesMapping.tableType !== "FACILITIES") {
    throw new Error("Selected Current Facilities and Warehouse Costs mapping was not found or has the wrong table type.");
  }
  if (!candidateFacilitiesMapping || candidateFacilitiesMapping.tableType !== "CANDIDATE_FACILITIES") {
    throw new Error("Selected Candidate Warehouses and Proposed Costs mapping was not found or has the wrong table type.");
  }

  const currentFacilities = readNetworkDesignCurrentFacilities(facilitiesMapping);
  const allCandidateFacilities = readNetworkDesignCandidateFacilities(candidateFacilitiesMapping);
  const selectedCandidateIds = new Set(stringValues(formData, "candidateFacilityIds"));
  const candidateSelectionSubmitted = formData.get("candidateSelectionSubmitted") === "1";
  const candidateFacilities = candidateSelectionSubmitted
    ? allCandidateFacilities.filter((candidate) => selectedCandidateIds.has(candidate.facilityId))
    : allCandidateFacilities;

  if (candidateSelectionSubmitted && candidateFacilities.length === 0) {
    throw new Error("Select at least one candidate warehouse to evaluate.");
  }

  const scenarioSelections = candidateFacilities.map((candidate) => {
    return {
      candidateFacilityId: candidate.facilityId,
      scenarioType: "REPLACE" as const,
      comparedCurrentFacilityIds: []
    };
  });

  return {
    scenarioSelections,
    currentFacilities,
    candidateFacilities
  };
}

function readNetworkDesignCurrentFacilities(mapping: {
  fieldMappings: unknown;
  file: { fileBytes: Uint8Array; originalFileName?: string | null };
}) {
  const { headers, rows } = readMappedCsv(mapping.file.fileBytes);
  const fieldMappings = toFieldMappings(mapping.fieldMappings);
  const columns = toColumnIndex(fieldMappings, headers);
  const facilityIdIndex = columns.get("facility_id");
  const facilityNameIndex = columns.get("facility_name");
  const annualCostIndex = columns.get("annual_facility_warehouse_cost") ?? columns.get("annual_fixed_cost");
  if (facilityIdIndex === undefined || facilityNameIndex === undefined) {
    throw new Error("Current Facilities and Warehouse Costs mapping must include facility ID and facility name.");
  }
  return rows
    .map((row) => ({
      facilityId: row[facilityIdIndex]?.trim() ?? "",
      facilityName: row[facilityNameIndex]?.trim() ?? "",
      annualFacilityCost: parseCurrencyNumber(annualCostIndex === undefined ? "" : row[annualCostIndex])
    }))
    .filter((facility) => facility.facilityId);
}

function readNetworkDesignCandidateFacilities(mapping: {
  fieldMappings: unknown;
  file: { fileBytes: Uint8Array; originalFileName?: string | null };
}) {
  const { headers, rows } = readMappedCsv(mapping.file.fileBytes);
  const fieldMappings = toFieldMappings(mapping.fieldMappings);
  const columns = toColumnIndex(fieldMappings, headers);
  const facilityIdIndex = columns.get("candidate_facility_id");
  const facilityNameIndex = columns.get("candidate_facility_name");
  const annualCostIndex = columns.get("annual_fixed_cost") ?? columns.get("annual_facility_warehouse_cost");
  if (facilityIdIndex === undefined || facilityNameIndex === undefined) {
    throw new Error("Candidate Warehouses and Proposed Costs mapping must include candidate facility ID and candidate name.");
  }
  return rows
    .map((row) => ({
      facilityId: row[facilityIdIndex]?.trim() ?? "",
      facilityName: row[facilityNameIndex]?.trim() ?? "",
      annualFixedCost: parseCurrencyNumber(annualCostIndex === undefined ? "" : row[annualCostIndex])
    }))
    .filter((facility) => facility.facilityId);
}

function readMappedCsv(fileBytes: Uint8Array) {
  const parsedRows = parseCsvRows(Buffer.from(fileBytes).toString("utf8"));
  return {
    headers: parsedRows[0] ?? [],
    rows: parsedRows.slice(1)
  };
}

function toColumnIndex(fieldMappings: SupplyChainDesignFieldMapping[], headers: string[]) {
  const headerMap = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
  const columns = new Map<string, number>();
  for (const field of fieldMappings) {
    if (!field.sourceColumn) continue;
    const index = headerMap.get(normalizeHeader(field.sourceColumn));
    if (index !== undefined) {
      columns.set(field.standardField, index);
    }
  }
  return columns;
}

function parseCurrencyNumber(value: string | undefined) {
  if (!value?.trim()) return 0;
  const parsed = Number(value.replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function toScenarioInputReference<
  TMapping extends {
    id: string;
    fileId: string;
    updatedAt: Date;
    file: { originalFileName: string };
  }
>(mapping: TMapping, mappings: TMapping[]) {
  return {
    fileId: mapping.fileId,
    fileName: mapping.file.originalFileName,
    mappingId: mapping.id,
    mappingUpdatedAt: mapping.updatedAt.toISOString(),
    candidateFiles: mappings.map((candidate) => ({
      fileId: candidate.fileId,
      fileName: candidate.file.originalFileName,
      mappingId: candidate.id,
      mappingUpdatedAt: candidate.updatedAt.toISOString(),
      selected: candidate.id === mapping.id
    }))
  };
}

function toMappedScenarioFile(mapping: {
  fileId: string;
  id: string;
  tableType: SupplyChainDesignTableTypeValue;
  file: { originalFileName?: string; fileBytes: Uint8Array };
  fieldMappings: unknown;
}) {
  return {
    fileId: mapping.fileId,
    mappingId: mapping.id,
    fileName: mapping.file.originalFileName ?? "Uploaded CSV",
    tableType: mapping.tableType,
    fileBytes: Buffer.from(mapping.file.fileBytes),
    fieldMappings: toFieldMappings(mapping.fieldMappings)
  };
}

async function buildNetworkScenarioComparisonOrchestrationInput(input: {
  context: Awaited<ReturnType<typeof getAuthenticatedContext>>;
  projectId: string;
  shipmentsMapping: {
    fileId: string;
    id: string;
    tableType: SupplyChainDesignTableTypeValue;
    updatedAt: Date;
    fieldMappings: unknown;
    file: { originalFileName: string; fileBytes: Uint8Array; contentHash?: string | null };
  };
  facilitiesMapping: {
    fileId: string;
    id: string;
    tableType: SupplyChainDesignTableTypeValue;
    updatedAt: Date;
    fieldMappings: unknown;
    file: { originalFileName: string; fileBytes: Uint8Array; contentHash?: string | null };
  };
  candidateFacilitiesMapping: {
    fileId: string;
    id: string;
    tableType: SupplyChainDesignTableTypeValue;
    updatedAt: Date;
    fieldMappings: unknown;
    file: { originalFileName: string; fileBytes: Uint8Array; contentHash?: string | null };
  };
  scenarioAName: string;
  scenarioBName: string;
  scenarioAFacilityOptionIds: string[];
  scenarioBFacilityOptionIds: string[];
  cadToUsdRate: number | null;
  submittedNetworkScenarioComparison?: SupplyChainDesignModelRunState["submittedNetworkScenarioComparison"];
}): Promise<SupplyChainDesignNetworkScenarioComparisonOrchestrationInput> {
  const accountState = await getLtlRatePortalAccounts(input.context);
  const account = pickPreferredLiveSevenLAccount(accountState.accounts);
  if (!account) {
    throw new Error("The configured live 7L account is not available.");
  }
  const carrierHashes = account.carriers.filter((carrier) => carrier.enabled).map((carrier) => carrier.carrierHash);
  const prepared = prepareSupplyChainDesignCandidateLtlRateRequests({
    tenantId: input.context.tenantId,
    projectId: input.projectId,
    shipments: toMappedScenarioFile(input.shipmentsMapping),
    candidateFacilities: toMappedScenarioFile(input.candidateFacilitiesMapping)
  });
  const scenarioPreparedProfiles = toSupplyChainDesignNetworkScenarioPreparedProfiles(prepared.preparedRequests);
  const currentOrigins = normalizeSupplyChainDesignCurrentFacilityRatingOrigins(toMappedScenarioFile(input.facilitiesMapping)).origins;
  const candidateOrigins = normalizeSupplyChainDesignCandidateRatingOrigins(toMappedScenarioFile(input.candidateFacilitiesMapping)).origins;
  const shipmentWarehouseCostRows = readHistoricalShipmentWarehouseCostContractRows({
    tableType: "SHIPMENTS",
    fileBytes: Buffer.from(input.shipmentsMapping.file.fileBytes),
    fieldMappings: toMappedSourceFields(input.shipmentsMapping.fieldMappings)
  });
  const facilityOptions = readWarehouseCostFacilityOptions({
    currentFacilities: {
      fileBytes: input.facilitiesMapping.file.fileBytes,
      fieldMappings: toFieldMappings(input.facilitiesMapping.fieldMappings)
    },
    candidateFacilities: {
      fileBytes: input.candidateFacilitiesMapping.file.fileBytes,
      fieldMappings: toFieldMappings(input.candidateFacilitiesMapping.fieldMappings)
    }
  });

  const scenarioAInput: NetworkScenarioComparisonScenarioInput = {
    scenarioKey: "A",
    scenarioName: input.scenarioAName,
    selectedFacilities: toComparisonSelectedFacilities(input.scenarioAFacilityOptionIds, facilityOptions, input.facilitiesMapping, input.candidateFacilitiesMapping)
  };
  const scenarioBInput: NetworkScenarioComparisonScenarioInput = {
    scenarioKey: "B",
    scenarioName: input.scenarioBName,
    selectedFacilities: toComparisonSelectedFacilities(input.scenarioBFacilityOptionIds, facilityOptions, input.facilitiesMapping, input.candidateFacilitiesMapping)
  };

  return {
    context: input.context,
    projectId: input.projectId,
    inputReferences: {
      tenantId: input.context.tenantId,
      projectId: input.projectId,
      historicalShipments: toComparisonFileReference(input.shipmentsMapping),
      currentFacilities: toComparisonFileReference(input.facilitiesMapping),
      candidateFacilities: toComparisonFileReference(input.candidateFacilitiesMapping)
    },
    scenarioInputs: {
      historicalShipments: toComparisonFileReference(input.shipmentsMapping),
      scenarios: [scenarioAInput, scenarioBInput]
    },
    scenarioA: {
      scenarioKey: "A" as const,
      scenarioName: input.scenarioAName,
      transportationInput: {
        tenantId: input.context.tenantId,
        scenarioId: "scenario-a",
        scenarioName: input.scenarioAName,
        selectedOrigins: toSelectedScenarioOrigins(input.scenarioAFacilityOptionIds, currentOrigins, candidateOrigins),
        shipments: toScenarioShipmentReference(input.shipmentsMapping),
        preparedProfiles: scenarioPreparedProfiles,
        ratingConfig: { accountId: account.id, accountName: account.name, carrierHashes }
      },
      combinedCostInput: {
        scenarioId: "scenario-a",
        scenarioName: input.scenarioAName,
        transportationCurrency: "USD",
        selectedFacilities: toCombinedScenarioFacilities(input.scenarioAFacilityOptionIds, facilityOptions),
        warehouseCostProfilesByProfileKey: buildWarehouseCostProfilesFromPreparedRequests({
          preparedRequests: scenarioPreparedProfiles,
          shipmentFileId: input.shipmentsMapping.fileId,
          shipmentWarehouseCostRows
        })
      }
    },
    scenarioB: {
      scenarioKey: "B" as const,
      scenarioName: input.scenarioBName,
      transportationInput: {
        tenantId: input.context.tenantId,
        scenarioId: "scenario-b",
        scenarioName: input.scenarioBName,
        selectedOrigins: toSelectedScenarioOrigins(input.scenarioBFacilityOptionIds, currentOrigins, candidateOrigins),
        shipments: toScenarioShipmentReference(input.shipmentsMapping),
        preparedProfiles: scenarioPreparedProfiles,
        ratingConfig: { accountId: account.id, accountName: account.name, carrierHashes }
      },
      combinedCostInput: {
        scenarioId: "scenario-b",
        scenarioName: input.scenarioBName,
        transportationCurrency: "USD",
        selectedFacilities: toCombinedScenarioFacilities(input.scenarioBFacilityOptionIds, facilityOptions),
        warehouseCostProfilesByProfileKey: buildWarehouseCostProfilesFromPreparedRequests({
          preparedRequests: scenarioPreparedProfiles,
          shipmentFileId: input.shipmentsMapping.fileId,
          shipmentWarehouseCostRows
        })
      }
    },
    account,
    carrierHashes,
    fxInput: input.cadToUsdRate ? { cadToUsdRate: input.cadToUsdRate } : null,
    resultInputs: {
      preparedRequestCount: scenarioPreparedProfiles.length,
      candidateExpandedPreparedRequestCount: prepared.preparedRequests.length
    }
  };
}

function toComparisonFileReference(mapping: {
  fileId: string;
  id: string;
  updatedAt: Date;
  file: { originalFileName: string; contentHash?: string | null };
}) {
  return {
    fileId: mapping.fileId,
    fileName: mapping.file.originalFileName,
    contentHash: mapping.file.contentHash ?? "",
    mappingId: mapping.id,
    mappingUpdatedAt: mapping.updatedAt.toISOString()
  };
}

function toScenarioShipmentReference(mapping: {
  fileId: string;
  id: string;
  updatedAt: Date;
  file: { originalFileName: string };
}) {
  return {
    fileId: mapping.fileId,
    fileName: mapping.file.originalFileName,
    mappingId: mapping.id,
    mappingUpdatedAt: mapping.updatedAt.toISOString()
  };
}

function toSelectedScenarioOrigins(
  optionIds: string[],
  currentOrigins: SupplyChainDesignRatingOrigin[],
  candidateOrigins: SupplyChainDesignRatingOrigin[]
) {
  const selected = new Set(optionIds);
  return [...currentOrigins, ...candidateOrigins].filter((origin) => selected.has(`${origin.sourceType}:${origin.facilityId}`));
}

function toCombinedScenarioFacilities(
  optionIds: string[],
  facilityOptions: WarehouseCostComparisonFacilityOption[]
) {
  const selected = new Set(optionIds);
  return facilityOptions
    .filter((facility) => selected.has(facility.optionId))
    .map((facility) => facility.facilityType === "CURRENT"
      ? {
          sourceType: "CURRENT" as const,
          facilityId: facility.facilityId,
          facilityName: facility.facilityName,
          warehouseCost: {
            facilityId: facility.facilityId,
            facilitySourceType: "CURRENT" as const,
            currency: facility.currency,
            annualFacilityWarehouseCost: facility.annualFacilityWarehouseCost
          }
        }
      : {
          sourceType: "CANDIDATE" as const,
          facilityId: facility.facilityId,
          facilityName: facility.facilityName,
          warehouseCost: {
            facilityId: facility.facilityId,
            facilitySourceType: "CANDIDATE" as const,
            currency: facility.currency,
        annualFacilityWarehouseCost: facility.annualFacilityWarehouseCost,
        annualFixedCost: facility.annualFixedCost,
        inboundFeePerPallet: facility.inboundFeePerPallet,
        outboundFeePerPallet: facility.outboundFeePerPallet,
        storageFeePerPalletPerMonth: facility.storageFeePerPalletPerMonth
      }
    });
}

function toComparisonSelectedFacilities(
  optionIds: string[],
  facilityOptions: WarehouseCostComparisonFacilityOption[],
  facilitiesMapping: { fileId: string; id: string; file: { contentHash?: string | null } },
  candidateFacilitiesMapping: { fileId: string; id: string; file: { contentHash?: string | null } }
) {
  const selected = new Set(optionIds);
  return facilityOptions
    .filter((facility) => selected.has(facility.optionId))
    .map((facility) => {
      const sourceMapping = facility.facilityType === "CURRENT" ? facilitiesMapping : candidateFacilitiesMapping;
      return {
        facilityId: facility.facilityId,
        sourceType: facility.facilityType,
        facilityName: facility.facilityName,
        postalCode: null,
        city: facility.city,
        stateProvince: facility.stateProvince,
        country: facility.country,
        sourceFileId: sourceMapping.fileId,
        sourceMappingId: sourceMapping.id,
        sourceContentHash: sourceMapping.file.contentHash ?? "",
        warehouseCostEvidence: {
          annualFacilityWarehouseCost: facility.annualFacilityWarehouseCost,
          annualFixedCost: facility.annualFixedCost,
          comparableAnnualWarehouseCost: facility.comparableAnnualWarehouseCost
        }
      };
    });
}

function toMappedScreeningFile(mapping: {
  fileId: string;
  id: string;
  file: { originalFileName: string; fileBytes: Uint8Array };
  fieldMappings: unknown;
  updatedAt: Date;
}) {
  return {
    fileId: mapping.fileId,
    fileName: mapping.file.originalFileName,
    mappingId: mapping.id,
    mappingUpdatedAt: mapping.updatedAt.toISOString(),
    fileBytes: Buffer.from(mapping.file.fileBytes),
    fieldMappings: toFieldMappings(mapping.fieldMappings)
  };
}
