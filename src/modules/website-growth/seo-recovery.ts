import { WebsiteGrowthAction } from "@prisma/client";

import { buildOpportunityCandidate, type OpportunityCandidate } from "@/modules/website-growth/opportunities";

export const SEO_RECOVERY_PERIOD_DAYS = 28;
export const SEO_RECOVERY_DATA_LAG_DAYS = 2;
export const SEO_RECOVERY_PACKET_LIMIT = 2;

export type WebsiteGrowthSearchConsoleRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

export type WebsiteGrowthRedirectMapping = {
  source: string;
  destination: string;
};

export type WebsiteGrowthSeoRecoveryStatus =
  | "NEEDS_RECOVERY"
  | "MIGRATION_TRANSITION"
  | "IMPROVING"
  | "MONITOR";

export type WebsiteGrowthSeoRecoveryMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  brandedClicks: number;
  nonBrandedClicks: number;
};

export type WebsiteGrowthSeoRecoveryCandidate = {
  route: string;
  status: WebsiteGrowthSeoRecoveryStatus;
  reason: string;
  current: WebsiteGrowthSeoRecoveryMetrics;
  previous: WebsiteGrowthSeoRecoveryMetrics;
  clickChangePercent: number | null;
  impressionChangePercent: number | null;
  positionChange: number | null;
  legacySources: string[];
  topQueries: string[];
  commercial: boolean;
};

export type WebsiteGrowthSeoRecoverySnapshot = {
  version: 1;
  currentPeriod: { startDate: string; endDate: string };
  previousPeriod: { startDate: string; endDate: string };
  site: {
    current: WebsiteGrowthSeoRecoveryMetrics;
    previous: WebsiteGrowthSeoRecoveryMetrics;
    clickChangePercent: number | null;
    impressionChangePercent: number | null;
    positionChange: number | null;
  };
  country: {
    canada: { current: WebsiteGrowthSeoRecoveryMetrics; previous: WebsiteGrowthSeoRecoveryMetrics };
    unitedStates: { current: WebsiteGrowthSeoRecoveryMetrics; previous: WebsiteGrowthSeoRecoveryMetrics };
  };
  counts: Record<WebsiteGrowthSeoRecoveryStatus, number>;
  candidates: WebsiteGrowthSeoRecoveryCandidate[];
};

type MetricAccumulator = {
  clicks: number;
  impressions: number;
  positionWeightedTotal: number;
  positionWeight: number;
  brandedClicks: number;
  nonBrandedClicks: number;
};

