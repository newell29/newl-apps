import {
  runSupplyChainDesignModel02Proof,
  type SupplyChainDesignMappedScenarioFile,
  type SupplyChainDesignModel02ProofResult
} from "@/modules/supply-chain-design/model-02-proof";
import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import { getSourceColumn } from "@/modules/supply-chain-design/model-01-proof";

export const MODEL_02_OPTIMIZER_TYPE = "Exact small-network optimizer";
export const MODEL_02_OPTIMIZER_SELECTABLE_FACILITY_LIMIT = 10;
export const MODEL_02_EXACT_SOLVER_VERSION = "model02-exact-enumeration-v1";
export const MODEL_02_MATHEMATICAL_SOLVER_VERSION = "model02-mathematical-programming-placeholder-v1";

export type SupplyChainDesignModel02SolverType = "EXACT_ENUMERATION" | "MATHEMATICAL_PROGRAMMING";
export type SupplyChainDesignModel02SolverStatus = "SUCCESS" | "FAILED" | "NOT_CONFIGURED";

export type SupplyChainDesignModel02OptimizerInput = {
  scenarioName: string;
  baselineRunId: string;
  baselineObservedCost: number;
  baselineRunCreatedAt?: string;
  facilities: SupplyChainDesignMappedScenarioFile;
  shipments: SupplyChainDesignMappedScenarioFile;
  customers: SupplyChainDesignMappedScenarioFile;
  candidateFacilities: SupplyChainDesignMappedScenarioFile;
  scenarioLaneCosts?: SupplyChainDesignMappedScenarioFile | null;
  facilityCosts?: SupplyChainDesignMappedScenarioFile | null;
  mandatoryExistingFacilityIds: string[];
  permittedExistingFacilityIds: string[];
  permittedCandidateFacilityIds: string[];
  prohibitedCandidateFacilityIds: string[];
  minimumOpenFacilities: number;
  maximumOpenFacilities: number;
  enforceCapacity: boolean;
  solverType?: SupplyChainDesignModel02SolverType;
  allowSolverFallback?: boolean;
};

export type SupplyChainDesignModel02OptimizerResult = SupplyChainDesignModel02ProofResult & {
  optimizerType: typeof MODEL_02_OPTIMIZER_TYPE;
  combinationsEvaluated: number;
  feasibleCombinations: number;
  mandatoryExistingFacilityIds: string[];
  permittedExistingFacilityIds: string[];
  permittedCandidateFacilityIds: string[];
  prohibitedCandidateFacilityIds: string[];
  minimumOpenFacilities: number;
  maximumOpenFacilities: number;
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
    missingScenarioLaneCosts: Array<{ facilityId: string; destinationId: string }>;
    capacityShortfalls: string[];
    unmatchedFacilityIds: string[];
    unmatchedCustomerIds: string[];
  };
  optimizerAudit: SupplyChainDesignModel02OptimizerAudit;
  solverMetadata: SupplyChainDesignModel02SolverMetadata;
};

export type SupplyChainDesignModel02Problem = {
  input: SupplyChainDesignModel02OptimizerInput;
  existingFacilityIds: string[];
  candidateFacilityIds: string[];
  customerShipmentQuantities: Array<{ customerId: string; shipmentQuantity: number }>;
  validLaneCosts: Array<{ facilityId: string; customerId: string; costPerShipment: number }>;
  existingFacilityOperatingCosts: Array<{ facilityId: string; operatingCost: number }>;
  candidateFixedCosts: Array<{ facilityId: string; fixedCost: number }>;
  capacityValues: Array<{ facilityId: string; capacity: number | null }>;
  mandatoryExistingFacilityIds: string[];
  permittedExistingFacilityIds: string[];
  permittedCandidateFacilityIds: string[];
  prohibitedCandidateFacilityIds: string[];
  minimumOpenFacilities: number;
  maximumOpenFacilities: number;
  enforceCapacity: boolean;
  tieBreaking: "ALPHABETICAL_FACILITY_ID";
  sizeSummary: SupplyChainDesignModel02ProblemSizeSummary;
};

export type SupplyChainDesignModel02ProblemSizeSummary = {
  facilityCount: number;
  customerCount: number;
  validLaneCount: number;
  estimatedEnumerationCombinationCount: number;
};

export type SupplyChainDesignModel02SolverMetadata = {
  solverType: SupplyChainDesignModel02SolverType;
  solverName: string;
  solverVersion: string;
  solverStatus: SupplyChainDesignModel02SolverStatus;
  solveDurationMs: number;
  problemSize: SupplyChainDesignModel02ProblemSizeSummary;
  objectiveValue: number | null;
  verificationStatus: "PASSED" | "FAILED" | "NOT_RUN";
  warnings: string[];
  diagnostics: string[];
};

export type SupplyChainDesignModel02SolverResult = {
  status: SupplyChainDesignModel02SolverStatus;
  solverName: string;
  solverVersion: string;
  solveDurationMs: number;
  selectedExistingFacilityIds: string[];
  selectedCandidateFacilityIds: string[];
  closedExistingFacilityIds: string[];
  allocations: SupplyChainDesignModel02ProofResult["customerAssignments"];
  unallocatedShipmentVolume: number;
  transportationCost: number;
  retainedExistingOperatingCost: number;
  candidateFixedCost: number;
  totalObservedCost: number;
  objectiveValue: number | null;
  feasibility: {
    feasibleCombinations: number;
    combinationsEvaluated: number;
  };
  warnings: string[];
  diagnostics: string[];
  proofResult: SupplyChainDesignModel02ProofResult | null;
  alternatives: SupplyChainDesignModel02ProofResult[];
};

export type SupplyChainDesignModel02OptimizerAudit = {
  baselineRunId: string;
  baselineRunCreatedAt: string | null;
  baselineObservedCost: number;
  inputFiles: Array<{ tableType: string; fileId: string; fileName: string; mappingId: string }>;
  selectedMappings: Array<{ tableType: string; mappingId: string; fields: Array<{ standardField: string; sourceColumn: string | null }> }>;
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
};

