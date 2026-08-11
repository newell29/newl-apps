ALTER TYPE "SupplyChainDesignTableType" ADD VALUE 'CANDIDATE_FACILITIES';
ALTER TYPE "SupplyChainDesignTableType" ADD VALUE 'SCENARIO_LANE_COSTS';

CREATE TYPE "SupplyChainDesignScenarioStatus" AS ENUM ('SUCCESS', 'FAILED');

CREATE TABLE "SupplyChainDesignScenario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SupplyChainDesignScenarioStatus" NOT NULL,
    "inputReferences" JSONB NOT NULL,
    "selectedFacilities" JSONB NOT NULL,
    "baselineRunId" TEXT NOT NULL,
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyChainDesignScenario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplyChainDesignScenario_tenantId_id_key" ON "SupplyChainDesignScenario"("tenantId", "id");
CREATE INDEX "SupplyChainDesignScenario_tenantId_projectId_createdAt_idx" ON "SupplyChainDesignScenario"("tenantId", "projectId", "createdAt");
CREATE INDEX "SupplyChainDesignScenario_tenantId_status_idx" ON "SupplyChainDesignScenario"("tenantId", "status");

ALTER TABLE "SupplyChainDesignScenario" ADD CONSTRAINT "SupplyChainDesignScenario_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyChainDesignScenario" ADD CONSTRAINT "SupplyChainDesignScenario_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "SupplyChainDesignProject"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyChainDesignScenario" ADD CONSTRAINT "SupplyChainDesignScenario_tenantId_baselineRunId_fkey" FOREIGN KEY ("tenantId", "baselineRunId") REFERENCES "SupplyChainDesignModelRun"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "SupplyChainDesignScenario" ADD CONSTRAINT "SupplyChainDesignScenario_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
