import { HunterDecisionStatus, type JobStatus, type Prisma } from "@prisma/client";
import { DEFAULT_HUNTER_POLICY, HUNTER_DRY_RUN_JOB_TYPE } from "@/modules/lead-gen/hunter-planner";
import { HUNTER_COMPANY_RESEARCH_JOB_TYPE } from "@/modules/lead-gen/hunter-company-research";
import {
  readStoredHunterResearchLunaShadow,
  summarizeHunterResearchLunaShadow
} from "@/modules/lead-gen/hunter-company-research-shadow";
import { HUNTER_OUTREACH_HANDOFF_JOB_TYPE } from "@/modules/lead-gen/hunter-job-types";
import { HUNTER_SIGNAL_SCOUT_JOB_TYPE } from "@/modules/lead-gen/hunter-signal-scout";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";

export async function getHunterControlPlane(tenant: Pick<TenantContext, "tenantId">) {
  const [
    storedPolicy,
    latestRuns,
    signalScoutRuns,
    companyResearchRuns,
    signals,
    decisionCount,
    activeSuppressionCount,
    latestOutreachHandoffRun
  ] = await Promise.all([
    prisma.hunterAutomationPolicy.findUnique({
      where: { tenantId: tenant.tenantId }
    }),
    prisma.automationJobRun.findMany({
      where: {
        tenantId: tenant.tenantId,
        jobType: HUNTER_DRY_RUN_JOB_TYPE
      },
      orderBy: { startedAt: "desc" },
      take: 10,
      include: {
        hunterProspectingDecisions: {
          orderBy: { rank: "asc" }
        }
      }
    }),
    prisma.automationJobRun.findMany({
      where: {
        tenantId: tenant.tenantId,
        jobType: HUNTER_SIGNAL_SCOUT_JOB_TYPE
      },
      orderBy: { startedAt: "desc" },
      take: 10
    }),
    prisma.automationJobRun.findMany({
      where: {
        tenantId: tenant.tenantId,
        jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE
      },
      orderBy: { startedAt: "desc" },
      take: 10
    }),
    prisma.hunterOpportunitySignal.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
      take: 200
    }),
    prisma.hunterProspectingDecision.count({
      where: {
        tenantId: tenant.tenantId,
        status: HunterDecisionStatus.WOULD_PURSUE
      }
    }),
    prisma.hunterOutreachSuppression.count({
      where: {
        tenantId: tenant.tenantId,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    }),
    prisma.automationJobRun.findFirst({
      where: {
        tenantId: tenant.tenantId,
        jobType: HUNTER_OUTREACH_HANDOFF_JOB_TYPE
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        input: true,
        output: true,
        errorMessage: true
      }
    })
  ]);

  const latestSuccessfulCompanyResearchRun =
    companyResearchRuns.find((run) => run.status === "SUCCESS") ?? null;
  const latestResearchRunId = latestSuccessfulCompanyResearchRun?.id ?? null;
  const {
    latestResearchSignals,
    carryForwardResearchSignals
  } = partitionHunterResearchSignals(signals, latestResearchRunId);
  const lunaShadow = readStoredHunterResearchLunaShadow(
    latestSuccessfulCompanyResearchRun?.output
  );

  return {
    policy: storedPolicy ?? {
      id: null,
      tenantId: tenant.tenantId,
      ...DEFAULT_HUNTER_POLICY,
      allowedJurisdictions: null,
      createdAt: null,
      updatedAt: null
    },
    policyIsStored: Boolean(storedPolicy),
    latestRuns,
    latestRun: latestRuns[0] ?? null,
    signalScoutRuns,
    latestSignalScoutRun: signalScoutRuns[0] ?? null,
    companyResearchRuns,
    latestCompanyResearchRun: companyResearchRuns[0] ?? null,
    latestSuccessfulCompanyResearchRun,
    latestResearchSignals,
    carryForwardResearchSignals,
    latestLunaShadow: lunaShadow,
    latestLunaShadowSummary: summarizeHunterResearchLunaShadow(lunaShadow),
    signals,
    decisionCount,
    activeSuppressionCount,
    latestOutreachHandoff: summarizeHunterOutreachHandoffRun(
      latestOutreachHandoffRun
    )
  };
}

