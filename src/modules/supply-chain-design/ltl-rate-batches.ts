import { createHash } from "node:crypto";

import { JobStatus, Prisma, SupplyChainDesignModelRunStatus } from "@prisma/client";

import {
  SCDS_LTL_RATE_PREPARATION_RESULT_VERSION,
  type SupplyChainDesignLtlPreparedRequest,
  type SupplyChainDesignLtlRatePreparationResultSummary
} from "@/modules/supply-chain-design/candidate-ltl-rate-preparation";
import { pickPreferredLiveSevenLAccount } from "@/modules/ltl-rate-portal/account-selection";
import { LTL_BULK_CHUNK_SIZE } from "@/modules/ltl-rate-portal/bulk-jobs";
import { getLtlRatePortalAccounts } from "@/modules/ltl-rate-portal/queries";
import { preflightSevenLQuoteRequest } from "@/modules/ltl-rate-portal/request-preflight";
import type {
  LtlCarrierErrorResult,
  LtlQuoteRequest,
  LtlQuoteResult,
  SevenLAccountConfig
} from "@/modules/ltl-rate-portal/types";
import { getLtlQuotes, type SevenLLocationCache } from "@/server/integrations/seven-l";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const SCDS_LTL_RATE_BATCH_JOB_TYPE = "supply-chain-design.candidate-ltl-rate-batch";
export const SCDS_LTL_EXACT_LANE_FINGERPRINT_VERSION = "SCDS_LTL_EXACT_LANE_V1";
const DEFAULT_SCDS_LTL_LANE_CONCURRENCY = 2;
const DEFAULT_SCDS_LTL_CARRIER_CONCURRENCY = 3;
const DEFAULT_SCDS_LTL_REQUEST_TIMEOUT_MS = 45_000;
const MAX_SCDS_LTL_LANE_CONCURRENCY = 5;
const MAX_SCDS_LTL_CARRIER_CONCURRENCY = 8;
const MAX_SCDS_LTL_REQUEST_TIMEOUT_MS = 120_000;

export type SupplyChainDesignLtlRateBatchSummary = {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  preparationRunId: string;
  preparationCreatedAt: string | null;
  requestsSubmitted: number;
  processedRequests: number;
  ratedSuccessfully: number;
  issueRequests: number;
  missingData: number;
  noRateReturned: number;
  sevenLErrors: number;
  manuallyRated: number;
  excluded: number;
  sourceRowCounts: {
    historicalRowsReviewed: number;
    ltlRowsReviewed: number;
    shipmentsRepresented: number;
    rateRequestsCompleted: number;
    incompleteLtlRowsExcluded: number;
    nonLtlRowsExcluded: number;
    unratedRateRequests: number;
  };
  historicalShipmentVolumeCovered: number;
  unratedRepresentedShipments: number;
  accountName: string;
  lanes: SupplyChainDesignLtlRateBatchLaneSummary[];
  candidateComparisons: SupplyChainDesignCandidateComparisonSummary[];
  coverage: {
    historicalLtlRowsReviewed: number;
    validLtlRowsRated: number;
    unratedRequests: number;
    currentRepresentedWarehouseCost: number;
    coveredShipments: number;
    coveredHistoricalTransportationCost: number;
    excludedShipmentCount: number;
    excludedHistoricalTransportationCost: number;
    shipmentCoveragePercent: number;
    historicalCostCoveragePercent: number;
  };
  savedInputSelection?: {
    selectedCandidateFacilityIds: string[];
  };
};

export type SupplyChainDesignLtlRateBatchLaneSummary = {
  rateRequestKey: string;
  candidateFacilityId: string;
  candidateFacilityName: string;
  originalFacilityId: string;
  destination: string;
  sourceReference: string;
  recordType: string;
  representedShipments: number;
  currentTransportationCost: number | null;
  currentTransportationCostPerShipment: number | null;
  representativePallets: number | null;
  representativeWeight: number | null;
  weightUnit: string | null;
  dimensions: string;
  dimensionUnit: string | null;
  freightClass: string | null;
  request: LtlQuoteRequest;
  quotes: LtlQuoteResult[];
  errors: LtlCarrierErrorResult[];
  selectedQuote: LtlQuoteResult | null;
  selectedRateSource: "7L selected rate" | "Manual rate" | "Excluded" | "None";
  manualRate: ManualRateEvidence | null;
  exclusion: ExclusionEvidence | null;
  status: "Rated" | "Manual" | "No rate returned" | "7L error" | "Excluded" | "Pending";
  issue: string | null;
  estimatedTotalTransportationCost: number | null;
};

export type SupplyChainDesignCandidateComparisonSummary = {
  candidateFacilityId: string;
  candidateFacilityName: string;
  comparedCurrentFacilityIds: string[];
  scenarioType: "Replace" | "Supplement";
  coveredShipments: number;
  currentCoveredLtlCost: number;
  candidateLtlCost: number;
  transportationDifference: number;
  currentWarehouseCost: number;
  retainedCurrentWarehouseCost: number;
  candidateWarehouseCost: number;
  currentCoveredNetworkCost: number;
  proposedCoveredNetworkCost: number;
  totalEstimatedDifference: number;
  percentageChange: number | null;
  coveragePercentage: number;
  warning: string | null;
};

type ManualRateEvidence = {
  totalRate: number;
  reason: string;
  createdByUserId: string | null;
  createdAt: string;
};

type ExclusionEvidence = {
  reason: string;
  createdByUserId: string | null;
  createdAt: string;
};

type ReusedLaneQuoteEvidence = LtlQuoteResult & {
  scdsReuseLineage?: {
    sourceLaneId: string;
    sourceBatchId: string;
    exactLaneFingerprint: string;
    reusedAt: string;
  };
};

export type ScdsLtlBatchInput = {
  source: "SUPPLY_CHAIN_DESIGN";
  projectId: string;
  preparationRunId: string;
  preparationCreatedAt: string | null;
  accountId: string;
  accountName: string;
  carrierHashes: string[];
  comparisonSetup: SupplyChainDesignLtlComparisonSetup;
  preparationSummary?: {
    historicalRowsReviewed: number;
    readyRequestCount: number;
    missingDataRequestCount: number;
    excludedNonLtlRowCount: number;
  };
  requests: Array<{
    rateRequestKey: string;
    candidateFacilityId: string;
    candidateFacilityName: string;
    originalFacilityId: string;
    sourceReference: string;
    recordType: string;
    representedShipments: number;
    currentTransportationCost: number | null;
    currentTransportationCostPerShipment: number | null;
    representativePallets: number | null;
    representativeWeight: number | null;
    weightUnit: string | null;
    dimensions: string;
    dimensionUnit: string | null;
    freightClass: string | null;
    sourceRowIds: string[];
    request: LtlQuoteRequest;
      scenarioLineage?: {
        scenarioId: string;
        scenarioName?: string;
        scenarioKey?: "A" | "B";
        comparisonRunId?: string;
        originFacilityId: string;
        originSourceType: "CURRENT" | "CANDIDATE";
        exactLaneFingerprint: string;
        affectedAlternatives: Array<{
          scenarioKey?: "A" | "B";
          scenarioName?: string;
          profileKey: string;
          sourceReference: string;
          originFacilityId: string;
          originSourceType: "CURRENT" | "CANDIDATE";
        representedShipments: number;
      }>;
    };
  }>;
};

export type SupplyChainDesignLtlComparisonSetup = {
  scenarioSelections: Array<{
    candidateFacilityId: string;
    scenarioType: "REPLACE" | "SUPPLEMENT";
    comparedCurrentFacilityIds: string[];
  }>;
  currentFacilities: Array<{
    facilityId: string;
    facilityName: string;
    annualFacilityCost: number;
  }>;
  candidateFacilities: Array<{
    facilityId: string;
    facilityName: string;
    annualFixedCost: number;
  }>;
};

