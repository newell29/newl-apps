import { createHash } from "node:crypto";

import {
  ApolloCompanyMatchClassification,
  ApolloStatus,
  ContactSource,
  ContactStatus,
  HunterAutomationMode,
  JobStatus,
  OutreachPlanStatus,
  Prisma,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";

import {
  evaluateHunterOutreachEligibility,
  getHunterOutreachResearchMaxAgeDays
} from "@/modules/lead-gen/hunter-outreach-eligibility";
import {
  blocksApolloEmployeeLookup,
  resolveApolloContactDiscoveryMatch
} from "@/modules/lead-gen/apollo-contact-discovery-review";
import {
  isActiveHunterCadence,
  isHunterContactSafeForReview
} from "@/modules/lead-gen/apollo-reengagement-policy";
import {
  HUNTER_COMPANY_RESEARCH_JOB_TYPE,
  HUNTER_OUTREACH_HANDOFF_JOB_TYPE
} from "@/modules/lead-gen/hunter-job-types";
import { runHunterDryPlan } from "@/modules/lead-gen/hunter-planner";
import {
  generateOutreachPlanForContact,
  loadOutreachPlanContactContext
} from "@/modules/lead-gen/outreach-plan-generation";
import {
  DEFAULT_HUNTER_CONTACT_FIT_MODEL,
  HUNTER_CONTACT_FIT_PROMPT_VERSION,
  type HunterContactFitReview
} from "@/modules/lead-gen/outreach-plan";
import { prisma } from "@/server/db";
import {
  ApolloRateLimitError,
  fetchApolloContactsForCompany,
  readApolloAccountIdFromMatchQuery,
  type ApolloContactLookupResult,
  type ApolloContactRecord
} from "@/server/integrations/apollo";
import {
  isOpenAiDraftGenerationConfigured,
  reviewHunterContactFit
} from "@/server/integrations/openai";

export { HUNTER_OUTREACH_HANDOFF_JOB_TYPE } from "@/modules/lead-gen/hunter-job-types";

const ACTIVE_JOB_WINDOW_MS = 4 * 60 * 60 * 1_000;
const PROCESSING_LEASE_MS = 15 * 60 * 1_000;
const MAX_COMPANY_ATTEMPTS = 3;
const HUNTER_CONTACT_REVIEW_POOL_MAX = 10;
const HUNTER_SELECTED_CONTACT_MAX = 3;

type HandoffItem = {
  companyId: string;
  companyName: string;
  researchSignalId: string;
  prospectingDecisionId: string;
  recommendedPersona: string | null;
};

type HandoffResult = {
  companyId: string;
  companyName: string;
  state:
    | "PLANS_GENERATED"
    | "REVIEW_REQUIRED"
    | "NO_CONTACTS"
    | "NO_QUALIFYING_CONTACTS"
    | "CONTACT_REVIEW_REQUIRED"
    | "SKIPPED_INELIGIBLE"
    | "ERROR";
  matchClassification: ApolloCompanyMatchClassification | null;
  apolloContactsFound: number;
  contactsRanked: number;
  contactsImported: number;
  plansCreated: number;
  existingPlansFound: number;
  actionablePlans: number;
  plansGenerated: number;
  qaFailedPlans: number;
  message: string;
  completedAt: string;
};

type HandoffOutput = {
  phase: "QUEUED" | "RUNNING" | "COMPLETE";
  processingCompanyId: string | null;
  processingStartedAt: string | null;
  nextAttemptAt: string | null;
  attempts: Record<string, number>;
  results: HandoffResult[];
  completedAt: string | null;
};

export async function queueCurrentHunterOutreachHandoff({
  tenantId,
  actorUserId
}: {
  tenantId: string;
  actorUserId: string;
}) {
  const latestResearch = await prisma.automationJobRun.findFirst({
    where: {
      tenantId,
      jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE,
      status: JobStatus.SUCCESS
    },
    orderBy: { finishedAt: "desc" },
    select: { id: true }
  });
  if (!latestResearch) {
    return {
      state: "research_required" as const,
      message: "Hunter has no completed company research to hand off."
    };
  }

  const plan = await runHunterDryPlan({
    tenantId,
    actorUserId,
    trigger: "MANUAL",
    candidateScope: "CURRENT_RESEARCHED_OUTREACH",
    researchRunId: latestResearch.id
  });
  if (plan.state !== "completed") {
    return {
      state: "plan_failed" as const,
      message: "Hunter could not refresh the current opportunity plan."
    };
  }

  return enqueueHunterOutreachHandoff({
    tenantId,
    researchRunId: latestResearch.id,
    prospectingPlanRunId: plan.runId,
    forceContactReview: true
  });
}

export async function enqueueHunterOutreachHandoff({
  tenantId,
  researchRunId,
  prospectingPlanRunId,
  forceContactReview = false
}: {
  tenantId: string;
  researchRunId: string;
  prospectingPlanRunId: string;
  forceContactReview?: boolean;
}) {
  const policy = await prisma.hunterAutomationPolicy.findUnique({
    where: { tenantId },
    select: {
      mode: true,
      killSwitch: true,
      maxContactsPerCompany: true
    }
  });
  if (
    !policy ||
    policy.killSwitch ||
    policy.mode !== HunterAutomationMode.ASSISTED
  ) {
    return {
      state: "disabled" as const,
      message: "Hunter assisted handoff is not enabled for this tenant."
    };
  }
  if (!isOpenAiDraftGenerationConfigured()) {
    return {
      state: "configuration_required" as const,
      message: "Outreach model configuration is missing."
    };
  }
  const aiConfig = await prisma.tradeMiningScoringConfig.findUnique({
    where: { tenantId },
    select: { aiClassificationEnabled: true }
  });
  if (aiConfig?.aiClassificationEnabled === false) {
    return {
      state: "configuration_required" as const,
      message: "Lead-generation AI is disabled."
    };
  }

  const activeJobs = await prisma.automationJobRun.findMany({
    where: {
      tenantId,
      jobType: HUNTER_OUTREACH_HANDOFF_JOB_TYPE,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      startedAt: { gte: new Date(Date.now() - ACTIVE_JOB_WINDOW_MS) }
    },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: { id: true, input: true }
  });
  const active = activeJobs.find((candidate) => {
    const input = isObject(candidate.input) ? candidate.input : {};
    return input.researchRunId === researchRunId;
  });
  if (active) {
    return {
      state: "already_queued" as const,
      runId: active.id
    };
  }

  const decisions = await prisma.hunterProspectingDecision.findMany({
    where: {
      tenantId,
      jobRunId: prospectingPlanRunId,
      status: "WOULD_PURSUE",
      companyId: { not: null }
    },
    orderBy: { rank: "asc" },
    select: {
      id: true,
      status: true,
      companyId: true,
      companyName: true,
      recommendedPersona: true,
      serviceLine: true,
      opportunityType: true,
      rationale: true,
      recommendedSender: true,
      recommendedCadence: true,
      createdAt: true,
      company: {
        select: {
          hunterOpportunitySignals: {
            where: {
              tenantId,
              sourceName: "Hunter company research"
            },
            orderBy: { observedAt: "desc" },
            take: 1,
            select: {
              id: true,
              sourceName: true,
              serviceLine: true,
              observedAt: true,
              evidence: true
            }
          }
        }
      }
    }
  });

  const items: HandoffItem[] = [];
  for (const decision of decisions) {
    if (!decision.companyId) continue;
    const signal = decision.company?.hunterOpportunitySignals[0] ?? null;
    const eligibility = evaluateHunterOutreachEligibility({
      researchSignal: signal,
      prospectingDecision: decision,
      maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
    });
    if (eligibility.status !== "ELIGIBLE" || !eligibility.directive) continue;
    items.push({
      companyId: decision.companyId,
      companyName: decision.companyName,
      researchSignalId: eligibility.directive.researchSignalId,
      prospectingDecisionId: eligibility.directive.prospectingDecisionId,
      recommendedPersona: eligibility.directive.recommendedPersona
    });
  }

  if (items.length === 0) {
    return {
      state: "nothing_eligible" as const,
      message: "No Hot or Qualified company cleared the current Hunter handoff."
    };
  }

  const job = await prisma.automationJobRun.create({
    data: {
      tenantId,
      jobType: HUNTER_OUTREACH_HANDOFF_JOB_TYPE,
      status: JobStatus.QUEUED,
      input: {
        version: 1,
        researchRunId,
        prospectingPlanRunId,
        maxContactsPerCompany: Math.min(3, Math.max(1, policy.maxContactsPerCompany)),
        forceContactReview,
        items
      },
      output: emptyOutput()
    }
  });
  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "lead-gen.hunter-outreach-handoff.queued",
      entityType: "AutomationJobRun",
      entityId: job.id,
      after: {
        researchRunId,
        prospectingPlanRunId,
        companyCount: items.length,
        maxContactsPerCompany: Math.min(3, Math.max(1, policy.maxContactsPerCompany))
      }
    }
  });
  return {
    state: "queued" as const,
    runId: job.id,
    companyCount: items.length
  };
}

