import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type ShipmentDocumentRunRouteClient = typeof prisma & {
  shipmentDocumentRun: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{
      id?: string;
      outputBolFileName?: string;
      outputPickTicketFileName?: string;
      bolPdfBytes?: Uint8Array;
      pickTicketPdfBytes?: Uint8Array;
    } | null>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

    const { runId } = await params;
    const url = new URL(request.url);
    const documentType = url.searchParams.get("documentType");
    const client = prisma as ShipmentDocumentRunRouteClient;

    if (!documentType || !["bol", "pick"].includes(documentType)) {
      return NextResponse.json({ error: "documentType must be either bol or pick." }, { status: 400 });
    }

    const run = await client.shipmentDocumentRun.findFirst({
      where: {
        id: runId,
        tenantId: context.tenantId
      },
      select: {
        outputBolFileName: true,
        outputPickTicketFileName: true,
        bolPdfBytes: true,
        pickTicketPdfBytes: true
      }
    });

    if (!run) {
      return NextResponse.json({ error: "Shipment document run not found." }, { status: 404 });
    }

    const bytes = documentType === "bol" ? run.bolPdfBytes : run.pickTicketPdfBytes;
    const fileName = documentType === "bol" ? run.outputBolFileName : run.outputPickTicketFileName;

    if (!bytes || !fileName) {
      return NextResponse.json({ error: "The requested shipment document file is unavailable." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to download shipment document PDF." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const client = prisma as ShipmentDocumentRunRouteClient;

    const { runId } = await params;

    const existing = await client.shipmentDocumentRun.findFirst({
      where: {
        id: runId,
        tenantId: context.tenantId
      },
      select: {
        id: true
      }
    });

    if (!existing) {
      return NextResponse.json({ error: "Shipment document run not found." }, { status: 404 });
    }

    await client.shipmentDocumentRun.delete({
      where: {
        id: runId
      }
    });

    return NextResponse.json({ deleted: { id: runId } }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete shipment document run." },
      { status: 500 }
    );
  }
}
