import { WebsiteGrowthAction } from "@prisma/client";

export type LegacyPageRebuild = {
  key: string;
  canonicalTopic: string;
  primaryKeyword: string;
  legacyPath: string;
  proposedPath: string;
  currentRedirectPath: string;
  aliases: string[];
};

export const legacyPageRebuilds: LegacyPageRebuild[] = [
  {
    key: "top-3pl-companies-in-usa",
    canonicalTopic: "top 3PL companies in the USA",
    primaryKeyword: "top 3pl companies in usa",
    legacyPath: "/top-3pl-companies-in-usa",
    proposedPath: "/top-3pl-companies-in-usa",
    currentRedirectPath: "/locations/charlotte-warehousing",
    aliases: [
      "top 3pl companies in usa",
      "top 3pl companies in the usa",
      "top 3pl provider",
      "best 3pls in america",
      "best 3pl companies",
      "nationwide 3pl companies",
      "3pl companies in usa",
      "3pl logistics providers in usa",
      "third party logistics companies usa"
    ]
  }
];

export function resolveLegacyPageRebuild(input: {
  topic?: string | null;
  primaryKeyword?: string | null;
  targetPage?: string | null;
  sourcePage?: string | null;
  evidence?: unknown;
}): LegacyPageRebuild | null {
  const evidence = readRecord(input.evidence);
  const evidenceKey = typeof evidence?.legacyRebuildKey === "string" ? evidence.legacyRebuildKey : null;
  const topicIntent = `${input.topic ?? ""} ${input.primaryKeyword ?? ""}`.toLowerCase();
  const pagePaths = [
    normalizeWebsitePath(input.targetPage),
    normalizeWebsitePath(input.sourcePage),
    normalizeWebsitePath(readString(evidence?.legacyPath)),
    normalizeWebsitePath(readString(evidence?.proposedPath)),
    normalizeWebsitePath(readString(evidence?.currentRedirectPath)),
    normalizeWebsitePath(readString(evidence?.originalTargetPage)),
    normalizeWebsitePath(readString(evidence?.originalSourcePage))
  ].filter((path): path is string => Boolean(path));

  for (const rebuild of legacyPageRebuilds) {
    if (evidenceKey === rebuild.key) {
      return rebuild;
    }

    const hasLegacyUrl = pagePaths.some((path) => path === rebuild.legacyPath || path === rebuild.proposedPath);
    const hasRedirectUrl = pagePaths.some((path) => path === rebuild.currentRedirectPath);
    const hasAlias = rebuild.aliases.some((alias) => topicIntent.includes(alias));

    if (hasLegacyUrl || (hasAlias && (hasRedirectUrl || pagePaths.length === 0))) {
      return rebuild;
    }
  }

  return null;
}

export function buildLegacyRebuildReason(input: {
  rebuild: LegacyPageRebuild;
  impressions: number;
  clicks: number;
  position: number | null;
  leadCount: number;
}) {
  const parts = [
    `${input.impressions} impressions`,
    `${input.clicks} clicks`,
    `${input.leadCount} related leads`
  ];

  if (input.position) {
    parts.push(`average position ${input.position.toFixed(1)}`);
  }

  parts.push(`legacy URL ${input.rebuild.proposedPath} currently redirects to ${input.rebuild.currentRedirectPath}`);

  return parts.join(", ");
}

export function buildLegacyRebuildRecommendation(rebuild: LegacyPageRebuild) {
  return `Build a dedicated draft page for ${rebuild.canonicalTopic} at ${rebuild.proposedPath}. Treat the current redirect to ${rebuild.currentRedirectPath} as evidence only until the draft is approved and implemented.`;
}

export function buildLegacyRebuildEvidence(
  rebuild: LegacyPageRebuild,
  input: {
    targetPage?: string | null;
    sourcePage?: string | null;
    evidence?: Record<string, unknown>;
  }
) {
  return {
    ...(input.evidence ?? {}),
    legacyRebuild: true,
    legacyRebuildKey: rebuild.key,
    legacyPath: rebuild.legacyPath,
    proposedPath: rebuild.proposedPath,
    currentRedirectPath: rebuild.currentRedirectPath,
    currentRedirectUrl: toNewlUrl(rebuild.currentRedirectPath),
    originalTargetPage: input.targetPage ?? null,
    originalSourcePage: input.sourcePage ?? null
  };
}

export function getOpportunityReviewKey(input: {
  action?: WebsiteGrowthAction | null;
  topic?: string | null;
  primaryKeyword?: string | null;
  targetPage?: string | null;
  sourcePage?: string | null;
  evidence?: unknown;
}) {
  const rebuild = resolveLegacyPageRebuild(input);

  if (rebuild) {
    return `legacy-rebuild:${rebuild.proposedPath}`;
  }

  return `page:${normalizeReviewPage(input.targetPage ?? input.sourcePage ?? input.topic ?? "")}`;
}

export function toNewlUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `https://www.newlgroup.com${path.startsWith("/") ? path : `/${path}`}`;
}

export function normalizeWebsitePath(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return normalizePath(parsed.pathname);
  } catch {
    return normalizePath(trimmed.replace(/^https?:\/\/[^/]+/i, ""));
  }
}

function normalizeReviewPage(value: string) {
  return normalizeWebsitePath(value) ?? value.toLowerCase().trim();
}

function normalizePath(value: string) {
  const withoutQuery = value.split(/[?#]/)[0] ?? value;
  const path = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;

  return path.toLowerCase().replace(/\/+$/g, "") || "/";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}
