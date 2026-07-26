import { createHash } from "node:crypto";
import {
  HunterAutomationMode,
  HunterServiceLine,
  HunterSignalStatus,
  HunterSignalType,
  JobStatus,
  Prisma
} from "@prisma/client";

import { DEFAULT_HUNTER_POLICY } from "@/modules/lead-gen/hunter-planner";
import { prisma } from "@/server/db";
import { normalizeCompanyName } from "@/server/integrations/apollo";

export const HUNTER_SIGNAL_SCOUT_JOB_TYPE = "HUNTER_EXTERNAL_SIGNAL_SCOUT";
export const HUNTER_SIGNAL_SCOUT_PROMPT_VERSION = "hunter-signal-classifier-v1";
export const HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL = "qwen3:30b-instruct";
const ACTIVE_RUN_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_COMPLETION_CANDIDATES = 100;

const DISCOVERY_LENSES = [
  {
    id: "warehouse-expansion",
    serviceLine: HunterServiceLine.WAREHOUSING,
    query:
      '("distribution center" OR "fulfillment center" OR warehouse) (opens OR opening OR expansion OR expanding OR lease OR construction) (US OR USA OR Canada)'
  },
  {
    id: "retail-rollout",
    serviceLine: HunterServiceLine.WAREHOUSING,
    query:
      '("store openings" OR "new stores" OR "retail expansion" OR "market entry") (US OR USA OR Canada)'
  },
  {
    id: "manufacturing-capacity",
    serviceLine: HunterServiceLine.WAREHOUSING,
    query:
      '("new plant" OR "new factory" OR "manufacturing expansion" OR "production expansion") (US OR USA OR Canada)'
  },
  {
    id: "ocean-air-import-growth",
    serviceLine: HunterServiceLine.OCEAN_AIR,
    query:
      '("US expansion" OR "North American expansion" OR "enters US market") (manufacturer OR retailer OR distributor OR brand)'
  },
  {
    id: "supply-chain-leadership",
    serviceLine: HunterServiceLine.OCEAN_AIR,
    query:
      '("chief supply chain officer" OR "vice president supply chain" OR "head of logistics") (appointed OR joins OR named)'
  },
  {
    id: "regional-distribution",
    serviceLine: HunterServiceLine.TRUCKING,
    query:
      '("regional distribution" OR "last mile network" OR "distribution network") (expands OR expansion OR opens OR launch)'
  }
] as const;

type ScoutCandidate = {
  sourceIndex: number;
  sourceUrl: string;
  sourceName: string | null;
  sourcePublishedAt: string | null;
  articleTitle: string;
  queryId: string;
  relevant: boolean;
  companyName: string | null;
  signalType: HunterSignalType;
  serviceLine: HunterServiceLine;
  opportunityTitle: string;
  summary: string;
  geography: string | null;
  confidence: number;
  rationale: string;
  evidence: string[];
};

export type HunterSignalScoutCompletion = {
  model: {
    provider: "OLLAMA" | "KIMI";
    name: string;
    promptVersion: string;
    structuredOutput: boolean;
  };
  discovery: {
    provider: "MULTI_SOURCE_NEWS";
    lookbackHours: number;
    fetchedAt: string;
    queries: Array<{
      id: string;
      provider: "GDELT_DOC_2" | "GOOGLE_NEWS_RSS";
      resultCount: number;
      error: string | null;
    }>;
  };
  candidates: ScoutCandidate[];
};

