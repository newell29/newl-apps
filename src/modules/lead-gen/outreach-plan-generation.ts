import {
  ContactOutreachDraftSource,
  ContactOutreachDraftStatus,
  HunterServiceLine,
  OutreachPlanStatus,
  OutreachQaStatus,
  Prisma
} from "@prisma/client";

import {
  buildTradeMiningEvidenceWhere,
  summarizeTradeMiningEvidence
} from "@/modules/lead-gen/queries";
import { resolveConfiguredApolloSender } from "@/modules/lead-gen/apollo-sender-routing";
import { scoreContact } from "@/modules/lead-gen/contact-scoring";
import {
  evaluateHunterOutreachEligibility,
  getHunterOutreachResearchMaxAgeDays
} from "@/modules/lead-gen/hunter-outreach-eligibility";
import {
  DEFAULT_OUTREACH_DRAFT_MODEL,
  DEFAULT_OUTREACH_QA_MODEL,
  DEFAULT_OUTREACH_STRATEGY_MODEL,
  classifyOutreachQaIssues,
  fingerprintOutreachEvidence,
  getOutreachRegenerationBlockReason,
  mergeOutreachQaResults,
  OUTREACH_PLAN_COMPATIBLE_PASSED_PROMPT_VERSIONS,
  OUTREACH_PLAN_PROMPT_VERSION,
  repairOutreachSequenceDeterministically,
  runDeterministicOutreachQa,
  type GeneratedOutreachSequence,
  type ModelOutreachQaResult,
  type OutreachEvidenceRecord,
  type OutreachQaIssue,
  type OutreachStrategy
} from "@/modules/lead-gen/outreach-plan";
import { persistOutreachPlanWithSteps } from "@/modules/lead-gen/outreach-plan-persistence";
import {
  recommendSequenceForContact,
  shouldUseHunterSequenceRecommendation
} from "@/modules/lead-gen/sequence-catalog";
import {
  buildApolloSequenceMappingsWithDefaults,
  parseApolloSequenceDirectory,
  parseApolloSequenceMapping,
  parseSearchProfileApolloSequenceMapping,
  resolveApolloSequenceMappings
} from "@/modules/settings/apollo-sequence-mapping";
import { parseApolloRepMapping } from "@/modules/settings/apollo-rep-mapping";
import { DEFAULT_TRADEMINING_SCORING_SETTINGS } from "@/modules/settings/types";
import { prisma } from "@/server/db";
import {
  generateCompleteOutreachSequence,
  generateOutreachStrategy,
  reviewOutreachSequenceGrounding,
  type OpenAiStructuredUsage
} from "@/server/integrations/openai";

export function normalizeHunterChannelStrategy(
  strategy: OutreachStrategy,
  allowCallTask: boolean
): OutreachStrategy {
  return {
    ...strategy,
    channelStrategy: allowCallTask
      ? [
          "Email on day 0",
          "Email on day 4",
          "Separate human call task on day 7",
          "Email on day 10"
        ]
      : [
          "Email on day 0",
          "Email on day 4",
          "Email on day 10"
        ]
  };
}

export function shouldReuseExistingOutreachPlan({
  promptVersion,
  qaStatus,
  existingSequenceName,
  selectedSequenceName
}: {
  promptVersion: string;
  qaStatus: OutreachQaStatus;
  existingSequenceName?: string | null;
  selectedSequenceName?: string | null;
}) {
  if (
    selectedSequenceName &&
    existingSequenceName !== undefined &&
    existingSequenceName !== selectedSequenceName
  ) {
    return false;
  }
  return (
    promptVersion === OUTREACH_PLAN_PROMPT_VERSION ||
    (
      qaStatus === OutreachQaStatus.PASSED &&
      OUTREACH_PLAN_COMPATIBLE_PASSED_PROMPT_VERSIONS.has(promptVersion)
    )
  );
}

export function buildBoundedOutreachRepairFeedback({
  deterministicIssues,
  modelIssues,
  allowCallTask,
  senderFirstName
}: {
  deterministicIssues: OutreachQaIssue[];
  modelIssues: OutreachQaIssue[];
  allowCallTask: boolean;
  senderFirstName: string;
}) {
  const blockingIssues = [...deterministicIssues, ...modelIssues]
    .filter(
      (issue) =>
        issue.severity === "ERROR" &&
        classifyOutreachQaIssues([issue]) === "MODEL_REGENERATION"
    )
    .filter(
      (issue, index, issues) =>
        issues.findIndex(
          (candidate) =>
            candidate.code === issue.code &&
            candidate.stepNumber === issue.stepNumber &&
            candidate.message === issue.message
        ) === index
    )
    .slice(0, 12);
  if (blockingIssues.length === 0) {
    return null;
  }

  const schedule = allowCallTask
    ? "Return exactly three EMAIL steps on days 0, 4, and 10 plus one CALL_TASK on day 7. The CALL_TASK must be its own channel and must not have a subject."
    : "Return exactly three EMAIL steps on days 0, 4, and 10. Do not include a call or LinkedIn task.";
  const issueText = blockingIssues
    .map(
      (issue) =>
        `${issue.stepNumber === null ? "Sequence" : `Step ${issue.stepNumber}`}: ${issue.message}`
    )
    .join("\n");

  return [
    "Automatic bounded QA repair: regenerate the complete sequence once and correct every blocking issue below.",
    schedule,
    `Every email must end with ${senderFirstName} on its own final line.`,
    "Never expose research provenance in customer-visible copy. Do not say saved activity, saved shipment, saved record, evidence, research, TradeMining, Hunter, internal, database, or system.",
    "Use only evidenceRefs that exactly match IDs in the supplied evidence ledger.",
    "Replace or remove each exact disputed clause. Do not preserve an unsupported inference by paraphrasing it.",
    "Keep dates, quantities, and intended outcomes attached only to the exact fact they modify in the evidence.",
    "A job posting proves only that the listed role is being recruited; it does not prove added capacity, team growth, increased workload, or an operational problem.",
    issueText
  ].join("\n");
}

