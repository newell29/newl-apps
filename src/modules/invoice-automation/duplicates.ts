import { InvoiceAutomationStatus, type InvoiceAutomationType } from "@prisma/client";

export const VENDOR_INVOICE_DUPLICATE_CHECK_STATUSES = [
  InvoiceAutomationStatus.OPERATIONS_REVIEW,
  InvoiceAutomationStatus.ACCOUNTING_REVIEW,
  InvoiceAutomationStatus.APPROVED_FOR_POSTING,
  InvoiceAutomationStatus.POSTED,
  InvoiceAutomationStatus.POSTING_ERROR,
  InvoiceAutomationStatus.REJECTED
];

export type InvoiceDuplicateInput = {
  invoiceType: InvoiceAutomationType;
  invoiceNumber: string | null;
  quickBooksEntityId: string | null;
  quickBooksEntityDisplayName: string | null;
  entityNameRaw: string | null;
};

export function buildVendorInvoiceDuplicateKey(input: InvoiceDuplicateInput) {
  if (input.invoiceType !== "VENDOR") {
    return null;
  }

  const invoiceNumber = normalizeDuplicateToken(input.invoiceNumber);
  const vendorToken = input.quickBooksEntityId
    ? `qb:${normalizeDuplicateToken(input.quickBooksEntityId)}`
    : `name:${normalizeDuplicateToken(input.quickBooksEntityDisplayName ?? input.entityNameRaw)}`;

  if (!invoiceNumber || vendorToken.endsWith(":")) {
    return null;
  }

  return `${vendorToken}|invoice:${invoiceNumber}`;
}

export function normalizeDuplicateToken(value: string | null | undefined) {
  return value
    ?.toLowerCase()
    .replace(/\b(usd|cad|cdn)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim() ?? "";
}
