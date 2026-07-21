CREATE TYPE "VendorInvoiceReviewStatus" AS ENUM ('DRAFT', 'SAVED');

CREATE TABLE "VendorInvoiceReviewDocument" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "invoiceKind" TEXT NOT NULL DEFAULT 'Vendor_Invoices',
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "extractedText" TEXT,
  "pdfBytes" BYTEA NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "approvedByName" TEXT,
  "uploadedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VendorInvoiceReviewDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VendorInvoiceReviewInvoice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "invoiceKind" TEXT NOT NULL DEFAULT 'Vendor_Invoices',
  "status" "VendorInvoiceReviewStatus" NOT NULL DEFAULT 'SAVED',
  "fileName" TEXT NOT NULL,
  "vendorName" TEXT,
  "invoiceNumber" TEXT,
  "invoiceDate" TIMESTAMP(3),
  "tmsFileNumber" TEXT NOT NULL,
  "vendorReference" TEXT,
  "currency" TEXT,
  "subtotalAmount" DECIMAL(14,2),
  "taxAmount" DECIMAL(14,2),
  "totalAmount" DECIMAL(14,2),
  "duplicateKey" TEXT,
  "issueCodes" JSONB,
  "extractionJson" JSONB,
  "uploadedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VendorInvoiceReviewInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorInvoiceReviewDocument_tenantId_id_key"
  ON "VendorInvoiceReviewDocument"("tenantId", "id");

CREATE INDEX "VendorInvoiceReviewDocument_tenantId_sha256_idx"
  ON "VendorInvoiceReviewDocument"("tenantId", "sha256");

CREATE INDEX "VendorInvoiceReviewDocument_tenantId_createdAt_idx"
  ON "VendorInvoiceReviewDocument"("tenantId", "createdAt");

CREATE UNIQUE INDEX "VendorInvoiceReviewInvoice_tenantId_id_key"
  ON "VendorInvoiceReviewInvoice"("tenantId", "id");

CREATE UNIQUE INDEX "VendorInvoiceReviewInvoice_tenantId_duplicateKey_key"
  ON "VendorInvoiceReviewInvoice"("tenantId", "duplicateKey");

CREATE INDEX "VendorInvoiceReviewInvoice_tenantId_documentId_idx"
  ON "VendorInvoiceReviewInvoice"("tenantId", "documentId");

CREATE INDEX "VendorInvoiceReviewInvoice_tenantId_invoiceKind_idx"
  ON "VendorInvoiceReviewInvoice"("tenantId", "invoiceKind");

CREATE INDEX "VendorInvoiceReviewInvoice_tenantId_status_idx"
  ON "VendorInvoiceReviewInvoice"("tenantId", "status");

CREATE INDEX "VendorInvoiceReviewInvoice_tenantId_tmsFileNumber_idx"
  ON "VendorInvoiceReviewInvoice"("tenantId", "tmsFileNumber");

CREATE INDEX "VendorInvoiceReviewInvoice_tenantId_invoiceNumber_idx"
  ON "VendorInvoiceReviewInvoice"("tenantId", "invoiceNumber");

CREATE INDEX "VendorInvoiceReviewInvoice_tenantId_vendorName_idx"
  ON "VendorInvoiceReviewInvoice"("tenantId", "vendorName");

CREATE INDEX "VendorInvoiceReviewInvoice_tenantId_createdAt_idx"
  ON "VendorInvoiceReviewInvoice"("tenantId", "createdAt");

ALTER TABLE "VendorInvoiceReviewDocument"
  ADD CONSTRAINT "VendorInvoiceReviewDocument_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorInvoiceReviewInvoice"
  ADD CONSTRAINT "VendorInvoiceReviewInvoice_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorInvoiceReviewInvoice"
  ADD CONSTRAINT "VendorInvoiceReviewInvoice_tenantId_documentId_fkey"
  FOREIGN KEY ("tenantId", "documentId") REFERENCES "VendorInvoiceReviewDocument"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
