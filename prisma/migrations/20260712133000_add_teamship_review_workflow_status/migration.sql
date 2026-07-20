ALTER TABLE "TeamshipReviewOrder"
ADD COLUMN "workflowStatus" TEXT NOT NULL DEFAULT 'NEEDS_SETUP',
ADD COLUMN "bolPrintedAt" TIMESTAMP(3),
ADD COLUMN "bolPrintedByUserId" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "TeamshipReviewOrder_tenantId_workflowStatus_idx" ON "TeamshipReviewOrder"("tenantId", "workflowStatus");
