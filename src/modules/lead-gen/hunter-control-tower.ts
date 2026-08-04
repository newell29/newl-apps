import {
  ContactStatus,
  OutreachPlanStatus,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";

import { getApolloStatusSyncHealth } from "@/modules/lead-gen/apollo-status-sync";
import { getHunterControlPlane } from "@/modules/lead-gen/hunter-queries";
import {
  getApolloIdentityResolutionMetrics,
  getApolloMatchReviewQueue,
  getTradeMiningSearchProfiles
} from "@/modules/lead-gen/queries";
import { VISIBLE_OUTREACH_PLAN_VERSION_WHERE } from "@/modules/lead-gen/outreach-plan";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";

export type HunterTowerTone = "healthy" | "running" | "attention" | "waiting";

export async function getHunterControlTower(tenant: TenantContext, now = new Date()) {
  const [
    controlPlane,
    searchProfiles,
    apolloReviewRows,
    identityMetrics,
    apolloSyncHealth,
    needsAttentionContacts,
    activeCadenceContacts,
    deliveryFailureContacts,
    engagedContacts,
    meetingContacts
  ] = await Promise.all([
    getHunterControlPlane(tenant),
    getTradeMiningSearchProfiles(tenant),
    getApolloMatchReviewQueue(tenant),
    getApolloIdentityResolutionMetrics(tenant, now),
    getApolloStatusSyncHealth(tenant),
    prisma.contact.count({
      where: {
        tenantId: tenant.tenantId,
        email: { not: null },
        contactStatus: { notIn: [ContactStatus.REJECTED, ContactStatus.DO_NOT_CONTACT] },
        replyStatus: { notIn: [ReplyStatus.POSITIVE, ReplyStatus.MEETING_BOOKED, ReplyStatus.NEGATIVE] },
        sequenceStatus: {
          notIn: [SequenceStatus.ENROLLED, SequenceStatus.FINISHED, SequenceStatus.BOUNCED]
        },
        OR: [
          { contactStatus: ContactStatus.APPROVED },
          { sequenceStatus: { in: [SequenceStatus.READY, SequenceStatus.PAUSED, SequenceStatus.REPLIED] } },
          { outreachDrafts: { some: { tenantId: tenant.tenantId } } },
          {
            outreachPlans: {
              some: {
                tenantId: tenant.tenantId,
                status: { not: OutreachPlanStatus.ARCHIVED },
                ...VISIBLE_OUTREACH_PLAN_VERSION_WHERE
              }
            }
          }
        ]
      }
    }),
    prisma.contact.count({
      where: {
        tenantId: tenant.tenantId,
        email: { not: null },
        contactStatus: { notIn: [ContactStatus.REJECTED, ContactStatus.DO_NOT_CONTACT] },
        replyStatus: { notIn: [ReplyStatus.POSITIVE, ReplyStatus.MEETING_BOOKED, ReplyStatus.NEGATIVE] },
        sequenceStatus: SequenceStatus.ENROLLED
      }
    }),
    prisma.contact.count({
      where: {
        tenantId: tenant.tenantId,
        sequenceStatus: SequenceStatus.BOUNCED
      }
    }),
    prisma.contact.count({
      where: {
        tenantId: tenant.tenantId,
        replyStatus: { in: [ReplyStatus.REPLIED, ReplyStatus.POSITIVE] },
        outreachPlans: { some: { tenantId: tenant.tenantId } }
      }
    }),
    prisma.contact.count({
      where: {
        tenantId: tenant.tenantId,
        replyStatus: ReplyStatus.MEETING_BOOKED,
        outreachPlans: { some: { tenantId: tenant.tenantId } }
      }
    })
  ]);

  const timeZone = controlPlane.policy.scheduleTimezone;
  const today = localDate(now, timeZone);
  const enabledProfiles = searchProfiles.profiles.filter((profile) => profile.enabled);
  const profilesRunToday = enabledProfiles.filter(
    (profile) => profile.lastRunAt &&
      localDate(profile.lastRunAt, profile.scheduleTimezone) === localDate(now, profile.scheduleTimezone)
  );
  const completedProfiles = profilesRunToday.filter((profile) =>
    ["COMPLETED", "PARTIAL", "SUCCESS"].includes(profile.lastRunStatus.toUpperCase())
  );
  const failedProfiles = profilesRunToday.filter((profile) =>
    ["FAILED", "ERROR"].includes(profile.lastRunStatus.toUpperCase())
  );
  const runningProfiles = profilesRunToday.filter((profile) =>
    ["RUNNING", "QUEUED"].includes(profile.lastRunStatus.toUpperCase())
  );
  const tradeMiningQualifyingCompanies = completedProfiles.reduce(
    (sum, profile) => sum + (profile.coverage?.qualifyingCompanies ?? 0),
    0
  );
  const tradeMiningMatches = completedProfiles.reduce(
    (sum, profile) => sum + (profile.coverage?.matchedRecords ?? 0),
    0
  );
  const tradeMiningExports = completedProfiles.reduce(
    (sum, profile) => sum + (profile.coverage?.exportedRecords ?? 0),
    0
  );

  const scoutRun = isRunToday(controlPlane.latestSignalScoutRun?.startedAt, today, timeZone)
    ? controlPlane.latestSignalScoutRun
    : null;
  const scoutOutput = record(scoutRun?.output);
  const researchRun = isRunToday(controlPlane.latestCompanyResearchRun?.startedAt, today, timeZone)
    ? controlPlane.latestCompanyResearchRun
    : null;
  const researchOutput = record(researchRun?.output);
  const researchSelection = resolveTowerResearchSelection(
    controlPlane.latestCompanyResearchSelection,
    researchRun?.input
  );
  const researchRecovery = readRecoveryState(researchRun?.input, researchRun?.output);
  const todayResearchSignals = researchRun?.status === "SUCCESS"
    ? controlPlane.latestResearchSignals
    : [];
  const controlTowerCarryForwardSignals = researchRun?.status === "SUCCESS"
    ? controlPlane.carryForwardResearchSignals
    : [...controlPlane.latestResearchSignals, ...controlPlane.carryForwardResearchSignals];
  const handoff = controlPlane.latestOutreachHandoff;
  const reviewCounts = {
    needsReview: apolloReviewRows.filter((row) => row.status === "NEEDS_REVIEW").length,
    mappedNoEmployees: apolloReviewRows.filter((row) => row.status === "MAPPED_NO_EMPLOYEES").length,
    archived: apolloReviewRows.filter((row) => row.status === "CONFIRMED_NO_MATCH").length
  };
  const tierCounts = record(researchOutput?.tierCounts);
  const qualifiedCompanies = count(tierCounts?.HOT_OPPORTUNITY) +
    count(tierCounts?.QUALIFIED_CURRENT_ACCOUNT);

  return {
    ...controlPlane,
    latestResearchSignals: todayResearchSignals,
    carryForwardResearchSignals: controlTowerCarryForwardSignals,
    generatedAt: now,
    timeZone,
    stages: {
      tradeMining: {
        tone: stageTone({
          failed: failedProfiles.length,
          running: runningProfiles.length,
          complete: completedProfiles.length === enabledProfiles.length && enabledProfiles.length > 0
        }),
        enabledProfiles: enabledProfiles.length,
        completedProfiles: completedProfiles.length,
        failedProfiles: failedProfiles.length,
        runningProfiles: runningProfiles.length,
        matches: tradeMiningMatches,
        exports: tradeMiningExports,
        qualifyingCompanies: tradeMiningQualifyingCompanies
      },
      scout: {
        tone: runTone(scoutRun?.status),
        status: scoutRun?.status ?? null,
        startedAt: scoutRun?.startedAt ?? null,
        selectedArticles: count(scoutOutput?.selectedArticleCount),
        acceptedSignals: count(scoutOutput?.acceptedCount),
        promotedCompanies: count(scoutOutput?.promotedCompanyCount),
        duplicateUrls: count(scoutOutput?.duplicateUrlCount),
        duplicateEvents: count(scoutOutput?.duplicateEventCount)
      },
      research: {
        tone: runTone(researchRun?.status),
        status: researchRun?.status ?? null,
        startedAt: researchRun?.startedAt ?? null,
        selectedCompanies: resolveTowerSelectedCompanyCount(
          researchSelection,
          researchRun?.input,
          researchRun?.output
        ),
        newCompanies: count(researchSelection?.newCompanyCount),
        suppressedRepeats: count(researchSelection?.recentResearchSuppressedCount),
        suppressedActiveOutreach: count(researchSelection?.activeOutreachSuppressedCount),
        researchedCompanies: count(researchOutput?.researchedCount),
        qualifiedCompanies,
        blockedCompanies: count(researchOutput?.blockedCount),
        tierCounts: {
          hot: count(tierCounts?.HOT_OPPORTUNITY),
          qualified: count(tierCounts?.QUALIFIED_CURRENT_ACCOUNT),
          watchlist: count(tierCounts?.WATCHLIST),
          blocked: count(tierCounts?.BLOCKED)
        },
        recovery: researchRecovery
      },
      outreach: {
        tone: handoff?.status === "ERROR"
          ? "attention" as const
          : handoff?.status === "RUNNING" || handoff?.status === "QUEUED"
            ? "running" as const
            : handoff?.status === "SUCCESS"
              ? "healthy" as const
              : "waiting" as const,
        status: handoff?.status ?? null,
        companiesQueued: handoff?.companiesQueued ?? 0,
        companiesProcessed: handoff?.companiesProcessed ?? 0,
        contactsFound: handoff?.apolloContactsFound ?? 0,
        actionablePlans: handoff?.actionablePlans ?? 0,
        qaFailedPlans: handoff?.qaFailedPlans ?? 0
      },
      apollo: {
        tone: reviewCounts.needsReview > 0 || apolloSyncHealth.failedContacts > 0
          ? "attention" as const
          : apolloSyncHealth.latestJob?.status === "RUNNING"
            ? "running" as const
            : apolloSyncHealth.lastSuccessfulAt
              ? "healthy" as const
              : "waiting" as const,
        reviewCounts,
        autoMatchRate: identityMetrics.autoMatchRate,
        trackedContacts: apolloSyncHealth.trackedContacts,
        dueSyncContacts: apolloSyncHealth.dueContacts,
        failedSyncContacts: apolloSyncHealth.failedContacts,
        lastSuccessfulSyncAt: apolloSyncHealth.lastSuccessfulAt
      }
    },
    funnel: {
      sourceCompanies: tradeMiningQualifyingCompanies + count(scoutOutput?.promotedCompanyCount),
      researchedCompanies: count(researchOutput?.researchedCount),
      qualifiedCompanies,
      contactsFound: handoff?.apolloContactsFound ?? 0,
      plansReady: handoff?.actionablePlans ?? 0,
      needsAttention: needsAttentionContacts,
      activeCadences: activeCadenceContacts,
      deliveryFailures: deliveryFailureContacts,
      engagedContacts,
      meetingContacts
    },
    reviewCounts,
    identityMetrics,
    apolloSyncHealth
  };
}

export function readRecoveryState(inputValue: unknown, outputValue: unknown) {
  const input = record(inputValue);
  const output = record(outputValue);
  const recovery = record(output?.recovery);
  const recoveryOfRunId = text(input?.recoveryOfRunId);
  const recoveryAttempt = Math.max(0, count(input?.recoveryAttempt));
  return {
    recoveryOfRunId,
    attempt: recoveryAttempt > 0 ? recoveryAttempt : 1,
    checkpointStage: text(recovery?.checkpointStage),
    retryable: recovery?.retryable === true,
    retryScheduled: recovery?.retryScheduled === true,
    recovered: Boolean(recoveryOfRunId && output?.phase === "COMPANY_RESEARCH_COMPLETE")
  };
}

export function resolveTowerResearchSelection(
  normalizedSelection: unknown,
  runInput: unknown
) {
  return record(normalizedSelection) ?? record(record(runInput)?.selection);
}

export function resolveTowerSelectedCompanyCount(
  selectionValue: unknown,
  runInput: unknown,
  runOutput: unknown
) {
  const selection = record(selectionValue);
  const auditedCount = count(selection?.selectedCompanyCount);
  if (auditedCount > 0) return auditedCount;

  const input = record(runInput);
  const candidateCompanyIds = Array.isArray(input?.candidateCompanyIds)
    ? input.candidateCompanyIds
    : [];
  if (candidateCompanyIds.length > 0) return candidateCompanyIds.length;

  const output = record(runOutput);
  return count(output?.researchedCount) + count(output?.missingCompanyCount);
}

function stageTone(input: { failed: number; running: number; complete: boolean }): HunterTowerTone {
  if (input.failed > 0) return "attention";
  if (input.running > 0) return "running";
  return input.complete ? "healthy" : "waiting";
}

function runTone(status: string | null | undefined): HunterTowerTone {
  if (status === "ERROR" || status === "CANCELLED") return "attention";
  if (status === "RUNNING" || status === "QUEUED") return "running";
  return status === "SUCCESS" ? "healthy" : "waiting";
}

function isRunToday(date: Date | null | undefined, today: string, timeZone: string) {
  return Boolean(date && localDate(date, timeZone) === today);
}

function localDate(date: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
