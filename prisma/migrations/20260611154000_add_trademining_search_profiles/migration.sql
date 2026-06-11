-- CreateTable
CREATE TABLE "TradeMiningSearchProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "destinationMarkets" JSONB NOT NULL,
    "destinationPorts" JSONB,
    "originPorts" JSONB,
    "shipFromPorts" JSONB,
    "originCountries" JSONB,
    "productKeywords" JSONB,
    "hsCodes" JSONB,
    "lookbackWindowDays" INTEGER NOT NULL DEFAULT 90,
    "minShipmentCount" INTEGER NOT NULL DEFAULT 1,
    "minShipmentVolume" DECIMAL(12,2),
    "scheduleFrequency" TEXT NOT NULL DEFAULT 'daily',
    "scheduleTimezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "scheduleMetadata" JSONB,
    "priorityWeight" INTEGER NOT NULL DEFAULT 50,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeMiningSearchProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeMiningSearchProfile_tenantId_name_key" ON "TradeMiningSearchProfile"("tenantId", "name");

-- CreateIndex
CREATE INDEX "TradeMiningSearchProfile_tenantId_enabled_idx" ON "TradeMiningSearchProfile"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "TradeMiningSearchProfile_tenantId_priorityWeight_idx" ON "TradeMiningSearchProfile"("tenantId", "priorityWeight");

-- CreateIndex
CREATE INDEX "TradeMiningSearchProfile_tenantId_scheduleFrequency_idx" ON "TradeMiningSearchProfile"("tenantId", "scheduleFrequency");

-- AddForeignKey
ALTER TABLE "TradeMiningSearchProfile" ADD CONSTRAINT "TradeMiningSearchProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
