CREATE TABLE "InvoiceAutomationCorrectionMemory" (
  "id" TEXT NOT NULL,
  "memoryKey" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "invoiceType" "InvoiceAutomationType" NOT NULL,
  "fieldName" TEXT NOT NULL,
  "normalizedEntityName" TEXT,
  "quickBooksEntityId" TEXT,
  "quickBooksEntityDisplayName" TEXT,
  "shipmentPrefix" TEXT,
  "currency" TEXT,
  "learnedValue" TEXT NOT NULL,
  "sourceValue" TEXT,
  "createdByUserId" TEXT,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usageCount" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvoiceAutomationCorrectionMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceAutomationCorrectionMemory_memoryKey_key"
  ON "InvoiceAutomationCorrectionMemory"("memoryKey");

CREATE INDEX "InvoiceAutomationCorrectionMemory_tenantId_invoiceType_idx"
  ON "InvoiceAutomationCorrectionMemory"("tenantId", "invoiceType");

CREATE INDEX "InvoiceAutomationCorrectionMemory_tenantId_fieldName_idx"
  ON "InvoiceAutomationCorrectionMemory"("tenantId", "fieldName");

CREATE INDEX "InvoiceAutomationCorrectionMemory_tenantId_quickBooksEntityId_idx"
  ON "InvoiceAutomationCorrectionMemory"("tenantId", "quickBooksEntityId");

CREATE INDEX "InvoiceAutomationCorrectionMemory_tenantId_normalizedEntityName_idx"
  ON "InvoiceAutomationCorrectionMemory"("tenantId", "normalizedEntityName");

CREATE INDEX "InvoiceAutomationCorrectionMemory_tenantId_lastUsedAt_idx"
  ON "InvoiceAutomationCorrectionMemory"("tenantId", "lastUsedAt");

ALTER TABLE "InvoiceAutomationCorrectionMemory"
  ADD CONSTRAINT "InvoiceAutomationCorrectionMemory_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