export async function enqueueHunterCompanyOutreachHandoff({
  tenantId,
  companyId,
  forceContactReview = true,
  authorizePaidEmailEnrichment = false,
  explicitApolloPersonIds = []
}: {
  tenantId: string;
  companyId: string;
  forceContactReview?: boolean;
  authorizePaidEmailEnrichment?: boolean;
  explicitApolloPersonIds?: string[];
}) {
  const normalizedExplicitApolloPersonIds =
    normalizeExplicitApolloPersonIds(explicitApolloPersonIds);
  if (
    normalizedExplicitApolloPersonIds.length > 0 &&
    !authorizePaidEmailEnrichment
  ) {
    throw new Error(
      "Authorize email-only Apollo enrichment before resolving explicit person URLs."
    );
  }
  const policy = await prisma.hunterAutomationPolicy.findUnique({
    where: { tenantId },
    select: {
      mode: true,
      killSwitch: true,
      maxContactsPerCompany: true
    }
  });
  if (
    !policy ||
    policy.killSwitch ||
    policy.mode !== HunterAutomationMode.ASSISTED
  ) {
    return {
      state: "disabled" as const,
      message: "Hunter assisted handoff is not enabled for this tenant."
    };
  }
  if (!isOpenAiDraftGenerationConfigured()) {
    return {
      state: "configuration_required" as const,
      message: "Outreach model configuration is missing."
    };
  }
  const aiConfig = await prisma.tradeMiningScoringConfig.findUnique({
    where: { tenantId },
    select: { aiClassificationEnabled: true }
  });
  if (aiConfig?.aiClassificationEnabled === false) {
    return {
      state: "configuration_required" as const,
      message: "Lead-generation AI is disabled."
    };
  }

  const decision = await prisma.hunterProspectingDecision.findFirst({
    where: {
      tenantId,
      companyId
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      companyId: true,
      companyName: true,
      recommendedPersona: true,
      serviceLine: true,
      opportunityType: true,
      rationale: true,
      recommendedSender: true,
      recommendedCadence: true,
      createdAt: true,
      jobRunId: true,
      company: {
        select: {
          hunterOpportunitySignals: {
            where: {
              tenantId,
              sourceName: "Hunter company research"
            },
            orderBy: { observedAt: "desc" },
            take: 1,
            select: {
              id: true,
              sourceName: true,
              serviceLine: true,
              observedAt: true,
              evidence: true
            }
          }
        }
      }
    }
  });
  const signal = decision?.company?.hunterOpportunitySignals[0] ?? null;
  const eligibility = evaluateHunterOutreachEligibility({
    researchSignal: signal,
    prospectingDecision: decision,
    maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
  });
  if (
    !decision?.companyId ||
    eligibility.status !== "ELIGIBLE" ||
    !eligibility.directive ||
    !signal
  ) {
    return {
      state: "nothing_eligible" as const,
      message: eligibility.reason
    };
  }

  const activeJobs = await prisma.automationJobRun.findMany({
    where: {
      tenantId,
      jobType: HUNTER_OUTREACH_HANDOFF_JOB_TYPE,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      startedAt: { gte: new Date(Date.now() - ACTIVE_JOB_WINDOW_MS) }
    },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: { id: true, input: true }
  });
  const active = activeJobs.find((candidate) => {
    const input = isObject(candidate.input) ? candidate.input : {};
    return Array.isArray(input.items) && input.items.some((item) => (
      isObject(item) && item.companyId === companyId
    ));
  });
  if (active) {
    return {
      state: "already_queued" as const,
      runId: active.id
    };
  }

  const item: HandoffItem = {
    companyId: decision.companyId,
    companyName: decision.companyName,
    researchSignalId: eligibility.directive.researchSignalId,
    prospectingDecisionId: eligibility.directive.prospectingDecisionId,
    recommendedPersona: eligibility.directive.recommendedPersona
  };
  const maxContactsPerCompany = Math.min(
    HUNTER_SELECTED_CONTACT_MAX,
    Math.max(1, policy.maxContactsPerCompany)
  );
  const job = await prisma.automationJobRun.create({
    data: {
      tenantId,
      jobType: HUNTER_OUTREACH_HANDOFF_JOB_TYPE,
      status: JobStatus.QUEUED,
      input: {
        version: 1,
        source: "MANUAL_APOLLO_MAPPING_OR_RECHECK",
        researchRunId: null,
        prospectingPlanRunId: decision.jobRunId,
        maxContactsPerCompany,
        forceContactReview,
        authorizePaidEmailEnrichment,
        explicitApolloPersonIds: normalizedExplicitApolloPersonIds,
        items: [item]
      },
      output: emptyOutput()
    }
  });
  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "lead-gen.hunter-outreach-handoff.company-queued",
      entityType: "AutomationJobRun",
      entityId: job.id,
      after: {
        companyId,
        prospectingDecisionId: decision.id,
        companyCount: 1,
        maxContactsPerCompany,
        forceContactReview,
        authorizePaidEmailEnrichment,
        explicitApolloPersonCount: normalizedExplicitApolloPersonIds.length,
        source: "MANUAL_APOLLO_MAPPING_OR_RECHECK"
      }
    }
  });
  return {
    state: "queued" as const,
    runId: job.id,
    companyCount: 1
  };
}

