import { JobStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";

export const APOLLO_PUSH_JOB_TYPE = "lead-gen.apollo-push";

export type ApolloPushJobDetailItem = {
  contactId: string;
  contactName: string;
  companyName: string;
  outcome: "enrolled" | "skipped" | "failed";
  reason: string | null;
};

export type ApolloPushJobInput = {
  contactIds: string[];
  selectedContacts: number;
  requestedAt: string;
};

export type ApolloPushJobOutput = {
  selectedContacts: number;
  processedContacts: number;
  enrolledContacts: number;
  skippedContacts: number;
  failedContacts: number;
  companiesTouched: number;
  details: ApolloPushJobDetailItem[];
  startedProcessingAt?: string | null;
  completedAt?: string | null;
};

export type ApolloPushJobSummary = {
  id: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  selectedContacts: number;
  processedContacts: number;
  enrolledContacts: number;
  skippedContacts: number;
  failedContacts: number;
  companiesTouched: number;
  completedAt: string | null;
  errorMessage: string | null;
  details: ApolloPushJobDetailItem[];
};

type ApolloPushJobRecord = {
  id: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  input: Prisma.JsonValue | null;
  output: Prisma.JsonValue | null;
};

export async function getRecentApolloPushJobs(tenant: TenantContext): Promise<ApolloPushJobSummary[]> {
  const jobs = await prisma.automationJobRun.findMany({
    where: {
      tenantId: tenant.tenantId,
      jobType: APOLLO_PUSH_JOB_TYPE
    },
    orderBy: {
      startedAt: "desc"
    },
    take: 10
  });

  return jobs.map(mapApolloPushJobSummary);
}

export async function getApolloPushJobForTenant(
  tenant: TenantContext,
  jobRunId: string
): Promise<ApolloPushJobSummary> {
  const job = await prisma.automationJobRun.findFirst({
    where: {
      id: jobRunId,
      tenantId: tenant.tenantId,
      jobType: APOLLO_PUSH_JOB_TYPE
    }
  });

  if (!job) {
    throw new Error("Apollo push job not found for this tenant.");
  }

  return mapApolloPushJobSummary(job);
}

export async function getApolloPushJobRecordForTenant(
  tenant: TenantContext,
  jobRunId: string
) {
  return prisma.automationJobRun.findFirst({
    where: {
      id: jobRunId,
      tenantId: tenant.tenantId,
      jobType: APOLLO_PUSH_JOB_TYPE
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
      input: true,
      output: true
    }
  });
}

export function createApolloPushJobOutput(selectedContacts: number, companiesTouched = 0): ApolloPushJobOutput {
  return {
    selectedContacts,
    processedContacts: 0,
    enrolledContacts: 0,
    skippedContacts: 0,
    failedContacts: 0,
    companiesTouched,
    details: [],
    startedProcessingAt: null,
    completedAt: null
  };
}

export function parseApolloPushJobInput(value: Prisma.JsonValue | null): ApolloPushJobInput | null {
  return asApolloPushJobInput(value);
}

export function mapApolloPushJobSummary(job: ApolloPushJobRecord): ApolloPushJobSummary {
  const input = asApolloPushJobInput(job.input);
  const output = asApolloPushJobOutput(job.output);

  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    selectedContacts: output?.selectedContacts ?? input?.selectedContacts ?? 0,
    processedContacts: output?.processedContacts ?? 0,
    enrolledContacts: output?.enrolledContacts ?? 0,
    skippedContacts: output?.skippedContacts ?? 0,
    failedContacts: output?.failedContacts ?? 0,
    companiesTouched: output?.companiesTouched ?? 0,
    completedAt: output?.completedAt ?? null,
    errorMessage: job.errorMessage ?? null,
    details: output?.details ?? []
  };
}

function asApolloPushJobInput(value: Prisma.JsonValue | null): ApolloPushJobInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    contactIds: Array.isArray(record.contactIds)
      ? record.contactIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    selectedContacts: typeof record.selectedContacts === "number" ? record.selectedContacts : 0,
    requestedAt: typeof record.requestedAt === "string" ? record.requestedAt : new Date(0).toISOString()
  };
}

function asApolloPushJobOutput(value: Prisma.JsonValue | null): ApolloPushJobOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    selectedContacts: typeof record.selectedContacts === "number" ? record.selectedContacts : 0,
    processedContacts: typeof record.processedContacts === "number" ? record.processedContacts : 0,
    enrolledContacts: typeof record.enrolledContacts === "number" ? record.enrolledContacts : 0,
    skippedContacts: typeof record.skippedContacts === "number" ? record.skippedContacts : 0,
    failedContacts: typeof record.failedContacts === "number" ? record.failedContacts : 0,
    companiesTouched: typeof record.companiesTouched === "number" ? record.companiesTouched : 0,
    details: Array.isArray(record.details)
      ? record.details.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return [];
          }

          const item = entry as Record<string, unknown>;
          const outcome = item.outcome;
          if (outcome !== "enrolled" && outcome !== "skipped" && outcome !== "failed") {
            return [];
          }

          return [
            {
              contactId: typeof item.contactId === "string" ? item.contactId : "",
              contactName: typeof item.contactName === "string" ? item.contactName : "Unknown contact",
              companyName: typeof item.companyName === "string" ? item.companyName : "Unknown company",
              outcome,
              reason: typeof item.reason === "string" ? item.reason : null
            } satisfies ApolloPushJobDetailItem
          ];
        })
      : [],
    startedProcessingAt: typeof record.startedProcessingAt === "string" ? record.startedProcessingAt : null,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : null
  };
}
