import { WebsiteGrowthAction } from "@prisma/client";

import type { CsvRow } from "@/modules/website-growth/csv";
import { readNumber, readString } from "@/modules/website-growth/csv";
import {
  buildLegacyRebuildEvidence,
  buildLegacyRebuildReason,
  buildLegacyRebuildRecommendation,
  getOpportunityReviewKey,
  resolveLegacyPageRebuild,
  toNewlUrl
} from "@/modules/website-growth/legacy-rebuilds";

export type OpportunityInput = {
  topic: string;
  primaryKeyword?: string | null;
  targetPage?: string | null;
  sourcePage?: string | null;
  impressions?: number | null;
  clicks?: number | null;
  position?: number | null;
  leadCount?: number | null;
  source?: string;
  evidence?: Record<string, unknown>;
};

export type OpportunityCandidate = {
  action: WebsiteGrowthAction;
  topic: string;
  primaryKeyword: string | null;
  targetPage: string | null;
  sourcePage: string | null;
  score: number;
  confidence: string;
  reason: string;
  recommendation: string;
  supportingKeywords: string[];
  evidence: Record<string, unknown>;
};

export type OpportunityQualificationResult = {
  qualified: OpportunityCandidate[];
  rawCount: number;
  clusterCount: number;
  skippedCount: number;
};

export type WeeklyContentLane = "CORE_PAGE" | "SUPPORTING_CONTENT" | "QUICK_OPTIMIZATION";

export type WeeklyContentRecommendation = {
  lane: WeeklyContentLane;
  label: string;
  description: string;
  publishLimit: number;
  actions: WebsiteGrowthAction[];
};

export const weeklyContentRecommendations: WeeklyContentRecommendation[] = [
  {
    lane: "CORE_PAGE",
    label: "Core service or location page",
    description: "Major commercial pages or meaningful updates to existing money pages.",
    publishLimit: 2,
    actions: [WebsiteGrowthAction.CREATE_PAGE, WebsiteGrowthAction.IMPROVE_EXISTING_PAGE]
  },
  {
    lane: "SUPPORTING_CONTENT",
    label: "Blog, glossary, or support content",
    description: "Educational articles that support a commercial page and build topical authority.",
    publishLimit: 4,
    actions: [WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE]
  },
  {
    lane: "QUICK_OPTIMIZATION",
    label: "Quick page optimization",
    description: "Page sections, internal links, redirects, FAQs, and smaller improvements.",
    publishLimit: 6,
    actions: [
      WebsiteGrowthAction.ADD_SECTION,
      WebsiteGrowthAction.ADD_INTERNAL_LINKS,
      WebsiteGrowthAction.UPDATE_REDIRECT
    ]
  }
];

const serviceTerms = [
  "warehouse",
  "warehousing",
  "3pl",
  "fulfillment",
  "fba",
  "distribution",
  "trucking",
  "cross border",
  "ocean freight",
  "air freight",
  "local trucking",
  "gta trucking",
  "freight",
  "transportation",
  "inventory",
  "wms",
  "teamship",
  "mississauga",
  "charlotte",
  "canada",
  "u.s.",
  "automotive",
  "retail",
  "wholesale",
  "amazon"
];

const informationalTerms = ["what is", "meaning", "definition", "guide", "how to", "demurrage", "ddp"];
const brandedTerms = ["newl", "newell", "newells", "newell's", "teamship"];
const keywordStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "best",
  "by",
  "canada",
  "company",
  "companies",
  "for",
  "from",
  "in",
  "near",
  "of",
  "service",
  "services",
  "the",
  "to",
  "us",
  "usa",
  "with"
]);

