import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  teamshipReviewOrder: { findMany: vi.fn(), findFirst: vi.fn() },
  workflowArtifact: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  garlandSourceAttachment: { findMany: vi.fn() },
  operationalFeedback: { findFirst: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));
const graphMock = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  fetchAttachment: vi.fn()
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/integrations/microsoft-graph-application", () => ({
  getMicrosoftGraphApplicationAccessToken: (...args: unknown[]) => graphMock.getAccessToken(...args)
}));
vi.mock("@/server/integrations/microsoft-graph-mail", () => ({
  fetchMicrosoftGraphMessageAttachmentContent: (...args: unknown[]) => graphMock.fetchAttachment(...args)
}));

import {
  ensureGarlandFeedbackReviewSourceArtifact,
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
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([]);

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

  it("shows that an original parsed email PDF can be reused without a new upload", async () => {
    vi.resetAllMocks();
    prismaMock.teamshipReviewOrder.findMany.mockResolvedValue([{
      id: "review-order-1",
      runId: "review-run-1",
      psNumber: "PS123456",
      srNumber: "SR812345",
      status: "FAIL",
      pageNumbers: [1],
      createdAt: new Date("2026-07-29T12:00:00Z"),
      run: {
        documentLabel: "Synthetic batch",
        sourcePdfFileName: "synthetic-orders.pdf",
        shipmentDate: new Date("2026-07-29T00:00:00Z")
      }
    }]);
    prismaMock.workflowArtifact.findMany.mockResolvedValue([]);
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([{
      id: "email-attachment-1",
      fileName: "synthetic-orders.pdf",
      contentHash: "a".repeat(64),
      extractedPsNumbers: ["PS123456"],
      extractedSrNumbers: ["SR812345"]
    }]);

    const result = await listGarlandFeedbackEvidenceOptions(
      { tenantId: "tenant-1" },
      "PS123456"
    );

    expect(result[0]).toEqual(expect.objectContaining({
      hasStoredSourcePdf: false,
      hasSavedEmailPdf: true
    }));
    expect(prismaMock.garlandSourceAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          fileName: { in: ["synthetic-orders.pdf"] }
        })
      })
    );
  });

  it("retrieves, verifies, chunks, and caches the original saved-email PDF for Rivet", async () => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    const pdfBytes = new Uint8Array(Buffer.from("%PDF-1.7\nsynthetic evidence\n", "utf8"));
    const contentHash = createHash("sha256").update(pdfBytes).digest("hex");
    prismaMock.teamshipReviewOrder.findFirst.mockResolvedValue({
      id: "review-order-1",
      runId: "review-run-1",
      psNumber: "PS123456",
      srNumber: "SR812345",
      run: { sourcePdfFileName: "synthetic-orders.pdf" }
    });
    prismaMock.workflowArtifact.findFirst.mockResolvedValue(null);
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([{
      id: "email-attachment-1",
      graphAttachmentId: "graph-attachment-1",
      fileName: "synthetic-orders.pdf",
      contentHash,
      extractedPsNumbers: ["PS123456"],
      extractedSrNumbers: ["SR812345"],
      sourceEmail: {
        mailboxAddress: "garland@example.com",
        graphMessageId: "graph-message-1",
        conversationId: "graph-conversation-1"
      }
    }]);
    graphMock.getAccessToken.mockResolvedValue("graph-token");
    graphMock.fetchAttachment.mockResolvedValue({
      id: "graph-attachment-1",
      contentBytes: Buffer.from(pdfBytes).toString("base64")
    });
    prismaMock.workflowArtifact.create.mockResolvedValue({ id: "source-pdf-1" });

    const result = await ensureGarlandFeedbackReviewSourceArtifact(
      { tenantId: "tenant-1", userId: "admin-1" },
      "review-order-1"
    );

    expect(result).toEqual({ id: "source-pdf-1" });
    expect(graphMock.fetchAttachment).toHaveBeenCalledWith(
      "graph-token",
      "garland@example.com",
      "graph-message-1",
      "graph-attachment-1"
    );
    expect(prismaMock.workflowArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          sourceChannel: "EMAIL",
          status: "REVIEWED",
          teamshipReviewRunId: "review-run-1",
          contentHash,
          chunks: {
            create: [{
              chunkIndex: 0,
              sizeBytes: pdfBytes.byteLength,
              contentHash,
              bytes: Buffer.from(pdfBytes)
            }]
          }
        })
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "assistant.operational_feedback.cache_saved_email_pdf"
        })
      })
    );
  });

  it("does not reuse an email PDF when its extracted PS and SR do not match the saved review", async () => {
    vi.resetAllMocks();
    prismaMock.teamshipReviewOrder.findFirst.mockResolvedValue({
      id: "review-order-1",
      runId: "review-run-1",
      psNumber: "PS123456",
      srNumber: "SR812345",
      run: { sourcePdfFileName: "synthetic-orders.pdf" }
    });
    prismaMock.workflowArtifact.findFirst.mockResolvedValue(null);
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([{
      id: "email-attachment-1",
      graphAttachmentId: "graph-attachment-1",
      fileName: "synthetic-orders.pdf",
      contentHash: "a".repeat(64),
      extractedPsNumbers: ["PS123457"],
      extractedSrNumbers: ["SR812346"],
      sourceEmail: {
        mailboxAddress: "garland@example.com",
        graphMessageId: "graph-message-1",
        conversationId: "graph-conversation-1"
      }
    }]);

    const result = await ensureGarlandFeedbackReviewSourceArtifact(
      { tenantId: "tenant-1", userId: "admin-1" },
      "review-order-1"
    );

    expect(result).toBeNull();
    expect(graphMock.fetchAttachment).not.toHaveBeenCalled();
    expect(prismaMock.workflowArtifact.create).not.toHaveBeenCalled();
  });

  it("rejects a changed email attachment whose bytes no longer match the parsed hash", async () => {
    vi.resetAllMocks();
    prismaMock.teamshipReviewOrder.findFirst.mockResolvedValue({
      id: "review-order-1",
      runId: "review-run-1",
      psNumber: "PS123456",
      srNumber: "SR812345",
      run: { sourcePdfFileName: "synthetic-orders.pdf" }
    });
    prismaMock.workflowArtifact.findFirst.mockResolvedValue(null);
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([{
      id: "email-attachment-1",
      graphAttachmentId: "graph-attachment-1",
      fileName: "synthetic-orders.pdf",
      contentHash: "a".repeat(64),
      extractedPsNumbers: ["PS123456"],
      extractedSrNumbers: ["SR812345"],
      sourceEmail: {
        mailboxAddress: "garland@example.com",
        graphMessageId: "graph-message-1",
        conversationId: "graph-conversation-1"
      }
    }]);
    graphMock.getAccessToken.mockResolvedValue("graph-token");
    graphMock.fetchAttachment.mockResolvedValue({
      id: "graph-attachment-1",
      contentBytes: Buffer.from("%PDF-1.7\nchanged synthetic evidence\n", "utf8").toString("base64")
    });

    await expect(ensureGarlandFeedbackReviewSourceArtifact(
      { tenantId: "tenant-1", userId: "admin-1" },
      "review-order-1"
    )).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("integrity validation")
    });
    expect(prismaMock.workflowArtifact.create).not.toHaveBeenCalled();
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
