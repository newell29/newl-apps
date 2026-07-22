import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  shipmentCarrierManifestRun: {
    findFirst: vi.fn()
  },
  shipmentCarrierManifestAttachment: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    role: "OPERATIONS",
    tenantSlug: "newl",
    tenantName: "Newl"
  }))
}));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: vi.fn(async () => undefined),
  requireMutationAccess: vi.fn(async () => undefined)
}));
import { POST } from "@/app/api/shipment-documents/carrier-manifest/runs/[runId]/attachments/route";
import { GET } from "@/app/api/shipment-documents/carrier-manifest/runs/[runId]/attachments/[attachmentId]/route";
import { POST as POST_CHUNK } from "@/app/api/shipment-documents/carrier-manifest/runs/[runId]/attachments/[attachmentId]/chunks/route";

describe("Carrier manifest PDF attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shipmentCarrierManifestRun.findFirst.mockResolvedValue({ id: "run-1" });
    prismaMock.shipmentCarrierManifestAttachment.create.mockResolvedValue({ id: "attachment-1" });
    prismaMock.shipmentCarrierManifestAttachment.update.mockResolvedValue({ id: "attachment-1" });
  });

  it("adds another PDF to a tenant-scoped saved run", async () => {
    const firstChunk = Buffer.alloc(1024 * 1024);
    firstChunk.write("%PDF-1.7\nadditional signed manifest");
    const finalChunk = Buffer.from("final PDF bytes");
    const pdfBytes = Buffer.concat([firstChunk, finalChunk]);
    const response = await POST(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs/run-1/attachments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "second-signed-copy.pdf",
          contentType: "application/pdf",
          sizeBytes: pdfBytes.byteLength
        })
      }),
      { params: Promise.resolve({ runId: "run-1" }) }
    );

    expect(response.status).toBe(201);
    expect(prismaMock.shipmentCarrierManifestRun.findFirst).toHaveBeenCalledWith({
      where: { id: "run-1", tenantId: "tenant-1", deletedAt: null },
      select: { id: true }
    });
    expect(prismaMock.shipmentCarrierManifestAttachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        runId: "run-1",
        fileName: "second-signed-copy.pdf",
        contentType: "application/pdf",
        sizeBytes: pdfBytes.byteLength,
        fileBytes: Buffer.alloc(0),
        uploadComplete: false,
        uploadedByUserId: "user-1"
      }),
      select: { id: true }
    });

    prismaMock.shipmentCarrierManifestAttachment.findFirst
      .mockResolvedValueOnce({
        id: "attachment-1",
        sizeBytes: pdfBytes.byteLength,
        fileBytes: Buffer.alloc(0),
        uploadComplete: false
      })
      .mockResolvedValueOnce({
        id: "attachment-1",
        sizeBytes: pdfBytes.byteLength,
        fileBytes: firstChunk,
        uploadComplete: false
      });
    const firstChunkResponse = await POST_CHUNK(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs/run-1/attachments/attachment-1/chunks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chunkBase64: firstChunk.toString("base64"), chunkIndex: 0, isLast: false })
      }),
      { params: Promise.resolve({ runId: "run-1", attachmentId: "attachment-1" }) }
    );
    const finalChunkResponse = await POST_CHUNK(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs/run-1/attachments/attachment-1/chunks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chunkBase64: finalChunk.toString("base64"), chunkIndex: 1, isLast: true })
      }),
      { params: Promise.resolve({ runId: "run-1", attachmentId: "attachment-1" }) }
    );

    expect(firstChunkResponse.status).toBe(200);
    expect(finalChunkResponse.status).toBe(200);
    expect(prismaMock.shipmentCarrierManifestAttachment.update).toHaveBeenLastCalledWith({
      where: { id: "attachment-1" },
      data: { fileBytes: pdfBytes, uploadComplete: true }
    });
  });

  it("rejects a renamed non-PDF before completing the attachment", async () => {
    const plainText = Buffer.from("plain text");
    prismaMock.shipmentCarrierManifestAttachment.findFirst.mockResolvedValue({
      id: "attachment-1",
      sizeBytes: plainText.byteLength,
      fileBytes: Buffer.alloc(0),
      uploadComplete: false
    });

    const response = await POST_CHUNK(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs/run-1/attachments/attachment-1/chunks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chunkBase64: plainText.toString("base64"),
          chunkIndex: 0,
          isLast: true
        })
      }),
      { params: Promise.resolve({ runId: "run-1", attachmentId: "attachment-1" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "The uploaded file is not a valid PDF." });
    expect(prismaMock.shipmentCarrierManifestAttachment.update).not.toHaveBeenCalled();
  });

  it("downloads only an attachment belonging to the requested run and tenant", async () => {
    const pdfBytes = Buffer.from("%PDF-1.7\nsaved attachment");
    prismaMock.shipmentCarrierManifestAttachment.findFirst.mockResolvedValue({
      fileName: "extra.pdf",
      contentType: "application/pdf",
      fileBytes: pdfBytes
    });

    const response = await GET(
      new Request("https://newl.test/api/shipment-documents/carrier-manifest/runs/run-1/attachments/attachment-1"),
      { params: Promise.resolve({ runId: "run-1", attachmentId: "attachment-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="extra.pdf"');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfBytes);
    expect(prismaMock.shipmentCarrierManifestAttachment.findFirst).toHaveBeenCalledWith({
      where: {
        id: "attachment-1",
        runId: "run-1",
        tenantId: "tenant-1",
        uploadComplete: true,
        run: { tenantId: "tenant-1", deletedAt: null }
      },
      select: { fileName: true, contentType: true, fileBytes: true }
    });
  });
});
