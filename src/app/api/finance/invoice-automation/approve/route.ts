import { InvoiceAutomationStatus, ModuleKey, PlatformRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { formatInvoiceApprovalBlocker, getInvoiceApprovalBlockingIssues, InvoiceApprovalError } from "@/modules/invoice-automation/approval";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
    await requireMutationAccess(context);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);

    const body = (await request.json().catch(() => null)) as { invoiceIds?: unknown } | null;
    const invoiceIds = Array.isArray(body?.invoiceIds)
      ? body.invoiceIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

    if (invoiceIds.length === 0) {
      return NextResponse.json({ error: "Select at least one invoice to approve for QuickBooks posting." }, { status: 400 });
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const selectedInvoices = await tx.invoiceAutomationInvoice.findMany({
        where: {
          tenantId: context.tenantId,
          id: { in: invoiceIds },
          status: InvoiceAutomationStatus.ACCOUNTING_REVIEW
        },
        select: {
          id: true,
          invoiceType: true,
          fileName: true,
          shipmentFileNumber: true,
          invoiceNumber: true,
          invoiceDate: true,
          entityNameRaw: true,
          quickBooksEntityId: true,
          currency: true,
          totalAmount: true,
          productOrAccountName: true
        }
      });

      if (selectedInvoices.length !== invoiceIds.length) {
        throw new InvoiceApprovalError("One or more selected invoices are no longer available for accounting review.");
      }

      for (const invoice of selectedInvoices) {
        const issues = getInvoiceApprovalBlockingIssues(invoice);
        if (issues.length > 0) {
          throw new InvoiceApprovalError(formatInvoiceApprovalBlocker(invoice, issues));
        }
      }

      await tx.invoiceAutomationInvoice.updateMany({
        where: {
          tenantId: context.tenantId,
          id: { in: invoiceIds },
          status: InvoiceAutomationStatus.ACCOUNTING_REVIEW
        },
        data: {
          status: InvoiceAutomationStatus.APPROVED_FOR_POSTING,
          approvedByUserId: context.userId,
          approvedAt: now
        }
      });

      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "invoice-automation.approved-for-posting",
          entityType: "InvoiceAutomationInvoice",
          after: {
            invoiceIds,
            count: invoiceIds.length
          }
        }
      });
    });

    revalidatePath("/finance/invoice-automation");
    revalidatePath("/finance/invoice-automation/accounting");
    revalidatePath("/finance/invoice-automation/posted");
    revalidatePath("/finance/invoice-automation/reconciliation");

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    if (error instanceof InvoiceApprovalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to approve invoices for posting." },
      { status: 500 }
    );
  }
}
