import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewWindows, reviewRoute, reviewPages, effectivenessPacket, type SiteReview, type SourceName } from "@/modules/website-growth/scout/effectiveness-model";
import { refreshSiteReview, loadSiteReview } from "@/modules/website-growth/scout/effectiveness";
const mocks = vi.hoisted(() => ({ job: vi.fn(), upsert: vi.fn(), update: vi.fn(), tenant: vi.fn(), enquiries: vi.fn(), gsc: vi.fn(), ga4: vi.fn(), inventory: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { automationJobRun: { findFirst: mocks.job, upsert: mocks.upsert, updateMany: mocks.update }, tenant: { findFirst: mocks.tenant }, websiteInboundSubmission: { groupBy: mocks.enquiries } } }));
vi.mock("@/modules/website-growth/integrations", () => ({ fetchSearchConsoleRows: mocks.gsc, fetchGa4LandingPageRows: mocks.ga4 }));
vi.mock("@/modules/website-growth/newl-website-context-scanner", () => ({ resolveNewlWebsiteContext: mocks.inventory }));
const now = new Date("2026-06-15T12:00:00Z"), route = "/services/warehouse";
function review(): SiteReview {
  const windows = reviewWindows(now);
  const source = () => ({ status: "AVAILABLE" as const, attemptedAt: now.toISOString(), observedAt: now.toISOString(), data: { windows, before: [], after: [], truncated: false } });
  return { version: 1, attemptedAt: now.toISOString(), nextRefreshAt: now.toISOString(), windows,
    sources: { search_console: source(), ga4: source(), enquiries: source() }, inventory: { routes: [route], source: "static", observedAt: null } };
}
function traffic(value: SiteReview, source: SourceName, before: Record<string, number>, after: Record<string, number>) {
  value.sources[source].data!.before = [{ route, metrics: before }]; value.sources[source].data!.after = [{ route, metrics: after }];
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG", "synthetic");
  mocks.job.mockResolvedValue({ status: "QUEUED", startedAt: new Date("2026-01-01"), output: null });
  mocks.update.mockResolvedValue({ count: 1 }); mocks.tenant.mockResolvedValue({ id: "tenant-a" });
  mocks.gsc.mockResolvedValue([]); mocks.ga4.mockResolvedValue([]); mocks.enquiries.mockResolvedValue([]);
  mocks.inventory.mockResolvedValue({ siteInventory: { source: "static", routes: [{ path: route }], scannedAt: null } });
});
describe("whole-site review evidence", () => {
  it("uses complete non-overlapping 28-day periods with reporting delay", () => {
    expect(reviewWindows(now)).toEqual({ before: { startDate: "2026-04-18", endDate: "2026-05-15" }, after: { startDate: "2026-05-16", endDate: "2026-06-12" } });
  });
  it("normalizes ordinary query parameters and rejects diagnostic and malformed routes", () => {
    expect(reviewRoute("https://example.com/services/warehouse/?utm_source=search")).toBe(route);
    for (const value of ["//evil.example/path", "/test?codex_weekly_diagnostic=1", "not-a-route", "/bad\\path"]) expect(reviewRoute(value)).toBeNull();
  });
  it("finds declines and gains, allows contradictory sources, and ignores tiny-volume swings", () => {
    const value = review(); traffic(value, "search_console", { clicks: 100 }, { clicks: 50 });
    expect(reviewPages(value, now).pages[0].direction).toBe("Declining");
    traffic(value, "ga4", { sessions: 100 }, { sessions: 150 });
    expect(reviewPages(value, now).pages[0].direction).toBe("Mixed");
    traffic(value, "search_console", { clicks: 2 }, { clicks: 1 }); traffic(value, "ga4", { sessions: 3 }, { sessions: 1 });
    expect(reviewPages(value, now).pages[0].direction).toBe("Insufficient evidence");
  });
  it("does not turn completely missing or partially missing analytics into zero traffic", () => {
    const value = review();
    expect(reviewPages(value, now).pages[0].comparisons.map(row => row.metric)).toEqual(["enquiries", "qualified", "quoted", "won", "disqualified"]);
    value.sources.search_console.data!.before = [{ route, metrics: { clicks: 80 } }];
    expect(reviewPages(value, now).pages[0].direction).toBe("Insufficient evidence");
    value.sources.enquiries.status = "UNAVAILABLE";
    expect(reviewPages(value, now).pages[0].comparisons).toEqual([]);
  });
  it("excludes retained stale evidence from current movements, including mismatched windows", () => {
    const value = review(); traffic(value, "search_console", { clicks: 100 }, { clicks: 10 });
    value.sources.search_console.status = "UNAVAILABLE";
    expect(reviewPages(value, now).pages[0].direction).toBe("Insufficient evidence");
    value.sources.search_console.status = "AVAILABLE"; value.sources.search_console.data!.windows = reviewWindows(new Date("2026-01-01"));
    expect(effectivenessPacket(value, now).status).toBe("PARTIAL_OR_STALE");
    expect(reviewPages(value, now).pages[0].comparisons.some(row => row.source === "search_console")).toBe(false);
  });
  it("finds exposure opportunities without prescribing a rewrite or inventing percentage lift", () => {
    const value = review(); traffic(value, "search_console", { clicks: 0, impressions: 500, ctr: 0, position: 9 }, { clicks: 5, impressions: 500, ctr: 0.01, position: 9 });
    const page = reviewPages(value, now).pages[0]; expect(page.opportunities).toHaveLength(1);
    expect(page.comparisons.find(row => row.metric === "clicks")?.percentChange).toBeNull();
    expect(effectivenessPacket(value, now).rule).toContain("no automatic rewrite");
  });
  it("does not invent zero enquiries when a capped report omitted a page", () => {
    const value = review(); value.sources.enquiries.data!.truncated = true;
    expect(reviewPages(value, now).pages[0].comparisons).toEqual([]);
  });
});
describe("refresh recovery and isolation", () => {
  it("retains failed source evidence and refreshes the other sources independently", async () => {
    const saved = review(); traffic(saved, "search_console", { clicks: 10 }, { clicks: 20 });
    mocks.job.mockResolvedValue({ status: "SUCCESS", startedAt: new Date("2026-01-01"), output: saved });
    mocks.gsc.mockRejectedValue(new Error("private integration detail"));
    const result = await refreshSiteReview("tenant-a", now);
    expect(result!.sources.search_console).toMatchObject({ status: "UNAVAILABLE", data: saved.sources.search_console.data });
    expect(result!.sources.ga4.status).toBe("AVAILABLE"); expect(JSON.stringify(result)).not.toContain("private integration detail");
    expect(result!.nextRefreshAt).toBe("2026-06-15T18:00:00.000Z");
  });
  it("saves explicit gaps when every source fails, with no fabricated counts", async () => {
    mocks.gsc.mockRejectedValue(new Error("gsc")); mocks.ga4.mockRejectedValue(new Error("ga4")); mocks.enquiries.mockRejectedValue(new Error("database"));
    const result = await refreshSiteReview("tenant-a", now);
    expect(Object.values(result!.sources).every(source => source.status === "UNAVAILABLE" && source.data === null)).toBe(true);
    expect(reviewPages(result!, now).pages[0].comparisons).toEqual([]);
  });
  it("does not expose deployment Google data or Newl inventory to another tenant", async () => {
    mocks.tenant.mockResolvedValue(null);
    const result = await refreshSiteReview("tenant-b", now);
    expect(mocks.gsc).not.toHaveBeenCalled(); expect(mocks.ga4).not.toHaveBeenCalled(); expect(mocks.inventory).not.toHaveBeenCalled();
    expect(result!.sources.search_console.status).toBe("UNBOUND");
    expect(mocks.enquiries).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-b", entryMethod: "WEBSITE_FORM" }) }));
    expect(mocks.update.mock.calls.every(([query]) => query.where.tenantId === "tenant-b")).toBe(true);
  });
  it("reuses fresh reports and a running lease without duplicating provider reads", async () => {
    const saved = review(); saved.nextRefreshAt = "2026-06-16T12:00:00Z";
    mocks.job.mockResolvedValue({ output: saved }); expect(await refreshSiteReview("tenant-a", now)).toEqual(saved);
    mocks.job.mockResolvedValue({ status: "RUNNING", startedAt: now, output: null }); expect(await refreshSiteReview("tenant-a", now)).toBeNull();
    expect(mocks.gsc).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("recovers an expired lease but does not write after losing lease ownership", async () => {
    mocks.job.mockResolvedValue({ status: "RUNNING", startedAt: new Date("2026-06-15T11:00:00Z"), output: null });
    mocks.update.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await refreshSiteReview("tenant-a", now)).toBeNull();
    expect(mocks.update.mock.calls[1][0].where.input.path).toEqual(["lease"]);
  });
  it("stops a concurrent refresh that loses the initial compare-and-swap", async () => {
    mocks.update.mockResolvedValue({ count: 0 }); await refreshSiteReview("tenant-a", now);
    expect(mocks.gsc).not.toHaveBeenCalled();
  });
  it("aggregates canonical paths and separate human statuses without leaking inbound identity", async () => {
    mocks.enquiries.mockResolvedValue([{ pageUrl: route + "?utm_source=test", status: "QUALIFIED", _count: { _all: 2 } },
      { pageUrl: route, status: "WON", _count: { _all: 1 } }, { pageUrl: route + "?codex_weekly_diagnostic=1", status: "NEW", _count: { _all: 9 } }]);
    const result = await refreshSiteReview("tenant-a", now);
    expect(result!.sources.enquiries.data!.after).toEqual([{ route, metrics: { enquiries: 3, qualified: 2, quoted: 0, won: 1, disqualified: 0 } }]);
    expect(mocks.enquiries.mock.calls[0][0].by).toEqual(["pageUrl", "status"]);
  });
  it("loads only the authenticated tenant snapshot", async () => {
    await loadSiteReview("tenant-a"); expect(mocks.job.mock.calls[0][0].where.tenantId).toBe("tenant-a");
  });
});

it("surfaces disappeared traffic as an investigation without zero-filling missing recent rows", () => {
  const value = review(); value.sources.search_console.data!.before = [{ route, metrics: { clicks: 100 } }];
  const page = reviewPages(value, now).pages[0];
  expect(page.opportunities[0]).toContain("no matching recent rows");
  expect(page.comparisons.some(row => row.metric === "clicks")).toBe(false);
  expect(effectivenessPacket(value, now)).toMatchObject({ findings: [expect.objectContaining({ route })] });
});

it("treats malformed or incompatible saved snapshots as unavailable instead of crashing the review", async () => {
  for (const output of [{ version: 2 }, { ...review(), sources: { search_console: {} } }, { ...review(), nextRefreshAt: "invalid" }]) {
    mocks.job.mockResolvedValue({ output }); expect(await loadSiteReview("tenant-a")).toBeNull();
  }
});
