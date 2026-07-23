import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformRole } from "@prisma/client";
import type { AuthenticatedContext } from "@/server/tenant-context";

const prismaMock = vi.hoisted(() => ({
  shipmentCarrierManifestRun: {
    findMany: vi.fn(),
    count: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({
  prisma: prismaMock
}));

import { getGarlandCarrierManifestHistory } from "@/modules/shipment-documents/carrier-manifest-queries";

const context: AuthenticatedContext = {
  userId: "user-1",
  userEmail: "ops@example.com",
  userName: "Ops User",
  role: PlatformRole.OPERATIONS,
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  tenantName: "Tenant One"
};

describe("Garland carrier manifest history queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shipmentCarrierManifestRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        documentLabel: "July 23, 2026",
        shipmentDate: new Date("2026-07-23T00:00:00.000Z"),
        sourceBolFileName: "Garland BOLs.pdf",
        carrierCounts: {
          MIDLAND: 2,
          SPEEDY: 1
        },
        midlandWorkbookBytes: new Uint8Array([1]),
        speedyWorkbookBytes: null,
        suretrackWorkbookBytes: new Uint8Array([2]),
        signedCopyFileName: "signed.pdf",
        signedCopyUploadedAt: new Date("2026-07-23T17:30:00.000Z"),
        attachments: [
          {
            id: "attachment-1",
            fileName: "dock-copy.pdf",
            createdAt: new Date("2026-07-23T18:30:00.000Z")
          }
        ],
        createdAt: new Date("2026-07-23T16:00:00.000Z"),
        createdBy: {
          name: "CSR User",
          email: "csr@example.com"
        }
      }
    ]);
    prismaMock.shipmentCarrierManifestRun.count.mockResolvedValue(1);
  });

  it("loads saved manifest history scoped to the tenant and Garland carrier workflow", async () => {
    const history = await getGarlandCarrierManifestHistory(context, { take: 500 });

    expect(prismaMock.shipmentCarrierManifestRun.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        workflowKey: "GARLAND_CARRIER_MANIFEST",
        deletedAt: null
      },
      orderBy: [{ shipmentDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: expect.objectContaining({
        id: true,
        carrierCounts: true,
        midlandWorkbookBytes: true,
        speedyWorkbookBytes: true,
        suretrackWorkbookBytes: true,
        attachments: expect.any(Object)
      })
    });
    expect(prismaMock.shipmentCarrierManifestRun.count).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        workflowKey: "GARLAND_CARRIER_MANIFEST",
        deletedAt: null
      }
    });
    expect(history.runs[0]).toMatchObject({
      id: "run-1",
      documentLabel: "July 23, 2026",
      shipmentDate: "2026-07-23T00:00:00.000Z",
      sourceBolFileName: "Garland BOLs.pdf",
      carrierCounts: {
        MIDLAND: 2,
        SPEEDY: 1,
        SURETRACK: 0
      },
      createdAt: "2026-07-23T16:00:00.000Z",
      createdByName: "CSR User",
      hasMidlandWorkbook: true,
      hasSpeedyWorkbook: false,
      hasSuretrackWorkbook: true,
      signedCopyFileName: "signed.pdf",
      signedCopyUploadedAt: "2026-07-23T17:30:00.000Z",
      attachments: [
        {
          id: null,
          fileName: "signed.pdf",
          uploadedAt: "2026-07-23T17:30:00.000Z",
          isLegacySignedCopy: true
        },
        {
          id: "attachment-1",
          fileName: "dock-copy.pdf",
          uploadedAt: "2026-07-23T18:30:00.000Z",
          isLegacySignedCopy: false
        }
      ]
    });
    expect(history.totalCount).toBe(1);
  });
});
