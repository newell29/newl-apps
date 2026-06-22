CREATE TABLE "TradeMiningScoringConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recentWindowDays" INTEGER NOT NULL DEFAULT 30,
    "comparisonWindowDays" INTEGER NOT NULL DEFAULT 30,
    "lookbackWindowDays" INTEGER NOT NULL DEFAULT 90,
    "momentumWeight" INTEGER NOT NULL DEFAULT 30,
    "marketFitWeight" INTEGER NOT NULL DEFAULT 20,
    "industryFitWeight" INTEGER NOT NULL DEFAULT 15,
    "companySizeWeight" INTEGER NOT NULL DEFAULT 15,
    "roleWeight" INTEGER NOT NULL DEFAULT 10,
    "confidenceWeight" INTEGER NOT NULL DEFAULT 5,
    "workflowWeight" INTEGER NOT NULL DEFAULT 5,
    "preferredIndustryKeywords" JSONB,
    "penalizedIndustryKeywords" JSONB,
    "preferredHsCodePrefixes" JSONB,
    "penalizedHsCodePrefixes" JSONB,
    "oversizeTeuThreshold" DECIMAL(12,2),
    "oversizeShipmentCount30dThreshold" INTEGER,
    "oversizePenalty" INTEGER NOT NULL DEFAULT 10,
    "midMarketTeuMin" DECIMAL(12,2),
    "midMarketTeuMax" DECIMAL(12,2),
    "midMarketBoost" INTEGER NOT NULL DEFAULT 6,
    "aiClassificationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeMiningScoringConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradeMiningScoringConfig_tenantId_key" ON "TradeMiningScoringConfig"("tenantId");
CREATE INDEX "TradeMiningScoringConfig_tenantId_idx" ON "TradeMiningScoringConfig"("tenantId");

ALTER TABLE "TradeMiningScoringConfig" ADD CONSTRAINT "TradeMiningScoringConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