export async function createSupplyChainDesignScenarioMissingRateBatch(input: {
  context: AuthenticatedContext;
  projectId: string;
  scenarioId: string;
  scenarioName: string;
  account: SevenLAccountConfig;
  carrierHashes: string[];
  missingRateManifest: Array<{
    laneFingerprint: string;
    request: LtlQuoteRequest;
    affectedAlternatives: Array<{
      scenarioKey?: "A" | "B";
      scenarioName?: string;
      profileKey: string;
      sourceReference: string;
      originFacilityId: string;
      originSourceType: "CURRENT" | "CANDIDATE";
      representedShipments: number;
    }>;
  }>;
}) {
  const project = await prisma.supplyChainDesignProject.findUnique({
    where: {
      tenantId_id: {
        tenantId: input.context.tenantId,
        id: input.projectId
      }
    }
  });
  if (!project) {
    throw new Error("Supply Chain Design project was not found.");
  }

  const requests = input.missingRateManifest
    .slice()
    .sort((left, right) => left.laneFingerprint.localeCompare(right.laneFingerprint))
    .map((missing) => {
      const first = missing.affectedAlternatives[0];
      return {
        rateRequestKey: missing.laneFingerprint,
        candidateFacilityId: first?.originFacilityId ?? "UNKNOWN",
        candidateFacilityName: first ? `${first.originSourceType} ${first.originFacilityId}` : "Unknown scenario origin",
        originalFacilityId: first?.originFacilityId ?? "",
        sourceReference: missing.affectedAlternatives.map((alternative) => alternative.sourceReference).filter(Boolean).join(", "),
        recordType: "Scenario Missing Rate",
        representedShipments: missing.affectedAlternatives.reduce((total, alternative) => total + alternative.representedShipments, 0),
        currentTransportationCost: null,
        currentTransportationCostPerShipment: null,
        representativePallets: null,
        representativeWeight: null,
        weightUnit: null,
        dimensions: "",
        dimensionUnit: null,
        freightClass: missing.request.pieces[0]?.freightClass ?? null,
        sourceRowIds: missing.affectedAlternatives.map((alternative) => alternative.profileKey),
        request: {
          ...missing.request,
          customerReference: missing.laneFingerprint
        },
        scenarioLineage: {
          scenarioId: input.scenarioId,
          scenarioName: input.scenarioName,
          scenarioKey: first?.scenarioKey,
          comparisonRunId: input.scenarioId.startsWith("comparison:") ? input.scenarioId.slice("comparison:".length) : undefined,
          originFacilityId: first?.originFacilityId ?? "UNKNOWN",
          originSourceType: first?.originSourceType ?? "CANDIDATE",
          exactLaneFingerprint: missing.laneFingerprint,
          affectedAlternatives: missing.affectedAlternatives
        }
      };
    });

  const batchInput: ScdsLtlBatchInput = {
    source: "SUPPLY_CHAIN_DESIGN",
    projectId: input.projectId,
    preparationRunId: `scenario:${input.scenarioId}`,
    preparationCreatedAt: null,
    accountId: input.account.id,
    accountName: input.account.name,
    carrierHashes: input.carrierHashes,
    comparisonSetup: {
      scenarioSelections: [],
      currentFacilities: [],
      candidateFacilities: []
    },
    preparationSummary: {
      historicalRowsReviewed: 0,
      readyRequestCount: requests.length,
      missingDataRequestCount: 0,
      excludedNonLtlRowCount: 0
    },
    requests
  };

  const output = buildOutput(batchInput, {
    processedLanes: 0,
    quotedLanes: 0,
    issueLanes: 0,
    quoteCount: 0,
    errorCount: 0
  });
  const jobRun = await prisma.automationJobRun.create({
    data: {
      tenantId: input.context.tenantId,
      jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE,
      status: JobStatus.QUEUED,
      input: batchInput,
      output
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: input.context.tenantId,
      actorUserId: input.context.userId,
      action: "supply-chain-design.network-scenario-rate-batch.queued",
      entityType: "AutomationJobRun",
      entityId: jobRun.id,
      after: {
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        requestCount: requests.length,
        accountName: input.account.name
      }
    }
  });

  return {
    jobId: jobRun.id,
    account: input.account,
    input: batchInput,
    shouldProcess: requests.length > 0
  };
}

export async function createSupplyChainDesignLtlRateBatch(
  context: AuthenticatedContext,
  projectId: string,
  preparationRunId: string,
  comparisonSetup: SupplyChainDesignLtlComparisonSetup
) {
  const [project, account] = await Promise.all([
    prisma.supplyChainDesignProject.findUnique({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: projectId
        }
      },
      include: {
        ltlRatePreparationRuns: {
          where: {
            id: preparationRunId
          },
          take: 1
        }
      }
    }),
    getDefaultSevenLAccount(context)
  ]);

  if (!project) {
    throw new Error("Supply Chain Design project was not found.");
  }
  const preparation = project.ltlRatePreparationRuns[0] ?? null;
  if (!preparation || preparation.status !== SupplyChainDesignModelRunStatus.SUCCESS) {
    throw new Error("Select a successful reviewed preparation run before requesting 7L rates.");
  }
  if (!account) {
    throw new Error("The configured live 7L account is not available.");
  }

  const result = preparation.resultSummary as unknown as SupplyChainDesignLtlRatePreparationResultSummary | null;
  if (result?.resultVersion !== SCDS_LTL_RATE_PREPARATION_RESULT_VERSION) {
    throw new Error("Selected LTL preparation is incompatible with the current candidate selection.");
  }
  const selectedCandidateIds = new Set(comparisonSetup.candidateFacilities.map((candidate) => candidate.facilityId));
  const readyRequests = (result?.preparedRequests ?? [])
    .filter((request) => request.preparationStatus === "Ready for rating" && request.normalizedRequest)
    .filter((request) => selectedCandidateIds.size === 0 || selectedCandidateIds.has(request.candidateFacilityId))
    .sort(comparePreparedRequests);
  const preparedCandidateIds = new Set(readyRequests.map((request) => request.candidateFacilityId));
  const missingSelectedCandidateIds = [...selectedCandidateIds].filter((candidateId) => !preparedCandidateIds.has(candidateId));
  if (missingSelectedCandidateIds.length > 0) {
    throw new Error("Selected LTL preparation is incompatible with the current candidate selection.");
  }

  if (readyRequests.length === 0) {
    throw new Error("No prepared LTL shipments are ready for 7L rating.");
  }

  const carrierHashes = account.carriers.filter((carrier) => carrier.enabled).map((carrier) => carrier.carrierHash);
  const input: ScdsLtlBatchInput = {
    source: "SUPPLY_CHAIN_DESIGN",
    projectId,
    preparationRunId,
    preparationCreatedAt: preparation.createdAt.toISOString(),
    accountId: account.id,
    accountName: account.name,
    carrierHashes,
    comparisonSetup,
    preparationSummary: {
      historicalRowsReviewed: result.historicalRowsReviewed,
      readyRequestCount: result.readyRequestCount,
      missingDataRequestCount: result.missingDataRequestCount,
      excludedNonLtlRowCount: result.excludedNonLtlRowCount
    },
    requests: readyRequests.map((request) => ({
      rateRequestKey: request.rateRequestKey,
      candidateFacilityId: request.candidateFacilityId,
      candidateFacilityName: request.candidateFacilityName,
      originalFacilityId: request.originalFacilityId,
      sourceReference: request.shipmentOrderReferences.join(", ") || request.historicalShipmentRowIds.join(", "),
      recordType: request.recordType,
      representedShipments: request.representedShipments,
      currentTransportationCost: request.currentTransportationCost,
      currentTransportationCostPerShipment: request.currentTransportationCostPerShipment,
      representativePallets: request.representativePallets,
      representativeWeight: request.representativeWeight,
      weightUnit: request.weightUnit,
      dimensions:
        request.length !== null && request.width !== null && request.height !== null
          ? `${request.length} x ${request.width} x ${request.height}`
          : "",
      dimensionUnit: request.dimensionUnit,
      freightClass: request.calculatedFreightClass,
      sourceRowIds: request.historicalShipmentRowIds,
      request: {
        ...request.normalizedRequest!,
        customerReference: request.rateRequestKey
      }
    }))
  };

  const activeBatches = await prisma.automationJobRun.findMany({
    where: {
      tenantId: context.tenantId,
      jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE,
      status: {
        in: [JobStatus.QUEUED, JobStatus.RUNNING]
      }
    },
    take: 25
  });
  const duplicateActiveBatch = activeBatches
    .map((batch) => ({ batch, input: readInput(batch.input) }))
    .find((candidate) => isReusableBatchInput(candidate.input, projectId, preparationRunId, comparisonSetup, input));
  if (duplicateActiveBatch?.input) {
    return {
      jobId: duplicateActiveBatch.batch.id,
      account,
      input: duplicateActiveBatch.input,
      shouldProcess: true,
      reused: false,
      disposition: "RESUMED" as const
    };
  }

  const completedBatches = await prisma.automationJobRun.findMany({
    where: {
      tenantId: context.tenantId,
      jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE,
      status: JobStatus.SUCCESS
    },
    orderBy: {
      startedAt: "desc"
    },
    take: 25,
    include: {
      ltlBatchQuoteLanes: true
    }
  });
  const reusableCompletedBatch = completedBatches
    .map((batch) => ({ batch, input: readInput(batch.input) }))
    .find(
      (candidate) =>
        isReusableBatchInput(candidate.input, projectId, preparationRunId, comparisonSetup, input) &&
        hasReusableCompletedBatch(candidate.batch, candidate.input)
    );
  if (reusableCompletedBatch?.input) {
    return {
      jobId: reusableCompletedBatch.batch.id,
      account,
      input: reusableCompletedBatch.input,
      shouldProcess: false,
      reused: true,
      disposition: "REUSED_COMPLETED" as const
    };
  }

  const output = buildOutput(input, {
    processedLanes: 0,
    quotedLanes: 0,
    issueLanes: 0,
    quoteCount: 0,
    errorCount: 0
  });

  const jobRun = await prisma.automationJobRun.create({
    data: {
      tenantId: context.tenantId,
      jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE,
      status: JobStatus.QUEUED,
      input,
      output
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "supply-chain-design.ltl-rate-batch.queued",
      entityType: "AutomationJobRun",
      entityId: jobRun.id,
      after: {
        projectId,
        preparationRunId,
        requestCount: input.requests.length,
        accountName: account.name
      }
    }
  });

  return {
    jobId: jobRun.id,
    account,
    input,
    shouldProcess: true,
    reused: false,
    disposition: "STARTED" as const
  };
}