function combineOutreachFeedback(
  reviewerFeedback: string | null,
  repairFeedback: string | null
) {
  return [reviewerFeedback?.trim(), repairFeedback?.trim()]
    .filter((value): value is string => Boolean(value))
    .join("\n\n") || null;
}

export async function runBoundedOutreachQaRepair({
  generateSequence,
  runDeterministicQa,
  runModelQa,
  repairSequence = (sequence) => sequence,
  allowCallTask,
  senderFirstName
}: {
  generateSequence: (
    repairFeedback: string | null
  ) => Promise<{
    sequence: GeneratedOutreachSequence;
    usage: OpenAiStructuredUsage;
  }>;
  runDeterministicQa: (
    sequence: GeneratedOutreachSequence
  ) => ReturnType<typeof runDeterministicOutreachQa>;
  runModelQa: (
    sequence: GeneratedOutreachSequence
  ) => Promise<{
    result: ModelOutreachQaResult;
    usage: OpenAiStructuredUsage | null;
  }>;
  repairSequence?: (
    sequence: GeneratedOutreachSequence
  ) => GeneratedOutreachSequence;
  allowCallTask: boolean;
  senderFirstName: string;
}) {
  const draftingUsageAttempts: OpenAiStructuredUsage[] = [];
  const qaUsageAttempts: OpenAiStructuredUsage[] = [];

  const createDraft = async (repairFeedback: string | null) => {
    const generated = await generateSequence(repairFeedback);
    draftingUsageAttempts.push(generated.usage);
    return repairSequence(generated.sequence);
  };
  const reviewDraft = async (sequence: GeneratedOutreachSequence) => {
    const reviewed = await runModelQa(sequence);
    if (reviewed.usage) {
      qaUsageAttempts.push(reviewed.usage);
    }
    return reviewed.result;
  };

  let sequence = await createDraft(null);
  let deterministicQa = runDeterministicQa(sequence);
  let modelQa = deterministicQa.passed
    ? await reviewDraft(sequence)
    : { passed: true, issues: [] as OutreachQaIssue[] };
  const automaticRepairFeedback = buildBoundedOutreachRepairFeedback({
    deterministicIssues: deterministicQa.issues,
    modelIssues: modelQa.issues,
    allowCallTask,
    senderFirstName
  });

  if (automaticRepairFeedback) {
    sequence = await createDraft(automaticRepairFeedback);
    deterministicQa = runDeterministicQa(sequence);
    modelQa = deterministicQa.passed
      ? await reviewDraft(sequence)
      : { passed: true, issues: [] as OutreachQaIssue[] };
  }

  return {
    sequence,
    deterministicQa,
    modelQa,
    draftingUsageAttempts,
    qaUsageAttempts,
    automaticRepairAttempted: Boolean(automaticRepairFeedback),
    automaticRepairFeedback
  };
}

