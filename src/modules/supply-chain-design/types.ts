import type { SupplyChainDesignProviderComparisonResultSummary } from "@/modules/supply-chain-design/three-pl-provider-comparison";
import type { SupplyChainDesignLtlRatePreparationResultSummary } from "@/modules/supply-chain-design/candidate-ltl-rate-preparation";
import type { SupplyChainDesignLtlRateBatchSummary } from "@/modules/supply-chain-design/ltl-rate-batches";
import type { WarehouseLocationStrategyResultSummary } from "@/modules/supply-chain-design/warehouse-location-strategy";
import type {
  WarehouseCostComparisonFacilityOption,
  WarehouseCostComparisonInputReference,
  WarehouseCostComparisonResultSummary
} from "@/modules/supply-chain-design/warehouse-cost-comparison";
import type {
  NetworkScenarioComparisonRunListItem as SupplyChainDesignNetworkScenarioComparisonRunListItem
} from "@/modules/supply-chain-design/network-scenario-comparison-persistence";

export type { SupplyChainDesignLtlRateBatchSummary };
import type { SupplyChainDesignScreeningResultSummary } from "@/modules/supply-chain-design/three-pl-screening";

export type SupplyChainDesignStudioShell = {
  modelId: "MOD-01";
  modelName: string;
  status: "SHELL_ONLY";
  workspaceSteps: Array<{
    label: string;
    status: "available" | "deferred";
  }>;
};

export type SupplyChainDesignProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string | null;
};

export type SupplyChainDesignProjectDetail = SupplyChainDesignProjectSummary & {
  shell: SupplyChainDesignStudioShell;
  files: SupplyChainDesignProjectFileSummary[];
  model01Proof: SupplyChainDesignModel01ProofReadiness;
  latestModelRun: SupplyChainDesignModelRunSummary | null;
  recentModelRuns: SupplyChainDesignModelRunSummary[];
  model02Proof: SupplyChainDesignModel02ProofReadiness;
  candidateLtlRatePreparation: SupplyChainDesignLtlRatePreparationReadiness;
  latestLtlRatePreparationRun: SupplyChainDesignLtlRatePreparationRunSummary | null;
  recentLtlRatePreparationRuns: SupplyChainDesignLtlRatePreparationRunSummary[];
  latestLtlRateBatch: SupplyChainDesignLtlRateBatchSummary | null;
  recentLtlRateBatches: SupplyChainDesignLtlRateBatchSummary[];
  latestScenario: SupplyChainDesignScenarioSummary | null;
  recentScenarios: SupplyChainDesignScenarioSummary[];
  threePlScreening: SupplyChainDesignThreePlScreeningReadiness;
  latestScreeningRun: SupplyChainDesignScreeningRunSummary | null;
  recentScreeningRuns: SupplyChainDesignScreeningRunSummary[];
  warehouseLocationStrategy: SupplyChainDesignWarehouseLocationStrategyReadiness;
  latestWarehouseLocationStrategyRun: SupplyChainDesignWarehouseLocationStrategyRunSummary | null;
  recentWarehouseLocationStrategyRuns: SupplyChainDesignWarehouseLocationStrategyRunSummary[];
  warehouseCostComparison: SupplyChainDesignWarehouseCostComparisonReadiness;
  latestWarehouseCostComparisonRun: SupplyChainDesignWarehouseCostComparisonRunSummary | null;
  recentWarehouseCostComparisonRuns: SupplyChainDesignWarehouseCostComparisonRunSummary[];
  networkScenarioComparison: SupplyChainDesignNetworkScenarioComparisonReadiness;
  latestNetworkScenarioComparisonRun: SupplyChainDesignNetworkScenarioComparisonRunListItem | null;
  recentNetworkScenarioComparisonRuns: SupplyChainDesignNetworkScenarioComparisonRunListItem[];
};

export type SupplyChainDesignProjectFileSummary = {
  id: string;
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number;
  contentHash: string;
  rowCount: number;
  detectedHeaders: string[];
  status: string;
  uploadedByName: string | null;
  createdAt: Date;
  hasMapping: boolean;
  mappingId: string | null;
  mappingTableType: string | null;
  mappingUpdatedAt: Date | null;
  mappingDisplayStatus:
    | "Ready"
    | "Ready — automatically mapped"
    | "Needs attention"
    | "Needs mapping"
    | "Not used by this project"
    | "Internal/test only";
  mappingStatusReason: string | null;
  duplicateContentFileNames: string[];
};

