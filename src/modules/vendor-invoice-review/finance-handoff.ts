import { createHash } from "crypto";
import {
  InvoiceAutomationBatchStatus,
  InvoiceAutomationStatus,
  Prisma,
  type InvoiceAutomationType,
  type VendorInvoiceReviewInvoice
} from "@prisma/client";
import { buildInvoiceDuplicateKey } from "@/modules/invoice-automation/duplicates";
import {
  defaultDueDateFromInvoiceDate,
  getBusinessLineFromInvoiceFileNumber,
  getDefaultProductOrAccount,
  getInvoiceDraftIssueCodes,
  getShipmentTypeFromInvoiceFileNumber,
  matchQuickBooksEntity,
  normalizeInvoiceAmountsForCurrency
} from "@/modules/invoice-automation/extraction";
import { learnInvoiceAutomationCorrectionMemory } from "@/modules/invoice-automation/correction-memory-store";
import { learnInvoiceAutomationEntityAlias } from "@/modules/invoice-automation/entity-aliases";
import { getInvoiceAutomationEntityOptions } from "@/modules/invoice-automation/queries";
import type { AuthenticatedContext } from "@/server/tenant-context";

type HandoffInput = {
  tx: Prisma.TransactionClient;
  context: AuthenticatedContext;
  document: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    extractedText: string | null;
    pdfBytes: Uint8Array | Buffer;
    invoiceKind: string;
    approvedAt: Date | null;
    approvedByUserId: string | null;
    approvedByName: string | null;
    financeBatchId?: string | null;
  };
  invoices: VendorInvoiceReviewInvoice[];
  now: Date;
};

