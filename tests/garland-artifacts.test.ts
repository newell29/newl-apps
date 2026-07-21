import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  workflowArtifact: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  workflowArtifactChunk: { upsert: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));
vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import {
  createGarlandArtifact,
  resolveGarlandReviewShipmentDate,
  saveGarlandArtifactChunk,
  WORKFLOW_ARTIFACT_CHUNK_BYTES
} from "@/modules/assistant/garland-artifacts";
import type { AuthenticatedContext } from "@/server/tenant-context";

const context: AuthenticatedContext = {
  tenantId: "tenant-1",
  tenantSlug: "newl",
  tenantName: "Newl",
  userId: "user-1",
  userEmail: "employee@newl.ca",
  userName: "Employee",
  role: "OPERATIONS"
};

describe("Garland workflow artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.workflowArtifact.create.mockResolvedValue({ id: "artifact-1", status: "UPLOADING" });
    prismaMock.workflowArtifact.findFirst.mockImplementation(async ({ where }) =>
      where.sourceIdempotencyKey
        ? null
        : { id: "artifact-1", status: "UPLOADING", chunkCount: 1 }
    );
    prismaMock.workflowArtifactChunk.upsert.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
  });

  it("creates tenant-scoped Teams PDF storage with the exact required chunk count", async () => {
    await createGarlandArtifact(context, {
      fileName: "Garland orders.pdf",
      contentType: "application/pdf",
      sizeBytes: WORKFLOW_ARTIFACT_CHUNK_BYTES + 1,
      chunkCount: 2,
      contentHash: "a".repeat(64),
      sourceChannel: "TEAMS",
      externalMessageId: "message-1"
    });

    expect(prismaMock.workflowArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          submittedByUserId: "user-1",
          chunkCount: 2,
          contentHash: "a".repeat(64),
          sourceChannel: "TEAMS"
        })
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "assistant.garland_artifact.create" }) })
    );
  });

  it("reuses the same Teams message and file instead of storing duplicate PDF chunks", async () => {
    prismaMock.workflowArtifact.findFirst.mockResolvedValue({
      id: "artifact-existing",
      status: "REVIEWED",
      contentHash: "b".repeat(64)
    });

    const result = await createGarlandArtifact(context, {
      fileName: "Garland orders.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      chunkCount: 1,
      contentHash: "b".repeat(64),
      sourceChannel: "TEAMS",
      externalMessageId: "message-1",
      externalConversationId: "conversation-1"
    });

    expect(result).toMatchObject({ id: "artifact-existing", status: "REVIEWED" });
    expect(prismaMock.workflowArtifact.create).not.toHaveBeenCalled();
  });

  it("stores each chunk with tenant scope and a content hash", async () => {
    const result = await saveGarlandArtifactChunk(
      context,
      "artifact-1",
      0,
      new Uint8Array([1, 2, 3])
    );

    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prismaMock.workflowArtifact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-1", id: "artifact-1" }) })
    );
    expect(prismaMock.workflowArtifactChunk.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_artifactId_chunkIndex: {
            tenantId: "tenant-1",
            artifactId: "artifact-1",
            chunkIndex: 0
          }
        }
      })
    );
  });

  it("rejects a chunk when the declared integrity hash is wrong", async () => {
    await expect(
      saveGarlandArtifactChunk(context, "artifact-1", 0, new Uint8Array([1, 2, 3]), "0".repeat(64))
    ).rejects.toThrow("hash does not match");
    expect(prismaMock.workflowArtifactChunk.upsert).not.toHaveBeenCalled();
  });

  it("derives one shipment date from the PDF or Teamship and rejects ambiguity", () => {
    const pdfOrder = {
      items: [{ dueShipDate: "7/21/2026" }]
    } as never;
    expect(resolveGarlandReviewShipmentDate(null, [pdfOrder], [])).toBe("2026-07-21");
    expect(() => resolveGarlandReviewShipmentDate(null, [pdfOrder], [
      { shipment_date: "2026-07-22" }
    ])).toThrow("more than one shipment date");
    expect(resolveGarlandReviewShipmentDate("2026-07-23", [pdfOrder], [])).toBe("2026-07-23");
  });
});
