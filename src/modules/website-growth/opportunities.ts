import { WebsiteGrowthAction } from "@prisma/client";

import type { CsvRow } from "@/modules/website-growth/csv";
import { readNumber, readString } from "@/modules/website-growth/csv";

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
  "inventory",
  "wms"
];

const informationalTerms = ["what is", "meaning", "definition", "guide", "how to", "demurrage", "ddp"];

export function buildOpportunityCandidate(input: OpportunityInput): OpportunityCandidate {
  const topic = cleanTopic(input.topic);
  const primaryKeyword = cleanTopic(input.primaryKeyword ?? input.topic);
  const impressions = input.impressions ?? 0;
  const clicks = input.clicks ?? 0;
  const position = input.position ?? null;
  const leadCount = input.leadCount ?? 0;
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

  if (targetPage && leadCount > 0) {
    return WebsiteGrowthAction.IMPROVE_EXISTING_PAGE;
  }

  if (targetPage && impressions >= 200 && clicks / Math.max(impressions, 1) < 0.01) {
    return WebsiteGrowthAction.IMPROVE_EXISTING_PAGE;
  }

  if (targetPage && position && position > 8 && position <= 30) {
    return WebsiteGrowthAction.ADD_SECTION;
  }

  if (informationalTerms.some((term) => lowerTopic.includes(term))) {
    return WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE;
  }

  if (!targetPage && serviceTerms.some((term) => lowerTopic.includes(term))) {
    return WebsiteGrowthAction.CREATE_PAGE;
  }

  if (clicks === 0 && impressions < 50) {
    return WebsiteGrowthAction.MONITOR;
  }

  return targetPage ? WebsiteGrowthAction.ADD_INTERNAL_LINKS : WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE;
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