export async function processNextHunterOutreachHandoff({
  tenantId,
  runId,
  now = new Date()
}: {
  tenantId: string;
  runId?: string;
  now?: Date;
}) {
  const policy = await prisma.hunterAutomationPolicy.findUnique({
    where: { tenantId },
    select: { mode: true, killSwitch: true }
  });
  if (
    !policy ||
    policy.killSwitch ||
    policy.mode !== HunterAutomationMode.ASSISTED
  ) {
    return {
      state: "disabled" as const,
      message: "Hunter assisted handoff is not enabled for this tenant."
    };
  }

  const job = await prisma.automationJobRun.findFirst({
    where: {
      tenantId,
      jobType: HUNTER_OUTREACH_HANDOFF_JOB_TYPE,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      ...(runId ? { id: runId } : {})
    },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      status: true,
      input: true,
      output: true
    }
  });
  if (!job) return { state: "idle" as const };

  const input = parseInput(job.input);
  let output = parseOutput(job.output);
  if (
    output.nextAttemptAt &&
    new Date(output.nextAttemptAt).getTime() > now.getTime()
  ) {
    return {
      state: "retry_wait" as const,
      runId: job.id,
      nextAttemptAt: output.nextAttemptAt
    };
  }
  if (
    output.processingCompanyId &&
    output.processingStartedAt &&
    now.getTime() - new Date(output.processingStartedAt).getTime() < PROCESSING_LEASE_MS
  ) {
    return {
      state: "already_processing" as const,
      runId: job.id,
      companyId: output.processingCompanyId
    };
  }

  const completedIds = new Set(output.results.map((result) => result.companyId));
  const item = input.items.find((candidate) => !completedIds.has(candidate.companyId));
  if (!item) {
    const result = await finishJob(job.id, tenantId, output, now);
    return { state: "completed" as const, runId: job.id, ...result };
  }

  output = {
    ...output,
    phase: "RUNNING",
    processingCompanyId: item.companyId,
    processingStartedAt: now.toISOString(),
    nextAttemptAt: null
  };
  await prisma.automationJobRun.updateMany({
    where: { id: job.id, tenantId },
    data: {
      status: JobStatus.RUNNING,
      output: toInputJsonValue(output)
    }
  });

  try {
    const result = await processCompany({
      tenantId,
      jobId: job.id,
      item,
      maxContactsPerCompany: input.maxContactsPerCompany,
      forceContactReview: input.forceContactReview,
      authorizePaidEmailEnrichment: input.authorizePaidEmailEnrichment,
      explicitApolloPersonIds: input.explicitApolloPersonIds
    });
    const nextOutput: HandoffOutput = {
      ...output,
      processingCompanyId: null,
      processingStartedAt: null,
      attempts: {
        ...output.attempts,
        [item.companyId]: (output.attempts[item.companyId] ?? 0) + 1
      },
      results: [...output.results, result]
    };
    const remaining = input.items.length - nextOutput.results.length;
    if (remaining === 0) {
      const finished = await finishJob(job.id, tenantId, nextOutput, new Date());
      return {
        state: "completed" as const,
        runId: job.id,
        processedCompanyId: item.companyId,
        result,
        ...finished
      };
    }
    await prisma.automationJobRun.updateMany({
      where: { id: job.id, tenantId },
      data: { output: toInputJsonValue(nextOutput) }
    });
    return {
      state: "processed" as const,
      runId: job.id,
      processedCompanyId: item.companyId,
      result,
      remaining
    };
  } catch (error) {
    const attempts = (output.attempts[item.companyId] ?? 0) + 1;
    const message = safeError(error);
    if (attempts < MAX_COMPANY_ATTEMPTS) {
      const retryMinutes = error instanceof ApolloRateLimitError ? 15 : attempts === 1 ? 1 : 5;
      const retryOutput: HandoffOutput = {
        ...output,
        processingCompanyId: null,
        processingStartedAt: null,
        nextAttemptAt: new Date(now.getTime() + retryMinutes * 60_000).toISOString(),
        attempts: { ...output.attempts, [item.companyId]: attempts }
      };
      await prisma.automationJobRun.updateMany({
        where: { id: job.id, tenantId },
        data: { output: toInputJsonValue(retryOutput) }
      });
      return {
        state: "retry_scheduled" as const,
        runId: job.id,
        companyId: item.companyId,
        attempt: attempts,
        nextAttemptAt: retryOutput.nextAttemptAt,
        message
      };
    }

    const failed: HandoffResult = {
      companyId: item.companyId,
      companyName: item.companyName,
      state: "ERROR",
      matchClassification: null,
      apolloContactsFound: 0,
      contactsRanked: 0,
      contactsImported: 0,
      plansCreated: 0,
      existingPlansFound: 0,
      actionablePlans: 0,
      plansGenerated: 0,
      qaFailedPlans: 0,
      message,
      completedAt: now.toISOString()
    };
    const failedOutput: HandoffOutput = {
      ...output,
      processingCompanyId: null,
      processingStartedAt: null,
      nextAttemptAt: null,
      attempts: { ...output.attempts, [item.companyId]: attempts },
      results: [...output.results, failed]
    };
    if (failedOutput.results.length === input.items.length) {
      const finished = await finishJob(job.id, tenantId, failedOutput, now);
      return { state: "completed" as const, runId: job.id, result: failed, ...finished };
    }
    await prisma.automationJobRun.updateMany({
      where: { id: job.id, tenantId },
      data: { output: toInputJsonValue(failedOutput) }
    });
    return {
      state: "failed_company" as const,
      runId: job.id,
      result: failed,
      remaining: input.items.length - failedOutput.results.length
    };
  }
}

