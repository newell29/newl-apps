import { JobStatus, type Prisma } from "@prisma/client";
import { exportLtlResultsCsv } from "@/modules/ltl-rate-portal/csv";
import type {
  LtlBulkQuoteCreateRequestPayload,
  LtlBulkQuoteJobDetail,
  LtlBulkQuoteJobSummary,
  LtlCarrierErrorResult,
  LtlQuoteRequest,
  LtlQuoteResult,
  SevenLAccountConfig
} from "@/modules/ltl-rate-portal/types";
import { prisma } from "@/server/db";
import { getLtlQuotes } from "@/server/integrations/seven-l";
import type { TenantContext } from "@/server/tenant-context";

export const LTL_BULK_JOB_TYPE = "ltl-rate-portal.bulk-quote";
export const LTL_BULK_CHUNK_SIZE = 10;
export const LTL_BULK_LANE_CONCURRENCY = 1;

type LtlBulkQuoteJobInput = {
  name?: string;
  accountId: string;
  accountName: string;
  carrierHashes: string[];
  rows: LtlQuoteRequest[];
};

type LtlBulkQuoteJobOutput = {
  totalLanes: number;
  processedLanes: number;
  quotedLanes: number;
  issueLanes: number;
  quoteCount: number;
  errorCount: number;
  selectedCarrierCount: number;
  completedAt?: string | null;
};

type LtlBulkQuoteProgress = {
  processedLanes: number;
  quotedLanes: number;
  issueLanes: number;
  quoteCount: number;
  errorCount: number;
};

type BulkJobActorContext = {
  tenantId: string;
  userId: string | null;
};

export async function createLtlBulkQuoteJob(
  tenant: BulkJobActorContext,
  account: SevenLAccountConfig,
  payload: LtlBulkQuoteCreateRequestPayload
) {
  const input: LtlBulkQuoteJobInput = {
    name: payload.name?.trim() ? payload.name.trim() : undefined,
    accountId: account.id,
    accountName: account.name,
    carrierHashes: payload.carrierHashes,
    rows: payload.rows
  };

  const output: LtlBulkQuoteJobOutput = {
    totalLanes: payload.rows.length,
    processedLanes: 0,
    quotedLanes: 0,
    issueLanes: 0,
    quoteCount: 0,
    errorCount: 0,
    selectedCarrierCount: payload.carrierHashes.length
  };

  const jobRun = await prisma.automationJobRun.create({
    data: {
      tenantId: tenant.tenantId,
      jobType: LTL_BULK_JOB_TYPE,
      status: JobStatus.QUEUED,
      input,
      output
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      action: "ltl.bulk-job.queued",
      entityType: "AutomationJobRun",
      entityId: jobRun.id,
      after: {
        accountId: account.id,
        accountName: account.name,
        name: input.name ?? null,
        totalLanes: payload.rows.length,
        selectedCarrierCount: payload.carrierHashes.length
      }
    }
  });

  return mapBulkJobSummary(jobRun);
}

