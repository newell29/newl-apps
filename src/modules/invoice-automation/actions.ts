/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

import { createHash } from "node:crypto";
import { AccountingInvoiceBatchStatus, AccountingInvoiceStatus, AccountingInvoiceType, AccountingPostingStatus, AccountingStorageBackend, ModuleKey, PlatformRole, Prisma, QuickBooksDirectoryEntityType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { parseInvoiceReviewFormData, parseManualQuickBooksDirectoryFormData } from "./form-data";
import { buildInvoiceSearchText, defaultServiceMapping, extractInvoiceFileNumber, inferInvoiceNumber, getServicePrefix, inferShipmentType } from "./parsing";
import { approvalIssues } from "./validation";

const PATH = "/finance/invoice-automation";
const WRITE_ROLES = [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE];

async function requireFinanceWrite() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
  await requireMutationAccess(context);
  requireRole(context, WRITE_ROLES);
  return context;
}

function jsonIssues(value: string[]) { return value as Prisma.InputJsonValue; }
function str(value: FormDataEntryValue | null) { const text = String(value ?? "").trim(); return text || null; }

export async function uploadInvoicePdfsAction(formData: FormData) {
  const context = await requireFinanceWrite();
  const files = formData.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
  if (!files.length) throw new Error("Select at least one PDF invoice.");
  const batch = await prisma.accountingInvoiceBatch.create({ data: { tenantId: context.tenantId, batchNumber: `INV-${Date.now()}`, createdByUserId: context.userId, status: AccountingInvoiceBatchStatus.UPLOAD_REVIEW } });
  for (const file of files) {
    if (file.type && file.type !== "application/pdf") throw new Error(`${file.name} must be a PDF.`);
    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileNumber = extractInvoiceFileNumber(file.name);
    const prefix = getServicePrefix(fileNumber);
    const invoiceType = (str(formData.get("invoiceType")) as AccountingInvoiceType | null) ?? AccountingInvoiceType.CUSTOMER_INVOICE;
    const mapping = defaultServiceMapping(invoiceType, prefix);
    const issues = [!fileNumber ? "MISSING_FILE_NUMBER" : null, mapping.issue].filter(Boolean) as string[];
    const document = await prisma.accountingDocument.upsert({
      where: { tenantId_sha256: { tenantId: context.tenantId, sha256 } },
      update: { searchText: buildInvoiceSearchText({ fileName: file.name, fileNumber }) },
      create: { tenantId: context.tenantId, fileName: file.name, contentType: "application/pdf", sizeBytes: bytes.length, sha256, storageBackend: AccountingStorageBackend.POSTGRES_BYTES, pdfBytes: bytes, searchText: buildInvoiceSearchText({ fileName: file.name, fileNumber }), uploadedByUserId: context.userId }
    });
    await prisma.accountingInvoiceStaging.create({ data: { tenantId: context.tenantId, documentId: document.id, batchId: batch.id, invoiceType, legalEntity: "NEWL_WORLDWIDE", shipmentFileNumber: fileNumber, shipmentType: inferShipmentType(fileNumber), serviceType: prefix, businessLine: mapping.businessLine, invoiceNumber: inferInvoiceNumber(file.name), currency: "CAD", productServiceName: mapping.itemName, expenseAccountName: mapping.accountName, issues: jsonIssues(issues), searchText: buildInvoiceSearchText({ fileName: file.name, fileNumber, invoiceNumber: inferInvoiceNumber(file.name) }) } });
  }
  await prisma.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, action: "invoice_automation.upload_batch_created", entityType: "AccountingInvoiceBatch", entityId: batch.id, after: { fileCount: files.length } } });
  revalidatePath(PATH);
}

export async function saveInvoiceReviewAction(formData: FormData) {
  const context = await requireFinanceWrite();
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.accountingInvoiceStaging.findFirst({ where: { id, tenantId: context.tenantId } });
  if (!existing) throw new Error("Invoice not found.");
  const qbEntityId = str(formData.get("qbEntityId"));
  const qbEntity = qbEntityId ? await prisma.quickBooksDirectoryEntity.findFirst({ where: { tenantId: context.tenantId, quickBooksId: qbEntityId } }) : null;
  const data = parseInvoiceReviewFormData(formData, qbEntity);
  await prisma.accountingInvoiceStaging.update({ where: { id }, data: { ...data, searchText: buildInvoiceSearchText(data) } });
  await prisma.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, action: "invoice_automation.invoice_field_edited", entityType: "AccountingInvoiceStaging", entityId: id, before: existing as any, after: data as any } });
  revalidatePath(PATH);
}

export async function approveInvoiceAction(formData: FormData) {
  const context = await requireFinanceWrite();
  const id = String(formData.get("id") ?? "");
  const invoice = await prisma.accountingInvoiceStaging.findFirst({ where: { id, tenantId: context.tenantId } });
  if (!invoice) throw new Error("Invoice not found.");
  const directoryAvailable = (await prisma.quickBooksDirectoryEntity.count({ where: { tenantId: context.tenantId, entityType: invoice.invoiceType === AccountingInvoiceType.VENDOR_INVOICE ? QuickBooksDirectoryEntityType.VENDOR : QuickBooksDirectoryEntityType.CUSTOMER } })) > 0;
  const issues = approvalIssues(invoice as any, directoryAvailable);
  if (issues.length) { await prisma.accountingInvoiceStaging.update({ where: { id }, data: { issues: jsonIssues(issues), status: AccountingInvoiceStatus.NEEDS_REVIEW, postingStatus: AccountingPostingStatus.NOT_READY } }); throw new Error(`Invoice cannot be approved: ${issues.join(", ")}`); }
  await prisma.accountingInvoiceStaging.update({ where: { id }, data: { status: AccountingInvoiceStatus.APPROVED, postingStatus: directoryAvailable ? AccountingPostingStatus.READY_TO_POST : AccountingPostingStatus.NOT_READY, approvedByUserId: context.userId, approvedAt: new Date(), issues: [] } });
  await prisma.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, action: "invoice_automation.invoice_approved", entityType: "AccountingInvoiceStaging", entityId: id } });
  revalidatePath(PATH);
}

