import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateIngestionRequestMock = vi.hoisted(() => vi.fn());
const authenticateIngestionCronRequestMock = vi.hoisted(() => vi.fn());
const syncTmgEmailIntakeMock = vi.hoisted(() => vi.fn());
const getTmgOrderIntakeSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/ingestion-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/ingestion-auth")>("@/server/ingestion-auth");
  return {
    ...actual,
    authenticateIngestionRequest: authenticateIngestionRequestMock,
    authenticateIngestionCronRequest: authenticateIngestionCronRequestMock
  };
});

vi.mock("@/modules/shipment-documents/tmg-email-intake", async () => {
  const actual = await vi.importActual<typeof import("@/modules/shipment-documents/tmg-email-intake")>(
    "@/modules/shipment-documents/tmg-email-intake"
  );
  return { ...actual, syncTmgEmailIntake: syncTmgEmailIntakeMock };
});

vi.mock("@/modules/shipment-documents/tmg-settings", () => ({
  getTmgOrderIntakeSettings: getTmgOrderIntakeSettingsMock
}));

import { GET, POST } from "@/app/api/operations/tmg-order-intake/scheduled/route";

const tenant = { tenantId: "tenant-1", tenantSlug: "synthetic", tenantName: "Synthetic Tenant" };

describe("scheduled TMG email intake route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateIngestionRequestMock.mockResolvedValue(tenant);
    authenticateIngestionCronRequestMock.mockResolvedValue(tenant);
    getTmgOrderIntakeSettingsMock.mockResolvedValue({ enabled: true, configured: true });
    syncTmgEmailIntakeMock.mockResolvedValue({
      scannedMessageCount: 4,
      candidateMessageCount: 1,
      results: [],
      failures: []
    });
  });

  it("keeps the existing POST route on ingestion authentication", async () => {
    const response = await POST(new Request("https://newl.test/api/operations/tmg-order-intake/scheduled", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(authenticateIngestionRequestMock).toHaveBeenCalledTimes(1);
    expect(authenticateIngestionCronRequestMock).not.toHaveBeenCalled();
    expect(syncTmgEmailIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", userId: "system:tmg-email-intake", role: "ADMIN" }),
      { triggerSource: "SCHEDULED" }
    );
  });

  it("uses dedicated cron authentication for Vercel GET invocations", async () => {
    const response = await GET(new Request("https://newl.test/api/operations/tmg-order-intake/scheduled"));

    expect(response.status).toBe(200);
    expect(authenticateIngestionCronRequestMock).toHaveBeenCalledTimes(1);
    expect(authenticateIngestionRequestMock).not.toHaveBeenCalled();
  });

  it("returns a safe no-op while tenant configuration is disabled", async () => {
    getTmgOrderIntakeSettingsMock.mockResolvedValue({ enabled: false, configured: false });

    const response = await GET(new Request("https://newl.test/api/operations/tmg-order-intake/scheduled"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { skipped: true, reason: "TMG order intake is not enabled and fully configured." }
    });
    expect(syncTmgEmailIntakeMock).not.toHaveBeenCalled();
  });
});
