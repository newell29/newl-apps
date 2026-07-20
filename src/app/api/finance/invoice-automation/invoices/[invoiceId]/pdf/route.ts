import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireModule } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
    const { invoiceId } = await params;

    const invoice = await prisma.invoiceAutomationInvoice.findFirst({
      where: {
        tenantId: context.tenantId,
        id: invoiceId
      },
      select: {
        fileName: true,
        document: {
          select: {
            pdfBytes: true,
            contentType: true
          }
        }
      }
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(invoice.document.pdfBytes), {
      status: 200,
      headers: {
        "content-type": invoice.document.contentType || "application/pdf",
        "content-disposition": `attachment; filename="${invoice.fileName.replace(/"/g, "")}"`
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to download invoice PDF." },
      { status: 500 }
    );
  }
}

