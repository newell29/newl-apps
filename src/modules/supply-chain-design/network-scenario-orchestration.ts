import type { SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";
import type { AuthenticatedContext } from "@/server/tenant-context";
import {
  createSupplyChainDesignScenarioMissingRateBatch,
  runSupplyChainDesignLtlRateBatch
} from "@/modules/supply-chain-design/ltl-rate-batches";
import {
  evaluateSupplyChainDesignNetworkScenario,
  type SupplyChainDesignNetworkScenarioEvaluationResult,
  type SupplyChainDesignNetworkScenarioInput
} from "@/modules/supply-chain-design/network-scenario-evaluation";
import {
  evaluateSupplyChainDesignCombinedScenarioCost,
  type SupplyChainDesignCombinedScenarioCostInput,
  type SupplyChainDesignCombinedScenarioCostResult
} from "@/modules/supply-chain-design/network-scenario-combined-cost";

export type SupplyChainDesignNetworkScenarioOrchestrationPhase =
  | "EVALUATING"
  | "RATES_REQUIRED"
  | "RATING"
  | "READY_FOR_COST_EVALUATION"
  | "COMPLETE"
  | "INCOMPLETE"
  | "FAILED";

export type SupplyChainDesignNetworkScenarioOrchestrationInput = {
  context: AuthenticatedContext;
  projectId: string;
  transportationInput: SupplyChainDesignNetworkScenarioInput;
  combinedCostInput: Omit<SupplyChainDesignCombinedScenarioCostInput, "transportationEvaluation">;
  account: SevenLAccountConfig;
  submitMissingRates?: boolean;
  processCreatedBatch?: boolean;
};

export type SupplyChainDesignNetworkScenarioOrchestrationResult = {
  phase: SupplyChainDesignNetworkScenarioOrchestrationPhase;
  scenarioId: string;
  scenarioName: string;
  transportationEvaluation: SupplyChainDesignNetworkScenarioEvaluationResult;
  combinedCostEvaluation: SupplyChainDesignCombinedScenarioCostResult | null;
  missingRateBatch: {
    jobId: string;
    requestCount: number;
    shouldProcess: boolean;
  } | null;
  lineage: Array<{
    exactLaneFingerprint: string;
    batchId: string | null;
    laneId: string | null;
    affectedAlternatives: SupplyChainDesignNetworkScenarioEvaluationResult["missingRateManifest"][number]["affectedAlternatives"];
  }>;
  counts: {
    totalScenarioAlternatives: number;
    exactReusedAlternatives: number;
    uniqueMissingRequests: number;
    liveRequestsCompleted: number;
    liveRequestsRemaining: number;
    failedOrNoRateRequests: number;
    profilesWithAtLeastOneCompleteAlternative: number;
    profilesWithNoCompleteAlternative: number;
  };
};

type OrchestrationDependencies = {
  evaluateTransportation?: typeof evaluateSupplyChainDesignNetworkScenario;
  createMissingRateBatch?: typeof createSupplyChainDesignScenarioMissingRateBatch;
  runRateBatch?: typeof runSupplyChainDesignLtlRateBatch;
  evaluateCombinedCost?: typeof evaluateSupplyChainDesignCombinedScenarioCost;
};

export async function orchestrateSupplyChainDesignNetworkScenarioMissingRates(
  input: SupplyChainDesignNetworkScenarioOrchestrationInput,
  dependencies: OrchestrationDependencies = {}
): Promise<SupplyChainDesignNetworkScenarioOrchestrationResult> {
  const evaluateTransportation = dependencies.evaluateTransportation ?? evaluateSupplyChainDesignNetworkScenario;
  const createMissingRateBatch = dependencies.createMissingRateBatch ?? createSupplyChainDesignScenarioMissingRateBatch;
  const runRateBatch = dependencies.runRateBatch ?? runSupplyChainDesignLtlRateBatch;
  const evaluateCombinedCost = dependencies.evaluateCombinedCost ?? evaluateSupplyChainDesignCombinedScenarioCost;

  try {
    const transportationEvaluation = await evaluateTransportation(input.transportationInput);
    const uniqueMissingRequests = transportationEvaluation.missingRateManifest.length;
    const totalScenarioAlternatives = transportationEvaluation.profileAlternatives.reduce(
      (total, profile) => total + profile.alternatives.length,
      0
    );
    const exactReusedAlternatives = transportationEvaluation.profileAlternatives.reduce(
      (total, profile) => total + profile.alternatives.filter((alternative) => alternative.status === "REUSED").length,
      0
    );

    if (uniqueMissingRequests > 0) {
      if (input.submitMissingRates === false) {
        return buildResult({
          phase: "RATES_REQUIRED",
          input,
          transportationEvaluation,
          combinedCostEvaluation: null,
          missingRateBatch: null,
          lineageBatchId: null,
          liveRequestsCompleted: 0,
          failedOrNoRateRequests: 0,
          totalScenarioAlternatives,
          exactReusedAlternatives
        });
      }

      const batch = await createMissingRateBatch({
        context: input.context,
        projectId: input.projectId,
        scenarioId: input.transportationInput.scenarioId,
        scenarioName: input.transportationInput.scenarioName,
        account: input.account,
        carrierHashes: input.transportationInput.ratingConfig.carrierHashes,
        missingRateManifest: transportationEvaluation.missingRateManifest
      });

      if (input.processCreatedBatch && batch.shouldProcess) {
        await runRateBatch(input.context, batch.jobId, batch.account, batch.input);
      }

      return buildResult({
        phase: "RATING",
        input,
        transportationEvaluation,
        combinedCostEvaluation: null,
        missingRateBatch: {
          jobId: batch.jobId,
          requestCount: batch.input.requests.length,
          shouldProcess: batch.shouldProcess
        },
        lineageBatchId: batch.jobId,
        liveRequestsCompleted: 0,
        failedOrNoRateRequests: 0,
        totalScenarioAlternatives,
        exactReusedAlternatives
      });
    }

    const combinedCostEvaluation = evaluateCombinedCost({
      ...input.combinedCostInput,
      transportationEvaluation
    });
    return buildResult({
      phase: combinedCostEvaluation.status === "COMPLETE" ? "COMPLETE" : "INCOMPLETE",
      input,
      transportationEvaluation,
      combinedCostEvaluation,
      missingRateBatch: null,
      lineageBatchId: null,
      liveRequestsCompleted: 0,
      failedOrNoRateRequests: 0,
      totalScenarioAlternatives,
      exactReusedAlternatives
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error("Network scenario orchestration failed.");
  }
}

function buildResult(input: {
  phase: SupplyChainDesignNetworkScenarioOrchestrationPhase;
  input: SupplyChainDesignNetworkScenarioOrchestrationInput;
  transportationEvaluation: SupplyChainDesignNetworkScenarioEvaluationResult;
  combinedCostEvaluation: SupplyChainDesignCombinedScenarioCostResult | null;
  missingRateBatch: SupplyChainDesignNetworkScenarioOrchestrationResult["missingRateBatch"];
  lineageBatchId: string | null;
  liveRequestsCompleted: number;
  failedOrNoRateRequests: number;
  totalScenarioAlternatives: number;
  exactReusedAlternatives: number;
}): SupplyChainDesignNetworkScenarioOrchestrationResult {
  const profilesWithAtLeastOneCompleteAlternative = input.combinedCostEvaluation
    ? input.combinedCostEvaluation.profileResults.filter((profile) => profile.winnerFacilityId).length
    : 0;
  const profilesWithNoCompleteAlternative = input.combinedCostEvaluation
    ? input.combinedCostEvaluation.profileResults.filter((profile) => !profile.winnerFacilityId).length
    : input.transportationEvaluation.profileAlternatives.length;

  return {
    phase: input.phase,
    scenarioId: input.input.transportationInput.scenarioId,
    scenarioName: input.input.transportationInput.scenarioName,
    transportationEvaluation: input.transportationEvaluation,
    combinedCostEvaluation: input.combinedCostEvaluation,
    missingRateBatch: input.missingRateBatch,
    lineage: input.transportationEvaluation.missingRateManifest.map((missing) => ({
      exactLaneFingerprint: missing.laneFingerprint,
      batchId: input.lineageBatchId,
      laneId: null,
      affectedAlternatives: missing.affectedAlternatives
    })),
    counts: {
      totalScenarioAlternatives: input.totalScenarioAlternatives,
      exactReusedAlternatives: input.exactReusedAlternatives,
      uniqueMissingRequests: input.transportationEvaluation.missingRateManifest.length,
      liveRequestsCompleted: input.liveRequestsCompleted,
      liveRequestsRemaining: input.transportationEvaluation.missingRateManifest.length - input.liveRequestsCompleted,
      failedOrNoRateRequests: input.failedOrNoRateRequests,
      profilesWithAtLeastOneCompleteAlternative,
      profilesWithNoCompleteAlternative
    }
  };
}
