import { describe, expect, it, vi, beforeEach } from "vitest";

const getAuthenticatedContextMock = vi.hoisted(() => vi.fn());
const authenticateIngestionRequestMock = vi.hoisted(() => vi.fn());
const syncShipmentInquiryOutlookIntakeForUserMock = vi.hoisted(() => vi.fn());
const syncShipmentInquiryOutlookIntakeMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: getAuthenticatedContextMock
}));
vi.mock("@/server/ingestion-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/ingestion-auth")>("@/server/ingestion-auth");

  return {
    ...actual,
    authenticateIngestionRequest: authenticateIngestionRequestMock
  };
});
vi.mock("@/modules/shipment-inquiries/outlook-intake", async () => {
  const actual = await vi.importActual<typeof import("@/modules/shipment-inquiries/outlook-intake")>(
    "@/modules/shipment-inquiries/outlook-intake"
  );

  return {
    ...actual,
    syncShipmentInquiryOutlookIntakeForUser: syncShipmentInquiryOutlookIntakeForUserMock,
    syncShipmentInquiryOutlookIntake: syncShipmentInquiryOutlookIntakeMock
  };
});

import { POST as postManual } from "@/app/api/shipment-inquiries/outlook-intake/route";
import { POST as postScheduled } from "@/app/api/shipment-inquiries/outlook-intake/scheduled/route";

describe("shipment inquiry Outlook intake routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks unauthorized manual access before syncing", async () => {
    getAuthenticatedContextMock.mockRejectedValue(new Error("No authenticated session."));

    const response = await postManual(
      new Request("https://newl.test/api/shipment-inquiries/outlook-intake", { method: "POST" })
    );

    expect(response.status).toBe(502);
    expect(syncShipmentInquiryOutlookIntakeForUserMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "No authenticated session." });
  });

  it("runs scheduled intake through ingestion-token authentication", async () => {
    authenticateIngestionRequestMock.mockResolvedValue({
      tenantId: "tenant-a",
      tenantSlug: "newl-group",
      tenantName: "Newl Group"
    });
    syncShipmentInquiryOutlookIntakeMock.mockResolvedValue({
      folderPath: "Inbox/Automation",
      mailboxCount: 2,
      messageCount: 2,
      createdCount: 2,
      skippedDuplicateCount: 0,
      failureCount: 0,
      mailboxes: []
    });

    const response = await postScheduled(
      new Request("https://newl.test/api/shipment-inquiries/outlook-intake/scheduled", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ maxMessagesPerMailbox: 25 })
      })
    );

    expect(response.status).toBe(200);
    expect(authenticateIngestionRequestMock).toHaveBeenCalledTimes(1);
    expect(syncShipmentInquiryOutlookIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        userId: "system:shipment-inquiry-outlook-intake",
        role: "ADMIN"
      }),
      expect.objectContaining({
        maxMessagesPerMailbox: 25,
        triggerSource: "SCHEDULED"
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        tenant: { slug: "newl-group" },
        folderPath: "Inbox/Automation",
        createdCount: 2
      }
    });
  });
});
