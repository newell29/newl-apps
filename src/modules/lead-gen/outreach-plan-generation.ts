import {
  ContactOutreachDraftSource,
  ContactOutreachDraftStatus,
  OutreachPlanStatus,
  OutreachQaStatus,
  Prisma
} from "@prisma/client";

import {
  buildTradeMiningEvidenceWhere,
  summarizeTradeMiningEvidence
} from "@/modules/lead-gen/queries";
import { scoreContact } from "@/modules/lead-gen/contact-scoring";
import {
  evaluateHunterOutreachEligibility,
  getHunterOutreachResearchMaxAgeDays
} from "@/modules/lead-gen/hunter-outreach-eligibility";
import {
  DEFAULT_OUTREACH_DRAFT_MODEL,
  DEFAULT_OUTREACH_QA_MODEL,
  DEFAULT_OUTREACH_STRATEGY_MODEL,
  fingerprintOutreachEvidence,
  mergeOutreachQaResults,
  OUTREACH_PLAN_PROMPT_VERSION,
  runDeterministicOutreachQa,
  type OutreachEvidenceRecord
} from "@/modules/lead-gen/outreach-plan";
import { persistOutreachPlanWithSteps } from "@/modules/lead-gen/outreach-plan-persistence";
import { recommendSequenceForContact } from "@/modules/lead-gen/sequence-catalog";
import {
  buildApolloSequenceMappingsWithDefaults,
  parseApolloSequenceDirectory,
  parseApolloSequenceMapping,
  parseSearchProfileApolloSequenceMapping,
  resolveApolloSequenceMappings
} from "@/modules/settings/apollo-sequence-mapping";
import { DEFAULT_TRADEMINING_SCORING_SETTINGS } from "@/modules/settings/types";
import { prisma } from "@/server/db";
import {
  generateCompleteOutreachSequence,
  generateOutreachStrategy,
  reviewOutreachSequenceGrounding
} from "@/server/integrations/openai";

export async function generateOutreachPlanForContact({
  tenantId,
  contactId,
  forceRegenerate,
  generateWhenNotRequired = false
}: {
  tenantId: string;
  contactId: string;
  forceRegenerate: boolean;
  generateWhenNotRequired?: boolean;
}) {
  const draftContext = await loadOutreachPlanContactContext({ tenantId, contactId });

  if (!draftContext) {
    throw new Error("Contact not found for this tenant.");
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

  const evidenceLedger = buildOutreachEvidenceLedger(draftContext);
  if (evidenceLedger.length === 0) {
    if (forceRegenerate) {
      throw new Error("No saved Hunter or TradeMining evidence is available for this company yet.");
    }
    return { state: "evidence_missing" as const };
  }
  if (
    draftContext.existingOutreachPlan?.promptVersion === OUTREACH_PLAN_PROMPT_VERSION &&
    !forceRegenerate
  ) {
    return {
      state: "already_generated" as const,
      planId: draftContext.existingOutreachPlan.id
    };
  }

  const models = loadOutreachModels();
  const hunterDirective = draftContext.hunterEligibility.directive;
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
    evidence: evidenceLedger
  });
  const strategy = strategyGeneration.strategy;
  const sequenceGeneration = await generateCompleteOutreachSequence({
    model: models.drafting,
    companyName: draftContext.contact.company.name,
    contact: {
      firstName: draftContext.contact.firstName,
      fullName: draftContext.contact.fullName,
      title: draftContext.contact.title,
      department: draftContext.contact.department,
      seniority: draftContext.contact.seniority
    },
    selectedSequenceName: draftContext.selectedSequenceName,
    strategy,
    evidence: evidenceLedger,
    allowCallTask: hunterDirective.opportunityTier === "HOT_OPPORTUNITY"
  });
  const sequence = sequenceGeneration.sequence;
  const deterministicQa = runDeterministicOutreachQa({
    evidence: evidenceLedger,
    strategy,
    sequence,
    allowCallTask: hunterDirective.opportunityTier === "HOT_OPPORTUNITY"
  });
  let modelQa;
  let qaUsage = null;
  try {
    const qaReview = await reviewOutreachSequenceGrounding({
      model: models.qa,
      companyName: draftContext.contact.company.name,
      contact: {
        firstName: draftContext.contact.firstName,
        fullName: draftContext.contact.fullName,
        title: draftContext.contact.title,
        department: draftContext.contact.department,
        seniority: draftContext.contact.seniority
      },
      strategy,
      sequence,
      evidence: evidenceLedger
    });
    modelQa = qaReview.result;
    qaUsage = qaReview.usage;
  } catch (error) {
    modelQa = {
      passed: false,
      issues: [{
        code: "MODEL_QA_UNAVAILABLE",
        severity: "ERROR" as const,
        message: error instanceof Error ? error.message : "The model QA check could not be completed.",
        stepNumber: null
      }]
    };
  }
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
      drafting: sequenceGeneration.usage,
      qa: qaUsage
    },
    generatedAt: new Date().toISOString(),
    companyName: draftContext.contact.company.name,
    companyPriorityScore: draftContext.contact.company.priorityScore,
    leadScore: draftContext.leadScore,
    contactTier: draftContext.contactTier,
    selectedSequenceName: draftContext.selectedSequenceName,
    selectedSequenceId: draftContext.selectedSequenceId,
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

  const [contact, apolloCredential] = await Promise.all([
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
          select: { id: true, status: true, qaStatus: true, version: true, promptVersion: true }
        }
      }
    }),
    prisma.integrationCredential.findFirst({
      where: { tenantId, provider: "APOLLO" },
      select: { publicConfig: true }
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
  const useHunterRecommendation =
    hunterEligibility.status === "ELIGIBLE" && !contact.sequenceManuallyOverridden;
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
