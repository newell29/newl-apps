import { InvoiceAutomationStatus, type InvoiceAutomationType, type Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";
import { getInvoiceAutomationCorrectionMemoryHints } from "@/modules/invoice-automation/correction-memory-store";
import { normalizeInvoiceEntityName } from "@/modules/invoice-automation/extraction";
import {
  getInvoiceAutomationQuickBooksEntityOptions,
  getInvoiceAutomationQuickBooksSyncSummary
} from "@/modules/invoice-automation/quickbooks-entities";
import { toInvoiceAutomationRow } from "@/modules/invoice-automation/row-mapper";
import type { InvoiceAutomationEntityOption, InvoiceAutomationRow } from "@/modules/invoice-automation/types";

const INVOICE_AUTOMATION_ROW_QUERY_LIMIT = 5000;

export type InvoiceAutomationFilters = {
  q?: string;
  status?: string;
  type?: string;
};

export type InvoiceAutomationReconciliationRisk =
  | "MISSING_CUSTOMER_INVOICE"
  | "MISSING_VENDOR_INVOICE"
  | "HIGH_MARGIN"
  | "ELEVATED_MARGIN"
  | "NEGATIVE_MARGIN"
  | "FX_MISSING";

export type InvoiceAutomationReconciliationRow = {
  shipmentFileNumber: string;
  shipmentType: string | null;
  customerNames: string[];
  vendorNames: string[];
  customerInvoiceCount: number;
  vendorInvoiceCount: number;
  customerRevenueCad: number | null;
  vendorCostCad: number | null;
  grossProfitCad: number | null;
  grossMarginPercent: number | null;
  unknownCustomerRevenueCount: number;
  unknownVendorCostCount: number;
  customerInvoiceNumbers: string[];
  vendorInvoiceNumbers: string[];
  latestInvoiceDate: string | null;
  risks: InvoiceAutomationReconciliationRisk[];
};

export async function getInvoiceAutomationUploadShell(tenant: TenantContext, filters: InvoiceAutomationFilters = {}) {
  const [invoices, entityOptions, quickBooksSync, correctionMemories] = await Promise.all([
    getInvoiceAutomationRows(tenant, filters, [
      InvoiceAutomationStatus.OPERATIONS_REVIEW,
      InvoiceAutomationStatus.ACCOUNTING_REVIEW,
      InvoiceAutomationStatus.APPROVED_FOR_POSTING,
      InvoiceAutomationStatus.POSTING_ERROR,
      InvoiceAutomationStatus.POSTED
    ]),
    getInvoiceAutomationEntityOptions(tenant),
    getInvoiceAutomationQuickBooksSyncSummary(tenant),
    getInvoiceAutomationCorrectionMemoryHints(prisma, tenant)
  ]);

  return {
    invoices,
    entityOptions,
    quickBooksSync,
    correctionMemories,
    filters,
    summary: {
      operationsReview: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.OPERATIONS_REVIEW).length,
      accountingReview: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.ACCOUNTING_REVIEW).length,
      approvedForPosting: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.APPROVED_FOR_POSTING).length,
      posted: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.POSTED).length,
      needsAttention: invoices.filter((invoice) => invoice.issueCodes.length > 0).length
    }
  };
}

export async function getInvoiceAutomationAccountingShell(tenant: TenantContext, filters: InvoiceAutomationFilters = {}) {
  const invoices = await getInvoiceAutomationRows(tenant, filters, [
    InvoiceAutomationStatus.ACCOUNTING_REVIEW,
    InvoiceAutomationStatus.APPROVED_FOR_POSTING,
    InvoiceAutomationStatus.POSTING_ERROR
  ]);

  return {
    invoices,
    filters,
    summary: {
      accountingReview: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.ACCOUNTING_REVIEW).length,
      approvedForPosting: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.APPROVED_FOR_POSTING).length,
      postingErrors: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.POSTING_ERROR).length
    }
  };
}

