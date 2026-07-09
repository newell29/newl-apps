import { InvoiceAutomationStatus, ModuleKey, PlatformRole, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { buildVendorInvoiceDuplicateKey, VENDOR_INVOICE_DUPLICATE_CHECK_STATUSES } from "@/modules/invoice-automation/duplicates";
import {
  defaultDueDateFromInvoiceDate,
  getBusinessLineFromInvoiceFileNumber,
  getDefaultProductOrAccount,
  getInvoiceDraftIssueCodes,
  getShipmentTypeFromInvoiceFileNumber
} from "@/modules/invoice-automation/extraction";
import { toInvoiceAutomationRow } from "@/modules/invoice-automation/row-mapper";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type Params = Promise<{
  invoiceId: string;
}>;

type InvoiceUpdatePayload = {
  shipmentFileNumber?: unknown;
  entityNameRaw?: unknown;
  quickBooksEntityId?: unknown;
  quickBooksEntityDisplayName?: unknown;
  invoiceNumber?: unknown;
  invoiceDate?: unknown;
  dueDate?: unknown;
  currency?: unknown;
  subtotalAmount?: unknown;
  taxAmount?: unknown;
  totalAmount?: unknown;
  productOrAccountName?: unknown;
};

const EDITABLE_ACCOUNTING_STATUSES: InvoiceAutomationStatus[] = [
  InvoiceAutomationStatus.ACCOUNTING_REVIEW,
  InvoiceAutomationStatus.APPROVED_FOR_POSTING,
  InvoiceAutomationStatus.POSTING_ERROR
];

export async function PATCH(request: Request, { params }: { params: Params }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
    await requireMutationAccess(context);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);

    const { invoiceId } = await params;
    const body = (await request.json().catch(() => null)) as InvoiceUpdatePayload | null;
    if (!body) {
      return NextResponse.json({ error: "Provide invoice fields to update." }, { status: 400 });
    }

    const existing = await prisma.invoiceAutomationInvoice.findUnique({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: invoiceId
        }
      },
      include: {
        batch: {
          select: {
            batchNumber: true
          }
        }
      }
    });

    if (!existing) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    if (!EDITABLE_ACCOUNTING_STATUSES.includes(existing.status)) {
      return NextResponse.json({ error: "Only invoices in the accounting queue can be edited before posting." }, { status: 409 });
    }

    const shipmentFileNumber = readNullable(body.shipmentFileNumber);
    const invoiceDate = readDateString(body.invoiceDate);
    const dueDate = readDateString(body.dueDate) ?? defaultDueDateFromInvoiceDate(invoiceDate);
    const quickBooksEntityId = readNullable(body.quickBooksEntityId);
    const quickBooksEntityDisplayName = readNullable(body.quickBooksEntityDisplayName);
    const entityNameRaw = readNullable(body.entityNameRaw) ?? quickBooksEntityDisplayName;
    const productOrAccountName =
      readNullable(body.productOrAccountName) ?? getDefaultProductOrAccount(existing.invoiceType, shipmentFileNumber);
    const duplicateKey = buildVendorInvoiceDuplicateKey({
      invoiceType: existing.invoiceType,
      invoiceNumber: readNullable(body.invoiceNumber),
      quickBooksEntityId,
      quickBooksEntityDisplayName,
      entityNameRaw
    });

    if (duplicateKey) {
      const duplicate = await prisma.invoiceAutomationInvoice.findFirst({
        where: {
          tenantId: context.tenantId,
          invoiceType: "VENDOR",
          status: {
            in: VENDOR_INVOICE_DUPLICATE_CHECK_STATUSES
          },
          vendorInvoiceDuplicateKey: duplicateKey,
          id: {
            not: invoiceId
          }
        },
        select: {
          batch: {
            select: {
              batchNumber: true
            }
          }
        }
      });

      if (duplicate) {
        return NextResponse.json(
          { error: `This vendor invoice number already exists for the same vendor in batch ${duplicate.batch.batchNumber}.` },
          { status: 409 }
        );
      }
    }

    const issueCodes = getInvoiceDraftIssueCodes({
      extractedText: "manual accounting edit",
      shipmentFileNumber,
      invoiceNumber: readNullable(body.invoiceNumber),
      invoiceDate,
      entityNameRaw,
      quickBooksEntityId,
      totalAmount: readMoney(body.totalAmount),
      currency: readNullable(body.currency),
      productOrAccountName
    });

    const updated = await prisma.invoiceAutomationInvoice.update({
      where: {
        tenantId_id: {
          tenantId: context.tenantId,
          id: invoiceId
        }
      },
      data: {
        status: InvoiceAutomationStatus.ACCOUNTING_REVIEW,
        shipmentFileNumber,
        shipmentType: getShipmentTypeFromInvoiceFileNumber(shipmentFileNumber),
        businessLine: getBusinessLineFromInvoiceFileNumber(shipmentFileNumber),
        entityNameRaw,
        quickBooksEntityId,
        quickBooksEntityDisplayName,
        quickBooksMatchConfidence: quickBooksEntityId ? 100 : null,
        invoiceNumber: readNullable(body.invoiceNumber),
        vendorInvoiceDuplicateKey: duplicateKey,
        invoiceDate: parseDate(invoiceDate),
        dueDate: parseDate(dueDate),
        currency: readNullable(body.currency)?.toUpperCase() ?? null,
        subtotalAmount: decimalOrNull(readMoney(body.subtotalAmount)),
        taxAmount: decimalOrNull(readMoney(body.taxAmount)),
        totalAmount: decimalOrNull(readMoney(body.totalAmount)),
        productOrAccountName,
        issueCodes: issueCodes as Prisma.InputJsonValue,
        approvedByUserId: null,
        approvedAt: null,
        quickBooksPostingError: null
      },
      include: {
        batch: {
          select: {
            batchNumber: true
          }
        }
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "invoice-automation.accounting-edited",
        entityType: "InvoiceAutomationInvoice",
        entityId: invoiceId,
        before: {
          status: existing.status
        },
        after: {
          status: updated.status,
          invoiceNumber: updated.invoiceNumber,
          shipmentFileNumber: updated.shipmentFileNumber
        }
      }
    });

    revalidateInvoiceAutomation();

    return NextResponse.json({ invoice: toInvoiceAutomationRow(updated) });
  } catch (error) {
    console.error(error);
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "This vendor invoice number has already been uploaded for the same vendor." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update invoice." },
      { status: 500 }
    );
  }
}

function readNullable(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readDateString(value: unknown) {
  const text = readNullable(value);
  if (!text) {
    return null;
  }

  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

function readMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decimalOrNull(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? new Prisma.Decimal(value) : null;
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function revalidateInvoiceAutomation() {
  revalidatePath("/finance/invoice-automation");
  revalidatePath("/finance/invoice-automation/accounting");
  revalidatePath("/finance/invoice-automation/posted");
}