export type SupplyChainDesignProjectFileDetail = SupplyChainDesignProjectFileSummary & {
  projectId: string;
  projectName: string;
  previewRows: string[][];
  mapping: SupplyChainDesignFileMappingDetail | null;
};

export type SupplyChainDesignFieldMapping = {
  standardField: string;
  sourceColumn: string | null;
  requirement: "REQUIRED" | "OPTIONAL";
};

export type SupplyChainDesignFileMappingDetail = {
  id: string;
  tableType: string;
  status: string;
  fieldMappings: SupplyChainDesignFieldMapping[];
  createdAt: Date;
  updatedAt: Date;
};

export type SupplyChainDesignModel01ProofReadiness = {
  canRun: boolean;
  missingInputs: string[];
  inputSelection: SupplyChainDesignModel01ProofInputSelection | null;
  warnings: string[];
};

export type SupplyChainDesignModelRunSummary = {
  id: string;
  status: string;
  createdAt: Date;
  errorMessage: string | null;
  inputReferences: SupplyChainDesignModel01ProofInputSelection | null;
  resultSummary: SupplyChainDesignModel01ProofResultSummary | null;
  weightUnit: string | null;
  weightUnitWarning: string | null;
};

export type SupplyChainDesignModel01ProofInputSelection = {
  currentNetworkActivity: SupplyChainDesignModel01ProofSelectedInput | null;
  facilities: SupplyChainDesignModel01ProofSelectedInput | null;
  shipments: SupplyChainDesignModel01ProofSelectedInput | null;
  inventory: SupplyChainDesignModel01ProofSelectedInput | null;
  facilityCosts: SupplyChainDesignModel01ProofSelectedInput | null;
  customers: SupplyChainDesignModel01ProofSelectedInput | null;
};

export type SupplyChainDesignModel01ProofSelectedInput = {
  fileId: string;
  fileName: string;
  mappingId: string;
  mappingUpdatedAt: string;
  candidateFiles: Array<{
    fileId: string;
    fileName: string;
    mappingId: string;
    mappingUpdatedAt: string;
    selected: boolean;
  }>;
};

export type SupplyChainDesignWarehouseLocationStrategyReadiness = {
  canRun: boolean;
  missingInputs: string[];
  inputSelection: {
    shipments: SupplyChainDesignModel01ProofSelectedInput;
  } | null;
};

export type SupplyChainDesignWarehouseLocationStrategyRunSummary = {
  id: string;
  status: string;
  createdAt: Date;
  errorMessage: string | null;
  inputReferences: {
    shipments: SupplyChainDesignModel01ProofSelectedInput;
    maxRegions: 1 | 2 | 3;
    weightingMethod: string;
    countryScope: string;
    cadToUsdRate?: number | null;
    reportFingerprint?: string;
  } | null;
  resultSummary: WarehouseLocationStrategyResultSummary | null;
};

export type SupplyChainDesignWarehouseCostComparisonReadiness = {
  canRun: boolean;
  missingInputs: string[];
  inputSelection: {
    facilities: SupplyChainDesignModel01ProofSelectedInput;
    candidateFacilities: SupplyChainDesignModel01ProofSelectedInput;
    facilityOptions: WarehouseCostComparisonFacilityOption[];
  } | null;
};

export type SupplyChainDesignWarehouseCostComparisonRunSummary = {
  id: string;
  status: string;
  createdAt: Date;
  errorMessage: string | null;
  inputReferences: WarehouseCostComparisonInputReference | null;
  resultSummary: WarehouseCostComparisonResultSummary | null;
};

export type SupplyChainDesignNetworkScenarioComparisonReadiness = {
  canRun: boolean;
  missingInputs: string[];
  inputSelection: {
    shipments: SupplyChainDesignModel01ProofSelectedInput;
    facilities: SupplyChainDesignModel01ProofSelectedInput;
    candidateFacilities: SupplyChainDesignModel01ProofSelectedInput;
    facilityOptions: WarehouseCostComparisonFacilityOption[];
    currentFacilityOptionsByMappingId: Array<{
      mappingId: string;
      options: WarehouseCostComparisonFacilityOption[];
    }>;
    candidateFacilityOptionsByMappingId: Array<{
      mappingId: string;
      options: WarehouseCostComparisonFacilityOption[];
    }>;
  } | null;
};

export type SupplyChainDesignThreePlScreeningReadiness = {
  canRun: boolean;
  missingInputs: string[];
  inputSelection: SupplyChainDesignThreePlScreeningInputSelection | null;
};

