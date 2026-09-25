import { WebsiteGrowthContentDraftStatus, WebsiteGrowthDataSource, WebsiteGrowthImportStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import { record } from "./model";
import { reviewRoute, type Period } from "./effectiveness-model";

const QUERY_ROW_CAP = 5_000;
const QUERY_PACKET_CAP = 40;
const DEPLOYMENT_SCAN_CAP = 200;

type QueryMetric = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

type QueryTotals = QueryMetric & {
  queryCount: number;
};

export type ScoutPageEvidence = {
  route: string;
  searchQueries: {
    status: "AVAILABLE" | "UNAVAILABLE" | "PARTIAL";
    observedAt: string | null;
    windows: { before: Period; after: Period } | null;
    totals: { before: QueryTotals; after: QueryTotals } | null;
    rows: Array<{
      query: string;
      before: QueryMetric | null;
      after: QueryMetric | null;
      changes: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null };
    }>;
    limitation: string;
  };
  deployments: Array<{ draftId: string; title: string; publishedAt: string; route: string }>;
};

/**
 * Give the specialist the matched query/page evidence that the normal evidence refresh already saved.
 * This avoids asking the owner to export data that is present in the tenant-scoped store.
 */
export async function loadScoutPageEvidence(tenantId: string, routeInput: string): Promise<ScoutPageEvidence> {
  const route = reviewRoute(routeInput);
  if (!route) return unavailablePageEvidence(routeInput);
  const [latestImport, publishedDrafts] = await Promise.all([
    prisma.websiteGrowthDataImport.findFirst({
      where: { tenantId, source: WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_API, status: WebsiteGrowthImportStatus.SUCCESS },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      select: { completedAt: true, createdAt: true, summary: true }
    }),
    prisma.websiteGrowthContentDraft.findMany({
      where: { tenantId, status: WebsiteGrowthContentDraftStatus.PUBLISHED, publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      take: DEPLOYMENT_SCAN_CAP,
      select: { id: true, title: true, proposedPath: true, targetPage: true, publishedAt: true }
    })
  ]);
  const deployments = publishedDrafts.flatMap(draft => {
    const publishedRoute = reviewRoute(draft.proposedPath ?? draft.targetPage);
    return publishedRoute === route && draft.publishedAt
      ? [{ draftId: draft.id, title: draft.title, publishedAt: draft.publishedAt.toISOString(), route: publishedRoute }]
      : [];
  });
  const summary = record(latestImport?.summary);
  const after = readPeriod(summary.currentPeriod);
  const before = readPeriod(summary.previousPeriod);
  if (!latestImport || !before || !after) {
    return { ...unavailablePageEvidence(route), deployments };
  }
  const pageFilter = route === "/"
    ? { not: null as null }
    : { in: [route, `${route}/`] };
  const [beforeRows, afterRows] = await Promise.all([before, after].map(period => prisma.websiteGrowthMetric.findMany({
    where: {
      tenantId,
      source: WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_API,
      query: { not: null },
      ...(route === "/" ? { page: pageFilter } : { OR: [
        { page: pageFilter },
        { page: { endsWith: route } },
        { page: { endsWith: `${route}/` } }
      ] }),
      ...dateRange(period)
    },
    orderBy: { createdAt: "desc" },
    take: QUERY_ROW_CAP
  })));
  const rows = [...beforeRows, ...afterRows];
  const matching = rows.filter(row => reviewRoute(row.page) === route);
  const periods = { before: new Map<string, QueryMetric>(), after: new Map<string, QueryMetric>() };
  for (const row of matching) {
    const query = row.query?.trim();
    if (!query) continue;
    const period = samePeriod(row.dateRangeStart, row.dateRangeEnd, after) ? "after" : samePeriod(row.dateRangeStart, row.dateRangeEnd, before) ? "before" : null;
    if (!period) continue;
    const key = query.toLocaleLowerCase("en-US");
    // Metrics can contain a repeated same-day refresh. The newest saved row wins rather than being double counted.
    if (!periods[period].has(key)) periods[period].set(key, {
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: finite(row.ctr),
      position: finite(row.position)
    });
  }
  const queryNames = new Map<string, string>();
  for (const row of matching) if (row.query?.trim()) queryNames.set(row.query.trim().toLocaleLowerCase("en-US"), row.query.trim());
  const packetRows = Array.from(new Set([...periods.before.keys(), ...periods.after.keys()])).map(key => {
    const previous = periods.before.get(key) ?? null;
    const current = periods.after.get(key) ?? null;
    return {
      query: queryNames.get(key) ?? key,
      before: previous,
      after: current,
      changes: {
        clicks: difference(previous?.clicks, current?.clicks),
        impressions: difference(previous?.impressions, current?.impressions),
        ctr: difference(previous?.ctr, current?.ctr),
        position: difference(previous?.position, current?.position)
      }
    };
  }).sort((left, right) => {
    const rightWeight = Math.max(right.before?.impressions ?? 0, right.after?.impressions ?? 0);
    const leftWeight = Math.max(left.before?.impressions ?? 0, left.after?.impressions ?? 0);
    return rightWeight - leftWeight || left.query.localeCompare(right.query);
  }).slice(0, QUERY_PACKET_CAP);
  const truncated = beforeRows.length === QUERY_ROW_CAP || afterRows.length === QUERY_ROW_CAP || packetRows.length < new Set([...periods.before.keys(), ...periods.after.keys()]).size;
  return {
    route,
    searchQueries: {
      status: truncated ? "PARTIAL" : "AVAILABLE",
      observedAt: (latestImport.completedAt ?? latestImport.createdAt).toISOString(),
      windows: { before, after },
      totals: { before: queryTotals(periods.before), after: queryTotals(periods.after) },
      rows: packetRows,
      limitation: truncated
        ? `The totals cover every matched query in the bounded saved report; the rows show only the top ${QUERY_PACKET_CAP}. Treat both as partial rather than as a complete Search Console export.`
        : "The totals cover all matched query/page rows in the latest saved Search Console comparison. Missing rows remain missing rather than being converted to zero."
    },
    deployments
  };
}

function unavailablePageEvidence(route: string): ScoutPageEvidence {
  return { route, searchQueries: { status: "UNAVAILABLE", observedAt: null, windows: null, totals: null, rows: [],
    limitation: "No compatible saved Search Console comparison is available. Continue with other evidence and record the specific missing source." }, deployments: [] };
}

function queryTotals(rows: Map<string, QueryMetric>): QueryTotals {
  let clicks = 0;
  let impressions = 0;
  let positionedImpressions = 0;
  let weightedPosition = 0;
  for (const row of rows.values()) {
    clicks += row.clicks;
    impressions += row.impressions;
    if (row.position !== null && row.impressions > 0) {
      weightedPosition += row.position * row.impressions;
      positionedImpressions += row.impressions;
    }
  }
  return {
    queryCount: rows.size,
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: positionedImpressions > 0 ? weightedPosition / positionedImpressions : null
  };
}

function readPeriod(value: unknown): Period | null {
  const input = record(value);
  if (typeof input.startDate !== "string" || typeof input.endDate !== "string" ||
      !Number.isFinite(Date.parse(input.startDate)) || !Number.isFinite(Date.parse(input.endDate))) return null;
  return { startDate: input.startDate, endDate: input.endDate };
}

function dateRange(period: Period) {
  return { dateRangeStart: new Date(`${period.startDate}T00:00:00.000Z`), dateRangeEnd: new Date(`${period.endDate}T00:00:00.000Z`) };
}

function samePeriod(start: Date | null, end: Date | null, period: Period) {
  return start?.toISOString().slice(0, 10) === period.startDate && end?.toISOString().slice(0, 10) === period.endDate;
}

function finite(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function difference(before: number | null | undefined, after: number | null | undefined) {
  return typeof before === "number" && typeof after === "number" ? after - before : null;
}