export async function getInvoiceAutomationPostedShell(tenant: TenantContext, filters: InvoiceAutomationFilters = {}) {
  const invoices = await getInvoiceAutomationRows(tenant, filters, [InvoiceAutomationStatus.POSTED]);
  return { invoices, filters };
}

export async function getInvoiceAutomationReconciliationShell(tenant: TenantContext) {
  const invoices = await prisma.invoiceAutomationInvoice.findMany({
    where: {
      tenantId: tenant.tenantId,
      shipmentFileNumber: {
        not: null
      },
      status: {
        not: InvoiceAutomationStatus.REJECTED
      }
    },
    orderBy: [{ updatedAt: "desc" }],
    take: INVOICE_AUTOMATION_ROW_QUERY_LIMIT,
    select: {
      id: true,
      invoiceType: true,
      status: true,
      shipmentFileNumber: true,
      shipmentType: true,
      entityNameRaw: true,
      quickBooksEntityDisplayName: true,
      invoiceNumber: true,
      invoiceDate: true,
      currency: true,
      subtotalAmount: true,
      quickBooksSubtotalHomeAmount: true
    }
  });
  const newlShipmentFileNumbers = uniqueShipmentFileNumbers(invoices.map((invoice) => invoice.shipmentFileNumber));
  const quickBooksTransactions = newlShipmentFileNumbers.length > 0
    ? await prisma.invoiceAutomationQuickBooksTransaction.findMany({
        where: {
          tenantId: tenant.tenantId,
          invoiceAutomationInvoiceId: null,
          shipmentFileNumber: {
            in: newlShipmentFileNumbers
          }
        },
        orderBy: [{ observedAt: "desc" }],
        take: INVOICE_AUTOMATION_ROW_QUERY_LIMIT,
        select: {
          id: true,
          invoiceType: true,
          shipmentFileNumber: true,
          shipmentType: true,
          entityName: true,
          quickBooksTxnNumber: true,
          transactionDate: true,
          currency: true,
          subtotalAmount: true,
          quickBooksSubtotalHomeAmount: true
        }
      })
    : [];

  const rows = buildShipmentReconciliationRows([
    ...invoices,
    ...quickBooksTransactions.map(toQuickBooksReconciliationRecord)
  ]);

  return {
    rows,
    summary: {
      shipmentCount: rows.length,
      missingCustomerInvoice: rows.filter((row) => row.risks.includes("MISSING_CUSTOMER_INVOICE")).length,
      missingVendorInvoice: rows.filter((row) => row.risks.includes("MISSING_VENDOR_INVOICE")).length,
      highOrElevatedMargin: rows.filter((row) => row.risks.includes("HIGH_MARGIN") || row.risks.includes("ELEVATED_MARGIN")).length,
      negativeMargin: rows.filter((row) => row.risks.includes("NEGATIVE_MARGIN")).length,
      fxMissing: rows.filter((row) => row.risks.includes("FX_MISSING")).length
    }
  };
}

function uniqueShipmentFileNumbers(values: Array<string | null>) {
  return [...new Set(values.map((value) => value?.trim().toUpperCase()).filter((value): value is string => Boolean(value)))];
}