type CandidateNetwork = {
  existing: string[];
  candidates: string[];
};

export function runSupplyChainDesignModel02Optimizer(
  input: SupplyChainDesignModel02OptimizerInput
): SupplyChainDesignModel02OptimizerResult {
  const problem = buildModel02Problem(input);
  validateModel02Problem(problem);
  const solverResult = solveModel02Problem(problem, input.solverType ?? "EXACT_ENUMERATION", Boolean(input.allowSolverFallback));
  verifyModel02Solution(problem, solverResult);
  const result = buildModel02OptimizerResult(input, problem, solverResult);
  assertSupplyChainDesignModel02OptimizerConsistency(result);
  return result;
}

export function buildModel02Problem(input: SupplyChainDesignModel02OptimizerInput): SupplyChainDesignModel02Problem {
  const existingFacilityIds = readFacilityIds(input.facilities);
  const candidateFacilityIds = readCandidateFacilityIds(input.candidateFacilities);
  const customerShipmentQuantities = readCustomerShipmentQuantities(input.shipments);
  const validLaneCosts = readProblemLaneCosts(input);
  const existingFacilityOperatingCosts = input.facilityCosts ? [...readExistingFacilityCostSources(input.facilityCosts).entries()].map(([facilityId, source]) => ({
    facilityId,
    operatingCost: Number(source.sourceValue)
  })) : [];
  const candidateFixedCosts = [...readCandidateFacilityCostSources(input.candidateFacilities).entries()].map(([facilityId, source]) => ({
    facilityId,
    fixedCost: Number(source.sourceValue)
  }));
  const capacityValues = [...readCapacityValues(input.facilities, "facility_id"), ...readCapacityValues(input.candidateFacilities, "candidate_facility_id")];
  const selectableExistingIds = uniqueSorted([...input.mandatoryExistingFacilityIds, ...input.permittedExistingFacilityIds]);
  const permittedCandidateIds = uniqueSorted(
    input.permittedCandidateFacilityIds.filter((facilityId) => !input.prohibitedCandidateFacilityIds.includes(facilityId))
  );
  const selectableFacilityIds = [...selectableExistingIds, ...permittedCandidateIds];

  return {
    input,
    existingFacilityIds,
    candidateFacilityIds,
    customerShipmentQuantities,
    validLaneCosts,
    existingFacilityOperatingCosts,
    candidateFixedCosts,
    capacityValues,
    mandatoryExistingFacilityIds: uniqueSorted(input.mandatoryExistingFacilityIds),
    permittedExistingFacilityIds: uniqueSorted(input.permittedExistingFacilityIds),
    permittedCandidateFacilityIds: permittedCandidateIds,
    prohibitedCandidateFacilityIds: uniqueSorted(input.prohibitedCandidateFacilityIds),
    minimumOpenFacilities: input.minimumOpenFacilities,
    maximumOpenFacilities: input.maximumOpenFacilities,
    enforceCapacity: input.enforceCapacity,
    tieBreaking: "ALPHABETICAL_FACILITY_ID",
    sizeSummary: {
      facilityCount: selectableFacilityIds.length,
      customerCount: customerShipmentQuantities.length,
      validLaneCount: validLaneCosts.length,
      estimatedEnumerationCombinationCount: Math.max(0, 2 ** selectableFacilityIds.length - 1)
    }
  };
}

export function validateModel02Problem(problem: SupplyChainDesignModel02Problem) {
  if (problem.sizeSummary.facilityCount > MODEL_02_OPTIMIZER_SELECTABLE_FACILITY_LIMIT) {
    throw new Error(
      `${MODEL_02_OPTIMIZER_TYPE} supports at most ${MODEL_02_OPTIMIZER_SELECTABLE_FACILITY_LIMIT} selectable facilities; ${problem.sizeSummary.facilityCount} were selected.`
    );
  }
  if (problem.minimumOpenFacilities < 1) {
    throw new Error("Minimum open facilities must be at least 1.");
  }
  if (problem.maximumOpenFacilities < problem.minimumOpenFacilities) {
    throw new Error("Maximum open facilities must be greater than or equal to minimum open facilities.");
  }
}

export function solveModel02Problem(
  problem: SupplyChainDesignModel02Problem,
  solverType: SupplyChainDesignModel02SolverType = "EXACT_ENUMERATION",
  allowFallback = false
): SupplyChainDesignModel02SolverResult {
  const solver =
    solverType === "MATHEMATICAL_PROGRAMMING"
      ? new MathematicalProgrammingModel02Solver()
      : new ExactEnumerationModel02Solver();
  const result = solver.solve(problem);

  if (result.status === "NOT_CONFIGURED" && allowFallback) {
    return new ExactEnumerationModel02Solver().solve(problem);
  }
  if (result.status === "NOT_CONFIGURED") {
    throw new Error("MATHEMATICAL_PROGRAMMING Model 02 solver is not configured.");
  }
  if (result.status !== "SUCCESS" || !result.proofResult) {
    throw new Error(`${result.solverName} did not find a feasible network within the selected facility-count limits.`);
  }
  return result;
}

export class ExactEnumerationModel02Solver {
  readonly name = MODEL_02_OPTIMIZER_TYPE;
  readonly version = MODEL_02_EXACT_SOLVER_VERSION;

