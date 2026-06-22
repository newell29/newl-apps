ALTER TABLE "TradeMiningScoringConfig"
ADD COLUMN "preferredOriginCountries" JSONB,
ADD COLUMN "penalizedOriginCountries" JSONB,
ADD COLUMN "preferredOriginPorts" JSONB,
ADD COLUMN "penalizedOriginPorts" JSONB,
ADD COLUMN "preferredDestinationMarkets" JSONB,
ADD COLUMN "penalizedDestinationMarkets" JSONB;
