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
import {
  generateOutreachPlanForContact,
  loadOutreachPlanContactContext
} from "@/modules/lead-gen/outreach-plan-generation";
import { prisma } from "@/server/db";
import {
  ApolloRateLimitError,
  fetchApolloContactsForCompany,
  type ApolloContactLookupResult,
  type ApolloContactRecord
} from "@/server/integrations/apollo";
import { isOpenAiDraftGenerationConfigured } from "@/server/integrations/openai";

export const HUNTER_OUTREACH_HANDOFF_JOB_TYPE = "HUNTER_OUTREACH_HANDOFF";

const ACTIVE_JOB_WINDOW_MS = 4 * 60 * 60 * 1_000;
const PROCESSING_LEASE_MS = 15 * 60 * 1_000;
const MAX_COMPANY_ATTEMPTS = 3;

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

export async function enqueueHunterOutreachHandoff({
  tenantId,
  researchRunId,
  prospectingPlanRunId
}: {
  tenantId: string;
  researchRunId: string;
  prospectingPlanRunId: string;
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
        maxContactsPerCompany: Math.min(5, Math.max(1, policy.maxContactsPerCompany)),
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
        maxContactsPerCompany: Math.min(5, Math.max(1, policy.maxContactsPerCompany))
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
      maxContactsPerCompany: input.maxContactsPerCompany
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
  maxContactsPerCompany
}: {
  tenantId: string;
  jobId: string;
  item: HandoffItem;
  maxContactsPerCompany: number;
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
      contacts: {
        where: {
          contactStatus: { notIn: [ContactStatus.REJECTED, ContactStatus.DO_NOT_CONTACT] },
          replyStatus: ReplyStatus.NO_REPLY,
          sequenceStatus: { in: [SequenceStatus.NOT_STARTED, SequenceStatus.READY] }
        },
        orderBy: [{ contactScore: "desc" }, { updatedAt: "desc" }],
        take: maxContactsPerCompany,
        select: { id: true }
      },
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
  if (eligibility.status !== "ELIGIBLE") {
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

  let contactIds = company.contacts.map((contact) => contact.id);
  let contactsImported = 0;
  let classification: ApolloCompanyMatchClassification | null =
    company.apolloOrganizationId ? ApolloCompanyMatchClassification.DIRECT_COMPANY : null;
  if (contactIds.length === 0) {
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

    const ranked = rankHunterContacts(lookup.contacts, item.recommendedPersona)
      .slice(0, maxContactsPerCompany);
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
  }

  let plansGenerated = 0;
  let qaFailedPlans = 0;
  for (const contactId of contactIds.slice(0, maxContactsPerCompany)) {
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
      email: true,
      linkedinUrl: true,
      apolloContactId: true,
      apolloPersonId: true,
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
      firstName: incoming.firstName,
      lastName: incoming.lastName,
      fullName: incoming.fullName,
      title: incoming.title,
      department: incoming.department,
      seniority: incoming.seniority,
      email: incoming.email,
      phone: incoming.phone,
      linkedinUrl: incoming.linkedinUrl,
      source: ContactSource.APOLLO,
      contactStatus: match?.contactStatus ?? ContactStatus.REVIEWING,
      apolloContactId: incoming.apolloContactId,
      apolloPersonId: incoming.apolloPersonId,
      apolloStatus: ApolloStatus.ENRICHED,
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
  recommendedPersona: string | null
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
      score: contactFitScore(contact, personaTokens)
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

function contactFitScore(contact: ApolloContactRecord, personaTokens: Set<string>) {
  const text = `${contact.title ?? ""} ${contact.department ?? ""}`.toLowerCase();
  let score = contact.email ? 30 : 0;
  if (contact.linkedinUrl) score += 10;
  if (/\b(vp|vice president|head|director|chief|president|owner)\b/i.test(text)) score += 25;
  else if (/\bmanager\b/i.test(text)) score += 12;
  if (/\b(logistics|supply chain|operations|distribution|warehouse|warehousing|procurement|import)\b/i.test(text)) {
    score += 25;
  }
  score += Math.min(20, [...personaTokens].filter((token) => text.includes(token)).length * 5);
  return score;
}

function findExistingContact(
  existing: Array<{
    id: string;
    email: string | null;
    linkedinUrl: string | null;
    apolloContactId: string | null;
    apolloPersonId: string | null;
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
        ? Math.min(5, Math.max(1, Math.round(root.maxContactsPerCompany)))
        : 2,
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
