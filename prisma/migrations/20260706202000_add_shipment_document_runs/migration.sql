CREATE TABLE "ShipmentDocumentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL DEFAULT 'GARLAND_CANADA',
    "documentLabel" TEXT NOT NULL,
    "shipmentDate" TIMESTAMP(3) NOT NULL,
    "recipientEmail" TEXT,
    "sourceBolFileName" TEXT,
    "sourcePickTicketFileName" TEXT,
    "outputBolFileName" TEXT NOT NULL,
    "outputPickTicketFileName" TEXT NOT NULL,
    "bolPageCount" INTEGER NOT NULL,
    "pickTicketPageCount" INTEGER NOT NULL,
    "bolAiFallbackPageCount" INTEGER NOT NULL DEFAULT 0,
    "pickAiFallbackPageCount" INTEGER NOT NULL DEFAULT 0,
    "bolPsNumbers" JSONB NOT NULL,
    "pickPsNumbers" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "bolPdfBytes" BYTEA NOT NULL,
    "pickTicketPdfBytes" BYTEA NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentDocumentRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShipmentDocumentRun_tenantId_workflowKey_shipmentDate_idx" ON "ShipmentDocumentRun"("tenantId", "workflowKey", "shipmentDate");
CREATE INDEX "ShipmentDocumentRun_tenantId_createdAt_idx" ON "ShipmentDocumentRun"("tenantId", "createdAt");
CREATE INDEX "ShipmentDocumentRun_tenantId_searchText_idx" ON "ShipmentDocumentRun"("tenantId", "searchText");

ALTER TABLE "ShipmentDocumentRun" ADD CONSTRAINT "ShipmentDocumentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentDocumentRun" ADD CONSTRAINT "ShipmentDocumentRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