const brandedQueryPattern = /(?:^|\s)(?:newl|newell|newells|newell's)(?:\s|$)|newell logistics/i;
const commercialRoutePattern = /^\/(?:services|locations|industries|freight)(?:\/|$)/;

export function buildWebsiteGrowthSearchConsoleComparisonWindows(
  now = new Date(),
  periodDays = SEO_RECOVERY_PERIOD_DAYS,
  lagDays = SEO_RECOVERY_DATA_LAG_DAYS
) {
  const normalizedPeriodDays = Math.max(7, Math.round(periodDays));
  const normalizedLagDays = Math.max(0, Math.round(lagDays));
  const currentEnd = atUtcMidnight(now);
  currentEnd.setUTCDate(currentEnd.getUTCDate() - normalizedLagDays);
  const currentStart = shiftUtcDays(currentEnd, -(normalizedPeriodDays - 1));
  const previousEnd = shiftUtcDays(currentStart, -1);
  const previousStart = shiftUtcDays(previousEnd, -(normalizedPeriodDays - 1));

  return {
    current: {
      startDate: formatUtcDate(currentStart),
      endDate: formatUtcDate(currentEnd)
    },
    previous: {
      startDate: formatUtcDate(previousStart),
      endDate: formatUtcDate(previousEnd)
    }
  };
}

export function buildWebsiteGrowthSeoRecoverySnapshot({
  currentPageCountryRows,
  previousPageCountryRows,
  currentQueryPageRows,
  previousQueryPageRows,
  redirects,
  currentPeriod,
  previousPeriod
}: {
  currentPageCountryRows: WebsiteGrowthSearchConsoleRow[];
  previousPageCountryRows: WebsiteGrowthSearchConsoleRow[];
  currentQueryPageRows: WebsiteGrowthSearchConsoleRow[];
  previousQueryPageRows: WebsiteGrowthSearchConsoleRow[];
  redirects: WebsiteGrowthRedirectMapping[];
  currentPeriod: { startDate: string; endDate: string };
  previousPeriod: { startDate: string; endDate: string };
}): WebsiteGrowthSeoRecoverySnapshot {
  const redirectMap = buildRedirectMap(redirects);
  const current = aggregatePageRows(currentPageCountryRows, redirectMap);
  const previous = aggregatePageRows(previousPageCountryRows, redirectMap);
  const currentQueries = aggregateQueryRows(currentQueryPageRows, redirectMap);
  const previousQueries = aggregateQueryRows(previousQueryPageRows, redirectMap);
  const routeKeys = new Set([...current.routes.keys(), ...previous.routes.keys()]);
  const candidates = Array.from(routeKeys)
    .map((route) => buildRecoveryCandidate({
      route,
      current: mergeQueryMetrics(current.routes.get(route), currentQueries.get(route)),
      previous: mergeQueryMetrics(previous.routes.get(route), previousQueries.get(route)),
      currentLegacySources: current.legacySources.get(route) ?? new Set<string>(),
      previousLegacySources: previous.legacySources.get(route) ?? new Set<string>(),
      currentQueries: currentQueries.get(route),
      previousQueries: previousQueries.get(route)
    }))
    .filter((candidate) => candidate.current.impressions > 0 || candidate.previous.impressions > 0)
    .sort(compareRecoveryCandidates)
    .slice(0, 25);

  const counts = emptyRecoveryCounts();
  for (const candidate of candidates) counts[candidate.status] += 1;
  const currentSite = finalizeMetrics(current.site);
  const previousSite = finalizeMetrics(previous.site);

  return {
    version: 1,
    currentPeriod,
    previousPeriod,
    site: {
      current: currentSite,
      previous: previousSite,
      clickChangePercent: percentageChange(currentSite.clicks, previousSite.clicks),
      impressionChangePercent: percentageChange(currentSite.impressions, previousSite.impressions),
      positionChange: positionChange(currentSite.position, previousSite.position)
    },
    country: {
      canada: {
        current: finalizeMetrics(current.countries.get("canada")),
        previous: finalizeMetrics(previous.countries.get("canada"))
      },
      unitedStates: {
        current: finalizeMetrics(current.countries.get("usa")),
        previous: finalizeMetrics(previous.countries.get("usa"))
      }
    },
    counts,
    candidates
  };
}

export function buildWebsiteGrowthSeoRecoveryOpportunityCandidates(
  snapshot: WebsiteGrowthSeoRecoverySnapshot
): OpportunityCandidate[] {
  return snapshot.candidates
    .filter((candidate) => candidate.status === "NEEDS_RECOVERY")
    .slice(0, SEO_RECOVERY_PACKET_LIMIT)
    .map((candidate) => {
      const primaryKeyword = candidate.topQueries[0] ?? routeLabel(candidate.route);
      const targetPage = toNewlUrl(candidate.route);
      const base = buildOpportunityCandidate({
        topic: `SEO recovery for ${routeLabel(candidate.route)}`,
        primaryKeyword,
        targetPage,
        sourcePage: candidate.legacySources[0] ? toNewlUrl(candidate.legacySources[0]) : targetPage,
        impressions: candidate.current.impressions,
        clicks: candidate.current.clicks,
        position: candidate.current.position,
        source: "google_search_console_recovery",
        evidence: {
          seoRecovery: true,
          seoRecoveryStatus: candidate.status,
          currentPeriod: snapshot.currentPeriod,
          previousPeriod: snapshot.previousPeriod,
          current: candidate.current,
          previous: candidate.previous,
          clickChangePercent: candidate.clickChangePercent,
          impressionChangePercent: candidate.impressionChangePercent,
          positionChange: candidate.positionChange,
          legacySources: candidate.legacySources,
          topQueries: candidate.topQueries,
          recoveryReason: candidate.reason
        }
      });

      return {
        ...base,
        action: WebsiteGrowthAction.IMPROVE_EXISTING_PAGE,
        score: Math.max(70, base.score),
        confidence: "High",
        reason: candidate.reason,
        recommendation:
          `Audit the redirect, canonical, sitemap, internal links, metadata, and retained search intent for ${candidate.route}. ` +
          "Recover qualified visibility on the existing destination without recreating thin or duplicate legacy pages."
      };
    });
}

export function isWebsiteGrowthSeoRecoveryOpportunity(value: { evidence?: unknown }) {
  const evidence = readRecord(value.evidence);
  return evidence.seoRecovery === true;
}

function aggregatePageRows(rows: WebsiteGrowthSearchConsoleRow[], redirectMap: Map<string, string>) {
  const routes = new Map<string, MetricAccumulator>();
  const countries = new Map<string, MetricAccumulator>();
  const legacySources = new Map<string, Set<string>>();
  const site = emptyAccumulator();

  for (const row of rows) {
    const source = normalizeWebsitePath(row.keys?.[0]);
    if (!source) continue;
    const route = resolveRedirectDestination(source, redirectMap);
    addMetrics(site, row);
    addMetrics(getAccumulator(routes, route), row);
    const country = normalizeCountry(row.keys?.[1]);
    if (country) addMetrics(getAccumulator(countries, country), row);
    if (source !== route) {
      const sources = legacySources.get(route) ?? new Set<string>();
      sources.add(source);
      legacySources.set(route, sources);
    }
  }

  return { routes, countries, legacySources, site };
}

function aggregateQueryRows(rows: WebsiteGrowthSearchConsoleRow[], redirectMap: Map<string, string>) {
  const routes = new Map<string, MetricAccumulator & { queries: Map<string, number> }>();

  for (const row of rows) {
    const query = row.keys?.[0]?.trim();
    const source = normalizeWebsitePath(row.keys?.[1]);
    if (!query || !source) continue;
    const route = resolveRedirectDestination(source, redirectMap);
    const metrics = routes.get(route) ?? { ...emptyAccumulator(), queries: new Map<string, number>() };
    const clicks = Math.max(0, Number(row.clicks) || 0);
    if (brandedQueryPattern.test(query)) metrics.brandedClicks += clicks;
    else metrics.nonBrandedClicks += clicks;
    metrics.queries.set(query, (metrics.queries.get(query) ?? 0) + Math.max(0, Number(row.impressions) || 0));
    routes.set(route, metrics);
  }

  return routes;
}

function buildRecoveryCandidate({
  route,
  current,
  previous,
  currentLegacySources,
  previousLegacySources,
  currentQueries,
  previousQueries
}: {
  route: string;
  current: WebsiteGrowthSeoRecoveryMetrics;
  previous: WebsiteGrowthSeoRecoveryMetrics;
  currentLegacySources: Set<string>;
  previousLegacySources: Set<string>;
  currentQueries?: MetricAccumulator & { queries: Map<string, number> };
  previousQueries?: MetricAccumulator & { queries: Map<string, number> };
}): WebsiteGrowthSeoRecoveryCandidate {
  const legacySources = Array.from(new Set([...currentLegacySources, ...previousLegacySources])).sort();
  const commercial = route === "/" || commercialRoutePattern.test(route);
  const clickChangePercent = percentageChange(current.clicks, previous.clicks);
  const impressionChangePercent = percentageChange(current.impressions, previous.impressions);
  const changedPosition = positionChange(current.position, previous.position);
  const clickLoss = previous.clicks - current.clicks;
  const rootBrandStable =
    route === "/" && previous.brandedClicks > 0 && current.brandedClicks >= previous.brandedClicks;
  const materialClickLoss =
    previous.clicks >= 5 && clickLoss >= 5 && current.clicks <= previous.clicks * 0.8;
  const materialPositionLoss =
    previous.impressions >= 250 && current.impressions >= 250 &&
    changedPosition !== null && changedPosition >= 5 && current.clicks <= previous.clicks + 1;
  const improving =
    current.clicks >= previous.clicks + 3 ||
    (current.impressions >= 100 && previous.impressions === 0) ||
    (changedPosition !== null && changedPosition <= -5 && current.impressions >= 100);
  const migrationTransition = legacySources.length > 0 && (
    clickLoss < 5 ||
    current.clicks >= previous.clicks * 0.8 ||
    current.ctr > previous.ctr
  );
  const status: WebsiteGrowthSeoRecoveryStatus =
    commercial && !rootBrandStable && (materialClickLoss || materialPositionLoss)
      ? "NEEDS_RECOVERY"
      : improving
        ? "IMPROVING"
        : migrationTransition
          ? "MIGRATION_TRANSITION"
          : "MONITOR";
  const queryScores = new Map<string, number>();
  for (const querySet of [currentQueries?.queries, previousQueries?.queries]) {
    for (const [query, impressions] of querySet ?? []) {
      if (brandedQueryPattern.test(query)) continue;
      queryScores.set(query, (queryScores.get(query) ?? 0) + impressions);
    }
  }
  const topQueries = Array.from(queryScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([query]) => query);

  return {
    route,
    status,
    reason: buildRecoveryReason({ route, status, current, previous, clickChangePercent, impressionChangePercent, changedPosition, legacySources }),
    current,
    previous,
    clickChangePercent,
    impressionChangePercent,
    positionChange: changedPosition,
    legacySources,
    topQueries,
    commercial
  };
}

function buildRecoveryReason({
  route,
  status,
  current,
  previous,
  clickChangePercent,
  impressionChangePercent,
  changedPosition,
  legacySources
}: {
  route: string;
  status: WebsiteGrowthSeoRecoveryStatus;
  current: WebsiteGrowthSeoRecoveryMetrics;
  previous: WebsiteGrowthSeoRecoveryMetrics;
  clickChangePercent: number | null;
  impressionChangePercent: number | null;
  changedPosition: number | null;
  legacySources: string[];
}) {
  const statusLabel = status === "NEEDS_RECOVERY"
    ? "Qualified visibility needs recovery"
    : status === "MIGRATION_TRANSITION"
      ? "Legacy visibility is transitioning"
      : status === "IMPROVING"
        ? "The destination is improving"
        : "Continue monitoring";
  const parts = [
    `${statusLabel} for ${route}`,
    `${previous.clicks} to ${current.clicks} clicks (${formatSignedPercent(clickChangePercent)})`,
    `${previous.impressions} to ${current.impressions} impressions (${formatSignedPercent(impressionChangePercent)})`,
    changedPosition === null
      ? null
      : `average position ${formatPosition(previous.position)} to ${formatPosition(current.position)} (${changedPosition > 0 ? "+" : ""}${changedPosition.toFixed(1)})`,
    legacySources.length > 0 ? `${legacySources.length} legacy ${legacySources.length === 1 ? "URL" : "URLs"} consolidated` : null
  ];
  return parts.filter(Boolean).join("; ");
}

function compareRecoveryCandidates(a: WebsiteGrowthSeoRecoveryCandidate, b: WebsiteGrowthSeoRecoveryCandidate) {
  const statusWeight: Record<WebsiteGrowthSeoRecoveryStatus, number> = {
    NEEDS_RECOVERY: 4,
    MIGRATION_TRANSITION: 3,
    IMPROVING: 2,
    MONITOR: 1
  };
  return statusWeight[b.status] - statusWeight[a.status] ||
    b.previous.clicks - a.previous.clicks ||
    b.current.impressions - a.current.impressions;
}

function mergeQueryMetrics(
  metrics: MetricAccumulator | undefined,
  queries: (MetricAccumulator & { queries: Map<string, number> }) | undefined
) {
  const finalized = finalizeMetrics(metrics);
  return {
    ...finalized,
    brandedClicks: queries?.brandedClicks ?? 0,
    nonBrandedClicks: queries?.nonBrandedClicks ?? 0
  };
}

function addMetrics(accumulator: MetricAccumulator, row: WebsiteGrowthSearchConsoleRow) {
  const clicks = Math.max(0, Number(row.clicks) || 0);
  const impressions = Math.max(0, Number(row.impressions) || 0);
  const position = Number(row.position);
  accumulator.clicks += clicks;
  accumulator.impressions += impressions;
  if (Number.isFinite(position) && impressions > 0) {
    accumulator.positionWeightedTotal += position * impressions;
    accumulator.positionWeight += impressions;
  }
}

function getAccumulator(map: Map<string, MetricAccumulator>, key: string) {
  const existing = map.get(key);
  if (existing) return existing;
  const created = emptyAccumulator();
  map.set(key, created);
  return created;
}

function emptyAccumulator(): MetricAccumulator {
  return {
    clicks: 0,
    impressions: 0,
    positionWeightedTotal: 0,
    positionWeight: 0,
    brandedClicks: 0,
    nonBrandedClicks: 0
  };
}

function finalizeMetrics(value?: MetricAccumulator): WebsiteGrowthSeoRecoveryMetrics {
  const metrics = value ?? emptyAccumulator();
  return {
    clicks: Math.round(metrics.clicks),
    impressions: Math.round(metrics.impressions),
    ctr: metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0,
    position: metrics.positionWeight > 0 ? metrics.positionWeightedTotal / metrics.positionWeight : null,
    brandedClicks: Math.round(metrics.brandedClicks),
    nonBrandedClicks: Math.round(metrics.nonBrandedClicks)
  };
}

function buildRedirectMap(redirects: WebsiteGrowthRedirectMapping[]) {
  const entries: Array<[string, string]> = [];
  for (const redirect of redirects) {
    const source = normalizeWebsitePath(redirect.source);
    const destination = normalizeWebsitePath(redirect.destination);
    if (!source || !destination || source.includes(":")) continue;
    entries.push([source, destination]);
  }
  return new Map(entries);
}

function resolveRedirectDestination(source: string, redirects: Map<string, string>) {
  let current = source;
  const seen = new Set<string>();
  for (let index = 0; index < 8; index += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const next = redirects.get(current);
    if (!next) break;
    current = next;
  }
  return current;
}

function normalizeWebsitePath(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value);
    return normalizePath(parsed.pathname);
  } catch {
    return normalizePath(value);
  }
}

