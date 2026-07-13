import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  teamshipReviewRun: {
    findMany: vi.fn(),
    count: vi.fn()
  },
  teamshipReviewOrder: {
    findMany: vi.fn(),
    updateMany: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  prisma: prismaMock
}));

import { getTeamshipReviewHistory } from "@/modules/shipment-documents/teamship-review-history";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context = {
  tenantId: "tenant-1",
  userId: "user-1",
  role: "OPERATIONS",
  tenantSlug: "newl",
  tenantName: "Newl"
} satisfies AuthenticatedContext;

describe("Teamship review history", () => {
  beforeEach(() => {
    prismaMock.teamshipReviewRun.findMany.mockResolvedValue([]);
    prismaMock.teamshipReviewRun.count.mockResolvedValue(0);
    vi.clearAllMocks();
  });

  it("searches saved runs across the requested shipment date range", async () => {
    const history = await getTeamshipReviewHistory(context, {
      search: "SR808478",
      dateFrom: "2026-07-12",
      dateTo: "2026-07-10",
      take: 500
    });

    expect(history).toMatchObject({
      search: "SR808478",
      dateFrom: "2026-07-10",
      dateTo: "2026-07-12",
      allDates: false,
      totalCount: 0
    });
    expect(prismaMock.teamshipReviewRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        where: expect.objectContaining({
          tenantId: "tenant-1",
          workflowKey: "GARLAND_TEAMSHIP_REVIEW",
          deletedAt: null,
          shipmentDate: {
            gte: new Date("2026-07-10T00:00:00.000Z"),
            lte: new Date("2026-07-12T23:59:59.999Z")
          },
          OR: expect.arrayContaining([
            {
              searchText: {
                contains: "SR808478",
                mode: "insensitive"
              }
            },
            {
              orders: {
                some: {
                  OR: expect.arrayContaining([
                    {
                      srNumber: {
                        contains: "SR808478",
                        mode: "insensitive"
                      }
                    }
                  ])
                }
              }
            }
          ])
        })
      })
    );
  });

  it("can search across all saved run dates without a shipment date filter", async () => {
    const history = await getTeamshipReviewHistory(context, {
      search: "READY_TO_PRINT",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-12",
      allDates: true
    });
    const findManyArgs = prismaMock.teamshipReviewRun.findMany.mock.calls[0]?.[0];

    expect(history).toMatchObject({
      search: "READY_TO_PRINT",
      dateFrom: "",
      dateTo: "",
      allDates: true
    });
    expect(findManyArgs?.where).not.toHaveProperty("shipmentDate");
    expect(findManyArgs?.where).toMatchObject({
      tenantId: "tenant-1",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      deletedAt: null
    });
  });
});
