import { createHash } from "crypto";
import { ModuleKey, PlatformRole, Prisma, VendorInvoiceReviewStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  buildVendorInvoiceReviewDuplicateKey,
  findDuplicateVendorInvoiceReviewDraft,
  getVendorInvoiceReviewDraftIssues
} from "@/modules/vendor-invoice-review/review";
import { sendVendorInvoiceReviewToFinance } from "@/modules/vendor-invoice-review/finance-handoff";
import { stampVendorInvoicePdf } from "@/modules/vendor-invoice-review/stamping";
import type {
  VendorInvoiceReviewDocumentUpload,
  VendorInvoiceReviewDraft,
  VendorInvoiceReviewKind,
  VendorInvoiceReviewUploadResponse
} from "@/modules/vendor-invoice-review/types";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type UploadPayload = {
  document?: VendorInvoiceReviewDocumentUpload;
  invoices?: VendorInvoiceReviewDraft[];
  invoiceKind?: VendorInvoiceReviewKind;
  approveAndStamp?: boolean;
};

export async function POST(request: Request) {
  return saveInvoiceReviewUpload(request, "Vendor_Invoices");
}

export async function saveInvoiceReviewUpload(request: Request, forcedInvoiceKind: VendorInvoiceReviewKind) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
    await requireMutationAccess(context);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.OPERATIONS, PlatformRole.FINANCE]);

    const body = (await request.json().catch(() => null)) as UploadPayload | null;
    const invoiceKind = forcedInvoiceKind;
    const document = readDocument(body?.document, invoiceKind);
    const invoices = Array.isArray(body?.invoices) ? body.invoices : [];
    const approveAndStamp = body?.approveAndStamp === true;

    if (!document) {
      return NextResponse.json({ error: "Upload one PDF package before saving." }, { status: 400 });
    }

    if (invoices.length === 0) {
      return NextResponse.json({ error: "Keep at least one detected invoice row before saving." }, { status: 400 });
    }

    if (invoiceKind === "Vendor_Invoices" && !approveAndStamp) {
      return NextResponse.json({ error: "Approve and stamp the vendor invoice package before saving." }, { status: 422 });
    }

    const duplicateInUpload = findDuplicateVendorInvoiceReviewDraft(invoices);
    if (duplicateInUpload) {
      return NextResponse.json(
        {
          error: `Duplicate vendor invoice ${duplicateInUpload.duplicate.invoiceNumber ?? ""} for ${
            duplicateInUpload.duplicate.vendorName ?? "this vendor"
          } is already in this upload.`
        },
        { status: 409 }
      );
    }

    const preparedInvoices = invoices.map((invoice) => prepareInvoiceForSave(invoice, invoiceKind));
    const incomplete = preparedInvoices.find((invoice) => invoice.issueCodes.includes("CONFIRM_TMS_FILE_NUMBER"));
    if (incomplete) {
      return NextResponse.json(
        { error: `${incomplete.invoiceNumber ?? incomplete.fileName} needs a confirmed TMS file number before saving.` },
        { status: 422 }
      );
    }

    const duplicateKeys = preparedInvoices
      .map((invoice) => invoice.duplicateKey)
      .filter((value): value is string => Boolean(value));

    if (duplicateKeys.length > 0) {
      const existingDuplicate = await prisma.vendorInvoiceReviewInvoice.findFirst({
        where: {
          tenantId: context.tenantId,
          duplicateKey: { in: duplicateKeys }
        },
        select: {
          invoiceNumber: true,
          vendorName: true,
          tmsFileNumber: true
        }
      });

      if (existingDuplicate) {
        return NextResponse.json(
          {
            error: `Duplicate vendor invoice ${existingDuplicate.invoiceNumber ?? ""} for ${
              existingDuplicate.vendorName ?? "this vendor"
            } already exists for TMS file ${existingDuplicate.tmsFileNumber}.`
          },
          { status: 409 }
        );
      }
    }

    const originalPdfBytes = decodeBase64Pdf(document.pdfBase64);
    const now = new Date();
    const approvedByName = context.userName || context.userEmail || "Unknown user";
    const pdfBytes =
      invoiceKind === "Vendor_Invoices"
        ? Buffer.from(
            await stampVendorInvoicePdf(originalPdfBytes, {
              tmsFileNumber: preparedInvoices[0]?.confirmedTmsFileNumber ?? "",
              approvedByName,
              approvedAt: now
            })
          )
        : originalPdfBytes;
    const sha256 = createHash("sha256").update(pdfBytes).digest("hex");

    const created = await prisma.$transaction(async (tx) => {
      const persistedDocument = await tx.vendorInvoiceReviewDocument.create({
        data: {
          tenantId: context.tenantId,
          invoiceKind,
          fileName: document.fileName,
          contentType: document.contentType,
          sizeBytes: document.sizeBytes || pdfBytes.byteLength,
          sha256,
          extractedText: document.extractedText?.slice(0, 200000) ?? null,
          pdfBytes,
          approvedAt: invoiceKind === "Vendor_Invoices" ? now : null,
          approvedByUserId: invoiceKind === "Vendor_Invoices" ? context.userId : null,
          approvedByName: invoiceKind === "Vendor_Invoices" ? approvedByName : null,
          financeStatus: invoiceKind === "Vendor_Invoices" ? "APPROVED" : "SAVED",
          uploadedByUserId: context.userId
        }
      });

      const rows = [];
      for (const invoice of preparedInvoices) {
        rows.push(
          await tx.vendorInvoiceReviewInvoice.create({
            data: {
              tenantId: context.tenantId,
              documentId: persistedDocument.id,
              invoiceKind,
              status: VendorInvoiceReviewStatus.SAVED,
              fileName: invoice.fileName,
              vendorName: readNullable(invoice.vendorName),
              invoiceNumber: readNullable(invoice.invoiceNumber),
              invoiceDate: parseDate(invoice.invoiceDate),
              tmsFileNumber: invoice.confirmedTmsFileNumber,
              vendorReference: readNullable(invoice.vendorReference),
              currency: readNullable(invoice.currency)?.toUpperCase() ?? null,
              subtotalAmount: decimalOrNull(invoice.subtotalAmount),
              taxAmount: decimalOrNull(invoice.taxAmount),
              totalAmount: decimalOrNull(invoice.totalAmount),
              duplicateKey: invoice.duplicateKey,
              issueCodes: invoice.issueCodes as Prisma.InputJsonValue,
              extractionJson: {
                clientId: invoice.clientId,
                originalExtractedTmsFileNumber: invoice.tmsFileNumber,
                vendorReference: invoice.vendorReference,
                approvedAndStamped: invoiceKind === "Vendor_Invoices"
              },
              uploadedByUserId: context.userId
            }
          })
        );
      }

      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "vendor-invoice-review.saved",
          entityType: "VendorInvoiceReviewDocument",
          entityId: persistedDocument.id,
          after: {
            fileName: document.fileName,
            invoiceKind,
            invoiceCount: rows.length,
            createdAt: now.toISOString()
          }
        }
      });

      try {
        await sendVendorInvoiceReviewToFinance({
          tx,
          context,
          document: {
            id: persistedDocument.id,
            fileName: persistedDocument.fileName,
            contentType: persistedDocument.contentType,
            sizeBytes: persistedDocument.sizeBytes,
            extractedText: persistedDocument.extractedText,
            pdfBytes: persistedDocument.pdfBytes,
            invoiceKind: persistedDocument.invoiceKind,
            approvedAt: persistedDocument.approvedAt,
            approvedByUserId: persistedDocument.approvedByUserId,
            approvedByName: persistedDocument.approvedByName,
            financeBatchId: persistedDocument.financeBatchId
          },
          invoices: rows,
          now
        });
      } catch (handoffError) {
        await tx.vendorInvoiceReviewDocument.update({
          where: { tenantId_id: { tenantId: context.tenantId, id: persistedDocument.id } },
          data: {
            financeStatus: "FINANCE_HANDOFF_FAILED",
            financeError: handoffError instanceof Error ? handoffError.message.slice(0, 500) : "Finance handoff failed."
          }
        });
      }

      const finalDocument = await tx.vendorInvoiceReviewDocument.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: context.tenantId, id: persistedDocument.id } }
      });

      return { document: finalDocument, invoices: rows };
    });

    revalidatePath(invoiceKind === "Vendor_Invoices" ? "/operations/vendor-invoice-review" : "/operations/customer-invoice-intake");

    const response: VendorInvoiceReviewUploadResponse = {
      documentId: created.document.id,
      invoiceKind,
      financeStatus: created.document.financeStatus,
      financeError: created.document.financeError,
      financeBatchId: created.document.financeBatchId,
      invoiceCount: created.invoices.length,
      invoices: created.invoices.map((invoice) => ({
        id: invoice.id,
        documentId: invoice.documentId,
        invoiceKind: readInvoiceKind(invoice.invoiceKind),
        fileName: invoice.fileName,
        vendorName: invoice.vendorName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
        tmsFileNumber: invoice.tmsFileNumber,
        vendorReference: invoice.vendorReference,
        currency: invoice.currency,
        subtotalAmount: decimalToNumber(invoice.subtotalAmount),
        taxAmount: decimalToNumber(invoice.taxAmount),
        totalAmount: decimalToNumber(invoice.totalAmount),
        issueCodes: readIssueCodes(invoice.issueCodes),
        financeInvoiceId: invoice.financeInvoiceId,
        createdAt: invoice.createdAt.toISOString()
      }))
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error(error);
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "This vendor invoice has already been saved." }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save vendor invoice review." },
      { status: 500 }
    );
  }
}

