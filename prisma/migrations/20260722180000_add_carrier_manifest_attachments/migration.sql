CREATE TABLE "ShipmentCarrierManifestAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER NOT NULL,
    "fileBytes" BYTEA NOT NULL,
    "uploadComplete" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentCarrierManifestAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShipmentCarrierManifestAttachment_tenantId_runId_createdAt_idx"
ON "ShipmentCarrierManifestAttachment"("tenantId", "runId", "createdAt");

ALTER TABLE "ShipmentCarrierManifestAttachment"
ADD CONSTRAINT "ShipmentCarrierManifestAttachment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShipmentCarrierManifestAttachment"
ADD CONSTRAINT "ShipmentCarrierManifestAttachment_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "ShipmentCarrierManifestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShipmentCarrierManifestAttachment"
ADD CONSTRAINT "ShipmentCarrierManifestAttachment_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
