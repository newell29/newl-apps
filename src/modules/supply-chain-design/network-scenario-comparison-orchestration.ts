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
  forceFreshRates?: boolean;
  completedRateBatchIds?: string[];
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

  const completed = input.forceNewRun || input.forceFreshRates ? null : await findCompletedRun(input.context, input.projectId, comparisonFingerprint);
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

  const activeCandidate = input.forceNewRun ? null : await findActiveRun(input.context, input.projectId, comparisonFingerprint);
  const active = input.forceFreshRates && activeCandidate?.ratingEvidence.reconciliation.forceFreshRates !== true ? null : activeCandidate;
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
    const initialRatingEvidence = buildRatingEvidence("EVALUATING", [], null, input.account.id, input.carrierHashes, undefined, input.forceFreshRates === true);
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

    const scenarioA = await evaluateScenario("A", input.scenarioA, evaluateTransportation, input.forceFreshRates === true, input.completedRateBatchIds);
    const scenarioB = await evaluateScenario("B", input.scenarioB, evaluateTransportation, input.forceFreshRates === true, input.completedRateBatchIds);
    const missingManifest = dedupeComparisonMissingRateManifest([scenarioA, scenarioB]);
    const ratingEvidence = buildRatingEvidence("READY_FOR_COST_EVALUATION", [scenarioA, scenarioB], null, input.account.id, input.carrierHashes, undefined, input.forceFreshRates === true, input.completedRateBatchIds);

    if (missingManifest.length > 0) {
      const missingEvidence = buildRatingEvidence("RATES_REQUIRED", [scenarioA, scenarioB], null, input.account.id, input.carrierHashes, missingManifest, input.forceFreshRates === true, input.completedRateBatchIds);
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
        forceFreshRates: input.forceFreshRates === true,
        missingRateManifest: missingManifest
      });
      const batchEvidence = buildRatingEvidence("RATING", [scenarioA, scenarioB], batch.jobId, input.account.id, input.carrierHashes, missingManifest, input.forceFreshRates === true, input.completedRateBatchIds);
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
  evaluateTransportation: typeof evaluateSupplyChainDesignNetworkScenario,
  forceFreshRates: boolean,
  completedRateBatchIds: string[] | undefined
): Promise<ScenarioWork> {
  const transportationEvaluation = await evaluateTransportation({
    ...scenario.transportationInput,
    bypassExactReuse: forceFreshRates,
    completedRateBatchIds
  });
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
  const missingCurrency = missingScenarioMonetaryCurrency(scenario.combinedCostInput);
  if (missingCurrency) return {
    combined: evaluateCombinedCost({ ...scenario.combinedCostInput, transportationEvaluation: scenario.transportationEvaluation }),
    fx: { sourceCurrencies, normalizedCurrency: null, cadToUsdRate: fxInput?.cadToUsdRate ?? null, fxApplied: false, incompleteReason: `${missingCurrency} currency is required before scenario comparison.` }
  };
  const unsupportedCurrency = sourceCurrencies.find((currency) => currency !== "USD" && currency !== "CAD");
  if (unsupportedCurrency) return {
    combined: evaluateCombinedCost({ ...scenario.combinedCostInput, transportationEvaluation: scenario.transportationEvaluation }),
    fx: { sourceCurrencies, normalizedCurrency: null, cadToUsdRate: fxInput?.cadToUsdRate ?? null, fxApplied: false, incompleteReason: `Unsupported scenario currency: ${unsupportedCurrency}. Use USD or CAD.` }
  };
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

  const targetCurrency = fxInput?.analysisCurrency ?? (sourceCurrencies[0] === "CAD" ? "CAD" : "USD");
  const hasAmountSpecificCurrency = scenario.combinedCostInput.selectedFacilities.some((facility) => Object.entries(facility.warehouseCost).some(([key, value]) => key.endsWith("Currency") && typeof value === "string" && value.trim()));
  const needsTargetNormalization = Boolean(fxInput) && sourceCurrencies.some((currency) => currency && currency !== targetCurrency);
  if (needsFx || needsTargetNormalization || hasAmountSpecificCurrency) {
    const normalized = normalizeScenarioCostInputToCurrency(scenario, fxInput?.cadToUsdRate ?? 1, targetCurrency);
    return {
      combined: evaluateCombinedCost(normalized),
      fx: {
        sourceCurrencies,
        normalizedCurrency: targetCurrency,
        cadToUsdRate: fxInput?.cadToUsdRate ?? null,
        fxApplied: needsFx || needsTargetNormalization,
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

function normalizeScenarioCostInputToCurrency(
  scenario: ScenarioWork,
  cadToUsdRate: number,
  analysisCurrency: "USD" | "CAD"
): SupplyChainDesignCombinedScenarioCostInput {
  const transportationRate = conversionFactor(normalizeCurrency(scenario.combinedCostInput.transportationCurrency), analysisCurrency, cadToUsdRate);
  return {
    ...scenario.combinedCostInput,
    transportationCurrency: analysisCurrency,
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
    selectedFacilities: scenario.combinedCostInput.selectedFacilities.map((facility) => normalizeFacilityCostToCurrency(facility, cadToUsdRate, analysisCurrency))
  };
}

function normalizeFacilityCostToCurrency(
  facility: SupplyChainDesignCombinedScenarioFacilityInput,
  cadToUsdRate: number,
  analysisCurrency: "USD" | "CAD"
): SupplyChainDesignCombinedScenarioFacilityInput {
  const aggregateCurrency = normalizeCurrency(facility.warehouseCost.currency);
  if (facility.sourceType === "CURRENT") {
    const annualCurrency = normalizeCurrency(facility.warehouseCost.annualFacilityWarehouseCostCurrency) ?? aggregateCurrency;
    const annualFactor = conversionFactor(annualCurrency, analysisCurrency, cadToUsdRate);
    if (annualFactor === 1 && aggregateCurrency === analysisCurrency) return facility;
    return {
      ...facility,
      warehouseCost: {
        ...facility.warehouseCost,
        currency: analysisCurrency,
        annualFacilityWarehouseCost: multiplyNullable(facility.warehouseCost.annualFacilityWarehouseCost, annualFactor)
      }
    };
  }
  const annualFacilityCurrency = normalizeCurrency(facility.warehouseCost.annualFacilityWarehouseCostCurrency) ?? aggregateCurrency;
  const annualFixedCurrency = normalizeCurrency(facility.warehouseCost.annualFixedCostCurrency) ?? aggregateCurrency;
  const inboundCurrency = normalizeCurrency(facility.warehouseCost.inboundFeePerPalletCurrency) ?? aggregateCurrency;
  const outboundCurrency = normalizeCurrency(facility.warehouseCost.outboundFeePerPalletCurrency) ?? aggregateCurrency;
  const storageCurrency = normalizeCurrency(facility.warehouseCost.storageFeePerPalletPerMonthCurrency) ?? aggregateCurrency;
  const annualFacilityFactor = conversionFactor(annualFacilityCurrency, analysisCurrency, cadToUsdRate);
  const annualFixedFactor = conversionFactor(annualFixedCurrency, analysisCurrency, cadToUsdRate);
  const inboundFactor = conversionFactor(inboundCurrency, analysisCurrency, cadToUsdRate);
  const outboundFactor = conversionFactor(outboundCurrency, analysisCurrency, cadToUsdRate);
  const storageFactor = conversionFactor(storageCurrency, analysisCurrency, cadToUsdRate);
  return {
    ...facility,
    warehouseCost: {
      ...facility.warehouseCost,
      currency: analysisCurrency,
      annualFacilityWarehouseCostCurrency: analysisCurrency,
      annualFixedCostCurrency: analysisCurrency,
      inboundFeePerPalletCurrency: analysisCurrency,
      outboundFeePerPalletCurrency: analysisCurrency,
      storageFeePerPalletPerMonthCurrency: analysisCurrency,
      annualFacilityWarehouseCost: multiplyNullable(facility.warehouseCost.annualFacilityWarehouseCost, annualFacilityFactor),
      annualFixedCost: multiplyNullable(facility.warehouseCost.annualFixedCost, annualFixedFactor),
      inboundFeePerPallet: multiplyNullable(facility.warehouseCost.inboundFeePerPallet, inboundFactor),
      outboundFeePerPallet: multiplyNullable(facility.warehouseCost.outboundFeePerPallet, outboundFactor),
      storageFeePerPalletPerMonth: multiplyNullable(facility.warehouseCost.storageFeePerPalletPerMonth, storageFactor)
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
  missingManifest = dedupeComparisonMissingRateManifest(scenarios),
  forceFreshRates = false,
  retainedBatchIds: string[] = []
): NetworkScenarioComparisonRatingEvidence {
  const allAlternatives = scenarios.flatMap((scenario) => scenario.transportationEvaluation.profileAlternatives.flatMap((profile) => profile.alternatives));
  const ratingBatchIds = unique([...(batchId ? [batchId] : []), ...retainedBatchIds]);
  const exactReusedAlternatives = allAlternatives.filter((alternative) => alternative.status === "REUSED").length;
  const newLiveAlternatives = allAlternatives.filter((alternative) => alternative.status === "LIVE_RATE").length;
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
    ratingBatchIds,
    missingRateCount: missingManifest.length,
    reusedLaneCount: exactReusedAlternatives,
    exactLaneFingerprints: unique([...laneReferences.map((lane) => lane.exactLaneFingerprint), ...missingManifest.map((missing) => missing.laneFingerprint)]),
    laneReferences,
    reconciliation: {
      ratingAccountId,
      carrierHashes,
      forceFreshRates,
      scenarioA: scenarios.find((scenario) => scenario.scenarioKey === "A") ? scenarioCounts(scenarios.find((scenario) => scenario.scenarioKey === "A")!) : null,
      scenarioB: scenarios.find((scenario) => scenario.scenarioKey === "B") ? scenarioCounts(scenarios.find((scenario) => scenario.scenarioKey === "B")!) : null,
      totalAlternatives: allAlternatives.length,
      exactReusedAlternatives,
      newLiveAlternatives,
      rawMissingAlternatives: allAlternatives.filter((alternative) => alternative.status === "MISSING_RATE").length,
      uniqueMissingLiveRequests: missingManifest.length,
      liveCompleted: newLiveAlternatives,
      liveRemaining: missingManifest.length,
      failedOrNoRate: 0
    }
  };
}

function scenarioCounts(scenario: ScenarioWork) {
  const alternatives = scenario.transportationEvaluation.profileAlternatives.flatMap((profile) => profile.alternatives);
  const profilesWithComplete = scenario.transportationEvaluation.profileAlternatives.filter((profile) =>
    profile.alternatives.some((alternative) => isCompletedRateStatus(alternative.status))
  ).length;
  return {
    totalAlternatives: alternatives.length,
    exactReusedAlternatives: alternatives.filter((alternative) => alternative.status === "REUSED").length,
    newLiveAlternatives: alternatives.filter((alternative) => alternative.status === "LIVE_RATE").length,
    rawMissingAlternatives: alternatives.filter((alternative) => alternative.status === "MISSING_RATE").length,
    profilesWithCompleteAlternatives: profilesWithComplete,
    profilesWithoutCompleteAlternatives: scenario.transportationEvaluation.profileAlternatives.length - profilesWithComplete
  };
}

function isCompletedRateStatus(status: string) {
  return status === "REUSED" || status === "LIVE_RATE";
}

function collectScenarioCurrencies(input: Omit<SupplyChainDesignCombinedScenarioCostInput, "transportationEvaluation">) {
  return unique([
    normalizeCurrency(input.transportationCurrency),
    ...input.selectedFacilities.flatMap((facility) => {
      if (facility.sourceType === "CURRENT") {
        return [currencyForAmount(facility.warehouseCost.annualFacilityWarehouseCost, facility.warehouseCost.annualFacilityWarehouseCostCurrency, normalizeCurrency(facility.warehouseCost.currency))];
      }
      const aggregateCurrency = normalizeCurrency(facility.warehouseCost.currency);
      return [
        currencyForAmount(facility.warehouseCost.annualFacilityWarehouseCost, facility.warehouseCost.annualFacilityWarehouseCostCurrency, aggregateCurrency),
        currencyForAmount(facility.warehouseCost.annualFixedCost, facility.warehouseCost.annualFixedCostCurrency, aggregateCurrency),
        currencyForAmount(facility.warehouseCost.inboundFeePerPallet, facility.warehouseCost.inboundFeePerPalletCurrency, aggregateCurrency),
        currencyForAmount(facility.warehouseCost.outboundFeePerPallet, facility.warehouseCost.outboundFeePerPalletCurrency, aggregateCurrency),
        currencyForAmount(facility.warehouseCost.storageFeePerPalletPerMonth, facility.warehouseCost.storageFeePerPalletPerMonthCurrency, aggregateCurrency)
      ];
    })
  ]);
}

function currencyForAmount(amount: number | null | undefined, currency: string | null | undefined, fallbackCurrency: string | null) {
  return typeof amount === "number" && Number.isFinite(amount)
    ? normalizeCurrency(currency) ?? fallbackCurrency
    : null;
}

function normalizeFxInput(input: NetworkScenarioComparisonFxInput | null): NetworkScenarioComparisonFxInput | null {
  if (!input) return null;
  if (!Number.isFinite(input.cadToUsdRate) || input.cadToUsdRate <= 0) {
    throw new Error("Network Scenario Comparison CAD to USD rate must be a finite number greater than zero.");
  }
  const analysisCurrency: "USD" | "CAD" = input.analysisCurrency === "CAD" ? "CAD" : "USD";
  return { cadToUsdRate: input.cadToUsdRate, analysisCurrency };
}

function normalizeCurrency(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

function multiplyNullable(value: number | null | undefined, factor: number) {
  return typeof value === "number" && Number.isFinite(value) ? roundCurrency(value * factor) : value ?? null;
}

function conversionFactor(sourceCurrency: string | null, analysisCurrency: "USD" | "CAD", cadToUsdRate: number) {
  if (!sourceCurrency || sourceCurrency === analysisCurrency) return 1;
  if (sourceCurrency === "CAD" && analysisCurrency === "USD") return cadToUsdRate;
  if (sourceCurrency === "USD" && analysisCurrency === "CAD") return 1 / cadToUsdRate;
  throw new Error(`Unsupported scenario currency: ${sourceCurrency}. Use USD or CAD.`);
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


function missingScenarioMonetaryCurrency(input: Omit<SupplyChainDesignCombinedScenarioCostInput, "transportationEvaluation">) {
  for (const facility of input.selectedFacilities) {
    const cost = facility.warehouseCost;
    const aggregate = normalizeCurrency(cost.currency);
    const fields = cost.facilitySourceType === "CURRENT"
      ? [[cost.annualFacilityWarehouseCost, cost.annualFacilityWarehouseCostCurrency ?? aggregate, "annual warehouse cost"]] as const
      : typeof cost.annualFacilityWarehouseCost === "number" || typeof cost.annualFixedCost === "number"
        ? [[cost.annualFacilityWarehouseCost ?? cost.annualFixedCost, cost.annualFacilityWarehouseCost != null ? cost.annualFacilityWarehouseCostCurrency ?? aggregate : cost.annualFixedCostCurrency ?? aggregate, "annual warehouse cost"]] as const
        : [[cost.inboundFeePerPallet, cost.inboundFeePerPalletCurrency ?? aggregate, "inbound fee"], [cost.outboundFeePerPallet, cost.outboundFeePerPalletCurrency ?? aggregate, "outbound fee"], [cost.storageFeePerPalletPerMonth, cost.storageFeePerPalletPerMonthCurrency ?? aggregate, "storage fee"]] as const;
    for (const [amount, currency, label] of fields) {
      if (typeof amount === "number" && Number.isFinite(amount) && !normalizeCurrency(currency)) return `${facility.facilityId} ${label}`;
    }
  }
  return null;
}
