import crypto from "node:crypto";

import {
  JobStatus,
  WebsiteGrowthBacklinkCategory,
  type Prisma
} from "@prisma/client";

import { prisma } from "@/server/db";

export const WEBSITE_GROWTH_SCOUT_JOB_TYPE = "WEBSITE_GROWTH_SCOUT_WEEKLY";
export const BACKLINK_DISCOVERY_QUERY_LIMIT = 12;
export const BACKLINK_DISCOVERY_RESULTS_PER_QUERY = 10;
export const BACKLINK_DISCOVERY_RESULT_LIMIT =
  BACKLINK_DISCOVERY_QUERY_LIMIT * BACKLINK_DISCOVERY_RESULTS_PER_QUERY;
export const BACKLINK_DISCOVERY_DOMAIN_LIMIT = 60;
export const BACKLINK_DISCOVERY_FETCH_LIMIT = 40;
export const BACKLINK_DISCOVERY_PAGES_PER_DOMAIN = 2;
export const BACKLINK_DISCOVERY_FINALIST_LIMIT = 15;
export const BACKLINK_DISCOVERY_PROMOTION_LIMIT = 5;

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ref",
  "source"
]);

type DiscoveryQuery = {
  lane: string;
  query: string;
};

type DiscoverySearchResult = {
  queryLane: string;
  queryText: string;
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string | null;
};

export type WebsiteGrowthBacklinkDiscoveryCandidate = {
  id: string;
  canonicalUrl: string;
  sourceDomain: string;
  queryLane: string;
  queryText: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
};

export type WebsiteGrowthBacklinkDiscoveryDecision = {
  id: string;
  disposition: "REJECT" | "FETCH_FAILED" | "FETCHED" | "FINALIST";
  category: WebsiteGrowthBacklinkCategory | null;
  confidence: number;
  reason: string;
  pageSummary: string | null;
  fetchError: string | null;
};

export function buildWebsiteGrowthBacklinkDiscoveryQueries(
  date = new Date()
): { rotation: number; queries: DiscoveryQuery[] } {
  const week = getIsoWeek(date);
  const rotations: DiscoveryQuery[][] = [
    [
      ["DIRECTORY", "\"3PL directory\" \"add company\" Canada"],
      ["DIRECTORY", "\"fulfillment provider directory\" \"submit listing\""],
      ["DIRECTORY", "\"warehouse directory\" \"company profile\" Ontario"],
      ["DIRECTORY", "\"logistics directory\" \"add listing\" United States"],
      ["EDITORIAL", "\"supply chain\" \"write for us\""],
      ["EDITORIAL", "\"fulfillment\" \"editorial guidelines\""],
      ["EDITORIAL", "\"3PL\" \"expert contributor\""],
      ["EDITORIAL", "\"logistics\" \"submit an article\""],
      ["RESOURCE", "\"ecommerce fulfillment\" \"resource page\""],
      ["RESOURCE", "\"kitting services\" directory"],
      ["MEDIA", "\"logistics podcast\" \"guest application\""],
      ["ASSOCIATION", "\"warehousing association\" membership Canada"]
    ],
    [
      ["DIRECTORY", "\"B2B fulfillment\" directory Canada"],
      ["DIRECTORY", "\"ecommerce fulfillment companies\" directory USA"],
      ["DIRECTORY", "\"3PL companies\" \"claim profile\""],
      ["DIRECTORY", "\"warehouse services\" \"submit company\""],
      ["EDITORIAL", "\"warehouse management\" contributor guidelines"],
      ["EDITORIAL", "\"retail logistics\" \"write for us\""],
      ["EDITORIAL", "\"supply chain publication\" expert commentary"],
      ["EDITORIAL", "\"ecommerce operations\" guest article"],
      ["RESOURCE", "\"fulfillment resources\" logistics"],
      ["RESOURCE", "\"pick and pack\" resources"],
      ["MEDIA", "\"supply chain podcast\" guest"],
      ["ASSOCIATION", "\"logistics association\" member directory Ontario"]
    ],
    [
      ["DIRECTORY", "\"contract warehousing\" business directory"],
      ["DIRECTORY", "\"kitting and assembly\" directory"],
      ["DIRECTORY", "\"marketplace fulfillment\" provider listing"],
      ["DIRECTORY", "\"Charlotte 3PL\" directory"],
      ["EDITORIAL", "\"logistics magazine\" contributor"],
      ["EDITORIAL", "\"warehouse automation\" expert source"],
      ["EDITORIAL", "\"retail compliance\" guest post"],
      ["EDITORIAL", "\"freight logistics\" editorial contact"],
      ["RESOURCE", "\"3PL resources\" fulfillment"],
      ["RESOURCE", "\"warehouse selection\" useful links"],
      ["MEDIA", "\"ecommerce logistics podcast\" guest"],
      ["ASSOCIATION", "\"fulfillment association\" membership"]
    ],
    [
      ["DIRECTORY", "\"North American 3PL\" directory"],
      ["DIRECTORY", "\"Canadian logistics companies\" submit listing"],
      ["DIRECTORY", "\"Mississauga warehouse\" business directory"],
      ["DIRECTORY", "\"fulfillment services\" \"claim this business\""],
      ["EDITORIAL", "\"distribution center\" \"write for us\""],
      ["EDITORIAL", "\"operations publication\" contributor logistics"],
      ["EDITORIAL", "\"ecommerce fulfillment\" journalist source"],
      ["EDITORIAL", "\"supply chain trends\" expert interview"],
      ["RESOURCE", "\"logistics vendor resources\""],
      ["RESOURCE", "\"retail fulfillment\" resources"],
      ["MEDIA", "\"warehousing podcast\" guest"],
      ["ASSOCIATION", "\"international logistics association\" directory"]
    ]
  ].map((rotation) =>
    rotation.map(([lane, query]) => ({ lane, query }))
  );
  const rotation = (week - 1) % rotations.length;
  return { rotation, queries: rotations[rotation] };
}

