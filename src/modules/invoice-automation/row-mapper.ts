import type { InvoiceAutomationInvoice, Prisma } from "@prisma/client";
import type { InvoiceAutomationRow } from "@/modules/invoice-automation/types";

export type InvoiceAutomationRecordWithBatch = InvoiceAutomationInvoice & {
  batch: {
    batchNumber: string;
  };
};

export function toInvoiceAutomationRow(
  invoice: InvoiceAutomationRecordWithBatch,
  userNameById: Map<string, string> = new Map()
): InvoiceAutomationRow {
  return {
    id: invoice.id,
    batchNumber: invoice.batch.batchNumber,
    invoiceType: invoice.invoiceType,
    status: invoice.status,
    fileName: invoice.fileName,
    shipmentFileNumber: invoice.shipmentFileNumber,
    shipmentType: invoice.shipmentType,
    entityNameRaw: invoice.entityNameRaw,
    quickBooksEntityId: invoice.quickBooksEntityId,
    quickBooksEntityDisplayName: invoice.quickBooksEntityDisplayName,
    quickBooksMatchConfidence: invoice.quickBooksMatchConfidence,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
    dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
    currency: invoice.currency,
    subtotalAmount: decimalToNumber(invoice.subtotalAmount),
    taxAmount: decimalToNumber(invoice.taxAmount),
    totalAmount: decimalToNumber(invoice.totalAmount),
    quickBooksExchangeRate: decimalToNumber(invoice.quickBooksExchangeRate),
    quickBooksHomeCurrency: invoice.quickBooksHomeCurrency,
    quickBooksSubtotalHomeAmount: decimalToNumber(invoice.quickBooksSubtotalHomeAmount),
    quickBooksTaxHomeAmount: decimalToNumber(invoice.quickBooksTaxHomeAmount),
    quickBooksTotalHomeAmount: decimalToNumber(invoice.quickBooksTotalHomeAmount),
    quickBooksFxSource: invoice.quickBooksFxSource,
    quickBooksFxCapturedAt: invoice.quickBooksFxCapturedAt?.toISOString() ?? null,
    productOrAccountName: invoice.productOrAccountName,
    reviewNotes: invoice.reviewNotes,
    issueCodes: readIssueCodes(invoice.issueCodes),
    createdAt: invoice.createdAt.toISOString(),
    sentToAccountingAt: invoice.sentToAccountingAt?.toISOString() ?? null,
    sentToAccountingByName: invoice.sentToAccountingById ? userNameById.get(invoice.sentToAccountingById) ?? null : null
  };
}

function readIssueCodes(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((issue): issue is string => typeof issue === "string") : [];
}

function decimalToNumber(value: { toString(): string } | number | null) {
  return value === null ? null : Number(value.toString());
}