export async function prepareHunterSignalScoutRun({
  tenantId,
  force = false,
  now = new Date()
}: {
  tenantId: string;
  force?: boolean;
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

  const localDate = formatLocalDate(now, effective.scheduleTimezone);
  const active = await prisma.automationJobRun.findFirst({
    where: {
      tenantId,
      jobType: HUNTER_SIGNAL_SCOUT_JOB_TYPE,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      startedAt: { gte: new Date(now.getTime() - ACTIVE_RUN_WINDOW_MS) }
    },
    orderBy: { startedAt: "desc" }
  });
  if (active) {
    return {
      state: "already_running" as const,
      runId: active.id,
      message: "A Hunter signal scout run is already active."
    };
  }

  if (!force) {
    const latest = await prisma.automationJobRun.findFirst({
      where: {
        tenantId,
        jobType: HUNTER_SIGNAL_SCOUT_JOB_TYPE
      },
      orderBy: { startedAt: "desc" }
    });
    const latestLocalDate = latest ? formatLocalDate(latest.startedAt, effective.scheduleTimezone) : null;
    if (latest && latestLocalDate === localDate) {
      return {
        state: "already_attempted" as const,
        runId: latest.id,
        status: latest.status,
        message: "Hunter signal scouting has already been attempted for this local date."
      };
    }
  }

  const existingSignals = await prisma.hunterOpportunitySignal.findMany({
    where: {
      tenantId,
      sourceUrl: { not: null },
      observedAt: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) }
    },
    orderBy: { observedAt: "desc" },
    take: 2_000,
    select: { sourceUrl: true }
  });
  const job = await prisma.automationJobRun.create({
    data: {
      tenantId,
      jobType: HUNTER_SIGNAL_SCOUT_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: {
        version: 1,
        localDate,
        force,
        model: HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL,
        promptVersion: HUNTER_SIGNAL_SCOUT_PROMPT_VERSION,
        discoveryProvider: "MULTI_SOURCE_NEWS",
        lensIds: DISCOVERY_LENSES.map((lens) => lens.id)
      }
    }
  });

  return {
    state: "ready" as const,
    runId: job.id,
    packet: {
      version: 1,
      localDate,
      model: {
        recommended: HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL,
        promptVersion: HUNTER_SIGNAL_SCOUT_PROMPT_VERSION,
        temperature: 0,
        structuredOutput: true
      },
      discovery: {
        provider: "MULTI_SOURCE_NEWS",
        gdeltEndpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
        googleNewsEndpoint: "https://news.google.com/rss/search",
        lookbackHours: 36,
        maxArticles: 40,
        maxArticlesByService: {
          [HunterServiceLine.WAREHOUSING]: 24,
          [HunterServiceLine.OCEAN_AIR]: 12,
          [HunterServiceLine.TRUCKING]: 4
        },
        lenses: DISCOVERY_LENSES
      },
      existingSourceUrls: existingSignals
        .map((signal) => signal.sourceUrl)
        .filter((url): url is string => Boolean(url)),
      policy: {
        minimumSignalConfidence: effective.minimumSignalConfidence,
        allocation: {
          warehousing: effective.warehousingPercent,
          oceanAir: effective.oceanAirPercent,
          trucking: effective.truckingPercent
        }
      },
      rules: {
        noApollo: true,
        noOutreach: true,
        noCadenceWrites: true,
        companyMustBeExplicit: true,
        excludeLogisticsProviders: true,
        evidenceOnly: true
      }
    }
  };
}