export async function getInvoiceAutomationEntityOptions(tenant: TenantContext): Promise<InvoiceAutomationEntityOption[]> {
  const [quickBooksEntities, aliases, customers, vendors] = await Promise.all([
    getInvoiceAutomationQuickBooksEntityOptions(tenant),
    prisma.cashflowCustomerAlias.findMany({
      where: tenantWhere(tenant),
      orderBy: { sourceCustomerName: "asc" },
      select: {
        id: true,
        sourceCustomerId: true,
        sourceCustomerName: true,
        normalizedSourceName: true,
        sourceCurrency: true
      }
    }),
    prisma.cashflowCustomer.findMany({
      where: tenantWhere(tenant, { active: true }),
      orderBy: { customerName: "asc" },
      select: {
        id: true,
        customerName: true
      }
    }),
    prisma.cashflowVendorBill.findMany({
      where: tenantWhere(tenant),
      distinct: ["vendorName"],
      orderBy: { vendorName: "asc" },
      select: {
        vendorName: true
      }
    })
  ]);

  const customerOptions = [
    ...aliases.map((alias) => ({
      id: alias.sourceCustomerId ?? alias.id,
      displayName: alias.sourceCustomerName,
      normalizedName: alias.normalizedSourceName.replace(/-/g, " "),
      currency: alias.sourceCurrency,
      entityType: "CUSTOMER" as const
    })),
    ...customers.map((customer) => ({
      id: customer.id,
      displayName: customer.customerName,
      normalizedName: normalizeInvoiceEntityName(customer.customerName),
      currency: null,
      entityType: "CUSTOMER" as const
    }))
  ];

  const vendorOptions = vendors.map((vendor) => ({
    id: `vendor:${normalizeInvoiceEntityName(vendor.vendorName)}`,
    displayName: vendor.vendorName,
    normalizedName: normalizeInvoiceEntityName(vendor.vendorName),
    currency: null,
    entityType: "VENDOR" as const
  }));

  return dedupeEntityOptions([...quickBooksEntities, ...customerOptions, ...vendorOptions]);
}

async function getInvoiceAutomationRows(
  tenant: TenantContext,
  filters: InvoiceAutomationFilters,
  defaultStatuses: InvoiceAutomationStatus[]
): Promise<InvoiceAutomationRow[]> {
  const where: Prisma.InvoiceAutomationInvoiceWhereInput = {
    tenantId: tenant.tenantId,
    status: {
      in: readStatuses(filters.status, defaultStatuses)
    },
    ...(filters.type === "CUSTOMER" || filters.type === "VENDOR" ? { invoiceType: filters.type } : {}),
    ...(filters.q?.trim()
      ? {
          OR: [
            { fileName: { contains: filters.q.trim(), mode: "insensitive" } },
            { shipmentFileNumber: { contains: filters.q.trim(), mode: "insensitive" } },
            { entityNameRaw: { contains: filters.q.trim(), mode: "insensitive" } },
            { quickBooksEntityDisplayName: { contains: filters.q.trim(), mode: "insensitive" } },
            { invoiceNumber: { contains: filters.q.trim(), mode: "insensitive" } },
            { batch: { batchNumber: { contains: filters.q.trim(), mode: "insensitive" } } }
          ]
        }
      : {})
  };

  const rows = await prisma.invoiceAutomationInvoice.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: INVOICE_AUTOMATION_ROW_QUERY_LIMIT,
    include: {
      batch: {
        select: {
          batchNumber: true
        }
      }
    }
  });

  const userNameById = await getUserNameById(
    rows.map((row) => row.sentToAccountingById).filter((userId): userId is string => Boolean(userId))
  );
  return rows.map((row) => toInvoiceAutomationRow(row, userNameById));
}

type ReconciliationInvoiceRecord = {
  id: string;
  invoiceType: InvoiceAutomationType;
  status: InvoiceAutomationStatus;
  shipmentFileNumber: string | null;
  shipmentType: string | null;
  entityNameRaw: string | null;
  quickBooksEntityDisplayName: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  currency: string | null;
  subtotalAmount: { toString(): string } | number | null;
  quickBooksSubtotalHomeAmount: { toString(): string } | number | null;
};

function toQuickBooksReconciliationRecord(record: {
  id: string;
  invoiceType: InvoiceAutomationType;
  shipmentFileNumber: string | null;
  shipmentType: string | null;
  entityName: string | null;
  quickBooksTxnNumber: string | null;
  transactionDate: Date | null;
  currency: string | null;
  subtotalAmount: Prisma.Decimal | null;
  quickBooksSubtotalHomeAmount: Prisma.Decimal | null;
}): ReconciliationInvoiceRecord {
  return {
    id: `quickbooks:${record.id}`,
    invoiceType: record.invoiceType,
    status: InvoiceAutomationStatus.POSTED,
    shipmentFileNumber: record.shipmentFileNumber,
    shipmentType: record.shipmentType,
    entityNameRaw: record.entityName,
    quickBooksEntityDisplayName: record.entityName,
    invoiceNumber: record.quickBooksTxnNumber,
    invoiceDate: record.transactionDate,
    currency: record.currency,
    subtotalAmount: record.subtotalAmount,
    quickBooksSubtotalHomeAmount: record.quickBooksSubtotalHomeAmount
  };
}