  solve(problem: SupplyChainDesignModel02Problem): SupplyChainDesignModel02SolverResult {
  const startedAt = Date.now();
  const input = problem.input;
  const selectableExistingIds = uniqueSorted([...input.mandatoryExistingFacilityIds, ...input.permittedExistingFacilityIds]);
  const permittedCandidateIds = problem.permittedCandidateFacilityIds;
  const networks = enumerateNetworks(selectableExistingIds, permittedCandidateIds).filter((network) => {
    const openCount = network.existing.length + network.candidates.length;
    return (
      openCount >= input.minimumOpenFacilities &&
      openCount <= input.maximumOpenFacilities &&
      input.mandatoryExistingFacilityIds.every((facilityId) => network.existing.includes(facilityId))
    );
  });
  const evaluated = networks.length;
  const successful = networks
    .map((network) => {
      try {
        return runSupplyChainDesignModel02Proof({
          scenarioName: input.scenarioName,
          baselineRunId: input.baselineRunId,
          baselineObservedCost: input.baselineObservedCost,
          facilities: input.facilities,
          shipments: input.shipments,
          customers: input.customers,
          candidateFacilities: input.candidateFacilities,
          scenarioLaneCosts: input.scenarioLaneCosts,
          facilityCosts: input.facilityCosts,
          selectedExistingFacilityIds: network.existing,
          selectedCandidateFacilityIds: network.candidates,
          enforceCapacity: input.enforceCapacity
        });
      } catch {
        return null;
      }
    })
    .filter((result): result is SupplyChainDesignModel02ProofResult => Boolean(result))
    .sort(compareResults);

  if (successful.length === 0) {
    return {
      status: "FAILED",
      solverName: this.name,
      solverVersion: this.version,
      solveDurationMs: Date.now() - startedAt,
      selectedExistingFacilityIds: [],
      selectedCandidateFacilityIds: [],
      closedExistingFacilityIds: [],
      allocations: [],
      unallocatedShipmentVolume: 0,
      transportationCost: 0,
      retainedExistingOperatingCost: 0,
      candidateFixedCost: 0,
      totalObservedCost: 0,
      objectiveValue: null,
      feasibility: { combinationsEvaluated: evaluated, feasibleCombinations: 0 },
      warnings: [],
      diagnostics: ["No feasible exact-enumeration network was produced."],
      proofResult: null,
      alternatives: []
    };
  }

  const recommended = successful[0];
  return {
    status: "SUCCESS",
    solverName: this.name,
    solverVersion: this.version,
    solveDurationMs: Date.now() - startedAt,
    selectedExistingFacilityIds: recommended.selectedExistingFacilityIds,
    selectedCandidateFacilityIds: recommended.selectedCandidateFacilityIds,
    closedExistingFacilityIds: recommended.closedExistingFacilityIds,
    allocations: recommended.customerAssignments,
    unallocatedShipmentVolume: recommended.unallocatedShipmentCount,
    transportationCost: recommended.proposedTotalTransportationCost,
    retainedExistingOperatingCost: recommended.retainedExistingFacilityOperatingCost,
    candidateFixedCost: recommended.selectedCandidateAnnualFixedCost,
    totalObservedCost: recommended.proposedObservedAnnualCost,
    objectiveValue: recommended.proposedObservedAnnualCost,
    feasibility: {
      combinationsEvaluated: evaluated,
      feasibleCombinations: successful.length
    },
    warnings: [],
    diagnostics: [
      `Exact enumeration evaluated ${evaluated} network combinations.`,
      "Ranking rule: lowest unallocated shipment volume, then lowest observed cost, then alphabetical open facility IDs."
    ],
    proofResult: recommended,
    alternatives: successful.slice(0, 5)
  };
  }
}

export class MathematicalProgrammingModel02Solver {
  readonly name = "MathematicalProgrammingModel02Solver";
  readonly version = MODEL_02_MATHEMATICAL_SOLVER_VERSION;

  solve(problem: SupplyChainDesignModel02Problem): SupplyChainDesignModel02SolverResult {
    /*
     * Future formulation:
     * - binary open[f] for each permitted existing or candidate facility;
     * - nonnegative allocation[f,c] shipment quantity from facility to customer;
     * - lexicographic objective: first minimize unallocated shipment volume, then minimize
     *   transportation cost + retained existing operating cost + opened candidate fixed cost;
     * - constraints: mandatory facilities open, prohibited candidates closed, open-count
     *   minimum/maximum, allocation only through open facilities with valid lane cost,
     *   assigned plus unallocated reconciles to historical shipment volume, capacity
     *   respected when enabled, no negative allocation, deterministic result normalization.
     */
    return {
      status: "NOT_CONFIGURED",
      solverName: this.name,
      solverVersion: this.version,
      solveDurationMs: 0,
      selectedExistingFacilityIds: [],
      selectedCandidateFacilityIds: [],
      closedExistingFacilityIds: [],
      allocations: [],
      unallocatedShipmentVolume: 0,
      transportationCost: 0,
      retainedExistingOperatingCost: 0,
      candidateFixedCost: 0,
      totalObservedCost: 0,
      objectiveValue: null,
      feasibility: { combinationsEvaluated: 0, feasibleCombinations: 0 },
      warnings: ["No approved mathematical-programming solver dependency is configured in this repository."],
      diagnostics: [`Problem had ${problem.sizeSummary.facilityCount} selectable facilities.`],
      proofResult: null,
      alternatives: []
    };
  }
}

