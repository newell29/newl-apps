ALTER TABLE "LtlBatchQuoteLane" ADD COLUMN "selectedQuoteJson" JSONB;
ALTER TABLE "LtlBatchQuoteLane" ADD COLUMN "selectedRateSource" TEXT;
ALTER TABLE "LtlBatchQuoteLane" ADD COLUMN "manualRateJson" JSONB;
ALTER TABLE "LtlBatchQuoteLane" ADD COLUMN "exclusionJson" JSONB;