function buildShipmentReconciliationRows(records: ReconciliationInvoiceRecord[]): InvoiceAutomationReconciliationRow[] {
  const groups = new Map<string, ReconciliationInvoiceRecord[]>();
  for (const record of records) {
    const shipmentFileNumber = record.shipmentFileNumber?.trim().toUpperCase();
    if (!shipmentFileNumber) {
      continue;
    }
    const group = groups.get(shipmentFileNumber) ?? [];
    group.push(record);
    groups.set(shipmentFileNumber, group);
  }

  return [...groups.entries()]
    .map(([shipmentFileNumber, group]) => buildShipmentReconciliationRow(shipmentFileNumber, group))
    .sort((left, right) => {
      const leftRisk = getRiskSortWeight(left);
      const rightRisk = getRiskSortWeight(right);
      if (leftRisk !== rightRisk) return rightRisk - leftRisk;
      return (right.latestInvoiceDate ?? "").localeCompare(left.latestInvoiceDate ?? "");
    });
}

function buildShipmentReconciliationRow(
  shipmentFileNumber: string,
  group: ReconciliationInvoiceRecord[]
): InvoiceAutomationReconciliationRow {
  const customerInvoices = group.filter((record) => record.invoiceType === "CUSTOMER");
  const vendorInvoices = group.filter((record) => record.invoiceType === "VENDOR");
  const customerAmounts = sumCadSubtotal(customerInvoices);
  const vendorAmounts = sumCadSubtotal(vendorInvoices);
  const customerRevenueCad = customerAmounts.unknownCount === 0 ? customerAmounts.total : null;
  const vendorCostCad = vendorAmounts.unknownCount === 0 ? vendorAmounts.total : null;
  const grossProfitCad = customerRevenueCad !== null && vendorCostCad !== null
    ? roundMoney(customerRevenueCad - vendorCostCad)
    : null;
  const grossMarginPercent = grossProfitCad !== null && customerRevenueCad !== null && customerRevenueCad > 0
    ? roundPercent((grossProfitCad / customerRevenueCad) * 100)
    : null;
  const risks = buildReconciliationRisks({
    customerInvoiceCount: customerInvoices.length,
    vendorInvoiceCount: vendorInvoices.length,
    grossProfitCad,
    grossMarginPercent,
    unknownHomeAmountCount: customerAmounts.unknownCount + vendorAmounts.unknownCount
  });

  return {
    shipmentFileNumber,
    shipmentType: group.find((record) => record.shipmentType)?.shipmentType ?? shipmentFileNumber.slice(0, 2),
    customerNames: uniqueSorted(customerInvoices.map(readReconciliationEntityName)),
    vendorNames: uniqueSorted(vendorInvoices.map(readReconciliationEntityName)),
    customerInvoiceCount: customerInvoices.length,
    vendorInvoiceCount: vendorInvoices.length,
    customerRevenueCad,
    vendorCostCad,
    grossProfitCad,
    grossMarginPercent,
    unknownCustomerRevenueCount: customerAmounts.unknownCount,
    unknownVendorCostCount: vendorAmounts.unknownCount,
    customerInvoiceNumbers: uniqueSorted(customerInvoices.map((invoice) => invoice.invoiceNumber).filter((value): value is string => Boolean(value))),
    vendorInvoiceNumbers: uniqueSorted(vendorInvoices.map((invoice) => invoice.invoiceNumber).filter((value): value is string => Boolean(value))),
    latestInvoiceDate: readLatestInvoiceDate(group),
    risks
  };
}

