import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { fetchGa4LandingPageRows, fetchSearchConsoleRows } from "@/modules/website-growth/integrations";
import { resolveNewlWebsiteContext } from "@/modules/website-growth/newl-website-context-scanner";
import { DAY_MS, record, stableId } from "./model";
import { EFFECTIVENESS_JOB, SOURCE_NAMES, reviewRoute, reviewWindows, type PageMetrics, type Period, type ReviewSource, type SiteReview, type SourceData, type SourceName } from "./effectiveness-model";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const CAP = 500;
export async function loadSiteReview(tenantId: string): Promise<SiteReview | null> {
  const job = await prisma.automationJobRun.findFirst({ where: { tenantId, id: stableId(tenantId, "effectiveness"), jobType: EFFECTIVENESS_JOB }, select: { output: true } });
  return readSiteReview(job?.output);
}
function readSiteReview(value: unknown): SiteReview | null {
  const review = record(value), sources = record(review.sources);
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const windows = (value: unknown) => ["before", "after"].every(period => {
    const range = record(record(value)[period]); return date(range.startDate) && date(range.endDate);
  });
  const rows = (value: unknown) => Array.isArray(value) && value.length <= CAP && value.every(item => {
    const row = record(item); return typeof row.route === "string" && reviewRoute(row.route) === row.route &&
      row.metrics !== null && typeof row.metrics === "object" && !Array.isArray(row.metrics) && Object.values(record(row.metrics)).every(number => typeof number === "number" && Number.isFinite(number));
  });
  if (review.version !== 1 || !date(review.attemptedAt) || !date(review.nextRefreshAt) || !windows(review.windows) ||
    !Array.isArray(record(review.inventory).routes) || !(record(review.inventory).routes as unknown[]).every(route => typeof route === "string" && reviewRoute(route) === route) ||
    !SOURCE_NAMES.every(name => {
      const source = record(sources[name]), data = record(source.data);
      return ["AVAILABLE", "UNAVAILABLE", "UNBOUND"].includes(String(source.status)) && date(source.attemptedAt) &&
        (source.observedAt === null || date(source.observedAt)) &&
        (source.data === null || (windows(data.windows) && rows(data.before) && rows(data.after) && typeof data.truncated === "boolean"));
    })) return null;
  return review as unknown as SiteReview;
}

/** One recoverable refresh lease; source failure retains dated prior evidence, never an invented zero. */
export async function refreshSiteReview(tenantId: string, now = new Date()) {
  const id = stableId(tenantId, "effectiveness");
  await prisma.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id } },
    create: { id, tenantId, jobType: EFFECTIVENESS_JOB, status: "QUEUED" }, update: {} });
  const saved = await prisma.automationJobRun.findFirst({ where: { tenantId, id, jobType: EFFECTIVENESS_JOB } });
  const previous = readSiteReview(saved?.output);
  if (previous && Date.parse(previous.nextRefreshAt) > now.getTime()) return previous;
  if (saved?.status === "RUNNING" && now.getTime() - saved.startedAt.getTime() < 2 * 60_000) return previous;
  const lease = randomUUID();
  const claimed = await prisma.automationJobRun.updateMany({ where: { tenantId, id, jobType: EFFECTIVENESS_JOB,
    OR: [{ status: { not: "RUNNING" } }, { startedAt: { lte: new Date(now.getTime() - 2 * 60_000) } }],
    ...(saved ? { startedAt: saved.startedAt, status: saved.status } : {}) }, data: { status: "RUNNING", startedAt: now, input: { lease }, errorMessage: null } });
  if (claimed.count !== 1) return previous;
  const windows = reviewWindows(now), attemptedAt = now.toISOString();
  // Existing Google credentials and website inventory are deployment-bound. Never copy their data into another tenant.
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, slug: process.env.OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG?.trim() || "__unconfigured__" }, select: { id: true } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22_000);
  const fetcher: typeof fetch = (input, init) => fetch(input, { ...init, signal: controller.signal });
  try {
    const sources = Object.fromEntries(await Promise.all(SOURCE_NAMES.map(async name => {
      const prior = previous?.sources[name];
      if (name !== "enquiries" && !tenant) return [name, { status: "UNBOUND", attemptedAt, observedAt: null, data: null } satisfies ReviewSource];
      try {
        const periods = await Promise.all([readPeriod(tenantId, name, windows.before, fetcher), readPeriod(tenantId, name, windows.after, fetcher)]);
        const data: SourceData = { windows, before: periods[0].rows, after: periods[1].rows, truncated: periods.some(period => period.truncated) };
        return [name, { status: "AVAILABLE", attemptedAt, observedAt: attemptedAt, data } satisfies ReviewSource];
      } catch {
        return [name, { status: "UNAVAILABLE", attemptedAt, observedAt: prior?.observedAt ?? null, data: prior?.data ?? null } satisfies ReviewSource];
      }
    }))) as SiteReview["sources"];
    let inventory: SiteReview["inventory"] = tenant ? previous?.inventory ?? { routes: [], source: "unavailable", observedAt: null } : { routes: [], source: "unbound", observedAt: null };
    if (tenant) {
      try {
        const context = await resolveNewlWebsiteContext();
        const evidence = context.siteInventory;
        inventory = { routes: [...new Set((evidence?.routes ?? []).map(row => reviewRoute(row.path)).filter((route): route is string => Boolean(route)))].slice(0, CAP),
          source: evidence?.source ?? "unavailable", observedAt: evidence?.scannedAt ?? null };
      } catch { /* Retain the dated inventory; analytics can still reveal pages. */ }
    }
    const review: SiteReview = { version: 1, attemptedAt, windows, sources, inventory,
      nextRefreshAt: new Date(now.getTime() + (SOURCE_NAMES.every(name => sources[name].status === "AVAILABLE") ? DAY_MS : 6 * 60 * 60_000)).toISOString() };
    const changed = await prisma.automationJobRun.updateMany({ where: { tenantId, id, jobType: EFFECTIVENESS_JOB,
      input: { path: ["lease"], equals: lease } }, data: { status: "SUCCESS", finishedAt: new Date(), output: json(review) } });
    return changed.count === 1 ? review : loadSiteReview(tenantId);
  } finally { clearTimeout(timer); }
}

