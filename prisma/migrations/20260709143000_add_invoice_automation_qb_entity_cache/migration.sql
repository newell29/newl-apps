CREATE TABLE "InvoiceAutomationQuickBooksEntity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "entityType" "InvoiceAutomationType" NOT NULL,
  "quickBooksId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "currency" TEXT,
  "legalEntity" TEXT,
  "realmId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "rawJson" JSONB,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoiceAutomationQuickBooksEntity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceAutomationQuickBooksEntity_tenantId_entityType_realmId_quickBooksId_key"
  ON "InvoiceAutomationQuickBooksEntity"("tenantId", "entityType", "realmId", "quickBooksId");

CREATE INDEX "InvoiceAutomationQuickBooksEntity_tenantId_entityType_normalizedName_idx"
  ON "InvoiceAutomationQuickBooksEntity"("tenantId", "entityType", "normalizedName");

CREATE INDEX "InvoiceAutomationQuickBooksEntity_tenantId_entityType_currency_idx"
  ON "InvoiceAutomationQuickBooksEntity"("tenantId", "entityType", "currency");

CREATE INDEX "InvoiceAutomationQuickBooksEntity_tenantId_realmId_idx"
  ON "InvoiceAutomationQuickBooksEntity"("tenantId", "realmId");

CREATE INDEX "InvoiceAutomationQuickBooksEntity_tenantId_active_idx"
  ON "InvoiceAutomationQuickBooksEntity"("tenantId", "active");

ALTER TABLE "InvoiceAutomationQuickBooksEntity"
  ADD CONSTRAINT "InvoiceAutomationQuickBooksEntity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
