import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformRole } from "@prisma/client";
import type { AuthenticatedContext } from "@/server/tenant-context";

const findMany = vi.fn();
const count = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    shipmentDocumentRun: {
      findMany: (...args: unknown[]) => findMany(...args),
      count: (...args: unknown[]) => count(...args)
    }
  }
}));

import {
  buildShipmentDocumentRunSearchText,
  getShipmentDocumentRunHistory
} from "@/modules/shipment-documents/queries";

const context: AuthenticatedContext = {
  userId: "user-1",
  userEmail: "user@example.com",
  userName: "User",
  role: PlatformRole.OPERATIONS,
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  tenantName: "Tenant One"
};

describe("shipment document queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([
      {
        id: "run-1",
        workflowKey: "GARLAND_CANADA",
        documentLabel: "June 26 2026",
        shipmentDate: new Date("2026-06-26T00:00:00.000Z"),
        recipientEmail: "customer@example.com",
        sourceBolFileName: "June 26 2026 BOL's.pdf",
        sourcePickTicketFileName: "June 26 2026 Pick-tickets.pdf",
        outputBolFileName: "June 26 2026 BOLs.pdf",
        outputPickTicketFileName: "June 26 2026 Pick Tickets.pdf",
        bolPageCount: 10,
        pickTicketPageCount: 10,
        bolAiFallbackPageCount: 1,
        pickAiFallbackPageCount: 0,
        bolPsNumbers: ["PS100001", "PS100010"],
        pickPsNumbers: ["PS100001", "PS100010"],
        createdAt: new Date("2026-06-26T22:15:00.000Z"),
        createdBy: {
          name: "CSR User",
          email: "csr@example.com"
        }
      }
    ]);
    count.mockResolvedValue(1);
  });

  it("scopes history lookups to the tenant and workflow with search support", async () => {
    await getShipmentDocumentRunHistory(context, { search: "PS100001" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          workflowKey: "GARLAND_CANADA",
          deletedAt: null,
          OR: expect.any(Array)
        })
      })
    );
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: "tenant-1",
        workflowKey: "GARLAND_CANADA",
        deletedAt: null,
        OR: expect.any(Array)
      })
    });
  });

  it("builds a searchable text blob from run metadata and PS numbers", () => {
    expect(
      buildShipmentDocumentRunSearchText({
        documentLabel: "June 26 2026",
        shipmentDate: "2026-06-26",
        recipientEmail: "customer@example.com",
        sourceBolFileName: "June 26 2026 BOL's.pdf",
        sourcePickTicketFileName: "June 26 2026 Pick-tickets.pdf",
        bolPsNumbers: ["PS100001", "PS100010"],
        pickPsNumbers: ["PS100001", "PS100010"]
      })
    ).toContain("PS100001");
  });
});
