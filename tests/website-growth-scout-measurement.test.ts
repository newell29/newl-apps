import { beforeEach, describe, expect, it, vi } from "vitest";
import { measureScoutPage, measurementWindows } from "@/modules/website-growth/scout/measurement";
const mocks = vi.hoisted(() => ({ search: vi.fn(), ga4: vi.fn(), inbound: vi.fn() }));
vi.mock("@/modules/website-growth/integrations", () => ({ fetchSearchConsoleRows: mocks.search, fetchGa4LandingPageRows: mocks.ga4 }));
vi.mock("@/server/db", () => ({ prisma: { websiteInboundSubmission: { groupBy: mocks.inbound } } }));
const published = new Date("2026-05-01T15:00:00Z"), now = new Date("2026-06-15T12:00:00Z");
beforeEach(() => vi.resetAllMocks());
describe("Scout per-change measurement", () => {
  it("uses fixed full windows excluding the publication day and allows reporting lag", () => {
    const windows = measurementWindows(published, now);
    expect(windows.before).toEqual({ startDate: "2026-04-03", endDate: "2026-04-30" });
    expect(windows.after).toEqual({ startDate: "2026-05-02", endDate: "2026-05-29" });
    expect(windows.readyAt).toBe("2026-06-02T00:00:00.000Z");
  });
  it("does not query incomplete windows", async () => {
    expect((await measureScoutPage("tenant-a", "/services/warehouse", published, new Date("2026-05-10"))).status).toBe("WAITING_FOR_DATA");
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it("preserves partial evidence without inventing zeros or including another route", async () => {
    mocks.search.mockRejectedValue(new Error("Unavailable"));
    mocks.ga4.mockResolvedValue([{ page: "/services/warehouse", sessions: 40, engagedSessions: 20 }, { page: "/unrelated", sessions: 900, engagedSessions: 500 }]);
    mocks.inbound.mockResolvedValue([{ pageUrl: "https://example.com/services/warehouse", _count: { _all: 2 } }]);
    const result = await measureScoutPage("tenant-a", "/services/warehouse", published, now);
    expect(result.status).toBe("PARTIAL_OR_MISSING");
    expect(result.sources.filter(row => row.source === "search_console").every(row => row.metrics === null)).toBe(true);
    expect(result.sources.find(row => row.source === "ga4")?.metrics).toEqual({ sessions: 40, engagedSessions: 20, engagementRate: 0.5 });
    expect(mocks.inbound).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a", entryMethod: "WEBSITE_FORM", formType: { not: "account_setup" } }) }));
    expect(result.caveat).toContain("not causal");
  });
  it("reports completely missing evidence explicitly", async () => {
    mocks.search.mockRejectedValue(new Error("Unavailable")); mocks.ga4.mockRejectedValue(new Error("Unavailable")); mocks.inbound.mockRejectedValue(new Error("Unavailable"));
    const result = await measureScoutPage("tenant-a", "/services/warehouse", published, now);
    expect(result.sources).toHaveLength(6);
    expect(result.sources.every(row => row.metrics === null && row.status === "UNAVAILABLE")).toBe(true);
  });
  it("distinguishes successful empty analytics from a successful zero enquiry count", async () => {
    mocks.search.mockResolvedValue([]); mocks.ga4.mockResolvedValue([]); mocks.inbound.mockResolvedValue([]);
    const result = await measureScoutPage("tenant-a", "/services/warehouse", published, now);
    expect(result.sources.find(row => row.source === "search_console")?.status).toBe("NO_MATCHING_ROWS");
    expect(result.sources.find(row => row.source === "enquiries")?.metrics).toEqual({ enquiries: 0, excludedDiagnosticEnquiries: 0 });
  });
  it("calculates comparable changes, weighted search position and rate metrics without dividing by zero", async () => {
    mocks.search.mockResolvedValueOnce([{ keys: ["https://example.com/services/warehouse"], clicks: 0, impressions: 100, position: 8 }])
      .mockResolvedValueOnce([{ keys: ["https://example.com/services/warehouse"], clicks: 10, impressions: 100, position: 4 },
        { keys: ["https://example.com/services/warehouse/"], clicks: 5, impressions: 50, position: 10 }]);
    mocks.ga4.mockResolvedValueOnce([{ page: "/services/warehouse", sessions: 100, engagedSessions: 50 }]).mockRejectedValueOnce(new Error("Unavailable"));
    mocks.inbound.mockResolvedValue([]);
    const result = await measureScoutPage("tenant-a", "/services/warehouse", published, now);
    expect(result.sources.find(row => row.source === "search_console" && row.period === "after")?.metrics).toEqual({ clicks: 15, impressions: 150, ctr: 0.1, position: 6 });
    expect(result.changes?.find(row => row.metric === "clicks")).toMatchObject({ difference: 15, percentChange: null });
    expect(result.changes?.some(row => row.source === "ga4")).toBe(false);
  });
  it("gives a deferred review new evidence with a later equal-length window and the original baseline", () => {
    const windows = measurementWindows(published, now, true);
    expect(windows.before).toEqual(measurementWindows(published, now).before);
    expect(windows.after).toEqual({ startDate: "2026-05-16", endDate: "2026-06-12" });
  });
  it("separates explicitly marked diagnostics from real enquiries and analytics without excluding ordinary attribution parameters", async () => {
    mocks.search.mockResolvedValue([]);
    mocks.ga4.mockResolvedValue([{ page: "/resources/contact?codex_weekly_diagnostic=synthetic", sessions: 20, engagedSessions: 10 },
      { page: "/resources/contact?utm_source=example", sessions: 8, engagedSessions: 4 }]);
    mocks.inbound.mockResolvedValue([{ pageUrl: "https://example.com/resources/contact?codex_weekly_diagnostic=synthetic", _count: { _all: 9 } },
      { pageUrl: "https://example.com/resources/contact?utm_source=example", _count: { _all: 2 } }, { pageUrl: null, _count: { _all: 5 } }]);
    const result = await measureScoutPage("tenant-a", "/resources/contact", published, now);
    expect(result.sources.find(row => row.source === "enquiries")?.metrics).toEqual({ enquiries: 2, excludedDiagnosticEnquiries: 9 });
    expect(result.sources.find(row => row.source === "ga4")?.metrics?.sessions).toBe(8);
  });
});
