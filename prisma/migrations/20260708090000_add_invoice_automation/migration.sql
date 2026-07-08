-- CreateEnum
CREATE TYPE "AccountingInvoiceType" AS ENUM ('CUSTOMER_INVOICE', 'VENDOR_INVOICE');

-- CreateEnum
CREATE TYPE "AccountingInvoiceStatus" AS ENUM ('NEEDS_REVIEW', 'READY_FOR_APPROVAL', 'APPROVED', 'REJECTED', 'VOID');

-- CreateEnum
CREATE TYPE "AccountingPostingStatus" AS ENUM ('NOT_READY', 'READY_TO_POST', 'BATCHED', 'POSTED', 'ERROR');

-- CreateEnum
CREATE TYPE "AccountingInvoiceBatchStatus" AS ENUM ('UPLOAD_REVIEW', 'DRAFT', 'APPROVED', 'CANCELLED', 'POSTED_PLACEHOLDER');

-- CreateEnum
CREATE TYPE "QuickBooksDirectoryEntityType" AS ENUM ('CUSTOMER', 'VENDOR', 'ITEM', 'EXPENSE_ACCOUNT', 'TAX_CODE', 'TERM');

-- CreateEnum
CREATE TYPE "AccountingStorageBackend" AS ENUM ('POSTGRES_BYTES', 'EXTERNAL_REF');

-- CreateTable
CREATE TABLE "AccountingDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageBackend" "AccountingStorageBackend" NOT NULL DEFAULT 'POSTGRES_BYTES',
    "storageKey" TEXT,
    "storageRef" TEXT,
    "pdfBytes" BYTEA,
    "searchText" TEXT NOT NULL DEFAULT '',
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingInvoiceBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "status" "AccountingInvoiceBatchStatus" NOT NULL DEFAULT 'UPLOAD_REVIEW',
    "source" TEXT NOT NULL DEFAULT 'INVOICE_UPLOAD',
    "notes" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingInvoiceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingInvoiceStaging" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "batchId" TEXT,
    "invoiceType" "AccountingInvoiceType",
    "status" "AccountingInvoiceStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "postingStatus" "AccountingPostingStatus" NOT NULL DEFAULT 'NOT_READY',
    "legalEntity" "CashflowLegalEntity",
    "shipmentFileNumber" TEXT,
    "shipmentType" TEXT,
    "serviceType" TEXT,
    "businessLine" "CashflowBusinessLine",
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "rawEntityName" TEXT,
    "normalizedEntityName" TEXT,
    "qbEntityId" TEXT,
    "qbEntityType" "QuickBooksDirectoryEntityType",
    "qbEntityDisplayName" TEXT,
    "qbItemId" TEXT,
    "qbItemName" TEXT,
    "qbExpenseAccountId" TEXT,
    "qbExpenseAccountName" TEXT,
    "qbTaxCodeId" TEXT,
    "qbTaxCodeName" TEXT,
    "qbTermId" TEXT,
    "qbTermName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "subtotal" DECIMAL(14,2),
    "tax" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "taxApplicable" BOOLEAN,
    "productServiceName" TEXT,
    "productServiceId" TEXT,
    "expenseAccountName" TEXT,
    "expenseAccountId" TEXT,
    "exchangeRateToCad" DECIMAL(14,6),
    "fxOverrideReason" TEXT,
    "extractionConfidence" DECIMAL(6,4),
    "extractionJson" JSONB,
    "issues" JSONB,
    "reviewNotes" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "qbPostingId" TEXT,
    "qbPostingError" TEXT,
    "qbPostingResult" JSONB,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingInvoiceStaging_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksDirectoryEntity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalEntity" "CashflowLegalEntity",
    "entityType" "QuickBooksDirectoryEntityType" NOT NULL,
    "quickBooksId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "currency" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "parentName" TEXT,
    "accountType" TEXT,
    "fullyQualifiedName" TEXT,
    "aliases" JSONB,
    "rawJson" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksDirectoryEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingServiceMappingRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalEntity" "CashflowLegalEntity",
    "invoiceType" "AccountingInvoiceType",
    "servicePrefix" TEXT NOT NULL,
    "rawEntityName" TEXT,
    "normalizedEntityName" TEXT,
    "businessLine" "CashflowBusinessLine" NOT NULL,
    "customerItemName" TEXT,
    "customerItemId" TEXT,
    "vendorAccountName" TEXT,
    "vendorAccountId" TEXT,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingServiceMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksPostingBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountingBatchId" TEXT,
    "status" "AccountingInvoiceBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "futurePostStartedAt" TIMESTAMP(3),
    "futurePostCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksPostingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksPostingBatchItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postingBatchId" TEXT NOT NULL,
    "invoiceStagingId" TEXT NOT NULL,
    "futureActionType" TEXT NOT NULL,
    "status" "AccountingPostingStatus" NOT NULL DEFAULT 'NOT_READY',
    "qbTransactionId" TEXT,
    "qbError" TEXT,
    "qbResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksPostingBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingDocument_tenantId_createdAt_idx" ON "AccountingDocument"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountingDocument_tenantId_searchText_idx" ON "AccountingDocument"("tenantId", "searchText");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingDocument_tenantId_id_key" ON "AccountingDocument"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingDocument_tenantId_sha256_key" ON "AccountingDocument"("tenantId", "sha256");