export function buildModel02OptimizerResult(
  input: SupplyChainDesignModel02OptimizerInput,
  problem: SupplyChainDesignModel02Problem,
  solverResult: SupplyChainDesignModel02SolverResult
): SupplyChainDesignModel02OptimizerResult {
  const recommended = solverResult.proofResult;
  if (!recommended) {
    throw new Error(`${solverResult.solverName} did not return a solution.`);
  }
  const alternatives = solverResult.alternatives.map((result, index) => ({
    rank: index + 1,
    openFacilityIds: result.selectedFacilityIds,
    unallocatedShipmentCount: result.unallocatedShipmentCount,
    proposedTotalTransportationCost: result.proposedTotalTransportationCost,
    facilityCost: result.retainedExistingFacilityOperatingCost + result.selectedCandidateAnnualFixedCost,
    proposedObservedAnnualCost: result.proposedObservedAnnualCost,
    differenceFromRecommended: result.proposedObservedAnnualCost - recommended.proposedObservedAnnualCost
  }));

  const result = {
    ...recommended,
    scenarioName: input.scenarioName,
    optimizerType: MODEL_02_OPTIMIZER_TYPE,
    combinationsEvaluated: solverResult.feasibility.combinationsEvaluated,
    feasibleCombinations: solverResult.feasibility.feasibleCombinations,
    mandatoryExistingFacilityIds: uniqueSorted(input.mandatoryExistingFacilityIds),
    permittedExistingFacilityIds: uniqueSorted(input.permittedExistingFacilityIds),
    permittedCandidateFacilityIds: problem.permittedCandidateFacilityIds,
    prohibitedCandidateFacilityIds: uniqueSorted(input.prohibitedCandidateFacilityIds),
    minimumOpenFacilities: input.minimumOpenFacilities,
    maximumOpenFacilities: input.maximumOpenFacilities,
    alternatives,
    optimizationExceptions: {
      unallocatedShipmentCount: recommended.unallocatedShipmentCount,
      customersWithNoUsableLane: recommended.customerAssignments
        .filter((assignment) => assignment.assignedFacilityId === null)
        .map((assignment) => assignment.customerId),
      missingScenarioLaneCosts: recommended.missingScenarioLaneCosts,
      capacityShortfalls: recommended.unallocatedShipmentCount > 0 && input.enforceCapacity ? recommended.unallocatedCustomerIds : [],
      unmatchedFacilityIds: recommended.unmatchedFacilityIds,
      unmatchedCustomerIds: recommended.unmatchedCustomerIds
    },
    optimizerAudit: buildOptimizerAudit(input, recommended, alternatives),
    solverMetadata: {
      solverType: input.solverType ?? "EXACT_ENUMERATION",
      solverName: solverResult.solverName,
      solverVersion: solverResult.solverVersion,
      solverStatus: solverResult.status,
      solveDurationMs: solverResult.solveDurationMs,
      problemSize: problem.sizeSummary,
      objectiveValue: solverResult.objectiveValue,
      verificationStatus: "PASSED",
      warnings: solverResult.warnings,
      diagnostics: solverResult.diagnostics
    }
  };
  return result;
}

export function verifyModel02Solution(
  problem: SupplyChainDesignModel02Problem,
  solverResult: SupplyChainDesignModel02SolverResult
) {
  if (solverResult.status !== "SUCCESS" || !solverResult.proofResult) {
    throw new Error(`${solverResult.solverName} did not return a successful solution to verify.`);
  }

  const result = solverResult.proofResult;
  const openFacilityIds = new Set(result.selectedFacilityIds);
  const validLaneKeys = new Set(problem.validLaneCosts.map((lane) => laneKey(lane.facilityId, lane.customerId)));
  const failed = [
    {
      label: "mandatory facilities are open",
      passed: problem.mandatoryExistingFacilityIds.every((facilityId) => result.selectedExistingFacilityIds.includes(facilityId))
    },
    {
      label: "prohibited candidates are closed",
      passed: problem.prohibitedCandidateFacilityIds.every((facilityId) => !result.selectedCandidateFacilityIds.includes(facilityId))
    },
    {
      label: "open facility count is within limits",
      passed:
        result.selectedFacilityIds.length >= problem.minimumOpenFacilities &&
        result.selectedFacilityIds.length <= problem.maximumOpenFacilities
    },
    {
      label: "allocations use only open facilities",
      passed: result.customerAssignments.every(
        (assignment) => assignment.assignedFacilityId === null || openFacilityIds.has(assignment.assignedFacilityId)
      )
    },
    {
      label: "allocations use only valid lane costs",
      passed: result.customerAssignments.every(
        (assignment) =>
          assignment.assignedFacilityId === null ||
          validLaneKeys.has(laneKey(assignment.assignedFacilityId, assignment.customerId))
      )
    },
    {
      label: "capacity is not exceeded",
      passed:
        !problem.enforceCapacity ||
        result.facilitySummary.every(
          (facility) => facility.capacity === null || facility.assignedShipments <= facility.capacity + 0.000001
        )
    }
  ].filter((check) => !check.passed);

  if (failed.length > 0) {
    throw new Error(`Model 02 solver verification failed: ${failed[0].label}.`);
  }
}