function prepareInvoiceForSave(invoice: VendorInvoiceReviewDraft, invoiceKind: VendorInvoiceReviewKind) {
  const confirmedTmsFileNumber = readNullable(invoice.confirmedTmsFileNumber);
  const issueCodes = getVendorInvoiceReviewDraftIssues({
    ...invoice,
    confirmedTmsFileNumber
  });
  return {
    ...invoice,
    invoiceKind,
    confirmedTmsFileNumber: confirmedTmsFileNumber ?? "",
    issueCodes,
    duplicateKey: prefixDuplicateKey(invoiceKind, buildVendorInvoiceReviewDuplicateKey({
      vendorName: invoice.vendorName,
      invoiceNumber: invoice.invoiceNumber
    }))
  };
}

function prefixDuplicateKey(invoiceKind: VendorInvoiceReviewKind, duplicateKey: string | null) {
  return duplicateKey ? `${invoiceKind}:${duplicateKey}` : null;
}

function readDocument(document: unknown, invoiceKind: VendorInvoiceReviewKind): VendorInvoiceReviewDocumentUpload | null {
  if (!document || typeof document !== "object") {
    return null;
  }
  const candidate = document as Partial<VendorInvoiceReviewDocumentUpload>;
  const clientDocumentId = readNullable(candidate.clientDocumentId);
  const fileName = readNullable(candidate.fileName);
  const pdfBase64 = typeof candidate.pdfBase64 === "string" ? candidate.pdfBase64 : null;
  if (!clientDocumentId || !fileName || !pdfBase64) {
    return null;
  }

  return {
    clientDocumentId,
    invoiceKind,
    fileName,
    contentType: readNullable(candidate.contentType) ?? "application/pdf",
    sizeBytes: Number.isFinite(candidate.sizeBytes) ? Number(candidate.sizeBytes) : 0,
    pdfBase64,
    extractedText: readNullable(candidate.extractedText)
  };
}

function readInvoiceKind(value: unknown): VendorInvoiceReviewKind {
  return value === "Customer_Invoices" ? "Customer_Invoices" : "Vendor_Invoices";
}

function decodeBase64Pdf(value: string) {
  const buffer = Buffer.from(value.replace(/^data:application\/pdf;base64,/, ""), "base64");
  if (buffer.byteLength === 0) {
    throw new Error("The uploaded PDF was empty.");
  }
  return buffer;
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

function readIssueCodes(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((issue): issue is string => typeof issue === "string") : [];
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}
