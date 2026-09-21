const DAY_MS = 86_400_000;

export const EFFECTIVENESS_JOB = "WEBSITE_GROWTH_SCOUT_EFFECTIVENESS";
export const SOURCE_NAMES = ["search_console", "ga4", "enquiries"] as const;
export type SourceName = typeof SOURCE_NAMES[number];
export type Period = { startDate: string; endDate: string };
export type ReviewWindows = { before: Period; after: Period };
export type PageMetrics = { route: string; metrics: Record<string, number> };
export type SourceData = { windows: ReviewWindows; before: PageMetrics[]; after: PageMetrics[]; truncated: boolean };
export type ReviewSource = { status: "AVAILABLE" | "UNAVAILABLE" | "UNBOUND"; attemptedAt: string;
  observedAt: string | null; data: SourceData | null };
export type SiteReview = { version: 1; attemptedAt: string; nextRefreshAt: string; windows: ReviewWindows;
  sources: Record<SourceName, ReviewSource>; inventory: { routes: string[]; source: string; observedAt: string | null } };
export type ReviewDirection = "Improving" | "Declining" | "Mixed" | "No clear change" | "Insufficient evidence";
export type PageReviewFacet = { key: "search" | "visits" | "engagement" | "enquiries"; label: string; direction: ReviewDirection; metrics: string[] };
export type PageReview = { route: string; direction: ReviewDirection; facets: PageReviewFacet[];
  comparisons: Array<{ source: SourceName; metric: string; before: number; after: number; difference: number; percentChange: number | null }>;
  opportunities: string[]; gaps: string[]; weight: number };

export function reviewWindows(now = new Date()): ReviewWindows {
  const day = Date.parse(now.toISOString().slice(0, 10));
  const date = (offset: number) => new Date(day + offset * DAY_MS).toISOString().slice(0, 10);
  return { before: { startDate: date(-58), endDate: date(-31) }, after: { startDate: date(-30), endDate: date(-3) } };
}
export function reviewRoute(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000 || /[\\\s]/.test(value)) return null;
  try {
    if (!value.startsWith("/") && !value.startsWith("https://")) return null;
    if (value.startsWith("//")) return null;
    const url = new URL(value, "https://example.com");
    if (url.searchParams.has("codex_weekly_diagnostic")) return null;
    return url.pathname.replace(/\/+$/, "") || "/";
  } catch { return null; }
}
export function sourceCurrent(source: ReviewSource, review: SiteReview, now = new Date()) {
  return source.status === "AVAILABLE" && source.data !== null && Boolean(source.observedAt) &&
    Date.parse(source.observedAt!) <= now.getTime() && now.getTime() - Date.parse(source.observedAt!) < 2 * DAY_MS &&
    JSON.stringify(source.data.windows) === JSON.stringify(review.windows);
}

