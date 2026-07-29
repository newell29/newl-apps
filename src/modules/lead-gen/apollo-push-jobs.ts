import { JobStatus, SequenceStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";

export const APOLLO_PUSH_JOB_TYPE = "lead-gen.apollo-push";
export const APOLLO_PROPAGATION_PENDING_REASON =
  "Apollo accepted the push, but the cadence enrollment is still propagating in Apollo and was not visible during Newl Apps verification.";
export const APOLLO_ENROLLMENT_CONFIRMATION_TIMEOUT_MS = 10 * 60 * 1000;
export const APOLLO_ENROLLMENT_CONFIRMATION_FAILED_REASON =
  "Apollo accepted the enrollment request, but the contact was still not present in the requested cadence after 10 minutes. Review the Apollo contact stage, email eligibility, and prior cadence history before retrying.";

export type ApolloPushJobDetailItem = {
  contactId: string;
  contactName: string;
  companyName: string;
  outcome: "enrolled" | "pending" | "skipped" | "failed";
  reason: string | null;
};

export type ApolloPendingSequenceConfirmation = {
  sequenceId: string;
  sequenceName: string;
  jobRunId: string;
  acceptedAt: string;
  attemptCount: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
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
  pendingContacts: number;
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
  pendingContacts: number;
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
    pendingContacts: 0,
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

export function parseApolloPushJobOutput(value: Prisma.JsonValue | null): ApolloPushJobOutput | null {
  return asApolloPushJobOutput(value);
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
    pendingContacts: output?.pendingContacts ?? 0,
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
  const details = Array.isArray(record.details)
    ? record.details.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return [];
        }

        const item = entry as Record<string, unknown>;
        const rawOutcome = item.outcome;
        const reason = typeof item.reason === "string" ? item.reason : null;
        const outcome =
          rawOutcome === "skipped" && reason === APOLLO_PROPAGATION_PENDING_REASON
            ? "pending"
            : rawOutcome;
        if (
          outcome !== "enrolled" &&
          outcome !== "pending" &&
          outcome !== "skipped" &&
          outcome !== "failed"
        ) {
          return [];
        }

        return [
          {
            contactId: typeof item.contactId === "string" ? item.contactId : "",
            contactName: typeof item.contactName === "string" ? item.contactName : "Unknown contact",
            companyName: typeof item.companyName === "string" ? item.companyName : "Unknown company",
            outcome,
            reason
          } satisfies ApolloPushJobDetailItem
        ];
      })
    : [];

  return {
    selectedContacts: typeof record.selectedContacts === "number" ? record.selectedContacts : 0,
    processedContacts: typeof record.processedContacts === "number" ? record.processedContacts : 0,
    enrolledContacts: details.filter((detail) => detail.outcome === "enrolled").length,
    pendingContacts: details.filter((detail) => detail.outcome === "pending").length,
    skippedContacts: details.filter((detail) => detail.outcome === "skipped").length,
    failedContacts: details.filter((detail) => detail.outcome === "failed").length,
    companiesTouched: typeof record.companiesTouched === "number" ? record.companiesTouched : 0,
    details,
    startedProcessingAt: typeof record.startedProcessingAt === "string" ? record.startedProcessingAt : null,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : null
  };
}

export function isApolloPushJobDetailPending(detail: ApolloPushJobDetailItem) {
  return detail.outcome === "pending" ||
    (detail.outcome === "skipped" && detail.reason === APOLLO_PROPAGATION_PENDING_REASON);
}

export function isApolloSequenceMembershipConfirmed(status: SequenceStatus) {
  return (
    status === SequenceStatus.READY ||
    status === SequenceStatus.ENROLLED ||
    status === SequenceStatus.PAUSED
  );
}

export function recalculateApolloPushJobOutput(
  output: ApolloPushJobOutput,
  details: ApolloPushJobDetailItem[]
): ApolloPushJobOutput {
  return {
    ...output,
    enrolledContacts: details.filter((detail) => detail.outcome === "enrolled").length,
    pendingContacts: details.filter((detail) => detail.outcome === "pending").length,
    skippedContacts: details.filter((detail) => detail.outcome === "skipped").length,
    failedContacts: details.filter((detail) => detail.outcome === "failed").length,
    details
  };
}

export function readApolloPendingSequenceConfirmation(
  rawJson: Prisma.JsonValue | null,
  expectedJobRunId?: string
): ApolloPendingSequenceConfirmation | null {
  const root = asRecord(rawJson);
  const apolloData = asRecord(root.apollo);
  const pending = asRecord(apolloData.pendingSequenceConfirmation);

  const sequenceId = readString(pending.sequenceId);
  const sequenceName = readString(pending.sequenceName);
  const jobRunId = readString(pending.jobRunId);
  const acceptedAt = readString(pending.acceptedAt);
  if (
    !sequenceId ||
    !sequenceName ||
    !jobRunId ||
    !acceptedAt ||
    (expectedJobRunId && jobRunId !== expectedJobRunId) ||
    !Number.isFinite(new Date(acceptedAt).getTime())
  ) {
    return null;
  }

  const rawAttemptCount = pending.attemptCount;
  return {
    sequenceId,
    sequenceName,
    jobRunId,
    acceptedAt,
    attemptCount:
      typeof rawAttemptCount === "number" && Number.isInteger(rawAttemptCount) && rawAttemptCount >= 0
        ? rawAttemptCount
        : 0,
    lastCheckedAt: readString(pending.lastCheckedAt),
    nextCheckAt: readString(pending.nextCheckAt)
  };
}

export async function persistApolloPushJobPendingResolution({
  tenantId,
  jobRunId,
  contactId,
  outcome,
  reason
}: {
  tenantId: string;
  jobRunId: string;
  contactId: string;
  outcome: "enrolled" | "failed";
  reason: string;
}) {
  const job = await prisma.automationJobRun.findFirst({
    where: {
      id: jobRunId,
      tenantId,
      jobType: APOLLO_PUSH_JOB_TYPE
    },
    select: {
      id: true,
      output: true
    }
  });
  const output = job ? parseApolloPushJobOutput(job.output) : null;
  if (!job || !output) {
    return false;
  }

  let changed = false;
  const details = output.details.map((detail) => {
    if (detail.contactId !== contactId || !isApolloPushJobDetailPending(detail)) {
      return detail;
    }
    changed = true;
    return {
      ...detail,
      outcome,
      reason
    } satisfies ApolloPushJobDetailItem;
  });
  if (!changed) {
    return false;
  }

  const nextOutput = recalculateApolloPushJobOutput(output, details);
  const isCompleteFailure =
    nextOutput.pendingContacts === 0 &&
    nextOutput.failedContacts > 0 &&
    nextOutput.enrolledContacts === 0;
  await prisma.automationJobRun.update({
    where: {
      id: job.id
    },
    data: {
      output: nextOutput,
      status: isCompleteFailure ? JobStatus.ERROR : JobStatus.SUCCESS,
      errorMessage: isCompleteFailure
        ? nextOutput.details.find((detail) => detail.outcome === "failed")?.reason ?? "Apollo push failed."
        : null
    }
  });
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId: null,
      action:
        outcome === "enrolled"
          ? "lead-gen.apollo-push.pending-confirmed"
          : "lead-gen.apollo-push.pending-failed",
      entityType: "Contact",
      entityId: contactId,
      after: {
        jobRunId,
        outcome,
        reason
      }
    }
  });

  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