async function processCompany({
  tenantId,
  jobId,
  item,
  maxContactsPerCompany,
  forceContactReview,
  authorizePaidEmailEnrichment,
  explicitApolloPersonIds
}: {
  tenantId: string;
  jobId: string;
  item: HandoffItem;
  maxContactsPerCompany: number;
  forceContactReview: boolean;
  authorizePaidEmailEnrichment: boolean;
  explicitApolloPersonIds: string[];
}): Promise<HandoffResult> {
  const company = await prisma.company.findFirst({
    where: {
      id: item.companyId,
      tenantId,
      doNotProspect: false,
      candidateStatus: { notIn: ["REJECTED", "DISQUALIFIED"] }
    },
    select: {
      id: true,
      name: true,
      domain: true,
      linkedinUrl: true,
      apolloOrganizationId: true,
      apolloCompanyMatches: {
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          classification: true,
          matchReason: true,
          reviewedAt: true,
          queryJson: true
        }
      },
      hunterOpportunitySignals: {
        where: {
          id: item.researchSignalId,
          tenantId,
          sourceName: "Hunter company research"
        },
        take: 1,
        select: {
          id: true,
          sourceName: true,
          serviceLine: true,
          observedAt: true,
          evidence: true
        }
      },
      hunterProspectingDecisions: {
        where: { id: item.prospectingDecisionId, tenantId },
        take: 1,
        select: {
          id: true,
          status: true,
          serviceLine: true,
          opportunityType: true,
          rationale: true,
          recommendedPersona: true,
          recommendedSender: true,
          recommendedCadence: true,
          createdAt: true
        }
      }
    }
  });
  if (!company) {
    return terminal(item, "SKIPPED_INELIGIBLE", null, 0, 0, 0, "Company is no longer safe for outreach.");
  }
  const eligibility = evaluateHunterOutreachEligibility({
    researchSignal: company.hunterOpportunitySignals[0] ?? null,
    prospectingDecision: company.hunterProspectingDecisions[0] ?? null,
    maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
  });
  if (eligibility.status !== "ELIGIBLE" || !eligibility.directive) {
    return terminal(
      item,
      "SKIPPED_INELIGIBLE",
      null,
      0,
      0,
      0,
      `${eligibility.label}: ${eligibility.reason}`
    );
  }

  let contactIds: string[] = [];
  let contactsImported = 0;
  let classification: ApolloCompanyMatchClassification | null =
    company.apolloOrganizationId ? ApolloCompanyMatchClassification.DIRECT_COMPANY : null;
  const latestMatch = company.apolloCompanyMatches[0] ?? null;
  const confirmedApolloAccountId =
    company.apolloCompanyMatches
      .map((match) => readApolloAccountIdFromMatchQuery(match.queryJson))
      .find((accountId): accountId is string => Boolean(accountId)) ??
    null;
  if (
    latestMatch &&
    blocksApolloEmployeeLookup({
      classification: latestMatch.classification,
      apolloOrganizationId: company.apolloOrganizationId,
      matchReason: latestMatch.matchReason
    })
  ) {
    return terminal(
      item,
      "REVIEW_REQUIRED",
      latestMatch.classification,
      0,
      0,
      0,
      "The latest Apollo company match requires review; automatic repeat search was blocked."
    );
  }

  const lookup = await fetchApolloContactsForCompany(
    {
      companyName: company.name,
      domain: company.domain,
      apolloOrganizationId: company.apolloOrganizationId,
      apolloAccountId: confirmedApolloAccountId
    },
    {
      authorizePaidEmailEnrichment,
      explicitApolloPersonIds
    }
  );
  const recordedMatch = await recordCompanyMatch(tenantId, company.id, lookup, {
    domain: company.domain,
    linkedinUrl: company.linkedinUrl
  });
  classification = recordedMatch.classification;
  if (
    lookup.match.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY &&
    lookup.contacts.length === 0
  ) {
    await archiveHunterPlansWithoutConcreteEmail({
      tenantId,
      companyId: company.id,
      jobId
    });
    return terminal(
      item,
      "NO_CONTACTS",
      classification,
      0,
      0,
      0,
      recordedMatch.matchReason ??
        "Apollo verified the company but returned zero employees; manual Apollo company-page review is required."
    );
  }
  if (classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY) {
    return terminal(
      item,
      "REVIEW_REQUIRED",
      classification,
      0,
      0,
      0,
      lookup.match.matchReason || "Apollo could not verify a direct company match."
    );
  }

  const ranked = rankHunterContacts(
    lookup.contacts,
    item.recommendedPersona,
    eligibility.directive.rationale
  ).slice(0, HUNTER_CONTACT_REVIEW_POOL_MAX);
  if (ranked.length === 0) {
    await archiveHunterPlansWithoutConcreteEmail({
      tenantId,
      companyId: company.id,
      jobId
    });
    return terminal(
      item,
      "NO_QUALIFYING_CONTACTS",
      classification,
      0,
      0,
      0,
      "Apollo returned contacts, but none matched Hunter's buyer criteria.",
      {
        apolloContactsFound: lookup.contacts.length,
        contactsRanked: 0
      }
    );
  }
  const contactPersistence = await upsertContacts({
    tenantId,
    jobId,
    companyId: company.id,
    contacts: ranked
  });
  contactIds = contactPersistence.contactIds;
  contactsImported = contactIds.length;
  await archiveHunterPlansWithoutConcreteEmail({
    tenantId,
    companyId: company.id,
    jobId
  });
  if (contactIds.length === 0) {
    return terminal(
      item,
      "NO_QUALIFYING_CONTACTS",
      classification,
      0,
      0,
      0,
      contactPersistence.activeHunterCadenceCount > 0
        ? `${contactPersistence.activeHunterCadenceCount} Apollo contact${contactPersistence.activeHunterCadenceCount === 1 ? " is" : "s are"} already active in a Hunter cadence; no duplicate contact or outreach plan was created.`
        : `${contactPersistence.existingCanonicalContactCount} Apollo contact${contactPersistence.existingCanonicalContactCount === 1 ? " is" : "s are"} already tracked under another canonical company record; no duplicate contact was created.`,
      {
        apolloContactsFound: lookup.contacts.length,
        contactsRanked: ranked.length
      }
    );
  }

  let plansCreated = 0;
  let existingPlansFound = 0;
  let actionablePlans = 0;
  let qaFailedPlans = 0;
  const fit = await reviewAndPersistHunterContactFit({
    tenantId,
    jobId,
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain
    },
    directive: eligibility.directive,
    contactIds,
    selectionLimit: Math.min(HUNTER_SELECTED_CONTACT_MAX, maxContactsPerCompany),
    forceContactReview
  });
  if (forceContactReview) {
    await archiveUnselectedHunterPlans({
      tenantId,
      companyId: company.id,
      jobId,
      acceptedContactIds: fit.acceptedContactIds
    });
  }
  if (fit.acceptedContactIds.length === 0) {
    return terminal(
      item,
      "CONTACT_REVIEW_REQUIRED",
      classification,
      contactsImported,
      0,
      0,
      `${fit.reviewCount} contact${fit.reviewCount === 1 ? "" : "s"} evaluated; none cleared the model or deterministic buyer-role gate for human-review drafting.`,
      {
        apolloContactsFound: lookup.contacts.length,
        contactsRanked: ranked.length
      }
    );
  }

  for (const contactId of fit.acceptedContactIds) {
    const context = await loadOutreachPlanContactContext({ tenantId, contactId });
    if (!context || context.contactTier === "UNRANKED") continue;
    await prisma.contact.updateMany({
      where: { id: contactId, tenantId },
      data: {
        contactScore: context.contactScore,
        contactTier: context.contactTier,
        assignedRep:
          context.contact.assignedRep ??
          context.senderIdentity?.ownerUserId ??
          null
      }
    });
    const generated = await generateOutreachPlanForContact({
      tenantId,
      contactId,
      forceRegenerate: false,
      generateWhenNotRequired: true
    });
    if (
      isActionableHunterPlanState(generated.state) &&
      (
        generated.state !== "already_generated" ||
        generated.qaStatus === "PASSED"
      )
    ) {
      actionablePlans += 1;
    }
    if (generated.state === "already_generated") {
      existingPlansFound += 1;
      if (generated.qaStatus === "FAILED") {
        qaFailedPlans += 1;
      }
    } else if (
      generated.state === "qa_passed" ||
      generated.state === "qa_failed"
    ) {
      plansCreated += 1;
    }
    if (generated.state === "qa_failed") {
      qaFailedPlans += 1;
    }
  }
  if (actionablePlans === 0 && qaFailedPlans === 0) {
    return terminal(
      item,
      "NO_QUALIFYING_CONTACTS",
      classification,
      contactsImported,
      0,
      0,
      "Contacts were available, but none produced an actionable plan.",
      {
        apolloContactsFound: lookup.contacts.length,
        contactsRanked: ranked.length
      }
    );
  }
  return terminal(
    item,
    "PLANS_GENERATED",
    classification,
    contactsImported,
    actionablePlans,
    qaFailedPlans,
    actionablePlans > 0
      ? `${actionablePlans} QA-passed outreach plan${actionablePlans === 1 ? "" : "s"} available for human review (${plansCreated} newly generated, ${existingPlansFound} already current).`
      : `${qaFailedPlans} outreach plan${qaFailedPlans === 1 ? "" : "s"} generated but blocked by QA; none are ready for approval.`,
    {
      apolloContactsFound: lookup.contacts.length,
      contactsRanked: ranked.length,
      plansCreated,
      existingPlansFound
    }
  );
}

async function archiveUnselectedHunterPlans({
  tenantId,
  companyId,
  jobId,
  acceptedContactIds
}: {
  tenantId: string;
  companyId: string;
  jobId: string;
  acceptedContactIds: string[];
}) {
  const supersedablePlans = await prisma.outreachPlan.findMany({
    where: {
      tenantId,
      companyId,
      status: {
        in: [
          OutreachPlanStatus.DRAFT,
          OutreachPlanStatus.QA_FAILED,
          OutreachPlanStatus.QA_PASSED
        ]
      },
      ...(acceptedContactIds.length > 0
        ? { contactId: { notIn: acceptedContactIds } }
        : {})
    },
    select: {
      id: true,
      contactId: true,
      version: true,
      promptVersion: true
    }
  });
  if (supersedablePlans.length === 0) return;

  const archivedAt = new Date();
  await prisma.$transaction([
    prisma.outreachPlan.updateMany({
      where: {
        tenantId,
        companyId,
        id: { in: supersedablePlans.map((plan) => plan.id) },
        status: {
          in: [
            OutreachPlanStatus.DRAFT,
            OutreachPlanStatus.QA_FAILED,
            OutreachPlanStatus.QA_PASSED
          ]
        }
      },
      data: {
        status: OutreachPlanStatus.ARCHIVED,
        archivedAt
      }
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "lead-gen.hunter-outreach-plan.superseded",
        entityType: "Company",
        entityId: companyId,
        after: {
          handoffJobId: jobId,
          acceptedContactIds,
          archivedPlans: supersedablePlans.map((plan) => ({
            id: plan.id,
            contactId: plan.contactId,
            version: plan.version,
            promptVersion: plan.promptVersion
          })),
          archivedAt: archivedAt.toISOString()
        }
      }
    })
  ]);
}

async function archiveHunterPlansWithoutConcreteEmail({
  tenantId,
  companyId,
  jobId
}: {
  tenantId: string;
  companyId: string;
  jobId: string;
}) {
  const plans = await prisma.outreachPlan.findMany({
    where: {
      tenantId,
      companyId,
      status: {
        in: [
          OutreachPlanStatus.DRAFT,
          OutreachPlanStatus.QA_FAILED,
          OutreachPlanStatus.QA_PASSED
        ]
      }
    },
    select: {
      id: true,
      contactId: true,
      version: true,
      contact: {
        select: {
          email: true
        }
      }
    }
  });
  const stalePlans = plans.filter(
    (plan) => !hasUsableHunterEmail({ email: plan.contact.email })
  );
  if (stalePlans.length === 0) {
    return;
  }

  const archivedAt = new Date();
  await prisma.$transaction([
    prisma.outreachPlan.updateMany({
      where: {
        tenantId,
        companyId,
        id: { in: stalePlans.map((plan) => plan.id) },
        status: {
          in: [
            OutreachPlanStatus.DRAFT,
            OutreachPlanStatus.QA_FAILED,
            OutreachPlanStatus.QA_PASSED
          ]
        }
      },
      data: {
        status: OutreachPlanStatus.ARCHIVED,
        archivedAt
      }
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "lead-gen.hunter-outreach-plan.archived-missing-email",
        entityType: "Company",
        entityId: companyId,
        after: {
          handoffJobId: jobId,
          reason: "MISSING_CONCRETE_EMAIL",
          plans: stalePlans.map((plan) => ({
            id: plan.id,
            contactId: plan.contactId,
            version: plan.version
          })),
          archivedAt: archivedAt.toISOString()
        }
      }
    })
  ]);
}

