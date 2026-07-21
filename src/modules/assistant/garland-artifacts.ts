import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { getGarlandLearnedProductDimensionRecommendations } from "@/modules/shipment-documents/garland-product-dimension-directory";
import { collectGarlandProductDimensionSkus } from "@/modules/shipment-documents/garland-product-dimensions";
import { extractGarlandShippingOrdersFromPdfBytes } from "@/modules/shipment-documents/garland-pdf-server-extraction";
import { buildGarlandTeamshipReview } from "@/modules/shipment-documents/teamship-review";
import { saveTeamshipReviewRun } from "@/modules/shipment-documents/teamship-review-history";
import { prisma } from "@/server/db";
import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const GARLAND_WORKFLOW_KEY = "GARLAND_TEAMSHIP_REVIEW";
export const WORKFLOW_ARTIFACT_MAX_BYTES = 20 * 1024 * 1024;
export const WORKFLOW_ARTIFACT_CHUNK_BYTES = 3 * 1024 * 1024;
export const WORKFLOW_ARTIFACT_MAX_CHUNKS = Math.ceil(
  WORKFLOW_ARTIFACT_MAX_BYTES / WORKFLOW_ARTIFACT_CHUNK_BYTES
);

export class GarlandArtifactError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GarlandArtifactError";
    this.status = status;
  }
}

export async function createGarlandArtifact(
  context: AuthenticatedContext,
  input: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    chunkCount: number;
    sourceChannel: "TEAMS" | "NEWL_APPS";
    externalMessageId?: string | null;
    externalConversationId?: string | null;
  }
) {
  const fileName = normalizePdfFileName(input.fileName);
  if (input.contentType.toLowerCase() !== "application/pdf") {
    throw new GarlandArtifactError("Only PDF Garland orders can be uploaded.");
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > WORKFLOW_ARTIFACT_MAX_BYTES) {
    throw new GarlandArtifactError("Garland PDFs must be between 1 byte and 20 MB.");
  }
  const expectedChunks = Math.ceil(input.sizeBytes / WORKFLOW_ARTIFACT_CHUNK_BYTES);
  if (
    !Number.isInteger(input.chunkCount) ||
    input.chunkCount !== expectedChunks ||
    input.chunkCount < 1 ||
    input.chunkCount > WORKFLOW_ARTIFACT_MAX_CHUNKS
  ) {
    throw new GarlandArtifactError(`chunkCount must be ${expectedChunks} for this file size.`);
  }

  return prisma.workflowArtifact.create({
    data: {
      tenantId: context.tenantId,
      workflowKey: GARLAND_WORKFLOW_KEY,
      sourceChannel: input.sourceChannel,
      externalMessageId: normalizeOptionalText(input.externalMessageId, 300),
      externalConversationId: normalizeOptionalText(input.externalConversationId, 300),
      submittedByUserId: context.userId,
      fileName,
      contentType: "application/pdf",
      sizeBytes: input.sizeBytes,
      chunkCount: input.chunkCount
    },
    select: {
      id: true,
      fileName: true,
      sizeBytes: true,
      chunkCount: true,
      status: true,
      createdAt: true
    }
  });
}

export async function saveGarlandArtifactChunk(
  context: AuthenticatedContext,
  artifactId: string,
  chunkIndex: number,
  bytes: Uint8Array,
  declaredHash?: string | null
) {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= WORKFLOW_ARTIFACT_MAX_CHUNKS) {
    throw new GarlandArtifactError("chunkIndex is outside the allowed range.");
  }
  if (bytes.byteLength < 1 || bytes.byteLength > WORKFLOW_ARTIFACT_CHUNK_BYTES) {
    throw new GarlandArtifactError("Each upload chunk must be between 1 byte and 3 MB.");
  }

  const artifact = await prisma.workflowArtifact.findFirst({
    where: {
      id: artifactId,
      tenantId: context.tenantId,
      workflowKey: GARLAND_WORKFLOW_KEY
    },
    select: { id: true, status: true, chunkCount: true }
  });
  if (!artifact) throw new GarlandArtifactError("Garland artifact was not found.", 404);
  if (artifact.status !== "UPLOADING") {
    throw new GarlandArtifactError("This Garland artifact is no longer accepting chunks.", 409);
  }
  if (chunkIndex >= artifact.chunkCount) {
    throw new GarlandArtifactError("chunkIndex exceeds the artifact chunk count.");
  }

  const contentHash = sha256(bytes);
  if (declaredHash && !safeHashEquals(contentHash, declaredHash)) {
    throw new GarlandArtifactError("The uploaded chunk hash does not match its contents.");
  }

  await prisma.workflowArtifactChunk.upsert({
    where: {
      tenantId_artifactId_chunkIndex: {
        tenantId: context.tenantId,
        artifactId,
        chunkIndex
      }
    },
    create: {
      tenantId: context.tenantId,
      artifactId,
      chunkIndex,
      sizeBytes: bytes.byteLength,
      contentHash,
      bytes: Buffer.from(bytes)
    },
    update: {
      sizeBytes: bytes.byteLength,
      contentHash,
      bytes: Buffer.from(bytes)
    }
  });

  return { artifactId, chunkIndex, sizeBytes: bytes.byteLength, contentHash };
}

