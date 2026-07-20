ALTER TABLE "ShipmentDocumentRun"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedByUserId" TEXT;

CREATE INDEX "ShipmentDocumentRun_tenantId_deletedAt_idx" ON "ShipmentDocumentRun"("tenantId", "deletedAt");
