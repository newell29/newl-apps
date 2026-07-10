import type { InvoiceAutomationType } from "@prisma/client";
import type { InvoiceAutomationRow } from "@/modules/invoice-automation/types";
import { getQuickBooksApiBaseUrl } from "@/server/integrations/quickbooks";

export type QuickBooksRef = {
  value: string;
  name?: string;
};

export type QuickBooksPostingMappings = {
  productServices: Record<string, QuickBooksRef>;
  expenseAccounts: Record<string, QuickBooksRef>;
  taxCodes: {
    exempt: QuickBooksRef;
    gst?: QuickBooksRef;
    gstPst?: QuickBooksRef;
    gstPstBc?: QuickBooksRef;
    gstPstManitoba?: QuickBooksRef;
    gstPstSaskatchewan?: QuickBooksRef;
    gstQstQuebec?: QuickBooksRef;
    hst?: QuickBooksRef;
    hst15?: QuickBooksRef;
    pst?: QuickBooksRef;
    taxable?: QuickBooksRef;
  };
};

type QuickBooksQueryEntityName = "Account" | "Item" | "TaxCode";

type QuickBooksPostingMappingEntity = {
  Id?: string;
  Name?: string;
  FullyQualifiedName?: string;
  AcctNum?: string;
  Active?: boolean;
  Taxable?: boolean;
};

type QuickBooksTransactionEntityName = "Invoice" | "Bill";

type QuickBooksPostedTransactionEntity = {
  Id?: string;
  DocNumber?: string;
  CurrencyRef?: QuickBooksRef;
  ExchangeRate?: number | string;
  TotalAmt?: number | string;
  HomeTotalAmt?: number | string;
  TxnTaxDetail?: {
    TotalTax?: number | string;
  };
  Line?: Array<{
    Amount?: number | string;
    DetailType?: string;
  }>;
};

export type QuickBooksPostedTransactionDetail = {
  id: string;
  docNumber: string | null;
  currency: string | null;
  exchangeRate: number | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  homeSubtotalAmount: number | null;
  homeTaxAmount: number | null;
  homeTotalAmount: number | null;
};

