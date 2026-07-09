"use server";

import { InvoiceAutomationBatchStatus, InvoiceAutomationStatus, ModuleKey, PlatformRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { formatInvoiceApprovalBlocker, getInvoiceApprovalBlockingIssues, InvoiceApprovalError } from "@/modules/invoice-automation/approval";
import { prisma } from "@/server/db";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function sendInvoiceAutomationToAccountingAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
  await requireMutationAccess(context);
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.OPERATIONS, PlatformRole.FINANCE]);

  const invoiceIds = formData.getAll("invoiceId").filter((value): value is string => typeof value === "string" && value.length > 0);
  if (invoiceIds.length === 0) {
    throw new Error("Select at least one invoice to send to accounting.");
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const selectedInvoices = await tx.invoiceAutomationInvoice.findMany({
      where: {
        tenantId: context.tenantId,
        id: { in: invoiceIds },
        status: InvoiceAutomationStatus.OPERATIONS_REVIEW
      },
      select: APPROVAL_VALIDATION_SELECT
    });

    if (selectedInvoices.length !== invoiceIds.length) {
      throw new InvoiceApprovalError("One or more selected invoices are no longer available for operations review.");
    }

    assertInvoicesAreCompleteForApproval(selectedInvoices);

    await tx.invoiceAutomationInvoice.updateMany({
      where: {
        tenantId: context.tenantId,
        id: { in: invoiceIds },
        status: InvoiceAutomationStatus.OPERATIONS_REVIEW
      },
      data: {
        status: InvoiceAutomationStatus.ACCOUNTING_REVIEW,
        sentToAccountingById: context.userId,
        sentToAccountingAt: now
      }
    });

    const batchIds = await tx.invoiceAutomationInvoice.findMany({
      where: {
        tenantId: context.tenantId,
        id: { in: invoiceIds }
      },
      distinct: ["batchId"],
      select: { batchId: true }
    });

    await tx.invoiceAutomationBatch.updateMany({
      where: {
        tenantId: context.tenantId,
        id: { in: batchIds.map((row) => row.batchId) }
      },
      data: {
        status: InvoiceAutomationBatchStatus.ACCOUNTING_REVIEW,
        sentToAccountingById: context.userId,
        sentToAccountingAt: now
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "invoice-automation.sent-to-accounting",
        entityType: "InvoiceAutomationInvoice",
        after: {
          invoiceIds,
          count: invoiceIds.length
        }
      }
    });
  });

  revalidateInvoiceAutomation();
}

export async function approveInvoiceAutomationForPostingAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
  await requireMutationAccess(context);
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);

  const invoiceIds = formData.getAll("invoiceId").filter((value): value is string => typeof value === "string" && value.length > 0);
  if (invoiceIds.length === 0) {
    throw new Error("Select at least one invoice to approve for QuickBooks posting.");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const selectedInvoices = await tx.invoiceAutomationInvoice.findMany({
      where: {
        tenantId: context.tenantId,
        id: { in: invoiceIds },
        status: InvoiceAutomationStatus.ACCOUNTING_REVIEW
      },
      select: APPROVAL_VALIDATION_SELECT
    });

    if (selectedInvoices.length !== invoiceIds.length) {
      throw new InvoiceApprovalError("One or more selected invoices are no longer available for accounting review.");
    }

    assertInvoicesAreCompleteForApproval(selectedInvoices);

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

  revalidateInvoiceAutomation();
}

function revalidateInvoiceAutomation() {
  revalidatePath("/finance/invoice-automation");
  revalidatePath("/finance/invoice-automation/accounting");
  revalidatePath("/finance/invoice-automation/posted");
}

const APPROVAL_VALIDATION_SELECT = {
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
} as const;

function assertInvoicesAreCompleteForApproval(invoices: Array<{
  invoiceType: "CUSTOMER" | "VENDOR";
  fileName: string | null;
  shipmentFileNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  entityNameRaw: string | null;
  quickBooksEntityId: string | null;
  currency: string | null;
  totalAmount: { toString(): string } | null;
  productOrAccountName: string | null;
}>) {
  for (const invoice of invoices) {
    const issues = getInvoiceApprovalBlockingIssues(invoice);
    if (issues.length > 0) {
      throw new InvoiceApprovalError(formatInvoiceApprovalBlocker(invoice, issues));
    }
  }
}
