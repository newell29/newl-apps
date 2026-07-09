CREATE TABLE "InvoiceAutomationEntityAlias" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "invoiceType" "InvoiceAutomationType" NOT NULL,
  "aliasRawName" TEXT NOT NULL,
  "normalizedAlias" TEXT NOT NULL,
  "quickBooksEntityId" TEXT NOT NULL,
  "quickBooksEntityDisplayName" TEXT NOT NULL,
  "currency" TEXT,
  "createdByUserId" TEXT,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usageCount" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoiceAutomationEntityAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceAutomationEntityAlias_tenantId_invoiceType_normalizedAlias_key"
  ON "InvoiceAutomationEntityAlias"("tenantId", "invoiceType", "normalizedAlias");

CREATE INDEX "InvoiceAutomationEntityAlias_tenantId_invoiceType_idx"
  ON "InvoiceAutomationEntityAlias"("tenantId", "invoiceType");

CREATE INDEX "InvoiceAutomationEntityAlias_tenantId_quickBooksEntityId_idx"
  ON "InvoiceAutomationEntityAlias"("tenantId", "quickBooksEntityId");

CREATE INDEX "InvoiceAutomationEntityAlias_tenantId_lastUsedAt_idx"
  ON "InvoiceAutomationEntityAlias"("tenantId", "lastUsedAt");

ALTER TABLE "InvoiceAutomationEntityAlias"
  ADD CONSTRAINT "InvoiceAutomationEntityAlias_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
