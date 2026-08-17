-- Add table types used by the first 3PL location-screening vertical slice.
ALTER TYPE "SupplyChainDesignTableType" ADD VALUE IF NOT EXISTS 'DEMAND_POINTS';
ALTER TYPE "SupplyChainDesignTableType" ADD VALUE IF NOT EXISTS 'LOGISTICS_MARKETS';
ALTER TYPE "SupplyChainDesignTableType" ADD VALUE IF NOT EXISTS 'CANADA_PROVINCE_MARKET_MAP';
ALTER TYPE "SupplyChainDesignTableType" ADD VALUE IF NOT EXISTS 'STUDY_CONTROL';

-- Keep screening runs separate from Model 01 runs and Model 02 scenarios.
CREATE TABLE "SupplyChainDesignScreeningRun" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "status" "SupplyChainDesignModelRunStatus" NOT NULL,
  "inputReferences" JSONB NOT NULL,
  "resultSummary" JSONB,
  "errorMessage" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplyChainDesignScreeningRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplyChainDesignScreeningRun_tenantId_id_key" ON "SupplyChainDesignScreeningRun"("tenantId", "id");
CREATE INDEX "SupplyChainDesignScreeningRun_tenantId_projectId_createdAt_idx" ON "SupplyChainDesignScreeningRun"("tenantId", "projectId", "createdAt");
CREATE INDEX "SupplyChainDesignScreeningRun_tenantId_status_idx" ON "SupplyChainDesignScreeningRun"("tenantId", "status");

ALTER TABLE "SupplyChainDesignScreeningRun"
  ADD CONSTRAINT "SupplyChainDesignScreeningRun_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignScreeningRun"
  ADD CONSTRAINT "SupplyChainDesignScreeningRun_tenantId_projectId_fkey"
  FOREIGN KEY ("tenantId", "projectId") REFERENCES "SupplyChainDesignProject"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignScreeningRun"
  ADD CONSTRAINT "SupplyChainDesignScreeningRun_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
