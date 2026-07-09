import type {
  CashflowBusinessLine,
  InvoiceAutomationStatus,
  InvoiceAutomationType
} from "@prisma/client";

export type InvoiceAutomationEntityOption = {
  id: string;
  displayName: string;
  normalizedName: string;
  currency: string | null;
  entityType: InvoiceAutomationType;
};

export type InvoiceAutomationUploadDraft = {
  clientId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  pdfBase64: string;
  extractedText: string;
  shipmentFileNumber: string | null;
  shipmentType: string | null;
  businessLine: CashflowBusinessLine;
  entityNameRaw: string | null;
  quickBooksEntityId: string | null;
  quickBooksEntityDisplayName: string | null;
  quickBooksMatchConfidence: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  productOrAccountName: string | null;
  issueCodes: string[];
};

export type InvoiceAutomationRow = {
  id: string;
  batchNumber: string;
  invoiceType: InvoiceAutomationType;
  status: InvoiceAutomationStatus;
  fileName: string;
  shipmentFileNumber: string | null;
  shipmentType: string | null;
  entityNameRaw: string | null;
  quickBooksEntityDisplayName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  productOrAccountName: string | null;
  issueCodes: string[];
  createdAt: string;
  sentToAccountingAt: string | null;
};

export type InvoiceAutomationUploadResponse = {
  batchId: string;
  batchNumber: string;
  invoiceCount: number;
  invoices: InvoiceAutomationRow[];
};

export type InvoiceAutomationOcrInvoice = {
  extractedText: string;
  shipmentFileNumber: string | null;
  entityName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  taxApplicable: boolean | null;
  confidence: string;
  notes: string | null;
};

export type InvoiceAutomationOcrResult = {
  model: string;
  invoices: InvoiceAutomationOcrInvoice[];
};
