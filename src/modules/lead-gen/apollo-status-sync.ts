import {
  ApolloStatus,
  IntegrationProvider,
  IntegrationStatus,
  JobStatus,
  ModuleKey,
  Prisma,
  ReplyStatus
} from "@prisma/client";

import {
  APOLLO_STATUS_SYNC_MAX_ATTEMPTS,
  getApolloFailureRetryAt,
  getApolloStatusSyncBatchSize,
  getApolloStatusSyncIntervalHours,
  getNextApolloSyncAt
} from "@/modules/lead-gen/apollo-status-sync-policy";
import {
  APOLLO_ENROLLMENT_CONFIRMATION_FAILED_REASON,
  APOLLO_ENROLLMENT_CONFIRMATION_TIMEOUT_MS,
  isApolloSequenceMembershipConfirmed,
  persistApolloPushJobPendingResolution,
  readApolloPendingSequenceConfirmation
} from "@/modules/lead-gen/apollo-push-jobs";
import { resolveTrackedSequenceStatus } from "@/modules/lead-gen/apollo-reengagement-policy";
import { recordCurrentContactScoreSnapshot } from "@/modules/lead-gen/contact-score-snapshot";
import { recordLeadOutcomeEvent } from "@/modules/lead-gen/score-history";
import { prisma } from "@/server/db";
import {
  ApolloRateLimitError,
  ApolloTransientError,
  fetchApolloSequenceDeliveryFailures,
  fetchApolloContactById,
  reconcileApolloContactWithDeliveryFailureEvidence,
  type ApolloContactRecord,
  type ApolloSequenceDeliveryFailure
} from "@/server/integrations/apollo";
import type { TenantContext } from "@/server/tenant-context";

export const APOLLO_STATUS_SYNC_JOB_TYPE = "lead-gen.apollo-status-sync";
const ACTIVE_JOB_WINDOW_MS = 30 * 60 * 1000;

type SyncDependencies = {
  fetchContact: typeof fetchApolloContactById;
  fetchDeliveryFailures: typeof fetchApolloSequenceDeliveryFailures;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
  recordScoreSnapshot: typeof recordCurrentContactScoreSnapshot;
  recordOutcome: typeof recordLeadOutcomeEvent;
};

const defaultDependencies: SyncDependencies = {
  fetchContact: fetchApolloContactById,
  fetchDeliveryFailures: fetchApolloSequenceDeliveryFailures,
  sleep: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => new Date(),
  recordScoreSnapshot: recordCurrentContactScoreSnapshot,
  recordOutcome: recordLeadOutcomeEvent
};

export type ApolloStatusSyncResult = {
  tenantId: string;
  jobRunId: string | null;
  status: "success" | "error" | "skipped";
  selectedContacts: number;
  syncedContacts: number;
  changedContacts: number;
  failedContacts: number;
  confirmedEnrollments: number;
  failedEnrollments: number;
  deferredContacts: number;
  retryCount: number;
  rateLimited: boolean;
  deliveryFailuresMatched: number;
  unmatchedDeliveryFailures: number;
  message: string;
};

export async function runScheduledApolloStatusSync() {
  const tenants = await prisma.tenant.findMany({
    where: {
      moduleAccess: {
        some: {
          enabled: true,
          module: { key: ModuleKey.LEAD_GEN }
        }
      },
      integrationCredentials: {
        some: {
          provider: IntegrationProvider.APOLLO,
          status: IntegrationStatus.ACTIVE
        }
      }
    },
    select: { id: true, slug: true, name: true },
    orderBy: { createdAt: "asc" }
  });

  const results: ApolloStatusSyncResult[] = [];
  for (const tenant of tenants) {
    results.push(await syncApolloStatusesForTenant({ tenantId: tenant.id, tenantSlug: tenant.slug, tenantName: tenant.name }));
  }
  return results;
}