async function reviewAndPersistHunterContactFit({
  tenantId,
  jobId,
  company,
  directive,
  contactIds,
  selectionLimit,
  forceContactReview
}: {
  tenantId: string;
  jobId: string;
  company: { id: string; name: string; domain: string | null };
  directive: {
    prospectingDecisionId: string;
    requiredServiceLine: "WAREHOUSING" | "OCEAN_AIR" | "TRUCKING";
    opportunityType: string;
    rationale: string;
    recommendedPersona: string | null;
  };
  contactIds: string[];
  selectionLimit: number;
  forceContactReview: boolean;
}) {
  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      companyId: company.id,
      id: { in: contactIds }
    },
    orderBy: [{ contactScore: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      fullName: true,
      title: true,
      department: true,
      seniority: true,
      email: true,
      phone: true,
      linkedinUrl: true,
      contactStatus: true,
      sequenceStatus: true,
      replyStatus: true,
      selectedSequenceName: true,
      lastTouchAt: true,
      lastReplyAt: true,
      rawJson: true
    }
  });
  if (contacts.length !== new Set(contactIds).size) {
    throw new Error("Hunter contact-fit review could not resolve the complete tenant contact cohort.");
  }

  const reviewableContacts = contacts.filter((contact) =>
    isHunterContactSafeForReview(contact)
  );
  const reviewByContactId = new Map<string, HunterContactFitReview>();
  const contactsNeedingReview = [];
  for (const contact of reviewableContacts) {
    const cached = forceContactReview
      ? null
      : readCachedContactFitReview(
          contact.rawJson,
          directive.prospectingDecisionId
        );
    if (cached) {
      reviewByContactId.set(contact.id, cached);
    } else {
      contactsNeedingReview.push(contact);
    }
  }

  const model =
    process.env.HUNTER_CONTACT_FIT_MODEL?.trim() ||
    DEFAULT_HUNTER_CONTACT_FIT_MODEL;
  if (contactsNeedingReview.length > 0) {
    const generated = await reviewHunterContactFit({
      model,
      company: {
        name: company.name,
        domain: company.domain
      },
      opportunity: {
        serviceLine: directive.requiredServiceLine,
        opportunityType: directive.opportunityType,
        rationale: directive.rationale,
        recommendedPersona: directive.recommendedPersona
      },
      contacts: contactsNeedingReview.map((contact) => {
        const apolloContext = readStoredApolloContactContext(contact.rawJson);
        return {
          city: apolloContext.city,
          state: apolloContext.state,
          country: apolloContext.country,
          priorActivityStatus: apolloContext.priorActivityStatus,
          contactId: contact.id,
          fullName: contact.fullName,
          title: contact.title,
          department: contact.department,
          seniority: contact.seniority,
          hasEmail: hasUsableHunterEmail(contact),
          hasPhone: Boolean(contact.phone) || apolloContext.hasPhoneAvailable,
          hasLinkedin:
            Boolean(contact.linkedinUrl) ||
            apolloContext.hasLinkedinAvailable,
          sequenceStatus: contact.sequenceStatus,
          replyStatus: contact.replyStatus,
          existingSequenceName: contact.selectedSequenceName,
          lastTouchAt: contact.lastTouchAt?.toISOString() ?? null,
          lastReplyAt: contact.lastReplyAt?.toISOString() ?? null
        };
      })
    });
    validateExactContactFitCohort(
      contactsNeedingReview.map((contact) => contact.id),
      generated.reviews
    );

    const generatedById = new Map(
      generated.reviews.map((review) => [review.contactId, review])
    );
    await prisma.$transaction(
      contactsNeedingReview.map((contact) => {
        const review = generatedById.get(contact.id);
        if (!review) {
          throw new Error("OpenAI contact-fit review omitted a required contact.");
        }
        reviewByContactId.set(contact.id, review);
        const existingRaw = isObject(contact.rawJson) ? contact.rawJson : {};
        return prisma.contact.updateMany({
          where: { id: contact.id, tenantId, companyId: company.id },
          data: {
            rawJson: toInputJsonValue({
              ...existingRaw,
              hunterContactFit: {
                ...review,
                model,
                promptVersion: HUNTER_CONTACT_FIT_PROMPT_VERSION,
                prospectingDecisionId: directive.prospectingDecisionId,
                reviewedAt: new Date().toISOString(),
                handoffJobId: jobId,
                usage: generated.usage
              }
            })
          }
        });
      })
    );
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "lead-gen.hunter-contact-fit.reviewed",
        entityType: "Company",
        entityId: company.id,
        after: {
          handoffJobId: jobId,
          prospectingDecisionId: directive.prospectingDecisionId,
          model,
          promptVersion: HUNTER_CONTACT_FIT_PROMPT_VERSION,
          contactCount: generated.reviews.length,
          dispositions: dispositionCounts(generated.reviews),
          usage: generated.usage
        }
      }
    });
  }

  const contactById = new Map(reviewableContacts.map((contact) => [contact.id, contact]));
  const acceptedContactIds = [...reviewByContactId.values()]
    .filter((review) => {
      const contact = contactById.get(review.contactId);
      return Boolean(
        contact &&
        shouldAdvanceHunterContactReview(review, contact)
      );
    })
    .sort((left, right) => {
      const leftContact = contactById.get(left.contactId);
      const rightContact = contactById.get(right.contactId);
      const modelEligibilityDelta =
        Number(isContactFitAutoEligible(right)) -
        Number(isContactFitAutoEligible(left));
      if (modelEligibilityDelta) return modelEligibilityDelta;
      const dispositionDelta =
        contactFitPriority(left.disposition) - contactFitPriority(right.disposition);
      if (dispositionDelta) return dispositionDelta;
      const deterministicDelta =
        Number(isStrongHunterBuyerRole(rightContact)) -
        Number(isStrongHunterBuyerRole(leftContact));
      return deterministicDelta || right.confidence - left.confidence;
    })
    .slice(0, Math.max(1, Math.min(HUNTER_SELECTED_CONTACT_MAX, selectionLimit)))
    .map((review) => review.contactId);
  return {
    acceptedContactIds,
    reviewCount: reviewByContactId.size
  };
}

export function isContactFitAutoEligible(review: HunterContactFitReview) {
  return (
    (review.disposition === "PRIMARY" && review.confidence >= 70) ||
    (review.disposition === "SECONDARY" && review.confidence >= 80)
  );
}

export function isActionableHunterPlanState(
  state:
    | "qa_passed"
    | "qa_failed"
    | "already_generated"
    | "not_required"
    | "unranked"
    | "ineligible"
    | "sequence_missing"
    | "sender_missing"
    | "evidence_missing"
) {
  return (
    state === "qa_passed" ||
    state === "already_generated"
  );
}

export function isStrongHunterBuyerRole(contact: {
  title: string | null;
  department: string | null;
} | undefined) {
  if (!contact) return false;
  const role = `${contact.title ?? ""} ${contact.department ?? ""}`;
  const hasPhysicalBuyerFunction =
    /\b(logistics|supply chain|distribution|warehouse|warehousing|fulfillment|transportation|shipping|receiving|procurement|purchasing|sourcing|materials|inventory|import|export)\b/i.test(
      role
    );
  const hasPhysicalOperationsScope =
    /\b(plant|manufacturing|factory|facility|facilities|distribution|warehouse|warehousing|fulfillment|transportation|shipping|receiving)\s+operations\b|\boperations\s+(?:manager|director|head|lead|supervisor|vp|vice president)\b.*\b(plant|manufacturing|factory|facility|facilities|distribution|warehouse|warehousing|fulfillment|transportation|shipping|receiving)\b/i.test(
      role
    );
  const hasDecisionScope =
    /\b(manager|director|head|lead|supervisor|vp|vice president|chief|coo|president|owner)\b/i.test(
      role
    );
  const isSellerSide =
    /\b(sales|business development|account executive|customer service|marketing|digital operations|franchise operations|revenue operations|people operations|human resources|hr operations|finance operations|financial operations|clinical operations|administrative operations)\b/i.test(
      role
    );
  return (
    (hasPhysicalBuyerFunction || hasPhysicalOperationsScope) &&
    hasDecisionScope &&
    !isSellerSide
  );
}

