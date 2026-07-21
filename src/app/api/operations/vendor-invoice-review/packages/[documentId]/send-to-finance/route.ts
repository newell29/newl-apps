import { ModuleKey, PlatformRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { sendVendorInvoiceReviewToFinance } from "@/modules/vendor-invoice-review/finance-handoff";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
    await requireMutationAccess(context);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.OPERATIONS, PlatformRole.FINANCE]);

    const { documentId } = await params;
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const document = await tx.vendorInvoiceReviewDocument.findFirst({
        where: { tenantId: context.tenantId, id: documentId },
        include: { invoices: true }
      });
      if (!document) {
        throw new Error("Operations invoice package was not found.");
      }
      if (document.financeStatus === "SENT_TO_FINANCE") {
        return { status: "SENT_TO_FINANCE" };
      }
      await sendVendorInvoiceReviewToFinance({ tx, context, document, invoices: document.invoices, now });
      return { status: "SENT_TO_FINANCE" };
    });

    revalidatePath("/operations/vendor-invoice-review");
    revalidatePath("/operations/customer-invoice-intake");
    revalidatePath("/finance/invoice-automation/accounting");
    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Finance handoff retry failed." }, { status: 500 });
  }
}
