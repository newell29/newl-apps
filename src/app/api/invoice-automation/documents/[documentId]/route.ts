import { NextResponse } from "next/server";
import { findTenantAccountingDocument } from "@/modules/invoice-automation/queries";
import { getAuthenticatedContext } from "@/server/tenant-context";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const context = await getAuthenticatedContext();
  const { documentId } = await params;
  const document = await findTenantAccountingDocument(context, documentId);
  if (!document?.pdfBytes) return NextResponse.json({ error: "Invoice PDF not found." }, { status: 404 });
  return new NextResponse(new Uint8Array(document.pdfBytes), { headers: { "content-type": document.contentType, "content-disposition": `attachment; filename="${document.fileName.replace(/"/g, "")}"` } });
}
