import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSourceKind, ModuleKey, PlatformRole } from "@prisma/client";

const requireModule = vi.fn();
const syncedOrderCount = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    teamshipSyncedOrder: {
      count: (...args: unknown[]) => syncedOrderCount(...args)
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers Garland shipment counts from tenant-scoped automatically processed email orders", async () => {
    const result = await maybeRunAssistantShipmentDocumentsRequest(context, "how many shipments did Garland have today?");

    expect(requireModule).toHaveBeenCalledWith(context, ModuleKey.SHIPMENT_DOCUMENTS);
    expect(syncedOrderCount).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        shipmentDate: new Date("2026-07-17T00:00:00.000Z")
      }
    });
    expect(result?.answer).toContain("Garland has 18 Teamship shipments from automatically processed Garland emails for today (2026-07-17, America/Toronto).");
    expect(result?.sources[0]).toMatchObject({
      sourceKind: AssistantSourceKind.OTHER,
      sourceId: "garland-email-orders:2026-07-17",
      title: "Garland email order count"
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
