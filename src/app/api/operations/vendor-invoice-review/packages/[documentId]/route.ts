import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { getVendorInvoiceReviewPackageDetail } from "@/modules/vendor-invoice-review/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.INVOICE_VERIFICATION);

    const { documentId } = await params;
    const document = await getVendorInvoiceReviewPackageDetail(context, documentId);
    if (!document) {
      return NextResponse.json({ error: "Saved vendor invoice package was not found." }, { status: 404 });
    }

    return NextResponse.json(document);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to open saved vendor invoice package." },
      { status: 500 }
    );
  }
}