function normalizePath(value: string) {
  const path = (value.split(/[?#]/)[0] ?? value).trim();
  return (path.startsWith("/") ? path : `/${path}`).toLowerCase().replace(/\/+$/g, "") || "/";
}

function normalizeCountry(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "can" || normalized === "canada") return "canada";
  if (normalized === "usa" || normalized === "united states" || normalized === "us") return "usa";
  return normalized || null;
}

function percentageChange(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous : current > 0 ? null : 0;
}

function positionChange(current: number | null, previous: number | null) {
  return current !== null && previous !== null ? current - previous : null;
}

function emptyRecoveryCounts(): Record<WebsiteGrowthSeoRecoveryStatus, number> {
  return { NEEDS_RECOVERY: 0, MIGRATION_TRANSITION: 0, IMPROVING: 0, MONITOR: 0 };
}

function atUtcMidnight(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function shiftUtcDays(value: Date, days: number) {
  const shifted = new Date(value);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatSignedPercent(value: number | null) {
  if (value === null) return "new";
  const percent = Math.round(value * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function formatPosition(value: number | null) {
  return value === null ? "not ranked" : value.toFixed(1);
}

function routeLabel(route: string) {
  return route === "/"
    ? "homepage"
    : route.split("/").filter(Boolean).at(-1)?.replace(/-/g, " ") ?? route;
}

function toNewlUrl(path: string) {
  return `https://www.newlgroup.com${path === "/" ? "/" : path}`;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
