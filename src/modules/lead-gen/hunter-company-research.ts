import { createHash } from "node:crypto";

import {
  CandidateStatus,
  HunterAutomationMode,
  HunterServiceLine,
  HunterSignalStatus,
  HunterSignalType,
  JobStatus,
  Prisma
} from "@prisma/client";
import { HUNTER_COMPANY_REPLY_HARD_STOP_STATUSES } from "@/modules/lead-gen/apollo-reengagement-policy";

import { DEFAULT_HUNTER_POLICY, runHunterDryPlan } from "@/modules/lead-gen/hunter-planner";
import { enqueueHunterOutreachHandoff } from "@/modules/lead-gen/hunter-outreach-handoff";
import { HUNTER_COMPANY_RESEARCH_JOB_TYPE } from "@/modules/lead-gen/hunter-job-types";
import { prisma } from "@/server/db";

export { HUNTER_COMPANY_RESEARCH_JOB_TYPE };
export const HUNTER_COMPANY_RESEARCH_PROMPT_VERSION = "hunter-company-research-v13";
export const HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL = "qwen3.5:35b";
export const HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL = "kimi-k2.6";
export const HUNTER_COMPANY_RESEARCH_DEFAULT_VALIDATOR_MODEL = "kimi-k3";

const ACTIVE_RUN_WINDOW_MS = 4 * 60 * 60 * 1000;
const RECENT_RESEARCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESEARCH_COMPANIES = 100;
const MAX_EVIDENCE_PER_COMPANY = 24;
export const HUNTER_COMPANY_RESEARCH_TRANSACTION_TIMEOUT_MS = 30_000;

export const HUNTER_RESEARCH_PASSES = [
  {
    id: "IDENTITY",
    purpose: "Confirm the operating company, parent, official domain, and beneficial owner."
  },
  {
    id: "FRESH_EVENTS",
    purpose: "Find dated expansions, facilities, launches, investment, hiring, or leadership events."
  },
  {
    id: "CAREERS",
    purpose: "Use first-party careers evidence to detect warehouse, distribution, supply-chain, or import growth."
  },
  {
    id: "DISTRIBUTION_FOOTPRINT",
    purpose: "Map facilities, markets, channels, and any named external provider or displacement evidence."
  }
] as const;

type ResearchPass = typeof HUNTER_RESEARCH_PASSES[number]["id"] | "FOLLOW_UP";
type IdentityDisposition = "PASS" | "AMBIGUOUS" | "BLOCK";
type Freshness = "FRESH" | "CURRENT" | "STALE" | "NONE";
type OperatingRegion = "NORTH_AMERICA" | "CHINA" | "OTHER_FOREIGN" | "UNKNOWN";
type ValidatorDisposition = "CONFIRM" | "DOWNGRADE_TO_WATCHLIST";
export type HunterResearchOpportunityTier =
  | "HOT_OPPORTUNITY"
  | "QUALIFIED_CURRENT_ACCOUNT"
  | "WATCHLIST"
  | "BLOCKED";

type Evidence = {
  pass: ResearchPass;
  query: string;
  title: string;
  url: string;
  sourceDomain: string;
  sourceType: "FIRST_PARTY" | "GOVERNMENT" | "NEWS" | "CAREERS" | "DIRECTORY" | "OTHER";
  publishedAt: string | null;
  excerpt: string;
  firstParty: boolean;
};

type ResearchResult = {
  companyId: string;
  companyKey: string;
  companyName: string;
  evidence: Evidence[];
  synthesis: {
    identityDisposition: IdentityDisposition;
    identityConfidence: number;
    identityReason: string;
    logisticsProvider: boolean;
    namedExternalLogisticsProvider: boolean;
    stableExclusiveProviderEvidence: boolean;
    providerDisplacementEvidence: boolean;
    freshness: Freshness;
    opportunitySummary: string;
    triggerEvidenceIndices: number[];
    geography: string | null;
    companyCountry: string | null;
    operatingRegion: OperatingRegion;
    verifiedUsDivision: boolean;
    usDivisionName: string | null;
    usDivisionEvidenceIndices: number[];
    serviceLine: HunterServiceLine;
    signalType: HunterSignalType;
    confidence: number;
    rationale: string;
    missingEvidence: string[];
  };
  scoring: {
    serviceLine: HunterServiceLine;
    opportunityType: string;
    rationale: string;
    recommendedPersona: string;
    recommendedCadence: string;
    dimensionScores: {
      demandTrigger: number;
      serviceFit: number;
      timing: number;
      accessibility: number;
      evidenceQuality: number;
    };
    totalScore: number;
    confidence: number;
  };
  validation: {
    status: "VALIDATED" | "NOT_SELECTED" | "ERROR";
    disposition: ValidatorDisposition | null;
    validatedScore: number | null;
    confidence: number | null;
    rationale: string | null;
    riskFlags: string[];
    supportingEvidenceIndices: number[];
  };
};

export type HunterCompanyResearchCompletion = {
  models: {
    synthesis: {
      provider: "OLLAMA";
      name: string;
      promptVersion: string;
      structuredOutput: boolean;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
    };
    scoring: {
      provider: "KIMI";
      name: string;
      promptVersion: string;
      structuredOutput: boolean;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      durationMs: number;
      estimatedCostUsd: number | null;
    };
    validation: {
      provider: "KIMI";
      name: string;
      promptVersion: string;
      structuredOutput: boolean;
      status: "SUCCESS" | "SKIPPED" | "ERROR";
      reasoningEffort: "LOW" | "HIGH" | "MAX";
      candidateCount: number;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      durationMs: number;
      estimatedCostUsd: number | null;
      errorMessage: string | null;
    };
  };
  search: {
    provider: "BRAVE" | "DUCKDUCKGO";
    retrievedAt: string;
    queryCount: number;
    pageFetchCount: number;
    failedQueryCount: number;
  };
  companies: ResearchResult[];
};

type PreparedCandidate = {
  companyId: string;
  companyKey: string;
  companyName: string;
  priorityScore: number;
  primaryIndustry: string | null;
  domain: string | null;
  shipmentEvidence: Array<{
    arrivalDate: string | null;
    destinationCity: string | null;
    destinationState: string | null;
    sourcePort: string | null;
    originCountry: string | null;
    productDescription: string | null;
  }>;
  existingSignals: Array<{
    type: HunterSignalType;
    title: string;
    summary: string;
    sourceUrl: string | null;
    confidence: number;
    observedAt: string;
  }>;
};

