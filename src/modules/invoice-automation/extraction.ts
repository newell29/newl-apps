import type { CashflowBusinessLine, InvoiceAutomationType } from "@prisma/client";
import type { InvoiceAutomationEntityOption, InvoiceAutomationUploadDraft } from "@/modules/invoice-automation/types";

const FILE_NUMBER_PATTERN = /(?:^|[^A-Z0-9])(OE|OI|AE|AI|TR|DR)\s*[-_#:]?\s*(\d+[A-Z]?\d*)(?=$|[^A-Z0-9])/i;
const COMMON_CURRENCY_CODES = ["CAD", "USD", "EUR", "GBP", "AUD", "MXN", "CNY", "JPY", "CHF", "HKD", "SGD"];
const AUTO_QB_MATCH_CONFIDENCE_THRESHOLD = 90;
const CANADIAN_TAX_LABEL_PATTERN = /\b(?:GST|HST|PST|QST|SALES\s+TAX|TAX)\b/i;
const FOREIGN_TAX_LABEL_PATTERN = /\b(?:VAT|IVA|TVA)\b/i;
const IATA_CASS_VENDOR_NAME = "IATA CARGO ACCOUNTS SETTLEMENT SYSTEM - CANADA";
const ENTITY_MATCH_STOPWORDS = new Set([
  "air",
  "alberta",
  "bc",
  "british",
  "canada",
  "canadian",
  "columbia",
  "drayage",
  "freight",
  "gst",
  "hst",
  "manitoba",
  "new",
  "ontario",
  "ocean",
  "pst",
  "qst",
  "rate",
  "saskatchewan",
  "tax",
  "trucking",
  "vendor"
]);

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
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b(usd|cad|cdn|eur|gbp)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isInternalNewellEntityName(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const normalized = normalizeInvoiceEntityName(value);
  return /\bnewell(s)?\b/.test(normalized) || /\bnewl\b/.test(normalized);
}

export function isUnsafeInvoiceEntityName(value: string | null | undefined) {
  if (!value) {
    return true;
  }

  const normalized = normalizeInvoiceEntityName(value);
  const original = value.trim().toLowerCase();
  return (
    normalized.length < 3 ||
    /^(cad|cdn|usd|eur|gbp|aud|mxn|cny|jpy|chf|hkd|sgd)$/.test(original) ||
    /^(invoice|total|subtotal|tax|amount|ocean freight|air freight|trucking|warehouse)$/.test(normalized)
  );
}

export function inferCurrencyFromInvoiceEntityName(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const upper = value.toUpperCase();
  if (/\bUSD\b|US\s*DOLLARS?/.test(upper)) return "USD";
  if (/\bCAD\b|\bCDN\b|CANADIAN\s*DOLLARS?/.test(upper)) return "CAD";
  if (/\bEUR\b|EUROS?/.test(upper)) return "EUR";
  if (/\bGBP\b|POUNDS?|STERLING/.test(upper)) return "GBP";
  return null;
}

export function extractShipmentFileNumber(text: string, fallbackName = "") {
  const match = `${text} ${fallbackName}`.match(FILE_NUMBER_PATTERN);
  if (!match) {
    return null;
  }

  const extracted = `${match[1].toUpperCase()}${match[2].toUpperCase()}`;
  const fallbackMatch = fallbackName.match(FILE_NUMBER_PATTERN);
  if (fallbackMatch) {
    const fallback = `${fallbackMatch[1].toUpperCase()}${fallbackMatch[2].toUpperCase()}`;
    if (shouldPreferFileNameShipmentNumber(extracted, fallback)) {
      return fallback;
    }
  }

  return extracted;
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
  const explicitFileNameInvoice = extractExplicitInvoiceTokenFromFileName(fallbackName);
  if (explicitFileNameInvoice) {
    return explicitFileNameInvoice;
  }

  const repeatedInvoiceWordNumberMatch = text.match(/\binvoice\s+invoice\s+([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (repeatedInvoiceWordNumberMatch && !isGenericInvoiceFileToken(repeatedInvoiceWordNumberMatch[1])) {
    return cleanToken(repeatedInvoiceWordNumberMatch[1]);
  }

  const spacedInvoiceNumberMatch = text.match(/\bI\s*N\s*V\s*O\s*I\s*C\s*E\s+NO\.?[ \t]*[:.]?[ \t]*([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (spacedInvoiceNumberMatch && !isGenericInvoiceFileToken(spacedInvoiceNumberMatch[1])) {
    return cleanToken(spacedInvoiceNumberMatch[1]);
  }

  const spacedFactureMatch = text.match(/\bI\s*n\s+vo\s+ic\s*e\s*\/\s*F\s*a\s*c\s*tu\s*re\s+([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (spacedFactureMatch && !isGenericInvoiceFileToken(spacedFactureMatch[1])) {
    return cleanToken(spacedFactureMatch[1]);
  }

  const invoiceAdjustmentMatch = text.match(/\binvoice\/adjustment\s+invoice\s+nr\s*:\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (invoiceAdjustmentMatch && !isGenericInvoiceFileToken(invoiceAdjustmentMatch[1])) {
    return cleanToken(invoiceAdjustmentMatch[1]);
  }

  const invoiceNoMatch = text.match(/\binvoice\s+no\.?\s*[:：]\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (invoiceNoMatch && !isGenericInvoiceFileToken(invoiceNoMatch[1])) {
    return cleanToken(invoiceNoMatch[1]);
  }

  const taxInvoiceMatch = text.match(/\btax\s+invoice\s+([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (taxInvoiceMatch && !isGenericInvoiceFileToken(taxInvoiceMatch[1])) {
    return cleanToken(taxInvoiceMatch[1]);
  }

  const fileNumberAdjacentMatch = text.match(/\b(?:OE|OI|AE|AI|TR|DR)\s*[-_#:]?\s*\d+[A-Z]?\d*\s+([A-Z0-9][^\s]*)/i);
  const fileNumberAdjacentToken = fileNumberAdjacentMatch ? cleanToken(fileNumberAdjacentMatch[1]) : null;
  if (fileNumberAdjacentToken && /\d/.test(fileNumberAdjacentToken) && !isMoneyLikeToken(fileNumberAdjacentToken)) {
    return fileNumberAdjacentToken;
  }

  const shipmentAdjacentInvoice = extractInvoiceNumberAdjacentToFileNumber(text, fallbackName);
  if (shipmentAdjacentInvoice) {
    return shipmentAdjacentInvoice;
  }

  const invoiceNumberTableMatch = text.match(/\binvoice\s+number\s+invoice\s+date\s+([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (invoiceNumberTableMatch) {
    return cleanToken(invoiceNumberTableMatch[1]);
  }

  const dateInvoiceNumberTableMatch = text.match(/\bdate\s+invoice\s*#\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (dateInvoiceNumberTableMatch) {
    return cleanToken(dateInvoiceNumberTableMatch[1]);
  }

  const labelMatch = text.match(/\b(?:invoice|inv)[ \t]*(?:number|no\.?|#)[ \t]*[:：#-]?[ \t]*([A-Z0-9][A-Z0-9._/-]{2,})/i);
  if (labelMatch && !isGenericInvoiceFileToken(labelMatch[1])) {
    return cleanToken(labelMatch[1]);
  }

  const freightBillMatch = text.match(/\bP\s*a\s*r\s*t\s+\d+\s+of\s+\d+\s+([A-Z0-9][A-Z0-9._/-]{4,})\b/i);
  if (freightBillMatch) {
    return cleanToken(freightBillMatch[1]);
  }

  return extractInvoiceNumberFromFileName(fallbackName);
}

export function extractCurrency(text: string) {
  const upper = text.toUpperCase();
  if (/\bUSD\b|US\s*DOLLARS?/.test(upper)) return "USD";
  if (/\bCAD\b|\bCDN\b|CANADIAN\s*DOLLARS?|CANADIAN\s+DOL/.test(upper)) return "CAD";
  if (/\bEUR\b|EUROS?|€/.test(upper)) return "EUR";
  if (/\bGBP\b|POUNDS?|STERLING|£/.test(upper)) return "GBP";
  const explicitCurrencyMatch = upper.match(/\b(?:CURRENCY|CURR|AMOUNT|TOTAL)\s*:?\s*(CAD|USD|EUR|GBP|AUD|MXN|CNY|JPY|CHF|HKD|SGD)\b/);
  if (explicitCurrencyMatch) return explicitCurrencyMatch[1];
  const commonCode = COMMON_CURRENCY_CODES.find((code) => new RegExp(`\\b${code}\\b`).test(upper));
  if (commonCode) return commonCode;
  if (/\$/.test(text)) return "CAD";
  return null;
}

export function extractInvoiceDate(text: string) {
  const spacedInvoiceDateMatch = text.match(/\bI\s*N\s*V\s*O\s*I\s*C\s*E\s+NO\.?\s*[:.]?\s*[A-Z0-9][A-Z0-9._/-]{2,}\s+([A-Z]{3}\.?\s+\d{1,2},\s*\d{4})\b/i);
  if (spacedInvoiceDateMatch) {
    return normalizeDate(spacedInvoiceDateMatch[1]);
  }

  const tableHeaderDateMatch = text.match(/\bDATE\s*\n\s*(\d{1,2}\s+[A-Z][a-z]{2,},?\s+\d{4})\b/i);
  if (tableHeaderDateMatch) {
    return normalizeDate(tableHeaderDateMatch[1]);
  }

  const spacedDateMatch = text.match(/\bD\s*a\s*te\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i);
  if (spacedDateMatch) {
    return normalizeDate(spacedDateMatch[1]);
  }

  const tableDateMatch = text.match(/\binvoice\s+number\s+invoice\s+date\s+[A-Z0-9][A-Z0-9._/-]{2,}\s+(\d{1,2}-[A-Z][a-z]{2}-\d{2,4})\b/i);
  if (tableDateMatch) {
    return normalizeDate(tableDateMatch[1]);
  }

  const dateInvoiceTableMatch = text.match(/\bdate\s+invoice\s*#\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+[A-Z0-9][A-Z0-9._/-]{2,}/i);
  if (dateInvoiceTableMatch) {
    return normalizeDate(dateInvoiceTableMatch[1]);
  }

  const customerTermsTableMatch = text.match(/\binvoice\s+date\s+due\s+date\s+payment\s+terms\s+(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i);
  if (customerTermsTableMatch) {
    return normalizeDate(customerTermsTableMatch[1]);
  }

  return findDateByLabels(text, ["invoice date", "bill date", "date"]);
}

export function extractDueDate(text: string, invoiceDate: string | null = null) {
  if (invoiceDate && hasDueOnReceiptTerms(text)) {
    return invoiceDate;
  }

  return findDateByLabels(text, ["due date", "payment due"]);
}

export function extractInvoiceAmounts(text: string, currency?: string | null) {
  const subtotal = findMoneyByLabels(text, ["subtotal", "sub total", "amount before tax"]);
  const tax = findCanadianTaxAmount(text) ?? findForeignTaxAmount(text) ?? findMoneyByLabels(text, ["hst", "gst", "pst", "qst", "sales tax", "tax", "vat"]);
  const total =
    findTotalFromPrepaidTotals(text) ??
    findMoneyByLabels(text, ["total amount", "invoice total", "amount due", "balance due", "total rate", "inv amount", "total"]);

  return normalizeInvoiceAmountsForCurrency({
    currency,
    subtotalAmount: subtotal,
    taxAmount: tax,
    totalAmount: total
  });
}

export function normalizeInvoiceAmountsForCurrency({
  currency,
  subtotalAmount,
  taxAmount,
  totalAmount
}: {
  currency?: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
}) {
  const normalizedCurrency = currency?.toUpperCase() ?? null;
  const subtotal = subtotalAmount;
  let tax = taxAmount;
  let total = totalAmount;

  if (subtotal !== null && tax === null && total !== null && total >= subtotal) {
    tax = roundMoney(total - subtotal);
  }

  if (normalizedCurrency && normalizedCurrency !== "CAD" && tax !== null && tax > 0) {
    const costInclusiveTotal = total ?? (subtotal !== null ? roundMoney(subtotal + tax) : null);
    return {
      subtotalAmount: costInclusiveTotal ?? subtotal,
      taxAmount: 0,
      totalAmount: costInclusiveTotal ?? subtotal
    };
  }

  total = deriveInvoiceTotal(subtotal, tax, total);

  return {
    subtotalAmount: subtotal ?? (total !== null && tax !== null ? roundMoney(total - tax) : null),
    taxAmount: tax,
    totalAmount: total
  };
}

export function deriveInvoiceTotal(subtotalAmount: number | null, taxAmount: number | null, fallbackTotal: number | null = null) {
  if (subtotalAmount !== null && taxAmount !== null) {
    return roundMoney(subtotalAmount + taxAmount);
  }

  if (subtotalAmount !== null) {
    return fallbackTotal ?? subtotalAmount;
  }

  return fallbackTotal;
}

export function splitInvoiceTextIntoDocuments(text: string) {
  const compact = text.trim();
  if (!compact) {
    return [""];
  }

  const iataCassShipmentDocuments = splitIataCassStatementIntoShipmentDocuments(compact);
  if (iataCassShipmentDocuments.length > 0) {
    return iataCassShipmentDocuments;
  }

  const freightBillPartChunks = splitByFreightBillPartHeaders(compact);
  const groupedFreightBills = groupFreightBillParts(freightBillPartChunks);
  if (groupedFreightBills.length > 1) {
    return groupedFreightBills;
  }

  const tearChunks = compact
    .split(/-+\s*Tear\s+Here\s*-+/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const chunks = tearChunks.length > 1 ? tearChunks : splitByRepeatedInvoiceHeaders(compact);
  const grouped = groupFreightBillParts(chunks);

  if (grouped.length > 1) {
    return grouped;
  }

  return chunks.length > 1 ? chunks : [compact];
}

export function matchQuickBooksEntity(
  text: string,
  invoiceType: InvoiceAutomationType,
  options: InvoiceAutomationEntityOption[],
  invoiceCurrency?: string | null
) {
  const normalizedText = normalizeInvoiceEntityName(text);
  const normalizedInvoiceCurrency = invoiceCurrency?.toUpperCase() ?? null;
  const relevant = options.filter((option) => option.entityType === invoiceType);
  let best: { option: InvoiceAutomationEntityOption; confidence: number } | null = null;

  for (const option of relevant) {
    const normalizedName = option.normalizedName || normalizeInvoiceEntityName(option.displayName);
    if (!normalizedName) {
      continue;
    }
    if (isInternalNewellEntityName(option.displayName) || isInternalNewellEntityName(normalizedName)) {
      continue;
    }
    if (isUnsafeInvoiceEntityName(option.displayName) || isUnsafeInvoiceEntityName(normalizedName)) {
      continue;
    }

    let confidence = 0;
    if (normalizedText.includes(normalizedName)) {
      confidence = normalizedName.length > 12 ? 96 : 88;
    } else {
      const parts = normalizedName.split(" ").filter((part) => part.length > 2 && !ENTITY_MATCH_STOPWORDS.has(part));
      const matchedParts = parts.filter((part) => normalizedText.includes(part)).length;
      const minimumMatchedParts = Math.min(2, parts.length);
      if (parts.length > 0 && matchedParts >= minimumMatchedParts) {
        confidence = Math.round((matchedParts / parts.length) * 70);
      }
    }

    const optionCurrency = (option.currency ?? inferCurrencyFromInvoiceEntityName(option.displayName))?.toUpperCase() ?? null;
    if (confidence > 0 && normalizedInvoiceCurrency && optionCurrency) {
      confidence += optionCurrency === normalizedInvoiceCurrency ? 12 : -8;
    }

    const boundedConfidence = Math.max(0, Math.min(100, confidence));
    if (boundedConfidence > (best?.confidence ?? 0)) {
      best = { option, confidence: boundedConfidence };
    }
  }

  return best && best.confidence >= AUTO_QB_MATCH_CONFIDENCE_THRESHOLD ? best : null;
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
  const currency = extractCurrency(text);
  const rawExtractedEntityName = extractEntityNameByLabel(text, invoiceType, fileName);
  const extractedEntityName = isUnsafeInvoiceEntityName(rawExtractedEntityName) ? null : rawExtractedEntityName;
  const entityMatch = extractedEntityName
    ? matchQuickBooksEntity(extractedEntityName, invoiceType, entityOptions, currency)
    : matchQuickBooksEntity(text, invoiceType, entityOptions, currency);
  const amounts = extractInvoiceAmounts(text, currency);
  const invoiceDate = extractInvoiceDate(text);
  const dueDate = extractDueDate(text, invoiceDate) ?? defaultDueDateFromInvoiceDate(invoiceDate);
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
    entityNameRaw: entityMatch?.option.displayName ?? extractedEntityName,
    quickBooksEntityId: entityMatch?.option.id ?? null,
    quickBooksEntityDisplayName: entityMatch?.option.displayName ?? null,
    quickBooksMatchConfidence: entityMatch?.confidence ?? null,
    invoiceNumber: extractInvoiceNumber(text, fileName),
    invoiceDate,
    dueDate,
    currency,
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

function extractEntityNameByLabel(text: string, invoiceType: InvoiceAutomationType, fallbackName = "") {
  if (invoiceType === "VENDOR") {
    if (isIataCassStatement(text)) {
      return IATA_CASS_VENDOR_NAME;
    }

    return extractVendorName(text, fallbackName);
  }

  const label = invoiceType === "CUSTOMER" ? "(?:bill to|customer|invoice to)" : "(?:vendor|remit to|from)";
  const match = text.match(new RegExp(`${label}\\s*:?\\s*([^\\n\\r]{3,80})`, "i"));
  return match ? cleanupLine(match[1]) : null;
}

function extractVendorName(text: string, fallbackName = "") {
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

  const headerVendor = extractVendorNameFromHeader(text);
  if (headerVendor) {
    return headerVendor;
  }

  const labelMatch = text.match(/\b(?:vendor|from)\s*:\s*([^\n\r]{3,80})/i);
  const labeledVendor = labelMatch ? cleanupLine(labelMatch[1]) : null;
  if (labeledVendor && !isFactoringOrPayeeName(labeledVendor)) {
    return labeledVendor;
  }

  return extractVendorNameFromFileName(fallbackName);
}

function isFactoringOrPayeeName(value: string) {
  return /\b(RTS\s+Financial|financial\s+service|factoring|factor|payable\s+to|remit\s+to|newells?\s+express|newell[’']?s?\s+express)\b/i.test(value);
}

function findDateByLabels(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}\\s*[:：]?\\s*([A-Z][a-z]+\\s+\\d{1,2},\\s*\\d{4}|\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{1,2}-[A-Z][a-z]{2}-\\d{2,4})`, "i"));
    if (match) {
      return normalizeDate(match[1]);
    }
  }

  return null;
}

function hasDueOnReceiptTerms(text: string) {
  return (
    /\bdue\s+on\s+receipt\b/i.test(text) ||
    /\bpayment\s+terms?\s*[:：]?\s*0\b/i.test(text) ||
    /\bterms?\s*[:：]?\s*(?:due\s+on\s+receipt|0\s*(?:days?)?)\b/i.test(text)
  );
}

function findMoneyByLabels(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|[^A-Za-z])${escapeRegExp(label)}\\s*:?\\s*(?:CAD|USD|CDN|EUR|GBP|AUD|MXN|CNY|JPY|CHF|HKD|SGD)?\\s*[$€£]?\\s*(-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})|-?\\d+(?:\\.\\d{2}))`, "i"));
    if (match) {
      return parseMoney(match[1]);
    }
  }

  return null;
}

function findCanadianTaxAmount(text: string) {
  return sumTaxLines(text, CANADIAN_TAX_LABEL_PATTERN);
}

function findForeignTaxAmount(text: string) {
  return sumTaxLines(text, FOREIGN_TAX_LABEL_PATTERN);
}

function sumTaxLines(text: string, labelPattern: RegExp) {
  let taxAmount = 0;
  let found = false;

  for (const line of text.split(/\r?\n/)) {
    if (!labelPattern.test(line) || /\b(?:subtotal|sub\s+total|total|amount\s+due|balance\s+due)\b/i.test(line)) {
      continue;
    }

    const amount = parseLastMoneyAmount(line);
    if (amount === null) {
      continue;
    }

    taxAmount += amount;
    found = true;
  }

  return found ? roundMoney(taxAmount) : null;
}

function parseLastMoneyAmount(line: string) {
  const amountMatches = [
    ...line.matchAll(/(?:CAD|USD|CDN|EUR|GBP|AUD|MXN|CNY|JPY|CHF|HKD|SGD)?\s*[$€£]?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+\.\d{2})/gi)
  ];
  const candidates = amountMatches
    .filter((match) => {
      const index = match.index ?? 0;
      const before = line.slice(Math.max(0, index - 1), index);
      const after = line.slice(index + match[0].length, index + match[0].length + 1);
      return before !== "%" && after !== "%";
    })
    .map((match) => parseMoney(match[1]))
    .filter((amount): amount is number => amount !== null);

  return candidates.at(-1) ?? null;
}

function findTotalFromPrepaidTotals(text: string) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!/\bPREPAID\s+TOTALS\b/i.test(line)) {
      continue;
    }

    const amounts = line.match(/-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+(?:\.\d{2})/g);
    const lastAmount = amounts?.at(-1);
    if (lastAmount) {
      return parseMoney(lastAmount);
    }
  }

  return null;
}

function splitIataCassStatementIntoShipmentDocuments(text: string) {
  if (!isIataCassStatement(text)) {
    return [];
  }

  const sections = splitIataCassCargoInvoiceSections(text);
  const documents: string[] = [];
  const seen = new Set<string>();
  const statementCurrency = extractCurrency(text) ?? "CAD";
  const statementInvoiceDate = extractInvoiceDate(text);
  const statementRemittanceDate = findDateByLabels(text, ["remittance date"]);

  for (const section of sections) {
    const cassInvoiceNumber = extractIataCassInvoiceNumber(section);
    const currency = extractCurrency(section) ?? statementCurrency;
    const invoiceDate = extractInvoiceDate(section) ?? statementInvoiceDate;
    const dueDate = findDateByLabels(section, ["remittance date"]) ?? statementRemittanceDate;
    const shipmentAmounts = extractIataCassShipmentAmounts(section);

    for (const shipmentAmount of shipmentAmounts) {
      const invoiceNumber = [cassInvoiceNumber, shipmentAmount.fileNumber].filter(Boolean).join("-");
      const uniqueKey = `${invoiceNumber}:${shipmentAmount.fileNumber}:${shipmentAmount.amount}`;
      if (seen.has(uniqueKey)) {
        continue;
      }

      seen.add(uniqueKey);
      documents.push(
        [
          IATA_CASS_VENDOR_NAME,
          invoiceNumber ? `INVOICE NUMBER: ${invoiceNumber}` : null,
          cassInvoiceNumber ? `CASS REFERENCE: ${cassInvoiceNumber}` : null,
          invoiceDate ? `INVOICE DATE: ${invoiceDate}` : null,
          dueDate ? `DUE DATE: ${dueDate}` : null,
          `CURRENCY: ${currency}`,
          `SHIPMENT FILE NUMBER: ${shipmentAmount.fileNumber}`,
          `TOTAL AMOUNT: ${currency} ${shipmentAmount.amount.toFixed(2)}`,
          `NET TOTAL DUE AIRLINE: ${currency} ${shipmentAmount.amount.toFixed(2)}`
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  return documents;
}

function isIataCassStatement(text: string) {
  return /IATA\s+CARGO\s+ACCOUNTS\s+SETTLEMENT\s+SYSTEM\s*-\s*CANADA/i.test(text);
}

function splitIataCassCargoInvoiceSections(text: string) {
  const headers = [
    ...text.matchAll(
      /IATA\s+CARGO\s+ACCOUNTS\s+SETTLEMENT\s+SYSTEM\s*-\s*CANADA\s+CARGO\s+SALES\s+INVOICE\/ADJUSTMENT\s+INVOICE\s+NR\s*[:：]\s*[A-Z0-9-]+/gi
    )
  ];

  if (headers.length === 0) {
    return [text];
  }

  return headers
    .map((header, index) => {
      const start = header.index ?? 0;
      const nextHeader = headers[index + 1]?.index;
      const exportSummaryIndex = text.slice(start).search(/IATA\s+CARGO\s+ACCOUNTS\s+SETTLEMENT\s+SYSTEM\s*-\s*CANADA\s+EXPORT\s+BILLING\s+STATEMENT/i);
      const endFromSummary = exportSummaryIndex >= 0 ? start + exportSummaryIndex : null;
      const end = Math.min(nextHeader ?? text.length, endFromSummary ?? text.length);
      return text.slice(start, end).trim();
    })
    .filter(Boolean);
}

function extractIataCassInvoiceNumber(text: string) {
  const match = text.match(/\bINVOICE\/ADJUSTMENT\s+INVOICE\s+NR\s*[:：]\s*([A-Z0-9-]+)/i);
  return match ? cleanToken(match[1]) : null;
}

function extractIataCassShipmentAmounts(text: string) {
  const lines = text.split(/\r?\n/);
  const shipmentAmounts: Array<{ fileNumber: string; amount: number }> = [];
  const seen = new Set<string>();

  for (const [index, line] of lines.entries()) {
    const fileNumber = extractShipmentFileNumber(line);
    if (!fileNumber) {
      continue;
    }

    const amount =
      findIataAmountAfterFileNumber(line, fileNumber) ??
      findStandaloneMoneyNearLine(lines, index + 1, 2, "forward") ??
      findStandaloneMoneyNearLine(lines, index - 1, 3, "backward");

    if (amount === null) {
      continue;
    }

    const key = `${fileNumber}:${amount}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    shipmentAmounts.push({ fileNumber, amount });
  }

  return shipmentAmounts;
}

function findIataAmountAfterFileNumber(line: string, fileNumber: string) {
  const fileNumberIndex = line.toUpperCase().indexOf(fileNumber.toUpperCase());
  if (fileNumberIndex < 0) {
    return null;
  }

  const afterFileNumber = line.slice(fileNumberIndex + fileNumber.length);
  return parseLastMoneyAmount(afterFileNumber);
}

function findStandaloneMoneyNearLine(lines: string[], startIndex: number, maxDistance: number, direction: "forward" | "backward") {
  for (let distance = 0; distance < maxDistance; distance += 1) {
    const index = direction === "forward" ? startIndex + distance : startIndex - distance;
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    if (!isStandaloneMoneyLine(line)) {
      continue;
    }

    return parseLastMoneyAmount(line);
  }

  return null;
}

function isStandaloneMoneyLine(line: string) {
  return /^(?:CAD|USD|CDN|EUR|GBP|AUD|MXN|CNY|JPY|CHF|HKD|SGD)?\s*[$€£]?\s*-?\d{1,3}(?:,\d{3})*(?:\.\d{2})$|^(?:CAD|USD|CDN|EUR|GBP|AUD|MXN|CNY|JPY|CHF|HKD|SGD)?\s*[$€£]?\s*-?\d+\.\d{2}$/.test(
    line
  );
}

function groupFreightBillParts(chunks: string[]) {
  const groups = new Map<string, string[]>();
  const order: string[] = [];

  for (const chunk of chunks) {
    const match = chunk.match(/\bP\s*a\s*r\s*t\s+(\d+)\s+of\s+(\d+)\s+([A-Z0-9][A-Z0-9._/-]{4,})\b/i);
    if (!match) {
      return [];
    }

    const billNumber = cleanToken(match[3]);
    if (!groups.has(billNumber)) {
      groups.set(billNumber, []);
      order.push(billNumber);
    }
    groups.get(billNumber)?.push(chunk);
  }

  return order.map((billNumber) => groups.get(billNumber)?.join("\n") ?? "").filter(Boolean);
}

function splitByFreightBillPartHeaders(text: string) {
  const partHeaders = [...text.matchAll(/\bP\s*a\s*r\s*t\s+\d+\s+of\s+\d+\s+[A-Z0-9][A-Z0-9._/-]{4,}\b/gi)];
  if (partHeaders.length <= 1) {
    return [text];
  }

  return partHeaders
    .map((match, index) => {
      const start = match.index ?? 0;
      const end = partHeaders[index + 1]?.index ?? text.length;
      return text.slice(start, end).trim();
    })
    .filter(Boolean);
}

function splitByRepeatedInvoiceHeaders(text: string) {
  const headers = [...text.matchAll(/\b(?:invoice|inv)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/gi)]
    .map((match) => ({
      index: match.index ?? 0,
      invoiceNumber: cleanToken(match[1])
    }))
    .filter((match) => !isGenericInvoiceFileToken(match.invoiceNumber));

  const uniqueInvoiceNumbers = new Set(headers.map((header) => header.invoiceNumber.toUpperCase()));
  if (headers.length <= 1 || uniqueInvoiceNumbers.size <= 1) {
    return [text];
  }

  const prefix = text.slice(0, headers[0].index).trim();
  const chunks: string[] = [];
  for (const [index, header] of headers.entries()) {
    const end = headers[index + 1]?.index ?? text.length;
    const body = text.slice(header.index, end).trim();
    const chunk = [prefix, body].filter(Boolean).join("\n").trim();
    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks.length > 1 ? chunks : [text];
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

function shouldPreferFileNameShipmentNumber(extracted: string, fallback: string) {
  const extractedPrefix = extracted.match(/^[A-Z]+/)?.[0];
  const fallbackPrefix = fallback.match(/^[A-Z]+/)?.[0];
  if (!extractedPrefix || extractedPrefix !== fallbackPrefix) {
    return false;
  }

  return normalizeShipmentNumberForComparison(extracted) === normalizeShipmentNumberForComparison(fallback) && extracted !== fallback;
}

function normalizeShipmentNumberForComparison(value: string) {
  return value.replace(/^([A-Z]+)(\d+)[A-Z](\d+)$/, "$1$2$3");
}

function extractInvoiceNumberAdjacentToFileNumber(text: string, fallbackName = "") {
  const fileNumber = extractShipmentFileNumber(text, fallbackName);
  if (!fileNumber) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const normalizedLine = line.replace(/\s+/g, " ").trim();
    const fileNumberIndex = normalizedLine.toUpperCase().indexOf(fileNumber.toUpperCase());
    if (fileNumberIndex < 0) {
      continue;
    }

    const afterFileNumber = normalizedLine.slice(fileNumberIndex + fileNumber.length).trim();
    const candidate = afterFileNumber.split(/\s+/)[0];
    if (candidate && isStrongAdjacentInvoiceToken(candidate)) {
      return cleanToken(candidate);
    }
  }

  return null;
}

function isStrongAdjacentInvoiceToken(value: string) {
  const cleaned = cleanToken(value);
  return (
    !isGenericInvoiceFileToken(cleaned) &&
    /\d/.test(cleaned) &&
    !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(cleaned) &&
    !isMoneyLikeToken(cleaned)
  );
}

function isMoneyLikeToken(value: string) {
  return /^\d{1,3}(?:,\d{3})*(?:\.\d{2})$/.test(value);
}

function extractInvoiceNumberFromFileName(fileName: string) {
  const baseName = fileName.replace(/\.pdf$/i, "");
  const leadingInvMatch = baseName.match(/\binv[_ -]*(\d{5,})(?=\b|[_ -])/i);
  if (leadingInvMatch) {
    return cleanToken(leadingInvMatch[1]);
  }

  const leadingInvoiceNumberMatch = baseName.match(/\binvoice\s+(\d{3,})\s*[-–—]/i);
  if (leadingInvoiceNumberMatch) {
    return cleanToken(leadingInvoiceNumberMatch[1]);
  }

  const shipmentMatch = baseName.match(FILE_NUMBER_PATTERN);
  if (shipmentMatch?.index !== undefined) {
    const afterShipment = baseName.slice(shipmentMatch.index + shipmentMatch[0].length).trim();
    const invoiceNoToken = afterShipment.match(/\binvoice\s*(?:no\.?|#)\s*([A-Z0-9][A-Z0-9._/-]{2,})/i);
    if (invoiceNoToken && !isGenericInvoiceFileToken(invoiceNoToken[1])) {
      return cleanToken(invoiceNoToken[1]);
    }

    const strongToken = afterShipment.match(/\b(?:DN-[A-Z0-9-]+|INV[-_ ]?[A-Z0-9-]+|[A-Z]{2,}[-_][A-Z0-9-]+|[A-Z]{4,}\d[A-Z0-9-]+|\d{5,}(?:-\d+)?)\b/i);
    if (strongToken) {
      return cleanToken(strongToken[0].replace(/\s+/g, ""));
    }
  }

  const invoiceFileMatch = baseName.match(/\b(?:invoice|inv)[\s_-]*(?:no\.?|#)?\s*([A-Z0-9][A-Z0-9._-]{2,})/i);
  const candidate = invoiceFileMatch ? cleanToken(invoiceFileMatch[1]) : null;
  return candidate && !isGenericInvoiceFileToken(candidate) ? candidate : null;
}

function extractExplicitInvoiceTokenFromFileName(fileName: string) {
  const baseName = fileName.replace(/\.pdf$/i, "");
  const explicitMatch = baseName.match(/\binvoice[_\s-]+(?!no\.?\b|#)([A-Z]{2,}\d[A-Z0-9._/-]*)\b/i);
  if (!explicitMatch) {
    return null;
  }

  return cleanToken(explicitMatch[1].replace(/\s+/g, ""));
}

function extractVendorNameFromFileName(fileName: string) {
  const baseName = fileName.replace(/\.pdf$/i, "").replace(/[_]+/g, " ");
  const amountApprovedMatch = baseName.match(/\bamount\s+approved\s+(.+?)\s+(?:OE|OI|AE|AI|TR|DR)\d+[A-Z]?\d*\b/i);
  if (amountApprovedMatch) {
    return cleanupVendorNameFromFileName(amountApprovedMatch[1]);
  }

  const approvedMatch = baseName.match(/\b(?:approved|amount\s+approved)?\s*invoic(?:e)?\s+(.+?)\s+(?:OE|OI|AE|AI|TR|DR)\d+[A-Z]?\d*\b/i);
  if (approvedMatch) {
    return cleanupVendorNameFromFileName(approvedMatch[1]);
  }

  const fileNumberFirstMatch = baseName.match(/\b(?:OE|OI|AE|AI|TR|DR)\d+[A-Z]?\d*\s*[-–—]\s*(.+)$/i);
  if (fileNumberFirstMatch) {
    return cleanupVendorNameFromFileName(fileNumberFirstMatch[1]);
  }

  const invoicePrefixMatch = baseName.match(/\binvoice\s+\d+\s*[-–—]\s*(?:OE|OI|AE|AI|TR|DR)\d+[A-Z]?\d*\s*[-–—]\s*(.+)$/i);
  if (invoicePrefixMatch) {
    return cleanupVendorNameFromFileName(invoicePrefixMatch[1]);
  }

  const leadingInvoiceMatch = baseName.match(/^([A-Z0-9][A-Z0-9 &'./-]+?)\s*[-–—]\s*(?:\d{5,}|(?:OE|OI|AE|AI|TR|DR)\d+[A-Z]?\d*)\b/i);
  if (leadingInvoiceMatch) {
    return cleanupVendorNameFromFileName(leadingInvoiceMatch[1]);
  }

  return null;
}

function extractVendorNameFromHeader(text: string) {
  const headerLines = text
    .split(/\r?\n/)
    .map((line) => cleanupLine(line) ?? "")
    .filter(Boolean)
    .slice(0, 8);

  for (const line of headerLines) {
    if (!/(?:INCORPORATED|INC\.?|LTD\.?|LIMITED|LLC|CORP\.?|CORPORATION|COMPANY|CO\.?|LOGISTICS|TRANSPORT|TRANSPORTATION|FREIGHT|EXPRESS|CARTAGE)/i.test(line)) {
      continue;
    }

    if (!isFactoringOrPayeeName(line)) {
      return line;
    }
  }

  return null;
}

function cleanupVendorNameFromFileName(value: string) {
  const cleaned = cleanupLine(
    value
      .replace(/\bnewell[’']?s?\s+express(?:\s+worldwide)?(?:\s+logistics)?(?:\s+warehousing)?(?:\s+ltd\.?)?\b/gi, " ")
      .replace(/\b(?:invoice|inv|approved|amount|pod|tax|revised|from)\b/gi, " ")
      .replace(/\b(?:(?:DN|INV|TAX)[-_ ]?[A-Z0-9]{4,}|[A-Z0-9]*\d[A-Z0-9-]{4,})\b/gi, " ")
      .replace(/\d{1,2}-[A-Za-z]{3}-\d{2,4}/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
  );

  return cleaned && !isGenericInvoiceFileToken(cleaned) && !isFactoringOrPayeeName(cleaned) ? cleaned : null;
}

function isGenericInvoiceFileToken(value: string) {
  return /^(invoice|inv|bill|newell|newells?|approved|amount|revised|pod|from|tax|no\.?|number)$/i.test(value.trim());
}