export async function runSupplyChainDesignLtlRateBatch(
  context: { tenantId: string; userId: string | null },
  jobRunId: string,
  account: SevenLAccountConfig,
  input: ScdsLtlBatchInput
) {
  const progress = {
    processedLanes: 0,
    quotedLanes: 0,
    issueLanes: 0,
    quoteCount: 0,
    errorCount: 0
  };
  const concurrency = getSupplyChainDesignLtlRateConcurrencyConfig();
  const locationCache: SevenLLocationCache = new Map();

  try {
    await prisma.automationJobRun.update({
      where: { id: jobRunId, tenantId: context.tenantId },
      data: { status: JobStatus.RUNNING }
    });

    for (let start = 0; start < input.requests.length; start += LTL_BULK_CHUNK_SIZE) {
      const chunk = input.requests.slice(start, start + LTL_BULK_CHUNK_SIZE);
      await mapWithConcurrency(chunk, concurrency.laneConcurrency, async (prepared, indexInChunk) => {
        const laneIndex = start + indexInChunk;
        const existing = await prisma.ltlBatchQuoteLane.findUnique({
          where: {
            jobRunId_laneIndex: {
              jobRunId,
              laneIndex
            }
          }
        });

        if (existing?.selectedQuoteJson || existing?.manualRateJson || existing?.exclusionJson) {
          progress.processedLanes += 1;
          if (existing.selectedQuoteJson || existing.manualRateJson) progress.quotedLanes += 1;
          await persistBatchProgress(context.tenantId, jobRunId, input, progress);
          return;
        }

        let requestJson = prepared.request;
        let quotes: LtlQuoteResult[] = [];
        let errors: LtlCarrierErrorResult[] = [];
        let selectedQuote: LtlQuoteResult | null = null;

        try {
          const preflight = preflightSevenLQuoteRequest(prepared.request);
          requestJson = preflight.request;
          if (!preflight.ok) {
            errors = [toLaneError(preflight.request, preflight.message)];
          } else {
            const reusable = await findReusableSupplyChainDesignExactLaneRate({
              tenantId: context.tenantId,
              currentJobRunId: jobRunId,
              accountId: input.accountId,
              carrierHashes: input.carrierHashes,
              request: preflight.request
            });
            if (reusable) {
              selectedQuote = {
                ...reusable.selectedQuote,
                customerReference: preflight.request.customerReference,
                scdsReuseLineage: {
                  sourceLaneId: reusable.sourceLaneId,
                  sourceBatchId: reusable.sourceBatchId,
                  exactLaneFingerprint: reusable.exactLaneFingerprint,
                  reusedAt: new Date().toISOString()
                }
              } as ReusedLaneQuoteEvidence;
            } else {
              const response = await getLtlQuotes(account, [preflight.request], input.carrierHashes, {
                carrierConcurrency: concurrency.carrierConcurrency,
                locationCache,
                requestTimeoutMs: concurrency.requestTimeoutMs
              });
              quotes = response.data;
              errors = response.errors;
              selectedQuote = selectLowestLtlQuote(quotes);
            }
          }
        } catch (error) {
          errors = [toLaneError(requestJson, safeLaneErrorMessage(error))];
        }

        progress.processedLanes += 1;
        if (selectedQuote) progress.quotedLanes += 1;
        if (!selectedQuote || errors.length > 0) progress.issueLanes += 1;
        progress.quoteCount += quotes.length;
        progress.errorCount += errors.length;

        await prisma.ltlBatchQuoteLane.upsert({
          where: {
            jobRunId_laneIndex: {
              jobRunId,
              laneIndex
            }
          },
          update: {
            customerReference: prepared.rateRequestKey,
            quoteCount: quotes.length,
            errorCount: errors.length,
            requestJson,
            quotesJson: quotes,
            errorsJson: errors,
            selectedQuoteJson: selectedQuote ?? Prisma.JsonNull,
            selectedRateSource: selectedQuote ? "7L selected rate" : "None"
          },
          create: {
            tenantId: context.tenantId,
            jobRunId,
            laneIndex,
            customerReference: prepared.rateRequestKey,
            quoteCount: quotes.length,
            errorCount: errors.length,
            requestJson,
            quotesJson: quotes,
            errorsJson: errors,
            selectedQuoteJson: selectedQuote ?? Prisma.JsonNull,
            selectedRateSource: selectedQuote ? "7L selected rate" : "None"
          }
        });
        await persistBatchProgress(context.tenantId, jobRunId, input, progress);
      });
    }

    await prisma.automationJobRun.update({
      where: { id: jobRunId, tenantId: context.tenantId },
      data: {
        status: JobStatus.SUCCESS,
        finishedAt: new Date(),
        output: buildOutput(input, progress, new Date().toISOString())
      }
    });
  } catch (error) {
    await prisma.automationJobRun.update({
      where: { id: jobRunId, tenantId: context.tenantId },
      data: {
        status: JobStatus.ERROR,
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unexpected 7L rate batch error.",
        output: buildOutput(input, progress, new Date().toISOString())
      }
    });
  }
}

export function getSupplyChainDesignLtlRateConcurrencyConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    laneConcurrency: readBoundedInteger(env.SCDS_LTL_LANE_CONCURRENCY, DEFAULT_SCDS_LTL_LANE_CONCURRENCY, 1, MAX_SCDS_LTL_LANE_CONCURRENCY),
    carrierConcurrency: readBoundedInteger(env.SCDS_LTL_CARRIER_CONCURRENCY, DEFAULT_SCDS_LTL_CARRIER_CONCURRENCY, 1, MAX_SCDS_LTL_CARRIER_CONCURRENCY),
    requestTimeoutMs: readBoundedInteger(env.SCDS_LTL_REQUEST_TIMEOUT_MS, DEFAULT_SCDS_LTL_REQUEST_TIMEOUT_MS, 1_000, MAX_SCDS_LTL_REQUEST_TIMEOUT_MS)
  };
}

async function persistBatchProgress(
  tenantId: string,
  jobRunId: string,
  input: ScdsLtlBatchInput,
  progress: { processedLanes: number; quotedLanes: number; issueLanes: number; quoteCount: number; errorCount: number }
) {
  await prisma.automationJobRun.update({
    where: { id: jobRunId, tenantId },
    data: { output: buildOutput(input, progress) }
  });
}