/** Triage hints only. They never approve a rewrite or represent statistical significance. */
export function reviewPages(review: SiteReview, now = new Date()) {
  const routes = new Set(review.inventory.routes);
  const maps = Object.fromEntries(SOURCE_NAMES.map(name => [name, {
    before: new Map(review.sources[name].data?.before.map(row => [row.route, row.metrics]) ?? []),
    after: new Map(review.sources[name].data?.after.map(row => [row.route, row.metrics]) ?? [])
  }])) as Record<SourceName, { before: Map<string, Record<string, number>>; after: Map<string, Record<string, number>> }>;
  for (const name of SOURCE_NAMES) for (const period of ["before", "after"] as const) for (const route of maps[name][period].keys()) routes.add(route);
  const pages: PageReview[] = Array.from(routes).map(route => {
    const comparisons: PageReview["comparisons"] = [], gaps: string[] = [], opportunities: string[] = [];
    for (const name of SOURCE_NAMES) {
      const source = review.sources[name];
      if (!sourceCurrent(source, review, now)) { gaps.push(`${name}: ${source.data ? "saved evidence is stale" : "unavailable"}`); continue; }
      // Empty first-party counts are known zeros only when the grouped query was complete.
      const empty: Record<string, number> | undefined = name === "enquiries" && !source.data!.truncated ? { enquiries: 0, qualified: 0, quoted: 0, won: 0, disqualified: 0 } : undefined;
      const before = maps[name].before.get(route) ?? empty, after = maps[name].after.get(route) ?? empty;
      if (!before || !after) {
        gaps.push(`${name}: no matching rows in one or both periods`);
        if (before && !after && name !== "enquiries" && (before.clicks ?? before.sessions ?? 0) >= 20) {
          opportunities.push(`${name}: previously observed traffic has no matching recent rows. Check coverage, tracking and indexing before treating this as lost traffic.`);
        }
        continue;
      }
      for (const [metric, value] of Object.entries(before)) {
        const current = after[metric];
        if (typeof current !== "number" || !Number.isFinite(value) || !Number.isFinite(current)) continue;
        comparisons.push({ source: name, metric, before: value, after: current, difference: current - value,
          percentChange: value === 0 ? null : (current - value) / value * 100 });
      }
    }
    const facets = reviewFacets(comparisons);
    const up = facets.some(facet => facet.direction === "Improving" || facet.direction === "Mixed");
    const down = facets.some(facet => facet.direction === "Declining" || facet.direction === "Mixed");
    const direction: PageReview["direction"] = up && down ? "Mixed" : down ? "Declining" : up ? "Improving" :
      facets.some(facet => facet.direction === "No clear change") ? "No clear change" : "Insufficient evidence";
    const metric = (key: string) => comparisons.find(row => row.source === "search_console" && row.metric === key)?.after;
    if ((metric("impressions") ?? 0) >= 100 && (metric("ctr") ?? 1) < 0.02 && (metric("position") ?? 100) <= 20) {
      opportunities.push("Investigate search intent, query mix and competing results: exposure is not translating into many clicks.");
    }
    if (direction === "Improving" && facets.some(facet => facet.direction === "Improving" && facet.metrics.some(name => ["clicks", "sessions"].includes(name)))) {
      opportunities.push("Check customer fit and identify whether the successful approach transfers to a related page.");
    }
    const meaningful = facets.flatMap(facet => facet.metrics).length;
    return { route, direction, facets, comparisons, opportunities, gaps,
      weight: comparisons.reduce((sum, row) => sum + (isMaterialMetric(row, comparisons) ? Math.abs(row.difference) : 0), 0) + meaningful + opportunities.length };
  });
  pages.sort((a, b) => b.weight - a.weight || a.route.localeCompare(b.route));
  return { pages: pages.slice(0, 500), totalRoutes: pages.length, truncated: pages.length > 500 };
}

function reviewFacets(comparisons: PageReview["comparisons"]): PageReviewFacet[] {
  const definitions: Array<{ key: PageReviewFacet["key"]; label: string; metrics: string[] }> = [
    { key: "search", label: "Search visibility", metrics: ["clicks", "impressions", "ctr", "position"] },
    { key: "visits", label: "Visits", metrics: ["sessions"] },
    { key: "engagement", label: "Engagement", metrics: ["engagedSessions", "engagementRate"] },
    { key: "enquiries", label: "Enquiries and outcomes", metrics: ["enquiries", "qualified", "quoted", "won"] }
  ];
  return definitions.map(definition => {
    const available = comparisons.filter(row => definition.metrics.includes(row.metric));
    const movements = available.filter(row => isMaterialMetric(row, comparisons));
    const improving = movements.filter(row => metricDirection(row) > 0).map(row => row.metric);
    const declining = movements.filter(row => metricDirection(row) < 0).map(row => row.metric);
    const direction: ReviewDirection = improving.length && declining.length ? "Mixed" : declining.length ? "Declining" : improving.length ? "Improving" :
      hasEnoughFacetEvidence(definition.key, available) ? "No clear change" : "Insufficient evidence";
    return { key: definition.key, label: definition.label, direction, metrics: [...improving, ...declining] };
  });
}

