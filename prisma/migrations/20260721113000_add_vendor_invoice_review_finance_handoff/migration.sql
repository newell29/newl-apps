ALTER TABLE "VendorInvoiceReviewDocument"
  ADD COLUMN IF NOT EXISTS "financeStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "financeError" TEXT,
  ADD COLUMN IF NOT EXISTS "financeBatchId" TEXT;

ALTER TABLE "VendorInvoiceReviewInvoice"
  ADD COLUMN IF NOT EXISTS "financeInvoiceId" TEXT;

CREATE INDEX IF NOT EXISTS "VendorInvoiceReviewDocument_tenantId_financeStatus_idx"
  ON "VendorInvoiceReviewDocument"("tenantId", "financeStatus");