export async function prepareHunterCompanyResearchRun({
  tenantId,
  force = false,
  companyKeys,
  now = new Date()
}: {
  tenantId: string;
  force?: boolean;
  companyKeys?: string[];
  now?: Date;
}) {
  const policy = await prisma.hunterAutomationPolicy.findUnique({ where: { tenantId } });
  const effective = policy ?? DEFAULT_HUNTER_POLICY;
  if (effective.killSwitch || effective.mode === HunterAutomationMode.OFF) {
    return {
      state: "disabled" as const,
      message: effective.killSwitch ? "Hunter kill switch is active." : "Hunter is off."
    };
  }

  const requestedKeys = normalizeRequestedCompanyKeys(companyKeys);
  const active = await prisma.automationJobRun.findFirst({
    where: {
      tenantId,
      jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      startedAt: { gte: new Date(now.getTime() - ACTIVE_RUN_WINDOW_MS) }
    },
    orderBy: { startedAt: "desc" },
    select: { id: true }
  });
  if (active) {
    return {
      state: "already_running" as const,
      runId: active.id,
      message: "A Hunter company-research run is already active."
    };
  }

  const localDate = formatLocalDate(now, effective.scheduleTimezone);
  if (!force && requestedKeys.length === 0) {
    const latest = await prisma.automationJobRun.findFirst({
      where: { tenantId, jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, startedAt: true }
    });
    if (latest && formatLocalDate(latest.startedAt, effective.scheduleTimezone) === localDate) {
      return {
        state: "already_attempted" as const,
        runId: latest.id,
        status: latest.status,
        message: "Hunter company research has already been attempted for this local date."
      };
    }
  }

  const limit = Math.min(MAX_RESEARCH_COMPANIES, Math.max(1, effective.dailyCompanyLimit));
  const recentResearch = requestedKeys.length === 0 && !force
    ? await prisma.hunterOpportunitySignal.findMany({
        where: {
          tenantId,
          sourceName: "Hunter company research",
          observedAt: { gte: new Date(now.getTime() - RECENT_RESEARCH_WINDOW_MS) },
          companyId: { not: null }
        },
        select: { companyId: true },
        take: 2_000
      })
    : [];
  const recentlyResearchedIds = new Set(
    recentResearch.map((row) => row.companyId).filter((value): value is string => Boolean(value))
  );

  const companies = await prisma.company.findMany({
    where: buildHunterCompanyResearchWhere({
      tenantId,
      requestedKeys,
      recentlyResearchedIds: [...recentlyResearchedIds]
    }),
    orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
    take: requestedKeys.length > 0 ? Math.min(MAX_RESEARCH_COMPANIES, requestedKeys.length) : limit,
    select: {
      id: true,
      name: true,
      normalizedName: true,
      priorityScore: true,
      primaryIndustry: true,
      domain: true,
      importRecords: {
        orderBy: { arrivalDate: "desc" },
        take: 8,
        select: {
          arrivalDate: true,
          destinationCity: true,
          destinationState: true,
          sourcePort: true,
          originCountry: true,
          productDescription: true
        }
      },
      hunterOpportunitySignals: {
        where: {
          status: { in: [HunterSignalStatus.NEW, HunterSignalStatus.ACTIVE] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        },
        orderBy: [{ confidence: "desc" }, { observedAt: "desc" }],
        take: 5,
        select: {
          signalType: true,
          title: true,
          summary: true,
          sourceUrl: true,
          confidence: true,
          observedAt: true
        }
      }
    }
  });

  const candidates: PreparedCandidate[] = companies.map((company) => ({
    companyId: company.id,
    companyKey: company.normalizedName,
    companyName: company.name,
    priorityScore: company.priorityScore,
    primaryIndustry: company.primaryIndustry,
    domain: company.domain,
    shipmentEvidence: company.importRecords.map((record) => ({
      ...record,
      arrivalDate: record.arrivalDate?.toISOString() ?? null,
      productDescription: record.productDescription?.slice(0, 1_000) ?? null
    })),
    existingSignals: company.hunterOpportunitySignals.map((signal) => ({
      type: signal.signalType,
      title: signal.title,
      summary: signal.summary,
      sourceUrl: signal.sourceUrl,
      confidence: signal.confidence,
      observedAt: signal.observedAt.toISOString()
    }))
  }));

  const job = await prisma.automationJobRun.create({
    data: {
      tenantId,
      jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: {
        version: 1,
        localDate,
        force,
        requestedCompanyKeys: requestedKeys,
        candidateCompanyIds: candidates.map((candidate) => candidate.companyId),
        candidateCompanyKeys: candidates.map((candidate) => candidate.companyKey),
        dailyCompanyLimit: limit,
        promptVersion: HUNTER_COMPANY_RESEARCH_PROMPT_VERSION,
        qwenModel: HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL,
        kimiModel: HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL,
        validatorModel: HUNTER_COMPANY_RESEARCH_DEFAULT_VALIDATOR_MODEL
      }
    }
  });

  return {
    state: "ready" as const,
    runId: job.id,
    packet: {
      version: 1,
      localDate,
      candidates,
      passes: HUNTER_RESEARCH_PASSES,
      models: {
        synthesis: {
          provider: "OLLAMA",
          recommended: HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL,
          promptVersion: HUNTER_COMPANY_RESEARCH_PROMPT_VERSION,
          structuredOutput: true,
          thinking: false
        },
        scoring: {
          provider: "KIMI",
          recommended: HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL,
          promptVersion: HUNTER_COMPANY_RESEARCH_PROMPT_VERSION,
          structuredOutput: true,
          temperature: 0.6
        },
        validation: {
          provider: "KIMI",
          recommended: HUNTER_COMPANY_RESEARCH_DEFAULT_VALIDATOR_MODEL,
          promptVersion: HUNTER_COMPANY_RESEARCH_PROMPT_VERSION,
          structuredOutput: true,
          reasoningEffort: "LOW"
        }
      },
      limits: {
        companies: limit,
        initialQueriesPerCompany: HUNTER_RESEARCH_PASSES.length,
        followUpQueriesPerCompany: 2,
        resultsPerQuery: 5,
        evidencePerCompany: MAX_EVIDENCE_PER_COMPANY
      },
      thresholds: {
        minimumPriorityScore: effective.minimumPriorityScore,
        minimumSignalConfidence: effective.minimumSignalConfidence
      },
      rules: {
        noApollo: true,
        noOutreach: true,
        noCadenceWrites: true,
        noPipelineStageChanges: true,
        evidenceOnly: true,
        blockLogisticsProviders: true,
        blockIncumbentsWithoutOutsourceEvidence: true,
        requireIdentityPass: true,
        blockChinaWithoutVerifiedUsDivision: true,
        deprioritizeOtherForeignWithoutVerifiedUsDivision: true
      }
    }
  };
}

export function buildHunterCompanyResearchWhere({
  tenantId,
  requestedKeys,
  recentlyResearchedIds
}: {
  tenantId: string;
  requestedKeys: string[];
  recentlyResearchedIds: string[];
}): Prisma.CompanyWhereInput {
  return {
    tenantId,
    doNotProspect: false,
    candidateStatus: {
      notIn: [CandidateStatus.REJECTED, CandidateStatus.DISQUALIFIED]
    },
    cashflowCustomers: { none: {} },
    contacts: {
      none: {
        replyStatus: {
          in: [...HUNTER_COMPANY_REPLY_HARD_STOP_STATUSES]
        }
      }
    },
    ...(requestedKeys.length > 0
      ? { normalizedName: { in: requestedKeys } }
      : recentlyResearchedIds.length > 0
        ? { id: { notIn: recentlyResearchedIds } }
        : {})
  };
}

export async function completeHunterCompanyResearchRun({
  tenantId,
  runId,
  completion: rawCompletion
}: {
  tenantId: string;
  runId: string;
  completion: unknown;
}) {
  const completion = parseHunterCompanyResearchCompletion(rawCompletion);
  const run = await prisma.automationJobRun.findFirst({
    where: {
      id: runId,
      tenantId,
      jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    select: { id: true, input: true }
  });
  if (!run) throw new Error("Hunter company-research run is not active for this tenant.");

  const input = record(run.input, "run.input");
  const expectedCompanyIds = new Set(
    array(input.candidateCompanyIds, "run.input.candidateCompanyIds").map((value, index) =>
      text(value, 200, `run.input.candidateCompanyIds[${index}]`)
    )
  );
  const returnedCompanyIds = new Set<string>();
  for (const company of completion.companies) {
    if (!expectedCompanyIds.has(company.companyId)) {
      throw new Error("Hunter company research returned a company outside the prepared tenant-scoped cohort.");
    }
    if (returnedCompanyIds.has(company.companyId)) {
      throw new Error("Hunter company research returned the same company more than once.");
    }
    returnedCompanyIds.add(company.companyId);
  }

  const policy = await prisma.hunterAutomationPolicy.findUnique({ where: { tenantId } });
  const effective = policy ?? DEFAULT_HUNTER_POLICY;
  const decisions = completion.companies.map((company) => {
    const gate = evaluateResearchGate(company);
    const classification = classifyResearchOpportunity(company, gate, {
      minimumPriorityScore: effective.minimumPriorityScore,
      minimumSignalConfidence: effective.minimumSignalConfidence
    });
    const wouldPursue = ["HOT_OPPORTUNITY", "QUALIFIED_CURRENT_ACCOUNT"].includes(
      classification.tier
    );
    return {
      company,
      gate,
      ...classification,
      status: wouldPursue ? HunterSignalStatus.NEW : HunterSignalStatus.DISMISSED
    };
  });

  let acceptedCount = 0;
  let blockedCount = 0;
  const tierCounts: Record<HunterResearchOpportunityTier, number> = {
    HOT_OPPORTUNITY: 0,
    QUALIFIED_CURRENT_ACCOUNT: 0,
    WATCHLIST: 0,
    BLOCKED: 0
  };
  const savedSignalIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    const tenantCompanies = await tx.company.findMany({
      where: {
        tenantId,
        id: { in: decisions.map((decision) => decision.company.companyId) }
      },
      select: { id: true, normalizedName: true, name: true }
    });
    const tenantCompanyById = new Map(
      tenantCompanies.map((company) => [company.id, company])
    );
    for (const decision of decisions) {
      const { company, gate, status, finalScore, finalConfidence, tier, tierReasons } = decision;
      const tenantCompany = tenantCompanyById.get(company.companyId);
      if (!tenantCompany || tenantCompany.normalizedName !== company.companyKey) {
        throw new Error("Hunter company research failed tenant or company identity validation.");
      }
      if (status === HunterSignalStatus.NEW) acceptedCount += 1;
      if (tier === "BLOCKED") blockedCount += 1;
      tierCounts[tier] += 1;

      const primaryEvidence =
        company.evidence[company.synthesis.triggerEvidenceIndices[0]] ?? company.evidence[0];
      const sourceUrl = primaryEvidence?.url ?? null;
      const dedupeKey = createHash("sha256")
        .update([
          tenantCompany.normalizedName,
          "COMPANY_RESEARCH",
          sourceUrl ? canonicalSourceUrl(sourceUrl) : HUNTER_COMPANY_RESEARCH_PROMPT_VERSION
        ].join("|"))
        .digest("hex");
      const signal = await tx.hunterOpportunitySignal.upsert({
        where: { tenantId_dedupeKey: { tenantId, dedupeKey } },
        create: {
          tenantId,
          companyId: tenantCompany.id,
          companyName: tenantCompany.name,
          normalizedCompanyName: tenantCompany.normalizedName,
          signalType: company.synthesis.signalType,
          serviceLine: company.scoring.serviceLine,
          status,
          title: company.scoring.opportunityType,
          summary: company.synthesis.opportunitySummary,
          geography: company.synthesis.geography,
          sourceName: "Hunter company research",
          sourceUrl,
          confidence: finalConfidence,
          dedupeKey,
          evidence: researchEvidenceJson(
            company,
            gate,
            finalScore,
            finalConfidence,
            tier,
            tierReasons,
            decision.foreignPriorityAdjustment,
            decision.operatingRegion,
            completion
          ),
          rawJson: {
            researchVersion: 2,
            runId,
            evidenceCount: company.evidence.length,
            queryPasses: [...new Set(company.evidence.map((item) => item.pass))]
          }
        },
        update: {
          status,
          signalType: company.synthesis.signalType,
          serviceLine: company.scoring.serviceLine,
          title: company.scoring.opportunityType,
          summary: company.synthesis.opportunitySummary,
          geography: company.synthesis.geography,
          sourceUrl,
          confidence: finalConfidence,
          observedAt: new Date(),
          evidence: researchEvidenceJson(
            company,
            gate,
            finalScore,
            finalConfidence,
            tier,
            tierReasons,
            decision.foreignPriorityAdjustment,
            decision.operatingRegion,
            completion
          ),
          rawJson: {
            researchVersion: 2,
            runId,
            evidenceCount: company.evidence.length,
            queryPasses: [...new Set(company.evidence.map((item) => item.pass))]
          }
        },
        select: { id: true }
      });
      savedSignalIds.push(signal.id);
    }

    await tx.automationJobRun.update({
      where: { id: runId },
      data: {
        status: JobStatus.SUCCESS,
        finishedAt: new Date(),
        output: {
          phase: "COMPANY_RESEARCH_COMPLETE",
          researchedCount: completion.companies.length,
          missingCompanyCount: expectedCompanyIds.size - returnedCompanyIds.size,
          acceptedCount,
          blockedCount,
          tierCounts,
          belowThresholdCount: decisions.length - acceptedCount - blockedCount,
          evidenceCount: completion.companies.reduce((sum, company) => sum + company.evidence.length, 0),
          search: completion.search,
          models: completion.models,
          savedSignalIds,
          completedAt: new Date().toISOString()
        }
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        action: "lead-gen.hunter-company-research.completed",
        entityType: "AutomationJobRun",
        entityId: runId,
        after: {
          researchedCount: completion.companies.length,
          acceptedCount,
          blockedCount,
          tierCounts,
          searchProvider: completion.search.provider,
          qwenModel: completion.models.synthesis.name,
          kimiModel: completion.models.scoring.name,
          validatorModel: completion.models.validation.name,
          validatorStatus: completion.models.validation.status
        }
      }
    });
  }, {
    timeout: HUNTER_COMPANY_RESEARCH_TRANSACTION_TIMEOUT_MS
  });

  const plan = await runHunterDryPlan({
    tenantId,
    actorUserId: null,
    trigger: "RESEARCH",
    candidateScope: "CURRENT_RESEARCHED_OUTREACH"
  });
  let handoff:
    | Awaited<ReturnType<typeof enqueueHunterOutreachHandoff>>
    | { state: "error"; message: string };
  try {
    handoff = plan.state === "completed"
      ? await enqueueHunterOutreachHandoff({
          tenantId,
          researchRunId: runId,
          prospectingPlanRunId: plan.runId
        })
      : {
          state: "error",
          message: "Hunter did not create a completed prospecting plan for this research run."
        };
  } catch (error) {
    const message = error instanceof Error
      ? error.message.slice(0, 500)
      : "Hunter could not queue the assisted outreach handoff.";
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "lead-gen.hunter-outreach-handoff.enqueue-failed",
        entityType: "AutomationJobRun",
        entityId: runId,
        after: { message }
      }
    });
    handoff = { state: "error", message };
  }
  return {
    runId,
    researchedCount: completion.companies.length,
    acceptedCount,
    blockedCount,
    tierCounts,
    missingCompanyCount: expectedCompanyIds.size - returnedCompanyIds.size,
    plan,
    handoff
  };
}