export async function completeHunterSignalScoutRun({
  tenantId,
  runId,
  completion: rawCompletion
}: {
  tenantId: string;
  runId: string;
  completion: unknown;
}) {
  const completion = parseHunterSignalScoutCompletion(rawCompletion);
  const run = await prisma.automationJobRun.findFirst({
    where: {
      id: runId,
      tenantId,
      jobType: HUNTER_SIGNAL_SCOUT_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    select: { id: true }
  });
  if (!run) throw new Error("Hunter signal scout run is not active for this tenant.");

  const policy = await prisma.hunterAutomationPolicy.findUnique({ where: { tenantId } });
  const minimumConfidence = policy?.minimumSignalConfidence ?? DEFAULT_HUNTER_POLICY.minimumSignalConfidence;
  const relevant = completion.candidates.filter((candidate) => candidate.relevant && candidate.companyName);
  const rejected = completion.candidates.filter((candidate) => !candidate.relevant || !candidate.companyName);
  let activeCount = 0;
  let dismissedCount = 0;
  const savedSignalIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const candidate of relevant) {
      const companyName = candidate.companyName!;
      const normalizedCompanyName = normalizeCompanyName(companyName);
      if (!normalizedCompanyName) continue;
      const company = await tx.company.findUnique({
        where: {
          tenantId_normalizedName: {
            tenantId,
            normalizedName: normalizedCompanyName
          }
        },
        select: { id: true }
      });
      const status =
        candidate.confidence >= minimumConfidence
          ? HunterSignalStatus.NEW
          : HunterSignalStatus.DISMISSED;
      if (status === HunterSignalStatus.NEW) activeCount += 1;
      else dismissedCount += 1;
      const dedupeKey = createHash("sha256")
        .update([normalizedCompanyName, candidate.signalType, canonicalSourceUrl(candidate.sourceUrl)].join("|"))
        .digest("hex");
      const signal = await tx.hunterOpportunitySignal.upsert({
        where: {
          tenantId_dedupeKey: {
            tenantId,
            dedupeKey
          }
        },
        create: {
          tenantId,
          companyId: company?.id,
          companyName,
          normalizedCompanyName,
          signalType: candidate.signalType,
          serviceLine: candidate.serviceLine,
          status,
          title: candidate.opportunityTitle,
          summary: candidate.summary,
          geography: candidate.geography,
          sourceName: candidate.sourceName,
          sourceUrl: candidate.sourceUrl,
          sourcePublishedAt: candidate.sourcePublishedAt
            ? new Date(candidate.sourcePublishedAt)
            : null,
          confidence: candidate.confidence,
          dedupeKey,
          evidence: {
            statements: candidate.evidence,
            classification: {
              provider: completion.model.provider,
              model: completion.model.name,
              promptVersion: completion.model.promptVersion,
              structuredOutput: completion.model.structuredOutput,
              rationale: candidate.rationale,
              classifiedAt: new Date().toISOString()
            },
            discovery: {
              provider: completion.discovery.provider,
              queryId: candidate.queryId,
              articleTitle: candidate.articleTitle
            }
          },
          rawJson: {
            sourceIndex: candidate.sourceIndex,
            articleTitle: candidate.articleTitle
          }
        },
        update: {
          companyId: company?.id,
          companyName,
          serviceLine: candidate.serviceLine,
          status,
          title: candidate.opportunityTitle,
          summary: candidate.summary,
          geography: candidate.geography,
          sourceName: candidate.sourceName,
          sourcePublishedAt: candidate.sourcePublishedAt
            ? new Date(candidate.sourcePublishedAt)
            : null,
          confidence: candidate.confidence,
          observedAt: new Date(),
          evidence: {
            statements: candidate.evidence,
            classification: {
              provider: completion.model.provider,
              model: completion.model.name,
              promptVersion: completion.model.promptVersion,
              structuredOutput: completion.model.structuredOutput,
              rationale: candidate.rationale,
              classifiedAt: new Date().toISOString()
            },
            discovery: {
              provider: completion.discovery.provider,
              queryId: candidate.queryId,
              articleTitle: candidate.articleTitle
            }
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
          phase: "CLASSIFICATION_COMPLETE",
          discovery: completion.discovery,
          model: completion.model,
          candidateCount: completion.candidates.length,
          acceptedCount: activeCount,
          belowThresholdCount: dismissedCount,
          rejectedCount: rejected.length,
          savedSignalIds,
          rejectedSample: rejected.slice(0, 20).map((candidate) => ({
            sourceUrl: candidate.sourceUrl,
            articleTitle: candidate.articleTitle,
            companyName: candidate.companyName,
            confidence: candidate.confidence,
            rationale: candidate.rationale
          })),
          completedAt: new Date().toISOString()
        }
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        action: "lead-gen.hunter-signal-scout.completed",
        entityType: "AutomationJobRun",
        entityId: runId,
        after: {
          candidateCount: completion.candidates.length,
          acceptedCount: activeCount,
          belowThresholdCount: dismissedCount,
          rejectedCount: rejected.length,
          provider: completion.model.provider,
          model: completion.model.name,
          promptVersion: completion.model.promptVersion
        }
      }
    });
  });

  return {
    runId,
    candidateCount: completion.candidates.length,
    acceptedCount: activeCount,
    belowThresholdCount: dismissedCount,
    rejectedCount: rejected.length
  };
}

export async function failHunterSignalScoutRun({
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
      jobType: HUNTER_SIGNAL_SCOUT_JOB_TYPE,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] }
    },
    data: {
      status: JobStatus.ERROR,
      finishedAt: new Date(),
      errorMessage: errorMessage.trim().slice(0, 1_000) || "Hunter signal scout failed."
    }
  });
  if (result.count !== 1) {
    throw new Error("Hunter signal scout run is not active for this tenant.");
  }
  return { runId, state: "failed" as const };
}

