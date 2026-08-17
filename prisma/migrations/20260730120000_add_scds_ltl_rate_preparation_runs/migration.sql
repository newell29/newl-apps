-- CreateTable
CREATE TABLE "SupplyChainDesignLtlRatePreparationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "SupplyChainDesignModelRunStatus" NOT NULL,
    "inputReferences" JSONB NOT NULL,
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyChainDesignLtlRatePreparationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplyChainDesignLtlRatePreparationRun_tenantId_id_key" ON "SupplyChainDesignLtlRatePreparationRun"("tenantId", "id");

-- CreateIndex
CREATE INDEX "SupplyChainDesignLtlRatePreparationRun_tenantId_projectId_createdAt_idx" ON "SupplyChainDesignLtlRatePreparationRun"("tenantId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplyChainDesignLtlRatePreparationRun_tenantId_status_idx" ON "SupplyChainDesignLtlRatePreparationRun"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "SupplyChainDesignLtlRatePreparationRun" ADD CONSTRAINT "SupplyChainDesignLtlRatePreparationRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainDesignLtlRatePreparationRun" ADD CONSTRAINT "SupplyChainDesignLtlRatePreparationRun_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "SupplyChainDesignProject"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyChainDesignLtlRatePreparationRun" ADD CONSTRAINT "SupplyChainDesignLtlRatePreparationRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
