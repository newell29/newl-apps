import type { InvoiceAutomationType } from "@prisma/client";
import {
  defaultDueDateFromInvoiceDate,
  getDefaultProductOrAccount,
  getShipmentTypeFromInvoiceFileNumber,
  normalizeInvoiceEntityName
} from "@/modules/invoice-automation/extraction";
import type { InvoiceAutomationCorrectionMemoryHint, InvoiceAutomationUploadDraft } from "@/modules/invoice-automation/types";

export const INVOICE_CORRECTION_MEMORY_FIELDS = ["CURRENCY", "PRODUCT_OR_ACCOUNT", "PAYMENT_TERMS_DAYS"] as const;

export type InvoiceCorrectionMemoryField = (typeof INVOICE_CORRECTION_MEMORY_FIELDS)[number];

type BuildCorrectionMemoryInput = {
  tenantId: string;
  invoiceType: InvoiceAutomationType;
  entityNameRaw: string | null;
  quickBooksEntityId: string | null;
  quickBooksEntityDisplayName: string | null;
  shipmentFileNumber: string | null;
  currency: string | null;
  productOrAccountName: string | null;
  invoiceDate: string | Date | null;
  dueDate: string | Date | null;
  userId?: string | null;
};

export type InvoiceCorrectionMemoryCandidate = {
  memoryKey: string;
  tenantId: string;
  invoiceType: InvoiceAutomationType;
  fieldName: InvoiceCorrectionMemoryField;
  normalizedEntityName: string | null;
  quickBooksEntityId: string | null;
  quickBooksEntityDisplayName: string | null;
  shipmentPrefix: string | null;
  currency: string | null;
  learnedValue: string;
  sourceValue: string | null;
  createdByUserId: string | null;
};

export function buildInvoiceCorrectionMemoryCandidates(input: BuildCorrectionMemoryInput) {
  const normalizedEntityName = normalizeCorrectionEntityName(input.entityNameRaw ?? input.quickBooksEntityDisplayName);
  const quickBooksEntityId = cleanText(input.quickBooksEntityId);
  const quickBooksEntityDisplayName = cleanText(input.quickBooksEntityDisplayName);
  const shipmentPrefix = getShipmentTypeFromInvoiceFileNumber(input.shipmentFileNumber);
  const currency = cleanText(input.currency)?.toUpperCase() ?? null;
  const candidates: InvoiceCorrectionMemoryCandidate[] = [];

  if (!normalizedEntityName && !quickBooksEntityId) {
    return candidates;
  }

  const base = {
    tenantId: input.tenantId,
    invoiceType: input.invoiceType,
    normalizedEntityName,
    quickBooksEntityId,
    quickBooksEntityDisplayName,
    shipmentPrefix,
    currency,
    createdByUserId: input.userId ?? null
  };

  const productOrAccountName = cleanText(input.productOrAccountName);
  if (productOrAccountName) {
    candidates.push(buildCandidate({ ...base, fieldName: "PRODUCT_OR_ACCOUNT", learnedValue: productOrAccountName }));
  }

  if (currency) {
    candidates.push(buildCandidate({ ...base, fieldName: "CURRENCY", learnedValue: currency }));
  }

  const paymentTermsDays = calculatePaymentTermsDays(input.invoiceDate, input.dueDate);
  if (paymentTermsDays !== null && paymentTermsDays !== 30) {
    candidates.push(buildCandidate({ ...base, fieldName: "PAYMENT_TERMS_DAYS", learnedValue: String(paymentTermsDays) }));
  }

  return candidates;
}

export function applyInvoiceCorrectionMemory(
  draft: InvoiceAutomationUploadDraft,
  invoiceType: InvoiceAutomationType,
  memories: InvoiceAutomationCorrectionMemoryHint[]
): InvoiceAutomationUploadDraft {
  let next: InvoiceAutomationUploadDraft = { ...draft };
  const appliedIssueCodes = new Set(next.issueCodes.filter(isCorrectionMemoryIssueCode));

  const currencyMemory = findBestCorrectionMemory("CURRENCY", next, invoiceType, memories);
  if (!next.currency && currencyMemory) {
    next = { ...next, currency: currencyMemory.learnedValue.toUpperCase() };
    appliedIssueCodes.add("MEMORY_APPLIED_CURRENCY");
  }

  const productMemory = findBestCorrectionMemory("PRODUCT_OR_ACCOUNT", next, invoiceType, memories);
  const defaultProductOrAccount = getDefaultProductOrAccount(invoiceType, next.shipmentFileNumber);
  if (productMemory && (!next.productOrAccountName || next.productOrAccountName === defaultProductOrAccount)) {
    next = { ...next, productOrAccountName: productMemory.learnedValue };
    appliedIssueCodes.add("MEMORY_APPLIED_PRODUCT_OR_ACCOUNT");
  }

  const paymentTermsMemory = findBestCorrectionMemory("PAYMENT_TERMS_DAYS", next, invoiceType, memories);
  if (paymentTermsMemory && shouldApplyPaymentTermsMemory(next)) {
    const paymentTermsDays = Number(paymentTermsMemory.learnedValue);
    if (Number.isInteger(paymentTermsDays) && paymentTermsDays >= 0 && paymentTermsDays <= 120) {
      next = { ...next, dueDate: addDaysToIsoDate(next.invoiceDate, paymentTermsDays) };
      appliedIssueCodes.add("MEMORY_APPLIED_PAYMENT_TERMS");
    }
  }

  if (appliedIssueCodes.size === 0) {
    return next;
  }

  return {
    ...next,
    issueCodes: [...new Set([...next.issueCodes.filter((issue) => !isCorrectionMemoryIssueCode(issue)), ...appliedIssueCodes])]
  };
}

