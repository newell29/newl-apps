import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { GARLAND_WORKFLOW_KEY, WORKFLOW_ARTIFACT_CHUNK_BYTES } from "@/modules/assistant/garland-artifacts";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const OPERATIONAL_FEEDBACK_EVIDENCE_MAX_BYTES = WORKFLOW_ARTIFACT_CHUNK_BYTES;

const SUPPORTED_EVIDENCE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export class OperationalFeedbackEvidenceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "OperationalFeedbackEvidenceError";
    this.status = status;
  }
}

export async function listGarlandFeedbackEvidenceOptions(
  context: Pick<AuthenticatedContext, "tenantId">,
  reference: string
) {
  const normalized = normalizeGarlandReference(reference);
  const orders = await prisma.teamshipReviewOrder.findMany({
    where: {
      tenantId: context.tenantId,
      ...(normalized.startsWith("PS")
        ? { psNumber: normalized }
        : { srNumber: normalized }),
      run: { deletedAt: null }
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      runId: true,
      psNumber: true,
      srNumber: true,
      status: true,
      pageNumbers: true,
      createdAt: true,
      run: {
        select: {
          documentLabel: true,
          sourcePdfFileName: true,
          shipmentDate: true
        }
      }
    }
  });
  const runIds = [...new Set(orders.map((item) => item.runId))];
  const artifacts = runIds.length === 0
    ? []
    : await prisma.workflowArtifact.findMany({
        where: {
          tenantId: context.tenantId,
          teamshipReviewRunId: { in: runIds },
          status: "REVIEWED",
          contentType: "application/pdf"
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          teamshipReviewRunId: true
        }
      });
  const artifactByRun = new Map<string, string>();
  for (const artifact of artifacts) {
    if (artifact.teamshipReviewRunId && !artifactByRun.has(artifact.teamshipReviewRunId)) {
      artifactByRun.set(artifact.teamshipReviewRunId, artifact.id);
    }
  }

  return orders.map((order) => ({
    reviewOrderId: order.id,
    reviewRunId: order.runId,
    artifactId: artifactByRun.get(order.runId) ?? null,
    psNumber: order.psNumber,
    srNumber: order.srNumber,
    status: order.status,
    pageNumbers: normalizePageNumbers(order.pageNumbers),
    checkedAt: order.createdAt.toISOString(),
    shipmentDate: order.run.shipmentDate.toISOString().slice(0, 10),
    documentLabel: order.run.documentLabel,
    sourcePdfFileName: order.run.sourcePdfFileName,
    hasStoredSourcePdf: artifactByRun.has(order.runId)
  }));
}

export async function saveOperationalFeedbackEvidence(
  context: Pick<AuthenticatedContext, "tenantId" | "userId">,
  feedbackId: string,
  input: {
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
  }
) {
  const feedback = await prisma.operationalFeedback.findFirst({
    where: { tenantId: context.tenantId, id: feedbackId },
    select: {
      id: true,
      workflowKey: true,
      status: true,
      artifactId: true
    }
  });
  if (!feedback) throw new OperationalFeedbackEvidenceError("Feedback was not found.", 404);
  if (!new Set(["REPORTED", "INVESTIGATING"]).has(feedback.status)) {
    throw new OperationalFeedbackEvidenceError(
      "Evidence can be attached only while feedback is waiting for review.",
      409
    );
  }
  if (feedback.workflowKey !== GARLAND_WORKFLOW_KEY) {
    throw new OperationalFeedbackEvidenceError("Only Garland feedback accepts this evidence type.");
  }
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > OPERATIONAL_FEEDBACK_EVIDENCE_MAX_BYTES) {
    throw new OperationalFeedbackEvidenceError(
      `Evidence files must be between 1 byte and ${OPERATIONAL_FEEDBACK_EVIDENCE_MAX_BYTES} bytes.`
    );
  }
  const contentType = normalizeEvidenceContentType(input.contentType, input.bytes);
  const fileName = normalizeEvidenceFileName(input.fileName, contentType);
  const contentHash = sha256(input.bytes);

  return prisma.$transaction(async (tx) => {
    const artifact = await tx.workflowArtifact.create({
      data: {
        tenantId: context.tenantId,
        workflowKey: GARLAND_WORKFLOW_KEY,
        sourceChannel: "NEWL_APPS",
        submittedByUserId: context.userId,
        fileName,
        contentType,
        sizeBytes: input.bytes.byteLength,
        contentHash,
        status: "EVIDENCE_READY",
        chunkCount: 1,
        completedAt: new Date(),
        extractionSummary: {
          purpose: "RIVET_FEEDBACK_EVIDENCE",
          feedbackId
        } satisfies Prisma.InputJsonValue,
        chunks: {
          create: {
            chunkIndex: 0,
            sizeBytes: input.bytes.byteLength,
            contentHash,
            bytes: Buffer.from(input.bytes)
          }
        }
      },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        contentHash: true
      }
    });
    await tx.operationalFeedback.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: feedbackId } },
      data: { artifactId: artifact.id }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.operational_feedback.attach_evidence",
        entityType: "OperationalFeedback",
        entityId: feedbackId,
        before: { artifactId: feedback.artifactId } satisfies Prisma.InputJsonValue,
        after: {
          artifactId: artifact.id,
          contentType: artifact.contentType,
          sizeBytes: artifact.sizeBytes,
          contentHash: artifact.contentHash
        } satisfies Prisma.InputJsonValue
      }
    });
    return artifact;
  });
}

function normalizeGarlandReference(value: string) {
  const match = value.trim().toUpperCase().match(/\b(?:PS\d{6}|SR\d{5,8})\b/);
  if (!match) throw new OperationalFeedbackEvidenceError("Provide a Garland PS or SR number.");
  return match[0];
}

function normalizeEvidenceContentType(declared: string, bytes: Uint8Array) {
  const normalized = declared.trim().toLowerCase();
  if (!SUPPORTED_EVIDENCE_TYPES.has(normalized)) {
    throw new OperationalFeedbackEvidenceError("Evidence must be a PDF, PNG, JPEG, or WebP file.");
  }
  const valid = normalized === "application/pdf"
    ? startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
    : normalized === "image/png"
      ? startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : normalized === "image/jpeg"
        ? startsWith(bytes, [0xff, 0xd8, 0xff])
        : startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!valid) {
    throw new OperationalFeedbackEvidenceError("The evidence file signature does not match its type.");
  }
  return normalized;
}

function normalizeEvidenceFileName(value: string, contentType: string) {
  const extension = contentType === "application/pdf"
    ? ".pdf"
    : contentType === "image/png"
      ? ".png"
      : contentType === "image/webp"
        ? ".webp"
        : ".jpg";
  const base = value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .trim()
    .slice(0, 120) || "feedback-evidence";
  return `${base}${extension}`;
}

function normalizePageNumbers(value: Prisma.JsonValue) {
  return Array.isArray(value)
    ? value
        .filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0)
        .slice(0, 20)
    : [];
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