export async function runLtlBulkQuoteJob(
  tenant: BulkJobActorContext,
  jobRunId: string,
  account: SevenLAccountConfig,
  payload: LtlBulkQuoteCreateRequestPayload
) {
  const progress: LtlBulkQuoteProgress = {
    processedLanes: 0,
    quotedLanes: 0,
    issueLanes: 0,
    quoteCount: 0,
    errorCount: 0
  };

  try {
    await prisma.automationJobRun.update({
      where: { id: jobRunId, tenantId: tenant.tenantId },
      data: {
        status: JobStatus.RUNNING
      }
    });

    for (let start = 0; start < payload.rows.length; start += LTL_BULK_CHUNK_SIZE) {
      const chunk = payload.rows.slice(start, start + LTL_BULK_CHUNK_SIZE);

      await mapWithConcurrency(chunk, LTL_BULK_LANE_CONCURRENCY, async (request, indexInChunk) => {
        const laneIndex = start + indexInChunk;
        const response = await getLtlQuotes(account, [request], payload.carrierHashes);
        const quotes = response.data;
        const errors = response.errors;

        progress.processedLanes += 1;
        if (quotes.length > 0) {
          progress.quotedLanes += 1;
        }
        if (errors.length > 0) {
          progress.issueLanes += 1;
        }
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
            customerReference: request.customerReference,
            quoteCount: quotes.length,
            errorCount: errors.length,
            requestJson: request,
            quotesJson: quotes,
            errorsJson: errors
          },
          create: {
            tenantId: tenant.tenantId,
            jobRunId,
            laneIndex,
            customerReference: request.customerReference,
            quoteCount: quotes.length,
            errorCount: errors.length,
            requestJson: request,
            quotesJson: quotes,
            errorsJson: errors
          }
        });

        await sleep(250);
      });

      await prisma.automationJobRun.update({
        where: { id: jobRunId, tenantId: tenant.tenantId },
        data: {
          output: buildJobOutput(payload, progress, null)
        }
      });
    }

    await prisma.automationJobRun.update({
      where: { id: jobRunId, tenantId: tenant.tenantId },
      data: {
        status: JobStatus.SUCCESS,
        finishedAt: new Date(),
        output: buildJobOutput(payload, progress, new Date().toISOString())
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "ltl.bulk-job.completed",
        entityType: "AutomationJobRun",
        entityId: jobRunId,
        after: buildJobOutput(payload, progress, new Date().toISOString())
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected LTL bulk quote error.";

    await prisma.automationJobRun.update({
      where: { id: jobRunId, tenantId: tenant.tenantId },
      data: {
        status: JobStatus.ERROR,
        finishedAt: new Date(),
        errorMessage: message,
        output: buildJobOutput(payload, progress, new Date().toISOString())
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "ltl.bulk-job.failed",
        entityType: "AutomationJobRun",
        entityId: jobRunId,
        after: {
          errorMessage: message,
          ...buildJobOutput(payload, progress, new Date().toISOString())
        }
      }
    });
  }
}

export async function getRecentLtlBulkQuoteJobs(tenant: TenantContext) {
  const jobs = await prisma.automationJobRun.findMany({
    where: {
      tenantId: tenant.tenantId,
      jobType: LTL_BULK_JOB_TYPE
    },
    orderBy: {
      startedAt: "desc"
    },
    take: 25
  });

  return jobs.map(mapBulkJobSummary);
}

export async function getLtlBulkQuoteJobDetail(tenant: TenantContext, jobRunId: string): Promise<LtlBulkQuoteJobDetail> {
  const jobRun = await getLtlBulkQuoteJobRun(tenant, jobRunId);

  const laneRows = await prisma.ltlBatchQuoteLane.findMany({
    where: {
      tenantId: tenant.tenantId,
      jobRunId
    },
    orderBy: {
      laneIndex: "asc"
    }
  });

  return {
    job: mapBulkJobSummary(jobRun),
    lanes: laneRows.map((row) => ({
      laneIndex: row.laneIndex,
      customerReference: row.customerReference,
      request: row.requestJson as unknown as LtlQuoteRequest,
      quotes: asQuoteResults(row.quotesJson),
      errors: asCarrierErrors(row.errorsJson),
      quoteCount: row.quoteCount,
      errorCount: row.errorCount
    }))
  };
}

export async function getLtlBulkQuoteJobSummaryForTenant(tenant: TenantContext, jobRunId: string) {
  const jobRun = await getLtlBulkQuoteJobRun(tenant, jobRunId);
  return mapBulkJobSummary(jobRun);
}

export async function deleteLtlBulkQuoteJob(tenant: BulkJobActorContext, jobRunId: string) {
  const jobRun = await getLtlBulkQuoteJobRun(tenant, jobRunId);
  if (!["SUCCESS", "ERROR", "CANCELLED"].includes(jobRun.status)) {
    throw new Error("Only completed or failed LTL bulk quote jobs can be deleted.");
  }

  await prisma.automationJobRun.delete({
    where: {
      id: jobRun.id
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      action: "ltl.bulk-job.deleted",
      entityType: "AutomationJobRun",
      entityId: jobRun.id,
      after: {
        jobId: jobRun.id,
        status: jobRun.status,
        jobName: readBulkInput(jobRun.input).name ?? null
      }
    }
  });

  return {
    id: jobRun.id
  };
}

async function getLtlBulkQuoteJobRun(tenant: { tenantId: string }, jobRunId: string) {
  const jobRun = await prisma.automationJobRun.findFirst({
    where: {
      id: jobRunId,
      tenantId: tenant.tenantId,
      jobType: LTL_BULK_JOB_TYPE
    }
  });

  if (!jobRun) {
    throw new Error("LTL bulk quote job was not found for this tenant.");
  }
  return jobRun;
}

export async function exportLtlBulkQuoteJobCsv(tenant: TenantContext, jobRunId: string) {
  const detail = await getLtlBulkQuoteJobDetail(tenant, jobRunId);
  const rows = detail.lanes.map((lane) => {
    const carrierCells = Object.fromEntries([
      ...lane.quotes.map((quote) => [`${quote.carrierName} (${quote.scac})`, quote.total.toFixed(2)]),
      ...lane.errors.map((error) => [`${error.carrierName} (${error.scac})`, error.errorMessage])
    ]);
    const cheapestQuote = lane.quotes.reduce<LtlQuoteResult | null>(
      (current, quote) => (!current || quote.total < current.total ? quote : current),
      null
    );

    return {
      customerReference: lane.request.customerReference,
      origin: formatLaneLabel(
        lane.request.originCity,
        lane.request.originState,
        lane.request.originZipcode,
        lane.request.originCountry
      ),
      destination: formatLaneLabel(
        lane.request.destinationCity,
        lane.request.destinationState,
        lane.request.destinationZipcode,
        lane.request.destinationCountry
      ),
      totalWeight: `${lane.request.pieces.reduce((sum, piece) => sum + piece.qty * piece.weight, 0).toLocaleString("en-US")} lb`,
      ...carrierCells,
      cheapestCarrier: cheapestQuote ? `${cheapestQuote.carrierName} (${cheapestQuote.scac})` : "",
      cheapestRate: cheapestQuote ? cheapestQuote.total.toFixed(2) : ""
    };
  });

  return exportLtlResultsCsv(rows);
}

export function mapBulkJobSummary(jobRun: {
  id: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  input: Prisma.JsonValue | null;
  output: Prisma.JsonValue | null;
  errorMessage: string | null;
}): LtlBulkQuoteJobSummary {
  const input = readBulkInput(jobRun.input);
  const output = readBulkOutput(jobRun.output);

  return {
    id: jobRun.id,
    status: jobRun.status,
    name: input.name ?? null,
    accountId: input.accountId,
    accountName: input.accountName,
    selectedCarrierCount: output.selectedCarrierCount,
    totalLanes: output.totalLanes,
    processedLanes: output.processedLanes,
    quotedLanes: output.quotedLanes,
    issueLanes: output.issueLanes,
    quoteCount: output.quoteCount,
    errorCount: output.errorCount,
    startedAt: jobRun.startedAt.toISOString(),
    finishedAt: jobRun.finishedAt?.toISOString() ?? null,
    errorMessage: jobRun.errorMessage
  };
}

function buildJobOutput(
  payload: LtlBulkQuoteCreateRequestPayload,
  progress: LtlBulkQuoteProgress,
  completedAt: string | null
): LtlBulkQuoteJobOutput {
  return {
    totalLanes: payload.rows.length,
    processedLanes: progress.processedLanes,
    quotedLanes: progress.quotedLanes,
    issueLanes: progress.issueLanes,
    quoteCount: progress.quoteCount,
    errorCount: progress.errorCount,
    selectedCarrierCount: payload.carrierHashes.length,
    completedAt
  };
}

function readBulkInput(value: Prisma.JsonValue | null): LtlBulkQuoteJobInput {
  const input = (value ?? {}) as Partial<LtlBulkQuoteJobInput>;
  return {
    accountId: typeof input.accountId === "string" ? input.accountId : "",
    accountName: typeof input.accountName === "string" ? input.accountName : "",
    name: typeof input.name === "string" && input.name.trim().length > 0 ? input.name.trim() : undefined,
    carrierHashes: Array.isArray(input.carrierHashes)
      ? input.carrierHashes.filter((item): item is string => typeof item === "string")
      : [],
    rows: Array.isArray(input.rows) ? (input.rows as LtlQuoteRequest[]) : []
  };
}

function readBulkOutput(value: Prisma.JsonValue | null): LtlBulkQuoteJobOutput {
  const output = (value ?? {}) as Partial<LtlBulkQuoteJobOutput>;
  return {
    totalLanes: readNumber(output.totalLanes),
    processedLanes: readNumber(output.processedLanes),
    quotedLanes: readNumber(output.quotedLanes),
    issueLanes: readNumber(output.issueLanes),
    quoteCount: readNumber(output.quoteCount),
    errorCount: readNumber(output.errorCount),
    selectedCarrierCount: readNumber(output.selectedCarrierCount),
    completedAt: typeof output.completedAt === "string" ? output.completedAt : null
  };
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asQuoteResults(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? (value as unknown as LtlQuoteResult[]) : [];
}

function asCarrierErrors(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? (value as unknown as LtlCarrierErrorResult[]) : [];
}

function formatLaneLabel(city: string, state: string, zipcode: string, country: string) {
  const cityState = [city, state].filter(Boolean).join(", ");
  return cityState ? `${cityState} ${zipcode}`.trim() : `${zipcode} ${country}`.trim();
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<void>
) {
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
