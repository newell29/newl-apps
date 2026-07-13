ALTER TABLE "TeamshipReviewOrder"
ADD COLUMN "orderCompletedAt" TIMESTAMP(3),
ADD COLUMN "orderCompletedByUserId" TEXT;

CREATE INDEX "TeamshipReviewOrder_tenantId_orderCompletedAt_idx" ON "TeamshipReviewOrder"("tenantId", "orderCompletedAt");