export async function failHunterCompanyResearchRun({
  tenantId,
  runId,
  errorMessage
}: {
  tenantId: string;
  runId: string;
  errorMessage: string;
}) {
  const result = await prisma.automationJobRun.updateMany({
    where: {
      id: runId,
      tenantId,
      jobType: HUNTER_COMPANY_RESEARCH_JOB_TYPE,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] }
    },
    data: {
      status: JobStatus.ERROR,
      finishedAt: new Date(),
      errorMessage: errorMessage.trim().slice(0, 1_000) || "Hunter company research failed."
    }
  });
  if (result.count !== 1) throw new Error("Hunter company-research run is not active for this tenant.");
  return { runId, state: "failed" as const };
}

export function parseHunterCompanyResearchCompletion(value: unknown): HunterCompanyResearchCompletion {
  const root = record(value, "completion");
  const models = record(root.models, "completion.models");
  const synthesisModel = record(models.synthesis, "completion.models.synthesis");
  const scoringModel = record(models.scoring, "completion.models.scoring");
  const validationModel = record(models.validation, "completion.models.validation");
  const search = record(root.search, "completion.search");
  const companies = array(root.companies, "completion.companies");
  if (companies.length > MAX_RESEARCH_COMPANIES) {
    throw new Error(`completion.companies cannot exceed ${MAX_RESEARCH_COMPANIES} items.`);
  }
  const parsed: HunterCompanyResearchCompletion = {
    models: {
      synthesis: {
        provider: enumValue(synthesisModel.provider, ["OLLAMA"] as const, "completion.models.synthesis.provider"),
        name: text(synthesisModel.name, 200, "completion.models.synthesis.name"),
        promptVersion: text(synthesisModel.promptVersion, 100, "completion.models.synthesis.promptVersion"),
        structuredOutput: boolean(synthesisModel.structuredOutput, "completion.models.synthesis.structuredOutput"),
        inputTokens: integer(synthesisModel.inputTokens, 0, 10_000_000, "completion.models.synthesis.inputTokens"),
        outputTokens: integer(synthesisModel.outputTokens, 0, 10_000_000, "completion.models.synthesis.outputTokens"),
        durationMs: integer(synthesisModel.durationMs, 0, 86_400_000, "completion.models.synthesis.durationMs")
      },
      scoring: {
        provider: enumValue(scoringModel.provider, ["KIMI"] as const, "completion.models.scoring.provider"),
        name: text(scoringModel.name, 200, "completion.models.scoring.name"),
        promptVersion: text(scoringModel.promptVersion, 100, "completion.models.scoring.promptVersion"),
        structuredOutput: boolean(scoringModel.structuredOutput, "completion.models.scoring.structuredOutput"),
        inputTokens: integer(scoringModel.inputTokens, 0, 10_000_000, "completion.models.scoring.inputTokens"),
        cachedInputTokens: integer(
          scoringModel.cachedInputTokens,
          0,
          10_000_000,
          "completion.models.scoring.cachedInputTokens"
        ),
        outputTokens: integer(scoringModel.outputTokens, 0, 10_000_000, "completion.models.scoring.outputTokens"),
        durationMs: integer(scoringModel.durationMs, 0, 86_400_000, "completion.models.scoring.durationMs"),
        estimatedCostUsd: nullableNumber(
          scoringModel.estimatedCostUsd,
          0,
          10_000,
          "completion.models.scoring.estimatedCostUsd"
        )
      },
      validation: {
        provider: enumValue(validationModel.provider, ["KIMI"] as const, "completion.models.validation.provider"),
        name: text(validationModel.name, 200, "completion.models.validation.name"),
        promptVersion: text(
          validationModel.promptVersion,
          100,
          "completion.models.validation.promptVersion"
        ),
        structuredOutput: boolean(
          validationModel.structuredOutput,
          "completion.models.validation.structuredOutput"
        ),
        status: enumValue(
          validationModel.status,
          ["SUCCESS", "SKIPPED", "ERROR"] as const,
          "completion.models.validation.status"
        ),
        reasoningEffort: enumValue(
          validationModel.reasoningEffort,
          ["LOW", "HIGH", "MAX"] as const,
          "completion.models.validation.reasoningEffort"
        ),
        candidateCount: integer(
          validationModel.candidateCount,
          0,
          MAX_RESEARCH_COMPANIES,
          "completion.models.validation.candidateCount"
        ),
        inputTokens: integer(
          validationModel.inputTokens,
          0,
          10_000_000,
          "completion.models.validation.inputTokens"
        ),
        cachedInputTokens: integer(
          validationModel.cachedInputTokens,
          0,
          10_000_000,
          "completion.models.validation.cachedInputTokens"
        ),
        outputTokens: integer(
          validationModel.outputTokens,
          0,
          10_000_000,
          "completion.models.validation.outputTokens"
        ),
        durationMs: integer(
          validationModel.durationMs,
          0,
          86_400_000,
          "completion.models.validation.durationMs"
        ),
        estimatedCostUsd: nullableNumber(
          validationModel.estimatedCostUsd,
          0,
          10_000,
          "completion.models.validation.estimatedCostUsd"
        ),
        errorMessage: nullableText(
          validationModel.errorMessage,
          1_000,
          "completion.models.validation.errorMessage"
        )
      }
    },
    search: {
      provider: enumValue(search.provider, ["BRAVE", "DUCKDUCKGO"] as const, "completion.search.provider"),
      retrievedAt: isoDate(search.retrievedAt, "completion.search.retrievedAt"),
      queryCount: integer(search.queryCount, 0, 1_000, "completion.search.queryCount"),
      pageFetchCount: integer(search.pageFetchCount, 0, 2_000, "completion.search.pageFetchCount"),
      failedQueryCount: integer(search.failedQueryCount, 0, 1_000, "completion.search.failedQueryCount")
    },
    companies: companies.map((company, index) => parseResearchResult(company, index))
  };
  const validatedCount = parsed.companies.filter(
    (company) => company.validation.status === "VALIDATED"
  ).length;
  const validationErrorCount = parsed.companies.filter(
    (company) => company.validation.status === "ERROR"
  ).length;
  if (
    parsed.models.validation.status === "SUCCESS" &&
    (validatedCount !== parsed.models.validation.candidateCount || validationErrorCount > 0)
  ) {
    throw new Error("completion.models.validation SUCCESS counts do not match company validation results.");
  }
  if (
    parsed.models.validation.status === "SKIPPED" &&
    (parsed.models.validation.candidateCount !== 0 || validatedCount > 0 || validationErrorCount > 0)
  ) {
    throw new Error("completion.models.validation SKIPPED cannot contain selected company validations.");
  }
  if (
    parsed.models.validation.status === "ERROR" &&
    validationErrorCount !== parsed.models.validation.candidateCount
  ) {
    throw new Error("completion.models.validation ERROR counts do not match company validation results.");
  }
  return parsed;
}