export type QuickBooksSalesInvoicePayload = {
  CustomerRef: QuickBooksRef;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  CurrencyRef?: QuickBooksRef;
  GlobalTaxCalculation: "TaxExcluded";
  ExchangeRate?: number;
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
  GlobalTaxCalculation: "TaxExcluded";
  ExchangeRate?: number;
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
  mappings: QuickBooksPostingMappings,
  options: { exchangeRate?: number | null; taxContextText?: string | null } = {}
): QuickBooksSalesInvoicePayload {
  assertInvoiceType(invoice, "CUSTOMER");
  const customerRef = buildEntityRef(invoice, "CUSTOMER");
  const itemRef = getMappedRef(mappings.productServices, invoice.productOrAccountName, "product/service");
  const lineAmount = getLineAmount(invoice);
  const taxCodeRef = getTaxCodeRef(invoice, mappings, options.taxContextText);

  return stripUndefined({
    CustomerRef: customerRef,
    DocNumber: invoice.invoiceNumber ?? undefined,
    TxnDate: invoice.invoiceDate ?? undefined,
    DueDate: invoice.dueDate ?? undefined,
    CurrencyRef: buildCurrencyRef(invoice.currency),
    GlobalTaxCalculation: "TaxExcluded",
    ExchangeRate: options.exchangeRate ?? undefined,
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
  mappings: QuickBooksPostingMappings,
  options: { exchangeRate?: number | null; taxContextText?: string | null } = {}
): QuickBooksVendorBillPayload {
  assertInvoiceType(invoice, "VENDOR");
  const vendorRef = buildEntityRef(invoice, "VENDOR");
  const accountRef = getMappedRef(mappings.expenseAccounts, invoice.productOrAccountName, "expense account");
  const lineAmount = getLineAmount(invoice);
  const taxCodeRef = getTaxCodeRef(invoice, mappings, options.taxContextText);

  return stripUndefined({
    VendorRef: vendorRef,
    DocNumber: invoice.invoiceNumber ?? undefined,
    TxnDate: invoice.invoiceDate ?? undefined,
    DueDate: invoice.dueDate ?? undefined,
    CurrencyRef: buildCurrencyRef(invoice.currency),
    GlobalTaxCalculation: "TaxExcluded",
    ExchangeRate: options.exchangeRate ?? undefined,
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

export async function fetchQuickBooksPostingMappings({
  realmId,
  accessToken
}: {
  realmId: string;
  accessToken: string;
}): Promise<QuickBooksPostingMappings> {
  const [items, accounts, taxCodes] = await Promise.all([
    fetchQuickBooksMappingEntities({ realmId, accessToken, entityName: "Item" }),
    fetchQuickBooksMappingEntities({ realmId, accessToken, entityName: "Account" }),
    fetchQuickBooksMappingEntities({ realmId, accessToken, entityName: "TaxCode" })
  ]);

  return {
    productServices: buildRefMap(items),
    expenseAccounts: buildRefMap(accounts),
    taxCodes: {
      exempt: findTaxCodeRef(taxCodes, ["E", "Exempt", "Out of Scope", "NON"]) ?? { value: "E", name: "E" },
      gst: findTaxCodeRef(taxCodes, ["G", "GST"]) ?? undefined,
      gstPst: findTaxCodeRefByContains(taxCodes, ["GST PST", "GST/PST", "GST + PST", "British Columbia", "BC 12"]) ?? undefined,
      gstPstBc: findTaxCodeRefByContains(taxCodes, ["GST PST BC", "GST/PST BC", "British Columbia", "BC 12", "BC GST"]) ?? undefined,
      gstPstManitoba: findTaxCodeRefByContains(taxCodes, ["GST PST MB", "GST/PST MB", "Manitoba", "MB 12", "MB GST"]) ?? undefined,
      gstPstSaskatchewan: findTaxCodeRefByContains(taxCodes, ["GST PST SK", "GST/PST SK", "Saskatchewan", "SK 11", "SK GST"]) ?? undefined,
      gstQstQuebec: findTaxCodeRefByContains(taxCodes, ["GST QST", "GST/QST", "Quebec", "Quebec QST", "QC QST", "QST"]) ?? undefined,
      hst: findTaxCodeRef(taxCodes, ["H", "HST", "GST/HST", "Taxable"]) ?? undefined,
      hst15: findTaxCodeRef(taxCodes, ["HNS", "HNB", "HNL", "HPE", "HST 15", "HST15"]) ?? undefined,
      pst: findTaxCodeRef(taxCodes, ["P", "PST"]) ?? undefined,
      taxable: findTaxCodeRef(taxCodes, ["H", "HST", "GST/HST", "Taxable"]) ?? undefined
    }
  };
}

export async function findExistingQuickBooksTransaction({
  realmId,
  accessToken,
  invoiceType,
  docNumber
}: {
  realmId: string;
  accessToken: string;
  invoiceType: InvoiceAutomationType;
  docNumber: string;
}) {
  const entityName = invoiceType === "CUSTOMER" ? "Invoice" : "Bill";
  const query = `select * from ${entityName} where DocNumber = '${escapeQuickBooksQueryValue(docNumber)}' maxresults 1`;
  const response = await queryQuickBooks({ realmId, accessToken, query });
  const rows = invoiceType === "CUSTOMER" ? response.QueryResponse?.Invoice : response.QueryResponse?.Bill;
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function fetchQuickBooksExchangeRate({
  realmId,
  accessToken,
  sourceCurrencyCode,
  asOfDate
}: {
  realmId: string;
  accessToken: string;
  sourceCurrencyCode: string;
  asOfDate: string;
}) {
  const currency = sourceCurrencyCode.trim().toUpperCase();
  if (!currency) {
    throw new QuickBooksPostingMappingError("Missing currency for QuickBooks exchange rate lookup.");
  }

  const url = new URL(`${getQuickBooksApiBaseUrl()}/v3/company/${realmId}/exchangerate`);
  url.searchParams.set("sourcecurrencycode", currency);
  url.searchParams.set("asofdate", asOfDate);
  url.searchParams.set("minorversion", "75");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new QuickBooksPostingMappingError(`QuickBooks exchange rate lookup failed with status ${response.status}: ${text.slice(0, 500)}`);
  }

  const json = (await response.json()) as {
    ExchangeRate?: {
      Rate?: number | string;
    };
  };
  const rate = Number(json.ExchangeRate?.Rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new QuickBooksPostingMappingError(`QuickBooks did not return a valid exchange rate for ${currency} on ${asOfDate}.`);
  }

  return rate;
}

export async function createQuickBooksInvoiceAutomationTransaction({
  realmId,
  accessToken,
  invoiceType,
  payload
}: {
  realmId: string;
  accessToken: string;
  invoiceType: InvoiceAutomationType;
  payload: QuickBooksSalesInvoicePayload | QuickBooksVendorBillPayload;
}) {
  const entityPath = invoiceType === "CUSTOMER" ? "invoice" : "bill";
  const url = new URL(`${getQuickBooksApiBaseUrl()}/v3/company/${realmId}/${entityPath}`);
  url.searchParams.set("minorversion", "75");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new QuickBooksPostingMappingError(`QuickBooks ${entityPath} create failed with status ${response.status}: ${text.slice(0, 500)}`);
  }

  return (await response.json()) as {
    Invoice?: {
      Id?: string;
      DocNumber?: string;
    };
    Bill?: {
      Id?: string;
      DocNumber?: string;
    };
  };
}

export async function fetchQuickBooksPostedTransaction({
  realmId,
  accessToken,
  invoiceType,
  transactionId
}: {
  realmId: string;
  accessToken: string;
  invoiceType: InvoiceAutomationType;
  transactionId: string;
}) {
  const entityPath = invoiceType === "CUSTOMER" ? "invoice" : "bill";
  const entityName = invoiceType === "CUSTOMER" ? "Invoice" : "Bill";
  const url = new URL(`${getQuickBooksApiBaseUrl()}/v3/company/${realmId}/${entityPath}/${transactionId}`);
  url.searchParams.set("minorversion", "75");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new QuickBooksPostingMappingError(`QuickBooks ${entityPath} read failed with status ${response.status}: ${text.slice(0, 500)}`);
  }

  const json = (await response.json()) as Record<QuickBooksTransactionEntityName, QuickBooksPostedTransactionEntity | undefined>;
  const transaction = json[entityName];
  if (!transaction?.Id) {
    throw new QuickBooksPostingMappingError("QuickBooks did not return the posted transaction details.");
  }

  return readQuickBooksPostedTransactionDetail(transaction);
}

export function readQuickBooksPostedTransactionDetail(
  transaction: QuickBooksPostedTransactionEntity
): QuickBooksPostedTransactionDetail {
  if (!transaction.Id) {
    throw new QuickBooksPostingMappingError("QuickBooks transaction details are missing an ID.");
  }

  const currency = transaction.CurrencyRef?.value?.toUpperCase() ?? null;
  const exchangeRate = readPositiveNumber(transaction.ExchangeRate) ?? (currency === "CAD" ? 1 : null);
  const subtotalAmount = readTransactionSubtotalAmount(transaction);
  const taxAmount = readNumber(transaction.TxnTaxDetail?.TotalTax);
  const totalAmount = readNumber(transaction.TotalAmt);
  const homeTotalAmount = readNumber(transaction.HomeTotalAmt) ?? convertToHomeAmount(totalAmount, exchangeRate);
  const homeTaxAmount = convertToHomeAmount(taxAmount, exchangeRate);
  const homeSubtotalAmount = homeTotalAmount !== null && homeTaxAmount !== null
    ? roundMoney(homeTotalAmount - homeTaxAmount)
    : convertToHomeAmount(subtotalAmount, exchangeRate);

  return {
    id: transaction.Id,
    docNumber: transaction.DocNumber ?? null,
    currency,
    exchangeRate,
    subtotalAmount,
    taxAmount,
    totalAmount,
    homeSubtotalAmount,
    homeTaxAmount,
    homeTotalAmount
  };
}

export async function attachPdfToQuickBooksTransaction({
  realmId,
  accessToken,
  invoiceType,
  transactionId,
  fileName,
  contentType,
  pdfBytes
}: {
  realmId: string;
  accessToken: string;
  invoiceType: InvoiceAutomationType;
  transactionId: string;
  fileName: string;
  contentType: string;
  pdfBytes: Uint8Array;
}) {
  const entityType = invoiceType === "CUSTOMER" ? "Invoice" : "Bill";
  const uploadFileName = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  const metadata = {
    AttachableRef: [
      {
        EntityRef: {
          type: entityType,
          value: transactionId
        }
      }
    ],
    FileName: uploadFileName,
    ContentType: contentType
  };
  const pdfArrayBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer;
  const form = new FormData();
  form.append("file_metadata_01", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file_content_01", new Blob([pdfArrayBuffer], { type: contentType }), uploadFileName);

  const url = new URL(`${getQuickBooksApiBaseUrl()}/v3/company/${realmId}/upload`);
  url.searchParams.set("minorversion", "75");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new QuickBooksPostingMappingError(`QuickBooks PDF attachment failed with status ${response.status}: ${text.slice(0, 500)}`);
  }

  return (await response.json()) as {
    AttachableResponse?: Array<{
      Attachable?: {
        Id?: string;
        FileName?: string;
      };
      Fault?: unknown;
    }>;
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

function getTaxCodeRef(invoice: InvoiceAutomationRow, mappings: QuickBooksPostingMappings, taxContextText?: string | null) {
  if (invoice.taxAmount && invoice.taxAmount > 0) {
    if ((invoice.currency ?? "CAD").toUpperCase() !== "CAD") {
      return mappings.taxCodes.exempt;
    }

    const context = normalizeTaxContext([
      taxContextText,
      invoice.fileName,
      invoice.entityNameRaw,
      invoice.quickBooksEntityDisplayName,
      invoice.productOrAccountName
    ].filter((value): value is string => Boolean(value)).join(" "));
    const taxRate = invoice.subtotalAmount && invoice.subtotalAmount > 0
      ? roundMoney((invoice.taxAmount / invoice.subtotalAmount) * 100)
      : null;
    const provinceTaxRegion = detectCanadianProvinceTaxRegion(context);

    if (provinceTaxRegion === "BC_GST_PST") {
      return requireTaxCode(
        mappings.taxCodes.gstPstBc ?? mappings.taxCodes.gstPst,
        "Missing QuickBooks GST/PST or BC sales tax code mapping. Refusing to post as HST."
      );
    }

    if (provinceTaxRegion === "MANITOBA_GST_PST") {
      return requireTaxCode(
        mappings.taxCodes.gstPstManitoba,
        "Missing QuickBooks Manitoba GST/PST sales tax code mapping. Refusing to post as HST."
      );
    }

    if (provinceTaxRegion === "SASKATCHEWAN_GST_PST") {
      return requireTaxCode(
        mappings.taxCodes.gstPstSaskatchewan,
        "Missing QuickBooks Saskatchewan GST/PST sales tax code mapping. Refusing to post as HST."
      );
    }

    if (provinceTaxRegion === "QUEBEC_GST_QST") {
      return requireTaxCode(
        mappings.taxCodes.gstQstQuebec,
        "Missing QuickBooks Quebec GST/QST sales tax code mapping. Refusing to post as HST."
      );
    }

    if (provinceTaxRegion === "GST_ONLY" || isApproximateRate(taxRate, 5)) {
      return requireTaxCode(mappings.taxCodes.gst, "Missing QuickBooks GST sales tax code mapping.");
    }

    if (provinceTaxRegion === "HST_15" || isApproximateRate(taxRate, 15) || isApproximateRate(taxRate, 14)) {
      return requireTaxCode(mappings.taxCodes.hst15, "Missing QuickBooks 15% HST sales tax code mapping.");
    }

    if (provinceTaxRegion === "HST_13" || isApproximateRate(taxRate, 13)) {
      return requireTaxCode(
        mappings.taxCodes.hst ?? mappings.taxCodes.taxable,
        "Missing QuickBooks taxable sales tax code mapping."
      );
    }

    return requireTaxCode(mappings.taxCodes.taxable, "Missing QuickBooks taxable sales tax code mapping.");
  }

  return mappings.taxCodes.exempt;
}

function requireTaxCode(ref: QuickBooksRef | undefined, message: string) {
  if (!ref?.value) {
    throw new QuickBooksPostingMappingError(message);
  }

  return ref;
}

function normalizeTaxContext(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function detectCanadianProvinceTaxRegion(context: string) {
  if (/\bbritish columbia\b|\bbc\b/.test(context)) return "BC_GST_PST";
  if (/\bmanitoba\b|\bmb\b/.test(context)) return "MANITOBA_GST_PST";
  if (/\bsaskatchewan\b|\bsk\b/.test(context)) return "SASKATCHEWAN_GST_PST";
  if (/\bquebec\b|\bqc\b|\bqst\b/.test(context)) return "QUEBEC_GST_QST";
  if (/\balberta\b|\bab\b|\bnorthwest territories\b|\bnwt\b|\bnunavut\b|\bnu\b|\byukon\b|\byt\b/.test(context)) return "GST_ONLY";
  if (/\bontario\b|\bh 13\b/.test(context)) return "HST_13";
  if (/\bnew brunswick\b|\bnb\b|\bnewfoundland\b|\blabrador\b|\bnl\b|\bnova scotia\b|\bns\b|\bprince edward island\b|\bpei\b|\bpe\b|\bhns\b|\bhst 15\b/.test(context)) {
    return "HST_15";
  }
  if (/\bgst pst\b|\bpst gst\b/.test(context)) return "BC_GST_PST";
  if (/\bgst qst\b|\bqst gst\b/.test(context)) return "QUEBEC_GST_QST";
  if (/\bgst\b/.test(context) && !/\bpst\b|\bqst\b|\bhst\b/.test(context)) return "GST_ONLY";
  if (/\bhst\b/.test(context)) return "HST_13";

  return null;
}

function isApproximateRate(value: number | null, expected: number) {
  return value !== null && Math.abs(value - expected) <= 0.35;
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

function readTransactionSubtotalAmount(transaction: QuickBooksPostedTransactionEntity) {
  const lineSubtotal = transaction.Line
    ?.filter((line) => line.DetailType === "SalesItemLineDetail" || line.DetailType === "AccountBasedExpenseLineDetail")
    .reduce((total, line) => total + (readNumber(line.Amount) ?? 0), 0);
  if (lineSubtotal && Number.isFinite(lineSubtotal)) {
    return roundMoney(lineSubtotal);
  }

  const totalAmount = readNumber(transaction.TotalAmt);
  const taxAmount = readNumber(transaction.TxnTaxDetail?.TotalTax);
  return totalAmount !== null && taxAmount !== null ? roundMoney(totalAmount - taxAmount) : null;
}

function readNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readPositiveNumber(value: unknown) {
  const number = readNumber(value);
  return number && number > 0 ? number : null;
}

function convertToHomeAmount(value: number | null, exchangeRate: number | null) {
  if (value === null || exchangeRate === null) {
    return null;
  }
  return roundMoney(value * exchangeRate);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

async function fetchQuickBooksMappingEntities({
  realmId,
  accessToken,
  entityName
}: {
  realmId: string;
  accessToken: string;
  entityName: QuickBooksQueryEntityName;
}) {
  const entities: QuickBooksPostingMappingEntity[] = [];
  let startPosition = 1;

  while (true) {
    const query = `select * from ${entityName} where Active = true startposition ${startPosition} maxresults 1000`;
    const json = await queryQuickBooks({ realmId, accessToken, query });
    const page = readQueryResponseEntities(json, entityName);
    entities.push(...page);
    if (page.length < 1000) {
      return entities;
    }
    startPosition += 1000;
  }
}

async function queryQuickBooks({
  realmId,
  accessToken,
  query
}: {
  realmId: string;
  accessToken: string;
  query: string;
}) {
  const url = new URL(`${getQuickBooksApiBaseUrl()}/v3/company/${realmId}/query`);
  url.searchParams.set("query", query);
  url.searchParams.set("minorversion", "75");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new QuickBooksPostingMappingError(`QuickBooks query failed with status ${response.status}: ${text.slice(0, 500)}`);
  }

  return (await response.json()) as {
    QueryResponse?: Record<string, QuickBooksPostingMappingEntity[] | undefined>;
  };
}

function readQueryResponseEntities(
  json: {
    QueryResponse?: Record<string, QuickBooksPostingMappingEntity[] | undefined>;
  },
  entityName: QuickBooksQueryEntityName
) {
  return json.QueryResponse?.[entityName] ?? [];
}

function buildRefMap(entities: QuickBooksPostingMappingEntity[]) {
  const refs: Record<string, QuickBooksRef> = {};

  for (const entity of entities) {
    if (!entity.Id) {
      continue;
    }
    const names = [
      entity.Name,
      entity.FullyQualifiedName,
      entity.AcctNum && entity.Name ? `${entity.AcctNum} ${entity.Name}` : null,
      entity.AcctNum && entity.FullyQualifiedName ? `${entity.AcctNum} ${entity.FullyQualifiedName}` : null
    ].filter((value): value is string => Boolean(value));
    const ref = {
      value: entity.Id,
      name: entity.FullyQualifiedName ?? entity.Name
    };

    for (const name of names) {
      refs[name] = ref;
      refs[normalizeMappingKey(name)] = ref;
    }
  }

  return refs;
}

function findTaxCodeRef(entities: QuickBooksPostingMappingEntity[], names: string[]) {
  for (const name of names) {
    const normalizedName = normalizeMappingKey(name);
    const match = entities.find((entity) =>
      [entity.Id, entity.Name, entity.FullyQualifiedName]
        .filter((value): value is string => Boolean(value))
        .some((value) => normalizeMappingKey(value) === normalizedName)
    );
    if (match?.Id) {
      return {
        value: match.Id,
        name: match.Name ?? match.FullyQualifiedName ?? name
      };
    }
  }

  return null;
}

function findTaxCodeRefByContains(entities: QuickBooksPostingMappingEntity[], names: string[]) {
  for (const name of names) {
    const normalizedName = normalizeMappingKey(name);
    const match = entities.find((entity) =>
      [entity.Name, entity.FullyQualifiedName]
        .filter((value): value is string => Boolean(value))
        .some((value) => normalizeMappingKey(value).includes(normalizedName))
    );
    if (match?.Id) {
      return {
        value: match.Id,
        name: match.Name ?? match.FullyQualifiedName ?? name
      };
    }
  }

  return null;
}

function escapeQuickBooksQueryValue(value: string) {
  return value.replace(/'/g, "\\'");
}
