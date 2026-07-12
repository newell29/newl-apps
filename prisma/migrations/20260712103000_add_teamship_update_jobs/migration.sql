-- CreateTable
CREATE TABLE "TeamshipUpdateJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL DEFAULT 'GARLAND_TEAMSHIP_PHASE2_UPDATE',
    "documentLabel" TEXT NOT NULL,
    "shipmentDate" TIMESTAMP(3) NOT NULL,
    "sourcePdfFileName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "agentMode" TEXT NOT NULL DEFAULT 'DRY_RUN',
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "selectedSrNumbers" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "sourceReviewResponse" JSONB NOT NULL,
    "sourcePdfOrders" JSONB NOT NULL,
    "plan" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "errorMessage" TEXT,
    "agentId" TEXT,
    "agentClaimedAt" TIMESTAMP(3),
    "agentStartedAt" TIMESTAMP(3),
    "agentFinishedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "lastVerificationAt" TIMESTAMP(3),
    "verificationResponse" JSONB,
    "agentResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamshipUpdateJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamshipUpdateOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "psNumber" TEXT NOT NULL,
    "srNumber" TEXT NOT NULL,
    "teamshipOrderId" TEXT,
    "teamshipUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceReviewStatus" TEXT NOT NULL,
    "plannedFieldUpdates" JSONB NOT NULL,
    "plannedPalletRows" JSONB NOT NULL,
    "validationIssues" JSONB NOT NULL,
    "agentResult" JSONB,
    "verificationReview" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamshipUpdateOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamshipUpdateJob_tenantId_workflowKey_shipmentDate_idx" ON "TeamshipUpdateJob"("tenantId", "workflowKey", "shipmentDate");

-- CreateIndex
CREATE INDEX "TeamshipUpdateJob_tenantId_status_idx" ON "TeamshipUpdateJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TeamshipUpdateJob_tenantId_createdAt_idx" ON "TeamshipUpdateJob"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamshipUpdateJob_tenantId_searchText_idx" ON "TeamshipUpdateJob"("tenantId", "searchText");

-- CreateIndex
CREATE INDEX "TeamshipUpdateOrder_tenantId_jobId_idx" ON "TeamshipUpdateOrder"("tenantId", "jobId");

-- CreateIndex
CREATE INDEX "TeamshipUpdateOrder_tenantId_srNumber_idx" ON "TeamshipUpdateOrder"("tenantId", "srNumber");

-- CreateIndex
CREATE INDEX "TeamshipUpdateOrder_tenantId_psNumber_idx" ON "TeamshipUpdateOrder"("tenantId", "psNumber");

-- CreateIndex
CREATE INDEX "TeamshipUpdateOrder_tenantId_status_idx" ON "TeamshipUpdateOrder"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "TeamshipUpdateJob" ADD CONSTRAINT "TeamshipUpdateJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipUpdateJob" ADD CONSTRAINT "TeamshipUpdateJob_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipUpdateJob" ADD CONSTRAINT "TeamshipUpdateJob_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipUpdateOrder" ADD CONSTRAINT "TeamshipUpdateOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipUpdateOrder" ADD CONSTRAINT "TeamshipUpdateOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TeamshipUpdateJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
