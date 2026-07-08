import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type PdfChunkPayload = {
  documentType: "bol" | "pick";
  chunkBase64: string;
  chunkIndex: number;
  isLast: boolean;
};

type ShipmentDocumentChunkClient = typeof prisma & {
  shipmentDocumentRun: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{
      id: string;
      bolPdfBytes: Uint8Array;
      pickTicketPdfBytes: Uint8Array;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
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
    const body = (await request.json().catch(() => null)) as PdfChunkPayload | null;
    const payload = validatePdfChunkPayload(body);
    const client = prisma as ShipmentDocumentChunkClient;

    const existing = await client.shipmentDocumentRun.findFirst({
      where: {
        id: runId,
        tenantId: context.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        bolPdfBytes: true,
        pickTicketPdfBytes: true
      }
    });

    if (!existing) {
      return NextResponse.json({ error: "Shipment document run not found." }, { status: 404 });
    }

    const previousBytes =
      payload.chunkIndex === 0
        ? Buffer.alloc(0)
        : Buffer.from(payload.documentType === "bol" ? existing.bolPdfBytes : existing.pickTicketPdfBytes);
    const nextBytes = Buffer.concat([previousBytes, payload.chunk]);
    const data =
      payload.documentType === "bol"
        ? { bolPdfBytes: nextBytes, bolPdfUploadComplete: payload.isLast }
        : { pickTicketPdfBytes: nextBytes, pickPdfUploadComplete: payload.isLast };

    await client.shipmentDocumentRun.update({
      where: { id: existing.id },
      data
    });

    return NextResponse.json({ uploaded: true }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload shipment document PDF chunk." },
      { status: 500 }
    );
  }
}

function validatePdfChunkPayload(value: PdfChunkPayload | null) {
  if (!value || !["bol", "pick"].includes(value.documentType)) {
    throw new Error("documentType must be either bol or pick.");
  }

  if (!Number.isInteger(value.chunkIndex) || value.chunkIndex < 0) {
    throw new Error("chunkIndex must be a non-negative integer.");
  }

  if (typeof value.isLast !== "boolean") {
    throw new Error("isLast is required.");
  }

  if (typeof value.chunkBase64 !== "string" || value.chunkBase64.length === 0) {
    throw new Error("chunkBase64 is required.");
  }

  const chunk = Buffer.from(value.chunkBase64, "base64");

  if (chunk.byteLength === 0) {
    throw new Error("PDF chunk contents were empty.");
  }

  return {
    documentType: value.documentType,
    chunk,
    chunkIndex: value.chunkIndex,
    isLast: value.isLast
  };
}