export function isCorrectionMemoryIssueCode(issueCode: string) {
  return issueCode.startsWith("MEMORY_APPLIED_");
}

function buildCandidate(
  input: Omit<InvoiceCorrectionMemoryCandidate, "memoryKey" | "sourceValue"> & { fieldName: InvoiceCorrectionMemoryField }
): InvoiceCorrectionMemoryCandidate {
  return {
    ...input,
    sourceValue: input.normalizedEntityName ?? input.quickBooksEntityDisplayName ?? input.quickBooksEntityId,
    memoryKey: buildInvoiceCorrectionMemoryKey(input)
  };
}

function buildInvoiceCorrectionMemoryKey(input: {
  tenantId: string;
  invoiceType: InvoiceAutomationType;
  fieldName: InvoiceCorrectionMemoryField;
  normalizedEntityName: string | null;
  quickBooksEntityId: string | null;
  shipmentPrefix: string | null;
  currency: string | null;
}) {
  return [
    input.tenantId,
    input.invoiceType,
    input.fieldName,
    input.quickBooksEntityId ?? "",
    input.normalizedEntityName ?? "",
    input.shipmentPrefix ?? "",
    input.currency ?? ""
  ].join("|");
}

function findBestCorrectionMemory(
  fieldName: InvoiceCorrectionMemoryField,
  draft: InvoiceAutomationUploadDraft,
  invoiceType: InvoiceAutomationType,
  memories: InvoiceAutomationCorrectionMemoryHint[]
) {
  const candidates = memories
    .filter((memory) => memory.invoiceType === invoiceType && memory.fieldName === fieldName)
    .map((memory) => ({ memory, score: scoreCorrectionMemory(memory, draft) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.memory ?? null;
}

function scoreCorrectionMemory(memory: InvoiceAutomationCorrectionMemoryHint, draft: InvoiceAutomationUploadDraft) {
  const normalizedDraftEntity = normalizeCorrectionEntityName(draft.entityNameRaw ?? draft.quickBooksEntityDisplayName);
  const shipmentPrefix = getShipmentTypeFromInvoiceFileNumber(draft.shipmentFileNumber);
  const draftCurrency = draft.currency?.toUpperCase() ?? null;
  let score = 0;

  if (memory.quickBooksEntityId && draft.quickBooksEntityId && memory.quickBooksEntityId === draft.quickBooksEntityId) {
    score += 100;
  }

  if (memory.normalizedEntityName && normalizedDraftEntity && memory.normalizedEntityName === normalizedDraftEntity) {
    score += 70;
  }

  if (score === 0) {
    return 0;
  }

  if (memory.shipmentPrefix) {
    if (memory.shipmentPrefix !== shipmentPrefix) return 0;
    score += 15;
  }

  if (memory.currency && draftCurrency) {
    if (memory.currency !== draftCurrency) return 0;
    score += 10;
  }

  return score + Math.min(memory.usageCount ?? 1, 25);
}

function normalizeCorrectionEntityName(value: string | null | undefined) {
  const normalized = value ? normalizeInvoiceEntityName(value) : "";
  return normalized || null;
}

function cleanText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function calculatePaymentTermsDays(invoiceDate: string | Date | null, dueDate: string | Date | null) {
  const invoice = toDate(invoiceDate);
  const due = toDate(dueDate);
  if (!invoice || !due) return null;
  const days = Math.round((due.getTime() - invoice.getTime()) / 86400000);
  return days >= 0 && days <= 120 ? days : null;
}

function shouldApplyPaymentTermsMemory(draft: InvoiceAutomationUploadDraft) {
  if (!draft.invoiceDate) return false;
  if (hasExplicitDueDateOrTerms(draft.extractedText)) return false;
  return !draft.dueDate || draft.dueDate === defaultDueDateFromInvoiceDate(draft.invoiceDate);
}

function hasExplicitDueDateOrTerms(text: string) {
  return /\b(?:due\s+date|due\s+on\s+receipt|payment\s+terms?|terms?)\b/i.test(text);
}

function addDaysToIsoDate(value: string | null, days: number) {
  const date = toDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
