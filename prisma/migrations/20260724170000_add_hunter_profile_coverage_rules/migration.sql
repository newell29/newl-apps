ALTER TABLE "TradeMiningSearchProfile"
ADD COLUMN "industryPackIds" JSONB,
ADD COLUMN "industryFilterMode" TEXT NOT NULL DEFAULT 'PREFER',
ADD COLUMN "minAggregateTeu" DECIMAL(12,2);
