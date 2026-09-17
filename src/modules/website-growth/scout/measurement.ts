import { fetchGa4LandingPageRows, fetchSearchConsoleRows } from "@/modules/website-growth/integrations";
import { prisma } from "@/server/db";
import { DAY_MS, routePath } from "./model";

export function measurementWindows(publishedAt: Date, now = new Date(), followUp = false) {
  const day = new Date(publishedAt.toISOString().slice(0, 10) + "T00:00:00Z");
  const date = (offset: number) => new Date(day.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
  const end = followUp ? Math.max(28, Math.floor((now.getTime() - day.getTime()) / DAY_MS) - 3) : 28;
  return { before: { startDate: date(-28), endDate: date(-1) }, after: { startDate: date(end - 27), endDate: date(end) },
    readyAt: new Date(day.getTime() + 32 * DAY_MS).toISOString(), ready: now.getTime() >= day.getTime() + 32 * DAY_MS };
}

/** Independent sources, fixed non-overlapping windows, and no zero substitution for unavailable evidence. */
export async function measureScoutPage(tenantId: string, route: string, publishedAt: Date, now = new Date(), followUp = false) {
  const windows = measurementWindows(publishedAt, now, followUp);
  if (!windows.ready) return { windows, status: "WAITING_FOR_DATA", sources: [], caveat: "The post-publication window is not complete." };
  const sources = await Promise.all(["before", "after"].flatMap((period) => {
    const range = windows[period as "before" | "after"];
    return [
      source("search_console", period, async () => {
        const rows = await fetchSearchConsoleRows({ ...range, dimensions: ["page"] });
        const matched = rows.filter(row => safePath(row.keys?.[0]) === route && !isDiagnosticPage(row.keys?.[0]));
        if (!matched.length) return null;
        const clicks = matched.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
        const impressions = matched.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
        return { clicks, impressions, ...(impressions > 0 ? { ctr: clicks / impressions,
          ...(matched.every(row => typeof row.position === "number") ? { position: matched.reduce((sum, row) => sum + row.position! * (row.impressions ?? 0), 0) / impressions } : {}) } : {}) };
      }),
      source("ga4", period, async () => {
        const rows = await fetchGa4LandingPageRows(range);
        const matched = rows.filter(row => safePath(row.page) === route && !isDiagnosticPage(row.page));
        if (!matched.length) return null;
        const sessions = matched.reduce((sum, row) => sum + row.sessions, 0), engagedSessions = matched.reduce((sum, row) => sum + row.engagedSessions, 0);
        return { sessions, engagedSessions, ...(sessions > 0 ? { engagementRate: engagedSessions / sessions } : {}) };
      }),
      source("enquiries", period, async () => {
        const rows = await prisma.websiteInboundSubmission.groupBy({ by: ["pageUrl"],
          where: { tenantId, entryMethod: "WEBSITE_FORM", formType: { not: "account_setup" }, createdAt: {
            gte: new Date(range.startDate + "T00:00:00Z"), lt: new Date(Date.parse(range.endDate + "T00:00:00Z") + DAY_MS) } },
          _count: { _all: true } });
        const matched = rows.filter(row => safePath(row.pageUrl) === route);
        return { enquiries: matched.filter(row => !isDiagnosticPage(row.pageUrl)).reduce((sum, row) => sum + row._count._all, 0),
          excludedDiagnosticEnquiries: matched.filter(row => isDiagnosticPage(row.pageUrl)).reduce((sum, row) => sum + row._count._all, 0) };
      })
    ];
  }));
  const changes = sources.filter(row => row.period === "before" && row.metrics).flatMap(before => {
    const after = sources.find(row => row.source === before.source && row.period === "after");
    if (!after?.metrics) return [];
    return Object.entries(before.metrics!).flatMap(([metric, value]) => {
      const current = after.metrics![metric];
      return typeof current === "number" ? [{ source: before.source, metric, before: value, after: current,
        difference: current - value, percentChange: value === 0 ? null : (current - value) / value * 100 }] : [];
    });
  });
  return { windows, observedAt: now.toISOString(), followUp, status: sources.every(row => row.status === "AVAILABLE") ? "AVAILABLE" : "PARTIAL_OR_MISSING", sources, changes,
    caveat: "Observed before/after association, not causal lift. Enquiries exclude explicitly tagged diagnostic URLs; untagged tests and spam may remain. Enquiries are not qualified leads or session-attributed conversions. Google reads use the configured site/property and capped page reports. Consider traffic volume, seasonality, and other site changes." };
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
function isDiagnosticPage(value: string | null | undefined) {
  if (!value) return false;
  try { return new URL(value, "https://example.com").searchParams.has("codex_weekly_diagnostic"); } catch { return false; }
}
