import {
  WebsiteGrowthAction,
  WebsiteGrowthContentDraftStatus,
  type Prisma
} from "@prisma/client";

const MAX_TRACKED_KEYWORDS = 500;
const MAX_KEYWORDS_PER_PAGE = 6;

export type WebsiteGrowthSemrushTrackedKeyword = {
  keyword: string;
  tags: string[];
  position: number | null;
  previousPosition: number | null;
  landingPage: string | null;
  searchVolume: number | null;
};

export type WebsiteGrowthSemrushTrackingSnapshot = {
  projectId: string | null;
  campaignId: string | null;
  domain: string | null;
  database: string | null;
  device: string | null;
  visibility: number | null;
  previousVisibility: number | null;
  top3: number | null;
  top10: number | null;
  top20: number | null;
  top100: number | null;
  improved: number | null;
  declined: number | null;
  entered: number | null;
  lost: number | null;
  trackedKeywords: WebsiteGrowthSemrushTrackedKeyword[];
};

export type WebsiteGrowthTrackingDraft = {
  id: string;
  status: WebsiteGrowthContentDraftStatus;
  proposedPath: string | null;
  targetPage: string | null;
  draftJson: Prisma.JsonValue;
  opportunity: {
    action: WebsiteGrowthAction;
    primaryKeyword: string | null;
    supportingKeywords: Prisma.JsonValue | null;
    targetPage: string | null;
    sourcePage: string | null;
  };
};

export type WebsiteGrowthKeywordAddition = {
  keyword: string;
  tags: string;
  route: string;
  draftId: string;
  draftStatus: WebsiteGrowthContentDraftStatus;
};

export type WebsiteGrowthSpreadsheetReport = {
  filename: string;
  sheetName: string;
  columns: Array<{ key: string; header: string }>;
  rows: Array<Record<string, string | number | boolean | null>>;
};

export function buildWebsiteGrowthKeywordAdditions({
  drafts,
  trackedKeywords
}: {
  drafts: WebsiteGrowthTrackingDraft[];
  trackedKeywords: WebsiteGrowthSemrushTrackedKeyword[];
}) {
  const tracked = new Set(trackedKeywords.map((row) => normalizeKeyword(row.keyword)).filter(Boolean));
  const selected = new Set<string>();
  const additions: WebsiteGrowthKeywordAddition[] = [];

  for (const draft of drafts) {
    const route = resolveTrackingRoute(draft);
    const tags = buildTrackingTags(draft);
    const candidates = [
      readString(readRecord(draft.draftJson).targetKeyword),
      draft.opportunity.primaryKeyword,
      ...readStringArray(draft.opportunity.supportingKeywords)
    ];
    let pageKeywordCount = 0;

    for (const candidate of candidates) {
      const keyword = cleanKeyword(candidate);
      const key = normalizeKeyword(keyword);
      if (!key || tracked.has(key) || selected.has(key)) continue;

      additions.push({
        keyword,
        tags,
        route,
        draftId: draft.id,
        draftStatus: draft.status
      });
      selected.add(key);
      pageKeywordCount += 1;

      if (pageKeywordCount >= MAX_KEYWORDS_PER_PAGE || additions.length >= MAX_TRACKED_KEYWORDS) break;
    }

    if (additions.length >= MAX_TRACKED_KEYWORDS) break;
  }

  return additions;
}

export function buildWebsiteGrowthKeywordImportReport(
  additions: WebsiteGrowthKeywordAddition[],
  generatedAt: Date
): WebsiteGrowthSpreadsheetReport {
  return {
    filename: `newl-semrush-keywords-${generatedAt.toISOString().slice(0, 10)}.xlsx`,
    sheetName: "SEMrush Import",
    columns: [
      { key: "keyword", header: "Keyword" },
      { key: "tags", header: "Tags" }
    ],
    rows: additions.map((addition) => ({
      keyword: addition.keyword,
      tags: addition.tags
    }))
  };
}

export function buildWebsiteGrowthPerformanceReport(
  tracking: WebsiteGrowthSemrushTrackingSnapshot,
  generatedAt: Date
): WebsiteGrowthSpreadsheetReport {
  const campaignRows = [
    metricRow("Visibility", tracking.visibility, tracking.previousVisibility),
    metricRow("Keywords in top 3", tracking.top3, null),
    metricRow("Keywords in top 10", tracking.top10, null),
    metricRow("Keywords in top 20", tracking.top20, null),
    metricRow("Keywords in top 100", tracking.top100, null),
    metricRow("Keywords improved", tracking.improved, null),
    metricRow("Keywords declined", tracking.declined, null),
    metricRow("Keywords entered", tracking.entered, null),
    metricRow("Keywords lost", tracking.lost, null)
  ];
  const keywordRows = tracking.trackedKeywords.slice(0, MAX_TRACKED_KEYWORDS).map((row) => ({
    recordType: "Tracked keyword",
    item: row.keyword,
    currentValue: row.position,
    previousValue: row.previousPosition,
    change:
      row.position !== null && row.previousPosition !== null
        ? row.previousPosition - row.position
        : null,
    landingPage: row.landingPage,
    searchVolume: row.searchVolume,
    tags: row.tags.join(", "),
    source: "Official SEMrush MCP",
    reportDate: generatedAt.toISOString().slice(0, 10)
  }));

  return {
    filename: `newl-seo-performance-${generatedAt.toISOString().slice(0, 10)}.xlsx`,
    sheetName: "Weekly SEO",
    columns: [
      { key: "recordType", header: "Record Type" },
      { key: "item", header: "Keyword or Metric" },
      { key: "currentValue", header: "Current" },
      { key: "previousValue", header: "Previous" },
      { key: "change", header: "Change" },
      { key: "landingPage", header: "Landing Page" },
      { key: "searchVolume", header: "Search Volume" },
      { key: "tags", header: "Tags" },
      { key: "source", header: "Source" },
      { key: "reportDate", header: "Report Date" }
    ],
    rows: [...campaignRows, ...keywordRows].map((row) => ({
      ...row,
      source: "Official SEMrush MCP",
      reportDate: generatedAt.toISOString().slice(0, 10)
    }))
  };
}

function metricRow(item: string, currentValue: number | null, previousValue: number | null) {
  return {
    recordType: "Campaign metric",
    item,
    currentValue,
    previousValue,
    change:
      currentValue !== null && previousValue !== null
        ? currentValue - previousValue
        : null,
    landingPage: null,
    searchVolume: null,
    tags: null
  };
}

function buildTrackingTags(draft: WebsiteGrowthTrackingDraft) {
  const changeTag =
    draft.opportunity.action === WebsiteGrowthAction.CREATE_PAGE ||
    draft.opportunity.action === WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE
      ? "new-page"
      : "page-update";
  return ["website-growth", "scout", changeTag].join(",");
}

function resolveTrackingRoute(draft: WebsiteGrowthTrackingDraft) {
  const candidate =
    draft.proposedPath ??
    draft.targetPage ??
    draft.opportunity.targetPage ??
    draft.opportunity.sourcePage ??
    "/";
  try {
    return new URL(candidate, "https://www.newlgroup.com").pathname || "/";
  } catch {
    return candidate.startsWith("/") ? candidate : `/${candidate}`;
  }
}

function cleanKeyword(value: unknown) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 300)
    : "";
}

function normalizeKeyword(value: unknown) {
  return cleanKeyword(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}
