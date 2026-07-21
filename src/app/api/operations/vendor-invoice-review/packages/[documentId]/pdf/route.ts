import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { getVendorInvoiceReviewPdf } from "@/modules/vendor-invoice-review/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.INVOICE_VERIFICATION);

    const { documentId } = await params;
    const document = await getVendorInvoiceReviewPdf(context, documentId);
    if (!document) {
      return NextResponse.json({ error: "Saved vendor invoice PDF was not found." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(document.pdfBytes), {
      headers: {
        "content-type": document.contentType || "application/pdf",
        "content-disposition": `attachment; filename="${sanitizeDownloadFileName(document.fileName)}"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to download saved vendor invoice PDF." },
      { status: 500 }
    );
  }
}

function sanitizeDownloadFileName(fileName: string) {
  return fileName.replace(/[\r\n"]/g, "").trim() || "vendor-invoice-review.pdf";
}