export async function generateOutreachPlanForContact({
  tenantId,
  contactId,
  forceRegenerate,
  generateWhenNotRequired = false,
  reviewerFeedback = null
}: {
  tenantId: string;
  contactId: string;
  forceRegenerate: boolean;
  generateWhenNotRequired?: boolean;
  reviewerFeedback?: string | null;
}) {
  const draftContext = await loadOutreachPlanContactContext({ tenantId, contactId });

  if (!draftContext) {
    throw new Error("Contact not found for this tenant.");
  }
  const regenerationBlockReason = forceRegenerate
    ? getOutreachRegenerationBlockReason({
        planStatus: draftContext.existingOutreachPlan?.status ?? null,
        contactStatus: draftContext.contact.contactStatus,
        replyStatus: draftContext.contact.replyStatus,
        sequenceStatus: draftContext.contact.sequenceStatus
      })
    : null;
  if (regenerationBlockReason) {
    throw new Error(regenerationBlockReason);
  }
  if (!draftContext.requiresAiDraft && !forceRegenerate && !generateWhenNotRequired) {
    return { state: "not_required" as const };
  }
  if (draftContext.contactTier === "UNRANKED") {
    if (forceRegenerate) {
      throw new Error("This contact must be ranked before generating an outreach plan.");
    }
    return { state: "unranked" as const };
  }
  if (draftContext.hunterEligibility.status !== "ELIGIBLE" || !draftContext.hunterEligibility.directive) {
    if (forceRegenerate) {
      throw new Error(`${draftContext.hunterEligibility.label}: ${draftContext.hunterEligibility.reason}`);
    }
    return { state: "ineligible" as const };
  }
  if (!draftContext.selectedSequenceName) {
    if (forceRegenerate) {
      throw new Error("Select a cadence for this contact before generating the AI draft.");
    }
    return { state: "sequence_missing" as const };
  }
  if (!draftContext.senderIdentity) {
    if (forceRegenerate) {
      throw new Error(
        "No active Apollo sender mailbox is mapped to this contact's assigned rep."
      );
    }
    return { state: "sender_missing" as const };
  }
  const senderIdentity = draftContext.senderIdentity;

  const evidenceLedger = buildOutreachEvidenceLedger(draftContext);
  if (evidenceLedger.length === 0) {
    if (forceRegenerate) {
      throw new Error("No saved Hunter or TradeMining evidence is available for this company yet.");
    }
    return { state: "evidence_missing" as const };
  }
  if (
    draftContext.existingOutreachPlan &&
    (
      draftContext.existingOutreachPlan.status === OutreachPlanStatus.APPROVED ||
      shouldReuseExistingOutreachPlan({
        promptVersion: draftContext.existingOutreachPlan.promptVersion,
        qaStatus: draftContext.existingOutreachPlan.qaStatus,
        existingSequenceName: draftContext.existingOutreachPlan.sequenceName,
        selectedSequenceName: draftContext.selectedSequenceName
      })
    ) &&
    !forceRegenerate
  ) {
    return {
      state: "already_generated" as const,
      planId: draftContext.existingOutreachPlan.id,
      planStatus: draftContext.existingOutreachPlan.status,
      qaStatus: draftContext.existingOutreachPlan.qaStatus
    };
  }

  const models = loadOutreachModels();
  const hunterDirective = draftContext.hunterEligibility.directive;
  const allowCallTask =
    hunterDirective.opportunityTier === "HOT_OPPORTUNITY";
  const strategyGeneration = await generateOutreachStrategy({
    model: models.strategy,
    companyName: draftContext.contact.company.name,
    companyDomain: draftContext.contact.company.domain,
    contact: {
      firstName: draftContext.contact.firstName,
      fullName: draftContext.contact.fullName,
      title: draftContext.contact.title,
      department: draftContext.contact.department,
      seniority: draftContext.contact.seniority
    },
    selectedSequenceName: draftContext.selectedSequenceName,
    recommendedPersona: hunterDirective.recommendedPersona,
    recommendedCadence: hunterDirective.recommendedCadence,
    hunterDirective,
    senderFirstName: senderIdentity.firstName,
    allowCallTask,
    evidence: evidenceLedger,
    reviewerFeedback
  });
  const strategy = normalizeHunterChannelStrategy({
    ...strategyGeneration.strategy,
    senderRecommendation: senderIdentity.firstName
  }, allowCallTask);
  const contactContext = {
    firstName: draftContext.contact.firstName,
    fullName: draftContext.contact.fullName,
    title: draftContext.contact.title,
    department: draftContext.contact.department,
    seniority: draftContext.contact.seniority
  };
  const repaired = await runBoundedOutreachQaRepair({
    generateSequence: async (repairFeedback) =>
      generateCompleteOutreachSequence({
        model: models.drafting,
        companyName: draftContext.contact.company.name,
        contact: contactContext,
        selectedSequenceName: draftContext.selectedSequenceName,
        strategy,
        senderFirstName: senderIdentity.firstName,
        evidence: evidenceLedger,
        allowCallTask,
        reviewerFeedback: combineOutreachFeedback(reviewerFeedback, repairFeedback)
      }),
    runDeterministicQa: (candidateSequence) =>
      runDeterministicOutreachQa({
        evidence: evidenceLedger,
        strategy,
        sequence: candidateSequence,
        senderFirstName: senderIdentity.firstName,
        allowCallTask
      }),
    repairSequence: (candidateSequence) =>
      repairOutreachSequenceDeterministically({
        evidence: evidenceLedger,
        sequence: candidateSequence
      }).sequence,
    runModelQa: async (candidateSequence) => {
      try {
        const qaReview = await reviewOutreachSequenceGrounding({
          model: models.qa,
          companyName: draftContext.contact.company.name,
          contact: contactContext,
          strategy,
          sequence: candidateSequence,
          evidence: evidenceLedger,
          senderFirstName: senderIdentity.firstName,
          allowCallTask
        });
        return {
          result: qaReview.result,
          usage: qaReview.usage
        };
      } catch (error) {
        return {
          result: {
            passed: false,
            issues: [{
              code: "MODEL_QA_UNAVAILABLE",
              severity: "ERROR" as const,
              message: error instanceof Error ? error.message : "The model QA check could not be completed.",
              stepNumber: null
            }]
          },
          usage: null
        };
      }
    },
    allowCallTask,
    senderFirstName: senderIdentity.firstName
  });
  const {
    sequence,
    deterministicQa,
    modelQa,
    draftingUsageAttempts,
    qaUsageAttempts,
    automaticRepairAttempted,
    automaticRepairFeedback
  } = repaired;

  const qa = mergeOutreachQaResults(deterministicQa, modelQa);
  const firstEmail = sequence.steps.find((step) => step.channel === "EMAIL");
  if (!firstEmail?.subject) {
    throw new Error("The generated outreach sequence did not include a valid first email.");
  }
  const firstEmailSubject = firstEmail.subject;

  const rawInputs = {
    models,
    promptVersion: OUTREACH_PLAN_PROMPT_VERSION,
    modelUsage: {
      strategy: strategyGeneration.usage,
      drafting: draftingUsageAttempts.at(-1) ?? null,
      draftingAttempts: draftingUsageAttempts,
      qa: qaUsageAttempts.at(-1) ?? null,
      qaAttempts: qaUsageAttempts
    },
    automaticRepair: {
      attempted: automaticRepairAttempted,
      feedback: automaticRepairFeedback
    },
    generatedAt: new Date().toISOString(),
    companyName: draftContext.contact.company.name,
    companyPriorityScore: draftContext.contact.company.priorityScore,
    leadScore: draftContext.leadScore,
    contactTier: draftContext.contactTier,
    selectedSequenceName: draftContext.selectedSequenceName,
    selectedSequenceId: draftContext.selectedSequenceId,
    senderIdentity,
    reviewerFeedback,
    hunterDirective,
    strategy,
    evidenceLedger
  };

  const persisted = await prisma.$transaction(async (transaction) => {
    const latestPlan = await transaction.outreachPlan.findFirst({
      where: { tenantId, contactId: draftContext.contact.id },
      orderBy: { version: "desc" },
      select: { version: true }
    });
    await transaction.outreachPlan.updateMany({
      where: {
        tenantId,
        contactId: draftContext.contact.id,
        status: { not: OutreachPlanStatus.ARCHIVED }
      },
      data: {
        status: OutreachPlanStatus.ARCHIVED,
        archivedAt: new Date()
      }
    });
    const version = (latestPlan?.version ?? 0) + 1;
    const plan = await persistOutreachPlanWithSteps({
      transaction,
      plan: {
        tenantId,
        companyId: draftContext.contact.companyId,
        contactId: draftContext.contact.id,
        version,
        status: qa.passed ? OutreachPlanStatus.QA_PASSED : OutreachPlanStatus.QA_FAILED,
        qaStatus: qa.passed ? OutreachQaStatus.PASSED : OutreachQaStatus.FAILED,
        serviceLine: strategy.serviceLine,
        opportunityType: strategy.opportunityType,
        objective: strategy.objective,
        triggerSummary: strategy.triggerSummary,
        buyerHypothesis: strategy.buyerHypothesis,
        valueProposition: strategy.valueProposition,
        likelyObjection: strategy.likelyObjection,
        callToAction: strategy.callToAction,
        channelStrategy: toInputJsonValue(strategy.channelStrategy),
        senderRecommendation: strategy.senderRecommendation,
        sequenceName: draftContext.selectedSequenceName,
        sequenceId: draftContext.selectedSequenceId,
        confidence: strategy.confidence,
        evidence: toInputJsonValue(evidenceLedger),
        evidenceFingerprint: fingerprintOutreachEvidence(evidenceLedger),
        strategyModel: models.strategy,
        draftingModel: models.drafting,
        qaModel: models.qa,
        promptVersion: OUTREACH_PLAN_PROMPT_VERSION,
        qaIssues: toInputJsonValue(qa.issues),
        qaCheckedAt: new Date()
      },
      steps: sequence.steps.map((step) => ({
        tenantId,
        stepNumber: step.stepNumber,
        channel: step.channel,
        delayDays: step.delayDays,
        subject: step.subject,
        body: step.body,
        angle: step.angle,
        evidenceRefs: toInputJsonValue(step.evidenceRefs),
        qaIssues: toInputJsonValue(
          qa.issues.filter((issue) => issue.stepNumber === null || issue.stepNumber === step.stepNumber)
        )
      }))
    });

    await transaction.contactOutreachDraft.upsert({
      where: {
        tenantId_contactId_sequenceName: {
          tenantId,
          contactId: draftContext.contact.id,
          sequenceName: draftContext.selectedSequenceName
        }
      },
      update: {
        companyId: draftContext.contact.companyId,
        leadId: draftContext.leadId,
        sequenceId: draftContext.selectedSequenceId,
        subject: firstEmailSubject,
        body: firstEmail.body,
        status: qa.passed ? ContactOutreachDraftStatus.AVAILABLE : ContactOutreachDraftStatus.DRAFT,
        source: ContactOutreachDraftSource.OPENAI,
        aiGenerated: true,
        personalizationNotes: `${strategy.triggerSummary} Evidence: ${firstEmail.evidenceRefs.join(", ")}.`,
        approvedAt: null,
        rawInputs: toInputJsonValue(rawInputs),
        rawJson: toInputJsonValue({ provider: "openai", outreachPlanId: plan.id, qa })
      },
      create: {
        tenantId,
        contactId: draftContext.contact.id,
        companyId: draftContext.contact.companyId,
        leadId: draftContext.leadId,
        sequenceName: draftContext.selectedSequenceName,
        sequenceId: draftContext.selectedSequenceId,
        subject: firstEmailSubject,
        body: firstEmail.body,
        status: qa.passed ? ContactOutreachDraftStatus.AVAILABLE : ContactOutreachDraftStatus.DRAFT,
        source: ContactOutreachDraftSource.OPENAI,
        aiGenerated: true,
        personalizationNotes: `${strategy.triggerSummary} Evidence: ${firstEmail.evidenceRefs.join(", ")}.`,
        rawInputs: toInputJsonValue(rawInputs),
        rawJson: toInputJsonValue({ provider: "openai", outreachPlanId: plan.id, qa })
      }
    });
    await transaction.auditLog.create({
      data: {
        tenantId,
        actorUserId: null,
        action: "OUTREACH_PLAN_GENERATED",
        entityType: "OUTREACH_PLAN",
        entityId: plan.id,
        after: toInputJsonValue({
          contactId: draftContext.contact.id,
          companyId: draftContext.contact.companyId,
          version,
          qaPassed: qa.passed,
          issueCount: qa.issues.length,
          promptVersion: OUTREACH_PLAN_PROMPT_VERSION,
          models
        })
      }
    });
    return { planId: plan.id, version };
  });

  return {
    state: qa.passed ? "qa_passed" as const : "qa_failed" as const,
    ...persisted,
    qaPassed: qa.passed,
    issueCount: qa.issues.length
  };
}