export function evaluateResearchGate(company: ResearchResult) {
  const blockers: string[] = [];
  if (
    (company.synthesis.identityDisposition !== "PASS" || company.synthesis.identityConfidence < 70) &&
    !hasCorroboratingFirstPartyIdentity(company)
  ) {
    blockers.push("Company identity was not confirmed at 70% or better.");
  }
  if (hasExplicitProviderServiceEvidence(company)) {
    blockers.push("Public evidence explicitly describes the company providing logistics services to others.");
  }
  if (
    company.synthesis.stableExclusiveProviderEvidence &&
    !company.synthesis.providerDisplacementEvidence &&
    hasExplicitStableProviderEvidence(company.evidence)
  ) {
    blockers.push("Evidence shows a stable exclusive provider relationship without a credible displacement trigger.");
  }
  if (company.evidence.length < 2) blockers.push("Fewer than two evidence records were retrieved.");
  const passes = new Set(company.evidence.map((item) => item.pass));
  if (!passes.has("IDENTITY")) blockers.push("The mandatory identity pass has no evidence.");
  if (passes.size < 2) blockers.push("Evidence covers fewer than two independent research passes.");
  const operatingRegion = effectiveOperatingRegion(company);
  if (
    company.synthesis.verifiedUsDivision &&
    operatingRegion !== "NORTH_AMERICA" &&
    !hasCitedUsDivisionEvidence(company)
  ) {
    blockers.push("The claimed U.S. division is not verified by the cited public identity evidence.");
  }
  const isChinaEntity =
    operatingRegion === "CHINA" ||
    (operatingRegion === "UNKNOWN" && hasExplicitChinaHeadquartersEvidence(company.evidence));
  if (isChinaEntity && !company.synthesis.verifiedUsDivision) {
    blockers.push("Mainland-China company has no verified U.S. operating division.");
  }
  return { passed: blockers.length === 0, blockers };
}