export function canonicalizeWebsiteGrowthDiscoveryUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    parsed.pathname = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildWebsiteGrowthDiscoveryUrlHash(canonicalUrl: string) {
  return crypto.createHash("sha256").update(canonicalUrl).digest("hex");
}

export function selectNewWebsiteGrowthDiscoveryCandidates({
  results,
  historicalHashes
}: {
  results: DiscoverySearchResult[];
  historicalHashes: Set<string>;
}) {
  if (results.length > BACKLINK_DISCOVERY_RESULT_LIMIT) {
    throw new Error(
      `Backlink discovery accepts at most ${BACKLINK_DISCOVERY_RESULT_LIMIT} search results per run.`
    );
  }

  const seenThisRun = new Set<string>();
  const domains = new Set<string>();
  const ledger: WebsiteGrowthBacklinkDiscoveryCandidate[] = [];
  const candidates: WebsiteGrowthBacklinkDiscoveryCandidate[] = [];
  let duplicatesSkipped = 0;
  let invalidSkipped = 0;
  let domainLimitSkipped = 0;

  for (const result of results) {
    const canonicalUrl = canonicalizeWebsiteGrowthDiscoveryUrl(result.url);
    if (!canonicalUrl) {
      invalidSkipped += 1;
      continue;
    }
    const id = buildWebsiteGrowthDiscoveryUrlHash(canonicalUrl);
    if (seenThisRun.has(id)) {
      duplicatesSkipped += 1;
      continue;
    }
    seenThisRun.add(id);
    const sourceDomain = new URL(canonicalUrl).hostname;
    const row = {
      id,
      canonicalUrl,
      sourceDomain,
      queryLane: readBoundedString(result.queryLane, 80),
      queryText: readBoundedString(result.queryText, 500),
      title: readBoundedString(result.title, 500),
      snippet: readBoundedString(result.snippet, 1200),
      publishedAt: normalizeOptionalTimestamp(result.publishedAt)
    };
    ledger.push(row);
    if (historicalHashes.has(id)) {
      duplicatesSkipped += 1;
      continue;
    }
    if (!domains.has(sourceDomain) && domains.size >= BACKLINK_DISCOVERY_DOMAIN_LIMIT) {
      domainLimitSkipped += 1;
      continue;
    }
    domains.add(sourceDomain);
    candidates.push(row);
  }

  return {
    ledger,
    candidates,
    rawResultCount: results.length,
    duplicatesSkipped,
    invalidSkipped,
    domainLimitSkipped,
    uniqueDomainCount: domains.size
  };
}

