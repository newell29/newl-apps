CREATE TYPE "SupplyChainDesignModelRunStatus" AS ENUM ('SUCCESS', 'FAILED');

CREATE TABLE "SupplyChainDesignModelRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "SupplyChainDesignModelRunStatus" NOT NULL,
    "inputReferences" JSONB NOT NULL,
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyChainDesignModelRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplyChainDesignModelRun_tenantId_id_key"
ON "SupplyChainDesignModelRun"("tenantId", "id");

CREATE INDEX "SupplyChainDesignModelRun_tenantId_projectId_createdAt_idx"
ON "SupplyChainDesignModelRun"("tenantId", "projectId", "createdAt");

CREATE INDEX "SupplyChainDesignModelRun_tenantId_status_idx"
ON "SupplyChainDesignModelRun"("tenantId", "status");

ALTER TABLE "SupplyChainDesignModelRun"
ADD CONSTRAINT "SupplyChainDesignModelRun_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignModelRun"
ADD CONSTRAINT "SupplyChainDesignModelRun_tenantId_projectId_fkey"
FOREIGN KEY ("tenantId", "projectId") REFERENCES "SupplyChainDesignProject"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplyChainDesignModelRun"
ADD CONSTRAINT "SupplyChainDesignModelRun_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
