CREATE TABLE "GarlandProductDimensionObservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "observationKey" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'TEAMSHIP_PALLET',
    "sourceTeamshipOrderId" TEXT,
    "sourceSrNumber" TEXT,
    "carrier" TEXT,
    "commodity" TEXT,
    "quantity" DOUBLE PRECISION,
    "lengthIn" DOUBLE PRECISION NOT NULL,
    "widthIn" DOUBLE PRECISION NOT NULL,
    "heightIn" DOUBLE PRECISION NOT NULL,
    "weightLb" DOUBLE PRECISION NOT NULL,
    "weightUnit" TEXT DEFAULT 'lbs',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GarlandProductDimensionObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GarlandProductDimensionObservation_tenantId_observationKey_key" ON "GarlandProductDimensionObservation"("tenantId", "observationKey");
CREATE INDEX "GarlandProductDimensionObservation_tenantId_sku_idx" ON "GarlandProductDimensionObservation"("tenantId", "sku");
CREATE INDEX "GarlandProductDimensionObservation_tenantId_sourceSrNumber_idx" ON "GarlandProductDimensionObservation"("tenantId", "sourceSrNumber");
CREATE INDEX "GarlandProductDimensionObservation_tenantId_observedAt_idx" ON "GarlandProductDimensionObservation"("tenantId", "observedAt");

ALTER TABLE "GarlandProductDimensionObservation" ADD CONSTRAINT "GarlandProductDimensionObservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
