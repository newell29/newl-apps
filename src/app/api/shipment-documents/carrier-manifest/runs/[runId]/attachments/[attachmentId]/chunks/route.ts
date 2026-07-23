import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const MAX_CHUNK_BYTES = 1024 * 1024;

type PdfChunkPayload = {
  chunkBase64: string;
  chunkIndex: number;
  isLast: boolean;
};

type CarrierManifestAttachmentChunkClient = typeof prisma & {
  shipmentCarrierManifestAttachment: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{
      id: string;
      sizeBytes: number;
      fileBytes: Uint8Array;
      uploadComplete: boolean;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; attachmentId: string }> }
) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const { runId, attachmentId } = await params;
    const body = (await request.json().catch(() => null)) as PdfChunkPayload | null;
    const payload = validatePdfChunkPayload(body);
    const client = prisma as CarrierManifestAttachmentChunkClient;

    const existing = await client.shipmentCarrierManifestAttachment.findFirst({
      where: {
        id: attachmentId,
        runId,
        tenantId: context.tenantId,
        run: {
          tenantId: context.tenantId,
          deletedAt: null
        }
      },
      select: {
        id: true,
        sizeBytes: true,
        fileBytes: true,
        uploadComplete: true
      }
    });

    if (!existing) {
      return NextResponse.json({ error: "Carrier manifest PDF attachment not found." }, { status: 404 });
    }

    if (existing.uploadComplete) {
      return NextResponse.json({ error: "This PDF attachment upload is already complete." }, { status: 409 });
    }

    const previousBytes = Buffer.from(existing.fileBytes);
    const expectedChunkIndex = previousBytes.byteLength === 0 ? 0 : Math.ceil(previousBytes.byteLength / MAX_CHUNK_BYTES);

    if (payload.chunkIndex !== expectedChunkIndex) {
      throw new PdfChunkValidationError(`Expected PDF chunk ${expectedChunkIndex}.`);
    }

    if (payload.chunkIndex === 0 && payload.chunk.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new PdfChunkValidationError("The uploaded file is not a valid PDF.");
    }

    const nextBytes = Buffer.concat([previousBytes, payload.chunk]);

    if (nextBytes.byteLength > existing.sizeBytes) {
      throw new PdfChunkValidationError("Uploaded PDF contents exceed the declared file size.");
    }

    if (payload.isLast && nextBytes.byteLength !== existing.sizeBytes) {
      throw new PdfChunkValidationError("The final PDF chunk did not match the declared file size.");
    }

    if (!payload.isLast && nextBytes.byteLength === existing.sizeBytes) {
      throw new PdfChunkValidationError("The final PDF chunk must be marked as complete.");
    }

    await client.shipmentCarrierManifestAttachment.update({
      where: { id: existing.id },
      data: {
        fileBytes: nextBytes,
        uploadComplete: payload.isLast
      }
    });

    return NextResponse.json({ uploaded: true, complete: payload.isLast }, { status: 200 });
  } catch (error) {
    if (!(error instanceof PdfChunkValidationError)) {
      console.error(error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload carrier manifest PDF chunk." },
      { status: error instanceof PdfChunkValidationError ? 400 : 500 }
    );
  }
}

class PdfChunkValidationError extends Error {}

function validatePdfChunkPayload(value: PdfChunkPayload | null) {
  if (!value || !Number.isInteger(value.chunkIndex) || value.chunkIndex < 0) {
    throw new PdfChunkValidationError("chunkIndex must be a non-negative integer.");
  }

  if (typeof value.isLast !== "boolean") {
    throw new PdfChunkValidationError("isLast is required.");
  }

  if (typeof value.chunkBase64 !== "string" || value.chunkBase64.length === 0) {
    throw new PdfChunkValidationError("chunkBase64 is required.");
  }

  const chunk = Buffer.from(value.chunkBase64, "base64");

  if (chunk.byteLength === 0 || chunk.byteLength > MAX_CHUNK_BYTES) {
    throw new PdfChunkValidationError("Each PDF chunk must be between 1 byte and 1 MB.");
  }

  if (!value.isLast && chunk.byteLength !== MAX_CHUNK_BYTES) {
    throw new PdfChunkValidationError("Every PDF chunk before the final chunk must be exactly 1 MB.");
  }

  return { chunk, chunkIndex: value.chunkIndex, isLast: value.isLast };
}
