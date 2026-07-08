import { AccountingInvoiceType, CashflowBusinessLine } from "@prisma/client";
import { extractFileNumber, getShipmentTypeFromFileNumber, normalizeQuickBooksCustomerName } from "@/modules/customer-cashflow/quickbooks";

export const INVOICE_FILE_NUMBER_PATTERN = /\b(AI|AE|OI|OE|TR|DR)\s*[-#:]?\s*(\d+[A-Z]?\d*)\b/i;

export function normalizeInvoiceEntityName(value?: string | null) {
  return normalizeQuickBooksCustomerName(value ?? "");
}

export function extractInvoiceFileNumber(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const match = value?.match(INVOICE_FILE_NUMBER_PATTERN);
    if (match) return `${match[1].toUpperCase()}${match[2].toUpperCase()}`;
    const existing = extractFileNumber(value);
    if (existing && !existing.startsWith("WH")) return existing;
  }
  return null;
}

export function getServicePrefix(fileNumber?: string | null) {
  return fileNumber?.match(/^[A-Z]+/)?.[0] ?? null;
}

export function inferInvoiceBusinessLine(prefix?: string | null): CashflowBusinessLine {
  if (prefix === "OE" || prefix === "OI") return CashflowBusinessLine.OCEAN;
  if (prefix === "AE" || prefix === "AI") return CashflowBusinessLine.AIR;
  if (prefix === "TR" || prefix === "DR") return CashflowBusinessLine.TRUCKING;
  return CashflowBusinessLine.OTHER;
}

export function inferShipmentType(fileNumber?: string | null) {
  if (!fileNumber) return null;
  if (fileNumber.startsWith("DR")) return "DR";
  return getShipmentTypeFromFileNumber(fileNumber);
}

export function inferInvoiceNumber(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const match = value?.match(/(?:invoice|inv)\s*(?:no\.?|number|#|:)\s*([A-Z0-9-]+)/i) ?? value?.match(/\bINV[-_ ]?([A-Z0-9-]{4,})\b/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

export function defaultServiceMapping(invoiceType: AccountingInvoiceType | null | undefined, prefix?: string | null) {
  const businessLine = inferInvoiceBusinessLine(prefix);
  if (invoiceType === AccountingInvoiceType.CUSTOMER_INVOICE) {
    if (prefix === "OE" || prefix === "OI") return { businessLine, itemName: "Ocean Freight", issue: null };
    if (prefix === "AE" || prefix === "AI") return { businessLine, itemName: "Air Freight", issue: null };
    if (prefix === "TR") return { businessLine, itemName: "Trucking", issue: null };
    if (prefix === "DR") return { businessLine, itemName: "Drayage / Trucking", issue: "DR_MAPPING_NEEDS_FINANCE_CONFIRMATION" };
  }
  if (invoiceType === AccountingInvoiceType.VENDOR_INVOICE) {
    if (prefix === "OE" || prefix === "OI") return { businessLine, accountName: "5020 Ocean Freight Rate", issue: null };
    if (prefix === "AE" || prefix === "AI") return { businessLine, accountName: "5300 Air Freight Rate", issue: null };
    if (prefix === "TR") return { businessLine, accountName: "5015 Trucking Rate", issue: null };
    if (prefix === "DR") return { businessLine, accountName: "5015 Trucking Rate", issue: "DR_MAPPING_NEEDS_FINANCE_CONFIRMATION" };
  }
  return { businessLine, issue: "UNKNOWN_SERVICE_PREFIX" };
}

export function buildInvoiceSearchText(input: Record<string, unknown>) {
  return Object.values(input).filter((value) => typeof value === "string" && value.trim()).join(" ").toLowerCase();
}
