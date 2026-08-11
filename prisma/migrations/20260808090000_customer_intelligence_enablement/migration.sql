-- Customer Intelligence live-sync enablement (CP-PHASE-02B-8)
--
-- Owner decision CP-02B-8-Q1 (`FEATURE_ENABLEMENT_RECORD`): live QuickBooks
-- synchronization must have a separate tenant-scoped and operating-company-
-- scoped enablement record. It defaults to disabled and requires explicit
-- owner approval recorded for audit; connecting a QuickBooks company never
-- auto-enables live synchronization.
--
-- This migration is purely additive: it creates one table plus its
-- tenant-scoped foreign keys and indexes, and a CHECK constraint that makes an
-- enabled row without recorded approval evidence impossible. No data is
-- written; every operating company is default-off until an ADMIN records an
-- approval through the guarded enablement action.

-- CreateTable
CREATE TABLE "CustomerIntelligenceEnablement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operatingCompanyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerIntelligenceEnablement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerIntelligenceEnablement_tenantId_id_key" ON "CustomerIntelligenceEnablement"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerIntelligenceEnablement_tenantId_operatingCompanyId_key" ON "CustomerIntelligenceEnablement"("tenantId", "operatingCompanyId");

-- CreateIndex
CREATE INDEX "CustomerIntelligenceEnablement_tenantId_enabled_idx" ON "CustomerIntelligenceEnablement"("tenantId", "enabled");

-- AddForeignKey
ALTER TABLE "CustomerIntelligenceEnablement" ADD CONSTRAINT "CustomerIntelligenceEnablement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerIntelligenceEnablement" ADD CONSTRAINT "CustomerIntelligenceEnablement_tenantId_operatingCompanyId_fkey" FOREIGN KEY ("tenantId", "operatingCompanyId") REFERENCES "OperatingCompany"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An enabled live-sync record always carries explicit owner approval evidence.
ALTER TABLE "CustomerIntelligenceEnablement"
ADD CONSTRAINT "CustomerIntelligenceEnablement_enabled_requires_approval"
CHECK ("enabled" = false OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL));
