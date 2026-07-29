-- CreateTable
CREATE TABLE "TeamshipPrintBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "summary" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamshipPrintBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "TeamshipPrintJob"
ADD COLUMN "batchId" TEXT,
ADD COLUMN "batchPosition" INTEGER,
ADD COLUMN "reviewOrderId" TEXT;

-- CreateIndex
CREATE INDEX "TeamshipPrintBatch_tenantId_status_createdAt_idx" ON "TeamshipPrintBatch"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamshipPrintBatch_tenantId_idempotencyKey_key" ON "TeamshipPrintBatch"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TeamshipPrintBatch_tenantId_reviewRunId_createdAt_idx" ON "TeamshipPrintBatch"("tenantId", "reviewRunId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamshipPrintBatch_tenantId_requestedByUserId_createdAt_idx" ON "TeamshipPrintBatch"("tenantId", "requestedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamshipPrintBatch_expiresAt_idx" ON "TeamshipPrintBatch"("expiresAt");

-- CreateIndex
CREATE INDEX "TeamshipPrintJob_tenantId_batchId_batchPosition_idx" ON "TeamshipPrintJob"("tenantId", "batchId", "batchPosition");

-- AddForeignKey
ALTER TABLE "TeamshipPrintBatch" ADD CONSTRAINT "TeamshipPrintBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipPrintBatch" ADD CONSTRAINT "TeamshipPrintBatch_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "TeamshipReviewRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipPrintBatch" ADD CONSTRAINT "TeamshipPrintBatch_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipPrintBatch" ADD CONSTRAINT "TeamshipPrintBatch_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipPrintJob" ADD CONSTRAINT "TeamshipPrintJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TeamshipPrintBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
