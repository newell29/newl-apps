export type VendorInvoiceReviewKind = "Vendor_Invoices" | "Customer_Invoices";

export type VendorInvoiceReviewDraft = {
  clientId: string;
  documentClientId: string;
  invoiceKind: VendorInvoiceReviewKind;
  fileName: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  tmsFileNumber: string | null;
  confirmedTmsFileNumber: string | null;
  vendorReference: string | null;
  currency: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  issueCodes: string[];
  duplicateWarning: string | null;
};

export type VendorInvoiceReviewDocumentUpload = {
  clientDocumentId: string;
  invoiceKind: VendorInvoiceReviewKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  pdfBase64: string;
  extractedText: string | null;
};

export type VendorInvoiceReviewSavedInvoice = {
  id: string;
  documentId: string;
  invoiceKind: VendorInvoiceReviewKind;
  fileName: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  tmsFileNumber: string;
  vendorReference: string | null;
  currency: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  issueCodes: string[];
  financeInvoiceId: string | null;
  createdAt: string;
};

export type VendorInvoiceReviewUploadResponse = {
  documentId: string;
  invoiceKind: VendorInvoiceReviewKind;
  financeStatus: string;
  financeError: string | null;
  financeBatchId: string | null;
  invoiceCount: number;
  invoices: VendorInvoiceReviewSavedInvoice[];
};

export type VendorInvoiceReviewPackageSummary = {
  id: string;
  invoiceKind: VendorInvoiceReviewKind;
  fileName: string;
  createdAt: string;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  uploadedByEmail: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  financeStatus: string;
  financeError: string | null;
  financeBatchId: string | null;
  invoiceCount: number;
  status: string;
  invoices: VendorInvoiceReviewSavedInvoice[];
};

export type VendorInvoiceReviewPackageDetail = VendorInvoiceReviewPackageSummary & {
  contentType: string;
  sizeBytes: number;
  extractedText: string | null;
};