export function shouldAdvanceHunterContactReview(
  review: HunterContactFitReview,
  contact: {
    title: string | null;
    department: string | null;
    seniority?: string | null;
    contactStatus: ContactStatus;
    sequenceStatus: SequenceStatus;
    replyStatus: ReplyStatus;
  }
) {
  return (
    (
      (
        isContactFitAutoEligible(review) &&
        !hasBlockingContactFitRisk(review) &&
        !isClearlyIndividualContributor(contact)
      ) ||
      isStrongHunterBuyerRole(contact)
    ) &&
    isContactEligibleForFreshOutreach(contact)
  );
}

export function isClearlyIndividualContributor(contact: {
  title: string | null;
  department: string | null;
  seniority?: string | null;
}) {
  if (isStrongHunterBuyerRole(contact)) return false;
  const role = `${contact.title ?? ""} ${contact.department ?? ""} ${contact.seniority ?? ""}`;
  if (
    /\b(?:import(?:\s*\/\s*|\s+and\s+|\s+)export|customs|trade compliance)\s+specialist\b/i.test(
      role
    )
  ) {
    return false;
  }
  return /\b(coordinator|specialist|analyst|associate|assistant|administrator|clerk|representative|agent|technician)\b/i.test(
    role
  );
}

function hasBlockingContactFitRisk(review: HunterContactFitReview) {
  return review.riskFlags.some((risk) =>
    /\b(?:geography_mismatch|wrong geography|outside (?:the )?(?:target|opportunity) (?:market|region)|unrelated geography)\b/i.test(
      risk
    )
  );
}

export function isContactEligibleForFreshOutreach(contact: {
  contactStatus: ContactStatus;
  sequenceStatus: SequenceStatus;
  replyStatus: ReplyStatus;
}) {
  return isHunterContactSafeForReview(contact);
}

export function validateExactContactFitCohort(
  expectedContactIds: string[],
  reviews: HunterContactFitReview[]
) {
  const expectedIds = new Set(expectedContactIds);
  const returnedIds = new Set(reviews.map((review) => review.contactId));
  if (
    returnedIds.size !== expectedIds.size ||
    reviews.length !== expectedIds.size ||
    reviews.some((review) => !expectedIds.has(review.contactId))
  ) {
    throw new Error("OpenAI contact-fit review did not return the exact tenant contact cohort.");
  }
}

export function readCachedContactFitReview(
  rawJson: Prisma.JsonValue | null,
  prospectingDecisionId: string
) {
  const root = isObject(rawJson) ? rawJson : {};
  const cached = isObject(root.hunterContactFit) ? root.hunterContactFit : null;
  if (
    !cached ||
    cached.promptVersion !== HUNTER_CONTACT_FIT_PROMPT_VERSION ||
    cached.prospectingDecisionId !== prospectingDecisionId
  ) {
    return null;
  }
  const disposition = cached.disposition;
  const confidence = cached.confidence;
  if (
    typeof cached.contactId !== "string" ||
    !["PRIMARY", "SECONDARY", "REVIEW", "REJECT"].includes(String(disposition)) ||
    typeof confidence !== "number" ||
    !Number.isInteger(confidence) ||
    typeof cached.responsibilityHypothesis !== "string" ||
    typeof cached.rationale !== "string" ||
    typeof cached.recommendedApproach !== "string" ||
    !Array.isArray(cached.riskFlags)
  ) {
    return null;
  }
  return {
    contactId: cached.contactId,
    disposition: disposition as HunterContactFitReview["disposition"],
    confidence,
    responsibilityHypothesis: cached.responsibilityHypothesis,
    rationale: cached.rationale,
    recommendedApproach: cached.recommendedApproach,
    riskFlags: cached.riskFlags.filter(
      (value): value is string => typeof value === "string"
    )
  } satisfies HunterContactFitReview;
}

function dispositionCounts(reviews: HunterContactFitReview[]) {
  return Object.fromEntries(
    ["PRIMARY", "SECONDARY", "REVIEW", "REJECT"].map((disposition) => [
      disposition,
      reviews.filter((review) => review.disposition === disposition).length
    ])
  );
}

function contactFitPriority(disposition: HunterContactFitReview["disposition"]) {
  return disposition === "PRIMARY"
    ? 0
    : disposition === "SECONDARY"
      ? 1
      : disposition === "REVIEW"
        ? 2
        : 3;
}

async function recordCompanyMatch(
  tenantId: string,
  companyId: string,
  lookup: ApolloContactLookupResult,
  current: { domain: string | null; linkedinUrl: string | null }
) {
  const recoverySummary =
    `Apollo employee retrieval completed: ${lookup.contactRecovery.savedContactPagesRead} ` +
    `saved-contact page${lookup.contactRecovery.savedContactPagesRead === 1 ? "" : "s"} read, ` +
    `${lookup.contactRecovery.maskedPeopleChecked} masked candidate${lookup.contactRecovery.maskedPeopleChecked === 1 ? "" : "s"} checked, ` +
    `${lookup.contactRecovery.savedContactsRecovered} saved contact${lookup.contactRecovery.savedContactsRecovered === 1 ? "" : "s"} recovered, ` +
    `${lookup.contactRecovery.relatedAccountsChecked} related saved account${lookup.contactRecovery.relatedAccountsChecked === 1 ? "" : "s"} checked, ` +
    `${lookup.contactRecovery.relatedOrganizationScopesChecked} related organization scope${lookup.contactRecovery.relatedOrganizationScopesChecked === 1 ? "" : "s"} checked, ` +
    `${lookup.contactRecovery.companyKeywordSearches} strict company-keyword search${lookup.contactRecovery.companyKeywordSearches === 1 ? "" : "es"}, ` +
    `${lookup.contactRecovery.paidEmailsRecovered}/${lookup.contactRecovery.paidEmailEnrichmentsAttempted} ` +
    `authorized paid email enrichment${lookup.contactRecovery.paidEmailEnrichmentsAttempted === 1 ? "" : "s"} recovered`;
  const resolvedMatch = resolveApolloContactDiscoveryMatch({
    classification: lookup.match.classification,
    matchReason: [lookup.match.matchReason, recoverySummary]
      .filter(Boolean)
      .join("; "),
    contactsFound: lookup.contacts.length
  });
  await prisma.$transaction(async (tx) => {
    await tx.apolloCompanyMatch.create({
      data: {
        tenantId,
        companyId,
        apolloOrganizationId: lookup.match.organizationId,
        apolloCompanyName: lookup.match.companyName,
        apolloDomain: lookup.match.domain,
        apolloLinkedinUrl: lookup.match.linkedinUrl,
        score: lookup.match.score,
        classification: resolvedMatch.classification,
        nameMatchType: lookup.match.nameMatchType,
        domainMatch: lookup.match.domainMatch,
        logisticsProviderMatch: lookup.match.logisticsProviderMatch,
        branchLocationMatch: lookup.match.branchLocationMatch,
        matchReason: resolvedMatch.matchReason,
        queryJson: toInputJsonValue(lookup.match.query),
        rawJson: lookup.match.rawPayload
          ? toInputJsonValue(lookup.match.rawPayload)
          : Prisma.JsonNull
      }
    });
    if (resolvedMatch.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY) {
      await tx.company.updateMany({
        where: { id: companyId, tenantId },
        data: {
          apolloOrganizationId: lookup.organizationId,
          domain: lookup.domain ?? current.domain,
          linkedinUrl: lookup.linkedinUrl ?? current.linkedinUrl
        }
      });
    }
  });
  return resolvedMatch;
}

