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
import {
  normalizeHunterCompanyIdentity,
  normalizeHunterCompanyKey
} from "@/modules/lead-gen/hunter-company-key";
import { prisma } from "@/server/db";

export const HUNTER_SIGNAL_SCOUT_JOB_TYPE = "HUNTER_EXTERNAL_SIGNAL_SCOUT";
export const HUNTER_SIGNAL_SCOUT_PROMPT_VERSION = "hunter-signal-classifier-v2";
export const HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL = "qwen3:30b-instruct";
const ACTIVE_RUN_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_COMPLETION_CANDIDATES = 100;
const SOURCE_URL_DEDUPE_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

type DiscoveryLens = {
  id: string;
  serviceLine: HunterServiceLine;
  query: string;
  topic: string;
  geography: string;
};

const WAREHOUSING_DISCOVERY_TOPICS = [
  {
    id: "distribution-facility",
    query:
      '("distribution center" OR "fulfillment center" OR warehouse) (opens OR opening OR expansion OR expanding OR lease OR construction)'
  },
  {
    id: "retail-rollout",
    query:
      '("store openings" OR "new stores" OR "retail expansion" OR "market entry") (retailer OR brand)'
  },
  {
    id: "manufacturing-capacity",
    query:
      '("new plant" OR "new factory" OR "manufacturing expansion" OR "production line" OR "production expansion")'
  },
  {
    id: "industrial-lease-construction",
    query:
      '("industrial lease" OR "warehouse lease" OR "facility construction" OR "building permit") (manufacturer OR retailer OR distributor OR brand)'
  },
  {
    id: "ecommerce-fulfillment-growth",
    query:
      '("ecommerce growth" OR "online sales growth" OR "fulfillment expansion" OR "direct-to-consumer expansion") (retailer OR brand OR manufacturer)'
  },
  {
    id: "reshoring-relocation",
    query:
      '("reshoring" OR "facility relocation" OR "moves production" OR "North American manufacturing") (company OR manufacturer OR brand)'
  },
  {
    id: "food-consumer-expansion",
    query:
      '("food production expansion" OR "beverage plant expansion" OR "consumer products expansion" OR "new product launch") (plant OR warehouse OR distribution)'
  },
  {
    id: "warehouse-leadership-hiring",
    query:
      '("warehouse director" OR "distribution director" OR "head of fulfillment" OR "vice president supply chain") (hiring OR appointed OR joins)'
  }
] as const;

const OCEAN_AIR_DISCOVERY_TOPICS = [
  {
    id: "north-america-market-entry",
    query:
      '("US market entry" OR "enters the US" OR "North American expansion" OR "launches in Canada") (manufacturer OR retailer OR distributor OR brand)'
  },
  {
    id: "foreign-brand-launch",
    query:
      '("launches in the United States" OR "expands to the United States" OR "first US location" OR "US distribution") (brand OR manufacturer OR retailer)'
  },
  {
    id: "global-sourcing-expansion",
    query:
      '("new supplier" OR "production expansion" OR "manufacturing partnership" OR "sourcing expansion") (imports OR export OR overseas OR international)'
  },
  {
    id: "import-distribution-partnership",
    query:
      '("distribution agreement" OR "North American distributor" OR "US distributor" OR "Canadian distributor") (international OR global OR overseas)'
  },
  {
    id: "supply-chain-leadership",
    query:
      '("chief supply chain officer" OR "vice president supply chain" OR "head of logistics" OR "head of imports") (appointed OR joins OR named)'
  }
] as const;

const TRUCKING_DISCOVERY_TOPICS = [
  {
    id: "regional-distribution",
    query:
      '("regional distribution" OR "last mile network" OR "distribution network") (expands OR expansion OR opens OR launch)'
  },
  {
    id: "plant-output-growth",
    query:
      '("production increase" OR "plant expansion" OR "capacity increase") ("regional delivery" OR distribution OR shipments)'
  },
  {
    id: "store-delivery-network",
    query:
      '("store rollout" OR "new locations" OR "retail expansion") ("delivery network" OR replenishment OR distribution)'
  },
  {
    id: "port-regional-volume",
    query:
      '("port volume" OR "import volume" OR "container volume") (manufacturer OR retailer OR distributor) (increase OR growth OR expansion)'
  }
] as const;

