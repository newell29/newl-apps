CREATE TYPE "InvoiceAutomationType" AS ENUM ('CUSTOMER', 'VENDOR');
CREATE TYPE "InvoiceAutomationStatus" AS ENUM ('OPERATIONS_REVIEW', 'ACCOUNTING_REVIEW', 'APPROVED_FOR_POSTING', 'POSTED', 'POSTING_ERROR', 'REJECTED');
CREATE TYPE "InvoiceAutomationBatchStatus" AS ENUM ('OPERATIONS_REVIEW', 'ACCOUNTING_REVIEW', 'COMPLETED');

CREATE TABLE "InvoiceAutomationDocument" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "extractedText" TEXT,
  "pdfBytes" BYTEA NOT NULL,
  "uploadedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceAutomationDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceAutomationBatch" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL,
  "invoiceType" "InvoiceAutomationType" NOT NULL,
  "status" "InvoiceAutomationBatchStatus" NOT NULL DEFAULT 'OPERATIONS_REVIEW',
  "uploadedByUserId" TEXT,
  "sentToAccountingById" TEXT,
  "sentToAccountingAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceAutomationBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceAutomationInvoice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "invoiceType" "InvoiceAutomationType" NOT NULL,
  "status" "InvoiceAutomationStatus" NOT NULL DEFAULT 'OPERATIONS_REVIEW',
  "fileName" TEXT NOT NULL,
  "shipmentFileNumber" TEXT,
  "shipmentType" TEXT,
  "businessLine" "CashflowBusinessLine" NOT NULL DEFAULT 'OTHER',
  "entityNameRaw" TEXT,
  "quickBooksEntityId" TEXT,
  "quickBooksEntityDisplayName" TEXT,
  "quickBooksMatchConfidence" INTEGER,
  "invoiceNumber" TEXT,
  "invoiceDate" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "currency" TEXT,
  "subtotalAmount" DECIMAL(14,2),
  "taxAmount" DECIMAL(14,2),
  "totalAmount" DECIMAL(14,2),
  "productOrAccountName" TEXT,
  "issueCodes" JSONB,
  "extractionJson" JSONB,
  "reviewNotes" TEXT,
  "uploadedByUserId" TEXT,
  "sentToAccountingById" TEXT,
  "sentToAccountingAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "quickBooksTxnId" TEXT,
  "quickBooksTxnNumber" TEXT,
  "quickBooksPostingError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceAutomationInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceAutomationDocument_tenantId_id_key" ON "InvoiceAutomationDocument"("tenantId", "id");
CREATE UNIQUE INDEX "InvoiceAutomationDocument_tenantId_sha256_key" ON "InvoiceAutomationDocument"("tenantId", "sha256");
CREATE INDEX "InvoiceAutomationDocument_tenantId_createdAt_idx" ON "InvoiceAutomationDocument"("tenantId", "createdAt");
CREATE UNIQUE INDEX "InvoiceAutomationBatch_tenantId_id_key" ON "InvoiceAutomationBatch"("tenantId", "id");
CREATE UNIQUE INDEX "InvoiceAutomationBatch_tenantId_batchNumber_key" ON "InvoiceAutomationBatch"("tenantId", "batchNumber");
CREATE INDEX "InvoiceAutomationBatch_tenantId_invoiceType_createdAt_idx" ON "InvoiceAutomationBatch"("tenantId", "invoiceType", "createdAt");
CREATE INDEX "InvoiceAutomationBatch_tenantId_status_idx" ON "InvoiceAutomationBatch"("tenantId", "status");
CREATE UNIQUE INDEX "InvoiceAutomationInvoice_tenantId_id_key" ON "InvoiceAutomationInvoice"("tenantId", "id");
CREATE INDEX "InvoiceAutomationInvoice_tenantId_invoiceType_status_idx" ON "InvoiceAutomationInvoice"("tenantId", "invoiceType", "status");
CREATE INDEX "InvoiceAutomationInvoice_tenantId_batchId_idx" ON "InvoiceAutomationInvoice"("tenantId", "batchId");
CREATE INDEX "InvoiceAutomationInvoice_tenantId_documentId_idx" ON "InvoiceAutomationInvoice"("tenantId", "documentId");
CREATE INDEX "InvoiceAutomationInvoice_tenantId_shipmentFileNumber_idx" ON "InvoiceAutomationInvoice"("tenantId", "shipmentFileNumber");
CREATE INDEX "InvoiceAutomationInvoice_tenantId_invoiceNumber_idx" ON "InvoiceAutomationInvoice"("tenantId", "invoiceNumber");
CREATE INDEX "InvoiceAutomationInvoice_tenantId_entityNameRaw_idx" ON "InvoiceAutomationInvoice"("tenantId", "entityNameRaw");
CREATE INDEX "InvoiceAutomationInvoice_tenantId_createdAt_idx" ON "InvoiceAutomationInvoice"("tenantId", "createdAt");

ALTER TABLE "InvoiceAutomationDocument" ADD CONSTRAINT "InvoiceAutomationDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceAutomationBatch" ADD CONSTRAINT "InvoiceAutomationBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceAutomationInvoice" ADD CONSTRAINT "InvoiceAutomationInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceAutomationInvoice" ADD CONSTRAINT "InvoiceAutomationInvoice_tenantId_batchId_fkey" FOREIGN KEY ("tenantId", "batchId") REFERENCES "InvoiceAutomationBatch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceAutomationInvoice" ADD CONSTRAINT "InvoiceAutomationInvoice_tenantId_documentId_fkey" FOREIGN KEY ("tenantId", "documentId") REFERENCES "InvoiceAutomationDocument"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
