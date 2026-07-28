import { createHash } from "node:crypto";

import {
  ApolloCompanyMatchClassification,
  ApolloStatus,
  ContactSource,
  ContactStatus,
  HunterAutomationMode,
  JobStatus,
  Prisma,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";

import {
  evaluateHunterOutreachEligibility,
  getHunterOutreachResearchMaxAgeDays
} from "@/modules/lead-gen/hunter-outreach-eligibility";
import { HUNTER_COMPANY_RESEARCH_JOB_TYPE } from "@/modules/lead-gen/hunter-job-types";
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
  type ApolloContactLookupResult,
  type ApolloContactRecord
} from "@/server/integrations/apollo";
import {
  isOpenAiDraftGenerationConfigured,
  reviewHunterContactFit
} from "@/server/integrations/openai";

export const HUNTER_OUTREACH_HANDOFF_JOB_TYPE = "HUNTER_OUTREACH_HANDOFF";

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
  contactsImported: number;
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
    trigger: "MANUAL"
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
      forceContactReview: input.forceContactReview
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
      contactsImported: 0,
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
  forceContactReview
}: {
  tenantId: string;
  jobId: string;
  item: HandoffItem;
  maxContactsPerCompany: number;
  forceContactReview: boolean;
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
        take: 1,
        select: {
          classification: true,
          reviewedAt: true
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
  if (
    !company.apolloOrganizationId &&
    latestMatch &&
    latestMatch.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY
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

  const lookup = await fetchApolloContactsForCompany({
    companyName: company.name,
    domain: company.domain,
    apolloOrganizationId: company.apolloOrganizationId
  });
  classification = lookup.match.classification;
  await recordCompanyMatch(tenantId, company.id, lookup, {
    domain: company.domain,
    linkedinUrl: company.linkedinUrl
  });
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
  if (lookup.contacts.length === 0) {
    return terminal(item, "NO_CONTACTS", classification, 0, 0, 0, "Apollo returned no contacts.");
  }
  if (ranked.length === 0) {
    return terminal(
      item,
      "NO_QUALIFYING_CONTACTS",
      classification,
      0,
      0,
      0,
      "Apollo returned contacts, but none matched Hunter's buyer criteria."
    );
  }
  contactIds = await upsertContacts({
    tenantId,
    jobId,
    companyId: company.id,
    contacts: ranked
  });
  contactsImported = contactIds.length;

  let plansGenerated = 0;
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
  if (fit.acceptedContactIds.length === 0) {
    return terminal(
      item,
      "CONTACT_REVIEW_REQUIRED",
      classification,
      contactsImported,
      0,
      0,
      `${fit.reviewCount} contact${fit.reviewCount === 1 ? "" : "s"} evaluated; none cleared the AI buyer-role gate for automatic drafting.`
    );
  }

  for (const contactId of fit.acceptedContactIds) {
    const context = await loadOutreachPlanContactContext({ tenantId, contactId });
    if (!context || context.contactTier === "UNRANKED") continue;
    await prisma.contact.updateMany({
      where: { id: contactId, tenantId },
      data: {
        contactScore: context.contactScore,
        contactTier: context.contactTier
      }
    });
    const generated = await generateOutreachPlanForContact({
      tenantId,
      contactId,
      forceRegenerate: false,
      generateWhenNotRequired: true
    });
    if (generated.state === "qa_passed") plansGenerated += 1;
    if (generated.state === "qa_failed") {
      plansGenerated += 1;
      qaFailedPlans += 1;
    }
  }
  if (plansGenerated === 0) {
    return terminal(
      item,
      "NO_QUALIFYING_CONTACTS",
      classification,
      contactsImported,
      0,
      0,
      "Contacts were available, but none cleared deterministic contact ranking."
    );
  }
  return terminal(
    item,
    "PLANS_GENERATED",
    classification,
    contactsImported,
    plansGenerated,
    qaFailedPlans,
    `${plansGenerated} grounded outreach plan${plansGenerated === 1 ? "" : "s"} created for human review.`
  );
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

  const reviewByContactId = new Map<string, HunterContactFitReview>();
  const contactsNeedingReview = [];
  for (const contact of contacts) {
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
          hasEmail: Boolean(contact.email) || apolloContext.hasEmailAvailable,
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

  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const acceptedContactIds = [...reviewByContactId.values()]
    .filter((review) => {
      const contact = contactById.get(review.contactId);
      return Boolean(
        contact &&
        isContactFitAutoEligible(review) &&
        isContactEligibleForFreshOutreach(contact)
      );
    })
    .sort((left, right) => {
      const dispositionDelta =
        contactFitPriority(left.disposition) - contactFitPriority(right.disposition);
      return dispositionDelta || right.confidence - left.confidence;
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

export function isContactEligibleForFreshOutreach(contact: {
  sequenceStatus: SequenceStatus;
  replyStatus: ReplyStatus;
}) {
  return (
    contact.replyStatus === ReplyStatus.NO_REPLY &&
    (contact.sequenceStatus === SequenceStatus.NOT_STARTED ||
      contact.sequenceStatus === SequenceStatus.READY)
  );
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
        classification: lookup.match.classification,
        nameMatchType: lookup.match.nameMatchType,
        domainMatch: lookup.match.domainMatch,
        logisticsProviderMatch: lookup.match.logisticsProviderMatch,
        branchLocationMatch: lookup.match.branchLocationMatch,
        matchReason: lookup.match.matchReason,
        queryJson: toInputJsonValue(lookup.match.query),
        rawJson: lookup.match.rawPayload
          ? toInputJsonValue(lookup.match.rawPayload)
          : Prisma.JsonNull
      }
    });
    if (lookup.match.classification === ApolloCompanyMatchClassification.DIRECT_COMPANY) {
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
    where: { tenantId, companyId },
    select: {
      id: true,
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
      assignedRep: true,
      rawJson: true
    }
  });
  const ids: string[] = [];
  for (const incoming of contacts) {
    const match = findExistingContact(existing, incoming);
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
      selectedSequenceId: incoming.sequenceId,
      selectedSequenceName: incoming.sequenceName,
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
  return ids;
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
      Boolean(contact.apolloContactId || contact.apolloPersonId) &&
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
  let score = contact.hasEmailAvailable ? 30 : 0;
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
  if (
    contact.sequenceStatus !== SequenceStatus.NOT_STARTED &&
    contact.sequenceStatus !== SequenceStatus.READY
  ) {
    score -= 30;
  }
  if (isApolloUnresponsive(contact.rawPayload)) score -= 25;
  return score;
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
    assignedRep: string | null;
    rawJson: Prisma.JsonValue | null;
  }>,
  incoming: ApolloContactRecord
) {
  const email = incoming.email?.trim().toLowerCase();
  const linkedin = incoming.linkedinUrl?.trim().toLowerCase();
  return existing.find((contact) =>
    (incoming.apolloContactId && contact.apolloContactId === incoming.apolloContactId) ||
    (incoming.apolloPersonId && contact.apolloPersonId === incoming.apolloPersonId) ||
    (email && contact.email?.trim().toLowerCase() === email) ||
    (linkedin && contact.linkedinUrl?.trim().toLowerCase() === linkedin) ||
    (
      contact.fullName.trim().toLowerCase() === incoming.fullName.trim().toLowerCase() &&
      (contact.title ?? "").trim().toLowerCase() === (incoming.title ?? "").trim().toLowerCase()
    )
  ) ?? null;
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
          plansGenerated
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
    items
  };
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
  message: string
): HandoffResult {
  return {
    companyId: item.companyId,
    companyName: item.companyName,
    state,
    matchClassification,
    contactsImported,
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
