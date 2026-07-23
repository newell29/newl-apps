import { describe, expect, it, vi, beforeEach } from "vitest";

const getAuthenticatedContextMock = vi.hoisted(() => vi.fn());
const authenticateIngestionRequestMock = vi.hoisted(() => vi.fn());
const processForUserMock = vi.hoisted(() => vi.fn());
const processScheduledMock = vi.hoisted(() => vi.fn());

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
vi.mock("@/modules/shipment-inquiries/outlook-processor", async () => {
  const actual = await vi.importActual<typeof import("@/modules/shipment-inquiries/outlook-processor")>(
    "@/modules/shipment-inquiries/outlook-processor"
  );
  return {
    ...actual,
    processShipmentInquiryOutlookJobsForUser: processForUserMock,
    processShipmentInquiryOutlookJobs: processScheduledMock
  };
});

describe("shipment inquiry Outlook processor routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processForUserMock.mockResolvedValue({ attemptedCount: 0 });
    processScheduledMock.mockResolvedValue({ attemptedCount: 0 });
    getAuthenticatedContextMock.mockResolvedValue({
      tenantId: "tenant-a",
      tenantSlug: "newl-group",
      tenantName: "Newl Group",
      userId: "user-a",
      userEmail: "pricing@newl.ca",
      userName: "Pricing User",
      role: "ADMIN"
    });
    authenticateIngestionRequestMock.mockResolvedValue({
      tenantId: "tenant-a",
      tenantSlug: "newl-group",
      tenantName: "Newl Group"
    });
  });

  it("manual route requires authenticated context before processing", async () => {
    getAuthenticatedContextMock.mockRejectedValue(new Error("not authenticated"));
    const route = await import("@/app/api/shipment-inquiries/outlook-processor/route");

    const response = await route.POST(new Request("https://newl-apps.test/api/shipment-inquiries/outlook-processor"));

    expect(response.status).toBe(502);
    expect(processForUserMock).not.toHaveBeenCalled();
  });

  it("scheduled route uses ingestion auth and system tenant context", async () => {
    const route = await import("@/app/api/shipment-inquiries/outlook-processor/scheduled/route");

    const response = await route.POST(
      new Request("https://newl-apps.test/api/shipment-inquiries/outlook-processor/scheduled", {
        method: "POST",
        body: JSON.stringify({ limit: 2 })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(authenticateIngestionRequestMock).toHaveBeenCalled();
    expect(processScheduledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        userId: "system:shipment-inquiry-outlook-processor"
      }),
      expect.objectContaining({ limit: 2, triggerSource: "SCHEDULED" })
    );
    expect(body.data.tenant).toBe("newl-group");
  });
});