async function readPeriod(tenantId: string, name: SourceName, range: Period, fetcher: typeof fetch) {
  const pages = new Map<string, Record<string, number>>();
  let capped = false;
  const add = (value: unknown, metrics: Record<string, number>) => {
    const route = reviewRoute(value);
    if (!route) return;
    const current = pages.get(route) ?? {};
    for (const [key, number] of Object.entries(metrics)) if (Number.isFinite(number)) current[key] = (current[key] ?? 0) + number;
    pages.set(route, current);
  };
  if (name === "search_console") {
    const rows = await fetchSearchConsoleRows({ ...range, dimensions: ["page"], fetcher });
    capped = rows.length >= 25_000;
    for (const row of rows) {
      const metrics: Record<string, number> = {};
      if (typeof row.clicks === "number") metrics.clicks = row.clicks;
      if (typeof row.impressions === "number") metrics.impressions = row.impressions;
      if (typeof row.position === "number" && typeof row.impressions === "number") { metrics.positionTotal = row.position * row.impressions; metrics.positionWeight = row.impressions; }
      add(row.keys?.[0], metrics);
    }
    for (const metrics of pages.values()) {
      if (metrics.impressions > 0 && typeof metrics.clicks === "number") metrics.ctr = metrics.clicks / metrics.impressions;
      if (metrics.positionWeight > 0) metrics.position = metrics.positionTotal / metrics.positionWeight;
      delete metrics.positionTotal; delete metrics.positionWeight;
    }
  } else if (name === "ga4") {
    const rows = await fetchGa4LandingPageRows({ ...range, fetcher });
    capped = rows.length >= 10_000;
    for (const row of rows) add(row.page, { sessions: row.sessions, engagedSessions: row.engagedSessions });
    for (const metrics of pages.values()) if (metrics.sessions > 0) metrics.engagementRate = metrics.engagedSessions / metrics.sessions;
  } else {
    const rows = await prisma.websiteInboundSubmission.groupBy({ by: ["pageUrl", "status"],
      where: { tenantId, entryMethod: "WEBSITE_FORM", formType: { not: "account_setup" }, status: { not: "TEST" }, isTest: false,
        marketingExcludedReason: null, createdAt: {
        gte: new Date(range.startDate + "T00:00:00Z"), lt: new Date(Date.parse(range.endDate) + DAY_MS) } },
      _count: { _all: true }, orderBy: { pageUrl: "asc" }, take: 5001 });
    capped = rows.length >= 5001;
    for (const row of rows) {
      const count = row._count._all;
      add(row.pageUrl, { enquiries: count, qualified: row.status === "QUALIFIED" ? count : 0, quoted: row.status === "QUOTE_SENT" ? count : 0,
        won: row.status === "WON" ? count : 0, disqualified: row.status === "DISQUALIFIED" ? count : 0 });
    }
  }
  const rows: PageMetrics[] = Array.from(pages, ([route, metrics]) => ({ route, metrics }))
    .sort((a, b) => (b.metrics.clicks ?? b.metrics.sessions ?? b.metrics.enquiries ?? 0) - (a.metrics.clicks ?? a.metrics.sessions ?? a.metrics.enquiries ?? 0) || a.route.localeCompare(b.route));
  return { rows: rows.slice(0, CAP), truncated: capped || rows.length > CAP };
}