export async function repairFailedOutreachPlanForContact({
  tenantId,
  contactId
}: {
  tenantId: string;
  contactId: string;
}) {
  const plan = await prisma.outreachPlan.findFirst({
    where: {
      tenantId,
      contactId,
      status: OutreachPlanStatus.QA_FAILED,
      qaStatus: OutreachQaStatus.FAILED
    },
    orderBy: { version: "desc" },
    include: {
      steps: { orderBy: { stepNumber: "asc" } },
      contact: {
        select: {
          contactStatus: true,
          replyStatus: true,
          sequenceStatus: true
        }
      }
    }
  });
  if (!plan) {
    return {
      state: "skipped" as const,
      message: "No current failed QA plan was found."
    };
  }

  const regenerationBlockReason = getOutreachRegenerationBlockReason({
    planStatus: plan.status,
    contactStatus: plan.contact.contactStatus,
    replyStatus: plan.contact.replyStatus,
    sequenceStatus: plan.contact.sequenceStatus
  });
  if (regenerationBlockReason) {
    return { state: "blocked" as const, message: regenerationBlockReason };
  }

  const priorIssues = parseOutreachQaIssues(plan.qaIssues);
  const evidence = parseOutreachEvidence(plan.evidence);
  const sequence: GeneratedOutreachSequence = {
    sequenceName: plan.sequenceName,
    steps: plan.steps.map((step) => ({
      stepNumber: step.stepNumber,
      channel: step.channel,
      delayDays: step.delayDays,
      subject: step.subject,
      body: step.body,
      angle: step.angle,
      evidenceRefs: asStringArray(step.evidenceRefs)
    }))
  };
  const priorDisposition = classifyOutreachQaIssues(
    priorIssues,
    evidence,
    sequence
  );
  if (priorDisposition === "HUMAN_REVIEW") {
    return {
      state: "human_review" as const,
      message: "This plan needs sender, evidence, or configuration review before it can be repaired."
    };
  }
  const strategy: OutreachStrategy = {
    serviceLine: plan.serviceLine,
    opportunityType: plan.opportunityType,
    objective: plan.objective,
    triggerSummary: plan.triggerSummary,
    buyerHypothesis: plan.buyerHypothesis,
    valueProposition: plan.valueProposition,
    likelyObjection: plan.likelyObjection,
    callToAction: plan.callToAction,
    channelStrategy: asStringArray(plan.channelStrategy),
    senderRecommendation: plan.senderRecommendation ?? "",
    confidence: plan.confidence,
    evidenceRefs: evidence.map((record) => record.id)
  };

  const deterministicRepair = repairOutreachSequenceDeterministically({
    evidence,
    sequence
  });
  const allowCallTask = deterministicRepair.sequence.steps.some(
    (step) => step.channel === "CALL_TASK"
  );
  const deterministicQa = runDeterministicOutreachQa({
    evidence,
    strategy,
    sequence: deterministicRepair.sequence,
    senderFirstName: plan.senderRecommendation ?? undefined,
    allowCallTask
  });
  const remainingDisposition = classifyOutreachQaIssues(
    deterministicQa.issues,
    evidence,
    deterministicRepair.sequence
  );

  if (
    priorDisposition === "AUTOMATIC" &&
    deterministicRepair.changed &&
    deterministicQa.passed
  ) {
    const firstEmail = deterministicRepair.sequence.steps.find(
      (step) => step.channel === "EMAIL" && step.subject
    );
    if (!firstEmail?.subject) {
      return {
        state: "human_review" as const,
        message: "The repaired plan has no usable first email."
      };
    }
    const firstEmailSubject = firstEmail.subject;
    await prisma.$transaction(async (transaction) => {
      await transaction.outreachPlan.update({
        where: { tenantId_id: { tenantId, id: plan.id } },
        data: {
          status: OutreachPlanStatus.QA_PASSED,
          qaStatus: OutreachQaStatus.PASSED,
          qaIssues: toInputJsonValue([]),
          qaCheckedAt: new Date()
        }
      });
      for (const step of deterministicRepair.sequence.steps) {
        await transaction.outreachSequenceStep.update({
          where: {
            tenantId_outreachPlanId_stepNumber: {
              tenantId,
              outreachPlanId: plan.id,
              stepNumber: step.stepNumber
            }
          },
          data: {
            subject: step.subject,
            body: step.body,
            evidenceRefs: toInputJsonValue(step.evidenceRefs),
            qaIssues: toInputJsonValue([])
          }
        });
      }
      await transaction.contactOutreachDraft.updateMany({
        where: {
          tenantId,
          contactId,
          sequenceName: plan.sequenceName
        },
        data: {
          subject: firstEmailSubject,
          body: firstEmail.body,
          status: ContactOutreachDraftStatus.AVAILABLE,
          approvedAt: null
        }
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          actorUserId: null,
          action: "OUTREACH_PLAN_DETERMINISTIC_QA_REPAIRED",
          entityType: "OUTREACH_PLAN",
          entityId: plan.id,
          after: toInputJsonValue({
            contactId,
            repairs: deterministicRepair.repairs,
            noModelCall: true
          })
        }
      });
    });
    return {
      state: "repaired" as const,
      message: "Evidence annotations were repaired and deterministic QA now passes."
    };
  }

  if (
    priorDisposition === "MODEL_REGENERATION" ||
    remainingDisposition === "MODEL_REGENERATION"
  ) {
    const feedback = [...priorIssues, ...deterministicQa.issues]
      .filter(
        (issue) =>
          issue.severity === "ERROR" &&
          classifyOutreachQaIssues([issue], evidence) === "MODEL_REGENERATION"
      )
      .map((issue) => issue.message)
      .filter((message, index, messages) => messages.indexOf(message) === index)
      .slice(0, 8)
      .join("\n");
    const regenerated = await generateOutreachPlanForContact({
      tenantId,
      contactId,
      forceRegenerate: true,
      reviewerFeedback:
        feedback || "Regenerate the sequence to resolve the remaining grounded QA failures."
    });
    return {
      state: regenerated.state === "qa_passed" ? "regenerated" as const : "failed" as const,
      message:
        regenerated.state === "qa_passed"
          ? "The semantic QA failures were regenerated and the new plan passed."
          : "The model regenerated this plan, but its replacement still did not pass QA."
    };
  }

  return {
    state: "human_review" as const,
    message:
      deterministicRepair.changed
        ? "The safe corrections were applied in memory, but remaining evidence or configuration failures need review."
        : "No safe deterministic correction was available for this plan."
  };
}