-- CreateIndex
CREATE INDEX "AccountingInvoiceBatch_tenantId_status_createdAt_idx" ON "AccountingInvoiceBatch"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingInvoiceBatch_tenantId_id_key" ON "AccountingInvoiceBatch"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingInvoiceBatch_tenantId_batchNumber_key" ON "AccountingInvoiceBatch"("tenantId", "batchNumber");

-- CreateIndex
CREATE INDEX "AccountingInvoiceStaging_tenantId_status_createdAt_idx" ON "AccountingInvoiceStaging"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AccountingInvoiceStaging_tenantId_postingStatus_idx" ON "AccountingInvoiceStaging"("tenantId", "postingStatus");

-- CreateIndex
CREATE INDEX "AccountingInvoiceStaging_tenantId_shipmentFileNumber_idx" ON "AccountingInvoiceStaging"("tenantId", "shipmentFileNumber");

-- CreateIndex
CREATE INDEX "AccountingInvoiceStaging_tenantId_invoiceNumber_idx" ON "AccountingInvoiceStaging"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "AccountingInvoiceStaging_tenantId_normalizedEntityName_idx" ON "AccountingInvoiceStaging"("tenantId", "normalizedEntityName");

-- CreateIndex
CREATE INDEX "AccountingInvoiceStaging_tenantId_qbEntityId_idx" ON "AccountingInvoiceStaging"("tenantId", "qbEntityId");

-- CreateIndex
CREATE INDEX "AccountingInvoiceStaging_tenantId_currency_idx" ON "AccountingInvoiceStaging"("tenantId", "currency");

-- CreateIndex
CREATE INDEX "AccountingInvoiceStaging_tenantId_searchText_idx" ON "AccountingInvoiceStaging"("tenantId", "searchText");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingInvoiceStaging_tenantId_id_key" ON "AccountingInvoiceStaging"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingInvoiceStaging_tenantId_invoiceType_qbEntityId_in_key" ON "AccountingInvoiceStaging"("tenantId", "invoiceType", "qbEntityId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "QuickBooksDirectoryEntity_tenantId_entityType_normalizedNam_idx" ON "QuickBooksDirectoryEntity"("tenantId", "entityType", "normalizedName");

-- CreateIndex
CREATE INDEX "QuickBooksDirectoryEntity_tenantId_legalEntity_entityType_c_idx" ON "QuickBooksDirectoryEntity"("tenantId", "legalEntity", "entityType", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksDirectoryEntity_tenantId_legalEntity_entityType_q_key" ON "QuickBooksDirectoryEntity"("tenantId", "legalEntity", "entityType", "quickBooksId");

-- CreateIndex
CREATE INDEX "AccountingServiceMappingRule_tenantId_servicePrefix_active_idx" ON "AccountingServiceMappingRule"("tenantId", "servicePrefix", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingServiceMappingRule_tenantId_legalEntity_invoiceTy_key" ON "AccountingServiceMappingRule"("tenantId", "legalEntity", "invoiceType", "servicePrefix", "normalizedEntityName");

-- CreateIndex
CREATE INDEX "QuickBooksPostingBatch_tenantId_status_createdAt_idx" ON "QuickBooksPostingBatch"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksPostingBatch_tenantId_id_key" ON "QuickBooksPostingBatch"("tenantId", "id");

-- CreateIndex
CREATE INDEX "QuickBooksPostingBatchItem_tenantId_status_idx" ON "QuickBooksPostingBatchItem"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksPostingBatchItem_tenantId_postingBatchId_invoiceS_key" ON "QuickBooksPostingBatchItem"("tenantId", "postingBatchId", "invoiceStagingId");

-- AddForeignKey
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingInvoiceBatch" ADD CONSTRAINT "AccountingInvoiceBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingInvoiceStaging" ADD CONSTRAINT "AccountingInvoiceStaging_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingInvoiceStaging" ADD CONSTRAINT "AccountingInvoiceStaging_tenantId_documentId_fkey" FOREIGN KEY ("tenantId", "documentId") REFERENCES "AccountingDocument"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingInvoiceStaging" ADD CONSTRAINT "AccountingInvoiceStaging_tenantId_batchId_fkey" FOREIGN KEY ("tenantId", "batchId") REFERENCES "AccountingInvoiceBatch"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingInvoiceStaging" ADD CONSTRAINT "AccountingInvoiceStaging_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksDirectoryEntity" ADD CONSTRAINT "QuickBooksDirectoryEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingServiceMappingRule" ADD CONSTRAINT "AccountingServiceMappingRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksPostingBatch" ADD CONSTRAINT "QuickBooksPostingBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksPostingBatchItem" ADD CONSTRAINT "QuickBooksPostingBatchItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksPostingBatchItem" ADD CONSTRAINT "QuickBooksPostingBatchItem_tenantId_postingBatchId_fkey" FOREIGN KEY ("tenantId", "postingBatchId") REFERENCES "QuickBooksPostingBatch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksPostingBatchItem" ADD CONSTRAINT "QuickBooksPostingBatchItem_tenantId_invoiceStagingId_fkey" FOREIGN KEY ("tenantId", "invoiceStagingId") REFERENCES "AccountingInvoiceStaging"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

