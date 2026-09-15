import { createHash } from "node:crypto";

import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireModule } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string; orderId: string }> }
) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const { batchId, orderId } = await params;
    const order = await prisma.tmgOrderIntakeOrder.findFirst({
      where: {
        id: orderId,
        batchId,
        tenantId: context.tenantId,
        batch: { tenantId: context.tenantId }
      },
      select: {
        combinedPdfFileName: true,
        combinedPdfHash: true,
        combinedPdfBytes: true
      }
    });

    if (!order?.combinedPdfFileName || !order.combinedPdfHash || !order.combinedPdfBytes) {
      return NextResponse.json({ error: "TMG consolidated PDF not found." }, { status: 404 });
    }

    const bytes = Buffer.from(order.combinedPdfBytes);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || actualHash !== order.combinedPdfHash) {
      return NextResponse.json({ error: "TMG consolidated PDF failed integrity verification." }, { status: 409 });
    }

    const fileName = order.combinedPdfFileName.replace(/["\r\n]/g, "");
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename="${fileName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to open the TMG consolidated PDF." },
      { status: 500 }
    );
  }
}