export async function loadOutreachPlanContactContext({
  tenantId,
  contactId
}: {
  tenantId: string;
  contactId: string;
}) {
  const [scoringConfigRecord, profileRecords] = await Promise.all([
    prisma.tradeMiningScoringConfig.findUnique({ where: { tenantId } }),
    prisma.tradeMiningSearchProfile.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        priorityWeight: true,
        destinationMarkets: true,
        destinationPorts: true,
        originPorts: true,
        shipFromPorts: true,
        originCountries: true,
        productKeywords: true,
        hsCodes: true,
        contactCadenceConfig: true,
        lookbackWindowDays: true,
        minShipmentCount: true
      }
    })
  ]);
  const scoringConfig = normalizeLeadGenAiScoringConfig(scoringConfigRecord);
  const evidenceLookbackDays = Math.max(
    scoringConfig.lookbackWindowDays,
    ...profileRecords.map((profile) => profile.lookbackWindowDays)
  );
  const evidenceWhere = buildTradeMiningEvidenceWhere({ tenantId }, evidenceLookbackDays);
  const searchProfiles = new Map(profileRecords.map((profile) => [
    profile.id,
    {
      ...profile,
      destinationMarkets: asStringArray(profile.destinationMarkets),
      destinationPorts: asStringArray(profile.destinationPorts),
      originPorts: asStringArray(profile.originPorts),
      shipFromPorts: asStringArray(profile.shipFromPorts),
      originCountries: asStringArray(profile.originCountries),
      productKeywords: asStringArray(profile.productKeywords),
      hsCodes: asStringArray(profile.hsCodes)
    }
  ]));

  const [contact, apolloCredential, memberships] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: contactId, tenantId },
      include: {
        leads: {
          where: { tenantId },
          select: { id: true },
          take: 1
        },
        company: {
          select: {
            id: true,
            name: true,
            priorityScore: true,
            candidateStatus: true,
            domain: true,
            apolloOrganizationId: true,
            importRecords: {
              where: evidenceWhere,
              orderBy: { arrivalDate: "desc" },
              select: {
                rawJson: true,
                arrivalDate: true,
                createdAt: true,
                sourcePort: true,
                destinationCity: true,
                destinationState: true,
                originCountry: true,
                productDescription: true
              }
            },
            leads: {
              where: { tenantId },
              orderBy: { updatedAt: "desc" },
              take: 1,
              select: { id: true, score: true }
            },
            hunterOpportunitySignals: {
              where: { tenantId, sourceName: "Hunter company research" },
              orderBy: { observedAt: "desc" },
              take: 5,
              select: {
                id: true,
                signalType: true,
                serviceLine: true,
                title: true,
                summary: true,
                sourceName: true,
                sourceUrl: true,
                sourcePublishedAt: true,
                observedAt: true,
                confidence: true,
                evidence: true
              }
            },
            hunterProspectingDecisions: {
              where: { tenantId },
              orderBy: { createdAt: "desc" },
              take: 3,
              select: {
                id: true,
                status: true,
                serviceLine: true,
                opportunityType: true,
                rationale: true,
                recommendedPersona: true,
                recommendedSender: true,
                recommendedCadence: true,
                evidence: true,
                confidence: true,
                createdAt: true
              }
            }
          }
        },
        outreachDrafts: {
          where: { tenantId },
          orderBy: { updatedAt: "desc" },
          take: 1
        },
        outreachPlans: {
          where: { tenantId, status: { not: OutreachPlanStatus.ARCHIVED } },
          orderBy: { version: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            qaStatus: true,
            version: true,
            promptVersion: true,
            sequenceName: true,
            sequenceId: true
          }
        }
      }
    }),
    prisma.integrationCredential.findFirst({
      where: { tenantId, provider: "APOLLO" },
      select: { publicConfig: true }
    }),
    prisma.membership.findMany({
      where: { tenantId },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    })
  ]);
  if (!contact) return null;

  const companyLeadScore = contact.company.leads[0]?.score ?? null;
  const scoring = scoreContact({
    fullName: contact.fullName,
    title: contact.title,
    department: contact.department,
    seniority: contact.seniority,
    email: contact.email,
    phone: contact.phone,
    linkedinUrl: contact.linkedinUrl,
    contactStatus: contact.contactStatus,
    replyStatus: contact.replyStatus,
    companyPriorityScore: contact.company.priorityScore,
    companyLeadScore,
    isPrimaryContact: contact.leads.length > 0
  }, scoringConfig);
  const evidence = summarizeTradeMiningEvidence(contact.company.importRecords, searchProfiles);
  const sequenceDirectory = parseApolloSequenceDirectory(apolloCredential?.publicConfig);
  const defaultMappings = buildApolloSequenceMappingsWithDefaults({
    existingMappings: parseApolloSequenceMapping(apolloCredential?.publicConfig),
    directory: sequenceDirectory
  });
  const effectiveMappings = resolveApolloSequenceMappings({
    existingMappings: evidence.searchProfile
      ? parseSearchProfileApolloSequenceMapping(evidence.searchProfile.contactCadenceConfig)
      : defaultMappings,
    directory: sequenceDirectory
  });
  const hunterEligibility = evaluateHunterOutreachEligibility({
    researchSignal: contact.company.hunterOpportunitySignals[0] ?? null,
    prospectingDecision: contact.company.hunterProspectingDecisions[0] ?? null,
    maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
  });
  const recommendation = recommendSequenceForContact({
    contactTier: scoring.tier,
    title: contact.title,
    department: contact.department,
    companyName: contact.company.name,
    sequenceMappings: effectiveMappings,
    sequenceDirectory,
    hunterManaged: hunterEligibility.status === "ELIGIBLE"
  });
  const tierMapping = effectiveMappings.find((entry) => entry.tier === scoring.tier) ?? null;
  const useHunterRecommendation = shouldUseHunterSequenceRecommendation({
    hunterEligible: hunterEligibility.status === "ELIGIBLE",
    sequenceManuallyOverridden: contact.sequenceManuallyOverridden,
    selectedSequenceName: contact.selectedSequenceName
  });
  const senderIdentity = resolveConfiguredApolloSender({
    entries: parseApolloRepMapping(apolloCredential?.publicConfig),
    users: memberships.map((membership) => membership.user),
    assignedRep: contact.assignedRep,
    companyId: contact.companyId
  });
  return {
    contact,
    contactScore: scoring.score,
    contactScoreSummary: scoring.summary,
    contactTier: scoring.tier,
    scoringConfig,
    evidence,
    shipmentDraftContext: buildShipmentDraftContext(contact.company.importRecords),
    selectedSequenceName:
      useHunterRecommendation
        ? recommendation.name
        : contact.selectedSequenceName
          ?? contact.recommendedSequenceName
          ?? recommendation.name
          ?? null,
    selectedSequenceId:
      useHunterRecommendation
        ? recommendation.id
        : contact.selectedSequenceId ?? contact.recommendedSequenceId ?? recommendation.id ?? null,
    selectedSequenceReason:
      useHunterRecommendation
        ? recommendation.reason
        : contact.sequenceRecommendationReason ?? recommendation.reason,
    requiresAiDraft: hunterEligibility.status === "ELIGIBLE" || (tierMapping?.requiresAiDraft ?? false),
    senderIdentity,
    hunterEligibility,
    existingDraft: contact.outreachDrafts[0] ?? null,
    existingOutreachPlan: contact.outreachPlans[0] ?? null,
    leadId: contact.company.leads[0]?.id ?? null,
    leadScore: companyLeadScore
  };
}