function isMaterialMetric(row: PageReview["comparisons"][number], comparisons: PageReview["comparisons"]) {
  const absolute = Math.abs(row.difference), percent = Math.abs(row.percentChange ?? 0);
  if (["clicks", "sessions"].includes(row.metric)) return row.before >= 20 && absolute >= 10 && percent >= 25;
  if (row.metric === "impressions") return row.before >= 100 && absolute >= 50 && percent >= 25;
  if (row.metric === "ctr") {
    const impressions = comparisons.find(value => value.source === row.source && value.metric === "impressions");
    return Boolean(impressions && Math.max(impressions.before, impressions.after) >= 100 && absolute >= 0.01);
  }
  if (row.metric === "position") {
    const impressions = comparisons.find(value => value.source === row.source && value.metric === "impressions");
    return Boolean(impressions && Math.max(impressions.before, impressions.after) >= 100 && absolute >= 3);
  }
  if (row.metric === "engagedSessions") return Math.max(row.before, row.after) >= 10 && absolute >= 5 && percent >= 25;
  if (row.metric === "engagementRate") {
    const engaged = comparisons.find(value => value.source === row.source && value.metric === "engagedSessions");
    return Boolean(engaged && Math.max(engaged.before, engaged.after) >= 10 && absolute >= 0.05);
  }
  if (row.metric === "enquiries") return Math.max(row.before, row.after) >= 3 && absolute >= 2;
  if (["qualified", "quoted", "won"].includes(row.metric)) return absolute >= 1;
  return false;
}

function metricDirection(row: PageReview["comparisons"][number]) {
  if (row.difference === 0) return 0;
  return row.metric === "position" ? (row.difference < 0 ? 1 : -1) : row.difference > 0 ? 1 : -1;
}

function hasEnoughFacetEvidence(key: PageReviewFacet["key"], rows: PageReview["comparisons"]) {
  if (key === "search") return rows.some(row => row.metric === "impressions" && Math.max(row.before, row.after) >= 100);
  if (key === "visits") return rows.some(row => row.metric === "sessions" && Math.max(row.before, row.after) >= 20);
  if (key === "engagement") return rows.some(row => row.metric === "engagedSessions" && Math.max(row.before, row.after) >= 10);
  return rows.some(row => row.metric === "enquiries" && Math.max(row.before, row.after) >= 3);
}

export function effectivenessPacket(review: SiteReview | null, now = new Date()) {
  if (!review) return { status: "UNAVAILABLE", rule: "No site review is saved. Continue useful research; do not infer that the site is healthy." };
  const result = reviewPages(review, now);
  return { status: SOURCE_NAMES.every(name => sourceCurrent(review.sources[name], review, now)) ? "AVAILABLE" : "PARTIAL_OR_STALE",
    attemptedAt: review.attemptedAt, windows: review.windows, totalRoutes: result.totalRoutes,
    inventory: { source: review.inventory.source, observedAt: review.inventory.observedAt, count: review.inventory.routes.length },
    coverage: SOURCE_NAMES.map(name => ({ source: name, status: review.sources[name].status, observedAt: review.sources[name].observedAt,
      current: sourceCurrent(review.sources[name], review, now), capped: review.sources[name].data?.truncated ?? false })),
    findings: result.pages.filter(page => page.weight > 0).slice(0, 12),
    insufficientEvidence: result.pages.filter(page => page.direction === "Insufficient evidence").length,
    rule: "Whole-site triage, including untouched pages. Investigate causes; no automatic rewrite. Counts by submitted page are not landing-session attribution. Qualified, quoted and won are separate human-recorded statuses at observation time, not causal lift or a historical funnel. Investigate missing topics and dated competitors even without Search Console demand. Reuse active work and respect past decisions." };
}
