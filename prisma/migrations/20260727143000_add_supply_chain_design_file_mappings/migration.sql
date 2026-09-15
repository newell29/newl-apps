CREATE TYPE "SupplyChainDesignTableType" AS ENUM ('FACILITIES', 'SHIPMENTS', 'INVENTORY');

CREATE TYPE "SupplyChainDesignMappingFieldRequirement" AS ENUM ('REQUIRED', 'OPTIONAL');

CREATE TYPE "SupplyChainDesignMappingStatus" AS ENUM ('DRAFT');

CREATE TABLE "SupplyChainDesignFileMapping" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "tableType" "SupplyChainDesignTableType" NOT NULL,
    "fieldMappings" JSONB NOT NULL,
    "status" "SupplyChainDesignMappingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyChainDesignFileMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplyChainDesignFileMapping_tenantId_fileId_key"
ON "SupplyChainDesignFileMapping"("tenantId", "fileId");

CREATE UNIQUE INDEX "SupplyChainDesignFileMapping_tenantId_id_key"
ON "SupplyChainDesignFileMapping"("tenantId", "id");

CREATE INDEX "SupplyChainDesignFileMapping_tenantId_projectId_idx"
ON "SupplyChainDesignFileMapping"("tenantId", "projectId");

CREATE INDEX "SupplyChainDesignFileMapping_tenantId_tableType_idx"
ON "SupplyChainDesignFileMapping"("tenantId", "tableType");

CREATE INDEX "SupplyChainDesignFileMapping_tenantId_status_idx"
ON "SupplyChainDesignFileMapping"("tenantId", "status");

ALTER TABLE "SupplyChainDesignFileMapping"
ADD CONSTRAINT "SupplyChainDesignFileMapping_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignFileMapping"
ADD CONSTRAINT "SupplyChainDesignFileMapping_tenantId_projectId_fkey"
FOREIGN KEY ("tenantId", "projectId") REFERENCES "SupplyChainDesignProject"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignFileMapping"
ADD CONSTRAINT "SupplyChainDesignFileMapping_tenantId_fileId_fkey"
FOREIGN KEY ("tenantId", "fileId") REFERENCES "SupplyChainDesignProjectFile"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignFileMapping"
ADD CONSTRAINT "SupplyChainDesignFileMapping_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