function loadOutreachModels() {
  return {
    strategy: process.env.LEAD_GEN_OUTREACH_STRATEGY_MODEL?.trim() || DEFAULT_OUTREACH_STRATEGY_MODEL,
    drafting: process.env.LEAD_GEN_OUTREACH_DRAFT_MODEL?.trim() || DEFAULT_OUTREACH_DRAFT_MODEL,
    qa: process.env.LEAD_GEN_OUTREACH_QA_MODEL?.trim() || DEFAULT_OUTREACH_QA_MODEL
  };
}

function buildOutreachEvidenceLedger(
  draftContext: NonNullable<Awaited<ReturnType<typeof loadOutreachPlanContactContext>>>
): OutreachEvidenceRecord[] {
  const records: OutreachEvidenceRecord[] = [{
    id: "company:identity",
    kind: "COMPANY",
    title: `${draftContext.contact.company.name} identity and buyer context`,
    summary: `${draftContext.contact.fullName} is saved as ${
      draftContext.contact.title ?? "a contact with an unconfirmed title"
    } at ${draftContext.contact.company.name}.`,
    sourceUrl: draftContext.contact.company.domain
      ? `https://${draftContext.contact.company.domain.replace(/^https?:\/\//i, "")}`
      : null,
    publishedAt: null,
    facts: [
      `Company: ${draftContext.contact.company.name}`,
      `Contact: ${draftContext.contact.fullName}`,
      draftContext.contact.title ? `Contact title: ${draftContext.contact.title}` : "Contact title is unknown",
      draftContext.contact.department
        ? `Contact department: ${draftContext.contact.department}`
        : "Contact department is unknown"
    ]
  }];

  const requiredServiceLine =
    draftContext.hunterEligibility.directive?.requiredServiceLine ?? null;
  if (requiredServiceLine) {
    records.push(buildApprovedNewlCapabilityEvidence(requiredServiceLine));
  }

  if (draftContext.contact.company.importRecords.length > 0) {
    const shipmentFacts = [
      `${draftContext.evidence.shipmentCount} shipments during the saved evidence lookback`,
      draftContext.evidence.totalTeu > 0 ? `${formatDecimalValue(draftContext.evidence.totalTeu)} TEUs` : null,
      draftContext.evidence.latestShipmentDate
        ? `Latest saved arrival date: ${draftContext.evidence.latestShipmentDate.toISOString().slice(0, 10)}`
        : null,
      draftContext.evidence.destinationPort ? `Arrival port: ${draftContext.evidence.destinationPort}` : null,
      draftContext.evidence.destinationMarket
        ? `Destination market: ${draftContext.evidence.destinationMarket}`
        : null,
      draftContext.evidence.originCountry ? `Origin country: ${draftContext.evidence.originCountry}` : null,
      draftContext.evidence.productDescription
        ? `Product description: ${draftContext.evidence.productDescription}`
        : null,
      ...draftContext.shipmentDraftContext.recentShipmentHighlights.slice(0, 4)
    ].filter((value): value is string => Boolean(value));
    records.push({
      id: "trademining:summary",
      kind: "TRADEMINING",
      title: `${draftContext.contact.company.name} saved TradeMining activity`,
      summary: shipmentFacts.join(". "),
      sourceUrl: null,
      publishedAt: draftContext.evidence.latestShipmentDate?.toISOString() ?? null,
      facts: shipmentFacts
    });
  }

  const researchSignal = draftContext.contact.company.hunterOpportunitySignals[0] ?? null;
  if (researchSignal) {
    const research = asObject(asObject(researchSignal.evidence).research);
    const evidenceRows = Array.isArray(research.evidence) ? research.evidence : [];
    for (const [index, rawEvidence] of evidenceRows.slice(0, 7).entries()) {
      const evidence = asObject(rawEvidence);
      const sourceUrl = readString(evidence, "url");
      const title = readString(evidence, "title");
      const excerpt = readString(evidence, "excerpt");
      if (!sourceUrl || !title || !excerpt) continue;
      records.push({
        id: `hunter-research:${researchSignal.id}:${index + 1}`,
        kind: "HUNTER_RESEARCH",
        title,
        summary: excerpt,
        sourceUrl,
        publishedAt: readString(evidence, "publishedAt"),
        facts: [
          readString(evidence, "pass") ? `Research pass: ${readString(evidence, "pass")}` : null,
          readString(evidence, "sourceType") ? `Source type: ${readString(evidence, "sourceType")}` : null,
          excerpt
        ].filter((value): value is string => Boolean(value))
      });
    }
  }

  const directive = draftContext.hunterEligibility.directive;
  const decision = draftContext.contact.company.hunterProspectingDecisions[0] ?? null;
  if (directive && decision) {
    records.push({
      id: `hunter-decision:${decision.id}`,
      kind: "HUNTER_DECISION",
      title: `${directive.opportunityTier.replaceAll("_", " ")}: ${directive.opportunityType}`,
      summary: directive.rationale,
      sourceUrl: null,
      publishedAt: decision.createdAt.toISOString(),
      facts: [
        `Hunter-required service line: ${directive.requiredServiceLine}`,
        `Hunter final score: ${directive.finalScore}`,
        `Hunter final confidence: ${directive.finalConfidence}`,
        directive.recommendedPersona ? `Recommended persona: ${directive.recommendedPersona}` : null,
        directive.recommendedCadence ? `Recommended cadence: ${directive.recommendedCadence}` : null
      ].filter((value): value is string => Boolean(value))
    });
  }
  return records.slice(0, 12);
}