export function buildOpportunityCandidate(input: OpportunityInput): OpportunityCandidate {
  const topic = cleanTopic(input.topic);
  const primaryKeyword = cleanTopic(input.primaryKeyword ?? input.topic);
  const impressions = input.impressions ?? 0;
  const clicks = input.clicks ?? 0;
  const position = input.position ?? null;
  const leadCount = input.leadCount ?? 0;
  const legacyRebuild = resolveLegacyPageRebuild({
    topic,
    primaryKeyword,
    targetPage: input.targetPage,
    sourcePage: input.sourcePage,
    evidence: input.evidence
  });

  if (legacyRebuild) {
    const legacyEvidence = buildLegacyRebuildEvidence(legacyRebuild, {
      targetPage: input.targetPage,
      sourcePage: input.sourcePage,
      evidence: input.evidence
    });
    const score = Math.max(42, scoreOpportunity({
      topic,
      impressions,
      clicks,
      position,
      leadCount,
      targetPage: toNewlUrl(legacyRebuild.proposedPath)
    }));
    const confidence = score >= 75 ? "High" : score >= 45 ? "Medium" : "Low";

    return {
      action: WebsiteGrowthAction.CREATE_PAGE,
      topic,
      primaryKeyword,
      targetPage: toNewlUrl(legacyRebuild.proposedPath),
      sourcePage: input.sourcePage ?? input.targetPage ?? toNewlUrl(legacyRebuild.currentRedirectPath),
      score,
      confidence,
      reason: buildLegacyRebuildReason({ rebuild: legacyRebuild, impressions, clicks, position, leadCount }),
      recommendation: buildLegacyRebuildRecommendation(legacyRebuild),
      supportingKeywords: Array.from(new Set([primaryKeyword, legacyRebuild.primaryKeyword, ...legacyRebuild.aliases].filter(Boolean))),
      evidence: {
        impressions,
        clicks,
        position,
        leadCount,
        source: input.source ?? "manual",
        ...legacyEvidence
      }
    };
  }

  const action = chooseAction({
    topic,
    targetPage: input.targetPage,
    impressions,
    clicks,
    position,
    leadCount
  });
  const score = scoreOpportunity({
    topic,
    impressions,
    clicks,
    position,
    leadCount,
    targetPage: input.targetPage
  });
  const confidence = score >= 75 ? "High" : score >= 45 ? "Medium" : "Low";

  return {
    action,
    topic,
    primaryKeyword,
    targetPage: input.targetPage ?? null,
    sourcePage: input.sourcePage ?? input.targetPage ?? null,
    score,
    confidence,
    reason: buildReason({ impressions, clicks, position, leadCount, targetPage: input.targetPage }),
    recommendation: buildRecommendation(action, topic, input.targetPage ?? null),
    supportingKeywords: primaryKeyword ? [primaryKeyword] : [],
    evidence: {
      impressions,
      clicks,
      position,
      leadCount,
      source: input.source ?? "manual",
      ...(input.evidence ?? {})
    }
  };
}

export function buildCandidatesFromMetricRows(rows: CsvRow[], source: string): OpportunityCandidate[] {
  return rows
    .map((row) => {
      const query = readString(row, ["query", "keyword", "search query"]);
      const page = readString(row, ["page", "url", "landing page", "landing_page"]);
      const topic = query ?? page;

      if (!topic) {
        return null;
      }

      return buildOpportunityCandidate({
        topic,
        primaryKeyword: query,
        targetPage: page,
        sourcePage: page,
        impressions: readNumber(row, ["impressions", "impr"]) ?? 0,
        clicks: readNumber(row, ["clicks"]) ?? 0,
        position: readNumber(row, ["position", "avg position", "average position"]),
        leadCount: readNumber(row, ["leads", "lead count", "generate_lead"]) ?? 0,
        source,
        evidence: row
      });
    })
    .filter((candidate): candidate is OpportunityCandidate => Boolean(candidate));
}

export function qualifyOpportunityCandidates(candidates: OpportunityCandidate[]): OpportunityQualificationResult {
  const clusters = new Map<string, OpportunityCandidate[]>();

  for (const candidate of candidates) {
    const key = getClusterKey(candidate);
    const existing = clusters.get(key) ?? [];
    existing.push(candidate);
    clusters.set(key, existing);
  }

  const qualified: OpportunityCandidate[] = [];

  for (const cluster of clusters.values()) {
    const candidate = mergeCandidateCluster(cluster);

    if (isQualifiedOpportunity(candidate)) {
      qualified.push(candidate);
    }
  }

  qualified.sort((a, b) => b.score - a.score || Number(b.evidence.impressions ?? 0) - Number(a.evidence.impressions ?? 0));

  return {
    qualified,
    rawCount: candidates.length,
    clusterCount: clusters.size,
    skippedCount: clusters.size - qualified.length
  };
}

