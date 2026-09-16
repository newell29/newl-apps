import { fetchGa4LandingPageRows, fetchSearchConsoleRows } from "@/modules/website-growth/integrations";
import { prisma } from "@/server/db";
import { DAY_MS, routePath } from "./model";

export function measurementWindows(publishedAt: Date, now = new Date()) {
  const day = new Date(publishedAt.toISOString().slice(0, 10) + "T00:00:00Z");
  const date = (offset: number) => new Date(day.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
  return { before: { startDate: date(-28), endDate: date(-1) }, after: { startDate: date(1), endDate: date(28) },
    readyAt: new Date(day.getTime() + 32 * DAY_MS).toISOString(), ready: now.getTime() >= day.getTime() + 32 * DAY_MS };
}

/** Independent sources, fixed non-overlapping windows, and no zero substitution for unavailable evidence. */
export async function measureScoutPage(tenantId: string, route: string, publishedAt: Date, now = new Date()) {
  const windows = measurementWindows(publishedAt, now);
  if (!windows.ready) return { windows, status: "WAITING_FOR_DATA", sources: [], caveat: "The post-publication window is not complete." };
  const sources = await Promise.all(["before", "after"].flatMap((period) => {
    const range = windows[period as "before" | "after"];
    return [
      source("search_console", period, async () => {
        const rows = await fetchSearchConsoleRows({ ...range, dimensions: ["page"] });
        const matched = rows.filter(row => safePath(row.keys?.[0]) === route);
        return matched.length ? { clicks: matched.reduce((sum, row) => sum + (row.clicks ?? 0), 0),
          impressions: matched.reduce((sum, row) => sum + (row.impressions ?? 0), 0) } : null;
      }),
      source("ga4", period, async () => {
        const rows = await fetchGa4LandingPageRows(range);
        const matched = rows.filter(row => safePath(row.page) === route);
        return matched.length ? { sessions: matched.reduce((sum, row) => sum + row.sessions, 0),
          engagedSessions: matched.reduce((sum, row) => sum + row.engagedSessions, 0) } : null;
      }),
      source("enquiries", period, async () => {
        const rows = await prisma.websiteInboundSubmission.groupBy({ by: ["pageUrl"],
          where: { tenantId, entryMethod: "WEBSITE_FORM", formType: { not: "account_setup" }, createdAt: {
            gte: new Date(range.startDate + "T00:00:00Z"), lt: new Date(Date.parse(range.endDate + "T00:00:00Z") + DAY_MS) } },
          _count: { _all: true } });
        return { enquiries: rows.filter(row => safePath(row.pageUrl) === route).reduce((sum, row) => sum + row._count._all, 0) };
      })
    ];
  }));
  return { windows, status: sources.every(row => row.status === "AVAILABLE") ? "AVAILABLE" : "PARTIAL_OR_MISSING", sources,
    caveat: "Observed before/after association, not causal lift. Enquiries are not qualified leads. Consider traffic volume, seasonality, and other site changes." };
}
async function source(name: string, period: string, read: () => Promise<Record<string, number> | null>) {
  try {
    const metrics = await read();
    return { source: name, period, status: metrics ? "AVAILABLE" : "NO_MATCHING_ROWS", metrics };
  } catch {
    return { source: name, period, status: "UNAVAILABLE", metrics: null };
  }
}
function safePath(value: string | null | undefined) {
  try { return routePath(value?.split("?")[0]); } catch { return null; }
}
