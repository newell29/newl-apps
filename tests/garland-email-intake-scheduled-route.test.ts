import { describe, expect, it, vi } from "vitest";

const authenticateIngestionRequestMock = vi.hoisted(() => vi.fn());
const syncGarlandEmailIntakeMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/ingestion-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/ingestion-auth")>("@/server/ingestion-auth");

  return {
    ...actual,
    authenticateIngestionRequest: authenticateIngestionRequestMock
  };
});

vi.mock("@/modules/shipment-documents/garland-email-intake", async () => {
  const actual = await vi.importActual<typeof import("@/modules/shipment-documents/garland-email-intake")>(
    "@/modules/shipment-documents/garland-email-intake"
  );

  return {
    ...actual,
    syncGarlandEmailIntake: syncGarlandEmailIntakeMock
  };
});

import { POST } from "@/app/api/shipment-documents/teamship-review/email-intake/scheduled/route";

describe("scheduled Garland email intake route", () => {
  it("uses ingestion auth and runs the Garland email sync as a scheduled machine job", async () => {
    authenticateIngestionRequestMock.mockResolvedValue({
      tenantId: "tenant-1",
      tenantSlug: "newl",
      tenantName: "Newl"
    });
    syncGarlandEmailIntakeMock.mockResolvedValue({
      run: {
        id: "run-1",
        status: "SUCCESS",
        mailboxAddress: "warehouse@newl.ca",
        triggerSource: "SCHEDULED"
      },
      messageCount: 12,
      candidateMessageCount: 8,
      storedCount: 8,
      createdCount: 2,
      updatedCount: 6,
      attachmentsFetched: 4,
      attachmentsStored: 4,
      duplicateAttachmentCount: 1,
      attachmentErrors: 0,
      failures: []
    });

    const response = await POST(
      new Request("https://newl.test/api/shipment-documents/teamship-review/email-intake/scheduled", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          lookbackDays: 7,
          maxMessagesPerMailbox: 100
        })
      })
    );

    expect(response.status).toBe(200);
    expect(authenticateIngestionRequestMock).toHaveBeenCalledTimes(1);
    expect(syncGarlandEmailIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "system:garland-email-intake",
        role: "ADMIN"
      }),
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: null,
        lookbackDays: 7,
        maxMessagesPerMailbox: 100,
        triggerSource: "SCHEDULED"
      })
    );

    await expect(response.json()).resolves.toMatchObject({
      data: {
        tenant: {
          slug: "newl"
        },
        sync: {
          runId: "run-1",
          status: "SUCCESS",
          triggerSource: "SCHEDULED",
          storedAttachmentCount: 4,
          duplicateAttachmentCount: 1
        }
      }
    });
  });
});
