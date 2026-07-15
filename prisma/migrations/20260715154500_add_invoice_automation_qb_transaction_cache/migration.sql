-- Store QuickBooks transaction read-backs observed by invoice automation.
-- These rows support reconciliation without live-querying QuickBooks on page load.
CREATE TABLE "InvoiceAutomationQuickBooksTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceAutomationInvoiceId" TEXT,
    "realmId" TEXT NOT NULL,
    "invoiceType" "InvoiceAutomationType" NOT NULL,
    "quickBooksTxnId" TEXT NOT NULL,
    "quickBooksTxnNumber" TEXT,
    "shipmentFileNumber" TEXT,
    "shipmentType" TEXT,
    "entityName" TEXT,
    "quickBooksEntityId" TEXT,
    "currency" TEXT,
    "transactionDate" TIMESTAMP(3),
    "subtotalAmount" DECIMAL(14,2),
    "taxAmount" DECIMAL(14,2),
    "totalAmount" DECIMAL(14,2),
    "quickBooksExchangeRate" DECIMAL(18,8),
    "quickBooksHomeCurrency" TEXT,
    "quickBooksSubtotalHomeAmount" DECIMAL(14,2),
    "quickBooksTaxHomeAmount" DECIMAL(14,2),
    "quickBooksTotalHomeAmount" DECIMAL(14,2),
    "source" TEXT NOT NULL DEFAULT 'POSTED_TRANSACTION_READBACK',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceAutomationQuickBooksTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "iaqbt_tenant_realm_type_txn_key"
    ON "InvoiceAutomationQuickBooksTransaction"("tenantId", "realmId", "invoiceType", "quickBooksTxnId");

CREATE INDEX "iaqbt_tenant_file_idx"
    ON "InvoiceAutomationQuickBooksTransaction"("tenantId", "shipmentFileNumber");

CREATE INDEX "iaqbt_tenant_invoice_idx"
    ON "InvoiceAutomationQuickBooksTransaction"("tenantId", "invoiceAutomationInvoiceId");

CREATE INDEX "iaqbt_tenant_type_idx"
    ON "InvoiceAutomationQuickBooksTransaction"("tenantId", "invoiceType");

CREATE INDEX "iaqbt_tenant_observed_idx"
    ON "InvoiceAutomationQuickBooksTransaction"("tenantId", "observedAt");

ALTER TABLE "InvoiceAutomationQuickBooksTransaction"
    ADD CONSTRAINT "iaqbt_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
