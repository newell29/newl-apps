import {
  ApolloStatus,
  IntegrationProvider,
  IntegrationStatus,
  JobStatus,
  ModuleKey,
  Prisma,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";

import {
  APOLLO_STATUS_SYNC_MAX_ATTEMPTS,
  getApolloFailureRetryAt,
  getApolloStatusSyncBatchSize,
  getApolloStatusSyncIntervalHours,
  getNextApolloSyncAt
} from "@/modules/lead-gen/apollo-status-sync-policy";
import { recordCurrentContactScoreSnapshot } from "@/modules/lead-gen/contact-score-snapshot";
import { recordLeadOutcomeEvent } from "@/modules/lead-gen/score-history";
import { prisma } from "@/server/db";
import {
  ApolloRateLimitError,
  ApolloTransientError,
  fetchApolloContactById,
  type ApolloContactRecord
} from "@/server/integrations/apollo";
import type { TenantContext } from "@/server/tenant-context";

export const APOLLO_STATUS_SYNC_JOB_TYPE = "lead-gen.apollo-status-sync";
const ACTIVE_JOB_WINDOW_MS = 30 * 60 * 1000;

type SyncDependencies = {
  fetchContact: typeof fetchApolloContactById;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
  recordScoreSnapshot: typeof recordCurrentContactScoreSnapshot;
  recordOutcome: typeof recordLeadOutcomeEvent;
};

const defaultDependencies: SyncDependencies = {
  fetchContact: fetchApolloContactById,
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
  deferredContacts: number;
  retryCount: number;
  rateLimited: boolean;
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
        trigger: "VERCEL_CRON",
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

    for (let index = 0; index < contacts.length; index += 1) {
      const contact = contacts[index];
      const apolloContactId = contact.apolloContactId;
      if (!apolloContactId) {
        continue;
      }

      try {
        const incoming = await fetchContactWithRetry(apolloContactId, dependencies, () => {
          result.retryCount += 1;
        });
        const syncedAt = dependencies.now();
        const sequenceStatus = mergeSequenceStatus(contact.sequenceStatus, incoming.sequenceStatus);
        const replyStatus = mergeReplyStatus(contact.replyStatus, incoming.replyStatus);
        const sequenceChanged = sequenceStatus !== contact.sequenceStatus;
        const replyChanged = replyStatus !== contact.replyStatus;
        const rawJson = mergeApolloSyncPayload(contact.rawJson, incoming, syncedAt);

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
            apolloNextSyncAt: getNextApolloSyncAt(syncedAt),
            apolloSyncFailureCount: 0,
            apolloSyncLastError: null
          }
        });
        if (updated.count !== 1) {
          throw new Error("The contact was removed before its Apollo status could be saved.");
        }

        result.syncedContacts += 1;
        if (sequenceChanged || replyChanged) {
          result.changedContacts += 1;
          const lead = await prisma.lead.findFirst({
            where: { tenantId: tenant.tenantId, companyId: contact.companyId },
            select: { id: true }
          });
          const scoreSnapshot = await dependencies.recordScoreSnapshot({
            tenantId: tenant.tenantId,
            contactId: contact.id,
            trigger: "APOLLO_STATUS_SYNC"
          });

          if (sequenceChanged) {
            await dependencies.recordOutcome({
              tenantId: tenant.tenantId,
              companyId: contact.companyId,
              contactId: contact.id,
              leadId: lead?.id ?? null,
              outcomeType: "APOLLO_SEQUENCE_STATUS_CHANGED",
              previousValue: contact.sequenceStatus,
              currentValue: sequenceStatus,
              source: "APOLLO",
              scoreSnapshotId: scoreSnapshot?.id ?? null,
              occurredAt: syncedAt,
              metadata: { trigger: "SCHEDULED_SYNC" }
            });
          }
          if (replyChanged) {
            await dependencies.recordOutcome({
              tenantId: tenant.tenantId,
              companyId: contact.companyId,
              contactId: contact.id,
              leadId: lead?.id ?? null,
              outcomeType: "APOLLO_REPLY_STATUS_CHANGED",
              previousValue: contact.replyStatus,
              currentValue: replyStatus,
              source: "APOLLO",
              scoreSnapshotId: scoreSnapshot?.id ?? null,
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
    enabled: Boolean(integration && process.env.CRON_SECRET?.trim() && process.env.APOLLO_MASTER_API?.trim()),
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

function mergeSequenceStatus(existing: SequenceStatus, incoming: SequenceStatus) {
  if (incoming === SequenceStatus.NOT_STARTED) return existing;
  return sequenceStatusRank(incoming) >= sequenceStatusRank(existing) ? incoming : existing;
}

function sequenceStatusRank(status: SequenceStatus) {
  return {
    [SequenceStatus.NOT_STARTED]: 0,
    [SequenceStatus.READY]: 1,
    [SequenceStatus.ENROLLED]: 2,
    [SequenceStatus.PAUSED]: 3,
    [SequenceStatus.REPLIED]: 4,
    [SequenceStatus.BOUNCED]: 5,
    [SequenceStatus.FINISHED]: 6
  }[status];
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

function mergeApolloSyncPayload(rawJson: Prisma.JsonValue | null, incoming: ApolloContactRecord, syncedAt: Date) {
  const current = asJsonObject(rawJson);
  const apollo = asJsonObject(current.apollo);
  return {
    ...current,
    apollo: {
      ...apollo,
      importedAt: syncedAt.toISOString(),
      record: incoming.rawPayload,
      statusSync: {
        trigger: "SCHEDULED_SYNC",
        syncedAt: syncedAt.toISOString()
      }
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
    deferredContacts: 0,
    retryCount: 0,
    rateLimited: false,
    message
  };
}

function buildResultMessage(result: ApolloStatusSyncResult) {
  if (result.rateLimited) {
    return `Apollo rate-limited the sync after ${result.syncedContacts} contact(s); ${result.deferredContacts} contact(s) remain due.`;
  }
  if (result.failedContacts > 0) {
    return `Apollo status sync refreshed ${result.syncedContacts} contact(s) and failed ${result.failedContacts}.`;
  }
  return `Apollo status sync refreshed ${result.syncedContacts} contact(s); ${result.changedContacts} had new sequence or reply outcomes.`;
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
