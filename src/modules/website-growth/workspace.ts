import {
  WebsiteGrowthAction,
  WebsiteGrowthContentDraftStatus,
  WebsiteGrowthOpportunityStatus
} from "@prisma/client";

export type WebsiteGrowthWorkflowStage =
  | "NEEDS_REVIEW"
  | "BUILDING"
  | "PREVIEW_READY"
  | "COMPLETED";

export function deduplicateScoutDrafts<T extends { opportunityId: string }>(drafts: T[]) {
  const seen = new Set<string>();

  return drafts.filter((draft) => {
    if (seen.has(draft.opportunityId)) {
      return false;
    }

    seen.add(draft.opportunityId);
    return true;
  });
}

type DraftLike = {
  status: WebsiteGrowthContentDraftStatus;
  builtUrl?: string | null;
  pullRequestUrl?: string | null;
  proposedPath?: string | null;
  targetPage?: string | null;
  draftJson?: unknown;
  opportunity: {
    action: WebsiteGrowthAction;
    status: WebsiteGrowthOpportunityStatus;
    targetPage?: string | null;
    sourcePage?: string | null;
    recommendation: string;
  };
};

export function getWebsiteGrowthWorkflowStage(draft: DraftLike): WebsiteGrowthWorkflowStage {
  if (
    draft.status === WebsiteGrowthContentDraftStatus.PUBLISHED ||
    draft.status === WebsiteGrowthContentDraftStatus.REJECTED
  ) {
    return "COMPLETED";
  }

  if (draft.builtUrl) {
    return "PREVIEW_READY";
  }

  if (
    draft.status === WebsiteGrowthContentDraftStatus.APPROVED ||
    draft.status === WebsiteGrowthContentDraftStatus.BUILT ||
    draft.opportunity.status === WebsiteGrowthOpportunityStatus.APPROVED ||
    draft.opportunity.status === WebsiteGrowthOpportunityStatus.IN_PROGRESS ||
    Boolean(draft.pullRequestUrl)
  ) {
    return "BUILDING";
  }

  return "NEEDS_REVIEW";
}

export function getWebsiteGrowthChangeType(action: WebsiteGrowthAction) {
  if (
    action === WebsiteGrowthAction.CREATE_PAGE ||
    action === WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE
  ) {
    return {
      label: "New page",
      description: "Scout is proposing a new website route."
    };
  }

  if (action === WebsiteGrowthAction.UPDATE_REDIRECT) {
    return {
      label: "Technical update",
      description: "Scout is proposing a redirect or routing change."
    };
  }

  if (action === WebsiteGrowthAction.IGNORE || action === WebsiteGrowthAction.MONITOR) {
    return {
      label: "Research only",
      description: "No website build is proposed."
    };
  }

  return {
    label: "Update existing page",
    description: "Scout is proposing changes to a page that already exists."
  };
}

export function getWebsiteGrowthRoute(draft: DraftLike) {
  const buildPackage = readRecord(readRecord(draft.draftJson).buildPackage);
  const routePath = readString(buildPackage.routePath);

  if (routePath) {
    return normalizeRoute(routePath);
  }

  const candidate =
    draft.proposedPath ??
    draft.targetPage ??
    draft.opportunity.targetPage ??
    draft.opportunity.sourcePage;

  return candidate ? normalizeRoute(candidate) : "Route not provided";
}

export function getWebsiteGrowthPrimaryChange(draft: DraftLike) {
  const payload = readRecord(draft.draftJson);
  const pageChangePreview = readRecord(payload.pageChangePreview);
  const scout = readRecord(payload.scout);

  return (
    readString(pageChangePreview.approvalSummary) ??
    readString(scout.recommendationSummary) ??
    draft.opportunity.recommendation
  );
}

export function readScoutRunId(draftJson: unknown) {
  return readString(readRecord(readRecord(draftJson).scout).runId);
}

export function readScoutRunSummary(output: unknown) {
  const record = readRecord(output);
  return {
    phase: readString(record.phase),
    draftIds: readStringArray(record.draftIds),
    semrushRowCount: readNumber(record.semrushRowCount),
    completedAt: readString(record.completedAt)
  };
}

function normalizeRoute(value: string) {
  try {
    return new URL(value).pathname || "/";
  } catch {
    return value.startsWith("/") ? value : `/${value}`;
  }
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

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
