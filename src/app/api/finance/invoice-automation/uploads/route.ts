import { createHash } from "crypto";
import { InvoiceAutomationBatchStatus, InvoiceAutomationStatus, ModuleKey, PlatformRole, Prisma, type InvoiceAutomationType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getInvoiceDraftIssueCodes } from "@/modules/invoice-automation/extraction";
import type { InvoiceAutomationUploadDraft, InvoiceAutomationUploadResponse } from "@/modules/invoice-automation/types";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type UploadPayload = {
  invoiceType?: InvoiceAutomationType;
  sendToAccounting?: boolean;
  invoices?: InvoiceAutomationUploadDraft[];
};

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
    await requireMutationAccess(context);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.OPERATIONS, PlatformRole.FINANCE]);

    const body = (await request.json().catch(() => null)) as UploadPayload | null;
    const invoiceType = body?.invoiceType;
    const invoices = Array.isArray(body?.invoices) ? body.invoices : [];
    const sendToAccounting = body?.sendToAccounting === true;

    if (invoiceType !== "CUSTOMER" && invoiceType !== "VENDOR") {
      return NextResponse.json({ error: "invoiceType must be CUSTOMER or VENDOR." }, { status: 400 });
    }

    if (invoices.length === 0) {
      return NextResponse.json({ error: "Upload at least one invoice PDF." }, { status: 400 });
    }

    if (invoices.length > 25) {
      return NextResponse.json({ error: "Upload 25 invoices or fewer at a time." }, { status: 400 });
    }

    const batchNumber = `IA-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now().toString(36).toUpperCase()}`;
    const now = new Date();

    const created = await prisma.$transaction(async (tx) => {
      const batch = await tx.invoiceAutomationBatch.create({
        data: {
          tenantId: context.tenantId,
          batchNumber,
          invoiceType,
          status: sendToAccounting ? InvoiceAutomationBatchStatus.ACCOUNTING_REVIEW : InvoiceAutomationBatchStatus.OPERATIONS_REVIEW,
          uploadedByUserId: context.userId,
          sentToAccountingById: sendToAccounting ? context.userId : null,
          sentToAccountingAt: sendToAccounting ? now : null
        }
      });

      const createdInvoices = [];

      for (const invoice of invoices) {
        const pdfBytes = decodeBase64Pdf(invoice.pdfBase64);
        const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
        const document = await tx.invoiceAutomationDocument.upsert({
          where: {
            tenantId_sha256: {
              tenantId: context.tenantId,
              sha256
            }
          },
          update: {
            extractedText: invoice.extractedText?.slice(0, 200000) ?? null,
            updatedAt: now
          },
          create: {
            tenantId: context.tenantId,
            fileName: readString(invoice.fileName, "invoice.pdf"),
            contentType: readString(invoice.contentType, "application/pdf"),
            sizeBytes: Number.isFinite(invoice.sizeBytes) ? invoice.sizeBytes : pdfBytes.byteLength,
            sha256,
            extractedText: invoice.extractedText?.slice(0, 200000) ?? null,
            pdfBytes,
            uploadedByUserId: context.userId
          }
        });

        const issueCodes = getInvoiceDraftIssueCodes(invoice);
        const row = await tx.invoiceAutomationInvoice.create({
          data: {
            tenantId: context.tenantId,
            batchId: batch.id,
            documentId: document.id,
            invoiceType,
            status: sendToAccounting ? InvoiceAutomationStatus.ACCOUNTING_REVIEW : InvoiceAutomationStatus.OPERATIONS_REVIEW,
            fileName: readString(invoice.fileName, document.fileName),
            shipmentFileNumber: readNullable(invoice.shipmentFileNumber),
            shipmentType: readNullable(invoice.shipmentType),
            businessLine: invoice.businessLine,
            entityNameRaw: readNullable(invoice.entityNameRaw),
            quickBooksEntityId: readNullable(invoice.quickBooksEntityId),
            quickBooksEntityDisplayName: readNullable(invoice.quickBooksEntityDisplayName),
            quickBooksMatchConfidence: invoice.quickBooksMatchConfidence,
            invoiceNumber: readNullable(invoice.invoiceNumber),
            invoiceDate: parseDate(invoice.invoiceDate),
            dueDate: parseDate(invoice.dueDate),
            currency: readNullable(invoice.currency),
            subtotalAmount: decimalOrNull(invoice.subtotalAmount),
            taxAmount: decimalOrNull(invoice.taxAmount),
            totalAmount: decimalOrNull(invoice.totalAmount),
            productOrAccountName: readNullable(invoice.productOrAccountName),
            issueCodes: issueCodes as Prisma.InputJsonValue,
            extractionJson: {
              clientId: invoice.clientId,
              suppliedIssueCodes: invoice.issueCodes,
              textLength: invoice.extractedText.length
            },
            uploadedByUserId: context.userId,
            sentToAccountingById: sendToAccounting ? context.userId : null,
            sentToAccountingAt: sendToAccounting ? now : null
          },
          include: {
            batch: {
              select: {
                batchNumber: true
              }
            }
          }
        });

        createdInvoices.push(row);
      }

      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: sendToAccounting ? "invoice-automation.uploaded-and-sent" : "invoice-automation.uploaded",
          entityType: "InvoiceAutomationBatch",
          entityId: batch.id,
          after: {
            batchNumber,
            invoiceType,
            invoiceCount: createdInvoices.length
          }
        }
      });

      return { batch, invoices: createdInvoices };
    });

    revalidatePath("/finance/invoice-automation");
    revalidatePath("/finance/invoice-automation/accounting");

    const response: InvoiceAutomationUploadResponse = {
      batchId: created.batch.id,
      batchNumber: created.batch.batchNumber,
      invoiceCount: created.invoices.length,
      invoices: created.invoices.map((invoice) => ({
        id: invoice.id,
        batchNumber: invoice.batch.batchNumber,
        invoiceType: invoice.invoiceType,
        status: invoice.status,
        fileName: invoice.fileName,
        shipmentFileNumber: invoice.shipmentFileNumber,
        shipmentType: invoice.shipmentType,
        entityNameRaw: invoice.entityNameRaw,
        quickBooksEntityDisplayName: invoice.quickBooksEntityDisplayName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
        dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
        currency: invoice.currency,
        subtotalAmount: decimalToNumber(invoice.subtotalAmount),
        taxAmount: decimalToNumber(invoice.taxAmount),
        totalAmount: decimalToNumber(invoice.totalAmount),
        productOrAccountName: invoice.productOrAccountName,
        issueCodes: Array.isArray(invoice.issueCodes) ? invoice.issueCodes.filter((issue): issue is string => typeof issue === "string") : [],
        createdAt: invoice.createdAt.toISOString(),
        sentToAccountingAt: invoice.sentToAccountingAt?.toISOString() ?? null
      }))
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload invoices." },
      { status: 500 }
    );
  }
}

function decodeBase64Pdf(value: string) {
  const buffer = Buffer.from(value.replace(/^data:application\/pdf;base64,/, ""), "base64");
  if (buffer.byteLength === 0) {
    throw new Error("One of the uploaded PDFs was empty.");
  }
  return buffer;
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNullable(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decimalOrNull(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? new Prisma.Decimal(value) : null;
}

function decimalToNumber(value: { toString(): string } | number | null) {
  return value === null ? null : Number(value.toString());
}

