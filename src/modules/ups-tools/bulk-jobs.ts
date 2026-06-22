import { JobStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import type {
  QuoteResult,
  UpsAccountConfig,
  UpsBulkQuoteJobDetail,
  UpsBulkQuoteJobSummary,
  UpsInputRow,
  UpsQuoteIssue,
  UpsServiceName
} from "@/modules/ups-tools/types";
import { getShipmentReference } from "@/modules/ups-tools/upload";

export const UPS_BULK_JOB_TYPE = "ups-tools.bulk-rate-quote";
export const UPS_BULK_ROW_CHUNK_SIZE = 25;
export const UPS_BULK_REQUEST_CONCURRENCY = 4;
export const UPS_BULK_CHUNK_DELAY_MS = 400;

type UpsBulkQuoteJobInput = {
  name?: string;
  accountIds: string[];
  accountNames: string[];
  services: UpsServiceName[];
  rows: UpsInputRow[];
  isResidential: boolean;
};

type UpsBulkQuoteJobOutput = {
  rowCount: number;
  accountCount: number;
  serviceCount: number;
  totalRequestCount: number;
  processedRequestCount: number;
  quoteCount: number;
  issueCount: number;
  chunkSize: number;
  chunkCount: number;
  requestConcurrency: number;
  results: QuoteResult[];
  issues: UpsQuoteIssue[];
};

type BulkJobActorContext = {
  tenantId: string;
  userId: string | null;
};

export async function createUpsBulkQuoteJob(
  tenant: BulkJobActorContext,
  payload: {
    name?: string;
    accounts: UpsAccountConfig[];
    services: UpsServiceName[];
    rows: UpsInputRow[];
    isResidential: boolean;
    results: QuoteResult[];
    status?: JobStatus;
    errorMessage?: string | null;
    rowCount?: number;
    processedRequestCount?: number;
    issues?: UpsQuoteIssue[];
  }
) {
  const input: UpsBulkQuoteJobInput = {
    name: payload.name?.trim() ? payload.name.trim() : undefined,
    accountIds: payload.accounts.map((account) => account.id),
    accountNames: payload.accounts.map((account) => account.name),
    services: payload.services,
    rows: payload.rows,
    isResidential: payload.isResidential
  };

  const output: UpsBulkQuoteJobOutput = {
    rowCount: payload.rowCount ?? payload.rows.length,
    accountCount: payload.accounts.length,
    serviceCount: payload.services.length,
    totalRequestCount: (payload.rowCount ?? payload.rows.length) * payload.accounts.length * payload.services.length,
    processedRequestCount: payload.processedRequestCount ?? payload.results.length,
    quoteCount: payload.results.length,
    issueCount: payload.issues?.length ?? 0,
    chunkSize: UPS_BULK_ROW_CHUNK_SIZE,
    chunkCount: Math.ceil((payload.rowCount ?? payload.rows.length) / UPS_BULK_ROW_CHUNK_SIZE),
    requestConcurrency: UPS_BULK_REQUEST_CONCURRENCY,
    results: payload.results,
    issues: payload.issues ?? []
  };

  const jobRun = await prisma.automationJobRun.create({
    data: {
      tenantId: tenant.tenantId,
      jobType: UPS_BULK_JOB_TYPE,
      status: payload.status ?? JobStatus.SUCCESS,
      startedAt: new Date(),
      finishedAt:
        payload.status === JobStatus.QUEUED || payload.status === JobStatus.RUNNING ? null : new Date(),
      errorMessage: payload.errorMessage ?? null,
      input,
      output
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      action: "ups.bulk-job.saved",
      entityType: "AutomationJobRun",
      entityId: jobRun.id,
      after: {
        name: input.name ?? null,
        accountIds: input.accountIds,
        accountNames: input.accountNames,
        services: input.services,
        rowCount: output.rowCount,
        totalRequestCount: output.totalRequestCount,
        quoteCount: output.quoteCount,
        status: payload.status ?? JobStatus.SUCCESS,
        errorMessage: payload.errorMessage ?? null
      }
    }
  });

  return mapUpsBulkJobSummary(jobRun);
}

export async function runUpsBulkQuoteJob(
  tenant: BulkJobActorContext,
  jobRunId: string,
  payload: {
    accounts: UpsAccountConfig[];
    services: UpsServiceName[];
    rows: UpsInputRow[];
    isResidential: boolean;
  },
  quoteRunner: (account: UpsAccountConfig, row: UpsInputRow, service: UpsServiceName, isResidential: boolean) => Promise<QuoteResult>
) {
  const validRows = payload.rows.filter((row) => {
    const destinationPostalCode = (row.DestinationZIP ?? "").trim();
    const weight = Number.parseFloat(row.Weight ?? "0");
    return destinationPostalCode.length > 0 && !Number.isNaN(weight);
  });

  const totalRequestCount = validRows.length * payload.accounts.length * payload.services.length;
  const results: QuoteResult[] = [];
  const issues: UpsQuoteIssue[] = [];
  let processedRequestCount = 0;

  try {
    await prisma.automationJobRun.update({
      where: { id: jobRunId, tenantId: tenant.tenantId },
      data: {
        status: JobStatus.RUNNING,
        output: buildUpsBulkOutput(payload, validRows.length, results, issues, processedRequestCount)
      }
    });

    for (const account of payload.accounts) {
      for (let start = 0; start < validRows.length; start += UPS_BULK_ROW_CHUNK_SIZE) {
        const chunk = validRows.slice(start, start + UPS_BULK_ROW_CHUNK_SIZE);
        const chunkRequests = chunk.flatMap((row) =>
          payload.services.map((service) => ({
            row,
            service
          }))
        );

        await mapWithConcurrency(chunkRequests, UPS_BULK_REQUEST_CONCURRENCY, async ({ row, service }) => {
          try {
            const quote = await quoteRunner(account, row, service, payload.isResidential);
            results.push(quote);
          } catch (error) {
            issues.push(buildUpsQuoteIssue(account, row, service, payload.isResidential, error));
          } finally {
            processedRequestCount += 1;
          }
        });

        await prisma.automationJobRun.update({
          where: { id: jobRunId, tenantId: tenant.tenantId },
          data: {
            output: buildUpsBulkOutput(payload, validRows.length, results, issues, processedRequestCount)
          }
        });

        const hasAnotherChunk = start + UPS_BULK_ROW_CHUNK_SIZE < validRows.length;
        if (hasAnotherChunk) {
          await sleep(UPS_BULK_CHUNK_DELAY_MS);
        }
      }
    }

    await prisma.automationJobRun.update({
      where: { id: jobRunId, tenantId: tenant.tenantId },
      data: {
        status: JobStatus.SUCCESS,
        finishedAt: new Date(),
        errorMessage: null,
        output: buildUpsBulkOutput(payload, validRows.length, results, issues, totalRequestCount)
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "ups.bulk-job.completed",
        entityType: "AutomationJobRun",
        entityId: jobRunId,
        after: {
          rowCount: validRows.length,
          totalRequestCount,
          quoteCount: results.length,
          issueCount: issues.length
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected UPS bulk quote error.";

    await prisma.automationJobRun.update({
      where: { id: jobRunId, tenantId: tenant.tenantId },
      data: {
        status: JobStatus.ERROR,
        finishedAt: new Date(),
        errorMessage: message,
        output: buildUpsBulkOutput(payload, validRows.length, results, issues, processedRequestCount)
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        actorUserId: tenant.userId,
        action: "ups.bulk-job.failed",
        entityType: "AutomationJobRun",
        entityId: jobRunId,
        after: {
          rowCount: validRows.length,
          processedRequestCount,
          totalRequestCount,
          quoteCount: results.length,
          issueCount: issues.length,
          errorMessage: message
        }
      }
    });
  }
}

export async function getRecentUpsBulkQuoteJobs(tenant: TenantContext) {
  const jobs = await prisma.automationJobRun.findMany({
    where: {
      tenantId: tenant.tenantId,
      jobType: UPS_BULK_JOB_TYPE
    },
    orderBy: {
      startedAt: "desc"
    },
    take: 25
  });

  return jobs.map(mapUpsBulkJobSummary);
}

export async function getUpsBulkQuoteJobDetail(
  tenant: TenantContext,
  jobRunId: string
): Promise<UpsBulkQuoteJobDetail> {
  const jobRun = await getUpsBulkQuoteJobRun(tenant, jobRunId);
  const input = readBulkInput(jobRun.input);
  const output = readBulkOutput(jobRun.output);

  return {
    job: mapUpsBulkJobSummary(jobRun),
    rows: input.rows,
    results: output.results,
    issues: output.issues,
    isResidential: input.isResidential
  };
}

export async function getUpsBulkQuoteJobSummaryForTenant(tenant: TenantContext, jobRunId: string) {
  const jobRun = await getUpsBulkQuoteJobRun(tenant, jobRunId);
  return mapUpsBulkJobSummary(jobRun);
}

export async function deleteUpsBulkQuoteJob(tenant: BulkJobActorContext, jobRunId: string) {
  const jobRun = await getUpsBulkQuoteJobRun(tenant, jobRunId);
  const summary = mapUpsBulkJobSummary(jobRun);

  await prisma.automationJobRun.delete({
    where: {
      id: jobRun.id
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      actorUserId: tenant.userId,
      action: "ups.bulk-job.deleted",
      entityType: "AutomationJobRun",
      entityId: jobRun.id,
      before: {
        name: summary.name,
        accountIds: summary.accountIds,
        services: summary.services,
        rowCount: summary.rowCount,
        quoteCount: summary.quoteCount
      }
    }
  });
}

async function getUpsBulkQuoteJobRun(tenant: Pick<TenantContext, "tenantId">, jobRunId: string) {
  const jobRun = await prisma.automationJobRun.findFirst({
    where: {
      id: jobRunId,
      tenantId: tenant.tenantId,
      jobType: UPS_BULK_JOB_TYPE
    }
  });

  if (!jobRun) {
    throw new Error("UPS bulk quote job was not found for this tenant.");
  }

  return jobRun;
}

export function mapUpsBulkJobSummary(jobRun: {
  id: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  input: Prisma.JsonValue | null;
  output: Prisma.JsonValue | null;
  errorMessage: string | null;
}): UpsBulkQuoteJobSummary {
  const input = readBulkInput(jobRun.input);
  const output = readBulkOutput(jobRun.output);

  return {
    id: jobRun.id,
    status: jobRun.status,
    name: input.name ?? null,
    accountIds: input.accountIds,
    accountNames: input.accountNames,
    services: input.services,
    rowCount: output.rowCount,
    accountCount: output.accountCount,
    serviceCount: output.serviceCount,
    totalRequestCount: output.totalRequestCount,
    processedRequestCount: output.processedRequestCount,
    quoteCount: output.quoteCount,
    issueCount: output.issueCount,
    chunkSize: output.chunkSize,
    chunkCount: output.chunkCount,
    requestConcurrency: output.requestConcurrency,
    startedAt: jobRun.startedAt.toISOString(),
    finishedAt: jobRun.finishedAt?.toISOString() ?? null,
    errorMessage: jobRun.errorMessage
  };
}

function readBulkInput(value: Prisma.JsonValue | null): UpsBulkQuoteJobInput {
  const input = (value ?? {}) as Partial<UpsBulkQuoteJobInput>;
  return {
    name: typeof input.name === "string" && input.name.trim().length > 0 ? input.name.trim() : undefined,
    accountIds: Array.isArray(input.accountIds)
      ? input.accountIds.filter((item): item is string => typeof item === "string")
      : [],
    accountNames: Array.isArray(input.accountNames)
      ? input.accountNames.filter((item): item is string => typeof item === "string")
      : [],
    services: Array.isArray(input.services)
      ? input.services.filter((item): item is UpsServiceName => typeof item === "string")
      : [],
    rows: Array.isArray(input.rows) ? (input.rows as UpsInputRow[]) : [],
    isResidential: input.isResidential === true
  };
}

function readBulkOutput(value: Prisma.JsonValue | null): UpsBulkQuoteJobOutput {
  const output = (value ?? {}) as Partial<UpsBulkQuoteJobOutput>;
  return {
    rowCount: typeof output.rowCount === "number" && Number.isFinite(output.rowCount) ? output.rowCount : 0,
    accountCount: typeof output.accountCount === "number" && Number.isFinite(output.accountCount) ? output.accountCount : 0,
    serviceCount: typeof output.serviceCount === "number" && Number.isFinite(output.serviceCount) ? output.serviceCount : 0,
    totalRequestCount:
      typeof output.totalRequestCount === "number" && Number.isFinite(output.totalRequestCount)
        ? output.totalRequestCount
        : 0,
    processedRequestCount:
      typeof output.processedRequestCount === "number" && Number.isFinite(output.processedRequestCount)
        ? output.processedRequestCount
        : 0,
    quoteCount: typeof output.quoteCount === "number" && Number.isFinite(output.quoteCount) ? output.quoteCount : 0,
    issueCount: typeof output.issueCount === "number" && Number.isFinite(output.issueCount) ? output.issueCount : 0,
    chunkSize: typeof output.chunkSize === "number" && Number.isFinite(output.chunkSize) ? output.chunkSize : UPS_BULK_ROW_CHUNK_SIZE,
    chunkCount: typeof output.chunkCount === "number" && Number.isFinite(output.chunkCount) ? output.chunkCount : 0,
    requestConcurrency:
      typeof output.requestConcurrency === "number" && Number.isFinite(output.requestConcurrency)
        ? output.requestConcurrency
        : UPS_BULK_REQUEST_CONCURRENCY,
    results: Array.isArray(output.results) ? (output.results as QuoteResult[]) : [],
    issues: Array.isArray(output.issues) ? (output.issues as UpsQuoteIssue[]) : []
  };
}

function buildUpsBulkOutput(
  payload: {
    accounts: UpsAccountConfig[];
    services: UpsServiceName[];
  },
  rowCount: number,
  results: QuoteResult[],
  issues: UpsQuoteIssue[],
  processedRequestCount: number
): UpsBulkQuoteJobOutput {
  return {
    rowCount,
    accountCount: payload.accounts.length,
    serviceCount: payload.services.length,
    totalRequestCount: rowCount * payload.accounts.length * payload.services.length,
    processedRequestCount,
    quoteCount: results.length,
    issueCount: issues.length,
    chunkSize: UPS_BULK_ROW_CHUNK_SIZE,
    chunkCount: Math.ceil(rowCount / UPS_BULK_ROW_CHUNK_SIZE),
    requestConcurrency: UPS_BULK_REQUEST_CONCURRENCY,
    results,
    issues
  };
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

function buildUpsQuoteIssue(
  account: UpsAccountConfig,
  row: UpsInputRow,
  service: UpsServiceName,
  isResidential: boolean,
  error: unknown
): UpsQuoteIssue {
  const destinationPostalCode = (row.DestinationZIP ?? "").trim();
  const originPostalCode = (row.OriginZIP ?? account.originPostalCode).trim();
  const weight = Number.parseFloat(row.Weight ?? "0");
  const length = Number.parseFloat(row.Length ?? "0") || 0;
  const width = Number.parseFloat(row.Width ?? "0") || 0;
  const height = Number.parseFloat(row.Height ?? "0") || 0;

  return {
    shipmentReference: getShipmentReference(row),
    originPostalCode,
    originCountryCode: account.countryCode,
    destinationPostalCode,
    destinationCountryCode: inferCountryCodeFromPostalCode(destinationPostalCode),
    weight: Number.isFinite(weight) ? weight : 0,
    length,
    width,
    height,
    service,
    isResidential,
    accountId: account.id,
    accountName: account.name,
    accountShipperNumber: account.shipperNumber,
    mode: account.dryRun ? "dry-run" : "live",
    errorMessage: error instanceof Error ? error.message : "Unexpected UPS quote error."
  };
}

function inferCountryCodeFromPostalCode(postalCode: string): "US" | "CA" {
  return /[A-Za-z]/.test(postalCode) ? "CA" : "US";
}

function sleep(timeoutMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
