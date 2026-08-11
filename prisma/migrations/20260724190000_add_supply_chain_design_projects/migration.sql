ALTER TYPE "ModuleKey" ADD VALUE IF NOT EXISTS 'SUPPLY_CHAIN_DESIGN';

CREATE TYPE "SupplyChainDesignProjectStatus" AS ENUM ('DRAFT');

CREATE TABLE "SupplyChainDesignProject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SupplyChainDesignProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyChainDesignProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplyChainDesignProject_tenantId_id_key" ON "SupplyChainDesignProject"("tenantId", "id");
CREATE INDEX "SupplyChainDesignProject_tenantId_createdAt_idx" ON "SupplyChainDesignProject"("tenantId", "createdAt");
CREATE INDEX "SupplyChainDesignProject_tenantId_status_idx" ON "SupplyChainDesignProject"("tenantId", "status");

ALTER TABLE "SupplyChainDesignProject"
ADD CONSTRAINT "SupplyChainDesignProject_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignProject"
ADD CONSTRAINT "SupplyChainDesignProject_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
