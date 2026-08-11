import {
  JobStatus,
  IntegrationProvider,
  IntegrationStatus,
  ModuleKey,
  PlatformRole,
  SupplyChainDesignMappingStatus,
  SupplyChainDesignModelRunStatus,
  SupplyChainDesignProjectStatus,
  SupplyChainDesignScenarioStatus,
  SupplyChainDesignTableType
} from "@prisma/client";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AuthenticatedContext } from "@/server/tenant-context";
import {
  MODEL_01_PROOF_OVERVIEW_CARDS,
  MODEL_01_PROOF_RESULT_SECTIONS
} from "@/modules/supply-chain-design/result-layout";
import { deriveSupplyChainDesignCostAnalysis } from "@/modules/supply-chain-design/cost-analysis";
import { recognizeSupplyChainDesignOfficialTemplate } from "@/modules/supply-chain-design/mapping-definitions";
import {
  readWarehouseCostFacilityOptions,
  runWarehouseCostComparison
} from "@/modules/supply-chain-design/warehouse-cost-comparison";
import {
  buildWarehouseCostProfilesFromPreparedRequests,
  readCandidateWarehouseCostContractRows,
  readHistoricalShipmentWarehouseCostContractRows
} from "@/modules/supply-chain-design/warehouse-cost-data-contract";
import {
  calculateBillableStorageMonths,
  calculateCandidateWarehouseCostForPreparedProfile,
  calculateCandidateWarehouseCostFromSourceRows,
  calculateCurrentFacilityWarehouseCostBasis
} from "@/modules/supply-chain-design/warehouse-cost-engine";

const getAuthenticatedContext = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
const getLtlQuotes = vi.fn();

const prismaMock = vi.hoisted(() => {
  const tx = {
    supplyChainDesignProject: {
      create: vi.fn()
    },
    supplyChainDesignProjectFile: {
      create: vi.fn(),
      update: vi.fn()
    },
    supplyChainDesignFileMapping: {
      upsert: vi.fn(),
      delete: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    }
  };

  return {
    tx,
    prisma: {
      tenantModuleAccess: {
        findFirst: vi.fn()
      },
      tenantRolePolicy: {
        findUnique: vi.fn()
      },
      tenantRoleModuleAccess: {
        findMany: vi.fn()
      },
      supplyChainDesignProject: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn()
      },
      supplyChainDesignProjectFile: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        delete: vi.fn()
      },
      supplyChainDesignFileMapping: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn()
      },
      supplyChainDesignModelRun: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn()
      },
      supplyChainDesignScenario: {
        create: vi.fn(),
        findMany: vi.fn(),
        deleteMany: vi.fn()
      },
      supplyChainDesignNetworkScenarioComparisonRun: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        deleteMany: vi.fn()
      },
      supplyChainDesignScreeningRun: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        deleteMany: vi.fn()
      },
      supplyChainDesignLtlRatePreparationRun: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn()
      },
      automationJobRun: {
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        deleteMany: vi.fn()
      },
      ltlBatchQuoteLane: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn()
      },
      integrationCredential: {
        findMany: vi.fn()
      },
      auditLog: {
        create: vi.fn()
      },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx))
    }
  };
});

vi.mock("@/server/db", () => ({
  prisma: prismaMock.prisma
}));

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: () => getAuthenticatedContext()
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args)
}));

vi.mock("@/server/integrations/seven-l", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/integrations/seven-l")>();
  return {
    ...actual,
    getLtlQuotes: (...args: unknown[]) => getLtlQuotes(...args)
  };
});

vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  })
}));

vi.mock("@/server/auth/actions", () => ({
  signOutAction: vi.fn()
}));

import { AuthorizationError } from "@/server/auth/authorization";
import { filterVisibleNavEntries } from "@/components/app-shell";
import {
  applySupplyChainDesignAutomaticMappingAction,
  createSupplyChainDesignProjectAction,
  deleteSupplyChainDesignProjectAction,
  deleteSupplyChainDesignFileMappingAction,
  deleteSupplyChainDesignProjectFileAction,
  deleteSupplyChainDesignNetworkScenarioComparisonRunAction,
  deleteSupplyChainDesignRunAction,
  deleteSupplyChainDesignWarehouseLocationStrategyRunAction,
  runSupplyChainDesignModel01ProofAction,
  runSupplyChainDesignWarehouseLocationStrategyAction,
  runSupplyChainDesignModel02OptimizerAction,
  runSupplyChainDesignModel02ProofAction,
  generateSupplyChainDesignCandidateLtlRatePreparationAction,
  runSupplyChainDesignNetworkDesignAction,
  runSupplyChainDesignNetworkScenarioComparisonAction,
  startSupplyChainDesignNetworkScenarioComparisonRateBatchAction,
  startSupplyChainDesignLtlRateBatchAction,
  runSupplyChainDesignThreePlScreeningAction,
  saveSupplyChainDesignFileMappingAction,
  uploadSupplyChainDesignProjectFilesAction
} from "@/modules/supply-chain-design/actions";
import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import {
  parseCsvRows,
  parseSupplyChainDesignCsvUpload
} from "@/modules/supply-chain-design/csv-intake";
import { SUPPLY_CHAIN_DESIGN_CSV_MAX_BYTES } from "@/modules/supply-chain-design/file-size";
import {
  getSupplyChainDesignProject,
  getSupplyChainDesignProjectFile,
  listSupplyChainDesignProjects
} from "@/modules/supply-chain-design/queries";
import {
  compareSupplyChainDesignScenarios,
  getSuccessfulModel02Scenarios
} from "@/modules/supply-chain-design/scenario-comparison";
import { runSupplyChainDesignModel02Proof } from "@/modules/supply-chain-design/model-02-proof";
import { runSupplyChainDesignModel01Proof } from "@/modules/supply-chain-design/model-01-proof";
import {
  assertSupplyChainDesignModel02OptimizerConsistency,
  buildModel02Problem,
  ExactEnumerationModel02Solver,
  MathematicalProgrammingModel02Solver,
  solveModel02Problem,
  validateModel02Problem,
  verifyModel02Solution,
  runSupplyChainDesignModel02Optimizer
} from "@/modules/supply-chain-design/model-02-optimizer";
import {
  normalizeLogisticsMarketEligibility,
  runSupplyChainDesignThreePlScreening,
  traceSupplyChainDesignLogisticsMarkets
} from "@/modules/supply-chain-design/three-pl-screening";
import { runSupplyChainDesignProviderComparison } from "@/modules/supply-chain-design/three-pl-provider-comparison";
import {
  calculateFreightClass,
  SCDS_LTL_RATE_PREPARATION_RESULT_VERSION,
  prepareSupplyChainDesignCandidateLtlRateRequests,
  toSupplyChainDesignNetworkScenarioPreparedProfiles
} from "@/modules/supply-chain-design/candidate-ltl-rate-preparation";
import {
  normalizeSupplyChainDesignCandidateRatingOrigins,
  normalizeSupplyChainDesignCurrentFacilityRatingOrigins,
  resolveHistoricalShipmentCurrentFacilityOrigins
} from "@/modules/supply-chain-design/rating-origins";
import { evaluateSupplyChainDesignNetworkScenario } from "@/modules/supply-chain-design/network-scenario-evaluation";
import { evaluateSupplyChainDesignCombinedScenarioCost } from "@/modules/supply-chain-design/network-scenario-combined-cost";
import { orchestrateSupplyChainDesignNetworkScenarioMissingRates } from "@/modules/supply-chain-design/network-scenario-orchestration";
import {
  dedupeComparisonMissingRateManifest,
  orchestrateSupplyChainDesignNetworkScenarioComparison
} from "@/modules/supply-chain-design/network-scenario-comparison-orchestration";
import {
  NETWORK_SCENARIO_COMPARISON_CALCULATION_VERSION,
  buildNetworkScenarioComparisonFingerprint,
  buildNetworkScenarioTransportationFingerprint,
  createNetworkScenarioComparisonRun,
  deleteNetworkScenarioComparisonRun,
  findActiveNetworkScenarioComparisonRunByFingerprint,
  findCompletedNetworkScenarioComparisonRunByFingerprint,
  getNetworkScenarioComparisonRun,
  listNetworkScenarioComparisonRuns,
  updateNetworkScenarioComparisonRunLifecycle
} from "@/modules/supply-chain-design/network-scenario-comparison-persistence";
import {
  assignmentRows,
  alternativeRows,
  buildNetworkScenarioComparisonCostRows,
  buildNetworkScenarioComparisonCsvTable,
  compactNetworkScenarioComparisonCoverage,
  deliveryAssignmentRows,
  exportNetworkScenarioComparisonCsv,
  facilitySummaryRows,
  hasCompetingAlternatives,
  networkScenarioComparisonExportFilename,
  networkScenarioComparisonSavingsCallout,
  summarizeNetworkScenarioComparisonCoverage,
  winningDeliveryAssignmentRows
} from "@/modules/supply-chain-design/network-scenario-comparison-reporting";
import {
  classifyWarehouseLocationStrategyCenterCountry,
  exportWarehouseLocationStrategyCsv,
  runSupplyChainDesignWarehouseLocationStrategy,
  selectNearestWarehouseLocationStrategyPracticalMarket
} from "@/modules/supply-chain-design/warehouse-location-strategy";
import { buildWarehouseLocationStrategyMapData } from "@/modules/supply-chain-design/components/warehouse-location-strategy-map";
import { calculateLtlFreightClass } from "@/modules/ltl-rate-portal/freight-class";
import {
  buildSupplyChainDesignExactLaneRateFingerprint,
  createSupplyChainDesignLtlRateBatch,
  createSupplyChainDesignScenarioMissingRateBatch,
  exportSupplyChainDesignLtlRateBatchCsv,
  exportSupplyChainDesignCandidateSummaryCsv,
  exportSupplyChainDesignShipmentComparisonCsv,
  getSupplyChainDesignLtlRateBatchById,
  getSupplyChainDesignLtlRateBatches,
  getSupplyChainDesignLtlRateConcurrencyConfig,
  runSupplyChainDesignLtlRateBatch,
  selectLowestLtlQuote
} from "@/modules/supply-chain-design/ltl-rate-batches";
import { preflightSevenLQuoteRequest } from "@/modules/ltl-rate-portal/request-preflight";
import {
  NEWL_LOGISTICS_MARKET_CATALOGUE,
  NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION
} from "@/modules/supply-chain-design/reference-data/logistics-market-catalogue";
import {
  CENSUS_ZCTA_2025_COORDINATE_SOURCE,
  getUsZipCentroidReferenceMetadata,
  getUsZipCentroidReferenceRecords
} from "@/modules/supply-chain-design/reference-data/us-zip-centroids";

function context(role: PlatformRole, tenantId = "tenant-1"): AuthenticatedContext {
  return {
    userId: "user-1",
    userEmail: "user@example.com",
    userName: "User",
    role,
    tenantId,
    tenantSlug: "tenant-one",
    tenantName: "Tenant One"
  };
}

function form(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

function csvHeader(filePath: string) {
  return readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)[0]
    .split(",");
}

function proofRunForm(
  values: Partial<
    Record<
      | "currentNetworkActivityMappingId"
      | "facilitiesMappingId"
      | "shipmentsMappingId"
      | "inventoryMappingId"
      | "facilityCostsMappingId"
      | "customersMappingId",
      string
    >
  > = {}
) {
  return form({
    projectId: "project-1",
    ...(values.currentNetworkActivityMappingId
      ? { currentNetworkActivityMappingId: values.currentNetworkActivityMappingId }
      : {
          facilitiesMappingId: values.facilitiesMappingId ?? "facilities-mapping",
          shipmentsMappingId: values.shipmentsMappingId ?? "shipments-mapping"
        }),
    ...(values.inventoryMappingId ? { inventoryMappingId: values.inventoryMappingId } : {}),
    ...(values.facilityCostsMappingId ? { facilityCostsMappingId: values.facilityCostsMappingId } : {}),
    ...(values.customersMappingId ? { customersMappingId: values.customersMappingId } : {})
  });
}

function scenarioRunForm(
  values: Partial<
    Record<
      | "scenarioName"
      | "baselineRunId"
      | "facilitiesMappingId"
      | "shipmentsMappingId"
      | "customersMappingId"
      | "candidateFacilitiesMappingId"
      | "scenarioLaneCostsMappingId"
      | "facilityCostsMappingId",
      string
    >
  > & { selectedExistingFacilityIds?: string[]; selectedCandidateFacilityIds?: string[] } = {}
) {
  const formData = form({
    projectId: "project-1",
    scenarioName: values.scenarioName ?? "Candidate network",
    baselineRunId: values.baselineRunId ?? "run-1",
    facilitiesMappingId: values.facilitiesMappingId ?? "facilities-mapping",
    shipmentsMappingId: values.shipmentsMappingId ?? "shipments-mapping",
    customersMappingId: values.customersMappingId ?? "customers-mapping",
    candidateFacilitiesMappingId: values.candidateFacilitiesMappingId ?? "candidate-facilities-mapping",
    ...(values.scenarioLaneCostsMappingId ? { scenarioLaneCostsMappingId: values.scenarioLaneCostsMappingId } : {}),
    ...(values.facilityCostsMappingId ? { facilityCostsMappingId: values.facilityCostsMappingId } : {})
  });
  for (const facilityId of values.selectedExistingFacilityIds ?? ["F1", "F2"]) {
    formData.append("selectedExistingFacilityIds", facilityId);
  }
  for (const facilityId of values.selectedCandidateFacilityIds ?? ["N1"]) {
    formData.append("selectedCandidateFacilityIds", facilityId);
  }
  return formData;
}

function optimizerRunForm(
  values: Partial<
    Record<
      | "optimizerName"
      | "baselineRunId"
      | "facilitiesMappingId"
      | "shipmentsMappingId"
      | "customersMappingId"
      | "candidateFacilitiesMappingId"
      | "scenarioLaneCostsMappingId"
      | "facilityCostsMappingId"
      | "minimumOpenFacilities"
      | "maximumOpenFacilities",
      string
    >
  > & {
    mandatoryExistingFacilityIds?: string[];
    permittedExistingFacilityIds?: string[];
    permittedCandidateFacilityIds?: string[];
    prohibitedCandidateFacilityIds?: string[];
    enforceCapacity?: boolean;
  } = {}
) {
  const formData = form({
    projectId: "project-1",
    optimizerName: values.optimizerName ?? "Optimized network",
    baselineRunId: values.baselineRunId ?? "run-1",
    facilitiesMappingId: values.facilitiesMappingId ?? "facilities-mapping",
    shipmentsMappingId: values.shipmentsMappingId ?? "shipments-mapping",
    customersMappingId: values.customersMappingId ?? "customers-mapping",
    candidateFacilitiesMappingId: values.candidateFacilitiesMappingId ?? "candidate-facilities-mapping",
    minimumOpenFacilities: values.minimumOpenFacilities ?? "1",
    maximumOpenFacilities: values.maximumOpenFacilities ?? "3",
    ...(values.scenarioLaneCostsMappingId ? { scenarioLaneCostsMappingId: values.scenarioLaneCostsMappingId } : {}),
    ...(values.facilityCostsMappingId ? { facilityCostsMappingId: values.facilityCostsMappingId } : {})
  });
  for (const facilityId of values.mandatoryExistingFacilityIds ?? []) {
    formData.append("mandatoryExistingFacilityIds", facilityId);
  }
  for (const facilityId of values.permittedExistingFacilityIds ?? ["F1", "F2"]) {
    formData.append("permittedExistingFacilityIds", facilityId);
  }
  for (const facilityId of values.permittedCandidateFacilityIds ?? ["N1", "N2"]) {
    formData.append("permittedCandidateFacilityIds", facilityId);
  }
  for (const facilityId of values.prohibitedCandidateFacilityIds ?? []) {
    formData.append("prohibitedCandidateFacilityIds", facilityId);
  }
  if (values.enforceCapacity) {
    formData.set("optimizerEnforceCapacity", "on");
  }
  return formData;
}

const createdAt = new Date("2026-07-24T12:00:00.000Z");
const updatedAt = new Date("2026-07-24T12:05:00.000Z");

describe("Supply Chain Design Studio persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ id: "access-1" });
    prismaMock.prisma.tenantRolePolicy.findUnique.mockResolvedValue(null);
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProjectFile.findFirst.mockResolvedValue(null);
    prismaMock.prisma.supplyChainDesignProjectFile.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignModelRun.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignScenario.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findFirst.mockResolvedValue(null);
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findUnique.mockResolvedValue(null);
    prismaMock.prisma.supplyChainDesignScreeningRun.findMany.mockResolvedValue([]);
    prismaMock.prisma.automationJobRun.findMany.mockResolvedValue([]);
    prismaMock.prisma.integrationCredential.findMany.mockResolvedValue([]);
    prismaMock.prisma.ltlBatchQuoteLane.findMany.mockResolvedValue([]);
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-1",
      tableType: SupplyChainDesignTableType.FACILITIES,
      status: SupplyChainDesignMappingStatus.DRAFT
    });
    prismaMock.prisma.supplyChainDesignModelRun.create.mockResolvedValue({
      id: "run-1"
    });
    prismaMock.prisma.supplyChainDesignModelRun.findUnique.mockResolvedValue({
      id: "run-1"
    });
    prismaMock.prisma.supplyChainDesignScenario.create.mockResolvedValue({
      id: "scenario-1"
    });
  });

  it("creates and reads a typed Network Scenario Comparison run with tenant and project scope", async () => {
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    const input = networkScenarioComparisonCreateInput();
    const persisted = networkScenarioComparisonRunRecord({ id: "comparison-1", ...input });
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.create.mockResolvedValue(persisted);
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findUnique.mockResolvedValue(persisted);

    const created = await createNetworkScenarioComparisonRun(context(PlatformRole.ADMIN), input);
    const read = await getNetworkScenarioComparisonRun(context(PlatformRole.ADMIN), "project-1", "comparison-1");

    expect(prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        projectId: "project-1",
        status: "RATES_REQUIRED",
        calculationVersion: NETWORK_SCENARIO_COMPARISON_CALCULATION_VERSION,
        createdByUserId: "user-1"
      })
    });
    expect(created.inputReferences.historicalShipments.fileName).toBe("historical-shipments.csv");
    expect(read?.scenarioInputs.scenarios.map((scenario) => scenario.scenarioKey)).toEqual(["A", "B"]);
    expect(read?.ratingEvidence.exactLaneFingerprints).toEqual(["fp-a"]);
  });

  it("fails safely when persisted Network Scenario Comparison JSON is malformed", async () => {
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findUnique.mockResolvedValue(
      networkScenarioComparisonRunRecord({ scenarioInputs: { historicalShipments: fileRef("shipments-file", "historical-shipments.csv", "hash-shipments", "shipments-mapping"), scenarios: [] } })
    );

    await expect(getNetworkScenarioComparisonRun(context(PlatformRole.ADMIN), "project-1", "comparison-1")).rejects.toThrow(
      "Network Scenario Comparison requires exactly two scenario inputs."
    );
  });

  it("enforces tenant and project isolation for Network Scenario Comparison persistence", async () => {
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(null);
    await expect(createNetworkScenarioComparisonRun(context(PlatformRole.ADMIN), networkScenarioComparisonCreateInput())).rejects.toThrow(
      "Supply Chain Design project was not found."
    );

    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findUnique.mockResolvedValue(
      networkScenarioComparisonRunRecord({ projectId: "other-project" })
    );
    await expect(getNetworkScenarioComparisonRun(context(PlatformRole.ADMIN), "project-1", "comparison-1")).resolves.toBeNull();
  });

  it("lists Network Scenario Comparison runs newest first without mixing legacy reports", async () => {
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findMany.mockResolvedValue([
      networkScenarioComparisonRunRecord({
        id: "new-run",
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
        scenarioAName: "Current",
        scenarioBName: "Proposed",
        resultSummary: networkScenarioComparisonResultSummary({ totalDifference: -1000 })
      }),
      networkScenarioComparisonRunRecord({
        id: "old-run",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        scenarioAName: "Old A",
        scenarioBName: "Old B"
      })
    ]);

    const runs = await listNetworkScenarioComparisonRuns(context(PlatformRole.ADMIN), "project-1");

    expect(prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", projectId: "project-1" },
      orderBy: { createdAt: "desc" }
    });
    expect(runs.map((run) => run.id)).toEqual(["new-run", "old-run"]);
    expect(runs[0]).toMatchObject({
      scenarioAName: "Current",
      scenarioBName: "Proposed",
      scenarioInputs: expect.objectContaining({
        scenarios: expect.arrayContaining([
          expect.objectContaining({ scenarioKey: "A" }),
          expect.objectContaining({ scenarioKey: "B" })
        ])
      }),
      inputReferences: expect.objectContaining({
        historicalShipments: expect.objectContaining({ fileName: "historical-shipments.csv" })
      }),
      ratingEvidence: expect.objectContaining({
        exactLaneFingerprints: ["fp-a"]
      }),
      resultReadError: null,
      headline: { completenessStatus: "COMPLETE", totalDifference: -1000 }
    });
    expect(prismaMock.prisma.supplyChainDesignModelRun.findMany).not.toHaveBeenCalled();
  });

  it("returns a read-error list item instead of an undefined persisted Network Scenario Comparison shape", async () => {
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findMany.mockResolvedValue([
      networkScenarioComparisonRunRecord({
        id: "bad-run",
        status: "FAILED",
        scenarioInputs: { historicalShipments: fileRef("shipments-file", "historical-shipments.csv", "hash-shipments", "shipments-mapping") },
        transportationFingerprint: "fp-bad-transportation",
        resultSummary: null,
        errorMessage: "Saved failure"
      })
    ]);

    const runs = await listNetworkScenarioComparisonRuns(context(PlatformRole.ADMIN), "project-1");

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "bad-run",
      status: "FAILED",
      scenarioInputs: null,
      ratingEvidence: null,
      resultSummary: null,
      errorMessage: "Saved failure",
      resultReadError: "Network Scenario Comparison requires exactly two scenario inputs."
    });
  });

  it("deletes only the target Network Scenario Comparison record", async () => {
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.deleteMany.mockResolvedValue({ count: 1 });

    await expect(deleteNetworkScenarioComparisonRun(context(PlatformRole.ADMIN), "project-1", "comparison-1")).resolves.toBe(true);

    expect(prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", projectId: "project-1", id: "comparison-1" }
    });
    expect(prismaMock.prisma.automationJobRun.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.prisma.supplyChainDesignProjectFile.delete).not.toHaveBeenCalled();
    expect(prismaMock.prisma.supplyChainDesignModelRun.deleteMany).not.toHaveBeenCalled();
  });

  it("exposes a server action that deletes only the selected Network Scenario Comparison result", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.deleteMany.mockResolvedValue({ count: 1 });

    const result = await deleteSupplyChainDesignNetworkScenarioComparisonRunAction(
      { ok: false, message: "" },
      form({
        projectId: "project-1",
        runId: "comparison-1",
        confirmDelete: "on"
      })
    );

    expect(result).toMatchObject({ ok: true, message: "Network Scenario Comparison result deleted." });
    expect(prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", projectId: "project-1", id: "comparison-1" }
    });
    expect(prismaMock.prisma.automationJobRun.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.prisma.ltlBatchQuoteLane.update).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/supply-chain-design/project-1");
  });

  it("builds deterministic separated transportation and comparison fingerprints", () => {
    const input = networkScenarioComparisonCreateInput();
    const reordered = {
      ...input.scenarioInputs,
      scenarios: input.scenarioInputs.scenarios.map((scenario) => ({
        ...scenario,
        selectedFacilities: scenario.selectedFacilities.slice().reverse()
      })) as any
    };
    const baseTransportation = buildNetworkScenarioTransportationFingerprint({
      inputReferences: input.inputReferences,
      scenarioInputs: input.scenarioInputs,
      ratingAccountId: "account-1",
      carrierHashes: ["carrier-b", "carrier-a"]
    });
    expect(buildNetworkScenarioTransportationFingerprint({
      inputReferences: input.inputReferences,
      scenarioInputs: reordered,
      ratingAccountId: "account-1",
      carrierHashes: ["carrier-a", "carrier-b"]
    })).toBe(baseTransportation);

    const changedOrigin = networkScenarioComparisonCreateInput();
    changedOrigin.scenarioInputs.scenarios[0].selectedFacilities[0].postalCode = "60601";
    expect(buildNetworkScenarioTransportationFingerprint({
      inputReferences: changedOrigin.inputReferences,
      scenarioInputs: changedOrigin.scenarioInputs,
      ratingAccountId: "account-1",
      carrierHashes: ["carrier-a", "carrier-b"]
    })).not.toBe(baseTransportation);

    const changedWarehouse = networkScenarioComparisonCreateInput();
    changedWarehouse.scenarioInputs.scenarios[0].selectedFacilities[0].warehouseCostEvidence = { annualAllInCost: 999 };
    const changedWarehouseTransportation = buildNetworkScenarioTransportationFingerprint({
      inputReferences: changedWarehouse.inputReferences,
      scenarioInputs: changedWarehouse.scenarioInputs,
      ratingAccountId: "account-1",
      carrierHashes: ["carrier-b", "carrier-a"]
    });
    expect(changedWarehouseTransportation).toBe(baseTransportation);
    expect(buildNetworkScenarioComparisonFingerprint({
      transportationFingerprint: baseTransportation,
      scenarioInputs: input.scenarioInputs,
      fxInput: null,
      resultInputs: { dwellHash: "dwell-a" }
    })).not.toBe(buildNetworkScenarioComparisonFingerprint({
      transportationFingerprint: changedWarehouseTransportation,
      scenarioInputs: changedWarehouse.scenarioInputs,
      fxInput: null,
      resultInputs: { dwellHash: "dwell-a" }
    }));
    expect(buildNetworkScenarioComparisonFingerprint({
      transportationFingerprint: baseTransportation,
      scenarioInputs: input.scenarioInputs,
      fxInput: null,
      resultInputs: { dwellHash: "dwell-a" }
    })).not.toBe(buildNetworkScenarioComparisonFingerprint({
      transportationFingerprint: baseTransportation,
      scenarioInputs: input.scenarioInputs,
      fxInput: { cadToUsdRate: 0.74 },
      resultInputs: { dwellHash: "dwell-a" }
    }));
    expect(buildNetworkScenarioTransportationFingerprint({
      inputReferences: input.inputReferences,
      scenarioInputs: input.scenarioInputs,
      ratingAccountId: "account-2",
      carrierHashes: ["carrier-a", "carrier-b"]
    })).not.toBe(baseTransportation);
  });

  it("separates completed exact-result reuse from active Network Scenario Comparison resume lookup", async () => {
    const complete = networkScenarioComparisonRunRecord({ id: "complete-run", status: "COMPLETE", comparisonFingerprint: "fp-comparison" });
    const active = networkScenarioComparisonRunRecord({ id: "active-run", status: "RATING", comparisonFingerprint: "fp-comparison" });
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findFirst
      .mockResolvedValueOnce(complete)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(active);

    await expect(findCompletedNetworkScenarioComparisonRunByFingerprint(context(PlatformRole.ADMIN), "project-1", "fp-comparison")).resolves.toMatchObject({ id: "complete-run" });
    await expect(findCompletedNetworkScenarioComparisonRunByFingerprint(context(PlatformRole.ADMIN), "project-1", "failed-fp")).resolves.toBeNull();
    await expect(findActiveNetworkScenarioComparisonRunByFingerprint(context(PlatformRole.ADMIN), "project-1", "fp-comparison")).resolves.toMatchObject({ id: "active-run" });

    expect(prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findFirst.mock.calls[0][0].where).toMatchObject({
      tenantId: "tenant-1",
      projectId: "project-1",
      comparisonFingerprint: "fp-comparison",
      status: "COMPLETE"
    });
    expect(prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findFirst.mock.calls[2][0].where.status.in).toEqual([
      "EVALUATING",
      "RATES_REQUIRED",
      "RATING",
      "READY_FOR_COST_EVALUATION"
    ]);
  });

  it("allows an authorized user to create and reopen a tenant-scoped project", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    getAuthenticatedContext.mockResolvedValue(adminContext);
    prismaMock.tx.supplyChainDesignProject.create.mockResolvedValue({
      id: "project-1",
      tenantId: adminContext.tenantId,
      name: "Network baseline",
      description: "Initial shell",
      status: SupplyChainDesignProjectStatus.DRAFT,
      createdByUserId: adminContext.userId,
      createdAt,
      updatedAt
    });
    prismaMock.tx.auditLog.create.mockResolvedValue({ id: "audit-1" });

    await expect(
      createSupplyChainDesignProjectAction(
        form({
          name: "Network baseline",
          description: "Initial shell"
        })
      )
    ).rejects.toThrow("redirect:/supply-chain-design/project-1");

    expect(prismaMock.tx.supplyChainDesignProject.create).toHaveBeenCalledWith({
      data: {
        tenantId: adminContext.tenantId,
        name: "Network baseline",
        description: "Initial shell",
        createdByUserId: adminContext.userId
      }
    });
    expect(prismaMock.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: adminContext.tenantId,
        actorUserId: adminContext.userId,
        action: "supply-chain-design.project.created",
        entityType: "SupplyChainDesignProject",
        entityId: "project-1"
      })
    });
    expect(revalidatePath).toHaveBeenCalledWith("/supply-chain-design");

    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      tenantId: adminContext.tenantId,
      name: "Network baseline",
      description: "Initial shell",
      status: SupplyChainDesignProjectStatus.DRAFT,
      createdByUserId: adminContext.userId,
      createdAt,
      updatedAt,
      createdBy: {
        name: "User",
        email: "user@example.com"
      },
      files: []
    });

    const reopened = await getSupplyChainDesignProject(adminContext, "project-1");

    expect(reopened).toMatchObject({
      id: "project-1",
      name: "Network baseline",
      shell: {
        modelId: "MOD-01"
      }
    });
    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: adminContext.tenantId,
            id: "project-1"
          }
        }
      })
    );
  });

  it("blocks unauthorized roles from the module", async () => {
    await expect(requireSupplyChainDesignStudioAccess(context(PlatformRole.OPERATIONS))).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("does not allow one tenant to read another tenant's project", async () => {
    const tenantTwoContext = context(PlatformRole.ADMIN, "tenant-2");
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(null);

    await expect(getSupplyChainDesignProject(tenantTwoContext, "project-1")).resolves.toBeNull();

    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-2",
            id: "project-1"
          }
        }
      })
    );
  });

  it("deletes only the selected project after confirmation", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    getAuthenticatedContext.mockResolvedValue(adminContext);
    prismaMock.prisma.supplyChainDesignProject.delete.mockResolvedValue({
      id: "project-1",
      tenantId: adminContext.tenantId,
      name: "Network baseline",
      status: SupplyChainDesignProjectStatus.DRAFT
    });
    prismaMock.prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });

    await expect(
      deleteSupplyChainDesignProjectAction(form({ projectId: "project-1", confirmDelete: "on" }))
    ).resolves.toEqual({ ok: true, message: "Network baseline was deleted." });

    expect(prismaMock.prisma.supplyChainDesignProject.delete).toHaveBeenCalledWith({
      where: {
        tenantId_id: {
          tenantId: adminContext.tenantId,
          id: "project-1"
        }
      }
    });
    expect(prismaMock.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: adminContext.tenantId,
        actorUserId: adminContext.userId,
        action: "supply-chain-design.project.deleted",
        entityId: "project-1"
      })
    });
    expect(revalidatePath).toHaveBeenCalledWith("/supply-chain-design");
  });

  it("does not delete a project without confirmation", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));

    await expect(deleteSupplyChainDesignProjectAction(form({ projectId: "project-1" }))).resolves.toEqual({
      ok: false,
      message: "Project deletion was not confirmed."
    });
    expect(prismaMock.prisma.supplyChainDesignProject.delete).not.toHaveBeenCalled();
  });

  it("lists only projects for the authenticated tenant", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findMany.mockResolvedValue([
      {
        id: "project-1",
        tenantId: adminContext.tenantId,
        name: "Network baseline",
        description: null,
        status: SupplyChainDesignProjectStatus.DRAFT,
        createdByUserId: adminContext.userId,
        createdAt,
        updatedAt,
        createdBy: {
          name: "User",
          email: "user@example.com"
        },
        files: []
      }
    ]);

    await expect(listSupplyChainDesignProjects(adminContext)).resolves.toHaveLength(1);
    expect(prismaMock.prisma.supplyChainDesignProject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: adminContext.tenantId
        }
      })
    );
  });

  it("uses module entitlement and role checks for navigation visibility", () => {
    const entries = [
      {
        id: "supply-chain-design",
        href: "/supply-chain-design",
        label: "Supply Chain Design Studio",
        moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN,
        allowedRoles: [PlatformRole.ADMIN, PlatformRole.MANAGER]
      }
    ];

    expect(filterVisibleNavEntries(entries, [ModuleKey.SUPPLY_CHAIN_DESIGN], PlatformRole.ADMIN)).toHaveLength(1);
    expect(filterVisibleNavEntries(entries, [], PlatformRole.ADMIN)).toHaveLength(0);
    expect(filterVisibleNavEntries(entries, [ModuleKey.SUPPLY_CHAIN_DESIGN], PlatformRole.OPERATIONS)).toHaveLength(0);
  });

  it("uploads a CSV file and persists header and preview metadata", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    getAuthenticatedContext.mockResolvedValue(adminContext);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.tx.supplyChainDesignProjectFile.create.mockResolvedValue({
      id: "file-1",
      originalFileName: "lanes.csv",
      sizeBytes: 34,
      rowCount: 2
    });
    prismaMock.tx.auditLog.create.mockResolvedValue({ id: "audit-2" });

    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.append("files", new File(["Origin,Destination\nToronto,Chicago\nMontreal,New York\n"], "lanes.csv", { type: "text/csv" }));

    await expect(uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm)).resolves.toEqual({
      ok: true,
      message: "1 CSV file uploaded."
    });

    expect(prismaMock.tx.supplyChainDesignProjectFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: adminContext.tenantId,
        projectId: "project-1",
        originalFileName: "lanes.csv",
        rowCount: 2,
        detectedHeaders: ["Origin", "Destination"],
        previewRows: [
          ["Toronto", "Chicago"],
          ["Montreal", "New York"]
        ],
        uploadedByUserId: adminContext.userId
      })
    });
    expect(revalidatePath).toHaveBeenCalledWith("/supply-chain-design/project-1");
  });

  it("keeps uploaded CSV files visible after reloading a project", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      tenantId: adminContext.tenantId,
      name: "Network baseline",
      description: null,
      status: SupplyChainDesignProjectStatus.DRAFT,
      createdByUserId: adminContext.userId,
      createdAt,
      updatedAt,
      createdBy: {
        name: "User",
        email: "user@example.com"
      },
      files: [
        {
          id: "file-1",
          originalFileName: "lanes.csv",
          contentType: "text/csv",
          sizeBytes: 42,
          contentHash: "hash-1",
          rowCount: 2,
          detectedHeaders: ["Origin", "Destination"],
          status: "READY",
          createdAt,
          uploadedBy: {
            name: "User",
            email: "user@example.com"
          },
          mappings: []
        }
      ]
    });

    const reopened = await getSupplyChainDesignProject(adminContext, "project-1");

    expect(reopened?.files).toEqual([
      expect.objectContaining({
        id: "file-1",
        originalFileName: "lanes.csv",
        rowCount: 2,
        detectedHeaders: ["Origin", "Destination"]
      })
    ]);
  });

  it("opens a tenant-scoped CSV preview", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      tenantId: adminContext.tenantId,
      projectId: "project-1",
      originalFileName: "lanes.csv",
      contentType: "text/csv",
      sizeBytes: 42,
      contentHash: "hash-1",
      rowCount: 1,
      detectedHeaders: ["Origin", "Destination"],
      previewRows: [["Toronto", "Chicago"]],
      status: "READY",
      createdAt,
      mappings: [],
      project: {
        id: "project-1",
        name: "Network baseline"
      },
      uploadedBy: null
    });

    await expect(getSupplyChainDesignProjectFile(adminContext, "project-1", "file-1")).resolves.toMatchObject({
      id: "file-1",
      previewRows: [["Toronto", "Chicago"]]
    });
  });

  it("does not allow one tenant to open another tenant's CSV preview", async () => {
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue(null);

    await expect(getSupplyChainDesignProjectFile(context(PlatformRole.ADMIN, "tenant-2"), "project-1", "file-1")).resolves.toBeNull();
    expect(prismaMock.prisma.supplyChainDesignProjectFile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-2",
            id: "file-1"
          }
        }
      })
    );
  });

  it("rejects duplicate CSV content for the same project", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.prisma.supplyChainDesignProjectFile.findFirst.mockResolvedValue({
      originalFileName: "existing.csv"
    });

    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.append("files", new File(["A,B\n1,2\n"], "new.csv", { type: "text/csv" }));

    await expect(uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm)).resolves.toEqual({
      ok: false,
      message: "Duplicate content was already uploaded as existing.csv."
    });
    expect(prismaMock.tx.supplyChainDesignProjectFile.create).not.toHaveBeenCalled();
  });

  it("requires explicit same-name replacement confirmation before replacing", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.prisma.supplyChainDesignProjectFile.findMany.mockResolvedValue([
      {
        id: "file-existing",
        originalFileName: "delivery-demand.csv",
        mappings: []
      }
    ]);

    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.append("files", new File(["Demand ID,Annual Shipments\nD001,10\n"], "delivery-demand.csv", { type: "text/csv" }));

    await expect(uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm)).resolves.toEqual({
      ok: false,
      message: "A file with this name already exists: delivery-demand.csv. Replace it or cancel the upload."
    });
    expect(prismaMock.tx.supplyChainDesignProjectFile.create).not.toHaveBeenCalled();
  });

  it("uploads and automatically maps the official Current Facilities and Warehouse Costs template with the real unique selector", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    getAuthenticatedContext.mockResolvedValue(adminContext);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.tx.supplyChainDesignProjectFile.create.mockResolvedValue({
      id: "file-current",
      originalFileName: "renamed-current-facilities.csv",
      sizeBytes: 10,
      rowCount: 0
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-current",
      tableType: "FACILITIES",
      status: SupplyChainDesignMappingStatus.DRAFT
    });
    const csv = readFileSync("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv", "utf8");
    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.append("files", new File([csv], "renamed-current-facilities.csv", { type: "text/csv" }));

    await expect(uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm)).resolves.toEqual({
      ok: true,
      message: "1 CSV file uploaded. 1 file was automatically mapped from a Newl template."
    });

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_fileId: {
            tenantId: adminContext.tenantId,
            fileId: "file-current"
          }
        },
        create: expect.objectContaining({
          tableType: "FACILITIES",
          status: SupplyChainDesignMappingStatus.DRAFT
        }),
        update: expect.objectContaining({
          tableType: "FACILITIES",
          status: SupplyChainDesignMappingStatus.DRAFT
        })
      })
    );
    expect(JSON.stringify(prismaMock.tx.supplyChainDesignFileMapping.upsert.mock.calls)).not.toContain("fileId_tableType");
  });

  it("uses existing runtime Prisma enums for the approved shared datasets", () => {
    expect(SupplyChainDesignTableType.FACILITIES).toBe("FACILITIES");
    expect(SupplyChainDesignTableType.SHIPMENTS).toBe("SHIPMENTS");
    expect(SupplyChainDesignTableType.CANDIDATE_FACILITIES).toBe("CANDIDATE_FACILITIES");
  });

  it("uploads and automatically maps the official Historical Shipments example", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.tx.supplyChainDesignProjectFile.create.mockResolvedValue({
      id: "file-shipments",
      originalFileName: "customer-historical-shipments.csv",
      sizeBytes: 10,
      rowCount: 1
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-shipments",
      tableType: "SHIPMENTS",
      status: SupplyChainDesignMappingStatus.DRAFT
    });
    const csv = readFileSync("docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv", "utf8");
    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.append("files", new File([csv], "customer-historical-shipments.csv", { type: "text/csv" }));

    await uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm);

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_fileId: expect.objectContaining({ fileId: "file-shipments" })
        }),
        update: expect.objectContaining({
          tableType: "SHIPMENTS",
          fieldMappings: expect.arrayContaining([
            expect.objectContaining({ standardField: "origin_facility_id", sourceColumn: "Origin Facility ID" }),
            expect.objectContaining({ standardField: "shipment_quantity", sourceColumn: "Shipments" })
          ])
        })
      })
    );
  });

  it("recognizes and saves the dedicated Location Strategy Historical Shipments sample with optional State/Province", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.tx.supplyChainDesignProjectFile.create.mockResolvedValue({
      id: "file-location-strategy-shipments",
      originalFileName: "historical-shipments-location-strategy-fixture.csv",
      sizeBytes: 10,
      rowCount: 105
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-location-strategy-shipments",
      tableType: "SHIPMENTS",
      status: SupplyChainDesignMappingStatus.DRAFT
    });
    const csv = readFileSync("docs/modules/supply-chain-design/fixtures/warehouse-location-strategy/historical-shipments-location-strategy-fixture.csv", "utf8");
    const headers = csv.split("\n")[0].split(",");
    const recognized = recognizeSupplyChainDesignOfficialTemplate(headers);
    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.append("files", new File([csv], "historical-shipments-location-strategy-fixture.csv", { type: "text/csv" }));

    await expect(uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm)).resolves.toEqual({
      ok: true,
      message: "1 CSV file uploaded. 1 file was automatically mapped from a Newl template."
    });

    expect(recognized?.tableType).toBe("SHIPMENTS");
    expect(recognized?.fieldMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ standardField: "country", sourceColumn: "Destination Country", requirement: "OPTIONAL" }),
        expect.objectContaining({ standardField: "state_province", sourceColumn: "State/Province", requirement: "OPTIONAL" }),
        expect.objectContaining({ standardField: "postal_or_region_code", sourceColumn: "Destination ZIP / Postal Code", requirement: "OPTIONAL" })
      ])
    );
    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tableType: "SHIPMENTS",
          fieldMappings: expect.arrayContaining([
            expect.objectContaining({ standardField: "state_province", sourceColumn: "State/Province", requirement: "OPTIONAL" })
          ])
        })
      })
    );
  });

  it("returns a safe recognized-dataset upload message when automatic mapping persistence fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.tx.supplyChainDesignProjectFile.create.mockResolvedValue({
      id: "file-current",
      originalFileName: "current-facilities-and-costs-template.csv",
      sizeBytes: 10,
      rowCount: 0
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockRejectedValue(new Error("Invalid field mapping for FACILITIES: unknown standardField legacy_field."));
    const csv = readFileSync("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv", "utf8");
    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.append("files", new File([csv], "current-facilities-and-costs-template.csv", { type: "text/csv" }));

    await expect(uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm)).resolves.toEqual({
      ok: false,
      message: "The file was recognized as Current Facilities and Warehouse Costs, but its mapping could not be saved. Reason: Invalid field mapping for FACILITIES: unknown standardField legacy_field."
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("applies automatic mapping to an existing unmapped official template without overwriting saved mappings", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    getAuthenticatedContext.mockResolvedValue(adminContext);
    const headers = readFileSync("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv", "utf8")
      .trim()
      .split(/\r?\n/)[0]
      .split(",");
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-current",
      projectId: "project-1",
      detectedHeaders: headers,
      mappings: []
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-current",
      tableType: "FACILITIES",
      status: SupplyChainDesignMappingStatus.DRAFT
    });
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockClear();

    await expect(
      applySupplyChainDesignAutomaticMappingAction({ ok: false, message: "" }, form({ projectId: "project-1", fileId: "file-current" }))
    ).resolves.toEqual({ ok: true, message: "Current Facilities and Warehouse Costs was automatically mapped." });
    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_fileId: {
            tenantId: adminContext.tenantId,
            fileId: "file-current"
          }
        }
      })
    );

    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockClear();
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-current",
      projectId: "project-1",
      detectedHeaders: headers,
      mappings: [{ id: "mapping-manual", status: SupplyChainDesignMappingStatus.DRAFT }]
    });
    await expect(
      applySupplyChainDesignAutomaticMappingAction({ ok: false, message: "" }, form({ projectId: "project-1", fileId: "file-current" }))
    ).resolves.toEqual({
      ok: false,
      message: "This file already has a saved mapping. Review it before replacing it manually."
    });
    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).not.toHaveBeenCalled();
  });

  it("generates valid unique automatic field mappings for the approved shared datasets", () => {
    const headers = csvHeader("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv");
    const recognized = recognizeSupplyChainDesignOfficialTemplate(headers);
    expect(recognized?.tableType).toBe("FACILITIES");
    const mappings = recognized?.fieldMappings ?? [];
    expect(mappings).toHaveLength(11);
    expect(new Set(mappings.map((mapping) => mapping.standardField)).size).toBe(mappings.length);
    expect(new Set(mappings.map((mapping) => mapping.sourceColumn)).size).toBe(mappings.length);
    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" }),
        expect.objectContaining({ standardField: "facility_type", sourceColumn: "Facility Type", requirement: "REQUIRED" }),
        expect.objectContaining({ standardField: "annual_facility_warehouse_cost", sourceColumn: "Annual Facility / Warehouse Cost" }),
        expect.objectContaining({ standardField: "current_inventory_pallets", sourceColumn: "Current Inventory Pallets" })
      ])
    );
    expect(mappings.some((mapping) => Object.values(mapping).includes(undefined))).toBe(false);
  });

  it("returns a safe Apply automatic mapping message and logs diagnostics when persistence fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const headers = csvHeader("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv");
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-current",
      projectId: "project-1",
      detectedHeaders: headers,
      mappings: []
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockRejectedValue(new Error("database enum does not contain FACILITIES"));

    await expect(
      applySupplyChainDesignAutomaticMappingAction({ ok: false, message: "" }, form({ projectId: "project-1", fileId: "file-current" }))
    ).resolves.toEqual({
      ok: false,
      message: "The file was recognized as Current Facilities and Warehouse Costs, but its mapping could not be saved. Reason: Automatic mapping validation failed."
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Supply Chain Design automatic mapping failed",
      expect.objectContaining({
        stage: "apply-automatic-mapping-persistence",
        model: "SupplyChainDesignFileMapping",
        method: "upsert",
        tableType: "FACILITIES",
        fieldMappingCount: 11,
        error: expect.any(Error)
      })
    );
    consoleError.mockRestore();
  });

  it("returns review-required feedback when Apply automatic mapping receives a customer file", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-customer",
      projectId: "project-1",
      detectedHeaders: ["Customer Header", "Another Header"],
      mappings: []
    });

    await expect(
      applySupplyChainDesignAutomaticMappingAction({ ok: false, message: "" }, form({ projectId: "project-1", fileId: "file-customer" }))
    ).resolves.toEqual({
      ok: false,
      message: "This file does not exactly match a current Newl template. Review the field mapping."
    });
    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).not.toHaveBeenCalled();
  });

  it("replaces a same-name file and retains its mapping when mapped headers still exist", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.prisma.supplyChainDesignProjectFile.findMany.mockResolvedValue([
      {
        id: "file-existing",
        originalFileName: "delivery-demand.csv",
        mappings: [
          {
            id: "mapping-1",
            tableType: "DEMAND_POINTS",
            fieldMappings: testFieldMappings([
              ["destination_id", "Demand ID"],
              ["annual_shipment_count", "Annual Shipments"]
            ])
          }
        ]
      }
    ]);
    prismaMock.tx.supplyChainDesignProjectFile.update.mockResolvedValue({
      id: "file-existing",
      originalFileName: "delivery-demand.csv"
    });

    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.set("sameNameMode", "REPLACE");
    uploadForm.append("files", new File(["Demand ID,Annual Shipments\nD001,10\n"], "delivery-demand.csv", { type: "text/csv" }));

    await expect(uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm)).resolves.toMatchObject({
      ok: true
    });
    expect(prismaMock.tx.supplyChainDesignProjectFile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_id: { tenantId: "tenant-1", id: "file-existing" } },
        data: expect.objectContaining({
          detectedHeaders: ["Demand ID", "Annual Shipments"],
          status: "READY"
        })
      })
    );
    expect(prismaMock.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "supply-chain-design.file.replaced",
          after: expect.objectContaining({
            missingColumnsByMapping: [
              {
                mappingId: "mapping-1",
                tableType: "DEMAND_POINTS",
                missingColumns: []
              }
            ]
          })
        })
      })
    );
  });

  it("marks replacement audit evidence as needs attention when a mapped header disappears", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.prisma.supplyChainDesignProjectFile.findMany.mockResolvedValue([
      {
        id: "file-existing",
        originalFileName: "delivery-demand.csv",
        mappings: [
          {
            id: "mapping-1",
            tableType: "DEMAND_POINTS",
            fieldMappings: testFieldMappings([
              ["destination_id", "Demand ID"],
              ["annual_shipment_count", "Annual Shipments"]
            ])
          }
        ]
      }
    ]);
    prismaMock.tx.supplyChainDesignProjectFile.update.mockResolvedValue({
      id: "file-existing",
      originalFileName: "delivery-demand.csv"
    });

    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.set("sameNameMode", "REPLACE");
    uploadForm.append("files", new File(["Demand ID,Shipments\nD001,10\n"], "delivery-demand.csv", { type: "text/csv" }));

    await uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm);

    expect(prismaMock.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          after: expect.objectContaining({
            missingColumnsByMapping: [
              {
                mappingId: "mapping-1",
                tableType: "DEMAND_POINTS",
                missingColumns: ["Annual Shipments"]
              }
            ]
          })
        })
      })
    );
  });

  it("rejects stale keep-both same-name submissions instead of creating a version suffix", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.prisma.supplyChainDesignProjectFile.findMany.mockResolvedValue([
      {
        id: "file-existing",
        originalFileName: "delivery-demand.csv",
        mappings: []
      }
    ]);
    const uploadForm = new FormData();
    uploadForm.set("projectId", "project-1");
    uploadForm.set("sameNameMode", "KEEP_BOTH");
    uploadForm.append("files", new File(["Demand ID,Annual Shipments\nD001,10\n"], "delivery-demand.csv", { type: "text/csv" }));

    await expect(uploadSupplyChainDesignProjectFilesAction({ ok: false, message: "" }, uploadForm)).resolves.toEqual({
      ok: false,
      message: "A file with this name already exists: delivery-demand.csv. Replace it or cancel the upload."
    });

    expect(prismaMock.tx.supplyChainDesignProjectFile.create).not.toHaveBeenCalled();
  });

  it("shows file dependency warning before deleting an uploaded file", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      originalFileName: "delivery-demand.csv",
      mappings: [{ id: "mapping-1", tableType: "DEMAND_POINTS" }]
    });
    prismaMock.prisma.supplyChainDesignModelRun.findMany.mockResolvedValue([
      { inputReferences: { demandPoints: { fileId: "file-1" } } }
    ]);

    await expect(
      deleteSupplyChainDesignProjectFileAction(
        { ok: false, message: "" },
        form({ projectId: "project-1", fileId: "file-1" })
      )
    ).resolves.toEqual({
      ok: false,
      message:
        "Confirm delete for delivery-demand.csv. Logical table: DEMAND_POINTS. Saved mapping: yes. Referenced by 1 saved run/scenario record(s). Historical runs will not be deleted."
    });
    expect(prismaMock.prisma.supplyChainDesignProjectFile.delete).not.toHaveBeenCalled();
  });

  it("deletes only the selected uploaded file after confirmation and preserves historical runs", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      originalFileName: "delivery-demand.csv",
      mappings: []
    });
    prismaMock.prisma.supplyChainDesignProjectFile.delete.mockResolvedValue({ id: "file-1" });
    const deleteForm = form({ projectId: "project-1", fileId: "file-1" });
    deleteForm.set("confirmDelete", "on");

    await expect(deleteSupplyChainDesignProjectFileAction({ ok: false, message: "" }, deleteForm)).resolves.toEqual({
      ok: true,
      message: "delivery-demand.csv was deleted. Historical runs were preserved."
    });
    expect(prismaMock.prisma.supplyChainDesignProjectFile.delete).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "file-1" } }
    });
  });

  it("prevents deleting files outside the current project or tenant", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      tenantId: "tenant-1",
      projectId: "other-project",
      originalFileName: "delivery-demand.csv",
      mappings: []
    });
    const deleteForm = form({ projectId: "project-1", fileId: "file-1" });
    deleteForm.set("confirmDelete", "on");

    await expect(deleteSupplyChainDesignProjectFileAction({ ok: false, message: "" }, deleteForm)).resolves.toEqual({
      ok: false,
      message: "Uploaded file was not found for this project and tenant."
    });
  });

  it("deletes only the selected mapping after confirmation", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignFileMapping.findUnique.mockResolvedValue({
      id: "mapping-1",
      projectId: "project-1",
      tableType: "DEMAND_POINTS",
      file: { originalFileName: "delivery-demand.csv" }
    });
    prismaMock.prisma.supplyChainDesignFileMapping.delete.mockResolvedValue({ id: "mapping-1" });
    const deleteForm = form({ projectId: "project-1", mappingId: "mapping-1" });
    deleteForm.set("confirmDelete", "on");

    await expect(deleteSupplyChainDesignFileMappingAction({ ok: false, message: "" }, deleteForm)).resolves.toEqual({
      ok: true,
      message: "DEMAND_POINTS mapping was deleted."
    });
    expect(prismaMock.prisma.supplyChainDesignFileMapping.delete).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "mapping-1" } }
    });
    expect(prismaMock.prisma.supplyChainDesignProjectFile.delete).not.toHaveBeenCalled();
  });

  it("deletes individual saved run records without deleting files or mappings", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignModelRun.deleteMany.mockResolvedValue({ count: 1 });
    const deleteForm = form({ projectId: "project-1", runId: "run-1", runType: "MODEL_01" });
    deleteForm.set("confirmDelete", "on");

    await expect(deleteSupplyChainDesignRunAction({ ok: false, message: "" }, deleteForm)).resolves.toEqual({
      ok: true,
      message: "Model 01 run was deleted."
    });
    expect(prismaMock.prisma.supplyChainDesignModelRun.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", projectId: "project-1", id: "run-1" }
    });
    expect(prismaMock.prisma.supplyChainDesignProjectFile.delete).not.toHaveBeenCalled();
    expect(prismaMock.prisma.supplyChainDesignFileMapping.delete).not.toHaveBeenCalled();
  });

  it("deletes saved Network Design reports through the saved-run delete action", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.automationJobRun.findFirst.mockResolvedValueOnce({
      id: "batch-1",
      input: {
        projectId: "project-1"
      }
    });
    prismaMock.prisma.automationJobRun.deleteMany.mockResolvedValueOnce({ count: 1 });
    const deleteForm = form({ projectId: "project-1", runId: "batch-1", runType: "NETWORK_DESIGN" });
    deleteForm.set("confirmDelete", "on");

    await expect(deleteSupplyChainDesignRunAction({ ok: false, message: "" }, deleteForm)).resolves.toEqual({
      ok: true,
      message: "Network Design report was deleted."
    });
    expect(prismaMock.prisma.automationJobRun.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        id: "batch-1",
        jobType: "supply-chain-design.candidate-ltl-rate-batch"
      },
      select: {
        id: true,
        input: true
      }
    });
    expect(prismaMock.prisma.automationJobRun.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        id: "batch-1",
        jobType: "supply-chain-design.candidate-ltl-rate-batch"
      }
    });
  });

  it("rejects empty, non-CSV, oversized, and malformed CSV uploads", async () => {
    await expect(parseSupplyChainDesignCsvUpload(new File([""], "empty.csv", { type: "text/csv" }))).rejects.toThrow(
      "empty.csv is empty."
    );
    await expect(parseSupplyChainDesignCsvUpload(new File(["A,B\n"], "lanes.txt", { type: "text/plain" }))).rejects.toThrow(
      "Only .csv files are supported."
    );
    await expect(
      parseSupplyChainDesignCsvUpload({
        name: "large.csv",
        type: "text/csv",
        size: SUPPLY_CHAIN_DESIGN_CSV_MAX_BYTES + 1,
        arrayBuffer: async () => new ArrayBuffer(0)
      } as File)
    ).rejects.toThrow("large.csv is too large.");
    await expect(parseSupplyChainDesignCsvUpload(new File(["A,B\n\"bad"], "bad.csv", { type: "text/csv" }))).rejects.toThrow(
      "CSV contains an unclosed quoted value."
    );
  });

  it("parses quoted CSV headers and preview rows", () => {
    expect(parseCsvRows("\"Origin City\",Destination\n\"Toronto, ON\",Chicago\n")).toEqual([
      ["Origin City", "Destination"],
      ["Toronto, ON", "Chicago"]
    ]);
  });

  it("saves a valid facility mapping", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    getAuthenticatedContext.mockResolvedValue(adminContext);
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: ["Facility ID", "Name", "Type", "City", "Country"]
    });
    prismaMock.tx.auditLog.create.mockResolvedValue({ id: "audit-3" });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "FACILITIES",
          "field:facility_id": "Facility ID",
          "field:facility_name": "Name",
          "field:facility_type": "Type",
          "field:city": "City",
          "field:country": "Country"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Saved facilities mapping." });

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith({
      where: {
        tenantId_fileId: {
          tenantId: adminContext.tenantId,
          fileId: "file-1"
        }
      },
      create: expect.objectContaining({
        tenantId: adminContext.tenantId,
        projectId: "project-1",
        fileId: "file-1",
        tableType: SupplyChainDesignTableType.FACILITIES,
        status: SupplyChainDesignMappingStatus.DRAFT,
        createdByUserId: adminContext.userId
      }),
      update: expect.objectContaining({
        tableType: SupplyChainDesignTableType.FACILITIES,
        status: SupplyChainDesignMappingStatus.DRAFT,
        createdByUserId: adminContext.userId
      })
    });
    expect(prismaMock.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: adminContext.tenantId,
        actorUserId: adminContext.userId,
        action: "supply-chain-design.file-mapping.saved",
        entityType: "SupplyChainDesignFileMapping",
        entityId: "mapping-1"
      })
    });
  });

  it("rejects a missing required mapping", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: ["Facility ID", "Name", "Type", "City", "Country"]
    });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "FACILITIES",
          "field:facility_id": "Facility ID",
          "field:facility_type": "Type",
          "field:city": "City",
          "field:country": "Country"
        })
      )
    ).resolves.toEqual({ ok: false, message: "facility_name is required." });
    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown source column", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: ["Facility ID", "Name", "Type", "City", "Country"]
    });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "FACILITIES",
          "field:facility_id": "Facility ID",
          "field:facility_name": "Missing Column",
          "field:facility_type": "Type",
          "field:city": "City",
          "field:country": "Country"
        })
      )
    ).resolves.toEqual({ ok: false, message: "Missing Column is not a detected CSV header." });
  });

  it("rejects duplicate source columns", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: ["Facility ID", "Name", "Type", "City", "Country"]
    });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "FACILITIES",
          "field:facility_id": "Facility ID",
          "field:facility_name": "Name",
          "field:facility_type": "Type",
          "field:city": "City",
          "field:country": "City"
        })
      )
    ).resolves.toEqual({ ok: false, message: "City is already mapped to another field." });
  });

  it("keeps a saved mapping visible after reloading a file", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      tenantId: adminContext.tenantId,
      projectId: "project-1",
      originalFileName: "facilities.csv",
      contentType: "text/csv",
      sizeBytes: 64,
      contentHash: "hash-1",
      rowCount: 1,
      detectedHeaders: ["Facility ID", "Name", "Type", "City", "Country"],
      previewRows: [["F1", "Toronto DC", "DC", "Toronto", "Canada"]],
      status: "READY",
      createdAt,
      project: {
        id: "project-1",
        name: "Network baseline"
      },
      uploadedBy: null,
      mappings: [
        {
          id: "mapping-1",
          tableType: "FACILITIES",
          fieldMappings: [
            { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" }
          ],
          status: "DRAFT",
          createdAt,
          updatedAt
        }
      ]
    });

    await expect(getSupplyChainDesignProjectFile(adminContext, "project-1", "file-1")).resolves.toMatchObject({
      mapping: {
        id: "mapping-1",
        tableType: "FACILITIES",
        fieldMappings: [{ standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" }]
      }
    });
  });

  it("edits the saved mapping by replacing the draft for the file", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: ["Facility ID", "Item", "Qty", "Cost"]
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-1",
      tableType: SupplyChainDesignTableType.INVENTORY,
      status: SupplyChainDesignMappingStatus.DRAFT
    });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "INVENTORY",
          "field:facility_id": "Facility ID",
          "field:item_id": "Item",
          "field:quantity": "Qty",
          "field:unit_cost": "Cost"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Saved inventory mapping." });

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tableType: SupplyChainDesignTableType.INVENTORY,
          fieldMappings: expect.arrayContaining([
            { standardField: "unit_cost", sourceColumn: "Cost", requirement: "OPTIONAL" }
          ])
        })
      })
    );
  });

  it("saves a valid facility costs mapping", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: ["Facility ID", "Category", "Annual Cost", "Currency", "Year", "Notes"]
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-1",
      tableType: SupplyChainDesignTableType.FACILITY_COSTS,
      status: SupplyChainDesignMappingStatus.DRAFT
    });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "FACILITY_COSTS",
          "field:facility_id": "Facility ID",
          "field:cost_category": "Category",
          "field:annual_cost": "Annual Cost",
          "field:currency": "Currency",
          "field:cost_year": "Year",
          "field:notes": "Notes"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Saved facility_costs mapping." });

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tableType: SupplyChainDesignTableType.FACILITY_COSTS,
          fieldMappings: expect.arrayContaining([
            { standardField: "annual_cost", sourceColumn: "Annual Cost", requirement: "REQUIRED" },
            { standardField: "cost_year", sourceColumn: "Year", requirement: "OPTIONAL" }
          ])
        })
      })
    );
  });

  it("saves a valid candidate-facilities mapping", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: [
        "Candidate ID",
        "Candidate Name",
        "Candidate Type",
        "Candidate ZIP",
        "Candidate Country",
        "City",
        "Country",
        "Fixed Cost",
        "Capacity"
      ]
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-1",
      tableType: SupplyChainDesignTableType.CANDIDATE_FACILITIES,
      status: SupplyChainDesignMappingStatus.DRAFT
    });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "CANDIDATE_FACILITIES",
          "field:candidate_facility_id": "Candidate ID",
          "field:candidate_facility_name": "Candidate Name",
          "field:candidate_type": "Candidate Type",
          "field:postal_code": "Candidate ZIP",
          "field:candidate_country": "Candidate Country",
          "field:city": "City",
          "field:country": "Country",
          "field:annual_fixed_cost": "Fixed Cost",
          "field:capacity": "Capacity"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Saved candidate_facilities mapping." });

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tableType: SupplyChainDesignTableType.CANDIDATE_FACILITIES,
          fieldMappings: expect.arrayContaining([
            { standardField: "candidate_facility_id", sourceColumn: "Candidate ID", requirement: "REQUIRED" },
            { standardField: "candidate_type", sourceColumn: "Candidate Type", requirement: "REQUIRED" },
            { standardField: "postal_code", sourceColumn: "Candidate ZIP", requirement: "REQUIRED" },
            { standardField: "candidate_country", sourceColumn: "Candidate Country", requirement: "REQUIRED" },
            { standardField: "annual_fixed_cost", sourceColumn: "Fixed Cost", requirement: "OPTIONAL" },
            { standardField: "capacity", sourceColumn: "Capacity", requirement: "OPTIONAL" }
          ])
        })
      })
    );
  });

  it("saves a valid scenario-lane-costs mapping", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: ["Origin", "Destination", "Cost", "Service Days"]
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-1",
      tableType: SupplyChainDesignTableType.SCENARIO_LANE_COSTS,
      status: SupplyChainDesignMappingStatus.DRAFT
    });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "SCENARIO_LANE_COSTS",
          "field:origin_facility_id": "Origin",
          "field:destination_id": "Destination",
          "field:cost_per_shipment": "Cost",
          "field:service_days": "Service Days"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Saved scenario_lane_costs mapping." });

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tableType: SupplyChainDesignTableType.SCENARIO_LANE_COSTS,
          fieldMappings: expect.arrayContaining([
            { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
            { standardField: "cost_per_shipment", sourceColumn: "Cost", requirement: "REQUIRED" },
            { standardField: "service_days", sourceColumn: "Service Days", requirement: "OPTIONAL" }
          ])
        })
      })
    );
  });

  it("saves a DEMAND_POINTS mapping without city or state for U.S. ZIP-based screening", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: ["Demand ID", "Destination ZIP", "Country", "Annual Shipments"]
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-1",
      tableType: SupplyChainDesignTableType.DEMAND_POINTS,
      status: SupplyChainDesignMappingStatus.DRAFT
    });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "DEMAND_POINTS",
          "field:destination_id": "Demand ID",
          "field:postal_or_region_code": "Destination ZIP",
          "field:country": "Country",
          "field:annual_shipment_count": "Annual Shipments"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Saved demand_points mapping." });

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tableType: SupplyChainDesignTableType.DEMAND_POINTS,
          fieldMappings: expect.arrayContaining([
            { standardField: "destination_id", sourceColumn: "Demand ID", requirement: "REQUIRED" },
            { standardField: "postal_or_region_code", sourceColumn: "Destination ZIP", requirement: "REQUIRED" },
            { standardField: "country", sourceColumn: "Country", requirement: "REQUIRED" },
            { standardField: "annual_shipment_count", sourceColumn: "Annual Shipments", requirement: "REQUIRED" },
            { standardField: "city", sourceColumn: null, requirement: "OPTIONAL" },
            { standardField: "state_province", sourceColumn: null, requirement: "OPTIONAL" }
          ])
        })
      })
    );
  });

  it("saves a valid customers mapping", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "file-1",
      projectId: "project-1",
      detectedHeaders: ["Customer ID", "Customer Name", "City", "Country", "Segment", "Annual Demand"]
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-1",
      tableType: SupplyChainDesignTableType.CUSTOMERS,
      status: SupplyChainDesignMappingStatus.DRAFT
    });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "CUSTOMERS",
          "field:customer_id": "Customer ID",
          "field:customer_name": "Customer Name",
          "field:city": "City",
          "field:country": "Country",
          "field:customer_segment": "Segment",
          "field:annual_demand": "Annual Demand"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Saved customers mapping." });

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tableType: SupplyChainDesignTableType.CUSTOMERS,
          fieldMappings: expect.arrayContaining([
            { standardField: "customer_id", sourceColumn: "Customer ID", requirement: "REQUIRED" },
            { standardField: "annual_demand", sourceColumn: "Annual Demand", requirement: "OPTIONAL" }
          ])
        })
      })
    );
  });

  it("does not allow one tenant to save a mapping for another tenant's file", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN, "tenant-2"));
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue(null);

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "FACILITIES",
          "field:facility_id": "Facility ID"
        })
      )
    ).resolves.toEqual({ ok: false, message: "Uploaded file was not found for this project." });
    expect(prismaMock.prisma.supplyChainDesignProjectFile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-2",
            id: "file-1"
          }
        }
      })
    );
    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).not.toHaveBeenCalled();
  });

  it("blocks unauthorized roles from saving mappings", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.OPERATIONS));

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "file-1",
          tableType: "FACILITIES"
        })
      )
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).not.toHaveBeenCalled();
  });

  it("runs a successful Model 01 proof using mapped facilities and shipments", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    getAuthenticatedContext.mockResolvedValue(adminContext);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithProofMappings());

    await expect(
      runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm())
    ).resolves.toEqual({ ok: true, message: "Current Network Baseline completed." });

    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: adminContext.tenantId,
            id: "project-1"
          }
        }
      })
    );
    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: adminContext.tenantId,
        projectId: "project-1",
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        inputReferences: expect.objectContaining({
          facilities: expect.objectContaining({
            fileId: "facilities-file",
            fileName: "facilities.csv",
            mappingId: "facilities-mapping"
          }),
          shipments: expect.objectContaining({
            fileId: "shipments-file",
            fileName: "shipments.csv",
            mappingId: "shipments-mapping"
          })
        }),
        createdByUserId: adminContext.userId
      })
    });
    expect(prismaMock.prisma.supplyChainDesignModelRun.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_id: {
          tenantId: adminContext.tenantId,
          id: "run-1"
        }
      },
      select: {
        id: true
      }
    });
  });

  it("runs Model 01 from one combined current-network dataset without a technical Demand ID", () => {
    const result = runSupplyChainDesignModel01Proof(currentNetworkActivityInput());

    expect(result.facilityCount).toBe(2);
    expect(result.shipmentCount).toBe(28);
    expect(result.hasTransportationCost).toBe(true);
    expect(result.totalTransportationCost).toBe(3105);
    expect(result.hasCustomers).toBe(true);
    expect(result.customerCount).toBe(4);
    expect(result.shipmentCountByDestination?.map((row) => row.destinationId)).toEqual([
      "10001",
      "75201",
      "Customer A",
      "Customer B"
    ]);
    expect(result.laneShipmentCounts).toEqual(
      expect.arrayContaining([
        { originFacilityId: "TOR-01", destinationId: "10001", shipmentCount: 1 },
        { originFacilityId: "DFW-3PL", destinationId: "75201", shipmentCount: 25 }
      ])
    );
    expect(result.hasInventory).toBe(true);
    expect(result.inventoryQuantity).toBe(200);
    expect(result.hasInventoryValue).toBe(true);
    expect(result.inventoryValue).toBe(5600);
    expect(result.hasFacilityCosts).toBe(false);
    expect(result.totalFacilityOperatingCost).toBeNull();
    expect(result.facilitySummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          facilityId: "DFW-3PL",
          facilityName: "Dallas 3PL",
          shipmentCount: 26,
          transportationCost: 2485,
          facilityOperatingCost: null,
          observedCost: 2485
        }),
        expect.objectContaining({
          facilityId: "TOR-01",
          facilityName: "Toronto DC",
          shipmentCount: 2,
          transportationCost: 620,
          facilityOperatingCost: null,
          observedCost: 620
        })
      ])
    );
    expect(result.analysisLevels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Geographic and lane baseline", status: "AVAILABLE" }),
        expect.objectContaining({ label: "Transportation-cost baseline", status: "AVAILABLE" }),
        expect.objectContaining({ label: "Facility-cost baseline", status: "NOT_CALCULATED" }),
        expect.objectContaining({ label: "Service baseline", status: "AVAILABLE" })
      ])
    );
    expect(result.volumeSummary).toMatchObject({
      totalShipments: 28,
      totalPallets: 31,
      totalUnits: 419,
      totalWeight: 13500,
      transportationCostPerShipment: 110.89285714285714,
      transportationCostPerPallet: 100.16129032258064
    });
    expect(result.modeSummary).toEqual([
      { mode: "LTL", shipmentCount: 2, transportationCost: 1135 },
      { mode: "Parcel", shipmentCount: 26, transportationCost: 1970 }
    ]);
    expect(result.serviceLevelSummary).toEqual([
      { serviceLevel: "Ground", shipmentCount: 26 },
      { serviceLevel: "Standard", shipmentCount: 2 }
    ]);
    expect(result.skuSummary).toMatchObject({ distinctSkuCount: 2 });
    expect(result.snapshotPalletUtilization).toEqual([
      expect.objectContaining({
        facilityId: "DFW-3PL",
        facilityName: "Dallas 3PL",
        facilityType: "Existing 3PL",
        capacityPalletPositions: 8000,
        inventoryPallets: 2,
        snapshotDate: "2026-01-31",
        latest: true
      }),
      expect.objectContaining({
        facilityId: "TOR-01",
        facilityName: "Toronto DC",
        facilityType: "Owned",
        capacityPalletPositions: 12000,
        inventoryPallets: 3,
        snapshotDate: "2026-01-31",
        latest: true
      })
    ]);
  });

  it("runs Current Network Baseline from the populated official samples with volume, utilization, and currency summaries", () => {
    const facilitiesCsv = readFileSync("docs/modules/supply-chain-design/sample-data/current-facilities-and-costs-sample.csv", "utf8");
    const facilitiesRecognition = recognizeSupplyChainDesignOfficialTemplate(csvHeader("docs/modules/supply-chain-design/sample-data/current-facilities-and-costs-sample.csv"));
    const shipmentsCsv = readFileSync("docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv", "utf8");
    const shipmentsRecognition = recognizeSupplyChainDesignOfficialTemplate(csvHeader("docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv"));

    expect(facilitiesRecognition?.tableType).toBe("FACILITIES");
    expect(shipmentsRecognition?.tableType).toBe("SHIPMENTS");
    const result = runSupplyChainDesignModel01Proof({
      facilities: {
        fileId: "facilities-file",
        mappingId: "facilities-mapping",
        tableType: "FACILITIES" as SupplyChainDesignTableType,
        fileBytes: Buffer.from(facilitiesCsv),
        fieldMappings: facilitiesRecognition?.fieldMappings ?? []
      },
      shipments: {
        fileId: "shipments-file",
        mappingId: "shipments-mapping",
        tableType: "SHIPMENTS" as SupplyChainDesignTableType,
        fileBytes: Buffer.from(shipmentsCsv),
        fieldMappings: shipmentsRecognition?.fieldMappings ?? []
      },
      inventory: null,
      facilityCosts: null,
      customers: null
    });

    expect(result.facilityCount).toBe(2);
    expect(shipmentsCsv.trim().split(/\r?\n/).length - 1).toBe(12);
    expect(result.shipmentCount).toBe(116);
    expect(result.volumeSummary).toMatchObject({
      totalPallets: 217,
      totalUnits: 4360,
      totalWeight: 129050
    });
    expect(result.transportationCostByCurrency).toEqual([{ currency: "USD", transportationCost: 59595 }]);
    expect(result.facilityCostByCurrency).toEqual([{ currency: "USD", facilityOperatingCost: 485000 }]);
    expect(result.observedNetworkCostByCurrency).toEqual([{ currency: "USD", observedCost: 544595 }]);
    expect(result.snapshotPalletUtilization).toEqual([
      expect.objectContaining({
        facilityId: "DFW-01",
        facilityType: "Existing 3PL",
        capacityPalletPositions: 9000,
        inventoryPallets: 2300,
        utilizationPercent: 25.555555555555554,
        latest: true
      }),
      expect.objectContaining({
        facilityId: "TOR-01",
        facilityType: "Owned",
        capacityPalletPositions: 12000,
        inventoryPallets: 3500,
        utilizationPercent: 29.166666666666668,
        latest: true
      })
    ]);
    expect(result.facilitySummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          facilityId: "DFW-01",
          facilityType: "Existing 3PL",
          shipmentCount: 64,
          pallets: 122,
          units: 2450,
          weight: 71800,
          transportationCost: 34300,
          facilityOperatingCost: 210000,
          observedCost: 244300
        }),
        expect.objectContaining({
          facilityId: "TOR-01",
          facilityType: "Owned",
          shipmentCount: 52,
          pallets: 95,
          units: 1910,
          weight: 57250,
          transportationCost: 25295,
          facilityOperatingCost: 275000,
          observedCost: 300295
        })
      ])
    );
  });

  it("derives Current Network Baseline weight units from the selected Historical Shipments source file", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...projectReloadWithMultipleMappings(adminContext),
      files: [
        fileSummaryFixture("facilities-file", "facilities.csv", "hash-f", [
          {
            id: "facilities-mapping",
            tableType: "FACILITIES",
            updatedAt,
            fieldMappings: [
              { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
              { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" }
            ]
          }
        ]),
        {
          ...fileSummaryFixture("shipments-file", "historical-shipments.csv", "hash-s", [
            {
              id: "shipments-mapping",
              tableType: "SHIPMENTS",
              updatedAt,
              fieldMappings: [
                { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
                { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
                { standardField: "weight", sourceColumn: "Weight", requirement: "OPTIONAL" },
                { standardField: "weight_unit", sourceColumn: "Weight Unit", requirement: "OPTIONAL" }
              ]
            }
          ]),
          fileBytes: Buffer.from("Shipment ID,Origin,Weight,Weight Unit\nS1,F1,100,lb\nS2,F1,200,lb\n")
        }
      ],
      modelRuns: [
        {
          id: "run-1",
          status: "SUCCESS",
          createdAt,
          errorMessage: null,
          inputReferences: {
            currentNetworkActivity: null,
            facilities: { fileId: "facilities-file", fileName: "facilities.csv", mappingId: "facilities-mapping", mappingUpdatedAt: updatedAt.toISOString(), candidateFiles: [] },
            shipments: { fileId: "shipments-file", fileName: "historical-shipments.csv", mappingId: "shipments-mapping", mappingUpdatedAt: updatedAt.toISOString(), candidateFiles: [] },
            inventory: null,
            facilityCosts: null,
            customers: null
          },
          resultSummary: {
            facilityCount: 1,
            shipmentCount: 2,
            hasTransportationCost: false,
            shipmentCountByOrigin: [],
            unmatchedShipmentOriginIds: [],
            hasInventory: false,
            unmatchedInventoryFacilityIds: [],
            hasInventoryValue: false,
            hasFacilityCosts: false,
            unmatchedFacilityCostFacilityIds: [],
            hasCustomers: false,
            unmatchedShipmentDestinationIds: [],
            hasCustomerDemand: false,
            hasServiceDays: false,
            facilitySummary: [{ facilityId: "F1", facilityName: "Facility 1", shipmentCount: 2, weight: 300 }],
            volumeSummary: { totalShipments: 2, totalWeight: 300 },
            deferredValidation: []
          }
        }
      ]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestModelRun: {
        weightUnit: "lb",
        weightUnitWarning: null
      }
    });
  });

  it("does not assume a Current Network Baseline weight unit when none is available", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...projectReloadWithMultipleMappings(adminContext),
      files: [
        {
          ...fileSummaryFixture("shipments-file", "historical-shipments.csv", "hash-s", [
            {
              id: "shipments-mapping",
              tableType: "SHIPMENTS",
              updatedAt,
              fieldMappings: [
                { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
                { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
                { standardField: "weight", sourceColumn: "Weight", requirement: "OPTIONAL" }
              ]
            }
          ]),
          fileBytes: Buffer.from("Shipment ID,Origin,Weight\nS1,F1,100\n")
        }
      ],
      modelRuns: [
        {
          id: "run-1",
          status: "SUCCESS",
          createdAt,
          errorMessage: null,
          inputReferences: {
            currentNetworkActivity: null,
            facilities: null,
            shipments: { fileId: "shipments-file", fileName: "historical-shipments.csv", mappingId: "shipments-mapping", mappingUpdatedAt: updatedAt.toISOString(), candidateFiles: [] },
            inventory: null,
            facilityCosts: null,
            customers: null
          },
          resultSummary: {
            facilityCount: 0,
            shipmentCount: 1,
            hasTransportationCost: false,
            shipmentCountByOrigin: [],
            unmatchedShipmentOriginIds: [],
            hasInventory: false,
            unmatchedInventoryFacilityIds: [],
            hasInventoryValue: false,
            hasFacilityCosts: false,
            unmatchedFacilityCostFacilityIds: [],
            hasCustomers: false,
            unmatchedShipmentDestinationIds: [],
            hasCustomerDemand: false,
            hasServiceDays: false,
            facilitySummary: [],
            volumeSummary: { totalShipments: 1, totalWeight: 100 },
            deferredValidation: []
          }
        }
      ]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestModelRun: {
        weightUnit: null,
        weightUnitWarning: null
      }
    });
  });

  it("runs and persists Current Network Baseline with Historical Shipments and Current Facilities selected", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    getAuthenticatedContext.mockResolvedValue(adminContext);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithProofMappings());

    await expect(
      runSupplyChainDesignModel01ProofAction(
        { ok: false, message: "" },
        proofRunForm()
      )
    ).resolves.toEqual({ ok: true, message: "Current Network Baseline completed." });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        inputReferences: expect.objectContaining({
          currentNetworkActivity: null,
          facilities: expect.objectContaining({ mappingId: "facilities-mapping" }),
          shipments: expect.objectContaining({ mappingId: "shipments-mapping" })
        }),
        resultSummary: expect.objectContaining({
          facilityCount: 2,
          shipmentCount: 3,
          hasTransportationCost: true,
          totalTransportationCost: 22.5,
          volumeSummary: expect.objectContaining({
            totalShipments: 3
          })
        })
      })
    });
  });

  it("keeps Model 01 optional analysis levels independent for missing destination or cost fields", () => {
    const result = runSupplyChainDesignModel01Proof(
      currentNetworkActivityInput({
        csv: currentNetworkActivityCsvWithoutDestinationOrCost(),
        fields: currentNetworkActivityMappingsWithoutDestinationOrCost()
      })
    );

    expect(result.facilityCount).toBe(2);
    expect(result.shipmentCount).toBe(26);
    expect(result.hasCustomers).toBe(false);
    expect(result.networkLanes).toBeNull();
    expect(result.hasTransportationCost).toBe(false);
    expect(result.totalTransportationCost).toBeNull();
    expect(result.analysisLevels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Geographic and lane baseline",
          status: "NOT_CALCULATED",
          explanation: "Not calculated - destination/customer fields were not supplied."
        }),
        expect.objectContaining({
          label: "Transportation-cost baseline",
          status: "NOT_CALCULATED",
          explanation: "Not calculated - transportation cost was not supplied."
        })
      ])
    );
  });

  it("deduplicates repeated facility data and reports conflicting repeated facility values", () => {
    const result = runSupplyChainDesignModel01Proof(
      currentNetworkActivityInput({
        csv: currentNetworkActivityCsvWithFacilityConflict()
      })
    );

    expect(result.facilityCount).toBe(2);
    expect(result.facilityDataWarnings).toEqual(
      expect.arrayContaining([
        'Conflicting repeated facility value for TOR-01: facility_name has "Toronto DC" and "Toronto DC East".'
      ])
    );
  });

  it("persists Model 01 proof result totals and grouping by origin", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithProofMappings());

    await runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm());

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          facilityCount: 2,
          shipmentCount: 3,
          hasTransportationCost: true,
          totalTransportationCost: 22.5,
          shipmentCountByOrigin: [
            { originFacilityId: "F1", shipmentCount: 2 },
            { originFacilityId: "F3", shipmentCount: 1 }
          ],
          transportationCostByOrigin: [
            { originFacilityId: "F1", transportationCost: 17.5 },
            { originFacilityId: "F3", transportationCost: 5 }
          ],
          unmatchedShipmentOriginIds: ["F3"]
        })
      })
    });
  });

  it("does not return success unless the saved run can be retrieved afterward", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithProofMappings());
    prismaMock.prisma.supplyChainDesignModelRun.findUnique.mockResolvedValue(null);

    await expect(
      runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm())
    ).resolves.toEqual({
      ok: false,
      message: "Current Network Baseline run was created but could not be retrieved."
    });
  });

  it("runs without transportation cost when the optional shipment cost field is not mapped", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithProofMappings({ includeCost: false }));

    await expect(
      runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm())
    ).resolves.toEqual({ ok: true, message: "Current Network Baseline completed." });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        resultSummary: expect.objectContaining({
          hasTransportationCost: false,
          totalTransportationCost: null,
          transportationCostByOrigin: null
        })
      })
    });
  });

  it("saves a LOGISTICS_MARKETS mapping without a separate major_city source column", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    getAuthenticatedContext.mockResolvedValue(adminContext);
    prismaMock.prisma.supplyChainDesignProjectFile.findUnique.mockResolvedValue({
      id: "market-file",
      projectId: "project-1",
      detectedHeaders: ["Market ID", "Market Name", "Country", "State/Province", "Latitude", "Longitude", "Market Type"]
    });
    prismaMock.tx.supplyChainDesignFileMapping.upsert.mockResolvedValue({
      id: "mapping-1",
      tableType: SupplyChainDesignTableType.LOGISTICS_MARKETS,
      status: SupplyChainDesignMappingStatus.DRAFT
    });
    prismaMock.tx.auditLog.create.mockResolvedValue({ id: "audit-3" });

    await expect(
      saveSupplyChainDesignFileMappingAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          fileId: "market-file",
          tableType: "LOGISTICS_MARKETS",
          "field:market_id": "Market ID",
          "field:market_name": "Market Name",
          "field:state_province": "State/Province",
          "field:country": "Country",
          "field:latitude": "Latitude",
          "field:longitude": "Longitude",
          "field:active_eligible": "Market Type"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Saved logistics_markets mapping." });

    expect(prismaMock.tx.supplyChainDesignFileMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tableType: SupplyChainDesignTableType.LOGISTICS_MARKETS,
          fieldMappings: expect.arrayContaining([
            { standardField: "major_city", sourceColumn: null, requirement: "OPTIONAL" }
          ])
        })
      })
    );
  });

  it("runs with an explicit optional inventory mapping and persists selected filenames and IDs", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithProofMappings({ includeInventory: true }));

    await expect(
      runSupplyChainDesignModel01ProofAction(
        { ok: false, message: "" },
        proofRunForm({ inventoryMappingId: "inventory-mapping" })
      )
    ).resolves.toEqual({ ok: true, message: "Current Network Baseline completed." });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputReferences: expect.objectContaining({
          facilities: expect.objectContaining({
            fileId: "facilities-file",
            fileName: "facilities.csv",
            mappingId: "facilities-mapping"
          }),
          shipments: expect.objectContaining({
            fileId: "shipments-file",
            fileName: "shipments.csv",
            mappingId: "shipments-mapping"
          }),
          inventory: expect.objectContaining({
            fileId: "inventory-file",
            fileName: "inventory.csv",
            mappingId: "inventory-mapping"
          })
        })
      })
    });
  });

  it("calculates inventory quantity, value, grouping, combined facility summary, and unmatched inventory facilities", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithProofMappings({ includeInventory: true }));

    await runSupplyChainDesignModel01ProofAction(
      { ok: false, message: "" },
      proofRunForm({ inventoryMappingId: "inventory-mapping" })
    );

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          hasInventory: true,
          inventoryQuantity: 16,
          inventoryQuantityByFacility: [
            { facilityId: "F1", inventoryQuantity: 10 },
            { facilityId: "F2", inventoryQuantity: 5 },
            { facilityId: "F9", inventoryQuantity: 1 }
          ],
          hasInventoryValue: true,
          inventoryValue: 39,
          inventoryValueByFacility: [
            { facilityId: "F1", inventoryValue: 20 },
            { facilityId: "F2", inventoryValue: 15 },
            { facilityId: "F9", inventoryValue: 4 }
          ],
          unmatchedInventoryFacilityIds: ["F9"],
          facilitySummary: [
            expect.objectContaining({
              facilityId: "F1",
              facilityName: "Toronto DC",
              shipmentCount: 2,
              transportationCost: 17.5,
              inventoryQuantity: 10,
              inventoryValue: 20,
              facilityOperatingCost: null,
              observedCost: 17.5
            }),
            expect.objectContaining({
              facilityId: "F2",
              facilityName: "Montreal DC",
              shipmentCount: 0,
              transportationCost: 0,
              inventoryQuantity: 5,
              inventoryValue: 15,
              facilityOperatingCost: null,
              observedCost: 0
            })
          ]
        })
      })
    });
  });

  it("keeps facilities and shipments proof working when inventory is not selected", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithProofMappings({ includeInventory: true }));

    await runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm());

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputReferences: expect.objectContaining({
          inventory: null
        }),
        resultSummary: expect.objectContaining({
          hasInventory: false,
          inventoryQuantity: null,
          inventoryValue: null
        })
      })
    });
  });

  it("runs with an optional facility costs mapping and persists selected filenames and IDs", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeFacilityCosts: true })
    );

    await expect(
      runSupplyChainDesignModel01ProofAction(
        { ok: false, message: "" },
        proofRunForm({ facilityCostsMappingId: "facility-costs-mapping" })
      )
    ).resolves.toEqual({ ok: true, message: "Current Network Baseline completed." });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputReferences: expect.objectContaining({
          facilityCosts: expect.objectContaining({
            fileId: "facility-costs-file",
            fileName: "facility-costs.csv",
            mappingId: "facility-costs-mapping"
          })
        })
      })
    });
  });

  it("calculates facility operating costs, grouping, observed cost, and unmatched cost facilities", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeFacilityCosts: true })
    );

    await runSupplyChainDesignModel01ProofAction(
      { ok: false, message: "" },
      proofRunForm({ facilityCostsMappingId: "facility-costs-mapping" })
    );

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          hasFacilityCosts: true,
          totalFacilityOperatingCost: 175,
          facilityOperatingCostByFacility: [
            { facilityId: "F1", facilityOperatingCost: 100 },
            { facilityId: "F2", facilityOperatingCost: 50 },
            { facilityId: "F9", facilityOperatingCost: 25 }
          ],
          facilityOperatingCostByCategory: [
            { costCategory: "Rent", facilityOperatingCost: 125 },
            { costCategory: "Utilities", facilityOperatingCost: 50 }
          ],
          unmatchedFacilityCostFacilityIds: ["F9"],
          facilitySummary: [
            expect.objectContaining({
              facilityId: "F1",
              transportationCost: 17.5,
              facilityOperatingCost: 100,
              observedCost: 117.5
            }),
            expect.objectContaining({
              facilityId: "F2",
              transportationCost: 0,
              facilityOperatingCost: 50,
              observedCost: 50
            })
          ]
        })
      })
    });
  });

  it("runs without facility costs when no facility-cost mapping is selected", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeFacilityCosts: true })
    );

    await runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm());

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputReferences: expect.objectContaining({
          facilityCosts: null
        }),
        resultSummary: expect.objectContaining({
          hasFacilityCosts: false,
          totalFacilityOperatingCost: null,
          facilityOperatingCostByFacility: null,
          facilityOperatingCostByCategory: null,
          unmatchedFacilityCostFacilityIds: []
        })
      })
    });
  });

  it("runs with an optional customer mapping and persists selected filenames and IDs", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeCustomers: true })
    );

    await expect(
      runSupplyChainDesignModel01ProofAction(
        { ok: false, message: "" },
        proofRunForm({ customersMappingId: "customers-mapping" })
      )
    ).resolves.toEqual({ ok: true, message: "Current Network Baseline completed." });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputReferences: expect.objectContaining({
          customers: expect.objectContaining({
            fileId: "customers-file",
            fileName: "customers.csv",
            mappingId: "customers-mapping"
          })
        })
      })
    });
  });

  it("calculates customer count, destination grouping, lanes, demand, and unmatched destinations", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeCustomers: true })
    );

    await runSupplyChainDesignModel01ProofAction(
      { ok: false, message: "" },
      proofRunForm({ customersMappingId: "customers-mapping" })
    );

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          hasCustomers: true,
          customerCount: 2,
          shipmentCountByDestination: [
            { destinationId: "C1", shipmentCount: 2 },
            { destinationId: "C9", shipmentCount: 1 }
          ],
          transportationCostByDestination: [
            { destinationId: "C1", transportationCost: 17.5 },
            { destinationId: "C9", transportationCost: 5 }
          ],
          laneShipmentCounts: [
            { originFacilityId: "F1", destinationId: "C1", shipmentCount: 2 },
            { originFacilityId: "F3", destinationId: "C9", shipmentCount: 1 }
          ],
          transportationCostByLane: [
            { originFacilityId: "F1", destinationId: "C1", transportationCost: 17.5 },
            { originFacilityId: "F3", destinationId: "C9", transportationCost: 5 }
          ],
          unmatchedShipmentDestinationIds: ["C9"],
          hasCustomerDemand: true,
          totalAnnualCustomerDemand: 1500,
          annualDemandByCustomer: [
            { customerId: "C1", annualDemand: 1000 },
            { customerId: "C2", annualDemand: 500 }
          ],
          networkLanes: [
            {
              originFacilityId: "F1",
              originFacilityName: "Toronto DC",
              destinationId: "C1",
              customerName: "Customer One",
              shipmentCount: 2,
              transportationCost: 17.5,
              averageServiceDays: null
            },
            {
              originFacilityId: "F3",
              originFacilityName: "Unknown facility",
              destinationId: "C9",
              customerName: null,
              shipmentCount: 1,
              transportationCost: 5,
              averageServiceDays: null
            }
          ]
        })
      })
    });
  });

  it("calculates average service days overall, by destination, and by lane", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeCustomers: true, includeServiceDays: true })
    );

    await runSupplyChainDesignModel01ProofAction(
      { ok: false, message: "" },
      proofRunForm({ customersMappingId: "customers-mapping" })
    );

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          hasServiceDays: true,
          averageServiceDays: 3,
          averageServiceDaysByDestination: [{ destinationId: "C1", averageServiceDays: 3 }],
          averageServiceDaysByLane: [{ originFacilityId: "F1", destinationId: "C1", averageServiceDays: 3 }],
          networkLanes: expect.arrayContaining([
            expect.objectContaining({
              originFacilityId: "F1",
              destinationId: "C1",
              averageServiceDays: 3
            })
          ])
        })
      })
    });
  });

  it("runs without customers when no customer mapping is selected", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeCustomers: true })
    );

    await runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm());

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputReferences: expect.objectContaining({
          customers: null
        }),
        resultSummary: expect.objectContaining({
          hasCustomers: false,
          customerCount: null,
          shipmentCountByDestination: null,
          networkLanes: null
        })
      })
    });
  });

  it("persists a failed run for invalid customer demand", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeCustomers: true, invalidDemand: true })
    );

    await expect(
      runSupplyChainDesignModel01ProofAction(
        { ok: false, message: "" },
        proofRunForm({ customersMappingId: "customers-mapping" })
      )
    ).resolves.toEqual({
      ok: false,
      message: 'CUSTOMERS annual_demand value "bad" is not a valid number.'
    });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SupplyChainDesignModelRunStatus.FAILED,
        errorMessage: 'CUSTOMERS annual_demand value "bad" is not a valid number.',
        inputReferences: expect.objectContaining({
          customers: expect.objectContaining({
            fileName: "customers.csv"
          })
        })
      })
    });
  });

  it("persists a failed run for invalid shipment service days", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeCustomers: true, includeServiceDays: true, invalidServiceDays: true })
    );

    await expect(
      runSupplyChainDesignModel01ProofAction(
        { ok: false, message: "" },
        proofRunForm({ customersMappingId: "customers-mapping" })
      )
    ).resolves.toEqual({
      ok: false,
      message: 'SHIPMENTS service_days value "bad" is not a valid number.'
    });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SupplyChainDesignModelRunStatus.FAILED,
        errorMessage: 'SHIPMENTS service_days value "bad" is not a valid number.'
      })
    });
  });

  it("runs and persists a Model 02 scenario with selected candidate facilities", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings());

    await expect(
      runSupplyChainDesignModel02ProofAction(
        { ok: false, message: "" },
        scenarioRunForm({
          selectedCandidateFacilityIds: ["N1"],
          scenarioLaneCostsMappingId: "scenario-lane-costs-mapping",
          facilityCostsMappingId: "facility-costs-mapping"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Model 02 proof scenario completed." });

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        projectId: "project-1",
        name: "Candidate network",
        status: SupplyChainDesignScenarioStatus.SUCCESS,
        baselineRunId: "run-1",
        selectedFacilities: {
          existing: ["F1", "F2"],
          candidates: ["N1"]
        },
        inputReferences: expect.objectContaining({
          customers: expect.objectContaining({ fileName: "customers.csv" }),
          candidateFacilities: expect.objectContaining({ fileName: "candidate-facilities.csv" }),
          scenarioLaneCosts: expect.objectContaining({ fileName: "scenario-lane-costs.csv" }),
          selectedExistingFacilityIds: ["F1", "F2"],
          selectedCandidateFacilityIds: ["N1"]
        })
      })
    });
  });

  it("keeps all existing facilities open when explicitly selected", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings());

    await runSupplyChainDesignModel02ProofAction(
      { ok: false, message: "" },
      scenarioRunForm({
        selectedExistingFacilityIds: ["F1", "F2"],
        selectedCandidateFacilityIds: [],
        facilityCostsMappingId: "facility-costs-mapping"
      })
    );

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        selectedFacilities: {
          existing: ["F1", "F2"],
          candidates: []
        },
        resultSummary: expect.objectContaining({
          selectedExistingFacilityIds: ["F1", "F2"],
          selectedCandidateFacilityIds: [],
          closedExistingFacilityIds: [],
          selectedFacilityIds: ["F1", "F2"],
          retainedExistingFacilityOperatingCost: 100,
          selectedCandidateAnnualFixedCost: 0,
          proposedObservedAnnualCost: 136
        })
      })
    });
  });

  it("closes one existing facility and excludes it from allocation and operating cost", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings());

    await runSupplyChainDesignModel02ProofAction(
      { ok: false, message: "" },
      scenarioRunForm({
        selectedExistingFacilityIds: ["F1"],
        selectedCandidateFacilityIds: ["N1"],
        scenarioLaneCostsMappingId: "scenario-lane-costs-mapping",
        facilityCostsMappingId: "facility-costs-mapping"
      })
    );

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          selectedExistingFacilityIds: ["F1"],
          closedExistingFacilityIds: ["F2"],
          retainedExistingFacilityOperatingCost: 40,
          selectedCandidateAnnualFixedCost: 100,
          proposedObservedAnnualCost: 160,
          customerAssignments: expect.arrayContaining([
            expect.objectContaining({
              customerId: "C2",
              assignedFacilityId: "N1"
            })
          ]),
          facilitySummary: expect.not.arrayContaining([
            expect.objectContaining({
              facilityId: "F2"
            })
          ])
        })
      })
    });
  });

  it("closes multiple existing facilities and can run with only a candidate open", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings());

    await runSupplyChainDesignModel02ProofAction(
      { ok: false, message: "" },
      scenarioRunForm({
        selectedExistingFacilityIds: [],
        selectedCandidateFacilityIds: ["N1"],
        scenarioLaneCostsMappingId: "scenario-lane-costs-mapping",
        facilityCostsMappingId: "facility-costs-mapping"
      })
    );

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          selectedExistingFacilityIds: [],
          closedExistingFacilityIds: ["F1", "F2"],
          retainedExistingFacilityOperatingCost: 0,
          selectedCandidateAnnualFixedCost: 100,
          proposedObservedAnnualCost: 120
        })
      })
    });
  });

  it("opens multiple candidate facilities and excludes unselected candidates from fixed cost", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings());

    await runSupplyChainDesignModel02ProofAction(
      { ok: false, message: "" },
      scenarioRunForm({
        selectedExistingFacilityIds: [],
        selectedCandidateFacilityIds: ["N1", "N2"],
        scenarioLaneCostsMappingId: "scenario-lane-costs-mapping"
      })
    );

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          selectedCandidateFacilityIds: ["N1", "N2"],
          unselectedCandidateFacilityIds: [],
          selectedCandidateAnnualFixedCost: 180,
          retainedExistingFacilityOperatingCost: 0,
          proposedObservedAnnualCost: 200
        })
      })
    });
  });

  it("runs a scenario with no candidate facilities when existing facilities are open", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings());

    await expect(
      runSupplyChainDesignModel02ProofAction(
        { ok: false, message: "" },
        scenarioRunForm({
          selectedExistingFacilityIds: ["F1", "F2"],
          selectedCandidateFacilityIds: [],
          facilityCostsMappingId: "facility-costs-mapping"
        })
      )
    ).resolves.toEqual({ ok: true, message: "Model 02 proof scenario completed." });

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          selectedCandidateFacilityIds: [],
          unselectedCandidateFacilityIds: ["N1", "N2"],
          selectedCandidateAnnualFixedCost: 0,
          proposedObservedAnnualCost: 136
        })
      })
    });
  });

  it("rejects a Model 02 scenario when no facility is open", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));

    await expect(
      runSupplyChainDesignModel02ProofAction(
        { ok: false, message: "" },
        scenarioRunForm({
          selectedExistingFacilityIds: [],
          selectedCandidateFacilityIds: []
        })
      )
    ).resolves.toEqual({ ok: false, message: "Select at least one existing or candidate facility to keep open." });

    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.prisma.supplyChainDesignScenario.create).not.toHaveBeenCalled();
  });

  it("allocates customers to the lowest available cost and calculates Model 02 costs", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings());

    await runSupplyChainDesignModel02ProofAction(
      { ok: false, message: "" },
      scenarioRunForm({
        selectedCandidateFacilityIds: ["N1"],
        scenarioLaneCostsMappingId: "scenario-lane-costs-mapping",
        facilityCostsMappingId: "facility-costs-mapping"
      })
    );

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          customersAllocated: 2,
          customersUnallocated: 1,
          proposedTotalTransportationCost: 20,
          selectedCandidateAnnualFixedCost: 100,
          retainedExistingFacilityOperatingCost: 100,
          proposedObservedAnnualCost: 220,
          annualCostDifference: 84,
          percentageDifference: 61.76470588235294,
          customerAssignments: [
            expect.objectContaining({
              customerId: "C1",
              assignedFacilityId: "N1",
              costPerShipment: 8,
              proposedAnnualTransportationCost: 16,
              serviceDays: 2
            }),
            expect.objectContaining({
              customerId: "C2",
              assignedFacilityId: "N1",
              costPerShipment: 4,
              proposedAnnualTransportationCost: 4,
              serviceDays: 3
            }),
            expect.objectContaining({
              customerId: "C3",
              assignedFacilityId: null,
              historicalShipmentCount: 0,
              proposedAnnualTransportationCost: null,
              allocationStatus: "UNALLOCATED"
            })
          ],
          facilitySummary: expect.arrayContaining([
            expect.objectContaining({
              facilityId: "N1",
              facilityKind: "CANDIDATE",
              assignedCustomers: 2,
              assignedShipments: 3,
              transportationCost: 20,
              fixedOrOperatingCost: 100,
              proposedObservedCost: 120
            })
          ])
        })
      })
    });
  });

  it("uses deterministic alphabetic tie handling for Model 02 allocations", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings({ tie: true }));

    await runSupplyChainDesignModel02ProofAction(
      { ok: false, message: "" },
      scenarioRunForm({
        selectedCandidateFacilityIds: ["N1", "N2"],
        scenarioLaneCostsMappingId: "scenario-lane-costs-mapping",
        selectedExistingFacilityIds: []
      })
    );

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          customerAssignments: expect.arrayContaining([
            expect.objectContaining({
              customerId: "C2",
              assignedFacilityId: "N1",
              costPerShipment: 6
            })
          ])
        })
      })
    });
  });

  it("marks Model 02 customers unallocated when no selected facility cost is available", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithModel02Mappings({ missingLaneCosts: true })
    );

    await runSupplyChainDesignModel02ProofAction(
      { ok: false, message: "" },
      scenarioRunForm({
        selectedCandidateFacilityIds: ["N1"],
        scenarioLaneCostsMappingId: "scenario-lane-costs-mapping",
        selectedExistingFacilityIds: []
      })
    );

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resultSummary: expect.objectContaining({
          customersAllocated: 1,
          customersUnallocated: 2,
          unallocatedCustomerIds: ["C2", "C3"],
          missingScenarioLaneCosts: expect.arrayContaining([
            { facilityId: "N1", destinationId: "C2" },
            { facilityId: "N1", destinationId: "C3" }
          ])
        })
      })
    });
  });

  it("preserves lowest-cost Model 02 allocation when capacity is disabled", () => {
    const result = runSupplyChainDesignModel02Proof(model02CapacityInput({ enforceCapacity: false }));

    expect(result.enforceCapacity).toBe(false);
    expect(result.proposedTotalTransportationCost).toBe(30);
    expect(result.customerAssignments).toEqual([
      expect.objectContaining({
        customerId: "C1",
        assignedFacilityId: "N1",
        assignedShipmentQuantity: 3,
        allocationStatus: "FULLY_ALLOCATED"
      })
    ]);
    expect(result.facilitySummary.find((facility) => facility.facilityId === "N1")).toEqual(
      expect.objectContaining({
        assignedShipments: 3,
        capacity: 2,
        capacityStatus: "FULL"
      })
    );
  });

  it("treats blank capacity as unlimited for Model 02", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02CapacityInput({
        enforceCapacity: true,
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,\n",
        scenarioLaneCostsCsv: "Origin,Destination,Cost,Service Days\nN1,C1,10,2\n"
      })
    );

    expect(result.facilitySummary).toEqual([
      expect.objectContaining({
        facilityId: "N1",
        assignedShipments: 3,
        capacity: null,
        remainingCapacity: null,
        utilizationPercent: null,
        capacityStatus: "UNLIMITED"
      })
    ]);
  });

  it("allocates to one facility with sufficient enforced capacity", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02CapacityInput({
        enforceCapacity: true,
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,3\n"
      })
    );

    expect(result.assignedShipmentCount).toBe(3);
    expect(result.unallocatedShipmentCount).toBe(0);
    expect(result.facilitySummary[0]).toEqual(
      expect.objectContaining({
        assignedShipments: 3,
        remainingCapacity: 0,
        utilizationPercent: 100,
        capacityStatus: "FULL"
      })
    );
  });

  it("moves allocation to the next-lowest-cost facility when the cheapest reaches capacity", () => {
    const result = runSupplyChainDesignModel02Proof(model02CapacityInput({ enforceCapacity: true }));

    expect(result.customerAssignments).toEqual([
      expect.objectContaining({
        customerId: "C1",
        assignedFacilityId: "N1",
        assignedShipmentQuantity: 2,
        costPerShipment: 10,
        allocationStatus: "SPLIT_ACROSS_FACILITIES"
      }),
      expect.objectContaining({
        customerId: "C1",
        assignedFacilityId: "N2",
        assignedShipmentQuantity: 1,
        costPerShipment: 12,
        allocationStatus: "SPLIT_ACROSS_FACILITIES"
      })
    ]);
    expect(result.proposedTotalTransportationCost).toBe(32);
  });

  it("partially allocates when all available enforced capacity is exhausted", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02CapacityInput({
        enforceCapacity: true,
        candidateFacilitiesCsv:
          "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,1\nN2,Second DC,London,Canada,80,1\n"
      })
    );

    expect(result.assignedShipmentCount).toBe(2);
    expect(result.unallocatedShipmentCount).toBe(1);
    expect(result.customerAssignments).toEqual([
      expect.objectContaining({ assignedFacilityId: "N1", assignedShipmentQuantity: 1, allocationStatus: "PARTIALLY_ALLOCATED" }),
      expect.objectContaining({ assignedFacilityId: "N2", assignedShipmentQuantity: 1, allocationStatus: "PARTIALLY_ALLOCATED" }),
      expect.objectContaining({
        assignedFacilityId: null,
        assignedShipmentQuantity: 0,
        remainingUnallocatedShipmentQuantity: 1,
        allocationStatus: "PARTIALLY_ALLOCATED"
      })
    ]);
  });

  it("marks shipment volume fully unallocated when no selected facility has capacity", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02CapacityInput({
        enforceCapacity: true,
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,0\n"
      })
    );

    expect(result.assignedShipmentCount).toBe(0);
    expect(result.unallocatedShipmentCount).toBe(3);
    expect(result.customerAssignments).toEqual([
      expect.objectContaining({
        customerId: "C1",
        assignedFacilityId: null,
        remainingUnallocatedShipmentQuantity: 3,
        allocationStatus: "UNALLOCATED"
      })
    ]);
  });

  it("uses alphabetical tie handling under enforced capacity", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02CapacityInput({
        enforceCapacity: true,
        candidateFacilitiesCsv:
          "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,3\nN2,Second DC,London,Canada,80,3\n",
        scenarioLaneCostsCsv: "Origin,Destination,Cost,Service Days\nN2,C1,10,2\nN1,C1,10,2\n"
      })
    );

    expect(result.customerAssignments[0]).toEqual(
      expect.objectContaining({
        assignedFacilityId: "N1",
        assignedShipmentQuantity: 3
      })
    );
  });

  it("calculates near-capacity and full capacity statuses without exceeding capacity", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02CapacityInput({
        enforceCapacity: true,
        customersCsv: "Customer ID,Customer Name,City,Country\nC1,Customer One,Toronto,Canada\nC2,Customer Two,Ottawa,Canada\n",
        shipmentsCsv:
          "Shipment ID,Origin,Destination,Cost\nS1,F1,C1,10\nS2,F1,C1,10\nS3,F1,C2,10\nS4,F1,C2,10\n",
        candidateFacilitiesCsv:
          "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,2\nN2,Second DC,London,Canada,80,2\n",
        scenarioLaneCostsCsv: "Origin,Destination,Cost,Service Days\nN1,C1,10,2\nN2,C1,12,2\nN2,C2,9,2\nN1,C2,11,2\n"
      })
    );

    expect(result.facilitySummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ facilityId: "N1", assignedShipments: 2, capacityStatus: "FULL" }),
        expect.objectContaining({ facilityId: "N2", assignedShipments: 2, capacityStatus: "FULL" })
      ])
    );
    expect(result.facilitySummary.every((facility) => facility.capacity === null || facility.assignedShipments <= facility.capacity)).toBe(true);
    expect(result.assignedShipmentCount + result.unallocatedShipmentCount).toBe(result.historicalShipmentCount);
  });

  it("calculates near-capacity status at 90 percent utilization", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02CapacityInput({
        enforceCapacity: true,
        shipmentsCsv: [
          "Shipment ID,Origin,Destination,Cost",
          "S1,F1,C1,10",
          "S2,F1,C1,10",
          "S3,F1,C1,10",
          "S4,F1,C1,10",
          "S5,F1,C1,10",
          "S6,F1,C1,10",
          "S7,F1,C1,10",
          "S8,F1,C1,10",
          "S9,F1,C1,10"
        ].join("\n"),
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,10\n",
        scenarioLaneCostsCsv: "Origin,Destination,Cost,Service Days\nN1,C1,10,2\n"
      })
    );

    expect(result.facilitySummary[0]).toEqual(
      expect.objectContaining({
        assignedShipments: 9,
        remainingCapacity: 1,
        utilizationPercent: 90,
        capacityStatus: "NEAR_CAPACITY"
      })
    );
  });

  it("fails clearly for invalid or negative capacity", () => {
    expect(() =>
      runSupplyChainDesignModel02Proof(
        model02CapacityInput({
          enforceCapacity: true,
          candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,bad\n"
        })
      )
    ).toThrow('CANDIDATE_FACILITIES capacity value "bad" is not a valid number.');
    expect(() =>
      runSupplyChainDesignModel02Proof(
        model02CapacityInput({
          enforceCapacity: true,
          candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,-1\n"
        })
      )
    ).toThrow("CANDIDATE_FACILITIES capacity cannot be negative.");
  });

  it("reconciles four shipments with TOR-01 and VAN-01 open and blank capacities", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02FourShipmentInput({
        selectedExistingFacilityIds: ["TOR-01", "VAN-01"],
        selectedCandidateFacilityIds: [],
        enforceCapacity: true
      })
    );

    expect(result.historicalShipmentCount).toBe(4);
    expect(result.assignedShipmentCount + result.unallocatedShipmentCount).toBe(4);
    expect(result.facilitySummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ facilityId: "TOR-01", capacityStatus: "UNLIMITED" }),
        expect.objectContaining({ facilityId: "VAN-01", capacityStatus: "UNLIMITED" })
      ])
    );
  });

  it("reconciles four shipments with TOR-01, VAN-01, and CHI-01 open and blank capacities", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02FourShipmentInput({
        selectedExistingFacilityIds: ["TOR-01", "VAN-01"],
        selectedCandidateFacilityIds: ["CHI-01"],
        enforceCapacity: true
      })
    );

    expect(result.historicalShipmentCount).toBe(4);
    expect(result.assignedShipmentCount + result.unallocatedShipmentCount).toBe(4);
    expect(result.facilitySummary.find((facility) => facility.facilityId === "CHI-01")).toEqual(
      expect.objectContaining({ capacity: null, capacityStatus: "UNLIMITED" })
    );
  });

  it("matches pre-capacity allocation totals when capacity enforcement is disabled", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02FourShipmentInput({
        selectedExistingFacilityIds: ["TOR-01", "VAN-01"],
        selectedCandidateFacilityIds: ["CHI-01"],
        enforceCapacity: false
      })
    );

    expect(result.enforceCapacity).toBe(false);
    expect(result.historicalShipmentCount).toBe(4);
    expect(result.assignedShipmentCount).toBe(4);
    expect(result.unallocatedShipmentCount).toBe(0);
    expect(result.customerAssignments.map((assignment) => [assignment.customerId, assignment.assignedFacilityId])).toEqual([
      ["Customer-A", "TOR-01"],
      ["Customer-B", "VAN-01"],
      ["Customer-C", "CHI-01"],
      ["Customer-D", "CHI-01"]
    ]);
  });

  it("matches capacity-disabled assignment totals when all open capacities are blank", () => {
    const disabled = runSupplyChainDesignModel02Proof(
      model02FourShipmentInput({
        selectedExistingFacilityIds: ["TOR-01", "VAN-01"],
        selectedCandidateFacilityIds: ["CHI-01"],
        enforceCapacity: false
      })
    );
    const enabled = runSupplyChainDesignModel02Proof(
      model02FourShipmentInput({
        selectedExistingFacilityIds: ["TOR-01", "VAN-01"],
        selectedCandidateFacilityIds: ["CHI-01"],
        enforceCapacity: true
      })
    );

    expect(enabled.assignedShipmentCount).toBe(disabled.assignedShipmentCount);
    expect(enabled.unallocatedShipmentCount).toBe(disabled.unallocatedShipmentCount);
    expect(enabled.proposedTotalTransportationCost).toBe(disabled.proposedTotalTransportationCost);
  });

  it("counts one unmatched customer destination once as allocated or unallocated", () => {
    const allocated = runSupplyChainDesignModel02Proof(
      model02FourShipmentInput({
        customersCsv:
          "Customer ID,Customer Name,City,Country\nCustomer-A,Customer A,Toronto,Canada\nCustomer-B,Customer B,Vancouver,Canada\nCustomer-C,Customer C,Calgary,Canada\n",
        scenarioLaneCostsCsv:
          "Origin,Destination,Cost,Service Days\nTOR-01,Customer-A,10,2\nVAN-01,Customer-B,11,2\nCHI-01,Customer-C,8,2\nCHI-01,Customer-D,7,2\n",
        selectedExistingFacilityIds: ["TOR-01", "VAN-01"],
        selectedCandidateFacilityIds: ["CHI-01"],
        enforceCapacity: true
      })
    );
    const unallocated = runSupplyChainDesignModel02Proof(
      model02FourShipmentInput({
        customersCsv:
          "Customer ID,Customer Name,City,Country\nCustomer-A,Customer A,Toronto,Canada\nCustomer-B,Customer B,Vancouver,Canada\nCustomer-C,Customer C,Calgary,Canada\n",
        scenarioLaneCostsCsv:
          "Origin,Destination,Cost,Service Days\nTOR-01,Customer-A,10,2\nVAN-01,Customer-B,11,2\nCHI-01,Customer-C,8,2\n",
        selectedExistingFacilityIds: [],
        selectedCandidateFacilityIds: ["CHI-01"],
        enforceCapacity: true
      })
    );

    expect(allocated.assignedShipmentCount + allocated.unallocatedShipmentCount).toBe(4);
    expect(allocated.customerAssignments.filter((assignment) => assignment.customerId === "Customer-D")).toHaveLength(1);
    expect(allocated.customerAssignments.find((assignment) => assignment.customerId === "Customer-D")).toEqual(
      expect.objectContaining({ assignedFacilityId: "CHI-01", assignedShipmentQuantity: 1 })
    );
    expect(unallocated.assignedShipmentCount + unallocated.unallocatedShipmentCount).toBe(4);
    expect(unallocated.customerAssignments.filter((assignment) => assignment.customerId === "Customer-D")).toHaveLength(1);
    expect(unallocated.customerAssignments.find((assignment) => assignment.customerId === "Customer-D")).toEqual(
      expect.objectContaining({ assignedFacilityId: null, remainingUnallocatedShipmentQuantity: 1 })
    );
  });

  it("reconciles finite-capacity split cases", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02FourShipmentInput({
        facilitiesCsv: "Facility ID,Facility Name,Capacity\nTOR-01,Toronto DC,1\nVAN-01,Vancouver DC,1\n",
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,100,1\n",
        selectedExistingFacilityIds: ["TOR-01", "VAN-01"],
        selectedCandidateFacilityIds: ["CHI-01"],
        enforceCapacity: true
      })
    );

    expect(result.historicalShipmentCount).toBe(4);
    expect(result.assignedShipmentCount).toBe(3);
    expect(result.unallocatedShipmentCount).toBe(1);
    expect(result.assignedShipmentCount + result.unallocatedShipmentCount).toBe(result.historicalShipmentCount);
  });

  it("does not persist invalid numeric capacity values in result JSON", () => {
    const result = runSupplyChainDesignModel02Proof(
      model02FourShipmentInput({
        selectedExistingFacilityIds: ["TOR-01", "VAN-01"],
        selectedCandidateFacilityIds: ["CHI-01"],
        enforceCapacity: true
      })
    );
    const json = JSON.stringify(result);

    expect(json).not.toContain("Infinity");
    expect(json).not.toContain("NaN");
    expect(JSON.parse(json)).toEqual(expect.objectContaining({ totalFiniteCapacity: null }));
  });

  it("builds and validates a normalized Model 02 solver problem", () => {
    const problem = buildModel02Problem(model02OptimizerInput());

    expect(problem.sizeSummary).toEqual({
      facilityCount: 3,
      customerCount: 4,
      validLaneCount: 6,
      estimatedEnumerationCombinationCount: 7
    });
    expect(problem.tieBreaking).toBe("ALPHABETICAL_FACILITY_ID");
    expect(() => validateModel02Problem(problem)).not.toThrow();
  });

  it("rejects invalid Model 02 solver problems during validation", () => {
    const problem = buildModel02Problem(model02OptimizerInput({ minimumOpenFacilities: 3, maximumOpenFacilities: 2 }));

    expect(() => validateModel02Problem(problem)).toThrow(
      "Maximum open facilities must be greater than or equal to minimum open facilities."
    );
  });

  it("uses exact enumeration as the default solver and preserves current optimizer results", () => {
    const defaultResult = runSupplyChainDesignModel02Optimizer(model02OptimizerInput());
    const exactResult = solveModel02Problem(buildModel02Problem(model02OptimizerInput()), "EXACT_ENUMERATION");

    expect(defaultResult.solverMetadata).toEqual(
      expect.objectContaining({
        solverType: "EXACT_ENUMERATION",
        solverName: "Exact small-network optimizer",
        solverStatus: "SUCCESS",
        verificationStatus: "PASSED"
      })
    );
    expect(exactResult.proofResult).toEqual(
      expect.objectContaining({
        selectedFacilityIds: ["TOR-01", "VAN-01"],
        proposedObservedAnnualCost: 46
      })
    );
  });

  it("keeps the mathematical-programming adapter disabled when no solver dependency is configured", () => {
    const problem = buildModel02Problem(model02OptimizerInput());
    const adapterResult = new MathematicalProgrammingModel02Solver().solve(problem);

    expect(adapterResult.status).toBe("NOT_CONFIGURED");
    expect(adapterResult.warnings[0]).toContain("No approved mathematical-programming solver dependency");
    expect(() => solveModel02Problem(problem, "MATHEMATICAL_PROGRAMMING")).toThrow(
      "MATHEMATICAL_PROGRAMMING Model 02 solver is not configured."
    );
  });

  it("allows explicit mathematical-programming fallback only when requested", () => {
    const problem = buildModel02Problem(model02OptimizerInput());
    const fallbackResult = solveModel02Problem(problem, "MATHEMATICAL_PROGRAMMING", true);

    expect(fallbackResult.solverName).toBe("Exact small-network optimizer");
    expect(fallbackResult.status).toBe("SUCCESS");
  });

  it("independently verifies valid exact solver solutions", () => {
    const problem = buildModel02Problem(model02OptimizerInput());
    const solverResult = new ExactEnumerationModel02Solver().solve(problem);

    expect(() => verifyModel02Solution(problem, solverResult)).not.toThrow();
  });

  it("independently rejects solver capacity, mandatory, prohibited, lane, cost, and reconciliation defects", () => {
    const problem = buildModel02Problem(
      model02OptimizerInput({
        facilitiesCsv: "Facility ID,Facility Name,Capacity\nTOR-01,Toronto DC,1\nVAN-01,Vancouver DC,1\n",
        enforceCapacity: true
      })
    );
    const solverResult = new ExactEnumerationModel02Solver().solve(problem);
    const validResult = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        facilitiesCsv: "Facility ID,Facility Name,Capacity\nTOR-01,Toronto DC,1\nVAN-01,Vancouver DC,1\n",
        enforceCapacity: true
      })
    );

    expect(() =>
      verifyModel02Solution(problem, {
        ...solverResult,
        proofResult: solverResult.proofResult
          ? {
              ...solverResult.proofResult,
              facilitySummary: solverResult.proofResult.facilitySummary.map((facility) =>
                facility.facilityId === "TOR-01" ? { ...facility, assignedShipments: 99 } : facility
              )
            }
          : null
      })
    ).toThrow("capacity is not exceeded");
    expect(() =>
      verifyModel02Solution(buildModel02Problem(model02OptimizerInput({ mandatoryExistingFacilityIds: ["TOR-01"] })), {
        ...solverResult,
        proofResult: solverResult.proofResult
          ? { ...solverResult.proofResult, selectedExistingFacilityIds: ["VAN-01"], selectedFacilityIds: ["VAN-01"] }
          : null
      })
    ).toThrow("mandatory facilities are open");
    expect(() =>
      verifyModel02Solution(buildModel02Problem(model02OptimizerInput({ prohibitedCandidateFacilityIds: ["CHI-01"] })), {
        ...solverResult,
        proofResult: solverResult.proofResult
          ? { ...solverResult.proofResult, selectedCandidateFacilityIds: ["CHI-01"], selectedFacilityIds: ["CHI-01"] }
          : null
      })
    ).toThrow("prohibited candidates are closed");
    expect(() =>
      verifyModel02Solution(buildModel02Problem(model02OptimizerInput()), {
        ...solverResult,
        proofResult: solverResult.proofResult
          ? {
              ...solverResult.proofResult,
              customerAssignments: solverResult.proofResult.customerAssignments.map((assignment, index) =>
                index === 0 ? { ...assignment, assignedFacilityId: "VAN-01" } : assignment
              )
            }
          : null
      })
    ).toThrow("allocations use only valid lane costs");
    expect(() =>
      assertSupplyChainDesignModel02OptimizerConsistency({
        ...validResult,
        proposedObservedAnnualCost: validResult.proposedObservedAnnualCost + 1
      })
    ).toThrow("observed cost equals transportation plus facility cost");
    expect(() =>
      assertSupplyChainDesignModel02OptimizerConsistency({
        ...validResult,
        assignedShipmentCount: validResult.assignedShipmentCount + 1
      })
    ).toThrow("assigned plus unallocated shipment volume equals historical shipment volume");
  });

  it("chooses the lowest-cost fully allocated Model 02 optimizer network", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,0,\n"
      })
    );

    expect(result.optimizerType).toBe("Exact small-network optimizer");
    expect(result.selectedFacilityIds).toEqual(["CHI-01", "TOR-01", "VAN-01"]);
    expect(result.unallocatedShipmentCount).toBe(0);
    expect(result.proposedObservedAnnualCost).toBe(36);
  });

  it("keeps mandatory facilities open and excludes prohibited optimizer candidates", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        mandatoryExistingFacilityIds: ["TOR-01"],
        prohibitedCandidateFacilityIds: ["CHI-01"],
        minimumOpenFacilities: 1,
        maximumOpenFacilities: 2
      })
    );

    expect(result.selectedExistingFacilityIds).toContain("TOR-01");
    expect(result.selectedCandidateFacilityIds).not.toContain("CHI-01");
    expect(result.mandatoryExistingFacilityIds).toEqual(["TOR-01"]);
    expect(result.prohibitedCandidateFacilityIds).toEqual(["CHI-01"]);
  });

  it("honors optimizer minimum and maximum facility counts", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        candidateFacilitiesCsv:
          "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,0,\nDET-01,Detroit DC,Detroit,USA,0,\n",
        permittedCandidateFacilityIds: ["CHI-01", "DET-01"],
        scenarioLaneCostsCsv:
          "Origin,Destination,Cost,Service Days\nTOR-01,Customer-A,10,2\nVAN-01,Customer-B,11,2\nCHI-01,Customer-C,8,2\nCHI-01,Customer-D,7,2\nDET-01,Customer-C,8,2\nDET-01,Customer-D,7,2\n",
        minimumOpenFacilities: 2,
        maximumOpenFacilities: 2
      })
    );

    expect(result.selectedFacilityIds).toHaveLength(2);
  });

  it("supports capacity-constrained optimizer split allocations", () => {
    const result = runSupplyChainDesignModel02Optimizer({
      ...model02CapacityInput({ enforceCapacity: true }),
      mandatoryExistingFacilityIds: [],
      permittedExistingFacilityIds: [],
      permittedCandidateFacilityIds: ["N1", "N2"],
      prohibitedCandidateFacilityIds: [],
      minimumOpenFacilities: 2,
      maximumOpenFacilities: 2
    });

    expect(result.assignedShipmentCount + result.unallocatedShipmentCount).toBe(result.historicalShipmentCount);
    expect(result.customerAssignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assignedFacilityId: "N1", assignedShipmentQuantity: 2 }),
        expect.objectContaining({ assignedFacilityId: "N2", assignedShipmentQuantity: 1 })
      ])
    );
  });

  it("ranks fully allocated optimizer networks ahead of cheaper incomplete networks", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,0,\n",
        minimumOpenFacilities: 1,
        maximumOpenFacilities: 2
      })
    );

    expect(result.selectedFacilityIds).toEqual(["TOR-01", "VAN-01"]);
    expect(result.unallocatedShipmentCount).toBe(0);
    expect(result.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          openFacilityIds: ["CHI-01"],
          unallocatedShipmentCount: 2,
          proposedObservedAnnualCost: 15
        })
      ])
    );
  });

  it("uses alphabetical open-facility IDs for deterministic optimizer ties", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        candidateFacilitiesCsv:
          "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,0,\nDET-01,Detroit DC,Detroit,USA,0,\n",
        permittedExistingFacilityIds: [],
        permittedCandidateFacilityIds: ["CHI-01", "DET-01"],
        scenarioLaneCostsCsv:
          "Origin,Destination,Cost,Service Days\nCHI-01,Customer-A,1,2\nCHI-01,Customer-B,1,2\nCHI-01,Customer-C,1,2\nCHI-01,Customer-D,1,2\nDET-01,Customer-A,1,2\nDET-01,Customer-B,1,2\nDET-01,Customer-C,1,2\nDET-01,Customer-D,1,2\n",
        minimumOpenFacilities: 1,
        maximumOpenFacilities: 1
      })
    );

    expect(result.selectedFacilityIds).toEqual(["CHI-01"]);
  });

  it("reports optimizer missing lane costs and no feasible facility-count selections", () => {
    const missingLaneResult = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        permittedExistingFacilityIds: [],
        minimumOpenFacilities: 1,
        maximumOpenFacilities: 1,
        scenarioLaneCostsCsv: "Origin,Destination,Cost,Service Days\nCHI-01,Customer-C,8,2\n"
      })
    );

    expect(missingLaneResult.unallocatedShipmentCount).toBe(3);
    expect(missingLaneResult.optimizationExceptions.customersWithNoUsableLane).toEqual([
      "Customer-A",
      "Customer-B",
      "Customer-D"
    ]);
    expect(() =>
      runSupplyChainDesignModel02Optimizer(
        model02OptimizerInput({
          permittedExistingFacilityIds: [],
          permittedCandidateFacilityIds: [],
          minimumOpenFacilities: 1,
          maximumOpenFacilities: 1
        })
      )
    ).toThrow("did not find a feasible network");
  });

  it("rejects optimizer requests above the selectable facility limit", () => {
    const candidateIds = Array.from({ length: 9 }, (_, index) => `CAND-${index + 1}`);

    expect(() =>
      runSupplyChainDesignModel02Optimizer(
        model02OptimizerInput({
          candidateFacilitiesCsv: [
            "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity",
            ...candidateIds.map((facilityId) => `${facilityId},${facilityId} DC,Chicago,USA,0,`)
          ].join("\n"),
          permittedCandidateFacilityIds: candidateIds
        })
      )
    ).toThrow("supports at most 10 selectable facilities");
  });

  it("saves optimizer baseline comparison and top-five alternatives", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        baselineObservedCost: 50,
        candidateFacilitiesCsv:
          "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,0,\nDET-01,Detroit DC,Detroit,USA,1,\n",
        permittedCandidateFacilityIds: ["CHI-01", "DET-01"],
        scenarioLaneCostsCsv:
          "Origin,Destination,Cost,Service Days\nTOR-01,Customer-A,10,2\nVAN-01,Customer-B,11,2\nCHI-01,Customer-C,8,2\nCHI-01,Customer-D,7,2\nDET-01,Customer-C,9,2\nDET-01,Customer-D,8,2\n"
      })
    );

    expect(result.annualCostDifference).toBe(result.proposedObservedAnnualCost - 50);
    expect(result.alternatives).toHaveLength(5);
    expect(result.alternatives[0]).toEqual(
      expect.objectContaining({
        rank: 1,
        proposedObservedAnnualCost: result.proposedObservedAnnualCost,
        differenceFromRecommended: 0
      })
    );
  });

  it("traces uploaded candidate fixed cost instead of fixture defaults", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,900000,\n",
        permittedExistingFacilityIds: [],
        permittedCandidateFacilityIds: ["CHI-01"],
        minimumOpenFacilities: 1,
        maximumOpenFacilities: 1
      })
    );

    expect(result.selectedCandidateAnnualFixedCost).toBe(900000);
    expect(result.optimizerAudit.facilityCostEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          facilityId: "CHI-01",
          costUsed: 900000,
          sourceFileName: "candidate-facilities.csv",
          sourceValue: "900000",
          sourceRow: 2,
          openStatus: "OPEN"
        })
      ])
    );
  });

  it("saves optimizer input filenames and mapping references", () => {
    const result = runSupplyChainDesignModel02Optimizer(model02OptimizerInput());

    expect(result.optimizerAudit.inputFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableType: "CANDIDATE_FACILITIES",
          fileName: "candidate-facilities.csv",
          mappingId: "candidate-facilities-mapping"
        }),
        expect.objectContaining({
          tableType: "SCENARIO_LANE_COSTS",
          fileName: "scenario-lane-costs.csv",
          mappingId: "scenario-lane-costs-mapping"
        })
      ])
    );
    expect(result.optimizerAudit.selectedMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableType: "SHIPMENTS",
          fields: expect.arrayContaining([{ standardField: "transportation_cost", sourceColumn: "Cost" }])
        })
      ])
    );
  });

  it("matches facility cost evidence to the optimizer objective", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,25,\n"
      })
    );
    const displayedFacilityCost = result.optimizerAudit.facilityCostEvidence
      .filter((facility) => facility.openStatus === "OPEN")
      .reduce((total, facility) => total + facility.costUsed, 0);

    expect(displayedFacilityCost).toBe(
      result.retainedExistingFacilityOperatingCost + result.selectedCandidateAnnualFixedCost
    );
  });

  it("identifies uploaded, historical, and missing lane-cost sources", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        permittedCandidateFacilityIds: ["CHI-01"],
        minimumOpenFacilities: 3,
        maximumOpenFacilities: 3,
        scenarioLaneCostsCsv: "Origin,Destination,Cost,Service Days\nCHI-01,Customer-C,8,2\n"
      })
    );

    expect(result.optimizerAudit.laneCostEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerId: "Customer-A",
          selectedFacilityId: "TOR-01",
          costSource: "HISTORICAL_EXISTING_LANE_AVERAGE"
        }),
        expect.objectContaining({
          customerId: "Customer-C",
          selectedFacilityId: "CHI-01",
          costSource: "UPLOADED_SCENARIO_LANE_COST"
        })
      ])
    );
    expect(
      result.optimizerAudit.laneCostEvidence
        .find((row) => row.customerId === "Customer-D")
        ?.otherOpenFacilities.some((facility) => facility.costSource === "MISSING_RATE")
    ).toBe(true);
  });

  it("identifies capacity-caused assignment decisions", () => {
    const result = runSupplyChainDesignModel02Optimizer({
      ...model02CapacityInput({ enforceCapacity: true }),
      mandatoryExistingFacilityIds: [],
      permittedExistingFacilityIds: [],
      permittedCandidateFacilityIds: ["N1", "N2"],
      prohibitedCandidateFacilityIds: [],
      minimumOpenFacilities: 2,
      maximumOpenFacilities: 2
    });

    expect(
      result.optimizerAudit.laneCostEvidence.some((row) =>
        row.otherOpenFacilities.some((facility) => facility.capacityPreventedAssignment)
      )
    ).toBe(true);
  });

  it("explains why displayed optimizer alternatives ranked lower", () => {
    const result = runSupplyChainDesignModel02Optimizer(
      model02OptimizerInput({
        candidateFacilitiesCsv: "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,0,\n",
        minimumOpenFacilities: 1,
        maximumOpenFacilities: 2
      })
    );

    expect(result.optimizerAudit.rankingExplanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rank: expect.any(Number),
          reason: expect.stringContaining("ranked ahead")
        })
      ])
    );
  });

  it("passes optimizer consistency checks for valid results and rejects inconsistent results", () => {
    const result = runSupplyChainDesignModel02Optimizer(model02OptimizerInput());

    expect(result.optimizerAudit.consistencyChecks.every((check) => check.passed)).toBe(true);
    expect(() =>
      assertSupplyChainDesignModel02OptimizerConsistency({
        ...result,
        proposedObservedAnnualCost: result.proposedObservedAnnualCost + 1
      })
    ).toThrow("Model 02 optimizer consistency check failed");
  });

  it("keeps optimizer calculations unchanged while adding audit evidence", () => {
    const result = runSupplyChainDesignModel02Optimizer(model02OptimizerInput());

    expect(result.selectedFacilityIds).toEqual(["TOR-01", "VAN-01"]);
    expect(result.historicalShipmentCount).toBe(4);
    expect(result.proposedTotalTransportationCost).toBe(46);
    expect(result.proposedObservedAnnualCost).toBe(46);
  });

  it("persists optimizer scenarios without changing manual Model 02 scenario storage", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings());

    await expect(
      runSupplyChainDesignModel02OptimizerAction(
        { ok: false, message: "" },
        optimizerRunForm({
          scenarioLaneCostsMappingId: "scenario-lane-costs-mapping",
          facilityCostsMappingId: "facility-costs-mapping",
          permittedExistingFacilityIds: ["F1", "F2"],
          permittedCandidateFacilityIds: ["N1", "N2"],
          enforceCapacity: true
        })
      )
    ).resolves.toEqual({ ok: true, message: "Model 02 optimizer completed." });

    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        selectedFacilities: expect.objectContaining({ optimizer: true }),
        resultSummary: expect.objectContaining({
          optimizerType: "Exact small-network optimizer",
          combinationsEvaluated: expect.any(Number),
          alternatives: expect.any(Array)
        })
      })
    });

    vi.clearAllMocks();
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithModel02Mappings());
    await runSupplyChainDesignModel02ProofAction({ ok: false, message: "" }, scenarioRunForm());
    expect(prismaMock.prisma.supplyChainDesignScenario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        selectedFacilities: {
          existing: ["F1", "F2"],
          candidates: ["N1"]
        }
      })
    });
  });

  it("keeps tenant isolation for optimizer actions", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN, "tenant-2"));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(null);

    await expect(
      runSupplyChainDesignModel02OptimizerAction({ ok: false, message: "" }, optimizerRunForm())
    ).resolves.toEqual({ ok: false, message: "Supply Chain Design project was not found." });
    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-2",
            id: "project-1"
          }
        }
      })
    );
    expect(prismaMock.prisma.supplyChainDesignScenario.create).not.toHaveBeenCalled();
  });

  it("blocks unauthorized roles from running Model 02 scenarios", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.OPERATIONS));

    await expect(
      runSupplyChainDesignModel02ProofAction({ ok: false, message: "" }, scenarioRunForm())
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(prismaMock.prisma.supplyChainDesignScenario.create).not.toHaveBeenCalled();
  });

  it("does not allow one tenant to run a Model 02 scenario for another tenant's project", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN, "tenant-2"));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(null);

    await expect(
      runSupplyChainDesignModel02ProofAction({ ok: false, message: "" }, scenarioRunForm())
    ).resolves.toEqual({ ok: false, message: "Supply Chain Design project was not found." });
    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-2",
            id: "project-1"
          }
        }
      })
    );
    expect(prismaMock.prisma.supplyChainDesignScenario.create).not.toHaveBeenCalled();
  });

  it("persists a failed run for invalid facility annual cost", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeFacilityCosts: true, invalidAnnualCost: true })
    );

    await expect(
      runSupplyChainDesignModel01ProofAction(
        { ok: false, message: "" },
        proofRunForm({ facilityCostsMappingId: "facility-costs-mapping" })
      )
    ).resolves.toEqual({
      ok: false,
      message: 'FACILITY_COSTS annual_cost value "bad" is not a valid number.'
    });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SupplyChainDesignModelRunStatus.FAILED,
        errorMessage: 'FACILITY_COSTS annual_cost value "bad" is not a valid number.',
        inputReferences: expect.objectContaining({
          facilityCosts: expect.objectContaining({
            fileName: "facility-costs.csv"
          })
        })
      })
    });
  });

  it("derives observed cost component percentages from existing result values", () => {
    const analysis = deriveSupplyChainDesignCostAnalysis(model01CostAnalysisFixture());

    expect(analysis.costBreakdown).toMatchObject([
      { component: "Transportation", amount: 22.5 },
      { component: "Labour", amount: 0 },
      { component: "Rent", amount: 125 },
      { component: "Utilities", amount: 50 }
    ]);
    expect(analysis.costBreakdown[0].share).toBeCloseTo(11.39240506329114, 6);
    expect(analysis.costBreakdown[1].share).toBeCloseTo(0, 6);
    expect(analysis.costBreakdown[2].share).toBeCloseTo(63.291139240506325, 6);
    expect(analysis.costBreakdown[3].share).toBeCloseTo(25.31645569620253, 6);
    expect(analysis.costBreakdown.reduce((total, component) => total + (component.share ?? 0), 0)).toBeCloseTo(100, 6);
  });

  it("derives facility operating-cost shares", () => {
    const analysis = deriveSupplyChainDesignCostAnalysis(model01CostAnalysisFixture());

    expect(analysis.facilityOperatingCostShares).toEqual([
      {
        facilityId: "F1",
        facilityName: "Toronto DC",
        facilityOperatingCost: 100,
        share: 57.14285714285714
      },
      {
        facilityId: "F2",
        facilityName: "Montreal DC",
        facilityOperatingCost: 50,
        share: 28.57142857142857
      },
      {
        facilityId: "F9",
        facilityName: "Unmatched facility",
        facilityOperatingCost: 25,
        share: 14.285714285714285
      }
    ]);
  });

  it("derives transportation and observed cost per shipment and preserves existing result values", () => {
    const result = model01CostAnalysisFixture();
    const analysis = deriveSupplyChainDesignCostAnalysis(result);

    expect(analysis.facilityCostPerShipment).toEqual([
      {
        facilityId: "F1",
        transportationCostPerShipment: 8.75,
        observedCostPerShipment: 58.75
      },
      {
        facilityId: "F2",
        transportationCostPerShipment: null,
        observedCostPerShipment: null
      }
    ]);
    expect(result).toMatchObject({
      facilityCount: 2,
      shipmentCount: 3,
      totalTransportationCost: 22.5,
      inventoryQuantity: 16,
      inventoryValue: 39,
      totalFacilityOperatingCost: 175,
      facilitySummary: [
        expect.objectContaining({ facilityId: "F1", observedCost: 117.5 }),
        expect.objectContaining({ facilityId: "F2", observedCost: 50 })
      ]
    });
  });

  it("derives highest-cost rankings", () => {
    const analysis = deriveSupplyChainDesignCostAnalysis(model01CostAnalysisFixture());

    expect(analysis.rankings).toEqual({
      highestObservedCostFacility: {
        labels: ["F1 - Toronto DC"],
        amount: 117.5,
        isTie: false
      },
      highestOperatingCostCategory: {
        labels: ["Rent"],
        amount: 125,
        isTie: false
      },
      highestObservedCostPerShipmentFacility: {
        labels: ["F1 - Toronto DC"],
        amount: 58.75,
        isTie: false
      }
    });
  });

  it("handles zero totals without unavailable divisions", () => {
    const analysis = deriveSupplyChainDesignCostAnalysis({
      ...model01CostAnalysisFixture(),
      totalTransportationCost: 0,
      totalFacilityOperatingCost: 0,
      facilityOperatingCostByFacility: [{ facilityId: "F1", facilityOperatingCost: 0 }],
      facilityOperatingCostByCategory: [],
      facilitySummary: [
        {
          facilityId: "F1",
          facilityName: "Toronto DC",
          shipmentCount: 0,
          transportationCost: 0,
          inventoryQuantity: null,
          inventoryValue: null,
          facilityOperatingCost: 0,
          observedCost: 0
        }
      ]
    });

    expect(analysis.costBreakdown.every((component) => component.share === null)).toBe(true);
    expect(analysis.facilityOperatingCostShares).toEqual([
      {
        facilityId: "F1",
        facilityName: "Toronto DC",
        facilityOperatingCost: 0,
        share: null
      }
    ]);
    expect(analysis.facilityCostPerShipment).toEqual([
      {
        facilityId: "F1",
        transportationCostPerShipment: null,
        observedCostPerShipment: null
      }
    ]);
  });

  it("handles ranking ties deterministically", () => {
    const analysis = deriveSupplyChainDesignCostAnalysis({
      ...model01CostAnalysisFixture(),
      facilityOperatingCostByCategory: [
        { costCategory: "Rent", facilityOperatingCost: 100 },
        { costCategory: "Utilities", facilityOperatingCost: 100 }
      ],
      facilitySummary: [
        {
          facilityId: "F2",
          facilityName: "Montreal DC",
          shipmentCount: 2,
          transportationCost: 20,
          inventoryQuantity: null,
          inventoryValue: null,
          facilityOperatingCost: 80,
          observedCost: 100
        },
        {
          facilityId: "F1",
          facilityName: "Toronto DC",
          shipmentCount: 2,
          transportationCost: 20,
          inventoryQuantity: null,
          inventoryValue: null,
          facilityOperatingCost: 80,
          observedCost: 100
        }
      ]
    });

    expect(analysis.rankings.highestObservedCostFacility).toEqual({
      labels: ["F1 - Toronto DC", "F2 - Montreal DC"],
      amount: 100,
      isTie: true
    });
    expect(analysis.rankings.highestOperatingCostCategory).toEqual({
      labels: ["Rent", "Utilities"],
      amount: 100,
      isTie: true
    });
    expect(analysis.rankings.highestObservedCostPerShipmentFacility).toEqual({
      labels: ["F1 - Toronto DC", "F2 - Montreal DC"],
      amount: 50,
      isTie: true
    });
  });

  it("persists a failed run for invalid inventory quantity", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeInventory: true, invalidQuantity: true })
    );

    await expect(
      runSupplyChainDesignModel01ProofAction(
        { ok: false, message: "" },
        proofRunForm({ inventoryMappingId: "inventory-mapping" })
      )
    ).resolves.toEqual({
      ok: false,
      message: 'INVENTORY quantity value "bad" is not a valid number.'
    });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SupplyChainDesignModelRunStatus.FAILED,
        errorMessage: 'INVENTORY quantity value "bad" is not a valid number.'
      })
    });
  });

  it("persists a failed run for invalid inventory unit cost", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(
      projectWithProofMappings({ includeInventory: true, invalidUnitCost: true })
    );

    await expect(
      runSupplyChainDesignModel01ProofAction(
        { ok: false, message: "" },
        proofRunForm({ inventoryMappingId: "inventory-mapping" })
      )
    ).resolves.toEqual({
      ok: false,
      message: 'INVENTORY unit_cost value "bad" is not a valid number.'
    });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SupplyChainDesignModelRunStatus.FAILED,
        errorMessage: 'INVENTORY unit_cost value "bad" is not a valid number.'
      })
    });
  });

  it("returns a clear missing required input message before running", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      mappings: [facilityMapping()]
    });

    await expect(
      runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm())
    ).resolves.toEqual({
      ok: false,
      message: "Missing required Current Network Baseline input: selected Historical Shipments mapping."
    });
    expect(prismaMock.prisma.supplyChainDesignModelRun.create).not.toHaveBeenCalled();
  });

  it("persists a failed run for invalid mapped transportation cost", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithProofMappings({ invalidCost: true }));

    await expect(
      runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm())
    ).resolves.toEqual({
      ok: false,
      message: 'SHIPMENTS transportation_cost value "bad" is not a valid number.'
    });

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SupplyChainDesignModelRunStatus.FAILED,
        errorMessage: 'SHIPMENTS transportation_cost value "bad" is not a valid number.'
      })
    });
  });

  it("does not allow one tenant to run another tenant's project", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN, "tenant-2"));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(null);

    await expect(
      runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm())
    ).resolves.toEqual({ ok: false, message: "Supply Chain Design project was not found." });
    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: "tenant-2",
            id: "project-1"
          }
        }
      })
    );
    expect(prismaMock.prisma.supplyChainDesignModelRun.create).not.toHaveBeenCalled();
  });

  it("blocks unauthorized roles from running Model 01 proof", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.OPERATIONS));

    await expect(
      runSupplyChainDesignModel01ProofAction({ ok: false, message: "" }, proofRunForm())
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(prismaMock.prisma.supplyChainDesignModelRun.create).not.toHaveBeenCalled();
  });

  it("keeps the latest Model 01 proof result visible after reloading a project", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      tenantId: adminContext.tenantId,
      name: "Network baseline",
      description: null,
      status: SupplyChainDesignProjectStatus.DRAFT,
      createdByUserId: adminContext.userId,
      createdAt,
      updatedAt,
      createdBy: {
        name: "User",
        email: "user@example.com"
      },
      files: [
        {
          id: "facilities-file",
          originalFileName: "facilities.csv",
          contentType: "text/csv",
          sizeBytes: 50,
          contentHash: "hash-f",
          rowCount: 2,
          detectedHeaders: ["Facility ID", "Facility Name"],
          status: "READY",
          createdAt,
          uploadedBy: null,
          mappings: [
            {
              tableType: "FACILITIES",
              fieldMappings: [
                { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
                { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" }
              ]
            }
          ]
        },
        {
          id: "shipments-file",
          originalFileName: "shipments.csv",
          contentType: "text/csv",
          sizeBytes: 50,
          contentHash: "hash-s",
          rowCount: 3,
          detectedHeaders: ["Shipment ID", "Origin", "Cost"],
          status: "READY",
          createdAt,
          uploadedBy: null,
          mappings: [
            {
              tableType: "SHIPMENTS",
              fieldMappings: [
                { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
                { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" }
              ]
            }
          ]
        }
      ],
      modelRuns: [
        {
          id: "run-1",
          status: "SUCCESS",
          createdAt,
          errorMessage: null,
          inputReferences: {
            facilities: {
              fileId: "facilities-file",
              fileName: "facilities.csv",
              mappingId: "facilities-mapping",
              mappingUpdatedAt: updatedAt.toISOString(),
              candidateFiles: [
                {
                  fileId: "facilities-file",
                  fileName: "facilities.csv",
                  mappingId: "facilities-mapping",
                  mappingUpdatedAt: updatedAt.toISOString(),
                  selected: true
                }
              ]
            },
            shipments: {
              fileId: "shipments-file",
              fileName: "shipments.csv",
              mappingId: "shipments-mapping",
              mappingUpdatedAt: updatedAt.toISOString(),
              candidateFiles: [
                {
                  fileId: "shipments-file",
                  fileName: "shipments.csv",
                  mappingId: "shipments-mapping",
                  mappingUpdatedAt: updatedAt.toISOString(),
                  selected: true
                }
              ]
            }
          },
          resultSummary: {
            facilityCount: 2,
            shipmentCount: 3,
            hasTransportationCost: true,
            totalTransportationCost: 22.5,
            shipmentCountByOrigin: [{ originFacilityId: "F1", shipmentCount: 2 }],
            transportationCostByOrigin: [{ originFacilityId: "F1", transportationCost: 17.5 }],
            unmatchedShipmentOriginIds: ["F3"],
            deferredValidation: ["Full row-level validation framework"]
          }
        }
      ]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      model01Proof: {
        canRun: true,
        missingInputs: []
      },
      latestModelRun: {
        id: "run-1",
        status: "SUCCESS",
        inputReferences: {
          facilities: {
            fileId: "facilities-file",
            fileName: "facilities.csv"
          },
          shipments: {
            fileId: "shipments-file",
            fileName: "shipments.csv"
          }
        },
        resultSummary: {
          facilityCount: 2,
          shipmentCount: 3,
          totalTransportationCost: 22.5,
          unmatchedShipmentOriginIds: ["F3"]
        }
      },
      recentModelRuns: [
        {
          id: "run-1",
          status: "SUCCESS"
        }
      ],
      shell: {
        workspaceSteps: expect.arrayContaining([
          { label: "Model run", status: "available" },
          { label: "Results", status: "available" }
        ])
      }
    });
    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          modelRuns: {
            orderBy: {
              createdAt: "desc"
            },
            take: 5
          }
        })
      })
    );
  });

  it("keeps the no-result state available when a project has no saved runs", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      tenantId: adminContext.tenantId,
      name: "Network baseline",
      description: null,
      status: SupplyChainDesignProjectStatus.DRAFT,
      createdByUserId: adminContext.userId,
      createdAt,
      updatedAt,
      createdBy: {
        name: "User",
        email: "user@example.com"
      },
      files: [],
      modelRuns: []
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestModelRun: null,
      recentModelRuns: []
    });
  });

  it("makes Model 01 ready from mapped shared current-facility and historical-shipment files", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    const facilityHeaders = csvHeader("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv");
    const shipmentHeaders = csvHeader("docs/modules/supply-chain-design/templates/historical-shipments-template.csv");
    const recognizedFacilities = recognizeSupplyChainDesignOfficialTemplate(facilityHeaders);
    const recognizedShipments = recognizeSupplyChainDesignOfficialTemplate(shipmentHeaders);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-current",
      tenantId: adminContext.tenantId,
      name: "Current network",
      description: null,
      status: SupplyChainDesignProjectStatus.DRAFT,
      createdByUserId: adminContext.userId,
      createdAt,
      updatedAt,
      createdBy: {
        name: "User",
        email: "user@example.com"
      },
      files: [
        {
          id: "facilities-file",
          originalFileName: "current-facilities-and-costs-template.csv",
          contentType: "text/csv",
          sizeBytes: 500,
          contentHash: "hash-facilities",
          rowCount: 0,
          detectedHeaders: facilityHeaders,
          status: "READY",
          createdAt,
          uploadedBy: null,
          fileBytes: Buffer.from(readFileSync("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv", "utf8")),
          mappings: [
            {
              id: "facilities-mapping",
              tableType: "FACILITIES",
              updatedAt,
              fieldMappings: recognizedFacilities?.fieldMappings
            }
          ]
        },
        {
          id: "shipments-file",
          originalFileName: "historical-shipments-template.csv",
          contentType: "text/csv",
          sizeBytes: 500,
          contentHash: "hash-shipments",
          rowCount: 0,
          detectedHeaders: shipmentHeaders,
          status: "READY",
          createdAt,
          uploadedBy: null,
          fileBytes: Buffer.from(readFileSync("docs/modules/supply-chain-design/templates/historical-shipments-template.csv", "utf8")),
          mappings: [
            {
              id: "shipments-mapping",
              tableType: "SHIPMENTS",
              updatedAt,
              fieldMappings: recognizedShipments?.fieldMappings
            }
          ]
        }
      ],
      modelRuns: []
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-current")).resolves.toMatchObject({
      model01Proof: {
        canRun: true,
        missingInputs: [],
        inputSelection: {
          facilities: expect.objectContaining({
            fileId: "facilities-file",
            fileName: "current-facilities-and-costs-template.csv",
            mappingId: "facilities-mapping"
          }),
          shipments: expect.objectContaining({
            fileId: "shipments-file",
            fileName: "historical-shipments-template.csv",
            mappingId: "shipments-mapping"
          }),
          currentNetworkActivity: null
        }
      }
    });
  });

  it("keeps the Current Network Baseline result layout sections and summary cards customer-facing", () => {
    expect(MODEL_01_PROOF_RESULT_SECTIONS).toEqual([
      "Current Network Summary",
      "Facility Summary",
      "Analysis details"
    ]);
    expect(MODEL_01_PROOF_OVERVIEW_CARDS).toEqual([
      "Current facilities",
      "Total shipments",
      "Total pallets",
      "Total units",
      "Total weight",
      "Transportation cost by currency",
      "Annual facility and warehouse cost by currency",
      "Observed network cost by currency"
    ]);
  });

  it("keeps existing result values available for the reorganized latest result layout", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectReloadWithSuccessfulInventoryRun(adminContext));

    const project = await getSupplyChainDesignProject(adminContext, "project-1");
    const result = project?.latestModelRun?.resultSummary;

    expect(result).toMatchObject({
      facilityCount: 2,
      shipmentCount: 3,
      totalTransportationCost: 22.5,
      inventoryQuantity: 16,
      inventoryValue: 39,
      totalFacilityOperatingCost: 175,
      customerCount: 2,
      totalAnnualCustomerDemand: 1500,
      averageServiceDays: 3,
      unmatchedShipmentOriginIds: ["F3"],
      unmatchedInventoryFacilityIds: ["F9"],
      unmatchedFacilityCostFacilityIds: ["F9"],
      unmatchedShipmentDestinationIds: ["C9"],
      networkLanes: expect.arrayContaining([
        expect.objectContaining({
          originFacilityId: "F1",
          destinationId: "C1",
          shipmentCount: 2,
          averageServiceDays: 3
        })
      ]),
      facilitySummary: expect.arrayContaining([
        expect.objectContaining({
          facilityId: "F1",
          facilityName: "Toronto DC",
          facilityType: "Owned",
          shipmentCount: 2,
          pallets: 4,
          units: 20,
          weight: 1000,
          transportationCost: 17.5,
          inventoryQuantity: 10,
          inventoryValue: 20,
          facilityOperatingCost: 100,
          observedCost: 117.5
        })
      ]),
      volumeSummary: expect.objectContaining({
        totalPallets: 4,
        totalUnits: 20,
        totalWeight: 1000
      }),
      transportationCostByCurrency: [{ currency: "USD", transportationCost: 22.5 }],
      facilityCostByCurrency: [{ currency: "USD", facilityOperatingCost: 175 }],
      observedNetworkCostByCurrency: [{ currency: "USD", observedCost: 197.5 }],
      snapshotPalletUtilization: [
        expect.objectContaining({
          facilityId: "F1",
          facilityType: "Owned",
          utilizationPercent: 10,
          latest: true
        })
      ]
    });
    expect(
      (result?.unmatchedShipmentOriginIds.length ?? 0) +
        (result?.unmatchedInventoryFacilityIds.length ?? 0) +
        (result?.unmatchedFacilityCostFacilityIds.length ?? 0) +
        (result?.unmatchedShipmentDestinationIds.length ?? 0)
    ).toBe(4);
  });

  it("retrieves a compact recent run history with the latest run first", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    const projectFixture = projectReloadWithSuccessfulInventoryRun(adminContext);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...projectFixture,
      modelRuns: [
        ...(projectFixture.modelRuns ?? []),
        {
          id: "older-run",
          status: "SUCCESS",
          createdAt: new Date("2026-07-24T11:00:00.000Z"),
          errorMessage: null,
          inputReferences: projectFixture.modelRuns[0].inputReferences,
          resultSummary: {
            facilityCount: 1,
            shipmentCount: 1,
            hasTransportationCost: false,
            totalTransportationCost: null,
            shipmentCountByOrigin: [],
            transportationCostByOrigin: null,
            unmatchedShipmentOriginIds: [],
            hasInventory: false,
            inventoryQuantity: null,
            inventoryQuantityByFacility: null,
            hasInventoryValue: false,
            inventoryValue: null,
            inventoryValueByFacility: null,
            unmatchedInventoryFacilityIds: [],
            hasFacilityCosts: false,
            totalFacilityOperatingCost: null,
            facilityOperatingCostByFacility: null,
            facilityOperatingCostByCategory: null,
            unmatchedFacilityCostFacilityIds: [],
            facilitySummary: [],
            deferredValidation: []
          }
        }
      ]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestModelRun: {
        id: "run-1"
      },
      recentModelRuns: [{ id: "run-1" }, { id: "older-run" }]
    });
  });

  it("defaults the explicit run form to the most recently updated valid mapping for each required table type", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectWithMultipleProofMappings());

    await runSupplyChainDesignModel01ProofAction(
      { ok: false, message: "" },
      proofRunForm({
        facilitiesMappingId: "new-facilities-mapping",
        shipmentsMappingId: "new-shipments-mapping"
      })
    );

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputReferences: expect.objectContaining({
          facilities: expect.objectContaining({
            fileId: "new-facilities-file",
            fileName: "new-facilities.csv",
            mappingId: "new-facilities-mapping",
            candidateFiles: [
              expect.objectContaining({ fileName: "new-facilities.csv", selected: true }),
              expect.objectContaining({ fileName: "old-facilities.csv", selected: false })
            ]
          }),
          shipments: expect.objectContaining({
            fileId: "new-shipments-file",
            fileName: "new-shipments.csv",
            mappingId: "new-shipments-mapping",
            candidateFiles: [
              expect.objectContaining({ fileName: "new-shipments.csv", selected: true }),
              expect.objectContaining({ fileName: "old-shipments.csv", selected: false })
            ]
          })
        }),
        resultSummary: expect.objectContaining({
          facilityCount: 1,
          shipmentCount: 1
        })
      })
    });
  });

  it("shows multiple mapped file warnings and candidate filenames on project reload", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(projectReloadWithMultipleMappings(adminContext));

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      model01Proof: {
        canRun: true,
        warnings: [
          "Multiple Current Facilities and Warehouse Costs mappings exist: new-facilities.csv, old-facilities.csv.",
          "Multiple Historical Shipments mappings exist: new-shipments.csv, old-shipments.csv."
        ],
        inputSelection: {
          facilities: {
            fileName: "new-facilities.csv",
            candidateFiles: [
              { fileName: "new-facilities.csv", selected: true },
              { fileName: "old-facilities.csv", selected: false }
            ]
          },
          shipments: {
            fileName: "new-shipments.csv",
            candidateFiles: [
              { fileName: "new-shipments.csv", selected: true },
              { fileName: "old-shipments.csv", selected: false }
            ]
          }
        }
      }
    });
  });

  it("labels duplicate-content records on project reload without deleting them", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...projectReloadWithMultipleMappings(adminContext),
      files: [
        fileSummaryFixture("file-a", "facilities-a.csv", "same-hash", [
          {
            id: "mapping-a",
            tableType: "FACILITIES",
            updatedAt,
            fieldMappings: [
              { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
              { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" }
            ]
          }
        ]),
        fileSummaryFixture("file-b", "facilities-b.csv", "same-hash", [])
      ],
      modelRuns: []
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      files: [
        {
          id: "file-a",
          duplicateContentFileNames: ["facilities-b.csv"],
          hasMapping: true,
          mappingTableType: "FACILITIES"
        },
        {
          id: "file-b",
          duplicateContentFileNames: ["facilities-a.csv"],
          hasMapping: false,
          mappingTableType: null
        }
      ]
    });
  });

  it("shows automatically mapped template files with customer-facing ready wording", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    const detectedHeaders = [
      "Facility ID",
      "Facility Name",
      "Facility Type",
      "Facility ZIP / Postal Code",
      "Annual Facility / Warehouse Cost",
      "Pallet Capacity",
      "Current Inventory Pallets",
      "Current Inventory Units",
      "Current Inventory Value",
      "Currency",
      "Notes"
    ];
    const recognized = recognizeSupplyChainDesignOfficialTemplate(detectedHeaders);
    expect(recognized?.tableType).toBe("FACILITIES");
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...projectReloadWithMultipleMappings(adminContext),
      files: [
        {
          ...fileSummaryFixture("file-a", "current-facilities-and-costs-template.csv", "hash-a", [
            {
              id: "mapping-a",
              tableType: recognized!.tableType,
              updatedAt,
              fieldMappings: recognized!.fieldMappings
            }
          ]),
          detectedHeaders
        }
      ],
      modelRuns: []
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      files: [
        {
          id: "file-a",
          mappingDisplayStatus: "Ready — automatically mapped"
        }
      ]
    });
  });

  it("keeps failed runs visible with their saved error message", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...projectReloadWithMultipleMappings(adminContext),
      modelRuns: [
        {
          id: "failed-run",
          status: "FAILED",
          createdAt,
          errorMessage: "SHIPMENTS transportation_cost value \"bad\" is not a valid number.",
          inputReferences: {
            facilities: {
              fileId: "new-facilities-file",
              fileName: "new-facilities.csv",
              mappingId: "new-facilities-mapping",
              mappingUpdatedAt: updatedAt.toISOString(),
              candidateFiles: []
            },
            shipments: {
              fileId: "new-shipments-file",
              fileName: "new-shipments.csv",
              mappingId: "new-shipments-mapping",
              mappingUpdatedAt: updatedAt.toISOString(),
              candidateFiles: []
            }
          },
          resultSummary: null
        }
      ]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestModelRun: {
        id: "failed-run",
        status: "FAILED",
        errorMessage: "SHIPMENTS transportation_cost value \"bad\" is not a valid number.",
        inputReferences: {
          facilities: { fileName: "new-facilities.csv" },
          shipments: { fileName: "new-shipments.csv" }
        },
        resultSummary: null
      }
    });
  });

  it("keeps a saved Model 02 scenario visible after reloading a project", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...projectReloadWithMultipleMappings(adminContext),
      modelRuns: [
        {
          id: "run-1",
          status: "SUCCESS",
          createdAt,
          errorMessage: null,
          inputReferences: {},
          resultSummary: {
            totalTransportationCost: 36,
            totalFacilityOperatingCost: 100
          }
        }
      ],
      scenarios: [
        {
          id: "scenario-1",
          name: "Candidate network",
          status: "SUCCESS",
          createdAt,
          updatedAt,
          errorMessage: null,
          baselineRunId: "run-1",
          selectedFacilities: {
            existing: ["F1"],
            candidates: ["N1"]
          },
          inputReferences: {
            baselineRunId: "run-1",
            baselineObservedCost: 136,
            facilities: {
              fileId: "facilities-file",
              fileName: "facilities.csv",
              mappingId: "facilities-mapping",
              mappingUpdatedAt: updatedAt.toISOString(),
              candidateFiles: []
            },
            shipments: {
              fileId: "shipments-file",
              fileName: "shipments.csv",
              mappingId: "shipments-mapping",
              mappingUpdatedAt: updatedAt.toISOString(),
              candidateFiles: []
            },
            customers: {
              fileId: "customers-file",
              fileName: "customers.csv",
              mappingId: "customers-mapping",
              mappingUpdatedAt: updatedAt.toISOString(),
              candidateFiles: []
            },
            candidateFacilities: {
              fileId: "candidate-facilities-file",
              fileName: "candidate-facilities.csv",
              mappingId: "candidate-facilities-mapping",
              mappingUpdatedAt: updatedAt.toISOString(),
              candidateFiles: []
            },
            scenarioLaneCosts: {
              fileId: "scenario-lane-costs-file",
              fileName: "scenario-lane-costs.csv",
              mappingId: "scenario-lane-costs-mapping",
              mappingUpdatedAt: updatedAt.toISOString(),
              candidateFiles: []
            },
            existingFacilityOptions: [],
            candidateFacilityOptions: []
          },
          resultSummary: {
            scenarioName: "Candidate network",
            baselineRunId: "run-1",
            enforceCapacity: true,
            selectedExistingFacilityIds: ["F1"],
            selectedCandidateFacilityIds: ["N1"],
            closedExistingFacilityIds: ["F2"],
            unselectedCandidateFacilityIds: ["N2"],
            selectedFacilityIds: ["F1", "N1"],
            customersAllocated: 2,
            customersUnallocated: 1,
            historicalShipmentCount: 3,
            assignedShipmentCount: 2,
            unallocatedShipmentCount: 1,
            totalFiniteCapacity: 1000,
            facilitiesNearCapacityOrFull: 1,
            highestFacilityUtilization: 100,
            fullFacilityCount: 1,
            baselineObservedCost: 136,
            proposedTotalTransportationCost: 20,
            selectedCandidateAnnualFixedCost: 100,
            retainedExistingFacilityOperatingCost: 100,
            proposedObservedAnnualCost: 220,
            annualCostDifference: 84,
            percentageDifference: 61.76470588235294,
            customerAssignments: [
              {
                customerId: "C1",
                customerName: "Customer One",
                historicalShipmentCount: 2,
                assignedFacilityId: "N1",
                assignedFacilityName: "New DC",
                assignedShipmentQuantity: 2,
                costPerShipment: 8,
                proposedAnnualTransportationCost: 16,
                remainingUnallocatedShipmentQuantity: 0,
                serviceDays: 2,
                allocationStatus: "FULLY_ALLOCATED"
              }
            ],
            facilitySummary: [
              {
                facilityId: "N1",
                facilityName: "New DC",
                facilityKind: "CANDIDATE",
                assignedCustomers: 1,
                assignedShipments: 2,
                transportationCost: 16,
                fixedOrOperatingCost: 100,
                proposedObservedCost: 116,
                capacity: 1000,
                remainingCapacity: 0,
                utilizationPercent: 100,
                capacityStatus: "FULL"
              }
            ],
            unallocatedCustomerIds: ["C3"],
            missingScenarioLaneCosts: [{ facilityId: "N1", destinationId: "C3" }],
            unmatchedFacilityIds: [],
            unmatchedCustomerIds: [],
            deferredValidation: ["Capacity constraints are displayed as context only."]
          }
        }
      ]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestScenario: {
        id: "scenario-1",
        name: "Candidate network",
        status: "SUCCESS",
        inputReferences: {
          candidateFacilities: { fileName: "candidate-facilities.csv" },
          scenarioLaneCosts: { fileName: "scenario-lane-costs.csv" }
        },
        resultSummary: {
          customersAllocated: 2,
          proposedObservedAnnualCost: 220,
          enforceCapacity: true,
          assignedShipmentCount: 2,
          unallocatedShipmentCount: 1,
          totalFiniteCapacity: 1000,
          fullFacilityCount: 1,
          selectedExistingFacilityIds: ["F1"],
          selectedCandidateFacilityIds: ["N1"],
          closedExistingFacilityIds: ["F2"],
          unselectedCandidateFacilityIds: ["N2"],
          customerAssignments: [
            expect.objectContaining({
              customerId: "C1",
              assignedFacilityId: "N1"
            })
          ]
        }
      }
    });
    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          scenarios: expect.objectContaining({
            orderBy: { createdAt: "desc" },
            take: 5
          })
        })
      })
    );
  });

  it("retrieves multiple saved Model 02 scenarios in project history order", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    const latestScenario = scenarioSummaryFixture({
      id: "scenario-latest",
      name: "Latest scenario",
      createdAt: new Date("2026-07-27T16:00:00.000Z")
    });
    const olderScenario = scenarioSummaryFixture({
      id: "scenario-older",
      name: "Older scenario",
      createdAt: new Date("2026-07-27T15:00:00.000Z")
    });
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...projectReloadWithMultipleMappings(adminContext),
      modelRuns: [],
      scenarios: [latestScenario, olderScenario]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestScenario: { id: "scenario-latest" },
      recentScenarios: [{ id: "scenario-latest" }, { id: "scenario-older" }]
    });
    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_id: {
            tenantId: adminContext.tenantId,
            id: "project-1"
          }
        },
        include: expect.objectContaining({
          scenarios: expect.objectContaining({
            orderBy: { createdAt: "desc" },
            take: 5
          })
        })
      })
    );
  });

  it("compares between two and four successful Model 02 scenarios", () => {
    const comparison = compareSupplyChainDesignScenarios([
      scenarioSummaryFixture({ id: "scenario-a", name: "A" }),
      scenarioSummaryFixture({ id: "scenario-b", name: "B" }),
      scenarioSummaryFixture({ id: "scenario-c", name: "C" }),
      scenarioSummaryFixture({ id: "scenario-d", name: "D" })
    ]);

    expect(comparison.errorMessage).toBeNull();
    expect(comparison.scenarios.map((scenario) => scenario.id)).toEqual([
      "scenario-a",
      "scenario-b",
      "scenario-c",
      "scenario-d"
    ]);
  });

  it("rejects comparison of fewer than two successful scenarios", () => {
    const comparison = compareSupplyChainDesignScenarios([scenarioSummaryFixture({ id: "scenario-a" })]);

    expect(comparison.errorMessage).toBe("Select at least two successful scenarios to compare.");
    expect(comparison.scenarios).toHaveLength(1);
  });

  it("excludes failed Model 02 scenarios from successful comparison by default", () => {
    const scenarios = [
      scenarioSummaryFixture({ id: "scenario-a" }),
      scenarioSummaryFixture({ id: "scenario-failed", status: "FAILED", resultSummary: null }),
      scenarioSummaryFixture({ id: "scenario-b" })
    ];

    expect(getSuccessfulModel02Scenarios(scenarios).map((scenario) => scenario.id)).toEqual(["scenario-a", "scenario-b"]);
  });

  it("identifies lowest-cost, fewest-unallocated, and largest-saving scenarios", () => {
    const comparison = compareSupplyChainDesignScenarios([
      scenarioSummaryFixture({
        id: "scenario-a",
        resultSummary: scenarioResultFixture({
          proposedObservedAnnualCost: 200,
          proposedTotalTransportationCost: 90,
          customersUnallocated: 1,
          annualCostDifference: 50
        })
      }),
      scenarioSummaryFixture({
        id: "scenario-b",
        resultSummary: scenarioResultFixture({
          proposedObservedAnnualCost: 150,
          proposedTotalTransportationCost: 70,
          customersUnallocated: 0,
          annualCostDifference: -20
        })
      }),
      scenarioSummaryFixture({
        id: "scenario-c",
        resultSummary: scenarioResultFixture({
          proposedObservedAnnualCost: 180,
          proposedTotalTransportationCost: 60,
          customersUnallocated: 2,
          annualCostDifference: -10
        })
      })
    ]);

    expect(comparison.lowestObservedCostIds).toEqual(["scenario-b"]);
    expect(comparison.lowestTransportationCostIds).toEqual(["scenario-c"]);
    expect(comparison.fewestUnallocatedCustomerIds).toEqual(["scenario-b"]);
    expect(comparison.largestAnnualSavingIds).toEqual(["scenario-b"]);
  });

  it("detects customer assignment changes between two scenarios", () => {
    const comparison = compareSupplyChainDesignScenarios([
      scenarioSummaryFixture({
        id: "scenario-a",
        name: "Scenario A",
        resultSummary: scenarioResultFixture({
          customerAssignments: [
            customerAssignmentFixture({ customerId: "C1", assignedFacilityId: "F1", costPerShipment: 10 }),
            customerAssignmentFixture({ customerId: "C2", assignedFacilityId: "F2", costPerShipment: 5 })
          ]
        })
      }),
      scenarioSummaryFixture({
        id: "scenario-b",
        name: "Scenario B",
        resultSummary: scenarioResultFixture({
          customerAssignments: [
            customerAssignmentFixture({ customerId: "C1", assignedFacilityId: "N1", costPerShipment: 7 }),
            customerAssignmentFixture({ customerId: "C2", assignedFacilityId: "F2", costPerShipment: 5 })
          ]
        })
      })
    ]);

    expect(comparison.customerMovementRows).toEqual([
      expect.objectContaining({
        customerId: "C1",
        scenarioAName: "Scenario A",
        scenarioBName: "Scenario B",
        assignmentA: "F1 (1)",
        assignmentB: "N1 (1)",
        difference: -3
      })
    ]);
  });

  it("compares scenarios with different open-facility combinations and preserves Model 02 totals", () => {
    const comparison = compareSupplyChainDesignScenarios([
      scenarioSummaryFixture({
        id: "scenario-a",
        resultSummary: scenarioResultFixture({
          selectedExistingFacilityIds: ["F1", "F2"],
          selectedCandidateFacilityIds: [],
          closedExistingFacilityIds: [],
          proposedTotalTransportationCost: 36,
          retainedExistingFacilityOperatingCost: 100,
          selectedCandidateAnnualFixedCost: 0,
          proposedObservedAnnualCost: 136,
          annualCostDifference: 0
        })
      }),
      scenarioSummaryFixture({
        id: "scenario-b",
        resultSummary: scenarioResultFixture({
          selectedExistingFacilityIds: ["F1"],
          selectedCandidateFacilityIds: ["N1"],
          closedExistingFacilityIds: ["F2"],
          proposedTotalTransportationCost: 20,
          retainedExistingFacilityOperatingCost: 40,
          selectedCandidateAnnualFixedCost: 100,
          proposedObservedAnnualCost: 160,
          annualCostDifference: 24
        })
      })
    ]);

    expect(comparison.scenarios[0].resultSummary).toEqual(
      expect.objectContaining({
        proposedTotalTransportationCost: 36,
        retainedExistingFacilityOperatingCost: 100,
        selectedCandidateAnnualFixedCost: 0,
        proposedObservedAnnualCost: 136
      })
    );
    expect(comparison.facilityRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scenarioId: "scenario-b", facilityId: "F2", status: "CLOSED" }),
        expect.objectContaining({ scenarioId: "scenario-b", facilityId: "N1", status: "OPEN", facilityKind: "CANDIDATE" })
      ])
    );
  });

  it("compares Model 02 capacity metrics", () => {
    const comparison = compareSupplyChainDesignScenarios([
      scenarioSummaryFixture({
        id: "scenario-a",
        resultSummary: scenarioResultFixture({
          enforceCapacity: true,
          totalFiniteCapacity: 4,
          unallocatedShipmentCount: 1,
          highestFacilityUtilization: 100,
          fullFacilityCount: 1
        })
      }),
      scenarioSummaryFixture({
        id: "scenario-b",
        resultSummary: scenarioResultFixture({
          enforceCapacity: false,
          totalFiniteCapacity: null,
          unallocatedShipmentCount: 0,
          highestFacilityUtilization: null,
          fullFacilityCount: 0
        })
      })
    ]);

    expect(comparison.lowestUnallocatedShipmentVolumeIds).toEqual(["scenario-b"]);
    expect(comparison.highestFacilityUtilizationIds).toEqual(["scenario-a"]);
    expect(comparison.scenarios).toEqual([
      expect.objectContaining({
        resultSummary: expect.objectContaining({
          enforceCapacity: true,
          totalFiniteCapacity: 4,
          fullFacilityCount: 1
        })
      }),
      expect.objectContaining({
        resultSummary: expect.objectContaining({
          enforceCapacity: false,
          totalFiniteCapacity: null,
          fullFacilityCount: 0
        })
      })
    ]);
  });
});

function scenarioSummaryFixture(
  options: {
    id?: string;
    name?: string;
    status?: string;
    createdAt?: Date;
    resultSummary?: ReturnType<typeof scenarioResultFixture> | null;
  } = {}
) {
  return {
    id: options.id ?? "scenario-1",
    name: options.name ?? "Candidate network",
    status: options.status ?? "SUCCESS",
    createdAt: options.createdAt ?? createdAt,
    updatedAt,
    errorMessage: options.status === "FAILED" ? "Scenario failed." : null,
    baselineRunId: "run-1",
    inputReferences: null,
    selectedFacilities: [],
    resultSummary: options.resultSummary === undefined ? scenarioResultFixture() : options.resultSummary
  };
}

function scenarioResultFixture(
  options: Partial<{
    selectedExistingFacilityIds: string[];
    selectedCandidateFacilityIds: string[];
    closedExistingFacilityIds: string[];
    unselectedCandidateFacilityIds: string[];
    selectedFacilityIds: string[];
    enforceCapacity: boolean;
    customersAllocated: number;
    customersUnallocated: number;
    historicalShipmentCount: number | null;
    assignedShipmentCount: number | null;
    unallocatedShipmentCount: number | null;
    totalFiniteCapacity: number | null;
    facilitiesNearCapacityOrFull: number | null;
    highestFacilityUtilization: number | null;
    fullFacilityCount: number | null;
    proposedTotalTransportationCost: number;
    selectedCandidateAnnualFixedCost: number;
    retainedExistingFacilityOperatingCost: number;
    proposedObservedAnnualCost: number;
    annualCostDifference: number;
    percentageDifference: number | null;
    customerAssignments: ReturnType<typeof customerAssignmentFixture>[];
    optimizerType: string | null;
    combinationsEvaluated: number | null;
    feasibleCombinations: number | null;
  }> = {}
) {
  const selectedExistingFacilityIds = options.selectedExistingFacilityIds ?? ["F1", "F2"];
  const selectedCandidateFacilityIds = options.selectedCandidateFacilityIds ?? ["N1"];
  const closedExistingFacilityIds = options.closedExistingFacilityIds ?? [];
  const selectedFacilityIds = options.selectedFacilityIds ?? [...selectedExistingFacilityIds, ...selectedCandidateFacilityIds].sort();

  return {
    scenarioName: "Candidate network",
    baselineRunId: "run-1",
    optimizerType: options.optimizerType ?? null,
    combinationsEvaluated: options.combinationsEvaluated ?? null,
    feasibleCombinations: options.feasibleCombinations ?? null,
    mandatoryExistingFacilityIds: [],
    permittedExistingFacilityIds: [],
    permittedCandidateFacilityIds: [],
    prohibitedCandidateFacilityIds: [],
    minimumOpenFacilities: null,
    maximumOpenFacilities: null,
    selectedExistingFacilityIds,
    selectedCandidateFacilityIds,
    closedExistingFacilityIds,
    unselectedCandidateFacilityIds: options.unselectedCandidateFacilityIds ?? ["N2"],
    selectedFacilityIds,
    enforceCapacity: options.enforceCapacity ?? false,
    customersAllocated: options.customersAllocated ?? 2,
    customersUnallocated: options.customersUnallocated ?? 1,
    historicalShipmentCount: options.historicalShipmentCount ?? 3,
    assignedShipmentCount: options.assignedShipmentCount ?? 2,
    unallocatedShipmentCount: options.unallocatedShipmentCount ?? 1,
    totalFiniteCapacity: options.totalFiniteCapacity ?? null,
    facilitiesNearCapacityOrFull: options.facilitiesNearCapacityOrFull ?? 0,
    highestFacilityUtilization: options.highestFacilityUtilization ?? null,
    fullFacilityCount: options.fullFacilityCount ?? 0,
    baselineObservedCost: 136,
    proposedTotalTransportationCost: options.proposedTotalTransportationCost ?? 20,
    selectedCandidateAnnualFixedCost: options.selectedCandidateAnnualFixedCost ?? 100,
    retainedExistingFacilityOperatingCost: options.retainedExistingFacilityOperatingCost ?? 100,
    proposedObservedAnnualCost: options.proposedObservedAnnualCost ?? 220,
    annualCostDifference: options.annualCostDifference ?? 84,
    percentageDifference: options.percentageDifference ?? 61.76470588235294,
    customerAssignments: options.customerAssignments ?? [
      customerAssignmentFixture({ customerId: "C1", assignedFacilityId: "N1", costPerShipment: 8 }),
      customerAssignmentFixture({ customerId: "C2", assignedFacilityId: "F2", costPerShipment: 6 })
    ],
    facilitySummary: selectedFacilityIds.map((facilityId) => ({
      facilityId,
      facilityName: facilityId.startsWith("N") ? "New DC" : `${facilityId} DC`,
      facilityKind: facilityId.startsWith("N") ? "CANDIDATE" : "EXISTING",
      assignedCustomers: facilityId === "N1" ? 1 : 0,
      assignedShipments: facilityId === "N1" ? 2 : 0,
      transportationCost: facilityId === "N1" ? 16 : 0,
      fixedOrOperatingCost: facilityId === "N1" ? options.selectedCandidateAnnualFixedCost ?? 100 : 40,
      proposedObservedCost: facilityId === "N1" ? 116 : 40,
      capacity: null,
      remainingCapacity: null,
      utilizationPercent: null,
      capacityStatus: "UNLIMITED"
    })),
    unallocatedCustomerIds: ["C3"],
    missingScenarioLaneCosts: [],
    unmatchedFacilityIds: [],
    unmatchedCustomerIds: [],
    deferredValidation: [],
    alternatives: [],
    optimizationExceptions: null
  };
}

function customerAssignmentFixture(
  options: Partial<{
    customerId: string;
    customerName: string;
    assignedFacilityId: string | null;
    costPerShipment: number | null;
  }> = {}
) {
  return {
    customerId: options.customerId ?? "C1",
    customerName: options.customerName ?? "Customer One",
    historicalShipmentCount: 1,
    assignedFacilityId: options.assignedFacilityId ?? "N1",
    assignedFacilityName: options.assignedFacilityId ?? "N1",
    assignedShipmentQuantity: 1,
    costPerShipment: options.costPerShipment ?? 8,
    proposedAnnualTransportationCost: options.costPerShipment ?? 8,
    remainingUnallocatedShipmentQuantity: 0,
    serviceDays: null,
    allocationStatus: options.assignedFacilityId === null ? "UNALLOCATED" : "FULLY_ALLOCATED"
  };
}

function projectWithProofMappings(
  options: {
    includeCost?: boolean;
    invalidCost?: boolean;
    includeInventory?: boolean;
    invalidQuantity?: boolean;
    invalidUnitCost?: boolean;
    includeFacilityCosts?: boolean;
    invalidAnnualCost?: boolean;
    includeCustomers?: boolean;
    invalidDemand?: boolean;
    includeServiceDays?: boolean;
    invalidServiceDays?: boolean;
  } = {}
) {
  const includeCost = options.includeCost ?? true;
  const shipmentCost = options.invalidCost ? "bad" : "12.5";
  const annualCost = options.invalidAnnualCost ? "bad" : "100";
  const demand = options.invalidDemand ? "bad" : "1000";
  const serviceDays = options.invalidServiceDays ? "bad" : "2";

  return {
    id: "project-1",
    mappings: [
      facilityMapping(),
      {
        id: "shipments-mapping",
        fileId: "shipments-file",
        tableType: SupplyChainDesignTableType.SHIPMENTS,
        updatedAt,
        fieldMappings: [
          { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
          { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
          ...(options.includeCustomers
            ? [{ standardField: "destination_id", sourceColumn: "Destination", requirement: "REQUIRED" }]
            : []),
          ...(includeCost
            ? [{ standardField: "transportation_cost", sourceColumn: "Cost", requirement: "OPTIONAL" }]
            : []),
          ...(options.includeServiceDays
            ? [{ standardField: "service_days", sourceColumn: "Service Days", requirement: "OPTIONAL" }]
            : [])
        ],
        file: {
          id: "shipments-file",
          originalFileName: "shipments.csv",
          fileBytes: Buffer.from(
            `Shipment ID,Origin,Destination,Cost,Service Days\nS1,F1,C1,${shipmentCost},${serviceDays}\nS2,F1,C1,5,4\nS3,F3,C9,5,\n`
          )
        }
      },
      ...(options.includeInventory
        ? [
            {
              id: "inventory-mapping",
              fileId: "inventory-file",
              tableType: SupplyChainDesignTableType.INVENTORY,
              updatedAt,
              fieldMappings: [
                { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
                { standardField: "item_id", sourceColumn: "Item ID", requirement: "REQUIRED" },
                { standardField: "quantity", sourceColumn: "Qty", requirement: "REQUIRED" },
                { standardField: "unit_cost", sourceColumn: "Unit Cost", requirement: "OPTIONAL" }
              ],
              file: {
                id: "inventory-file",
                originalFileName: "inventory.csv",
                fileBytes: Buffer.from(
                  `Facility ID,Item ID,Qty,Unit Cost\nF1,I1,${options.invalidQuantity ? "bad" : "10"},2\nF2,I2,5,${
                    options.invalidUnitCost ? "bad" : "3"
                  }\nF9,I3,1,4\n`
                )
              }
            }
          ]
        : []),
      ...(options.includeFacilityCosts
        ? [
            {
              id: "facility-costs-mapping",
              fileId: "facility-costs-file",
              tableType: SupplyChainDesignTableType.FACILITY_COSTS,
              updatedAt,
              fieldMappings: [
                { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
                { standardField: "cost_category", sourceColumn: "Category", requirement: "REQUIRED" },
                { standardField: "annual_cost", sourceColumn: "Annual Cost", requirement: "REQUIRED" }
              ],
              file: {
                id: "facility-costs-file",
                originalFileName: "facility-costs.csv",
                fileBytes: Buffer.from(
                  `Facility ID,Category,Annual Cost\nF1,Rent,${annualCost}\nF2,Utilities,50\nF9,Rent,25\n`
                )
              }
            }
          ]
        : []),
      ...(options.includeCustomers
        ? [
            {
              id: "customers-mapping",
              fileId: "customers-file",
              tableType: SupplyChainDesignTableType.CUSTOMERS,
              updatedAt,
              fieldMappings: [
                { standardField: "customer_id", sourceColumn: "Customer ID", requirement: "REQUIRED" },
                { standardField: "customer_name", sourceColumn: "Customer Name", requirement: "REQUIRED" },
                { standardField: "city", sourceColumn: "City", requirement: "REQUIRED" },
                { standardField: "country", sourceColumn: "Country", requirement: "REQUIRED" },
                { standardField: "annual_demand", sourceColumn: "Annual Demand", requirement: "OPTIONAL" }
              ],
              file: {
                id: "customers-file",
                originalFileName: "customers.csv",
                fileBytes: Buffer.from(
                  `Customer ID,Customer Name,City,Country,Annual Demand\nC1,Customer One,Toronto,Canada,${demand}\nC2,Customer Two,Montreal,Canada,500\n`
                )
              }
            }
          ]
        : [])
    ]
  };
}

function projectWithCurrentNetworkActivityMapping() {
  return {
    id: "project-1",
    mappings: [
      {
        id: "current-network-mapping",
        fileId: "current-network-file",
        tableType: "CURRENT_NETWORK_ACTIVITY",
        updatedAt,
        fieldMappings: testFieldMappings(currentNetworkActivityMappings()),
        file: {
          id: "current-network-file",
          originalFileName: "current-network-data.csv",
          fileBytes: Buffer.from(currentNetworkActivityCsv())
        }
      }
    ]
  };
}

function currentNetworkActivityInput(options: { csv?: string; fields?: ScreeningFixtureMapping[] } = {}) {
  const currentNetworkActivity = {
    fileId: "current-network-file",
    mappingId: "current-network-mapping",
    tableType: "CURRENT_NETWORK_ACTIVITY" as SupplyChainDesignTableType,
    fileBytes: Buffer.from(options.csv ?? currentNetworkActivityCsv()),
    fieldMappings: testFieldMappings(options.fields ?? currentNetworkActivityMappings())
  };

  return {
    currentNetworkActivity,
    facilities: currentNetworkActivity,
    shipments: currentNetworkActivity,
    inventory: null,
    facilityCosts: null,
    customers: null
  };
}

function currentNetworkActivityMappings(): ScreeningFixtureMapping[] {
  return [
    ["shipment_reference", "Shipment / Order Reference"],
    ["record_type", "Record Type"],
    ["shipment_date", "Shipment Date"],
    ["origin_facility_id", "Current Facility ID"],
    ["facility_name", "Current Facility Name"],
    ["facility_type", "Facility Type"],
    ["postal_code", "Facility ZIP / Postal Code"],
    ["facility_capacity_pallet_positions", "Facility Capacity - Pallet Positions"],
    ["destination_id", "Destination Customer / Group"],
    ["postal_or_region_code", "Destination ZIP / Postal Code"],
    ["destination_label", "Destination City / Region"],
    ["country", "Country"],
    ["shipment_quantity", "Shipments"],
    ["pallets", "Pallets"],
    ["units", "Units"],
    ["weight", "Weight"],
    ["mode", "Transportation Mode"],
    ["transportation_cost", "Transportation Cost"],
    ["service_days", "Transit Days"],
    ["service_level", "Service Level"],
    ["item_id", "SKU / Item"],
    ["quantity", "Inventory Quantity"],
    ["inventory_pallets", "Inventory Pallets"],
    ["inventory_value_total", "Inventory Value"],
    ["snapshot_date", "Snapshot Date"],
    ["currency", "Currency"]
  ];
}

function currentNetworkActivityMappingsWithoutDestinationOrCost(): ScreeningFixtureMapping[] {
  return currentNetworkActivityMappings().filter(
    ([field]) => !["destination_id", "postal_or_region_code", "destination_label", "transportation_cost"].includes(field)
  );
}

function currentNetworkActivityCsv() {
  return [
    "Record Type,Shipment / Order Reference,Shipment Date,Current Facility ID,Current Facility Name,Facility Type,Facility ZIP / Postal Code,Facility Capacity - Pallet Positions,Destination Customer / Group,Destination ZIP / Postal Code,Destination City / Region,Country,Shipments,Pallets,Units,Weight,Transportation Mode,Transportation Cost,Transit Days,Service Level,SKU / Item,Inventory Quantity,Inventory Pallets,Inventory Value,Snapshot Date,Currency",
    "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Toronto DC,Owned,M5V 2T6,12000,Customer A,,New York NY,US,1,2,40,1200,LTL,525,2,Standard,SKU-100,120,3,2400,2026-01-31,USD",
    "Individual Shipment,ORD-1002,2026-01-16,TOR-01,Toronto DC,Owned,M5V 2T6,12000,,10001,New York ZIP group,US,1,1,24,700,Parcel,95,1,Ground,,,,,,USD",
    "Individual Shipment,ORD-2001,2026-01-17,DFW-3PL,Dallas 3PL,Existing 3PL,75201,8000,Customer B,30303,Atlanta GA,US,1,3,55,1600,LTL,610,3,Standard,SKU-200,80,2,3200,2026-01-31,USD",
    "Aggregated Activity,,2026-01-18,DFW-3PL,Dallas 3PL,Existing 3PL,75201,8000,,75201,Dallas ZIP group,US,25,25,300,10000,Parcel,1875,1,Ground,,,,,,USD"
  ].join("\n");
}

function currentNetworkActivityCsvWithoutDestinationOrCost() {
  return [
    "Record Type,Shipment / Order Reference,Shipment Date,Current Facility ID,Current Facility Name,Facility Type,Facility ZIP / Postal Code,Facility Capacity - Pallet Positions,Country,Shipments,Pallets,Units,Weight,Transportation Mode,Transit Days,Service Level,SKU / Item,Inventory Quantity,Inventory Pallets,Inventory Value,Snapshot Date,Currency",
    "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Toronto DC,Owned,M5V 2T6,12000,US,1,2,40,1200,LTL,2,Standard,,,,,,USD",
    "Aggregated Activity,,2026-01-17,DFW-3PL,Dallas 3PL,Existing 3PL,75201,8000,US,25,25,55,1600,LTL,3,Standard,,,,,,USD"
  ].join("\n");
}

function currentNetworkActivityCsvWithFacilityConflict() {
  return currentNetworkActivityCsv().replace("ORD-1002,2026-01-16,TOR-01,Toronto DC", "ORD-1002,2026-01-16,TOR-01,Toronto DC East");
}

function facilityMapping() {
  return {
    id: "facilities-mapping",
    fileId: "facilities-file",
    tableType: SupplyChainDesignTableType.FACILITIES,
    updatedAt,
    fieldMappings: [
      { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
      { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" },
      { standardField: "facility_type", sourceColumn: "Facility Type", requirement: "REQUIRED" },
      { standardField: "postal_code", sourceColumn: "Facility ZIP", requirement: "REQUIRED" }
    ],
    file: {
      id: "facilities-file",
      originalFileName: "facilities.csv",
      fileBytes: Buffer.from("Facility ID,Facility Name,Facility Type,Facility ZIP\nF1,Toronto DC,Owned,M5V 2T6\nF2,Montreal DC,Leased,H3B 1A7\n")
    }
  };
}

function model02CapacityInput(
  options: {
    enforceCapacity?: boolean;
    customersCsv?: string;
    shipmentsCsv?: string;
    candidateFacilitiesCsv?: string;
    scenarioLaneCostsCsv?: string;
  } = {}
) {
  return {
    scenarioName: "Capacity scenario",
    baselineRunId: "run-1",
    baselineObservedCost: 136,
    facilities: {
      fileId: "facilities-file",
      mappingId: "facilities-mapping",
      fileName: "toronto-vancouver-facilities.csv",
      tableType: SupplyChainDesignTableType.FACILITIES,
      fileBytes: Buffer.from("Facility ID,Facility Name,Capacity\nF1,Toronto DC,\n"),
      fieldMappings: [
        { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
        { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" },
        { standardField: "capacity", sourceColumn: "Capacity", requirement: "OPTIONAL" }
      ]
    },
    shipments: {
      fileId: "shipments-file",
      mappingId: "shipments-mapping",
      fileName: "historical-shipments.csv",
      tableType: SupplyChainDesignTableType.SHIPMENTS,
      fileBytes: Buffer.from(
        options.shipmentsCsv ?? "Shipment ID,Origin,Destination,Cost\nS1,F1,C1,10\nS2,F1,C1,10\nS3,F1,C1,10\n"
      ),
      fieldMappings: [
        { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
        { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
        { standardField: "destination_id", sourceColumn: "Destination", requirement: "REQUIRED" },
        { standardField: "transportation_cost", sourceColumn: "Cost", requirement: "OPTIONAL" }
      ]
    },
    customers: {
      fileId: "customers-file",
      mappingId: "customers-mapping",
      fileName: "customers.csv",
      tableType: SupplyChainDesignTableType.CUSTOMERS,
      fileBytes: Buffer.from(
        options.customersCsv ?? "Customer ID,Customer Name,City,Country\nC1,Customer One,Toronto,Canada\n"
      ),
      fieldMappings: [
        { standardField: "customer_id", sourceColumn: "Customer ID", requirement: "REQUIRED" },
        { standardField: "customer_name", sourceColumn: "Customer Name", requirement: "REQUIRED" },
        { standardField: "city", sourceColumn: "City", requirement: "REQUIRED" },
        { standardField: "country", sourceColumn: "Country", requirement: "REQUIRED" }
      ]
    },
    candidateFacilities: {
      fileId: "candidate-facilities-file",
      mappingId: "candidate-facilities-mapping",
      fileName: "candidate-facilities.csv",
      tableType: SupplyChainDesignTableType.CANDIDATE_FACILITIES,
      fileBytes: Buffer.from(
        options.candidateFacilitiesCsv ??
          "Candidate ID,Candidate Name,Candidate Type,Candidate ZIP,City,Country,Fixed Cost,Capacity\nN1,New DC,Location Candidate,K7K 1A1,Kingston,Canada,100,2\nN2,Second DC,Location Candidate,N6A 1A1,London,Canada,80,2\n"
      ),
      fieldMappings: [
        { standardField: "candidate_facility_id", sourceColumn: "Candidate ID", requirement: "REQUIRED" },
        { standardField: "candidate_facility_name", sourceColumn: "Candidate Name", requirement: "REQUIRED" },
        { standardField: "city", sourceColumn: "City", requirement: "REQUIRED" },
        { standardField: "country", sourceColumn: "Country", requirement: "REQUIRED" },
        { standardField: "annual_fixed_cost", sourceColumn: "Fixed Cost", requirement: "REQUIRED" },
        { standardField: "capacity", sourceColumn: "Capacity", requirement: "OPTIONAL" }
      ]
    },
    scenarioLaneCosts: {
      fileId: "scenario-lane-costs-file",
      mappingId: "scenario-lane-costs-mapping",
      fileName: "scenario-lane-costs.csv",
      tableType: SupplyChainDesignTableType.SCENARIO_LANE_COSTS,
      fileBytes: Buffer.from(
        options.scenarioLaneCostsCsv ?? "Origin,Destination,Cost,Service Days\nN1,C1,10,2\nN2,C1,12,3\n"
      ),
      fieldMappings: [
        { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
        { standardField: "destination_id", sourceColumn: "Destination", requirement: "REQUIRED" },
        { standardField: "cost_per_shipment", sourceColumn: "Cost", requirement: "REQUIRED" },
        { standardField: "service_days", sourceColumn: "Service Days", requirement: "OPTIONAL" }
      ]
    },
    facilityCosts: null,
    selectedExistingFacilityIds: [],
    selectedCandidateFacilityIds: ["N1", "N2"],
    enforceCapacity: options.enforceCapacity ?? true
  };
}

function model02FourShipmentInput(
  options: {
    enforceCapacity?: boolean;
    facilitiesCsv?: string;
    customersCsv?: string;
    shipmentsCsv?: string;
    candidateFacilitiesCsv?: string;
    scenarioLaneCostsCsv?: string;
    selectedExistingFacilityIds?: string[];
    selectedCandidateFacilityIds?: string[];
  } = {}
) {
  return {
    scenarioName: "Four shipment scenario",
    baselineRunId: "run-1",
    baselineObservedCost: 100,
    facilities: {
      fileId: "facilities-file",
      mappingId: "facilities-mapping",
      fileName: "toronto-vancouver-facilities.csv",
      tableType: SupplyChainDesignTableType.FACILITIES,
      fileBytes: Buffer.from(options.facilitiesCsv ?? "Facility ID,Facility Name,Capacity\nTOR-01,Toronto DC,\nVAN-01,Vancouver DC,\n"),
      fieldMappings: [
        { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
        { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" },
        { standardField: "capacity", sourceColumn: "Capacity", requirement: "OPTIONAL" }
      ]
    },
    shipments: {
      fileId: "shipments-file",
      mappingId: "shipments-mapping",
      fileName: "historical-shipments.csv",
      tableType: SupplyChainDesignTableType.SHIPMENTS,
      fileBytes: Buffer.from(
        options.shipmentsCsv ??
          [
            "Shipment ID,Origin,Destination,Cost",
            "S1,TOR-01,Customer-A,10",
            "S2,VAN-01,Customer-B,11",
            "S3,TOR-01,Customer-C,12",
            "S4,VAN-01,Customer-D,13"
          ].join("\n")
      ),
      fieldMappings: [
        { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
        { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
        { standardField: "destination_id", sourceColumn: "Destination", requirement: "REQUIRED" },
        { standardField: "transportation_cost", sourceColumn: "Cost", requirement: "OPTIONAL" }
      ]
    },
    customers: {
      fileId: "customers-file",
      mappingId: "customers-mapping",
      fileName: "customers.csv",
      tableType: SupplyChainDesignTableType.CUSTOMERS,
      fileBytes: Buffer.from(
        options.customersCsv ??
          [
            "Customer ID,Customer Name,City,Country",
            "Customer-A,Customer A,Toronto,Canada",
            "Customer-B,Customer B,Vancouver,Canada",
            "Customer-C,Customer C,Calgary,Canada",
            "Customer-D,Customer D,Montreal,Canada"
          ].join("\n")
      ),
      fieldMappings: [
        { standardField: "customer_id", sourceColumn: "Customer ID", requirement: "REQUIRED" },
        { standardField: "customer_name", sourceColumn: "Customer Name", requirement: "REQUIRED" },
        { standardField: "city", sourceColumn: "City", requirement: "REQUIRED" },
        { standardField: "country", sourceColumn: "Country", requirement: "REQUIRED" }
      ]
    },
    candidateFacilities: {
      fileId: "candidate-facilities-file",
      mappingId: "candidate-facilities-mapping",
      fileName: "candidate-facilities.csv",
      tableType: SupplyChainDesignTableType.CANDIDATE_FACILITIES,
      fileBytes: Buffer.from(
        options.candidateFacilitiesCsv ??
          "Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nCHI-01,Chicago DC,Chicago,USA,100,\n"
      ),
      fieldMappings: [
        { standardField: "candidate_facility_id", sourceColumn: "Candidate ID", requirement: "REQUIRED" },
        { standardField: "candidate_facility_name", sourceColumn: "Candidate Name", requirement: "REQUIRED" },
        { standardField: "city", sourceColumn: "City", requirement: "REQUIRED" },
        { standardField: "country", sourceColumn: "Country", requirement: "REQUIRED" },
        { standardField: "annual_fixed_cost", sourceColumn: "Fixed Cost", requirement: "REQUIRED" },
        { standardField: "capacity", sourceColumn: "Capacity", requirement: "OPTIONAL" }
      ]
    },
    scenarioLaneCosts: {
      fileId: "scenario-lane-costs-file",
      mappingId: "scenario-lane-costs-mapping",
      fileName: "scenario-lane-costs.csv",
      tableType: SupplyChainDesignTableType.SCENARIO_LANE_COSTS,
      fileBytes: Buffer.from(
        options.scenarioLaneCostsCsv ??
          [
            "Origin,Destination,Cost,Service Days",
            "TOR-01,Customer-A,10,2",
            "VAN-01,Customer-B,11,2",
            "CHI-01,Customer-C,8,2",
            "CHI-01,Customer-D,7,2"
          ].join("\n")
      ),
      fieldMappings: [
        { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
        { standardField: "destination_id", sourceColumn: "Destination", requirement: "REQUIRED" },
        { standardField: "cost_per_shipment", sourceColumn: "Cost", requirement: "REQUIRED" },
        { standardField: "service_days", sourceColumn: "Service Days", requirement: "OPTIONAL" }
      ]
    },
    facilityCosts: null,
    selectedExistingFacilityIds: options.selectedExistingFacilityIds ?? ["TOR-01", "VAN-01"],
    selectedCandidateFacilityIds: options.selectedCandidateFacilityIds ?? ["CHI-01"],
    enforceCapacity: options.enforceCapacity ?? true
  };
}

function model02OptimizerInput(
  options: Parameters<typeof model02FourShipmentInput>[0] & {
    mandatoryExistingFacilityIds?: string[];
    permittedExistingFacilityIds?: string[];
    permittedCandidateFacilityIds?: string[];
    prohibitedCandidateFacilityIds?: string[];
    minimumOpenFacilities?: number;
    maximumOpenFacilities?: number;
    baselineObservedCost?: number;
  } = {}
) {
  const base = model02FourShipmentInput(options);
  return {
    ...base,
    scenarioName: "Optimized network",
    baselineObservedCost: options.baselineObservedCost ?? base.baselineObservedCost,
    mandatoryExistingFacilityIds: options.mandatoryExistingFacilityIds ?? [],
    permittedExistingFacilityIds: options.permittedExistingFacilityIds ?? ["TOR-01", "VAN-01"],
    permittedCandidateFacilityIds: options.permittedCandidateFacilityIds ?? ["CHI-01"],
    prohibitedCandidateFacilityIds: options.prohibitedCandidateFacilityIds ?? [],
    minimumOpenFacilities: options.minimumOpenFacilities ?? 1,
    maximumOpenFacilities: options.maximumOpenFacilities ?? 3
  };
}

function projectWithModel02Mappings(options: { tie?: boolean; missingLaneCosts?: boolean } = {}) {
  return {
    id: "project-1",
    mappings: [
      facilityMapping(),
      {
        id: "shipments-mapping",
        fileId: "shipments-file",
        tableType: SupplyChainDesignTableType.SHIPMENTS,
        updatedAt,
        fieldMappings: [
          { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
          { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
          { standardField: "destination_id", sourceColumn: "Destination", requirement: "REQUIRED" },
          { standardField: "transportation_cost", sourceColumn: "Cost", requirement: "OPTIONAL" }
        ],
        file: {
          id: "shipments-file",
          originalFileName: "shipments.csv",
          fileBytes: Buffer.from("Shipment ID,Origin,Destination,Cost\nS1,F1,C1,10\nS2,F1,C1,20\nS3,F2,C2,6\n")
        }
      },
      {
        id: "customers-mapping",
        fileId: "customers-file",
        tableType: SupplyChainDesignTableType.CUSTOMERS,
        updatedAt,
        fieldMappings: [
          { standardField: "customer_id", sourceColumn: "Customer ID", requirement: "REQUIRED" },
          { standardField: "customer_name", sourceColumn: "Customer Name", requirement: "REQUIRED" },
          { standardField: "city", sourceColumn: "City", requirement: "REQUIRED" },
          { standardField: "country", sourceColumn: "Country", requirement: "REQUIRED" }
        ],
        file: {
          id: "customers-file",
          originalFileName: "customers.csv",
          fileBytes: Buffer.from("Customer ID,Customer Name,City,Country\nC1,Customer One,Toronto,Canada\nC2,Customer Two,Montreal,Canada\nC3,Customer Three,Ottawa,Canada\n")
        }
      },
      {
        id: "candidate-facilities-mapping",
        fileId: "candidate-facilities-file",
        tableType: SupplyChainDesignTableType.CANDIDATE_FACILITIES,
        updatedAt,
        fieldMappings: [
          { standardField: "candidate_facility_id", sourceColumn: "Candidate ID", requirement: "REQUIRED" },
          { standardField: "candidate_facility_name", sourceColumn: "Candidate Name", requirement: "REQUIRED" },
          { standardField: "city", sourceColumn: "City", requirement: "REQUIRED" },
          { standardField: "country", sourceColumn: "Country", requirement: "REQUIRED" },
          { standardField: "annual_fixed_cost", sourceColumn: "Fixed Cost", requirement: "REQUIRED" },
          { standardField: "capacity", sourceColumn: "Capacity", requirement: "OPTIONAL" }
        ],
        file: {
          id: "candidate-facilities-file",
          originalFileName: "candidate-facilities.csv",
          fileBytes: Buffer.from("Candidate ID,Candidate Name,City,Country,Fixed Cost,Capacity\nN1,New DC,Kingston,Canada,100,1000\nN2,Second DC,London,Canada,80,500\n")
        }
      },
      {
        id: "scenario-lane-costs-mapping",
        fileId: "scenario-lane-costs-file",
        tableType: SupplyChainDesignTableType.SCENARIO_LANE_COSTS,
        updatedAt,
        fieldMappings: [
          { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" },
          { standardField: "destination_id", sourceColumn: "Destination", requirement: "REQUIRED" },
          { standardField: "cost_per_shipment", sourceColumn: "Cost", requirement: "REQUIRED" },
          { standardField: "service_days", sourceColumn: "Service Days", requirement: "OPTIONAL" }
        ],
        file: {
          id: "scenario-lane-costs-file",
          originalFileName: "scenario-lane-costs.csv",
          fileBytes: Buffer.from(
            options.missingLaneCosts
              ? "Origin,Destination,Cost,Service Days\nN1,C1,8,2\n"
              : `Origin,Destination,Cost,Service Days\nN1,C1,8,2\nN1,C2,${
                  options.tie ? "6" : "4"
                },3\nN2,C2,6,4\n`
          )
        }
      },
      {
        id: "facility-costs-mapping",
        fileId: "facility-costs-file",
        tableType: SupplyChainDesignTableType.FACILITY_COSTS,
        updatedAt,
        fieldMappings: [
          { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
          { standardField: "cost_category", sourceColumn: "Category", requirement: "REQUIRED" },
          { standardField: "annual_cost", sourceColumn: "Annual Cost", requirement: "REQUIRED" }
        ],
        file: {
          id: "facility-costs-file",
          originalFileName: "facility-costs.csv",
          fileBytes: Buffer.from("Facility ID,Category,Annual Cost\nF1,Rent,40\nF2,Utilities,60\n")
        }
      }
    ],
    modelRuns: [
      {
        id: "run-1",
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        resultSummary: {
          totalTransportationCost: 36,
          totalFacilityOperatingCost: 100
        }
      }
    ]
  };
}

function model01CostAnalysisFixture() {
  return {
    facilityCount: 2,
    shipmentCount: 3,
    hasTransportationCost: true,
    totalTransportationCost: 22.5,
    shipmentCountByOrigin: [
      { originFacilityId: "F1", shipmentCount: 2 },
      { originFacilityId: "F3", shipmentCount: 1 }
    ],
    transportationCostByOrigin: [
      { originFacilityId: "F1", transportationCost: 17.5 },
      { originFacilityId: "F3", transportationCost: 5 }
    ],
    unmatchedShipmentOriginIds: ["F3"],
    hasInventory: true,
    inventoryQuantity: 16,
    inventoryQuantityByFacility: [
      { facilityId: "F1", inventoryQuantity: 10 },
      { facilityId: "F2", inventoryQuantity: 5 },
      { facilityId: "F9", inventoryQuantity: 1 }
    ],
    hasInventoryValue: true,
    inventoryValue: 39,
    inventoryValueByFacility: [
      { facilityId: "F1", inventoryValue: 20 },
      { facilityId: "F2", inventoryValue: 15 },
      { facilityId: "F9", inventoryValue: 4 }
    ],
    unmatchedInventoryFacilityIds: ["F9"],
    hasFacilityCosts: true,
    totalFacilityOperatingCost: 175,
    facilityOperatingCostByFacility: [
      { facilityId: "F1", facilityOperatingCost: 100 },
      { facilityId: "F2", facilityOperatingCost: 50 },
      { facilityId: "F9", facilityOperatingCost: 25 }
    ],
    facilityOperatingCostByCategory: [
      { costCategory: "Rent", facilityOperatingCost: 125 },
      { costCategory: "Utilities", facilityOperatingCost: 50 }
    ],
    unmatchedFacilityCostFacilityIds: ["F9"],
    hasCustomers: true,
    customerCount: 2,
    shipmentCountByDestination: [
      { destinationId: "C1", shipmentCount: 2 },
      { destinationId: "C9", shipmentCount: 1 }
    ],
    transportationCostByDestination: [
      { destinationId: "C1", transportationCost: 17.5 },
      { destinationId: "C9", transportationCost: 5 }
    ],
    laneShipmentCounts: [
      { originFacilityId: "F1", destinationId: "C1", shipmentCount: 2 },
      { originFacilityId: "F3", destinationId: "C9", shipmentCount: 1 }
    ],
    transportationCostByLane: [
      { originFacilityId: "F1", destinationId: "C1", transportationCost: 17.5 },
      { originFacilityId: "F3", destinationId: "C9", transportationCost: 5 }
    ],
    unmatchedShipmentDestinationIds: ["C9"],
    hasCustomerDemand: true,
    totalAnnualCustomerDemand: 1500,
    annualDemandByCustomer: [
      { customerId: "C1", annualDemand: 1000 },
      { customerId: "C2", annualDemand: 500 }
    ],
    hasServiceDays: true,
    averageServiceDays: 3,
    averageServiceDaysByDestination: [{ destinationId: "C1", averageServiceDays: 3 }],
    averageServiceDaysByLane: [{ originFacilityId: "F1", destinationId: "C1", averageServiceDays: 3 }],
    networkLanes: [
      {
        originFacilityId: "F1",
        originFacilityName: "Toronto DC",
        destinationId: "C1",
        customerName: "Customer One",
        shipmentCount: 2,
        transportationCost: 17.5,
        averageServiceDays: 3
      },
      {
        originFacilityId: "F3",
        originFacilityName: "Unknown facility",
        destinationId: "C9",
        customerName: null,
        shipmentCount: 1,
        transportationCost: 5,
        averageServiceDays: null
      }
    ],
    facilitySummary: [
      {
        facilityId: "F1",
        facilityName: "Toronto DC",
        facilityType: "Owned",
        shipmentCount: 2,
        pallets: 4,
        units: 20,
        weight: 1000,
        transportationCost: 17.5,
        inventoryQuantity: 10,
        inventoryValue: 20,
        facilityOperatingCost: 100,
        observedCost: 117.5
      },
      {
        facilityId: "F2",
        facilityName: "Montreal DC",
        facilityType: "Existing 3PL",
        shipmentCount: 0,
        pallets: 0,
        units: 0,
        weight: 0,
        transportationCost: 0,
        inventoryQuantity: 5,
        inventoryValue: 15,
        facilityOperatingCost: 50,
        observedCost: 50
      }
    ],
    analysisLevels: [{ label: "Volume baseline", status: "AVAILABLE", explanation: "Volume fields were mapped." }],
    facilityDataWarnings: [],
    volumeSummary: {
      totalShipments: 3,
      totalPallets: 4,
      totalUnits: 20,
      totalWeight: 1000,
      averagePalletsPerShipment: 1.3333333333333333,
      averageUnitsPerShipment: 6.666666666666667,
      averageWeightPerShipment: 333.3333333333333,
      transportationCostPerShipment: 7.5,
      transportationCostPerPallet: 5.625,
      transportationCostPerUnit: 1.125,
      transportationCostPerPound: 0.0225
    },
    currencyWarnings: [],
    transportationCostByCurrency: [{ currency: "USD", transportationCost: 22.5 }],
    facilityCostByCurrency: [{ currency: "USD", facilityOperatingCost: 175 }],
    observedNetworkCostByCurrency: [{ currency: "USD", observedCost: 197.5 }],
    snapshotPalletUtilization: [
      {
        facilityId: "F1",
        facilityName: "Toronto DC",
        facilityType: "Owned",
        capacityPalletPositions: 100,
        inventoryPallets: 10,
        snapshotDate: "2026-01-31",
        utilizationPercent: 10,
        latest: true,
        warning: null
      }
    ],
    modeSummary: [{ mode: "LTL", shipmentCount: 3, transportationCost: 22.5 }],
    serviceLevelSummary: [{ serviceLevel: "Standard", shipmentCount: 3 }],
    skuSummary: { distinctSkuCount: 1, shipmentCountBySku: [{ itemId: "SKU-1", shipmentCount: 3 }] },
    deferredValidation: []
  };
}

function projectWithMultipleProofMappings() {
  return {
    id: "project-1",
    mappings: [
      {
        id: "new-facilities-mapping",
        fileId: "new-facilities-file",
        tableType: SupplyChainDesignTableType.FACILITIES,
        updatedAt: new Date("2026-07-27T15:00:00.000Z"),
        fieldMappings: [
          { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
          { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" }
        ],
        file: {
          id: "new-facilities-file",
          originalFileName: "new-facilities.csv",
          fileBytes: Buffer.from("Facility ID,Facility Name\nF9,Newest DC\n")
        }
      },
      {
        id: "old-facilities-mapping",
        fileId: "old-facilities-file",
        tableType: SupplyChainDesignTableType.FACILITIES,
        updatedAt: new Date("2026-07-27T14:00:00.000Z"),
        fieldMappings: [
          { standardField: "facility_id", sourceColumn: "ID", requirement: "REQUIRED" },
          { standardField: "facility_name", sourceColumn: "Name", requirement: "REQUIRED" }
        ],
        file: {
          id: "old-facilities-file",
          originalFileName: "old-facilities.csv",
          fileBytes: Buffer.from("ID,Name\nF1,Old DC\n")
        }
      },
      {
        id: "new-shipments-mapping",
        fileId: "new-shipments-file",
        tableType: SupplyChainDesignTableType.SHIPMENTS,
        updatedAt: new Date("2026-07-27T15:30:00.000Z"),
        fieldMappings: [
          { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
          { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" }
        ],
        file: {
          id: "new-shipments-file",
          originalFileName: "new-shipments.csv",
          fileBytes: Buffer.from("Shipment ID,Origin\nS9,F9\n")
        }
      },
      {
        id: "old-shipments-mapping",
        fileId: "old-shipments-file",
        tableType: SupplyChainDesignTableType.SHIPMENTS,
        updatedAt: new Date("2026-07-27T13:00:00.000Z"),
        fieldMappings: [
          { standardField: "shipment_id", sourceColumn: "ID", requirement: "REQUIRED" },
          { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" }
        ],
        file: {
          id: "old-shipments-file",
          originalFileName: "old-shipments.csv",
          fileBytes: Buffer.from("ID,Origin\nS1,F1\n")
        }
      }
    ]
  };
}

function projectReloadWithMultipleMappings(adminContext: AuthenticatedContext) {
  return {
    id: "project-1",
    tenantId: adminContext.tenantId,
    name: "Network baseline",
    description: null,
    status: SupplyChainDesignProjectStatus.DRAFT,
    createdByUserId: adminContext.userId,
    createdAt,
    updatedAt,
    createdBy: {
      name: "User",
      email: "user@example.com"
    },
    files: [
      fileSummaryFixture("new-facilities-file", "new-facilities.csv", "hash-new-f", [
        {
          id: "new-facilities-mapping",
          tableType: "FACILITIES",
          updatedAt: new Date("2026-07-27T15:00:00.000Z"),
          fieldMappings: [
            { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
            { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" }
          ]
        }
      ]),
      fileSummaryFixture("old-facilities-file", "old-facilities.csv", "hash-old-f", [
        {
          id: "old-facilities-mapping",
          tableType: "FACILITIES",
          updatedAt: new Date("2026-07-27T14:00:00.000Z"),
          fieldMappings: [
            { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
            { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" }
          ]
        }
      ]),
      fileSummaryFixture("new-shipments-file", "new-shipments.csv", "hash-new-s", [
        {
          id: "new-shipments-mapping",
          tableType: "SHIPMENTS",
          updatedAt: new Date("2026-07-27T15:30:00.000Z"),
          fieldMappings: [
            { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
            { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" }
          ]
        }
      ]),
      fileSummaryFixture("old-shipments-file", "old-shipments.csv", "hash-old-s", [
        {
          id: "old-shipments-mapping",
          tableType: "SHIPMENTS",
          updatedAt: new Date("2026-07-27T13:00:00.000Z"),
          fieldMappings: [
            { standardField: "shipment_id", sourceColumn: "Shipment ID", requirement: "REQUIRED" },
            { standardField: "origin_facility_id", sourceColumn: "Origin", requirement: "REQUIRED" }
          ]
        }
      ])
    ],
    modelRuns: []
  };
}

function projectReloadWithSuccessfulInventoryRun(adminContext: AuthenticatedContext) {
  return {
    ...projectReloadWithMultipleMappings(adminContext),
    modelRuns: [
      {
        id: "run-1",
        status: "SUCCESS",
        createdAt,
        errorMessage: null,
        inputReferences: {
          facilities: {
            fileId: "facilities-file",
            fileName: "facilities.csv",
            mappingId: "facilities-mapping",
            mappingUpdatedAt: updatedAt.toISOString(),
            candidateFiles: []
          },
          shipments: {
            fileId: "shipments-file",
            fileName: "shipments.csv",
            mappingId: "shipments-mapping",
            mappingUpdatedAt: updatedAt.toISOString(),
            candidateFiles: []
          },
          inventory: {
            fileId: "inventory-file",
            fileName: "inventory.csv",
            mappingId: "inventory-mapping",
            mappingUpdatedAt: updatedAt.toISOString(),
            candidateFiles: []
          },
          facilityCosts: {
            fileId: "facility-costs-file",
            fileName: "facility-costs.csv",
            mappingId: "facility-costs-mapping",
            mappingUpdatedAt: updatedAt.toISOString(),
            candidateFiles: []
          },
          customers: {
            fileId: "customers-file",
            fileName: "customers.csv",
            mappingId: "customers-mapping",
            mappingUpdatedAt: updatedAt.toISOString(),
            candidateFiles: []
          }
        },
        resultSummary: {
          facilityCount: 2,
          shipmentCount: 3,
          hasTransportationCost: true,
          totalTransportationCost: 22.5,
          shipmentCountByOrigin: [
            { originFacilityId: "F1", shipmentCount: 2 },
            { originFacilityId: "F3", shipmentCount: 1 }
          ],
          transportationCostByOrigin: [
            { originFacilityId: "F1", transportationCost: 17.5 },
            { originFacilityId: "F3", transportationCost: 5 }
          ],
          unmatchedShipmentOriginIds: ["F3"],
          hasInventory: true,
          inventoryQuantity: 16,
          inventoryQuantityByFacility: [
            { facilityId: "F1", inventoryQuantity: 10 },
            { facilityId: "F2", inventoryQuantity: 5 },
            { facilityId: "F9", inventoryQuantity: 1 }
          ],
          hasInventoryValue: true,
          inventoryValue: 39,
          inventoryValueByFacility: [
            { facilityId: "F1", inventoryValue: 20 },
            { facilityId: "F2", inventoryValue: 15 },
            { facilityId: "F9", inventoryValue: 4 }
          ],
          unmatchedInventoryFacilityIds: ["F9"],
          hasFacilityCosts: true,
          totalFacilityOperatingCost: 175,
          facilityOperatingCostByFacility: [
            { facilityId: "F1", facilityOperatingCost: 100 },
            { facilityId: "F2", facilityOperatingCost: 50 },
            { facilityId: "F9", facilityOperatingCost: 25 }
          ],
          facilityOperatingCostByCategory: [
            { costCategory: "Rent", facilityOperatingCost: 125 },
            { costCategory: "Utilities", facilityOperatingCost: 50 }
          ],
          unmatchedFacilityCostFacilityIds: ["F9"],
          hasCustomers: true,
          customerCount: 2,
          shipmentCountByDestination: [
            { destinationId: "C1", shipmentCount: 2 },
            { destinationId: "C9", shipmentCount: 1 }
          ],
          transportationCostByDestination: [
            { destinationId: "C1", transportationCost: 17.5 },
            { destinationId: "C9", transportationCost: 5 }
          ],
          laneShipmentCounts: [
            { originFacilityId: "F1", destinationId: "C1", shipmentCount: 2 },
            { originFacilityId: "F3", destinationId: "C9", shipmentCount: 1 }
          ],
          transportationCostByLane: [
            { originFacilityId: "F1", destinationId: "C1", transportationCost: 17.5 },
            { originFacilityId: "F3", destinationId: "C9", transportationCost: 5 }
          ],
          unmatchedShipmentDestinationIds: ["C9"],
          hasCustomerDemand: true,
          totalAnnualCustomerDemand: 1500,
          annualDemandByCustomer: [
            { customerId: "C1", annualDemand: 1000 },
            { customerId: "C2", annualDemand: 500 }
          ],
          hasServiceDays: true,
          averageServiceDays: 3,
          averageServiceDaysByDestination: [{ destinationId: "C1", averageServiceDays: 3 }],
          averageServiceDaysByLane: [{ originFacilityId: "F1", destinationId: "C1", averageServiceDays: 3 }],
          networkLanes: [
            {
              originFacilityId: "F1",
              originFacilityName: "Toronto DC",
              destinationId: "C1",
              customerName: "Customer One",
              shipmentCount: 2,
              transportationCost: 17.5,
              averageServiceDays: 3
            },
            {
              originFacilityId: "F3",
              originFacilityName: "Unknown facility",
              destinationId: "C9",
              customerName: null,
              shipmentCount: 1,
              transportationCost: 5,
              averageServiceDays: null
            }
          ],
          facilitySummary: [
            {
              facilityId: "F1",
              facilityName: "Toronto DC",
              facilityType: "Owned",
              shipmentCount: 2,
              pallets: 4,
              units: 20,
              weight: 1000,
              transportationCost: 17.5,
              inventoryQuantity: 10,
              inventoryValue: 20,
              facilityOperatingCost: 100,
              observedCost: 117.5
            },
            {
              facilityId: "F2",
              facilityName: "Montreal DC",
              facilityType: "Existing 3PL",
              shipmentCount: 0,
              pallets: 0,
              units: 0,
              weight: 0,
              transportationCost: 0,
              inventoryQuantity: 5,
              inventoryValue: 15,
              facilityOperatingCost: 50,
              observedCost: 50
            }
          ],
          analysisLevels: [{ label: "Volume baseline", status: "AVAILABLE", explanation: "Volume fields were mapped." }],
          facilityDataWarnings: [],
          volumeSummary: {
            totalShipments: 3,
            totalPallets: 4,
            totalUnits: 20,
            totalWeight: 1000,
            averagePalletsPerShipment: 1.3333333333333333,
            averageUnitsPerShipment: 6.666666666666667,
            averageWeightPerShipment: 333.3333333333333,
            transportationCostPerShipment: 7.5,
            transportationCostPerPallet: 5.625,
            transportationCostPerUnit: 1.125,
            transportationCostPerPound: 0.0225
          },
          currencyWarnings: [],
          transportationCostByCurrency: [{ currency: "USD", transportationCost: 22.5 }],
          facilityCostByCurrency: [{ currency: "USD", facilityOperatingCost: 175 }],
          observedNetworkCostByCurrency: [{ currency: "USD", observedCost: 197.5 }],
          snapshotPalletUtilization: [
            {
              facilityId: "F1",
              facilityName: "Toronto DC",
              facilityType: "Owned",
              capacityPalletPositions: 100,
              inventoryPallets: 10,
              snapshotDate: "2026-01-31",
              utilizationPercent: 10,
              latest: true,
              warning: null
            }
          ],
          modeSummary: [{ mode: "LTL", shipmentCount: 3, transportationCost: 22.5 }],
          serviceLevelSummary: [{ serviceLevel: "Standard", shipmentCount: 3 }],
          skuSummary: { distinctSkuCount: 1, shipmentCountBySku: [{ itemId: "SKU-1", shipmentCount: 3 }] },
          deferredValidation: []
        }
      }
    ]
  };
}

describe("3PL location screening proof", () => {
  it("normalizes benchmark and boolean-style logistics market eligibility values", () => {
    for (const value of ["Major logistics market", " major logistics market ", "Province-level Canadian market", "TRUE", "yes", "active", "eligible", "1"]) {
      expect(normalizeLogisticsMarketEligibility(value)).toMatchObject({ eligible: true, reason: "ELIGIBLE" });
    }
    for (const value of ["false", "NO", "inactive", "ineligible", "0"]) {
      expect(normalizeLogisticsMarketEligibility(value)).toMatchObject({
        eligible: false,
        reason: "EXPLICITLY_INELIGIBLE"
      });
    }
    expect(normalizeLogisticsMarketEligibility("Experimental market")).toMatchObject({
      eligible: false,
      sourceValue: "Experimental market",
      reason: "UNRECOGNIZED"
    });
    expect(normalizeLogisticsMarketEligibility("  ")).toMatchObject({ eligible: false, reason: "BLANK" });
  });

  it("ranks U.S. one-region and two-region options using weighted Haversine screening distance", () => {
    const result = runSupplyChainDesignThreePlScreening(screeningInputFixture());

    expect(result.totalDemand).toBe(1600);
    expect(result.recommendedOneRegion?.marketIds).toEqual(["US-DAL"]);
    expect(result.recommendedOneRegion?.marketNames).toEqual(["Dallas-Fort Worth"]);
    expect(result.recommendedTwoRegion?.marketIds).toEqual(["US-DAL", "US-LAX"]);
    expect(result.recommendedTwoRegion?.marketNames).toEqual(["Dallas-Fort Worth", "Southern California"]);
    expect(result.oneRegionRankings.slice(0, 5).map((row) => row.marketIds.join("+"))).toEqual([
      "US-DAL",
      "US-HOU",
      "US-ATL",
      "US-CHI",
      "US-LAX"
    ]);
    expect(result.twoRegionRankings.slice(0, 6).map((row) => row.marketIds.join("+"))).toEqual([
      "US-DAL+US-LAX",
      "US-HOU+US-LAX",
      "US-ATL+US-DAL",
      "US-ATL+US-HOU",
      "US-CHI+US-DAL",
      "US-CHI+US-HOU"
    ]);
    expect(result.oneRegionRankings[0].weightedAverageDistance).toBeCloseTo(537.0, 1);
    expect(result.twoRegionRankings[0].weightedAverageDistance).toBeCloseTo(364.4, 1);
    expect(result.twoRegionAllocations).toHaveLength(12);
    expect(result.twoRegionAllocations.map((row) => [row.destinationId, row.assignedMarketId, row.screeningDistance])).toEqual([
      ["D001", "US-DAL", 0.8],
      ["D002", "US-DAL", 225.2],
      ["D003", "US-DAL", 181.9],
      ["D004", "US-DAL", 252.4],
      ["D005", "US-DAL", 719.4],
      ["D006", "US-DAL", 961.1],
      ["D007", "US-DAL", 616.2],
      ["D008", "US-DAL", 928.3],
      ["D009", "US-LAX", 0.7],
      ["D010", "US-LAX", 357.1],
      ["D011", "US-LAX", 960.5],
      ["D012", "US-DAL", 805.5]
    ]);
    expect(result.coverageSummary.demandAssigned).toBe(1600);
    expect(result.coverageSummary.unassignedDemand).toBe(0);
    expect(result.combinationsEvaluated).toBe(10);
    expect(result.eligibleMarketCount).toBe(10);
    expect(result.benchmarkControlResults.every((control) => control.passed)).toBe(true);
  });

  it("keeps project-uploaded benchmark market mode unchanged", () => {
    const result = runSupplyChainDesignThreePlScreening(screeningInputFixture());

    expect(result.marketSourceMode).toBe("PROJECT_UPLOADED_MARKETS");
    expect(result.catalogueVersion).toBeNull();
    expect(result.recommendedOneRegion?.marketIds).toEqual(["US-DAL"]);
    expect(result.recommendedOneRegion?.weightedAverageDistance).toBeCloseTo(537.0, 1);
    expect(result.recommendedTwoRegion?.marketIds).toHaveLength(2);
    expect(result.recommendedTwoRegion?.weightedAverageDistance).toBeLessThan(
      result.recommendedOneRegion?.weightedAverageDistance ?? Number.POSITIVE_INFINITY
    );
    expect(result.combinationsEvaluated).toBe(10);
  });

  it("uses the Newl reference catalogue and persists location-discovery evidence", () => {
    const result = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({ demandCsv: screeningDemandCsvWithoutCoordinates(), demandMappings: demandFieldMappingsWithoutCoordinates() }),
      marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
      logisticsMarkets: null
    });

    expect(result.marketSourceMode).toBe("NEWL_REFERENCE_CATALOGUE");
    expect(result.catalogueVersion).toBe(NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION);
    expect(result.zipCentroidVersion).toBe(CENSUS_ZCTA_2025_COORDINATE_SOURCE);
    expect(result.eligibleMarketCount).toBe(NEWL_LOGISTICS_MARKET_CATALOGUE.length);
    expect(result.oneRegionRankings).toHaveLength(activeUsReferenceMarkets().length);
    expect(result.twoRegionRankings).toHaveLength((activeUsReferenceMarkets().length * (activeUsReferenceMarkets().length - 1)) / 2);
    expect(result.resolvedDemandCoordinates).toHaveLength(12);
    expect(result.resolvedDemandCoordinates.every((row) => row.source === CENSUS_ZCTA_2025_COORDINATE_SOURCE)).toBe(true);
    expect(result.weightedDemandCenter).toMatchObject({ demandWeight: 1600 });
    expect(result.shortlistedMarkets.some((row) => row.solutionType === "ONE_REGION" && row.marketId === "US-DAL")).toBe(true);
    expect(result.scoredCandidates.some((row) => row.solutionType === "ONE_REGION" && row.selected)).toBe(true);
    expect(result.scoredCandidates.some((row) => row.solutionType === "TWO_REGION" && row.selected)).toBe(true);
    expect(result.clusterCenters).toHaveLength(2);
    expect(result.clusterCenters.map((center) => center.demandWeight).every((weight) => weight > 0)).toBe(true);
    expect(result.clusterAssignments).toHaveLength(12);
    expect(result.recommendedOneRegion?.marketIds).toEqual(["US-DAL"]);
    expect(result.recommendedOneRegion?.weightedAverageDistance).toBeCloseTo(536.9, 1);
    expect(result.recommendedTwoRegion?.marketIds).toHaveLength(2);
    expect(result.recommendedTwoRegion?.weightedAverageDistance).toBeLessThan(
      result.recommendedOneRegion?.weightedAverageDistance ?? Number.POSITIVE_INFINITY
    );
  });

  it("resolves ZIP-only U.S. demand and falls back to a neutral ZIP display label", () => {
    const result = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({
        demandCsv: screeningZipOnlyDemandCsv(),
        demandMappings: demandZipOnlyFieldMappings()
      }),
      marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
      logisticsMarkets: null
    });

    expect(result.resolvedZipCount).toBe(3);
    expect(result.demandPointCount).toBe(3);
    expect(result.oneRegionAllocations[0]).toMatchObject({
      destinationId: "Z001",
      postalOrRegionCode: "10001",
      city: "ZIP 10001"
    });
  });

  it("normalizes ZIP+4 demand to the first five digits", () => {
    const result = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({
        demandCsv: [
          "Demand ID,Destination ZIP,Country,Annual Shipments",
          "Z001,10001-1234,United States,10"
        ].join("\n"),
        demandMappings: demandZipOnlyFieldMappings()
      }),
      marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
      logisticsMarkets: null
    });

    expect(result.resolvedDemandCoordinates).toEqual([
      expect.objectContaining({
        destinationId: "Z001",
        postalOrRegionCode: "10001",
        source: CENSUS_ZCTA_2025_COORDINATE_SOURCE
      })
    ]);
    expect(result.oneRegionAllocations[0].city).toBe("ZIP 10001");
  });

  it("uses uploaded coordinates before ZIP centroid lookup", () => {
    const result = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({
        demandCsv: [
          "Demand ID,Destination ZIP,Country,Latitude,Longitude,Annual Shipments",
          "Z001,10001,USA,32.7876,-96.7994,10"
        ].join("\n"),
        demandMappings: [
          ...demandZipOnlyFieldMappings(),
          ["latitude", "Latitude"],
          ["longitude", "Longitude"]
        ]
      }),
      marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
      logisticsMarkets: null
    });

    expect(result.resolvedDemandCoordinates).toEqual([
      expect.objectContaining({
        destinationId: "Z001",
        postalOrRegionCode: "10001",
        latitude: 32.7876,
        longitude: -96.7994,
        source: "USER_PROVIDED"
      })
    ]);
    expect(result.recommendedOneRegion?.marketIds).toEqual(["US-DAL"]);
    expect(result.oneRegionAllocations[0].city).toBe("ZIP 10001");
  });

  it.each([
    ["Northeast concentration", [["10001", 500], ["07001", 300], ["19103", 200]]],
    ["Southeast concentration", [["30303", 500], ["28202", 250], ["32801", 150]]],
    ["Texas concentration", [["75201", 400], ["77002", 300], ["78701", 200], ["78205", 100]]],
    ["Midwest concentration", [["60601", 400], ["46204", 250], ["43215", 200], ["48226", 150]]],
    ["Southern California concentration", [["90012", 500], ["92501", 300], ["92101", 100]]],
    ["Pacific Northwest concentration", [["98101", 400], ["97204", 300], ["98402", 200]]],
    ["Nationally distributed demand", [["10001", 150], ["30303", 150], ["75201", 150], ["60601", 150], ["90012", 150], ["98101", 150]]],
    ["East/west two-cluster demand", [["10001", 500], ["30303", 300], ["90012", 500], ["98101", 300]]]
  ])("returns the independently scored full-catalogue winner for %s", (_label, rows) => {
    const result = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({
        demandCsv: demandCsvFromZipWeights(rows),
        demandMappings: demandZipOnlyFieldMappings()
      }),
      marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
      logisticsMarkets: null
    });
    const expected = expectedOneRegionMarket(rows);
    const repeated = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({
        demandCsv: demandCsvFromZipWeights(rows),
        demandMappings: demandZipOnlyFieldMappings()
      }),
      marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
      logisticsMarkets: null
    });

    expect(result.recommendedOneRegion?.marketIds).toEqual([expected.marketId]);
    expect(result.recommendedOneRegion?.weightedAverageDistance).toBe(expected.weightedAverageDistance);
    expect(result.oneRegionRankings).toHaveLength(activeUsReferenceMarkets().length);
    expect(result.shortlistedMarkets.filter((row) => row.solutionType === "ONE_REGION")).toHaveLength(activeUsReferenceMarkets().length);
    expect(repeated.recommendedOneRegion?.marketIds).toEqual(result.recommendedOneRegion?.marketIds);
    expect(repeated.recommendedTwoRegion?.marketIds).toEqual(result.recommendedTwoRegion?.marketIds);
    expect(result.clusterCenters).toHaveLength(2);
  });

  it("excludes unresolved U.S. ZIPs without inventing coordinates", () => {
    const result = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({
        demandCsv: screeningDemandCsvWithoutCoordinates().replace("D012,60601,Chicago IL", "D012,99999,Chicago IL"),
        demandMappings: demandFieldMappingsWithoutCoordinates()
      }),
      marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
      logisticsMarkets: null
    });

    expect(result.unresolvedZips).toEqual([
      expect.objectContaining({ destinationId: "D012", postalOrRegionCode: "99999" })
    ]);
    expect(result.exceptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "ZIP_NOT_FOUND_IN_CENSUS_ZCTA_2025", destinationId: "D012" })])
    );
    expect(result.totalDemand).toBe(1520);
    expect(result.demandExcluded).toBe(80);
    expect(result.unresolvedZipCount).toBe(1);
    expect(result.malformedZipCount).toBe(0);
  });

  it("resolves 10,000 local Census ZCTA ZIP rows without external requests", () => {
    const records = getUsZipCentroidReferenceRecords();
    const leadingZero = records.find((row) => row.zipCode.startsWith("0"));
    expect(leadingZero).toBeTruthy();
    expect(getUsZipCentroidReferenceMetadata()).toMatchObject({
      sourceOrganization: "U.S. Census Bureau",
      sourceYear: 2025,
      generatedFileVersion: CENSUS_ZCTA_2025_COORDINATE_SOURCE
    });

    const validRows = Array.from({ length: 10000 }, (_, index) => {
      const zip = index === 0 && leadingZero ? leadingZero.zipCode : records[index % records.length].zipCode;
      const suppliedZip = index === 1 ? `${zip}-1234` : zip;
      return `L${String(index + 1).padStart(5, "0")},${suppliedZip},Large row ${index + 1},US,ST,1`;
    });
    const demandCsv = [
      "Demand ID,Destination ZIP,Destination Label,Country,State,Annual Shipments",
      ...validRows,
      "BAD01,BADZIP,Malformed ZIP,US,ST,5",
      "UNK01,00000,Unknown ZIP,US,ST,7"
    ].join("\n");
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => {
      throw new Error("Screening calculation must not call fetch.");
    });
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      const startedAt = performance.now();
      const first = runSupplyChainDesignThreePlScreening({
        ...screeningInputFixture({
          demandCsv,
          demandMappings: demandFieldMappingsWithoutCoordinates()
        }),
        marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
        logisticsMarkets: null
      });
      const elapsedMs = performance.now() - startedAt;
      const second = runSupplyChainDesignThreePlScreening({
        ...screeningInputFixture({
          demandCsv,
          demandMappings: demandFieldMappingsWithoutCoordinates()
        }),
        marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
        logisticsMarkets: null
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(elapsedMs).toBeLessThan(30000);
      expect(first.resolvedZipCount).toBe(10000);
      expect(first.unresolvedZipCount).toBe(1);
      expect(first.malformedZipCount).toBe(1);
      expect(first.totalDemand).toBe(10000);
      expect(first.demandExcluded).toBe(12);
      expect(first.coverageSummary.demandAssigned + first.coverageSummary.unassignedDemand).toBe(first.totalDemand);
      expect(first.resolvedDemandCoordinates[0].postalOrRegionCode).toMatch(/^0\d{4}$/);
      expect(first.resolvedDemandCoordinates[1].postalOrRegionCode).toMatch(/^\d{5}$/);
      expect(first.oneRegionRankings[0].weightedAverageDistance).toBeGreaterThan(0);
      expect(first.twoRegionRankings.length).toBeGreaterThan(0);
      expect(second.recommendedOneRegion?.marketIds).toEqual(first.recommendedOneRegion?.marketIds);
      expect(second.recommendedTwoRegion?.marketIds).toEqual(first.recommendedTwoRegion?.marketIds);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses deterministic tie evidence for equal-distance practical markets", () => {
    const tieMarkets = [
      "\uFEFFMarket ID,Market Name,Country,State/Province,Latitude,Longitude,Market Type",
      "US-AAA,Alpha Market,US,TX,32.7876,-96.7994,Major logistics market",
      "US-BBB,Beta Market,US,TX,32.7876,-96.7994,Major logistics market"
    ].join("\n");

    const result = runSupplyChainDesignThreePlScreening(
      screeningInputFixture({
        demandCsv: [
          "Demand ID,Destination ZIP,Destination Label,Country,State,Latitude,Longitude,Annual Shipments",
          "D001,75201,Dallas TX,US,TX,32.7876,-96.7994,10"
        ].join("\n"),
        marketCsv: tieMarkets
      })
    );

    expect(result.recommendedOneRegion?.marketIds).toEqual(["US-AAA"]);
    expect(result.tieEvidence).toEqual([
      expect.objectContaining({
        solutionType: "ONE_REGION",
        objectiveValue: 0,
        tiedMarketIds: ["US-AAA", "US-BBB"]
      })
    ]);
  });

  it("records reviewed market tiers and explicit overlapping-market choices", () => {
    expect(NEWL_LOGISTICS_MARKET_CATALOGUE).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ marketId: "US-LAX", tier: "PRIMARY", marketName: "Southern California" }),
        expect.objectContaining({ marketId: "US-IE", tier: "PRIMARY", marketName: "Inland Empire" }),
        expect.objectContaining({ marketId: "US-NJ", tier: "PRIMARY", marketName: "New York / Northern New Jersey" }),
        expect.objectContaining({ marketId: "US-SEA", tier: "PRIMARY", marketName: "Seattle / Tacoma" }),
        expect.objectContaining({ marketId: "CA-EDM", tier: "CANADA_PROVINCE_LEVEL" })
      ])
    );
    expect(NEWL_LOGISTICS_MARKET_CATALOGUE.every((market) => market.rationale.length > 0)).toBe(true);
  });

  it("includes the targeted added U.S. practical warehouse markets as active unique catalogue entries", () => {
    const addedMarkets = [
      ["US-GEG", "Spokane / Inland Northwest", "Spokane", "WA", 47.6588, -117.426, "SECONDARY"],
      ["US-BOI", "Boise", "Boise", "ID", 43.615, -116.2023, "SECONDARY"],
      ["US-RNO", "Reno", "Reno", "NV", 39.5296, -119.8138, "SECONDARY"],
      ["US-ABQ", "Albuquerque", "Albuquerque", "NM", 35.0844, -106.6504, "SECONDARY"],
      ["US-MSY", "New Orleans", "New Orleans", "LA", 29.9511, -90.0715, "SECONDARY"],
      ["US-BUF", "Buffalo", "Buffalo", "NY", 42.8864, -78.8784, "SECONDARY"],
      ["US-PIT", "Pittsburgh", "Pittsburgh", "PA", 40.4406, -79.9959, "SECONDARY"],
      ["US-ALB", "Albany", "Albany", "NY", 42.6526, -73.7562, "SECONDARY"]
    ] as const;
    const ids = NEWL_LOGISTICS_MARKET_CATALOGUE.map((market) => market.marketId);
    const labelCoordinateKeys = NEWL_LOGISTICS_MARKET_CATALOGUE.map((market) => `${market.marketName}:${market.latitude}:${market.longitude}`);

    expect(NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION).toBe("NEWL_LOGISTICS_MARKETS_V2");
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labelCoordinateKeys).size).toBe(labelCoordinateKeys.length);
    for (const [marketId, marketName, representativeMajorCity, stateProvince, latitude, longitude, tier] of addedMarkets) {
      expect(NEWL_LOGISTICS_MARKET_CATALOGUE).toEqual(expect.arrayContaining([
        expect.objectContaining({
          marketId,
          marketName,
          representativeMajorCity,
          stateProvince,
          country: "US",
          latitude,
          longitude,
          activeEligible: true,
          tier,
          marketType: "Major logistics market",
          catalogueVersion: NEWL_LOGISTICS_MARKET_CATALOGUE_VERSION
        })
      ]));
      expect(latitude).toBeGreaterThan(24);
      expect(latitude).toBeLessThan(50);
      expect(longitude).toBeGreaterThan(-125);
      expect(longitude).toBeLessThan(-66);
    }
  });

  it("selects the nearest practical warehouse markets from the expanded shared catalogue", () => {
    const cases = [
      ["99201", "Spokane WA", "WA", "Spokane / Inland Northwest"],
      ["83702", "Boise ID", "ID", "Boise"],
      ["89501", "Reno NV", "NV", "Reno"],
      ["87102", "Albuquerque NM", "NM", "Albuquerque"],
      ["70112", "New Orleans LA", "LA", "New Orleans"],
      ["14202", "Buffalo NY", "NY", "Buffalo"],
      ["15222", "Pittsburgh PA", "PA", "Pittsburgh"],
      ["12207", "Albany NY", "NY", "Albany"],
      ["98101", "Seattle WA", "WA", "Seattle / Tacoma"],
      ["97204", "Portland OR", "OR", "Portland"],
      ["95814", "Sacramento CA", "CA", "Sacramento"],
      ["10001", "New York NY", "NY", "New York / Northern New Jersey"],
      ["19103", "Philadelphia PA", "PA", "Philadelphia / South Jersey"]
    ] as const;

    for (const [zip, label, state, expectedMarket] of cases) {
      const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
        maxRegions: 1,
        countryScope: "US",
        shipmentsCsv: [
          locationStrategyShipmentsHeader(),
          `Aggregated Activity,NEAR-${zip},${zip},${label},US,${state},10,1,100,lb,1,10,USD,LTL`
        ].join("\n")
      }));

      expect(result.recommendedSolution.regions[0]).toEqual(expect.objectContaining({
        recommendedMarketLabel: expectedMarket,
        labelSource: "NEWL_LOGISTICS_MARKET_CATALOGUE"
      }));
    }

    expect(selectNearestWarehouseLocationStrategyPracticalMarket(
      { latitude: 45.911095, longitude: -115.316436 },
      "ALL"
    )).toEqual(expect.objectContaining({
      label: "Spokane / Inland Northwest",
      marketId: "US-GEG",
      distanceMiles: expect.any(Number)
    }));
    expect(selectNearestWarehouseLocationStrategyPracticalMarket(
      { latitude: 45.911095, longitude: -115.316436 },
      "CA"
    )).toEqual(expect.objectContaining({ label: "Calgary", marketId: "CA-CGY" }));
    expect(selectNearestWarehouseLocationStrategyPracticalMarket(
      { latitude: 38.91304, longitude: -83.815829 },
      "ALL"
    )).toEqual(expect.objectContaining({
      label: "Cincinnati",
      marketId: "US-CVG",
      country: "US",
      stateProvince: "OH",
      distanceMiles: 39.6
    }));
    expect(selectNearestWarehouseLocationStrategyPracticalMarket(
      { latitude: 38.91304, longitude: -83.815829 },
      "US"
    )).toEqual(expect.objectContaining({ label: "Cincinnati", marketId: "US-CVG" }));
    expect(selectNearestWarehouseLocationStrategyPracticalMarket(
      { latitude: 38.91304, longitude: -83.815829 },
      "CA"
    )).toEqual(expect.objectContaining({ label: "Toronto / Southern Ontario", marketId: "CA-TOR" }));
    expect(selectNearestWarehouseLocationStrategyPracticalMarket(
      { latitude: 47.6062, longitude: -122.3321 },
      "US"
    )).toEqual(expect.objectContaining({ label: "Seattle / Tacoma", marketId: "US-SEA" }));
  });

  it("exposes the expanded shared catalogue to 3PL Location Screening without failing", () => {
    const result = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({ demandCsv: screeningDemandCsvWithoutCoordinates(), demandMappings: demandFieldMappingsWithoutCoordinates() }),
      marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
      logisticsMarkets: null
    });
    const addedMarketIds = ["US-GEG", "US-BOI", "US-RNO", "US-ABQ", "US-MSY", "US-BUF", "US-PIT", "US-ALB"];
    const activeReferenceMarketIds = activeUsReferenceMarkets().map((market) => market.marketId);

    expect(result.marketSourceMode).toBe("NEWL_REFERENCE_CATALOGUE");
    expect(result.catalogueVersion).toBe("NEWL_LOGISTICS_MARKETS_V2");
    expect(result.eligibleMarketCount).toBe(NEWL_LOGISTICS_MARKET_CATALOGUE.length);
    expect(activeReferenceMarketIds).toEqual(expect.arrayContaining(addedMarketIds));
    expect(result.oneRegionRankings.length).toBe(activeUsReferenceMarkets().length);
    expect(result.twoRegionRankings.length).toBe((activeUsReferenceMarkets().length * (activeUsReferenceMarkets().length - 1)) / 2);
  });

  it("renders the Warehouse Location Strategy recommendation areas without the old screening placeholder text", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const formSource = readFileSync(
      "src/modules/supply-chain-design/components/warehouse-location-strategy-form.tsx",
      "utf8"
    );
    const viewerSource = readFileSync(
      "src/modules/supply-chain-design/components/warehouse-location-strategy-solution-viewer.tsx",
      "utf8"
    );
    const mapSource = readFileSync(
      "src/modules/supply-chain-design/components/warehouse-location-strategy-map.tsx",
      "utf8"
    );

    expect(pageSource).toContain("Recommended Strategy");
    expect(viewerSource).toContain("Recommended Warehouse Search Regions");
    expect(pageSource).toContain("Download Location Strategy Assignments");
    expect(pageSource).toContain("initialSettings={displayedRun?.inputReferences");
    expect(formSource).toContain("initialSettings?.shipmentsMappingId");
    expect(formSource).toContain("CAD to USD conversion rate");
    expect(viewerSource).toContain("window.history.replaceState");
    expect(viewerSource).toContain("if (nextSolutionId === solutionId) return;");
    expect(mapSource).not.toContain("window.location.assign");
    expect(pageSource).not.toContain("Demand was excluded from this recommendation.");
  });

  it("uses the reference Canadian province-market mapping in catalogue mode", () => {
    const result = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({
        demandCsv: screeningCanadaDemandCsv(),
        demandMappings: canadaDemandFieldMappings()
      }),
      countryScope: "CA",
      marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
      logisticsMarkets: null,
      canadaProvinceMarketMap: null
    });

    expect(result.canadaProvinceAllocations.map((row) => [row.provinceCode, row.approvedMarketId])).toEqual([
      ["AB", "CA-CGY"],
      ["QC", "CA-MTL"],
      ["ON", "CA-TOR"],
      ["BC", "CA-VAN"],
      ["MB", "CA-WPG"]
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("uses the existing page table helper for 3PL screening result tables", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const result = runSupplyChainDesignThreePlScreening(screeningInputFixture());
    const firstRankingRow = [
      String(result.oneRegionRankings[0].rank),
      result.oneRegionRankings[0].marketNames.join(" + "),
      result.oneRegionRankings[0].majorCities.join(" + "),
      result.oneRegionRankings[0].stateProvinces.join(" + "),
      result.oneRegionRankings[0].assignedDemandByMarket.map((item) => `${item.marketId}: ${item.assignedDemand}`).join("; "),
      `${result.oneRegionRankings[0].weightedAverageDistance} miles`,
      `${result.oneRegionRankings[0].differenceFromRecommended} miles`
    ];

    expect(pageSource).not.toContain("<SimpleTable");
    expect(pageSource).toContain("<AnalysisTable");
    expect(firstRankingRow).toEqual([
      "1",
      "Dallas-Fort Worth",
      "Dallas-Fort Worth",
      "TX",
      "US-DAL: 1600",
      "537 miles",
      "0 miles"
    ]);
  });

  it("traces actual benchmark logistics market mappings before ranking", () => {
    const diagnostics = traceSupplyChainDesignLogisticsMarkets(screeningInputFixture().logisticsMarkets, "US");

    expect(diagnostics.sourceFileName).toBe("markets.csv");
    expect(diagnostics.mappingId).toBe("markets.csv-mapping");
    expect(diagnostics.rowsParsed).toBe(10);
    expect(diagnostics.eligibleBeforeCountryFiltering).toBe(10);
    expect(diagnostics.matchingSelectedCountry).toBe(5);
    expect(diagnostics.excludedForUnrecognizedEligibility).toBe(0);
    expect(diagnostics.excludedForCountryMismatch).toBe(5);
    expect(diagnostics.eligibleMarketIdsForSelectedCountry).toEqual(["US-DAL", "US-HOU", "US-ATL", "US-CHI", "US-LAX"]);
    expect(diagnostics.rows[0]).toMatchObject({
      marketId: "US-DAL",
      rawEligibilityValue: "Major logistics market",
      rawCountryValue: "US",
      normalizedCountryValue: "US",
      includedBeforeCountryFilter: true,
      includedForSelectedCountry: true
    });
    expect(diagnostics.rows[5]).toMatchObject({
      marketId: "CA-TOR",
      rawEligibilityValue: "Province-level Canadian market",
      rawCountryValue: "CA",
      normalizedCountryValue: "CA",
      includedBeforeCountryFilter: true,
      includedForSelectedCountry: false
    });
  });

  it("includes U.S. major logistics markets and excludes Canadian markets from U.S.-only ranking by country scope", () => {
    const result = runSupplyChainDesignThreePlScreening(screeningInputFixture());

    expect(result.oneRegionRankings.map((row) => row.marketIds[0])).toEqual([
      "US-DAL",
      "US-HOU",
      "US-ATL",
      "US-CHI",
      "US-LAX"
    ]);
    expect(result.twoRegionRankings).toHaveLength(10);
    expect(result.oneRegionRankings.flatMap((row) => row.marketIds).some((marketId) => marketId.startsWith("CA-"))).toBe(false);
  });

  it("keeps province-level Canadian markets eligible for Canadian province mapping", () => {
    const result = runSupplyChainDesignThreePlScreening(
      screeningInputFixture({
        demandCsv: screeningCanadaDemandCsv(),
        demandMappings: canadaDemandFieldMappings()
      })
    );

    expect(result.eligibleMarketCount).toBe(10);
    expect(result.canadaProvinceAllocations.map((row) => row.approvedMarketId)).toEqual([
      "CA-CGY",
      "CA-MTL",
      "CA-TOR",
      "CA-VAN",
      "CA-WPG"
    ]);
  });

  it("uses market ID as a deterministic tie-break", () => {
    const result = runSupplyChainDesignThreePlScreening(
      screeningInputFixture({
        demandCsv: [
          "Demand ID,Destination ZIP,Destination Label,Country,State,Latitude,Longitude,Annual Shipments,Annual Pallets,Shipment Profile ID,Required Service",
          "D001,00000,Tie TX,US,TX,32,-96,10,20,LTL-2P,3 days"
        ].join("\n"),
        marketCsv: [
          "Market ID,Market Name,Country,State/Province,Latitude,Longitude,Market Type",
          "BBB,Market B,US,TX,32,-95,Major logistics market",
          "AAA,Market A,US,TX,32,-97,Major logistics market"
        ].join("\n")
      })
    );

    expect(result.recommendedOneRegion?.marketIds).toEqual(["AAA"]);
    expect(result.oneRegionAllocations[0].assignedMarketId).toBe("AAA");
  });

  it("uses market_name as the displayed major-city label when major_city is not mapped", () => {
    const result = runSupplyChainDesignThreePlScreening(screeningInputFixture());

    expect(result.recommendedOneRegion?.majorCities).toEqual(["Dallas-Fort Worth"]);
    expect(result.oneRegionRankings[1].majorCities).toEqual(["Houston"]);
  });

  it("uses a separate mapped major_city value when one exists", () => {
    const result = runSupplyChainDesignThreePlScreening({
      ...screeningInputFixture({
        marketCsv: [
          "Market ID,Market Name,Major City,Country,State/Province,Latitude,Longitude,Market Type",
          "US-DAL,Dallas-Fort Worth Region,Dallas,US,TX,32.7767,-96.797,Major logistics market",
          "US-HOU,Houston Region,Houston,US,TX,29.7604,-95.3698,Major logistics market"
        ].join("\n")
      }),
      logisticsMarkets: screeningMappedFile(
        "markets.csv",
        [
          "Market ID,Market Name,Major City,Country,State/Province,Latitude,Longitude,Market Type",
          "US-DAL,Dallas-Fort Worth Region,Dallas,US,TX,32.7767,-96.797,Major logistics market",
          "US-HOU,Houston Region,Houston,US,TX,29.7604,-95.3698,Major logistics market"
        ].join("\n"),
        [...marketFieldMappings(), ["major_city", "Major City"]]
      )
    });

    expect(result.recommendedOneRegion?.marketNames).toEqual(["Dallas-Fort Worth Region"]);
    expect(result.recommendedOneRegion?.majorCities).toEqual(["Dallas"]);
  });

  it("aggregates Canadian demand through the approved province-market map", () => {
    const result = runSupplyChainDesignThreePlScreening(
      screeningInputFixture({
        demandCsv: screeningCanadaDemandCsv(),
        demandMappings: canadaDemandFieldMappings()
      })
    );

    expect(result.canadaProvinceAllocations).toEqual([
      { province: "AB", provinceCode: "AB", approvedMarketId: "CA-CGY", approvedMajorCity: "Calgary", annualShipmentCount: 220 },
      { province: "QC", provinceCode: "QC", approvedMarketId: "CA-MTL", approvedMajorCity: "Montreal", annualShipmentCount: 260 },
      { province: "ON", provinceCode: "ON", approvedMarketId: "CA-TOR", approvedMajorCity: "Toronto", annualShipmentCount: 500 },
      { province: "BC", provinceCode: "BC", approvedMarketId: "CA-VAN", approvedMajorCity: "Vancouver", annualShipmentCount: 180 },
      { province: "MB", provinceCode: "MB", approvedMarketId: "CA-WPG", approvedMajorCity: "Winnipeg", annualShipmentCount: 90 }
    ]);
  });

  it("blocks missing annual shipments from the benchmark defect manifest", () => {
    expect(() =>
      runSupplyChainDesignThreePlScreening(
        screeningInputFixture({
          demandCsv: screeningDemandCsv().replace("D004,78205,San Antonio TX,US,TX,29.4241,-98.4936,120,", "D004,78205,San Antonio TX,US,TX,29.4241,-98.4936,,")
        })
      )
    ).toThrow("SCDS_3PL_VOLUME_MISSING");
  });

  it("blocks duplicate market IDs from the benchmark defect manifest", () => {
    expect(() =>
      runSupplyChainDesignThreePlScreening({
        ...screeningInputFixture(),
        logisticsMarkets: screeningMappedFile("markets.csv", `${screeningMarketCsv()}\nUS-DAL,Dallas duplicate,US,TX,32.7767,-96.797,Major logistics market`, marketFieldMappings())
      })
    ).toThrow("SCDS_3PL_DUPLICATE_MARKET");
  });

  it("flags invalid U.S. ZIP rows from the benchmark defect manifest", () => {
    const result = runSupplyChainDesignThreePlScreening(
      screeningInputFixture({
        demandCsv: screeningDemandCsv().replace("D009,90012,", "D009,BADZIP,")
      })
    );

    expect(result.exceptions).toEqual([
      {
        type: "MALFORMED_ZIP",
        destinationId: "D009",
        message: "D009: ZIP code is malformed; use five digits or ZIP+4."
      }
    ]);
    expect(result.totalDemand).toBe(1450);
    expect(result.malformedZipCount).toBe(1);
  });

  it("excludes inactive or ineligible markets", () => {
    const result = runSupplyChainDesignThreePlScreening(
      screeningInputFixture({
        marketCsv: screeningMarketCsv().replace(
          "US-DAL,Dallas-Fort Worth,US,TX,32.7767,-96.797,Major logistics market",
          "US-DAL,Dallas-Fort Worth,US,TX,32.7767,-96.797,Inactive"
        )
      })
    );

    expect(result.exceptions).toContainEqual({
      type: "INACTIVE_MARKET",
      marketId: "US-DAL",
      message: "US-DAL is inactive or ineligible: explicitly ineligible."
    });
    expect(result.oneRegionRankings[0].marketIds).toEqual(["US-HOU"]);
  });

  it("excludes and reports explicit false/no/inactive/ineligible/0 market values", () => {
    const csv = [
      "Market ID,Market Name,Country,State/Province,Latitude,Longitude,Market Type",
      "T-TRUE,True Market,US,TX,32,-96,true",
      "T-YES,Yes Market,US,TX,33,-96,yes",
      "T-ACTIVE,Active Market,US,TX,34,-96,active",
      "T-ELIGIBLE,Eligible Market,US,TX,35,-96,eligible",
      "T-ONE,One Market,US,TX,36,-96,1",
      "F-FALSE,False Market,US,TX,37,-96,false",
      "F-NO,No Market,US,TX,38,-96,no",
      "F-INACTIVE,Inactive Market,US,TX,39,-96,inactive",
      "F-INELIGIBLE,Ineligible Market,US,TX,40,-96,ineligible",
      "F-ZERO,Zero Market,US,TX,41,-96,0"
    ].join("\n");
    const result = runSupplyChainDesignThreePlScreening(screeningInputFixture({ marketCsv: csv }));

    expect(result.oneRegionRankings.map((row) => row.marketIds[0])).toEqual([
      "T-TRUE",
      "T-YES",
      "T-ACTIVE",
      "T-ELIGIBLE",
      "T-ONE"
    ]);
    expect(result.exceptions.map((exception) => exception.marketId)).toEqual([
      "F-FALSE",
      "F-NO",
      "F-INACTIVE",
      "F-INELIGIBLE",
      "F-ZERO"
    ]);
  });

  it("excludes and reports unknown or blank market eligibility values", () => {
    const result = runSupplyChainDesignThreePlScreening(
      screeningInputFixture({
        marketCsv: [
          "Market ID,Market Name,Country,State/Province,Latitude,Longitude,Market Type",
          "US-DAL,Dallas-Fort Worth,US,TX,32.7767,-96.797,Major logistics market",
          "US-UNK,Unknown Market,US,TX,32,-96,Experimental market",
          "US-BLK,Blank Market,US,TX,33,-96,"
        ].join("\n")
      })
    );

    expect(result.oneRegionRankings.map((row) => row.marketIds[0])).toEqual(["US-DAL"]);
    expect(result.exceptions).toEqual([
      {
        type: "INACTIVE_MARKET",
        marketId: "US-UNK",
        message: 'US-UNK has unrecognized eligibility value "Experimental market".'
      },
      {
        type: "INACTIVE_MARKET",
        marketId: "US-BLK",
        message: "US-BLK is inactive or ineligible: blank."
      }
    ]);
  });

  it("returns a useful zero-market diagnostic for invalid eligibility input", () => {
    expect(() =>
      runSupplyChainDesignThreePlScreening(
        screeningInputFixture({
          marketCsv: [
            "\uFEFFMarket ID,Market Name,Country,State/Province,Latitude,Longitude,Market Type",
            "US-UNK,Unknown Market,US,TX,32,-96,Experimental market",
            "US-BLK,Blank Market,US,TX,33,-96,"
          ].join("\n")
        })
      )
    ).toThrow(
      'No active eligible logistics markets were available. Source file: markets.csv. Mapping ID: markets.csv-mapping. Rows parsed: 2. Rows eligible before country filtering: 0. Rows matching selected country: 0. Rows excluded for unrecognized eligibility: 1. Rows excluded for country mismatch: 0. Examples: US-UNK: Unrecognized eligibility value "Experimental market".; US-BLK: Eligibility value is blank..'
    );
  });

  it("treats valid U.S. demand and market mappings as enough to show the run form", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      tenantId: adminContext.tenantId,
      name: "3PL screening",
      description: null,
      status: SupplyChainDesignProjectStatus.DRAFT,
      createdAt,
      updatedAt,
      createdBy: null,
      files: [
        fileSummaryFixture("demand-file", "demand_points_us.csv", "hash-demand", [
          {
            id: "demand-mapping",
            tableType: "DEMAND_POINTS",
            updatedAt,
            fieldMappings: demandFieldMappings().map(([standardField, sourceColumn]) => ({
              standardField,
              sourceColumn,
              requirement: "REQUIRED"
            }))
          }
        ]),
        fileSummaryFixture("market-file", "logistics_markets.csv", "hash-market", [
          {
            id: "market-mapping",
            tableType: "LOGISTICS_MARKETS",
            updatedAt,
            fieldMappings: marketFieldMappings().map(([standardField, sourceColumn]) => ({
              standardField,
              sourceColumn,
              requirement: "REQUIRED"
            }))
          }
        ])
      ],
      modelRuns: [],
      scenarios: [],
      screeningRuns: []
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      threePlScreening: {
        canRun: true,
        missingInputs: [],
        inputSelection: {
          demandPoints: { fileName: "demand_points_us.csv", mappingId: "demand-mapping" },
          logisticsMarkets: { fileName: "logistics_markets.csv", mappingId: "market-mapping" },
          canadaProvinceMarketMap: null
        }
      }
    });
  });

  it("treats ZIP-only U.S. demand mappings as enough to show the reference-catalogue run form", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      tenantId: adminContext.tenantId,
      name: "3PL screening",
      description: null,
      status: SupplyChainDesignProjectStatus.DRAFT,
      createdAt,
      updatedAt,
      createdBy: null,
      files: [
        fileSummaryFixture("demand-file", "zip_only_demand.csv", "hash-demand", [
          {
            id: "demand-mapping",
            tableType: "DEMAND_POINTS",
            updatedAt,
            fieldMappings: demandZipOnlyFieldMappings().map(([standardField, sourceColumn]) => ({
              standardField,
              sourceColumn,
              requirement: "REQUIRED"
            }))
          }
        ])
      ],
      modelRuns: [],
      scenarios: [],
      screeningRuns: []
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      threePlScreening: {
        canRun: true,
        missingInputs: [],
        inputSelection: {
          demandPoints: { fileName: "zip_only_demand.csv", mappingId: "demand-mapping" },
          logisticsMarkets: null,
          canadaProvinceMarketMap: null,
          marketSourceMode: "NEWL_REFERENCE_CATALOGUE"
        }
      }
    });
  });

  it("requires the Canada map only when a Canadian screening study is submitted", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);

    await expect(
      runSupplyChainDesignThreePlScreeningAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          studyName: "Canada screening",
          studyType: "FIND_BEST_WAREHOUSE_REGION",
          countryScope: "CA",
          weightingMeasure: "annual_shipment_count",
          maximumRegionsToCompare: "1",
          marketSourceMode: "PROJECT_UPLOADED_MARKETS",
          demandPointsMappingId: "demand-mapping",
          logisticsMarketsMappingId: "market-mapping"
        })
      )
    ).resolves.toEqual({
      ok: false,
      message: "Select a CANADA_PROVINCE_MARKET_MAP mapping before running a Canadian screening study."
    });

    expect(prismaMock.prisma.supplyChainDesignScreeningRun.create).not.toHaveBeenCalled();
  });

  it("requires a province mapping for Canadian demand studies", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      mappings: [
        actionMappingFixture("demand-mapping", "DEMAND_POINTS", "demand.csv", screeningZipOnlyDemandCsv(), demandZipOnlyFieldMappings())
      ]
    });

    await expect(
      runSupplyChainDesignThreePlScreeningAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          studyName: "Canada screening",
          studyType: "FIND_BEST_WAREHOUSE_REGION",
          countryScope: "CA",
          weightingMeasure: "annual_shipment_count",
          maximumRegionsToCompare: "1",
          marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
          demandPointsMappingId: "demand-mapping"
        })
      )
    ).resolves.toEqual({
      ok: false,
      message: "Map state_province to the Canadian province field before running a Canadian screening study."
    });

    expect(prismaMock.prisma.supplyChainDesignScreeningRun.create).not.toHaveBeenCalled();
  });

  it("runs 3PL screening action with ZIP-only U.S. demand and no city mapping", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      mappings: [
        actionMappingFixture("demand-mapping", "DEMAND_POINTS", "demand.csv", screeningZipOnlyDemandCsv(), demandZipOnlyFieldMappings())
      ]
    });
    prismaMock.prisma.supplyChainDesignScreeningRun.create.mockResolvedValueOnce({ id: "screening-run-zip-only" });
    prismaMock.prisma.supplyChainDesignScreeningRun.findUnique.mockResolvedValueOnce({ id: "screening-run-zip-only" });

    const result = await runSupplyChainDesignThreePlScreeningAction(
      { ok: false, message: "" },
      form({
        projectId: "project-1",
        studyName: "ZIP-only U.S. screening",
        studyType: "FIND_BEST_WAREHOUSE_REGION",
        countryScope: "US",
        weightingMeasure: "annual_shipment_count",
        maximumRegionsToCompare: "2",
        marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
        demandPointsMappingId: "demand-mapping"
      })
    );

    expect(result).toEqual({ ok: true, message: "3PL location screening completed." });
    expect(prismaMock.prisma.supplyChainDesignScreeningRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          inputReferences: expect.objectContaining({
            marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
            logisticsMarkets: null
          }),
          resultSummary: expect.objectContaining({
            resolvedZipCount: 3,
            malformedZipCount: 0,
            unresolvedZipCount: 0
          })
        })
      })
    );
  });

  it("persists a tenant-scoped successful screening run through the action", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      mappings: [
        actionMappingFixture("demand-mapping", "DEMAND_POINTS", "demand.csv", screeningDemandCsv(), [
          ["destination_id", "Demand ID"],
          ["postal_or_region_code", "Destination ZIP"],
          ["city", "Destination Label"],
          ["state_province", "State"],
          ["country", "Country"],
          ["latitude", "Latitude"],
          ["longitude", "Longitude"],
          ["annual_shipment_count", "Annual Shipments"]
        ]),
        actionMappingFixture("market-mapping", "LOGISTICS_MARKETS", "markets.csv", screeningMarketCsv(), [
          ["market_id", "Market ID"],
          ["market_name", "Market Name"],
          ["state_province", "State/Province"],
          ["country", "Country"],
          ["latitude", "Latitude"],
          ["longitude", "Longitude"],
          ["active_eligible", "Market Type"]
        ])
      ]
    });
    prismaMock.prisma.supplyChainDesignScreeningRun.create.mockResolvedValue({ id: "screening-run-1" });
    prismaMock.prisma.supplyChainDesignScreeningRun.findUnique.mockResolvedValue({ id: "screening-run-1" });
    prismaMock.prisma.supplyChainDesignScreeningRun.create.mockClear();
    prismaMock.prisma.supplyChainDesignScreeningRun.findUnique.mockClear();

    const result = await runSupplyChainDesignThreePlScreeningAction(
      { ok: false, message: "" },
      form({
        projectId: "project-1",
        studyName: "Benchmark",
        studyType: "FIND_BEST_WAREHOUSE_REGION",
        countryScope: "US",
        weightingMeasure: "annual_shipment_count",
        maximumRegionsToCompare: "2",
        marketSourceMode: "PROJECT_UPLOADED_MARKETS",
        demandPointsMappingId: "demand-mapping",
        logisticsMarketsMappingId: "market-mapping"
      })
    );

    expect(result).toEqual({ ok: true, message: "3PL location screening completed." });
    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_id: { tenantId: "tenant-1", id: "project-1" } }
      })
    );
    expect(prismaMock.prisma.supplyChainDesignScreeningRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          projectId: "project-1",
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          inputReferences: expect.objectContaining({
            demandPoints: expect.objectContaining({ fileName: "demand.csv", mappingId: "demand-mapping" }),
            logisticsMarkets: expect.objectContaining({ fileName: "markets.csv", mappingId: "market-mapping" }),
            marketSourceMode: "PROJECT_UPLOADED_MARKETS"
          }),
          resultSummary: expect.objectContaining({
            recommendedOneRegion: expect.objectContaining({ marketIds: ["US-DAL"], weightedAverageDistance: 537 }),
            recommendedTwoRegion: expect.objectContaining({ marketIds: ["US-DAL", "US-LAX"], weightedAverageDistance: 364.4 }),
            combinationsEvaluated: 10
          }),
          createdByUserId: "user-1"
        })
      })
    );
    expect(prismaMock.prisma.supplyChainDesignScreeningRun.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.prisma.supplyChainDesignScreeningRun.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_id: {
          tenantId: "tenant-1",
          id: "screening-run-1"
        }
      },
      select: { id: true }
    });
    expect(revalidatePath).toHaveBeenCalledWith("/supply-chain-design/project-1");
  });

  it("filters Network Design rate requests to selected candidate checkboxes", async () => {
    const preparationResult = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture());
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      ltlRatePreparationRuns: [
        {
          id: "prep-run-1",
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          createdAt: new Date("2026-07-30T20:00:00.000Z"),
          resultSummary: preparationResult
        }
      ]
    });
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValueOnce({ id: "ltl-access" });
    prismaMock.prisma.integrationCredential.findMany.mockResolvedValueOnce(sevenLAccountRecordsFixture());
    prismaMock.prisma.automationJobRun.create.mockResolvedValueOnce({ id: "batch-selected" });

    await createSupplyChainDesignLtlRateBatch(context(PlatformRole.ADMIN), "project-1", "prep-run-1", {
      scenarioSelections: [{ candidateFacilityId: "ATL-01", scenarioType: "REPLACE", comparedCurrentFacilityIds: [] }],
      currentFacilities: [{ facilityId: "DFW-3PL", facilityName: "Dallas Current 3PL", annualFacilityCost: 250000 }],
      candidateFacilities: [{ facilityId: "ATL-01", facilityName: "Atlanta Proposed Warehouse", annualFixedCost: 300000 }]
    });

    expect(prismaMock.prisma.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: expect.objectContaining({
          requests: expect.arrayContaining([expect.objectContaining({ candidateFacilityId: "ATL-01" })])
        })
      })
    });
    const createdInput = prismaMock.prisma.automationJobRun.create.mock.calls.at(-1)?.[0].data.input;
    expect(createdInput.carrierHashes).toEqual(["carrier-a", "frontline-hash"]);
    expect(createdInput.requests).toHaveLength(2);
    expect(createdInput.requests.every((request: { candidateFacilityId: string }) => request.candidateFacilityId === "ATL-01")).toBe(true);
  });

  it("prepares candidate warehouse postal codes as actual 7L request origins", () => {
    const result = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({ candidateCsv: ltlFourCandidateCsv() })
    );
    const originsByCandidate = new Map(
      result.preparedRequests
        .filter((request) => request.normalizedRequest)
        .map((request) => [
          request.candidateFacilityId,
          preflightSevenLQuoteRequest(request.normalizedRequest!).request.originZipcode
        ])
    );

    expect(originsByCandidate.get("ATL-01")).toBe("30303");
    expect(originsByCandidate.get("CHI-3PL")).toBe("60601");
    expect(originsByCandidate.get("MTL-01")).toBe("H3B1A7");
    expect(originsByCandidate.get("PHX-01")).toBe("85004");
  });

  it("prepares two LTL rows for each selected sample candidate", () => {
    const fourCandidateResult = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({ candidateCsv: ltlFourCandidateCsv() })
    );
    const twoCandidateResult = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture());

    expect(fourCandidateResult.sourceRowOutcomes.filter((row) => row.status === "Prepared")).toHaveLength(2);
    expect(fourCandidateResult.readyRequestCount).toBe(8);
    expect(fourCandidateResult.preparedRequests).toHaveLength(8);
    expect(new Set(fourCandidateResult.preparedRequests.map((request) => request.candidateFacilityId))).toEqual(
      new Set(["ATL-01", "CHI-3PL", "MTL-01", "PHX-01"])
    );
    expect(twoCandidateResult.readyRequestCount).toBe(4);
    expect(twoCandidateResult.preparedRequests).toHaveLength(4);
  });

  it("does not return a screening success message when persistence cannot be retrieved", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(screeningActionProjectFixture());
    prismaMock.prisma.supplyChainDesignScreeningRun.create.mockResolvedValue({ id: "screening-run-1" });
    prismaMock.prisma.supplyChainDesignScreeningRun.findUnique.mockResolvedValue(null);

    await expect(
      runSupplyChainDesignThreePlScreeningAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          studyName: "Benchmark",
          studyType: "FIND_BEST_WAREHOUSE_REGION",
          countryScope: "US",
          weightingMeasure: "annual_shipment_count",
          maximumRegionsToCompare: "2",
          demandPointsMappingId: "demand-mapping",
          logisticsMarketsMappingId: "market-mapping"
        })
      )
    ).resolves.toEqual({ ok: false, message: "3PL screening run was created but could not be retrieved." });
  });

  it("loads screening runs on the project page query and selects the newest run", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    const olderRun = screeningRunRecordFixture("older-screening-run", new Date("2026-07-28T12:00:00.000Z"));
    const newestRun = screeningRunRecordFixture("newest-screening-run", new Date("2026-07-28T13:00:00.000Z"));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...screeningProjectQueryFixture(adminContext),
      screeningRuns: [newestRun, olderRun]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestScreeningRun: {
        id: "newest-screening-run",
        status: "SUCCESS",
        resultReadError: null,
        resultSummary: {
          recommendedOneRegion: { marketIds: ["US-DAL"], weightedAverageDistance: 537 },
          recommendedTwoRegion: { marketIds: ["US-DAL", "US-LAX"], weightedAverageDistance: 364.4 },
          combinationsEvaluated: 10
        }
      },
      recentScreeningRuns: [{ id: "newest-screening-run" }, { id: "older-screening-run" }],
      latestModelRun: null,
      latestScenario: null
    });
    expect(prismaMock.prisma.supplyChainDesignProject.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          screeningRuns: {
            orderBy: { createdAt: "desc" },
            take: 5
          }
        })
      })
    );
  });

  it("shows a screening result read error for malformed saved JSON instead of dropping the saved run", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...screeningProjectQueryFixture(adminContext),
      screeningRuns: [
        {
          id: "bad-screening-run",
          status: "SUCCESS",
          createdAt,
          updatedAt,
          errorMessage: null,
          inputReferences: screeningInputReferencesFixture(),
          resultSummary: { unexpected: true }
        }
      ]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestScreeningRun: {
        id: "bad-screening-run",
        status: "SUCCESS",
        resultSummary: null,
        resultReadError: "Saved 3PL screening result JSON is incomplete or invalid."
      }
    });
  });

  it("calculates the benchmark warehouse option comparison from mapped provider cost files", () => {
    const result = runSupplyChainDesignProviderComparison(providerComparisonInputFixture());

    expect(result.resultVersion).toBe("3PL_PROVIDER_COMPARISON_V1");
    expect(result.totalAnnualShipments).toBe(1600);
    expect(result.totalAnnualPallets).toBe(3200);
    expect(result.recommendedOption).toMatchObject({
      providerOptionId: "P-DFW",
      providerName: "Fort Worth 3PL",
      warehouseLocation: "Fort Worth, TX 76102",
      annualOutboundTransportationCost: 658056.8,
      warehouseCost: 116800,
      annualInboundGatewayCost: 230000,
      totalAnnualCost: 1004856.8,
      shipmentsWithinThreeDays: 1540
    });
    expect(result.providerResults.map((row) => row.providerOptionId)).toEqual(["P-DFW", "P-ATL", "P-RIV"]);
    expect(result.providerResults.map((row) => row.totalAnnualCost)).toEqual([1004856.8, 1240567.2, 1680853.8]);
    expect(result.rateMatchEvidence).toHaveLength(36);
    expect(result.rateMatchEvidence.every((row) => row.status === "MATCHED")).toBe(true);
    expect(result.benchmarkControlResults.every((control) => control.passed)).toBe(true);
  });

  it("uses explicit Average Stored Pallets for rate-based storage without changing benchmark arithmetic", () => {
    const result = runSupplyChainDesignProviderComparison(
      providerComparisonInputFixture({
        providerCsv: providerOptionsCsvWithAverageStoredPallets(),
        providerMappings: providerOptionFieldMappings()
      })
    );

    expect(result.calculationSettings).toMatchObject({
      storageInputRule:
        "Each provider must supply either Annual Storage Cost or both Storage Rate per Pallet per Month and Average Stored Pallets.",
      storageMethodPrecedence:
        "When Annual Storage Cost is supplied, direct annual storage is used and rate-based storage is not also applied."
    });
    expect(result.recommendedOption).toMatchObject({
      providerOptionId: "P-DFW",
      storageMethod: "RATE_BASED",
      storageRatePerPalletPerMonth: 12,
      averageStoredPallets: 500,
      directAnnualStorageCost: null,
      annualStorageCost: 72000,
      totalAnnualCost: 1004856.8
    });
  });

  it("rejects rate-based warehouse storage when Average Stored Pallets is missing", () => {
    expect(() =>
      runSupplyChainDesignProviderComparison(
        providerComparisonInputFixture({
          providerCsv: providerOptionsCsv(),
          providerMappings: providerOptionFieldMappings()
        })
      )
    ).toThrow(
      "SCDS_3PL_STORAGE_AVERAGE_PALLETS_MISSING: P-DFW has Storage Rate per Pallet per Month but is missing Average Stored Pallets."
    );

    const source = readFileSync("src/modules/supply-chain-design/three-pl-provider-comparison.ts", "utf8");
    expect(source).not.toContain("DEFAULT_AVERAGE_STORED_PALLETS");
    expect(source).not.toContain("?? 500");
  });

  it("uses direct annual storage when supplied without rate-based double counting", () => {
    const result = runSupplyChainDesignProviderComparison(
      providerComparisonInputFixture({
        providerCsv: providerOptionsCsvWithBothStorageMethods(),
        providerMappings: providerOptionFieldMappings()
      })
    );

    expect(result.recommendedOption).toMatchObject({
      providerOptionId: "P-DFW",
      storageMethod: "DIRECT_ANNUAL",
      storageRatePerPalletPerMonth: null,
      averageStoredPallets: null,
      directAnnualStorageCost: 72000,
      annualStorageCost: 72000,
      totalAnnualCost: 1004856.8
    });
  });

  it("accepts direct annual storage as the only storage basis", () => {
    const result = runSupplyChainDesignProviderComparison(
      providerComparisonInputFixture({
        providerCsv: providerOptionsCsvWithAnnualStorageCost(),
        providerMappings: providerOptionFieldMappings()
      })
    );

    expect(result.providerResults.map((row) => [row.providerOptionId, row.storageMethod, row.annualStorageCost])).toEqual([
      ["P-DFW", "DIRECT_ANNUAL", 72000],
      ["P-ATL", "DIRECT_ANNUAL", 60000],
      ["P-RIV", "DIRECT_ANNUAL", 90000]
    ]);
    expect(result.recommendedOption?.totalAnnualCost).toBe(1004856.8);
  });

  it("rejects missing or partial warehouse storage basis with provider-specific errors", () => {
    expect(() =>
      runSupplyChainDesignProviderComparison(
        providerComparisonInputFixture({
          providerCsv: providerOptionsCsvMissingStorageBasis(),
          providerMappings: providerOptionFieldMappings()
        })
      )
    ).toThrow(
      "SCDS_3PL_STORAGE_BASIS_MISSING: P-DFW requires either Annual Storage Cost or both Storage Rate per Pallet per Month and Average Stored Pallets."
    );

    expect(() =>
      runSupplyChainDesignProviderComparison(
        providerComparisonInputFixture({
          providerCsv: providerOptionsCsvWithAverageStoredPallets().replace(",12,500,", ",,500,"),
          providerMappings: providerOptionFieldMappings()
        })
      )
    ).toThrow("SCDS_3PL_STORAGE_RATE_MISSING: P-DFW has Average Stored Pallets but is missing Storage Rate per Pallet per Month.");
  });

  it("reports missing and duplicate outbound rates instead of inventing provider comparison costs", () => {
    const missingResult = runSupplyChainDesignProviderComparison(
      providerComparisonInputFixture({
        outboundRateCsv: providerOutboundRateCacheCsv()
          .split("\n")
          .filter((row) => !row.startsWith("P-DFW,D001,"))
          .join("\n")
      })
    );

    expect(missingResult.providerResults.find((row) => row.providerOptionId === "P-DFW")).toMatchObject({
      complete: false,
      totalAnnualCost: null,
      missingRateCount: 1
    });
    expect(missingResult.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "SCDS_3PL_OUTBOUND_RATE_MISSING",
          providerOptionId: "P-DFW",
          destinationId: "D001"
        })
      ])
    );

    const duplicateResult = runSupplyChainDesignProviderComparison({
      ...providerComparisonInputFixture(),
      outboundRateCache: providerMappedFile(
        "outbound_rate_cache.csv",
        `${providerOutboundRateCacheCsv()}\nP-DFW,D001,LTL-2P,35.6,103.51,1,Duplicate`,
        outboundRateCacheFieldMappings()
      )
    });
    expect(duplicateResult.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "SCDS_3PL_OUTBOUND_RATE_AMBIGUOUS",
          providerOptionId: "P-DFW",
          destinationId: "D001"
        })
      ])
    );
  });

  it("rejects invalid provider benchmark costs with clear deterministic errors", () => {
    expect(() =>
      runSupplyChainDesignProviderComparison(
        providerComparisonInputFixture({
          providerCsv: providerOptionsCsv().replace("P-ATL,Atlanta 3PL", "P-DFW,Atlanta 3PL")
        })
      )
    ).toThrow("SCDS_3PL_DUPLICATE_PROVIDER_OPTION");

    expect(() =>
      runSupplyChainDesignProviderComparison(
        providerComparisonInputFixture({
          providerCsv: providerOptionsCsv().replace("P-RIV,Riverside 3PL,Riverside,US,CA,92501", "P-RIV,Riverside 3PL,Riverside,US,CA,")
        })
      )
    ).toThrow("SCDS_3PL_PROVIDER_WAREHOUSE_ZIP_MISSING");

    expect(() =>
      runSupplyChainDesignProviderComparison(
        providerComparisonInputFixture({
          providerCsv: providerOptionsCsv().replace(",12,6,8,", ",BAD,6,8,")
        })
      )
    ).toThrow("SCDS_3PL_PROVIDER_INVALID_NUMERIC_COST");

    expect(() =>
      runSupplyChainDesignProviderComparison(
        providerComparisonInputFixture({
          providerCsv: providerOptionsCsv().replace(",12,6,8,", ",-12,6,8,")
        })
      )
    ).toThrow("SCDS_3PL_PROVIDER_NEGATIVE_COST");
  });

  it("shows provider-comparison readiness inputs when demand and provider mappings are saved", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...screeningProjectQueryFixture(adminContext),
      files: [
        fileSummaryFixture("demand-file", "demand_points_us.csv", "hash-demand", [
          { id: "demand-mapping", tableType: "DEMAND_POINTS", updatedAt, fieldMappings: testFieldMappings(providerDemandFieldMappings()) }
        ]),
        fileSummaryFixture("provider-file", "provider_options.csv", "hash-provider", [
          { id: "provider-mapping", tableType: "PROVIDER_OPTIONS", updatedAt, fieldMappings: testFieldMappings(providerOptionFieldMappings()) }
        ]),
        fileSummaryFixture("profile-file", "shipment_profiles.csv", "hash-profile", [
          { id: "profile-mapping", tableType: "SHIPMENT_PROFILES", updatedAt, fieldMappings: testFieldMappings(shipmentProfileFieldMappings()) }
        ]),
        fileSummaryFixture("rate-file", "outbound_rate_cache.csv", "hash-rate", [
          { id: "rate-mapping", tableType: "OUTBOUND_RATE_CACHE", updatedAt, fieldMappings: testFieldMappings(outboundRateCacheFieldMappings()) }
        ]),
        fileSummaryFixture("expected-file", "expected_provider_results.csv", "hash-expected", [
          { id: "expected-mapping", tableType: "EXPECTED_PROVIDER_RESULTS", updatedAt, fieldMappings: testFieldMappings(expectedProviderResultFieldMappings()) }
        ])
      ]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      threePlScreening: {
        canRun: true,
        inputSelection: {
          demandPoints: { fileName: "demand_points_us.csv", mappingId: "demand-mapping" },
          providerOptions: { fileName: "provider_options.csv", mappingId: "provider-mapping" },
          shipmentProfiles: { fileName: "shipment_profiles.csv", mappingId: "profile-mapping" },
          outboundRateCache: { fileName: "outbound_rate_cache.csv", mappingId: "rate-mapping" },
          expectedProviderResults: { fileName: "expected_provider_results.csv", mappingId: "expected-mapping" }
        }
      }
    });
  });

  it("keeps the Shipment Profiles selector wired to the server action FormData key", () => {
    const formSource = readFileSync(
      "src/modules/supply-chain-design/components/three-pl-screening-form.tsx",
      "utf8"
    );
    const actionSource = readFileSync("src/modules/supply-chain-design/actions.ts", "utf8");

    expect(formSource).toContain('name="shipmentProfilesMappingId"');
    expect(actionSource).toContain('text(formData, "shipmentProfilesMappingId")');
    expect(formSource).not.toContain("shipmentProfileMappingId");
    expect(actionSource).not.toContain('text(formData, "shipmentProfileMappingId")');
  });

  it("hides internal benchmark table types and coordinates from normal mapping UI", () => {
    const mappingSource = readFileSync(
      "src/modules/supply-chain-design/components/file-mapping-form.tsx",
      "utf8"
    );
    const definitionsSource = readFileSync("src/modules/supply-chain-design/mapping-definitions.ts", "utf8");

    expect(mappingSource).toContain("SUPPLY_CHAIN_DESIGN_NORMAL_TABLE_TYPES");
    expect(mappingSource).not.toContain("Advanced mapping details");
    expect(mappingSource).not.toContain("Canonical field:");
    expect(definitionsSource).toContain('"LOGISTICS_MARKETS"');
    expect(definitionsSource).toContain("SUPPLY_CHAIN_DESIGN_INTERNAL_TABLE_TYPES");
    expect(definitionsSource).toContain("SUPPLY_CHAIN_DESIGN_HIDDEN_NORMAL_MAPPING_FIELDS");
    expect(definitionsSource).toContain('shipment_profile_id: "Shipment Type"');
    expect(definitionsSource).toContain('PROVIDER_OPTIONS: "Candidate Warehouse Options"');
    expect(definitionsSource).toContain('average_stored_pallets: "Average Stored Pallets"');
  });

  it("keeps customer CSV templates free of coordinates and internal benchmark downloads", () => {
    const templateFiles = [
      "current-facilities-and-costs-template.csv",
      "historical-shipments-template.csv",
      "candidate-warehouses-and-costs-template.csv"
    ];
    for (const templateFile of templateFiles) {
      const content = readFileSync(`docs/modules/supply-chain-design/templates/${templateFile}`, "utf8");
      expect(content).not.toMatch(/latitude|longitude/i);
      expect(content).not.toMatch(/expected|benchmark|defect|logistics market/i);
    }
    expect(readFileSync("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv", "utf8").trim()).toBe(
      "Facility ID,Facility Name,Facility Type,Facility ZIP / Postal Code,Annual Facility / Warehouse Cost,Pallet Capacity,Current Inventory Pallets,Current Inventory Units,Current Inventory Value,Currency,Notes"
    );
    expect(readFileSync("docs/modules/supply-chain-design/templates/historical-shipments-template.csv", "utf8").trim()).toBe(
      "Record Type,Shipment / Order Reference,Shipment Date,Origin Facility ID,Destination Customer / Group,Destination ZIP / Postal Code,Destination City / Region,Destination Country,Shipments,Pallets,Inventory Dwell Time Days,Units,Weight,Weight Unit,Length,Width,Height,Dimension Unit,Hazardous Materials,Transportation Mode,Transportation Cost,Transit Days,Service Level,SKU / Item,Currency"
    );
    expect(readFileSync("docs/modules/supply-chain-design/templates/historical-shipments-template.csv", "utf8")).not.toContain(
      "Facility Name"
    );
    expect(readFileSync("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv", "utf8")).not.toMatch(
      /Storage Rate|Handling Rate|Accessorial/i
    );
    expect(readFileSync("docs/modules/supply-chain-design/templates/candidate-warehouses-and-costs-template.csv", "utf8").trim()).toBe(
      "Candidate Facility ID,Candidate Facility Name,Candidate Type,Candidate ZIP / Postal Code,Candidate Country,Annual Facility / Warehouse Cost,Inbound Fee Per Pallet,Outbound Fee Per Pallet,Storage Fee Per Pallet Per Month,Pallet Capacity,Currency,Notes"
    );
  });

  it("sample project data references reconcile across current models", () => {
    const sample = (fileName: string) =>
      parseCsvRows(readFileSync(`docs/modules/supply-chain-design/sample-data/${fileName}`, "utf8"));
    const facilityRows = sample("current-facilities-and-costs-sample.csv");
    const facilityHeaders = facilityRows[0];
    expect(facilityHeaders).toContain("Facility ID");
    expect(facilityHeaders).toContain("Annual Facility / Warehouse Cost");
    expect(facilityRows.slice(1).some((row) => row[facilityHeaders.indexOf("Facility Type")] === "Owned")).toBe(true);
    expect(facilityRows.slice(1).some((row) => row[facilityHeaders.indexOf("Facility Type")] === "Existing 3PL")).toBe(true);
    const shipmentRows = sample("historical-shipments-sample.csv");
    const shipmentHeaders = shipmentRows[0];
    expect(shipmentHeaders).toContain("Origin Facility ID");
    expect(shipmentHeaders).not.toContain("Facility Name");
    const dataRows = shipmentRows.slice(1);
    const modeIndex = shipmentHeaders.indexOf("Transportation Mode");
    const ltlRows = dataRows.filter((row) => row[modeIndex] === "LTL");
    expect(new Set(ltlRows.map((row) => row[shipmentHeaders.indexOf("Destination ZIP / Postal Code")])).size).toBe(11);
    expect(
      dataRows.reduce((total, row) => total + Number(row[shipmentHeaders.indexOf("Shipments")] || 0), 0)
    ).toBe(116);
    expect(
      ltlRows.reduce((total, row) => total + Number(row[shipmentHeaders.indexOf("Shipments")] || 0), 0)
    ).toBe(115);
    expect(
      dataRows.reduce((total, row) => total + Number(row[shipmentHeaders.indexOf("Transportation Cost")] || 0), 0)
    ).toBe(59595);
    expect(Array.from(new Set(ltlRows.map((row) => row[shipmentHeaders.indexOf("Inventory Dwell Time Days")]))).sort()).toEqual([
      "15",
      "30",
      "45",
      "61",
      "90"
    ]);
    const facilities = new Set(facilityRows.slice(1).map((row) => row[facilityHeaders.indexOf("Facility ID")]));
    expect(shipmentRows.slice(1).every((row) => facilities.has(row[shipmentHeaders.indexOf("Origin Facility ID")]))).toBe(true);
    expect(
      facilityRows.slice(1).reduce((total, row) => total + Number(row[facilityHeaders.indexOf("Annual Facility / Warehouse Cost")] || 0), 0)
    ).toBe(485000);
    expect(
      Number(facilityRows[1][facilityHeaders.indexOf("Current Inventory Pallets")]) /
        Number(facilityRows[1][facilityHeaders.indexOf("Pallet Capacity")])
    ).toBeCloseTo(3500 / 12000);
  });

  it("exposes only approved customer templates through the template download route", () => {
    const routeSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/templates/[template]/route.ts",
      "utf8"
    );

    expect(routeSource).toContain('"current-facilities-and-costs-template.csv"');
    expect(routeSource).toContain('"historical-shipments-template.csv"');
    expect(routeSource).toContain('"candidate-warehouses-and-costs-template.csv"');
    expect(routeSource).toContain('"current-facilities-and-costs-sample.csv"');
    expect(routeSource).toContain('"historical-shipments-sample.csv"');
    expect(routeSource).toContain('"candidate-warehouses-and-costs-sample.csv"');
    expect(routeSource).not.toContain('"shared-supply-chain-design-template-package.zip"');
    expect(routeSource).not.toContain('"shared-supply-chain-design-field-guide.md"');
    expect(routeSource).not.toContain('"model-to-template-README.md"');
    expect(routeSource).not.toContain('"current-network-data-template.csv"');
    expect(routeSource).not.toContain('"current-facility-costs-template.csv"');
    expect(routeSource).not.toContain('"current-network-baseline-template-package.zip"');
    expect(routeSource).not.toContain('"model-01-current-network-field-guide.md"');
    expect(routeSource).not.toContain('"supply-chain-design-customer-template-package-current.zip"');
    expect(routeSource).not.toContain('"warehouse-options-template.csv"');
    expect(routeSource).not.toContain('"delivery-demand-sample.csv"');
    expect(routeSource).not.toContain('"delivery-demand-template.csv"');
    expect(routeSource).not.toContain('"scenario-lane-costs-template.csv"');
    expect(routeSource).not.toContain('"shipment-types-template.csv"');
    expect(routeSource).not.toContain('"transportation-rates-template.csv"');
    expect(routeSource).not.toContain('"current-facilities-template.csv"');
    expect(routeSource).not.toContain('"inventory-snapshot-template.csv"');
    expect(routeSource).not.toContain('"facility-operating-costs-template.csv"');
    expect(routeSource).not.toContain("expected_provider_results");
    expect(routeSource).not.toContain("logistics_markets");
    expect(routeSource).toContain("requireSupplyChainDesignStudioAccess");
  });

  it("recognizes official shared templates by complete headers, not filename", () => {
    const facilityHeaders = csvHeader("docs/modules/supply-chain-design/templates/current-facilities-and-costs-template.csv");
    const facilitySampleHeaders = csvHeader("docs/modules/supply-chain-design/sample-data/current-facilities-and-costs-sample.csv");
    const shipmentHeaders = csvHeader("docs/modules/supply-chain-design/templates/historical-shipments-template.csv");
    const shipmentSampleHeaders = csvHeader("docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv");
    const candidateHeaders = csvHeader("docs/modules/supply-chain-design/templates/candidate-warehouses-and-costs-template.csv");
    const candidateSampleHeaders = csvHeader("docs/modules/supply-chain-design/sample-data/candidate-warehouses-and-costs-sample.csv");
    const renamedTemplateRecognition = recognizeSupplyChainDesignOfficialTemplate(
      facilityHeaders.map((header, index) => (index === 0 ? `\uFEFF ${header.toUpperCase()} ` : ` ${header} `))
    );

    expect(facilityHeaders).toHaveLength(11);
    expect(shipmentHeaders).toHaveLength(25);
    expect(candidateHeaders).toHaveLength(12);
    expect(facilitySampleHeaders).toEqual(facilityHeaders);
    expect(shipmentSampleHeaders).toEqual(shipmentHeaders);
    expect(candidateSampleHeaders).toEqual(candidateHeaders);
    expect(recognizeSupplyChainDesignOfficialTemplate(facilityHeaders)?.tableType).toBe("FACILITIES");
    expect(recognizeSupplyChainDesignOfficialTemplate(facilitySampleHeaders)?.tableType).toBe("FACILITIES");
    expect(recognizeSupplyChainDesignOfficialTemplate(shipmentHeaders)?.tableType).toBe("SHIPMENTS");
    expect(recognizeSupplyChainDesignOfficialTemplate(shipmentSampleHeaders)?.tableType).toBe("SHIPMENTS");
    expect(recognizeSupplyChainDesignOfficialTemplate(shipmentHeaders)?.fieldMappings.some((mapping) => mapping.standardField === "state_province")).toBe(false);
    expect(recognizeSupplyChainDesignOfficialTemplate(shipmentSampleHeaders)?.fieldMappings.some((mapping) => mapping.standardField === "state_province")).toBe(false);
    expect(recognizeSupplyChainDesignOfficialTemplate(candidateHeaders)?.tableType).toBe("CANDIDATE_FACILITIES");
    expect(recognizeSupplyChainDesignOfficialTemplate(candidateSampleHeaders)?.tableType).toBe("CANDIDATE_FACILITIES");
    expect(renamedTemplateRecognition?.tableType).toBe("FACILITIES");
    expect(renamedTemplateRecognition?.fieldMappings.map((mapping) => mapping.standardField)).toEqual(
      expect.arrayContaining([
        "facility_id",
        "annual_facility_warehouse_cost",
        "current_inventory_pallets",
        "pallet_capacity",
        "currency"
      ])
    );
    expect(
      recognizeSupplyChainDesignOfficialTemplate(["Demand ID", "Destination ZIP", "Country", "Annual Shipments"])
    ).toBeNull();
    expect(shipmentHeaders).not.toContain("Facility Name");
    expect(candidateHeaders).not.toContain("Annual Fixed Cost");
  });

  it("keeps Project Data downloads customer-facing and hides unfinished packages", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const projectDataPanelSource = pageSource.slice(
      pageSource.indexOf("function ProjectDataPanel"),
      pageSource.indexOf("function CurrentNetworkBaselinePanel")
    );

    expect(projectDataPanelSource).toContain("Download templates");
    expect(projectDataPanelSource).toContain("Current Facilities and Warehouse Costs");
    expect(projectDataPanelSource).toContain("current-facilities-and-costs-template.csv");
    expect(projectDataPanelSource).toContain("Historical Shipments");
    expect(projectDataPanelSource).toContain("historical-shipments-template.csv");
    expect(projectDataPanelSource).toContain("Candidate Warehouses and Proposed Costs");
    expect(projectDataPanelSource).toContain("candidate-warehouses-and-costs-template.csv");
    expect(projectDataPanelSource).toContain("Upload and manage the shared datasets used across Supply Chain Design analyses.");
    expect(pageSource).not.toContain("Current Facilities and Warehouse Costs — Template");
    expect(pageSource).not.toContain("Current Facilities and Warehouse Costs — Example");
    expect(pageSource).not.toContain("Historical Shipments — Template");
    expect(pageSource).not.toContain("Historical Shipments — Example");
    expect(pageSource).not.toContain("Candidate Warehouses and Proposed Costs — Template");
    expect(pageSource).not.toContain("Candidate Warehouses and Proposed Costs — Example");
    expect(pageSource).not.toContain("shared-supply-chain-design-field-guide.md");
    expect(pageSource).not.toContain("shared-supply-chain-design-template-package.zip");
    expect(pageSource).not.toContain("Complete sample project");
    expect(pageSource).not.toContain("Download complete Model 01 package");
    expect(pageSource).not.toContain("supply-chain-design-customer-template-package-current.zip");
  });

  it("uses cleaned Project Data controls without persistent upload modes or delete checkboxes", () => {
    const uploadFormSource = readFileSync("src/modules/supply-chain-design/components/file-upload-form.tsx", "utf8");
    const applyFormSource = readFileSync("src/modules/supply-chain-design/components/apply-automatic-mapping-form.tsx", "utf8");
    const mappingFormSource = readFileSync("src/modules/supply-chain-design/components/file-mapping-form.tsx", "utf8");
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const projectDataPanelSource = pageSource.slice(
      pageSource.indexOf("function ProjectDataPanel"),
      pageSource.indexOf("function CurrentNetworkBaselinePanel")
    );

    expect(uploadFormSource).toContain("A file with this name already exists. Replace it?");
    expect(uploadFormSource).toContain('value="REPLACE"');
    expect(uploadFormSource).toContain("Supported format: CSV. Maximum file size:");
    expect(uploadFormSource).not.toContain("Current database-backed proof limit");
    expect(uploadFormSource).not.toContain("proof limit");
    expect(uploadFormSource).not.toContain("Keep both with a version suffix");
    expect(uploadFormSource).not.toContain("Cancel and ask me what to do");
    expect(projectDataPanelSource).not.toContain("CUSTOMER_TEMPLATE_DOWNLOAD_LABELS.join");
    expect(projectDataPanelSource).not.toContain("PAGE_SOURCE_COMPATIBILITY_MARKERS.join");
    expect(projectDataPanelSource).not.toContain('type="checkbox" name="confirmDelete"');
    expect(projectDataPanelSource).not.toContain("mappingTableType");
    expect(projectDataPanelSource).not.toContain("FACILITIES");
    expect(projectDataPanelSource).not.toContain("SHIPMENTS");
    expect(projectDataPanelSource).not.toContain("CANDIDATE_FACILITIES");
    expect(projectDataPanelSource).toContain("mappingDisplayStatus");
    expect(projectDataPanelSource).toContain("DeleteConfirmationCancelButton");
    expect(projectDataPanelSource).toContain("deleteSupplyChainDesignProjectFileAction");
    expect(projectDataPanelSource).toContain("deleteSupplyChainDesignFileMappingAction");
    expect(projectDataPanelSource).toContain("View mapping");
    expect(projectDataPanelSource).toContain("Delete mapping");
    expect(projectDataPanelSource).toContain("Delete file");
    expect(projectDataPanelSource).toContain('name="confirmDelete"');
    expect(projectDataPanelSource).toContain("Confirm delete");
    expect(projectDataPanelSource).toContain("Deleting this mapping will keep the uploaded file, but analyses cannot use it until a new mapping is saved.");
    expect(projectDataPanelSource).toContain("Deleting this file will also delete its saved mapping. Future analyses cannot use this data.");
    const cancelButtonSource = readFileSync(
      "src/modules/supply-chain-design/components/delete-confirmation-cancel-button.tsx",
      "utf8"
    );
    expect(cancelButtonSource).toContain('type="button"');
    expect(cancelButtonSource).toContain('closest("details")?.removeAttribute("open")');
    expect(applyFormSource).toContain("useActionState");
    expect(applyFormSource).toContain("applySupplyChainDesignAutomaticMappingAction");
    expect(applyFormSource).toContain("state.message");
    expect(mappingFormSource).toContain("savedColumns.get(field.field)");
  });

  it("uses the real named upload and file-mapping components on project data pages", () => {
    const projectPageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const filePageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/files/[fileId]/page.tsx",
      "utf8"
    );

    expect(projectPageSource).toContain("SupplyChainDesignFileUploadForm");
    expect(projectPageSource).not.toContain("<FileUploadForm");
    expect(filePageSource).toContain("SupplyChainDesignFileMappingForm");
    expect(filePageSource).toContain("fileId={file.id}");
    expect(filePageSource).toContain("detectedHeaders={file.detectedHeaders}");
    expect(filePageSource).toContain("mapping={file.mapping}");
    expect(filePageSource).not.toContain("import { FileMappingForm");
    expect(filePageSource).not.toContain("<FileMappingForm");
  });

  it("renders Current Network Baseline wording and hides normal derived Model 01 slots", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const formSource = readFileSync("src/modules/supply-chain-design/components/model-01-proof-run-form.tsx", "utf8");

    expect(pageSource).toContain("Current Network Baseline");
    expect(pageSource).toContain("Review the customer&apos;s existing facilities, shipment activity, transportation costs, inventory, facility costs");
    expect(formSource).toContain("Run Current Network Baseline");
    expect(formSource).toContain('label="Historical Shipments"');
    expect(formSource).toContain('label="Current Facilities and Warehouse Costs"');
    expect(formSource).not.toContain("Use legacy normalized data mappings");
    expect(formSource).not.toContain('label="Candidate Warehouses and Proposed Costs"');
    expect(formSource).not.toContain("FACILITIES mapping");
    expect(formSource).not.toContain("SHIPMENTS mapping");
    expect(formSource).not.toContain("INVENTORY mapping");
    expect(formSource).not.toContain("CUSTOMERS mapping");
    expect(pageSource).not.toContain("Model 01 Proof Run");
    expect(formSource).not.toContain("Run Model 01 proof");
  });

  it("formats Supply Chain Design dates for America/Toronto with daylight saving support", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const projectsPageSource = readFileSync("src/app/(authenticated)/supply-chain-design/page.tsx", "utf8");
    const ltlFormSource = readFileSync(
      "src/modules/supply-chain-design/components/candidate-ltl-rate-preparation-form.tsx",
      "utf8"
    );
    const ltlBatchFormSource = readFileSync(
      "src/modules/supply-chain-design/components/ltl-rate-batch-form.tsx",
      "utf8"
    );
    const summer = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Toronto"
    }).format(new Date("2026-07-30T20:02:00.000Z"));
    const winter = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Toronto"
    }).format(new Date("2026-01-30T20:02:00.000Z"));

    expect(summer).toContain("4:02 PM");
    expect(winter).toContain("3:02 PM");
    expect(pageSource).toContain('timeZone: "America/Toronto"');
    expect(projectsPageSource).toContain('timeZone: "America/Toronto"');
    expect(ltlFormSource).toContain('timeZone: "America/Toronto"');
    expect(pageSource).not.toContain('timeZone: "UTC"');
    expect(projectsPageSource).not.toContain('timeZone: "UTC"');
    expect(ltlFormSource).not.toContain('timeZone: "UTC"');
  });

  it("uses the restored Design projects wording and project row actions", () => {
    const projectsPageSource = readFileSync("src/app/(authenticated)/supply-chain-design/page.tsx", "utf8");

    expect(projectsPageSource).toContain("Create and manage Supply Chain Design projects using shared operational data, network analysis and candidate-location comparisons.");
    expect(projectsPageSource).not.toContain("Create and reopen isolated Model 01 proof workspaces");
    expect(projectsPageSource).not.toContain("deferred file intake");
    expect(projectsPageSource).toContain("href={`/supply-chain-design/${project.id}`}");
    expect(projectsPageSource).toContain("{project.name}");
    expect(projectsPageSource).not.toContain(">Open<");
    expect(projectsPageSource).toContain("<th className=\"px-3 py-3\">Project</th>");
    expect(projectsPageSource).toContain("<th className=\"px-3 py-3\">Created</th>");
    expect(projectsPageSource).toContain("<th className=\"px-3 py-3\">Updated</th>");
    expect(projectsPageSource).toContain("<th className=\"px-3 py-3\">Actions</th>");
    expect(projectsPageSource).toContain("DeleteConfirmationCancelButton");
    expect(projectsPageSource).toContain("deleteSupplyChainDesignProjectAction");
    expect(projectsPageSource).toContain("Deleting this project will permanently remove its uploaded files, mappings, saved runs and results.");
    expect(projectsPageSource).toContain("Confirm delete");
  });

  it("renders Current Network Baseline result language without parser-style summary rows", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const baselinePanelSource = pageSource.slice(
      pageSource.indexOf("function CurrentNetworkBaselinePanel"),
      pageSource.indexOf("function WarehouseLocationStrategyPanel")
    );
    const resultLayoutSource = readFileSync("src/modules/supply-chain-design/result-layout.ts", "utf8");

    expect(resultLayoutSource).toContain("Current Network Summary");
    expect(resultLayoutSource).toContain("Facility Summary");
    expect(resultLayoutSource).toContain("Analysis details");
    expect(baselinePanelSource).toContain("Current Network Summary");
    expect(baselinePanelSource).toContain("Facility Summary");
    expect(baselinePanelSource).toContain("Historical shipment source rows");
    expect(baselinePanelSource).toContain("Historical shipments represented");
    expect(baselinePanelSource).toContain("Total transportation cost");
    expect(baselinePanelSource).toContain("Total annual facility and warehouse cost");
    expect(baselinePanelSource).toContain("Total observed network cost");
    expect(baselinePanelSource).toContain("Annual facility and warehouse cost");
    expect(baselinePanelSource).toContain("Capacity utilization");
    expect(baselinePanelSource).toContain("formatWeight(result.volumeSummary.totalWeight, weightUnit)");
    expect(baselinePanelSource).toContain("formatWeight(facility.weight, weightUnit)");
    expect(baselinePanelSource).toContain("weightUnitWarning");
    expect(baselinePanelSource).not.toContain("CURRENT_NETWORK_BASELINE_SECTION_LABELS.join");
    expect(baselinePanelSource).not.toContain("Facility and warehouse cost | Shipment activity by destination group");
    expect(baselinePanelSource).not.toContain("Historical shipment rows");
    expect(baselinePanelSource).not.toContain("Available analysis levels");
    expect(baselinePanelSource).not.toContain("Highest operating-cost category");
    expect(baselinePanelSource).not.toContain("Highest observed cost per shipment");
    expect(baselinePanelSource).not.toContain("Labour");
    expect(baselinePanelSource).not.toContain("Rent");
    expect(baselinePanelSource).not.toContain("Utilities");
    expect(baselinePanelSource).not.toContain("No customer file");
    expect(baselinePanelSource).not.toContain("No inventory file");
    expect(baselinePanelSource).not.toContain("No facility-cost file");
    expect(baselinePanelSource).not.toContain("Shipment count by origin");
    expect(baselinePanelSource).not.toContain("Transportation cost by origin");
    expect(baselinePanelSource).not.toContain("Facility and warehouse cost by category");
    expect(baselinePanelSource).not.toContain("Average transportation cost per shipment");
    expect(baselinePanelSource).not.toContain("Facilities loaded");
    expect(baselinePanelSource).not.toContain("Shipments loaded");
    expect(baselinePanelSource).not.toContain("Customers loaded");
    expect(baselinePanelSource).not.toContain("Rows loaded");
    expect(baselinePanelSource).not.toContain("Transportation cost per shipment");
    expect(baselinePanelSource).not.toContain("Facility operating cost");
  });

  it("removes normal mapping diagnostics and gives result panels wider space", () => {
    const mappingPageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/files/[fileId]/page.tsx",
      "utf8"
    );
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );

    expect(mappingPageSource).not.toContain("File details");
    expect(mappingPageSource).not.toContain("Detected Headers");
    expect(mappingPageSource).not.toContain("<FileMetric");
    expect(mappingPageSource).not.toContain("formatBytes");
    expect(pageSource).not.toContain('label: "Overview"');
    expect(pageSource).toContain("function ModelRunLayout");
    expect(pageSource).toContain('lg:grid-cols-[minmax(0,0.22fr)_minmax(0,0.78fr)]');
    expect(pageSource).toContain('lg:grid-cols-[minmax(0,0.55fr)_minmax(0,1fr)]');
    expect(pageSource).not.toContain('lg:grid-cols-[minmax(0,0.3fr)_minmax(0,0.7fr)]');
    expect(pageSource).not.toContain('lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]');
  });

  it("uses customer-facing Network Design and LTL preparation wording", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const networkDesignFormSource = readFileSync(
      "src/modules/supply-chain-design/components/network-design-run-form.tsx",
      "utf8"
    );

    expect(pageSource).toContain(">Network Design<");
    expect(pageSource).toContain(
      "Compare the customer&apos;s current transportation and warehouse costs with each selected candidate warehouse."
    );
    expect(pageSource).not.toContain(
      "Compare specific candidate warehouses with the current network using historical shipment activity,"
    );
    expect(pageSource).not.toContain("Inputs: Historical Shipments;");
    expect(networkDesignFormSource).toContain('label="Historical Shipments"');
    expect(networkDesignFormSource).toContain('label="Current Facilities and Warehouse Costs"');
    expect(networkDesignFormSource).toContain('label="Candidate Warehouses and Proposed Costs"');
    expect(networkDesignFormSource).toContain('name="preparationRunId"');
    expect(networkDesignFormSource).toContain("Candidate warehouses to evaluate");
    expect(networkDesignFormSource).toContain('name="candidateFacilityIds"');
    expect(networkDesignFormSource).toContain("defaultChecked");
    expect(networkDesignFormSource).toContain("initialSelectedCandidateFacilityIds");
    expect(networkDesignFormSource).toContain("initialSelectedCandidateFacilityIds.includes(candidate.facilityId)");
    expect(pageSource).toContain("initialSelectedCandidateFacilityIds={selectedLtlRateBatch?.savedInputSelection?.selectedCandidateFacilityIds ?? null}");
    expect(networkDesignFormSource).toContain('value={candidate.facilityId}');
    expect(networkDesignFormSource).toContain('key={candidate.facilityId}');
    expect(networkDesignFormSource).toContain("{candidate.facilityName}");
    expect(networkDesignFormSource).toContain("{candidate.facilityId}");
    expect(networkDesignFormSource).toContain("options.length === 1");
    expect(networkDesignFormSource).toContain('<input type="hidden" name={name} value={option.mappingId} />');
    expect(networkDesignFormSource).toContain("options.length === 0");
    expect(networkDesignFormSource).toContain("No eligible saved mapping is available.");
    expect(networkDesignFormSource).not.toContain('name="currentFacilityIds"');
    expect(networkDesignFormSource).not.toContain('name="existingFacilityIds"');
    expect(networkDesignFormSource).not.toContain("Replacement or supplement scenario");
    expect(networkDesignFormSource).not.toContain("Candidate supplements current network");
    expect(networkDesignFormSource).not.toContain("Replace {facility.facilityId}");
    expect(networkDesignFormSource).toContain("Run Network Design");
    expect(networkDesignFormSource).not.toContain("This starts shipment preparation");
    expect(networkDesignFormSource).not.toContain("Starting Network Design...");
    expect(networkDesignFormSource).not.toContain("<SupplyChainDesignNetworkDesignProgressPoller");
    expect(networkDesignFormSource).not.toContain("showImmediateProgress");
    expect(networkDesignFormSource).not.toContain('title="Network Design Progress"');
    expect(networkDesignFormSource).toContain("state.message && (!state.ok || !state.runId)");
    expect(networkDesignFormSource).toContain("networkDesignBatchId=${state.runId}");
    expect(pageSource).toContain("Rating candidate warehouses");
    expect(pageSource).toContain("networkDesignBatchId");
    expect(pageSource).toContain("project.recentLtlRateBatches.find");
    expect(pageSource).toContain("const requestedLtlRateBatch = project.recentLtlRateBatches.find((batch) => batch.id === networkDesignBatchId) ?? null");
    expect(pageSource).toContain("const activeLtlRateBatch = project.recentLtlRateBatches.find((batch) => batch.status === \"QUEUED\" || batch.status === \"RUNNING\") ?? null");
    expect(pageSource).toContain("const selectedLtlResultBatch =");
    expect(pageSource).toContain("const selectedLtlRateBatch = activeLtlRateBatch ?? selectedLtlResultBatch");
    expect(pageSource).toContain("const hasActiveNetworkDesignBatch = Boolean(activeLtlRateBatch)");
    expect(pageSource).toContain("const showNetworkDesignPreparation = !hasActiveNetworkDesignBatch && !selectedLtlRateBatch");
    expect(pageSource).toContain("!hasActiveNetworkDesignBatch ? (");
    expect(pageSource).toContain("<SupplyChainDesignNetworkDesignProgressPoller");
    expect(pageSource).toContain('title={isActive ? "Rating candidate warehouses" : "Network Design Result"}');
    expect(pageSource).toContain("showNetworkDesignPreparation && project.latestLtlRatePreparationRun");
    expect(pageSource).toContain("No LTL rate requests have been prepared yet.");
    expect(pageSource).not.toContain("Model 02 Warehouse-Network Scenario");
    expect(pageSource).not.toContain("Add the missing Model 02 input before running");
    expect(pageSource).not.toContain("Latest Candidate LTL Preparation");
    expect(pageSource).not.toContain("No Candidate LTL Rate Preparation has been saved yet.");
    expect(pageSource).not.toContain("Latest Scenario");
    expect(pageSource).not.toContain("Prepare LTL Shipments");
    expect(pageSource).not.toContain("Get 7L Rates");
  });

  it("runs calculation-only Warehouse Location Strategy for one two and three regions", () => {
    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3 }));

    expect(result.resultVersion).toBe("WAREHOUSE_LOCATION_STRATEGY_V9");
    expect(result.calculationVersion).toBe("WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V9");
    expect(result.solutions.map((solution) => solution.regionCount)).toEqual([1, 2, 3]);
    expect(result.assumptions).toContain("An additional region is recommended when it reduces weighted average distance by at least 15% and every proposed region represents at least 10% of selected demand.");
    expect(result.assumptions).toContain("Location Strategy includes all valid delivery activity because every shipment contributes to warehouse demand.");
    expect(result.eligibleDestinationProfiles).toBe(3);
    expect(result.shipmentsRepresented).toBe(15);
    expect(result.solutions[0].clusteringDiagnostics.seedMethod).toBe("FARTHEST_WEIGHTED_DETERMINISTIC");
    expect(result.solutions[0].clusteringDiagnostics.initialSeedCoordinates).toEqual([{ latitude: 33.752845, longitude: -84.390226 }]);
    expect(result.solutions[0].clusteringDiagnostics.finalCenterCoordinates[0]).not.toEqual(result.solutions[0].clusteringDiagnostics.initialSeedCoordinates[0]);
    expect(result.solutions[0].clusteringDiagnostics.iterationsPerformed).toBeGreaterThan(0);
    expect(result.solutions[0].clusteringDiagnostics.converged).toBe(true);
    expect(result.solutions[1].clusteringDiagnostics.initialSeedCoordinates).toEqual([
      { latitude: 33.752845, longitude: -84.390226 },
      { latitude: 41.885155, longitude: -87.621512 }
    ]);
    expect(result.solutions[2].clusteringDiagnostics.initialSeedCoordinates).toEqual([
      { latitude: 33.752845, longitude: -84.390226 },
      { latitude: 41.885155, longitude: -87.621512 },
      { latitude: 40.750649, longitude: -73.997298 }
    ]);
    expect(result.solutions.every((solution) => solution.assignments.length === 3)).toBe(true);
    expect(result.solutions[0].averageWeightedDistance).toBeGreaterThan(result.solutions[1].averageWeightedDistance);
    expect(result.solutions.map((solution) => solution.complexity)).toEqual([
      "Lowest operating complexity",
      "Moderate operating complexity",
      "Highest operating complexity"
    ]);
    expect(result.recommendedSolution.regions[0]).toEqual(expect.objectContaining({
      centerLatitude: expect.any(Number),
      centerLongitude: expect.any(Number),
      recommendedMarketLabel: expect.any(String),
      recommendedMarketLatitude: expect.any(Number),
      recommendedMarketLongitude: expect.any(Number),
      searchRadiusMiles: expect.any(Number)
    }));
  });

  it("classifies Warehouse Location Strategy centers by checked-in country reference before practical-market selection", () => {
    expect(classifyWarehouseLocationStrategyCenterCountry({ latitude: 42.9849, longitude: -81.2453 }).country).toBe("CA");
    expect(classifyWarehouseLocationStrategyCenterCountry({ latitude: 43.6532, longitude: -79.3832 }).country).toBe("CA");
    expect(classifyWarehouseLocationStrategyCenterCountry({ latitude: 42.3149, longitude: -83.0364 }).country).toBe("CA");
    expect(classifyWarehouseLocationStrategyCenterCountry({ latitude: 42.3314, longitude: -83.0458 }).country).toBe("US");
    expect(classifyWarehouseLocationStrategyCenterCountry({ latitude: 42.8864, longitude: -78.8784 }).country).toBe("US");
    expect(classifyWarehouseLocationStrategyCenterCountry({ latitude: 45.4215, longitude: -75.6972 }).country).toBe("CA");
    expect(classifyWarehouseLocationStrategyCenterCountry({ latitude: 45.5019, longitude: -73.5674 }).country).toBe("CA");
    expect(classifyWarehouseLocationStrategyCenterCountry({ latitude: 47.6062, longitude: -122.3321 }).country).toBe("US");
    expect(classifyWarehouseLocationStrategyCenterCountry({ latitude: 49.2827, longitude: -123.1207 }).country).toBe("CA");

    const torontoHeavyCenter = classifyWarehouseLocationStrategyCenterCountry({ latitude: 43.131362, longitude: -81.763898 });
    expect(torontoHeavyCenter.country).toBe("CA");
    expect(torontoHeavyCenter.referenceId).not.toBe("US-DETROIT-MI");
  });

  it("keeps Warehouse Location Strategy clustering deterministic across source row order", () => {
    const original = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3 }));
    const rows = locationStrategyShipmentsCsv().split("\n");
    const reordered = [rows[0], ...rows.slice(1).reverse()].join("\n");
    const shuffled = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: reordered }));
    const repeated = [
      locationStrategyShipmentsHeader(),
      "Aggregated Activity,ORD-2001,30303,Atlanta GA,US,GA,5,1,5000,lb,40,305,USD,Parcel",
      "Aggregated Activity,ORD-2001-B,30303,Atlanta GA,US,GA,5,1,5000,lb,40,305,USD,Parcel",
      "Individual Shipment,ORD-1001,10001,New York NY,US,NY,1,20,1200,lb,10,525,USD,LTL",
      "Aggregated Activity,ORD-3001,60601,Chicago IL,US,IL,4,8,4000,lb,35,400,USD,Truckload"
    ].join("\n");
    const repeatedResult = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: repeated }));

    expect(shuffled.solutions.map((solution) => solution.clusteringDiagnostics.initialSeedCoordinates)).toEqual(
      original.solutions.map((solution) => solution.clusteringDiagnostics.initialSeedCoordinates)
    );
    expect(shuffled.recommendedSolution.regions.map((region) => [region.centerLatitude, region.centerLongitude])).toEqual(
      original.recommendedSolution.regions.map((region) => [region.centerLatitude, region.centerLongitude])
    );
    expect(repeatedResult.solutions[1].clusteringDiagnostics.initialSeedCoordinates[0]).toEqual({ latitude: 33.752845, longitude: -84.390226 });
  });

  it("does not automatically recommend the maximum allowed Warehouse Location Strategy regions", () => {
    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 3,
      shipmentsCsv: [
        "Record Type,Shipment / Order Reference,Destination ZIP,Destination Label,Country,State/Province,Shipments,Pallets,Weight,Weight Unit,Units,Transportation Cost,Currency",
        "Aggregated Activity,ORD-1001,10001,New York NY,US,,10,10,1000,lb,10,100,USD",
        "Aggregated Activity,ORD-1002,10001,New York NY,US,,5,5,500,lb,5,50,USD"
      ].join("\n")
    }));

    expect(result.recommendedRegionCount).toBe(1);
    expect(result.solutions.find((solution) => solution.regionCount === 1)?.recommendationStatus).toBe("Recommended");
    expect(result.solutions.every((solution) => Number.isFinite(solution.averageWeightedDistance))).toBe(true);
  });

  it("applies the 15 percent one-to-two and two-to-three incremental recommendation threshold", () => {
    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3 }));
    const twoRegion = result.solutions.find((solution) => solution.regionCount === 2);
    const threeRegion = result.solutions.find((solution) => solution.regionCount === 3);

    expect(twoRegion?.incrementalImprovementPercent).toBeGreaterThanOrEqual(15);
    expect(result.recommendedRegionCount).toBeGreaterThanOrEqual(2);
    if ((threeRegion?.incrementalImprovementPercent ?? 0) < 15) {
      expect(result.recommendedRegionCount).toBe(2);
      expect(threeRegion?.recommendationStatus).toBe("Available");
    }
  });

  it("weights Warehouse Location Strategy by represented totals without multiplying aggregated rows", () => {
    const shipmentWeighted = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ weightingMethod: "SHIPMENTS_REPRESENTED" }));
    const palletWeighted = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ weightingMethod: "PALLETS" }));
    const spendWeighted = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ weightingMethod: "CURRENT_TRANSPORTATION_COST" }));

    expect(shipmentWeighted.solutions[0].regions[0].selectedMetricWeight).toBe(15);
    expect(palletWeighted.solutions[0].regions[0].selectedMetricWeight).toBe(30);
    expect(spendWeighted.solutions[0].regions[0].selectedMetricWeight).toBe(1535);
    expect(shipmentWeighted.solutions[0].assignments.find((assignment) => assignment.sourceReference === "ORD-2001")?.selectedWeight).toBe(10);
    expect({
      latitude: shipmentWeighted.solutions[0].regions[0].centerLatitude,
      longitude: shipmentWeighted.solutions[0].regions[0].centerLongitude
    }).not.toEqual({
      latitude: palletWeighted.solutions[0].regions[0].centerLatitude,
      longitude: palletWeighted.solutions[0].regions[0].centerLongitude
    });
  });

  it("reports unresolved Warehouse Location Strategy postal codes and exports assignments", () => {
    const result = runSupplyChainDesignWarehouseLocationStrategy(
      locationStrategyInputFixture({ shipmentsCsv: locationStrategyShipmentsCsv().replace("60601", "99999") })
    );
    const csv = exportWarehouseLocationStrategyCsv(result);

    expect(result.excludedDestinationCount).toBe(1);
    expect(result.eligibleDestinationProfiles).toBe(2);
    expect(csv).toContain("Solution region count,Solution recommendation status,Assigned region,Recommended warehouse market");
    expect(csv).toContain("ORD-1001,Individual Shipment,10001,US,40.750649,-73.997298,ZIP_ZCTA_CENTROID,1,20,1200,lb");
    expect(result.solutions[0].assignments[0]).toEqual(expect.objectContaining({
      destinationLatitude: expect.any(Number),
      destinationLongitude: expect.any(Number),
      coordinateSource: "CENSUS_ZCTA_2025",
      coordinatePrecision: "ZIP_ZCTA_CENTROID",
      recommendedMarketLabel: expect.any(String),
      precisionCategory: "ZIP_ZCTA_CENTROID"
    }));
  });

  it("resolves U.S. calculated centers to deterministic supported warehouse markets", () => {
    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 2 }));
    const marketLabels = result.recommendedSolution.regions.map((region) => region.recommendedMarketLabel);

    expect(marketLabels).toEqual([...marketLabels]);
    expect(result.recommendedSolution.regions.every((region) => region.labelSource === "NEWL_LOGISTICS_MARKET_CATALOGUE")).toBe(true);
    expect(result.recommendedSolution.regions.every((region) => region.recommendedMarketDistanceMiles !== null)).toBe(true);
    expect(result.recommendedSolution.regions[0].centerLatitude).not.toBe(result.recommendedSolution.regions[0].recommendedMarketLatitude);
  });

  it("uses broad approved Canadian province markets and applies max regions separately by country", () => {
    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 2,
      countryScope: "SEPARATE_BY_COUNTRY",
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,US-1,30303,Atlanta GA,US,GA,10,2,10000,lb,80,610,USD",
        "Aggregated Activity,CA-1,M5V,Toronto ON,CA,ON,8,4,8000,lb,40,500,CAD",
        "Aggregated Activity,CA-2,H3B,Montreal QC,CA,QC,7,3,7000,lb,35,450,CAD"
      ].join("\n")
    }));

    expect(result.assumptions).toContain("Canadian destination profiles use checked-in city coordinates where available, with approved province-market fallback only when a city cannot be resolved.");
    expect(result.recommendedSolutions.map((solution) => solution.country).sort()).toEqual(["CA", "US"]);
    expect(result.solutions.filter((solution) => solution.country === "CA").map((solution) => solution.regionCount)).toEqual([1, 2]);
    expect(result.solutions.filter((solution) => solution.country === "US").map((solution) => solution.regionCount)).toEqual([1]);
    expect(result.solutions.some((solution) =>
      solution.regions.some((region) =>
        region.country === "CA" &&
        region.broadRegionApproximation &&
        region.precisionCategory === "BROAD_CANADIAN_PROVINCE_MARKET" &&
        region.labelSource === "NEWL_CANADA_PROVINCE_MARKET_MAP"
      )
    )).toBe(true);
    const caAssignment = result.recommendedSolutions
      .find((solution) => solution.country === "CA")
      ?.assignments.find((assignment) => assignment.destinationCountry === "CA" && assignment.destinationPostalCode === "M5V");
    expect(caAssignment).toEqual(expect.objectContaining({
      destinationLatitude: 43.6532,
      destinationLongitude: -79.3832,
      destinationMarketLabel: "Toronto",
      destinationProvince: "ON",
      destinationBroadApproximation: false,
      coordinateSource: "NEWL_CANADIAN_DELIVERY_CITY_REFERENCE_V1",
      coordinatePrecision: "CANADIAN_DELIVERY_CITY",
      precisionCategory: "CANADIAN_DELIVERY_CITY",
      recommendedMarketPrecisionCategory: "BROAD_CANADIAN_PROVINCE_MARKET"
    }));
  });

  it("keeps Canadian destination coordinates separate from Combined assigned warehouse markets for map rendering", () => {
    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 2,
      countryScope: "ALL",
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,US-1,30303,Atlanta GA,US,GA,20,2,10000,lb,80,610,USD",
        "Aggregated Activity,US-2,90012,Los Angeles CA,US,CA,20,2,10000,lb,80,610,USD",
        "Aggregated Activity,CA-1,M5V,Toronto ON,CA,ON,8,4,8000,lb,40,500,CAD",
        "Aggregated Activity,CA-2,H3B,Montreal QC,CA,QC,7,3,7000,lb,35,450,CAD"
      ].join("\n")
    }));
    const caAssignments = result.recommendedSolution.assignments.filter((assignment) => assignment.destinationCountry === "CA");
    const mapData = buildWarehouseLocationStrategyMapData(result.recommendedSolution, result.weightingMethod);

    expect(caAssignments).toHaveLength(2);
    expect(caAssignments.map((assignment) => assignment.destinationMarketLabel).sort()).toEqual(["Montreal", "Toronto"]);
    expect(new Set(caAssignments.map((assignment) => assignment.recommendedMarketLabel))).not.toEqual(new Set(caAssignments.map((assignment) => assignment.destinationMarketLabel)));
    expect(caAssignments.every((assignment) => assignment.precisionCategory === "CANADIAN_DELIVERY_CITY")).toBe(true);
    expect(caAssignments.every((assignment) => assignment.recommendedMarketPrecisionCategory === "SUPPORTED_US_MARKET")).toBe(true);
    expect(new Set(caAssignments.map((assignment) => assignment.recommendedMarketLabel))).toEqual(new Set(["Columbus"]));
    expect(mapData.destinationMarkers).toEqual(expect.arrayContaining([
      expect.objectContaining({ latitude: 43.6532, longitude: -79.3832, broad: false, canadianDestination: true }),
      expect.objectContaining({ latitude: 45.5019, longitude: -73.5674, broad: false, canadianDestination: true })
    ]));
    for (const assignment of caAssignments) {
      expect(mapData.destinationMarkers.some((marker) =>
        marker.canadianDestination &&
        marker.latitude === assignment.destinationLatitude &&
        marker.longitude === assignment.destinationLongitude
      )).toBe(true);
    }
    expect(mapData.omittedDestinationCount).toBe(0);
  });

  it("scales Warehouse Location Strategy deterministically for 100 and 1000 profiles without one region per destination", () => {
    const oneHundred = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 3,
      shipmentsCsv: syntheticLocationStrategyCsv(100)
    }));
    const oneThousandA = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 3,
      shipmentsCsv: syntheticLocationStrategyCsv(1000)
    }));
    const oneThousandB = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 3,
      shipmentsCsv: syntheticLocationStrategyCsv(1000)
    }));

    expect(oneHundred.eligibleDestinationProfiles).toBe(100);
    expect(oneThousandA.eligibleDestinationProfiles).toBe(1000);
    expect(oneThousandA.solutions.every((solution) => solution.regions.length <= 3)).toBe(true);
    expect(oneThousandA.solutions.every((solution) => solution.assignments.length === 1000)).toBe(true);
    expect(oneThousandA.solutions.every((solution) => new Set(solution.assignments.map((assignment) => assignment.sourceReference)).size === 1000)).toBe(true);
    expect(oneThousandA.recommendedSolution).toEqual(oneThousandB.recommendedSolution);
    expect(oneThousandA.performance.practicalScale).toContain("O(k*n*i)");
  });

  it("includes non-LTL geography and applies business weighting formulas", () => {
    const shipments = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ weightingMethod: "SHIPMENTS_REPRESENTED" }));
    const pallets = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ weightingMethod: "PALLETS" }));
    const weight = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      weightingMethod: "WEIGHT",
      shipmentsCsv: locationStrategyShipmentsCsv().replace("1200,lb", "544.31,kg")
    }));
    const units = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ weightingMethod: "UNITS" }));
    const spend = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ weightingMethod: "CURRENT_TRANSPORTATION_COST" }));

    expect(shipments.selectedTotalDemandWeight).toBe(15);
    expect(pallets.selectedTotalDemandWeight).toBe(30);
    expect(weight.selectedTotalDemandWeight).toBeCloseTo(15200, 0);
    expect(units.selectedTotalDemandWeight).toBe(125);
    expect(spend.selectedTotalDemandWeight).toBe(1535);
    expect(shipments.solutions[0].assignments.map((assignment) => assignment.recordType)).toContain("Aggregated Activity");
  });

  it("requires a CAD-to-USD rate for mixed currency spend weighting and reports invalid row issues without dropping valid rows", () => {
    expect(() => runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      weightingMethod: "CURRENT_TRANSPORTATION_COST",
      shipmentsCsv: locationStrategyShipmentsCsv().replace("400,USD", "400,CAD")
    }))).toThrow("Enter a CAD to USD conversion rate greater than 0 and no more than 5.");
    expect(() => runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      weightingMethod: "CURRENT_TRANSPORTATION_COST",
      cadToUsdRate: 0,
      shipmentsCsv: locationStrategyShipmentsCsv().replace("400,USD", "400,CAD")
    }))).toThrow("Enter a CAD to USD conversion rate greater than 0 and no more than 5.");

    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      countryScope: "ALL",
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Individual Shipment,GOOD,10001,New York NY,US,NY,1,1,100,lb,1,10,USD",
        "Individual Shipment,MISSING,,Missing,US,NY,1,1,100,lb,1,10,USD",
        "Individual Shipment,BADZIP,00000,Bad,US,NY,1,1,100,lb,1,10,USD",
        "Individual Shipment,BADCOUNTRY,10001,Bad,MX,,1,1,100,lb,1,10,USD",
        "Aggregated Activity,NOWEIGHT,30303,Atlanta GA,US,GA,,1,100,lb,1,10,USD"
      ].join("\n")
    }));

    expect(result.eligibleDestinationProfiles).toBe(1);
    expect(result.excludedDestinationCount).toBe(4);
    expect(result.rowIssues.map((issue) => issue.reason)).toEqual(expect.arrayContaining([
      "Missing destination postal code.",
      "Destination could not be resolved to local reference coordinates.",
      "Unsupported destination country.",
      "Selected weighting value is missing, invalid, or not positive."
    ]));
  });

  it("converts mixed USD and CAD historical spend using the entered CAD-to-USD rate", () => {
    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      weightingMethod: "CURRENT_TRANSPORTATION_COST",
      cadToUsdRate: 0.75,
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,USD-100,30303,Atlanta GA,US,GA,10,2,10000,lb,80,100,USD",
        "Aggregated Activity,CAD-200,M5V,Toronto ON,CA,ON,8,4,8000,lb,40,200,CAD"
      ].join("\n")
    }));

    expect(result.selectedDemandCurrency).toBe("USD");
    expect(result.spendCurrencyMode).toBe("CONVERTED_MIXED_CURRENCY");
    expect(result.originalSpendCurrencies).toEqual(["CAD", "USD"]);
    expect(result.cadToUsdRate).toBe(0.75);
    expect(result.selectedTotalDemandWeight).toBe(250);
    expect(result.solutions[0].assignments.map((assignment) => [assignment.sourceReference, assignment.selectedWeight]).sort()).toEqual([
      ["USD-100", 100],
      ["CAD-200", 150]
    ].sort());
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("allows single-currency spend weighting and reports spend currency without FX assumptions", () => {
    const usd = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      weightingMethod: "CURRENT_TRANSPORTATION_COST",
      countryScope: "US"
    }));
    const cad = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      weightingMethod: "CURRENT_TRANSPORTATION_COST",
      countryScope: "CA",
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,CA-1,M5V,Toronto ON,CA,ON,8,4,8000,lb,40,500,CAD",
        "Aggregated Activity,CA-2,H3B,Montreal QC,CA,QC,7,3,7000,lb,35,450,CAD"
      ].join("\n")
    }));
    const mixedNonSpend = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      weightingMethod: "SHIPMENTS_REPRESENTED",
      countryScope: "ALL",
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,US-1,30303,Atlanta GA,US,GA,10,2,10000,lb,80,610,USD",
        "Aggregated Activity,CA-1,M5V,Toronto ON,CA,ON,8,4,8000,lb,40,500,CAD"
      ].join("\n")
    }));

    expect(usd.selectedDemandCurrency).toBe("USD");
    expect(usd.spendCurrencyMode).toBe("SINGLE_CURRENCY");
    expect(cad.selectedDemandCurrency).toBe("CAD");
    expect(cad.spendCurrencyMode).toBe("SINGLE_CURRENCY");
    expect(cad.selectedTotalDemandWeight).toBe(950);
    expect(mixedNonSpend.selectedDemandCurrency).toBeNull();
    expect(mixedNonSpend.selectedTotalDemandWeight).toBe(18);
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("excludes spend-weighted rows with missing or unsupported currency", () => {
    const missing = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      weightingMethod: "CURRENT_TRANSPORTATION_COST",
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,GOOD,30303,Atlanta GA,US,GA,10,2,10000,lb,80,610,USD",
        "Aggregated Activity,NOCUR,60601,Chicago IL,US,IL,4,8,4000,lb,35,400,"
      ].join("\n")
    }));
    const unsupported = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      weightingMethod: "CURRENT_TRANSPORTATION_COST",
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,GOOD,30303,Atlanta GA,US,GA,10,2,10000,lb,80,610,USD",
        "Aggregated Activity,BADCUR,60601,Chicago IL,US,IL,4,8,4000,lb,35,400,EUR"
      ].join("\n")
    }));

    expect(missing.rowIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceReference: "NOCUR", reason: "Historical transportation spend currency is missing." })
    ]));
    expect(unsupported.rowIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceReference: "BADCUR", reason: "Historical transportation spend currency \"EUR\" is not supported." })
    ]));
    expect(missing.eligibleDestinationProfiles).toBe(1);
    expect(unsupported.eligibleDestinationProfiles).toBe(1);
  });

  it("does not recommend a tiny outlier but allows one high-volume aggregated destination to stand alone", () => {
    const tinyOutlier = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 2,
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,ATL-1,30303,Atlanta GA,US,GA,50,50,5000,lb,50,500,USD",
        "Aggregated Activity,ATL-2,30303,Atlanta GA,US,GA,50,50,5000,lb,50,500,USD",
        "Individual Shipment,LAX-1,90012,Los Angeles CA,US,CA,1,1,100,lb,1,10,USD"
      ].join("\n")
    }));
    const highVolumeOutlier = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 2,
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,ATL-1,30303,Atlanta GA,US,GA,50,50,5000,lb,50,500,USD",
        "Aggregated Activity,ATL-2,30303,Atlanta GA,US,GA,50,50,5000,lb,50,500,USD",
        "Aggregated Activity,LAX-1,90012,Los Angeles CA,US,CA,25,25,2500,lb,25,250,USD"
      ].join("\n")
    }));

    expect(tinyOutlier.recommendedRegionCount).toBe(1);
    expect(tinyOutlier.solutions.find((solution) => solution.regionCount === 2)?.recommendationExplanation).toContain("only 1% of selected demand");
    expect(highVolumeOutlier.recommendedRegionCount).toBe(2);
    expect(highVolumeOutlier.recommendedSolution.regions.every((region) => region.supportStatus === "Sufficient demand")).toBe(true);
  });

  it("allows a single shipment and removes the old minimum-two-shipments rule", () => {
    const single = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 3,
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Individual Shipment,ONE,10001,New York NY,US,NY,1,1,100,lb,1,10,USD"
      ].join("\n")
    }));
    const oneAggregatedRegion = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 2,
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Aggregated Activity,ATL-1,30303,Atlanta GA,US,GA,50,50,5000,lb,50,500,USD",
        "Aggregated Activity,LAX-1,90012,Los Angeles CA,US,CA,20,20,2000,lb,20,200,USD"
      ].join("\n")
    }));

    expect(single.recommendedRegionCount).toBe(1);
    expect(single.recommendedSolution.regions[0].shipmentsRepresented).toBe(1);
    expect(oneAggregatedRegion.recommendedRegionCount).toBe(2);
    expect(JSON.stringify(oneAggregatedRegion)).not.toContain("fewer than 2 shipments");
  });

  it("uses weighted 85th percentile radius and keeps saved V2 CSV assignments aligned", () => {
    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 1 }));
    const region = result.recommendedSolution.regions[0];
    const csv = exportWarehouseLocationStrategyCsv(result);
    const livePattern = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 2,
      countryScope: "ALL",
      shipmentsCsv: [
        locationStrategyShipmentsHeader(),
        "Individual Shipment,ORD-1001,10001,New York NY,US,NY,1,1,1200,lb,10,525,USD,LTL",
        "Individual Shipment,ORD-1002,10001,New York ZIP group,US,NY,1,1,1200,lb,10,525,USD,Parcel",
        "Individual Shipment,ORD-2001,30303,Atlanta GA,US,GA,1,1,5000,lb,40,305,USD,LTL",
        "Aggregated Activity,row-5,75201,Dallas ZIP group,US,TX,25,10,9000,lb,250,2500,USD,LTL"
      ].join("\n")
    }));
    const twoRegion = livePattern.solutions.find((solution) => solution.regionCount === 2);
    const dallasRegion = twoRegion?.regions.find((candidate) => candidate.recommendedMarketLabel === "Dallas-Fort Worth");
    const regionRows = twoRegion?.assignments
      .filter((assignment) => assignment.assignedRegion === dallasRegion?.regionNumber)
      .sort((left, right) => left.distanceToCenter - right.distanceToCenter) ?? [];
    const cumulative = regionRows.reduce<Array<{ sourceReference: string; cumulative: number; percent: number }>>((rows, assignment) => {
      const next = (rows.at(-1)?.cumulative ?? 0) + assignment.selectedWeight;
      rows.push({ sourceReference: assignment.sourceReference, cumulative: next, percent: (next / (dallasRegion?.selectedMetricWeight ?? 1)) * 100 });
      return rows;
    }, []);
    const atlanta = regionRows.find((assignment) => assignment.sourceReference === "ORD-2001");

    expect(region.searchRadiusMiles).toBe(425);
    expect(region.maximumAssignedDistance).toBe(642.4);
    expect(dallasRegion?.searchRadiusMiles).toBe(50);
    expect(regionRows.map((assignment) => assignment.sourceReference)).toEqual(["row-5", "ORD-2001"]);
    expect(cumulative[0]).toEqual(expect.objectContaining({ sourceReference: "row-5", cumulative: 25 }));
    expect(cumulative[0].percent).toBeCloseTo(96.1538, 3);
    expect(atlanta?.distanceToCenter).toBe(692);
    expect((atlanta?.distanceToCenter ?? 0) > (dallasRegion?.searchRadiusMiles ?? 0)).toBe(true);
    expect(csv.split("\n").length).toBe(1 + result.solutions.reduce((total, solution) => total + solution.assignments.length, 0));
    expect(csv).toContain(result.recommendedSolution.regions[0].recommendedMarketLabel);
  });

  it("persists Warehouse Location Strategy as a model run without calling 7L", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      mappings: [
        actionMappingFixture("shipments-mapping", "SHIPMENTS", "historical.csv", locationStrategyShipmentsCsv(), locationStrategyFieldMappings())
      ]
    });
    prismaMock.prisma.supplyChainDesignModelRun.create.mockResolvedValueOnce({ id: "location-run-1" });

    await expect(runSupplyChainDesignWarehouseLocationStrategyAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", shipmentsMappingId: "shipments-mapping", maxRegions: "3", weightingMethod: "SHIPMENTS_REPRESENTED", countryScope: "US" })
    )).rejects.toThrow("redirect:/supply-chain-design/project-1?tab=warehouse-location-strategy&locationStrategyRunId=location-run-1");

    expect(getLtlQuotes).not.toHaveBeenCalled();
    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        inputReferences: expect.objectContaining({ maxRegions: 3, weightingMethod: "SHIPMENTS_REPRESENTED", countryScope: "US" }),
      resultSummary: expect.objectContaining({ resultVersion: "WAREHOUSE_LOCATION_STRATEGY_V9" })
      })
    });
  });

  it("does not save a mixed-currency Warehouse Location Strategy spend report without a CAD-to-USD rate", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      mappings: [
        actionMappingFixture("shipments-mapping", "SHIPMENTS", "historical.csv", [
          locationStrategyShipmentsHeader(),
          "Aggregated Activity,US-1,30303,Atlanta GA,US,GA,10,2,10000,lb,80,610,USD",
          "Aggregated Activity,CA-1,M5V,Toronto ON,CA,ON,8,4,8000,lb,40,500,CAD"
        ].join("\n"), locationStrategyFieldMappings())
      ]
    });
    const createCallsBefore = prismaMock.prisma.supplyChainDesignModelRun.create.mock.calls.length;

    const response = await runSupplyChainDesignWarehouseLocationStrategyAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", shipmentsMappingId: "shipments-mapping", maxRegions: "2", weightingMethod: "CURRENT_TRANSPORTATION_COST", countryScope: "ALL" })
    );

    expect(response).toEqual({
      ok: false,
      message: "Enter a CAD to USD conversion rate greater than 0 and no more than 5."
    });
    expect(prismaMock.prisma.supplyChainDesignModelRun.create.mock.calls.length).toBe(createCallsBefore);
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("persists mixed-currency Location Strategy spend reports with the entered CAD-to-USD rate", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      mappings: [
        actionMappingFixture("shipments-mapping", "SHIPMENTS", "historical.csv", [
          locationStrategyShipmentsHeader(),
          "Aggregated Activity,US-1,30303,Atlanta GA,US,GA,10,2,10000,lb,80,100,USD",
          "Aggregated Activity,CA-1,M5V,Toronto ON,CA,ON,8,4,8000,lb,40,200,CAD"
        ].join("\n"), locationStrategyFieldMappings())
      ]
    });
    prismaMock.prisma.supplyChainDesignModelRun.findMany.mockResolvedValueOnce([]);
    prismaMock.prisma.supplyChainDesignModelRun.create.mockResolvedValueOnce({ id: "location-run-fx" });

    await expect(runSupplyChainDesignWarehouseLocationStrategyAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", shipmentsMappingId: "shipments-mapping", maxRegions: "2", weightingMethod: "CURRENT_TRANSPORTATION_COST", countryScope: "ALL", cadToUsdRate: "0.75" })
    )).rejects.toThrow("redirect:/supply-chain-design/project-1?tab=warehouse-location-strategy&locationStrategyRunId=location-run-fx");

    expect(prismaMock.prisma.supplyChainDesignModelRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputReferences: expect.objectContaining({ cadToUsdRate: 0.75 }),
        resultSummary: expect.objectContaining({
          selectedDemandCurrency: "USD",
          spendCurrencyMode: "CONVERTED_MIXED_CURRENCY",
          cadToUsdRate: 0.75,
          selectedTotalDemandWeight: 250
        })
      })
    });
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("reuses an exact saved Warehouse Location Strategy report and creates a new one when settings change", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const mapping = actionMappingFixture("shipments-mapping", "SHIPMENTS", "historical.csv", locationStrategyShipmentsCsv(), locationStrategyFieldMappings());
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      mappings: [mapping]
    });
    prismaMock.prisma.supplyChainDesignModelRun.findMany.mockResolvedValueOnce([]);

    await expect(runSupplyChainDesignWarehouseLocationStrategyAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", shipmentsMappingId: "shipments-mapping", maxRegions: "3", weightingMethod: "SHIPMENTS_REPRESENTED", countryScope: "US" })
    )).rejects.toThrow("redirect:/supply-chain-design/project-1?tab=warehouse-location-strategy&locationStrategyRunId=run-1");

    const savedInput = prismaMock.prisma.supplyChainDesignModelRun.create.mock.calls.at(-1)?.[0].data.inputReferences as Record<string, unknown>;
    const reportFingerprint = savedInput.reportFingerprint;
    expect(typeof reportFingerprint).toBe("string");
    const createCallsBeforeReuse = prismaMock.prisma.supplyChainDesignModelRun.create.mock.calls.length;

    prismaMock.prisma.supplyChainDesignModelRun.findMany.mockResolvedValueOnce([
      {
        id: "existing-location-run",
        inputReferences: { reportFingerprint },
        resultSummary: { resultVersion: "WAREHOUSE_LOCATION_STRATEGY_V9" }
      }
    ]);

    await expect(runSupplyChainDesignWarehouseLocationStrategyAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", shipmentsMappingId: "shipments-mapping", maxRegions: "3", weightingMethod: "SHIPMENTS_REPRESENTED", countryScope: "US" })
    )).rejects.toThrow("redirect:/supply-chain-design/project-1?tab=warehouse-location-strategy&locationStrategyRunId=existing-location-run&locationStrategyStatus=reused");

    expect(prismaMock.prisma.supplyChainDesignModelRun.create.mock.calls.length).toBe(createCallsBeforeReuse);

    prismaMock.prisma.supplyChainDesignModelRun.findMany.mockResolvedValueOnce([
      {
        id: "old-v8-location-run",
        inputReferences: { reportFingerprint },
        resultSummary: { resultVersion: "WAREHOUSE_LOCATION_STRATEGY_V8" }
      }
    ]);

    prismaMock.prisma.supplyChainDesignModelRun.create.mockResolvedValueOnce({ id: "location-run-2" });
    await expect(runSupplyChainDesignWarehouseLocationStrategyAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", shipmentsMappingId: "shipments-mapping", maxRegions: "3", weightingMethod: "SHIPMENTS_REPRESENTED", countryScope: "US" })
    )).rejects.toThrow("redirect:/supply-chain-design/project-1?tab=warehouse-location-strategy&locationStrategyRunId=location-run-2");

    expect(prismaMock.prisma.supplyChainDesignModelRun.create.mock.calls.length).toBe(createCallsBeforeReuse + 1);
  });

  it.each([
    "WAREHOUSE_LOCATION_STRATEGY_V2",
    "WAREHOUSE_LOCATION_STRATEGY_V3",
    "WAREHOUSE_LOCATION_STRATEGY_V4",
    "WAREHOUSE_LOCATION_STRATEGY_V5",
    "WAREHOUSE_LOCATION_STRATEGY_V6",
    "WAREHOUSE_LOCATION_STRATEGY_V7",
    "WAREHOUSE_LOCATION_STRATEGY_V8"
  ])("deletes a saved Warehouse Location Strategy %s report without requiring the current result version", async (resultVersion) => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignModelRun.findFirst.mockResolvedValueOnce({
      id: "location-run-1",
      resultSummary: { resultVersion, legacyShape: true }
    });
    prismaMock.prisma.supplyChainDesignModelRun.delete.mockResolvedValueOnce({ id: "location-run-1" });

    const response = await deleteSupplyChainDesignWarehouseLocationStrategyRunAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", runId: "location-run-1", confirmDelete: "on" })
    );

    expect(response).toEqual({ ok: true, message: "Saved Location Strategy report was deleted." });
    expect(prismaMock.prisma.supplyChainDesignModelRun.delete).toHaveBeenCalledWith({
      where: {
        tenantId_id: {
          tenantId: "tenant-1",
          id: "location-run-1"
        }
      }
    });
    expect(prismaMock.prisma.supplyChainDesignProjectFile.delete).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/supply-chain-design/project-1");
  });

  it("keeps the current Location Strategy report selected when deleting another row", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignModelRun.findFirst.mockResolvedValueOnce({
      id: "legacy-run",
      resultSummary: { resultVersion: "WAREHOUSE_LOCATION_STRATEGY_V2" }
    });
    prismaMock.prisma.supplyChainDesignModelRun.delete.mockResolvedValueOnce({ id: "legacy-run" });

    await expect(deleteSupplyChainDesignWarehouseLocationStrategyRunAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", runId: "legacy-run", currentRunId: "current-v4-run", confirmDelete: "on" })
    )).rejects.toThrow("redirect:/supply-chain-design/project-1?tab=warehouse-location-strategy&locationStrategyRunId=current-v4-run");

    expect(prismaMock.prisma.supplyChainDesignModelRun.delete).toHaveBeenCalledWith({
      where: {
        tenantId_id: {
          tenantId: "tenant-1",
          id: "legacy-run"
        }
      }
    });
  });

  it("redirects current Location Strategy deletion to the newest remaining report or the base tab", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignModelRun.findFirst.mockResolvedValueOnce({
      id: "current-run",
      resultSummary: { resultVersion: "WAREHOUSE_LOCATION_STRATEGY_V9" }
    });
    prismaMock.prisma.supplyChainDesignModelRun.delete.mockResolvedValueOnce({ id: "current-run" });
    prismaMock.prisma.supplyChainDesignModelRun.findMany.mockResolvedValueOnce([
      { id: "newest-model-01", resultSummary: { facilityCount: 1 } },
      { id: "remaining-v3", resultSummary: { resultVersion: "WAREHOUSE_LOCATION_STRATEGY_V3" } }
    ]);

    await expect(deleteSupplyChainDesignWarehouseLocationStrategyRunAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", runId: "current-run", currentRunId: "current-run", confirmDelete: "on" })
    )).rejects.toThrow("redirect:/supply-chain-design/project-1?tab=warehouse-location-strategy&locationStrategyRunId=remaining-v3");

    prismaMock.prisma.supplyChainDesignModelRun.findFirst.mockResolvedValueOnce({
      id: "last-run",
      resultSummary: { resultVersion: "WAREHOUSE_LOCATION_STRATEGY_V9" }
    });
    prismaMock.prisma.supplyChainDesignModelRun.delete.mockResolvedValueOnce({ id: "last-run" });
    prismaMock.prisma.supplyChainDesignModelRun.findMany.mockResolvedValueOnce([
      { id: "model-01-only", resultSummary: { facilityCount: 1 } }
    ]);

    await expect(deleteSupplyChainDesignWarehouseLocationStrategyRunAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", runId: "last-run", currentRunId: "last-run", confirmDelete: "on" })
    )).rejects.toThrow("redirect:/supply-chain-design/project-1?tab=warehouse-location-strategy");
  });

  it("does not delete non-Location Strategy model runs through the Location Strategy delete action", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const deleteCallsBefore = prismaMock.prisma.supplyChainDesignModelRun.delete.mock.calls.length;
    prismaMock.prisma.supplyChainDesignModelRun.findFirst.mockResolvedValueOnce({
      id: "model-01-run",
      resultSummary: { facilityCount: 1 }
    });

    const response = await deleteSupplyChainDesignWarehouseLocationStrategyRunAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", runId: "model-01-run", confirmDelete: "on" })
    );

    expect(response).toEqual({ ok: false, message: "Saved Location Strategy report was not found." });
    expect(prismaMock.prisma.supplyChainDesignModelRun.delete.mock.calls.length).toBe(deleteCallsBefore);
  });

  it("renders Warehouse Location Strategy calculation controls and keeps other tabs unchanged", () => {
    const pageSource = readFileSync("src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx", "utf8");
    const formSource = readFileSync("src/modules/supply-chain-design/components/warehouse-location-strategy-form.tsx", "utf8");
    const viewerSource = readFileSync(
      "src/modules/supply-chain-design/components/warehouse-location-strategy-solution-viewer.tsx",
      "utf8"
    );
    const panelSource = pageSource.slice(
      pageSource.indexOf("function WarehouseLocationStrategyPanel"),
      pageSource.indexOf("function LatestLtlRatePreparationRun")
    );

    expect(panelSource).toContain("Warehouse Location Strategy");
    expect(panelSource).toContain("Recommended Strategy");
    expect(panelSource).toContain("Region-Count Comparison");
    expect(viewerSource).toContain("Interactive Map");
    expect(viewerSource).toContain("Recommended Warehouse Search Regions");
    expect(viewerSource).toContain("Available Warehouse Search Regions");
    expect(panelSource).toContain("selectedSolutionId");
    expect(panelSource).toContain("firstHigherAvailableSolution");
    expect(panelSource).toContain("locationStrategyAvailableSolutionReason(firstHigherAvailableSolution)");
    expect(panelSource).not.toContain("View {formatLocationStrategyRegionCount(firstHigherAvailableSolution.regionCount).toLowerCase()}");
    expect(panelSource).toContain("Analysis Assumptions");
    expect(panelSource).toContain("Download Location Strategy Assignments");
    expect(panelSource).toContain("Saved Location Strategy Reports");
    expect(panelSource).toContain("const activeRunId = displayedRun?.id ?? null");
    expect(panelSource).toContain("Report from {formatDateTime(displayedRun.createdAt)}");
    expect(panelSource).toContain("Viewing saved analysis:");
    expect(panelSource).toContain("formatLocationStrategyWeighting(result.weightingMethod)");
    expect(panelSource).toContain("formatLocationStrategyScope(result.countryScope)");
    expect(panelSource).toContain("formatNumber(result.maxRegions)");
    expect(panelSource).toContain("Selected metric total");
    expect(panelSource).toContain("formatLocationStrategySelectedMetric(result.selectedTotalDemandWeight, result.selectedDemandCurrency)");
    expect(pageSource).toContain("import { WarehouseLocationStrategySolutionViewer }");
    expect(panelSource).toContain("<WarehouseLocationStrategySolutionViewer result={result}");
    expect(panelSource).toContain("activeRunId={activeRunId ?? \"latest\"}");
    expect(panelSource).toContain("selectedSolutionId={selectedSolution?.solutionId}");
    expect(viewerSource).toContain("Shipments represented");
    expect(viewerSource).toContain('result.weightingMethod !== "SHIPMENTS_REPRESENTED"');
    expect(viewerSource).toContain("...(result.weightingMethod !== \"SHIPMENTS_REPRESENTED\" ? [selectedMetricHeader(result)] : [])");
    expect(viewerSource).toContain("formatSelectedMetric(region.selectedMetricWeight, result.selectedDemandCurrency)");
    expect(panelSource).toContain("locationStrategyRunId=${run.id}");
    expect(panelSource).toContain('name="runId" value={run.id}');
    expect(panelSource).toContain('name="currentRunId" value={activeRunId}');
    expect(panelSource).toContain("Currently displayed");
    expect(panelSource).toContain("View report");
    expect(panelSource).toContain("Report action");
    expect(panelSource).toContain("Delete action");
    expect(panelSource.indexOf("Recommended Strategy")).toBeLessThan(panelSource.indexOf("WarehouseLocationStrategySolutionViewer"));
    expect(panelSource.indexOf("WarehouseLocationStrategySolutionViewer")).toBeLessThan(panelSource.indexOf("Region-Count Comparison"));
    expect(panelSource.indexOf("Region-Count Comparison")).toBeLessThan(panelSource.indexOf("Analysis Assumptions"));
    expect(panelSource.indexOf("Analysis Assumptions")).toBeLessThan(panelSource.indexOf("Download"));
    expect(panelSource).toContain("Average distance to assigned region center");
    expect(panelSource).toContain("The average straight-line distance between delivery destinations and their assigned calculated region center, weighted by the selected demand measure. This is different from the 85% demand coverage radius.");
    expect(viewerSource).toContain("85% demand coverage radius");
    expect(pageSource).toContain("headers.map((header, index) => <th key={index}");
    expect(panelSource).toContain("85% demand coverage radius");
    expect(panelSource).toContain("Smallest region share of selected demand");
    expect(panelSource).toContain("The percentage of selected demand assigned to the smallest proposed region. Every region in an automatically recommended solution must represent at least 10% of selected demand.");
    expect(panelSource).toContain("Distance reduction compared with one region");
    expect(panelSource).toContain("The percentage decrease in average distance to assigned region centers compared with serving all eligible demand using one warehouse region.");
    expect(panelSource).toContain("Additional reduction from newest region");
    expect(panelSource).toContain("The additional percentage decrease achieved by this option compared with the immediately preceding region-count option. For three regions, this compares three regions with two regions.");
    expect(panelSource).toContain("Practical warehouse markets");
    expect(panelSource).toContain("The supported practical warehouse markets associated with the calculated region centers in this option. These market names are not the calculated-center coordinates.");
    expect(panelSource).toContain("Compare the geographic effect of using one, two, or three warehouse regions.");
    expect(panelSource).toContain("Distance reduction compared with one region uses the one-region option as the baseline. Additional reduction from newest region compares each option with the immediately preceding option.");
    expect(viewerSource).toContain("region.distinctDestinationCount");
    expect(viewerSource).toContain("solution.regions.map((region) =>");
    expect(viewerSource).toContain("Viewing: {formatRegionCount(solution.regionCount)} - {isRecommended ? \"recommended\" : \"available, not recommended\"}");
    expect(viewerSource).toContain("This table shows the individual regions and practical warehouse markets for the currently selected option.");
    expect(panelSource).not.toContain("Distance improvement versus one-region option");
    expect(panelSource).not.toContain("Additional distance improvement");
    expect(panelSource).not.toContain("Total distance reduction vs. one region");
    expect(panelSource).not.toContain("Extra distance reduction vs. previous option");
    expect(panelSource).toContain("warehouse ${solution.regionCount === 1 ? \"region\" : \"regions\"}");
    expect(panelSource).toContain("Reference option");
    expect(panelSource).toContain("Location Strategy assigns each historical destination to a proposed geographic service region.");
    expect(panelSource).toContain("The model calculates geographic centers that minimize weighted straight-line distance");
    expect(panelSource).toContain("How the recommended regions are calculated");
    expect(panelSource).toContain("For a one-region analysis, every destination contributes to one weighted geographic center.");
    expect(panelSource).toContain("Delete this saved Location Strategy report?");
    expect(formSource).toContain("Run Location Strategy");
    expect(formSource).toContain("Maximum regions to evaluate");
    expect(formSource).toContain("Weight demand by");
    expect(formSource).toContain("Historical transportation spend");
    expect(formSource).toContain("This does not estimate transportation costs from the recommended regions.");
    expect(formSource).toContain("Warehouse network country option");
    expect(formSource).toContain("Controls where warehouse markets may be recommended. Together uses one cross-border network. Separate creates independent U.S. and Canadian networks. U.S.-only and Canada-only still use all uploaded delivery demand but restrict warehouse recommendations to the selected country.");
    expect(formSource).toContain("Combined U.S. and Canada network");
    expect(formSource).toContain("Separate U.S. and Canada strategies");
    expect(formSource).toContain("Location Strategy includes all valid delivery activity");
    expect(pageSource).toContain("Network Design Result");
  });

  it("renders map evidence and solution switching from saved assignments without recalculation", () => {
    const mapSource = readFileSync("src/modules/supply-chain-design/components/warehouse-location-strategy-map.tsx", "utf8");
    const renderedMapSource = mapSource.slice(mapSource.indexOf("return ("), mapSource.indexOf("function renderMap"));

    expect(mapSource).toContain("maplibregl");
    expect(mapSource).toContain("NEXT_PUBLIC_SCDS_MAP_STYLE_URL");
    expect(mapSource).toContain("OPENFREEMAP_LIBERTY_STYLE_URL = \"https://tiles.openfreemap.org/styles/liberty\"");
    expect(mapSource).toContain("const configuredStyleUrl = process.env.NEXT_PUBLIC_SCDS_MAP_STYLE_URL?.trim()");
    expect(mapSource).toContain("const BASEMAP_STYLE_URL = configuredStyleUrl || OPENFREEMAP_LIBERTY_STYLE_URL");
    expect(mapSource).not.toContain("https://demotiles.maplibre.org/style.json");
    expect(mapSource).toContain("SHOW_DEVELOPMENT_MAP_NOTICE");
    expect(mapSource).toContain("Development basemap: OpenFreeMap Liberty.");
    expect(mapSource).not.toContain("Development map context uses MapLibre demo tiles");
    expect(mapSource).toContain("useState(selectedId)");
    expect(mapSource).toContain("activeRunId");
    expect(mapSource).toContain("setSolutionId(selectedId)");
    expect(mapSource).toContain("[activeRunId, selectedId]");
    expect(mapSource).toContain("popupRefs.current.forEach((popup) => popup.remove())");
    expect(mapSource).toContain("setMapError");
    expect(mapSource).toContain("Retry map");
    expect(mapSource).toContain("The map style could not be loaded.");
    expect(mapSource).toContain("setSolutionId(nextSolutionId)");
    expect(mapSource).toContain("Viewing:");
    expect(mapSource).toContain("const metricLabel = formatMetricLabel(result.weightingMethod)");
    expect(mapSource).toContain("weighted by {metricLabel}");
    expect(mapSource).toContain("assignment.selectedWeight");
    expect(mapSource).toContain("row.transportationMode");
    expect(mapSource).toContain("assignment.destinationLabel");
    expect(mapSource).toContain("Source references:");
    expect(mapSource).toContain("Source profiles:");
    expect(mapSource).toContain("formatDestinationListLabel(postalCodes)");
    expect(mapSource).toContain("formatListLabel(\"Record type\", recordTypes)");
    expect(mapSource).toContain("formatListLabel(\"Transportation mode\", transportationModes)");
    expect(mapSource).toContain("Assigned region:");
    expect(mapSource).toContain("Straight-line distance:");
    expect(mapSource).toContain("Calculated demand center");
    expect(mapSource).toContain("Recommended practical warehouse market");
    expect(mapSource).toContain("mouseenter");
    expect(mapSource).toContain("mouseleave");
    expect(mapSource).toContain("click");
    expect(mapSource).toContain("attachDestinationInteractions");
    expect(mapSource).toContain("createPinMarker");
    expect(mapSource).toContain("anchor: \"bottom\"");
    expect(mapSource).not.toContain("offset: point.visuallySeparated");
    expect(mapSource).not.toContain("[-14, 0]");
    expect(mapSource).not.toContain("[14, 0]");
    expect(mapSource).toContain("aggregateDestinationMarkers");
    expect(mapSource).toContain("resolveDestinationMapPoint");
    expect(mapSource).toContain("isFiniteNumber");
    expect(mapSource).toContain("BROAD_CANADIAN_PROVINCE_MARKET");
    expect(mapSource).toContain("omittedDestinationCount");
    expect(mapSource).toContain("broad or unresolved");
    expect(mapSource).toContain("Broad Canadian market approximation");
    expect(mapSource).toContain("This marker represents multiple Canadian destinations using the approved broad market coordinate. It is not a precise postal location.");
    expect(mapSource).toContain("Canadian broad-market destination - approximate location");
    expect(mapSource).toContain("hasBroadCanadianDestinations");
    expect(mapSource).toContain("circle-stroke-color");
    expect(mapSource).toContain("selectedMetricLine");
    expect(mapSource).toContain('if (weightingMethod === "SHIPMENTS_REPRESENTED") return "";');
    expect(mapSource).toContain("destinationRadius");
    expect(mapSource).toContain("Marker: new");
    expect(mapSource).toContain("new maplibre.Marker");
    expect(mapSource).not.toContain("function markerElement");
    expect(mapSource).toContain("location-strategy-destination-circles");
    expect(mapSource).not.toContain("location-strategy-center-crosshair-vertical");
    expect(mapSource).not.toContain("location-strategy-center-crosshair-horizontal");
    expect(mapSource).not.toContain("location-strategy-center-rings");
    expect(mapSource).toContain("centerPins");
    expect(mapSource).toContain("marketPins");
    expect(mapSource).toContain('kind: "destination"');
    expect(mapSource).toContain('kind === "center"');
    expect(mapSource).toContain("circleFeature(region.centerLongitude, region.centerLatitude");
    expect(mapSource).toContain("rounded-full");
    expect(mapSource).toContain("border-2 border-dashed");
    expect(mapSource).toContain("Math.max(6, Math.min(18");
    expect(mapSource).toContain("Destination size represents");
    expect(mapSource).toContain("The dashed circle contains approximately 85% of the selected weighted demand assigned to that region. Destinations outside the circle may still be assigned to the region.");
    expect(mapSource).toContain("Delivery destination - colored by assigned region");
    expect(mapSource).toContain("Recommended practical warehouse market - colored by assigned region");
    expect(mapSource).toContain("85% demand coverage radius - colored by assigned region");
    expect(mapSource).toContain("MultiColorDestinationLegend");
    expect(mapSource).toContain("MultiColorRadiusLegend");
    expect(mapSource).toContain("BroadCanadianDestinationLegend");
    expect(mapSource).toContain("radiusMiles / 69");
    expect(mapSource).toContain("Math.cos(latitude * Math.PI / 180)");
    expect(mapSource).not.toContain('label="Delivery destination"');
    expect(mapSource).toContain("Shipments represented");
    expect(mapSource).toContain("Pallets represented");
    expect(mapSource).toContain("Weight represented");
    expect(mapSource).toContain("Units represented");
    expect(mapSource).toContain("Historical transportation spend");
    expect(mapSource).toContain("85% demand coverage radius");
    expect(mapSource).toContain("location-strategy-radii");
    expect(mapSource).toContain("Reset view");
    expect(mapSource).toContain("selectedSolutionId");
    expect(mapSource).toContain("url.searchParams.set(\"locationStrategySolutionId\", nextSolutionId)");
    expect(mapSource).toContain("window.history.replaceState(window.history.state, \"\", url.toString())");
    expect(mapSource).not.toContain("window.location.assign(url.toString())");
    expect(mapSource).toContain("The map uses saved Location Strategy coordinates. Distances shown are straight-line miles.");
    expect(renderedMapSource.match(/The map uses saved Location Strategy coordinates\. Distances shown are straight-line miles\./g)?.length).toBe(1);
    expect(renderedMapSource).not.toContain("NEXT_PUBLIC_SCDS_MAP_STYLE_URL");
    expect(mapSource).toContain("h-[620px]");
    expect(mapSource).toContain("max-sm:h-[480px]");
    expect(mapSource).toContain("pinSvg");
    expect(mapSource).not.toContain("runSupplyChainDesignWarehouseLocationStrategy(");
  });

  it("uses the dedicated Location Strategy sample for weighting validation without 7L", () => {
    const sample = readFileSync("docs/modules/supply-chain-design/fixtures/warehouse-location-strategy/historical-shipments-location-strategy-fixture.csv", "utf8");
    const guide = readFileSync("docs/modules/supply-chain-design/fixtures/warehouse-location-strategy/historical-shipments-location-strategy-fixture-guide.md", "utf8");
    const rows = parseSimpleCsv(sample);
    const totalsByCluster = summarizeLocationStrategySample(rows);
    const templateRecognition = recognizeSupplyChainDesignOfficialTemplate(sample.split("\n")[0].split(","));
    const sampleFieldMappings = templateRecognition?.fieldMappings ?? [];
    const shipments = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: sample, fieldMappings: sampleFieldMappings, weightingMethod: "SHIPMENTS_REPRESENTED", countryScope: "ALL" }));
    const twoRegionShipments = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 2, shipmentsCsv: sample, fieldMappings: sampleFieldMappings, weightingMethod: "SHIPMENTS_REPRESENTED", countryScope: "ALL" }));
    const pallets = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: sample, fieldMappings: sampleFieldMappings, weightingMethod: "PALLETS", countryScope: "ALL" }));
    const weight = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: sample, fieldMappings: sampleFieldMappings, weightingMethod: "WEIGHT", countryScope: "ALL" }));
    const units = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: sample, fieldMappings: sampleFieldMappings, weightingMethod: "UNITS", countryScope: "ALL" }));
    const sampleLines = sample.trim().split(/\r?\n/);
    const countryColumnIndex = sampleLines[0].split(",").indexOf("Destination Country");
    const usOnlySpendSample = [sampleLines[0], ...sampleLines.slice(1).filter((line) => line.split(",")[countryColumnIndex] === "US")].join("\n");
    const canadaOnlySpendSample = [sampleLines[0], ...sampleLines.slice(1).filter((line) => line.split(",")[countryColumnIndex] === "CA")].join("\n");
    const usSpend = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: usOnlySpendSample, fieldMappings: sampleFieldMappings, weightingMethod: "CURRENT_TRANSPORTATION_COST", countryScope: "US" }));
    const canadaSpend = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: canadaOnlySpendSample, fieldMappings: sampleFieldMappings, weightingMethod: "CURRENT_TRANSPORTATION_COST", countryScope: "CA" }));

    expect(sample).toContain("Parcel");
    expect(sample).toContain("LTL");
    expect(sample).toContain("Other");
    expect(sample).toContain("Individual Shipment");
    expect(sample).toContain("Aggregated Activity");
    expect(sample).toContain("CAD");
    expect(sample).toContain("USD");
    expect(sample.split("\n")[0]).toBe("Record Type,Shipment / Order Reference,Shipment Date,Origin Facility ID,Destination Customer / Group,Destination ZIP / Postal Code,Destination City / Region,Destination Country,State/Province,Shipments,Pallets,Units,Weight,Weight Unit,Length,Width,Height,Dimension Unit,Hazardous Materials,Transportation Mode,Transportation Cost,Transit Days,Service Level,SKU / Item,Currency");
    expect(sample.trim().split("\n").length).toBe(106);
    expect(rows).toHaveLength(105);
    expect(templateRecognition?.tableType).toBe("SHIPMENTS");
    expect(new Set(rows.map((row) => `${countryValue(row)}:${postalValue(row)}`)).size).toBeGreaterThanOrEqual(60);
    expect(repeatedDestinationCount(rows)).toBeGreaterThanOrEqual(30);
    expect(Object.keys(totalsByCluster)).toEqual(expect.arrayContaining([
      "Southern California",
      "Pacific Northwest",
      "Texas",
      "Midwest / Chicago",
      "Southeast / Atlanta",
      "Northeast / New York-New Jersey",
      "Greater Toronto Area",
      "Montreal / Quebec",
      "Calgary / Edmonton",
      "Vancouver",
      "Atlantic Canada",
      "Remote low-volume outliers"
    ]));
    expect(topCluster(totalsByCluster, "shipments", "US")).toBe("Southeast / Atlanta");
    expect(topCluster(totalsByCluster, "pallets", "US")).toBe("Southern California");
    expect(topCluster(totalsByCluster, "weight", "US")).toBe("Southern California");
    expect(topCluster(totalsByCluster, "units", "US")).toBe("Southeast / Atlanta");
    expect(topCluster(totalsByCluster, "spend", "US")).toBe("Southern California");
    expect(topCluster(totalsByCluster, "spend", "CA")).toBe("Greater Toronto Area");
    expect(rows.filter((row) => countryValue(row) === "CA")).toHaveLength(31);
    expect(new Set(rows.filter((row) => countryValue(row) === "CA").map(postalValue)).size).toBe(17);
    expect(shipments.eligibleDestinationProfiles).toBe(105);
    expect(shipments.excludedDestinationCount).toBe(0);
    expect(shipments.solutions.map((solution) => solution.regionCount)).toEqual([1, 2, 3]);
    expect(shipments.solutions.every((solution) => solution.assignments.length === 105)).toBe(true);
    expect(shipments.recommendedSolution.regions).toHaveLength(shipments.recommendedRegionCount);
    expect(shipments.solutions.flatMap((solution) => solution.assignments).filter((assignment) => assignment.destinationCountry === "CA")).toHaveLength(93);
    expect(new Set(shipments.recommendedSolution.assignments.filter((assignment) => assignment.destinationCountry === "CA").map((assignment) => assignment.destinationPostalCode)).size).toBe(17);
    expect(new Set(shipments.recommendedSolution.assignments.filter((assignment) => assignment.destinationCountry === "CA").map((assignment) => assignment.destinationMarketLabel))).toEqual(new Set([
      "Calgary",
      "Charlottetown",
      "Edmonton",
      "Halifax",
      "Mississauga",
      "Moncton",
      "Montreal",
      "Ottawa",
      "Quebec City",
      "Regina",
      "Saskatoon",
      "St. John's",
      "Toronto",
      "Vancouver",
      "Victoria",
      "Winnipeg"
    ]));
    expect(twoRegionShipments.recommendedSolution.regions.reduce((total, region) => total + region.distinctDestinationCount, 0)).toBeGreaterThanOrEqual(54);
    const canadianAssignments = twoRegionShipments.recommendedSolution.assignments.filter((assignment) => assignment.destinationCountry === "CA");
    const canadianMarkerMarkets = new Map<string, {
      province: string | null;
      coordinates: [number | null, number | null];
      sourceProfileCount: number;
      distinctPostalDestinations: Set<string>;
      shipmentsRepresented: number;
      assignedRegions: Set<number>;
    }>();
    for (const assignment of canadianAssignments) {
      const label = assignment.destinationMarketLabel ?? "";
      const row = canadianMarkerMarkets.get(label) ?? {
        province: assignment.destinationProvince,
        coordinates: [assignment.destinationLatitude, assignment.destinationLongitude],
        sourceProfileCount: 0,
        distinctPostalDestinations: new Set<string>(),
        shipmentsRepresented: 0,
        assignedRegions: new Set<number>()
      };
      row.sourceProfileCount += 1;
      row.distinctPostalDestinations.add(assignment.destinationPostalCode);
      row.shipmentsRepresented += assignment.shipmentsRepresented;
      row.assignedRegions.add(assignment.assignedRegion);
      canadianMarkerMarkets.set(label, row);
    }
    expect([...canadianMarkerMarkets.keys()].sort()).toEqual([
      "Calgary",
      "Charlottetown",
      "Edmonton",
      "Halifax",
      "Mississauga",
      "Moncton",
      "Montreal",
      "Ottawa",
      "Quebec City",
      "Regina",
      "Saskatoon",
      "St. John's",
      "Toronto",
      "Vancouver",
      "Victoria",
      "Winnipeg"
    ]);
    expect(canadianMarkerMarkets.get("Toronto")).toMatchObject({
      province: "ON",
      coordinates: [43.6532, -79.3832],
      sourceProfileCount: 4,
      shipmentsRepresented: 65
    });
    expect(canadianMarkerMarkets.get("Ottawa")).toMatchObject({
      province: "ON",
      coordinates: [45.4215, -75.6972],
      sourceProfileCount: 2,
      shipmentsRepresented: 9
    });
    expect(canadianMarkerMarkets.get("Edmonton")).toMatchObject({
      province: "AB",
      coordinates: [53.5461, -113.4938],
      sourceProfileCount: 1,
      shipmentsRepresented: 1
    });
    expect(canadianMarkerMarkets.get("Vancouver")).toMatchObject({
      province: "BC",
      coordinates: [49.2827, -123.1207],
      sourceProfileCount: 2,
      shipmentsRepresented: 30
    });
    expect(canadianMarkerMarkets.get("Victoria")).toMatchObject({
      province: "BC",
      coordinates: [48.4284, -123.3656],
      sourceProfileCount: 1,
      shipmentsRepresented: 1
    });
    const twoRegionMapData = buildWarehouseLocationStrategyMapData(twoRegionShipments.recommendedSolution, twoRegionShipments.weightingMethod);
    expect(twoRegionMapData.destinationMarkers.filter((marker) => marker.canadianDestination)).toHaveLength(16);
    expect(twoRegionMapData.destinationMarkers.filter((marker) => marker.broad)).toHaveLength(0);
    expect(twoRegionMapData.omittedDestinationCount).toBe(0);
    expect(pallets.recommendedSolution.regions.map((region) => region.recommendedMarketLabel)).not.toEqual(shipments.recommendedSolution.regions.map((region) => region.recommendedMarketLabel));
    expect(weight.selectedTotalDemandWeight).toBeGreaterThan(shipments.selectedTotalDemandWeight);
    expect(units.selectedTotalDemandWeight).toBeGreaterThan(shipments.selectedTotalDemandWeight);
    expect(usSpend.selectedTotalDemandWeight).toBeGreaterThan(0);
    expect(canadaSpend.selectedTotalDemandWeight).toBeGreaterThan(0);
    for (const countryScope of ["ALL", "US", "CA", "SEPARATE_BY_COUNTRY"] as const) {
      expect(() => runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: sample, fieldMappings: sampleFieldMappings, weightingMethod: "CURRENT_TRANSPORTATION_COST", countryScope }))).toThrow("Enter a CAD to USD conversion rate greater than 0 and no more than 5.");
      expect(runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({ maxRegions: 3, shipmentsCsv: sample, fieldMappings: sampleFieldMappings, weightingMethod: "CURRENT_TRANSPORTATION_COST", countryScope, cadToUsdRate: 0.75 })).selectedDemandCurrency).toBe("USD");
    }
    expect(guide).toContain("Upload `historical-shipments-location-strategy-fixture.csv` under Project Data as Historical Shipments.");
    expect(guide).toContain("This file is for Warehouse Location Strategy validation only. Do not use it for live 7L rating or Network Design rate testing.");
    expect(guide).toContain("| 1 | `historical-shipments-location-strategy-fixture.csv` | Shipments represented | United States only |");
    expect(guide).toContain("| 13 | `historical-shipments-location-strategy-fixture.csv` | Shipments represented | Combined U.S. and Canada network | 3 |");
    expect(guide).toContain("`Shipments represented` emphasizes shipment-frequency clusters");
    expect(guide).toContain("`Pallets represented` emphasizes pallet-heavy rows");
    expect(guide).toContain("`Weight represented` emphasizes heavy-freight clusters");
    expect(guide).toContain("`Units represented` emphasizes rows with larger unit counts");
    expect(guide).toContain("`Historical transportation spend` emphasizes uploaded spend");
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("uses Combined practical-market ranking while preserving Toronto-heavy calculated centers and metrics", () => {
    const sample = readFileSync("docs/modules/supply-chain-design/fixtures/warehouse-location-strategy/historical-shipments-location-strategy-fixture.csv", "utf8");
    const torontoHeavySample = sample.replace(
      "Aggregated Activity,LS-CA-ON-001,,LS-SAMPLE,Toronto ON,M5V,Toronto ON,CA,ON,34,19,360,8200,lb,,,,,,Parcel,4100,,,,CAD",
      "Aggregated Activity,LS-CA-ON-001,,LS-SAMPLE,Toronto ON,M5V,Toronto ON,CA,ON,5000,19,360,8200,lb,,,,,,Parcel,4100,,,,CAD"
    );
    const sampleFieldMappings = recognizeSupplyChainDesignOfficialTemplate(sample.split("\n")[0].split(","))?.fieldMappings ?? [];
    const rows = parseSimpleCsv(torontoHeavySample);
    const torontoRows = rows.filter((row) => /Toronto ON/.test(destinationLabelValue(row)));
    const result = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 3,
      shipmentsCsv: torontoHeavySample,
      fieldMappings: sampleFieldMappings,
      weightingMethod: "SHIPMENTS_REPRESENTED",
      countryScope: "ALL"
    }));
    const usOnly = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 3,
      shipmentsCsv: torontoHeavySample,
      fieldMappings: sampleFieldMappings,
      weightingMethod: "SHIPMENTS_REPRESENTED",
      countryScope: "US"
    }));
    const canadaOnly = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 3,
      shipmentsCsv: torontoHeavySample,
      fieldMappings: sampleFieldMappings,
      weightingMethod: "SHIPMENTS_REPRESENTED",
      countryScope: "CA"
    }));
    const separate = runSupplyChainDesignWarehouseLocationStrategy(locationStrategyInputFixture({
      maxRegions: 3,
      shipmentsCsv: torontoHeavySample,
      fieldMappings: sampleFieldMappings,
      weightingMethod: "SHIPMENTS_REPRESENTED",
      countryScope: "SEPARATE_BY_COUNTRY"
    }));
    const oneRegion = result.solutions.find((solution) => solution.regionCount === 1);
    const usOnlyOneRegion = usOnly.solutions.find((solution) => solution.solutionId === "ALL-1");
    const canadaOnlyOneRegion = canadaOnly.solutions.find((solution) => solution.solutionId === "ALL-1");
    const twoRegion = result.solutions.find((solution) => solution.regionCount === 2);
    const threeRegion = result.solutions.find((solution) => solution.regionCount === 3);
    const twoRegionMapData = twoRegion ? buildWarehouseLocationStrategyMapData(twoRegion, result.weightingMethod) : null;

    expect(torontoRows.reduce((total, row) => total + numberValue(row.Shipments), 0)).toBe(5031);
    expect(rows.reduce((total, row) => total + numberValue(row.Shipments), 0)).toBe(6054);
    expect(result.resultVersion).toBe("WAREHOUSE_LOCATION_STRATEGY_V9");
    expect(result.calculationVersion).toBe("WAREHOUSE_LOCATION_STRATEGY_CALCULATION_ONLY_V9");
    expect(result.shipmentsRepresented).toBe(6054);
    expect([usOnly, canadaOnly].map((candidate) => ({
      eligibleDestinationProfiles: candidate.eligibleDestinationProfiles,
      shipmentsRepresented: candidate.shipmentsRepresented,
      selectedTotalDemandWeight: candidate.selectedTotalDemandWeight,
      centers: candidate.solutions.map((solution) => solution.regions.map((region) => [region.centerLatitude, region.centerLongitude])),
      assignments: candidate.solutions.map((solution) => solution.assignments.map((assignment) => [assignment.sourceReference, assignment.assignedRegion, assignment.distanceToCenter])),
      averageWeightedDistance: candidate.solutions.map((solution) => solution.averageWeightedDistance),
      maximumAssignedDistance: candidate.solutions.map((solution) => solution.maximumAssignedDistance),
      shares: candidate.solutions.map((solution) => solution.regions.map((region) => region.selectedDemandSharePercent)),
      radii: candidate.solutions.map((solution) => solution.regions.map((region) => region.searchRadiusMiles))
    }))).toEqual([result, result].map((candidate) => ({
      eligibleDestinationProfiles: candidate.eligibleDestinationProfiles,
      shipmentsRepresented: candidate.shipmentsRepresented,
      selectedTotalDemandWeight: candidate.selectedTotalDemandWeight,
      centers: candidate.solutions.map((solution) => solution.regions.map((region) => [region.centerLatitude, region.centerLongitude])),
      assignments: candidate.solutions.map((solution) => solution.assignments.map((assignment) => [assignment.sourceReference, assignment.assignedRegion, assignment.distanceToCenter])),
      averageWeightedDistance: candidate.solutions.map((solution) => solution.averageWeightedDistance),
      maximumAssignedDistance: candidate.solutions.map((solution) => solution.maximumAssignedDistance),
      shares: candidate.solutions.map((solution) => solution.regions.map((region) => region.selectedDemandSharePercent)),
      radii: candidate.solutions.map((solution) => solution.regions.map((region) => region.searchRadiusMiles))
    })));
    expect(oneRegion?.regions[0]).toEqual(expect.objectContaining({
      centerLatitude: 43.131362,
      centerLongitude: -81.763898,
      country: "US",
      stateProvince: "MI",
      recommendedMarketLabel: "Detroit",
      labelSource: "NEWL_LOGISTICS_MARKET_CATALOGUE",
      precisionCategory: "SUPPORTED_US_MARKET"
    }));
    expect(oneRegion?.regions[0].recommendedMarketLabel).not.toBe("Toronto / Southern Ontario");
    expect(usOnlyOneRegion?.regions[0]).toEqual(expect.objectContaining({
      centerLatitude: 43.131362,
      centerLongitude: -81.763898,
      country: "US",
      recommendedMarketLabel: "Detroit"
    }));
    expect(canadaOnlyOneRegion?.regions[0]).toEqual(expect.objectContaining({
      centerLatitude: 43.131362,
      centerLongitude: -81.763898,
      country: "CA",
      stateProvince: "ON",
      recommendedMarketLabel: "Toronto / Southern Ontario"
    }));
    expect(usOnly.recommendedSolution.assignments.filter((assignment) => /Toronto ON/.test(assignment.destinationLabel ?? "")).reduce((total, assignment) => total + assignment.shipmentsRepresented, 0)).toBe(5031);
    expect(canadaOnly.recommendedSolution.assignments.filter((assignment) => assignment.destinationCountry === "US").reduce((total, assignment) => total + assignment.shipmentsRepresented, 0)).toBeGreaterThan(0);
    expect(result.recommendedSolution.solutionId).toBe("ALL-1");
    expect(oneRegion?.averageWeightedDistance).toBe(273.8);
    expect(twoRegion?.averageWeightedDistance).toBe(126.8);
    expect(threeRegion?.averageWeightedDistance).toBe(79.4);
    expect(twoRegion?.improvementVersusOneRegionPercent).toBe(53.7);
    expect(threeRegion?.improvementVersusOneRegionPercent).toBe(71);
    expect(threeRegion?.incrementalImprovementPercent).toBe(37.4);
    expect(twoRegion?.recommendationStatus).toBe("Available");
    expect(twoRegion?.recommendationExplanation).toContain("only 7.5% of selected demand");
    expect(twoRegion?.regions).toHaveLength(2);
    expect(twoRegion?.regions.map((region) => region.recommendedMarketLabel)).toEqual([
      "Toronto / Southern Ontario",
      "Salt Lake City"
    ]);
    expect(threeRegion?.regions.map((region) => region.recommendedMarketLabel)).toEqual([
      "Toronto / Southern Ontario",
      "Reno",
      "New Orleans"
    ]);
    expect(twoRegion?.regions.map((region) => region.shipmentsRepresented)).toEqual([5600, 454]);
    expect(twoRegion?.regions.reduce((total, region) => total + region.selectedDemandSharePercent, 0)).toBe(100);
    expect(twoRegionMapData?.centerPins).toHaveLength(2);
    expect(twoRegionMapData?.marketPins).toHaveLength(2);
    expect((twoRegionMapData?.radii as { features: unknown[] } | undefined)?.features).toHaveLength(2);
    expect(separate.shipmentsRepresented).toBe(6054);
    expect(separate.selectedTotalDemandWeight).toBe(6054);
    expect(separate.networkStructure).toBe("SEPARATE");
    expect(separate.solutions.filter((solution) => solution.country === "US").every((solution) => solution.assignments.every((assignment) => assignment.destinationCountry === "US"))).toBe(true);
    expect(separate.solutions.filter((solution) => solution.country === "CA").every((solution) => solution.assignments.every((assignment) => assignment.destinationCountry === "CA"))).toBe(true);
    expect(separate.solutions.filter((solution) => solution.country === "US").every((solution) => solution.regions.every((region) => region.country === "US"))).toBe(true);
    expect(separate.solutions.filter((solution) => solution.country === "CA").every((solution) => solution.regions.every((region) => region.country === "CA"))).toBe(true);
    expect(separate.solutions.filter((solution) => solution.country === "US").map((solution) => solution.regionCount)).toEqual([1, 2, 3]);
    expect(separate.solutions.filter((solution) => solution.country === "CA").map((solution) => solution.regionCount)).toEqual([1, 2, 3]);
  });

  it("renders a concise LTL preparation summary and review table without raw JSON", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const networkDesignSource = pageSource.slice(
      pageSource.indexOf("function LatestLtlRatePreparationRun"),
      pageSource.indexOf("function RunHistoryPanel")
    );

    expect(networkDesignSource).toContain("LTL requests prepared");
    expect(networkDesignSource).toContain("Incomplete LTL rows");
    expect(networkDesignSource).toContain("Non-LTL rows excluded");
    expect(networkDesignSource).toContain("All required LTL shipment rows are ready for rating.");
    expect(networkDesignSource).toContain("non-LTL historical rows were excluded from LTL rating.");
    expect(networkDesignSource).not.toContain("Unique prepared requests");
    expect(networkDesignSource).toContain("Candidate warehouse");
    expect(networkDesignSource).toContain("Source reference");
    expect(networkDesignSource).not.toContain("Review excluded or incomplete rows");
    expect(networkDesignSource).not.toContain("Historical row outcomes");
    expect(pageSource).toContain("No ready LTL requests were prepared.");
    expect(pageSource).not.toContain("<pre");
    expect(pageSource).not.toContain("JSON.stringify(result");
  });

  it("gates Network Design comparison output until rates and current costs are available", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const networkDesignSource = pageSource.slice(
      pageSource.indexOf("function LatestLtlRateBatch"),
      pageSource.indexOf("function RunHistoryPanel")
    );

    expect(networkDesignSource).toContain("const hasAcceptedRates = validRateLanes.length > 0");
    expect(networkDesignSource).toContain("const hasCurrentCostEvidence = validRateLanes.every");
    expect(networkDesignSource).toContain("const hasComparison = hasAcceptedRates && hasCurrentCostEvidence && batch.candidateComparisons.length > 0");
    expect(networkDesignSource).toContain("Regenerate Network Design to include current shipment costs.");
    expect(networkDesignSource).toContain("const isActive = batch.status === \"QUEUED\" || batch.status === \"RUNNING\"");
    expect(networkDesignSource).not.toContain("Development rate detail");
    expect(networkDesignSource).toContain("<a href={`/supply-chain-design/${projectId}/ltl-rate-batches/${batch.id}/shipment-comparison`}");
    expect(networkDesignSource).toContain("<a href={`/supply-chain-design/${projectId}/ltl-rate-batches/${batch.id}/candidate-summary`}");
    expect(networkDesignSource).toContain("Current facilities represented");
    expect(networkDesignSource).toContain("Current warehouse cost");
    expect(networkDesignSource).toContain("Current Network Baseline for This Comparison");
    expect(networkDesignSource).toContain("batch.sourceRowCounts.ltlRowsReviewed");
    expect(networkDesignSource).toContain("batch.sourceRowCounts.shipmentsRepresented");
    expect(networkDesignSource).not.toContain("Network Comparison Summary");
    expect(networkDesignSource).toContain("Single-Candidate Network Comparison");
    expect(networkDesignSource).toContain("Each candidate is modeled as replacing all current facilities represented by the selected shipment data.");
    expect(networkDesignSource).toContain("Download Candidate Comparison");
    expect(networkDesignSource).toContain("Current transportation cost");
    expect(networkDesignSource).toContain("Candidate transportation cost");
    expect(networkDesignSource).toContain("Current total network cost");
    expect(networkDesignSource).toContain("Candidate total network cost");
    expect(networkDesignSource).not.toContain("Download Candidate Summary");
    expect(networkDesignSource).not.toContain("Valid LTL rows rated");
    expect(networkDesignSource).not.toContain("Coverage percentage");
    expect(networkDesignSource).not.toContain("Temporary development detail - selected shipment rates");
    expect(networkDesignSource).not.toContain("formatMoney(lane.currentTransportationCost)");
  });

  it("renders compact Network Design run history links without rerunning rates", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const activeResultIndex = pageSource.indexOf("activeLtlRateBatch ? <LatestLtlRateBatch");
    const completedResultIndex = pageSource.indexOf("selectedLtlResultBatch && selectedLtlResultBatch.id !== activeLtlRateBatch?.id ? <LatestLtlRateBatch");
    const historyIndex = pageSource.indexOf("project.recentLtlRateBatches.length > 0 ? <NetworkDesignRunHistory");

    expect(pageSource).toContain("function NetworkDesignRunHistory");
    expect(pageSource).toContain("Saved Network Design Reports");
    expect(pageSource).toContain("Open a previous analysis without rerunning 7L.");
    expect(pageSource).toContain("Run date and time");
    expect(pageSource).toContain("Candidate warehouses evaluated");
    expect(pageSource).toContain("LTL shipment profiles");
    expect(pageSource).toContain("Shipments represented");
    expect(pageSource).toContain("Report action");
    expect(pageSource).toContain("Delete action");
    expect(pageSource).toContain("tab=network-design&networkDesignBatchId=${batch.id}");
    expect(pageSource).toContain("project.recentLtlRateBatches.find((batch) => batch.id === networkDesignBatchId) ?? null");
    expect(pageSource).toContain("Currently displayed");
    expect(pageSource).toContain(">View report</Link>");
    expect(pageSource).toContain('name="runType" value="NETWORK_DESIGN"');
    expect(pageSource).toContain("Delete this saved Network Design report?");
    expect(pageSource).toContain("deleteSupplyChainDesignRunAction.bind");
    expect(pageSource).not.toContain("deleteSupplyChainDesignSavedRunAction");
    expect(pageSource).toContain("Report from {formatDateTime(batch.startedAt)}");
    expect(pageSource).toContain("activeLtlRateBatch ? <LatestLtlRateBatch projectId={project.id} batch={activeLtlRateBatch} />");
    expect(pageSource).toContain("selectedLtlResultBatch && selectedLtlResultBatch.id !== activeLtlRateBatch?.id ? <LatestLtlRateBatch projectId={project.id} batch={selectedLtlResultBatch} />");
    expect(activeResultIndex).toBeGreaterThan(-1);
    expect(completedResultIndex).toBeGreaterThan(activeResultIndex);
    expect(historyIndex).toBeGreaterThan(completedResultIndex);
    expect(pageSource).not.toContain("!hasActiveNetworkDesignBatch && project.recentLtlRateBatches.length > 0 ? <NetworkDesignRunHistory");
    expect(pageSource).not.toContain("Viewing result");
    expect(pageSource).not.toContain("Saved Network Design runs");
    expect(pageSource).not.toContain("startSupplyChainDesignLtlRateBatchAction");
    expect(pageSource).not.toContain("runSupplyChainDesignNetworkDesignAction.bind");
  });

  it("polls the returned Network Design batch and exposes prepared request progress", () => {
    const pollerSource = readFileSync(
      "src/modules/supply-chain-design/components/network-design-progress-poller.tsx",
      "utf8"
    );
    const statusRouteSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/ltl-rate-batches/[batchId]/status/route.ts",
      "utf8"
    );

    expect(pollerSource).toContain("window.setInterval(poll, 3000)");
    expect(pollerSource).toContain("void poll()");
    expect(pollerSource).toContain("inFlight.current");
    expect(pollerSource).toContain("router.refresh()");
    expect(pollerSource).toContain("{processed} of {requestTotal} requests completed");
    expect(pollerSource).toContain("Rated {rated}");
    expect(pollerSource).toContain("issues > 0 ? <span>Issues {issues}</span> : null");
    expect(pollerSource).toContain("({progress}%)");
    expect(pollerSource).toContain('aria-label={`Network Design progress ${progress}%`}');
    expect(pollerSource).not.toContain("processed ${processed}, issues ${issues}");
    expect(statusRouteSource).toContain("batchId: batch.id");
    expect(statusRouteSource).toContain("total: batch.requestsSubmitted");
    expect(statusRouteSource).toContain("processed: batch.processedRequests");
    expect(statusRouteSource).toContain("rated: batch.ratedSuccessfully + batch.manuallyRated");
    expect(statusRouteSource).toContain("remaining: Math.max(0, batch.requestsSubmitted - batch.processedRequests)");
  });

  it("guards Network Design preparation reuse by selected candidate coverage", () => {
    const actionsSource = readFileSync("src/modules/supply-chain-design/actions.ts", "utf8");
    const batchSource = readFileSync("src/modules/supply-chain-design/ltl-rate-batches.ts", "utf8");

    expect(batchSource).toContain("missingSelectedCandidateIds");
    expect(batchSource).toContain("Selected LTL preparation is incompatible with the current candidate selection.");
    expect(actionsSource).toContain("preparationResponse = await generateSupplyChainDesignCandidateLtlRatePreparationAction");
    expect(actionsSource).toContain("batch = await createSupplyChainDesignLtlRateBatch(context, projectId, preparationRunId, comparisonSetup)");
  });

  it("uses the actual Prisma mappings relation for Network Design mapping lookup", () => {
    const actionsSource = readFileSync("src/modules/supply-chain-design/actions.ts", "utf8");
    const comparisonSetupSource = actionsSource.slice(
      actionsSource.indexOf("async function buildSupplyChainDesignLtlComparisonSetup"),
      actionsSource.indexOf("function readNetworkDesignCurrentFacilities")
    );

    expect(comparisonSetupSource).toContain("mappings: {");
    expect(comparisonSetupSource).toContain("project.mappings.find");
    expect(comparisonSetupSource).not.toContain("fileMappings");
    expect(actionsSource).toContain('message: "Network Design could not be started."');
  });

  it("loads latest Candidate LTL preparation runs in the project-detail query", () => {
    const querySource = readFileSync("src/modules/supply-chain-design/queries.ts", "utf8");

    expect(querySource).toContain("ltlRatePreparationRuns: {");
    expect(querySource).toContain("const recentLtlRatePreparationRuns = project.ltlRatePreparationRuns?.map");
    expect(querySource).toContain("latestLtlRatePreparationRun: recentLtlRatePreparationRuns[0] ?? null");
    expect(querySource).toContain("orderBy: {\n          createdAt: \"desc\"");
    expect(querySource).toContain("getLtlRatePreparationReadiness(filesWithDuplicateLabels)");
    expect(querySource).not.toContain('candidates.customers[0] ? null : "CUSTOMERS mapping"');
  });

  it("does not keep a hidden duplicate output template package", () => {
    expect(existsSync("docs/modules/supply-chain-design/output")).toBe(false);
    expect(existsSync("docs/modules/supply-chain-design/output/shared-supply-chain-design-template-package.zip")).toBe(false);
    expect(existsSync("docs/modules/supply-chain-design/output/shared-supply-chain-design-field-guide.md")).toBe(false);
    expect(existsSync("docs/modules/supply-chain-design/output/model-to-template-README.md")).toBe(false);
  });

  it("keeps only canonical customer data files beside feature-specific fixtures", () => {
    expect(readdirSync("docs/modules/supply-chain-design/templates").sort()).toEqual([
      "candidate-warehouses-and-costs-template.csv",
      "current-facilities-and-costs-template.csv",
      "historical-shipments-template.csv"
    ]);
    expect(readdirSync("docs/modules/supply-chain-design/sample-data").sort()).toEqual([
      "candidate-warehouses-and-costs-sample.csv",
      "current-facilities-and-costs-sample.csv",
      "historical-shipments-sample.csv"
    ]);
    expect(existsSync("docs/modules/supply-chain-design/samples")).toBe(false);
    expect(existsSync("docs/modules/supply-chain-design/internal-fixtures")).toBe(false);
    expect(readdirSync("docs/modules/supply-chain-design/fixtures/warehouse-location-strategy").sort()).toEqual([
      "historical-shipments-location-strategy-fixture-guide.md",
      "historical-shipments-location-strategy-fixture.csv"
    ]);
  });

  it("separates SCDS workflows into project tabs and renders Network Scenario Comparison without removing legacy WCC calculations", () => {
    const pageSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/page.tsx",
      "utf8"
    );
    const formSource = readFileSync(
      "src/modules/supply-chain-design/components/network-scenario-comparison-form.tsx",
      "utf8"
    );
    const pollerSource = readFileSync(
      "src/modules/supply-chain-design/components/network-scenario-comparison-progress-poller.tsx",
      "utf8"
    );
    const pagedTableSource = readFileSync(
      "src/modules/supply-chain-design/components/network-scenario-comparison-result-tables.tsx",
      "utf8"
    );
    const comparisonSource = readFileSync("src/modules/supply-chain-design/warehouse-cost-comparison.ts", "utf8");
    const actionsSource = readFileSync("src/modules/supply-chain-design/actions.ts", "utf8");

    expect(pageSource).toContain('label: "Project Data"');
    expect(pageSource).toContain('label: "Current Network Baseline"');
    expect(pageSource).toContain('label: "Network Design"');
    expect(pageSource).toContain('label: "Warehouse Location Strategy"');
    expect(pageSource).toContain('label: "Network Scenario Comparison"');
    expect(pageSource).toContain('label: "Run History"');
    expect(pageSource).toContain("Compare two explicit warehouse network scenarios using one shared Historical Shipments source.");
    expect(pageSource).toContain("Status");
    expect(pageSource).toContain("Network Cost Comparison");
    expect(pageSource).toContain("Warehouse Allocation");
    expect(pageSource).toContain("Best Network Assignments");
    expect(pageSource).toContain("Advanced / Cost Audit");
    expect(pageSource).toContain("Assumptions and Source Evidence");
    expect(pageSource).toContain('headers={["Cost", run.scenarioAName, run.scenarioBName]}');
    expect(pageSource).toContain('"Assigned Warehouse", "Carrier", "Selected Rate"');
    expect(pageSource).not.toContain("compactNetworkScenarioComparisonCoverage(run)");
    expect(pageSource).toContain("formatSavingsCallout(run, comparisonCurrency)");
    expect(pageSource).toContain("/network-scenario-comparisons/${run.id}/exports/results");
    expect(pageSource).toContain("Download Results CSV");
    expect(pageSource).toContain("Download Cost Audit CSV");
    expect(pageSource).toContain("NetworkScenarioComparisonPagedTable");
    expect(pageSource).toContain("Technical rate evidence");
    expect(pageSource).toContain("Saved Network Scenario Comparison Results");
    expect(pageSource).toContain("formatAssignmentWarehouseCostCell");
    expect(pageSource).toContain("networkScenarioStatusLabel(displayedComparisonRun.status)");
    expect(pageSource).not.toContain("Complete - ${formatNumber(ratingEvidence.reusedLaneCount)}");
    expect(pageSource).not.toContain("Scenario Summary CSV");
    expect(pageSource).not.toContain("Warehouse Allocation CSV");
    expect(pageSource).not.toContain("Delivery Assignments CSV");
    expect(pageSource).not.toContain("Side-by-Side Network Cost");
    expect(pageSource).not.toContain("Scenario Coverage");
    expect(pageSource).not.toContain("Facility Assignment Summary");
    expect(pageSource).not.toContain("Delivery Assignment Detail");
    expect(pageSource).not.toContain("Annual Savings / Difference");
    expect(pageSource).not.toContain("`${run.scenarioAName} Transportation`");
    expect(pageSource).not.toContain("Legacy Warehouse Cost Comparison Reports");
    expect(pageSource).not.toContain("Historical Current-Network Reference");
    expect(pageSource).not.toContain("Legacy Warehouse Cost Comparison Summary");
    expect(pageSource).not.toContain("Legacy Cost-Category Comparison");
    expect(pageSource).not.toContain("Legacy Key Cost Drivers");
    expect(pageSource).not.toContain("Legacy Comparison Basis");
    expect(pageSource).not.toContain('name="runType" value="WAREHOUSE_COST_COMPARISON"');
    expect(pageSource).not.toContain("Beta - totals not yet validated");
    expect(formSource).toContain("Historical Shipments");
    expect(formSource).toContain("Current Facilities and Warehouse Costs");
    expect(formSource).toContain("Candidate Warehouses and Proposed Costs");
    expect(formSource).toContain('name="facilitiesMappingId"');
    expect(formSource).toContain('name="candidateFacilitiesMappingId"');
    expect(formSource).toContain('name="forceNewRun"');
    expect(formSource).toContain("Recalculate");
    expect(formSource).toContain('label="Scenario A"');
    expect(formSource).toContain('label="Scenario B"');
    expect(formSource).toContain("{label} Name");
    expect(formSource).toContain("Run Network Scenario Comparison");
    expect(formSource).toContain('selectedField="scenarioAFacilityOptionIds"');
    expect(formSource).toContain('selectedField="scenarioBFacilityOptionIds"');
    expect(actionsSource).toContain("runSupplyChainDesignNetworkScenarioComparisonAction");
    expect(actionsSource).toContain("resumeSupplyChainDesignNetworkScenarioComparisonAction");
    expect(actionsSource).toContain("startSupplyChainDesignNetworkScenarioComparisonRateBatchAction");
    expect(actionsSource).toContain("deleteSupplyChainDesignNetworkScenarioComparisonRunAction");
    expect(actionsSource).toContain("forceNewRun");
    expect(actionsSource).toContain("orchestrateSupplyChainDesignNetworkScenarioComparison");
    expect(pageSource).toContain("Delete Result");
    expect(pageSource).toContain("deleteSupplyChainDesignNetworkScenarioComparisonRunAction");
    expect(pageSource).toContain("keeps uploaded project data and shared 7L rate evidence");
    expect(pageSource).toContain("comparisonRunIsActive && comparisonBatchId");
    expect(pageSource).toContain("batchId={comparisonBatchId}");
    expect(pollerSource).toContain("resumeSupplyChainDesignNetworkScenarioComparisonAction");
    expect(pollerSource).toContain("startSupplyChainDesignNetworkScenarioComparisonRateBatchAction");
    expect(pollerSource).toContain('data.status === "QUEUED"');
    expect(pollerSource).toContain("window.setInterval(poll, 3000)");
    expect(pollerSource).toContain("Reconciling rated lanes");
    expect(comparisonSource).toContain("WAREHOUSE_COST_COMPARISON_V1");
    expect(comparisonSource).toContain("This comparison evaluates warehouse operating costs only.");
    expect(pageSource).toContain('mode="LOCATION_STRATEGY"');
    expect(pageSource).toContain('mode="WAREHOUSE_COST_COMPARISON"');
    expect(pageSource).toContain("Download templates");
    expect(pageSource).toContain("DeleteFileForm");
    expect(pageSource).toContain("DeleteMappingForm");
    expect(pageSource).toContain("DeleteRunForm");
    expect(pagedTableSource).toContain("const PAGE_SIZES = [25, 50, 100] as const");
    expect(pagedTableSource).toContain("defaultScenario");
    expect(pagedTableSource).toContain("enableSearch");
    expect(pagedTableSource).toContain("filteredRows.slice");
    expect(pagedTableSource).toContain("setScenario(value)");
    expect(pagedTableSource).toContain("setPage(1)");
  });

  it("builds business-oriented Network Scenario Comparison report rows and CSVs from persisted result evidence", () => {
    const run = networkScenarioComparisonRunRecord({
      status: "COMPLETE",
      scenarioAName: "Toronto",
      scenarioBName: "Atlanta",
      resultSummary: networkScenarioComparisonDetailedResultSummary()
    }) as any;

    const coverage = summarizeNetworkScenarioComparisonCoverage(run);
    expect(coverage).toEqual([
      expect.objectContaining({ scenarioName: "Toronto", representedShipments: 27, assignedRepresentedShipments: 27, incompleteRepresentedShipments: 0, modeledRateCoverage: 1, activeWarehouseCount: 1 }),
      expect.objectContaining({ scenarioName: "Atlanta", representedShipments: 27, assignedRepresentedShipments: 27, incompleteRepresentedShipments: 0, modeledRateCoverage: 1, activeWarehouseCount: 1 })
    ]);
    expect(compactNetworkScenarioComparisonCoverage(run)).toEqual([
      "Coverage: 27 of 27 eligible shipments modeled in both scenarios."
    ]);
    expect(buildNetworkScenarioComparisonCostRows(run)).toEqual([
      ["Transportation", "6054.74", "3978.09"],
      ["Warehouse", "240000", "420000"],
      ["Total Network Cost", "246054.74", "423978.09"]
    ]);
    expect(networkScenarioComparisonSavingsCallout(run)).toBe("Toronto is 177923.35 lower than Atlanta for the represented demand (about 42.0%).");

    expect(facilitySummaryRows(run)).toEqual([
      ["Toronto", "TOR-01 - Toronto DC", "Current", "M5V 2T6, US", "3", "27", "30", "6054.74", "0", "240000", "246054.74"],
      ["Atlanta", "ATL-01 - Atlanta Proposed Warehouse", "Candidate", "", "3", "27", "30", "3978.09", "0", "420000", "423978.09"]
    ]);

    const assignments = deliveryAssignmentRows(run);
    expect(assignments).toEqual([
      ["10001", "10001", "US", "ORD-1001", "1", "2", "TOR-01 - Toronto DC", "ATL-01 - Atlanta Proposed Warehouse", "428.97", "262.89"],
      ["30303", "30303", "US", "ORD-2001", "1", "3", "TOR-01 - Toronto DC", "ATL-01 - Atlanta Proposed Warehouse", "147.91", "173.95"],
      ["75201", "75201", "US", "ROW-5", "25", "25", "TOR-01 - Toronto DC", "ATL-01 - Atlanta Proposed Warehouse", "5477.86", "3541.25"]
    ]);
    expect(winningDeliveryAssignmentRows(run)[0]).toEqual([
      "Toronto",
      "10001",
      "TOR-01 - Toronto DC",
      "Carrier A",
      "428.97",
      "428.97",
      "0",
      "428.97",
      "1",
      "2"
    ]);

    const alternatives = alternativeRows(run);
    expect(alternatives.length).toBeGreaterThan(assignmentRows(run, true).length);
    expect(hasCompetingAlternatives(run)).toBe(true);
    expect(alternatives.some((row) => row[7] === "false" && row[2].includes("ATL-01"))).toBe(true);

    const resultsCsv = exportNetworkScenarioComparisonCsv(run, "results");
    expect(resultsCsv).toContain("Scenario summary,Toronto,Transportation,6054.74");
    expect(resultsCsv).toContain("Warehouse summary,Toronto,TOR-01 - Toronto DC");
    expect(resultsCsv).toContain("Winning delivery assignment,Toronto,10001,TOR-01 - Toronto DC,Carrier A,428.97,428.97,0,428.97,1,2");
    expect(networkScenarioComparisonExportFilename(run, "results")).toBe("network-scenario-results-2026-08-01.csv");
    expect(networkScenarioComparisonExportFilename(run, "alternative-audit")).toBe("network-cost-audit-2026-08-01.csv");

    const summaryCsv = exportNetworkScenarioComparisonCsv(run, "summary");
    expect(summaryCsv).toContain("Scenario A modeled transportation");
    expect(summaryCsv).toContain("6054.74");
    expect(summaryCsv).toContain("3978.09");
    expect(summaryCsv).toContain("246054.74");
    expect(summaryCsv).toContain("423978.09");
    expect(summaryCsv).toContain("177923.35");
    expect(summaryCsv).toContain("42.0");

    const facilityCsv = exportNetworkScenarioComparisonCsv(run, "facility-summary");
    expect(facilityCsv).toContain("Delivery locations served");
    expect(facilityCsv).toContain("TOR-01 - Toronto DC");
    expect(facilityCsv).toContain("240000");
    expect(facilityCsv).toContain("30");

    const assignmentCsv = exportNetworkScenarioComparisonCsv(run, "delivery-assignments");
    expect(assignmentCsv).toContain("Scenario A assigned warehouse");
    expect(assignmentCsv).toContain("TOR-01 - Toronto DC,ATL-01 - Atlanta Proposed Warehouse");
    expect(assignmentCsv).not.toContain("Missing rate");

    const auditTable = buildNetworkScenarioComparisonCsvTable(run, "alternative-audit");
    expect(auditTable.rows[0]).toContain("Selected carrier");
    expect(auditTable.rows[0]).toContain("Selected rate");
    expect(auditTable.rows[0]).toContain("Represented pallets");
    expect(auditTable.rows[0]).toContain("Winning");
    expect(auditTable.rows.some((row) => row.includes("false"))).toBe(true);
    expect(auditTable.rows.some((row) => row.includes("Carrier A") && row.includes("428.97"))).toBe(true);
  });

  it("compares current and candidate warehouse annual operating costs without inventing missing values", () => {
    const facilities = warehouseCostOptionsFixture();
    const result = runWarehouseCostComparison({
      facilities,
      selectedFacilityOptionIds: ["CURRENT:TOR-01", "CURRENT:VAN-01", "CANDIDATE:CHI-01"]
    });

    expect(result.resultVersion).toBe("WAREHOUSE_COST_COMPARISON_V1");
    expect(result.selectedFacilityCount).toBe(3);
    expect(result.reportingCurrency).toBe("USD");
    expect(result.lowestFacilityOptionId).toBe("CURRENT:VAN-01");
    expect(result.facilities.map((facility) => [facility.optionId, facility.comparableAnnualWarehouseCost, facility.differenceFromLowest]).sort()).toEqual([
      ["CANDIDATE:CHI-01", 300000, 100000],
      ["CURRENT:TOR-01", 250000, 50000],
      ["CURRENT:VAN-01", 200000, 0]
    ].sort());
    expect(result.facilities.find((facility) => facility.optionId === "CANDIDATE:MTL-01")?.comparableAnnualWarehouseCost).toBeUndefined();
    expect(result.categoryRows[0].category).toBe("Annual facility / warehouse cost");
    expect(result.observations).toContain("Vancouver Warehouse has the lowest comparable annual warehouse cost.");
  });

  it("supports current/current, candidate/candidate, arbitrary multi-facility selection and missing warehouse cost display", () => {
    const facilities = warehouseCostOptionsFixture();
    const currentOnly = runWarehouseCostComparison({
      facilities,
      selectedFacilityOptionIds: ["CURRENT:TOR-01", "CURRENT:VAN-01"]
    });
    const candidateOnly = runWarehouseCostComparison({
      facilities,
      selectedFacilityOptionIds: ["CANDIDATE:CHI-01", "CANDIDATE:MTL-01"]
    });

    expect(currentOnly.facilities.map((facility) => facility.facilityType)).toEqual(["CURRENT", "CURRENT"]);
    expect(candidateOnly.facilities.map((facility) => facility.facilityType)).toEqual(["CANDIDATE", "CANDIDATE"]);
    expect(candidateOnly.facilities.find((facility) => facility.optionId === "CANDIDATE:MTL-01")?.comparableAnnualWarehouseCost).toBeNull();
    expect(candidateOnly.unavailableMessages).toEqual(["Montreal Candidate has no comparable annual warehouse cost supplied."]);
    expect(() => runWarehouseCostComparison({ facilities, selectedFacilityOptionIds: ["CURRENT:TOR-01"] })).toThrow("Select at least two facilities to compare warehouse costs.");
  });

  it("requires explicit CAD-to-USD conversion for mixed warehouse cost currencies", () => {
    const facilities = warehouseCostOptionsFixture();
    expect(() => runWarehouseCostComparison({
      facilities,
      selectedFacilityOptionIds: ["CURRENT:TOR-01", "CANDIDATE:CGY-01"]
    })).toThrow("Enter a CAD to USD conversion rate greater than 0 and no more than 5.");

    const result = runWarehouseCostComparison({
      facilities,
      selectedFacilityOptionIds: ["CURRENT:TOR-01", "CANDIDATE:CGY-01"],
      cadToUsdRate: 0.75
    });

    expect(result.currencyMode).toBe("CONVERTED_MIXED_CURRENCY");
    expect(result.reportingCurrency).toBe("USD");
    expect(result.cadToUsdRate).toBe(0.75);
    expect(result.facilities.find((facility) => facility.optionId === "CANDIDATE:CGY-01")?.comparableAnnualWarehouseCost).toBe(165000);
  });

  it("relaxes global mapping requirements while run actions keep model-specific requirements", () => {
    const definitionsSource = readFileSync("src/modules/supply-chain-design/mapping-definitions.ts", "utf8");
    const actionsSource = readFileSync("src/modules/supply-chain-design/actions.ts", "utf8");

    expect(definitionsSource).toContain('{ field: "facility_type", requirement: "OPTIONAL" }');
    expect(definitionsSource).toContain('{ field: "destination_id", requirement: "OPTIONAL" }');
    expect(definitionsSource).toContain('{ field: "city", requirement: "OPTIONAL" }');
    expect(actionsSource).toContain('"destination_id"');
    expect(actionsSource).toContain('"annual_pallets"');
    expect(actionsSource).toContain('"shipment_profile_id"');
  });

  it("persists the 3PL study type so failed runs can stay under the right workflow", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(providerComparisonActionProjectFixture());
    prismaMock.prisma.supplyChainDesignScreeningRun.create.mockResolvedValue({ id: "provider-run-1" });
    prismaMock.prisma.supplyChainDesignScreeningRun.findUnique.mockResolvedValue({ id: "provider-run-1" });

    await runSupplyChainDesignThreePlScreeningAction(
      { ok: false, message: "" },
      form({
        projectId: "project-1",
        studyName: "Warehouse benchmark",
        studyType: "COMPARE_KNOWN_WAREHOUSE_OPTIONS",
        demandPointsMappingId: "demand-mapping",
        providerOptionsMappingId: "provider-mapping",
        shipmentProfilesMappingId: "profile-mapping",
        outboundRateCacheMappingId: "rate-mapping"
      })
    );

    expect(prismaMock.prisma.supplyChainDesignScreeningRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inputReferences: expect.objectContaining({
            studyType: "COMPARE_KNOWN_WAREHOUSE_OPTIONS"
          })
        })
      })
    );
  });

  it("persists a successful provider-comparison run with selected input references", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(providerComparisonActionProjectFixture());
    prismaMock.prisma.supplyChainDesignScreeningRun.create.mockResolvedValue({ id: "provider-run-1" });
    prismaMock.prisma.supplyChainDesignScreeningRun.findUnique.mockResolvedValue({ id: "provider-run-1" });

    const result = await runSupplyChainDesignThreePlScreeningAction(
      { ok: false, message: "" },
      form({
        projectId: "project-1",
        studyName: "Warehouse benchmark",
        studyType: "COMPARE_KNOWN_WAREHOUSE_OPTIONS",
        demandPointsMappingId: "demand-mapping",
        providerOptionsMappingId: "provider-mapping",
        shipmentProfilesMappingId: "profile-mapping",
        outboundRateCacheMappingId: "rate-mapping",
        expectedProviderResultsMappingId: "expected-mapping"
      })
    );

    expect(result).toEqual({ ok: true, message: "3PL warehouse option comparison completed." });
    expect(prismaMock.prisma.supplyChainDesignScreeningRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          projectId: "project-1",
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          inputReferences: expect.objectContaining({
            demandPoints: expect.objectContaining({ fileName: "demand_points_us.csv", mappingId: "demand-mapping" }),
            providerOptions: expect.objectContaining({ fileName: "provider_options.csv", mappingId: "provider-mapping" }),
            shipmentProfiles: expect.objectContaining({ fileName: "shipment_profiles.csv", mappingId: "profile-mapping" }),
            outboundRateCache: expect.objectContaining({ fileName: "outbound_rate_cache.csv", mappingId: "rate-mapping" }),
            expectedProviderResults: expect.objectContaining({
              fileName: "expected_provider_results.csv",
              mappingId: "expected-mapping"
            })
          }),
          resultSummary: expect.objectContaining({
            resultVersion: "3PL_PROVIDER_COMPARISON_V1",
            recommendedOption: expect.objectContaining({
              providerOptionId: "P-DFW",
              totalAnnualCost: 1004856.8
            })
          }),
          createdByUserId: "user-1"
        })
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/supply-chain-design/project-1");
  });

  it("passes the selected SHIPMENT_PROFILES mapping and file into provider comparison", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(providerComparisonActionProjectFixture());
    prismaMock.prisma.supplyChainDesignScreeningRun.create.mockResolvedValue({ id: "provider-run-1" });
    prismaMock.prisma.supplyChainDesignScreeningRun.findUnique.mockResolvedValue({ id: "provider-run-1" });

    await runSupplyChainDesignThreePlScreeningAction(
      { ok: false, message: "" },
      form({
        projectId: "project-1",
        studyName: "Warehouse benchmark",
        studyType: "COMPARE_KNOWN_WAREHOUSE_OPTIONS",
        demandPointsMappingId: "demand-mapping",
        providerOptionsMappingId: "provider-mapping",
        shipmentProfilesMappingId: "profile-mapping",
        outboundRateCacheMappingId: "rate-mapping"
      })
    );

    expect(prismaMock.prisma.supplyChainDesignScreeningRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inputReferences: expect.objectContaining({
            shipmentProfiles: expect.objectContaining({
              fileId: "profile-mapping-file",
              fileName: "shipment_profiles.csv",
              mappingId: "profile-mapping"
            })
          }),
          resultSummary: expect.objectContaining({
            rateMatchEvidence: expect.arrayContaining([
              expect.objectContaining({
                shipmentProfileId: "LTL-2P",
                status: "MATCHED"
              })
            ])
          })
        })
      })
    );
  });

  it("returns a precise error when the selected shipment profiles mapping has the wrong table type", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue(providerComparisonActionProjectFixture());

    await expect(
      runSupplyChainDesignThreePlScreeningAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          studyName: "Warehouse benchmark",
          studyType: "COMPARE_KNOWN_WAREHOUSE_OPTIONS",
          demandPointsMappingId: "demand-mapping",
          providerOptionsMappingId: "provider-mapping",
          shipmentProfilesMappingId: "rate-mapping",
          outboundRateCacheMappingId: "rate-mapping"
        })
      )
    ).resolves.toEqual({
      ok: false,
      message: "Selected mapping rate-mapping has table type OUTBOUND_RATE_CACHE; expected SHIPMENT_PROFILES."
    });
  });

  it("returns a precise error when provider-comparison demand mapping is incomplete", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.MANAGER));
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValue({ moduleKey: ModuleKey.SUPPLY_CHAIN_DESIGN });
    prismaMock.prisma.tenantRoleModuleAccess.findMany.mockResolvedValue([]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...providerComparisonActionProjectFixture(),
      mappings: [
        actionMappingFixture("demand-mapping", "DEMAND_POINTS", "demand_points_us.csv", screeningDemandCsv(), demandFieldMappings()),
        ...providerComparisonActionProjectFixture().mappings.filter((mapping) => mapping.id !== "demand-mapping")
      ]
    });

    await expect(
      runSupplyChainDesignThreePlScreeningAction(
        { ok: false, message: "" },
        form({
          projectId: "project-1",
          studyName: "Warehouse benchmark",
          studyType: "COMPARE_KNOWN_WAREHOUSE_OPTIONS",
          demandPointsMappingId: "demand-mapping",
          providerOptionsMappingId: "provider-mapping",
          shipmentProfilesMappingId: "profile-mapping",
          outboundRateCacheMappingId: "rate-mapping"
        })
      )
    ).resolves.toEqual({
      ok: false,
      message:
        "Selected DEMAND_POINTS mapping demand-mapping is missing required mapped field(s): annual_pallets, shipment_profile_id."
    });
  });

  it("reports a missing demand shipment profile ID without blaming the selected shipment profiles file", () => {
    expect(() =>
      runSupplyChainDesignProviderComparison({
        ...providerComparisonInputFixture(),
        demandPoints: providerMappedFile(
          "demand_points_us.csv",
          screeningDemandCsv(),
          demandFieldMappings()
        )
      })
    ).toThrow("SCDS_3PL_DEMAND_SHIPMENT_PROFILE_MISSING: DEMAND_POINTS row D001 is missing shipment_profile_id.");
  });

  it("parses saved provider-comparison result JSON on the project query", async () => {
    const adminContext = context(PlatformRole.ADMIN);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      ...screeningProjectQueryFixture(adminContext),
      screeningRuns: [
        {
          id: "provider-run-1",
          status: "SUCCESS",
          createdAt,
          updatedAt,
          errorMessage: null,
          inputReferences: providerComparisonInputReferencesFixture(),
          resultSummary: runSupplyChainDesignProviderComparison(providerComparisonInputFixture())
        }
      ]
    });

    await expect(getSupplyChainDesignProject(adminContext, "project-1")).resolves.toMatchObject({
      latestScreeningRun: {
        id: "provider-run-1",
        resultReadError: null,
        inputReferences: {
          providerOptions: { fileName: "provider_options.csv", mappingId: "provider-mapping" },
          outboundRateCache: { fileName: "outbound_rate_cache.csv", mappingId: "rate-mapping" }
        },
        resultSummary: {
          resultVersion: "3PL_PROVIDER_COMPARISON_V1",
          recommendedOption: {
            providerOptionId: "P-DFW",
            totalAnnualCost: 1004856.8
          }
        }
      }
    });
  });
});

function screeningActionProjectFixture() {
  return {
    id: "project-1",
    mappings: [
      actionMappingFixture("demand-mapping", "DEMAND_POINTS", "demand.csv", screeningDemandCsv(), demandFieldMappings()),
      actionMappingFixture("market-mapping", "LOGISTICS_MARKETS", "markets.csv", screeningMarketCsv(), marketFieldMappings())
    ]
  };
}

function screeningProjectQueryFixture(adminContext: AuthenticatedContext) {
  return {
    id: "project-1",
    tenantId: adminContext.tenantId,
    name: "3PL screening",
    description: null,
    status: SupplyChainDesignProjectStatus.DRAFT,
    createdAt,
    updatedAt,
    createdBy: null,
    files: [
      fileSummaryFixture("demand-file", "demand_points_us.csv", "hash-demand", [
        {
          id: "demand-mapping",
          tableType: "DEMAND_POINTS",
          updatedAt,
          fieldMappings: testFieldMappings(demandFieldMappings())
        }
      ]),
      fileSummaryFixture("market-file", "logistics_markets.csv", "hash-market", [
        {
          id: "market-mapping",
          tableType: "LOGISTICS_MARKETS",
          updatedAt,
          fieldMappings: testFieldMappings(marketFieldMappings())
        }
      ])
    ],
    modelRuns: [],
    scenarios: [],
    screeningRuns: []
  };
}

describe("SCDS Candidate LTL Rate Preparation", () => {
  it("calculates approved full-month storage billing periods", () => {
    expect(calculateBillableStorageMonths(0)).toBe(1);
    expect(calculateBillableStorageMonths(1)).toBe(1);
    expect(calculateBillableStorageMonths(15)).toBe(1);
    expect(calculateBillableStorageMonths(30)).toBe(1);
    expect(calculateBillableStorageMonths(31)).toBe(2);
    expect(calculateBillableStorageMonths(45)).toBe(2);
    expect(calculateBillableStorageMonths(60)).toBe(2);
    expect(calculateBillableStorageMonths(61)).toBe(3);
  });

  it("calculates complete variable candidate warehouse cost for a prepared profile", () => {
    const result = calculateCandidateWarehouseCostForPreparedProfile({
      candidate: {
        facilityId: "CHI-3PL",
        facilitySourceType: "CANDIDATE",
        currency: "USD",
        inboundFeePerPallet: 5,
        outboundFeePerPallet: 4,
        storageFeePerPalletPerMonth: 10
      },
      profile: {
        profileKey: "profile-1",
        representedShipments: 1,
        representativePallets: 2,
        inventoryDwellTimeDays: 30,
        sourceLineage: [{ sourceRowId: "shipments-file:row-2", shipmentReference: "ORD-1001", representedShipments: 1 }]
      }
    });

    expect(result).toMatchObject({
      facilityId: "CHI-3PL",
      facilitySourceType: "CANDIDATE",
      warehouseCostBasis: "VARIABLE_3PL_RATES",
      status: "COMPLETE",
      currency: "USD",
      representedPallets: 2,
      representedShipments: 1,
      inboundCost: 10,
      outboundCost: 8,
      storageCost: 20,
      knownSubtotal: 38,
      completeWarehouseCost: 38,
      annualAllInCost: null,
      billableStorageMonths: 1,
      missingInputs: []
    });
  });

  it("multiplies prepared-profile warehouse cost by represented shipments", () => {
    const result = calculateCandidateWarehouseCostForPreparedProfile({
      candidate: {
        facilityId: "CHI-3PL",
        facilitySourceType: "CANDIDATE",
        currency: "USD",
        inboundFeePerPallet: 5,
        outboundFeePerPallet: 4,
        storageFeePerPalletPerMonth: 10
      },
      profile: {
        profileKey: "profile-10",
        representedShipments: 10,
        representativePallets: 2,
        inventoryDwellTimeDays: 30,
        sourceLineage: [{ sourceRowId: "shipments-file:row-5", shipmentReference: "AGG-10", representedShipments: 10 }]
      }
    });

    expect(result.representedPallets).toBe(20);
    expect(result.inboundCost).toBe(100);
    expect(result.outboundCost).toBe(80);
    expect(result.storageCost).toBe(200);
    expect(result.completeWarehouseCost).toBe(380);
  });

  it("bills different dwell source rows before aggregation", () => {
    const result = calculateCandidateWarehouseCostFromSourceRows({
      candidate: {
        facilityId: "CHI-3PL",
        facilitySourceType: "CANDIDATE",
        currency: "USD",
        inboundFeePerPallet: 0,
        outboundFeePerPallet: 0,
        storageFeePerPalletPerMonth: 10
      },
      sourceRows: [
        { sourceRowId: "shipments-file:row-2", shipmentReference: "A", representedShipments: 1, pallets: 1, inventoryDwellTimeDays: 15 },
        { sourceRowId: "shipments-file:row-3", shipmentReference: "B", representedShipments: 1, pallets: 1, inventoryDwellTimeDays: 45 }
      ]
    });

    expect(result.billingEvidence.map((row) => row.billableStorageMonths)).toEqual([1, 2]);
    expect(result.storageCost).toBe(30);
    expect(result.completeWarehouseCost).toBe(30);
  });

  it("uses annual all-in candidate warehouse cost as a separate basis without adding variable rates", () => {
    const result = calculateCandidateWarehouseCostForPreparedProfile({
      candidate: {
        facilityId: "CHI-3PL",
        facilitySourceType: "CANDIDATE",
        currency: "USD",
        annualFacilityWarehouseCost: 275000,
        inboundFeePerPallet: 5,
        outboundFeePerPallet: 4,
        storageFeePerPalletPerMonth: 10
      },
      profile: {
        profileKey: "profile-1",
        representedShipments: 10,
        representativePallets: 2,
        inventoryDwellTimeDays: 30,
        sourceLineage: [{ sourceRowId: "shipments-file:row-2", shipmentReference: "ORD-1001", representedShipments: 10 }]
      }
    });

    expect(result).toMatchObject({
      warehouseCostBasis: "ANNUAL_ALL_IN",
      status: "ANNUAL_ALL_IN",
      annualAllInCost: 275000,
      inboundCost: null,
      outboundCost: null,
      storageCost: null,
      completeWarehouseCost: null,
      knownSubtotal: 0
    });
  });

  it("returns incomplete variable evidence without inventing missing inputs", () => {
    const result = calculateCandidateWarehouseCostForPreparedProfile({
      candidate: {
        facilityId: "CHI-3PL",
        facilitySourceType: "CANDIDATE",
        currency: "USD",
        inboundFeePerPallet: 5,
        outboundFeePerPallet: 4,
        storageFeePerPalletPerMonth: null
      },
      profile: {
        profileKey: "profile-missing",
        representedShipments: 1,
        representativePallets: 2,
        inventoryDwellTimeDays: null,
        sourceLineage: [{ sourceRowId: "shipments-file:row-2", shipmentReference: "ORD-1001", representedShipments: 1 }]
      }
    });

    expect(result.status).toBe("INCOMPLETE_VARIABLE_COST");
    expect(result.completeWarehouseCost).toBeNull();
    expect(result.knownSubtotal).toBe(18);
    expect(result.inboundCost).toBe(10);
    expect(result.outboundCost).toBe(8);
    expect(result.storageCost).toBeNull();
    expect(result.missingInputs).toEqual(["inventory_dwell_time_days", "storage_fee_per_pallet_per_month"]);
  });

  it("marks missing pallet volume incomplete without falling back to other volume fields", () => {
    const result = calculateCandidateWarehouseCostForPreparedProfile({
      candidate: {
        facilityId: "CHI-3PL",
        facilitySourceType: "CANDIDATE",
        currency: "USD",
        inboundFeePerPallet: 5,
        outboundFeePerPallet: 4,
        storageFeePerPalletPerMonth: 10
      },
      profile: {
        profileKey: "profile-no-pallets",
        representedShipments: 1,
        representativePallets: null,
        inventoryDwellTimeDays: 30,
        sourceLineage: [{ sourceRowId: "shipments-file:row-2", shipmentReference: "ORD-1001", representedShipments: 1 }]
      }
    });

    expect(result.status).toBe("INCOMPLETE_VARIABLE_COST");
    expect(result.knownSubtotal).toBe(0);
    expect(result.missingInputs).toEqual(["pallets"]);
  });

  it("exposes current-facility annual warehouse cost without inventing variable 3PL rates", () => {
    const result = calculateCurrentFacilityWarehouseCostBasis({
      facilityId: "TOR-01",
      facilitySourceType: "CURRENT",
      currency: "CAD",
      annualFacilityWarehouseCost: 240000
    });

    expect(result).toMatchObject({
      facilityId: "TOR-01",
      facilitySourceType: "CURRENT",
      warehouseCostBasis: "ANNUAL_ALL_IN",
      status: "ANNUAL_ALL_IN",
      currency: "CAD",
      annualAllInCost: 240000,
      inboundCost: null,
      outboundCost: null,
      storageCost: null
    });
  });

  it("preserves candidate warehouse-cost currency without FX conversion", () => {
    const result = calculateCandidateWarehouseCostForPreparedProfile({
      candidate: {
        facilityId: "MTL-01",
        facilitySourceType: "CANDIDATE",
        currency: "CAD",
        inboundFeePerPallet: 5,
        outboundFeePerPallet: 4,
        storageFeePerPalletPerMonth: 10
      },
      profile: {
        profileKey: "profile-cad",
        representedShipments: 1,
        representativePallets: 1,
        inventoryDwellTimeDays: 0,
        sourceLineage: [{ sourceRowId: "shipments-file:row-2", shipmentReference: "ORD-CA", representedShipments: 1 }]
      }
    });

    expect(result.currency).toBe("CAD");
    expect(result.completeWarehouseCost).toBe(19);
  });

  it("selects variable-rate scenario winners by modeled transport plus variable warehouse cost", () => {
    const result = evaluateSupplyChainDesignCombinedScenarioCost({
      scenarioId: "scenario-variable",
      scenarioName: "Variable only",
      transportationCurrency: "USD",
      transportationEvaluation: combinedTransportationFixture([
        combinedProfileFixture("profile-1", [
          combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", 100),
          combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", 120)
        ])
      ]),
      selectedFacilities: [
        candidateCombinedFacility("A-3PL", "A Warehouse", { inboundFeePerPallet: 5, outboundFeePerPallet: 5, storageFeePerPalletPerMonth: 10 }),
        candidateCombinedFacility("B-3PL", "B Warehouse", { inboundFeePerPallet: 2, outboundFeePerPallet: 1, storageFeePerPalletPerMonth: 2 })
      ],
      warehouseCostProfilesByProfileKey: {
        "profile-1": combinedWarehouseProfile("profile-1", { representativePallets: 2, representedShipments: 1, inventoryDwellTimeDays: 30 })
      }
    });

    expect(result.profileResults[0].winnerFacilityId).toBe("B-3PL");
    expect(result.profileResults[0].alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ facilityId: "A-3PL", modeledTransportationCost: 100, variableWarehouseCost: 40, combinedAssignmentCost: 140, winning: false }),
        expect.objectContaining({ facilityId: "B-3PL", modeledTransportationCost: 120, variableWarehouseCost: 10, combinedAssignmentCost: 130, winning: true })
      ])
    );
    expect(result).toMatchObject({
      status: "COMPLETE",
      modeledTransportationCost: 120,
      variableWarehouseCost: 10,
      annualAllInWarehouseCost: 0,
      totalWarehouseCost: 10,
      totalNetworkCost: 130
    });
  });

  it("uses annual-all-in transportation assignment and counts every selected annual facility once", () => {
    const result = evaluateSupplyChainDesignCombinedScenarioCost({
      scenarioId: "scenario-annual",
      scenarioName: "Annual all-in",
      transportationCurrency: "USD",
      transportationEvaluation: combinedTransportationFixture([
        combinedProfileFixture("profile-1", [
          combinedAlternativeFixture("profile-1", "ANN-A", "Annual A", 100),
          combinedAlternativeFixture("profile-1", "ANN-B", "Annual B", 150)
        ])
      ]),
      selectedFacilities: [
        candidateCombinedFacility("ANN-A", "Annual A", { annualFacilityWarehouseCost: 200000, inboundFeePerPallet: 999 }),
        candidateCombinedFacility("ANN-B", "Annual B", { annualFacilityWarehouseCost: 300000, inboundFeePerPallet: 999 })
      ],
      warehouseCostProfilesByProfileKey: {
        "profile-1": combinedWarehouseProfile("profile-1")
      }
    });

    expect(result.profileResults[0].winnerFacilityId).toBe("ANN-A");
    expect(result.profileResults[0].alternatives.find((alternative) => alternative.facilityId === "ANN-A")).toMatchObject({
      warehouseCostBasis: "ANNUAL_ALL_IN",
      warehouseCostUsedForAssignment: 0,
      annualAllInCost: 200000,
      combinedAssignmentCost: 100
    });
    expect(result.facilityTotals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ facilityId: "ANN-A", representedShipments: 1, annualAllInWarehouseCost: 200000, totalFacilityContribution: 200100 }),
        expect.objectContaining({ facilityId: "ANN-B", representedShipments: 0, annualAllInWarehouseCost: 300000, totalFacilityContribution: 300000 })
      ])
    );
    expect(result.totalWarehouseCost).toBe(500000);
    expect(result.totalNetworkCost).toBe(500100);
  });

  it("supports mixed annual-current and variable-candidate cost bases without double counting", () => {
    const result = evaluateSupplyChainDesignCombinedScenarioCost({
      scenarioId: "scenario-mixed-basis",
      scenarioName: "Mixed basis",
      transportationCurrency: "USD",
      transportationEvaluation: combinedTransportationFixture([
        combinedProfileFixture("profile-1", [
          combinedAlternativeFixture("profile-1", "TOR-01", "Toronto Current", 80, "CURRENT"),
          combinedAlternativeFixture("profile-1", "CHI-3PL", "Chicago 3PL", 60)
        ]),
        combinedProfileFixture("profile-2", [
          combinedAlternativeFixture("profile-2", "TOR-01", "Toronto Current", 200, "CURRENT"),
          combinedAlternativeFixture("profile-2", "CHI-3PL", "Chicago 3PL", 100)
        ])
      ]),
      selectedFacilities: [
        currentCombinedFacility("TOR-01", "Toronto Current", { annualFacilityWarehouseCost: 200000 }),
        candidateCombinedFacility("CHI-3PL", "Chicago 3PL", { inboundFeePerPallet: 5, outboundFeePerPallet: 5, storageFeePerPalletPerMonth: 10 })
      ],
      warehouseCostProfilesByProfileKey: {
        "profile-1": combinedWarehouseProfile("profile-1", { representativePallets: 2, representedShipments: 1, inventoryDwellTimeDays: 30 }),
        "profile-2": combinedWarehouseProfile("profile-2", { representativePallets: 2, representedShipments: 1, inventoryDwellTimeDays: 30 })
      }
    });

    expect(result.profileResults.map((profile) => profile.winnerFacilityId)).toEqual(["TOR-01", "CHI-3PL"]);
    expect(result.modeledTransportationCost).toBe(180);
    expect(result.variableWarehouseCost).toBe(40);
    expect(result.annualAllInWarehouseCost).toBe(200000);
    expect(result.totalWarehouseCost).toBe(200040);
    expect(result.totalNetworkCost).toBe(200220);
  });

  it("retains incomplete alternatives without choosing a winner or dropping represented volume", () => {
    const result = evaluateSupplyChainDesignCombinedScenarioCost({
      scenarioId: "scenario-incomplete",
      scenarioName: "Incomplete",
      transportationCurrency: "USD",
      transportationEvaluation: combinedTransportationFixture([
        combinedProfileFixture("profile-1", [
          combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", null, "CANDIDATE", "MISSING_RATE"),
          combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", 100)
        ], { representedShipments: 3 })
      ]),
      selectedFacilities: [
        candidateCombinedFacility("A-3PL", "A Warehouse", { inboundFeePerPallet: 5, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: 10 }),
        candidateCombinedFacility("B-3PL", "B Warehouse", { inboundFeePerPallet: 5, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: null })
      ],
      warehouseCostProfilesByProfileKey: {
        "profile-1": combinedWarehouseProfile("profile-1", { representativePallets: 2, representedShipments: 3, inventoryDwellTimeDays: null })
      }
    });

    expect(result.status).toBe("INCOMPLETE_MULTIPLE_REASONS");
    expect(result.profileResults[0].winnerFacilityId).toBeNull();
    expect(result.assignedRepresentedShipments).toBe(0);
    expect(result.incompleteRepresentedShipments).toBe(3);
    expect(result.profileResults[0].alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ facilityId: "A-3PL", complete: false, missingReasons: expect.arrayContaining(["modeled_transportation_rate"]) }),
        expect.objectContaining({ facilityId: "B-3PL", complete: false, missingReasons: expect.arrayContaining(["inventory_dwell_time_days", "storage_fee_per_pallet_per_month"]) })
      ])
    );
  });

  it("uses deterministic combined-cost, transportation-cost, then facility-ID tie breaks", () => {
    const result = evaluateSupplyChainDesignCombinedScenarioCost({
      scenarioId: "scenario-tie",
      scenarioName: "Tie",
      transportationCurrency: "USD",
      transportationEvaluation: combinedTransportationFixture([
        combinedProfileFixture("profile-1", [
          combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", 100),
          combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", 90),
          combinedAlternativeFixture("profile-1", "C-3PL", "C Warehouse", 90)
        ])
      ]),
      selectedFacilities: [
        candidateCombinedFacility("A-3PL", "A Warehouse", { inboundFeePerPallet: 0, outboundFeePerPallet: 0, storageFeePerPalletPerMonth: 0 }),
        candidateCombinedFacility("B-3PL", "B Warehouse", { inboundFeePerPallet: 5, outboundFeePerPallet: 0, storageFeePerPalletPerMonth: 0 }),
        candidateCombinedFacility("C-3PL", "C Warehouse", { inboundFeePerPallet: 5, outboundFeePerPallet: 0, storageFeePerPalletPerMonth: 0 })
      ],
      warehouseCostProfilesByProfileKey: {
        "profile-1": combinedWarehouseProfile("profile-1", { representativePallets: 2, representedShipments: 1, inventoryDwellTimeDays: 30 })
      }
    });

    expect(result.profileResults[0].alternatives.map((alternative) => ({
      facilityId: alternative.facilityId,
      combined: alternative.combinedAssignmentCost
    }))).toEqual([
      { facilityId: "A-3PL", combined: 100 },
      { facilityId: "B-3PL", combined: 100 },
      { facilityId: "C-3PL", combined: 100 }
    ]);
    expect(result.profileResults[0].winnerFacilityId).toBe("B-3PL");
  });

  it("blocks mixed-currency scenario totals without applying FX assumptions", () => {
    const result = evaluateSupplyChainDesignCombinedScenarioCost({
      scenarioId: "scenario-currency",
      scenarioName: "Mixed currency",
      transportationCurrency: "USD",
      transportationEvaluation: combinedTransportationFixture([
        combinedProfileFixture("profile-1", [
          combinedAlternativeFixture("profile-1", "MTL-01", "Montreal 3PL", 100)
        ])
      ]),
      selectedFacilities: [
        candidateCombinedFacility("MTL-01", "Montreal 3PL", {
          currency: "CAD",
          inboundFeePerPallet: 5,
          outboundFeePerPallet: 4,
          storageFeePerPalletPerMonth: 10
        })
      ],
      warehouseCostProfilesByProfileKey: {
        "profile-1": combinedWarehouseProfile("profile-1")
      }
    });

    expect(result.status).toBe("INCOMPLETE_MIXED_CURRENCY");
    expect(result.currenciesRequiringConversion).toEqual(["CAD", "USD"]);
    expect(result.totalNetworkCost).toBeNull();
    expect(result.profileResults[0].winnerFacilityId).toBeNull();
  });

  it("orchestrates a no-missing scenario directly into combined-cost evaluation without creating a batch", async () => {
    const transportationEvaluation = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [
        combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", 100)
      ])
    ]);
    const createMissingRateBatch = vi.fn();

    const result = await orchestrateSupplyChainDesignNetworkScenarioMissingRates(
      orchestrationInputFixture(transportationEvaluation, {
        selectedFacilities: [
          candidateCombinedFacility("A-3PL", "A Warehouse", { inboundFeePerPallet: 5, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: 10 })
        ]
      }),
      {
        evaluateTransportation: vi.fn().mockResolvedValue(transportationEvaluation),
        createMissingRateBatch
      }
    );

    expect(result.phase).toBe("COMPLETE");
    expect(createMissingRateBatch).not.toHaveBeenCalled();
    expect(result.combinedCostEvaluation?.totalNetworkCost).toBe(138);
    expect(result.counts).toMatchObject({
      totalScenarioAlternatives: 1,
      exactReusedAlternatives: 1,
      uniqueMissingRequests: 0,
      liveRequestsRemaining: 0,
      profilesWithAtLeastOneCompleteAlternative: 1
    });
  });

  it("creates only deduplicated missing scenario requests and preserves affected lineage", async () => {
    const missingManifest = [
      scenarioMissingRate("fingerprint-a", [
        { profileKey: "profile-1", sourceReference: "profile-1-source", originFacilityId: "A-3PL", originSourceType: "CANDIDATE" as const, representedShipments: 1 },
        { profileKey: "profile-1-duplicate", sourceReference: "profile-1-source-copy", originFacilityId: "A-3PL", originSourceType: "CANDIDATE" as const, representedShipments: 1 }
      ]),
      scenarioMissingRate("fingerprint-current", [
        { profileKey: "profile-2", sourceReference: "profile-2-source", originFacilityId: "TOR-01", originSourceType: "CURRENT" as const, representedShipments: 2 }
      ])
    ];
    const transportationEvaluation = {
      ...combinedTransportationFixture([
        combinedProfileFixture("profile-1", [
          combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", 100),
          combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", null, "CANDIDATE", "MISSING_RATE")
        ]),
        combinedProfileFixture("profile-2", [
          combinedAlternativeFixture("profile-2", "TOR-01", "Toronto Current", null, "CURRENT", "MISSING_RATE"),
          combinedAlternativeFixture("profile-2", "A-3PL", "A Warehouse", 120)
        ])
      ]),
      missingRateManifest: missingManifest,
      missingRateCount: 2
    };
    const createMissingRateBatch = vi.fn().mockResolvedValue({
      jobId: "scenario-batch-1",
      account: sevenLAccountFixture(),
      shouldProcess: true,
      input: {
        requests: missingManifest.map((missing) => ({
          rateRequestKey: missing.laneFingerprint,
          scenarioLineage: {
            scenarioId: "scenario-1",
            exactLaneFingerprint: missing.laneFingerprint,
            affectedAlternatives: missing.affectedAlternatives
          }
        }))
      }
    });

    const result = await orchestrateSupplyChainDesignNetworkScenarioMissingRates(
      orchestrationInputFixture(transportationEvaluation),
      {
        evaluateTransportation: vi.fn().mockResolvedValue(transportationEvaluation),
        createMissingRateBatch
      }
    );

    expect(result.phase).toBe("RATING");
    expect(createMissingRateBatch).toHaveBeenCalledTimes(1);
    expect(createMissingRateBatch.mock.calls[0][0].missingRateManifest).toHaveLength(2);
    expect(result.missingRateBatch).toMatchObject({ jobId: "scenario-batch-1", requestCount: 2, shouldProcess: true });
    expect(result.lineage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exactLaneFingerprint: "fingerprint-a",
          batchId: "scenario-batch-1",
          affectedAlternatives: expect.arrayContaining([
            expect.objectContaining({ profileKey: "profile-1" }),
            expect.objectContaining({ profileKey: "profile-1-duplicate" })
          ])
        }),
        expect.objectContaining({
          exactLaneFingerprint: "fingerprint-current",
          affectedAlternatives: [expect.objectContaining({ originFacilityId: "TOR-01", originSourceType: "CURRENT" })]
        })
      ])
    );
    expect(result.counts).toMatchObject({
      totalScenarioAlternatives: 4,
      exactReusedAlternatives: 2,
      uniqueMissingRequests: 2,
      liveRequestsRemaining: 2
    });
  });

  it("is idempotent after exact reuse resolves all scenario alternatives", async () => {
    const transportationEvaluation = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [
        combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", 100)
      ])
    ]);
    const createMissingRateBatch = vi.fn();
    const input = orchestrationInputFixture(transportationEvaluation);

    const first = await orchestrateSupplyChainDesignNetworkScenarioMissingRates(input, {
      evaluateTransportation: vi.fn().mockResolvedValue(transportationEvaluation),
      createMissingRateBatch
    });
    const second = await orchestrateSupplyChainDesignNetworkScenarioMissingRates(input, {
      evaluateTransportation: vi.fn().mockResolvedValue(transportationEvaluation),
      createMissingRateBatch
    });

    expect(first.phase).toBe("COMPLETE");
    expect(second.phase).toBe("COMPLETE");
    expect(createMissingRateBatch).not.toHaveBeenCalled();
  });

  it("keeps warehouse and currency incompleteness separate from missing-rate orchestration", async () => {
    const transportationEvaluation = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [
        combinedAlternativeFixture("profile-1", "MTL-01", "Montreal 3PL", 100)
      ])
    ]);
    const createMissingRateBatch = vi.fn();
    const result = await orchestrateSupplyChainDesignNetworkScenarioMissingRates(
      orchestrationInputFixture(transportationEvaluation, {
        selectedFacilities: [
          candidateCombinedFacility("MTL-01", "Montreal 3PL", {
            currency: "CAD",
            inboundFeePerPallet: 5,
            outboundFeePerPallet: 4,
            storageFeePerPalletPerMonth: null
          })
        ],
        warehouseCostProfilesByProfileKey: {
          "profile-1": combinedWarehouseProfile("profile-1", { inventoryDwellTimeDays: null })
        }
      }),
      {
        evaluateTransportation: vi.fn().mockResolvedValue(transportationEvaluation),
        createMissingRateBatch
      }
    );

    expect(result.phase).toBe("INCOMPLETE");
    expect(result.combinedCostEvaluation?.status).toBe("INCOMPLETE_MULTIPLE_REASONS");
    expect(result.counts.uniqueMissingRequests).toBe(0);
    expect(createMissingRateBatch).not.toHaveBeenCalled();
  });

  it("updates Network Scenario Comparison lifecycle records with tenant and project scope", async () => {
    const existing = networkScenarioComparisonRunRecord({ id: "comparison-1", status: "EVALUATING", resultSummary: null });
    const updated = networkScenarioComparisonRunRecord({
      id: "comparison-1",
      status: "COMPLETE",
      resultSummary: networkScenarioComparisonResultSummary({ totalDifference: -50 })
    });
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findUnique.mockResolvedValue(existing);
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.update.mockResolvedValue(updated);

    const result = await updateNetworkScenarioComparisonRunLifecycle(context(PlatformRole.ADMIN), "project-1", "comparison-1", {
      status: "COMPLETE",
      resultSummary: networkScenarioComparisonResultSummary({ totalDifference: -50 }),
      errorMessage: null
    });

    expect(prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "comparison-1" } },
      data: expect.objectContaining({ status: "COMPLETE", errorMessage: null })
    });
    expect(result.status).toBe("COMPLETE");
    expect(result.resultSummary?.comparison.totalDifference).toBe(-50);
  });

  it("starts Network Scenario Comparison with the actual account-query shape without accounts.find failure", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({
      id: "project-1",
      mappings: [
        actionMappingFixture("shipments-mapping", "SHIPMENTS", "historical-shipments.csv", ltlShipmentsCsv(), ltlShipmentFieldMappings()),
        actionMappingFixture("facilities-mapping", "FACILITIES", "current-facilities.csv", [
          "Facility ID,Facility Name,Facility Type,Facility ZIP / Postal Code,City,State/Province,Country,Annual Facility / Warehouse Cost,Currency",
          "TOR-01,Toronto DC,Owned,M5V 2T6,Toronto,ON,CA,240000,CAD"
        ].join("\n"), [
          ["facility_id", "Facility ID"],
          ["facility_name", "Facility Name"],
          ["facility_type", "Facility Type"],
          ["postal_code", "Facility ZIP / Postal Code"],
          ["city", "City"],
          ["state_province", "State/Province"],
          ["country", "Country"],
          ["annual_facility_warehouse_cost", "Annual Facility / Warehouse Cost"],
          ["currency", "Currency"]
        ]),
        actionMappingFixture("candidate-mapping", "CANDIDATE_FACILITIES", "candidate-warehouses.csv", ltlCandidateCsv(), ltlCandidateFieldMappings())
      ]
    });
    prismaMock.prisma.integrationCredential.findMany.mockResolvedValue([
      {
        id: "live-account-1",
        tenantId: "tenant-1",
        provider: IntegrationProvider.SEVEN_L,
        name: "Live 7L",
        status: IntegrationStatus.ACTIVE,
        secretRef: "secret/live-7l",
        publicConfig: {
          dryRun: false,
          carriers: [{ carrierHash: "carrier-a", name: "Carrier A", code: "CA", scac: "CARA", enabled: true }]
        }
      }
    ]);
    prismaMock.prisma.ltlBatchQuoteLane.findUnique.mockResolvedValue(null);
    prismaMock.prisma.automationJobRun.create.mockResolvedValue({ id: "comparison-batch-1" });
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.create.mockImplementation(({ data }: any) =>
      Promise.resolve(networkScenarioComparisonRunRecord({
        id: "comparison-run-1",
        status: data.status,
        inputReferences: data.inputReferences,
        scenarioInputs: data.scenarioInputs,
        ratingEvidence: data.ratingEvidence,
        fxInput: data.fxInput,
        resultSummary: data.resultSummary,
        comparisonFingerprint: data.comparisonFingerprint,
        transportationFingerprint: data.transportationFingerprint
      }))
    );
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(networkScenarioComparisonRunRecord({ id: where.tenantId_id.id, status: "EVALUATING", resultSummary: null }))
    );
    prismaMock.prisma.supplyChainDesignNetworkScenarioComparisonRun.update.mockImplementation(({ data }: any) =>
      Promise.resolve(networkScenarioComparisonRunRecord({
        id: "comparison-run-1",
        status: data.status,
        ratingEvidence: data.ratingEvidence ?? networkScenarioComparisonCreateInput().ratingEvidence,
        fxInput: data.fxInput ?? null,
        resultSummary: data.resultSummary ?? null,
        errorMessage: data.errorMessage ?? null
      }))
    );

    const result = await runSupplyChainDesignNetworkScenarioComparisonAction(
      { ok: false, message: "" },
      form({
        projectId: "project-1",
        shipmentsMappingId: "shipments-mapping",
        facilitiesMappingId: "facilities-mapping",
        candidateFacilitiesMappingId: "candidate-mapping",
        scenarioAName: "Keep Toronto",
        scenarioBName: "Try Cincinnati",
        cadToUsdRate: "0.75",
        scenarioAFacilityOptionIds: "CURRENT:TOR-01",
        scenarioBFacilityOptionIds: "CANDIDATE:CVG-01"
      })
    );

    expect(result.message).not.toContain("accounts.find is not a function");
    expect(result.submittedNetworkScenarioComparison).toMatchObject({
      shipmentsMappingId: "shipments-mapping",
      facilitiesMappingId: "facilities-mapping",
      candidateFacilitiesMappingId: "candidate-mapping",
      scenarioAName: "Keep Toronto",
      scenarioBName: "Try Cincinnati",
      scenarioAFacilityOptionIds: ["CURRENT:TOR-01"],
      scenarioBFacilityOptionIds: ["CANDIDATE:CVG-01"],
      cadToUsdRate: "0.75"
    });
    expect(prismaMock.prisma.automationJobRun.create).toHaveBeenCalled();
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("rejects Network Scenario Comparison inputs that do not share one Historical Shipments source", async () => {
    const input = comparisonOrchestrationFixture();
    input.scenarioB.transportationInput.shipments.fileId = "different-shipments-file";

    await expect(orchestrateSupplyChainDesignNetworkScenarioComparison(input, {
      findCompletedRun: vi.fn(),
      findActiveRun: vi.fn(),
      createRun: vi.fn(),
      updateRun: vi.fn(),
      evaluateTransportation: vi.fn()
    })).rejects.toThrow("Network Scenario Comparison scenarios must use the same Historical Shipments source.");
  });

  it("deduplicates identical missing exact requests across Scenario A and Scenario B and preserves side lineage", async () => {
    const missingA = scenarioMissingRate("shared-fingerprint", [
      { profileKey: "profile-1", sourceReference: "a-source", originFacilityId: "CVG-01", originSourceType: "CANDIDATE", representedShipments: 1 }
    ]);
    const missingB = scenarioMissingRate("shared-fingerprint", [
      { profileKey: "profile-1", sourceReference: "b-source", originFacilityId: "CVG-01", originSourceType: "CANDIDATE", representedShipments: 1 }
    ]);
    const deduped = dedupeComparisonMissingRateManifest([
      { ...comparisonScenarioWorkFixture("A"), transportationEvaluation: { ...comparisonScenarioWorkFixture("A").transportationEvaluation, missingRateManifest: [missingA] } },
      { ...comparisonScenarioWorkFixture("B"), transportationEvaluation: { ...comparisonScenarioWorkFixture("B").transportationEvaluation, missingRateManifest: [missingB] } }
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].affectedAlternatives).toEqual([
      expect.objectContaining({ scenarioKey: "A", scenarioName: "Scenario A", sourceReference: "a-source" }),
      expect.objectContaining({ scenarioKey: "B", scenarioName: "Scenario B", sourceReference: "b-source" })
    ]);
  });

  it("creates one shared missing-rate batch for unique cross-scenario requests", async () => {
    const input = comparisonOrchestrationFixture();
    const run = networkScenarioComparisonRunRecord({ id: "comparison-1", status: "EVALUATING", resultSummary: null });
    const ratingRun = networkScenarioComparisonRunRecord({ id: "comparison-1", status: "RATING", resultSummary: null });
    const sharedMissing = scenarioMissingRate("shared-fingerprint", [
      { profileKey: "profile-1", sourceReference: "source", originFacilityId: "CVG-01", originSourceType: "CANDIDATE", representedShipments: 1 }
    ]);
    const evalA = {
      ...combinedTransportationFixture([combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "CVG-01", "Cincinnati", null, "CANDIDATE", "MISSING_RATE")])]),
      missingRateManifest: [sharedMissing]
    };
    const evalB = {
      ...combinedTransportationFixture([combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "CVG-01", "Cincinnati", null, "CANDIDATE", "MISSING_RATE")])]),
      missingRateManifest: [sharedMissing]
    };
    const createMissingRateBatch = vi.fn().mockResolvedValue({
      jobId: "comparison-batch-1",
      shouldProcess: true,
      account: input.account,
      input: { requests: [{ rateRequestKey: "shared-fingerprint" }] }
    });
    const processRateBatch = vi.fn();

    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison(input, {
      findCompletedRun: vi.fn().mockResolvedValue(null),
      findActiveRun: vi.fn().mockResolvedValue(null),
      createRun: vi.fn().mockResolvedValue(run),
      updateRun: vi.fn().mockResolvedValue(ratingRun),
      evaluateTransportation: vi.fn()
        .mockResolvedValueOnce(evalA)
        .mockResolvedValueOnce(evalB),
      createMissingRateBatch,
      processRateBatch
    });
    await Promise.resolve();

    expect(result.phase).toBe("RATING");
    expect(createMissingRateBatch).toHaveBeenCalledTimes(1);
    expect(processRateBatch).toHaveBeenCalledTimes(1);
    expect(processRateBatch).toHaveBeenCalledWith(
      { tenantId: "tenant-1", userId: "user-1" },
      "comparison-batch-1",
      input.account,
      { requests: [{ rateRequestKey: "shared-fingerprint" }] }
    );
    expect(createMissingRateBatch.mock.calls[0][0]).toMatchObject({
      scenarioId: "comparison:comparison-1",
      missingRateManifest: [
        expect.objectContaining({
          laneFingerprint: "shared-fingerprint",
          affectedAlternatives: expect.arrayContaining([
            expect.objectContaining({ scenarioKey: "A" }),
            expect.objectContaining({ scenarioKey: "B" })
          ])
        })
      ]
    });
    expect(result.ratingEvidence.reconciliation.uniqueMissingLiveRequests).toBe(1);
  });

  it("places missing CURRENT scenario requests into the shared LTL batch while preserving CURRENT lineage", async () => {
    const missing = scenarioMissingRate("toronto-fingerprint", [
      {
        profileKey: "profile-toronto",
        sourceReference: "ORD-1001",
        originFacilityId: "TOR-01",
        originSourceType: "CURRENT",
        representedShipments: 1,
        scenarioKey: "A",
        scenarioName: "Toronto only"
      }
    ]);
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValue({ id: "project-1" });
    prismaMock.prisma.automationJobRun.create.mockResolvedValue({ id: "scenario-batch-1" });
    prismaMock.prisma.auditLog.create.mockResolvedValue({});

    const batch = await createSupplyChainDesignScenarioMissingRateBatch({
      context: context(PlatformRole.ADMIN),
      projectId: "project-1",
      scenarioId: "comparison:comparison-1",
      scenarioName: "Scenario A vs Scenario B",
      account: sevenLAccountRecordsFixture()[1],
      carrierHashes: ["carrier-a", "frontline-hash"],
      missingRateManifest: [missing]
    });

    expect(batch.shouldProcess).toBe(true);
    expect(batch.input.preparationRunId).toBe("scenario:comparison:comparison-1");
    expect(batch.input.requests[0]).toMatchObject({
      rateRequestKey: "toronto-fingerprint",
      candidateFacilityId: "TOR-01",
      candidateFacilityName: "CURRENT TOR-01",
      originalFacilityId: "TOR-01",
      representedShipments: 1,
      scenarioLineage: expect.objectContaining({
        scenarioKey: "A",
        comparisonRunId: "comparison-1",
        originFacilityId: "TOR-01",
        originSourceType: "CURRENT",
        exactLaneFingerprint: "toronto-fingerprint"
      })
    });
    expect(prismaMock.prisma.automationJobRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          input: expect.objectContaining({
            preparationRunId: "scenario:comparison:comparison-1",
            requests: [expect.objectContaining({
              scenarioLineage: expect.objectContaining({ originSourceType: "CURRENT" })
            })]
          })
        })
      })
    );
  });

  it("runs two-scenario combined-cost evaluation without a batch when all transport is reusable", async () => {
    const input = comparisonOrchestrationFixture();
    const run = networkScenarioComparisonRunRecord({ id: "comparison-1", status: "EVALUATING", resultSummary: null });
    const completeRun = networkScenarioComparisonRunRecord({ id: "comparison-1", status: "COMPLETE" });
    const evalA = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", 100)])
    ]);
    const evalB = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", 80)])
    ]);
    const createMissingRateBatch = vi.fn();

    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison(input, {
      findCompletedRun: vi.fn().mockResolvedValue(null),
      findActiveRun: vi.fn().mockResolvedValue(null),
      createRun: vi.fn().mockResolvedValue(run),
      updateRun: vi.fn().mockResolvedValue(completeRun),
      evaluateTransportation: vi.fn()
        .mockResolvedValueOnce(evalA)
        .mockResolvedValueOnce(evalB),
      createMissingRateBatch
    });

    expect(result.phase).toBe("COMPLETE");
    expect(createMissingRateBatch).not.toHaveBeenCalled();
    expect(result.resultSummary?.comparison).toMatchObject({
      differenceFormula: "Scenario B total network cost - Scenario A total network cost",
      lowerCostScenario: "B"
    });
    expect(result.resultSummary?.scenarioA.totalNetworkCost).toBe(138);
    expect(result.resultSummary?.scenarioB.totalNetworkCost).toBe(118);
  });

  it("keeps one scenario profile per eligible LTL source and reconciles Atlanta represented transportation once", async () => {
    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison(
      comparisonOrchestrationFixture({
        scenarioACombined: {
          selectedFacilities: [
            candidateCombinedFacility("ATL-01", "Atlanta Proposed Warehouse", { annualFacilityWarehouseCost: 420000 })
          ],
          warehouseCostProfilesByProfileKey: {
            "atl-ord-1001": combinedWarehouseProfile("atl-ord-1001", { representedShipments: 1 }),
            "atl-ord-2001": combinedWarehouseProfile("atl-ord-2001", { representedShipments: 1 }),
            "atl-row-5": combinedWarehouseProfile("atl-row-5", { representedShipments: 25 })
          }
        },
        scenarioBCombined: {
          selectedFacilities: [
            candidateCombinedFacility("ATL-01", "Atlanta Proposed Warehouse", { annualFacilityWarehouseCost: 420000 })
          ],
          warehouseCostProfilesByProfileKey: {
            "atl-ord-1001": combinedWarehouseProfile("atl-ord-1001", { representedShipments: 1 }),
            "atl-ord-2001": combinedWarehouseProfile("atl-ord-2001", { representedShipments: 1 }),
            "atl-row-5": combinedWarehouseProfile("atl-row-5", { representedShipments: 25 })
          }
        }
      }),
      comparisonOrchestrationDeps(
        combinedTransportationFixture([
          combinedProfileFixture("atl-ord-1001", [combinedAlternativeFixture("atl-ord-1001", "ATL-01", "Atlanta Proposed Warehouse", 262.89)], { representedShipments: 1 }),
          combinedProfileFixture("atl-ord-2001", [combinedAlternativeFixture("atl-ord-2001", "ATL-01", "Atlanta Proposed Warehouse", 173.95)], { representedShipments: 1 }),
          combinedProfileFixture("atl-row-5", [combinedAlternativeFixture("atl-row-5", "ATL-01", "Atlanta Proposed Warehouse", 3541.25)], { representedShipments: 25 })
        ]),
        combinedTransportationFixture([
          combinedProfileFixture("atl-ord-1001", [combinedAlternativeFixture("atl-ord-1001", "ATL-01", "Atlanta Proposed Warehouse", 262.89)], { representedShipments: 1 }),
          combinedProfileFixture("atl-ord-2001", [combinedAlternativeFixture("atl-ord-2001", "ATL-01", "Atlanta Proposed Warehouse", 173.95)], { representedShipments: 1 }),
          combinedProfileFixture("atl-row-5", [combinedAlternativeFixture("atl-row-5", "ATL-01", "Atlanta Proposed Warehouse", 3541.25)], { representedShipments: 25 })
        ])
      )
    );

    expect(result.phase).toBe("COMPLETE");
    expect(result.scenarioA.combinedCostEvaluation?.profileResults).toHaveLength(3);
    expect(result.scenarioA.combinedCostEvaluation?.assignedRepresentedShipments).toBe(27);
    expect(result.scenarioA.combinedCostEvaluation?.incompleteRepresentedShipments).toBe(0);
    expect(result.scenarioA.combinedCostEvaluation?.modeledTransportationCost).toBe(3978.09);
    expect(result.scenarioA.combinedCostEvaluation?.annualAllInWarehouseCost).toBe(420000);
    expect(result.scenarioA.combinedCostEvaluation?.totalNetworkCost).toBe(423978.09);
    expect(result.ratingEvidence.reconciliation.scenarioA?.exactReusedAlternatives).toBe(3);
    expect(result.ratingEvidence.reconciliation.totalAlternatives).toBe(6);
  });

  it("does not compare a warehouse-only scenario with no complete transportation alternatives", async () => {
    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison(
      comparisonOrchestrationFixture({
        scenarioACombined: {
          selectedFacilities: [
            currentCombinedFacility("TOR-01", "Toronto DC", { annualFacilityWarehouseCost: 240000 })
          ],
          warehouseCostProfilesByProfileKey: {
            "profile-1": combinedWarehouseProfile("profile-1", { representedShipments: 27 })
          }
        }
      }),
      comparisonOrchestrationDeps(
        combinedTransportationFixture([
          combinedProfileFixture("profile-1", [], { representedShipments: 27 })
        ]),
        combinedTransportationFixture([
          combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", 100)], { representedShipments: 27 })
        ])
      )
    );

    expect(result.phase).toBe("INCOMPLETE");
    expect(result.scenarioA.combinedCostEvaluation?.status).toBe("INCOMPLETE_NO_SCENARIO_ALTERNATIVES");
    expect(result.scenarioA.combinedCostEvaluation?.assignedRepresentedShipments).toBe(0);
    expect(result.scenarioA.combinedCostEvaluation?.incompleteRepresentedShipments).toBe(27);
    expect(result.scenarioA.combinedCostEvaluation?.totalNetworkCost).toBeNull();
    expect(result.scenarioA.combinedCostEvaluation?.profileResults[0].incompleteReason).toBe("No complete scenario alternative.");
    expect(result.resultSummary?.comparison.lowerCostScenario).toBeNull();
    expect(result.resultSummary?.comparison.totalDifference).toBeNull();
    expect(result.resultSummary?.scenarioA.annualAllInWarehouseCost).toBeNull();
  });

  it("requires FX before mixed USD/CAD winner selection and applies CAD-to-USD normalization before comparing alternatives", async () => {
    const input = comparisonOrchestrationFixture({
      scenarioACombined: {
        selectedFacilities: [
          candidateCombinedFacility("USD-3PL", "USD Warehouse", { currency: "USD", inboundFeePerPallet: 20, outboundFeePerPallet: 0, storageFeePerPalletPerMonth: 0 }),
          candidateCombinedFacility("CAD-3PL", "CAD Warehouse", { currency: "CAD", inboundFeePerPallet: 10, outboundFeePerPallet: 0, storageFeePerPalletPerMonth: 0 })
        ]
      }
    });
    const evalA = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [
        combinedAlternativeFixture("profile-1", "USD-3PL", "USD Warehouse", 100),
        combinedAlternativeFixture("profile-1", "CAD-3PL", "CAD Warehouse", 115)
      ])
    ]);
    const evalB = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", 200)])
    ]);
    const noFx = await orchestrateSupplyChainDesignNetworkScenarioComparison(input, comparisonOrchestrationDeps(evalA, evalB));
    expect(noFx.phase).toBe("INCOMPLETE");
    expect(noFx.resultSummary?.warnings).toEqual(expect.arrayContaining(["CAD to USD rate is required before mixed USD/CAD winner selection."]));

    const withFx = await orchestrateSupplyChainDesignNetworkScenarioComparison(
      { ...input, fxInput: { cadToUsdRate: 0.5 } },
      comparisonOrchestrationDeps(evalA, evalB)
    );
    expect(withFx.phase).toBe("COMPLETE");
    expect(withFx.scenarioA.combinedCostEvaluation?.profileResults[0].winnerFacilityId).toBe("CAD-3PL");
    expect(withFx.scenarioA.fx).toMatchObject({ fxApplied: true, normalizedCurrency: "USD", cadToUsdRate: 0.5 });
  });

  it("changes the comparison fingerprint but not transportation fingerprint when only FX changes", async () => {
    const input = comparisonOrchestrationFixture();
    const withFx = { ...input, fxInput: { cadToUsdRate: 0.72 } };

    const transportation = buildNetworkScenarioTransportationFingerprint({
      inputReferences: input.inputReferences,
      scenarioInputs: input.scenarioInputs,
      ratingAccountId: input.account.id,
      carrierHashes: input.carrierHashes
    });
    const transportationWithFx = buildNetworkScenarioTransportationFingerprint({
      inputReferences: withFx.inputReferences,
      scenarioInputs: withFx.scenarioInputs,
      ratingAccountId: withFx.account.id,
      carrierHashes: withFx.carrierHashes
    });
    const comparison = buildNetworkScenarioComparisonFingerprint({
      transportationFingerprint: transportation,
      scenarioInputs: input.scenarioInputs,
      fxInput: null,
      resultInputs: input.resultInputs ?? {}
    });
    const comparisonWithFx = buildNetworkScenarioComparisonFingerprint({
      transportationFingerprint: transportationWithFx,
      scenarioInputs: withFx.scenarioInputs,
      fxInput: withFx.fxInput,
      resultInputs: withFx.resultInputs ?? {}
    });

    expect(transportationWithFx).toBe(transportation);
    expect(comparisonWithFx).not.toBe(comparison);
  });

  it("reuses completed and active Network Scenario Comparison runs without duplicate rating work", async () => {
    const input = comparisonOrchestrationFixture();
    const completed = networkScenarioComparisonRunRecord({ id: "completed-comparison", status: "COMPLETE" });
    const active = networkScenarioComparisonRunRecord({ id: "active-comparison", status: "RATING", resultSummary: null });
    const createRun = vi.fn();
    const evaluateTransportation = vi.fn();
    const createMissingRateBatch = vi.fn();

    const reused = await orchestrateSupplyChainDesignNetworkScenarioComparison(input, {
      findCompletedRun: vi.fn().mockResolvedValue(completed),
      findActiveRun: vi.fn(),
      createRun,
      evaluateTransportation,
      createMissingRateBatch
    });
    const resumed = await orchestrateSupplyChainDesignNetworkScenarioComparison(input, {
      findCompletedRun: vi.fn().mockResolvedValue(null),
      findActiveRun: vi.fn().mockResolvedValue(active),
      createRun,
      evaluateTransportation,
      createMissingRateBatch
    });

    expect(reused.reusedCompletedRunId).toBe("completed-comparison");
    expect(resumed.resumedActiveRunId).toBe("active-comparison");
    expect(createRun).not.toHaveBeenCalled();
    expect(evaluateTransportation).not.toHaveBeenCalled();
    expect(createMissingRateBatch).not.toHaveBeenCalled();
  });

  it("creates a fresh Network Scenario Comparison run when Recalculate bypasses completed-run reuse", async () => {
    const input = { ...comparisonOrchestrationFixture(), forceNewRun: true };
    const completed = networkScenarioComparisonRunRecord({ id: "completed-comparison", status: "COMPLETE" });
    const created = networkScenarioComparisonRunRecord({ id: "fresh-comparison", status: "EVALUATING", resultSummary: null });
    const completeRun = networkScenarioComparisonRunRecord({ id: "fresh-comparison", status: "COMPLETE" });
    const evalA = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", 100)])
    ]);
    const evalB = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", 90)])
    ]);
    const findCompletedRun = vi.fn().mockResolvedValue(completed);
    const findActiveRun = vi.fn();
    const createRun = vi.fn().mockResolvedValue(created);

    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison(input, {
      findCompletedRun,
      findActiveRun,
      createRun,
      updateRun: vi.fn().mockResolvedValue(completeRun),
      evaluateTransportation: vi.fn()
        .mockResolvedValueOnce(evalA)
        .mockResolvedValueOnce(evalB)
    });

    expect(result.run.id).toBe("fresh-comparison");
    expect(result.reusedCompletedRunId).toBeNull();
    expect(findCompletedRun).not.toHaveBeenCalled();
    expect(findActiveRun).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledTimes(1);
  });

  it("reconciles a caller-selected active comparison run without creating a duplicate run", async () => {
    const input = { ...comparisonOrchestrationFixture(), comparisonRunId: "active-comparison" };
    const active = networkScenarioComparisonRunRecord({ id: "active-comparison", status: "READY_FOR_COST_EVALUATION", resultSummary: null });
    const completeRun = networkScenarioComparisonRunRecord({ id: "active-comparison", status: "COMPLETE" });
    const evalA = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", 100)])
    ]);
    const evalB = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", 90)])
    ]);
    const createRun = vi.fn();
    const updateRun = vi.fn()
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(completeRun);

    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison(input, {
      findCompletedRun: vi.fn().mockResolvedValue(null),
      findActiveRun: vi.fn().mockResolvedValue(active),
      createRun,
      updateRun,
      evaluateTransportation: vi.fn()
        .mockResolvedValueOnce(evalA)
        .mockResolvedValueOnce(evalB)
    });

    expect(result.phase).toBe("COMPLETE");
    expect(createRun).not.toHaveBeenCalled();
    expect(updateRun.mock.calls.map((call) => call[2])).toEqual(["active-comparison", "active-comparison"]);
  });

  it("finalizes a resumed active comparison as INCOMPLETE when terminal rating leaves no-rate lanes", async () => {
    const input = {
      ...comparisonOrchestrationFixture(),
      comparisonRunId: "active-comparison",
      submitMissingRates: false,
      finalizeWithMissingRates: true
    };
    const active = networkScenarioComparisonRunRecord({ id: "active-comparison", status: "RATING", resultSummary: null });
    const incompleteRun = networkScenarioComparisonRunRecord({ id: "active-comparison", status: "INCOMPLETE" });
    const missingA = {
      ...combinedAlternativeFixture("profile-1", "A-3PL", "A Warehouse", null, "CANDIDATE", "MISSING_RATE"),
      laneFingerprint: "missing-after-terminal"
    };
    const missingB = {
      ...combinedAlternativeFixture("profile-1", "B-3PL", "B Warehouse", null, "CANDIDATE", "MISSING_RATE"),
      laneFingerprint: "missing-after-terminal"
    };
    const evalA = combinedTransportationFixture([combinedProfileFixture("profile-1", [missingA])]);
    const evalB = combinedTransportationFixture([combinedProfileFixture("profile-1", [missingB])]);
    const createRun = vi.fn();
    const createMissingRateBatch = vi.fn();
    const updateRun = vi.fn()
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(incompleteRun);

    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison(input, {
      findCompletedRun: vi.fn().mockResolvedValue(null),
      findActiveRun: vi.fn().mockResolvedValue(active),
      createRun,
      updateRun,
      createMissingRateBatch,
      evaluateTransportation: vi.fn()
        .mockResolvedValueOnce(evalA)
        .mockResolvedValueOnce(evalB)
    });

    expect(result.phase).toBe("INCOMPLETE");
    expect(createRun).not.toHaveBeenCalled();
    expect(createMissingRateBatch).not.toHaveBeenCalled();
    expect(updateRun.mock.calls[1][3]).toMatchObject({
      status: "INCOMPLETE",
      resultSummary: expect.objectContaining({
        completenessStatus: "INCOMPLETE",
        warnings: expect.arrayContaining(["Scenario A is INCOMPLETE_RATES.", "Scenario B is INCOMPLETE_RATES."])
      })
    });
  });

  it("persists FAILED safely when comparison orchestration throws after run creation", async () => {
    const input = comparisonOrchestrationFixture();
    const run = networkScenarioComparisonRunRecord({ id: "comparison-1", status: "EVALUATING", resultSummary: null });
    const failedRun = networkScenarioComparisonRunRecord({ id: "comparison-1", status: "FAILED", resultSummary: null, errorMessage: "boom" });
    const updateRun = vi.fn().mockResolvedValue(failedRun);

    const result = await orchestrateSupplyChainDesignNetworkScenarioComparison(input, {
      findCompletedRun: vi.fn().mockResolvedValue(null),
      findActiveRun: vi.fn().mockResolvedValue(null),
      createRun: vi.fn().mockResolvedValue(run),
      updateRun,
      evaluateTransportation: vi.fn().mockRejectedValue(new Error("boom"))
    });

    expect(result.phase).toBe("FAILED");
    expect(updateRun).toHaveBeenCalledWith(expect.anything(), "project-1", "comparison-1", expect.objectContaining({
      status: "FAILED",
      errorMessage: "boom"
    }));
  });

  it("adds only the approved Historical Shipments and Candidate Warehouse template fields", () => {
    const historicalHeaders = csvHeader("docs/modules/supply-chain-design/templates/historical-shipments-template.csv");
    expect(historicalHeaders).toEqual(
      expect.arrayContaining([
        "Inventory Dwell Time Days",
        "Weight Unit",
        "Length",
        "Width",
        "Height",
        "Dimension Unit",
        "Hazardous Materials"
      ])
    );
    expect(historicalHeaders).not.toContain("Freight Class");
    expect(historicalHeaders).not.toContain("Stackable");
    expect(historicalHeaders).not.toContain("Accessorial Codes");
    expect(historicalHeaders).not.toContain("NMFC");
    expect(historicalHeaders).not.toContain("Commodity");
    expect(historicalHeaders).not.toContain("UN Number");

    const candidateHeaders = csvHeader("docs/modules/supply-chain-design/templates/candidate-warehouses-and-costs-template.csv");
    expect(candidateHeaders).toContain("Candidate Country");
    expect(candidateHeaders).toEqual(
      expect.arrayContaining([
        "Inbound Fee Per Pallet",
        "Outbound Fee Per Pallet",
        "Storage Fee Per Pallet Per Month"
      ])
    );
  });

  it("automatically recognizes updated official templates and samples", () => {
    const shipments = recognizeSupplyChainDesignOfficialTemplate(
      csvHeader("docs/modules/supply-chain-design/templates/historical-shipments-template.csv")
    );
    expect(shipments?.tableType).toBe("SHIPMENTS");
    expect(shipments?.fieldMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ standardField: "weight_unit", sourceColumn: "Weight Unit" }),
        expect.objectContaining({ standardField: "inventory_dwell_time_days", sourceColumn: "Inventory Dwell Time Days" }),
        expect.objectContaining({ standardField: "dimension_unit", sourceColumn: "Dimension Unit" }),
        expect.objectContaining({ standardField: "hazardous_materials", sourceColumn: "Hazardous Materials" })
      ])
    );

    const candidates = recognizeSupplyChainDesignOfficialTemplate(
      csvHeader("docs/modules/supply-chain-design/templates/candidate-warehouses-and-costs-template.csv")
    );
    expect(candidates?.tableType).toBe("CANDIDATE_FACILITIES");
    expect(candidates?.fieldMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          standardField: "candidate_country",
          sourceColumn: "Candidate Country",
          requirement: "REQUIRED"
        }),
        expect.objectContaining({ standardField: "inbound_fee_per_pallet", sourceColumn: "Inbound Fee Per Pallet" }),
        expect.objectContaining({ standardField: "outbound_fee_per_pallet", sourceColumn: "Outbound Fee Per Pallet" }),
        expect.objectContaining({ standardField: "storage_fee_per_pallet_per_month", sourceColumn: "Storage Fee Per Pallet Per Month" })
      ])
    );

    const sample = readFileSync("docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv", "utf8");
    const candidateSample = readFileSync("docs/modules/supply-chain-design/sample-data/candidate-warehouses-and-costs-sample.csv", "utf8");
    expect(sample).toContain("Weight Unit");
    expect(sample).toContain("Hazardous Materials");
    expect(sample).toContain("Inventory Dwell Time Days");
    expect(candidateSample).toContain("Inbound Fee Per Pallet");
    expect(candidateSample).toContain("Storage Fee Per Pallet Per Month");
  });

  it("parses optional future warehouse-cost fields without inventing missing values", () => {
    const shipmentRecognition = recognizeSupplyChainDesignOfficialTemplate(
      csvHeader("docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv")
    );
    const candidateRecognition = recognizeSupplyChainDesignOfficialTemplate(
      csvHeader("docs/modules/supply-chain-design/sample-data/candidate-warehouses-and-costs-sample.csv")
    );

    const shipmentRows = readHistoricalShipmentWarehouseCostContractRows({
      tableType: "SHIPMENTS",
      fileBytes: Buffer.from(readFileSync("docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv", "utf8")),
      fieldMappings: shipmentRecognition?.fieldMappings ?? []
    });
    const candidateRows = readCandidateWarehouseCostContractRows({
      tableType: "CANDIDATE_FACILITIES",
      fileBytes: Buffer.from(readFileSync("docs/modules/supply-chain-design/sample-data/candidate-warehouses-and-costs-sample.csv", "utf8")),
      fieldMappings: candidateRecognition?.fieldMappings ?? []
    });

    expect(shipmentRows.map((row) => row.inventoryDwellTimeDays)).toEqual([15, 30, 45, 15, 61, 30, 45, 90, 61, 30, 45, 15]);
    expect(candidateRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateFacilityId: "CHI-3PL",
          inboundFeePerPallet: 6,
          outboundFeePerPallet: 5,
          storageFeePerPalletPerMonth: 14
        }),
        expect.objectContaining({
          candidateFacilityId: "DFW-ALLIN",
          inboundFeePerPallet: 7.5,
          outboundFeePerPallet: 6.5,
          storageFeePerPalletPerMonth: 16
        })
      ])
    );
  });

  it("uses canonical sample-data files for Network Scenario Comparison validation coverage", () => {
    const historicalPath = "docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv";
    const candidatePath = "docs/modules/supply-chain-design/sample-data/candidate-warehouses-and-costs-sample.csv";
    const currentPath = "docs/modules/supply-chain-design/sample-data/current-facilities-and-costs-sample.csv";

    const historicalRecognition = recognizeSupplyChainDesignOfficialTemplate(csvHeader(historicalPath));
    const candidateRecognition = recognizeSupplyChainDesignOfficialTemplate(csvHeader(candidatePath));
    const currentRecognition = recognizeSupplyChainDesignOfficialTemplate(csvHeader(currentPath));

    expect(historicalRecognition?.tableType).toBe("SHIPMENTS");
    expect(candidateRecognition?.tableType).toBe("CANDIDATE_FACILITIES");
    expect(currentRecognition?.tableType).toBe("FACILITIES");
    expect(candidateRecognition?.fieldMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ standardField: "annual_facility_warehouse_cost", sourceColumn: "Annual Facility / Warehouse Cost" }),
        expect.objectContaining({ standardField: "inbound_fee_per_pallet", sourceColumn: "Inbound Fee Per Pallet" }),
        expect.objectContaining({ standardField: "outbound_fee_per_pallet", sourceColumn: "Outbound Fee Per Pallet" }),
        expect.objectContaining({ standardField: "storage_fee_per_pallet_per_month", sourceColumn: "Storage Fee Per Pallet Per Month" }),
        expect.objectContaining({ standardField: "currency", sourceColumn: "Currency" })
      ])
    );
    expect(historicalRecognition?.fieldMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ standardField: "shipment_id", sourceColumn: "Shipment / Order Reference" }),
        expect.objectContaining({ standardField: "postal_or_region_code", sourceColumn: "Destination ZIP / Postal Code" }),
        expect.objectContaining({ standardField: "shipment_quantity", sourceColumn: "Shipments" }),
        expect.objectContaining({ standardField: "pallets", sourceColumn: "Pallets" }),
        expect.objectContaining({ standardField: "inventory_dwell_time_days", sourceColumn: "Inventory Dwell Time Days" }),
        expect.objectContaining({ standardField: "mode", sourceColumn: "Transportation Mode" })
      ])
    );

    const olderCandidateHeaders = [
      "Candidate Facility ID",
      "Candidate Facility Name",
      "Candidate Type",
      "Candidate ZIP / Postal Code",
      "Candidate Country",
      "Annual Facility / Warehouse Cost",
      "Pallet Capacity",
      "Currency",
      "Notes"
    ];
    expect(recognizeSupplyChainDesignOfficialTemplate(olderCandidateHeaders)?.tableType).toBe("CANDIDATE_FACILITIES");
    expect(readFileSync("docs/modules/supply-chain-design/product-inventory.md", "utf8")).toContain("annual shipment volume");
    expect(existsSync("docs/modules/supply-chain-design/samples/network-scenario-comparison-validation-current-facilities.csv")).toBe(false);
    expect(existsSync("docs/modules/supply-chain-design/samples/network-scenario-comparison-validation-historical-shipments.csv")).toBe(false);
    expect(existsSync("docs/modules/supply-chain-design/samples/network-scenario-comparison-validation-candidate-warehouses.csv")).toBe(false);
    expect(existsSync("docs/modules/supply-chain-design/samples/network-scenario-comparison-validation-guide.md")).toBe(false);
  });

  it("calculates canonical sample candidate variable warehouse costs from row-level dwell and annual overrides", () => {
    const historicalPath = "docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv";
    const candidatePath = "docs/modules/supply-chain-design/sample-data/candidate-warehouses-and-costs-sample.csv";
    const shipmentMapping = recognizeSupplyChainDesignOfficialTemplate(csvHeader(historicalPath))?.fieldMappings ?? [];
    const candidateMapping = recognizeSupplyChainDesignOfficialTemplate(csvHeader(candidatePath))?.fieldMappings ?? [];
    const shipmentRows = readHistoricalShipmentWarehouseCostContractRows({
      tableType: "SHIPMENTS",
      fileBytes: Buffer.from(readFileSync(historicalPath, "utf8")),
      fieldMappings: shipmentMapping
    });
    const facilityOptions = readWarehouseCostFacilityOptions({
      currentFacilities: null,
      candidateFacilities: {
        fileBytes: Buffer.from(readFileSync(candidatePath, "utf8")),
        fieldMappings: candidateMapping
      }
    });

    expect(shipmentRows.map((row) => row.inventoryDwellTimeDays)).toEqual([15, 30, 45, 15, 61, 30, 45, 90, 61, 30, 45, 15]);
    const chi = facilityOptions.find((facility) => facility.facilityId === "CHI-3PL")!;
    const atl = facilityOptions.find((facility) => facility.facilityId === "ATL-3PL")!;
    const dfw = facilityOptions.find((facility) => facility.facilityId === "DFW-ALLIN")!;
    const ltlSourceRows = [
      { sourceRowId: "canonical-shipments:row-2", shipmentReference: "ANN-1001", representedShipments: 12, pallets: 24, inventoryDwellTimeDays: 15 },
      { sourceRowId: "canonical-shipments:row-3", shipmentReference: "ANN-1002", representedShipments: 8, pallets: 12, inventoryDwellTimeDays: 30 },
      { sourceRowId: "canonical-shipments:row-4", shipmentReference: "ANN-1003", representedShipments: 10, pallets: 18, inventoryDwellTimeDays: 45 }
    ];

    const chiCost = calculateCandidateWarehouseCostFromSourceRows({ candidate: candidateWarehouseCostInputFromOption(chi), sourceRows: ltlSourceRows });
    const atlCost = calculateCandidateWarehouseCostFromSourceRows({ candidate: candidateWarehouseCostInputFromOption(atl), sourceRows: ltlSourceRows });
    const dfwCost = calculateCandidateWarehouseCostFromSourceRows({ candidate: candidateWarehouseCostInputFromOption(dfw), sourceRows: ltlSourceRows });

    expect(chiCost.billingEvidence.map((row) => row.billableStorageMonths)).toEqual([1, 1, 2]);
    expect(chiCost).toMatchObject({ warehouseCostBasis: "VARIABLE_3PL_RATES", inboundCost: 324, outboundCost: 270, storageCost: 1008, completeWarehouseCost: 1602 });
    expect(atlCost).toMatchObject({ warehouseCostBasis: "VARIABLE_3PL_RATES", inboundCost: 297, outboundCost: 256.5, storageCost: 936, completeWarehouseCost: 1489.5 });
    expect(dfwCost).toMatchObject({
      warehouseCostBasis: "ANNUAL_ALL_IN",
      annualAllInCost: 195000,
      inboundCost: null,
      outboundCost: null,
      storageCost: null,
      completeWarehouseCost: null,
      knownSubtotal: 0
    });
  });

  it("carries mapped dwell into Network Scenario Comparison warehouse profiles without changing 7L request keys", () => {
    const historicalPath = "docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv";
    const candidatePath = "docs/modules/supply-chain-design/sample-data/candidate-warehouses-and-costs-sample.csv";
    const shipmentMapping = recognizeSupplyChainDesignOfficialTemplate(csvHeader(historicalPath))?.fieldMappings ?? [];
    const candidateMapping = recognizeSupplyChainDesignOfficialTemplate(csvHeader(candidatePath))?.fieldMappings ?? [];
    const input = ltlPreparationInputFixture({
      shipmentsCsv: readFileSync(historicalPath, "utf8"),
      candidateCsv: readFileSync(candidatePath, "utf8")
    });
    input.shipments.fileId = "validation-shipments";
    input.shipments.fieldMappings = testFieldMappings(shipmentMapping.map((mapping) => [mapping.standardField, mapping.sourceColumn]));
    input.candidateFacilities.fieldMappings = testFieldMappings(candidateMapping.map((mapping) => [mapping.standardField, mapping.sourceColumn]));

    const preparation = prepareSupplyChainDesignCandidateLtlRateRequests(input);
    const profiles = toSupplyChainDesignNetworkScenarioPreparedProfiles(preparation.preparedRequests);
    const shipmentRows = readHistoricalShipmentWarehouseCostContractRows({
      tableType: "SHIPMENTS",
      fileBytes: Buffer.from(readFileSync(historicalPath, "utf8")),
      fieldMappings: shipmentMapping
    });
    const warehouseProfiles = buildWarehouseCostProfilesFromPreparedRequests({
      preparedRequests: profiles,
      shipmentFileId: "validation-shipments",
      shipmentWarehouseCostRows: shipmentRows
    });

    expect(preparation.historicalRowsReviewed).toBe(12);
    expect(preparation.excludedNonLtlRowCount).toBe(1);
    expect(preparation.readyRequestCount).toBe(44);
    expect(profiles).toHaveLength(11);
    expect(Object.values(warehouseProfiles).map((profile: any) => profile.inventoryDwellTimeDays).sort((left, right) => left - right)).toEqual([15, 15, 30, 30, 30, 45, 45, 45, 61, 61, 90]);

    const changedWarehouseFields = ltlPreparationInputFixture({
      shipmentsCsv: readFileSync(historicalPath, "utf8").replace(",24,15,", ",24,29,"),
      candidateCsv: readFileSync(candidatePath, "utf8").replace(",6.00,5.00,14.00,", ",16.00,15.00,24.00,")
    });
    changedWarehouseFields.shipments.fieldMappings = input.shipments.fieldMappings;
    changedWarehouseFields.candidateFacilities.fieldMappings = input.candidateFacilities.fieldMappings;
    const changedPreparation = prepareSupplyChainDesignCandidateLtlRateRequests(changedWarehouseFields);
    expect(changedPreparation.preparedRequests.map((request) => request.normalizedRequest)).toEqual(
      preparation.preparedRequests.map((request) => request.normalizedRequest)
    );
    expect(changedPreparation.preparedRequests.map((request) => request.rateRequestKey)).toEqual(
      preparation.preparedRequests.map((request) => request.rateRequestKey)
    );
  });

  it("keeps transportation and warehouse costs separate for validation multi-origin scenarios", () => {
    const transportationEvaluation = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [
        combinedAlternativeFixture("profile-1", "TOR-01", "Toronto Current DC", 100, "CURRENT"),
        combinedAlternativeFixture("profile-1", "CHI-3PL", "Chicago Variable 3PL", 90, "CANDIDATE")
      ]),
      combinedProfileFixture("profile-2", [
        combinedAlternativeFixture("profile-2", "TOR-01", "Toronto Current DC", 200, "CURRENT"),
        combinedAlternativeFixture("profile-2", "CHI-3PL", "Chicago Variable 3PL", 80, "CANDIDATE")
      ])
    ]);

    const result = evaluateSupplyChainDesignCombinedScenarioCost({
      scenarioId: "scenario-validation-a",
      scenarioName: "Validation Scenario A",
      transportationCurrency: "USD",
      transportationEvaluation,
      selectedFacilities: [
        currentCombinedFacility("TOR-01", "Toronto Current DC", { currency: "USD", annualFacilityWarehouseCost: 240000 }),
        candidateCombinedFacility("CHI-3PL", "Chicago Variable 3PL", { currency: "USD", inboundFeePerPallet: 5, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: 10 })
      ],
      warehouseCostProfilesByProfileKey: {
        "profile-1": combinedWarehouseProfile("profile-1", { representativePallets: 2, representedShipments: 1, inventoryDwellTimeDays: 15 }),
        "profile-2": combinedWarehouseProfile("profile-2", { representativePallets: 3, representedShipments: 1, inventoryDwellTimeDays: 45 })
      }
    });

    expect(result.modeledTransportationCost).toBe(180);
    expect(result.variableWarehouseCost).toBe(87);
    expect(result.annualAllInWarehouseCost).toBe(240000);
    expect(result.totalWarehouseCost).toBe(240087);
    expect(result.totalNetworkCost).toBe(240267);
    expect(result.profileResults.every((profile) => profile.alternatives.some((alternative) => alternative.facilitySourceType === "CURRENT"))).toBe(true);
    expect(result.profileResults.every((profile) => profile.alternatives.some((alternative) => alternative.facilitySourceType === "CANDIDATE"))).toBe(true);
  });

  it("builds each scenario best network from all selected warehouses using served cost", () => {
    const transportationEvaluation = combinedTransportationFixture([
      combinedProfileFixture("profile-1", [
        combinedAlternativeFixture("profile-1", "TOR-01", "Toronto Current DC", 100, "CURRENT"),
        combinedAlternativeFixture("profile-1", "CHI-3PL", "Chicago Variable 3PL", 90, "CANDIDATE"),
        combinedAlternativeFixture("profile-1", "DFW-ALLIN", "Dallas All-In 3PL", 1000, "CANDIDATE")
      ]),
      combinedProfileFixture("profile-2", [
        combinedAlternativeFixture("profile-2", "TOR-01", "Toronto Current DC", 200, "CURRENT"),
        combinedAlternativeFixture("profile-2", "CHI-3PL", "Chicago Variable 3PL", 80, "CANDIDATE"),
        combinedAlternativeFixture("profile-2", "DFW-ALLIN", "Dallas All-In 3PL", 1000, "CANDIDATE")
      ])
    ]);

    const result = evaluateSupplyChainDesignCombinedScenarioCost({
      scenarioId: "scenario-best-network",
      scenarioName: "Best Network",
      transportationCurrency: "USD",
      transportationEvaluation,
      selectedFacilities: [
        currentCombinedFacility("TOR-01", "Toronto Current DC", { currency: "USD", annualFacilityWarehouseCost: 1000 }),
        candidateCombinedFacility("CHI-3PL", "Chicago Variable 3PL", { currency: "USD", inboundFeePerPallet: 5, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: 10 }),
        candidateCombinedFacility("DFW-ALLIN", "Dallas All-In 3PL", { currency: "USD", annualFacilityWarehouseCost: 500, inboundFeePerPallet: 99, outboundFeePerPallet: 99, storageFeePerPalletPerMonth: 99 })
      ],
      warehouseCostProfilesByProfileKey: {
        "profile-1": combinedWarehouseProfile("profile-1", { representativePallets: 2, representedShipments: 1, inventoryDwellTimeDays: 15 }),
        "profile-2": combinedWarehouseProfile("profile-2", { representativePallets: 3, representedShipments: 1, inventoryDwellTimeDays: 45 })
      }
    });

    expect(result.profileResults).toHaveLength(2);
    expect(result.profileResults.every((profile) => profile.alternatives.length === 3)).toBe(true);
    expect(result.profileResults[0].winnerFacilityId).toBe("TOR-01");
    expect(result.profileResults[0].alternatives.find((alternative) => alternative.facilityId === "CHI-3PL")).toMatchObject({
      modeledTransportationCost: 90,
      variableWarehouseCost: 38,
      combinedAssignmentCost: 128,
      winning: false
    });
    expect(result.profileResults[1].winnerFacilityId).toBe("CHI-3PL");
    expect(result.profileResults[1].alternatives.find((alternative) => alternative.facilityId === "TOR-01")).toMatchObject({
      modeledTransportationCost: 200,
      warehouseCostUsedForAssignment: 0,
      combinedAssignmentCost: 200,
      winning: false
    });
    expect(result.profileResults[1].alternatives.find((alternative) => alternative.facilityId === "CHI-3PL")).toMatchObject({
      modeledTransportationCost: 80,
      variableWarehouseCost: 87,
      combinedAssignmentCost: 167,
      winning: true
    });
    expect(result.profileResults.flatMap((profile) => profile.alternatives).find((alternative) => alternative.facilityId === "DFW-ALLIN")).toMatchObject({
      warehouseCostBasis: "ANNUAL_ALL_IN",
      warehouseCostUsedForAssignment: 0,
      variableWarehouseCost: null
    });
    expect(result.modeledTransportationCost).toBe(180);
    expect(result.variableWarehouseCost).toBe(87);
    expect(result.annualAllInWarehouseCost).toBe(1500);
    expect(result.totalWarehouseCost).toBe(1587);
    expect(result.totalNetworkCost).toBe(1767);
    expect(result.facilityTotals).toEqual([
      expect.objectContaining({ facilityId: "TOR-01", representedShipments: 1, modeledTransportationCost: 100, variableWarehouseCost: 0, annualAllInWarehouseCost: 1000, totalFacilityContribution: 1100 }),
      expect.objectContaining({ facilityId: "CHI-3PL", representedShipments: 1, modeledTransportationCost: 80, variableWarehouseCost: 87, annualAllInWarehouseCost: 0, totalFacilityContribution: 167 }),
      expect.objectContaining({ facilityId: "DFW-ALLIN", representedShipments: 0, representedPallets: 0, modeledTransportationCost: 0, variableWarehouseCost: 0, annualAllInWarehouseCost: 500, totalFacilityContribution: 500 })
    ]);
  });

  it("rejects malformed or negative future warehouse-cost fields when supplied", () => {
    const candidateCsv = [
      "Candidate Facility ID,Candidate Facility Name,Candidate Type,Candidate ZIP / Postal Code,Candidate Country,Annual Facility / Warehouse Cost,Inbound Fee Per Pallet,Outbound Fee Per Pallet,Storage Fee Per Pallet Per Month,Pallet Capacity,Currency,Notes",
      "BAD-01,Bad Candidate,Proposed 3PL,60601,US,100000,bad,7.25,18,9000,USD,Bad inbound fee."
    ].join("\n");
    const candidateMapping = recognizeSupplyChainDesignOfficialTemplate(candidateCsv.split("\n")[0].split(","))?.fieldMappings ?? [];

    expect(() =>
      readCandidateWarehouseCostContractRows({
        tableType: "CANDIDATE_FACILITIES",
        fileBytes: Buffer.from(candidateCsv),
        fieldMappings: candidateMapping
      })
    ).toThrow('CANDIDATE_FACILITIES inbound_fee_per_pallet value "bad" is not a valid number.');

    const shipmentsCsv = [
      "Record Type,Shipment / Order Reference,Shipment Date,Origin Facility ID,Destination Customer / Group,Destination ZIP / Postal Code,Destination City / Region,Destination Country,Shipments,Pallets,Inventory Dwell Time Days,Units,Weight,Weight Unit,Length,Width,Height,Dimension Unit,Hazardous Materials,Transportation Mode,Transportation Cost,Transit Days,Service Level,SKU / Item,Currency",
      "Individual Shipment,ORD-BAD,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,-1,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD"
    ].join("\n");
    const shipmentMapping = recognizeSupplyChainDesignOfficialTemplate(shipmentsCsv.split("\n")[0].split(","))?.fieldMappings ?? [];

    expect(() =>
      readHistoricalShipmentWarehouseCostContractRows({
        tableType: "SHIPMENTS",
        fileBytes: Buffer.from(shipmentsCsv),
        fieldMappings: shipmentMapping
      })
    ).toThrow("SHIPMENTS inventory_dwell_time_days cannot be negative.");
  });

  it("uses the freight-class calculator and prepares individual and aggregated rows without live 7L calls", () => {
    expect(calculateFreightClass({ weight: 1200, weightUnit: "lb", length: 48, width: 40, height: 60, dimensionUnit: "in" })).toBe("70");
    expect(calculateFreightClass({ weight: 1200, weightUnit: "lb", quantity: 2, length: 48, width: 40, height: 60, dimensionUnit: "in" })).toBe("100");
    expect(calculateFreightClass({ weight: 1600, weightUnit: "lb", quantity: 3, length: 48, width: 40, height: 72, dimensionUnit: "in" })).toBe("150");
    expect(
      calculateLtlFreightClass({
        totalWeight: 1200,
        weightUnit: "lb",
        quantity: 2,
        length: 48,
        width: 40,
        height: 60,
        dimensionUnit: "in"
      })
    ).toMatchObject({ ok: true, totalCubeFeet: 133.33333333333334, density: 9, freightClass: "100" });

    const result = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture());
    const ready = result.preparedRequests.filter((row) => row.preparationStatus === "Ready for rating");

    expect(result.historicalRowsReviewed).toBe(4);
    expect(result.candidateWarehouseCount).toBe(2);
    expect(result.excludedNonLtlRowCount).toBe(2);
    expect(result.assumptions).toContain("No live 7L request was made.");
    expect(ready).toHaveLength(4);
    expect(ready[0].normalizedRequest?.accessorialCodes).toEqual([]);
    expect(ready.some((row) => row.recordType === "Individual Shipment" && row.representedShipments === 1)).toBe(true);
    const aggregated = ready.find((row) => row.recordType === "Aggregated Activity");
    expect(aggregated?.representedShipments).toBe(10);
    expect(aggregated?.representativeWeight).toBe(1000);
    expect(aggregated?.representativePallets).toBe(2);
    expect(aggregated?.normalizedRequest?.pieces[0]?.weight).toBe(1000);
    expect(aggregated?.normalizedRequest?.pieces[0]).toMatchObject({ qty: 2, weightType: "total" });
  });

  it("does not include future warehouse-cost contract fields in 7L request payloads or fingerprints", () => {
    const baseResult = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({
        candidateCsv: [
          ltlCandidateHeader(),
          "ATL-01,Atlanta Proposed Warehouse,Proposed Owned,30303,US,420000,14000,USD,Proposed US owned warehouse option."
        ].join("\n"),
        shipmentsCsv: [
          ltlShipmentsHeader(),
          "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD"
        ].join("\n")
      })
    );
    const expandedInput = ltlPreparationInputFixture({
      candidateCsv: [
        "Candidate Facility ID,Candidate Facility Name,Candidate Type,Candidate ZIP / Postal Code,Candidate Country,Annual Facility / Warehouse Cost,Inbound Fee Per Pallet,Outbound Fee Per Pallet,Storage Fee Per Pallet Per Month,Pallet Capacity,Currency,Notes",
        "ATL-01,Atlanta Proposed Warehouse,Proposed Owned,30303,US,420000,8.25,7.00,17.50,14000,USD,Proposed US owned warehouse option."
      ].join("\n"),
      shipmentsCsv: [
        "Record Type,Shipment / Order Reference,Shipment Date,Origin Facility ID,Destination Customer / Group,Destination ZIP / Postal Code,Destination City / Region,Destination Country,Shipments,Pallets,Inventory Dwell Time Days,Units,Weight,Weight Unit,Length,Width,Height,Dimension Unit,Hazardous Materials,Transportation Mode,Transportation Cost,Transit Days,Service Level,SKU / Item,Currency",
        "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,12,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD"
      ].join("\n")
    });
    expandedInput.candidateFacilities.fieldMappings = testFieldMappings([
      ["candidate_facility_id", "Candidate Facility ID"],
      ["candidate_facility_name", "Candidate Facility Name"],
      ["candidate_type", "Candidate Type"],
      ["postal_code", "Candidate ZIP / Postal Code"],
      ["candidate_country", "Candidate Country"],
      ["annual_facility_warehouse_cost", "Annual Facility / Warehouse Cost"],
      ["inbound_fee_per_pallet", "Inbound Fee Per Pallet"],
      ["outbound_fee_per_pallet", "Outbound Fee Per Pallet"],
      ["storage_fee_per_pallet_per_month", "Storage Fee Per Pallet Per Month"],
      ["pallet_capacity", "Pallet Capacity"],
      ["currency", "Currency"],
      ["notes", "Notes"]
    ]);
    expandedInput.shipments.fieldMappings = testFieldMappings([
      ...ltlShipmentFieldMappings().slice(0, 10),
      ["inventory_dwell_time_days", "Inventory Dwell Time Days"],
      ...ltlShipmentFieldMappings().slice(10)
    ]);

    const expandedResult = prepareSupplyChainDesignCandidateLtlRateRequests(expandedInput);
    const baseRequest = baseResult.preparedRequests[0].normalizedRequest;
    const expandedRequest = expandedResult.preparedRequests[0].normalizedRequest;

    expect(expandedRequest).toEqual(baseRequest);
    expect(
      buildSupplyChainDesignExactLaneRateFingerprint({
        accountId: "account-1",
        carrierHashes: [],
        request: expandedRequest!
      })
    ).toBe(
      buildSupplyChainDesignExactLaneRateFingerprint({
        accountId: "account-1",
        carrierHashes: [],
        request: baseRequest!
      })
    );
  });

  it("calculates quantity-aware freight classes for Network Design LTL preparation", () => {
    const result = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({
        candidateCsv: [ltlCandidateHeader(), "ATL-01,Atlanta Proposed Warehouse,Proposed Owned,30303,US,420000,14000,USD,Proposed US owned warehouse option."].join("\n"),
        shipmentsCsv: [
          ltlShipmentsHeader(),
          "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
          "Individual Shipment,ORD-2001,2026-01-17,VAN-01,Customer C,30303,Atlanta GA,US,1,3,60,1600,lb,48,40,72,in,No,LTL,610,4,Standard,SKU-300,USD",
          "Aggregated Activity,,2026-01-20,TOR-01,Customer Group,10001,New York NY,US,4,8,160,4800,lb,48,40,60,in,No,LTL,2100,2,Standard,SKU-400,USD"
        ].join("\n")
      })
    );

    const byReference = new Map(result.preparedRequests.map((request) => [request.shipmentOrderReferences[0] || "Aggregated Activity", request]));
    expect(byReference.get("ORD-1001")?.calculatedFreightClass).toBe("100");
    expect(byReference.get("ORD-1001")?.normalizedRequest?.pieces[0]).toMatchObject({ qty: 2, weight: 1200, weightType: "total", freightClass: "100" });
    expect(byReference.get("ORD-2001")?.calculatedFreightClass).toBe("150");
    expect(byReference.get("ORD-1001")?.sourceRowCount).toBe(2);
  });

  it("rejects missing pallet quantity instead of assuming one for calculated Network Design freight class", () => {
    const result = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({
        shipmentsCsv: [
          ltlShipmentsHeader(),
          "Individual Shipment,ORD-NO-PALLETS,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD"
        ].join("\n")
      })
    );

    expect(result.readyRequestCount).toBe(0);
    expect(result.preparedRequests.every((request) => request.normalizedRequest === null)).toBe(true);
    expect(result.preparedRequests.map((request) => request.missingDataReason).join(" ")).toContain(
      "Pallets must be greater than zero for freight class calculation"
    );
  });

  it("parses mapped Transportation Cost currency values into valid current costs", () => {
    const result = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({
        candidateCsv: [
          ltlCandidateHeader(),
          "CHI-3PL,Chicago Proposed 3PL,Proposed 3PL,60601,US,275000,9000,USD,Proposed 3PL option."
        ].join("\n"),
        shipmentsCsv: [
          ltlShipmentsHeader(),
          "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,$525.00,2,Standard,SKU-100,USD"
        ].join("\n")
      })
    );

    expect(result.preparedRequests).toHaveLength(1);
    expect(result.preparedRequests[0]).toMatchObject({
      currentTransportationCost: 525,
      currentTransportationCostPerShipment: 525
    });
  });

  it("does not silently default missing units and marks hazmat rows as missing data", () => {
    const result = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({
        shipmentsCsv: [
          ltlShipmentsHeader(),
          "Individual Shipment,ORD-MISSING,2026-01-15,TOR-01,C1,10001,New York,US,1,2,40,1200,,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
          "Individual Shipment,ORD-HAZ,2026-01-16,TOR-01,C2,30303,Atlanta,US,1,1,20,500,lb,48,40,40,in,Yes,LTL,300,2,Standard,SKU-200,USD"
        ].join("\n")
      })
    );

    expect(result.readyRequestCount).toBe(0);
    expect(result.missingDataRequestCount).toBe(4);
    expect(result.preparedRequests.map((row) => row.missingDataReason).join(" ")).toContain("Weight Unit is required");
    expect(result.preparedRequests.map((row) => row.missingDataReason).join(" ")).toContain(
      "hazardous shipment requires additional information"
    );
  });

  it("consolidates exact duplicate requests and keeps cost-relevant differences separate", () => {
    const result = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({
        candidateCsv: [
          ltlCandidateHeader(),
          "CHI-3PL,Chicago Proposed 3PL,Proposed 3PL,60601,US,275000,9000,USD,Proposed 3PL option."
        ].join("\n"),
        shipmentsCsv: [
          ltlShipmentsHeader(),
          "Individual Shipment,ORD-1,2026-01-15,TOR-01,C1,10001,New York,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
          "Individual Shipment,ORD-2,2026-01-16,TOR-01,C1,10001,New York,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
          "Individual Shipment,ORD-3,2026-01-17,TOR-01,C1,10001,New York,US,1,2,40,1300,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD"
        ].join("\n")
      })
    );

    expect(result.duplicateRequestsConsolidated).toBe(1);
    expect(result.preparedRequests).toHaveLength(2);
    const duplicate = result.preparedRequests.find((row) => row.sourceRowCount === 2);
    expect(duplicate?.representedShipments).toBe(2);
    expect(duplicate?.shipmentOrderReferences).toEqual(["ORD-1", "ORD-2"]);
  });

  it("normalizes candidate rating origins without changing material 7L request fields", () => {
    const input = ltlPreparationInputFixture({
      candidateCsv: [
        "Candidate Facility ID,Candidate Facility Name,Candidate Type,Candidate ZIP / Postal Code,Candidate Country,City,State/Province,Annual Facility / Warehouse Cost,Pallet Capacity,Currency,Notes",
        "CHI-3PL,Chicago Proposed 3PL,Proposed 3PL,60601,US,Chicago,IL,275000,9000,USD,Proposed 3PL option."
      ].join("\n")
    });
    input.candidateFacilities.fieldMappings = testFieldMappings([
      ...ltlCandidateFieldMappings(),
      ["city", "City"],
      ["state_province", "State/Province"]
    ]);

    const origins = normalizeSupplyChainDesignCandidateRatingOrigins(input.candidateFacilities);
    const prepared = prepareSupplyChainDesignCandidateLtlRateRequests(input);

    expect(origins.issues).toEqual([]);
    expect(origins.origins[0]).toEqual(expect.objectContaining({
      sourceType: "CANDIDATE",
      facilityId: "CHI-3PL",
      facilityName: "Chicago Proposed 3PL",
      postalCode: "60601",
      city: "CHICAGO",
      stateProvince: "IL",
      country: "US",
      sourceFileId: "candidate-file",
      sourceMappingId: "candidate-mapping",
      sourceTableType: SupplyChainDesignTableType.CANDIDATE_FACILITIES
    }));
    expect(prepared.preparedRequests[0].normalizedRequest).toEqual(expect.objectContaining({
      originCity: "",
      originState: "",
      originZipcode: "60601",
      originCountry: "US",
      pickupDate: "Not scheduled",
      accessorialCodes: []
    }));
  });

  it("normalizes valid U.S. and Canadian current facilities for future rating origins", () => {
    const result = normalizeSupplyChainDesignCurrentFacilityRatingOrigins(currentFacilityOriginMappedFile([
      "TOR-01,Toronto DC,Owned,M5V 2T6,Toronto,ON,Canada,240000,USD",
      "DFW-01,Dallas DC,Owned,75201,Dallas,TX,United States,180000,USD"
    ]));

    expect(result.issues).toEqual([]);
    expect(result.origins).toEqual([
      expect.objectContaining({
        sourceType: "CURRENT",
        facilityId: "TOR-01",
        facilityName: "Toronto DC",
        postalCode: "M5V 2T6",
        city: "TORONTO",
        stateProvince: "ON",
        country: "CA",
        sourceFileId: "current-file",
        sourceMappingId: "current-mapping"
      }),
      expect.objectContaining({
        sourceType: "CURRENT",
        facilityId: "DFW-01",
        postalCode: "75201",
        city: "DALLAS",
        stateProvince: "TX",
        country: "US"
      })
    ]);
  });

  it("derives current-facility rating country from U.S. and Canadian postal formats when no country column is supplied", () => {
    const file = currentFacilityOriginMappedFile([
      "TOR-01,Toronto DC,Owned,M5V 2T6,Toronto,ON,,240000,USD",
      "DFW-01,Dallas DC,Owned,75201,Dallas,TX,,180000,USD"
    ]);
    file.fieldMappings = file.fieldMappings.filter((mapping) => mapping.standardField !== "country");

    const result = normalizeSupplyChainDesignCurrentFacilityRatingOrigins(file);

    expect(result.issues).toEqual([]);
    expect(result.origins).toEqual([
      expect.objectContaining({ facilityId: "TOR-01", postalCode: "M5V 2T6", country: "CA", sourceType: "CURRENT" }),
      expect.objectContaining({ facilityId: "DFW-01", postalCode: "75201", country: "US", sourceType: "CURRENT" })
    ]);
  });

  it("reports incomplete current facilities without guessing a rating location", () => {
    const result = normalizeSupplyChainDesignCurrentFacilityRatingOrigins(currentFacilityOriginMappedFile([
      "NOZIP-01,Missing ZIP,Owned,,Toronto,ON,CA,240000,USD",
      "NOCOUNTRY-01,Missing Country,Owned,UNKNOWN,Dallas,TX,,180000,USD"
    ]));

    expect(result.origins).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        sourceType: "CURRENT",
        facilityId: "NOZIP-01",
        reason: "ZIP / Postal Code is required for 7L origin rating."
      }),
      expect.objectContaining({
        sourceType: "CURRENT",
        facilityId: "NOCOUNTRY-01",
        reason: "Country is required and must be US, CA or MX for 7L origin rating."
      })
    ]);
  });

  it("resolves Historical Shipment origin_facility_id to normalized current facilities deterministically", () => {
    const result = resolveHistoricalShipmentCurrentFacilityOrigins({
      currentFacilities: currentFacilityOriginMappedFile([
        "TOR-01,Toronto DC,Owned,M5V 2T6,Toronto,ON,CA,240000,USD"
      ]),
      shipments: {
        ...ltlPreparationInputFixture({
          shipmentsCsv: [
            ltlShipmentsHeader(),
            "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
            "Individual Shipment,ORD-9999,2026-01-15,VAN-01,Customer B,30303,Atlanta GA,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD"
          ].join("\n")
        }).shipments
      }
    });

    expect(result.originIssues).toEqual([]);
    expect(result.resolved).toEqual([
      expect.objectContaining({
        sourceReference: "ORD-1001",
        originFacilityId: "TOR-01",
        origin: expect.objectContaining({ facilityId: "TOR-01", sourceType: "CURRENT" })
      })
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        sourceReference: "ORD-9999",
        originFacilityId: "VAN-01",
        reason: "Origin Facility ID VAN-01 does not match a rateable Current Facility."
      })
    ]);
  });

  it("handles thousands of source rows deterministically", () => {
    const rows = Array.from({ length: 1500 }, (_, index) =>
      `Individual Shipment,ORD-${index},2026-01-15,TOR-01,C1,10001,New York,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD`
    );
    const first = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({ shipmentsCsv: [ltlShipmentsHeader(), ...rows].join("\n") })
    );
    const second = prepareSupplyChainDesignCandidateLtlRateRequests(
      ltlPreparationInputFixture({ shipmentsCsv: [ltlShipmentsHeader(), ...rows].join("\n") })
    );

    expect(first.preparedRequests.map((row) => row.rateRequestKey)).toEqual(
      second.preparedRequests.map((row) => row.rateRequestKey)
    );
    expect(first.duplicateRequestsConsolidated).toBe(2998);
  });

  it("persists prepared requests by tenant and project and reloads them from the project query", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const project = ltlPreparationActionProjectFixture();
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce(project);
    prismaMock.prisma.supplyChainDesignLtlRatePreparationRun.create.mockResolvedValueOnce({ id: "prep-run-1" });
    prismaMock.prisma.supplyChainDesignLtlRatePreparationRun.findUnique.mockResolvedValueOnce({ id: "prep-run-1" });

    const response = await generateSupplyChainDesignCandidateLtlRatePreparationAction(
      { ok: false, message: "" },
      form({
        projectId: "project-1",
        shipmentsMappingId: "shipments-mapping",
        candidateFacilitiesMappingId: "candidate-mapping"
      })
    );

    expect(response).toEqual({ ok: true, message: "Candidate LTL rate preparation generated.", runId: "prep-run-1" });
    expect(prismaMock.prisma.supplyChainDesignLtlRatePreparationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        projectId: "project-1",
        status: SupplyChainDesignModelRunStatus.SUCCESS,
        inputReferences: expect.objectContaining({
          shipments: expect.objectContaining({ mappingId: "shipments-mapping" }),
          candidateFacilities: expect.objectContaining({ mappingId: "candidate-mapping" })
        }),
        resultSummary: expect.objectContaining({
          resultVersion: SCDS_LTL_RATE_PREPARATION_RESULT_VERSION,
          readyRequestCount: expect.any(Number)
        })
      })
    });
    expect(revalidatePath).toHaveBeenCalledWith("/supply-chain-design/project-1");
  });

  it("reconciles every current sample historical row with explicit preparation outcomes", () => {
    const sampleCsv = readFileSync("docs/modules/supply-chain-design/sample-data/historical-shipments-sample.csv", "utf8");
    const result = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture({ shipmentsCsv: sampleCsv }));

    expect(result.historicalRowsReviewed).toBe(12);
    expect(result.sourceRowOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        shipmentOrderReference: "ANN-1001",
        recordType: "Aggregated Activity",
        transportationMode: "LTL",
        representedShipments: 12,
        destination: "10001 US",
        pallets: 24,
        weight: 14400,
        dimensions: "48 x 40 x 60 in",
        status: "Prepared"
      }),
      expect.objectContaining({
        shipmentOrderReference: "ANN-PARCEL-1",
        transportationMode: "Parcel",
        status: "Excluded",
        reason: "Transportation Mode is not LTL."
      })
    ]));
    expect(result.readyRequestCount).toBe(22);
    expect(result.excludedNonLtlRowCount).toBe(1);
  });

  it("selects the lowest quote with deterministic SCAC carrier and quote-number ties", () => {
    const base = ltlQuoteFixture({ total: 500, scac: "ZZZZ", carrierName: "Z Carrier", quoteNumber: "Q-2" });
    const tiedWinner = ltlQuoteFixture({ total: 500, scac: "AAAA", carrierName: "A Carrier", quoteNumber: "Q-1" });
    const higher = ltlQuoteFixture({ total: 510, scac: "BBBB", carrierName: "B Carrier", quoteNumber: "Q-3" });

    expect(selectLowestLtlQuote([base, higher, tiedWinner])?.scac).toBe("AAAA");
  });

  it("builds exact 7L lane fingerprints from material request and account inputs", () => {
    const request = ltlRequestFixture("lane-1", {
      customerReference: "request-a",
      originZipcode: "30303",
      destinationZipcode: "10001",
      accessorialCodes: ["LIFTGATE", "RESIDENTIAL"],
      pieces: [
        {
          qty: 2,
          weight: 1200,
          weightType: "total" as const,
          length: 48,
          width: 40,
          height: 60,
          dimType: "PLT" as const,
          freightClass: "100",
          hazmat: false,
          stack: false
        }
      ]
    });
    const base = buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["frontline-hash", "carrier-a"],
      request
    });

    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, customerReference: "request-b", originZipcode: "30303 " }
    })).toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, originZipcode: "60601" }
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, destinationZipcode: "30303" }
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, pieces: [{ ...request.pieces[0], weight: 1300 }] }
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, pieces: [{ ...request.pieces[0], qty: 3 }] }
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, pieces: [{ ...request.pieces[0], freightClass: "125" }] }
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, pieces: [{ ...request.pieces[0], height: 72 }] }
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, pieces: [{ ...request.pieces[0], hazmat: true }] }
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, accessorialCodes: ["LIFTGATE"] }
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "other-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a"],
      request
    })).not.toBe(base);
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...request, pickupDate: "2026-08-08" }
    })).not.toBe(base);
  });

  it("keeps exact lane fingerprints based on the physical 7L request rather than origin source classification", () => {
    const currentOrigin = normalizeSupplyChainDesignCurrentFacilityRatingOrigins(currentFacilityOriginMappedFile([
      "ATL-01,Atlanta Current DC,Owned,30303,Atlanta,GA,US,240000,USD"
    ])).origins[0];
    const candidateOrigin = normalizeSupplyChainDesignCandidateRatingOrigins({
      ...ltlPreparationInputFixture({
        candidateCsv: [
          "Candidate Facility ID,Candidate Facility Name,Candidate Type,Candidate ZIP / Postal Code,Candidate Country,City,State/Province,Annual Facility / Warehouse Cost,Pallet Capacity,Currency,Notes",
          "ATL-CAND,Atlanta Candidate,Proposed 3PL,30303,US,Atlanta,GA,275000,9000,USD,Same physical origin."
        ].join("\n")
      }).candidateFacilities,
      fieldMappings: testFieldMappings([
        ...ltlCandidateFieldMappings(),
        ["city", "City"],
        ["state_province", "State/Province"]
      ])
    }).origins[0];
    const requestFromCurrent = ltlRequestFixture("current-origin", {
      originZipcode: currentOrigin.postalCode,
      originCountry: currentOrigin.country,
      destinationZipcode: "10001"
    });
    const requestFromCandidate = ltlRequestFixture("candidate-origin", {
      originZipcode: candidateOrigin.postalCode,
      originCountry: candidateOrigin.country,
      destinationZipcode: "10001"
    });

    expect(currentOrigin.sourceType).toBe("CURRENT");
    expect(candidateOrigin.sourceType).toBe("CANDIDATE");
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: requestFromCurrent
    })).toBe(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["frontline-hash", "carrier-a"],
      request: requestFromCandidate
    }));
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: { ...requestFromCurrent, originZipcode: "60601" }
    })).not.toBe(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: requestFromCandidate
    }));
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "other-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: requestFromCurrent
    })).not.toBe(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: requestFromCandidate
    }));
    expect(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a"],
      request: requestFromCurrent
    })).not.toBe(buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: "live-account",
      carrierHashes: ["carrier-a", "frontline-hash"],
      request: requestFromCandidate
    }));
  });

  it("collapses candidate-expanded LTL preparations into one profile per eligible shipment for scenario comparison", () => {
    const preparation = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture({
      candidateCsv: [
        ltlCandidateHeader(),
        "CVG-01,Cincinnati Candidate,Proposed 3PL,45202,US,275000,9000,USD,Scenario test candidate.",
        "ATL-01,Atlanta Candidate,Proposed 3PL,30303,US,420000,14000,USD,Scenario test candidate.",
        "RNO-01,Reno Candidate,Proposed 3PL,89501,US,285000,9000,USD,Scenario test candidate."
      ].join("\n"),
      shipmentsCsv: [
        ltlShipmentsHeader(),
        "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
        "Individual Shipment,ORD-1002,2026-01-16,TOR-01,Customer A,10001,New York NY,US,1,1,10,700,lb,24,20,18,in,No,Parcel,95,1,Parcel,SKU-100,USD",
        "Individual Shipment,ORD-2001,2026-01-17,DFW-3PL,Customer B,30303,Atlanta GA,US,1,3,55,1600,lb,48,40,72,in,No,LTL,610,3,Standard,SKU-200,USD",
        "Aggregated Activity,,2026-01-31,DFW-3PL,Customer D,75201,Dallas TX,US,25,25,50,10000,lb,48,40,54,in,No,LTL,1875,5,Standard,SKU-400,USD"
      ].join("\n")
    }));

    const profiles = toSupplyChainDesignNetworkScenarioPreparedProfiles(preparation.preparedRequests);

    expect(preparation.preparedRequests).toHaveLength(9);
    expect(profiles).toHaveLength(3);
    expect(profiles.reduce((total, profile) => total + profile.representedShipments, 0)).toBe(27);
    expect(new Set(profiles.map((profile) => profile.rateRequestKey)).size).toBe(3);
    expect(profiles.map((profile) => profile.shipmentOrderReferences.join(", ") || profile.historicalShipmentRowIds.join(", ")).sort()).toEqual([
      "ORD-1001",
      "ORD-2001",
      "shipments-file:row-5"
    ].sort());
  });

  it("creates CURRENT Toronto scenario alternatives and missing-rate requests for every eligible profile", async () => {
    const preparation = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture({
      candidateCsv: [
        ltlCandidateHeader(),
        "CVG-01,Cincinnati Candidate,Proposed 3PL,45202,US,275000,9000,USD,Scenario test candidate.",
        "ATL-01,Atlanta Candidate,Proposed 3PL,30303,US,420000,14000,USD,Scenario test candidate.",
        "RNO-01,Reno Candidate,Proposed 3PL,89501,US,285000,9000,USD,Scenario test candidate."
      ].join("\n"),
      shipmentsCsv: [
        ltlShipmentsHeader(),
        "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
        "Individual Shipment,ORD-1002,2026-01-16,TOR-01,Customer A,10001,New York NY,US,1,1,10,700,lb,24,20,18,in,No,Parcel,95,1,Parcel,SKU-100,USD",
        "Individual Shipment,ORD-2001,2026-01-17,DFW-3PL,Customer B,30303,Atlanta GA,US,1,3,55,1600,lb,48,40,72,in,No,LTL,610,3,Standard,SKU-200,USD",
        "Aggregated Activity,,2026-01-31,DFW-3PL,Customer D,75201,Dallas TX,US,25,25,50,10000,lb,48,40,54,in,No,LTL,1875,5,Standard,SKU-400,USD"
      ].join("\n")
    }));
    const profiles = toSupplyChainDesignNetworkScenarioPreparedProfiles(preparation.preparedRequests);
    const currentFile = currentFacilityOriginMappedFile([
      "TOR-01,Toronto DC,Owned,M5V 2T6,Toronto,ON,,240000,USD"
    ]);
    currentFile.fieldMappings = currentFile.fieldMappings.filter((mapping) => mapping.standardField !== "country");
    const toronto = normalizeSupplyChainDesignCurrentFacilityRatingOrigins(currentFile).origins[0];
    prismaMock.prisma.ltlBatchQuoteLane.findMany.mockResolvedValue([]);

    const result = await evaluateSupplyChainDesignNetworkScenario({
      tenantId: "tenant-1",
      scenarioId: "scenario-toronto",
      scenarioName: "Toronto only",
      selectedOrigins: [toronto],
      shipments: scenarioShipmentsReference(),
      preparedProfiles: profiles,
      ratingConfig: scenarioRatingConfig()
    });

    expect(toronto).toEqual(expect.objectContaining({
      sourceType: "CURRENT",
      facilityId: "TOR-01",
      facilityName: "Toronto DC",
      postalCode: "M5V 2T6",
      city: "TORONTO",
      stateProvince: "ON",
      country: "CA"
    }));
    expect(result.eligiblePreparedProfileCount).toBe(3);
    expect(result.maximumOriginProfileCombinations).toBe(3);
    expect(result.profileAlternatives).toHaveLength(3);
    expect(result.profileAlternatives.flatMap((profile) => profile.alternatives)).toHaveLength(3);
    expect(result.profileAlternatives.flatMap((profile) => profile.alternatives)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originFacilityId: "TOR-01", originSourceType: "CURRENT", status: "MISSING_RATE" })
      ])
    );
    expect(result.missingRateManifest).toHaveLength(3);
    expect(result.originSummaries[0]).toMatchObject({
      sourceType: "CURRENT",
      facilityId: "TOR-01",
      validProfileCombinations: 3,
      missingRateCount: 3,
      representedShipmentsEvaluated: 27
    });
    expect(result.representedShipmentVolumeCovered).toBe(0);
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("reuses physically matching candidate-origin exact rates for CURRENT scenario origins while preserving CURRENT lineage", async () => {
    const profile = toSupplyChainDesignNetworkScenarioPreparedProfiles(scenarioPreparedProfiles())[0];
    const currentOrigin = normalizeSupplyChainDesignCurrentFacilityRatingOrigins(currentFacilityOriginMappedFile([
      "TOR-01,Toronto DC,Owned,M5V 2T6,Toronto,ON,CA,240000,USD"
    ])).origins[0];
    const request = scenarioRequestFor(currentOrigin, profile);
    prismaMock.prisma.ltlBatchQuoteLane.findMany.mockResolvedValue([
      reusableScenarioLane("prior-candidate-physical-lane", "scenario-comparison-batch", request, 262.89, {
        preparationRunId: "scenario:comparison:previous-run"
      })
    ]);

    const result = await evaluateSupplyChainDesignNetworkScenario({
      tenantId: "tenant-1",
      scenarioId: "scenario-current-reuse",
      scenarioName: "Current physical reuse",
      selectedOrigins: [currentOrigin],
      shipments: scenarioShipmentsReference(),
      preparedProfiles: [profile],
      ratingConfig: scenarioRatingConfig()
    });

    expect(result.profileAlternatives[0].alternatives).toEqual([
      expect.objectContaining({
        originFacilityId: "TOR-01",
        originSourceType: "CURRENT",
        status: "REUSED",
        reusedSelectedRate: 262.89,
        reuseLineage: { sourceLaneId: "prior-candidate-physical-lane", sourceBatchId: "scenario-comparison-batch" }
      })
    ]);
  });

  it("evaluates explicit mixed-origin Network Scenario combinations without choosing a winner", async () => {
    const preparedProfiles = scenarioPreparedProfiles();
    const origins = scenarioOrigins();
    prismaMock.prisma.ltlBatchQuoteLane.findMany.mockResolvedValue([]);

    const result = await evaluateSupplyChainDesignNetworkScenario({
      tenantId: "tenant-1",
      scenarioId: "scenario-a",
      scenarioName: "Toronto and Cincinnati",
      selectedOrigins: origins.slice(0, 2),
      shipments: scenarioShipmentsReference(),
      preparedProfiles,
      ratingConfig: scenarioRatingConfig()
    });

    expect(result.selectedWarehouseCount).toBe(2);
    expect(result.eligiblePreparedProfileCount).toBe(3);
    expect(result.maximumOriginProfileCombinations).toBe(6);
    expect(result.reusableExactLaneCount).toBe(0);
    expect(result.missingRateCount).toBe(6);
    expect(result.invalidOriginCount).toBe(0);
    expect(result.distinctSelectedOrigins).toEqual([
      expect.objectContaining({ sourceType: "CURRENT", facilityId: "TOR-01" }),
      expect.objectContaining({ sourceType: "CANDIDATE", facilityId: "CVG-01" })
    ]);
    expect(result.originSummaries).toEqual([
      expect.objectContaining({ facilityId: "TOR-01", validProfileCombinations: 3, missingRateCount: 3 }),
      expect.objectContaining({ facilityId: "CVG-01", validProfileCombinations: 3, missingRateCount: 3 })
    ]);
    expect(result.profileAlternatives).toHaveLength(3);
    expect(result.profileAlternatives[0].alternatives).toHaveLength(2);
    expect(result.profileAlternatives[0].alternatives.every((alternative) => alternative.status === "MISSING_RATE")).toBe(true);
    expect(result.profileAlternatives.flatMap((profile) => profile.alternatives)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ winningOrigin: expect.anything() })])
    );
    expect(result.missingRateManifest).toHaveLength(6);
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("reuses exact prior candidate and current-compatible lanes without requiring whole-batch compatibility", async () => {
    const preparedProfiles = scenarioPreparedProfiles();
    const [toronto, cincinnati] = scenarioOrigins();
    const torontoRequest = scenarioRequestFor(toronto, preparedProfiles[0]);
    const cincinnatiRequest = scenarioRequestFor(cincinnati, preparedProfiles[0]);
    prismaMock.prisma.ltlBatchQuoteLane.findMany.mockImplementation(async () => [
      reusableScenarioLane("prior-current-lane", "prior-current-batch", torontoRequest, 100, { preparationRunId: "different-prep-a" }),
      reusableScenarioLane("prior-candidate-lane", "prior-candidate-batch", cincinnatiRequest, 80, { preparationRunId: "scenario:comparison:previous-run" })
    ]);

    const result = await evaluateSupplyChainDesignNetworkScenario({
      tenantId: "tenant-1",
      scenarioId: "scenario-b",
      scenarioName: "Mixed reusable scenario",
      selectedOrigins: [toronto, cincinnati],
      shipments: scenarioShipmentsReference(),
      preparedProfiles,
      ratingConfig: scenarioRatingConfig()
    });

    const reused = result.profileAlternatives.flatMap((profile) => profile.alternatives).filter((alternative) => alternative.status === "REUSED");
    expect(reused).toEqual(expect.arrayContaining([
      expect.objectContaining({
        originFacilityId: "TOR-01",
        reusedSelectedRate: 100,
        representedModeledTransportationCost: expect.any(Number),
        reuseLineage: { sourceLaneId: "prior-current-lane", sourceBatchId: "prior-current-batch" },
      }),
      expect.objectContaining({
        originFacilityId: "CVG-01",
        reusedSelectedRate: 80,
        representedModeledTransportationCost: expect.any(Number),
        reuseLineage: { sourceLaneId: "prior-candidate-lane", sourceBatchId: "prior-candidate-batch" }
      })
    ]));
    expect(reused).toHaveLength(2);
    expect(reused.every((alternative) => alternative.representedModeledTransportationCost === roundTestCurrency((alternative.reusedSelectedRate ?? 0) * alternative.representedShipments))).toBe(true);
    expect(result.reusableExactLaneCount).toBe(2);
    expect(result.missingRateCount).toBe(4);
    expect(result.missingRateManifest).toHaveLength(4);
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("deduplicates missing scenario requests while retaining affected lineage", async () => {
    const preparedProfiles = scenarioPreparedProfiles({
      shipmentsCsv: [
        ltlShipmentsHeader(),
        "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
        "Individual Shipment,ORD-1002,2026-01-16,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD"
      ].join("\n")
    });
    prismaMock.prisma.ltlBatchQuoteLane.findMany.mockResolvedValue([]);

    const result = await evaluateSupplyChainDesignNetworkScenario({
      tenantId: "tenant-1",
      scenarioId: "scenario-c",
      scenarioName: "Dedup missing rates",
      selectedOrigins: [scenarioOrigins()[1]],
      shipments: scenarioShipmentsReference(),
      preparedProfiles,
      ratingConfig: scenarioRatingConfig()
    });

    expect(result.maximumOriginProfileCombinations).toBe(1);
    expect(result.profileAlternatives[0].representedShipments).toBe(2);
    expect(result.missingRateCount).toBe(1);
    expect(result.missingRateManifest).toHaveLength(1);
    expect(result.missingRateManifest[0].affectedAlternatives).toEqual([
      expect.objectContaining({
        sourceReference: "ORD-1001, ORD-1002",
        representedShipments: 2,
        originFacilityId: "CVG-01"
      })
    ]);
  });

  it("reports invalid origins and ineligible profiles without putting them in the missing-rate manifest", async () => {
    const preparedProfiles = [
      ...scenarioPreparedProfiles().slice(0, 1),
      {
        ...scenarioPreparedProfiles()[0],
        rateRequestKey: "ineligible-profile",
        preparationStatus: "Missing data" as const,
        missingDataReason: "Weight is missing or invalid",
        normalizedRequest: null
      }
    ];
    prismaMock.prisma.ltlBatchQuoteLane.findMany.mockResolvedValue([]);

    const result = await evaluateSupplyChainDesignNetworkScenario({
      tenantId: "tenant-1",
      scenarioId: "scenario-d",
      scenarioName: "Invalid and ineligible",
      selectedOrigins: [
        scenarioOrigins()[0],
        {
          ...scenarioOrigins()[1],
          facilityId: "BAD-01",
          postalCode: null
        }
      ],
      shipments: scenarioShipmentsReference(),
      preparedProfiles,
      ratingConfig: scenarioRatingConfig()
    });

    expect(result.eligiblePreparedProfileCount).toBe(1);
    expect(result.maximumOriginProfileCombinations).toBe(2);
    expect(result.invalidOriginCount).toBe(1);
    expect(result.ineligibleProfileCount).toBe(2);
    expect(result.missingRateCount).toBe(1);
    expect(result.missingRateManifest).toHaveLength(1);
    expect(result.profileAlternatives.flatMap((profile) => profile.alternatives)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "INVALID_ORIGIN", originFacilityId: "BAD-01" }),
        expect.objectContaining({ status: "INELIGIBLE_PROFILE", issue: "Weight is missing or invalid" })
      ])
    );
  });

  it("reuses prior exact successful live 7L lanes without copying old represented volume totals", async () => {
    const input = {
      ...ltlBatchInputFixture(),
      requests: [
        {
          ...ltlBatchInputFixture().requests[0],
          rateRequestKey: "new-reused-key",
          representedShipments: 25,
          request: ltlRequestFixture("new-reused-key", {
            originZipcode: "30303",
            destinationZipcode: "10001",
            pieces: [
              {
                qty: 2,
                weight: 1200,
                weightType: "total" as const,
                length: 48,
                width: 40,
                height: 60,
                dimType: "PLT" as const,
                freightClass: "100",
                hazmat: false,
                stack: false
              }
            ]
          })
        }
      ]
    };
    const previousRequest = ltlRequestFixture("old-key", {
      originZipcode: "30303",
      destinationZipcode: "10001",
      pieces: input.requests[0].request.pieces
    });
    prismaMock.prisma.automationJobRun.update.mockResolvedValue({});
    prismaMock.prisma.ltlBatchQuoteLane.findUnique.mockResolvedValue(null);
    prismaMock.prisma.ltlBatchQuoteLane.findMany.mockResolvedValue([
      ltlLaneFixture({
        id: "lane-old",
        tenantId: "tenant-1",
        jobRunId: "batch-old",
        updatedAt: new Date("2026-07-30T20:00:00.000Z"),
        requestJson: previousRequest,
        selectedRateSource: "7L selected rate",
        selectedQuoteJson: ltlQuoteFixture({ customerReference: "old-key", total: 100, mode: "live" }),
        jobRun: {
          id: "batch-old",
          tenantId: "tenant-1",
          jobType: "supply-chain-design.candidate-ltl-rate-batch",
          status: JobStatus.SUCCESS,
          input: { ...input, accountId: "live-account", carrierHashes: ["carrier-a", "frontline-hash"] }
        }
      })
    ]);
    prismaMock.prisma.ltlBatchQuoteLane.upsert.mockResolvedValue({});

    await runSupplyChainDesignLtlRateBatch(
      { tenantId: "tenant-1", userId: "user-1" },
      "batch-new",
      sevenLAccountRecordsFixture()[1],
      input
    );

    expect(getLtlQuotes).not.toHaveBeenCalled();
    expect(prismaMock.prisma.ltlBatchQuoteLane.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          customerReference: "new-reused-key",
          quoteCount: 0,
          errorCount: 0,
          selectedQuoteJson: expect.objectContaining({
            customerReference: "new-reused-key",
            total: 100,
            scdsReuseLineage: expect.objectContaining({
              sourceLaneId: "lane-old",
              sourceBatchId: "batch-old",
              exactLaneFingerprint: expect.any(String)
            })
          })
        })
      })
    );
    const persisted = prismaMock.prisma.ltlBatchQuoteLane.upsert.mock.calls[0][0].create.selectedQuoteJson;
    expect(persisted.total * input.requests[0].representedShipments).toBe(2500);
    expect(prismaMock.prisma.automationJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: JobStatus.SUCCESS,
          output: expect.objectContaining({
            processedLanes: 1,
            quotedLanes: 1,
            remainingLanes: 0
          })
        })
      })
    );
  });

  it("rates only unmatched lanes in a mixed batch and rejects failed excluded manual and incompatible reusable candidates", async () => {
    const input = {
      ...ltlBatchInputFixture(),
      requests: ltlBatchInputFixture().requests.slice(0, 2).map((request, index) => ({
        ...request,
        rateRequestKey: index === 0 ? "reused-lane" : "live-lane",
        request: ltlRequestFixture(index === 0 ? "reused-lane" : "live-lane", {
          originZipcode: index === 0 ? "30303" : "60601",
          destinationZipcode: "10001",
          pieces: [
            {
              qty: 2,
              weight: 1200,
              weightType: "total" as const,
              length: 48,
              width: 40,
              height: 60,
              dimType: "PLT" as const,
              freightClass: "100",
              hazmat: false,
              stack: false
            }
          ]
        })
      }))
    };
    const reusableRequest = ltlRequestFixture("previous-live", {
      originZipcode: "30303",
      destinationZipcode: "10001",
      pieces: input.requests[0].request.pieces
    });
    prismaMock.prisma.automationJobRun.update.mockResolvedValue({});
    prismaMock.prisma.ltlBatchQuoteLane.findUnique.mockResolvedValue(null);
    prismaMock.prisma.ltlBatchQuoteLane.findMany.mockResolvedValue([
      ltlLaneFixture({
        id: "failed-lane",
        jobRunId: "failed-batch",
        updatedAt: new Date("2026-07-30T20:04:00.000Z"),
        requestJson: reusableRequest,
        errorsJson: [{ errorMessage: "No rate" }],
        selectedRateSource: "None",
        selectedQuoteJson: null,
        jobRun: { input, jobType: "supply-chain-design.candidate-ltl-rate-batch", status: JobStatus.SUCCESS }
      }),
      ltlLaneFixture({
        id: "excluded-lane",
        jobRunId: "excluded-batch",
        updatedAt: new Date("2026-07-30T20:03:00.000Z"),
        requestJson: reusableRequest,
        selectedRateSource: "Excluded",
        exclusionJson: { reason: "Analyst excluded", createdByUserId: "user-1", createdAt: "2026-07-30T20:03:00.000Z" },
        jobRun: { input, jobType: "supply-chain-design.candidate-ltl-rate-batch", status: JobStatus.SUCCESS }
      }),
      ltlLaneFixture({
        id: "manual-lane",
        jobRunId: "manual-batch",
        updatedAt: new Date("2026-07-30T20:02:00.000Z"),
        requestJson: reusableRequest,
        selectedRateSource: "Manual rate",
        manualRateJson: { totalRate: 90, reason: "Manual", createdByUserId: "user-1", createdAt: "2026-07-30T20:02:00.000Z" },
        jobRun: { input, jobType: "supply-chain-design.candidate-ltl-rate-batch", status: JobStatus.SUCCESS }
      }),
      ltlLaneFixture({
        id: "other-account-lane",
        jobRunId: "other-account-batch",
        updatedAt: new Date("2026-07-30T20:01:00.000Z"),
        requestJson: reusableRequest,
        selectedRateSource: "7L selected rate",
        selectedQuoteJson: ltlQuoteFixture({ customerReference: "previous-live", total: 88, mode: "live" }),
        jobRun: { input: { ...input, accountId: "other-account" }, jobType: "supply-chain-design.candidate-ltl-rate-batch", status: JobStatus.SUCCESS }
      }),
      ltlLaneFixture({
        id: "valid-newest-live-lane",
        jobRunId: "valid-newest-live-batch",
        updatedAt: new Date("2026-07-30T20:01:30.000Z"),
        requestJson: reusableRequest,
        selectedRateSource: "7L selected rate",
        selectedQuoteJson: ltlQuoteFixture({ customerReference: "previous-live-newest", total: 66, mode: "live" }),
        jobRun: { input, jobType: "supply-chain-design.candidate-ltl-rate-batch", status: JobStatus.SUCCESS }
      }),
      ltlLaneFixture({
        id: "valid-live-lane",
        jobRunId: "valid-live-batch",
        updatedAt: new Date("2026-07-30T20:00:00.000Z"),
        requestJson: reusableRequest,
        selectedRateSource: "7L selected rate",
        selectedQuoteJson: ltlQuoteFixture({ customerReference: "previous-live", total: 77, mode: "live" }),
        jobRun: { input, jobType: "supply-chain-design.candidate-ltl-rate-batch", status: JobStatus.SUCCESS }
      })
    ]);
    prismaMock.prisma.ltlBatchQuoteLane.upsert.mockResolvedValue({});
    getLtlQuotes.mockResolvedValue({
      data: [ltlQuoteFixture({ customerReference: "live-lane", total: 222, mode: "live" })],
      errors: []
    });

    await runSupplyChainDesignLtlRateBatch(
      { tenantId: "tenant-1", userId: "user-1" },
      "batch-mixed",
      sevenLAccountRecordsFixture()[1],
      input
    );

    expect(getLtlQuotes).toHaveBeenCalledTimes(1);
    expect(getLtlQuotes).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ customerReference: "live-lane" })],
      ["carrier-a", "frontline-hash"],
      expect.anything()
    );
    expect(prismaMock.prisma.ltlBatchQuoteLane.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          customerReference: "reused-lane",
          selectedQuoteJson: expect.objectContaining({
            total: 66,
            scdsReuseLineage: expect.objectContaining({ sourceLaneId: "valid-newest-live-lane" })
          })
        })
      })
    );
    expect(prismaMock.prisma.automationJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: JobStatus.SUCCESS,
          output: expect.objectContaining({
            totalLanes: 2,
            processedLanes: 2,
            quotedLanes: 2
          })
        })
      })
    );
  });

  it("persists a lane-level 7L failure and continues later Network Design lanes", async () => {
    const input = {
      ...ltlBatchInputFixture(),
      requests: [
        {
          ...ltlBatchInputFixture().requests[0],
          rateRequestKey: "done-key",
          request: ltlRequestFixture("done-key", { originZipcode: "30303", originCountry: "US" })
        },
        {
          ...ltlBatchInputFixture().requests[1],
          rateRequestKey: "montreal-key",
          candidateFacilityId: "MTL-01",
          candidateFacilityName: "Montreal Proposed DC",
          request: ltlRequestFixture("montreal-key", { originZipcode: "H3B 1A7", originCountry: "CA" })
        },
        {
          ...ltlBatchInputFixture().requests[2],
          rateRequestKey: "phoenix-key",
          candidateFacilityId: "PHX-01",
          candidateFacilityName: "Phoenix Location Candidate",
          request: ltlRequestFixture("phoenix-key", { originZipcode: "85004", originCountry: "US" })
        }
      ]
    };
    const account = sevenLAccountRecordsFixture()[1];
    prismaMock.prisma.automationJobRun.update.mockResolvedValue({});
    prismaMock.prisma.ltlBatchQuoteLane.findUnique.mockImplementation(async ({ where }: { where: { jobRunId_laneIndex: { laneIndex: number } } }) =>
      where.jobRunId_laneIndex.laneIndex === 0
        ? ltlLaneFixture({ selectedQuoteJson: ltlQuoteFixture({ total: 111, customerReference: "done-key" }) })
        : null
    );
    prismaMock.prisma.ltlBatchQuoteLane.upsert.mockResolvedValue({});
    getLtlQuotes.mockImplementation(async (_account, requests: ReturnType<typeof ltlRequestFixture>[]) => {
      const request = requests[0];
      if (request.customerReference === "montreal-key") {
        throw new Error("7L zipcode lookup failed with status 400.");
      }
      return {
        data: [ltlQuoteFixture({ customerReference: request.customerReference, total: 222 })],
        errors: []
      };
    });

    await runSupplyChainDesignLtlRateBatch(
      { tenantId: "tenant-1", userId: "user-1" },
      "batch-1",
      account,
      input
    );

    expect(getLtlQuotes.mock.calls.map((call) => (call[1] as ReturnType<typeof ltlRequestFixture>[])[0]?.customerReference)).not.toContain("done-key");
    expect(getLtlQuotes.mock.calls.map((call) => (call[1] as ReturnType<typeof ltlRequestFixture>[])[0]?.customerReference)).toEqual(
      expect.arrayContaining(["montreal-key", "phoenix-key"])
    );
    expect(getLtlQuotes).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ customerReference: "montreal-key", originZipcode: "H3B1A7" })],
      ["carrier-a", "frontline-hash"],
      expect.objectContaining({ carrierConcurrency: 3, requestTimeoutMs: 45000 })
    );
    expect(prismaMock.prisma.ltlBatchQuoteLane.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          laneIndex: 1,
          customerReference: "montreal-key",
          quoteCount: 0,
          errorCount: 1,
          errorsJson: [expect.objectContaining({ errorMessage: "Location validation failed." })],
          selectedQuoteJson: null
        })
      })
    );
    expect(prismaMock.prisma.ltlBatchQuoteLane.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          laneIndex: 2,
          customerReference: "phoenix-key",
          quoteCount: 1,
          selectedQuoteJson: expect.objectContaining({ total: 222 })
        })
      })
    );
    expect(prismaMock.prisma.automationJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: JobStatus.SUCCESS,
          output: expect.objectContaining({
            processedLanes: 3,
            quotedLanes: 2,
            issueLanes: 1,
            errorCount: 1
          })
        })
      })
    );
  });

  it("uses conservative bounded defaults and caps for SCDS LTL rate concurrency", () => {
    expect(getSupplyChainDesignLtlRateConcurrencyConfig({})).toEqual({
      laneConcurrency: 2,
      carrierConcurrency: 3,
      requestTimeoutMs: 45000
    });
    const capped = getSupplyChainDesignLtlRateConcurrencyConfig({
      SCDS_LTL_LANE_CONCURRENCY: "50",
      SCDS_LTL_CARRIER_CONCURRENCY: "50",
      SCDS_LTL_REQUEST_TIMEOUT_MS: "999999"
    });
    expect(capped).toEqual({
      laneConcurrency: 5,
      carrierConcurrency: 8,
      requestTimeoutMs: 120000
    });
    expect(2 * 3).toBeLessThanOrEqual(6);
  });

  it("limits SCDS Network Design lane concurrency and persists progress as lanes complete", async () => {
    const previousLaneConcurrency = process.env.SCDS_LTL_LANE_CONCURRENCY;
    process.env.SCDS_LTL_LANE_CONCURRENCY = "2";
    const input = {
      ...ltlBatchInputFixture(),
      requests: ltlBatchInputFixture().requests.map((request, index) => ({
        ...request,
        rateRequestKey: `lane-${index}`,
        request: ltlRequestFixture(`lane-${index}`)
      }))
    };
    const account = sevenLAccountRecordsFixture()[1];
    let active = 0;
    let maxActive = 0;
    prismaMock.prisma.automationJobRun.update.mockResolvedValue({});
    prismaMock.prisma.ltlBatchQuoteLane.findUnique.mockResolvedValue(null);
    prismaMock.prisma.ltlBatchQuoteLane.upsert.mockResolvedValue({});
    getLtlQuotes.mockImplementation(async (_account, requests: ReturnType<typeof ltlRequestFixture>[]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, requests[0].customerReference === "lane-0" ? 25 : 5));
      active -= 1;
      return {
        data: [ltlQuoteFixture({ customerReference: requests[0].customerReference, total: requests[0].customerReference === "lane-3" ? 90 : 100 })],
        errors: []
      };
    });

    try {
      await runSupplyChainDesignLtlRateBatch(
        { tenantId: "tenant-1", userId: "user-1" },
        "batch-concurrency",
        account,
        input
      );
    } finally {
      if (previousLaneConcurrency === undefined) {
        delete process.env.SCDS_LTL_LANE_CONCURRENCY;
      } else {
        process.env.SCDS_LTL_LANE_CONCURRENCY = previousLaneConcurrency;
      }
    }

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
    expect(prismaMock.prisma.ltlBatchQuoteLane.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          laneIndex: 3,
          customerReference: "lane-3",
          selectedQuoteJson: expect.objectContaining({ total: 90 })
        })
      })
    );
    expect(prismaMock.prisma.automationJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          output: expect.objectContaining({
            processedLanes: expect.any(Number),
            remainingLanes: expect.any(Number),
            currentStage: "Requesting 7L rates"
          })
        })
      })
    );
  });

  it("creates a project-scoped 7L rate batch from a reviewed preparation without live 7L in tests", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const preparationResult = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture());
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      ltlRatePreparationRuns: [
        {
          id: "prep-run-1",
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          createdAt: new Date("2026-07-30T20:00:00.000Z"),
          resultSummary: preparationResult
        }
      ]
    });
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValueOnce({ id: "ltl-access" });
    prismaMock.prisma.integrationCredential.findMany.mockResolvedValueOnce(sevenLAccountRecordsFixture());
    prismaMock.prisma.automationJobRun.create.mockResolvedValueOnce({ id: "batch-1" });

    const response = await startSupplyChainDesignLtlRateBatchAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", preparationRunId: "prep-run-1" })
    );

    expect(response).toEqual({ ok: true, message: "Network Design rate run started.", runId: "batch-1" });
    expect(prismaMock.prisma.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        jobType: "supply-chain-design.candidate-ltl-rate-batch",
        status: "QUEUED",
        input: expect.objectContaining({
          source: "SUPPLY_CHAIN_DESIGN",
          projectId: "project-1",
          preparationRunId: "prep-run-1",
          accountName: "7L Live Preferred Carriers",
          requests: expect.arrayContaining([
            expect.objectContaining({
              rateRequestKey: expect.any(String),
              representedShipments: expect.any(Number),
              request: expect.objectContaining({ customerReference: expect.any(String) })
            })
          ])
        })
      })
    });
    expect(revalidatePath).toHaveBeenCalledWith("/supply-chain-design/project-1");
  });

  it("resumes an active compatible Network Design rate batch instead of creating a duplicate", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const preparationResult = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture());
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      ltlRatePreparationRuns: [
        {
          id: "prep-run-1",
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          createdAt: new Date("2026-07-30T20:00:00.000Z"),
          resultSummary: preparationResult
        }
      ]
    });
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValueOnce({ id: "ltl-access" });
    prismaMock.prisma.integrationCredential.findMany.mockResolvedValueOnce(sevenLAccountRecordsFixture());
    prismaMock.prisma.automationJobRun.findMany.mockResolvedValueOnce([
      {
        id: "batch-1",
        input: ltlBatchInputFixture()
      }
    ]);
    prismaMock.prisma.supplyChainDesignLtlRatePreparationRun.findMany.mockResolvedValueOnce([]);
    prismaMock.prisma.automationJobRun.create.mockClear();

    const response = await runSupplyChainDesignNetworkDesignAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", preparationRunId: "prep-run-1" })
    );

    expect(response).toEqual({
      ok: true,
      message: "Network Design rate run resumed.",
      runId: "batch-1",
      runStatus: "QUEUED",
      requestTotal: ltlBatchInputFixture().requests.length
    });
    expect(prismaMock.prisma.automationJobRun.create).not.toHaveBeenCalled();
  });

  it("does not reuse failed or legacy-incompatible Network Design rate batches", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const preparationResult = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture());
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      ltlRatePreparationRuns: [
        {
          id: "prep-run-1",
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          createdAt: new Date("2026-07-30T20:00:00.000Z"),
          resultSummary: preparationResult
        }
      ]
    });
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValueOnce({ id: "ltl-access" });
    prismaMock.prisma.integrationCredential.findMany.mockResolvedValueOnce(sevenLAccountRecordsFixture());
    prismaMock.prisma.automationJobRun.findMany
      .mockResolvedValueOnce([
        {
          id: "legacy-active-batch",
          input: {
            ...ltlBatchInputFixture(),
            requests: ltlBatchInputFixture().requests.map(({ currentTransportationCost: _cost, currentTransportationCostPerShipment: _costPerShipment, ...request }) => request)
          }
        }
      ])
      .mockResolvedValueOnce([]);
    prismaMock.prisma.automationJobRun.create.mockResolvedValueOnce({ id: "batch-new" });

    const response = await runSupplyChainDesignNetworkDesignAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", preparationRunId: "prep-run-1" })
    );

    expect(response).toEqual({
      ok: true,
      message: "Network Design rate run started.",
      runId: "batch-new",
      runStatus: "QUEUED",
      requestTotal: ltlBatchInputFixture().requests.length
    });
    expect(prismaMock.prisma.automationJobRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: JobStatus.SUCCESS
        })
      })
    );
    expect(prismaMock.prisma.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: JobStatus.QUEUED,
        input: expect.objectContaining({
          requests: expect.arrayContaining([expect.objectContaining({ currentTransportationCost: expect.any(Number) })])
        })
      })
    });
  });

  it("reuses only completed Network Design batches with accepted rates and current-cost evidence", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const preparationResult = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture());
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      ltlRatePreparationRuns: [
        {
          id: "prep-run-1",
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          createdAt: new Date("2026-07-30T20:00:00.000Z"),
          resultSummary: preparationResult
        }
      ]
    });
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValueOnce({ id: "ltl-access" });
    prismaMock.prisma.integrationCredential.findMany.mockResolvedValueOnce(sevenLAccountRecordsFixture());
    prismaMock.prisma.automationJobRun.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "completed-batch",
          input: ltlBatchInputFixture(),
          ltlBatchQuoteLanes: [ltlLaneFixture({ selectedQuoteJson: ltlQuoteFixture({ total: 100 }) })]
        }
      ]);
    prismaMock.prisma.automationJobRun.create.mockClear();

    const response = await runSupplyChainDesignNetworkDesignAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", preparationRunId: "prep-run-1" })
    );

    expect(response).toEqual({
      ok: true,
      message: "Completed rates from the existing Network Design run were reused.",
      runId: "completed-batch",
      runStatus: "SUCCESS",
      requestTotal: ltlBatchInputFixture().requests.length
    });
    expect(prismaMock.prisma.automationJobRun.create).not.toHaveBeenCalled();
  });

  it("does not choose the dry-run 7L account merely because it is active", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const preparationResult = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture());
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      ltlRatePreparationRuns: [
        {
          id: "prep-run-1",
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          createdAt: new Date("2026-07-30T20:00:00.000Z"),
          resultSummary: preparationResult
        }
      ]
    });
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValueOnce({ id: "ltl-access" });
    prismaMock.prisma.integrationCredential.findMany.mockResolvedValueOnce([
      {
        id: "dry-run-account",
        name: "7L Dry Run - Core LTL",
        status: "ACTIVE",
        secretRef: null,
        publicConfig: {
          dryRun: true,
          carriers: [
            { carrierHash: "dry-carrier", name: "Dry Run Carrier", code: "DRY", scac: "DRYY", enabled: true }
          ]
        }
      }
    ]);
    prismaMock.prisma.automationJobRun.create.mockClear();

    const response = await runSupplyChainDesignNetworkDesignAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", preparationRunId: "prep-run-1" })
    );

    expect(response).toEqual({
      ok: false,
      message: "The configured live 7L account is not available."
    });
    expect(prismaMock.prisma.automationJobRun.create).not.toHaveBeenCalled();
  });

  it("does not reuse a completed dry-run Network Design batch after selecting the live account", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const preparationResult = prepareSupplyChainDesignCandidateLtlRateRequests(ltlPreparationInputFixture());
    prismaMock.prisma.supplyChainDesignProject.findUnique.mockResolvedValueOnce({
      id: "project-1",
      ltlRatePreparationRuns: [
        {
          id: "prep-run-1",
          status: SupplyChainDesignModelRunStatus.SUCCESS,
          createdAt: new Date("2026-07-30T20:00:00.000Z"),
          resultSummary: preparationResult
        }
      ]
    });
    prismaMock.prisma.tenantModuleAccess.findFirst.mockResolvedValueOnce({ id: "ltl-access" });
    prismaMock.prisma.integrationCredential.findMany.mockResolvedValueOnce(sevenLAccountRecordsFixture());
    prismaMock.prisma.automationJobRun.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "old-dry-run-batch",
          input: {
            ...ltlBatchInputFixture(),
            accountId: "dry-run-account",
            accountName: "7L Dry Run - Core LTL"
          },
          ltlBatchQuoteLanes: [ltlLaneFixture({ selectedQuoteJson: ltlQuoteFixture({ total: 100 }) })]
        }
      ]);
    prismaMock.prisma.automationJobRun.create.mockResolvedValueOnce({ id: "live-batch" });

    const response = await runSupplyChainDesignNetworkDesignAction(
      { ok: false, message: "" },
      form({ projectId: "project-1", preparationRunId: "prep-run-1" })
    );

    expect(response).toEqual({
      ok: true,
      message: "Network Design rate run started.",
      runId: "live-batch",
      runStatus: "QUEUED",
      requestTotal: ltlBatchInputFixture().requests.length
    });
    expect(prismaMock.prisma.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: expect.objectContaining({
          accountId: "live-account",
          accountName: "7L Live Preferred Carriers"
        })
      })
    });
  });

  it("exports successful failed manual and excluded SCDS LTL rate rows", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const batchInput = ltlBatchInputFixture();
    prismaMock.prisma.automationJobRun.findMany.mockResolvedValueOnce([
      {
        id: "batch-1",
        status: "SUCCESS",
        startedAt: new Date("2026-07-30T20:00:00.000Z"),
        finishedAt: new Date("2026-07-30T20:05:00.000Z"),
        errorMessage: null,
        input: batchInput,
        ltlBatchQuoteLanes: [
          ltlLaneFixture({ customerReference: batchInput.requests[0].rateRequestKey, selectedQuoteJson: ltlQuoteFixture({ total: 100 }) }),
          ltlLaneFixture({
            customerReference: batchInput.requests[1].rateRequestKey,
            selectedQuoteJson: null,
            errorsJson: [{ ...ltlQuoteFixture({ total: 0 }), errorMessage: "Carrier failed" }]
          }),
          ltlLaneFixture({
            customerReference: batchInput.requests[2].rateRequestKey,
            selectedQuoteJson: null,
            manualRateJson: { totalRate: 125, reason: "Analyst quote", createdByUserId: "user-1", createdAt: "2026-07-30T20:06:00.000Z" }
          }),
          ltlLaneFixture({
            customerReference: batchInput.requests[3].rateRequestKey,
            selectedQuoteJson: null,
            exclusionJson: { reason: "Do not rate", createdByUserId: "user-1", createdAt: "2026-07-30T20:07:00.000Z" }
          })
        ]
      }
    ]);

    const csv = await exportSupplyChainDesignLtlRateBatchCsv(context(PlatformRole.ADMIN), "project-1", "batch-1");

    expect(csv).toContain("Rate Request Key,Preparation Run ID,Rate Batch ID");
    expect(csv).toContain(batchInput.requests[0].rateRequestKey);
    expect(csv).toContain(batchInput.requests[1].rateRequestKey);
    expect(csv).toContain(batchInput.requests[2].rateRequestKey);
    expect(csv).toContain(batchInput.requests[3].rateRequestKey);
    expect(csv).toContain("7L selected rate");
    expect(csv).toContain("Manual rate");
    expect(csv).toContain("Excluded");
    expect(csv).toContain("Carrier failed");
  });

  it("uses linked preparation source-row exclusions in completed Network Design summaries", async () => {
    const batchInput = ltlThreeCandidateThreeProfileBatchInputFixture();
    prismaMock.prisma.automationJobRun.findMany.mockResolvedValueOnce([
      {
        id: "batch-1",
        status: "SUCCESS",
        startedAt: new Date("2026-07-30T20:00:00.000Z"),
        finishedAt: new Date("2026-07-30T20:05:00.000Z"),
        errorMessage: null,
        input: batchInput,
        output: null,
        ltlBatchQuoteLanes: batchInput.requests.map((request, index) =>
          ltlLaneFixture({ customerReference: request.rateRequestKey, selectedQuoteJson: ltlQuoteFixture({ total: 100 + index }) })
        )
      },
      {
        id: "scenario-comparison-batch",
        status: "SUCCESS",
        startedAt: new Date("2026-07-30T20:10:00.000Z"),
        finishedAt: new Date("2026-07-30T20:11:00.000Z"),
        errorMessage: null,
        input: {
          ...batchInput,
          preparationRunId: "scenario:comparison:comparison-1"
        },
        output: null,
        ltlBatchQuoteLanes: batchInput.requests.slice(0, 1).map((request) =>
          ltlLaneFixture({ customerReference: request.rateRequestKey, selectedQuoteJson: ltlQuoteFixture({ total: 100 }) })
        )
      }
    ]);
    prismaMock.prisma.supplyChainDesignLtlRatePreparationRun.findMany.mockResolvedValueOnce([
      {
        id: "prep-run-1",
        resultSummary: {
          resultVersion: SCDS_LTL_RATE_PREPARATION_RESULT_VERSION,
          historicalRowsReviewed: 4,
          candidateWarehouseCount: 3,
          readyRequestCount: 9,
          missingDataRequestCount: 0,
          excludedNonLtlRowCount: 1,
          duplicateRequestsConsolidated: 0,
          preparedRequests: [],
          sourceRowOutcomes: [],
          assumptions: []
        }
      }
    ]);

    const batches = await getSupplyChainDesignLtlRateBatches(context(PlatformRole.ADMIN), "project-1");

    expect(batches.map((batch) => batch.id)).toEqual(["batch-1"]);
    expect(batches[0].sourceRowCounts).toEqual({
      historicalRowsReviewed: 4,
      ltlRowsReviewed: 3,
      shipmentsRepresented: 27,
      rateRequestsCompleted: 9,
      incompleteLtlRowsExcluded: 0,
      nonLtlRowsExcluded: 1,
      unratedRateRequests: 0
    });
    expect(batches[0].coverage.coveredShipments).toBe(27);
  });

  it("loads scenario comparison batches by ID for status polling while keeping them out of Network Design history", async () => {
    const batchInput = ltlThreeCandidateThreeProfileBatchInputFixture();
    const scenarioInput = {
      ...batchInput,
      preparationRunId: "scenario:comparison:comparison-1",
      requests: batchInput.requests.slice(0, 3)
    };
    const scenarioJob = {
      id: "scenario-batch-1",
      status: "SUCCESS",
      startedAt: new Date("2026-08-10T15:56:11.869Z"),
      finishedAt: new Date("2026-08-10T15:57:28.555Z"),
      errorMessage: null,
      input: scenarioInput,
      output: {
        totalLanes: 3,
        processedLanes: 3,
        quotedLanes: 3,
        issueLanes: 0,
        remainingLanes: 0
      },
      ltlBatchQuoteLanes: scenarioInput.requests.map((request, index) =>
        ltlLaneFixture({
          customerReference: request.rateRequestKey,
          selectedRateSource: "7L selected rate",
          selectedQuoteJson: ltlQuoteFixture({ total: 200 + index, mode: "live" })
        })
      )
    };
    prismaMock.prisma.automationJobRun.findMany.mockResolvedValueOnce([scenarioJob]);
    prismaMock.prisma.automationJobRun.findFirst.mockResolvedValueOnce(scenarioJob);

    const history = await getSupplyChainDesignLtlRateBatches(context(PlatformRole.ADMIN), "project-1");
    const direct = await getSupplyChainDesignLtlRateBatchById(context(PlatformRole.ADMIN), "project-1", "scenario-batch-1");

    expect(history).toEqual([]);
    expect(direct).toMatchObject({
      id: "scenario-batch-1",
      status: "SUCCESS",
      preparationRunId: "scenario:comparison:comparison-1",
      requestsSubmitted: 3,
      processedRequests: 3,
      ratedSuccessfully: 3
    });
  });

  it("uses the direct LTL batch lookup in the status route so scenario batches can reconcile", () => {
    const routeSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/ltl-rate-batches/[batchId]/status/route.ts",
      "utf8"
    );

    expect(routeSource).toContain("getSupplyChainDesignLtlRateBatchById");
    expect(routeSource).not.toContain("getSupplyChainDesignLtlRateBatches(context, projectId)");
  });

  it("exports Network Design shipment and candidate summary comparison evidence", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const batchInput = {
      ...ltlBatchInputFixture(),
      comparisonSetup: {
        scenarioSelections: [{ candidateFacilityId: "ATL-01", scenarioType: "REPLACE" as const, comparedCurrentFacilityIds: [] }],
        currentFacilities: [
          { facilityId: "DFW-3PL", facilityName: "Dallas Current 3PL", annualFacilityCost: 250000 },
          { facilityId: "TOR-01", facilityName: "Toronto Current Warehouse", annualFacilityCost: 200000 }
        ],
        candidateFacilities: [{ facilityId: "ATL-01", facilityName: "Atlanta Proposed Warehouse", annualFixedCost: 300000 }]
      }
    };
    prismaMock.prisma.automationJobRun.findMany.mockResolvedValue([
      {
        id: "batch-1",
        status: "SUCCESS",
        startedAt: new Date("2026-07-30T20:00:00.000Z"),
        finishedAt: new Date("2026-07-30T20:05:00.000Z"),
        errorMessage: null,
        input: batchInput,
        ltlBatchQuoteLanes: [
          ltlLaneFixture({
            customerReference: batchInput.requests[0].rateRequestKey,
            selectedQuoteJson: ltlQuoteFixture({ total: 100, rateRemarks: ["Selected carrier note."] }),
            errorsJson: [{ ...ltlQuoteFixture({ total: 0 }), errorMessage: "Alternative carrier failed." }]
          }),
          ltlLaneFixture({ customerReference: batchInput.requests[2].rateRequestKey, selectedQuoteJson: ltlQuoteFixture({ total: 125 }) })
        ]
      }
    ]);
    prismaMock.prisma.supplyChainDesignLtlRatePreparationRun.findMany.mockResolvedValue([
      {
        id: "prep-run-1",
        resultSummary: {
          resultVersion: SCDS_LTL_RATE_PREPARATION_RESULT_VERSION,
          historicalRowsReviewed: 4,
          candidateWarehouseCount: 2,
          readyRequestCount: 3,
          missingDataRequestCount: 0,
          excludedNonLtlRowCount: 1,
          duplicateRequestsConsolidated: 0,
          preparedRequests: [],
          sourceRowOutcomes: [],
          assumptions: []
        }
      }
    ]);

    const shipmentCsv = await exportSupplyChainDesignShipmentComparisonCsv(context(PlatformRole.ADMIN), "project-1", "batch-1");
    const summaryCsv = await exportSupplyChainDesignCandidateSummaryCsv(context(PlatformRole.ADMIN), "project-1", "batch-1");

    expect(shipmentCsv).toContain("Current Facility ID,Current Facility Name,Candidate Facility ID,Candidate Facility Name");
    expect(shipmentCsv).toContain("Current Transportation Cost per Shipment,Candidate Transportation Cost per Shipment,Difference per Shipment");
    expect(shipmentCsv).toContain("Current Total Transportation Cost,Candidate Total Transportation Cost,Total Difference");
    expect(shipmentCsv).toContain("7L Rate Date");
    expect(shipmentCsv).toContain("DFW-3PL,DFW-3PL,ATL-01,Atlanta Proposed Warehouse");
    expect(shipmentCsv).toContain("Selected carrier note.");
    expect(shipmentCsv).toContain("Rated,");
    expect(shipmentCsv).not.toContain("Alternative carrier failed.");
    expect(summaryCsv).toContain("Candidate Warehouse,Current Facilities Represented,Covered Shipments");
    expect(summaryCsv).toContain("Current Warehouse Cost,Candidate Warehouse Cost,Current Covered Network Cost,Proposed Covered Network Cost");
    expect(summaryCsv).toContain("ATL-01 - Atlanta Proposed Warehouse");
    expect(summaryCsv).toContain("DFW-3PL; TOR-01");
  });

  it("keeps aggregated Network Design shipment totals as per-shipment rate times represented shipments", async () => {
    getAuthenticatedContext.mockResolvedValue(context(PlatformRole.ADMIN));
    const batchInput = ltlBatchInputFixture();
    prismaMock.prisma.automationJobRun.findMany.mockResolvedValueOnce([
      {
        id: "batch-1",
        status: "SUCCESS",
        startedAt: new Date("2026-07-30T20:00:00.000Z"),
        finishedAt: new Date("2026-07-30T20:05:00.000Z"),
        errorMessage: null,
        input: batchInput,
        output: null,
        ltlBatchQuoteLanes: [
          ltlLaneFixture({ customerReference: batchInput.requests[0].rateRequestKey, selectedQuoteJson: ltlQuoteFixture({ total: 100 }) }),
          ltlLaneFixture({ customerReference: batchInput.requests[1].rateRequestKey, selectedQuoteJson: ltlQuoteFixture({ total: 90 }) }),
          ltlLaneFixture({ customerReference: batchInput.requests[2].rateRequestKey, selectedQuoteJson: ltlQuoteFixture({ total: 125 }) }),
          ltlLaneFixture({ customerReference: batchInput.requests[3].rateRequestKey, selectedQuoteJson: ltlQuoteFixture({ total: 130 }) })
        ]
      }
    ]);
    prismaMock.prisma.supplyChainDesignLtlRatePreparationRun.findMany.mockResolvedValueOnce([]);

    const shipmentCsv = await exportSupplyChainDesignShipmentComparisonCsv(context(PlatformRole.ADMIN), "project-1", "batch-1");

    expect(shipmentCsv).toContain("ORD-2001,Aggregated Activity,10,2,1000,lb,48 x 40 x 60,in,125,61,100,39,610,1000,390");
    expect(shipmentCsv).toContain("ORD-2001,Aggregated Activity,10,2,1000,lb,48 x 40 x 60,in,125,61,90,29,610,900,290");
  });

  it("exposes Network Design CSV downloads as attachment routes", () => {
    const shipmentRouteSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/ltl-rate-batches/[batchId]/shipment-comparison/route.ts",
      "utf8"
    );
    const candidateRouteSource = readFileSync(
      "src/app/(authenticated)/supply-chain-design/[projectId]/ltl-rate-batches/[batchId]/candidate-summary/route.ts",
      "utf8"
    );

    expect(shipmentRouteSource).toContain('"Content-Type": "text/csv; charset=utf-8"');
    expect(shipmentRouteSource).toContain('"Content-Disposition": `attachment; filename="network-design-shipment-comparison-${batchId}.csv"`');
    expect(candidateRouteSource).toContain('"Content-Type": "text/csv; charset=utf-8"');
    expect(candidateRouteSource).toContain('"Content-Disposition": `attachment; filename="network-design-candidate-summary-${batchId}.csv"`');
  });

  it("keeps Network Design sample candidate warehouse costs explicit", () => {
    const sample = readFileSync(
      "docs/modules/supply-chain-design/sample-data/candidate-warehouses-and-costs-sample.csv",
      "utf8"
    );

    expect(sample).toContain("CHI-3PL,Chicago Variable 3PL,Proposed 3PL,60601,US,,6.00,5.00,14.00,10000,USD");
    expect(sample).toContain("ATL-3PL,Atlanta Variable 3PL,Proposed 3PL,30303,US,,5.50,4.75,13.00,12000,USD");
    expect(sample).toContain("PHX-3PL,Phoenix Variable 3PL,Proposed 3PL,85004,US,,6.25,5.25,15.00,9000,USD");
    expect(sample).toContain("DFW-ALLIN,Dallas Annual All-In Candidate,Proposed Leased,75201,US,195000,7.50,6.50,16.00,11000,USD");
  });
});

function ltlPreparationInputFixture(
  options: {
    shipmentsCsv?: string;
    candidateCsv?: string;
  } = {}
) {
  return {
    tenantId: "tenant-1",
    projectId: "project-1",
    shipments: {
      fileId: "shipments-file",
      mappingId: "shipments-mapping",
      tableType: SupplyChainDesignTableType.SHIPMENTS,
      fileName: "historical-shipments.csv",
      fileBytes: Buffer.from(options.shipmentsCsv ?? ltlShipmentsCsv()),
      fieldMappings: testFieldMappings(ltlShipmentFieldMappings())
    },
    candidateFacilities: {
      fileId: "candidate-file",
      mappingId: "candidate-mapping",
      tableType: SupplyChainDesignTableType.CANDIDATE_FACILITIES,
      fileName: "candidate-warehouses.csv",
      fileBytes: Buffer.from(options.candidateCsv ?? ltlCandidateCsv()),
      fieldMappings: testFieldMappings(ltlCandidateFieldMappings())
    }
  };
}

function combinedTransportationFixture(profiles: any[]) {
  const alternatives = profiles.flatMap((profile) => profile.alternatives);
  return {
    scenarioId: "scenario-1",
    scenarioName: "Scenario 1",
    selectedWarehouseCount: 2,
    eligiblePreparedProfileCount: profiles.length,
    maximumOriginProfileCombinations: alternatives.length,
    reusableExactLaneCount: alternatives.filter((alternative) => alternative.status === "REUSED").length,
    missingRateCount: alternatives.filter((alternative) => alternative.status === "MISSING_RATE").length,
    invalidOriginCount: 0,
    ineligibleProfileCount: 0,
    distinctSelectedOrigins: [],
    representedShipmentVolumeCovered: alternatives
      .filter((alternative) => alternative.status === "REUSED")
      .reduce((total, alternative) => total + alternative.representedShipments, 0),
    originSummaries: [],
    profileAlternatives: profiles,
    missingRateManifest: []
  };
}

function orchestrationInputFixture(transportationEvaluation: any, overrides: Record<string, unknown> = {}) {
  const combinedCostOverrides = (overrides.combinedCostInput ?? {}) as Record<string, unknown>;
  const selectedFacilities = (overrides.selectedFacilities ?? combinedCostOverrides.selectedFacilities ?? [
    candidateCombinedFacility("A-3PL", "A Warehouse", { inboundFeePerPallet: 5, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: 10 }),
    candidateCombinedFacility("B-3PL", "B Warehouse", { inboundFeePerPallet: 2, outboundFeePerPallet: 1, storageFeePerPalletPerMonth: 2 }),
    currentCombinedFacility("TOR-01", "Toronto Current", { annualFacilityWarehouseCost: 200000 })
  ]) as any;
  const warehouseCostProfilesByProfileKey = (overrides.warehouseCostProfilesByProfileKey ?? combinedCostOverrides.warehouseCostProfilesByProfileKey ?? Object.fromEntries(
    transportationEvaluation.profileAlternatives.map((profile: any) => [
      profile.profileKey,
      combinedWarehouseProfile(profile.profileKey, { representedShipments: profile.representedShipments })
    ])
  )) as any;
  return {
    context: context(PlatformRole.ADMIN),
    projectId: "project-1",
    transportationInput: {
      tenantId: "tenant-1",
      scenarioId: "scenario-1",
      scenarioName: "Scenario 1",
      selectedOrigins: [],
      shipments: {
        fileId: "shipments-file",
        fileName: "historical-shipments.csv",
        mappingId: "shipments-mapping",
        mappingUpdatedAt: "2026-01-01T00:00:00.000Z"
      },
      preparedProfiles: [],
      ratingConfig: {
        accountId: "account-1",
        accountName: "Live 7L",
        carrierHashes: ["carrier-a"]
      }
    },
    combinedCostInput: {
      scenarioId: "scenario-1",
      scenarioName: "Scenario 1",
      transportationCurrency: "USD",
      selectedFacilities,
      warehouseCostProfilesByProfileKey,
      ...combinedCostOverrides
    },
    account: sevenLAccountFixture(),
    ...overrides
  } as any;
}

function comparisonOrchestrationFixture(overrides: {
  scenarioACombined?: Record<string, unknown>;
  scenarioBCombined?: Record<string, unknown>;
} = {}) {
  const createInput = networkScenarioComparisonCreateInput();
  const scenarioACombined = {
    scenarioId: "scenario-a",
    scenarioName: "Scenario A",
    transportationCurrency: "USD",
    selectedFacilities: [
      candidateCombinedFacility("A-3PL", "A Warehouse", { currency: "USD", inboundFeePerPallet: 5, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: 10 })
    ],
    warehouseCostProfilesByProfileKey: {
      "profile-1": combinedWarehouseProfile("profile-1")
    },
    ...(overrides.scenarioACombined ?? {})
  };
  const scenarioBCombined = {
    scenarioId: "scenario-b",
    scenarioName: "Scenario B",
    transportationCurrency: "USD",
    selectedFacilities: [
      candidateCombinedFacility("B-3PL", "B Warehouse", { currency: "USD", inboundFeePerPallet: 5, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: 10 })
    ],
    warehouseCostProfilesByProfileKey: {
      "profile-1": combinedWarehouseProfile("profile-1")
    },
    ...(overrides.scenarioBCombined ?? {})
  };
  return {
    context: context(PlatformRole.ADMIN),
    projectId: "project-1",
    inputReferences: createInput.inputReferences,
    scenarioInputs: createInput.scenarioInputs,
    scenarioA: {
      scenarioKey: "A" as const,
      scenarioName: "Scenario A",
      transportationInput: comparisonTransportationInput("scenario-a", "Scenario A"),
      combinedCostInput: scenarioACombined
    },
    scenarioB: {
      scenarioKey: "B" as const,
      scenarioName: "Scenario B",
      transportationInput: comparisonTransportationInput("scenario-b", "Scenario B"),
      combinedCostInput: scenarioBCombined
    },
    account: sevenLAccountFixture(),
    carrierHashes: ["carrier-a"],
    fxInput: null,
    resultInputs: { warehouseProfileEvidenceHash: "profiles-v1" }
  } as any;
}

function comparisonOrchestrationDeps(evalA: any, evalB: any) {
  const run = networkScenarioComparisonRunRecord({ id: "comparison-1", status: "EVALUATING", resultSummary: null });
  return {
    findCompletedRun: vi.fn().mockResolvedValue(null),
    findActiveRun: vi.fn().mockResolvedValue(null),
    createRun: vi.fn().mockResolvedValue(run),
    updateRun: vi.fn((_: unknown, __: string, ___: string, update: any) =>
      Promise.resolve(networkScenarioComparisonRunRecord({
        id: "comparison-1",
        status: update.status,
        resultSummary: update.resultSummary ?? null,
        ratingEvidence: update.ratingEvidence ?? run.ratingEvidence,
        fxInput: update.fxInput ?? null,
        errorMessage: update.errorMessage ?? null
      }))
    ),
    evaluateTransportation: vi.fn()
      .mockResolvedValueOnce(evalA)
      .mockResolvedValueOnce(evalB),
    createMissingRateBatch: vi.fn()
  };
}

function comparisonTransportationInput(scenarioId: string, scenarioName: string) {
  return {
    tenantId: "tenant-1",
    scenarioId,
    scenarioName,
    selectedOrigins: [],
    shipments: {
      fileId: "shipments-file",
      fileName: "historical-shipments.csv",
      mappingId: "shipments-mapping",
      mappingUpdatedAt: "2026-01-01T00:00:00.000Z"
    },
    preparedProfiles: [],
    ratingConfig: {
      accountId: "account-1",
      accountName: "Live 7L",
      carrierHashes: ["carrier-a"]
    }
  };
}

function comparisonScenarioWorkFixture(scenarioKey: "A" | "B") {
  return {
    scenarioKey,
    scenarioName: `Scenario ${scenarioKey}`,
    transportationInput: comparisonTransportationInput(`scenario-${scenarioKey.toLowerCase()}`, `Scenario ${scenarioKey}`),
    combinedCostInput: comparisonOrchestrationFixture()[scenarioKey === "A" ? "scenarioA" : "scenarioB"].combinedCostInput,
    transportationEvaluation: combinedTransportationFixture([
      combinedProfileFixture("profile-1", [combinedAlternativeFixture("profile-1", `${scenarioKey}-3PL`, `${scenarioKey} Warehouse`, null, "CANDIDATE", "MISSING_RATE")])
    ])
  } as any;
}

function networkScenarioComparisonCreateInput(overrides: Record<string, any> = {}) {
  const inputReferences = {
    tenantId: "tenant-1",
    projectId: "project-1",
    historicalShipments: fileRef("shipments-file", "historical-shipments.csv", "hash-shipments", "shipments-mapping"),
    currentFacilities: fileRef("current-file", "current-facilities.csv", "hash-current", "current-mapping"),
    candidateFacilities: fileRef("candidate-file", "candidate-warehouses.csv", "hash-candidates", "candidate-mapping")
  };
  const scenarioInputs = {
    historicalShipments: inputReferences.historicalShipments,
    scenarios: [
      {
        scenarioKey: "A" as const,
        scenarioName: "Current Network",
        selectedFacilities: [
          selectedScenarioFacility("TOR-01", "CURRENT", "Toronto DC", "M5V 2T6", { annualAllInCost: 200000 }),
          selectedScenarioFacility("DFW-3PL", "CURRENT", "Dallas 3PL", "75201", { annualAllInCost: 250000 })
        ]
      },
      {
        scenarioKey: "B" as const,
        scenarioName: "Proposed Network",
        selectedFacilities: [
          selectedScenarioFacility("CHI-3PL", "CANDIDATE", "Chicago 3PL", "60601", { inboundFeePerPallet: 5, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: 10 }),
          selectedScenarioFacility("RNO-3PL", "CANDIDATE", "Reno 3PL", "89501", { inboundFeePerPallet: 6, outboundFeePerPallet: 4, storageFeePerPalletPerMonth: 9 })
        ]
      }
    ] as any
  };
  const ratingEvidence = {
    phase: "RATES_REQUIRED",
    ratingBatchIds: ["batch-1"],
    missingRateCount: 1,
    reusedLaneCount: 3,
    exactLaneFingerprints: ["fp-a"],
    laneReferences: [{ exactLaneFingerprint: "fp-a", batchId: "batch-1", laneId: "lane-1", status: "REUSED" }],
    reconciliation: { ratingAccountId: "account-1", carrierHashes: ["carrier-a", "carrier-b"] }
  };
  return {
    projectId: "project-1",
    status: "RATES_REQUIRED" as const,
    scenarioAName: "Current Network",
    scenarioBName: "Proposed Network",
    inputReferences,
    scenarioInputs,
    ratingEvidence,
    fxInput: null,
    resultSummary: networkScenarioComparisonResultSummary(),
    errorMessage: null,
    ...overrides
  };
}

function networkScenarioComparisonRunRecord(overrides: Record<string, any> = {}) {
  const input = networkScenarioComparisonCreateInput();
  const transportationFingerprint = overrides.transportationFingerprint ?? buildNetworkScenarioTransportationFingerprint({
    inputReferences: overrides.inputReferences ?? input.inputReferences,
    scenarioInputs: overrides.scenarioInputs ?? input.scenarioInputs,
    ratingAccountId: "account-1",
    carrierHashes: ["carrier-a", "carrier-b"]
  });
  return {
    id: overrides.id ?? "comparison-1",
    tenantId: overrides.tenantId ?? "tenant-1",
    projectId: overrides.projectId ?? "project-1",
    status: overrides.status ?? input.status,
    calculationVersion: overrides.calculationVersion ?? NETWORK_SCENARIO_COMPARISON_CALCULATION_VERSION,
    comparisonFingerprint: overrides.comparisonFingerprint ?? "fp-comparison",
    transportationFingerprint,
    scenarioAName: overrides.scenarioAName ?? input.scenarioAName,
    scenarioBName: overrides.scenarioBName ?? input.scenarioBName,
    inputReferences: overrides.inputReferences ?? input.inputReferences,
    scenarioInputs: overrides.scenarioInputs ?? input.scenarioInputs,
    ratingEvidence: overrides.ratingEvidence ?? input.ratingEvidence,
    fxInput: Object.prototype.hasOwnProperty.call(overrides, "fxInput") ? overrides.fxInput : input.fxInput,
    resultSummary: Object.prototype.hasOwnProperty.call(overrides, "resultSummary") ? overrides.resultSummary : input.resultSummary,
    errorMessage: overrides.errorMessage ?? null,
    createdByUserId: overrides.createdByUserId ?? "user-1",
    createdAt: overrides.createdAt ?? new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-08-01T00:05:00.000Z")
  };
}

function networkScenarioComparisonResultSummary(overrides: Record<string, unknown> = {}) {
  return {
    completenessStatus: "COMPLETE",
    scenarioA: { totalNetworkCost: 1000 },
    scenarioB: { totalNetworkCost: 900 },
    comparison: { totalDifference: overrides.totalDifference ?? -100 },
    warnings: [],
    rateCoverage: { missingRateCount: 0 },
    warehouseCostEvidence: { basis: "mixed" },
    historicalBaselineReference: { modeledSeparately: true }
  };
}

function networkScenarioComparisonDetailedResultSummary() {
  const torProfiles = [
    profileResult("tor-ord-1001", "ORD-1001", 1, "TOR-01", "Toronto DC", "CURRENT", 428.97, 0, 428.97, [
      alternativeResult("tor-ord-1001", "TOR-01", "Toronto DC", "CURRENT", 428.97, 0, 428.97, true),
      alternativeResult("tor-ord-1001", "ATL-01", "Atlanta Proposed Warehouse", "CANDIDATE", 262.89, 0, 262.89, false)
    ]),
    profileResult("tor-ord-2001", "ORD-2001", 1, "TOR-01", "Toronto DC", "CURRENT", 147.91, 0, 147.91, [
      alternativeResult("tor-ord-2001", "TOR-01", "Toronto DC", "CURRENT", 147.91, 0, 147.91, true),
      alternativeResult("tor-ord-2001", "ATL-01", "Atlanta Proposed Warehouse", "CANDIDATE", 173.95, 0, 173.95, false)
    ]),
    profileResult("tor-row-5", "ROW-5", 25, "TOR-01", "Toronto DC", "CURRENT", 5477.86, 0, 5477.86, [
      alternativeResult("tor-row-5", "TOR-01", "Toronto DC", "CURRENT", 5477.86, 0, 5477.86, true),
      alternativeResult("tor-row-5", "ATL-01", "Atlanta Proposed Warehouse", "CANDIDATE", 3541.25, 0, 3541.25, false)
    ])
  ];
  const atlProfiles = [
    profileResult("atl-ord-1001", "ORD-1001", 1, "ATL-01", "Atlanta Proposed Warehouse", "CANDIDATE", 262.89, 0, 262.89, [
      alternativeResult("atl-ord-1001", "TOR-01", "Toronto DC", "CURRENT", 428.97, 0, 428.97, false),
      alternativeResult("atl-ord-1001", "ATL-01", "Atlanta Proposed Warehouse", "CANDIDATE", 262.89, 0, 262.89, true)
    ]),
    profileResult("atl-ord-2001", "ORD-2001", 1, "ATL-01", "Atlanta Proposed Warehouse", "CANDIDATE", 173.95, 0, 173.95, [
      alternativeResult("atl-ord-2001", "TOR-01", "Toronto DC", "CURRENT", 147.91, 0, 147.91, false),
      alternativeResult("atl-ord-2001", "ATL-01", "Atlanta Proposed Warehouse", "CANDIDATE", 173.95, 0, 173.95, true)
    ]),
    profileResult("atl-row-5", "ROW-5", 25, "ATL-01", "Atlanta Proposed Warehouse", "CANDIDATE", 3541.25, 0, 3541.25, [
      alternativeResult("atl-row-5", "TOR-01", "Toronto DC", "CURRENT", 5477.86, 0, 5477.86, false),
      alternativeResult("atl-row-5", "ATL-01", "Atlanta Proposed Warehouse", "CANDIDATE", 3541.25, 0, 3541.25, true)
    ])
  ];
  return {
    completenessStatus: "COMPLETE",
    scenarioA: {
      scenarioName: "Toronto",
      status: "COMPLETE",
      modeledTransportationCost: 6054.74,
      variableWarehouseCost: 0,
      annualAllInWarehouseCost: 240000,
      totalWarehouseCost: 240000,
      totalNetworkCost: 246054.74,
      currency: "USD",
      normalizedCurrency: "USD",
      assignedRepresentedShipments: 27,
      incompleteRepresentedShipments: 0,
      facilityTotals: [
        { facilityId: "TOR-01", facilityName: "Toronto DC", facilitySourceType: "CURRENT", representedShipments: 27, representedPallets: 0, modeledTransportationCost: 6054.74, variableWarehouseCost: 0, annualAllInWarehouseCost: 240000, totalFacilityContribution: 246054.74 }
      ],
      profileResults: torProfiles
    },
    scenarioB: {
      scenarioName: "Atlanta",
      status: "COMPLETE",
      modeledTransportationCost: 3978.09,
      variableWarehouseCost: 0,
      annualAllInWarehouseCost: 420000,
      totalWarehouseCost: 420000,
      totalNetworkCost: 423978.09,
      currency: "USD",
      normalizedCurrency: "USD",
      assignedRepresentedShipments: 27,
      incompleteRepresentedShipments: 0,
      facilityTotals: [
        { facilityId: "ATL-01", facilityName: "Atlanta Proposed Warehouse", facilitySourceType: "CANDIDATE", representedShipments: 27, representedPallets: 0, modeledTransportationCost: 3978.09, variableWarehouseCost: 0, annualAllInWarehouseCost: 420000, totalFacilityContribution: 423978.09 }
      ],
      profileResults: atlProfiles
    },
    comparison: {
      baselineScenario: "A",
      differenceFormula: "Scenario B - Scenario A",
      totalDifference: 177923.35,
      percentDifference: 72.3,
      lowerCostScenario: "A"
    },
    warnings: [],
    rateCoverage: { scenarioAIncompleteShipments: 0, scenarioBIncompleteShipments: 0 },
    warehouseCostEvidence: { sourcePreserved: true },
    historicalBaselineReference: { modeledSeparately: true }
  };
}

function profileResult(profileKey: string, sourceReference: string, representedShipments: number, facilityId: string, facilityName: string, sourceType: "CURRENT" | "CANDIDATE", transportation: number, warehouse: number, combined: number, alternatives: any[]) {
  const destination = sourceReference === "ORD-1001" ? "10001" : sourceReference === "ORD-2001" ? "30303" : "75201";
  const representedPallets = sourceReference === "ORD-1001" ? 2 : sourceReference === "ORD-2001" ? 3 : 25;
  return {
    profileKey,
    sourceReference,
    representedShipments,
    representedPallets,
    destination,
    historicalTransportationCost: 100,
    winnerFacilityId: facilityId,
    winnerFacilityName: facilityName,
    incompleteReason: null,
    alternatives: alternatives.map((alternative) => ({ ...alternative, representedShipments, representedPallets, destination }))
  };
}

function alternativeResult(profileKey: string, facilityId: string, facilityName: string, sourceType: "CURRENT" | "CANDIDATE", transportation: number, warehouse: number, combined: number, winning: boolean) {
  return {
    profileKey,
    sourceReference: profileKey,
    representedShipments: 1,
    representedPallets: 1,
    destination: "10001",
    facilityId,
    facilityName,
    facilitySourceType: sourceType,
    modeledTransportationCost: transportation,
    transportationCurrency: "USD",
    warehouseCostBasis: "ANNUAL_ALL_IN",
    warehouseCostUsedForAssignment: warehouse,
    annualAllInCost: sourceType === "CURRENT" ? 240000 : 420000,
    variableWarehouseCost: warehouse,
    knownWarehouseSubtotal: warehouse,
    combinedAssignmentCost: combined,
    complete: true,
    missingReasons: [],
    winning,
    transportationAlternative: { selectedRateSource: "EXACT_REUSE", selectedQuote: { carrierName: "Carrier A", total: transportation }, reuseLineage: { sourceLaneId: `${facilityId}-${profileKey}-lane`, sourceBatchId: "batch-1" }, request: { destinationCountry: "US" } },
    warehouseCostEvidence: null
  };
}

function fileRef(fileId: string, fileName: string, contentHash: string, mappingId: string) {
  return {
    fileId,
    fileName,
    contentHash,
    mappingId,
    mappingUpdatedAt: "2026-08-01T00:00:00.000Z"
  };
}

function selectedScenarioFacility(
  facilityId: string,
  sourceType: "CURRENT" | "CANDIDATE",
  facilityName: string,
  postalCode: string,
  warehouseCostEvidence: Record<string, unknown>
) {
  return {
    facilityId,
    sourceType,
    facilityName,
    postalCode,
    city: null,
    stateProvince: null,
    country: "US",
    sourceFileId: sourceType === "CURRENT" ? "current-file" : "candidate-file",
    sourceMappingId: sourceType === "CURRENT" ? "current-mapping" : "candidate-mapping",
    sourceContentHash: sourceType === "CURRENT" ? "hash-current" : "hash-candidates",
    warehouseCostEvidence
  };
}

function scenarioMissingRate(
  laneFingerprint: string,
  affectedAlternatives: Array<{
    profileKey: string;
    sourceReference: string;
    originFacilityId: string;
    originSourceType: "CURRENT" | "CANDIDATE";
    representedShipments: number;
  }>
) {
  return {
    laneFingerprint,
    request: ltlRequestFixture(laneFingerprint),
    affectedAlternatives
  };
}

function sevenLAccountFixture() {
  return {
    id: "account-1",
    name: "Live 7L",
    secretName: "secret",
    secretConfigured: true,
    carriers: [{ carrierHash: "carrier-a", name: "Carrier A", code: "CA", scac: "CARA", enabled: true }]
  } as any;
}

function combinedProfileFixture(profileKey: string, alternatives: any[], options: { representedShipments?: number } = {}) {
  const representedShipments = options.representedShipments ?? 1;
  return {
    profileKey,
    sourceReference: `${profileKey}-source`,
    representedShipments,
    destination: "10001",
    historicalTransportationCost: 999,
    alternatives: alternatives.map((alternative) => ({ ...alternative, representedShipments }))
  };
}

function combinedAlternativeFixture(
  profileKey: string,
  facilityId: string,
  facilityName: string,
  representedModeledTransportationCost: number | null,
  sourceType: "CURRENT" | "CANDIDATE" = "CANDIDATE",
  status: "REUSED" | "MISSING_RATE" | "INVALID_ORIGIN" | "INELIGIBLE_PROFILE" = "REUSED"
) {
  return {
    profileKey,
    sourceReference: `${profileKey}-source`,
    representedShipments: 1,
    destination: "10001",
    originFacilityId: facilityId,
    originFacilityName: facilityName,
    originSourceType: sourceType,
    status,
    laneFingerprint: status === "REUSED" ? `${facilityId}-${profileKey}-fingerprint` : null,
    request: null,
    reusedSelectedRate: representedModeledTransportationCost,
    representedModeledTransportationCost,
    reuseLineage: status === "REUSED" ? { sourceLaneId: `${facilityId}-lane`, sourceBatchId: "batch-1" } : null,
    historicalTransportationCost: 999,
    issue: null
  };
}

function candidateWarehouseCostInputFromOption(option: {
  facilityId: string;
  currency: string | null;
  annualFacilityWarehouseCost: number | null;
  annualFixedCost: number | null;
  inboundFeePerPallet: number | null;
  outboundFeePerPallet: number | null;
  storageFeePerPalletPerMonth: number | null;
}) {
  return {
    facilityId: option.facilityId,
    facilitySourceType: "CANDIDATE" as const,
    currency: option.currency,
    annualFacilityWarehouseCost: option.annualFacilityWarehouseCost,
    annualFixedCost: option.annualFixedCost,
    inboundFeePerPallet: option.inboundFeePerPallet,
    outboundFeePerPallet: option.outboundFeePerPallet,
    storageFeePerPalletPerMonth: option.storageFeePerPalletPerMonth
  };
}

function candidateCombinedFacility(
  facilityId: string,
  facilityName: string,
  options: {
    currency?: string;
    annualFacilityWarehouseCost?: number | null;
    inboundFeePerPallet?: number | null;
    outboundFeePerPallet?: number | null;
    storageFeePerPalletPerMonth?: number | null;
  }
) {
  return {
    sourceType: "CANDIDATE" as const,
    facilityId,
    facilityName,
    warehouseCost: {
      facilityId,
      facilitySourceType: "CANDIDATE" as const,
      currency: options.currency ?? "USD",
      annualFacilityWarehouseCost: options.annualFacilityWarehouseCost ?? null,
      inboundFeePerPallet: options.inboundFeePerPallet ?? null,
      outboundFeePerPallet: options.outboundFeePerPallet ?? null,
      storageFeePerPalletPerMonth: options.storageFeePerPalletPerMonth ?? null
    }
  };
}

function currentCombinedFacility(
  facilityId: string,
  facilityName: string,
  options: { currency?: string; annualFacilityWarehouseCost?: number | null }
) {
  return {
    sourceType: "CURRENT" as const,
    facilityId,
    facilityName,
    warehouseCost: {
      facilityId,
      facilitySourceType: "CURRENT" as const,
      currency: options.currency ?? "USD",
      annualFacilityWarehouseCost: options.annualFacilityWarehouseCost ?? null
    }
  };
}

function combinedWarehouseProfile(
  profileKey: string,
  options: { representativePallets?: number | null; representedShipments?: number; inventoryDwellTimeDays?: number | null } = {}
) {
  const representedShipments = options.representedShipments ?? 1;
  return {
    profileKey,
    representedShipments,
    representativePallets: Object.prototype.hasOwnProperty.call(options, "representativePallets") ? options.representativePallets! : 2,
    inventoryDwellTimeDays: Object.prototype.hasOwnProperty.call(options, "inventoryDwellTimeDays") ? options.inventoryDwellTimeDays! : 30,
    sourceLineage: [{ sourceRowId: `shipments-file:${profileKey}`, shipmentReference: profileKey, representedShipments }]
  };
}

function scenarioPreparedProfiles(options: { shipmentsCsv?: string } = {}) {
  return prepareSupplyChainDesignCandidateLtlRateRequests(
    ltlPreparationInputFixture({
      candidateCsv: [
        ltlCandidateHeader(),
        "CVG-01,Cincinnati Candidate,Proposed 3PL,45202,US,275000,9000,USD,Scenario test candidate."
      ].join("\n"),
      shipmentsCsv: options.shipmentsCsv ?? [
        ltlShipmentsHeader(),
        "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
        "Aggregated Activity,ORD-2001,2026-01-17,DFW-3PL,Customer B,30303,Atlanta GA,US,10,20,55,10000,lb,48,40,60,in,No,LTL,610,3,Standard,SKU-200,USD",
        "Individual Shipment,ORD-3001,2026-01-18,TOR-01,Customer C,60601,Chicago IL,US,1,1,10,700,lb,48,40,40,in,No,LTL,300,2,Standard,SKU-300,USD"
      ].join("\n")
    })
  ).preparedRequests;
}

function scenarioOrigins() {
  const current = normalizeSupplyChainDesignCurrentFacilityRatingOrigins(currentFacilityOriginMappedFile([
    "TOR-01,Toronto DC,Owned,M5V 2T6,Toronto,ON,CA,240000,USD"
  ])).origins[0];
  const candidates = normalizeSupplyChainDesignCandidateRatingOrigins({
    ...ltlPreparationInputFixture({
      candidateCsv: [
        "Candidate Facility ID,Candidate Facility Name,Candidate Type,Candidate ZIP / Postal Code,Candidate Country,City,State/Province,Annual Facility / Warehouse Cost,Pallet Capacity,Currency,Notes",
        "CVG-01,Cincinnati Candidate,Proposed 3PL,45202,US,Cincinnati,OH,275000,9000,USD,Scenario candidate.",
        "RNO-01,Reno Candidate,Proposed 3PL,89501,US,Reno,NV,285000,9000,USD,Scenario candidate."
      ].join("\n")
    }).candidateFacilities,
    fieldMappings: testFieldMappings([
      ...ltlCandidateFieldMappings(),
      ["city", "City"],
      ["state_province", "State/Province"]
    ])
  }).origins;
  return [current, ...candidates];
}

function scenarioShipmentsReference() {
  return {
    fileId: "shipments-file",
    fileName: "historical-shipments.csv",
    mappingId: "shipments-mapping",
    mappingUpdatedAt: updatedAt.toISOString()
  };
}

function scenarioRatingConfig() {
  return {
    accountId: "live-account",
    accountName: "7L Live Preferred Carriers",
    carrierHashes: ["carrier-a", "frontline-hash"]
  };
}

function roundTestCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function scenarioRequestFor(origin: ReturnType<typeof scenarioOrigins>[number], profile: ReturnType<typeof scenarioPreparedProfiles>[number]) {
  return {
    ...profile.normalizedRequest!,
    customerReference: `${origin.sourceType}:${origin.facilityId}:${profile.rateRequestKey}`,
    originCity: "",
    originState: "",
    originZipcode: origin.postalCode,
    originCountry: origin.country
  };
}

function reusableScenarioLane(
  laneId: string,
  batchId: string,
  request: ReturnType<typeof scenarioRequestFor>,
  total: number,
  inputOverrides: Record<string, unknown> = {}
) {
  return ltlLaneFixture({
    id: laneId,
    jobRunId: batchId,
    updatedAt: new Date("2026-07-30T20:00:00.000Z"),
    requestJson: request,
    selectedRateSource: "7L selected rate",
    selectedQuoteJson: ltlQuoteFixture({ customerReference: request.customerReference, total, mode: "live" }),
    jobRun: {
      id: batchId,
      tenantId: "tenant-1",
      jobType: "supply-chain-design.candidate-ltl-rate-batch",
      status: JobStatus.SUCCESS,
      input: {
        ...ltlBatchInputFixture(),
        ...inputOverrides,
        source: "SUPPLY_CHAIN_DESIGN",
        projectId: "project-1",
        accountId: "live-account",
        accountName: "7L Live Preferred Carriers",
        carrierHashes: ["carrier-a", "frontline-hash"]
      }
    }
  });
}

function currentFacilityOriginMappedFile(rows: string[]) {
  return {
    fileId: "current-file",
    mappingId: "current-mapping",
    tableType: SupplyChainDesignTableType.FACILITIES,
    fileName: "current-facilities.csv",
    fileBytes: Buffer.from([
      "Facility ID,Facility Name,Facility Type,Facility ZIP / Postal Code,City,State/Province,Country,Annual Facility / Warehouse Cost,Currency",
      ...rows
    ].join("\n")),
    fieldMappings: testFieldMappings([
      ["facility_id", "Facility ID"],
      ["facility_name", "Facility Name"],
      ["facility_type", "Facility Type"],
      ["postal_code", "Facility ZIP / Postal Code"],
      ["city", "City"],
      ["state_province", "State/Province"],
      ["country", "Country"],
      ["annual_facility_warehouse_cost", "Annual Facility / Warehouse Cost"],
      ["currency", "Currency"]
    ])
  };
}

function ltlPreparationActionProjectFixture() {
  return {
    id: "project-1",
    mappings: [
      actionMappingFixture("shipments-mapping", "SHIPMENTS", "historical-shipments.csv", ltlShipmentsCsv(), ltlShipmentFieldMappings()),
      actionMappingFixture(
        "candidate-mapping",
        "CANDIDATE_FACILITIES",
        "candidate-warehouses.csv",
        ltlCandidateCsv(),
        ltlCandidateFieldMappings()
      )
    ]
  };
}

function ltlShipmentFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["record_type", "Record Type"],
    ["shipment_id", "Shipment / Order Reference"],
    ["shipment_date", "Shipment Date"],
    ["origin_facility_id", "Origin Facility ID"],
    ["destination_id", "Destination Customer / Group"],
    ["postal_or_region_code", "Destination ZIP / Postal Code"],
    ["destination_label", "Destination City / Region"],
    ["country", "Destination Country"],
    ["shipment_quantity", "Shipments"],
    ["pallets", "Pallets"],
    ["units", "Units"],
    ["weight", "Weight"],
    ["weight_unit", "Weight Unit"],
    ["length", "Length"],
    ["width", "Width"],
    ["height", "Height"],
    ["dimension_unit", "Dimension Unit"],
    ["hazardous_materials", "Hazardous Materials"],
    ["mode", "Transportation Mode"],
    ["transportation_cost", "Transportation Cost"],
    ["service_days", "Transit Days"],
    ["service_level", "Service Level"],
    ["item_id", "SKU / Item"],
    ["currency", "Currency"]
  ];
}

function ltlCandidateFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["candidate_facility_id", "Candidate Facility ID"],
    ["candidate_facility_name", "Candidate Facility Name"],
    ["candidate_type", "Candidate Type"],
    ["postal_code", "Candidate ZIP / Postal Code"],
    ["candidate_country", "Candidate Country"],
    ["annual_facility_warehouse_cost", "Annual Facility / Warehouse Cost"],
    ["pallet_capacity", "Pallet Capacity"],
    ["currency", "Currency"],
    ["notes", "Notes"]
  ];
}

function ltlShipmentsHeader() {
  return "Record Type,Shipment / Order Reference,Shipment Date,Origin Facility ID,Destination Customer / Group,Destination ZIP / Postal Code,Destination City / Region,Destination Country,Shipments,Pallets,Units,Weight,Weight Unit,Length,Width,Height,Dimension Unit,Hazardous Materials,Transportation Mode,Transportation Cost,Transit Days,Service Level,SKU / Item,Currency";
}

function ltlShipmentsCsv() {
  return [
    ltlShipmentsHeader(),
    "Individual Shipment,ORD-1001,2026-01-15,TOR-01,Customer A,10001,New York NY,US,1,2,40,1200,lb,48,40,60,in,No,LTL,525,2,Standard,SKU-100,USD",
    "Individual Shipment,ORD-1002,2026-01-16,TOR-01,,10001,New York ZIP group,US,1,1,24,700,lb,24,20,18,in,No,Parcel,95,1,Ground,,USD",
    "Aggregated Activity,,2026-01-17,DFW-3PL,Customer B,30303,Atlanta GA,US,10,20,55,10000,lb,48,40,60,in,No,LTL,610,3,Standard,SKU-200,USD",
    "Aggregated Activity,,2026-01-18,DFW-3PL,,75201,Dallas ZIP group,US,25,25,300,10000,lb,48,40,54,in,No,Parcel,1875,1,Ground,,USD"
  ].join("\n");
}

function ltlCandidateHeader() {
  return "Candidate Facility ID,Candidate Facility Name,Candidate Type,Candidate ZIP / Postal Code,Candidate Country,Annual Facility / Warehouse Cost,Pallet Capacity,Currency,Notes";
}

function locationStrategyShipmentsCsv() {
  return [
    locationStrategyShipmentsHeader(),
    "Individual Shipment,ORD-1001,10001,New York NY,US,NY,1,20,1200,lb,10,525,USD,LTL",
    "Aggregated Activity,ORD-2001,30303,Atlanta GA,US,GA,10,2,10000,lb,80,610,USD,Parcel",
    "Aggregated Activity,ORD-3001,60601,Chicago IL,US,IL,4,8,4000,lb,35,400,USD,Truckload"
  ].join("\n");
}

function syntheticLocationStrategyCsv(count: number) {
  const zips = [
    ["10001", "New York NY", "US", "NY"],
    ["30303", "Atlanta GA", "US", "GA"],
    ["60601", "Chicago IL", "US", "IL"],
    ["75201", "Dallas TX", "US", "TX"],
    ["90012", "Los Angeles CA", "US", "CA"],
    ["98101", "Seattle WA", "US", "WA"],
    ["33101", "Miami FL", "US", "FL"],
    ["80202", "Denver CO", "US", "CO"]
  ];
  return [
    locationStrategyShipmentsHeader(),
    ...Array.from({ length: count }, (_, index) => {
      const [zip, label, country, state] = zips[index % zips.length];
      const shipments = (index % 9) + 1;
      return `Aggregated Activity,SYN-${String(index + 1).padStart(4, "0")},${zip},${label},${country},${state},${shipments},${shipments * 2},${shipments * 100},lb,${shipments * 3},${shipments * 25},USD,LTL`;
    })
  ].join("\n");
}

function locationStrategyShipmentsHeader() {
  return "Record Type,Shipment / Order Reference,Destination ZIP,Destination Label,Country,State/Province,Shipments,Pallets,Weight,Weight Unit,Units,Transportation Cost,Currency,Mode";
}

function parseSimpleCsv(csv: string) {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value])));
}

function repeatedDestinationCount(rows: Array<Record<string, string>>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${countryValue(row)}:${postalValue(row)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function summarizeLocationStrategySample(rows: Array<Record<string, string>>) {
  const summary: Record<string, Record<string, { shipments: number; pallets: number; weight: number; units: number; spend: number }>> = {};
  for (const row of rows) {
    const cluster = locationStrategySampleCluster(row);
    const country = countryValue(row);
    summary[cluster] ??= {};
    summary[cluster][country] ??= { shipments: 0, pallets: 0, weight: 0, units: 0, spend: 0 };
    summary[cluster][country].shipments += numberValue(row.Shipments);
    summary[cluster][country].pallets += numberValue(row.Pallets);
    summary[cluster][country].weight += row["Weight Unit"].toLowerCase() === "kg" ? numberValue(row.Weight) * 2.2046226218 : numberValue(row.Weight);
    summary[cluster][country].units += numberValue(row.Units);
    summary[cluster][country].spend += numberValue(row["Transportation Cost"]);
  }
  return summary;
}

function locationStrategySampleCluster(row: Record<string, string>) {
  const reference = row["Shipment / Order Reference"];
  const label = destinationLabelValue(row);
  if (reference.includes("LS-NE")) return "Northeast / New York-New Jersey";
  if (reference.includes("LS-SE")) return "Southeast / Atlanta";
  if (reference.includes("LS-TX")) return "Texas";
  if (reference.includes("LS-MW")) return "Midwest / Chicago";
  if (reference.includes("LS-PNW") || /Seattle|Portland|Spokane/.test(label)) return "Pacific Northwest";
  if (reference.includes("LS-WC") || reference.includes("LS-W-") || /Los Angeles|Riverside|San Francisco|Sacramento|Las Vegas/.test(label)) return "Southern California";
  if (reference.includes("LS-CA-ON")) return "Greater Toronto Area";
  if (reference.includes("LS-CA-QC")) return "Montreal / Quebec";
  if (/Calgary|Edmonton/.test(label)) return "Calgary / Edmonton";
  if (/Vancouver|Victoria/.test(label)) return "Vancouver";
  if (reference.includes("LS-CA-ATL") || /Halifax|Moncton|Charlottetown|St Johns/.test(label)) return "Atlantic Canada";
  if (reference.includes("LS-LOW")) return "Remote low-volume outliers";
  return "Other";
}

function topCluster(summary: ReturnType<typeof summarizeLocationStrategySample>, metric: "shipments" | "pallets" | "weight" | "units" | "spend", country: string) {
  return Object.entries(summary)
    .map(([cluster, values]) => ({ cluster, value: values[country]?.[metric] ?? 0 }))
    .sort((left, right) => right.value - left.value || left.cluster.localeCompare(right.cluster))[0]?.cluster;
}

function numberValue(value: string) {
  return value === "" ? 0 : Number(value);
}

function countryValue(row: Record<string, string>) {
  return row["Destination Country"] ?? row.Country;
}

function postalValue(row: Record<string, string>) {
  return row["Destination ZIP / Postal Code"] ?? row["Destination ZIP"];
}

function destinationLabelValue(row: Record<string, string>) {
  return row["Destination City / Region"] ?? row["Destination Label"];
}

function locationStrategyFieldMappings() {
  return [
    { standardField: "record_type", sourceColumn: "Record Type", requirement: "OPTIONAL" as const },
    { standardField: "shipment_reference", sourceColumn: "Shipment / Order Reference", requirement: "OPTIONAL" as const },
    { standardField: "postal_or_region_code", sourceColumn: "Destination ZIP", requirement: "OPTIONAL" as const },
    { standardField: "destination_label", sourceColumn: "Destination Label", requirement: "OPTIONAL" as const },
    { standardField: "country", sourceColumn: "Country", requirement: "OPTIONAL" as const },
    { standardField: "state_province", sourceColumn: "State/Province", requirement: "OPTIONAL" as const },
    { standardField: "shipment_quantity", sourceColumn: "Shipments", requirement: "OPTIONAL" as const },
    { standardField: "pallets", sourceColumn: "Pallets", requirement: "OPTIONAL" as const },
    { standardField: "weight", sourceColumn: "Weight", requirement: "OPTIONAL" as const },
    { standardField: "weight_unit", sourceColumn: "Weight Unit", requirement: "OPTIONAL" as const },
    { standardField: "units", sourceColumn: "Units", requirement: "OPTIONAL" as const },
    { standardField: "transportation_cost", sourceColumn: "Transportation Cost", requirement: "OPTIONAL" as const },
    { standardField: "currency", sourceColumn: "Currency", requirement: "OPTIONAL" as const },
    { standardField: "transportation_mode", sourceColumn: "Mode", requirement: "OPTIONAL" as const },
    { standardField: "origin_facility_id", sourceColumn: "Shipment / Order Reference", requirement: "REQUIRED" as const }
  ];
}

function locationStrategyInputFixture(options: {
  shipmentsCsv?: string;
  maxRegions?: 1 | 2 | 3;
  weightingMethod?: "SHIPMENTS_REPRESENTED" | "PALLETS" | "WEIGHT" | "UNITS" | "CURRENT_TRANSPORTATION_COST";
  countryScope?: "ALL" | "US" | "CA" | "SEPARATE_BY_COUNTRY";
  fieldMappings?: ReturnType<typeof locationStrategyFieldMappings>;
  cadToUsdRate?: number | null;
} = {}) {
  return {
    shipments: {
      fileId: "shipments-file",
      mappingId: "shipments-mapping",
      fileBytes: Buffer.from(options.shipmentsCsv ?? locationStrategyShipmentsCsv()),
      fieldMappings: options.fieldMappings ?? locationStrategyFieldMappings()
    },
    maxRegions: options.maxRegions ?? 2,
    weightingMethod: options.weightingMethod ?? "SHIPMENTS_REPRESENTED",
    countryScope: options.countryScope ?? "US",
    cadToUsdRate: options.cadToUsdRate ?? null
  };
}

function ltlCandidateCsv() {
  return [
    ltlCandidateHeader(),
    "CHI-3PL,Chicago Proposed 3PL,Proposed 3PL,60601,US,275000,9000,USD,Proposed 3PL option.",
    "ATL-01,Atlanta Proposed Warehouse,Proposed Owned,30303,US,420000,14000,USD,Proposed US owned warehouse option."
  ].join("\n");
}

function ltlFourCandidateCsv() {
  return [
    ltlCandidateHeader(),
    "ATL-01,Atlanta Proposed Warehouse,Proposed Owned,30303,US,420000,14000,USD,Proposed US owned warehouse option.",
    "CHI-3PL,Chicago Proposed 3PL,Proposed 3PL,60601,US,275000,9000,USD,Proposed 3PL option.",
    "MTL-01,Montreal Candidate Warehouse,Proposed 3PL,H3B 1A7,CA,315000,7000,CAD,Proposed Montreal option.",
    "PHX-01,Phoenix Location Candidate,Proposed Owned,85004,US,260000,6500,USD,Proposed Phoenix option."
  ].join("\n");
}

function ltlQuoteFixture(overrides: Record<string, unknown> = {}) {
  return {
    customerReference: "rate-key-1",
    originCity: "CHICAGO",
    originState: "IL",
    originZipcode: "60601",
    originCountry: "US" as const,
    destinationCity: "NEW YORK",
    destinationState: "NY",
    destinationZipcode: "10001",
    destinationCountry: "US" as const,
    pickupDate: "Not scheduled",
    uom: "US" as const,
    accessorialCodes: [],
    pieces: [
      {
        qty: 2,
        weight: 1200,
        weightType: "total" as const,
        length: 48,
        width: 40,
        height: 60,
        dimType: "PLT" as const,
        freightClass: "100",
        hazmat: false,
        stack: false
      }
    ],
    carrierHash: "carrier-a",
    carrierName: "AAA Cooper",
    carrierCode: "AAA",
    scac: "AACT",
    serviceLevel: "Less than Truckload",
    transitDays: 3,
    quoteNumber: "Q-1",
    total: 100,
    fuelCharge: 15,
    accessorialCharge: 0,
    linehaulCharge: 85,
    rateRemarks: ["Rated by fixture."],
    mode: "dry-run" as const,
    ...overrides
  };
}

function ltlRequestFixture(rateRequestKey: string, overrides: Record<string, unknown> = {}) {
  const {
    carrierHash: _carrierHash,
    carrierName: _carrierName,
    carrierCode: _carrierCode,
    scac: _scac,
    serviceLevel: _serviceLevel,
    transitDays: _transitDays,
    quoteNumber: _quoteNumber,
    total: _total,
    fuelCharge: _fuelCharge,
    accessorialCharge: _accessorialCharge,
    linehaulCharge: _linehaulCharge,
    rateRemarks: _rateRemarks,
    mode: _mode,
    ...request
  } = ltlQuoteFixture({ customerReference: rateRequestKey });
  return { ...request, ...overrides };
}

function warehouseCostOptionsFixture() {
  return readWarehouseCostFacilityOptions({
    currentFacilities: {
      fileBytes: Buffer.from([
        "Facility ID,Facility Name,Facility Type,City,State/Province,Country,Annual Facility / Warehouse Cost,Currency",
        "TOR-01,Toronto Warehouse,Warehouse,Toronto,ON,US,250000,USD",
        "VAN-01,Vancouver Warehouse,Warehouse,Vancouver,BC,US,200000,USD"
      ].join("\n")),
      fieldMappings: [
        { standardField: "facility_id", sourceColumn: "Facility ID", requirement: "REQUIRED" },
        { standardField: "facility_name", sourceColumn: "Facility Name", requirement: "REQUIRED" },
        { standardField: "facility_type", sourceColumn: "Facility Type", requirement: "REQUIRED" },
        { standardField: "city", sourceColumn: "City", requirement: "OPTIONAL" },
        { standardField: "state_province", sourceColumn: "State/Province", requirement: "OPTIONAL" },
        { standardField: "country", sourceColumn: "Country", requirement: "OPTIONAL" },
        { standardField: "annual_facility_warehouse_cost", sourceColumn: "Annual Facility / Warehouse Cost", requirement: "OPTIONAL" },
        { standardField: "currency", sourceColumn: "Currency", requirement: "OPTIONAL" }
      ]
    },
    candidateFacilities: {
      fileBytes: Buffer.from([
        "Candidate Facility ID,Candidate Facility Name,Candidate Type,City,State/Province,Candidate Country,Annual Facility / Warehouse Cost,Currency",
        "CHI-01,Chicago Candidate,Warehouse,Chicago,IL,US,300000,USD",
        "MTL-01,Montreal Candidate,Warehouse,Montreal,QC,CA,,CAD",
        "CGY-01,Calgary Candidate,Warehouse,Calgary,AB,CA,220000,CAD"
      ].join("\n")),
      fieldMappings: [
        { standardField: "candidate_facility_id", sourceColumn: "Candidate Facility ID", requirement: "REQUIRED" },
        { standardField: "candidate_facility_name", sourceColumn: "Candidate Facility Name", requirement: "REQUIRED" },
        { standardField: "candidate_type", sourceColumn: "Candidate Type", requirement: "REQUIRED" },
        { standardField: "city", sourceColumn: "City", requirement: "OPTIONAL" },
        { standardField: "state_province", sourceColumn: "State/Province", requirement: "OPTIONAL" },
        { standardField: "candidate_country", sourceColumn: "Candidate Country", requirement: "REQUIRED" },
        { standardField: "annual_facility_warehouse_cost", sourceColumn: "Annual Facility / Warehouse Cost", requirement: "OPTIONAL" },
        { standardField: "currency", sourceColumn: "Currency", requirement: "OPTIONAL" }
      ]
    }
  });
}

function ltlBatchInputFixture() {
  const rateRequestKeys = [
    "46c43950010e335e1b8e04b32384acaa94d2c763c98f03d5f4d05f3c35bb8a3a",
    "63eaba19a0218320c54a41a285e89e4a7ad751ecdb38c00a2dc8e9038a62130b",
    "c9bb0ac3b09fc0c7935ba6c0b1f70207aca951d5d9064424134f3114cf9888de",
    "f6472d30dbf40883485f603ba9cbdcc8abc78baffa573b732bae263e5871cb61"
  ];
  const candidates = [
    { id: "ATL-01", name: "Atlanta Proposed Warehouse", originZipcode: "30303", originalFacilityId: "DFW-3PL", representedShipments: 10, currentTransportationCost: 610 },
    { id: "CHI-3PL", name: "Chicago Proposed 3PL", originZipcode: "60601", originalFacilityId: "DFW-3PL", representedShipments: 10, currentTransportationCost: 610 },
    { id: "ATL-01", name: "Atlanta Proposed Warehouse", originZipcode: "30303", originalFacilityId: "TOR-01", representedShipments: 1, currentTransportationCost: 525 },
    { id: "CHI-3PL", name: "Chicago Proposed 3PL", originZipcode: "60601", originalFacilityId: "TOR-01", representedShipments: 1, currentTransportationCost: 525 }
  ];
  return {
    source: "SUPPLY_CHAIN_DESIGN",
    projectId: "project-1",
    preparationRunId: "prep-run-1",
    preparationCreatedAt: "2026-07-30T19:55:00.000Z",
    accountId: "live-account",
    accountName: "7L Live Preferred Carriers",
    carrierHashes: ["carrier-a", "frontline-hash"],
    comparisonSetup: {
      scenarioSelections: [],
      currentFacilities: [],
      candidateFacilities: []
    },
    requests: candidates.map((candidate, index) => ({
      rateRequestKey: rateRequestKeys[index],
      candidateFacilityId: candidate.id,
      candidateFacilityName: candidate.name,
      originalFacilityId: candidate.originalFacilityId,
      sourceReference: candidate.representedShipments === 10 ? "ORD-2001" : "ORD-1001",
      recordType: candidate.representedShipments === 10 ? "Aggregated Activity" : "Individual Shipment",
      representedShipments: candidate.representedShipments,
      currentTransportationCost: candidate.currentTransportationCost,
      currentTransportationCostPerShipment: candidate.currentTransportationCost / candidate.representedShipments,
      representativePallets: 2,
      representativeWeight: candidate.representedShipments === 10 ? 1000 : 1200,
      weightUnit: "lb",
      dimensions: "48 x 40 x 60",
      dimensionUnit: "in",
      freightClass: candidate.representedShipments === 10 ? "125" : "100",
      sourceRowIds: [`shipments-file:row-${index + 1}`],
      request: ltlRequestFixture(rateRequestKeys[index], {
        originZipcode: candidate.originZipcode,
        destinationZipcode: candidate.originalFacilityId === "DFW-3PL" ? "30303" : "10001",
        pieces: [
          {
            qty: candidate.representedShipments === 10 ? 2 : 2,
            weight: candidate.representedShipments === 10 ? 1000 : 1200,
            weightType: "total" as const,
            length: 48,
            width: 40,
            height: 60,
            dimType: "PLT" as const,
            freightClass: candidate.representedShipments === 10 ? "125" : "100",
            hazmat: false,
            stack: false
          }
        ]
      })
    }))
  };
}

function ltlThreeCandidateThreeProfileBatchInputFixture() {
  const profiles = [
    { sourceReference: "ORD-1001", sourceRowId: "shipments-file:row-1", originalFacilityId: "TOR-01", representedShipments: 1, currentTransportationCost: 525, destinationZipcode: "10001", freightClass: "100" },
    { sourceReference: "ORD-2001", sourceRowId: "shipments-file:row-2", originalFacilityId: "DFW-3PL", representedShipments: 10, currentTransportationCost: 610, destinationZipcode: "30303", freightClass: "125" },
    { sourceReference: "ORD-3001", sourceRowId: "shipments-file:row-3", originalFacilityId: "VAN-01", representedShipments: 16, currentTransportationCost: 880, destinationZipcode: "60601", freightClass: "150" }
  ];
  const candidates = [
    { id: "MTL-01", name: "Montreal Proposed DC", originZipcode: "H3B1A7" },
    { id: "CHI-3PL", name: "Chicago Proposed 3PL", originZipcode: "60601" },
    { id: "ATL-01", name: "Atlanta Proposed Warehouse", originZipcode: "30303" }
  ];
  return {
    ...ltlBatchInputFixture(),
    comparisonSetup: {
      scenarioSelections: [],
      currentFacilities: [],
      candidateFacilities: candidates.map((candidate) => ({
        facilityId: candidate.id,
        facilityName: candidate.name,
        annualFixedCost: 300000
      }))
    },
    requests: candidates.flatMap((candidate) =>
      profiles.map((profile) => {
        const rateRequestKey = `${candidate.id}-${profile.sourceReference}`;
        return {
          rateRequestKey,
          candidateFacilityId: candidate.id,
          candidateFacilityName: candidate.name,
          originalFacilityId: profile.originalFacilityId,
          sourceReference: profile.sourceReference,
          recordType: profile.representedShipments === 1 ? "Individual Shipment" : "Aggregated Activity",
          representedShipments: profile.representedShipments,
          currentTransportationCost: profile.currentTransportationCost,
          currentTransportationCostPerShipment: profile.currentTransportationCost / profile.representedShipments,
          representativePallets: 2,
          representativeWeight: 1000,
          weightUnit: "lb",
          dimensions: "48 x 40 x 60",
          dimensionUnit: "in",
          freightClass: profile.freightClass,
          sourceRowIds: [profile.sourceRowId],
          request: ltlRequestFixture(rateRequestKey, {
            originZipcode: candidate.originZipcode,
            originCountry: candidate.originZipcode === "H3B1A7" ? "CA" : "US",
            destinationZipcode: profile.destinationZipcode,
            pieces: [
              {
                qty: 2,
                weight: 1000,
                weightType: "total" as const,
                length: 48,
                width: 40,
                height: 60,
                dimType: "PLT" as const,
                freightClass: profile.freightClass,
                hazmat: false,
                stack: false
              }
            ]
          })
        };
      })
    )
  };
}

function sevenLAccountRecordsFixture() {
  return [
    {
      id: "dry-run-account",
      name: "7L Dry Run - Core LTL",
      status: "ACTIVE",
      secretRef: null,
      publicConfig: {
        dryRun: true,
        carriers: [
          { carrierHash: "dry-carrier", name: "Dry Run Carrier", code: "DRY", scac: "DRYY", enabled: true }
        ]
      }
    },
    {
      id: "live-account",
      name: "7L Live Preferred Carriers",
      status: "ACTIVE",
      secretRef: "configured",
      publicConfig: {
        dryRun: false,
        carriers: [
          { carrierHash: "carrier-a", name: "AAA Cooper", code: "AAA", scac: "AACT", enabled: true },
          { carrierHash: "frontline-hash", name: "Frontline Freight", code: "FF", scac: "", enabled: true }
        ]
      }
    }
  ];
}

function ltlLaneFixture(overrides: Record<string, unknown> = {}) {
  return {
    customerReference: "rate-key-1",
    requestJson: ltlRequestFixture("rate-key-1"),
    quotesJson: [],
    errorsJson: [],
    selectedQuoteJson: null,
    selectedRateSource: null,
    manualRateJson: null,
    exclusionJson: null,
    ...overrides
  };
}

function screeningRunRecordFixture(id: string, createdAtValue: Date) {
  return {
    id,
    status: "SUCCESS",
    createdAt: createdAtValue,
    updatedAt: createdAtValue,
    errorMessage: null,
    inputReferences: screeningInputReferencesFixture(),
    resultSummary: runSupplyChainDesignThreePlScreening(screeningInputFixture())
  };
}

function screeningInputReferencesFixture() {
  return {
    demandPoints: {
      fileId: "demand-file",
      fileName: "demand_points_us.csv",
      mappingId: "demand-mapping",
      mappingUpdatedAt: updatedAt.toISOString(),
      candidateFiles: [
        {
          fileId: "demand-file",
          fileName: "demand_points_us.csv",
          mappingId: "demand-mapping",
          mappingUpdatedAt: updatedAt.toISOString(),
          selected: true
        }
      ]
    },
    logisticsMarkets: {
      fileId: "market-file",
      fileName: "logistics_markets.csv",
      mappingId: "market-mapping",
      mappingUpdatedAt: updatedAt.toISOString(),
      candidateFiles: [
        {
          fileId: "market-file",
          fileName: "logistics_markets.csv",
          mappingId: "market-mapping",
          mappingUpdatedAt: updatedAt.toISOString(),
          selected: true
        }
      ]
    },
    canadaProvinceMarketMap: null
  };
}

function screeningInputFixture(
  options: {
    demandCsv?: string;
    marketCsv?: string;
    canadaMapCsv?: string;
    demandMappings?: ScreeningFixtureMapping[];
  } = {}
) {
  return {
    studyName: "Benchmark",
    studyType: "FIND_BEST_WAREHOUSE_REGION" as const,
    countryScope: "US" as const,
    weightingMeasure: "annual_shipment_count" as const,
    maximumRegionsToCompare: 2,
    marketSourceMode: "PROJECT_UPLOADED_MARKETS" as const,
    demandPoints: screeningMappedFile(
      "demand.csv",
      options.demandCsv ?? screeningDemandCsv(),
      options.demandMappings ?? demandFieldMappings()
    ),
    logisticsMarkets: screeningMappedFile("markets.csv", options.marketCsv ?? screeningMarketCsv(), marketFieldMappings()),
    canadaProvinceMarketMap: screeningMappedFile(
      "canada-map.csv",
      options.canadaMapCsv ?? screeningCanadaMapCsv(),
      canadaMapFieldMappings()
    )
  };
}

type ScreeningFixtureMapping =
  | string
  | [string, string]
  | { standardField: string; sourceColumn: string; requirement?: "REQUIRED" | "OPTIONAL" };

function screeningMappedFile(fileName: string, csv: string, fields: ScreeningFixtureMapping[]) {
  return {
    fileId: `${fileName}-file`,
    fileName,
    mappingId: `${fileName}-mapping`,
    mappingUpdatedAt: "2026-07-28T00:00:00.000Z",
    fileBytes: Buffer.from(csv),
    fieldMappings: fields.map((field) => ({
      standardField: typeof field === "string" ? field : Array.isArray(field) ? field[0] : field.standardField,
      sourceColumn: typeof field === "string" ? field : Array.isArray(field) ? field[1] : field.sourceColumn,
      requirement: typeof field === "object" && !Array.isArray(field) && field.requirement ? field.requirement : "REQUIRED" as const
    }))
  };
}

function testFieldMappings(fields: ScreeningFixtureMapping[]) {
  return fields.map((field) => ({
    standardField: typeof field === "string" ? field : Array.isArray(field) ? field[0] : field.standardField,
    sourceColumn: typeof field === "string" ? field : Array.isArray(field) ? field[1] : field.sourceColumn,
    requirement: typeof field === "object" && !Array.isArray(field) && field.requirement ? field.requirement : "REQUIRED"
  }));
}

function actionMappingFixture(id: string, tableType: string, fileName: string, csv: string, fields: ScreeningFixtureMapping[]) {
  return {
    id,
    tableType,
    fileId: `${id}-file`,
    updatedAt: new Date("2026-07-28T00:00:00.000Z"),
    fieldMappings: testFieldMappings(fields),
    file: {
      id: `${id}-file`,
      originalFileName: fileName,
      fileBytes: Buffer.from(csv)
    }
  };
}

function screeningDemandCsv() {
  return [
    "Demand ID,Destination ZIP,Destination Label,Country,State,Latitude,Longitude,Annual Shipments,Annual Pallets,Shipment Profile ID,Required Service",
    "D001,75201,Dallas TX,US,TX,32.7876,-96.7994,300,600,LTL-2P,3 days",
    "D002,77002,Houston TX,US,TX,29.756,-95.365,220,440,LTL-2P,3 days",
    "D003,78701,Austin TX,US,TX,30.2711,-97.7437,180,360,LTL-2P,3 days",
    "D004,78205,San Antonio TX,US,TX,29.4241,-98.4936,120,240,LTL-2P,3 days",
    "D005,30303,Atlanta GA,US,GA,33.7525,-84.3915,160,320,LTL-2P,3 days",
    "D006,32801,Orlando FL,US,FL,28.541,-81.375,90,180,LTL-2P,4 days",
    "D007,37219,Nashville TN,US,TN,36.1667,-86.7833,80,160,LTL-2P,3 days",
    "D008,28202,Charlotte NC,US,NC,35.2271,-80.8431,70,140,LTL-2P,3 days",
    "D009,90012,Los Angeles CA,US,CA,34.0614,-118.239,150,300,LTL-2P,3 days",
    "D010,85004,Phoenix AZ,US,AZ,33.451,-112.069,90,180,LTL-2P,3 days",
    "D011,98101,Seattle WA,US,WA,47.6101,-122.3344,60,120,LTL-2P,4 days",
    "D012,60601,Chicago IL,US,IL,41.8864,-87.6186,80,160,LTL-2P,3 days"
  ].join("\n");
}

function screeningDemandCsvWithoutCoordinates() {
  return [
    "Demand ID,Destination ZIP,Destination Label,Country,State,Annual Shipments,Annual Pallets,Shipment Profile ID,Required Service",
    "D001,75201,Dallas TX,US,TX,300,600,LTL-2P,3 days",
    "D002,77002,Houston TX,US,TX,220,440,LTL-2P,3 days",
    "D003,78701,Austin TX,US,TX,180,360,LTL-2P,3 days",
    "D004,78205,San Antonio TX,US,TX,120,240,LTL-2P,3 days",
    "D005,30303,Atlanta GA,US,GA,160,320,LTL-2P,3 days",
    "D006,32801,Orlando FL,US,FL,90,180,LTL-2P,4 days",
    "D007,37219,Nashville TN,US,TN,80,160,LTL-2P,3 days",
    "D008,28202,Charlotte NC,US,NC,70,140,LTL-2P,3 days",
    "D009,90012,Los Angeles CA,US,CA,150,300,LTL-2P,3 days",
    "D010,85004,Phoenix AZ,US,AZ,90,180,LTL-2P,3 days",
    "D011,98101,Seattle WA,US,WA,60,120,LTL-2P,4 days",
    "D012,60601,Chicago IL,US,IL,80,160,LTL-2P,3 days"
  ].join("\n");
}

function screeningZipOnlyDemandCsv() {
  return [
    "Demand ID,Destination ZIP,Country,Annual Shipments",
    "Z001,10001,US,10",
    "Z002,30303,USA,20",
    "Z003,90012,United States,30"
  ].join("\n");
}

function demandCsvFromZipWeights(rows: Array<[string, number]>) {
  return [
    "Demand ID,Destination ZIP,Country,Annual Shipments",
    ...rows.map(([zipCode, annualShipments], index) => `D${String(index + 1).padStart(3, "0")},${zipCode},US,${annualShipments}`)
  ].join("\n");
}

function screeningMarketCsv() {
  return [
    "\uFEFFMarket ID,Market Name,Country,State/Province,Latitude,Longitude,Market Type",
    "US-DAL,Dallas-Fort Worth,US,TX,32.7767,-96.797,Major logistics market",
    "US-HOU,Houston,US,TX,29.7604,-95.3698,Major logistics market",
    "US-ATL,Atlanta,US,GA,33.749,-84.388,Major logistics market",
    "US-CHI,Chicago,US,IL,41.8781,-87.6298,Major logistics market",
    "US-LAX,Southern California,US,CA,34.0522,-118.2437,Major logistics market",
    "CA-TOR,Toronto,CA,ON,43.6532,-79.3832,Province-level Canadian market",
    "CA-VAN,Vancouver,CA,BC,49.2827,-123.1207,Province-level Canadian market",
    "CA-CGY,Calgary,CA,AB,51.0447,-114.0719,Province-level Canadian market",
    "CA-MTL,Montreal,CA,QC,45.5019,-73.5674,Province-level Canadian market",
    "CA-WPG,Winnipeg,CA,MB,49.8951,-97.1384,Province-level Canadian market"
  ].join("\n");
}

function screeningCanadaDemandCsv() {
  return [
    "Demand ID,Province,Demand Label,Country,Annual Shipments",
    "C001,ON,Toronto-area demand,CA,500",
    "C002,BC,Vancouver-area demand,CA,180",
    "C003,AB,Alberta demand,CA,220",
    "C004,QC,Quebec demand,CA,260",
    "C005,MB,Manitoba demand,CA,90"
  ].join("\n");
}

function screeningCanadaMapCsv() {
  return [
    "Province,Recommended Major City,Market ID",
    "ON,Toronto,CA-TOR",
    "BC,Vancouver,CA-VAN",
    "AB,Calgary,CA-CGY",
    "QC,Montreal,CA-MTL",
    "MB,Winnipeg,CA-WPG",
    "SK,Saskatoon,CA-SAS",
    "NS,Halifax,CA-HFX",
    "NB,Moncton,CA-YQM",
    "NL,St. John's,CA-YYT",
    "PE,Charlottetown,CA-YYG"
  ].join("\n");
}

function demandFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["destination_id", "Demand ID"],
    ["postal_or_region_code", "Destination ZIP"],
    ["city", "Destination Label"],
    ["state_province", "State"],
    ["country", "Country"],
    ["latitude", "Latitude"],
    ["longitude", "Longitude"],
    ["annual_shipment_count", "Annual Shipments"]
  ];
}

function demandFieldMappingsWithoutCoordinates(): ScreeningFixtureMapping[] {
  return [
    ["destination_id", "Demand ID"],
    ["postal_or_region_code", "Destination ZIP"],
    ["city", "Destination Label"],
    ["state_province", "State"],
    ["country", "Country"],
    ["annual_shipment_count", "Annual Shipments"]
  ];
}

function demandZipOnlyFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["destination_id", "Demand ID"],
    ["postal_or_region_code", "Destination ZIP"],
    ["country", "Country"],
    ["annual_shipment_count", "Annual Shipments"]
  ];
}

function providerComparisonInputFixture(
  options: {
    providerCsv?: string;
    outboundRateCsv?: string;
    providerMappings?: ScreeningFixtureMapping[];
  } = {}
) {
  return {
    studyName: "Warehouse option benchmark",
    demandPoints: providerMappedFile("demand_points_us.csv", screeningDemandCsv(), providerDemandFieldMappings()),
    providerOptions: providerMappedFile(
      "provider_options.csv",
      options.providerCsv ?? providerOptionsCsvWithAverageStoredPallets(),
      options.providerMappings ?? providerOptionFieldMappings()
    ),
    shipmentProfiles: providerMappedFile("shipment_profiles.csv", shipmentProfilesCsv(), shipmentProfileFieldMappings()),
    outboundRateCache: providerMappedFile(
      "outbound_rate_cache.csv",
      options.outboundRateCsv ?? providerOutboundRateCacheCsv(),
      outboundRateCacheFieldMappings()
    ),
    expectedProviderResults: providerMappedFile(
      "expected_provider_results.csv",
      expectedProviderResultsCsv(),
      expectedProviderResultFieldMappings()
    )
  };
}

function providerMappedFile(fileName: string, csv: string, fields: ScreeningFixtureMapping[]) {
  return {
    fileId: `${fileName}-file`,
    fileName,
    mappingId: `${fileName}-mapping`,
    mappingUpdatedAt: updatedAt.toISOString(),
    fileBytes: Buffer.from(csv),
    fieldMappings: testFieldMappings(fields)
  };
}

function providerComparisonActionProjectFixture() {
  return {
    id: "project-1",
    mappings: [
      actionMappingFixture("demand-mapping", "DEMAND_POINTS", "demand_points_us.csv", screeningDemandCsv(), providerDemandFieldMappings()),
      actionMappingFixture(
        "provider-mapping",
        "PROVIDER_OPTIONS",
        "provider_options.csv",
        providerOptionsCsvWithAverageStoredPallets(),
        providerOptionFieldMappings()
      ),
      actionMappingFixture("profile-mapping", "SHIPMENT_PROFILES", "shipment_profiles.csv", shipmentProfilesCsv(), shipmentProfileFieldMappings()),
      actionMappingFixture(
        "rate-mapping",
        "OUTBOUND_RATE_CACHE",
        "outbound_rate_cache.csv",
        providerOutboundRateCacheCsv(),
        outboundRateCacheFieldMappings()
      ),
      actionMappingFixture(
        "expected-mapping",
        "EXPECTED_PROVIDER_RESULTS",
        "expected_provider_results.csv",
        expectedProviderResultsCsv(),
        expectedProviderResultFieldMappings()
      )
    ]
  };
}

function providerComparisonInputReferencesFixture() {
  const ref = (fileId: string, fileName: string, mappingId: string) => ({
    fileId,
    fileName,
    mappingId,
    mappingUpdatedAt: updatedAt.toISOString(),
    candidateFiles: [{ fileId, fileName, mappingId, mappingUpdatedAt: updatedAt.toISOString(), selected: true }]
  });
  return {
    marketSourceMode: "NEWL_REFERENCE_CATALOGUE",
    demandPoints: ref("demand-file", "demand_points_us.csv", "demand-mapping"),
    logisticsMarkets: null,
    canadaProvinceMarketMap: null,
    providerOptions: ref("provider-file", "provider_options.csv", "provider-mapping"),
    shipmentProfiles: ref("profile-file", "shipment_profiles.csv", "profile-mapping"),
    outboundRateCache: ref("rate-file", "outbound_rate_cache.csv", "rate-mapping"),
    expectedProviderResults: ref("expected-file", "expected_provider_results.csv", "expected-mapping")
  };
}

function providerDemandFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ...demandFieldMappings(),
    ["annual_pallets", "Annual Pallets"],
    ["shipment_profile_id", "Shipment Profile ID"]
  ];
}

function providerOptionFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["provider_option_id", "Provider ID"],
    ["provider_name", "Provider Name"],
    ["warehouse_city", "City"],
    ["warehouse_country", "Country"],
    ["warehouse_state_province", "State"],
    ["warehouse_postal_code", "Origin ZIP"],
    ["monthly_storage_cost", "Storage $/Pallet/Month"],
    ["average_stored_pallets", "Average Stored Pallets"],
    ["annual_storage_cost", "Annual Storage Cost"],
    ["receiving_cost_per_unit", "Inbound Handling $/Pallet"],
    ["outbound_handling_cost_per_unit", "Outbound Handling $/Pallet"],
    ["monthly_minimum", "Monthly Minimum $"],
    ["inbound_gateway", "Inbound Gateway"],
    ["inbound_gateway_cost", "Annual Ocean Cost $"],
    ["other_annual_cost", "Annual Inland-to-Warehouse Cost $"]
  ];
}

function shipmentProfileFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["shipment_profile_id", "Profile ID"],
    ["mode", "Mode"],
    ["description", "Description"],
    ["pallets", "Pallets"],
    ["weight_lb", "Weight lb"],
    ["freight_class", "Freight Class"],
    ["assumptions", "Assumptions"]
  ];
}

function outboundRateCacheFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["provider_option_id", "Provider ID"],
    ["destination_id", "Demand ID"],
    ["shipment_profile_id", "Profile ID"],
    ["estimated_road_miles", "Estimated Road Miles"],
    ["cost_per_shipment", "Cost per Shipment $"],
    ["transit_business_days", "Transit Business Days"],
    ["source", "Source"]
  ];
}

function expectedProviderResultFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["rank", "Rank"],
    ["provider_option_id", "Provider ID"],
    ["provider_name", "Provider Name"],
    ["outbound_cost", "Outbound Cost $"],
    ["warehouse_cost", "Warehouse Cost $"],
    ["ocean_cost", "Ocean Cost $"],
    ["inland_to_warehouse_cost", "Inland-to-Warehouse Cost $"],
    ["total_annual_cost", "Total Annual Cost $"],
    ["shipments_within_3_days", "Shipments Within 3 Days"],
    ["three_day_coverage_percent", "3-Day Coverage %"]
  ];
}

function providerOptionsCsv() {
  return [
    "Provider ID,Provider Name,City,Country,State,Origin ZIP,Latitude,Longitude,Storage $/Pallet/Month,Inbound Handling $/Pallet,Outbound Handling $/Pallet,Monthly Minimum $,Inbound Gateway,Annual Ocean Cost $,Annual Inland-to-Warehouse Cost $",
    "P-DFW,Fort Worth 3PL,Fort Worth,US,TX,76102,32.7555,-97.3308,12,6,8,2500,Houston,195000,35000",
    "P-ATL,Atlanta 3PL,Atlanta,US,GA,30303,33.749,-84.388,10,5,7,2200,Charleston,205000,22000",
    "P-RIV,Riverside 3PL,Riverside,US,CA,92501,33.9806,-117.3755,15,7,9,3000,Los Angeles,180000,25000"
  ].join("\n");
}

function providerOptionsCsvWithAverageStoredPallets() {
  return [
    "Provider ID,Provider Name,City,Country,State,Origin ZIP,Latitude,Longitude,Storage $/Pallet/Month,Average Stored Pallets,Inbound Handling $/Pallet,Outbound Handling $/Pallet,Monthly Minimum $,Inbound Gateway,Annual Ocean Cost $,Annual Inland-to-Warehouse Cost $",
    "P-DFW,Fort Worth 3PL,Fort Worth,US,TX,76102,32.7555,-97.3308,12,500,6,8,2500,Houston,195000,35000",
    "P-ATL,Atlanta 3PL,Atlanta,US,GA,30303,33.749,-84.388,10,500,5,7,2200,Charleston,205000,22000",
    "P-RIV,Riverside 3PL,Riverside,US,CA,92501,33.9806,-117.3755,15,500,7,9,3000,Los Angeles,180000,25000"
  ].join("\n");
}

function providerOptionsCsvWithAnnualStorageCost() {
  return [
    "Provider ID,Provider Name,City,Country,State,Origin ZIP,Latitude,Longitude,Storage $/Pallet/Month,Average Stored Pallets,Annual Storage Cost,Inbound Handling $/Pallet,Outbound Handling $/Pallet,Monthly Minimum $,Inbound Gateway,Annual Ocean Cost $,Annual Inland-to-Warehouse Cost $",
    "P-DFW,Fort Worth 3PL,Fort Worth,US,TX,76102,32.7555,-97.3308,,,72000,6,8,2500,Houston,195000,35000",
    "P-ATL,Atlanta 3PL,Atlanta,US,GA,30303,33.749,-84.388,,,60000,5,7,2200,Charleston,205000,22000",
    "P-RIV,Riverside 3PL,Riverside,US,CA,92501,33.9806,-117.3755,,,90000,7,9,3000,Los Angeles,180000,25000"
  ].join("\n");
}

function providerOptionsCsvWithBothStorageMethods() {
  return [
    "Provider ID,Provider Name,City,Country,State,Origin ZIP,Latitude,Longitude,Storage $/Pallet/Month,Average Stored Pallets,Annual Storage Cost,Inbound Handling $/Pallet,Outbound Handling $/Pallet,Monthly Minimum $,Inbound Gateway,Annual Ocean Cost $,Annual Inland-to-Warehouse Cost $",
    "P-DFW,Fort Worth 3PL,Fort Worth,US,TX,76102,32.7555,-97.3308,12,500,72000,6,8,2500,Houston,195000,35000",
    "P-ATL,Atlanta 3PL,Atlanta,US,GA,30303,33.749,-84.388,10,500,60000,5,7,2200,Charleston,205000,22000",
    "P-RIV,Riverside 3PL,Riverside,US,CA,92501,33.9806,-117.3755,15,500,90000,7,9,3000,Los Angeles,180000,25000"
  ].join("\n");
}

function providerOptionsCsvMissingStorageBasis() {
  return [
    "Provider ID,Provider Name,City,Country,State,Origin ZIP,Latitude,Longitude,Storage $/Pallet/Month,Average Stored Pallets,Annual Storage Cost,Inbound Handling $/Pallet,Outbound Handling $/Pallet,Monthly Minimum $,Inbound Gateway,Annual Ocean Cost $,Annual Inland-to-Warehouse Cost $",
    "P-DFW,Fort Worth 3PL,Fort Worth,US,TX,76102,32.7555,-97.3308,,,,6,8,2500,Houston,195000,35000",
    "P-ATL,Atlanta 3PL,Atlanta,US,GA,30303,33.749,-84.388,10,500,,5,7,2200,Charleston,205000,22000",
    "P-RIV,Riverside 3PL,Riverside,US,CA,92501,33.9806,-117.3755,15,500,,7,9,3000,Los Angeles,180000,25000"
  ].join("\n");
}

function shipmentProfilesCsv() {
  return [
    "Profile ID,Mode,Description,Pallets,Weight lb,Freight Class,Assumptions",
    'LTL-2P,LTL,"2 pallets / 1,000 lb representative shipment",2,1000,Class 70,"Commercial, no accessorials"',
    "PARCEL-25,Parcel,25 lb representative parcel,0,25,N/A,Commercial ground"
  ].join("\n");
}

function providerOutboundRateCacheCsv() {
  return [
    "Provider ID,Demand ID,Profile ID,Estimated Road Miles,Cost per Shipment $,Transit Business Days,Source",
    "P-DFW,D001,LTL-2P,35.6,103.51,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D002,LTL-2P,273.2,227.05,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D003,LTL-2P,199.4,188.68,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D004,LTL-2P,276.3,228.66,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D005,LTL-2P,862.8,533.68,2,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D006,LTL-2P,1139.6,677.6,3,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D007,LTL-2P,741.7,470.71,2,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D008,LTL-2P,1102.5,658.29,3,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D009,LTL-2P,1388.3,806.91,3,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D010,LTL-2P,981.7,595.5,2,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D011,LTL-2P,1908.1,1077.23,4,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-DFW,D012,LTL-2P,948.9,578.45,2,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D001,LTL-2P,827.6,515.35,2,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D002,LTL-2P,806.1,504.17,2,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D003,LTL-2P,940.5,574.06,2,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D004,LTL-2P,1013.6,612.09,3,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D005,LTL-2P,0.4,85.19,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D006,LTL-2P,461.7,325.08,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D007,LTL-2P,247.4,213.67,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D008,LTL-2P,260.2,220.28,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D009,LTL-2P,2222.2,1240.53,5,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D010,LTL-2P,1826.6,1034.83,4,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D011,LTL-2P,2505.3,1387.75,6,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-ATL,D012,LTL-2P,677.5,437.29,2,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D001,LTL-2P,1366.2,795.41,3,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D002,LTL-2P,1519.5,875.16,4,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D003,LTL-2P,1351.2,787.65,3,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D004,LTL-2P,1324.6,773.78,3,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D005,LTL-2P,2166.7,1211.7,5,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D006,LTL-2P,2470.2,1369.52,5,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D007,LTL-2P,1988.8,1119.15,4,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D008,LTL-2P,2377.8,1321.48,5,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D009,LTL-2P,57.2,114.76,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D010,LTL-2P,353.2,268.66,1,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D011,LTL-2P,1122.7,668.8,3,Synthetic benchmark rate; represents cached 7L/UPS result",
    "P-RIV,D012,LTL-2P,1956.2,1102.24,4,Synthetic benchmark rate; represents cached 7L/UPS result"
  ].join("\n");
}

function expectedProviderResultsCsv() {
  return [
    "Rank,Provider ID,Provider Name,Outbound Cost $,Warehouse Cost $,Ocean Cost $,Inland-to-Warehouse Cost $,Total Annual Cost $,Shipments Within 3 Days,3-Day Coverage %",
    "1,P-DFW,Fort Worth 3PL,658056.8,116800,195000,35000,1004856.8,1540,96.2",
    "2,P-ATL,Atlanta 3PL,915167.2,98400,205000,22000,1240567.2,1300,81.2",
    "3,P-RIV,Riverside 3PL,1334653.8,141200,180000,25000,1680853.8,900,56.2"
  ].join("\n");
}

function activeUsReferenceMarkets() {
  return NEWL_LOGISTICS_MARKET_CATALOGUE.filter((market) => market.country === "US" && market.activeEligible);
}

function expectedOneRegionMarket(rows: Array<[string, number]>) {
  const zips = getUsZipCentroidReferenceRecords();
  const byZip = new Map(zips.map((row) => [row.zipCode, row]));
  const demand = rows.map(([zipCode, annualShipments]) => {
    const centroid = byZip.get(zipCode);
    if (!centroid) {
      throw new Error(`Missing test ZIP ${zipCode}`);
    }
    return { centroid, annualShipments };
  });
  const totalDemand = demand.reduce((total, row) => total + row.annualShipments, 0);
  const ranked = activeUsReferenceMarkets()
    .map((market) => {
      const weightedAverageDistance =
        demand.reduce(
          (total, row) =>
            total +
            Math.round(
              testHaversineMiles(row.centroid.latitude, row.centroid.longitude, market.latitude, market.longitude) * 10
            ) /
              10 *
              row.annualShipments,
          0
        ) / totalDemand;
      return {
        marketId: market.marketId,
        weightedAverageDistance: Math.round(weightedAverageDistance * 10) / 10
      };
    })
    .sort((left, right) => left.weightedAverageDistance - right.weightedAverageDistance || left.marketId.localeCompare(right.marketId));
  return ranked[0];
}

function testHaversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function canadaDemandFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["destination_id", "Demand ID"],
    ["postal_or_region_code", "Province"],
    ["city", "Demand Label"],
    ["state_province", "Province"],
    ["country", "Country"],
    ["annual_shipment_count", "Annual Shipments"]
  ];
}

function marketFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["market_id", "Market ID"],
    ["market_name", "Market Name"],
    ["state_province", "State/Province"],
    ["country", "Country"],
    ["latitude", "Latitude"],
    ["longitude", "Longitude"],
    ["active_eligible", "Market Type"]
  ];
}

function canadaMapFieldMappings(): ScreeningFixtureMapping[] {
  return [
    ["province_code", "Province"],
    ["approved_major_city", "Recommended Major City"],
    ["approved_logistics_market_id", "Market ID"]
  ];
}

function fileSummaryFixture(
  id: string,
  originalFileName: string,
  contentHash: string,
  mappings: Array<{ id: string; tableType: string; updatedAt: Date; fieldMappings: unknown }>
) {
  return {
    id,
    originalFileName,
    contentType: "text/csv",
    sizeBytes: 50,
    contentHash,
    rowCount: 1,
    detectedHeaders: ["A", "B"],
    status: "READY",
    createdAt,
    uploadedBy: null,
    mappings
  };
}