export function classifyResearchOpportunity(
  company: ResearchResult,
  gate: { passed: boolean; blockers: string[] },
  thresholds: { minimumPriorityScore: number; minimumSignalConfidence: number }
) {
  const reasons: string[] = [];
  const operatingRegion = effectiveOperatingRegion(company);
  const freshness = effectiveResearchFreshness(company);
  if (company.synthesis.freshness === "FRESH" && freshness === "CURRENT") {
    reasons.push(
      "The claimed fresh event lacked a recent dated source and was evaluated as current account fit instead."
    );
  }
  if (!gate.passed) {
    return {
      tier: "BLOCKED" as const,
      tierReasons: [...gate.blockers],
      finalScore: 0,
      finalConfidence: 0,
      foreignPriorityAdjustment: 0,
      operatingRegion
    };
  }

  const validatedScore =
    company.validation.status === "VALIDATED" && company.validation.validatedScore !== null
      ? Math.min(company.scoring.totalScore, company.validation.validatedScore)
      : company.scoring.totalScore;
  let foreignPriorityAdjustment = 0;
  let foreignWatchlist = false;
  if (
    operatingRegion === "OTHER_FOREIGN" &&
    !company.synthesis.verifiedUsDivision
  ) {
    foreignPriorityAdjustment = -10;
    foreignWatchlist = true;
    reasons.push("Foreign company without a verified U.S. division is deprioritized by 10 points.");
  } else if (operatingRegion === "UNKNOWN") {
    foreignWatchlist = true;
    reasons.push("Company operating country is not sufficiently verified for active prioritization.");
  }

  const finalScore = Math.max(0, validatedScore + foreignPriorityAdjustment);
  const finalConfidence = Math.min(
    company.synthesis.confidence,
    company.scoring.confidence,
    company.validation.status === "VALIDATED" && company.validation.confidence !== null
      ? company.validation.confidence
      : 100
  );

  if (foreignWatchlist) {
    return {
      tier: "WATCHLIST" as const,
      tierReasons: reasons,
      finalScore,
      finalConfidence,
      foreignPriorityAdjustment,
      operatingRegion
    };
  }
  if (freshness === "STALE" || freshness === "NONE") {
    reasons.push(
      "Current opportunity evidence was not established; retained for later research instead of being permanently blocked."
    );
    return {
      tier: "WATCHLIST" as const,
      tierReasons: reasons,
      finalScore,
      finalConfidence,
      foreignPriorityAdjustment,
      operatingRegion
    };
  }
  if (
    finalScore < thresholds.minimumPriorityScore ||
    finalConfidence < thresholds.minimumSignalConfidence
  ) {
    reasons.push(
      `Score or confidence is below the active threshold (${thresholds.minimumPriorityScore}/${thresholds.minimumSignalConfidence}).`
    );
    return {
      tier: "WATCHLIST" as const,
      tierReasons: reasons,
      finalScore,
      finalConfidence,
      foreignPriorityAdjustment,
      operatingRegion
    };
  }
  if (freshness === "FRESH") {
    const validatorSupportsRecentTrigger =
      company.validation.supportingEvidenceIndices.some((index) =>
        company.synthesis.triggerEvidenceIndices.includes(index)
      ) &&
      hasRecentDatedTriggerEvidence(
        company.evidence,
        company.validation.supportingEvidenceIndices
      );
    if (
      company.validation.status === "VALIDATED" &&
      company.validation.disposition === "CONFIRM" &&
      validatorSupportsRecentTrigger
    ) {
      reasons.push("Kimi K3 confirmed the verified recent event and conservative score.");
      return {
        tier: "HOT_OPPORTUNITY" as const,
        tierReasons: reasons,
        finalScore,
        finalConfidence,
        foreignPriorityAdjustment,
        operatingRegion
      };
    }
    reasons.push(
      company.validation.disposition === "DOWNGRADE_TO_WATCHLIST"
        ? "Kimi K3 downgraded the fresh-event candidate."
        : company.validation.disposition === "CONFIRM"
          ? "Kimi K3 did not cite the same recent dated trigger, so the candidate remains on the watchlist."
        : "Fresh-event candidate was not successfully validated by Kimi K3."
    );
    return {
      tier: "WATCHLIST" as const,
      tierReasons: reasons,
      finalScore,
      finalConfidence,
      foreignPriorityAdjustment,
      operatingRegion
    };
  }

  reasons.push("Strong current fit cleared deterministic score and confidence thresholds.");
  return {
    tier: "QUALIFIED_CURRENT_ACCOUNT" as const,
    tierReasons: reasons,
    finalScore,
    finalConfidence,
    foreignPriorityAdjustment,
    operatingRegion
  };
}

