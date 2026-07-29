import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  teamshipReviewOrder: { findMany: vi.fn() },
  workflowArtifact: { findMany: vi.fn(), create: vi.fn() },
  operationalFeedback: { findFirst: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import {
  listGarlandFeedbackEvidenceOptions,
  saveOperationalFeedbackEvidence
} from "@/modules/assistant/operational-feedback-evidence";

describe("operational feedback evidence", () => {
  it("lists only exact tenant-scoped saved Garland checks and their stored source PDF", async () => {
    prismaMock.teamshipReviewOrder.findMany.mockResolvedValue([{
      id: "review-order-1",
      runId: "review-run-1",
      psNumber: "PS123456",
      srNumber: "SR812345",
      status: "FAIL",
      pageNumbers: [1, 2],
      createdAt: new Date("2026-07-29T12:00:00Z"),
      run: {
        documentLabel: "Synthetic batch",
        sourcePdfFileName: "synthetic-orders.pdf",
        shipmentDate: new Date("2026-07-29T00:00:00Z")
      }
    }]);
    prismaMock.workflowArtifact.findMany.mockResolvedValue([{
      id: "source-pdf-1",
      teamshipReviewRunId: "review-run-1"
    }]);

    const result = await listGarlandFeedbackEvidenceOptions(
      { tenantId: "tenant-1" },
      "PS123456"
    );

    expect(prismaMock.teamshipReviewOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          psNumber: "PS123456"
        })
      })
    );
    expect(result).toEqual([
      expect.objectContaining({
        reviewOrderId: "review-order-1",
        artifactId: "source-pdf-1",
        pageNumbers: [1, 2],
        hasStoredSourcePdf: true
      })
    ]);
  });

  it("stores a validated screenshot in existing artifact storage and links it to pending feedback", async () => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.operationalFeedback.findFirst.mockResolvedValue({
      id: "feedback-1",
      workflowKey: "GARLAND_TEAMSHIP_REVIEW",
      status: "REPORTED",
      artifactId: null
    });
    prismaMock.workflowArtifact.create.mockResolvedValue({
      id: "evidence-1",
      fileName: "support.png",
      contentType: "image/png",
      sizeBytes: 8,
      contentHash: "hash"
    });
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await saveOperationalFeedbackEvidence(
      { tenantId: "tenant-1", userId: "admin-1" },
      "feedback-1",
      {
        fileName: "support.png",
        contentType: "image/png",
        bytes: pngSignature
      }
    );

    expect(prismaMock.workflowArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          workflowKey: "GARLAND_TEAMSHIP_REVIEW",
          status: "EVIDENCE_READY",
          chunks: {
            create: expect.objectContaining({
              chunkIndex: 0,
              bytes: Buffer.from(pngSignature)
            })
          }
        })
      })
    );
    expect(prismaMock.operationalFeedback.update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "feedback-1" } },
      data: { artifactId: "evidence-1" }
    });
  });
});