export function partitionHunterResearchSignals<
  T extends {
    id: string;
    sourceName: string | null;
    rawJson: Prisma.JsonValue | null;
    evidence: Prisma.JsonValue | null;
  }
>(signals: T[], latestResearchRunId: string | null) {
  const researchedSignals = signals.filter(
    (signal) => signal.sourceName === "Hunter company research"
  );
  const latestResearchSignals = latestResearchRunId
    ? researchedSignals.filter(
        (signal) => readSignalResearchRunId(signal.rawJson) === latestResearchRunId
      )
    : [];
  const latestResearchSignalIds = new Set(
    latestResearchSignals.map((signal) => signal.id)
  );
  return {
    latestResearchSignals,
    carryForwardResearchSignals: researchedSignals.filter(
      (signal) =>
        !latestResearchSignalIds.has(signal.id) &&
        isActionableResearchSignal(signal.evidence)
    )
  };
}

function readSignalResearchRunId(value: Prisma.JsonValue | null) {
  const record = asRecord(value);
  return typeof record?.runId === "string" ? record.runId : null;
}

function isActionableResearchSignal(value: Prisma.JsonValue | null) {
  const evidence = asRecord(value);
  const research = asRecord(evidence?.research);
  return (
    research?.opportunityTier === "HOT_OPPORTUNITY" ||
    research?.opportunityTier === "QUALIFIED_CURRENT_ACCOUNT"
  );
}

type HunterOutreachHandoffRun = {
  id: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  input: Prisma.JsonValue | null;
  output: Prisma.JsonValue | null;
  errorMessage: string | null;
};

export function summarizeHunterOutreachHandoffRun(
  run: HunterOutreachHandoffRun | null
) {
  if (!run) return null;
  const input = asRecord(run.input);
  const output = asRecord(run.output);
  const items = Array.isArray(input?.items) ? input.items : [];
  const results = (Array.isArray(output?.results) ? output.results : [])
    .map(asRecord)
    .filter((result): result is Record<string, unknown> => Boolean(result))
    .slice(0, 100)
    .map((result) => ({
      companyName: readText(result.companyName, "Unknown company"),
      state: readText(result.state, "UNKNOWN"),
      apolloContactsFound: readCount(
        result.apolloContactsFound ?? result.contactsImported
      ),
      contactsRanked: readCount(
        result.contactsRanked ?? result.contactsImported
      ),
      contactsEvaluated: readCount(result.contactsImported),
      plansCreated: readCount(
        result.plansCreated ?? result.plansGenerated
      ),
      existingPlansFound: readCount(result.existingPlansFound),
      actionablePlans: readCount(
        result.actionablePlans ?? result.plansGenerated
      ),
      qaFailedPlans: readCount(result.qaFailedPlans),
      message: readText(result.message, "No result detail was recorded.")
    }));

  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorMessage: run.errorMessage,
    companiesQueued: items.length,
    companiesProcessed: results.length,
    apolloContactsFound: results.reduce(
      (sum, result) => sum + result.apolloContactsFound,
      0
    ),
    contactsRanked: results.reduce(
      (sum, result) => sum + result.contactsRanked,
      0
    ),
    contactsEvaluated: results.reduce(
      (sum, result) => sum + result.contactsEvaluated,
      0
    ),
    plansCreated: results.reduce(
      (sum, result) => sum + result.plansCreated,
      0
    ),
    existingPlansFound: results.reduce(
      (sum, result) => sum + result.existingPlansFound,
      0
    ),
    actionablePlans: results.reduce(
      (sum, result) => sum + result.actionablePlans,
      0
    ),
    qaFailedPlans: results.reduce(
      (sum, result) => sum + result.qaFailedPlans,
      0
    ),
    results
  };
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function readText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 500)
    : fallback;
}