export function isQualifiedOpportunity(candidate: OpportunityCandidate) {
  const impressions = Number(candidate.evidence.impressions ?? 0);
  const clicks = Number(candidate.evidence.clicks ?? 0);
  const leadCount = Number(candidate.evidence.leadCount ?? 0);
  const position = typeof candidate.evidence.position === "number" ? candidate.evidence.position : null;
  const topic = candidate.topic.toLowerCase();
  const hasServiceIntent = serviceTerms.some((term) => topic.includes(term));
  const hasInformationalIntent = informationalTerms.some((term) => topic.includes(term));
  const isMostlyBranded = brandedTerms.some((term) => topic.includes(term)) && !hasServiceIntent;

  if (candidate.action === WebsiteGrowthAction.IGNORE) {
    return false;
  }

  if (leadCount > 0) {
    return true;
  }

  if (isMostlyBranded && impressions < 250) {
    return false;
  }

  if (candidate.score >= 55) {
    return true;
  }

  if (hasServiceIntent && impressions >= 20 && position !== null && position > 3 && position <= 50) {
    return true;
  }

  if (hasServiceIntent && impressions >= 75 && clicks === 0) {
    return true;
  }

  if (hasInformationalIntent && impressions >= 100 && position !== null && position <= 40) {
    return true;
  }

  return false;
}

export function scoreOpportunity({
  topic,
  impressions,
  clicks,
  position,
  leadCount,
  targetPage
}: {
  topic: string;
  impressions: number;
  clicks: number;
  position: number | null;
  leadCount: number;
  targetPage?: string | null;
}) {
  const commercialScore = serviceTerms.some((term) => topic.toLowerCase().includes(term)) ? 20 : 0;
  const demandScore = Math.min(30, Math.round(impressions / 75));
  const tractionScore = Math.min(15, clicks * 3);
  const leadScore = Math.min(25, leadCount * 12);
  const positionScore = position && position > 4 && position <= 30 ? 15 : position && position > 30 ? 8 : 0;
  const pageScore = targetPage ? 5 : 10;

  return Math.max(1, Math.min(100, commercialScore + demandScore + tractionScore + leadScore + positionScore + pageScore));
}

function chooseAction({
  topic,
  targetPage,
  impressions,
  clicks,
  position,
  leadCount
}: {
  topic: string;
  targetPage?: string | null;
  impressions: number;
  clicks: number;
  position: number | null;
  leadCount: number;
}) {
  const lowerTopic = topic.toLowerCase();
  const hasInformationalIntent = informationalTerms.some((term) => lowerTopic.includes(term));

  if (targetPage && leadCount > 0) {
    return WebsiteGrowthAction.IMPROVE_EXISTING_PAGE;
  }

  if (hasInformationalIntent) {
    return WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE;
  }

  if (targetPage && impressions >= 200 && clicks / Math.max(impressions, 1) < 0.01) {
    return WebsiteGrowthAction.IMPROVE_EXISTING_PAGE;
  }

  if (targetPage && position && position > 8 && position <= 30) {
    return WebsiteGrowthAction.ADD_SECTION;
  }

  if (!targetPage && serviceTerms.some((term) => lowerTopic.includes(term))) {
    return WebsiteGrowthAction.CREATE_PAGE;
  }

  if (clicks === 0 && impressions < 50) {
    return WebsiteGrowthAction.MONITOR;
  }

  return targetPage ? WebsiteGrowthAction.ADD_INTERNAL_LINKS : WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE;
}

function mergeCandidateCluster(cluster: OpportunityCandidate[]) {
  const sorted = [...cluster].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const impressions = sumEvidenceNumber(cluster, "impressions");
  const clicks = sumEvidenceNumber(cluster, "clicks");
  const leadCount = sumEvidenceNumber(cluster, "leadCount");
  const weightedPosition = weightedAveragePosition(cluster);
  const supportingKeywords = Array.from(
    new Set(cluster.flatMap((candidate) => candidate.supportingKeywords).filter(Boolean))
  ).slice(0, 12);
  const merged = buildOpportunityCandidate({
    topic: best.topic,
    primaryKeyword: best.primaryKeyword,
    targetPage: best.targetPage,
    sourcePage: best.sourcePage,
    impressions,
    clicks,
    position: weightedPosition,
    leadCount,
    source: String(best.evidence.source ?? "clustered"),
    evidence: {
      clusterSize: cluster.length,
      clusterKey: getClusterKey(best),
      supportingKeywords,
      sourceRows: cluster.slice(0, 10).map((candidate) => ({
        topic: candidate.topic,
        keyword: candidate.primaryKeyword,
        page: candidate.targetPage,
        score: candidate.score,
        impressions: candidate.evidence.impressions,
        clicks: candidate.evidence.clicks,
        position: candidate.evidence.position
      }))
    }
  });

  return {
    ...merged,
    supportingKeywords,
    evidence: {
      ...merged.evidence,
      clusterSize: cluster.length,
      clusterKey: getClusterKey(best),
      supportingKeywords
    }
  };
}

