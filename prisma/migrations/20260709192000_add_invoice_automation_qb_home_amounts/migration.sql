ALTER TABLE "InvoiceAutomationInvoice"
  ADD COLUMN "quickBooksExchangeRate" DECIMAL(18, 8),
  ADD COLUMN "quickBooksHomeCurrency" TEXT,
  ADD COLUMN "quickBooksSubtotalHomeAmount" DECIMAL(14, 2),
  ADD COLUMN "quickBooksTaxHomeAmount" DECIMAL(14, 2),
  ADD COLUMN "quickBooksTotalHomeAmount" DECIMAL(14, 2),
  ADD COLUMN "quickBooksFxSource" TEXT,
  ADD COLUMN "quickBooksFxCapturedAt" TIMESTAMP(3);
