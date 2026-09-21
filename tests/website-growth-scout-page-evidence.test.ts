import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  websiteGrowthDataImport: { findFirst: vi.fn() },
  websiteGrowthContentDraft: { findMany: vi.fn() },
  websiteGrowthMetric: { findMany: vi.fn() }
}));
vi.mock("@/server/db", () => ({ prisma: db }));

import { loadScoutPageEvidence } from "@/modules/website-growth/scout/page-evidence";

const before = { startDate: "2026-07-01", endDate: "2026-07-28" };
const after = { startDate: "2026-07-29", endDate: "2026-08-25" };
const metric = (query: string, period: typeof before, clicks: number, impressions: number, position: number, createdAt = "2026-08-26T12:00:00Z", page = "https://www.newlgroup.com/services/fulfillment-services?utm_source=ignored") => ({
  query,
  page,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
  dateRangeStart: new Date(`${period.startDate}T00:00:00Z`),
  dateRangeEnd: new Date(`${period.endDate}T00:00:00Z`),
  createdAt: new Date(createdAt)
});

beforeEach(() => {
  vi.resetAllMocks();
  db.websiteGrowthDataImport.findFirst.mockResolvedValue({ completedAt: new Date("2026-08-26T12:00:00Z"), createdAt: new Date("2026-08-26T11:59:00Z"), summary: { previousPeriod: before, currentPeriod: after } });
  db.websiteGrowthContentDraft.findMany.mockResolvedValue([{ id: "draft-synthetic", title: "Fulfillment update", proposedPath: "/services/fulfillment-services", targetPage: null, publishedAt: new Date("2026-07-15T12:00:00Z") }]);
  db.websiteGrowthMetric.findMany.mockImplementation(async ({ where }: { where: { dateRangeStart: Date } }) =>
    where.dateRangeStart.toISOString().startsWith(before.startDate)
      ? [metric("best pick and pack warehouse", before, 0, 50, 18)]
      : [metric("best pick and pack warehouse", after, 0, 93, 14.1), metric("irrelevant host", after, 2, 500, 2, "2026-08-26T12:00:00Z", "https://www.newlgroup.com/services/warehousing")]
  );
});

describe("Scout page evidence", () => {
  it("supplies matched before/after query evidence and recorded deployment dates from the authenticated tenant", async () => {
    const evidence = await loadScoutPageEvidence("tenant-a", "/services/fulfillment-services");
    expect(evidence.searchQueries).toMatchObject({ status: "AVAILABLE", windows: { before, after } });
    expect(evidence.searchQueries.rows).toEqual([expect.objectContaining({
      query: "best pick and pack warehouse",
      before: expect.objectContaining({ impressions: 50, position: 18 }),
      after: expect.objectContaining({ impressions: 93, position: 14.1 }),
      changes: expect.objectContaining({ impressions: 43 })
    })]);
    expect(evidence.searchQueries.rows[0].changes.position).toBeCloseTo(-3.9);
    expect(evidence.deployments).toEqual([expect.objectContaining({ draftId: "draft-synthetic", publishedAt: "2026-07-15T12:00:00.000Z" })]);
    expect(db.websiteGrowthMetric.findMany.mock.calls.every(([query]) => query.where.tenantId === "tenant-a")).toBe(true);
  });

  it("keeps missing saved comparisons explicit instead of inventing zero rows", async () => {
    db.websiteGrowthDataImport.findFirst.mockResolvedValue(null);
    const evidence = await loadScoutPageEvidence("tenant-b", "/services/example");
    expect(evidence.searchQueries.status).toBe("UNAVAILABLE");
    expect(evidence.searchQueries.rows).toEqual([]);
    expect(db.websiteGrowthMetric.findMany).not.toHaveBeenCalled();
  });
});