function effectiveResearchFreshness(company: ResearchResult): Freshness {
  if (
    company.synthesis.freshness === "FRESH" &&
    !hasRecentDatedTriggerEvidence(company.evidence, company.synthesis.triggerEvidenceIndices)
  ) {
    return "CURRENT";
  }
  return company.synthesis.freshness;
}

function hasCorroboratingFirstPartyIdentity(company: ResearchResult) {
  const aliases = company.companyName
    .toLowerCase()
    .replace(/\b(incorporated|corporation|company|limited|holdings|industries|manufacturing|solutions|systems|compressors|americas|inc|corp|llc|ltd|co|plc|lp)\b/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const identityNeedle = aliases.join("").replace(/[^a-z0-9]+/g, "");
  if (identityNeedle.length < 5) return false;
  return company.evidence.some((item) => {
    if (item.pass !== "IDENTITY" || !item.firstParty || item.sourceType !== "FIRST_PARTY") {
      return false;
    }
    const text = `${item.title} ${item.excerpt}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return text.includes(identityNeedle);
  });
}

function hasRecentDatedTriggerEvidence(evidence: Evidence[], triggerEvidenceIndices: number[]) {
  const now = Date.now();
  const cutoff = now - 548 * 24 * 60 * 60 * 1_000;
  const latestAccepted = now + 24 * 60 * 60 * 1_000;
  return triggerEvidenceIndices.some((index) => {
    const item = evidence[index];
    if (!item) return false;
    if (!["FRESH_EVENTS", "FOLLOW_UP"].includes(item.pass) || !item.publishedAt) return false;
    const publishedAt = new Date(item.publishedAt).getTime();
    return publishedAt >= cutoff && publishedAt <= latestAccepted;
  });
}

function hasExplicitProviderServiceEvidence(company: ResearchResult) {
  const directProviderPattern =
    /\b(provider|provides?|providing|offers?|offering)\b[^.\n]{0,120}\b(logistics services?|warehousing services?|transportation management|freight forwarding|customs brokerage|fulfillment services?|cross[- ]docking)\b/i;
  const onBehalfPattern =
    /\b(warehousing|warehouse|packaging|distribution|transportation)\b[^.\n]{0,120}\bon behalf of\b/i;
  const identityAliases = companyIdentityAliases(company.companyName);
  return company.evidence.some((item) => {
    if (item.pass === "CAREERS" && !item.firstParty) return false;
    const text = `${item.title}\n${item.excerpt}`;
    if (
      !item.firstParty &&
      !identityAliases.some((alias) => normalizeEvidenceText(text).includes(alias))
    ) {
      return false;
    }
    return directProviderPattern.test(text) || onBehalfPattern.test(text);
  });
}

function hasExplicitStableProviderEvidence(evidence: Evidence[]) {
  const stableProviderPattern =
    /\b(exclusive|sole|long[- ]term|multi[- ]year|strategic)\b[^.\n]{0,120}\b(logistics|warehousing|freight|fulfillment|transportation|3pl)\b[^.\n]{0,80}\b(provider|partner|agreement|contract)\b/i;
  const reverseStableProviderPattern =
    /\b(logistics|warehousing|freight|fulfillment|transportation|3pl)\b[^.\n]{0,80}\b(provider|partner)\b[^.\n]{0,120}\b(exclusive|sole|long[- ]term|multi[- ]year|strategic)\b/i;
  return evidence.some((item) => {
    const text = `${item.title}\n${item.excerpt}`;
    return stableProviderPattern.test(text) || reverseStableProviderPattern.test(text);
  });
}

function hasExplicitChinaHeadquartersEvidence(evidence: Evidence[]) {
  const chinaEntityPattern =
    /\b(?:china[- ]based|chinese (?:company|manufacturer|retailer|importer|business)|(?:headquartered|based|founded|incorporated) in (?:mainland )?china)\b/i;
  return evidence.some(
    (item) =>
      item.pass === "IDENTITY" &&
      chinaEntityPattern.test(`${item.title}\n${item.excerpt}`)
  );
}

function hasCitedUsDivisionEvidence(company: ResearchResult) {
  const divisionAliases = companyIdentityAliases(company.synthesis.usDivisionName ?? "");
  if (divisionAliases.length === 0) return false;
  const jurisdictionPattern = /\b(?:u s|usa|united states|north america)\b/;
  const operatingRelationshipPattern =
    /\b(?:subsidiar(?:y|ies)|division|branch|facility|facilities|manufactur(?:e|es|ing)|operat(?:e|es|ing)|based|headquarter(?:ed|s))\b/;
  return company.synthesis.usDivisionEvidenceIndices.some((index) => {
    const item = company.evidence[index];
    if (
      !item ||
      !["IDENTITY", "FOLLOW_UP"].includes(item.pass) ||
      item.sourceType === "DIRECTORY"
    ) {
      return false;
    }
    const evidenceText = normalizeEvidenceText(`${item.title} ${item.excerpt}`);
    return (
      divisionAliases.some((alias) => evidenceText.includes(alias)) &&
      jurisdictionPattern.test(evidenceText) &&
      operatingRelationshipPattern.test(evidenceText)
    );
  });
}

function companyIdentityAliases(value: string) {
  const withoutParenthetical = value.replace(/\([^)]*\)/g, " ");
  const normalized = normalizeEvidenceText(withoutParenthetical);
  if (!normalized) return [];
  const legalSuffixes = new Set([
    "co",
    "company",
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "llc",
    "limited",
    "lp",
    "ltd",
    "plc"
  ]);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && legalSuffixes.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  const withoutSuffix = tokens.join(" ");
  return [...new Set([normalized, withoutSuffix].filter((alias) => alias.length >= 5))];
}

function normalizeEvidenceText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function effectiveOperatingRegion(company: ResearchResult): OperatingRegion {
  const country = company.synthesis.companyCountry
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (!country) return company.synthesis.operatingRegion;
  if (
    ["united states", "united states of america", "usa", "us", "canada", "north america"].includes(
      country
    )
  ) {
    return "NORTH_AMERICA";
  }
  if (["china", "mainland china", "people s republic of china", "prc"].includes(country)) {
    return "CHINA";
  }
  if (["unknown", "unclear"].includes(country)) return "UNKNOWN";
  return "OTHER_FOREIGN";
}

function parseResearchResult(value: unknown, index: number): ResearchResult {
  const path = `completion.companies[${index}]`;
  const company = record(value, path);
  const synthesis = record(company.synthesis, `${path}.synthesis`);
  const scoring = record(company.scoring, `${path}.scoring`);
  const validation = record(company.validation, `${path}.validation`);
  const rawDimensions = record(scoring.dimensionScores, `${path}.scoring.dimensionScores`);
  const evidenceRows = array(company.evidence, `${path}.evidence`);
  if (evidenceRows.length > MAX_EVIDENCE_PER_COMPANY) {
    throw new Error(`${path}.evidence cannot exceed ${MAX_EVIDENCE_PER_COMPANY} items.`);
  }
  const parsedEvidence = evidenceRows.map((row, evidenceIndex) =>
    parseEvidence(row, `${path}.evidence[${evidenceIndex}]`)
  );
  const triggerEvidenceIndices = array(
    synthesis.triggerEvidenceIndices,
    `${path}.synthesis.triggerEvidenceIndices`
  ).map((item, triggerIndex) => {
    const evidenceIndex = integer(
      item,
      0,
      Math.max(0, parsedEvidence.length - 1),
      `${path}.synthesis.triggerEvidenceIndices[${triggerIndex}]`
    );
    if (!parsedEvidence[evidenceIndex]) {
      throw new Error(`${path}.synthesis.triggerEvidenceIndices[${triggerIndex}] is out of range.`);
    }
    return evidenceIndex;
  });
  if (triggerEvidenceIndices.length < 1 || triggerEvidenceIndices.length > 5) {
    throw new Error(`${path}.synthesis.triggerEvidenceIndices must contain 1 to 5 items.`);
  }
  const usDivisionEvidenceIndices = parseEvidenceIndices(
    synthesis.usDivisionEvidenceIndices,
    parsedEvidence,
    `${path}.synthesis.usDivisionEvidenceIndices`,
    0,
    5
  );
  const supportingEvidenceIndices = parseEvidenceIndices(
    validation.supportingEvidenceIndices,
    parsedEvidence,
    `${path}.validation.supportingEvidenceIndices`,
    0,
    5
  );
  const verifiedUsDivision = boolean(
    synthesis.verifiedUsDivision,
    `${path}.synthesis.verifiedUsDivision`
  );
  if (
    verifiedUsDivision &&
    (!nullableText(synthesis.usDivisionName, 300, `${path}.synthesis.usDivisionName`) ||
      usDivisionEvidenceIndices.length === 0)
  ) {
    throw new Error(`${path}.synthesis must cite a named U.S. division when verifiedUsDivision is true.`);
  }
  if (!verifiedUsDivision && usDivisionEvidenceIndices.length > 0) {
    throw new Error(`${path}.synthesis.usDivisionEvidenceIndices must be empty when no U.S. division is verified.`);
  }
  const validationStatus = enumValue(
    validation.status,
    ["VALIDATED", "NOT_SELECTED", "ERROR"] as const,
    `${path}.validation.status`
  );
  const validationDisposition = nullableEnumValue(
    validation.disposition,
    ["CONFIRM", "DOWNGRADE_TO_WATCHLIST"] as const,
    `${path}.validation.disposition`
  );
  if (
    validationStatus === "VALIDATED" &&
    (!validationDisposition ||
      supportingEvidenceIndices.length === 0 ||
      validation.validatedScore === null ||
      validation.validatedScore === undefined ||
      validation.confidence === null ||
      validation.confidence === undefined ||
      !nullableText(validation.rationale, 2_000, `${path}.validation.rationale`))
  ) {
    throw new Error(`${path}.validation must include a complete cited decision when validated.`);
  }
  if (validationStatus !== "VALIDATED" && validationDisposition) {
    throw new Error(`${path}.validation.disposition must be null unless validation succeeded.`);
  }
  const dimensions = {
    demandTrigger: integer(rawDimensions.demandTrigger, 0, 20, `${path}.scoring.dimensionScores.demandTrigger`),
    serviceFit: integer(rawDimensions.serviceFit, 0, 20, `${path}.scoring.dimensionScores.serviceFit`),
    timing: integer(rawDimensions.timing, 0, 20, `${path}.scoring.dimensionScores.timing`),
    accessibility: integer(rawDimensions.accessibility, 0, 20, `${path}.scoring.dimensionScores.accessibility`),
    evidenceQuality: integer(
      rawDimensions.evidenceQuality,
      0,
      20,
      `${path}.scoring.dimensionScores.evidenceQuality`
    )
  };
  const totalScore = integer(scoring.totalScore, 0, 100, `${path}.scoring.totalScore`);
  if (Object.values(dimensions).reduce((sum, score) => sum + score, 0) !== totalScore) {
    throw new Error(`${path}.scoring.totalScore must equal the five deterministic dimension scores.`);
  }
  const validatorScore = nullableInteger(
    validation.validatedScore,
    0,
    100,
    `${path}.validation.validatedScore`
  );
  if (validatorScore !== null && validatorScore > totalScore) {
    throw new Error(`${path}.validation.validatedScore cannot exceed the K2.6 score.`);
  }
  const validatorConfidence = nullableInteger(
    validation.confidence,
    0,
    100,
    `${path}.validation.confidence`
  );
  return {
    companyId: text(company.companyId, 200, `${path}.companyId`),
    companyKey: text(company.companyKey, 300, `${path}.companyKey`),
    companyName: text(company.companyName, 300, `${path}.companyName`),
    evidence: parsedEvidence,
    synthesis: {
      identityDisposition: enumValue(
        synthesis.identityDisposition,
        ["PASS", "AMBIGUOUS", "BLOCK"] as const,
        `${path}.synthesis.identityDisposition`
      ),
      identityConfidence: integer(synthesis.identityConfidence, 0, 100, `${path}.synthesis.identityConfidence`),
      identityReason: text(synthesis.identityReason, 1_000, `${path}.synthesis.identityReason`),
      logisticsProvider: boolean(synthesis.logisticsProvider, `${path}.synthesis.logisticsProvider`),
      namedExternalLogisticsProvider: boolean(
        synthesis.namedExternalLogisticsProvider,
        `${path}.synthesis.namedExternalLogisticsProvider`
      ),
      stableExclusiveProviderEvidence: boolean(
        synthesis.stableExclusiveProviderEvidence,
        `${path}.synthesis.stableExclusiveProviderEvidence`
      ),
      providerDisplacementEvidence: boolean(
        synthesis.providerDisplacementEvidence,
        `${path}.synthesis.providerDisplacementEvidence`
      ),
      freshness: enumValue(
        synthesis.freshness,
        ["FRESH", "CURRENT", "STALE", "NONE"] as const,
        `${path}.synthesis.freshness`
      ),
      opportunitySummary: text(synthesis.opportunitySummary, 2_000, `${path}.synthesis.opportunitySummary`),
      triggerEvidenceIndices,
      geography: nullableText(synthesis.geography, 300, `${path}.synthesis.geography`),
      companyCountry: nullableText(synthesis.companyCountry, 200, `${path}.synthesis.companyCountry`),
      operatingRegion: enumValue(
        synthesis.operatingRegion,
        ["NORTH_AMERICA", "CHINA", "OTHER_FOREIGN", "UNKNOWN"] as const,
        `${path}.synthesis.operatingRegion`
      ),
      verifiedUsDivision,
      usDivisionName: nullableText(
        synthesis.usDivisionName,
        300,
        `${path}.synthesis.usDivisionName`
      ),
      usDivisionEvidenceIndices,
      serviceLine: enumValue(
        synthesis.serviceLine,
        Object.values(HunterServiceLine),
        `${path}.synthesis.serviceLine`
      ),
      signalType: enumValue(
        synthesis.signalType,
        Object.values(HunterSignalType),
        `${path}.synthesis.signalType`
      ),
      confidence: integer(synthesis.confidence, 0, 100, `${path}.synthesis.confidence`),
      rationale: text(synthesis.rationale, 2_000, `${path}.synthesis.rationale`),
      missingEvidence: array(synthesis.missingEvidence, `${path}.synthesis.missingEvidence`)
        .map((item, missingIndex) => text(item, 300, `${path}.synthesis.missingEvidence[${missingIndex}]`))
        .slice(0, 10)
    },
    scoring: {
      serviceLine: enumValue(scoring.serviceLine, Object.values(HunterServiceLine), `${path}.scoring.serviceLine`),
      opportunityType: text(scoring.opportunityType, 300, `${path}.scoring.opportunityType`),
      rationale: text(scoring.rationale, 2_000, `${path}.scoring.rationale`),
      recommendedPersona: text(scoring.recommendedPersona, 500, `${path}.scoring.recommendedPersona`),
      recommendedCadence: text(scoring.recommendedCadence, 300, `${path}.scoring.recommendedCadence`),
      dimensionScores: dimensions,
      totalScore,
      confidence: integer(scoring.confidence, 0, 100, `${path}.scoring.confidence`)
    },
    validation: {
      status: validationStatus,
      disposition: validationDisposition,
      validatedScore: validatorScore,
      confidence: validatorConfidence,
      rationale: nullableText(validation.rationale, 2_000, `${path}.validation.rationale`),
      riskFlags: array(validation.riskFlags, `${path}.validation.riskFlags`)
        .map((item, riskIndex) => text(item, 300, `${path}.validation.riskFlags[${riskIndex}]`))
        .slice(0, 10),
      supportingEvidenceIndices
    }
  };
}

function parseEvidence(value: unknown, path: string): Evidence {
  const evidence = record(value, path);
  const url = httpsUrl(evidence.url, `${path}.url`);
  const sourceDomain = text(evidence.sourceDomain, 300, `${path}.sourceDomain`).toLowerCase();
  if (new URL(url).hostname.toLowerCase() !== sourceDomain) {
    throw new Error(`${path}.sourceDomain must match the evidence URL hostname.`);
  }
  return {
    pass: enumValue(
      evidence.pass,
      [...HUNTER_RESEARCH_PASSES.map((pass) => pass.id), "FOLLOW_UP"] as const,
      `${path}.pass`
    ),
    query: text(evidence.query, 500, `${path}.query`),
    title: text(evidence.title, 500, `${path}.title`),
    url,
    sourceDomain,
    sourceType: enumValue(
      evidence.sourceType,
      ["FIRST_PARTY", "GOVERNMENT", "NEWS", "CAREERS", "DIRECTORY", "OTHER"] as const,
      `${path}.sourceType`
    ),
    publishedAt: nullableIsoDate(evidence.publishedAt, `${path}.publishedAt`),
    excerpt: text(evidence.excerpt, 2_000, `${path}.excerpt`),
    firstParty: boolean(evidence.firstParty, `${path}.firstParty`)
  };
}

function researchEvidenceJson(
  company: ResearchResult,
  gate: { passed: boolean; blockers: string[] },
  finalScore: number,
  finalConfidence: number,
  tier: HunterResearchOpportunityTier,
  tierReasons: string[],
  foreignPriorityAdjustment: number,
  operatingRegion: OperatingRegion,
  completion: HunterCompanyResearchCompletion
): Prisma.InputJsonValue {
  return {
    research: {
      promptVersion: HUNTER_COMPANY_RESEARCH_PROMPT_VERSION,
      retrievedAt: completion.search.retrievedAt,
      searchProvider: completion.search.provider,
      evidence: company.evidence,
      synthesis: company.synthesis,
      scoring: company.scoring,
      validation: company.validation,
      deterministicGate: gate,
      opportunityTier: tier,
      tierReasons,
      finalScore,
      finalConfidence,
      foreignPriorityAdjustment,
      effectiveOperatingRegion: operatingRegion,
      models: completion.models
    }
  } as Prisma.InputJsonObject;
}

function normalizeRequestedCompanyKeys(companyKeys?: string[]) {
  if (!companyKeys) return [];
  if (!Array.isArray(companyKeys) || companyKeys.length > MAX_RESEARCH_COMPANIES) {
    throw new Error(`companyKeys cannot exceed ${MAX_RESEARCH_COMPANIES} items.`);
  }
  return [...new Set(companyKeys.map((value) => normalizeResearchCompanyKey(String(value))).filter(Boolean))];
}

function normalizeResearchCompanyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatLocalDate(date: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_HUNTER_POLICY.scheduleTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }
}

function canonicalSourceUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  return url.toString();
}

function record(value: unknown, path: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function parseEvidenceIndices(
  value: unknown,
  evidence: Evidence[],
  path: string,
  minimumItems: number,
  maximumItems: number
) {
  const indices = array(value, path).map((item, itemIndex) => {
    const evidenceIndex = integer(
      item,
      0,
      Math.max(0, evidence.length - 1),
      `${path}[${itemIndex}]`
    );
    if (!evidence[evidenceIndex]) throw new Error(`${path}[${itemIndex}] is out of range.`);
    return evidenceIndex;
  });
  if (indices.length < minimumItems || indices.length > maximumItems) {
    throw new Error(`${path} must contain ${minimumItems} to ${maximumItems} items.`);
  }
  return [...new Set(indices)];
}

function text(value: unknown, maximum: number, path: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new Error(`${path} must be a non-empty string of ${maximum} characters or fewer.`);
  }
  return value.trim();
}

function nullableText(value: unknown, maximum: number, path: string) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, maximum, path);
}

function boolean(value: unknown, path: string) {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, path: string) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${path} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return Number(value);
}

function nullableNumber(value: unknown, minimum: number, maximum: number, path: string) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be a number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function nullableInteger(value: unknown, minimum: number, maximum: number, path: string) {
  if (value === null || value === undefined) return null;
  return integer(value, minimum, maximum, path);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${path} must be one of: ${values.join(", ")}.`);
  }
  return value as T;
}

function nullableEnumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string
): T | null {
  if (value === null || value === undefined) return null;
  return enumValue(value, values, path);
}

function httpsUrl(value: unknown, path: string) {
  const raw = text(value, 2_000, path);
  const url = new URL(raw);
  if (url.protocol !== "https:" || !url.hostname) throw new Error(`${path} must use HTTPS.`);
  return url.toString();
}

function isoDate(value: unknown, path: string) {
  const raw = text(value, 100, path);
  if (Number.isNaN(new Date(raw).getTime())) throw new Error(`${path} must be an ISO date.`);
  return raw;
}

function nullableIsoDate(value: unknown, path: string) {
  if (value === null || value === undefined || value === "") return null;
  return isoDate(value, path);
}

export const HUNTER_COMPANY_RESEARCH_SAFETY = {
  externalWrites: false,
  apollo: false,
  outreach: false,
  cadenceWrites: false,
  pipelineStageChanges: false
} satisfies Prisma.InputJsonObject;
