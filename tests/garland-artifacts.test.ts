import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  workflowArtifact: { create: vi.fn(), findFirst: vi.fn() },
  workflowArtifactChunk: { upsert: vi.fn() }
}));
vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import {
  createGarlandArtifact,
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
    prismaMock.workflowArtifact.findFirst.mockResolvedValue({ id: "artifact-1", status: "UPLOADING", chunkCount: 1 });
    prismaMock.workflowArtifactChunk.upsert.mockResolvedValue({});
  });

  it("creates tenant-scoped Teams PDF storage with the exact required chunk count", async () => {
    await createGarlandArtifact(context, {
      fileName: "Garland orders.pdf",
      contentType: "application/pdf",
      sizeBytes: WORKFLOW_ARTIFACT_CHUNK_BYTES + 1,
      chunkCount: 2,
      sourceChannel: "TEAMS",
      externalMessageId: "message-1"
    });

    expect(prismaMock.workflowArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          submittedByUserId: "user-1",
          chunkCount: 2,
          sourceChannel: "TEAMS"
        })
      })
    );
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
});