export async function syncApolloStatusesForTenant(
  tenant: TenantContext,
  options: {
    batchSize?: number;
    dependencies?: Partial<SyncDependencies>;
  } = {}
): Promise<ApolloStatusSyncResult> {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const batchSize = Math.min(100, Math.max(1, options.batchSize ?? getApolloStatusSyncBatchSize()));
  const startedAt = dependencies.now();
  const staleBefore = new Date(startedAt.getTime() - ACTIVE_JOB_WINDOW_MS);

  await prisma.automationJobRun.updateMany({
    where: {
      tenantId: tenant.tenantId,
      jobType: APOLLO_STATUS_SYNC_JOB_TYPE,
      status: JobStatus.RUNNING,
      startedAt: { lt: staleBefore }
    },
    data: {
      status: JobStatus.ERROR,
      finishedAt: startedAt,
      errorMessage: "Apollo status sync exceeded its 30-minute lease and was closed before the next run."
    }
  });

  const activeJob = await prisma.automationJobRun.findFirst({
    where: {
      tenantId: tenant.tenantId,
      jobType: APOLLO_STATUS_SYNC_JOB_TYPE,
      status: JobStatus.RUNNING,
      startedAt: { gte: staleBefore }
    },
    select: { id: true },
    orderBy: { startedAt: "desc" }
  });
  if (activeJob) {
    return emptyResult(tenant.tenantId, "skipped", "A recent Apollo status sync is still running.");
  }

  const job = await prisma.automationJobRun.create({
    data: {
      tenantId: tenant.tenantId,
      jobType: APOLLO_STATUS_SYNC_JOB_TYPE,
      status: JobStatus.RUNNING,
      startedAt,
      input: {
        trigger: "SCHEDULED_HTTP",
        batchSize
      }
    },
    select: { id: true }
  });
  const result: ApolloStatusSyncResult = {
    ...emptyResult(tenant.tenantId, "success", "Apollo status sync completed."),
    jobRunId: job.id
  };

  try {
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId: tenant.tenantId,
        apolloContactId: { not: null },
        OR: [{ apolloNextSyncAt: null }, { apolloNextSyncAt: { lte: startedAt } }]
      },
      select: {
        id: true,
        companyId: true,
        apolloContactId: true,
        apolloPersonId: true,
        email: true,
        sequenceStatus: true,
        replyStatus: true,
        selectedSequenceId: true,
        selectedSequenceName: true,
        lastTouchAt: true,
        lastReplyAt: true,
        rawJson: true,
        apolloSyncFailureCount: true
      },
      orderBy: [{ apolloNextSyncAt: { sort: "asc", nulls: "first" } }, { updatedAt: "asc" }],
      take: batchSize
    });
    result.selectedContacts = contacts.length;
    const deliveryFailuresBySequence = new Map<
      string,
      Promise<ApolloSequenceDeliveryFailure[]>
    >();
    const matchedDeliveryFailureKeys = new Set<string>();

    for (let index = 0; index < contacts.length; index += 1) {
      const contact = contacts[index];
      const apolloContactId = contact.apolloContactId;
      if (!apolloContactId) {
        continue;
      }

      try {
        let incoming = await fetchContactWithRetry(apolloContactId, dependencies, () => {
          result.retryCount += 1;
        });
        if (contact.selectedSequenceId) {
          const selectedSequenceId = contact.selectedSequenceId;
          const deliveryFailuresPromise =
            deliveryFailuresBySequence.get(selectedSequenceId) ??
            dependencies.fetchDeliveryFailures(selectedSequenceId);
          deliveryFailuresBySequence.set(selectedSequenceId, deliveryFailuresPromise);
          const deliveryFailures = await deliveryFailuresPromise;
          incoming = reconcileApolloContactWithDeliveryFailureEvidence({
            contact: incoming,
            selectedSequenceId,
            apolloContactId,
            email: contact.email,
            deliveryFailures
          });
          const matchedFailure = findMatchingDeliveryFailure({
            failures: deliveryFailures,
            apolloContactId,
            email: contact.email
          });
          if (matchedFailure) {
            matchedDeliveryFailureKeys.add(
              deliveryFailureKey(selectedSequenceId, matchedFailure)
            );
          }
        }
        const syncedAt = dependencies.now();
        const pendingConfirmation = readApolloPendingSequenceConfirmation(contact.rawJson);
        const pendingEnrollmentConfirmed = Boolean(
          pendingConfirmation &&
          incoming.sequenceId === pendingConfirmation.sequenceId &&
          isApolloSequenceMembershipConfirmed(incoming.sequenceStatus)
        );
        const pendingEnrollmentFailed = Boolean(
          pendingConfirmation &&
          !pendingEnrollmentConfirmed &&
          syncedAt.getTime() - new Date(pendingConfirmation.acceptedAt).getTime() >=
            APOLLO_ENROLLMENT_CONFIRMATION_TIMEOUT_MS
        );
        const selectedEnrollmentConfirmed = Boolean(
          contact.selectedSequenceId &&
          incoming.sequenceId === contact.selectedSequenceId &&
          isApolloSequenceMembershipConfirmed(incoming.sequenceStatus)
        );
        const sequenceStatus = resolveTrackedSequenceStatus({
          existingStatus: contact.sequenceStatus,
          incomingStatus: incoming.sequenceStatus,
          selectedSequenceId: contact.selectedSequenceId,
          incomingSequenceId: incoming.sequenceId
        });
        const replyStatus = mergeReplyStatus(contact.replyStatus, incoming.replyStatus);
        const sequenceChanged = sequenceStatus !== contact.sequenceStatus;
        const replyChanged = replyStatus !== contact.replyStatus;
        const rawJson = mergeApolloSyncPayload(contact.rawJson, incoming, syncedAt, {
          pendingConfirmation,
          confirmed: pendingEnrollmentConfirmed,
          failed: pendingEnrollmentFailed,
          selectedEnrollmentConfirmed
        });
        let leadId: string | null = null;
        let scoreSnapshotId: string | null = null;

        if (sequenceChanged || replyChanged) {
          const lead = await prisma.lead.findFirst({
            where: { tenantId: tenant.tenantId, companyId: contact.companyId },
            select: { id: true }
          });
          const scoreSnapshot = await dependencies.recordScoreSnapshot({
            tenantId: tenant.tenantId,
            contactId: contact.id,
            trigger: "APOLLO_STATUS_SYNC"
          });
          leadId = lead?.id ?? null;
          scoreSnapshotId = scoreSnapshot?.id ?? null;
        }

        const updated = await prisma.contact.updateMany({
          where: { id: contact.id, tenantId: tenant.tenantId },
          data: {
            apolloPersonId: contact.apolloPersonId ?? incoming.apolloPersonId,
            apolloStatus: ApolloStatus.ENRICHED,
            sequenceStatus,
            replyStatus,
            selectedSequenceId: contact.selectedSequenceId ?? incoming.sequenceId,
            selectedSequenceName: contact.selectedSequenceName ?? incoming.sequenceName,
            lastTouchAt: incoming.lastTouchAt ?? contact.lastTouchAt,
            lastReplyAt: incoming.lastReplyAt ?? contact.lastReplyAt,
            rawJson,
            apolloLastSyncedAt: syncedAt,
            apolloNextSyncAt:
              pendingConfirmation && !pendingEnrollmentConfirmed && !pendingEnrollmentFailed
                ? new Date(syncedAt.getTime() + 15 * 60 * 1000)
                : getNextApolloSyncAt(syncedAt),
            apolloSyncFailureCount: 0,
            apolloSyncLastError: null
          }
        });
        if (updated.count !== 1) {
          throw new Error("The contact was removed before its Apollo status could be saved.");
        }

        result.syncedContacts += 1;
        if (pendingConfirmation && pendingEnrollmentConfirmed) {
          result.confirmedEnrollments += 1;
          await persistApolloPushJobPendingResolution({
            tenantId: tenant.tenantId,
            jobRunId: pendingConfirmation.jobRunId,
            contactId: contact.id,
            outcome: "enrolled",
            reason: `Enrollment confirmed in "${pendingConfirmation.sequenceName}".`
          });
        } else if (pendingConfirmation && pendingEnrollmentFailed) {
          result.failedEnrollments += 1;
          await persistApolloPushJobPendingResolution({
            tenantId: tenant.tenantId,
            jobRunId: pendingConfirmation.jobRunId,
            contactId: contact.id,
            outcome: "failed",
            reason: APOLLO_ENROLLMENT_CONFIRMATION_FAILED_REASON
          });
        }
        if (sequenceChanged || replyChanged) {
          result.changedContacts += 1;

          if (sequenceChanged) {
            await dependencies.recordOutcome({
              tenantId: tenant.tenantId,
              companyId: contact.companyId,
              contactId: contact.id,
              leadId,
              outcomeType: "APOLLO_SEQUENCE_STATUS_CHANGED",
              previousValue: contact.sequenceStatus,
              currentValue: sequenceStatus,
              source: "APOLLO",
              scoreSnapshotId,
              occurredAt: syncedAt,
              metadata: { trigger: "SCHEDULED_SYNC" }
            });
          }
          if (replyChanged) {
            await dependencies.recordOutcome({
              tenantId: tenant.tenantId,
              companyId: contact.companyId,
              contactId: contact.id,
              leadId,
              outcomeType: "APOLLO_REPLY_STATUS_CHANGED",
              previousValue: contact.replyStatus,
              currentValue: replyStatus,
              source: "APOLLO",
              scoreSnapshotId,
              occurredAt: syncedAt,
              metadata: { trigger: "SCHEDULED_SYNC" }
            });
          }
        }
      } catch (error) {
        result.failedContacts += 1;
        const failureCount = contact.apolloSyncFailureCount + 1;
        const message = normalizeSyncError(error);
        await prisma.contact.updateMany({
          where: { id: contact.id, tenantId: tenant.tenantId },
          data: {
            apolloSyncFailureCount: failureCount,
            apolloSyncLastError: message,
            apolloNextSyncAt: getApolloFailureRetryAt(failureCount, dependencies.now())
          }
        });

        if (error instanceof ApolloRateLimitError) {
          result.rateLimited = true;
          result.deferredContacts = contacts.length - index - 1;
          break;
        }
      }
    }

    const allDeliveryFailures = (
      await Promise.all(
        [...deliveryFailuresBySequence.entries()].map(async ([sequenceId, failures]) =>
          (await failures).map((failure) => ({ sequenceId, failure }))
        )
      )
    ).flat();
    result.deliveryFailuresMatched = matchedDeliveryFailureKeys.size;
    result.unmatchedDeliveryFailures = allDeliveryFailures.filter(
      ({ sequenceId, failure }) =>
        !matchedDeliveryFailureKeys.has(deliveryFailureKey(sequenceId, failure))
    ).length;
    result.status = result.failedContacts > 0 ? "error" : "success";
    result.message = buildResultMessage(result);
    await finishJob(job.id, result, dependencies.now());
    await writeJobAudit(tenant.tenantId, job.id, result);
    return result;
  } catch (error) {
    result.status = "error";
    result.message = normalizeSyncError(error);
    await finishJob(job.id, result, dependencies.now());
    await writeJobAudit(tenant.tenantId, job.id, result);
    return result;
  }
}

