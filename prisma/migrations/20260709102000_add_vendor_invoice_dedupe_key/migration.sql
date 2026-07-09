ALTER TABLE "InvoiceAutomationInvoice" ADD COLUMN "vendorInvoiceDuplicateKey" TEXT;

CREATE UNIQUE INDEX "InvoiceAutomationInvoice_tenantId_invoiceType_vendorInvoiceDuplicateKey_key"
  ON "InvoiceAutomationInvoice"("tenantId", "invoiceType", "vendorInvoiceDuplicateKey");