export async function rejectInvoiceAction(formData: FormData) { const context = await requireFinanceWrite(); const id = String(formData.get("id") ?? ""); await prisma.accountingInvoiceStaging.updateMany({ where: { id, tenantId: context.tenantId }, data: { status: AccountingInvoiceStatus.REJECTED, postingStatus: AccountingPostingStatus.NOT_READY } }); await prisma.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, action: "invoice_automation.invoice_rejected", entityType: "AccountingInvoiceStaging", entityId: id } }); revalidatePath(PATH); }
export async function returnInvoiceToReviewAction(formData: FormData) { const context = await requireFinanceWrite(); const id = String(formData.get("id") ?? ""); await prisma.accountingInvoiceStaging.updateMany({ where: { id, tenantId: context.tenantId }, data: { status: AccountingInvoiceStatus.NEEDS_REVIEW, approvedAt: null, approvedByUserId: null, postingStatus: AccountingPostingStatus.NOT_READY } }); await prisma.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, action: "invoice_automation.invoice_unapproved", entityType: "AccountingInvoiceStaging", entityId: id } }); revalidatePath(PATH); }
export async function createApprovedBatchAction(formData: FormData) { const context = await requireFinanceWrite(); const ids = formData.getAll("invoiceIds").map(String); const batch = await prisma.accountingInvoiceBatch.create({ data: { tenantId: context.tenantId, batchNumber: `BATCH-${Date.now()}`, status: AccountingInvoiceBatchStatus.DRAFT, source: "APPROVED_BATCH", createdByUserId: context.userId } }); await prisma.accountingInvoiceStaging.updateMany({ where: { tenantId: context.tenantId, id: { in: ids }, status: AccountingInvoiceStatus.APPROVED }, data: { batchId: batch.id, postingStatus: AccountingPostingStatus.BATCHED } }); await prisma.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, action: "invoice_automation.batch_created", entityType: "AccountingInvoiceBatch", entityId: batch.id, after: { invoiceIds: ids } } }); revalidatePath(PATH); }
export async function saveMappingRuleAction(formData: FormData) { const context = await requireFinanceWrite(); const servicePrefix = String(formData.get("servicePrefix") ?? "").toUpperCase().trim(); if (!servicePrefix) throw new Error("Service prefix is required."); await prisma.accountingServiceMappingRule.create({ data: { tenantId: context.tenantId, servicePrefix, invoiceType: str(formData.get("invoiceType")) as any, businessLine: str(formData.get("businessLine")) as any, customerItemName: str(formData.get("customerItemName")), vendorAccountName: str(formData.get("vendorAccountName")), requiresReview: formData.get("requiresReview") === "on", notes: str(formData.get("notes")) } }); await prisma.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, action: "invoice_automation.mapping_rule_changed", entityType: "AccountingServiceMappingRule" } }); revalidatePath(PATH); }

export async function createManualQuickBooksDirectoryEntityAction(formData: FormData) { const context = await requireFinanceWrite(); const data = parseManualQuickBooksDirectoryFormData(formData); const entity = await prisma.quickBooksDirectoryEntity.upsert({ where: { tenantId_legalEntity_entityType_quickBooksId: { tenantId: context.tenantId, legalEntity: data.legalEntity, entityType: data.entityType, quickBooksId: data.quickBooksId } }, update: { displayName: data.displayName, normalizedName: data.normalizedName, currency: data.currency, active: data.active }, create: { tenantId: context.tenantId, ...data } }); await prisma.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, action: "invoice_automation.quickbooks_directory_manual_upsert", entityType: "QuickBooksDirectoryEntity", entityId: entity.id, after: data as any } }); revalidatePath(PATH); }
export async function removeInvoiceFromBatchAction(formData: FormData) { const context = await requireFinanceWrite(); const id = String(formData.get("id") ?? ""); const invoice = await prisma.accountingInvoiceStaging.findFirst({ where: { id, tenantId: context.tenantId }, select: { id: true, batchId: true, postingStatus: true } }); if (!invoice?.batchId) throw new Error("Invoice is not assigned to a batch."); const batch = await prisma.accountingInvoiceBatch.findFirst({ where: { id: invoice.batchId, tenantId: context.tenantId } }); if (!batch || batch.status === AccountingInvoiceBatchStatus.POSTED_PLACEHOLDER) throw new Error("Only non-posted local batches can be edited."); await prisma.accountingInvoiceStaging.update({ where: { id }, data: { batchId: null, postingStatus: AccountingPostingStatus.READY_TO_POST } }); await prisma.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, action: "invoice_automation.invoice_removed_from_batch", entityType: "AccountingInvoiceStaging", entityId: id, before: { batchId: invoice.batchId }, after: { batchId: null } } }); revalidatePath(PATH); }
