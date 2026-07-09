import { InvoiceAutomationStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";
import { normalizeInvoiceEntityName } from "@/modules/invoice-automation/extraction";
import {
  getInvoiceAutomationQuickBooksEntityOptions,
  getInvoiceAutomationQuickBooksSyncSummary
} from "@/modules/invoice-automation/quickbooks-entities";
import { toInvoiceAutomationRow } from "@/modules/invoice-automation/row-mapper";
import type { InvoiceAutomationEntityOption, InvoiceAutomationRow } from "@/modules/invoice-automation/types";

export type InvoiceAutomationFilters = {
  q?: string;
  status?: string;
  type?: string;
};

export async function getInvoiceAutomationUploadShell(tenant: TenantContext, filters: InvoiceAutomationFilters = {}) {
  const [invoices, entityOptions, quickBooksSync] = await Promise.all([
    getInvoiceAutomationRows(tenant, filters, [
      InvoiceAutomationStatus.OPERATIONS_REVIEW,
      InvoiceAutomationStatus.ACCOUNTING_REVIEW,
      InvoiceAutomationStatus.APPROVED_FOR_POSTING,
      InvoiceAutomationStatus.POSTING_ERROR
    ]),
    getInvoiceAutomationEntityOptions(tenant),
    getInvoiceAutomationQuickBooksSyncSummary(tenant)
  ]);

  return {
    invoices,
    entityOptions,
    quickBooksSync,
    filters,
    summary: {
      operationsReview: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.OPERATIONS_REVIEW).length,
      accountingReview: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.ACCOUNTING_REVIEW).length,
      approvedForPosting: invoices.filter((invoice) => invoice.status === InvoiceAutomationStatus.APPROVED_FOR_POSTING).length,
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
    take: 100,
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