export async function getApolloStatusSyncHealth(tenant: Pick<TenantContext, "tenantId">) {
  const now = new Date();
  const [integration, trackedContacts, dueContacts, failedContacts, nextDueContact, recentJobs] = await Promise.all([
    prisma.integrationCredential.findFirst({
      where: {
        tenantId: tenant.tenantId,
        provider: IntegrationProvider.APOLLO,
        status: IntegrationStatus.ACTIVE
      },
      select: { id: true }
    }),
    prisma.contact.count({ where: { tenantId: tenant.tenantId, apolloContactId: { not: null } } }),
    prisma.contact.count({
      where: {
        tenantId: tenant.tenantId,
        apolloContactId: { not: null },
        OR: [{ apolloNextSyncAt: null }, { apolloNextSyncAt: { lte: now } }]
      }
    }),
    prisma.contact.count({
      where: { tenantId: tenant.tenantId, apolloContactId: { not: null }, apolloSyncFailureCount: { gt: 0 } }
    }),
    prisma.contact.findFirst({
      where: { tenantId: tenant.tenantId, apolloContactId: { not: null }, apolloNextSyncAt: { not: null } },
      select: { apolloNextSyncAt: true },
      orderBy: { apolloNextSyncAt: "asc" }
    }),
    prisma.automationJobRun.findMany({
      where: { tenantId: tenant.tenantId, jobType: APOLLO_STATUS_SYNC_JOB_TYPE },
      select: { id: true, status: true, startedAt: true, finishedAt: true, output: true, errorMessage: true },
      orderBy: { startedAt: "desc" },
      take: 5
    })
  ]);

  const latestSuccessfulJob = recentJobs.find((job) => job.status === JobStatus.SUCCESS) ?? null;
  return {
    enabled: Boolean(
      integration && process.env.APOLLO_STATUS_SYNC_SECRET?.trim() && process.env.APOLLO_MASTER_API?.trim()
    ),
    trackedContacts,
    dueContacts,
    failedContacts,
    nextDueAt: nextDueContact?.apolloNextSyncAt ?? null,
    latestJob: recentJobs[0] ?? null,
    lastSuccessfulAt: latestSuccessfulJob?.finishedAt ?? null,
    intervalHours: getApolloStatusSyncIntervalHours()
  };
}