export function assertSupplyChainDesignModel02OptimizerConsistency(
  result: SupplyChainDesignModel02OptimizerResult
) {
  const tolerance = 0.000001;
  const facilityCost = result.retainedExistingFacilityOperatingCost + result.selectedCandidateAnnualFixedCost;
  const facilityCostEvidenceTotal = result.optimizerAudit.facilityCostEvidence
    .filter((facility) => facility.openStatus === "OPEN")
    .reduce((total, facility) => total + facility.costUsed, 0);
  const transportationTotal = result.customerAssignments.reduce(
    (total, assignment) => total + (assignment.proposedAnnualTransportationCost ?? 0),
    0
  );
  const assignedShipmentCount = result.customerAssignments.reduce(
    (total, assignment) => total + assignment.assignedShipmentQuantity,
    0
  );
  const unallocatedShipmentCount = result.customerAssignments.reduce(
    (total, assignment) =>
      assignment.assignedFacilityId === null ? total + assignment.remainingUnallocatedShipmentQuantity : total,
    0
  );
  const failed = [
    {
      label: "facility cost evidence equals objective facility cost",
      passed: Math.abs(facilityCostEvidenceTotal - facilityCost) <= tolerance,
      detail: `${facilityCostEvidenceTotal} displayed facility cost vs ${facilityCost} objective facility cost`
    },
    {
      label: "transportation totals equal allocation-row totals",
      passed: Math.abs(transportationTotal - result.proposedTotalTransportationCost) <= tolerance,
      detail: `${transportationTotal} allocation total vs ${result.proposedTotalTransportationCost} displayed total`
    },
    {
      label: "observed cost equals transportation plus facility cost",
      passed: Math.abs(result.proposedObservedAnnualCost - (result.proposedTotalTransportationCost + facilityCost)) <= tolerance,
      detail: `${result.proposedObservedAnnualCost} observed vs ${result.proposedTotalTransportationCost + facilityCost} calculated`
    },
    {
      label: "difference equals proposed cost minus Model 01 baseline",
      passed: Math.abs(result.annualCostDifference - (result.proposedObservedAnnualCost - result.baselineObservedCost)) <= tolerance,
      detail: `${result.annualCostDifference} difference vs ${result.proposedObservedAnnualCost - result.baselineObservedCost} calculated`
    },
    {
      label: "assigned plus unallocated shipment volume equals historical shipment volume",
      passed:
        Math.abs(assignedShipmentCount + unallocatedShipmentCount - result.historicalShipmentCount) <= tolerance &&
        Math.abs(assignedShipmentCount - result.assignedShipmentCount) <= tolerance &&
        Math.abs(unallocatedShipmentCount - result.unallocatedShipmentCount) <= tolerance,
      detail: `${assignedShipmentCount} assigned + ${unallocatedShipmentCount} unallocated vs ${result.historicalShipmentCount} historical`
    },
    {
      label: "no prohibited facility is open",
      passed: result.prohibitedCandidateFacilityIds.every((facilityId) => !result.selectedCandidateFacilityIds.includes(facilityId)),
      detail: `open candidates: ${result.selectedCandidateFacilityIds.join(", ") || "none"}`
    },
    {
      label: "all mandatory facilities are open",
      passed: result.mandatoryExistingFacilityIds.every((facilityId) => result.selectedExistingFacilityIds.includes(facilityId)),
      detail: `open existing: ${result.selectedExistingFacilityIds.join(", ") || "none"}`
    },
    {
      label: "capacity is not exceeded when enforced",
      passed:
        !result.enforceCapacity ||
        result.facilitySummary.every(
          (facility) => facility.capacity === null || facility.assignedShipments <= facility.capacity + tolerance
        ),
      detail: result.enforceCapacity ? "capacity enforcement enabled" : "capacity enforcement disabled"
    }
  ].filter((check) => !check.passed);

  if (failed.length > 0) {
    throw new Error(`Model 02 optimizer consistency check failed: ${failed[0].label}; ${failed[0].detail}.`);
  }
}

function buildOptimizerAudit(
  input: SupplyChainDesignModel02OptimizerInput,
  recommended: SupplyChainDesignModel02ProofResult,
  alternatives: SupplyChainDesignModel02OptimizerResult["alternatives"]
): SupplyChainDesignModel02OptimizerAudit {
  const facilityCostEvidence = buildFacilityCostEvidence(input, recommended);
  const laneCostEvidence = buildLaneCostEvidence(input, recommended);
  const rankingExplanations = alternatives.slice(1).map((alternative) => ({
    rank: alternative.rank,
    alternativeOpenFacilityIds: alternative.openFacilityIds,
    reason: explainAlternative(recommended, alternative)
  }));
  const facilityCost = recommended.retainedExistingFacilityOperatingCost + recommended.selectedCandidateAnnualFixedCost;
  const allocationTransportationTotal = recommended.customerAssignments.reduce(
    (total, assignment) => total + (assignment.proposedAnnualTransportationCost ?? 0),
    0
  );
  const assignedShipmentCount = recommended.customerAssignments.reduce(
    (total, assignment) => total + assignment.assignedShipmentQuantity,
    0
  );
  const unallocatedShipmentCount = recommended.customerAssignments.reduce(
    (total, assignment) =>
      assignment.assignedFacilityId === null ? total + assignment.remainingUnallocatedShipmentQuantity : total,
    0
  );

  return {
    baselineRunId: input.baselineRunId,
    baselineRunCreatedAt: input.baselineRunCreatedAt ?? null,
    baselineObservedCost: input.baselineObservedCost,
    inputFiles: [
      inputFile("FACILITIES", input.facilities),
      inputFile("CUSTOMERS", input.customers),
      inputFile("SHIPMENTS", input.shipments),
      input.facilityCosts ? inputFile("FACILITY_COSTS", input.facilityCosts) : null,
      inputFile("CANDIDATE_FACILITIES", input.candidateFacilities),
      input.scenarioLaneCosts ? inputFile("SCENARIO_LANE_COSTS", input.scenarioLaneCosts) : null
    ].filter((file): file is SupplyChainDesignModel02OptimizerAudit["inputFiles"][number] => Boolean(file)),
    selectedMappings: [
      mappingEvidence("FACILITIES", input.facilities),
      mappingEvidence("CUSTOMERS", input.customers),
      mappingEvidence("SHIPMENTS", input.shipments),
      input.facilityCosts ? mappingEvidence("FACILITY_COSTS", input.facilityCosts) : null,
      mappingEvidence("CANDIDATE_FACILITIES", input.candidateFacilities),
      input.scenarioLaneCosts ? mappingEvidence("SCENARIO_LANE_COSTS", input.scenarioLaneCosts) : null
    ].filter((mapping): mapping is SupplyChainDesignModel02OptimizerAudit["selectedMappings"][number] => Boolean(mapping)),
    facilityCostEvidence,
    laneCostEvidence,
    rankingExplanations,
    consistencyChecks: [
      {
        label: "Facility cost evidence equals objective facility cost",
        passed:
          Math.abs(
            facilityCostEvidence
              .filter((facility) => facility.openStatus === "OPEN")
              .reduce((total, facility) => total + facility.costUsed, 0) - facilityCost
          ) <= 0.000001,
        detail: `Open facility cost is ${facilityCost}.`
      },
      {
        label: "Transportation totals equal allocation-row totals",
        passed: Math.abs(allocationTransportationTotal - recommended.proposedTotalTransportationCost) <= 0.000001,
        detail: `Allocation rows total ${allocationTransportationTotal}.`
      },
      {
        label: "Observed cost equals transportation plus facility costs",
        passed:
          Math.abs(
            recommended.proposedObservedAnnualCost - (recommended.proposedTotalTransportationCost + facilityCost)
          ) <= 0.000001,
        detail: `${recommended.proposedObservedAnnualCost} equals ${recommended.proposedTotalTransportationCost} plus ${facilityCost}.`
      },
      {
        label: "Difference equals proposed cost minus Model 01 baseline",
        passed:
          Math.abs(recommended.annualCostDifference - (recommended.proposedObservedAnnualCost - input.baselineObservedCost)) <=
          0.000001,
        detail: `${recommended.annualCostDifference} equals ${recommended.proposedObservedAnnualCost} minus ${input.baselineObservedCost}.`
      },
      {
        label: "Assigned plus unallocated shipment volume equals historical shipment volume",
        passed:
          Math.abs(assignedShipmentCount + unallocatedShipmentCount - recommended.historicalShipmentCount) <= 0.000001,
        detail: `${assignedShipmentCount} assigned plus ${unallocatedShipmentCount} unallocated equals ${recommended.historicalShipmentCount}.`
      },
      {
        label: "No prohibited facility is open",
        passed: input.prohibitedCandidateFacilityIds.every(
          (facilityId) => !recommended.selectedCandidateFacilityIds.includes(facilityId)
        ),
        detail: `Prohibited candidates: ${uniqueSorted(input.prohibitedCandidateFacilityIds).join(", ") || "none"}.`
      },
      {
        label: "All mandatory facilities are open",
        passed: input.mandatoryExistingFacilityIds.every((facilityId) =>
          recommended.selectedExistingFacilityIds.includes(facilityId)
        ),
        detail: `Mandatory existing facilities: ${uniqueSorted(input.mandatoryExistingFacilityIds).join(", ") || "none"}.`
      },
      {
        label: "Capacity is not exceeded when enforced",
        passed:
          !input.enforceCapacity ||
          recommended.facilitySummary.every(
            (facility) => facility.capacity === null || facility.assignedShipments <= facility.capacity + 0.000001
          ),
        detail: input.enforceCapacity ? "Capacity enforcement was enabled." : "Capacity enforcement was disabled."
      }
    ]
  };
}

