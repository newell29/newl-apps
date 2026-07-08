/* eslint-disable @typescript-eslint/no-explicit-any */
import { AccountingInvoiceStatus, AccountingInvoiceType, ModuleKey, QuickBooksDirectoryEntityType } from "@prisma/client";
import { requireModule } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export async function getInvoiceAutomationWorkspace(context: AuthenticatedContext, filters: { q?: string; status?: string; issue?: string } = {}) {
  await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
  const where: any = { tenantId: context.tenantId };
  if (filters.status) where.status = filters.status;
  if (filters.q) where.searchText = { contains: filters.q.toLowerCase() };
  const [invoices, batches, directory, mappings] = await Promise.all([
    prisma.accountingInvoiceStaging.findMany({ where, include: { document: { select: { fileName: true, id: true } }, batch: { select: { batchNumber: true, status: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.accountingInvoiceBatch.findMany({ where: { tenantId: context.tenantId }, include: { _count: { select: { invoices: true } }, invoices: { select: { id: true, invoiceNumber: true, invoiceType: true, rawEntityName: true, qbEntityDisplayName: true, shipmentFileNumber: true, total: true, currency: true, status: true }, orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.quickBooksDirectoryEntity.findMany({ where: { tenantId: context.tenantId, active: true }, orderBy: [{ entityType: "asc" }, { displayName: "asc" }], take: 1000 }),
    prisma.accountingServiceMappingRule.findMany({ where: { tenantId: context.tenantId, active: true }, orderBy: [{ servicePrefix: "asc" }, { createdAt: "desc" }] })
  ]);
  const filteredInvoices = filters.issue ? invoices.filter((invoice) => Array.isArray(invoice.issues) && invoice.issues.includes(filters.issue!)) : invoices;
  return { invoices: filteredInvoices, batches, directory, mappings, metrics: buildMetrics(filteredInvoices), profitability: buildProfitability(filteredInvoices), risks: buildRisks(filteredInvoices) };
}

export async function findTenantAccountingDocument(context: AuthenticatedContext, documentId: string) {
  await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
  return prisma.accountingDocument.findFirst({ where: { tenantId: context.tenantId, id: documentId } });
}

function amount(value: unknown) { return Number(value ?? 0); }
function issuesOf(invoice: any) { return Array.isArray(invoice.issues) ? invoice.issues as string[] : []; }
function buildMetrics(invoices: any[]) { return { total: invoices.length, needsReview: invoices.filter((i) => i.status === AccountingInvoiceStatus.NEEDS_REVIEW).length, approved: invoices.filter((i) => i.status === AccountingInvoiceStatus.APPROVED).length, readyToPost: invoices.filter((i) => i.postingStatus === "READY_TO_POST").length, issueCount: invoices.reduce((sum, i) => sum + issuesOf(i).length, 0) }; }
export function buildProfitability(invoices: any[]) {
  const grouped = new Map<string, any>();
  for (const invoice of invoices) {
    const key = invoice.shipmentFileNumber || "MISSING_FILE_NUMBER";
    const row = grouped.get(key) ?? { shipmentFileNumber: key, revenue: 0, cost: 0, customerInvoiceCount: 0, vendorInvoiceCount: 0, unapprovedInvoiceCount: 0, unpostedApprovedInvoiceCount: 0, issueCount: 0, currencies: new Set<string>(), fxNeeded: false };
    row.currencies.add(invoice.currency || "CAD");
    if (invoice.currency && invoice.currency !== "CAD" && !invoice.exchangeRateToCad) row.fxNeeded = true;
    if (invoice.status === AccountingInvoiceStatus.APPROVED && invoice.invoiceType === AccountingInvoiceType.CUSTOMER_INVOICE) { row.revenue += amount(invoice.total); row.customerInvoiceCount += 1; }
    if (invoice.status === AccountingInvoiceStatus.APPROVED && invoice.invoiceType === AccountingInvoiceType.VENDOR_INVOICE) { row.cost += amount(invoice.total); row.vendorInvoiceCount += 1; }
    if (invoice.status !== AccountingInvoiceStatus.APPROVED) row.unapprovedInvoiceCount += 1;
    if (invoice.status === AccountingInvoiceStatus.APPROVED && invoice.postingStatus !== "POSTED") row.unpostedApprovedInvoiceCount += 1;
    row.issueCount += issuesOf(invoice).length;
    grouped.set(key, row);
  }
  return [...grouped.values()].map((row) => ({ ...row, currencies: [...row.currencies], grossProfit: row.revenue - row.cost, grossMargin: row.revenue > 0 && !row.fxNeeded && row.currencies.length === 1 ? (row.revenue - row.cost) / row.revenue : null }));
}
export function buildRisks(invoices: any[]) {
  const risks: Array<{ shipmentFileNumber: string; code: string; detail: string }> = [];
  const duplicateKeys = new Map<string, any[]>();
  for (const invoice of invoices) {
    if (invoice.invoiceType && invoice.invoiceNumber) {
      const entityKey = invoice.qbEntityId ?? invoice.normalizedEntityName ?? invoice.rawEntityName ?? "UNKNOWN_ENTITY";
      const key = `${invoice.invoiceType}|${entityKey}|${invoice.invoiceNumber}`.toLowerCase();
      duplicateKeys.set(key, [...(duplicateKeys.get(key) ?? []), invoice]);
    }
    if (invoice.status === AccountingInvoiceStatus.APPROVED && !invoice.batchId) {
      risks.push({ shipmentFileNumber: invoice.shipmentFileNumber ?? "MISSING_FILE_NUMBER", code: "APPROVED_UNBATCHED", detail: invoice.invoiceNumber ?? invoice.document?.fileName ?? invoice.id });
    }
  }
  for (const duplicates of duplicateKeys.values()) {
    if (duplicates.length > 1) {
      const invoice = duplicates[0];
      risks.push({ shipmentFileNumber: invoice.shipmentFileNumber ?? "MISSING_FILE_NUMBER", code: "DUPLICATE_INVOICE", detail: invoice.invoiceNumber ?? invoice.id });
    }
  }
  for (const row of buildProfitability(invoices)) {
    if (row.shipmentFileNumber === "MISSING_FILE_NUMBER") risks.push({ shipmentFileNumber: row.shipmentFileNumber, code: "MISSING_FILE_NUMBER", detail: "Invoice is not tied to a shipment file." });
    if (row.vendorInvoiceCount > 0 && row.customerInvoiceCount === 0) risks.push({ shipmentFileNumber: row.shipmentFileNumber, code: "VENDOR_WITHOUT_CUSTOMER", detail: "Vendor invoice exists but no approved customer invoice." });
    if (row.customerInvoiceCount > 0 && row.vendorInvoiceCount === 0) risks.push({ shipmentFileNumber: row.shipmentFileNumber, code: "CUSTOMER_WITHOUT_VENDOR", detail: "Customer invoice exists but no approved vendor invoice." });
    if (row.grossProfit < 0) risks.push({ shipmentFileNumber: row.shipmentFileNumber, code: "NEGATIVE_GROSS_PROFIT", detail: "Approved costs exceed approved revenue." });
    if (row.fxNeeded || row.currencies.length > 1) risks.push({ shipmentFileNumber: row.shipmentFileNumber, code: "FX_NEEDED", detail: "Mixed/non-CAD currency requires exchange-rate review." });
    if (row.unpostedApprovedInvoiceCount > 0) risks.push({ shipmentFileNumber: row.shipmentFileNumber, code: "APPROVED_NOT_POSTED_PLACEHOLDER", detail: "Approved invoices are not posted; posting is future PR 4." });
  }
  for (const invoice of invoices) for (const issue of issuesOf(invoice)) risks.push({ shipmentFileNumber: invoice.shipmentFileNumber ?? "MISSING_FILE_NUMBER", code: issue, detail: invoice.invoiceNumber ?? invoice.document?.fileName ?? invoice.id });
  return risks;
}
export function directoryOptionsByType(directory: Array<{ entityType: QuickBooksDirectoryEntityType }>) { return { customers: directory.filter((d) => d.entityType === QuickBooksDirectoryEntityType.CUSTOMER), vendors: directory.filter((d) => d.entityType === QuickBooksDirectoryEntityType.VENDOR), items: directory.filter((d) => d.entityType === QuickBooksDirectoryEntityType.ITEM), accounts: directory.filter((d) => d.entityType === QuickBooksDirectoryEntityType.EXPENSE_ACCOUNT), taxCodes: directory.filter((d) => d.entityType === QuickBooksDirectoryEntityType.TAX_CODE), terms: directory.filter((d) => d.entityType === QuickBooksDirectoryEntityType.TERM) }; }