export type SupplyChainDesignThreePlScreeningInputSelection = {
  demandPoints: SupplyChainDesignModel01ProofSelectedInput;
  logisticsMarkets: SupplyChainDesignModel01ProofSelectedInput | null;
  canadaProvinceMarketMap: SupplyChainDesignModel01ProofSelectedInput | null;
  providerOptions: SupplyChainDesignModel01ProofSelectedInput | null;
  shipmentProfiles: SupplyChainDesignModel01ProofSelectedInput | null;
  outboundRateCache: SupplyChainDesignModel01ProofSelectedInput | null;
  expectedProviderResults: SupplyChainDesignModel01ProofSelectedInput | null;
  studyType?: "FIND_BEST_WAREHOUSE_REGION" | "COMPARE_KNOWN_WAREHOUSE_OPTIONS";
  marketSourceMode?: "NEWL_REFERENCE_CATALOGUE" | "PROJECT_UPLOADED_MARKETS";
};

export type SupplyChainDesignScreeningRunSummary = {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  errorMessage: string | null;
  resultReadError: string | null;
  inputReferences: SupplyChainDesignThreePlScreeningInputSelection | null;
  resultSummary: SupplyChainDesignScreeningResultSummary | SupplyChainDesignProviderComparisonResultSummary | null;
};

export type SupplyChainDesignModel01ProofResultSummary = {
  facilityCount: number;
  shipmentCount: number;
  hasTransportationCost: boolean;
  totalTransportationCost: number | null;
  shipmentCountByOrigin: Array<{
    originFacilityId: string;
    shipmentCount: number;
  }>;
  transportationCostByOrigin: Array<{
    originFacilityId: string;
    transportationCost: number;
  }> | null;
  unmatchedShipmentOriginIds: string[];
  hasInventory: boolean;
  inventoryQuantity: number | null;
  inventoryQuantityByFacility: Array<{
    facilityId: string;
    inventoryQuantity: number;
  }> | null;
  hasInventoryValue: boolean;
  inventoryValue: number | null;
  inventoryValueByFacility: Array<{
    facilityId: string;
    inventoryValue: number;
  }> | null;
  unmatchedInventoryFacilityIds: string[];
  hasFacilityCosts: boolean;
  totalFacilityOperatingCost: number | null;
  facilityOperatingCostByFacility: Array<{
    facilityId: string;
    facilityOperatingCost: number;
  }> | null;
  facilityOperatingCostByCategory: Array<{
    costCategory: string;
    facilityOperatingCost: number;
  }> | null;
  unmatchedFacilityCostFacilityIds: string[];
  hasCustomers: boolean;
  customerCount: number | null;
  shipmentCountByDestination: Array<{
    destinationId: string;
    shipmentCount: number;
  }> | null;
  transportationCostByDestination: Array<{
    destinationId: string;
    transportationCost: number;
  }> | null;
  laneShipmentCounts: Array<{
    originFacilityId: string;
    destinationId: string;
    shipmentCount: number;
  }> | null;
  transportationCostByLane: Array<{
    originFacilityId: string;
    destinationId: string;
    transportationCost: number;
  }> | null;
  unmatchedShipmentDestinationIds: string[];
  hasCustomerDemand: boolean;
  totalAnnualCustomerDemand: number | null;
  annualDemandByCustomer: Array<{
    customerId: string;
    annualDemand: number;
  }> | null;
  hasServiceDays: boolean;
  averageServiceDays: number | null;
  averageServiceDaysByDestination: Array<{
    destinationId: string;
    averageServiceDays: number;
  }> | null;
  averageServiceDaysByLane: Array<{
    originFacilityId: string;
    destinationId: string;
    averageServiceDays: number;
  }> | null;
  networkLanes: Array<{
    originFacilityId: string;
    originFacilityName: string;
    destinationId: string;
    customerName: string | null;
    shipmentCount: number;
    transportationCost: number | null;
    averageServiceDays: number | null;
  }> | null;
  facilitySummary: Array<{
    facilityId: string;
    facilityName: string;
    facilityType: string | null;
    shipmentCount: number;
    pallets: number | null;
    units: number | null;
    weight: number | null;
    transportationCost: number | null;
    inventoryQuantity: number | null;
    inventoryValue: number | null;
    facilityOperatingCost: number | null;
    observedCost: number | null;
  }>;
  analysisLevels?: Array<{
    label: string;
    status: "AVAILABLE" | "NOT_CALCULATED";
    explanation: string;
  }>;
  facilityDataWarnings?: string[];
  volumeSummary?: {
    totalShipments: number;
    totalPallets: number | null;
    totalUnits: number | null;
    totalWeight: number | null;
    averagePalletsPerShipment: number | null;
    averageUnitsPerShipment: number | null;
    averageWeightPerShipment: number | null;
    transportationCostPerShipment: number | null;
    transportationCostPerPallet: number | null;
    transportationCostPerUnit: number | null;
    transportationCostPerPound: number | null;
  };
  currencyWarnings?: string[];
  transportationCostByCurrency?: Array<{ currency: string; transportationCost: number }>;
  facilityCostByCurrency?: Array<{ currency: string; facilityOperatingCost: number }>;
  observedNetworkCostByCurrency?: Array<{ currency: string; observedCost: number }>;
  snapshotPalletUtilization?: Array<{
    facilityId: string;
    facilityName: string;
    facilityType: string | null;
    capacityPalletPositions: number;
    inventoryPallets: number;
    snapshotDate: string;
    utilizationPercent: number;
    latest: boolean;
    warning: string | null;
  }>;
  modeSummary?: Array<{ mode: string; shipmentCount: number; transportationCost: number | null }>;
  serviceLevelSummary?: Array<{ serviceLevel: string; shipmentCount: number }>;
  skuSummary?: {
    distinctSkuCount: number;
    shipmentCountBySku: Array<{ itemId: string; shipmentCount: number }>;
  } | null;
  deferredValidation: string[];
};

