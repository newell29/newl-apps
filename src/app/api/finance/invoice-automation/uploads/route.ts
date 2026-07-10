import { createHash } from "crypto";
import { InvoiceAutomationBatchStatus, InvoiceAutomationStatus, ModuleKey, PlatformRole, Prisma, type InvoiceAutomationType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { formatInvoiceApprovalBlocker, getInvoiceApprovalBlockingIssues } from "@/modules/invoice-automation/approval";
import { learnInvoiceAutomationCorrectionMemory } from "@/modules/invoice-automation/correction-memory-store";
import { buildInvoiceDuplicateKey, INVOICE_DUPLICATE_CHECK_STATUSES } from "@/modules/invoice-automation/duplicates";
import { learnInvoiceAutomationEntityAlias } from "@/modules/invoice-automation/entity-aliases";
import { defaultDueDateFromInvoiceDate, getInvoiceDraftIssueCodes, normalizeInvoiceAmountsForCurrency } from "@/modules/invoice-automation/extraction";
import { toInvoiceAutomationRow } from "@/modules/invoice-automation/row-mapper";
import type { InvoiceAutomationUploadDocument, InvoiceAutomationUploadDraft, InvoiceAutomationUploadResponse } from "@/modules/invoice-automation/types";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type UploadPayload = {
  invoiceType?: InvoiceAutomationType;
  sendToAccounting?: boolean;
  documents?: InvoiceAutomationUploadDocument[];
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
    const documentByClientId = buildUploadDocumentMap(body?.documents);
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

    if (sendToAccounting) {
      const approvalBlocker = findDraftApprovalBlocker(invoiceType, invoices);
      if (approvalBlocker) {
        return NextResponse.json({ error: approvalBlocker }, { status: 422 });
      }
    }

    const duplicateKeyByClientId = buildDuplicateKeyMap(invoiceType, invoices);
    const duplicateInUpload = findDuplicateUploadInvoice(invoiceType, invoices, duplicateKeyByClientId);
    if (duplicateInUpload) {
      return NextResponse.json(
        {
          error: `Duplicate ${duplicateInUpload.entityLabel} invoice ${duplicateInUpload.invoiceNumber} for ${duplicateInUpload.entityName} is already in this upload.`
        },
        { status: 409 }
      );
    }

    const duplicateKeys = [...new Set([...duplicateKeyByClientId.values()])];
    if (duplicateKeys.length > 0) {
      const existingDuplicate = await prisma.invoiceAutomationInvoice.findFirst({
        where: {
          tenantId: context.tenantId,
          invoiceType,
          status: {
            in: INVOICE_DUPLICATE_CHECK_STATUSES
          },
          vendorInvoiceDuplicateKey: { in: duplicateKeys }
        },
        select: {
          invoiceNumber: true,
          entityNameRaw: true,
          quickBooksEntityDisplayName: true,
          batch: {
            select: {
              batchNumber: true
            }
          }
        }
      });

      if (existingDuplicate) {
        const entityLabel = getInvoiceEntityLabel(invoiceType);
        return NextResponse.json(
          {
            error: `Duplicate ${entityLabel} invoice ${existingDuplicate.invoiceNumber ?? ""} for ${
              existingDuplicate.quickBooksEntityDisplayName ?? existingDuplicate.entityNameRaw ?? `this ${entityLabel}`
            } already exists in batch ${existingDuplicate.batch.batchNumber}.`
          },
          { status: 409 }
        );
      }
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
      const persistedDocumentByClientId = new Map<string, { id: string; fileName: string }>();

      for (const invoice of invoices) {
        const documentClientId = readNullable(invoice.documentClientId) ?? invoice.clientId;
        let document = persistedDocumentByClientId.get(documentClientId);
        if (!document) {
          document = await persistInvoiceAutomationDocument(tx, {
            tenantId: context.tenantId,
            userId: context.userId,
            now,
            invoice,
            document: documentByClientId.get(documentClientId)
          });
          persistedDocumentByClientId.set(documentClientId, document);
        }

        const invoiceDate = parseDate(invoice.invoiceDate);
        const dueDate = parseDate(invoice.dueDate) ?? parseDate(defaultDueDateFromInvoiceDate(invoice.invoiceDate));
        const entityNameRaw = readNullable(invoice.entityNameRaw);
        const quickBooksEntityId = readNullable(invoice.quickBooksEntityId);
        const quickBooksEntityDisplayName = readNullable(invoice.quickBooksEntityDisplayName);
        const currency = readNullable(invoice.currency)?.toUpperCase() ?? null;
        const amounts = normalizeInvoiceAmountsForCurrency({
          currency,
          subtotalAmount: invoice.subtotalAmount,
          taxAmount: invoice.taxAmount,
          totalAmount: invoice.totalAmount
        });
        const issueCodes = getInvoiceDraftIssueCodes({
          ...invoice,
          currency,
          totalAmount: amounts.totalAmount
        });
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
            entityNameRaw,
            quickBooksEntityId,
            quickBooksEntityDisplayName,
            quickBooksMatchConfidence: invoice.quickBooksMatchConfidence,
            invoiceNumber: readNullable(invoice.invoiceNumber),
            vendorInvoiceDuplicateKey: duplicateKeyByClientId.get(invoice.clientId) ?? null,
            invoiceDate,
            dueDate,
            currency,
            subtotalAmount: decimalOrNull(amounts.subtotalAmount),
            taxAmount: decimalOrNull(amounts.taxAmount),
            totalAmount: decimalOrNull(amounts.totalAmount),
            productOrAccountName: readNullable(invoice.productOrAccountName),
            issueCodes: issueCodes as Prisma.InputJsonValue,
            extractionJson: {
              clientId: invoice.clientId,
              suppliedIssueCodes: invoice.issueCodes,
              textLength: typeof invoice.extractedText === "string" ? invoice.extractedText.length : 0
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

        await learnInvoiceAutomationEntityAlias(tx, {
          tenantId: context.tenantId,
          invoiceType,
          aliasRawName: entityNameRaw,
          quickBooksEntityId,
          quickBooksEntityDisplayName,
          currency,
          userId: context.userId
        });

        await learnInvoiceAutomationCorrectionMemory(tx, {
          tenantId: context.tenantId,
          invoiceType,
          entityNameRaw,
          quickBooksEntityId,
          quickBooksEntityDisplayName,
          shipmentFileNumber: readNullable(invoice.shipmentFileNumber),
          currency,
          productOrAccountName: readNullable(invoice.productOrAccountName),
          invoiceDate,
          dueDate,
          userId: context.userId
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
      invoices: created.invoices.map((invoice) => toInvoiceAutomationRow(invoice))
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error(error);
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "This invoice number has already been uploaded for the same customer or vendor." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload invoices." },
      { status: 500 }
    );
  }
}

function buildDuplicateKeyMap(invoiceType: InvoiceAutomationType, invoices: InvoiceAutomationUploadDraft[]) {
  const duplicateKeyByClientId = new Map<string, string>();

  for (const invoice of invoices) {
    const duplicateKey = buildInvoiceDuplicateKey({
      invoiceType,
      invoiceNumber: readNullable(invoice.invoiceNumber),
      quickBooksEntityId: readNullable(invoice.quickBooksEntityId),
      quickBooksEntityDisplayName: readNullable(invoice.quickBooksEntityDisplayName),
      entityNameRaw: readNullable(invoice.entityNameRaw)
    });

    if (duplicateKey) {
      duplicateKeyByClientId.set(invoice.clientId, duplicateKey);
    }
  }

  return duplicateKeyByClientId;
}

function findDraftApprovalBlocker(invoiceType: InvoiceAutomationType, invoices: InvoiceAutomationUploadDraft[]) {
  for (const invoice of invoices) {
    const issues = getInvoiceApprovalBlockingIssues({
      invoiceType,
      fileName: invoice.fileName,
      shipmentFileNumber: invoice.shipmentFileNumber,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      entityNameRaw: invoice.entityNameRaw,
      quickBooksEntityId: invoice.quickBooksEntityId,
      currency: invoice.currency,
      totalAmount: invoice.totalAmount,
      productOrAccountName: invoice.productOrAccountName
    });

    if (issues.length > 0) {
      return formatInvoiceApprovalBlocker(
        {
          invoiceType,
          fileName: invoice.fileName,
          shipmentFileNumber: invoice.shipmentFileNumber,
          invoiceNumber: invoice.invoiceNumber
        },
        issues
      );
    }
  }

  return null;
}

function findDuplicateUploadInvoice(
  invoiceType: InvoiceAutomationType,
  invoices: InvoiceAutomationUploadDraft[],
  duplicateKeyByClientId: Map<string, string>
) {
  const entityLabel = getInvoiceEntityLabel(invoiceType);
  const seen = new Set<string>();

  for (const invoice of invoices) {
    const duplicateKey = duplicateKeyByClientId.get(invoice.clientId);
    if (!duplicateKey) {
      continue;
    }

    if (seen.has(duplicateKey)) {
      return {
        invoiceNumber: readNullable(invoice.invoiceNumber) ?? "unknown",
        entityName:
          readNullable(invoice.quickBooksEntityDisplayName) ??
          readNullable(invoice.entityNameRaw) ??
          `this ${entityLabel}`,
        entityLabel
      };
    }

    seen.add(duplicateKey);
  }

  return null;
}

type UploadTransaction = Prisma.TransactionClient;

function buildUploadDocumentMap(documents: unknown) {
  const documentByClientId = new Map<string, InvoiceAutomationUploadDocument>();
  if (!Array.isArray(documents)) {
    return documentByClientId;
  }

  for (const document of documents) {
    if (!document || typeof document !== "object") {
      continue;
    }

    const candidate = document as Partial<InvoiceAutomationUploadDocument>;
    const clientDocumentId = readNullable(candidate.clientDocumentId);
    if (!clientDocumentId) {
      continue;
    }

    documentByClientId.set(clientDocumentId, {
      clientDocumentId,
      fileName: readString(candidate.fileName, "invoice.pdf"),
      contentType: readString(candidate.contentType, "application/pdf"),
      sizeBytes: Number.isFinite(candidate.sizeBytes) ? Number(candidate.sizeBytes) : 0,
      pdfBase64: typeof candidate.pdfBase64 === "string" ? candidate.pdfBase64 : "",
      extractedText: readNullable(candidate.extractedText)
    });
  }

  return documentByClientId;
}

async function persistInvoiceAutomationDocument(
  tx: UploadTransaction,
  {
    tenantId,
    userId,
    now,
    invoice,
    document
  }: {
    tenantId: string;
    userId: string;
    now: Date;
    invoice: InvoiceAutomationUploadDraft;
    document?: InvoiceAutomationUploadDocument;
  }
) {
  const pdfBase64 = document?.pdfBase64 || invoice.pdfBase64;
  const pdfBytes = decodeBase64Pdf(pdfBase64);
  const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
  const persisted = await tx.invoiceAutomationDocument.upsert({
    where: {
      tenantId_sha256: {
        tenantId,
        sha256
      }
    },
    update: {
      extractedText: (document?.extractedText ?? invoice.extractedText)?.slice(0, 200000) ?? null,
      updatedAt: now
    },
    create: {
      tenantId,
      fileName: readString(document?.fileName, readString(invoice.fileName, "invoice.pdf")),
      contentType: readString(document?.contentType, readString(invoice.contentType, "application/pdf")),
      sizeBytes: Number.isFinite(document?.sizeBytes) && document?.sizeBytes ? document.sizeBytes : Number.isFinite(invoice.sizeBytes) ? invoice.sizeBytes : pdfBytes.byteLength,
      sha256,
      extractedText: (document?.extractedText ?? invoice.extractedText)?.slice(0, 200000) ?? null,
      pdfBytes,
      uploadedByUserId: userId
    },
    select: {
      id: true,
      fileName: true
    }
  });

  return persisted;
}

function getInvoiceEntityLabel(invoiceType: InvoiceAutomationType) {
  return invoiceType === "CUSTOMER" ? "customer" : "vendor";
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
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
