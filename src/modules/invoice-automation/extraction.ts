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

export function inferCurrencyFromInvoiceEntityName(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const upper = value.toUpperCase();
  if (/\bUSD\b|US\s*DOLLARS?/.test(upper)) return "USD";
  if (/\bCAD\b|\bCDN\b|CANADIAN\s*DOLLARS?/.test(upper)) return "CAD";
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

  const invoiceNumberTableMatch = text.match(/\binvoice\s+number\s+invoice\s+date\s+([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (invoiceNumberTableMatch) {
    return cleanToken(invoiceNumberTableMatch[1]);
  }

  const dateInvoiceNumberTableMatch = text.match(/\bdate\s+invoice\s*#\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
  if (dateInvoiceNumberTableMatch) {
    return cleanToken(dateInvoiceNumberTableMatch[1]);
  }

  const labelMatch = text.match(/\b(?:invoice|inv)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i);
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
  if (/\$/.test(text)) return "CAD";
  return null;
}

export function extractInvoiceDate(text: string) {
  const tableDateMatch = text.match(/\binvoice\s+number\s+invoice\s+date\s+[A-Z0-9][A-Z0-9._/-]{2,}\s+(\d{1,2}-[A-Z][a-z]{2}-\d{2,4})\b/i);
  if (tableDateMatch) {
    return normalizeDate(tableDateMatch[1]);
  }

  const dateInvoiceTableMatch = text.match(/\bdate\s+invoice\s*#\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+[A-Z0-9][A-Z0-9._/-]{2,}/i);
  if (dateInvoiceTableMatch) {
    return normalizeDate(dateInvoiceTableMatch[1]);
  }

  return findDateByLabels(text, ["invoice date", "bill date", "date"]);
}

export function extractDueDate(text: string) {
  return findDateByLabels(text, ["due date", "payment due"]);
}

export function extractInvoiceAmounts(text: string) {
  const subtotal = findMoneyByLabels(text, ["subtotal", "sub total", "amount before tax"]);
  const tax = findMoneyByLabels(text, ["hst", "sales tax", "tax"]);
  const total =
    findTotalFromPrepaidTotals(text) ??
    findMoneyByLabels(text, ["total amount", "invoice total", "amount due", "balance due", "total rate", "inv amount", "total"]);

  return {
    subtotalAmount: subtotal ?? (total !== null && tax !== null ? roundMoney(total - tax) : null),
    taxAmount: tax,
    totalAmount: total ?? (subtotal !== null && tax !== null ? roundMoney(subtotal + tax) : subtotal)
  };
}

export function splitInvoiceTextIntoDocuments(text: string) {
  const compact = text.trim();
  if (!compact) {
    return [""];
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

  return grouped.length > 1 ? grouped : [compact];
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

    const optionCurrency = (option.currency ?? inferCurrencyFromInvoiceEntityName(option.displayName))?.toUpperCase() ?? null;
    if (confidence > 0 && normalizedInvoiceCurrency && optionCurrency) {
      confidence += optionCurrency === normalizedInvoiceCurrency ? 12 : -8;
    }

    const boundedConfidence = Math.max(0, Math.min(100, confidence));
    if (boundedConfidence > (best?.confidence ?? 0)) {
      best = { option, confidence: boundedConfidence };
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
  const currency = extractCurrency(text);
  const entityMatch = matchQuickBooksEntity(text, invoiceType, entityOptions, currency);
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
    entityNameRaw: entityMatch?.option.displayName ?? extractEntityNameByLabel(text, invoiceType, fileName),
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

function findMoneyByLabels(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}\\s*:?\\s*(?:CAD|USD|CDN)?\\s*\\$?\\s*(-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})|-?\\d+(?:\\.\\d{2}))`, "i"));
    if (match) {
      return parseMoney(match[1]);
    }
  }

  return null;
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
  const starts = [...text.matchAll(/\b(?:invoice|inv)\s*(?:number|no\.?|#)\s*[:#-]?\s*[A-Z0-9][A-Z0-9._/-]{2,}/gi)]
    .map((match) => match.index ?? 0)
    .filter((index) => index > 0);

  if (starts.length === 0) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;
  for (const nextStart of starts) {
    const chunk = text.slice(start, nextStart).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    start = nextStart;
  }
  const finalChunk = text.slice(start).trim();
  if (finalChunk) {
    chunks.push(finalChunk);
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

  const approvedMatch = baseName.match(/\b(?:approved|amount\s+approved)?\s*invoice\s+(.+?)\s+(?:OE|OI|AE|AI|TR|DR)\d+[A-Z]?\d*\b/i);
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
      .replace(/\b(?:invoice|inv|approved|amount|pod|tax|revised|from|newells?|express|worldwide|warehousing|ltd)\b/gi, " ")
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