export async function ingestWebsiteGrowthBacklinkDiscoveryResults({
  tenantId,
  runId,
  queries,
  results
}: {
  tenantId: string;
  runId: string;
  queries: unknown;
  results: unknown;
}) {
  const parsedQueries = parseQueries(queries);
  const parsedResults = parseResults(results, parsedQueries);
  const job = await requireActiveScoutRun(tenantId, runId);
  const historicalRuns = await prisma.automationJobRun.findMany({
    where: {
      tenantId,
      jobType: WEBSITE_GROWTH_SCOUT_JOB_TYPE,
      id: { not: runId }
    },
    select: { output: true }
  });
  const historicalHashes = new Set<string>();
  for (const historical of historicalRuns) {
    const discovery = readRecord(readRecord(historical.output).backlinkDiscovery);
    for (const value of readStringArray(discovery.seenUrlHashes)) historicalHashes.add(value);
  }
  const existingBacklinks = await prisma.websiteGrowthBacklinkOpportunity.findMany({
    where: { tenantId, sourceUrl: { not: null } },
    select: { sourceUrl: true }
  });
  for (const backlink of existingBacklinks) {
    const canonical = backlink.sourceUrl
      ? canonicalizeWebsiteGrowthDiscoveryUrl(backlink.sourceUrl)
      : null;
    if (canonical) historicalHashes.add(buildWebsiteGrowthDiscoveryUrlHash(canonical));
  }

  const selection = selectNewWebsiteGrowthDiscoveryCandidates({
    results: parsedResults,
    historicalHashes
  });
  const currentOutput = readRecord(job.output);
  await prisma.automationJobRun.updateMany({
    where: {
      id: runId,
      tenantId,
      jobType: WEBSITE_GROWTH_SCOUT_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    data: {
      output: {
        ...currentOutput,
        backlinkDiscovery: {
          phase: "AWAITING_QWEN",
          queries: parsedQueries,
          queryCount: parsedQueries.length,
          rawResultCount: selection.rawResultCount,
          newCandidateCount: selection.candidates.length,
          duplicateCount: selection.duplicatesSkipped,
          invalidCount: selection.invalidSkipped,
          domainLimitSkipped: selection.domainLimitSkipped,
          uniqueDomainCount: selection.uniqueDomainCount,
          seenUrlHashes: selection.ledger.map((row) => row.id),
          ledger: selection.ledger,
          ingestedAt: new Date().toISOString()
        } as Prisma.InputJsonValue
      }
    }
  });

  return {
    candidates: selection.candidates,
    limits: {
      fetches: BACKLINK_DISCOVERY_FETCH_LIMIT,
      pagesPerDomain: BACKLINK_DISCOVERY_PAGES_PER_DOMAIN,
      finalists: BACKLINK_DISCOVERY_FINALIST_LIMIT,
      promotions: BACKLINK_DISCOVERY_PROMOTION_LIMIT
    },
    counts: {
      searched: selection.rawResultCount,
      new: selection.candidates.length,
      duplicatesSkipped: selection.duplicatesSkipped,
      invalidSkipped: selection.invalidSkipped,
      domainLimitSkipped: selection.domainLimitSkipped
    }
  };
}

export async function completeWebsiteGrowthBacklinkDiscovery({
  tenantId,
  runId,
  decisions
}: {
  tenantId: string;
  runId: string;
  decisions: unknown;
}) {
  const job = await requireActiveScoutRun(tenantId, runId);
  const discovery = readRecord(readRecord(job.output).backlinkDiscovery);
  const ledger = Array.isArray(discovery.ledger) ? discovery.ledger : [];
  const allowed = new Set(
    ledger.map((item) => readRecord(item).id).filter((value): value is string => typeof value === "string")
  );
  const parsed = parseDecisions(decisions, allowed);
  const finalists = parsed
    .filter((item) => item.disposition === "FINALIST")
    .slice(0, BACKLINK_DISCOVERY_FINALIST_LIMIT)
    .map((decision) => {
      const source = readRecord(
        ledger.find((item) => readRecord(item).id === decision.id)
      );
      return {
        ...source,
        category: decision.category,
        confidence: decision.confidence,
        triageReason: decision.reason,
        pageSummary: decision.pageSummary
      };
    });
  const currentOutput = readRecord(job.output);
  await prisma.automationJobRun.updateMany({
    where: {
      id: runId,
      tenantId,
      jobType: WEBSITE_GROWTH_SCOUT_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    data: {
      output: {
        ...currentOutput,
        backlinkDiscovery: {
          ...discovery,
          phase: "AWAITING_CODEX",
          ledger: ledger.map((item) => {
            const record = readRecord(item);
            return {
              id: readOptionalBoundedString(record.id, 64),
              canonicalUrl: readOptionalBoundedString(record.canonicalUrl, 2000),
              sourceDomain: readOptionalBoundedString(record.sourceDomain, 300)
            };
          }),
          fetchedCount: parsed.filter((item) =>
            item.disposition === "FETCHED" || item.disposition === "FINALIST"
          ).length,
          rejectedCount: parsed.filter((item) => item.disposition === "REJECT").length,
          fetchFailedCount: parsed.filter((item) => item.disposition === "FETCH_FAILED").length,
          finalistCount: finalists.length,
          finalists,
          completedAt: new Date().toISOString()
        } as Prisma.InputJsonValue
      }
    }
  });
  return {
    finalists,
    summary: {
      rawResults: readOptionalInteger(discovery.rawResultCount) ?? 0,
      newCandidates: readOptionalInteger(discovery.newCandidateCount) ?? 0,
      duplicatesSkipped: readOptionalInteger(discovery.duplicateCount) ?? 0,
      fetched: parsed.filter((item) =>
        item.disposition === "FETCHED" || item.disposition === "FINALIST"
      ).length,
      finalists: finalists.length,
      qwenRejected: Math.max(
        0,
        (readOptionalInteger(discovery.newCandidateCount) ?? 0) - finalists.length
      )
    }
  };
}

function parseQueries(value: unknown) {
  if (!Array.isArray(value) || value.length > BACKLINK_DISCOVERY_QUERY_LIMIT) {
    throw new Error(`Backlink discovery requires at most ${BACKLINK_DISCOVERY_QUERY_LIMIT} queries.`);
  }
  return value.map((item) => {
    const record = readRecord(item);
    return {
      lane: readBoundedString(record.lane, 80),
      query: readBoundedString(record.query, 500)
    };
  });
}

function parseResults(value: unknown, queries: DiscoveryQuery[]) {
  if (!Array.isArray(value) || value.length > BACKLINK_DISCOVERY_RESULT_LIMIT) {
    throw new Error(
      `Backlink discovery accepts at most ${BACKLINK_DISCOVERY_RESULT_LIMIT} results.`
    );
  }
  const allowedQueries = new Set(queries.map((item) => `${item.lane}|${item.query}`));
  return value.map((item) => {
    const record = readRecord(item);
    const result = {
      queryLane: readBoundedString(record.queryLane, 80),
      queryText: readBoundedString(record.queryText, 500),
      url: readBoundedString(record.url, 2000),
      title: readBoundedString(record.title, 500),
      snippet: readBoundedString(record.snippet, 2000),
      publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : null
    };
    if (!allowedQueries.has(`${result.queryLane}|${result.queryText}`)) {
      throw new Error("Backlink discovery returned a result outside the prepared query scope.");
    }
    return result;
  });
}

function parseDecisions(value: unknown, allowed: Set<string>): WebsiteGrowthBacklinkDiscoveryDecision[] {
  if (!Array.isArray(value) || value.length > BACKLINK_DISCOVERY_RESULT_LIMIT) {
    throw new Error("Backlink discovery returned too many Qwen decisions.");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    const record = readRecord(item);
    const id = readBoundedString(record.id, 64);
    if (!allowed.has(id) || seen.has(id)) {
      throw new Error("Backlink discovery returned an unknown or duplicate URL decision.");
    }
    seen.add(id);
    const disposition = readBoundedString(record.disposition, 20);
    if (!["REJECT", "FETCH_FAILED", "FETCHED", "FINALIST"].includes(disposition)) {
      throw new Error("Backlink discovery returned an invalid disposition.");
    }
    const category = record.category === null
      ? null
      : parseCategory(record.category);
    return {
      id,
      disposition: disposition as WebsiteGrowthBacklinkDiscoveryDecision["disposition"],
      category,
      confidence: readScore(record.confidence),
      reason: readBoundedString(record.reason, 1000),
      pageSummary: readOptionalBoundedString(record.pageSummary, 3000),
      fetchError: readOptionalBoundedString(record.fetchError, 1000)
    };
  });
}

async function requireActiveScoutRun(tenantId: string, runId: string) {
  const job = await prisma.automationJobRun.findFirst({
    where: {
      id: runId,
      tenantId,
      jobType: WEBSITE_GROWTH_SCOUT_JOB_TYPE,
      status: JobStatus.RUNNING
    }
  });
  if (!job) throw new Error("The Website Growth Scout run is not active for this tenant.");
  return job;
}

function parseCategory(value: unknown) {
  const category = readBoundedString(value, 40);
  if (!Object.values(WebsiteGrowthBacklinkCategory).includes(
    category as WebsiteGrowthBacklinkCategory
  )) {
    throw new Error("Backlink discovery returned an invalid category.");
  }
  return category as WebsiteGrowthBacklinkCategory;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readBoundedString(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Backlink discovery is missing required text.");
  return value.trim().slice(0, maximum);
}

function readOptionalBoundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum)
    : null;
}

function readOptionalInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function readScore(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Backlink discovery confidence must be an integer from 0 to 100.");
  }
  return value;
}

function normalizeOptionalTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function getIsoWeek(date: Date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