export function buildApprovedNewlCapabilityEvidence(
  serviceLine: HunterServiceLine
): OutreachEvidenceRecord {
  const factsByServiceLine: Record<HunterServiceLine, string[]> = {
    WAREHOUSING: [
      "Newl can provide supplemental and flexible warehousing support.",
      "Newl can support overflow storage, inventory staging, receiving, and distribution handoffs."
    ],
    OCEAN_AIR: [
      "Newl can provide ocean and air freight-forwarding support.",
      "Newl can coordinate freight handoffs with warehousing and inland transportation support."
    ],
    TRUCKING: [
      "Newl can provide supplemental trucking support.",
      "Newl can coordinate planned and exception inbound or outbound transportation."
    ]
  };

  return {
    id: `newl-capability:${serviceLine.toLowerCase()}`,
    kind: "NEWL_CAPABILITY",
    title: `Owner-approved Newl ${serviceLine.replaceAll("_", " ").toLowerCase()} capabilities`,
    summary: factsByServiceLine[serviceLine].join(" "),
    sourceUrl: null,
    publishedAt: null,
    facts: factsByServiceLine[serviceLine]
  };
}

function normalizeLeadGenAiScoringConfig(
  config: Awaited<ReturnType<typeof prisma.tradeMiningScoringConfig.findUnique>>
) {
  return {
    ...DEFAULT_TRADEMINING_SCORING_SETTINGS,
    ...(config ? {
      contactDecisionMakerWeight: config.contactDecisionMakerWeight,
      contactManagerWeight: config.contactManagerWeight,
      contactLogisticsDepartmentWeight: config.contactLogisticsDepartmentWeight,
      contactWeakFunctionPenalty: config.contactWeakFunctionPenalty,
      contactCompanyContextWeight: config.contactCompanyContextWeight,
      contactEmailWeight: config.contactEmailWeight,
      contactLinkedinWeight: config.contactLinkedinWeight,
      contactPhoneWeight: config.contactPhoneWeight,
      contactPrimaryContactBoost: config.contactPrimaryContactBoost,
      contactApprovedStatusBoost: config.contactApprovedStatusBoost,
      contactReviewingStatusBoost: config.contactReviewingStatusBoost,
      contactTier1Threshold: config.contactTier1Threshold,
      contactTier2Threshold: config.contactTier2Threshold,
      contactTier3Threshold: config.contactTier3Threshold,
      preferredContactTitleKeywords: asStringArray(config.preferredContactTitleKeywords),
      penalizedContactTitleKeywords: asStringArray(config.penalizedContactTitleKeywords),
      preferredContactDepartments: asStringArray(config.preferredContactDepartments),
      penalizedContactDepartments: asStringArray(config.penalizedContactDepartments)
    } : {})
  };
}