export function parseHunterSignalScoutCompletion(value: unknown): HunterSignalScoutCompletion {
  const root = record(value, "completion");
  const model = record(root.model, "completion.model");
  const discovery = record(root.discovery, "completion.discovery");
  const rawCandidates = array(root.candidates, "completion.candidates");
  if (rawCandidates.length > MAX_COMPLETION_CANDIDATES) {
    throw new Error(`completion.candidates cannot exceed ${MAX_COMPLETION_CANDIDATES} items.`);
  }
  const provider = enumValue(model.provider, ["OLLAMA", "KIMI"] as const, "completion.model.provider");
  const discoveryProvider = enumValue(
    discovery.provider,
    ["MULTI_SOURCE_NEWS"] as const,
    "completion.discovery.provider"
  );
  const queryRows = array(discovery.queries, "completion.discovery.queries").map((value, index) => {
    const query = record(value, `completion.discovery.queries[${index}]`);
    return {
      id: text(query.id, 100, `completion.discovery.queries[${index}].id`),
      provider: enumValue(
        query.provider,
        ["GDELT_DOC_2", "GOOGLE_NEWS_RSS"] as const,
        `completion.discovery.queries[${index}].provider`
      ),
      resultCount: integer(query.resultCount, 0, 250, `completion.discovery.queries[${index}].resultCount`),
      error: nullableText(query.error, 500, `completion.discovery.queries[${index}].error`)
    };
  });

  return {
    model: {
      provider,
      name: text(model.name, 200, "completion.model.name"),
      promptVersion: text(model.promptVersion, 100, "completion.model.promptVersion"),
      structuredOutput: boolean(model.structuredOutput, "completion.model.structuredOutput")
    },
    discovery: {
      provider: discoveryProvider,
      lookbackHours: integer(discovery.lookbackHours, 1, 168, "completion.discovery.lookbackHours"),
      fetchedAt: isoDate(discovery.fetchedAt, "completion.discovery.fetchedAt"),
      queries: queryRows
    },
    candidates: rawCandidates.map((value, index) => parseCandidate(value, index))
  };
}

function parseCandidate(value: unknown, index: number): ScoutCandidate {
  const path = `completion.candidates[${index}]`;
  const candidate = record(value, path);
  const relevant = boolean(candidate.relevant, `${path}.relevant`);
  return {
    sourceIndex: integer(candidate.sourceIndex, 0, 10_000, `${path}.sourceIndex`),
    sourceUrl: httpsUrl(candidate.sourceUrl, `${path}.sourceUrl`),
    sourceName: nullableText(candidate.sourceName, 200, `${path}.sourceName`),
    sourcePublishedAt: nullableIsoDate(candidate.sourcePublishedAt, `${path}.sourcePublishedAt`),
    articleTitle: text(candidate.articleTitle, 500, `${path}.articleTitle`),
    queryId: text(candidate.queryId, 100, `${path}.queryId`),
    relevant,
    companyName: relevant
      ? text(candidate.companyName, 200, `${path}.companyName`)
      : nullableText(candidate.companyName, 200, `${path}.companyName`),
    signalType: enumValue(candidate.signalType, Object.values(HunterSignalType), `${path}.signalType`),
    serviceLine: enumValue(candidate.serviceLine, Object.values(HunterServiceLine), `${path}.serviceLine`),
    opportunityTitle: text(candidate.opportunityTitle, 300, `${path}.opportunityTitle`),
    summary: text(candidate.summary, 2_000, `${path}.summary`),
    geography: nullableText(candidate.geography, 200, `${path}.geography`),
    confidence: integer(candidate.confidence, 0, 100, `${path}.confidence`),
    rationale: text(candidate.rationale, 1_000, `${path}.rationale`),
    evidence: array(candidate.evidence, `${path}.evidence`).map((item, evidenceIndex) =>
      text(item, 500, `${path}.evidence[${evidenceIndex}]`)
    ).slice(0, 10)
  };
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

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${path} must be one of: ${values.join(", ")}.`);
  }
  return value as T;
}

function httpsUrl(value: unknown, path: string) {
  const raw = text(value, 2_000, path);
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`${path} must use HTTPS.`);
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

export const HUNTER_SIGNAL_SCOUT_SAFETY = {
  externalWrites: false,
  apollo: false,
  outreach: false,
  cadenceWrites: false
} satisfies Prisma.InputJsonObject;
