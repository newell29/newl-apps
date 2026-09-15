-- CreateEnum
CREATE TYPE "SupplyChainDesignNetworkScenarioComparisonStatus" AS ENUM ('EVALUATING', 'RATES_REQUIRED', 'RATING', 'READY_FOR_COST_EVALUATION', 'COMPLETE', 'INCOMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "SupplyChainDesignNetworkScenarioComparisonRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "SupplyChainDesignNetworkScenarioComparisonStatus" NOT NULL,
    "calculationVersion" TEXT NOT NULL,
    "comparisonFingerprint" TEXT NOT NULL,
    "transportationFingerprint" TEXT NOT NULL,
    "scenarioAName" TEXT NOT NULL,
    "scenarioBName" TEXT NOT NULL,
    "inputReferences" JSONB NOT NULL,
    "scenarioInputs" JSONB NOT NULL,
    "ratingEvidence" JSONB NOT NULL,
    "fxInput" JSONB,
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyChainDesignNetworkScenarioComparisonRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scds_nsc_run_tenant_id_key" ON "SupplyChainDesignNetworkScenarioComparisonRun"("tenantId", "id");

-- CreateIndex
CREATE INDEX "scds_nsc_run_project_created_idx" ON "SupplyChainDesignNetworkScenarioComparisonRun"("tenantId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "scds_nsc_run_status_idx" ON "SupplyChainDesignNetworkScenarioComparisonRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "scds_nsc_run_project_fp_idx" ON "SupplyChainDesignNetworkScenarioComparisonRun"("tenantId", "projectId", "comparisonFingerprint");

-- AddForeignKey
ALTER TABLE "SupplyChainDesignNetworkScenarioComparisonRun" ADD CONSTRAINT "SupplyChainDesignNetworkScenarioComparisonRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainDesignNetworkScenarioComparisonRun" ADD CONSTRAINT "SupplyChainDesignNetworkScenarioComparisonRun_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "SupplyChainDesignProject"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainDesignNetworkScenarioComparisonRun" ADD CONSTRAINT "SupplyChainDesignNetworkScenarioComparisonRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