function buildShipmentDraftContext(
  importRecords: Array<{
    rawJson: unknown;
    arrivalDate: Date | null;
    sourcePort: string | null;
    destinationCity: string | null;
    destinationState: string | null;
    originCountry: string | null;
    productDescription: string | null;
  }>
) {
  const recentShipmentHighlights = importRecords.slice(0, 5).map((record) => {
    const raw = asObject(record.rawJson);
    return [
      record.arrivalDate ? record.arrivalDate.toISOString().slice(0, 10) : null,
      readString(raw, "destinationMarket") ??
        [record.destinationCity, record.destinationState].filter(Boolean).join(", "),
      readString(raw, "destinationPort") ?? readString(raw, "arrivalPort"),
      record.originCountry ?? readString(raw, "originCountry"),
      record.productDescription ?? readString(raw, "productDescription")
    ].filter((value): value is string => Boolean(value)).join(" | ");
  }).filter(Boolean);
  return { recentShipmentHighlights };
}

function asStringArray(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseOutreachQaIssues(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): OutreachQaIssue[] => {
    const issue = asObject(entry);
    const code = readString(issue, "code");
    const message = readString(issue, "message");
    const severity = readString(issue, "severity");
    if (
      !code ||
      !message ||
      (severity !== "ERROR" && severity !== "WARNING")
    ) {
      return [];
    }
    return [{
      code,
      message,
      severity,
      stepNumber:
        typeof issue.stepNumber === "number" ? issue.stepNumber : null
    }];
  });
}

function parseOutreachEvidence(
  value: Prisma.JsonValue
): OutreachEvidenceRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): OutreachEvidenceRecord[] => {
    const record = asObject(entry);
    const id = readString(record, "id");
    const kind = readString(record, "kind");
    const title = readString(record, "title");
    const summary = readString(record, "summary");
    if (
      !id ||
      !title ||
      !summary ||
      !kind ||
      ![
        "TRADEMINING",
        "HUNTER_RESEARCH",
        "HUNTER_SIGNAL",
        "HUNTER_DECISION",
        "COMPANY",
        "NEWL_CAPABILITY"
      ].includes(kind)
    ) {
      return [];
    }
    return [{
      id,
      kind: kind as OutreachEvidenceRecord["kind"],
      title,
      summary,
      sourceUrl: readString(record, "sourceUrl"),
      publishedAt: readString(record, "publishedAt"),
      facts: asStringArray(record.facts)
    }];
  });
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Prisma.JsonObject)
    : {};
}

function readString(record: Prisma.JsonObject, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatDecimalValue(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
