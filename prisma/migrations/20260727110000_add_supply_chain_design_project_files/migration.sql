CREATE TYPE "SupplyChainDesignUploadStatus" AS ENUM ('READY');

CREATE TABLE "SupplyChainDesignProjectFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "fileBytes" BYTEA NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "detectedHeaders" JSONB NOT NULL,
    "previewRows" JSONB NOT NULL,
    "status" "SupplyChainDesignUploadStatus" NOT NULL DEFAULT 'READY',
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyChainDesignProjectFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplyChainDesignProjectFile_tenantId_projectId_contentHash_key"
ON "SupplyChainDesignProjectFile"("tenantId", "projectId", "contentHash");

CREATE UNIQUE INDEX "SupplyChainDesignProjectFile_tenantId_id_key"
ON "SupplyChainDesignProjectFile"("tenantId", "id");

CREATE INDEX "SupplyChainDesignProjectFile_tenantId_projectId_createdAt_idx"
ON "SupplyChainDesignProjectFile"("tenantId", "projectId", "createdAt");

CREATE INDEX "SupplyChainDesignProjectFile_tenantId_status_idx"
ON "SupplyChainDesignProjectFile"("tenantId", "status");

ALTER TABLE "SupplyChainDesignProjectFile"
ADD CONSTRAINT "SupplyChainDesignProjectFile_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignProjectFile"
ADD CONSTRAINT "SupplyChainDesignProjectFile_tenantId_projectId_fkey"
FOREIGN KEY ("tenantId", "projectId") REFERENCES "SupplyChainDesignProject"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignProjectFile"
ADD CONSTRAINT "SupplyChainDesignProjectFile_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
