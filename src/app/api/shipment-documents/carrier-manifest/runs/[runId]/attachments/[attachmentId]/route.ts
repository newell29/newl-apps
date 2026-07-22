import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireModule } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type CarrierManifestAttachmentDownloadClient = typeof prisma & {
  shipmentCarrierManifestAttachment: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{
      fileName: string;
      contentType: string;
      fileBytes: Uint8Array;
    } | null>;
  };
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; attachmentId: string }> }
) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const { runId, attachmentId } = await params;
    const client = prisma as CarrierManifestAttachmentDownloadClient;

    const attachment = await client.shipmentCarrierManifestAttachment.findFirst({
      where: {
        id: attachmentId,
        runId,
        tenantId: context.tenantId,
        uploadComplete: true,
        run: {
          tenantId: context.tenantId,
          deletedAt: null
        }
      },
      select: {
        fileName: true,
        contentType: true,
        fileBytes: true
      }
    });

    if (!attachment) {
      return NextResponse.json({ error: "Carrier manifest PDF attachment not found." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(attachment.fileBytes), {
      status: 200,
      headers: {
        "content-type": attachment.contentType,
        "content-length": String(attachment.fileBytes.byteLength),
        "content-disposition": `attachment; filename="${attachment.fileName.replace(/["\r\n]/g, "")}"`
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to download carrier manifest PDF attachment." },
      { status: 500 }
    );
  }
}