export type SupplyChainDesignModel02ProofReadiness = {
  canRun: boolean;
  missingInputs: string[];
  inputSelection: SupplyChainDesignModel02ProofInputSelection | null;
};

export type SupplyChainDesignLtlRatePreparationReadiness = {
  canRun: boolean;
  missingInputs: string[];
  inputSelection: SupplyChainDesignLtlRatePreparationInputSelection | null;
};

export type SupplyChainDesignLtlRatePreparationInputSelection = {
  shipments: SupplyChainDesignModel01ProofSelectedInput;
  facilities: SupplyChainDesignModel01ProofSelectedInput;
  candidateFacilities: SupplyChainDesignModel01ProofSelectedInput;
  existingFacilityOptions: Array<{
    facilityId: string;
    facilityName: string;
    annualFacilityCost: number;
  }>;
  candidateFacilityOptions: Array<{
    facilityId: string;
    facilityName: string;
    annualFixedCost: number;
  }>;
};

export type SupplyChainDesignLtlRatePreparationRunSummary = {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  errorMessage: string | null;
  inputReferences: SupplyChainDesignLtlRatePreparationInputSelection | null;
  resultSummary: SupplyChainDesignLtlRatePreparationResultSummary | null;
};

export type SupplyChainDesignModel02ProofInputSelection = {
  baselineRunId: string;
  baselineObservedCost: number;
  facilities: SupplyChainDesignModel01ProofSelectedInput;
  shipments: SupplyChainDesignModel01ProofSelectedInput;
  customers: SupplyChainDesignModel01ProofSelectedInput;
  candidateFacilities: SupplyChainDesignModel01ProofSelectedInput;
  scenarioLaneCosts: SupplyChainDesignModel01ProofSelectedInput | null;
  facilityCosts: SupplyChainDesignModel01ProofSelectedInput | null;
  existingFacilityOptions: Array<{
    facilityId: string;
    facilityName: string;
    capacity: number | null;
  }>;
  existingFacilityOptionsByMappingId: Array<{
    mappingId: string;
    options: Array<{
      facilityId: string;
      facilityName: string;
      capacity: number | null;
    }>;
  }>;
  candidateFacilityOptions: Array<{
    facilityId: string;
    facilityName: string;
    annualFixedCost: number;
    capacity: number | null;
  }>;
  candidateFacilityOptionsByMappingId: Array<{
    mappingId: string;
    options: Array<{
      facilityId: string;
      facilityName: string;
      annualFixedCost: number;
      capacity: number | null;
    }>;
  }>;
};

export type SupplyChainDesignScenarioSummary = {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  errorMessage: string | null;
  baselineRunId: string;
  inputReferences: SupplyChainDesignModel02ProofInputSelection | null;
  selectedFacilities: string[];
  resultSummary: SupplyChainDesignModel02ProofResultSummary | null;
};

