import { createHash } from "node:crypto";

import {
  CandidateStatus,
  ContactStatus,
  HunterAutomationMode,
  HunterServiceLine,
  HunterSignalStatus,
  HunterSignalType,
  JobStatus,
  Prisma,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";

import { DEFAULT_HUNTER_POLICY, runHunterDryPlan } from "@/modules/lead-gen/hunter-planner";
import { prisma } from "@/server/db";

export const HUNTER_COMPANY_RESEARCH_JOB_TYPE = "HUNTER_COMPANY_DEEP_RESEARCH";
export const HUNTER_COMPANY_RESEARCH_PROMPT_VERSION = "hunter-company-research-v4";
export const HUNTER_COMPANY_RESEARCH_DEFAULT_QWEN_MODEL = "qwen3.5:35b";
export const HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL = "kimi-k2.6";

const ACTIVE_RUN_WINDOW_MS = 4 * 60 * 60 * 1000;
const RECENT_RESEARCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESEARCH_COMPANIES = 100;
const MAX_EVIDENCE_PER_COMPANY = 24;

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
    geography: string | null;
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
    where: {
      tenantId,
      doNotProspect: false,
      candidateStatus: { notIn: [CandidateStatus.REJECTED, CandidateStatus.DISQUALIFIED] },
      cashflowCustomers: { none: {} },
      leads: { none: {} },
      contacts: {
        none: {
          OR: [
            { contactStatus: ContactStatus.DO_NOT_CONTACT },
            { replyStatus: { not: ReplyStatus.NO_REPLY } },
            { sequenceStatus: { notIn: [SequenceStatus.NOT_STARTED, SequenceStatus.READY] } }
          ]
        }
      },
      ...(requestedKeys.length > 0
        ? { normalizedName: { in: requestedKeys } }
        : recentlyResearchedIds.size > 0
          ? { id: { notIn: [...recentlyResearchedIds] } }
          : {})
    },
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
        kimiModel: HUNTER_COMPANY_RESEARCH_DEFAULT_KIMI_MODEL
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
        }
      },
      limits: {
        companies: limit,
        initialQueriesPerCompany: HUNTER_RESEARCH_PASSES.length,
        followUpQueriesPerCompany: 2,
        resultsPerQuery: 5,
        evidencePerCompany: MAX_EVIDENCE_PER_COMPANY
      },
      rules: {
        noApollo: true,
        noOutreach: true,
        noCadenceWrites: true,
        noPipelineStageChanges: true,
        evidenceOnly: true,
        blockLogisticsProviders: true,
        blockIncumbentsWithoutOutsourceEvidence: true,
        requireIdentityPass: true
      }
    }
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
    const finalScore = gate.passed ? company.scoring.totalScore : 0;
    const finalConfidence = gate.passed
      ? Math.min(company.synthesis.confidence, company.scoring.confidence)
      : 0;
    const wouldPursue =
      gate.passed &&
      finalScore >= effective.minimumPriorityScore &&
      finalConfidence >= effective.minimumSignalConfidence;
    return {
      company,
      gate,
      finalScore,
      finalConfidence,
      status: wouldPursue ? HunterSignalStatus.NEW : HunterSignalStatus.DISMISSED
    };
  });

  let acceptedCount = 0;
  let blockedCount = 0;
  const savedSignalIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const decision of decisions) {
      const { company, gate, status, finalScore, finalConfidence } = decision;
      const tenantCompany = await tx.company.findFirst({
        where: { id: company.companyId, tenantId },
        select: { id: true, normalizedName: true, name: true }
      });
      if (!tenantCompany || tenantCompany.normalizedName !== company.companyKey) {
        throw new Error("Hunter company research failed tenant or company identity validation.");
      }
      if (status === HunterSignalStatus.NEW) acceptedCount += 1;
      if (!gate.passed) blockedCount += 1;

      const primaryEvidence = company.evidence[0];
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
          evidence: researchEvidenceJson(company, gate, finalScore, completion),
          rawJson: {
            researchVersion: 1,
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
          evidence: researchEvidenceJson(company, gate, finalScore, completion),
          rawJson: {
            researchVersion: 1,
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
          searchProvider: completion.search.provider,
          qwenModel: completion.models.synthesis.name,
          kimiModel: completion.models.scoring.name
        }
      }
    });
  });

  const plan = await runHunterDryPlan({
    tenantId,
    actorUserId: null,
    trigger: "RESEARCH"
  });
  return {
    runId,
    researchedCount: completion.companies.length,
    acceptedCount,
    blockedCount,
    missingCompanyCount: expectedCompanyIds.size - returnedCompanyIds.size,
    plan
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
  const search = record(root.search, "completion.search");
  const companies = array(root.companies, "completion.companies");
  if (companies.length > MAX_RESEARCH_COMPANIES) {
    throw new Error(`completion.companies cannot exceed ${MAX_RESEARCH_COMPANIES} items.`);
  }
  return {
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
}

export function evaluateResearchGate(company: ResearchResult) {
  const blockers: string[] = [];
  if (company.synthesis.identityDisposition !== "PASS" || company.synthesis.identityConfidence < 70) {
    blockers.push("Company identity was not confirmed at 70% or better.");
  }
  if (company.synthesis.logisticsProvider) blockers.push("The company is itself a logistics provider.");
  if (hasExplicitProviderServiceEvidence(company.evidence)) {
    blockers.push("Public evidence explicitly describes the company providing logistics services to others.");
  }
  if (
    company.synthesis.stableExclusiveProviderEvidence &&
    !company.synthesis.providerDisplacementEvidence
  ) {
    blockers.push("Evidence shows a stable exclusive provider relationship without a credible displacement trigger.");
  }
  if (company.evidence.length < 2) blockers.push("Fewer than two evidence records were retrieved.");
  const passes = new Set(company.evidence.map((item) => item.pass));
  if (!passes.has("IDENTITY")) blockers.push("The mandatory identity pass has no evidence.");
  if (passes.size < 2) blockers.push("Evidence covers fewer than two independent research passes.");
  if (company.synthesis.freshness === "STALE" || company.synthesis.freshness === "NONE") {
    blockers.push("No current or fresh opportunity evidence was found.");
  }
  return { passed: blockers.length === 0, blockers };
}

function hasExplicitProviderServiceEvidence(evidence: Evidence[]) {
  const directProviderPattern =
    /\b(provider|provides?|providing|offers?|offering)\b[^.\n]{0,120}\b(logistics services?|warehousing services?|transportation management|freight forwarding|customs brokerage|fulfillment services?|cross[- ]docking)\b/i;
  const onBehalfPattern =
    /\b(warehousing|warehouse|packaging|distribution|transportation)\b[^.\n]{0,120}\bon behalf of\b/i;
  return evidence.some((item) => {
    const text = `${item.title}\n${item.excerpt}`;
    return directProviderPattern.test(text) || onBehalfPattern.test(text);
  });
}

function parseResearchResult(value: unknown, index: number): ResearchResult {
  const path = `completion.companies[${index}]`;
  const company = record(value, path);
  const synthesis = record(company.synthesis, `${path}.synthesis`);
  const scoring = record(company.scoring, `${path}.scoring`);
  const rawDimensions = record(scoring.dimensionScores, `${path}.scoring.dimensionScores`);
  const evidenceRows = array(company.evidence, `${path}.evidence`);
  if (evidenceRows.length > MAX_EVIDENCE_PER_COMPANY) {
    throw new Error(`${path}.evidence cannot exceed ${MAX_EVIDENCE_PER_COMPANY} items.`);
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
  return {
    companyId: text(company.companyId, 200, `${path}.companyId`),
    companyKey: text(company.companyKey, 300, `${path}.companyKey`),
    companyName: text(company.companyName, 300, `${path}.companyName`),
    evidence: evidenceRows.map((row, evidenceIndex) => parseEvidence(row, `${path}.evidence[${evidenceIndex}]`)),
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
      geography: nullableText(synthesis.geography, 300, `${path}.synthesis.geography`),
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
      deterministicGate: gate,
      finalScore,
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

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${path} must be one of: ${values.join(", ")}.`);
  }
  return value as T;
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
