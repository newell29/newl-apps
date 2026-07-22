import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  shipmentCarrierManifestRun: {
    findMany: vi.fn(),
    count: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import { getGarlandCarrierManifestHistory } from "@/modules/shipment-documents/carrier-manifest-queries";

describe("Carrier manifest history", () => {
  it("lists a legacy signed copy and every additional PDF on the saved run", async () => {
    prismaMock.shipmentCarrierManifestRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        documentLabel: "July 22, 2026",
        shipmentDate: new Date("2026-07-22T00:00:00.000Z"),
        sourceBolFileName: "bols.pdf",
        carrierCounts: { MIDLAND: 2, SPEEDY: 1, SURETRACK: 0 },
        midlandWorkbookBytes: new Uint8Array([1]),
        speedyWorkbookBytes: new Uint8Array([2]),
        suretrackWorkbookBytes: null,
        signedCopyFileName: "original-signed.pdf",
        signedCopyUploadedAt: new Date("2026-07-22T15:00:00.000Z"),
        attachments: [
          {
            id: "attachment-1",
            fileName: "additional-page.pdf",
            createdAt: new Date("2026-07-22T16:00:00.000Z")
          }
        ],
        createdAt: new Date("2026-07-22T14:00:00.000Z"),
        createdBy: { name: "Alex", email: "alex@example.com" }
      }
    ]);
    prismaMock.shipmentCarrierManifestRun.count.mockResolvedValue(1);

    const result = await getGarlandCarrierManifestHistory({
      tenantId: "tenant-1",
      userId: "user-1",
      userEmail: "alex@example.com",
      userName: "Alex",
      role: "OPERATIONS",
      tenantSlug: "newl",
      tenantName: "Newl"
    });

    expect(result.runs[0]?.attachments).toEqual([
      {
        id: null,
        fileName: "original-signed.pdf",
        uploadedAt: "2026-07-22T15:00:00.000Z",
        isLegacySignedCopy: true
      },
      {
        id: "attachment-1",
        fileName: "additional-page.pdf",
        uploadedAt: "2026-07-22T16:00:00.000Z",
        isLegacySignedCopy: false
      }
    ]);
    expect(prismaMock.shipmentCarrierManifestRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          workflowKey: "GARLAND_CARRIER_MANIFEST",
          deletedAt: null
        },
        select: expect.objectContaining({
          attachments: expect.objectContaining({ where: { uploadComplete: true } })
        })
      })
    );
  });
});