export async function finalizeGarlandArtifact(
  context: AuthenticatedContext,
  artifactId: string,
  input: { shipmentDate?: string | null }
) {
  const artifact = await prisma.workflowArtifact.findFirst({
    where: {
      id: artifactId,
      tenantId: context.tenantId,
      workflowKey: GARLAND_WORKFLOW_KEY
    },
    include: { chunks: { orderBy: { chunkIndex: "asc" } } }
  });
  if (!artifact) throw new GarlandArtifactError("Garland artifact was not found.", 404);
  if (artifact.status !== "UPLOADING") {
    throw new GarlandArtifactError("This Garland artifact has already been finalized.", 409);
  }
  if (artifact.chunks.length !== artifact.chunkCount) {
    throw new GarlandArtifactError(
      `Upload is incomplete: received ${artifact.chunks.length} of ${artifact.chunkCount} chunks.`,
      409
    );
  }
  artifact.chunks.forEach((chunk, index) => {
    if (chunk.chunkIndex !== index || chunk.contentHash !== sha256(chunk.bytes)) {
      throw new GarlandArtifactError("An uploaded PDF chunk is missing or failed integrity validation.", 409);
    }
  });

  const bytes = Buffer.concat(artifact.chunks.map((chunk) => Buffer.from(chunk.bytes)));
  if (bytes.byteLength !== artifact.sizeBytes) {
    throw new GarlandArtifactError("The assembled PDF size does not match the declared file size.", 409);
  }
  const contentHash = sha256(bytes);
  const shipmentDateInput = normalizeShipmentDate(input.shipmentDate);

  try {
    const extraction = await extractGarlandShippingOrdersFromPdfBytes(bytes);
    if (extraction.orders.length === 0) {
      throw new GarlandArtifactError("No Garland shipping orders were found in this PDF.");
    }

    const teamshipOrders = await fetchTeamshipShippingOrdersForReview({
      tenantId: context.tenantId,
      shipmentDate: shipmentDateInput,
      srNumbers: extraction.orders.map((order) => order.srNumber)
    });
    const learnedProductDimensions = await getGarlandLearnedProductDimensionRecommendations({
      tenantId: context.tenantId,
      skus: collectGarlandProductDimensionSkus({ pdfOrders: extraction.orders, teamshipOrders })
    });
    const review = buildGarlandTeamshipReview(extraction.orders, teamshipOrders, [], {
      learnedProductDimensions
    });
    const shipmentDate = new Date(`${shipmentDateInput}T00:00:00.000Z`);
    const reviewRunId = await saveTeamshipReviewRun({
      context,
      documentLabel: buildDocumentLabel(shipmentDateInput, extraction.psNumbers),
      shipmentDate,
      sourcePdfFileName: artifact.fileName,
      review,
      alertDigestOrderCount: 0
    });
    const duplicate = await prisma.workflowArtifact.findFirst({
      where: {
        tenantId: context.tenantId,
        id: { not: artifact.id },
        contentHash,
        status: "REVIEWED"
      },
      select: { id: true },
      orderBy: { createdAt: "asc" }
    });

    await prisma.workflowArtifact.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: artifact.id } },
      data: {
        contentHash,
        status: "REVIEWED",
        teamshipReviewRunId: reviewRunId,
        duplicateOfArtifactId: duplicate?.id ?? null,
        extractionSummary: {
          shipmentDate: shipmentDateInput,
          pageCount: extraction.pageCount,
          orderCount: extraction.orders.length,
          psNumbers: extraction.psNumbers,
          srNumbers: extraction.srNumbers,
          review: review.summary
        } satisfies Prisma.InputJsonValue,
        errorMessage: null,
        completedAt: new Date()
      }
    });

    return {
      artifactId: artifact.id,
      reviewRunId,
      duplicateOfArtifactId: duplicate?.id ?? null,
      fileName: artifact.fileName,
      extraction: {
        pageCount: extraction.pageCount,
        orderCount: extraction.orders.length,
        psNumbers: extraction.psNumbers,
        srNumbers: extraction.srNumbers
      },
      review: review.summary,
      orders: review.reviews.map((order) => ({
        psNumber: order.psNumber,
        srNumber: order.srNumber,
        status: order.status,
        issueCount: order.issueCount
      }))
    };
  } catch (error) {
    await prisma.workflowArtifact.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: artifact.id } },
      data: {
        contentHash,
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Garland PDF review failed.",
        completedAt: new Date()
      }
    });
    throw error;
  }
}

function normalizePdfFileName(value: string) {
  const fileName = value.trim().replace(/[\\/]/g, "_").slice(0, 240);
  if (!fileName || !fileName.toLowerCase().endsWith(".pdf")) {
    throw new GarlandArtifactError("A valid PDF file name is required.");
  }
  return fileName;
}

function normalizeShipmentDate(value?: string | null) {
  const candidate = value?.trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || Number.isNaN(Date.parse(`${candidate}T00:00:00Z`))) {
    throw new GarlandArtifactError("shipmentDate must use YYYY-MM-DD format.");
  }
  return candidate;
}

function buildDocumentLabel(shipmentDate: string, psNumbers: string[]) {
  const compact = psNumbers.length < 2 ? psNumbers[0] : `${psNumbers[0]} - ${psNumbers.at(-1)}`;
  return compact ? `${shipmentDate} - ${compact}` : shipmentDate;
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number) {
  const text = value?.trim();
  return text ? text.slice(0, maxLength) : null;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeHashEquals(actual: string, declared: string) {
  return /^[a-f0-9]{64}$/i.test(declared) && actual === declared.toLowerCase();
}