function enumerateNetworks(existingFacilityIds: string[], candidateFacilityIds: string[]): CandidateNetwork[] {
  const facilities = [
    ...existingFacilityIds.map((facilityId) => ({ kind: "EXISTING" as const, facilityId })),
    ...candidateFacilityIds.map((facilityId) => ({ kind: "CANDIDATE" as const, facilityId }))
  ];
  const networks: CandidateNetwork[] = [];

  for (let mask = 1; mask < 2 ** facilities.length; mask += 1) {
    const network: CandidateNetwork = { existing: [], candidates: [] };
    facilities.forEach((facility, index) => {
      if ((mask & (1 << index)) === 0) {
        return;
      }
      if (facility.kind === "EXISTING") {
        network.existing.push(facility.facilityId);
      } else {
        network.candidates.push(facility.facilityId);
      }
    });
    networks.push({
      existing: uniqueSorted(network.existing),
      candidates: uniqueSorted(network.candidates)
    });
  }

  return networks;
}

function compareResults(left: SupplyChainDesignModel02ProofResult, right: SupplyChainDesignModel02ProofResult) {
  return (
    left.unallocatedShipmentCount - right.unallocatedShipmentCount ||
    left.proposedObservedAnnualCost - right.proposedObservedAnnualCost ||
    left.selectedFacilityIds.join("|").localeCompare(right.selectedFacilityIds.join("|"))
  );
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function inputFile(tableType: string, file: SupplyChainDesignMappedScenarioFile) {
  return {
    tableType,
    fileId: file.fileId,
    fileName: file.fileName ?? `${tableType} file`,
    mappingId: file.mappingId
  };
}

function mappingEvidence(tableType: string, file: SupplyChainDesignMappedScenarioFile) {
  return {
    tableType,
    mappingId: file.mappingId,
    fields: file.fieldMappings.map((field) => ({
      standardField: field.standardField,
      sourceColumn: field.sourceColumn
    }))
  };
}

function buildFacilityCostEvidence(
  input: SupplyChainDesignModel02OptimizerInput,
  recommended: SupplyChainDesignModel02ProofResult
) {
  const evidence: SupplyChainDesignModel02OptimizerAudit["facilityCostEvidence"] = [];
  const openFacilityIds = new Set(recommended.selectedFacilityIds);
  const existingOperatingCosts = input.facilityCosts ? readExistingFacilityCostSources(input.facilityCosts) : new Map();
  const candidateFixedCosts = readCandidateFacilityCostSources(input.candidateFacilities);

  for (const facility of recommended.facilitySummary) {
    const source = facility.facilityKind === "CANDIDATE" ? candidateFixedCosts.get(facility.facilityId) : existingOperatingCosts.get(facility.facilityId);
    evidence.push({
      facilityId: facility.facilityId,
      facilityKind: facility.facilityKind,
      costUsed: facility.fixedOrOperatingCost,
      sourceFileName: source?.sourceFileName ?? (facility.facilityKind === "CANDIDATE" ? input.candidateFacilities.fileName : input.facilityCosts?.fileName) ?? "Not selected",
      sourceValue: source?.sourceValue ?? (facility.fixedOrOperatingCost === 0 ? "0" : String(facility.fixedOrOperatingCost)),
      sourceRow: source?.sourceRow ?? null,
      openStatus: openFacilityIds.has(facility.facilityId) ? "OPEN" : "CLOSED"
    });
  }

  for (const facilityId of recommended.closedExistingFacilityIds) {
    const source = existingOperatingCosts.get(facilityId);
    evidence.push({
      facilityId,
      facilityKind: "EXISTING",
      costUsed: 0,
      sourceFileName: source?.sourceFileName ?? input.facilityCosts?.fileName ?? "No facility-cost file selected",
      sourceValue: source?.sourceValue ?? "0",
      sourceRow: source?.sourceRow ?? null,
      openStatus: "CLOSED"
    });
  }

  for (const facilityId of recommended.unselectedCandidateFacilityIds) {
    const source = candidateFixedCosts.get(facilityId);
    evidence.push({
      facilityId,
      facilityKind: "CANDIDATE",
      costUsed: 0,
      sourceFileName: source?.sourceFileName ?? input.candidateFacilities.fileName ?? "CANDIDATE_FACILITIES file",
      sourceValue: source?.sourceValue ?? "0",
      sourceRow: source?.sourceRow ?? null,
      openStatus: "CLOSED"
    });
  }

  return evidence.sort((left, right) => left.facilityId.localeCompare(right.facilityId));
}

function buildLaneCostEvidence(
  input: SupplyChainDesignModel02OptimizerInput,
  recommended: SupplyChainDesignModel02ProofResult
) {
  const uploadedLaneCosts = input.scenarioLaneCosts ? readLaneCostSources(input.scenarioLaneCosts) : new Map<string, number>();
  const historicalLaneCosts = readHistoricalLaneAverages(input.shipments);
  const openFacilities = recommended.facilitySummary;

  return recommended.customerAssignments.map((assignment) => {
    const selectedFacilityId = assignment.assignedFacilityId;
    const selectedCost =
      selectedFacilityId === null ? null : getLaneEvidenceCost(selectedFacilityId, assignment.customerId, uploadedLaneCosts, historicalLaneCosts);
    return {
      customerId: assignment.customerId,
      customerName: assignment.customerName,
      selectedFacilityId,
      costPerShipment: assignment.costPerShipment,
      costSource: selectedFacilityId
        ? getLaneEvidenceSource(selectedFacilityId, assignment.customerId, uploadedLaneCosts, historicalLaneCosts)
        : "MISSING_RATE" as const,
      historicalShipmentQuantity: assignment.historicalShipmentCount,
      resultingTransportationCost: assignment.proposedAnnualTransportationCost,
      otherOpenFacilities: openFacilities.map((facility) => {
        const costPerShipment = getLaneEvidenceCost(facility.facilityId, assignment.customerId, uploadedLaneCosts, historicalLaneCosts);
        return {
          facilityId: facility.facilityId,
          costPerShipment,
          costSource: getLaneEvidenceSource(facility.facilityId, assignment.customerId, uploadedLaneCosts, historicalLaneCosts),
          capacityPreventedAssignment:
            Boolean(input.enforceCapacity && selectedFacilityId && facility.facilityId !== selectedFacilityId && costPerShipment !== null && selectedCost !== null && costPerShipment < selectedCost && facility.capacity !== null && facility.remainingCapacity === 0)
        };
      })
    };
  });
}

function readExistingFacilityCostSources(file: SupplyChainDesignMappedScenarioFile) {
  const mapped = readRowsWithMappedColumns(file);
  const sources = new Map<string, { sourceFileName: string; sourceValue: string; sourceRow: number }>();
  const totals = new Map<string, number>();
  const rowsByFacility = new Map<string, number[]>();
  for (const row of mapped.rows) {
    const facilityId = valueFor(row.values, mapped.columnIndexes, "facility_id");
    const annualCostRaw = valueFor(row.values, mapped.columnIndexes, "annual_cost");
    if (!facilityId || !annualCostRaw) {
      continue;
    }
    totals.set(facilityId, (totals.get(facilityId) ?? 0) + Number(annualCostRaw));
    rowsByFacility.set(facilityId, [...(rowsByFacility.get(facilityId) ?? []), row.sourceRow]);
  }
  for (const [facilityId, total] of totals.entries()) {
    sources.set(facilityId, {
      sourceFileName: file.fileName ?? "FACILITY_COSTS file",
      sourceValue: String(total),
      sourceRow: rowsByFacility.get(facilityId)?.[0] ?? 0
    });
  }
  return sources;
}

function readCandidateFacilityCostSources(file: SupplyChainDesignMappedScenarioFile) {
  const mapped = readRowsWithMappedColumns(file);
  const sources = new Map<string, { sourceFileName: string; sourceValue: string; sourceRow: number }>();
  for (const row of mapped.rows) {
    const facilityId = valueFor(row.values, mapped.columnIndexes, "candidate_facility_id");
    const annualFixedCost =
      valueFor(row.values, mapped.columnIndexes, "annual_facility_warehouse_cost") ||
      valueFor(row.values, mapped.columnIndexes, "annual_fixed_cost");
    if (facilityId) {
      sources.set(facilityId, {
        sourceFileName: file.fileName ?? "CANDIDATE_FACILITIES file",
        sourceValue: annualFixedCost || "0",
        sourceRow: row.sourceRow
      });
    }
  }
  return sources;
}

function readLaneCostSources(file: SupplyChainDesignMappedScenarioFile) {
  const mapped = readRowsWithMappedColumns(file);
  const sources = new Map<string, number>();
  for (const row of mapped.rows) {
    const facilityId = valueFor(row.values, mapped.columnIndexes, "origin_facility_id");
    const destinationId = valueFor(row.values, mapped.columnIndexes, "destination_id");
    const cost = valueFor(row.values, mapped.columnIndexes, "cost_per_shipment");
    if (facilityId && destinationId && cost) {
      sources.set(laneKey(facilityId, destinationId), Number(cost));
    }
  }
  return sources;
}

function readHistoricalLaneAverages(file: SupplyChainDesignMappedScenarioFile) {
  const mapped = readRowsWithMappedColumns(file);
  const totals = new Map<string, { total: number; count: number }>();
  for (const row of mapped.rows) {
    const facilityId = valueFor(row.values, mapped.columnIndexes, "origin_facility_id");
    const destinationId = valueFor(row.values, mapped.columnIndexes, "destination_id");
    const cost = valueFor(row.values, mapped.columnIndexes, "transportation_cost");
    if (!facilityId || !destinationId || !cost) {
      continue;
    }
    const key = laneKey(facilityId, destinationId);
    const current = totals.get(key) ?? { total: 0, count: 0 };
    totals.set(key, { total: current.total + Number(cost), count: current.count + 1 });
  }
  return new Map([...totals.entries()].map(([key, value]) => [key, value.total / value.count]));
}

function readFacilityIds(file: SupplyChainDesignMappedScenarioFile) {
  const mapped = readRowsWithMappedColumns(file);
  return uniqueSorted(mapped.rows.map((row) => valueFor(row.values, mapped.columnIndexes, "facility_id")));
}

function readCandidateFacilityIds(file: SupplyChainDesignMappedScenarioFile) {
  const mapped = readRowsWithMappedColumns(file);
  return uniqueSorted(mapped.rows.map((row) => valueFor(row.values, mapped.columnIndexes, "candidate_facility_id")));
}

function readCustomerShipmentQuantities(file: SupplyChainDesignMappedScenarioFile) {
  const mapped = readRowsWithMappedColumns(file);
  const quantities = new Map<string, number>();
  for (const row of mapped.rows) {
    const customerId = valueFor(row.values, mapped.columnIndexes, "destination_id");
    if (customerId) {
      quantities.set(customerId, (quantities.get(customerId) ?? 0) + 1);
    }
  }
  return [...quantities.entries()]
    .map(([customerId, shipmentQuantity]) => ({ customerId, shipmentQuantity }))
    .sort((left, right) => left.customerId.localeCompare(right.customerId));
}

function readProblemLaneCosts(input: SupplyChainDesignModel02OptimizerInput) {
  const uploadedLaneCosts = input.scenarioLaneCosts ? readLaneCostSources(input.scenarioLaneCosts) : new Map<string, number>();
  const historicalLaneCosts = readHistoricalLaneAverages(input.shipments);
  return [...new Map([...historicalLaneCosts.entries(), ...uploadedLaneCosts.entries()]).entries()]
    .map(([key, costPerShipment]) => {
      const [facilityId, customerId] = key.split("::");
      return { facilityId, customerId, costPerShipment };
    })
    .sort((left, right) => left.facilityId.localeCompare(right.facilityId) || left.customerId.localeCompare(right.customerId));
}

function readCapacityValues(file: SupplyChainDesignMappedScenarioFile, idField: "facility_id" | "candidate_facility_id") {
  const mapped = readRowsWithMappedColumns(file);
  return mapped.rows
    .map((row) => {
      const facilityId = valueFor(row.values, mapped.columnIndexes, idField);
      const capacity = valueFor(row.values, mapped.columnIndexes, "capacity");
      return {
        facilityId,
        capacity: capacity ? Number(capacity) : null
      };
    })
    .filter((row) => row.facilityId)
    .sort((left, right) => left.facilityId.localeCompare(right.facilityId));
}

function getLaneEvidenceCost(
  facilityId: string,
  customerId: string,
  uploadedLaneCosts: Map<string, number>,
  historicalLaneCosts: Map<string, number>
) {
  const key = laneKey(facilityId, customerId);
  return uploadedLaneCosts.get(key) ?? historicalLaneCosts.get(key) ?? null;
}

function getLaneEvidenceSource(
  facilityId: string,
  customerId: string,
  uploadedLaneCosts: Map<string, number>,
  historicalLaneCosts: Map<string, number>
) {
  const key = laneKey(facilityId, customerId);
  if (uploadedLaneCosts.has(key)) {
    return "UPLOADED_SCENARIO_LANE_COST" as const;
  }
  if (historicalLaneCosts.has(key)) {
    return "HISTORICAL_EXISTING_LANE_AVERAGE" as const;
  }
  return "MISSING_RATE" as const;
}

function readRowsWithMappedColumns(file: SupplyChainDesignMappedScenarioFile) {
  const rows = parseCsvRows(file.fileBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  const columnIndexes = new Map<string, number>();
  for (const mapping of file.fieldMappings) {
    if (!mapping.sourceColumn) {
      continue;
    }
    const index = headers.indexOf(mapping.sourceColumn);
    if (index !== -1) {
      columnIndexes.set(mapping.standardField, index);
    }
  }
  return {
    columnIndexes,
    rows: rows
      .slice(1)
      .map((values, index) => ({ values, sourceRow: index + 2 }))
      .filter((row) => row.values.some((value) => value.trim()))
  };
}

function valueFor(row: string[], columnIndexes: Map<string, number>, standardField: string) {
  const index = columnIndexes.get(standardField);
  return typeof index === "number" ? (row[index] ?? "").trim() : "";
}

function laneKey(facilityId: string, destinationId: string) {
  return `${facilityId}::${destinationId}`;
}

function explainAlternative(
  recommended: SupplyChainDesignModel02ProofResult,
  alternative: SupplyChainDesignModel02OptimizerResult["alternatives"][number]
) {
  if (recommended.unallocatedShipmentCount < alternative.unallocatedShipmentCount) {
    return `This network ranked ahead of Alternative ${alternative.rank} because it left ${alternative.unallocatedShipmentCount - recommended.unallocatedShipmentCount} fewer shipments unallocated.`;
  }
  const costDifference = alternative.proposedObservedAnnualCost - recommended.proposedObservedAnnualCost;
  if (costDifference > 0) {
    return `This network ranked ahead of Alternative ${alternative.rank} because both allocated the same shipment volume, while this network's observed annual cost was ${costDifference} lower.`;
  }
  return `This network ranked ahead of Alternative ${alternative.rank} by alphabetical open-facility ID tie handling after unallocated volume and observed cost matched.`;
}
