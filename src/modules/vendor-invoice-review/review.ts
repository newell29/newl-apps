import type { InvoiceAutomationUploadDraft } from "@/modules/invoice-automation/types";
import { buildVendorInvoiceDuplicateKey } from "@/modules/invoice-automation/duplicates";
import type { VendorInvoiceReviewDraft, VendorInvoiceReviewKind } from "@/modules/vendor-invoice-review/types";

export function toVendorInvoiceReviewDraft(
  draft: InvoiceAutomationUploadDraft,
  options: { invoiceKind?: VendorInvoiceReviewKind; vendorReference?: string | null } = {}
): VendorInvoiceReviewDraft {
  return refreshVendorInvoiceReviewDraftIssues({
    clientId: draft.clientId,
    documentClientId: draft.documentClientId ?? draft.clientId,
    invoiceKind: options.invoiceKind ?? "Vendor_Invoices",
    fileName: draft.fileName,
    vendorName: draft.entityNameRaw,
    invoiceNumber: draft.invoiceNumber,
    invoiceDate: draft.invoiceDate,
    tmsFileNumber: draft.shipmentFileNumber,
    confirmedTmsFileNumber: draft.shipmentFileNumber,
    vendorReference: options.vendorReference ?? null,
    currency: draft.currency,
    subtotalAmount: draft.subtotalAmount,
    taxAmount: draft.taxAmount,
    totalAmount: draft.totalAmount,
    issueCodes: [],
    duplicateWarning: null
  });
}

export function refreshVendorInvoiceReviewDraftIssues(draft: VendorInvoiceReviewDraft): VendorInvoiceReviewDraft {
  return {
    ...draft,
    issueCodes: getVendorInvoiceReviewDraftIssues(draft)
  };
}

export function getVendorInvoiceReviewDraftIssues(
  draft: Pick<
    VendorInvoiceReviewDraft,
    "vendorName" | "invoiceNumber" | "invoiceDate" | "confirmedTmsFileNumber" | "currency" | "totalAmount"
  >
) {
  const issues: string[] = [];
  if (!readText(draft.confirmedTmsFileNumber)) issues.push("CONFIRM_TMS_FILE_NUMBER");
  if (!readText(draft.vendorName)) issues.push("MISSING_VENDOR");
  if (!readText(draft.invoiceNumber)) issues.push("MISSING_INVOICE_NUMBER");
  if (!readText(draft.invoiceDate)) issues.push("MISSING_INVOICE_DATE");
  if (!readText(draft.currency)) issues.push("MISSING_CURRENCY");
  if (draft.totalAmount === null || draft.totalAmount === undefined) issues.push("MISSING_TOTAL");
  return issues;
}

export function buildVendorInvoiceReviewDuplicateKey(input: {
  vendorName: string | null;
  invoiceNumber: string | null;
}) {
  return buildVendorInvoiceDuplicateKey({
    invoiceType: "VENDOR",
    invoiceNumber: input.invoiceNumber,
    quickBooksEntityId: null,
    quickBooksEntityDisplayName: null,
    entityNameRaw: input.vendorName
  });
}

export function findDuplicateVendorInvoiceReviewDraft(drafts: VendorInvoiceReviewDraft[]) {
  const seen = new Map<string, VendorInvoiceReviewDraft>();
  for (const draft of drafts) {
    const key = buildVendorInvoiceReviewDuplicateKey({
      vendorName: draft.vendorName,
      invoiceNumber: draft.invoiceNumber
    });
    if (!key) {
      continue;
    }

    const existing = seen.get(key);
    if (existing) {
      return { first: existing, duplicate: draft, duplicateKey: key };
    }
    seen.set(key, draft);
  }
  return null;
}

function readText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