async function upsertContacts({
  tenantId,
  jobId,
  companyId,
  contacts
}: {
  tenantId: string;
  jobId: string;
  companyId: string;
  contacts: ApolloContactRecord[];
}) {
  const existing = await prisma.contact.findMany({
    where: { tenantId },
    select: {
      id: true,
      companyId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      linkedinUrl: true,
      apolloContactId: true,
      apolloPersonId: true,
      apolloStatus: true,
      fullName: true,
      title: true,
      contactStatus: true,
      sequenceStatus: true,
      replyStatus: true,
      assignedRep: true,
      selectedSequenceId: true,
      selectedSequenceName: true,
      rawJson: true
    }
  });
  const ids: string[] = [];
  let activeHunterCadenceCount = 0;
  let existingCanonicalContactCount = 0;
  for (const incoming of contacts) {
    const match = findExistingContact(existing, incoming, companyId);
    if (
      match &&
      isActiveHunterCadence({
        sequenceStatus: match.sequenceStatus,
        sequenceName: match.selectedSequenceName
      })
    ) {
      activeHunterCadenceCount += 1;
      continue;
    }
    if (match && match.companyId !== companyId) {
      existingCanonicalContactCount += 1;
      continue;
    }
    const rawJson = isObject(match?.rawJson) ? match.rawJson : {};
    const data = {
      tenantId,
      companyId,
      firstName: incoming.firstName ?? match?.firstName ?? null,
      lastName: incoming.lastName ?? match?.lastName ?? null,
      fullName: incoming.fullName,
      title: incoming.title,
      department: incoming.department,
      seniority: incoming.seniority,
      email: incoming.email ?? match?.email ?? null,
      phone: incoming.phone ?? match?.phone ?? null,
      linkedinUrl: incoming.linkedinUrl ?? match?.linkedinUrl ?? null,
      source: ContactSource.APOLLO,
      contactStatus: match?.contactStatus ?? ContactStatus.REVIEWING,
      apolloContactId: incoming.apolloContactId ?? match?.apolloContactId ?? null,
      apolloPersonId: incoming.apolloPersonId ?? match?.apolloPersonId ?? null,
      apolloStatus:
        incoming.recordSource === "SAVED_CONTACT" || incoming.apolloContactId
          ? ApolloStatus.ENRICHED
          : match?.apolloStatus ?? ApolloStatus.NOT_STARTED,
      sequenceStatus: incoming.sequenceStatus,
      replyStatus: incoming.replyStatus,
      selectedSequenceId: match?.selectedSequenceId ?? null,
      selectedSequenceName: match?.selectedSequenceName ?? null,
      lastTouchAt: incoming.lastTouchAt,
      lastReplyAt: incoming.lastReplyAt,
      assignedRep: match?.assignedRep ?? null,
      rawJson: toInputJsonValue({
        ...rawJson,
        apollo: {
          importedAt: new Date().toISOString(),
          hunterHandoffJobId: jobId,
          recordSource: incoming.recordSource,
          availability: {
            email: incoming.hasEmailAvailable,
            phone: incoming.hasPhoneAvailable,
            linkedin: incoming.hasLinkedinAvailable
          },
          record: incoming.rawPayload
        }
      })
    };
    if (match) {
      await prisma.contact.updateMany({
        where: { id: match.id, tenantId },
        data
      });
      ids.push(match.id);
    } else {
      const created = await prisma.contact.create({
        data,
        select: { id: true }
      });
      ids.push(created.id);
    }
  }
  return {
    contactIds: ids,
    activeHunterCadenceCount,
    existingCanonicalContactCount
  };
}

export function rankHunterContacts(
  contacts: ApolloContactRecord[],
  recommendedPersona: string | null,
  opportunityGeography: string | null = null
) {
  const personaTokens = new Set(
    (recommendedPersona ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4)
  );
  return contacts
    .map((contact) => ({
      contact,
      score: contactFitScore(contact, personaTokens, opportunityGeography)
    }))
    .filter(({ contact, score }) =>
      score >= 20 &&
      hasUsableHunterEmail(contact) &&
      Boolean(contact.apolloContactId || contact.apolloPersonId) &&
      !isActiveHunterCadence({
        sequenceStatus: contact.sequenceStatus,
        sequenceName: contact.sequenceName
      }) &&
      !/\b(sales|business development|customer service|account executive)\b/i.test(
        `${contact.title ?? ""} ${contact.department ?? ""}`
      )
    )
    .sort((left, right) => right.score - left.score)
    .map(({ contact }) => contact);
}

function contactFitScore(
  contact: ApolloContactRecord,
  personaTokens: Set<string>,
  opportunityGeography: string | null
) {
  const text = `${contact.title ?? ""} ${contact.department ?? ""}`.toLowerCase();
  const geography = opportunityGeography?.toLowerCase() ?? "";
  let score = hasUsableHunterEmail(contact) ? 30 : 0;
  if (contact.hasLinkedinAvailable) score += 10;
  if (/\b(vp|vice president|head|director|chief|president|owner)\b/i.test(text)) score += 25;
  else if (/\bmanager\b/i.test(text)) score += 12;
  if (/\b(logistics|supply chain|operations|distribution|warehouse|warehousing|procurement|import)\b/i.test(text)) {
    score += 25;
  }
  score += Math.min(20, [...personaTokens].filter((token) => text.includes(token)).length * 5);
  const locationParts = [contact.city, contact.state, contact.country]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  if (locationParts.some((value) => value.length >= 3 && geography.includes(value))) {
    score += 15;
  } else if (contact.country && /\b(united states|usa|us)\b/i.test(contact.country)) {
    score += 4;
  }
  if (contact.replyStatus !== ReplyStatus.NO_REPLY) score -= 100;
  if (contact.sequenceStatus === SequenceStatus.FINISHED) score -= 5;
  if (
    contact.sequenceStatus === SequenceStatus.ENROLLED ||
    contact.sequenceStatus === SequenceStatus.PAUSED
  ) {
    score -= 10;
  }
  if (
    contact.sequenceStatus === SequenceStatus.REPLIED ||
    contact.sequenceStatus === SequenceStatus.BOUNCED
  ) {
    score -= 100;
  }
  if (isApolloUnresponsive(contact.rawPayload)) score -= 15;
  return score;
}

