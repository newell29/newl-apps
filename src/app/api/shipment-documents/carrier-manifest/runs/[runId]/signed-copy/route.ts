import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { getGarlandCarrierManifestHistory } from "@/modules/shipment-documents/carrier-manifest-queries";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SignedCopyPayload = {
  fileName: string;
  contentType: string;
  base64: string;
};

type SignedCopyClient = typeof prisma & {
  shipmentCarrierManifestRun: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{ id: string } | null>;
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
    const body = (await request.json().catch(() => null)) as SignedCopyPayload | null;
    const payload = validatePayload(body);
    const client = prisma as SignedCopyClient;

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

    await client.shipmentCarrierManifestRun.update({
      where: { id: existing.id },
      data: {
        signedCopyFileName: payload.fileName,
        signedCopyContentType: payload.contentType,
        signedCopyBytes: payload.bytes,
        signedCopyUploadedAt: new Date()
      }
    });

    const history = await getGarlandCarrierManifestHistory(context);
    return NextResponse.json(history, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload signed carrier manifest copy." },
      { status: 500 }
    );
  }
}

function validatePayload(value: SignedCopyPayload | null) {
  if (!value || typeof value.fileName !== "string" || value.fileName.trim().length === 0) {
    throw new Error("fileName is required.");
  }

  if (typeof value.contentType !== "string" || value.contentType.trim().length === 0) {
    throw new Error("contentType is required.");
  }

  if (typeof value.base64 !== "string" || value.base64.length === 0) {
    throw new Error("base64 is required.");
  }

  const bytes = Buffer.from(value.base64, "base64");

  if (bytes.byteLength === 0) {
    throw new Error("Signed copy contents were empty.");
  }

  return {
    fileName: value.fileName.trim(),
    contentType: value.contentType.trim(),
    bytes
  };
}
