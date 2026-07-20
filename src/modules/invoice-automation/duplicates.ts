import { InvoiceAutomationStatus, type InvoiceAutomationType } from "@prisma/client";

export const INVOICE_DUPLICATE_CHECK_STATUSES = [
  InvoiceAutomationStatus.OPERATIONS_REVIEW,
  InvoiceAutomationStatus.ACCOUNTING_REVIEW,
  InvoiceAutomationStatus.APPROVED_FOR_POSTING,
  InvoiceAutomationStatus.POSTED,
  InvoiceAutomationStatus.POSTING_ERROR
];

export const VENDOR_INVOICE_DUPLICATE_CHECK_STATUSES = INVOICE_DUPLICATE_CHECK_STATUSES;

export type InvoiceDuplicateInput = {
  invoiceType: InvoiceAutomationType;
  invoiceNumber: string | null;
  quickBooksEntityId: string | null;
  quickBooksEntityDisplayName: string | null;
  entityNameRaw: string | null;
};

export function buildInvoiceDuplicateKey(input: InvoiceDuplicateInput) {
  const invoiceNumber = normalizeDuplicateToken(input.invoiceNumber);
  const entityToken = input.quickBooksEntityId
    ? `qb:${normalizeDuplicateToken(input.quickBooksEntityId)}`
    : `name:${normalizeDuplicateToken(input.quickBooksEntityDisplayName ?? input.entityNameRaw)}`;

  if (!invoiceNumber || entityToken.endsWith(":")) {
    return null;
  }

  return `${entityToken}|invoice:${invoiceNumber}`;
}

export function buildVendorInvoiceDuplicateKey(input: InvoiceDuplicateInput) {
  return buildInvoiceDuplicateKey(input);
}

export function normalizeDuplicateToken(value: string | null | undefined) {
  return value
    ?.toLowerCase()
    .replace(/\b(usd|cad|cdn)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim() ?? "";
}
