ALTER TABLE "SupplyChainDesignProject"
ADD COLUMN "analysisCurrency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "cadToUsdRate" DECIMAL(12, 6);