function getClusterKey(candidate: OpportunityCandidate) {
  const reviewKey = getOpportunityReviewKey(candidate);

  if (reviewKey.startsWith("legacy-rebuild:")) {
    return `${WebsiteGrowthAction.CREATE_PAGE}:${reviewKey}`;
  }

  const pageKey = candidate.targetPage ? normalizePageKey(candidate.targetPage) : "no-page";
  const intentKey = normalizeKeywordIntent(candidate.primaryKeyword ?? candidate.topic);

  return `${candidate.action}:${pageKey}:${intentKey}`;
}

function normalizePageKey(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.pathname.replace(/\/+$/g, "") || "/";
  } catch {
    return value.replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/g, "") || value;
  }
}

function normalizeKeywordIntent(value: string) {
  const words = cleanTopic(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !keywordStopWords.has(word))
    .map((word) => word.replace(/ies$/, "y").replace(/s$/, ""));

  return words.sort().slice(0, 5).join(" ") || cleanTopic(value).toLowerCase();
}

function sumEvidenceNumber(candidates: OpportunityCandidate[], key: "impressions" | "clicks" | "leadCount") {
  return candidates.reduce((total, candidate) => total + Number(candidate.evidence[key] ?? 0), 0);
}

function weightedAveragePosition(candidates: OpportunityCandidate[]) {
  let weightedTotal = 0;
  let weight = 0;

  for (const candidate of candidates) {
    const position = typeof candidate.evidence.position === "number" ? candidate.evidence.position : null;
    const impressions = Math.max(1, Number(candidate.evidence.impressions ?? 0));

    if (position !== null) {
      weightedTotal += position * impressions;
      weight += impressions;
    }
  }

  return weight > 0 ? weightedTotal / weight : null;
}

function buildReason({
  impressions,
  clicks,
  position,
  leadCount,
  targetPage
}: {
  impressions: number;
  clicks: number;
  position: number | null;
  leadCount: number;
  targetPage?: string | null;
}) {
  const parts = [
    `${impressions} impressions`,
    `${clicks} clicks`,
    `${leadCount} related leads`
  ];

  if (position) {
    parts.push(`average position ${position.toFixed(1)}`);
  }

  if (targetPage) {
    parts.push(`mapped to ${targetPage}`);
  }

  return parts.join(", ");
}

function buildRecommendation(action: WebsiteGrowthAction, topic: string, targetPage: string | null) {
  switch (action) {
    case WebsiteGrowthAction.CREATE_PAGE:
      return `Create a dedicated page for ${topic} and connect it to relevant service, location, and industry pages.`;
    case WebsiteGrowthAction.IMPROVE_EXISTING_PAGE:
      return `Improve ${targetPage ?? "the existing page"} with stronger copy, FAQs, internal links, and clearer conversion path.`;
    case WebsiteGrowthAction.ADD_SECTION:
      return `Add a focused section for ${topic} to ${targetPage ?? "the best matching page"}.`;
    case WebsiteGrowthAction.ADD_INTERNAL_LINKS:
      return `Add internal links using ${topic} language from related pages to strengthen topical coverage.`;
    case WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE:
      return `Create a resource article or glossary page for ${topic} and link it to commercial pages.`;
    case WebsiteGrowthAction.UPDATE_REDIRECT:
      return `Review redirect handling and point legacy demand for ${topic} to the most relevant destination.`;
    case WebsiteGrowthAction.IGNORE:
      return `Ignore this topic unless it becomes commercially relevant.`;
    case WebsiteGrowthAction.MONITOR:
    default:
      return `Monitor ${topic} until demand, rank movement, or lead quality justifies content work.`;
  }
}

function cleanTopic(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}
