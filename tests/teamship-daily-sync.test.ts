import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamshipShippingOrderDetail } from "@/modules/shipment-documents/teamship-review-types";

const fetchTeamshipShippingOrdersForReviewMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  teamshipDailySyncRun: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn()
  },
  teamshipSyncedOrder: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    count: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  prisma: prismaMock
}));

vi.mock("@/server/integrations/teamship", () => ({
  fetchTeamshipShippingOrdersForReview: fetchTeamshipShippingOrdersForReviewMock
}));

vi.mock("@/server/integrations/teamship-settings", () => ({
  getTeamshipSyncEnabledCredentials: vi.fn()
}));

import { syncTeamshipDailyOrders } from "@/modules/shipment-documents/teamship-daily-sync";

const teamshipOrder: TeamshipShippingOrderDetail = {
  id: "teamship-1",
  shipment_id: "SR812345",
  carrier: "MIDLAND",
  ship_to_name: "Garland Test Customer",
  ship_to_city: "Toronto",
  ship_to_state: "ON",
  url: "https://app.teamshipos.com/orders/teamship-1",
  pallets: [{ quantity: 1, weight: 220 }]
};

describe("Teamship daily sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.teamshipDailySyncRun.create.mockResolvedValue({ id: "sync-run-1" });
    prismaMock.teamshipDailySyncRun.update.mockResolvedValue({});
    prismaMock.teamshipSyncedOrder.upsert.mockResolvedValue({});
    prismaMock.teamshipSyncedOrder.count.mockResolvedValue(1);
    fetchTeamshipShippingOrdersForReviewMock.mockResolvedValue([teamshipOrder]);
  });

  it("skips existing records when Teamship data has not changed", async () => {
    prismaMock.teamshipSyncedOrder.findMany.mockResolvedValue([
      {
        syncKey: "SR812345",
        srNumber: "SR812345",
        teamshipOrderId: "teamship-1",
        teamshipUrl: "https://app.teamshipos.com/orders/teamship-1",
        carrier: "MIDLAND",
        shipToName: "Garland Test Customer",
        city: "Toronto",
        state: "ON",
        rawOrder: teamshipOrder
      }
    ]);

    const result = await syncTeamshipDailyOrders({
      tenantId: "tenant-1",
      shipmentDate: "2026-07-11",
      triggerSource: "CRON"
    });

    expect(prismaMock.teamshipSyncedOrder.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      fetchedCount: 1,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 1
    });
    expect(prismaMock.teamshipDailySyncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCESS",
          updatedCount: 0,
          skippedCount: 1
        })
      })
    );
  });

  it("updates existing records when Teamship data changes", async () => {
    prismaMock.teamshipSyncedOrder.findMany.mockResolvedValue([
      {
        syncKey: "SR812345",
        srNumber: "SR812345",
        teamshipOrderId: "teamship-1",
        teamshipUrl: "https://app.teamshipos.com/orders/teamship-1",
        carrier: "OLD CARRIER",
        shipToName: "Garland Test Customer",
        city: "Toronto",
        state: "ON",
        rawOrder: {
          ...teamshipOrder,
          carrier: "OLD CARRIER"
        }
      }
    ]);

    const result = await syncTeamshipDailyOrders({
      tenantId: "tenant-1",
      shipmentDate: "2026-07-11",
      triggerSource: "CRON"
    });

    expect(prismaMock.teamshipSyncedOrder.upsert).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      fetchedCount: 1,
      insertedCount: 0,
      updatedCount: 1,
      skippedCount: 0
    });
  });
});