export type SupplyChainDesignModel02ProofResultSummary = {
  scenarioName: string;
  baselineRunId: string;
  optimizerType: string | null;
  combinationsEvaluated: number | null;
  feasibleCombinations: number | null;
  mandatoryExistingFacilityIds: string[];
  permittedExistingFacilityIds: string[];
  permittedCandidateFacilityIds: string[];
  prohibitedCandidateFacilityIds: string[];
  minimumOpenFacilities: number | null;
  maximumOpenFacilities: number | null;
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
  baselineObservedCost: number;
  proposedTotalTransportationCost: number;
  selectedCandidateAnnualFixedCost: number;
  retainedExistingFacilityOperatingCost: number;
  proposedObservedAnnualCost: number;
  annualCostDifference: number;
  percentageDifference: number | null;
  customerAssignments: Array<{
    customerId: string;
    customerName: string;
    historicalShipmentCount: number;
    assignedFacilityId: string | null;
    assignedFacilityName: string | null;
    assignedShipmentQuantity: number;
    costPerShipment: number | null;
    proposedAnnualTransportationCost: number | null;
    remainingUnallocatedShipmentQuantity: number;
    serviceDays: number | null;
    allocationStatus: "FULLY_ALLOCATED" | "SPLIT_ACROSS_FACILITIES" | "PARTIALLY_ALLOCATED" | "UNALLOCATED";
  }>;
  facilitySummary: Array<{
    facilityId: string;
    facilityName: string;
    facilityKind: "EXISTING" | "CANDIDATE";
    assignedCustomers: number;
    assignedShipments: number;
    transportationCost: number;
    fixedOrOperatingCost: number;
    proposedObservedCost: number;
    capacity: number | null;
    remainingCapacity: number | null;
    utilizationPercent: number | null;
    capacityStatus: "UNLIMITED" | "AVAILABLE" | "NEAR_CAPACITY" | "FULL" | "NOT_AVAILABLE";
  }>;
  unallocatedCustomerIds: string[];
  missingScenarioLaneCosts: Array<{
    facilityId: string;
    destinationId: string;
  }>;
  unmatchedFacilityIds: string[];
  unmatchedCustomerIds: string[];
  deferredValidation: string[];
  alternatives: Array<{
    rank: number;
    openFacilityIds: string[];
    unallocatedShipmentCount: number;
    proposedTotalTransportationCost: number;
    facilityCost: number;
    proposedObservedAnnualCost: number;
    differenceFromRecommended: number;
  }>;
  optimizationExceptions: {
    unallocatedShipmentCount: number;
    customersWithNoUsableLane: string[];
    missingScenarioLaneCosts: Array<{
      facilityId: string;
      destinationId: string;
    }>;
    capacityShortfalls: string[];
    unmatchedFacilityIds: string[];
    unmatchedCustomerIds: string[];
  } | null;
  optimizerAudit: {
    baselineRunId: string;
    baselineRunCreatedAt: string | null;
    baselineObservedCost: number;
    inputFiles: Array<{ tableType: string; fileId: string; fileName: string; mappingId: string }>;
    selectedMappings: Array<{
      tableType: string;
      mappingId: string;
      fields: Array<{ standardField: string; sourceColumn: string | null }>;
    }>;
    facilityCostEvidence: Array<{
      facilityId: string;
      facilityKind: "EXISTING" | "CANDIDATE";
      costUsed: number;
      sourceFileName: string;
      sourceValue: string;
      sourceRow: number | null;
      openStatus: "OPEN" | "CLOSED";
    }>;
    laneCostEvidence: Array<{
      customerId: string;
      customerName: string;
      selectedFacilityId: string | null;
      costPerShipment: number | null;
      costSource: "UPLOADED_SCENARIO_LANE_COST" | "HISTORICAL_EXISTING_LANE_AVERAGE" | "MISSING_RATE";
      historicalShipmentQuantity: number;
      resultingTransportationCost: number | null;
      otherOpenFacilities: Array<{
        facilityId: string;
        costPerShipment: number | null;
        costSource: "UPLOADED_SCENARIO_LANE_COST" | "HISTORICAL_EXISTING_LANE_AVERAGE" | "MISSING_RATE";
        capacityPreventedAssignment: boolean;
      }>;
    }>;
    rankingExplanations: Array<{
      rank: number;
      alternativeOpenFacilityIds: string[];
      reason: string;
    }>;
    consistencyChecks: Array<{ label: string; passed: boolean; detail: string }>;
  } | null;
  solverMetadata: {
    solverType: "EXACT_ENUMERATION" | "MATHEMATICAL_PROGRAMMING";
    solverName: string;
    solverVersion: string;
    solverStatus: "SUCCESS" | "FAILED" | "NOT_CONFIGURED";
    solveDurationMs: number;
    problemSize: {
      facilityCount: number;
      customerCount: number;
      validLaneCount: number;
      estimatedEnumerationCombinationCount: number;
    };
    objectiveValue: number | null;
    verificationStatus: "PASSED" | "FAILED" | "NOT_RUN";
    warnings: string[];
    diagnostics: string[];
  } | null;
};
