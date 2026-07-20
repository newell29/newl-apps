import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type DownloadType = "midland" | "speedy" | "suretrack" | "signed";

type CarrierManifestRunRouteClient = typeof prisma & {
  shipmentCarrierManifestRun: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{
      id?: string;
      midlandFileName?: string | null;
      midlandWorkbookBytes?: Uint8Array | null;
      speedyFileName?: string | null;
      speedyWorkbookBytes?: Uint8Array | null;
      suretrackFileName?: string | null;
      suretrackWorkbookBytes?: Uint8Array | null;
      signedCopyFileName?: string | null;
      signedCopyContentType?: string | null;
      signedCopyBytes?: Uint8Array | null;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
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
    const client = prisma as CarrierManifestRunRouteClient;

    if (!isDownloadType(documentType)) {
      return NextResponse.json({ error: "documentType must be midland, speedy, suretrack, or signed." }, { status: 400 });
    }

    const run = await client.shipmentCarrierManifestRun.findFirst({
      where: {
        id: runId,
        tenantId: context.tenantId,
        deletedAt: null
      },
      select: {
        midlandFileName: true,
        midlandWorkbookBytes: true,
        speedyFileName: true,
        speedyWorkbookBytes: true,
        suretrackFileName: true,
        suretrackWorkbookBytes: true,
        signedCopyFileName: true,
        signedCopyContentType: true,
        signedCopyBytes: true
      }
    });

    if (!run) {
      return NextResponse.json({ error: "Carrier manifest run not found." }, { status: 404 });
    }

    const download = readDownload(run, documentType);

    if (!download.bytes || !download.fileName) {
      return NextResponse.json({ error: "Requested carrier manifest file is unavailable." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(download.bytes), {
      status: 200,
      headers: {
        "content-type": download.contentType,
        "content-disposition": `attachment; filename="${download.fileName.replace(/"/g, "")}"`
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to download carrier manifest file." },
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
    const { runId } = await params;
    const client = prisma as CarrierManifestRunRouteClient;

    const existing = await client.shipmentCarrierManifestRun.findFirst({
      where: {
        id: runId,
        tenantId: context.tenantId,
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!existing?.id) {
      return NextResponse.json({ error: "Carrier manifest run not found." }, { status: 404 });
    }

    await client.shipmentCarrierManifestRun.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        deletedByUserId: context.userId
      }
    });

    return NextResponse.json({ deleted: { id: existing.id } }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete carrier manifest run." },
      { status: 500 }
    );
  }
}

function isDownloadType(value: string | null): value is DownloadType {
  return value === "midland" || value === "speedy" || value === "suretrack" || value === "signed";
}

function readDownload(
  run: {
    midlandFileName?: string | null;
    midlandWorkbookBytes?: Uint8Array | null;
    speedyFileName?: string | null;
    speedyWorkbookBytes?: Uint8Array | null;
    suretrackFileName?: string | null;
    suretrackWorkbookBytes?: Uint8Array | null;
    signedCopyFileName?: string | null;
    signedCopyContentType?: string | null;
    signedCopyBytes?: Uint8Array | null;
  },
  documentType: DownloadType
) {
  if (documentType === "midland") {
    return {
      fileName: run.midlandFileName,
      bytes: run.midlandWorkbookBytes,
      contentType: "application/vnd.ms-excel"
    };
  }

  if (documentType === "speedy") {
    return {
      fileName: run.speedyFileName,
      bytes: run.speedyWorkbookBytes,
      contentType: "application/vnd.ms-excel"
    };
  }

  if (documentType === "suretrack") {
    return {
      fileName: run.suretrackFileName,
      bytes: run.suretrackWorkbookBytes,
      contentType: "application/vnd.ms-excel"
    };
  }

  return {
    fileName: run.signedCopyFileName,
    bytes: run.signedCopyBytes,
    contentType: run.signedCopyContentType ?? "application/octet-stream"
  };
}
