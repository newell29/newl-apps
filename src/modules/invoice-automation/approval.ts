import type { InvoiceAutomationType } from "@prisma/client";

export class InvoiceApprovalError extends Error {
  status = 422;
}

export type InvoiceAutomationApprovalInput = {
  invoiceType: InvoiceAutomationType;
  fileName?: string | null;
  shipmentFileNumber?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Date | null;
  entityNameRaw?: string | null;
  quickBooksEntityId?: string | null;
  currency?: string | null;
  totalAmount?: number | { toString(): string } | null;
  productOrAccountName?: string | null;
};

export function getInvoiceApprovalBlockingIssues(input: InvoiceAutomationApprovalInput) {
  const issues: string[] = [];
  if (!readText(input.shipmentFileNumber)) issues.push("missing file number");
  if (!readText(input.invoiceNumber)) issues.push("missing invoice number");
  if (!input.invoiceDate) issues.push("missing invoice date");
  if (!readText(input.entityNameRaw)) issues.push(input.invoiceType === "CUSTOMER" ? "missing customer" : "missing vendor");
  if (!readText(input.quickBooksEntityId)) issues.push("missing QuickBooks match");
  if (!readText(input.currency)) issues.push("missing currency");
  if (!hasTotalAmount(input.totalAmount)) issues.push("missing total amount");
  if (!readText(input.productOrAccountName)) issues.push(input.invoiceType === "CUSTOMER" ? "missing product/service" : "missing expense account");
  return issues;
}

export function formatInvoiceApprovalBlocker(input: InvoiceAutomationApprovalInput, issues: string[]) {
  const label =
    readText(input.invoiceNumber) ??
    readText(input.shipmentFileNumber) ??
    readText(input.fileName) ??
    "one selected invoice";
  return `${label} cannot be approved because it has ${issues.join(", ")}.`;
}

function readText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasTotalAmount(value: InvoiceAutomationApprovalInput["totalAmount"]) {
  if (value === null || value === undefined) {
    return false;
  }

  const numeric = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(numeric);
}
