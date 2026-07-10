CREATE TABLE "ShipmentCarrierManifestRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL DEFAULT 'GARLAND_CARRIER_MANIFEST',
    "documentLabel" TEXT NOT NULL,
    "shipmentDate" TIMESTAMP(3) NOT NULL,
    "sourceBolFileName" TEXT,
    "carrierCounts" JSONB NOT NULL,
    "manifestRows" JSONB NOT NULL,
    "midlandFileName" TEXT,
    "midlandWorkbookBytes" BYTEA,
    "speedyFileName" TEXT,
    "speedyWorkbookBytes" BYTEA,
    "suretrackFileName" TEXT,
    "suretrackWorkbookBytes" BYTEA,
    "signedCopyFileName" TEXT,
    "signedCopyContentType" TEXT,
    "signedCopyBytes" BYTEA,
    "signedCopyUploadedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentCarrierManifestRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShipmentCarrierManifestRun_tenantId_workflowKey_shipmentDate_idx" ON "ShipmentCarrierManifestRun"("tenantId", "workflowKey", "shipmentDate");
CREATE INDEX "ShipmentCarrierManifestRun_tenantId_createdAt_idx" ON "ShipmentCarrierManifestRun"("tenantId", "createdAt");
CREATE INDEX "ShipmentCarrierManifestRun_tenantId_deletedAt_idx" ON "ShipmentCarrierManifestRun"("tenantId", "deletedAt");

ALTER TABLE "ShipmentCarrierManifestRun" ADD CONSTRAINT "ShipmentCarrierManifestRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentCarrierManifestRun" ADD CONSTRAINT "ShipmentCarrierManifestRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
