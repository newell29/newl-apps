import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024;

type AttachmentPayload = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

type CarrierManifestAttachmentClient = typeof prisma & {
  shipmentCarrierManifestRun: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{ id: string } | null>;
  };
  shipmentCarrierManifestAttachment: {
    create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
  };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const { runId } = await params;
    const body = (await request.json().catch(() => null)) as AttachmentPayload | null;
    const payload = validatePdfPayload(body);
    const client = prisma as CarrierManifestAttachmentClient;

    const existing = await client.shipmentCarrierManifestRun.findFirst({
      where: {
        id: runId,
        tenantId: context.tenantId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!existing) {
      return NextResponse.json({ error: "Carrier manifest run not found." }, { status: 404 });
    }

    const attachment = await client.shipmentCarrierManifestAttachment.create({
      data: {
        tenantId: context.tenantId,
        runId: existing.id,
        fileName: payload.fileName,
        contentType: "application/pdf",
        sizeBytes: payload.sizeBytes,
        fileBytes: Buffer.alloc(0),
        uploadComplete: false,
        uploadedByUserId: context.userId
      },
      select: { id: true }
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    if (!(error instanceof AttachmentValidationError)) {
      console.error(error);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to attach PDF to carrier manifest run." },
      { status: error instanceof AttachmentValidationError ? 400 : 500 }
    );
  }
}

class AttachmentValidationError extends Error {}

function validatePdfPayload(value: AttachmentPayload | null) {
  if (!value || typeof value.fileName !== "string" || value.fileName.trim().length === 0) {
    throw new AttachmentValidationError("fileName is required.");
  }

  const fileName = value.fileName.trim();
  const contentType = typeof value.contentType === "string" ? value.contentType.trim().toLowerCase() : "";

  if (!fileName.toLowerCase().endsWith(".pdf") && contentType !== "application/pdf") {
    throw new AttachmentValidationError("Only PDF files can be attached to a carrier manifest run.");
  }

  if (!Number.isInteger(value.sizeBytes) || value.sizeBytes <= 0) {
    throw new AttachmentValidationError("PDF attachments cannot be empty.");
  }

  if (value.sizeBytes > MAX_PDF_SIZE_BYTES) {
    throw new AttachmentValidationError("PDF attachments must be 20 MB or smaller.");
  }

  return { fileName, sizeBytes: value.sizeBytes };
}
