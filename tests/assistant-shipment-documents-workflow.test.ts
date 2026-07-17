import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSourceKind, ModuleKey, PlatformRole } from "@prisma/client";

const requireModule = vi.fn();
const syncedOrderCount = vi.fn();
const dailySyncRunFindFirst = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    teamshipSyncedOrder: {
      count: (...args: unknown[]) => syncedOrderCount(...args)
    },
    teamshipDailySyncRun: {
      findFirst: (...args: unknown[]) => dailySyncRunFindFirst(...args)
    }
  }
}));

vi.mock("@/server/auth/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/authorization")>();

  return {
    ...actual,
    requireModule: (...args: unknown[]) => requireModule(...args)
  };
});

import { maybeRunAssistantShipmentDocumentsRequest } from "@/modules/assistant/shipment-documents-workflow";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "user-1",
  userEmail: "admin@newl.ca",
  userName: "Admin User",
  role: PlatformRole.ADMIN,
  memberships: []
};

describe("maybeRunAssistantShipmentDocumentsRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T14:00:00.000Z"));
    requireModule.mockResolvedValue(undefined);
    syncedOrderCount.mockResolvedValue(18);
    dailySyncRunFindFirst.mockResolvedValue({
      id: "sync-1",
      status: "SUCCESS",
      fetchedCount: 18,
      insertedCount: 2,
      updatedCount: 16,
      skippedCount: 0,
      startedAt: new Date("2026-07-17T13:55:00.000Z"),
      finishedAt: new Date("2026-07-17T13:56:00.000Z"),
      errorMessage: null
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers Garland shipment counts from tenant-scoped synced Teamship orders", async () => {
    const result = await maybeRunAssistantShipmentDocumentsRequest(context, "how many shipments did Garland have today?");

    expect(requireModule).toHaveBeenCalledWith(context, ModuleKey.SHIPMENT_DOCUMENTS);
    expect(syncedOrderCount).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        shipmentDate: new Date("2026-07-17T00:00:00.000Z")
      }
    });
    expect(dailySyncRunFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        shipmentDate: new Date("2026-07-17T00:00:00.000Z")
      },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        fetchedCount: true,
        insertedCount: true,
        updatedCount: true,
        skippedCount: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true
      }
    });
    expect(result?.answer).toContain("Garland has 18 Teamship shipments stored for today (2026-07-17, America/Toronto).");
    expect(result?.sources[0]).toMatchObject({
      sourceKind: AssistantSourceKind.OTHER,
      sourceId: "teamship-synced-orders:2026-07-17",
      title: "Garland Teamship synced shipment count"
    });
    expect(result?.runMetadata).toMatchObject({
      shipmentDocumentsHandled: true,
      shipmentDate: "2026-07-17",
      shipmentCount: 18
    });
  });

  it("ignores non-Garland shipment prompts so other assistant tools can handle them", async () => {
    const result = await maybeRunAssistantShipmentDocumentsRequest(context, "how many shipments did UPS have today?");

    expect(result).toBeNull();
    expect(syncedOrderCount).not.toHaveBeenCalled();
  });
});
