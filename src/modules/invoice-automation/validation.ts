import { AccountingInvoiceType } from "@prisma/client";

export type InvoiceApprovalInput = { invoiceType?: AccountingInvoiceType | null; legalEntity?: string | null; invoiceNumber?: string | null; invoiceDate?: Date | string | null; currency?: string | null; total?: number | string | null; productServiceId?: string | null; qbItemId?: string | null; expenseAccountId?: string | null; qbExpenseAccountId?: string | null; shipmentFileNumber?: string | null; businessLine?: string | null; qbEntityId?: string | null; issues?: unknown; exchangeRateToCad?: number | string | null; fxOverrideReason?: string | null };
export function approvalIssues(invoice: InvoiceApprovalInput, directoryAvailable = false) {
  const issues: string[] = [];
  if (!invoice.invoiceType) issues.push("MISSING_INVOICE_TYPE");
  if (!invoice.legalEntity) issues.push("MISSING_LEGAL_ENTITY");
  if (!invoice.invoiceNumber) issues.push("MISSING_INVOICE_NUMBER");
  if (!invoice.invoiceDate) issues.push("MISSING_INVOICE_DATE");
  if (!invoice.currency) issues.push("MISSING_CURRENCY");
  if (invoice.total === null || invoice.total === undefined || invoice.total === "") issues.push("MISSING_TOTAL");
  if (invoice.invoiceType === AccountingInvoiceType.CUSTOMER_INVOICE && !(invoice.productServiceId || invoice.qbItemId)) issues.push("MISSING_PRODUCT_SERVICE");
  if (invoice.invoiceType === AccountingInvoiceType.VENDOR_INVOICE && !(invoice.expenseAccountId || invoice.qbExpenseAccountId)) issues.push("MISSING_EXPENSE_ACCOUNT");
  if (!invoice.shipmentFileNumber && invoice.businessLine !== "WAREHOUSING") issues.push("MISSING_FILE_NUMBER");
  if (directoryAvailable && !invoice.qbEntityId) issues.push("MISSING_QB_MATCH");
  const existing = Array.isArray(invoice.issues) ? invoice.issues : [];
  if (existing.includes("AMBIGUOUS_QB_MATCH")) issues.push("AMBIGUOUS_QB_MATCH");
  if (invoice.currency && invoice.currency !== "CAD" && !invoice.exchangeRateToCad && !invoice.fxOverrideReason) issues.push("FX_MISSING");
  return [...new Set(issues)];
}
