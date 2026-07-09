import type { CashflowBusinessLine, InvoiceAutomationType } from "@prisma/client";
import type { InvoiceAutomationEntityOption, InvoiceAutomationUploadDraft } from "@/modules/invoice-automation/types";

const FILE_NUMBER_PATTERN = /(?:^|[^A-Z0-9])(OE|OI|AE|AI|TR|DR)\s*[-_#:]?\s*(\d+[A-Z]?\d*)\b/i;

const CUSTOMER_PRODUCT_BY_PREFIX: Record<string, string> = {
  OE: "Ocean Freight",
  OI: "Ocean Freight",
  AE: "Air Freight",
  AI: "Air Freight",
  TR: "Trucking",
  DR: "Trucking"
};

const VENDOR_ACCOUNT_BY_PREFIX: Record<string, string> = {
  OE: "5020 Ocean Freight Rate",
  OI: "5020 Ocean Freight Rate",
  AE: "5300 Air Freight Rate",
  AI: "5300 Air Freight Rate",
  TR: "5015 Trucking Rate",
  DR: "5015 Trucking Rate"
};

export function normalizeInvoiceEntityName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(usd|cad|cdn)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractShipmentFileNumber(text: string, fallbackName = "") {
  const match = `${text} ${fallbackName}`.match(FILE_NUMBER_PATTERN);
  if (!match) {
    return null;
  }

  return `${match[1].toUpperCase()}${match[2].toUpperCase()}`;
}

export function getShipmentTypeFromInvoiceFileNumber(fileNumber?: string | null) {
  return fileNumber?.match(/^[A-Z]+/)?.[0] ?? null;
}

export function getBusinessLineFromInvoiceFileNumber(fileNumber?: string | null): CashflowBusinessLine {
  const prefix = getShipmentTypeFromInvoiceFileNumber(fileNumber);
  if (prefix === "OE" || prefix === "OI") return "OCEAN";
  if (prefix === "AE" || prefix === "AI") return "AIR";
  if (prefix === "TR" || prefix === "DR") return "TRUCKING";
  return "OTHER";
}

export function getDefaultProductOrAccount(invoiceType: InvoiceAutomationType, fileNumber?: string | null) {
  const prefix = getShipmentTypeFromInvoiceFileNumber(fileNumber);
  if (!prefix) {
    return null;
  }

  return invoiceType === "CUSTOMER" ? CUSTOMER_PRODUCT_BY_PREFIX[prefix] ?? null : VENDOR_ACCOUNT_BY_PREFIX[prefix] ?? null;
}

export function extractInvoiceNumber(text: string, fallbackName = "") {
  const labelMatch = text.match(/\b(?:invoice|inv)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i);
  if (labelMatch) {
    return cleanToken(labelMatch[1]);
  }

  const fileNameMatch = fallbackName.match(/\b(?:invoice|inv)[\s_-]*([A-Z0-9][A-Z0-9._-]{2,})/i);
  return fileNameMatch ? cleanToken(fileNameMatch[1]) : null;
}

export function extractCurrency(text: string) {
  const upper = text.toUpperCase();
  if (/\bUSD\b|US\s*DOLLARS?/.test(upper)) return "USD";
  if (/\bCAD\b|\bCDN\b|CANADIAN\s*DOLLARS?/.test(upper)) return "CAD";
  if (/\$/.test(text)) return "CAD";
  return null;
}

export function extractInvoiceDate(text: string) {
  return findDateByLabels(text, ["invoice date", "bill date", "date"]);
}

export function extractDueDate(text: string) {
  return findDateByLabels(text, ["due date", "payment due"]);
}

export function extractInvoiceAmounts(text: string) {
  const subtotal = findMoneyByLabels(text, ["subtotal", "sub total", "amount before tax"]);
  const tax = findMoneyByLabels(text, ["hst", "sales tax", "tax"]);
  const total = findMoneyByLabels(text, ["total amount", "invoice total", "amount due", "balance due", "total rate", "inv amount", "total"]);

  return {
    subtotalAmount: subtotal ?? (total !== null && tax !== null ? roundMoney(total - tax) : null),
    taxAmount: tax,
    totalAmount: total ?? (subtotal !== null && tax !== null ? roundMoney(subtotal + tax) : subtotal)
  };
}

export function matchQuickBooksEntity(
  text: string,
  invoiceType: InvoiceAutomationType,
  options: InvoiceAutomationEntityOption[]
) {
  const normalizedText = normalizeInvoiceEntityName(text);
  const relevant = options.filter((option) => option.entityType === invoiceType);
  let best: { option: InvoiceAutomationEntityOption; confidence: number } | null = null;

  for (const option of relevant) {
    const normalizedName = option.normalizedName || normalizeInvoiceEntityName(option.displayName);
    if (!normalizedName) {
      continue;
    }

    let confidence = 0;
    if (normalizedText.includes(normalizedName)) {
      confidence = normalizedName.length > 12 ? 96 : 88;
    } else {
      const parts = normalizedName.split(" ").filter((part) => part.length > 2);
      const matchedParts = parts.filter((part) => normalizedText.includes(part)).length;
      if (parts.length > 0 && matchedParts > 0) {
        confidence = Math.round((matchedParts / parts.length) * 70);
      }
    }

    if (confidence > (best?.confidence ?? 0)) {
      best = { option, confidence };
    }
  }

  return best && best.confidence >= 55 ? best : null;
}

export function buildInvoiceDraftFromText({
  clientId,
  fileName,
  contentType,
  sizeBytes,
  pdfBase64,
  text,
  invoiceType,
  entityOptions
}: {
  clientId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  pdfBase64: string;
  text: string;
  invoiceType: InvoiceAutomationType;
  entityOptions: InvoiceAutomationEntityOption[];
}): InvoiceAutomationUploadDraft {
  const shipmentFileNumber = extractShipmentFileNumber(text, fileName);
  const shipmentType = getShipmentTypeFromInvoiceFileNumber(shipmentFileNumber);
  const businessLine = getBusinessLineFromInvoiceFileNumber(shipmentFileNumber);
  const entityMatch = matchQuickBooksEntity(text, invoiceType, entityOptions);
  const amounts = extractInvoiceAmounts(text);
  const invoiceDate = extractInvoiceDate(text);
  const dueDate = extractDueDate(text) ?? defaultDueDateFromInvoiceDate(invoiceDate);
  const draft: InvoiceAutomationUploadDraft = {
    clientId,
    fileName,
    contentType,
    sizeBytes,
    pdfBase64,
    extractedText: text,
    shipmentFileNumber,
    shipmentType,
    businessLine,
    entityNameRaw: entityMatch?.option.displayName ?? extractEntityNameByLabel(text, invoiceType),
    quickBooksEntityId: entityMatch?.option.id ?? null,
    quickBooksEntityDisplayName: entityMatch?.option.displayName ?? null,
    quickBooksMatchConfidence: entityMatch?.confidence ?? null,
    invoiceNumber: extractInvoiceNumber(text, fileName),
    invoiceDate,
    dueDate,
    currency: extractCurrency(text),
    subtotalAmount: amounts.subtotalAmount,
    taxAmount: amounts.taxAmount,
    totalAmount: amounts.totalAmount,
    productOrAccountName: getDefaultProductOrAccount(invoiceType, shipmentFileNumber),
    issueCodes: []
  };

  return {
    ...draft,
    issueCodes: getInvoiceDraftIssueCodes(draft)
  };
}

export function getInvoiceDraftIssueCodes(draft: Pick<InvoiceAutomationUploadDraft, "extractedText" | "shipmentFileNumber" | "invoiceNumber" | "invoiceDate" | "entityNameRaw" | "quickBooksEntityId" | "totalAmount" | "currency" | "productOrAccountName">) {
  const issues: string[] = [];
  if (!draft.extractedText.trim()) issues.push("NO_EXTRACTABLE_TEXT");
  if (!draft.shipmentFileNumber) issues.push("MISSING_FILE_NUMBER");
  if (!draft.invoiceNumber) issues.push("MISSING_INVOICE_NUMBER");
  if (!draft.invoiceDate) issues.push("MISSING_INVOICE_DATE");
  if (!draft.entityNameRaw) issues.push("MISSING_CUSTOMER_OR_VENDOR");
  if (!draft.quickBooksEntityId) issues.push("MISSING_QB_MATCH");
  if (draft.totalAmount === null) issues.push("MISSING_TOTAL");
  if (!draft.currency) issues.push("MISSING_CURRENCY");
  if (!draft.productOrAccountName) issues.push("MISSING_PRODUCT_OR_ACCOUNT");
  return issues;
}

function extractEntityNameByLabel(text: string, invoiceType: InvoiceAutomationType) {
  if (invoiceType === "VENDOR") {
    return extractVendorName(text);
  }

  const label = invoiceType === "CUSTOMER" ? "(?:bill to|customer|invoice to)" : "(?:vendor|remit to|from)";
  const match = text.match(new RegExp(`${label}\\s*:?\\s*([^\\n\\r]{3,80})`, "i"));
  return match ? cleanupLine(match[1]) : null;
}

function extractVendorName(text: string) {
  const patterns = [
    /\bAssigned\s+For\s*:?\s*([\s\S]{0,80}?)([A-Z0-9][A-Z0-9 &.,'/-]+?(?:INCORPORATED|INC\.?|LTD\.?|LIMITED|LLC|CORP\.?|CORPORATION|COMPANY|CO\.?))\b/i,
    /\bcarrier\s+name\s*[–—-]\s*["“]?([^"”\n\r]{3,80})["”]?/i,
    /\bcarrier\s*:?\s*([A-Z0-9][A-Z0-9 &.,'/-]+?(?:INCORPORATED|INC\.?|LTD\.?|LIMITED|LLC|CORP\.?|CORPORATION|COMPANY|CO\.?))\b/i,
    /(?:^|\n|\r)([A-Z0-9][A-Z0-9 &.,'/-]+?(?:INCORPORATED|INC\.?|LTD\.?|LIMITED|LLC|CORP\.?|CORPORATION|COMPANY|CO\.?))\s+(?:\n|\r|\s)+INVOICE\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const rawValue = match?.[2] ?? match?.[1];
    const cleaned = rawValue ? cleanupLine(rawValue) : null;
    if (cleaned && !isFactoringOrPayeeName(cleaned)) {
      return cleaned;
    }
  }

  const labelMatch = text.match(/\b(?:vendor|from)\s*:\s*([^\n\r]{3,80})/i);
  const labeledVendor = labelMatch ? cleanupLine(labelMatch[1]) : null;
  return labeledVendor && !isFactoringOrPayeeName(labeledVendor) ? labeledVendor : null;
}

function isFactoringOrPayeeName(value: string) {
  return /\b(RTS\s+Financial|financial\s+service|factoring|factor|payable\s+to|remit\s+to)\b/i.test(value);
}

function findDateByLabels(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}\\s*:?\\s*([A-Z][a-z]+\\s+\\d{1,2},\\s*\\d{4}|\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})`, "i"));
    if (match) {
      return normalizeDate(match[1]);
    }
  }

  return null;
}

function findMoneyByLabels(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}\\s*:?\\s*(?:CAD|USD|CDN)?\\s*\\$?\\s*(-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})|-?\\d+(?:\\.\\d{2}))`, "i"));
    if (match) {
      return parseMoney(match[1]);
    }
  }

  return null;
}

function normalizeDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

export function defaultDueDateFromInvoiceDate(invoiceDate: string | null) {
  if (!invoiceDate) {
    return null;
  }

  const parsed = new Date(`${invoiceDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  parsed.setUTCDate(parsed.getUTCDate() + 30);
  return parsed.toISOString().slice(0, 10);
}

function parseMoney(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cleanToken(value: string) {
  return value.replace(/[,.):;]+$/g, "").trim();
}

function cleanupLine(value: string) {
  return value.replace(/\s{2,}/g, " ").replace(/\b(invoice|date|amount)\b.*$/i, "").trim() || null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