export function hasUsableHunterEmail(contact: { email: string | null }) {
  const email = contact.email?.trim() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isApolloUnresponsive(rawPayload: Record<string, unknown>) {
  const stage = [
    rawPayload.stage,
    rawPayload.contact_stage,
    rawPayload.account_stage,
    rawPayload.status
  ]
    .map((value) => {
      if (typeof value === "string") return value;
      if (isObject(value) && typeof value.name === "string") return value.name;
      return "";
    })
    .join(" ");
  return /\bunresponsive\b/i.test(stage);
}

function readStoredApolloContactContext(rawJson: Prisma.JsonValue | null) {
  const root = isObject(rawJson) ? rawJson : {};
  const apollo = isObject(root.apollo) ? root.apollo : {};
  const record = isObject(apollo.record) ? apollo.record : {};
  const availability = isObject(apollo.availability) ? apollo.availability : {};
  return {
    city: typeof record.city === "string" ? record.city : null,
    state:
      typeof record.state === "string"
        ? record.state
        : typeof record.region === "string"
          ? record.region
          : null,
    country: typeof record.country === "string" ? record.country : null,
    priorActivityStatus: isApolloUnresponsive(record) ? "UNRESPONSIVE" : null,
    hasEmailAvailable:
      availability.email === true || record.has_email === true,
    hasPhoneAvailable:
      availability.phone === true ||
      record.has_phone === true ||
      record.has_direct_phone === true ||
      record.has_mobile_phone === true,
    hasLinkedinAvailable:
      availability.linkedin === true ||
      record.has_linkedin === true ||
      record.has_linkedin_url === true
  };
}

function findExistingContact(
  existing: Array<{
    id: string;
    companyId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    apolloContactId: string | null;
    apolloPersonId: string | null;
    apolloStatus: ApolloStatus;
    fullName: string;
    title: string | null;
    contactStatus: ContactStatus;
    sequenceStatus: SequenceStatus;
    replyStatus: ReplyStatus;
    assignedRep: string | null;
    selectedSequenceId: string | null;
    selectedSequenceName: string | null;
    rawJson: Prisma.JsonValue | null;
  }>,
  incoming: ApolloContactRecord,
  companyId: string
) {
  const email = incoming.email?.trim().toLowerCase();
  const linkedin = incoming.linkedinUrl?.trim().toLowerCase();
  const incomingFirstName = normalizeContactIdentity(
    incoming.firstName ?? incoming.fullName.split(/\s+/u)[0] ?? null
  );
  const incomingTitle = normalizeContactIdentity(incoming.title);
  return (
    existing.find(
      (contact) =>
        incoming.apolloPersonId &&
        contact.apolloPersonId === incoming.apolloPersonId
    ) ??
    existing.find(
      (contact) =>
        incoming.apolloContactId &&
        contact.apolloContactId === incoming.apolloContactId
    ) ??
    existing.find(
      (contact) =>
        linkedin &&
        contact.linkedinUrl?.trim().toLowerCase() === linkedin
    ) ??
    existing.find(
      (contact) =>
        email &&
        contact.email?.trim().toLowerCase() === email
    ) ??
    existing.find((contact) => {
      const existingFirstName = normalizeContactIdentity(
        contact.firstName ?? contact.fullName.split(/\s+/u)[0] ?? null
      );
      return Boolean(
        contact.companyId === companyId &&
        incomingFirstName &&
        existingFirstName === incomingFirstName &&
        incomingTitle &&
        normalizeContactIdentity(contact.title) === incomingTitle
      );
    }) ??
    null
  );
}

function normalizeContactIdentity(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

async function finishJob(
  jobId: string,
  tenantId: string,
  output: HandoffOutput,
  now: Date
) {
  const failedCount = output.results.filter((result) => result.state === "ERROR").length;
  const reviewCount = output.results.filter((result) => result.state === "REVIEW_REQUIRED").length;
  const contactsImported = output.results.reduce((sum, result) => sum + result.contactsImported, 0);
  const plansGenerated = output.results.reduce((sum, result) => sum + result.plansGenerated, 0);
  const plansCreated = output.results.reduce(
    (sum, result) =>
      sum +
      (
        typeof result.plansCreated === "number"
          ? result.plansCreated
          : result.plansGenerated
      ),
    0
  );
  const existingPlansFound = output.results.reduce(
    (sum, result) =>
      sum +
      (
        typeof result.existingPlansFound === "number"
          ? result.existingPlansFound
          : 0
      ),
    0
  );
  const finalOutput: HandoffOutput = {
    ...output,
    phase: "COMPLETE",
    processingCompanyId: null,
    processingStartedAt: null,
    nextAttemptAt: null,
    completedAt: now.toISOString()
  };
  await prisma.$transaction([
    prisma.automationJobRun.updateMany({
      where: { id: jobId, tenantId },
      data: {
        status: failedCount > 0 ? JobStatus.ERROR : JobStatus.SUCCESS,
        finishedAt: now,
        errorMessage: failedCount > 0
          ? `${failedCount} Hunter outreach handoff compan${failedCount === 1 ? "y" : "ies"} failed after retries.`
          : null,
        output: toInputJsonValue(finalOutput)
      }
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: "lead-gen.hunter-outreach-handoff.completed",
        entityType: "AutomationJobRun",
        entityId: jobId,
        after: {
          companyCount: output.results.length,
          failedCount,
          reviewCount,
          contactsImported,
          plansGenerated,
          plansCreated,
          existingPlansFound
        }
      }
    })
  ]);
  return { failedCount, reviewCount, contactsImported, plansGenerated };
}

function emptyOutput(): HandoffOutput {
  return {
    phase: "QUEUED",
    processingCompanyId: null,
    processingStartedAt: null,
    nextAttemptAt: null,
    attempts: {},
    results: [],
    completedAt: null
  };
}

function parseInput(value: Prisma.JsonValue | null) {
  const root = isObject(value) ? value : {};
  const rows = Array.isArray(root.items) ? root.items : [];
  const items = rows.map((row) => {
    const item = isObject(row) ? row : {};
    return {
      companyId: requiredString(item.companyId, "companyId"),
      companyName: requiredString(item.companyName, "companyName"),
      researchSignalId: requiredString(item.researchSignalId, "researchSignalId"),
      prospectingDecisionId: requiredString(item.prospectingDecisionId, "prospectingDecisionId"),
      recommendedPersona:
        typeof item.recommendedPersona === "string" ? item.recommendedPersona : null
    };
  });
  return {
    maxContactsPerCompany:
      typeof root.maxContactsPerCompany === "number"
        ? Math.min(3, Math.max(1, Math.round(root.maxContactsPerCompany)))
        : 2,
    forceContactReview: root.forceContactReview === true,
    authorizePaidEmailEnrichment:
      root.authorizePaidEmailEnrichment === true,
    explicitApolloPersonIds: normalizeExplicitApolloPersonIds(
      Array.isArray(root.explicitApolloPersonIds)
        ? root.explicitApolloPersonIds.filter(
            (value): value is string => typeof value === "string"
          )
        : []
    ),
    items
  };
}

function normalizeExplicitApolloPersonIds(values: string[]) {
  const normalized = [
    ...new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[a-f0-9]{24}$/u.test(value))
    )
  ];
  if (normalized.length > HUNTER_SELECTED_CONTACT_MAX) {
    throw new Error(
      `Select no more than ${HUNTER_SELECTED_CONTACT_MAX} Apollo people.`
    );
  }
  return normalized;
}

function parseOutput(value: Prisma.JsonValue | null): HandoffOutput {
  const root = isObject(value) ? value : {};
  const attempts = isObject(root.attempts)
    ? Object.fromEntries(
        Object.entries(root.attempts)
          .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      )
    : {};
  return {
    phase: root.phase === "RUNNING" || root.phase === "COMPLETE" ? root.phase : "QUEUED",
    processingCompanyId:
      typeof root.processingCompanyId === "string" ? root.processingCompanyId : null,
    processingStartedAt:
      typeof root.processingStartedAt === "string" ? root.processingStartedAt : null,
    nextAttemptAt: typeof root.nextAttemptAt === "string" ? root.nextAttemptAt : null,
    attempts,
    results: Array.isArray(root.results) ? root.results as unknown as HandoffResult[] : [],
    completedAt: typeof root.completedAt === "string" ? root.completedAt : null
  };
}

function terminal(
  item: HandoffItem,
  state: HandoffResult["state"],
  matchClassification: ApolloCompanyMatchClassification | null,
  contactsImported: number,
  plansGenerated: number,
  qaFailedPlans: number,
  message: string,
  discovery: {
    apolloContactsFound: number;
    contactsRanked: number;
    plansCreated?: number;
    existingPlansFound?: number;
  } = {
    apolloContactsFound: contactsImported,
    contactsRanked: contactsImported
  }
): HandoffResult {
  return {
    companyId: item.companyId,
    companyName: item.companyName,
    state,
    matchClassification,
    apolloContactsFound: discovery.apolloContactsFound,
    contactsRanked: discovery.contactsRanked,
    contactsImported,
    plansCreated: discovery.plansCreated ?? plansGenerated,
    existingPlansFound: discovery.existingPlansFound ?? 0,
    actionablePlans: plansGenerated,
    plansGenerated,
    qaFailedPlans,
    message: message.slice(0, 500),
    completedAt: new Date().toISOString()
  };
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Hunter outreach handoff failed.";
  return message.replace(/\b(?:sk|pk)-[A-Za-z0-9_-]+\b/g, "[REDACTED]").slice(0, 500);
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Hunter outreach handoff input is missing ${field}.`);
  }
  return value.trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function hunterHandoffDedupeKey(companyId: string, prospectingDecisionId: string) {
  return createHash("sha256").update(`${companyId}|${prospectingDecisionId}`).digest("hex");
}
