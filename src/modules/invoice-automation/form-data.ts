import { AccountingInvoiceType, CashflowBusinessLine, CashflowLegalEntity, Prisma, QuickBooksDirectoryEntityType } from "@prisma/client";
import { normalizeInvoiceEntityName } from "./parsing";

function str(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function dateValue(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
}

function decimal(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? new Prisma.Decimal(text) : null;
}

function enumValue<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[]) {
  const text = str(value);
  return text && allowed.includes(text as T) ? (text as T) : null;
}

export function parseInvoiceReviewFormData(formData: FormData, qbEntity?: { entityType: QuickBooksDirectoryEntityType; displayName: string } | null) {
  const rawEntityName = str(formData.get("rawEntityName"));
  return {
    invoiceType: enumValue(formData.get("invoiceType"), Object.values(AccountingInvoiceType)),
    legalEntity: enumValue(formData.get("legalEntity"), Object.values(CashflowLegalEntity)),
    shipmentFileNumber: str(formData.get("shipmentFileNumber")),
    serviceType: str(formData.get("serviceType")),
    businessLine: enumValue(formData.get("businessLine"), Object.values(CashflowBusinessLine)),
    rawEntityName,
    normalizedEntityName: normalizeInvoiceEntityName(rawEntityName),
    invoiceNumber: str(formData.get("invoiceNumber")),
    invoiceDate: dateValue(formData.get("invoiceDate")),
    dueDate: dateValue(formData.get("dueDate")),
    currency: str(formData.get("currency")) ?? "CAD",
    subtotal: decimal(formData.get("subtotal")),
    tax: decimal(formData.get("tax")),
    total: decimal(formData.get("total")),
    taxApplicable: formData.get("taxApplicable") === "on",
    exchangeRateToCad: decimal(formData.get("exchangeRateToCad")),
    fxOverrideReason: str(formData.get("fxOverrideReason")),
    reviewNotes: str(formData.get("reviewNotes")),
    qbEntityId: str(formData.get("qbEntityId")),
    qbEntityType: qbEntity?.entityType,
    qbEntityDisplayName: qbEntity?.displayName,
    qbItemId: str(formData.get("qbItemId")),
    qbItemName: str(formData.get("qbItemName")),
    qbExpenseAccountId: str(formData.get("qbExpenseAccountId")),
    qbExpenseAccountName: str(formData.get("qbExpenseAccountName"))
  };
}

export function parseManualQuickBooksDirectoryFormData(formData: FormData) {
  const displayName = str(formData.get("displayName"));
  const quickBooksId = str(formData.get("quickBooksId"));
  const entityType = enumValue(formData.get("entityType"), Object.values(QuickBooksDirectoryEntityType));

  if (!displayName) throw new Error("QuickBooks display name is required.");
  if (!quickBooksId) throw new Error("QuickBooks ID is required.");
  if (!entityType) throw new Error("QuickBooks entity type is required.");

  return {
    displayName,
    quickBooksId,
    entityType,
    legalEntity: enumValue(formData.get("legalEntity"), Object.values(CashflowLegalEntity)) ?? CashflowLegalEntity.NEWL_WORLDWIDE,
    currency: str(formData.get("currency"))?.toUpperCase() ?? null,
    active: formData.get("active") === "on",
    normalizedName: normalizeInvoiceEntityName(displayName)
  };
}