export async function sendVendorInvoiceReviewToFinance({ tx, context, document, invoices, now }: HandoffInput) {
  const invoiceType: InvoiceAutomationType = document.invoiceKind === "Customer_Invoices" ? "CUSTOMER" : "VENDOR";
  const batchNumber = `IA-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${document.id.slice(-6).toUpperCase()}`;
  const entityOptions = await getInvoiceAutomationEntityOptions(context);
  const existingFinanceIds = invoices.map((invoice) => invoice.financeInvoiceId).filter((id): id is string => Boolean(id));
  if (existingFinanceIds.length > 0) {
    return {
      batchId: document.financeBatchId ?? null,
      invoiceIds: existingFinanceIds
    };
  }

  const firstDuplicate = await findExistingFinanceDuplicate(tx, context.tenantId, invoiceType, invoices);
  if (firstDuplicate) {
    await tx.vendorInvoiceReviewDocument.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: document.id } },
      data: {
        financeStatus: "SENT_TO_FINANCE",
        financeBatchId: firstDuplicate.batchId,
        financeError: null
      }
    });
    return { batchId: firstDuplicate.batchId, invoiceIds: [firstDuplicate.id] };
  }

  const batch = await tx.invoiceAutomationBatch.create({
    data: {
      tenantId: context.tenantId,
      batchNumber,
      invoiceType,
      status: InvoiceAutomationBatchStatus.ACCOUNTING_REVIEW,
      uploadedByUserId: context.userId,
      sentToAccountingById: context.userId,
      sentToAccountingAt: now,
      notes: document.invoiceKind === "Vendor_Invoices" ? `Operations approved by ${document.approvedByName ?? "Unknown"}` : "Customer invoice intake"
    }
  });

  const pdfBytes = Buffer.from(document.pdfBytes);
  const financeDocument = await tx.invoiceAutomationDocument.create({
    data: {
      tenantId: context.tenantId,
      fileName: document.fileName,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes || pdfBytes.byteLength,
      sha256: createHash("sha256").update(pdfBytes).digest("hex"),
      extractedText: document.extractedText,
      pdfBytes,
      uploadedByUserId: context.userId
    }
  });

  const financeInvoiceIds: string[] = [];
  for (const invoice of invoices) {
    const currency = invoice.currency?.toUpperCase() ?? null;
    const entityMatch = invoice.vendorName ? matchQuickBooksEntity(invoice.vendorName, invoiceType, entityOptions, currency) : null;
    const quickBooksEntityId = entityMatch?.option.id ?? null;
    const quickBooksEntityDisplayName = entityMatch?.option.displayName ?? null;
    const quickBooksMatchConfidence = entityMatch?.confidence ?? null;
    const shipmentType = getShipmentTypeFromInvoiceFileNumber(invoice.tmsFileNumber);
    const businessLine = getBusinessLineFromInvoiceFileNumber(invoice.tmsFileNumber);
    const dueDate = parseDate(defaultDueDateFromInvoiceDate(invoice.invoiceDate?.toISOString().slice(0, 10) ?? null));
    const productOrAccountName = getDefaultProductOrAccount(invoiceType, invoice.tmsFileNumber);
    const amounts = normalizeInvoiceAmountsForCurrency({
      currency,
      subtotalAmount: decimalToNumber(invoice.subtotalAmount),
      taxAmount: decimalToNumber(invoice.taxAmount),
      totalAmount: decimalToNumber(invoice.totalAmount),
      preserveNonCadTax: true
    });
    const issueCodes = getInvoiceDraftIssueCodes({
      extractedText: document.extractedText ?? "",
      shipmentFileNumber: invoice.tmsFileNumber,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
      entityNameRaw: invoice.vendorName,
      quickBooksEntityId,
      totalAmount: amounts.totalAmount,
      currency,
      productOrAccountName
    });
    const financeInvoice = await tx.invoiceAutomationInvoice.create({
      data: {
        tenantId: context.tenantId,
        batchId: batch.id,
        documentId: financeDocument.id,
        invoiceType,
        status: InvoiceAutomationStatus.ACCOUNTING_REVIEW,
        fileName: invoice.fileName,
        shipmentFileNumber: invoice.tmsFileNumber,
        shipmentType,
        businessLine,
        entityNameRaw: invoice.vendorName,
        quickBooksEntityId,
        quickBooksEntityDisplayName,
        quickBooksMatchConfidence,
        invoiceNumber: invoice.invoiceNumber,
        vendorInvoiceDuplicateKey: buildFinanceDuplicateKey(invoiceType, invoice),
        invoiceDate: invoice.invoiceDate,
        dueDate,
        currency,
        subtotalAmount: decimalOrNull(amounts.subtotalAmount),
        taxAmount: decimalOrNull(amounts.taxAmount),
        totalAmount: decimalOrNull(amounts.totalAmount),
        productOrAccountName,
        issueCodes,
        extractionJson: {
          source: "operations-invoice-review",
          operationsDocumentId: document.id,
          operationsInvoiceId: invoice.id,
          suppliedIssueCodes: invoice.issueCodes,
          textLength: document.extractedText?.length ?? 0,
          reference: invoice.vendorReference,
          approvedByName: document.approvedByName,
          approvedAt: document.approvedAt?.toISOString() ?? null
        },
        reviewNotes: invoice.vendorReference ? `Reference: ${invoice.vendorReference}` : null,
        uploadedByUserId: context.userId,
        sentToAccountingById: context.userId,
        sentToAccountingAt: now,
        approvedByUserId: document.invoiceKind === "Vendor_Invoices" ? document.approvedByUserId : null,
        approvedAt: document.invoiceKind === "Vendor_Invoices" ? document.approvedAt : null
      }
    });

    await learnInvoiceAutomationEntityAlias(tx, {
      tenantId: context.tenantId,
      invoiceType,
      aliasRawName: invoice.vendorName,
      quickBooksEntityId,
      quickBooksEntityDisplayName,
      currency,
      userId: context.userId
    });

    await learnInvoiceAutomationCorrectionMemory(tx, {
      tenantId: context.tenantId,
      invoiceType,
      entityNameRaw: invoice.vendorName,
      quickBooksEntityId,
      quickBooksEntityDisplayName,
      shipmentFileNumber: invoice.tmsFileNumber,
      currency,
      productOrAccountName,
      invoiceDate: invoice.invoiceDate,
      dueDate,
      userId: context.userId
    });
    financeInvoiceIds.push(financeInvoice.id);
    await tx.vendorInvoiceReviewInvoice.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: invoice.id } },
      data: { financeInvoiceId: financeInvoice.id }
    });
  }

  await tx.vendorInvoiceReviewDocument.update({
    where: { tenantId_id: { tenantId: context.tenantId, id: document.id } },
    data: {
      financeStatus: "SENT_TO_FINANCE",
      financeBatchId: batch.id,
      financeError: null
    }
  });

  return { batchId: batch.id, invoiceIds: financeInvoiceIds };
}

async function findExistingFinanceDuplicate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoiceType: InvoiceAutomationType,
  invoices: VendorInvoiceReviewInvoice[]
) {
  const duplicateKeys = invoices.map((invoice) => buildFinanceDuplicateKey(invoiceType, invoice)).filter((value): value is string => Boolean(value));
  if (duplicateKeys.length === 0) return null;
  return tx.invoiceAutomationInvoice.findFirst({
    where: {
      tenantId,
      invoiceType,
      vendorInvoiceDuplicateKey: { in: duplicateKeys },
      status: { not: InvoiceAutomationStatus.REJECTED }
    },
    select: { id: true, batchId: true }
  });
}

function buildFinanceDuplicateKey(invoiceType: InvoiceAutomationType, invoice: Pick<VendorInvoiceReviewInvoice, "vendorName" | "invoiceNumber">) {
  return buildInvoiceDuplicateKey({
    invoiceType,
    invoiceNumber: invoice.invoiceNumber,
    quickBooksEntityId: null,
    quickBooksEntityDisplayName: null,
    entityNameRaw: invoice.vendorName
  });
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decimalToNumber(value: Prisma.Decimal | number | null) {
  return value === null ? null : Number(value.toString());
}

function decimalOrNull(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? new Prisma.Decimal(value) : null;
}