const DISCOVERY_GEOGRAPHIES = [
  {
    id: "carolinas-georgia",
    query:
      '(Charlotte OR "North Carolina" OR "South Carolina" OR Georgia OR Savannah OR Charleston)'
  },
  {
    id: "southeast",
    query:
      '(Florida OR Tennessee OR Alabama OR Virginia OR "Southeast US" OR "Southeastern United States")'
  },
  {
    id: "ontario-canada",
    query:
      '(Ontario OR Toronto OR Mississauga OR Brampton OR Hamilton OR Canada)'
  },
  {
    id: "north-america",
    query:
      '("United States" OR USA OR Canada OR "North America")'
  }
] as const;

export function selectHunterSignalDiscoveryLenses(localDate: string): DiscoveryLens[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error("Hunter signal discovery requires a valid YYYY-MM-DD local date.");
  }
  const dayNumber = Math.floor(Date.parse(`${localDate}T00:00:00.000Z`) / 86_400_000);
  if (!Number.isFinite(dayNumber)) {
    throw new Error("Hunter signal discovery requires a valid YYYY-MM-DD local date.");
  }
  const geography = DISCOVERY_GEOGRAPHIES[positiveModulo(dayNumber, DISCOVERY_GEOGRAPHIES.length)]!;
  return [
    ...selectRotatingTopics(
      WAREHOUSING_DISCOVERY_TOPICS,
      dayNumber,
      4,
      HunterServiceLine.WAREHOUSING,
      geography
    ),
    ...selectRotatingTopics(
      OCEAN_AIR_DISCOVERY_TOPICS,
      dayNumber * 2,
      2,
      HunterServiceLine.OCEAN_AIR,
      geography
    ),
    ...selectRotatingTopics(
      TRUCKING_DISCOVERY_TOPICS,
      dayNumber,
      1,
      HunterServiceLine.TRUCKING,
      geography
    )
  ];
}

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
    provider: "BRAVE_WEB";
    lookbackHours: number;
    fetchedAt: string;
    rawResultCount: number;
    duplicateUrlCount: number;
    selectedArticleCount: number;
    queries: Array<{
      id: string;
      provider: "BRAVE_WEB" | "GOOGLE_NEWS_RSS";
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
  const discoveryLenses = selectHunterSignalDiscoveryLenses(localDate);
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
      observedAt: { gte: new Date(now.getTime() - SOURCE_URL_DEDUPE_WINDOW_MS) }
    },
    orderBy: { observedAt: "desc" },
    take: 2_000,
    select: { sourceUrl: true, evidence: true }
  });
  const existingSourceUrls = [
    ...existingSignals.flatMap((signal) => extractSignalSourceUrls(signal.evidence)),
    ...existingSignals
      .map((signal) => signal.sourceUrl)
      .filter((url): url is string => Boolean(url))
  ];
  const job = await prisma.automationJobRun.create({
    data: {
      tenantId,
      jobType: HUNTER_SIGNAL_SCOUT_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: {
        version: 2,
        localDate,
        force,
        model: HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL,
        promptVersion: HUNTER_SIGNAL_SCOUT_PROMPT_VERSION,
        discoveryProvider: "BRAVE_WEB",
        rotationKey: localDate,
        lensIds: discoveryLenses.map((lens) => lens.id),
        queryFingerprints: discoveryLenses.map((lens) => hashText(lens.query))
      }
    }
  });

  return {
    state: "ready" as const,
    runId: job.id,
    packet: {
      version: 2,
      localDate,
      model: {
        recommended: HUNTER_SIGNAL_SCOUT_DEFAULT_MODEL,
        promptVersion: HUNTER_SIGNAL_SCOUT_PROMPT_VERSION,
        temperature: 0,
        structuredOutput: true
      },
      discovery: {
        provider: "BRAVE_WEB",
        braveEndpoint: "https://api.search.brave.com/res/v1/web/search",
        googleNewsEndpoint: "https://news.google.com/rss/search",
        freshness: "pm",
        lookbackHours: 744,
        maxArticles: 40,
        maxArticlesByService: {
          [HunterServiceLine.WAREHOUSING]: 24,
          [HunterServiceLine.OCEAN_AIR]: 12,
          [HunterServiceLine.TRUCKING]: 4
        },
        lenses: discoveryLenses
      },
      existingSourceUrls: [...new Set(existingSourceUrls)],
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
        evidenceOnly: true,
        tradeMiningRequired: false,
        requireFullResearchBeforeApollo: true
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
  let promotedCompanyCount = 0;
  let existingCompanyCount = 0;
  let duplicateEventCount = 0;
  const savedSignalIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const candidate of relevant) {
      const companyName = candidate.companyName!;
      const normalizedCompanyName = normalizeHunterCompanyKey(companyName);
      if (!normalizedCompanyName) continue;
      const normalizedCompanyIdentity = normalizeHunterCompanyIdentity(companyName);
      const companyMatches = await tx.company.findMany({
        where: {
          tenantId,
          OR: [
            {
              normalizedName: {
                in: [...new Set([normalizedCompanyName, normalizedCompanyIdentity])]
              }
            },
            ...(normalizedCompanyIdentity
              ? [
                  {
                    normalizedName: {
                      startsWith: `${normalizedCompanyIdentity}-`
                    }
                  }
                ]
              : [])
          ]
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { id: true, name: true, normalizedName: true }
      });
      const company =
        companyMatches.find((row) => row.normalizedName === normalizedCompanyName) ??
        companyMatches.find(
          (row) =>
            normalizeHunterCompanyIdentity(row.name) === normalizedCompanyIdentity
        ) ??
        null;
      let companyId = company?.id ?? null;
      const status =
        candidate.confidence >= minimumConfidence
          ? HunterSignalStatus.NEW
          : HunterSignalStatus.DISMISSED;
      if (status === HunterSignalStatus.NEW) activeCount += 1;
      else dismissedCount += 1;
      if (company) {
        existingCompanyCount += 1;
      } else if (status === HunterSignalStatus.NEW) {
        const createdCompany = await tx.company.create({
          data: {
            tenantId,
            name: companyName,
            normalizedName: normalizedCompanyName,
            source: "HUNTER_EXTERNAL_SIGNAL_SCOUT",
            priorityScore: candidate.confidence,
            candidateStatus: "NEW"
          },
          select: { id: true }
        });
        companyId = createdCompany.id;
        promotedCompanyCount += 1;
      }
      const dedupeKey = createHunterSignalEventDedupeKey({
        companyName,
        signalType: candidate.signalType,
        geography: candidate.geography,
        sourcePublishedAt: candidate.sourcePublishedAt,
        fetchedAt: completion.discovery.fetchedAt
      });
      const existingSignal = await tx.hunterOpportunitySignal.findUnique({
        where: {
          tenantId_dedupeKey: {
            tenantId,
            dedupeKey
          }
        },
        select: {
          sourceUrl: true,
          evidence: true
        }
      });
      if (existingSignal) duplicateEventCount += 1;
      const sources = mergeSignalSources(existingSignal?.evidence, candidate);
      const signal = await tx.hunterOpportunitySignal.upsert({
        where: {
          tenantId_dedupeKey: {
            tenantId,
            dedupeKey
          }
        },
        create: {
          tenantId,
          companyId,
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
            },
            sources
          },
          rawJson: {
            sourceIndex: candidate.sourceIndex,
            articleTitle: candidate.articleTitle
          }
        },
        update: {
          companyId,
          companyName,
          serviceLine: candidate.serviceLine,
          status,
          title: candidate.opportunityTitle,
          summary: candidate.summary,
          geography: candidate.geography,
          sourceName: candidate.sourceName,
          sourceUrl: existingSignal?.sourceUrl ?? candidate.sourceUrl,
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
            },
            sources
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
          promotedCompanyCount,
          existingCompanyCount,
          duplicateEventCount,
          rawResultCount: completion.discovery.rawResultCount,
          duplicateUrlCount: completion.discovery.duplicateUrlCount,
          selectedArticleCount: completion.discovery.selectedArticleCount,
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
          promotedCompanyCount,
          existingCompanyCount,
          duplicateEventCount,
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
    rejectedCount: rejected.length,
    promotedCompanyCount,
    existingCompanyCount,
    duplicateEventCount,
    rawResultCount: completion.discovery.rawResultCount,
    duplicateUrlCount: completion.discovery.duplicateUrlCount,
    selectedArticleCount: completion.discovery.selectedArticleCount
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
    ["BRAVE_WEB"] as const,
    "completion.discovery.provider"
  );
  const queryRows = array(discovery.queries, "completion.discovery.queries").map((value, index) => {
    const query = record(value, `completion.discovery.queries[${index}]`);
    return {
      id: text(query.id, 100, `completion.discovery.queries[${index}].id`),
      provider: enumValue(
        query.provider,
        ["BRAVE_WEB", "GOOGLE_NEWS_RSS"] as const,
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
      lookbackHours: integer(discovery.lookbackHours, 1, 744, "completion.discovery.lookbackHours"),
      fetchedAt: isoDate(discovery.fetchedAt, "completion.discovery.fetchedAt"),
      rawResultCount: integer(discovery.rawResultCount, 0, 10_000, "completion.discovery.rawResultCount"),
      duplicateUrlCount: integer(
        discovery.duplicateUrlCount,
        0,
        10_000,
        "completion.discovery.duplicateUrlCount"
      ),
      selectedArticleCount: integer(
        discovery.selectedArticleCount,
        0,
        MAX_COMPLETION_CANDIDATES,
        "completion.discovery.selectedArticleCount"
      ),
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

function selectRotatingTopics<
  T extends ReadonlyArray<{ id: string; query: string }>
>(
  topics: T,
  offset: number,
  count: number,
  serviceLine: HunterServiceLine,
  geography: { id: string; query: string }
): DiscoveryLens[] {
  return Array.from({ length: Math.min(count, topics.length) }, (_, index) => {
    const topic = topics[positiveModulo(offset + index, topics.length)]!;
    return {
      id: `${topic.id}-${geography.id}`,
      serviceLine,
      query: `${topic.query} ${geography.query} -3PL -carrier -freight-forwarder`,
      topic: topic.id,
      geography: geography.id
    };
  });
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createHunterSignalEventDedupeKey({
  companyName,
  signalType,
  geography,
  sourcePublishedAt,
  fetchedAt
}: {
  companyName: string;
  signalType: HunterSignalType;
  geography: string | null;
  sourcePublishedAt: string | null;
  fetchedAt: string;
}) {
  const normalizedCompanyName = normalizeHunterCompanyKey(companyName);
  const normalizedGeography = (geography ?? "unspecified")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || "unspecified";
  const periodSource = new Date(sourcePublishedAt ?? fetchedAt);
  if (!normalizedCompanyName || Number.isNaN(periodSource.getTime())) {
    throw new Error("Hunter signal event fingerprint requires a company and valid discovery date.");
  }
  const eventMonth = periodSource.toISOString().slice(0, 7);
  return hashText(
    [normalizedCompanyName, signalType, normalizedGeography, eventMonth].join("|")
  );
}

function extractSignalSourceUrls(value: Prisma.JsonValue | null): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const sources = (value as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return [];
    const url = (source as Record<string, unknown>).url;
    return typeof url === "string" && url.startsWith("https://") ? [url] : [];
  });
}

function mergeSignalSources(
  existingEvidence: Prisma.JsonValue | null | undefined,
  candidate: ScoutCandidate
): Prisma.InputJsonObject[] {
  const existingSources =
    existingEvidence && typeof existingEvidence === "object" && !Array.isArray(existingEvidence)
      ? (existingEvidence as Record<string, unknown>).sources
      : null;
  const rows = Array.isArray(existingSources)
    ? existingSources.filter(
        (source): source is Record<string, unknown> =>
          Boolean(source) && typeof source === "object" && !Array.isArray(source)
      )
    : [];
  const byUrl = new Map<string, Prisma.InputJsonObject>();
  for (const source of rows) {
    const url = typeof source.url === "string" ? source.url : null;
    if (!url?.startsWith("https://")) continue;
    byUrl.set(canonicalSourceUrl(url), {
      url,
      sourceName: jsonNullableText(source.sourceName),
      publishedAt: jsonNullableText(source.publishedAt),
      articleTitle: jsonNullableText(source.articleTitle),
      queryId: jsonNullableText(source.queryId)
    });
  }
  byUrl.set(canonicalSourceUrl(candidate.sourceUrl), {
    url: candidate.sourceUrl,
    sourceName: candidate.sourceName,
    publishedAt: candidate.sourcePublishedAt,
    articleTitle: candidate.articleTitle,
    queryId: candidate.queryId
  });
  return [...byUrl.values()].slice(-8);
}

function jsonNullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
