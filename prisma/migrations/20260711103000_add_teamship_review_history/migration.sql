ALTER TYPE "IntegrationProvider" ADD VALUE 'TEAMSHIP';

CREATE TABLE "TeamshipReviewRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL DEFAULT 'GARLAND_TEAMSHIP_REVIEW',
    "documentLabel" TEXT NOT NULL,
    "shipmentDate" TIMESTAMP(3) NOT NULL,
    "sourcePdfFileName" TEXT,
    "pdfOrderCount" INTEGER NOT NULL,
    "teamshipMatchedCount" INTEGER NOT NULL,
    "passedCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "missingTeamshipCount" INTEGER NOT NULL,
    "pendingTeamshipCount" INTEGER NOT NULL,
    "alertDigestOrderCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL,
    "extractedOrders" JSONB NOT NULL,
    "reviewResponse" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamshipReviewRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamshipReviewOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "psNumber" TEXT NOT NULL,
    "srNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "teamshipOrderId" TEXT,
    "teamshipUrl" TEXT,
    "carrier" TEXT,
    "shipToName" TEXT,
    "city" TEXT,
    "state" TEXT,
    "shipToPo" TEXT,
    "pageNumbers" JSONB NOT NULL,
    "pdfOrder" JSONB NOT NULL,
    "review" JSONB NOT NULL,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamshipReviewOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeamshipReviewRun_tenantId_workflowKey_shipmentDate_idx" ON "TeamshipReviewRun"("tenantId", "workflowKey", "shipmentDate");
CREATE INDEX "TeamshipReviewRun_tenantId_createdAt_idx" ON "TeamshipReviewRun"("tenantId", "createdAt");
CREATE INDEX "TeamshipReviewRun_tenantId_deletedAt_idx" ON "TeamshipReviewRun"("tenantId", "deletedAt");
CREATE INDEX "TeamshipReviewOrder_tenantId_runId_idx" ON "TeamshipReviewOrder"("tenantId", "runId");
CREATE INDEX "TeamshipReviewOrder_tenantId_srNumber_idx" ON "TeamshipReviewOrder"("tenantId", "srNumber");
CREATE INDEX "TeamshipReviewOrder_tenantId_psNumber_idx" ON "TeamshipReviewOrder"("tenantId", "psNumber");
CREATE INDEX "TeamshipReviewOrder_tenantId_status_idx" ON "TeamshipReviewOrder"("tenantId", "status");

ALTER TABLE "TeamshipReviewRun" ADD CONSTRAINT "TeamshipReviewRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamshipReviewRun" ADD CONSTRAINT "TeamshipReviewRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "TeamshipReviewOrder" ADD CONSTRAINT "TeamshipReviewOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamshipReviewOrder" ADD CONSTRAINT "TeamshipReviewOrder_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TeamshipReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
