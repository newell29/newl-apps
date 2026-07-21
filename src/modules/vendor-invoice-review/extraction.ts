import {
  buildInvoiceDraftFromText,
  splitInvoiceTextIntoDocuments
} from "@/modules/invoice-automation/extraction";
import {
  refreshVendorInvoiceReviewDraftIssues,
  toVendorInvoiceReviewDraft
} from "@/modules/vendor-invoice-review/review";
import type { VendorInvoiceReviewDraft, VendorInvoiceReviewKind } from "@/modules/vendor-invoice-review/types";

export function buildVendorInvoiceReviewDraftsFromText({
  documentClientId,
  invoiceKind = "Vendor_Invoices",
  fileName,
  contentType,
  sizeBytes,
  pdfBase64,
  extractedText
}: {
  documentClientId: string;
  invoiceKind?: VendorInvoiceReviewKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  pdfBase64: string;
  extractedText: string;
}): VendorInvoiceReviewDraft[] {
  if (!extractedText.trim()) {
    return [buildBlankVendorInvoiceReviewDraft({ documentClientId, invoiceKind, fileName, sizeBytes })];
  }

  const segments = splitInvoiceTextIntoDocuments(extractedText);
  const drafts = segments.map((text, index) => {
    const vendorReference = extractReferenceFromEmbeddedText(text);
    const draft = toVendorInvoiceReviewDraft(
      buildInvoiceDraftFromText({
        clientId: `${fileName}-${sizeBytes}-${index}`,
        documentClientId,
        fileName: segments.length > 1 ? `${fileName} - invoice ${index + 1}` : fileName,
        contentType,
        sizeBytes,
        pdfBase64,
        text,
        invoiceType: invoiceKind === "Customer_Invoices" ? "CUSTOMER" : "VENDOR",
        entityOptions: []
      }),
      { invoiceKind, vendorReference }
    );
    return applyVendorReviewEmbeddedTextFallbacks(draft, text);
  });

  return drafts.some(hasUsableInvoiceSignal) ? drafts : [buildBlankVendorInvoiceReviewDraft({ documentClientId, invoiceKind, fileName, sizeBytes })];
}

function buildBlankVendorInvoiceReviewDraft({
  documentClientId,
  invoiceKind,
  fileName,
  sizeBytes
}: {
  documentClientId: string;
  invoiceKind: VendorInvoiceReviewKind;
  fileName: string;
  sizeBytes: number;
}): VendorInvoiceReviewDraft {
  return {
    clientId: `${fileName}-${sizeBytes}-manual-0`,
    documentClientId,
    invoiceKind,
    fileName,
    vendorName: null,
    invoiceNumber: null,
    invoiceDate: null,
    tmsFileNumber: null,
    confirmedTmsFileNumber: null,
    vendorReference: null,
    currency: null,
    subtotalAmount: null,
    taxAmount: null,
    totalAmount: null,
    issueCodes: [
      "CONFIRM_TMS_FILE_NUMBER",
      "MISSING_VENDOR",
      "MISSING_INVOICE_NUMBER",
      "MISSING_INVOICE_DATE",
      "MISSING_CURRENCY",
      "MISSING_TOTAL"
    ],
    duplicateWarning: null
  };
}

function hasUsableInvoiceSignal(draft: VendorInvoiceReviewDraft) {
  return Boolean(
    draft.vendorName?.trim() ||
      draft.invoiceNumber?.trim() ||
      draft.invoiceDate?.trim() ||
      draft.tmsFileNumber?.trim() ||
      draft.currency?.trim() ||
      draft.subtotalAmount !== null ||
      draft.taxAmount !== null ||
      draft.totalAmount !== null
  );
}

function applyVendorReviewEmbeddedTextFallbacks(draft: VendorInvoiceReviewDraft, text: string): VendorInvoiceReviewDraft {
  const enriched = {
    ...draft,
    vendorName: draft.vendorName ?? extractVendorNameFromContinuousInvoiceText(text),
    subtotalAmount: draft.subtotalAmount ?? findMoneyAfterLabel(text, ["subtotal", "sub total", "sub-total"]),
    taxAmount: draft.taxAmount ?? findMoneyAfterLabel(text, ["hst", "gst", "pst", "qst", "sales tax", "tax exempt", "tax excempt", "tax"])
  };

  return refreshVendorInvoiceReviewDraftIssues(enriched);
}

function extractReferenceFromEmbeddedText(text: string) {
  const patterns = [
    /\b(?:AWB|air\s*waybill)\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})\b/i,
    /\b(?:BOL|B\/L|bill\s+of\s+lading)\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})\b/i,
    /\bPRO\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})\b/i,
    /\bcontainer\s*(?:number|no\.?|#)?\s*:?\s*([A-Z]{4}\d{6,7})\b/i,
    /\b(?:vendor\s+reference|reference|ref)\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanupExtractedText(match[1]);
    }
  }

  return null;
}

function extractVendorNameFromContinuousInvoiceText(text: string) {
  const afterInvoiceNumber = text.match(
    /\binvoice\s*#?\s*[A-Z0-9][A-Z0-9._/-]{2,}\s+([A-Z0-9][A-Z0-9 &.,'/-]+?(?:INCORPORATED|INC\.?|LTD\.?|LIMITED|LLC|CORP\.?|CORPORATION|COMPANY|CO\.?))\b/i
  );
  if (afterInvoiceNumber?.[1]) {
    return cleanupExtractedText(afterInvoiceNumber[1]);
  }

  const remitTo = text.match(/\bremit\s+to\s*:?\s*([A-Z0-9][A-Z0-9 &.,'/-]+?(?:INCORPORATED|INC\.?|LTD\.?|LIMITED|LLC|CORP\.?|CORPORATION|COMPANY|CO\.?))\b/i);
  return remitTo?.[1] ? cleanupExtractedText(remitTo[1]) : null;
}

function findMoneyAfterLabel(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(
      new RegExp(`\\b${escapeRegExp(label)}\\b\\s*:?\\s*(?:CAD|USD|CDN|EUR|GBP|AUD|MXN|CNY|JPY|CHF|HKD|SGD)?\\s*[$€£]?\\s*(-?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})|-?\\d+(?:\\.\\d{2}))`, "i")
    );
    if (match?.[1]) {
      return parseMoney(match[1]);
    }
  }

  return null;
}

function parseMoney(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cleanupExtractedText(value: string) {
  return value.replace(/\s+/g, " ").replace(/[.,\s]+$/, "").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
