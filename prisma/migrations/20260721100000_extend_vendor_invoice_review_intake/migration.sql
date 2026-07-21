ALTER TABLE "VendorInvoiceReviewDocument"
  ADD COLUMN IF NOT EXISTS "invoiceKind" TEXT NOT NULL DEFAULT 'Vendor_Invoices',
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedByName" TEXT;

ALTER TABLE "VendorInvoiceReviewInvoice"
  ADD COLUMN IF NOT EXISTS "invoiceKind" TEXT NOT NULL DEFAULT 'Vendor_Invoices',
  ADD COLUMN IF NOT EXISTS "vendorReference" TEXT;

CREATE INDEX IF NOT EXISTS "VendorInvoiceReviewInvoice_tenantId_invoiceKind_idx"
  ON "VendorInvoiceReviewInvoice"("tenantId", "invoiceKind");