export async function getSupplyChainDesignLtlRateBatches(context: AuthenticatedContext, projectId: string) {
  let jobs: Array<{
    id: string;
    status: JobStatus;
    startedAt: Date;
    finishedAt: Date | null;
    input: Prisma.JsonValue | null;
    output: Prisma.JsonValue | null;
    errorMessage: string | null;
    ltlBatchQuoteLanes: Array<{
      customerReference: string;
      requestJson: Prisma.JsonValue;
      quotesJson: Prisma.JsonValue | null;
      errorsJson: Prisma.JsonValue | null;
      selectedQuoteJson: Prisma.JsonValue | null;
      selectedRateSource: string | null;
      manualRateJson: Prisma.JsonValue | null;
      exclusionJson: Prisma.JsonValue | null;
    }>;
  }>;
  try {
    jobs = await prisma.automationJobRun.findMany({
      where: {
        tenantId: context.tenantId,
        jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE
      },
      orderBy: {
        startedAt: "desc"
      },
      take: 50,
      include: {
        ltlBatchQuoteLanes: {
          orderBy: { laneIndex: "asc" }
        }
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("selectedQuoteJson")) {
      console.error(error);
      return [];
    }
    throw error;
  }

  const parsedInputs = jobs.map((job) => ({ job, input: readInput(job.input) }));
  const normalNetworkDesignInputs = parsedInputs.filter((entry) =>
    entry.input?.projectId === projectId && isNormalNetworkDesignBatchInput(entry.input)
  );
  const preparationRunIds = uniqueSorted(
    normalNetworkDesignInputs
      .filter((entry) => entry.input?.projectId === projectId)
      .map((entry) => entry.input?.preparationRunId)
      .filter((id): id is string => Boolean(id))
  );
  const preparationSummaries = new Map<string, SupplyChainDesignLtlRatePreparationResultSummary>();
  if (preparationRunIds.length > 0) {
    const preparationRuns = await prisma.supplyChainDesignLtlRatePreparationRun.findMany({
      where: {
        tenantId: context.tenantId,
        projectId,
        id: {
          in: preparationRunIds
        }
      },
      select: {
        id: true,
        resultSummary: true
      }
    });
    for (const run of preparationRuns) {
      const summary = readPreparationResultSummary(run.resultSummary);
      if (summary) preparationSummaries.set(run.id, summary);
    }
  }

  const summaries: Array<SupplyChainDesignLtlRateBatchSummary & { projectId: string }> = [];
  for (const { job, input } of normalNetworkDesignInputs) {
    const summary = mapScdsLtlRateBatchSummary(job, input, input ? preparationSummaries.get(input.preparationRunId) : undefined);
    if (summary && summary.projectId === projectId) {
      summaries.push(summary);
    }
  }
  return summaries
    .sort(compareBatchSummariesForDisplay)
    .map(omitBatchProjectId)
    .slice(0, 10);
}

export async function getSupplyChainDesignLtlRateBatchById(
  context: AuthenticatedContext,
  projectId: string,
  jobRunId: string
) {
  const job = await prisma.automationJobRun.findFirst({
    where: {
      tenantId: context.tenantId,
      id: jobRunId,
      jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE
    },
    include: {
      ltlBatchQuoteLanes: {
        orderBy: { laneIndex: "asc" }
      }
    }
  });
  const input = readInput(job?.input ?? null);
  if (!job || input?.projectId !== projectId) return null;
  let linkedPreparationSummary: SupplyChainDesignLtlRatePreparationResultSummary | undefined;
  if (isNormalNetworkDesignBatchInput(input)) {
    const preparationRun = await prisma.supplyChainDesignLtlRatePreparationRun.findFirst({
      where: {
        tenantId: context.tenantId,
        projectId,
        id: input.preparationRunId
      },
      select: {
        resultSummary: true
      }
    });
    linkedPreparationSummary = readPreparationResultSummary(preparationRun?.resultSummary) ?? undefined;
  }
  const summary = mapScdsLtlRateBatchSummary(job, input, linkedPreparationSummary);
  if (!summary || summary.projectId !== projectId) return null;
  return omitBatchProjectId(summary);
}

function omitBatchProjectId(summary: SupplyChainDesignLtlRateBatchSummary & { projectId: string }): SupplyChainDesignLtlRateBatchSummary {
  const batch: SupplyChainDesignLtlRateBatchSummary & { projectId?: string } = { ...summary };
  delete batch.projectId;
  return batch;
}

export async function saveSupplyChainDesignManualLtlRate(context: AuthenticatedContext, jobRunId: string, rateRequestKey: string, totalRate: number, reason: string) {
  const job = await getScdsJobForTenant(context, jobRunId);
  const lane = await prisma.ltlBatchQuoteLane.findFirst({
    where: { tenantId: context.tenantId, jobRunId: job.id, customerReference: rateRequestKey }
  });
  if (!lane) throw new Error("LTL rate row was not found.");
  if (!reason.trim()) throw new Error("Manual-rate reason is required.");
  await prisma.ltlBatchQuoteLane.update({
    where: { id: lane.id },
    data: {
      manualRateJson: {
        totalRate,
        reason: reason.trim(),
        createdByUserId: context.userId,
        createdAt: new Date().toISOString()
      },
      selectedRateSource: "Manual rate"
    }
  });
}

export async function excludeSupplyChainDesignLtlRateRow(context: AuthenticatedContext, jobRunId: string, rateRequestKey: string, reason: string) {
  const job = await getScdsJobForTenant(context, jobRunId);
  const lane = await prisma.ltlBatchQuoteLane.findFirst({
    where: { tenantId: context.tenantId, jobRunId: job.id, customerReference: rateRequestKey }
  });
  if (!lane) throw new Error("LTL rate row was not found.");
  if (!reason.trim()) throw new Error("Exclusion reason is required.");
  await prisma.ltlBatchQuoteLane.update({
    where: { id: lane.id },
    data: {
      exclusionJson: {
        reason: reason.trim(),
        createdByUserId: context.userId,
        createdAt: new Date().toISOString()
      },
      selectedRateSource: "Excluded"
    }
  });
}

export async function exportSupplyChainDesignLtlRateBatchCsv(context: AuthenticatedContext, projectId: string, jobRunId: string) {
  const batches = await getSupplyChainDesignLtlRateBatches(context, projectId);
  const batch = batches.find((candidate) => candidate.id === jobRunId);
  if (!batch) throw new Error("LTL rate batch was not found for this project.");
  const headers = [
    "Rate Request Key",
    "Preparation Run ID",
    "Rate Batch ID",
    "Candidate Facility",
    "Source Shipment Reference",
    "Origin",
    "Destination",
    "Represented Shipments",
    "Rating Inputs",
    "Freight Class",
    "Status",
    "Selected Carrier",
    "SCAC",
    "Transit Days",
    "Quote Number",
    "Linehaul",
    "Fuel",
    "Accessorial",
    "Selected Total Rate",
    "Estimated Total Cost",
    "Currency",
    "Remarks",
    "Error",
    "Source"
  ];
  const rows = batch.lanes.map((lane) => {
    const selected = lane.selectedQuote;
    const manualTotal = lane.manualRate?.totalRate ?? null;
    const totalRate = selected?.total ?? manualTotal;
    return [
      lane.rateRequestKey,
      batch.preparationRunId,
      batch.id,
      `${lane.candidateFacilityId} - ${lane.candidateFacilityName}`,
      lane.sourceReference,
      `${lane.request.originZipcode} ${lane.request.originCountry}`,
      lane.destination,
      String(lane.representedShipments),
      JSON.stringify(lane.request.pieces),
      lane.request.pieces.map((piece) => piece.freightClass).join("; "),
      lane.status,
      selected?.carrierName ?? "",
      selected?.scac ?? "",
      selected ? String(selected.transitDays) : "",
      selected?.quoteNumber ?? "",
      selected ? String(selected.linehaulCharge) : "",
      selected ? String(selected.fuelCharge) : "",
      selected ? String(selected.accessorialCharge) : "",
      totalRate === null ? "" : String(totalRate),
      totalRate === null ? "" : String(roundCurrency(totalRate * lane.representedShipments)),
      "USD",
      selected?.rateRemarks.join("; ") ?? lane.manualRate?.reason ?? lane.exclusion?.reason ?? "",
      lane.issue ?? "",
      lane.selectedRateSource
    ];
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export async function exportSupplyChainDesignShipmentComparisonCsv(
  context: AuthenticatedContext,
  projectId: string,
  jobRunId: string
) {
  const batches = await getSupplyChainDesignLtlRateBatches(context, projectId);
  const batch = batches.find((candidate) => candidate.id === jobRunId);
  if (!batch) throw new Error("Network Design run was not found for this project.");
  const headers = [
    "Current Facility ID",
    "Current Facility Name",
    "Candidate Facility ID",
    "Candidate Facility Name",
    "Current Origin Postal Code",
    "Candidate Origin Postal Code",
    "Destination Postal Code",
    "Destination Country",
    "Source Reference",
    "Record Type",
    "Shipments",
    "Pallets per Shipment",
    "Weight",
    "Weight Unit",
    "Dimensions",
    "Dimension Unit",
    "Freight Class",
    "Current Transportation Cost per Shipment",
    "Candidate Transportation Cost per Shipment",
    "Difference per Shipment",
    "Current Total Transportation Cost",
    "Candidate Total Transportation Cost",
    "Total Difference",
    "Percentage Change",
    "Selected Carrier",
    "SCAC",
    "Transit Days",
    "Service Level",
    "Quote Number",
    "Remarks",
    "Currency",
    "Status/Error",
    "7L Rate Date"
  ];
  const rows = batch.lanes.map((lane) => {
    const selectedRate = lane.selectedQuote?.total ?? lane.manualRate?.totalRate ?? null;
    const currentCost = lane.currentTransportationCost ?? 0;
    const candidateCost = lane.estimatedTotalTransportationCost ?? 0;
    const differencePerShipment =
      selectedRate === null || lane.currentTransportationCostPerShipment === null
        ? null
        : roundCurrency(selectedRate - lane.currentTransportationCostPerShipment);
    const totalDifference =
      lane.estimatedTotalTransportationCost === null || lane.currentTransportationCost === null
        ? null
        : roundCurrency(candidateCost - currentCost);
    const selectedRemarks = lane.selectedQuote
      ? lane.selectedQuote.rateRemarks.join("; ")
      : lane.manualRate?.reason ?? lane.exclusion?.reason ?? "";
    const statusOrError = lane.status === "Rated" ? lane.status : lane.issue ? `${lane.status}: ${lane.issue}` : lane.status;
    return [
      lane.originalFacilityId,
      lane.originalFacilityId,
      lane.candidateFacilityId,
      lane.candidateFacilityName,
      lane.request.originZipcode,
      lane.request.originZipcode,
      lane.request.destinationZipcode,
      lane.request.destinationCountry,
      lane.sourceReference,
      lane.recordType,
      String(lane.representedShipments),
      lane.representativePallets === null ? "" : String(lane.representativePallets),
      lane.representativeWeight === null ? "" : String(lane.representativeWeight),
      lane.weightUnit ?? "",
      lane.dimensions,
      lane.dimensionUnit ?? "",
      lane.freightClass ?? "",
      lane.currentTransportationCostPerShipment === null ? "" : String(lane.currentTransportationCostPerShipment),
      selectedRate === null ? "" : String(selectedRate),
      differencePerShipment === null ? "" : String(differencePerShipment),
      lane.currentTransportationCost === null ? "" : String(currentCost),
      lane.estimatedTotalTransportationCost === null ? "" : String(candidateCost),
      totalDifference === null ? "" : String(totalDifference),
      totalDifference === null || lane.currentTransportationCost === null ? "" : String(safePercent(totalDifference, lane.currentTransportationCost)),
      lane.selectedQuote?.carrierName ?? "",
      lane.selectedQuote?.scac ?? "",
      lane.selectedQuote ? String(lane.selectedQuote.transitDays) : "",
      "",
      lane.selectedQuote?.quoteNumber ?? "",
      selectedRemarks,
      "USD",
      statusOrError,
      lane.selectedQuote ? batch.finishedAt?.toISOString() ?? batch.startedAt.toISOString() : ""
    ];
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export async function exportSupplyChainDesignCandidateSummaryCsv(
  context: AuthenticatedContext,
  projectId: string,
  jobRunId: string
) {
  const batches = await getSupplyChainDesignLtlRateBatches(context, projectId);
  const batch = batches.find((candidate) => candidate.id === jobRunId);
  if (!batch) throw new Error("Network Design run was not found for this project.");
  const headers = [
    "Candidate Warehouse",
    "Current Facilities Represented",
    "Covered Shipments",
    "Current Covered LTL Cost",
    "Candidate LTL Cost",
    "Transportation Difference",
    "Current Warehouse Cost",
    "Candidate Warehouse Cost",
    "Current Covered Network Cost",
    "Proposed Covered Network Cost",
    "Difference From Current",
    "Percentage Change",
    "Coverage Percentage",
    "Warning"
  ];
  const rows = batch.candidateComparisons.map((candidate) => [
    `${candidate.candidateFacilityId} - ${candidate.candidateFacilityName}`,
    candidate.comparedCurrentFacilityIds.join("; "),
    String(candidate.coveredShipments),
    String(candidate.currentCoveredLtlCost),
    String(candidate.candidateLtlCost),
    String(candidate.transportationDifference),
    String(candidate.currentWarehouseCost),
    String(candidate.candidateWarehouseCost),
    String(candidate.currentCoveredNetworkCost),
    String(candidate.proposedCoveredNetworkCost),
    String(candidate.totalEstimatedDifference),
    candidate.percentageChange === null ? "" : String(candidate.percentageChange),
    String(candidate.coveragePercentage),
    candidate.warning ?? ""
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function selectLowestLtlQuote(quotes: LtlQuoteResult[]) {
  return [...quotes].sort((left, right) => {
    const totalDelta = left.total - right.total;
    if (Math.abs(totalDelta) > 0.00001) return totalDelta;
    return (
      left.scac.localeCompare(right.scac) ||
      left.carrierName.localeCompare(right.carrierName) ||
      left.quoteNumber.localeCompare(right.quoteNumber)
    );
  })[0] ?? null;
}

export function buildSupplyChainDesignExactLaneRateFingerprint(input: {
  accountId: string;
  carrierHashes: string[];
  request: LtlQuoteRequest;
}) {
  const payload = {
    version: SCDS_LTL_EXACT_LANE_FINGERPRINT_VERSION,
    provider: "7L",
    accountId: normalizeText(input.accountId),
    carrierHashes: input.carrierHashes.map(normalizeText).sort(),
    request: normalizeLtlQuoteRequestForFingerprint(input.request)
  };
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export async function findReusableSupplyChainDesignExactLaneRate(input: {
  tenantId: string;
  currentJobRunId?: string | null;
  accountId: string;
  carrierHashes: string[];
  request: LtlQuoteRequest;
}) {
  const exactLaneFingerprint = buildSupplyChainDesignExactLaneRateFingerprint({
    accountId: input.accountId,
    carrierHashes: input.carrierHashes,
    request: input.request
  });
  const candidateLanes = await Promise.resolve(
    prisma.ltlBatchQuoteLane.findMany({
      where: {
        tenantId: input.tenantId,
        selectedRateSource: "7L selected rate",
        jobRun: {
          jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE,
          status: JobStatus.SUCCESS
        }
      },
      include: {
        jobRun: true
      },
      orderBy: [
        { updatedAt: "desc" },
        { id: "desc" }
      ],
      take: 50
    })
  ).catch(() => []);

  for (const lane of candidateLanes ?? []) {
    if (input.currentJobRunId && lane.jobRunId === input.currentJobRunId) continue;
    const batchInput = readInput(lane.jobRun.input);
    if (!isReusableLaneBatchContext(batchInput, input.accountId, input.carrierHashes)) continue;
    if (!batchInput) continue;
    const quote = readLiveReusableQuote(lane.selectedQuoteJson);
    if (!quote) continue;
    const storedRequest = isLtlQuoteRequest(lane.requestJson) ? lane.requestJson : quote;
    const storedFingerprint = buildSupplyChainDesignExactLaneRateFingerprint({
      accountId: batchInput.accountId,
      carrierHashes: batchInput.carrierHashes,
      request: storedRequest
    });
    if (storedFingerprint !== exactLaneFingerprint) continue;
    return {
      sourceLaneId: lane.id,
      sourceBatchId: lane.jobRunId,
      exactLaneFingerprint,
      selectedQuote: quote
    };
  }

  return null;
}

function isReusableLaneBatchContext(input: ScdsLtlBatchInput | null, accountId: string, carrierHashes: string[]) {
  return Boolean(
    input &&
      input.accountId === accountId &&
      JSON.stringify(input.carrierHashes.slice().sort()) === JSON.stringify(carrierHashes.slice().sort())
  );
}

function readLiveReusableQuote(value: Prisma.JsonValue | null | undefined): LtlQuoteResult | null {
  if (!value || typeof value !== "object") return null;
  const quote = value as Partial<LtlQuoteResult>;
  return quote.mode === "live" && typeof quote.total === "number" && Number.isFinite(quote.total)
    ? (value as LtlQuoteResult)
    : null;
}

function normalizeLtlQuoteRequestForFingerprint(request: LtlQuoteRequest) {
  return {
    originCity: normalizeText(request.originCity),
    originState: normalizeText(request.originState),
    originZipcode: normalizePostal(request.originZipcode),
    originCountry: normalizeText(request.originCountry),
    destinationCity: normalizeText(request.destinationCity),
    destinationState: normalizeText(request.destinationState),
    destinationZipcode: normalizePostal(request.destinationZipcode),
    destinationCountry: normalizeText(request.destinationCountry),
    pickupDate: normalizeText(request.pickupDate),
    uom: normalizeText(request.uom),
    accessorialCodes: request.accessorialCodes.map(normalizeText).sort(),
    pieces: request.pieces.map((piece) => ({
      qty: normalizeNumber(piece.qty),
      weight: normalizeNumber(piece.weight),
      weightType: normalizeText(piece.weightType),
      length: normalizeNumber(piece.length),
      width: normalizeNumber(piece.width),
      height: normalizeNumber(piece.height),
      dimType: normalizeText(piece.dimType),
      freightClass: normalizeText(piece.freightClass),
      hazmat: Boolean(piece.hazmat),
      unNumber: normalizeNullableText(piece.unNumber),
      nmfc: normalizeNullableText(piece.nmfc),
      stack: Boolean(piece.stack),
      stackAmount: piece.stackAmount === undefined || piece.stackAmount === null ? null : normalizeNumber(piece.stackAmount),
      commodity: normalizeNullableText(piece.commodity)
    }))
  };
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

function normalizeNullableText(value: string | undefined | null) {
  return value === undefined || value === null || !value.trim() ? null : normalizeText(value);
}

function normalizePostal(value: string) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeNumber(value: number) {
  return Number(Number(value).toFixed(6));
}

function toLaneError(request: LtlQuoteRequest, message: string): LtlCarrierErrorResult {
  return {
    ...request,
    carrierHash: "",
    carrierName: "7L request preflight",
    carrierCode: "",
    scac: "",
    errorMessage: message,
    mode: "live"
  };
}

function safeLaneErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "7L lane request failed.";
  if (/zipcode lookup/i.test(message)) return "Location validation failed.";
  if (/credential/i.test(message)) return "7L account validation failed.";
  if (/rate request/i.test(message)) return "7L rate request failed.";
  return message || "7L lane request failed.";
}

async function getDefaultSevenLAccount(context: AuthenticatedContext): Promise<SevenLAccountConfig | null> {
  const accountState = await getLtlRatePortalAccounts(context);
  const account = pickPreferredLiveSevenLAccount(accountState.accounts);
  if (!accountState.moduleEnabled || !account || !account.secretConfigured || account.carriers.filter((carrier) => carrier.enabled).length === 0) {
    return null;
  }
  return account;
}

function mapScdsLtlRateBatchSummary(job: {
  id: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  input: Prisma.JsonValue | null;
  errorMessage: string | null;
  ltlBatchQuoteLanes: Array<{
    customerReference: string;
    requestJson: Prisma.JsonValue;
    quotesJson: Prisma.JsonValue | null;
    errorsJson: Prisma.JsonValue | null;
    selectedQuoteJson: Prisma.JsonValue | null;
    selectedRateSource: string | null;
    manualRateJson: Prisma.JsonValue | null;
    exclusionJson: Prisma.JsonValue | null;
  }>;
  output?: Prisma.JsonValue | null;
}, parsedInput?: ScdsLtlBatchInput | null, linkedPreparationSummary?: SupplyChainDesignLtlRatePreparationResultSummary) {
  const input = parsedInput ?? readInput(job.input);
  if (!input) return null;
  const output = readOutput(job.output);
  const savedLanes = job.ltlBatchQuoteLanes ?? [];
  const lanes = input.requests.map((request) => {
    const lane = savedLanes.find((candidate) => candidate.customerReference === request.rateRequestKey);
    return mapLane(request, lane);
  });
  const ratedSuccessfully = lanes.filter((lane) => lane.status === "Rated").length;
  const manuallyRated = lanes.filter((lane) => lane.status === "Manual").length;
  const excluded = lanes.filter((lane) => lane.status === "Excluded").length;
  const noRateReturned = lanes.filter((lane) => lane.status === "No rate returned").length;
  const sevenLErrors = lanes.filter((lane) => lane.status === "7L error").length;
  const preparationSummary = input.preparationSummary ?? toStoredPreparationSummary(linkedPreparationSummary);
  const comparableProfileLanes = getComparableProfileLanes(lanes);
  const rateRequestsCompleted = ratedSuccessfully + manuallyRated;
  const sourceRowCounts = {
    historicalRowsReviewed: preparationSummary?.historicalRowsReviewed ?? lanes.length,
    ltlRowsReviewed: comparableProfileLanes.length,
    shipmentsRepresented: comparableProfileLanes.reduce((sum, lane) => sum + lane.representedShipments, 0),
    rateRequestsCompleted,
    incompleteLtlRowsExcluded: preparationSummary?.missingDataRequestCount ?? 0,
    nonLtlRowsExcluded: preparationSummary?.excludedNonLtlRowCount ?? 0,
    unratedRateRequests: noRateReturned + sevenLErrors
  };
  const historicalShipmentVolumeCovered = lanes
    .filter((lane) => lane.status === "Rated" || lane.status === "Manual")
    .reduce((sum, lane) => sum + lane.representedShipments, 0);
  const unratedRepresentedShipments = lanes
    .filter((lane) => lane.status !== "Rated" && lane.status !== "Manual" && lane.status !== "Excluded")
    .reduce((sum, lane) => sum + lane.representedShipments, 0);
  return {
    projectId: input.projectId,
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errorMessage: job.errorMessage,
    preparationRunId: input.preparationRunId,
    preparationCreatedAt: input.preparationCreatedAt,
    requestsSubmitted: input.requests.length,
    processedRequests: output?.processedLanes ?? savedLanes.length,
    ratedSuccessfully,
    issueRequests: output?.issueLanes ?? noRateReturned + sevenLErrors + excluded,
    missingData: 0,
    noRateReturned,
    sevenLErrors,
    manuallyRated,
    excluded,
    sourceRowCounts,
    historicalShipmentVolumeCovered,
    unratedRepresentedShipments,
    accountName: input.accountName,
    lanes,
    candidateComparisons: buildCandidateComparisons(input.comparisonSetup ?? emptyComparisonSetup(), lanes),
    coverage: buildCoverage(input.comparisonSetup ?? emptyComparisonSetup(), lanes),
    savedInputSelection: {
      selectedCandidateFacilityIds: input.comparisonSetup?.candidateFacilities.map((candidate) => candidate.facilityId) ?? []
    }
  };
}

function mapLane(
  request: ScdsLtlBatchInput["requests"][number],
  lane:
    | {
        requestJson: Prisma.JsonValue;
        quotesJson: Prisma.JsonValue | null;
        errorsJson: Prisma.JsonValue | null;
        selectedQuoteJson: Prisma.JsonValue | null;
        selectedRateSource: string | null;
        manualRateJson: Prisma.JsonValue | null;
        exclusionJson: Prisma.JsonValue | null;
      }
    | undefined
): SupplyChainDesignLtlRateBatchLaneSummary {
  const quotes = Array.isArray(lane?.quotesJson) ? (lane?.quotesJson as unknown as LtlQuoteResult[]) : [];
  const errors = Array.isArray(lane?.errorsJson) ? (lane?.errorsJson as unknown as LtlCarrierErrorResult[]) : [];
  const selectedQuote = lane?.selectedQuoteJson ? (lane.selectedQuoteJson as unknown as LtlQuoteResult) : null;
  const manualRate = readManualRate(lane?.manualRateJson);
  const exclusion = readExclusion(lane?.exclusionJson);
  const storedRequest = isLtlQuoteRequest(lane?.requestJson) ? lane.requestJson : request.request;
  const status = exclusion
    ? "Excluded"
    : manualRate
      ? "Manual"
      : selectedQuote
        ? "Rated"
        : errors.length > 0
          ? "7L error"
          : lane && quotes.length === 0
            ? "No rate returned"
            : "Pending";
  const totalRate = manualRate?.totalRate ?? selectedQuote?.total ?? null;
  const errorIssue = errors.map((error) => `${error.carrierName}: ${error.errorMessage}`).join("; ") || null;
  return {
    rateRequestKey: request.rateRequestKey,
    candidateFacilityId: request.candidateFacilityId,
    candidateFacilityName: request.candidateFacilityName,
    originalFacilityId: request.originalFacilityId,
    destination: storedRequest.destinationZipcode,
    sourceReference: request.sourceReference,
    recordType: request.recordType,
    representedShipments: request.representedShipments,
    currentTransportationCost: request.currentTransportationCost,
    currentTransportationCostPerShipment: request.currentTransportationCostPerShipment,
    representativePallets: request.representativePallets,
    representativeWeight: request.representativeWeight,
    weightUnit: request.weightUnit,
    dimensions: request.dimensions,
    dimensionUnit: request.dimensionUnit,
    freightClass: request.freightClass,
    request: storedRequest,
    quotes,
    errors,
    selectedQuote,
    selectedRateSource: exclusion ? "Excluded" : manualRate ? "Manual rate" : selectedQuote ? "7L selected rate" : "None",
    manualRate,
    exclusion,
    status,
    issue: exclusion?.reason ?? manualRate?.reason ?? errorIssue,
    estimatedTotalTransportationCost: totalRate === null ? null : roundCurrency(totalRate * request.representedShipments)
  };
}

function buildCoverage(setup: SupplyChainDesignLtlComparisonSetup, lanes: SupplyChainDesignLtlRateBatchLaneSummary[]) {
  const comparableLanes = getComparableProfileLanes(lanes);
  const covered = comparableLanes.filter((lane) => lane.status === "Rated" || lane.status === "Manual");
  const excluded = comparableLanes.filter((lane) => lane.status !== "Rated" && lane.status !== "Manual");
  const currentCostByFacility = new Map(
    setup.currentFacilities.map((facility) => [facility.facilityId, facility.annualFacilityCost])
  );
  const representedFacilityIds = uniqueSorted(covered.map((lane) => lane.originalFacilityId).filter(Boolean));
  const totalShipmentVolume = comparableLanes.reduce((sum, lane) => sum + lane.representedShipments, 0);
  const totalHistoricalCost = comparableLanes.reduce((sum, lane) => sum + (lane.currentTransportationCost ?? 0), 0);
  const coveredShipments = covered.reduce((sum, lane) => sum + lane.representedShipments, 0);
  const coveredHistoricalTransportationCost = roundCurrency(
    covered.reduce((sum, lane) => sum + (lane.currentTransportationCost ?? 0), 0)
  );
  const excludedShipmentCount = excluded.reduce((sum, lane) => sum + lane.representedShipments, 0);
  const excludedHistoricalTransportationCost = roundCurrency(
    excluded.reduce((sum, lane) => sum + (lane.currentTransportationCost ?? 0), 0)
  );

  return {
    historicalLtlRowsReviewed: comparableLanes.length,
    validLtlRowsRated: covered.length,
    unratedRequests: excluded.length,
    currentRepresentedWarehouseCost: roundCurrency(
      representedFacilityIds.reduce((sum, facilityId) => sum + (currentCostByFacility.get(facilityId) ?? 0), 0)
    ),
    coveredShipments,
    coveredHistoricalTransportationCost,
    excludedShipmentCount,
    excludedHistoricalTransportationCost,
    shipmentCoveragePercent: safePercent(coveredShipments, totalShipmentVolume),
    historicalCostCoveragePercent: safePercent(coveredHistoricalTransportationCost, totalHistoricalCost)
  };
}

function getComparableProfileLanes(lanes: SupplyChainDesignLtlRateBatchLaneSummary[]) {
  const firstCandidateId = lanes[0]?.candidateFacilityId ?? null;
  return firstCandidateId ? lanes.filter((lane) => lane.candidateFacilityId === firstCandidateId) : lanes;
}

function buildCandidateComparisons(
  setup: SupplyChainDesignLtlComparisonSetup,
  lanes: SupplyChainDesignLtlRateBatchLaneSummary[]
): SupplyChainDesignCandidateComparisonSummary[] {
  const currentCostByFacility = new Map(
    setup.currentFacilities.map((facility) => [facility.facilityId, facility.annualFacilityCost])
  );

  return setup.candidateFacilities.map((candidate) => {
    const candidateLanes = lanes.filter((lane) => lane.candidateFacilityId === candidate.facilityId);
    const covered = candidateLanes.filter((lane) => lane.status === "Rated" || lane.status === "Manual");
    const coveredShipments = covered.reduce((sum, lane) => sum + lane.representedShipments, 0);
    const totalCandidateShipments = candidateLanes.reduce((sum, lane) => sum + lane.representedShipments, 0);
    const representedFacilityIds = uniqueSorted(covered.map((lane) => lane.originalFacilityId).filter(Boolean));
    const missingFacilityIds = representedFacilityIds.filter((facilityId) => !currentCostByFacility.has(facilityId));
    const currentCoveredLtlCost = roundCurrency(
      covered.reduce((sum, lane) => sum + (lane.currentTransportationCost ?? 0), 0)
    );
    const candidateLtlCost = roundCurrency(
      covered.reduce((sum, lane) => sum + (lane.estimatedTotalTransportationCost ?? 0), 0)
    );
    const currentWarehouseCost = roundCurrency(
      representedFacilityIds.reduce((sum, facilityId) => sum + (currentCostByFacility.get(facilityId) ?? 0), 0)
    );
    const candidateWarehouseCost = roundCurrency(candidate.annualFixedCost);
    const currentCoveredNetworkCost = roundCurrency(currentCoveredLtlCost + currentWarehouseCost);
    const proposedCoveredNetworkCost = roundCurrency(candidateLtlCost + candidateWarehouseCost);
    const totalEstimatedDifference = roundCurrency(proposedCoveredNetworkCost - currentCoveredNetworkCost);
    const warnings = [
      coveredShipments < totalCandidateShipments
        ? `${formatShipmentCount(totalCandidateShipments - coveredShipments)} represented shipment(s) excluded from this comparison.`
        : null,
      missingFacilityIds.length > 0
        ? `Missing current warehouse cost for origin facilit${missingFacilityIds.length === 1 ? "y" : "ies"}: ${missingFacilityIds.join(", ")}.`
        : null
    ].filter((value): value is string => Boolean(value));

    return {
      candidateFacilityId: candidate.facilityId,
      candidateFacilityName: candidate.facilityName,
      comparedCurrentFacilityIds: representedFacilityIds,
      scenarioType: "Replace",
      coveredShipments,
      currentCoveredLtlCost,
      candidateLtlCost,
      transportationDifference: roundCurrency(candidateLtlCost - currentCoveredLtlCost),
      currentWarehouseCost,
      retainedCurrentWarehouseCost: 0,
      candidateWarehouseCost,
      currentCoveredNetworkCost,
      proposedCoveredNetworkCost,
      totalEstimatedDifference,
      percentageChange: currentCoveredNetworkCost > 0 ? safePercent(totalEstimatedDifference, currentCoveredNetworkCost) : null,
      coveragePercentage: safePercent(coveredShipments, totalCandidateShipments),
      warning: warnings.join(" ") || null
    };
  });
}

function emptyComparisonSetup(): SupplyChainDesignLtlComparisonSetup {
  return {
    scenarioSelections: [],
    currentFacilities: [],
    candidateFacilities: []
  };
}

function readInput(value: Prisma.JsonValue | null): ScdsLtlBatchInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ScdsLtlBatchInput>;
  return candidate.source === "SUPPLY_CHAIN_DESIGN" && candidate.projectId && candidate.preparationRunId && Array.isArray(candidate.requests)
    ? (candidate as ScdsLtlBatchInput)
    : null;
}

export function readSupplyChainDesignLtlBatchInput(value: Prisma.JsonValue | null): ScdsLtlBatchInput | null {
  return readInput(value);
}

function isNormalNetworkDesignBatchInput(input: ScdsLtlBatchInput | null) {
  return Boolean(input && !input.preparationRunId.startsWith("scenario:"));
}

function readOutput(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return {
    processedLanes: typeof candidate.processedLanes === "number" ? candidate.processedLanes : null,
    quotedLanes: typeof candidate.quotedLanes === "number" ? candidate.quotedLanes : null,
    issueLanes: typeof candidate.issueLanes === "number" ? candidate.issueLanes : null
  };
}

function readPreparationResultSummary(value: Prisma.JsonValue | null | undefined): SupplyChainDesignLtlRatePreparationResultSummary | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SupplyChainDesignLtlRatePreparationResultSummary>;
  return candidate.resultVersion === SCDS_LTL_RATE_PREPARATION_RESULT_VERSION &&
    typeof candidate.historicalRowsReviewed === "number" &&
    typeof candidate.readyRequestCount === "number" &&
    typeof candidate.missingDataRequestCount === "number" &&
    typeof candidate.excludedNonLtlRowCount === "number"
    ? (candidate as SupplyChainDesignLtlRatePreparationResultSummary)
    : null;
}

function toStoredPreparationSummary(summary: SupplyChainDesignLtlRatePreparationResultSummary | undefined) {
  return summary
    ? {
        historicalRowsReviewed: summary.historicalRowsReviewed,
        readyRequestCount: summary.readyRequestCount,
        missingDataRequestCount: summary.missingDataRequestCount,
        excludedNonLtlRowCount: summary.excludedNonLtlRowCount
      }
    : undefined;
}

function isReusableBatchInput(
  input: ScdsLtlBatchInput | null,
  projectId: string,
  preparationRunId: string,
  comparisonSetup: SupplyChainDesignLtlComparisonSetup,
  expectedInput?: ScdsLtlBatchInput
) {
  if (
    input?.projectId !== projectId ||
    input.preparationRunId !== preparationRunId ||
    (expectedInput && (input.accountId !== expectedInput.accountId || input.accountName !== expectedInput.accountName)) ||
    JSON.stringify(normalizeComparisonSetup(input.comparisonSetup)) !== JSON.stringify(normalizeComparisonSetup(comparisonSetup)) ||
    (expectedInput &&
      JSON.stringify(buildBatchCompatibilityFingerprint(input)) !==
        JSON.stringify(buildBatchCompatibilityFingerprint(expectedInput)))
  ) {
    return false;
  }
  return hasInputCurrentCostEvidence(input) && (!expectedInput || hasInputCurrentCostEvidence(expectedInput));
}

function buildBatchCompatibilityFingerprint(input: ScdsLtlBatchInput) {
  return {
    accountId: input.accountId,
    carrierHashes: input.carrierHashes.slice().sort(),
    comparisonSetup: normalizeComparisonSetup(input.comparisonSetup),
    requests: input.requests
      .map((request) => ({
        candidateFacilityId: request.candidateFacilityId,
        originalFacilityId: request.originalFacilityId,
        representativePallets: request.representativePallets,
        representativeWeight: request.representativeWeight,
        weightUnit: request.weightUnit,
        dimensions: request.dimensions,
        dimensionUnit: request.dimensionUnit,
        freightClass: request.freightClass,
        request: {
          originZipcode: request.request.originZipcode,
          originCountry: request.request.originCountry,
          destinationZipcode: request.request.destinationZipcode,
          destinationCountry: request.request.destinationCountry,
          pickupDate: request.request.pickupDate,
          uom: request.request.uom,
          accessorialCodes: request.request.accessorialCodes.slice().sort(),
          pieces: request.request.pieces.map((piece) => ({
            qty: piece.qty,
            weight: piece.weight,
            weightType: piece.weightType,
            length: piece.length,
            width: piece.width,
            height: piece.height,
            dimType: piece.dimType,
            freightClass: piece.freightClass,
            hazmat: piece.hazmat,
            unNumber: piece.unNumber ?? null,
            nmfc: piece.nmfc ?? null,
            stack: piece.stack,
            stackAmount: piece.stackAmount ?? null
          }))
        }
      }))
      .sort((left, right) => `${left.candidateFacilityId}:${left.originalFacilityId}`.localeCompare(`${right.candidateFacilityId}:${right.originalFacilityId}`))
  };
}

function hasInputCurrentCostEvidence(input: ScdsLtlBatchInput | null) {
  return input !== null && input.requests.length > 0 && input.requests.every((request) => Number.isFinite(request.currentTransportationCost));
}

function hasReusableCompletedBatch(
  batch: { ltlBatchQuoteLanes?: Array<{ selectedQuoteJson: Prisma.JsonValue | null; manualRateJson: Prisma.JsonValue | null }> },
  input: ScdsLtlBatchInput | null
) {
  return hasInputCurrentCostEvidence(input) && (batch.ltlBatchQuoteLanes ?? []).some((lane) => Boolean(lane.selectedQuoteJson || lane.manualRateJson));
}

function compareBatchSummariesForDisplay(left: SupplyChainDesignLtlRateBatchSummary & { projectId?: string }, right: SupplyChainDesignLtlRateBatchSummary & { projectId?: string }) {
  const leftPriority = batchDisplayPriority(left);
  const rightPriority = batchDisplayPriority(right);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return right.startedAt.getTime() - left.startedAt.getTime();
}

function batchDisplayPriority(batch: SupplyChainDesignLtlRateBatchSummary) {
  if (batch.status === JobStatus.QUEUED || batch.status === JobStatus.RUNNING) return 0;
  if (batch.status === JobStatus.SUCCESS) return 1;
  if (batch.status === JobStatus.ERROR) return 2;
  return 3;
}

function normalizeComparisonSetup(setup: SupplyChainDesignLtlComparisonSetup | undefined) {
  return {
    scenarioSelections: (setup?.scenarioSelections ?? [])
      .map((selection) => ({
        candidateFacilityId: selection.candidateFacilityId,
        scenarioType: selection.scenarioType,
        comparedCurrentFacilityIds: selection.comparedCurrentFacilityIds.slice().sort()
      }))
      .sort((left, right) => left.candidateFacilityId.localeCompare(right.candidateFacilityId)),
    currentFacilities: (setup?.currentFacilities ?? [])
      .map((facility) => ({
        facilityId: facility.facilityId,
        annualFacilityCost: roundCurrency(facility.annualFacilityCost)
      }))
      .sort((left, right) => left.facilityId.localeCompare(right.facilityId)),
    candidateFacilities: (setup?.candidateFacilities ?? [])
      .map((facility) => ({
        facilityId: facility.facilityId,
        annualFixedCost: roundCurrency(facility.annualFixedCost)
      }))
      .sort((left, right) => left.facilityId.localeCompare(right.facilityId))
  };
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function readManualRate(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" ? (value as ManualRateEvidence) : null;
}

function readExclusion(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" ? (value as ExclusionEvidence) : null;
}

function isLtlQuoteRequest(value: Prisma.JsonValue | null | undefined): value is LtlQuoteRequest {
  return Boolean(
    value &&
      typeof value === "object" &&
      "originZipcode" in value &&
      "destinationZipcode" in value &&
      "pieces" in value &&
      Array.isArray((value as { pieces?: unknown }).pieces)
  );
}

async function getScdsJobForTenant(context: AuthenticatedContext, jobRunId: string) {
  const job = await prisma.automationJobRun.findFirst({
    where: { tenantId: context.tenantId, id: jobRunId, jobType: SCDS_LTL_RATE_BATCH_JOB_TYPE }
  });
  if (!job) throw new Error("LTL rate batch was not found for this tenant.");
  return job;
}

function buildOutput(input: ScdsLtlBatchInput, progress: { processedLanes: number; quotedLanes: number; issueLanes: number; quoteCount: number; errorCount: number }, completedAt: string | null = null) {
  return {
    projectId: input.projectId,
    preparationRunId: input.preparationRunId,
    totalLanes: input.requests.length,
    processedLanes: progress.processedLanes,
    quotedLanes: progress.quotedLanes,
    issueLanes: progress.issueLanes,
    remainingLanes: Math.max(0, input.requests.length - progress.processedLanes),
    currentStage: completedAt
      ? "Complete"
      : progress.processedLanes >= input.requests.length
        ? "Completing comparison"
        : "Requesting 7L rates",
    quoteCount: progress.quoteCount,
    errorCount: progress.errorCount,
    selectedCarrierCount: input.carrierHashes.length,
    completedAt
  };
}

function readBoundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function comparePreparedRequests(left: SupplyChainDesignLtlPreparedRequest, right: SupplyChainDesignLtlPreparedRequest) {
  return (
    left.candidateFacilityName.localeCompare(right.candidateFacilityName) ||
    left.destinationCountry.localeCompare(right.destinationCountry) ||
    left.destinationPostalCode.localeCompare(right.destinationPostalCode) ||
    left.rateRequestKey.localeCompare(right.rateRequestKey)
  );
}

async function mapWithConcurrency<T>(values: T[], concurrency: number, worker: (value: T, index: number) => Promise<void>) {
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(values[currentIndex], currentIndex);
      }
    })
  );
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function safePercent(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function formatShipmentCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
