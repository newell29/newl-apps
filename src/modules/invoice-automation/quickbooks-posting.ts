import type { InvoiceAutomationType } from "@prisma/client";
import type { InvoiceAutomationRow } from "@/modules/invoice-automation/types";

export type QuickBooksRef = {
  value: string;
  name?: string;
};

export type QuickBooksPostingMappings = {
  productServices: Record<string, QuickBooksRef>;
  expenseAccounts: Record<string, QuickBooksRef>;
  taxCodes: {
    exempt: QuickBooksRef;
    taxable?: QuickBooksRef;
  };
};

export type QuickBooksSalesInvoicePayload = {
  CustomerRef: QuickBooksRef;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  CurrencyRef?: QuickBooksRef;
  PrivateNote?: string;
  Line: Array<{
    DetailType: "SalesItemLineDetail";
    Description?: string;
    Amount: number;
    SalesItemLineDetail: {
      ItemRef: QuickBooksRef;
      Qty: number;
      UnitPrice: number;
      TaxCodeRef: QuickBooksRef;
    };
  }>;
};

export type QuickBooksVendorBillPayload = {
  VendorRef: QuickBooksRef;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  CurrencyRef?: QuickBooksRef;
  PrivateNote?: string;
  Line: Array<{
    DetailType: "AccountBasedExpenseLineDetail";
    Description?: string;
    Amount: number;
    AccountBasedExpenseLineDetail: {
      AccountRef: QuickBooksRef;
      TaxCodeRef: QuickBooksRef;
    };
  }>;
};

export class QuickBooksPostingMappingError extends Error {
  status = 422;
}

export function buildQuickBooksSalesInvoicePayload(
  invoice: InvoiceAutomationRow,
  mappings: QuickBooksPostingMappings
): QuickBooksSalesInvoicePayload {
  assertInvoiceType(invoice, "CUSTOMER");
  const customerRef = buildEntityRef(invoice, "CUSTOMER");
  const itemRef = getMappedRef(mappings.productServices, invoice.productOrAccountName, "product/service");
  const lineAmount = getLineAmount(invoice);
  const taxCodeRef = getTaxCodeRef(invoice, mappings);

  return stripUndefined({
    CustomerRef: customerRef,
    DocNumber: invoice.invoiceNumber ?? undefined,
    TxnDate: invoice.invoiceDate ?? undefined,
    DueDate: invoice.dueDate ?? undefined,
    CurrencyRef: buildCurrencyRef(invoice.currency),
    PrivateNote: invoice.shipmentFileNumber ?? undefined,
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Description: invoice.shipmentFileNumber ?? undefined,
        Amount: lineAmount,
        SalesItemLineDetail: {
          ItemRef: itemRef,
          Qty: 1,
          UnitPrice: lineAmount,
          TaxCodeRef: taxCodeRef
        }
      }
    ]
  });
}

export function buildQuickBooksVendorBillPayload(
  invoice: InvoiceAutomationRow,
  mappings: QuickBooksPostingMappings
): QuickBooksVendorBillPayload {
  assertInvoiceType(invoice, "VENDOR");
  const vendorRef = buildEntityRef(invoice, "VENDOR");
  const accountRef = getMappedRef(mappings.expenseAccounts, invoice.productOrAccountName, "expense account");
  const lineAmount = getLineAmount(invoice);
  const taxCodeRef = getTaxCodeRef(invoice, mappings);

  return stripUndefined({
    VendorRef: vendorRef,
    DocNumber: invoice.invoiceNumber ?? undefined,
    TxnDate: invoice.invoiceDate ?? undefined,
    DueDate: invoice.dueDate ?? undefined,
    CurrencyRef: buildCurrencyRef(invoice.currency),
    PrivateNote: invoice.shipmentFileNumber ?? undefined,
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Description: invoice.shipmentFileNumber ?? undefined,
        Amount: lineAmount,
        AccountBasedExpenseLineDetail: {
          AccountRef: accountRef,
          TaxCodeRef: taxCodeRef
        }
      }
    ]
  });
}

export function parseQuickBooksEntityOptionId(
  value: string | null,
  expectedType?: InvoiceAutomationType
) {
  if (!value?.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const parts = trimmed.split(":");
  if (parts.length === 4 && parts[0] === "quickbooks") {
    const entityType = parts[2] as InvoiceAutomationType;
    if (expectedType && entityType !== expectedType) {
      throw new QuickBooksPostingMappingError(`QuickBooks entity type ${entityType} does not match ${expectedType}.`);
    }
    return {
      realmId: parts[1],
      entityType,
      quickBooksId: parts[3]
    };
  }

  return {
    realmId: null,
    entityType: expectedType ?? null,
    quickBooksId: trimmed
  };
}

function assertInvoiceType(invoice: InvoiceAutomationRow, expectedType: InvoiceAutomationType) {
  if (invoice.invoiceType !== expectedType) {
    throw new QuickBooksPostingMappingError(`Expected a ${expectedType.toLowerCase()} invoice but received ${invoice.invoiceType}.`);
  }
}

function buildEntityRef(invoice: InvoiceAutomationRow, expectedType: InvoiceAutomationType) {
  const parsed = parseQuickBooksEntityOptionId(invoice.quickBooksEntityId, expectedType);
  if (!parsed?.quickBooksId) {
    throw new QuickBooksPostingMappingError(`Missing QuickBooks ${expectedType === "CUSTOMER" ? "customer" : "vendor"} ID.`);
  }

  return stripUndefined({
    value: parsed.quickBooksId,
    name: invoice.quickBooksEntityDisplayName ?? invoice.entityNameRaw ?? undefined
  });
}

function getMappedRef(
  refs: Record<string, QuickBooksRef>,
  name: string | null,
  label: string
) {
  const mapped = name ? refs[name] ?? refs[normalizeMappingKey(name)] : null;
  if (!mapped?.value) {
    throw new QuickBooksPostingMappingError(`Missing QuickBooks ${label} mapping for ${name ?? "blank value"}.`);
  }

  return mapped;
}

function getTaxCodeRef(invoice: InvoiceAutomationRow, mappings: QuickBooksPostingMappings) {
  if (invoice.taxAmount && invoice.taxAmount > 0) {
    if (!mappings.taxCodes.taxable?.value) {
      throw new QuickBooksPostingMappingError("Missing QuickBooks taxable sales tax code mapping.");
    }
    return mappings.taxCodes.taxable;
  }

  return mappings.taxCodes.exempt;
}

function getLineAmount(invoice: InvoiceAutomationRow) {
  const amount =
    invoice.subtotalAmount ??
    (invoice.totalAmount !== null && invoice.taxAmount !== null ? invoice.totalAmount - invoice.taxAmount : invoice.totalAmount);

  if (amount === null || !Number.isFinite(amount)) {
    throw new QuickBooksPostingMappingError("Missing invoice amount for QuickBooks line.");
  }

  return roundMoney(amount);
}

function buildCurrencyRef(currency: string | null) {
  return currency ? { value: currency.toUpperCase() } : undefined;
}

function normalizeMappingKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