function sumCadSubtotal(records: ReconciliationInvoiceRecord[]) {
  let total = 0;
  let unknownCount = 0;

  for (const record of records) {
    const amount = readCadSubtotalAmount(record);
    if (amount === null) {
      unknownCount += 1;
      continue;
    }
    total += amount;
  }

  return {
    total: roundMoney(total),
    unknownCount
  };
}

function readCadSubtotalAmount(record: ReconciliationInvoiceRecord) {
  const postedHomeAmount = decimalToNumber(record.quickBooksSubtotalHomeAmount);
  if (postedHomeAmount !== null) {
    return postedHomeAmount;
  }

  const currency = record.currency?.trim().toUpperCase() || "CAD";
  if (currency === "CAD") {
    return decimalToNumber(record.subtotalAmount);
  }

  return null;
}

function buildReconciliationRisks({
  customerInvoiceCount,
  vendorInvoiceCount,
  grossProfitCad,
  grossMarginPercent,
  unknownHomeAmountCount
}: {
  customerInvoiceCount: number;
  vendorInvoiceCount: number;
  grossProfitCad: number | null;
  grossMarginPercent: number | null;
  unknownHomeAmountCount: number;
}) {
  const risks: InvoiceAutomationReconciliationRisk[] = [];
  if (vendorInvoiceCount > 0 && customerInvoiceCount === 0) risks.push("MISSING_CUSTOMER_INVOICE");
  if (customerInvoiceCount > 0 && vendorInvoiceCount === 0) risks.push("MISSING_VENDOR_INVOICE");
  if (grossProfitCad !== null && grossProfitCad < 0) risks.push("NEGATIVE_MARGIN");
  if (grossMarginPercent !== null && grossMarginPercent >= 50) risks.push("HIGH_MARGIN");
  else if (grossMarginPercent !== null && grossMarginPercent >= 40) risks.push("ELEVATED_MARGIN");
  if (unknownHomeAmountCount > 0) risks.push("FX_MISSING");
  return risks;
}

function getRiskSortWeight(row: InvoiceAutomationReconciliationRow) {
  const weights: Record<InvoiceAutomationReconciliationRisk, number> = {
    MISSING_CUSTOMER_INVOICE: 100,
    NEGATIVE_MARGIN: 90,
    HIGH_MARGIN: 80,
    MISSING_VENDOR_INVOICE: 70,
    ELEVATED_MARGIN: 60,
    FX_MISSING: 50
  };
  return Math.max(0, ...row.risks.map((risk) => weights[risk]));
}

function readReconciliationEntityName(record: ReconciliationInvoiceRecord) {
  return record.quickBooksEntityDisplayName ?? record.entityNameRaw ?? null;
}

function readLatestInvoiceDate(records: ReconciliationInvoiceRecord[]) {
  const dates = records
    .map((record) => record.invoiceDate?.toISOString().slice(0, 10) ?? null)
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates.at(-1) ?? null;
}

function uniqueSorted(values: Array<string | null>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function decimalToNumber(value: { toString(): string } | number | null) {
  if (value === null) {
    return null;
  }
  const number = Number(value.toString());
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function readStatuses(value: string | undefined, fallback: InvoiceAutomationStatus[]) {
  if (!value || value === "ALL") {
    return fallback;
  }

  return Object.values(InvoiceAutomationStatus).includes(value as InvoiceAutomationStatus)
    ? [value as InvoiceAutomationStatus]
    : fallback;
}

function dedupeEntityOptions(options: InvoiceAutomationEntityOption[]) {
  const seen = new Set<string>();
  const deduped: InvoiceAutomationEntityOption[] = [];
  for (const option of options) {
    const key = `${option.entityType}:${option.normalizedName}:${option.currency ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(option);
  }
  return deduped;
}

async function getUserNameById(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) {
    return new Map<string, string>();
  }

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: uniqueUserIds
      }
    },
    select: {
      id: true,
      name: true,
      email: true
    }
  });

  return new Map(users.map((user) => [user.id, user.name ?? user.email]));
}
