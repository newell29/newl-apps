-- CreateTable
CREATE TABLE "LtlBatchQuoteLane" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobRunId" TEXT NOT NULL,
    "laneIndex" INTEGER NOT NULL,
    "customerReference" TEXT NOT NULL,
    "quoteCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "requestJson" JSONB NOT NULL,
    "quotesJson" JSONB,
    "errorsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LtlBatchQuoteLane_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LtlBatchQuoteLane_jobRunId_laneIndex_key" ON "LtlBatchQuoteLane"("jobRunId", "laneIndex");

-- CreateIndex
CREATE INDEX "LtlBatchQuoteLane_tenantId_jobRunId_idx" ON "LtlBatchQuoteLane"("tenantId", "jobRunId");

-- CreateIndex
CREATE INDEX "LtlBatchQuoteLane_tenantId_createdAt_idx" ON "LtlBatchQuoteLane"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "LtlBatchQuoteLane" ADD CONSTRAINT "LtlBatchQuoteLane_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtlBatchQuoteLane" ADD CONSTRAINT "LtlBatchQuoteLane_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "AutomationJobRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
