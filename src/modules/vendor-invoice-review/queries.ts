import type { Prisma } from "@prisma/client";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { prisma } from "@/server/db";
import type {
  VendorInvoiceReviewPackageDetail,
  VendorInvoiceReviewPackageSummary,
  VendorInvoiceReviewKind,
  VendorInvoiceReviewSavedInvoice
} from "@/modules/vendor-invoice-review/types";

export async function getVendorInvoiceReviewPackages(
  context: Pick<AuthenticatedContext, "tenantId">,
  options: { take?: number; invoiceKind?: VendorInvoiceReviewKind } = {}
): Promise<VendorInvoiceReviewPackageSummary[]> {
  const documents = await prisma.vendorInvoiceReviewDocument.findMany({
    where: { tenantId: context.tenantId, ...(options.invoiceKind ? { invoiceKind: options.invoiceKind } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 25,
    select: {
      id: true,
      invoiceKind: true,
      fileName: true,
      uploadedByUserId: true,
      approvedAt: true,
      approvedByName: true,
      financeStatus: true,
      financeError: true,
      financeBatchId: true,
      createdAt: true,
      invoices: {
        orderBy: { createdAt: "asc" },
        select: savedInvoiceSelect
      }
    }
  });

  const usersById = await getUsersById(
    documents.map((document) => document.uploadedByUserId).filter((id): id is string => Boolean(id))
  );

  return documents.map((document) => toPackageSummary(document, usersById));
}

export async function getVendorInvoiceReviewPackageDetail(
  context: Pick<AuthenticatedContext, "tenantId">,
  documentId: string
): Promise<VendorInvoiceReviewPackageDetail | null> {
  const document = await prisma.vendorInvoiceReviewDocument.findFirst({
    where: { tenantId: context.tenantId, id: documentId },
    select: {
      id: true,
      invoiceKind: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      extractedText: true,
      uploadedByUserId: true,
      approvedAt: true,
      approvedByName: true,
      financeStatus: true,
      financeError: true,
      financeBatchId: true,
      createdAt: true,
      invoices: {
        orderBy: { createdAt: "asc" },
        select: savedInvoiceSelect
      }
    }
  });

  if (!document) {
    return null;
  }

  const usersById = await getUsersById(document.uploadedByUserId ? [document.uploadedByUserId] : []);
  return {
    ...toPackageSummary(document, usersById),
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    extractedText: document.extractedText
  };
}

export async function getVendorInvoiceReviewPdf(
  context: Pick<AuthenticatedContext, "tenantId">,
  documentId: string
) {
  return prisma.vendorInvoiceReviewDocument.findFirst({
    where: { tenantId: context.tenantId, id: documentId },
    select: {
      fileName: true,
      contentType: true,
      invoiceKind: true,
      approvedAt: true,
      pdfBytes: true
    }
  });
}

const savedInvoiceSelect = {
  id: true,
  documentId: true,
  invoiceKind: true,
  status: true,
  fileName: true,
  vendorName: true,
  invoiceNumber: true,
  invoiceDate: true,
  tmsFileNumber: true,
  vendorReference: true,
  currency: true,
  subtotalAmount: true,
  taxAmount: true,
  totalAmount: true,
  issueCodes: true,
  financeInvoiceId: true,
  createdAt: true
} satisfies Prisma.VendorInvoiceReviewInvoiceSelect;

type SavedInvoiceRow = Prisma.VendorInvoiceReviewInvoiceGetPayload<{ select: typeof savedInvoiceSelect }>;

async function getUsersById(userIds: string[]) {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) {
    return new Map<string, { name: string | null; email: string | null }>();
  }

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, name: true, email: true }
  });

  return new Map(users.map((user) => [user.id, { name: user.name, email: user.email }]));
}

function toPackageSummary(
  document: {
    id: string;
    invoiceKind: string;
    fileName: string;
    uploadedByUserId: string | null;
    approvedAt: Date | null;
    approvedByName: string | null;
    financeStatus: string;
    financeError: string | null;
    financeBatchId: string | null;
    createdAt: Date;
    invoices: SavedInvoiceRow[];
  },
  usersById: Map<string, { name: string | null; email: string | null }>
): VendorInvoiceReviewPackageSummary {
  const uploadedBy = document.uploadedByUserId ? usersById.get(document.uploadedByUserId) ?? null : null;
  return {
    id: document.id,
    invoiceKind: readInvoiceKind(document.invoiceKind),
    fileName: document.fileName,
    createdAt: document.createdAt.toISOString(),
    uploadedByUserId: document.uploadedByUserId,
    uploadedByName: uploadedBy?.name ?? null,
    uploadedByEmail: uploadedBy?.email ?? null,
    approvedAt: document.approvedAt?.toISOString() ?? null,
    approvedByName: document.approvedByName,
    financeStatus: document.financeStatus,
    financeError: document.financeError,
    financeBatchId: document.financeBatchId,
    invoiceCount: document.invoices.length,
    status: summarizeStatus(document.invoices),
    invoices: document.invoices.map(toSavedInvoice)
  };
}

function summarizeStatus(invoices: SavedInvoiceRow[]) {
  const statuses = Array.from(new Set(invoices.map((invoice) => invoice.status)));
  if (statuses.length === 0) {
    return "SAVED";
  }
  return statuses.length === 1 ? statuses[0] : statuses.join(", ");
}

function toSavedInvoice(invoice: SavedInvoiceRow): VendorInvoiceReviewSavedInvoice {
  return {
    id: invoice.id,
    documentId: invoice.documentId,
    invoiceKind: readInvoiceKind(invoice.invoiceKind),
    fileName: invoice.fileName,
    vendorName: invoice.vendorName,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
    tmsFileNumber: invoice.tmsFileNumber,
    vendorReference: invoice.vendorReference,
    currency: invoice.currency,
    subtotalAmount: decimalToNumber(invoice.subtotalAmount),
    taxAmount: decimalToNumber(invoice.taxAmount),
    totalAmount: decimalToNumber(invoice.totalAmount),
    issueCodes: readIssueCodes(invoice.issueCodes),
    financeInvoiceId: invoice.financeInvoiceId,
    createdAt: invoice.createdAt.toISOString()
  };
}

function readInvoiceKind(value: string): VendorInvoiceReviewKind {
  return value === "Customer_Invoices" ? "Customer_Invoices" : "Vendor_Invoices";
}

function decimalToNumber(value: { toString(): string } | number | null) {
  return value === null ? null : Number(value.toString());
}

function readIssueCodes(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((issue): issue is string => typeof issue === "string") : [];
}
