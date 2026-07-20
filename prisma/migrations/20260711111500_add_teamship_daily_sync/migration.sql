CREATE TABLE "TeamshipDailySyncRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentDate" TIMESTAMP(3) NOT NULL,
    "triggerSource" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamshipDailySyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamshipSyncedOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "syncKey" TEXT NOT NULL,
    "shipmentDate" TIMESTAMP(3) NOT NULL,
    "srNumber" TEXT,
    "teamshipOrderId" TEXT,
    "teamshipUrl" TEXT,
    "carrier" TEXT,
    "shipToName" TEXT,
    "city" TEXT,
    "state" TEXT,
    "rawOrder" JSONB NOT NULL,
    "firstSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamshipSyncedOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeamshipDailySyncRun_tenantId_shipmentDate_idx" ON "TeamshipDailySyncRun"("tenantId", "shipmentDate");
CREATE INDEX "TeamshipDailySyncRun_tenantId_triggerSource_startedAt_idx" ON "TeamshipDailySyncRun"("tenantId", "triggerSource", "startedAt");
CREATE INDEX "TeamshipDailySyncRun_tenantId_status_idx" ON "TeamshipDailySyncRun"("tenantId", "status");
CREATE UNIQUE INDEX "TeamshipSyncedOrder_tenantId_syncKey_key" ON "TeamshipSyncedOrder"("tenantId", "syncKey");
CREATE INDEX "TeamshipSyncedOrder_tenantId_shipmentDate_idx" ON "TeamshipSyncedOrder"("tenantId", "shipmentDate");
CREATE INDEX "TeamshipSyncedOrder_tenantId_srNumber_idx" ON "TeamshipSyncedOrder"("tenantId", "srNumber");
CREATE INDEX "TeamshipSyncedOrder_tenantId_teamshipOrderId_idx" ON "TeamshipSyncedOrder"("tenantId", "teamshipOrderId");
CREATE INDEX "TeamshipSyncedOrder_tenantId_lastSyncedAt_idx" ON "TeamshipSyncedOrder"("tenantId", "lastSyncedAt");

ALTER TABLE "TeamshipDailySyncRun" ADD CONSTRAINT "TeamshipDailySyncRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamshipSyncedOrder" ADD CONSTRAINT "TeamshipSyncedOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
