import type { SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";
import {
  createSupplyChainDesignScenarioMissingRateBatch,
  runSupplyChainDesignLtlRateBatch
} from "@/modules/supply-chain-design/ltl-rate-batches";
import {
  evaluateSupplyChainDesignCombinedScenarioCost,
  type SupplyChainDesignCombinedScenarioCostInput,
  type SupplyChainDesignCombinedScenarioCostResult,
  type SupplyChainDesignCombinedScenarioFacilityInput
} from "@/modules/supply-chain-design/network-scenario-combined-cost";
import {
  evaluateSupplyChainDesignNetworkScenario,
  type SupplyChainDesignNetworkScenarioEvaluationResult,
  type SupplyChainDesignNetworkScenarioInput,
  type SupplyChainDesignNetworkScenarioMissingRateRequest
} from "@/modules/supply-chain-design/network-scenario-evaluation";
import {
  buildNetworkScenarioComparisonFingerprint,
  buildNetworkScenarioTransportationFingerprint,
  createNetworkScenarioComparisonRun,
  findActiveNetworkScenarioComparisonRunByFingerprint,
  findCompletedNetworkScenarioComparisonRunByFingerprint,
  type NetworkScenarioComparisonFxInput,
  type NetworkScenarioComparisonInputReferences,
  type NetworkScenarioComparisonRatingEvidence,
  type NetworkScenarioComparisonResultSummary,
  type NetworkScenarioComparisonRunDetail,
  type NetworkScenarioComparisonScenarioInputs,
  updateNetworkScenarioComparisonRunLifecycle
} from "@/modules/supply-chain-design/network-scenario-comparison-persistence";
import type { AuthenticatedContext } from "@/server/tenant-context";

export type SupplyChainDesignNetworkScenarioComparisonScenarioKey = "A" | "B";

export type SupplyChainDesignNetworkScenarioComparisonScenarioOrchestrationInput = {
  scenarioKey: SupplyChainDesignNetworkScenarioComparisonScenarioKey;
  scenarioName: string;
  transportationInput: SupplyChainDesignNetworkScenarioInput;
  combinedCostInput: Omit<SupplyChainDesignCombinedScenarioCostInput, "transportationEvaluation">;
};

export type SupplyChainDesignNetworkScenarioComparisonOrchestrationInput = {
  context: AuthenticatedContext;
  projectId: string;
  comparisonRunId?: string;
  inputReferences: NetworkScenarioComparisonInputReferences;
  scenarioInputs: NetworkScenarioComparisonScenarioInputs;
  scenarioA: SupplyChainDesignNetworkScenarioComparisonScenarioOrchestrationInput;
  scenarioB: SupplyChainDesignNetworkScenarioComparisonScenarioOrchestrationInput;
  account: SevenLAccountConfig;
  carrierHashes: string[];
  fxInput?: NetworkScenarioComparisonFxInput | null;
  submitMissingRates?: boolean;
  finalizeWithMissingRates?: boolean;
  forceNewRun?: boolean;
  resultInputs?: Record<string, unknown>;
};

export type SupplyChainDesignNetworkScenarioComparisonOrchestrationResult = {
  phase: "EVALUATING" | "RATES_REQUIRED" | "RATING" | "READY_FOR_COST_EVALUATION" | "COMPLETE" | "INCOMPLETE" | "FAILED";
  run: NetworkScenarioComparisonRunDetail;
  reusedCompletedRunId: string | null;
  resumedActiveRunId: string | null;
  transportationFingerprint: string;
  comparisonFingerprint: string;
  scenarioA: {
    transportationEvaluation: SupplyChainDesignNetworkScenarioEvaluationResult | null;
    combinedCostEvaluation: SupplyChainDesignCombinedScenarioCostResult | null;
    fx: ScenarioFxEvidence | null;
  };
  scenarioB: {
    transportationEvaluation: SupplyChainDesignNetworkScenarioEvaluationResult | null;
    combinedCostEvaluation: SupplyChainDesignCombinedScenarioCostResult | null;
    fx: ScenarioFxEvidence | null;
  };
  missingRateBatch: {
    jobId: string;
    requestCount: number;
    shouldProcess: boolean;
  } | null;
  ratingEvidence: NetworkScenarioComparisonRatingEvidence;
  resultSummary: NetworkScenarioComparisonResultSummary | null;
};

export type ScenarioFxEvidence = {
  sourceCurrencies: string[];
  normalizedCurrency: string | null;
  cadToUsdRate: number | null;
  fxApplied: boolean;
  incompleteReason: string | null;
};

type Dependencies = {
  evaluateTransportation?: typeof evaluateSupplyChainDesignNetworkScenario;
  createMissingRateBatch?: typeof createSupplyChainDesignScenarioMissingRateBatch;
  processRateBatch?: typeof runSupplyChainDesignLtlRateBatch;
  evaluateCombinedCost?: typeof evaluateSupplyChainDesignCombinedScenarioCost;
  findCompletedRun?: typeof findCompletedNetworkScenarioComparisonRunByFingerprint;
  findActiveRun?: typeof findActiveNetworkScenarioComparisonRunByFingerprint;
  createRun?: typeof createNetworkScenarioComparisonRun;
  updateRun?: typeof updateNetworkScenarioComparisonRunLifecycle;
};

type ScenarioWork = SupplyChainDesignNetworkScenarioComparisonScenarioOrchestrationInput & {
  transportationEvaluation: SupplyChainDesignNetworkScenarioEvaluationResult;
};

export async function orchestrateSupplyChainDesignNetworkScenarioComparison(
  input: SupplyChainDesignNetworkScenarioComparisonOrchestrationInput,
  dependencies: Dependencies = {}
): Promise<SupplyChainDesignNetworkScenarioComparisonOrchestrationResult> {
  validateSharedDemand(input);
  const evaluateTransportation = dependencies.evaluateTransportation ?? evaluateSupplyChainDesignNetworkScenario;
  const createMissingRateBatch = dependencies.createMissingRateBatch ?? createSupplyChainDesignScenarioMissingRateBatch;
  const processRateBatch = dependencies.processRateBatch ?? runSupplyChainDesignLtlRateBatch;
  const evaluateCombinedCost = dependencies.evaluateCombinedCost ?? evaluateSupplyChainDesignCombinedScenarioCost;
  const findCompletedRun = dependencies.findCompletedRun ?? findCompletedNetworkScenarioComparisonRunByFingerprint;
  const findActiveRun = dependencies.findActiveRun ?? findActiveNetworkScenarioComparisonRunByFingerprint;
  const createRun = dependencies.createRun ?? createNetworkScenarioComparisonRun;
  const updateRun = dependencies.updateRun ?? updateNetworkScenarioComparisonRunLifecycle;
  const fxInput = normalizeFxInput(input.fxInput ?? null);
  const transportationFingerprint = buildNetworkScenarioTransportationFingerprint({
    inputReferences: input.inputReferences,
    scenarioInputs: input.scenarioInputs,
    ratingAccountId: input.account.id,
    carrierHashes: input.carrierHashes
  });
  const comparisonFingerprint = buildNetworkScenarioComparisonFingerprint({
    transportationFingerprint,
    scenarioInputs: input.scenarioInputs,
    fxInput,
    resultInputs: input.resultInputs ?? {}
  });

  const completed = input.forceNewRun ? null : await findCompletedRun(input.context, input.projectId, comparisonFingerprint);
  if (completed) {
    return {
      phase: "COMPLETE",
      run: completed,
      reusedCompletedRunId: completed.id,
      resumedActiveRunId: null,
      transportationFingerprint,
      comparisonFingerprint,
      scenarioA: { transportationEvaluation: null, combinedCostEvaluation: null, fx: null },
      scenarioB: { transportationEvaluation: null, combinedCostEvaluation: null, fx: null },
      missingRateBatch: null,
      ratingEvidence: completed.ratingEvidence,
      resultSummary: completed.resultSummary
    };
  }

  const active = input.forceNewRun ? null : await findActiveRun(input.context, input.projectId, comparisonFingerprint);
  if (active && !input.comparisonRunId) {
    return {
      phase: active.status,
      run: active,
      reusedCompletedRunId: null,
      resumedActiveRunId: active.id,
      transportationFingerprint,
      comparisonFingerprint,
      scenarioA: { transportationEvaluation: null, combinedCostEvaluation: null, fx: null },
      scenarioB: { transportationEvaluation: null, combinedCostEvaluation: null, fx: null },
      missingRateBatch: null,
      ratingEvidence: active.ratingEvidence,
      resultSummary: active.resultSummary
    };
  }

  let run: NetworkScenarioComparisonRunDetail | null = active && input.comparisonRunId ? active : null;
  try {
    const initialRatingEvidence = buildRatingEvidence("EVALUATING", [], null, input.account.id, input.carrierHashes);
    if (!run) {
      run = await createRun(input.context, {
        projectId: input.projectId,
        status: "EVALUATING",
        scenarioAName: input.scenarioA.scenarioName,
        scenarioBName: input.scenarioB.scenarioName,
        inputReferences: input.inputReferences,
        scenarioInputs: input.scenarioInputs,
        ratingEvidence: initialRatingEvidence,
        fxInput,
        resultSummary: null,
        transportationFingerprint,
        comparisonFingerprint,
        errorMessage: null
      });
    } else {
      run = await updateRun(input.context, input.projectId, run.id, {
        status: "EVALUATING",
        ratingEvidence: initialRatingEvidence,
        fxInput,
        resultSummary: null,
        errorMessage: null
      });
    }

    const scenarioA = await evaluateScenario("A", input.scenarioA, evaluateTransportation);
    const scenarioB = await evaluateScenario("B", input.scenarioB, evaluateTransportation);
    const missingManifest = dedupeComparisonMissingRateManifest([scenarioA, scenarioB]);
    const ratingEvidence = buildRatingEvidence("READY_FOR_COST_EVALUATION", [scenarioA, scenarioB], null, input.account.id, input.carrierHashes);

    if (missingManifest.length > 0) {
      const missingEvidence = buildRatingEvidence("RATES_REQUIRED", [scenarioA, scenarioB], null, input.account.id, input.carrierHashes, missingManifest);
      if (input.finalizeWithMissingRates) {
        const evaluated = evaluateBothCombinedCosts({ scenarioA, scenarioB, fxInput, evaluateCombinedCost });
        const resultSummary = buildResultSummary(evaluated, input.resultInputs ?? {});
        const persisted = await updateRun(input.context, input.projectId, run.id, {
          status: "INCOMPLETE",
          ratingEvidence: missingEvidence,
          fxInput,
          resultSummary,
          errorMessage: null
        });
        return buildReturn("INCOMPLETE", persisted, transportationFingerprint, comparisonFingerprint, scenarioA, scenarioB, null, missingEvidence, resultSummary, evaluated.scenarioA.fx, evaluated.scenarioB.fx, evaluated.scenarioA.combined, evaluated.scenarioB.combined);
      }
      if (input.submitMissingRates === false) {
        run = await updateRun(input.context, input.projectId, run.id, {
          status: "RATES_REQUIRED",
          ratingEvidence: missingEvidence,
          fxInput,
          resultSummary: null,
          errorMessage: null
        });
        return buildReturn("RATES_REQUIRED", run, transportationFingerprint, comparisonFingerprint, scenarioA, scenarioB, null, missingEvidence, null, null, null);
      }

      const batch = await createMissingRateBatch({
        context: input.context,
        projectId: input.projectId,
        scenarioId: `comparison:${run.id}`,
        scenarioName: `${input.scenarioA.scenarioName} vs ${input.scenarioB.scenarioName}`,
        account: input.account,
        carrierHashes: input.carrierHashes,
        missingRateManifest: missingManifest
      });
      const batchEvidence = buildRatingEvidence("RATING", [scenarioA, scenarioB], batch.jobId, input.account.id, input.carrierHashes, missingManifest);
      run = await updateRun(input.context, input.projectId, run.id, {
        status: "RATING",
        ratingEvidence: batchEvidence,
        fxInput,
        resultSummary: null,
        errorMessage: null
      });
      if (batch.shouldProcess) {
        queueMicrotask(() => {
          void processRateBatch(
            { tenantId: input.context.tenantId, userId: input.context.userId },
            batch.jobId,
            batch.account,
            batch.input
          );
        });
      }
      return buildReturn("RATING", run, transportationFingerprint, comparisonFingerprint, scenarioA, scenarioB, {
        jobId: batch.jobId,
        requestCount: batch.input.requests.length,
        shouldProcess: batch.shouldProcess
      }, batchEvidence, null, null, null);
    }

    const evaluated = evaluateBothCombinedCosts({ scenarioA, scenarioB, fxInput, evaluateCombinedCost });
    const resultSummary = buildResultSummary(evaluated, input.resultInputs ?? {});
    const phase = resultSummary.completenessStatus === "COMPLETE" ? "COMPLETE" : "INCOMPLETE";
    const persisted = await updateRun(input.context, input.projectId, run.id, {
      status: phase,
      ratingEvidence,
      fxInput,
      resultSummary,
      errorMessage: null
    });

    return buildReturn(phase, persisted, transportationFingerprint, comparisonFingerprint, scenarioA, scenarioB, null, ratingEvidence, resultSummary, evaluated.scenarioA.fx, evaluated.scenarioB.fx, evaluated.scenarioA.combined, evaluated.scenarioB.combined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network Scenario Comparison orchestration failed.";
    if (run) {
      const failed = await updateRun(input.context, input.projectId, run.id, {
        status: "FAILED",
        ratingEvidence: run.ratingEvidence,
        fxInput,
        resultSummary: null,
        errorMessage: message
      });
      return {
        phase: "FAILED",
        run: failed,
        reusedCompletedRunId: null,
        resumedActiveRunId: null,
        transportationFingerprint,
        comparisonFingerprint,
        scenarioA: { transportationEvaluation: null, combinedCostEvaluation: null, fx: null },
        scenarioB: { transportationEvaluation: null, combinedCostEvaluation: null, fx: null },
        missingRateBatch: null,
        ratingEvidence: failed.ratingEvidence,
        resultSummary: null
      };
    }
    throw new Error(message);
  }
}

export function dedupeComparisonMissingRateManifest(
  scenarios: ScenarioWork[]
): ComparisonMissingRateRequest[] {
  const byFingerprint = new Map<string, ComparisonMissingRateRequest>();
  for (const scenario of scenarios) {
    for (const missing of scenario.transportationEvaluation.missingRateManifest) {
      const existing = byFingerprint.get(missing.laneFingerprint);
      const affected: ComparisonMissingRateRequest["affectedAlternatives"] = missing.affectedAlternatives.map((alternative) => ({
        ...alternative,
        scenarioKey: scenario.scenarioKey,
        scenarioName: scenario.scenarioName
      }));
      if (existing) {
        existing.affectedAlternatives.push(...affected);
      } else {
        byFingerprint.set(missing.laneFingerprint, {
          laneFingerprint: missing.laneFingerprint,
          request: missing.request,
          affectedAlternatives: affected
        });
      }
    }
  }
  return [...byFingerprint.values()]
    .map((missing) => {
      const affectedAlternatives: ComparisonMissingRateRequest["affectedAlternatives"] = [...missing.affectedAlternatives].sort((left, right) =>
        `${left.scenarioKey}:${left.profileKey}:${left.originSourceType}:${left.originFacilityId}`.localeCompare(`${right.scenarioKey}:${right.profileKey}:${right.originSourceType}:${right.originFacilityId}`)
      );
      return { ...missing, affectedAlternatives };
    })
    .sort((left, right) => left.laneFingerprint.localeCompare(right.laneFingerprint));
}

type ComparisonMissingRateRequest = SupplyChainDesignNetworkScenarioMissingRateRequest & {
  affectedAlternatives: Array<SupplyChainDesignNetworkScenarioMissingRateRequest["affectedAlternatives"][number] & {
    scenarioKey: "A" | "B";
    scenarioName: string;
  }>;
};

function validateSharedDemand(input: SupplyChainDesignNetworkScenarioComparisonOrchestrationInput) {
  const sharedFileId = input.inputReferences.historicalShipments.fileId;
  if (input.scenarioInputs.historicalShipments.fileId !== sharedFileId) {
    throw new Error("Network Scenario Comparison requires one shared Historical Shipments source.");
  }
  for (const scenario of [input.scenarioA, input.scenarioB]) {
    if (scenario.transportationInput.shipments.fileId !== sharedFileId) {
      throw new Error("Network Scenario Comparison scenarios must use the same Historical Shipments source.");
    }
    if (scenario.combinedCostInput.selectedFacilities.length === 0) {
      throw new Error(`Network Scenario Comparison ${scenario.scenarioKey} requires at least one selected facility.`);
    }
  }
  if (input.scenarioA.transportationInput.shipments.fileId !== input.scenarioB.transportationInput.shipments.fileId) {
    throw new Error("Network Scenario Comparison Scenario A and Scenario B cannot use different Historical Shipments sources.");
  }
}

async function evaluateScenario(
  scenarioKey: "A" | "B",
  scenario: SupplyChainDesignNetworkScenarioComparisonScenarioOrchestrationInput,
  evaluateTransportation: typeof evaluateSupplyChainDesignNetworkScenario
): Promise<ScenarioWork> {
  const transportationEvaluation = await evaluateTransportation(scenario.transportationInput);
  return { ...scenario, scenarioKey, transportationEvaluation };
}

function evaluateBothCombinedCosts(input: {
  scenarioA: ScenarioWork;
  scenarioB: ScenarioWork;
  fxInput: NetworkScenarioComparisonFxInput | null;
  evaluateCombinedCost: typeof evaluateSupplyChainDesignCombinedScenarioCost;
}) {
  const scenarioA = evaluateCombinedCostWithFx(input.scenarioA, input.fxInput, input.evaluateCombinedCost);
  const scenarioB = evaluateCombinedCostWithFx(input.scenarioB, input.fxInput, input.evaluateCombinedCost);
  const currencies = unique([scenarioA.fx.normalizedCurrency, scenarioB.fx.normalizedCurrency]);
  const requiresCrossScenarioFx = currencies.length > 1;
  if (requiresCrossScenarioFx && !input.fxInput) {
    scenarioA.fx = { ...scenarioA.fx, incompleteReason: "CAD to USD rate is required to compare Scenario A and Scenario B." };
    scenarioB.fx = { ...scenarioB.fx, incompleteReason: "CAD to USD rate is required to compare Scenario A and Scenario B." };
  }
  return { scenarioA, scenarioB };
}

function evaluateCombinedCostWithFx(
  scenario: ScenarioWork,
  fxInput: NetworkScenarioComparisonFxInput | null,
  evaluateCombinedCost: typeof evaluateSupplyChainDesignCombinedScenarioCost
): { combined: SupplyChainDesignCombinedScenarioCostResult; fx: ScenarioFxEvidence } {
  const sourceCurrencies = collectScenarioCurrencies(scenario.combinedCostInput);
  const needsFx = sourceCurrencies.includes("USD") && sourceCurrencies.includes("CAD");
  if (needsFx && !fxInput) {
    const combined = evaluateCombinedCost({
      ...scenario.combinedCostInput,
      transportationEvaluation: scenario.transportationEvaluation
    });
    return {
      combined,
      fx: {
        sourceCurrencies,
        normalizedCurrency: null,
        cadToUsdRate: null,
        fxApplied: false,
        incompleteReason: "CAD to USD rate is required before mixed USD/CAD winner selection."
      }
    };
  }

  if ((needsFx || sourceCurrencies.length === 1 && sourceCurrencies[0] === "CAD" && fxInput) && fxInput) {
    const normalized = normalizeScenarioCostInputToUsd(scenario, fxInput.cadToUsdRate);
    return {
      combined: evaluateCombinedCost(normalized),
      fx: {
        sourceCurrencies,
        normalizedCurrency: "USD",
        cadToUsdRate: fxInput.cadToUsdRate,
        fxApplied: true,
        incompleteReason: null
      }
    };
  }

  const combined = evaluateCombinedCost({
    ...scenario.combinedCostInput,
    transportationEvaluation: scenario.transportationEvaluation
  });
  return {
    combined,
    fx: {
      sourceCurrencies,
      normalizedCurrency: sourceCurrencies[0] ?? null,
      cadToUsdRate: fxInput?.cadToUsdRate ?? null,
      fxApplied: false,
      incompleteReason: null
    }
  };
}

function normalizeScenarioCostInputToUsd(scenario: ScenarioWork, cadToUsdRate: number): SupplyChainDesignCombinedScenarioCostInput {
  const transportationRate = normalizeCurrency(scenario.combinedCostInput.transportationCurrency) === "CAD" ? cadToUsdRate : 1;
  return {
    ...scenario.combinedCostInput,
    transportationCurrency: "USD",
    transportationEvaluation: {
      ...scenario.transportationEvaluation,
      profileAlternatives: scenario.transportationEvaluation.profileAlternatives.map((profile) => ({
        ...profile,
        alternatives: profile.alternatives.map((alternative) => ({
          ...alternative,
          reusedSelectedRate: multiplyNullable(alternative.reusedSelectedRate, transportationRate),
          representedModeledTransportationCost: multiplyNullable(alternative.representedModeledTransportationCost, transportationRate)
        }))
      }))
    },
    selectedFacilities: scenario.combinedCostInput.selectedFacilities.map((facility) => normalizeFacilityCostToUsd(facility, cadToUsdRate))
  };
}

function normalizeFacilityCostToUsd(
  facility: SupplyChainDesignCombinedScenarioFacilityInput,
  cadToUsdRate: number
): SupplyChainDesignCombinedScenarioFacilityInput {
  if (normalizeCurrency(facility.warehouseCost.currency) !== "CAD") return facility;
  if (facility.sourceType === "CURRENT") {
    return {
      ...facility,
      warehouseCost: {
        ...facility.warehouseCost,
        currency: "USD",
        annualFacilityWarehouseCost: multiplyNullable(facility.warehouseCost.annualFacilityWarehouseCost, cadToUsdRate)
      }
    };
  }
  return {
    ...facility,
    warehouseCost: {
      ...facility.warehouseCost,
      currency: "USD",
      annualFacilityWarehouseCost: multiplyNullable(facility.warehouseCost.annualFacilityWarehouseCost, cadToUsdRate),
      annualFixedCost: multiplyNullable(facility.warehouseCost.annualFixedCost, cadToUsdRate),
      inboundFeePerPallet: multiplyNullable(facility.warehouseCost.inboundFeePerPallet, cadToUsdRate),
      outboundFeePerPallet: multiplyNullable(facility.warehouseCost.outboundFeePerPallet, cadToUsdRate),
      storageFeePerPalletPerMonth: multiplyNullable(facility.warehouseCost.storageFeePerPalletPerMonth, cadToUsdRate)
    }
  };
}

function buildResultSummary(input: ReturnType<typeof evaluateBothCombinedCosts>, resultInputs: Record<string, unknown>): NetworkScenarioComparisonResultSummary {
  const scenarioA = buildScenarioSummary(input.scenarioA.combined, input.scenarioA.fx);
  const scenarioB = buildScenarioSummary(input.scenarioB.combined, input.scenarioB.fx);
  const comparable = scenarioA.normalizedTotalNetworkCost !== null && scenarioB.normalizedTotalNetworkCost !== null && !input.scenarioA.fx.incompleteReason && !input.scenarioB.fx.incompleteReason;
  const difference = comparable ? roundCurrency(scenarioB.normalizedTotalNetworkCost! - scenarioA.normalizedTotalNetworkCost!) : null;
  const percentDifference = comparable && scenarioA.normalizedTotalNetworkCost !== 0
    ? roundQuantity((difference! / scenarioA.normalizedTotalNetworkCost!) * 100)
    : null;
  const warnings = unique([
    input.scenarioA.fx.incompleteReason,
    input.scenarioB.fx.incompleteReason,
    input.scenarioA.combined.status === "COMPLETE" ? null : `Scenario A is ${input.scenarioA.combined.status}.`,
    input.scenarioB.combined.status === "COMPLETE" ? null : `Scenario B is ${input.scenarioB.combined.status}.`
  ]);
  return {
    completenessStatus: comparable && input.scenarioA.combined.status === "COMPLETE" && input.scenarioB.combined.status === "COMPLETE" ? "COMPLETE" : "INCOMPLETE",
    scenarioA,
    scenarioB,
    comparison: {
      baselineScenario: "A",
      differenceFormula: "Scenario B total network cost - Scenario A total network cost",
      totalDifference: difference,
      percentDifference,
      lowerCostScenario: comparable
        ? difference! < 0 ? "B" : difference! > 0 ? "A" : "TIE"
        : null
    },
    warnings,
    rateCoverage: {
      scenarioAIncompleteShipments: input.scenarioA.combined.incompleteRepresentedShipments,
      scenarioBIncompleteShipments: input.scenarioB.combined.incompleteRepresentedShipments
    },
    warehouseCostEvidence: {
      sourcePreserved: true,
      resultInputs
    }
  };
}

function buildScenarioSummary(combined: SupplyChainDesignCombinedScenarioCostResult, fx: ScenarioFxEvidence) {
  return {
    scenarioId: combined.scenarioId,
    scenarioName: combined.scenarioName,
    status: combined.status,
    modeledTransportationCost: combined.modeledTransportationCost,
    variableWarehouseCost: combined.variableWarehouseCost,
    annualAllInWarehouseCost: combined.annualAllInWarehouseCost,
    totalWarehouseCost: combined.totalWarehouseCost,
    totalNetworkCost: combined.totalNetworkCost,
    currency: combined.currencies.length === 1 ? combined.currencies[0] : null,
    normalizedTotalNetworkCost: fx.incompleteReason ? null : combined.totalNetworkCost,
    normalizedCurrency: fx.normalizedCurrency,
    sourceCurrencies: fx.sourceCurrencies,
    fxApplied: fx.fxApplied,
    cadToUsdRate: fx.cadToUsdRate,
    incompleteReason: fx.incompleteReason,
    assignedRepresentedShipments: combined.assignedRepresentedShipments,
    incompleteRepresentedShipments: combined.incompleteRepresentedShipments,
    facilityTotals: combined.facilityTotals,
    profileResults: combined.profileResults
  };
}

function buildRatingEvidence(
  phase: string,
  scenarios: ScenarioWork[],
  batchId: string | null,
  ratingAccountId: string,
  carrierHashes: string[],
  missingManifest = dedupeComparisonMissingRateManifest(scenarios)
): NetworkScenarioComparisonRatingEvidence {
  const allAlternatives = scenarios.flatMap((scenario) => scenario.transportationEvaluation.profileAlternatives.flatMap((profile) => profile.alternatives));
  const laneReferences = allAlternatives
    .filter((alternative) => alternative.laneFingerprint)
    .map((alternative) => ({
      exactLaneFingerprint: alternative.laneFingerprint!,
      batchId: alternative.reuseLineage?.sourceBatchId ?? batchId,
      laneId: alternative.reuseLineage?.sourceLaneId ?? null,
      status: alternative.status
    }));
  return {
    phase,
    ratingBatchIds: batchId ? [batchId] : [],
    missingRateCount: missingManifest.length,
    reusedLaneCount: allAlternatives.filter((alternative) => alternative.status === "REUSED").length,
    exactLaneFingerprints: unique([...laneReferences.map((lane) => lane.exactLaneFingerprint), ...missingManifest.map((missing) => missing.laneFingerprint)]),
    laneReferences,
    reconciliation: {
      ratingAccountId,
      carrierHashes,
      scenarioA: scenarios.find((scenario) => scenario.scenarioKey === "A") ? scenarioCounts(scenarios.find((scenario) => scenario.scenarioKey === "A")!) : null,
      scenarioB: scenarios.find((scenario) => scenario.scenarioKey === "B") ? scenarioCounts(scenarios.find((scenario) => scenario.scenarioKey === "B")!) : null,
      totalAlternatives: allAlternatives.length,
      exactReusedAlternatives: allAlternatives.filter((alternative) => alternative.status === "REUSED").length,
      rawMissingAlternatives: allAlternatives.filter((alternative) => alternative.status === "MISSING_RATE").length,
      uniqueMissingLiveRequests: missingManifest.length,
      liveCompleted: allAlternatives.filter((alternative) => alternative.status === "REUSED").length,
      liveRemaining: missingManifest.length,
      failedOrNoRate: 0
    }
  };
}

function scenarioCounts(scenario: ScenarioWork) {
  const alternatives = scenario.transportationEvaluation.profileAlternatives.flatMap((profile) => profile.alternatives);
  const profilesWithComplete = scenario.transportationEvaluation.profileAlternatives.filter((profile) =>
    profile.alternatives.some((alternative) => alternative.status === "REUSED")
  ).length;
  return {
    totalAlternatives: alternatives.length,
    exactReusedAlternatives: alternatives.filter((alternative) => alternative.status === "REUSED").length,
    rawMissingAlternatives: alternatives.filter((alternative) => alternative.status === "MISSING_RATE").length,
    profilesWithCompleteAlternatives: profilesWithComplete,
    profilesWithoutCompleteAlternatives: scenario.transportationEvaluation.profileAlternatives.length - profilesWithComplete
  };
}

function collectScenarioCurrencies(input: Omit<SupplyChainDesignCombinedScenarioCostInput, "transportationEvaluation">) {
  return unique([
    normalizeCurrency(input.transportationCurrency),
    ...input.selectedFacilities.map((facility) => normalizeCurrency(facility.warehouseCost.currency))
  ]);
}

function normalizeFxInput(input: NetworkScenarioComparisonFxInput | null) {
  if (!input) return null;
  if (!Number.isFinite(input.cadToUsdRate) || input.cadToUsdRate <= 0) {
    throw new Error("Network Scenario Comparison CAD to USD rate must be a finite number greater than zero.");
  }
  return { cadToUsdRate: input.cadToUsdRate };
}

function normalizeCurrency(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

function multiplyNullable(value: number | null | undefined, factor: number) {
  return typeof value === "number" && Number.isFinite(value) ? roundCurrency(value * factor) : value ?? null;
}

function buildReturn(
  phase: SupplyChainDesignNetworkScenarioComparisonOrchestrationResult["phase"],
  run: NetworkScenarioComparisonRunDetail,
  transportationFingerprint: string,
  comparisonFingerprint: string,
  scenarioA: ScenarioWork,
  scenarioB: ScenarioWork,
  missingRateBatch: SupplyChainDesignNetworkScenarioComparisonOrchestrationResult["missingRateBatch"],
  ratingEvidence: NetworkScenarioComparisonRatingEvidence,
  resultSummary: NetworkScenarioComparisonResultSummary | null,
  scenarioAFx: ScenarioFxEvidence | null,
  scenarioBFx: ScenarioFxEvidence | null,
  scenarioACombined: SupplyChainDesignCombinedScenarioCostResult | null = null,
  scenarioBCombined: SupplyChainDesignCombinedScenarioCostResult | null = null
) {
  return {
    phase,
    run,
    reusedCompletedRunId: null,
    resumedActiveRunId: null,
    transportationFingerprint,
    comparisonFingerprint,
    scenarioA: {
      transportationEvaluation: scenarioA.transportationEvaluation,
      combinedCostEvaluation: scenarioACombined,
      fx: scenarioAFx
    },
    scenarioB: {
      transportationEvaluation: scenarioB.transportationEvaluation,
      combinedCostEvaluation: scenarioBCombined,
      fx: scenarioBFx
    },
    missingRateBatch,
    ratingEvidence,
    resultSummary
  };
}

function unique(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output.sort();
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000000) / 1000000;
}