async function fetchContactWithRetry(
  apolloContactId: string,
  dependencies: SyncDependencies,
  onRetry: () => void
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < APOLLO_STATUS_SYNC_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await dependencies.fetchContact(apolloContactId);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === APOLLO_STATUS_SYNC_MAX_ATTEMPTS - 1) {
        throw error;
      }
      onRetry();
      const delay = error instanceof ApolloRateLimitError && error.retryAfterMs !== null
        ? error.retryAfterMs
        : 500 * 2 ** attempt;
      await dependencies.sleep(Math.min(delay, 30_000));
    }
  }
  throw lastError;
}

function isRetryable(error: unknown) {
  return error instanceof ApolloRateLimitError || error instanceof ApolloTransientError;
}

function mergeReplyStatus(existing: ReplyStatus, incoming: ReplyStatus) {
  if (incoming === ReplyStatus.NO_REPLY) return existing;
  return replyStatusRank(incoming) >= replyStatusRank(existing) ? incoming : existing;
}

function replyStatusRank(status: ReplyStatus) {
  return {
    [ReplyStatus.NO_REPLY]: 0,
    [ReplyStatus.OUT_OF_OFFICE]: 1,
    [ReplyStatus.REPLIED]: 2,
    [ReplyStatus.NEGATIVE]: 3,
    [ReplyStatus.POSITIVE]: 4,
    [ReplyStatus.MEETING_BOOKED]: 5
  }[status];
}

function mergeApolloSyncPayload(
  rawJson: Prisma.JsonValue | null,
  incoming: ApolloContactRecord,
  syncedAt: Date,
  enrollmentConfirmation: {
    pendingConfirmation: ReturnType<typeof readApolloPendingSequenceConfirmation>;
    confirmed: boolean;
    failed: boolean;
    selectedEnrollmentConfirmed: boolean;
  }
) {
  const current = asJsonObject(rawJson);
  const apollo = asJsonObject(current.apollo);
  const withoutPending = Object.fromEntries(
    Object.entries(apollo).filter(([key]) => key !== "pendingSequenceConfirmation")
  );
  const withoutPendingOrBlocker = Object.fromEntries(
    Object.entries(withoutPending).filter(([key]) => key !== "pushBlocker")
  );
  const pending = enrollmentConfirmation.pendingConfirmation;
  const deliveryFailure = readIncomingDeliveryFailure(incoming.rawPayload);
  const enrollmentMetadata = enrollmentConfirmation.confirmed
    ? withoutPendingOrBlocker
    : enrollmentConfirmation.failed
      ? {
          ...withoutPending,
          pushBlocker: {
            reason: APOLLO_ENROLLMENT_CONFIRMATION_FAILED_REASON,
            blockedAt: syncedAt.toISOString()
          }
        }
      : pending
        ? {
            ...apollo,
            pendingSequenceConfirmation: {
              ...pending,
              attemptCount: pending.attemptCount + 1,
              lastCheckedAt: syncedAt.toISOString(),
              nextCheckAt: new Date(syncedAt.getTime() + 15 * 60 * 1000).toISOString()
            }
          }
        : enrollmentConfirmation.selectedEnrollmentConfirmed
          ? withoutPendingOrBlocker
          : apollo;
  return {
    ...current,
    apollo: {
      ...enrollmentMetadata,
      importedAt: syncedAt.toISOString(),
      record: incoming.rawPayload,
      statusSync: {
        trigger: "SCHEDULED_SYNC",
        syncedAt: syncedAt.toISOString()
      },
      ...(deliveryFailure
        ? {
            deliveryFailure: {
              ...deliveryFailure,
              detectedAt: syncedAt.toISOString()
            }
          }
        : {})
    }
  } as Prisma.InputJsonValue;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : "Apollo status sync failed.";
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

function emptyResult(tenantId: string, status: ApolloStatusSyncResult["status"], message: string): ApolloStatusSyncResult {
  return {
    tenantId,
    jobRunId: null,
    status,
    selectedContacts: 0,
    syncedContacts: 0,
    changedContacts: 0,
    failedContacts: 0,
    confirmedEnrollments: 0,
    failedEnrollments: 0,
    deferredContacts: 0,
    retryCount: 0,
    rateLimited: false,
    deliveryFailuresMatched: 0,
    unmatchedDeliveryFailures: 0,
    message
  };
}

function buildResultMessage(result: ApolloStatusSyncResult) {
  const deliverySummary =
    result.deliveryFailuresMatched > 0 || result.unmatchedDeliveryFailures > 0
      ? ` ${result.deliveryFailuresMatched} delivery failure(s) were reconciled; ${result.unmatchedDeliveryFailures} Apollo delivery failure(s) did not match a tracked contact in this sync batch.`
      : "";
  if (result.rateLimited) {
    return `Apollo rate-limited the sync after ${result.syncedContacts} contact(s); ${result.deferredContacts} contact(s) remain due.${deliverySummary}`;
  }
  if (result.failedContacts > 0) {
    return `Apollo status sync refreshed ${result.syncedContacts} contact(s) and failed ${result.failedContacts}.${deliverySummary}`;
  }
  if (result.confirmedEnrollments > 0 || result.failedEnrollments > 0) {
    return (
      `Apollo status sync refreshed ${result.syncedContacts} contact(s); ` +
      `${result.confirmedEnrollments} pending enrollment(s) were confirmed and ` +
      `${result.failedEnrollments} expired without confirmation.${deliverySummary}`
    );
  }
  return `Apollo status sync refreshed ${result.syncedContacts} contact(s); ${result.changedContacts} had new sequence or reply outcomes.${deliverySummary}`;
}

function readIncomingDeliveryFailure(rawPayload: Record<string, unknown>) {
  const failure = asJsonObject(rawPayload.newlDeliveryFailureReconciliation);
  const kind = typeof failure.kind === "string" ? failure.kind : null;
  const reason = typeof failure.reason === "string" ? failure.reason : null;
  if (!kind || !reason) {
    return null;
  }
  return {
    kind,
    reason,
    source:
      typeof failure.source === "string"
        ? failure.source
        : "APOLLO_OUTREACH_EMAIL_SEARCH",
    sequenceId:
      typeof failure.sequenceId === "string" ? failure.sequenceId : null,
    record: failure.record ?? null
  };
}

function findMatchingDeliveryFailure({
  failures,
  apolloContactId,
  email
}: {
  failures: ApolloSequenceDeliveryFailure[];
  apolloContactId: string;
  email: string | null;
}) {
  const normalizedEmail = email?.trim().toLowerCase() ?? null;
  return failures.find(
    (failure) =>
      failure.apolloContactId === apolloContactId ||
      (normalizedEmail && failure.email?.trim().toLowerCase() === normalizedEmail)
  );
}

function deliveryFailureKey(
  sequenceId: string,
  failure: ApolloSequenceDeliveryFailure
) {
  return `${sequenceId}|${failure.apolloContactId ?? failure.email?.trim().toLowerCase() ?? "unknown"}|${failure.kind}`;
}

async function finishJob(jobRunId: string, result: ApolloStatusSyncResult, finishedAt: Date) {
  await prisma.automationJobRun.update({
    where: { id: jobRunId },
    data: {
      status: result.status === "success" ? JobStatus.SUCCESS : JobStatus.ERROR,
      finishedAt,
      output: result,
      errorMessage: result.status === "error" ? result.message : null
    }
  });
}

async function writeJobAudit(tenantId: string, jobRunId: string, result: ApolloStatusSyncResult) {
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId: null,
      action: result.status === "success" ? "lead-gen.apollo-status-sync.completed" : "lead-gen.apollo-status-sync.failed",
      entityType: "AutomationJobRun",
      entityId: jobRunId,
      after: result
    }
  });
}
