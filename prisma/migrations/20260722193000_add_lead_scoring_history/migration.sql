-- This migration is intentionally additive. It creates immutable scoring and
-- outcome history without changing or backfilling existing lead-generation data.
CREATE TABLE "LeadScoreSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "leadId" TEXT,
    "scoreType" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" TEXT,
    "modelVersion" TEXT NOT NULL,
    "configFingerprint" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "searchProfileId" TEXT,
    "explanation" TEXT,
    "breakdown" JSONB NOT NULL,
    "evidenceAsOf" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScoreSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadOutcomeEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "leadId" TEXT,
    "outcomeType" TEXT NOT NULL,
    "previousValue" TEXT,
    "currentValue" TEXT,
    "source" TEXT NOT NULL,
    "actorUserId" TEXT,
    "scoreSnapshotId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadOutcomeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadScoreSnapshot_tenantId_companyId_createdAt_idx" ON "LeadScoreSnapshot"("tenantId", "companyId", "createdAt");
CREATE INDEX "LeadScoreSnapshot_tenantId_contactId_createdAt_idx" ON "LeadScoreSnapshot"("tenantId", "contactId", "createdAt");
CREATE INDEX "LeadScoreSnapshot_tenantId_leadId_createdAt_idx" ON "LeadScoreSnapshot"("tenantId", "leadId", "createdAt");
CREATE INDEX "LeadScoreSnapshot_tenantId_scoreType_createdAt_idx" ON "LeadScoreSnapshot"("tenantId", "scoreType", "createdAt");
CREATE INDEX "LeadScoreSnapshot_tenantId_configFingerprint_createdAt_idx" ON "LeadScoreSnapshot"("tenantId", "configFingerprint", "createdAt");

CREATE INDEX "LeadOutcomeEvent_tenantId_companyId_occurredAt_idx" ON "LeadOutcomeEvent"("tenantId", "companyId", "occurredAt");
CREATE INDEX "LeadOutcomeEvent_tenantId_contactId_occurredAt_idx" ON "LeadOutcomeEvent"("tenantId", "contactId", "occurredAt");
CREATE INDEX "LeadOutcomeEvent_tenantId_leadId_occurredAt_idx" ON "LeadOutcomeEvent"("tenantId", "leadId", "occurredAt");
CREATE INDEX "LeadOutcomeEvent_tenantId_outcomeType_occurredAt_idx" ON "LeadOutcomeEvent"("tenantId", "outcomeType", "occurredAt");
CREATE INDEX "LeadOutcomeEvent_tenantId_scoreSnapshotId_idx" ON "LeadOutcomeEvent"("tenantId", "scoreSnapshotId");

ALTER TABLE "LeadScoreSnapshot" ADD CONSTRAINT "LeadScoreSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadScoreSnapshot" ADD CONSTRAINT "LeadScoreSnapshot_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadOutcomeEvent" ADD CONSTRAINT "LeadOutcomeEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadOutcomeEvent" ADD CONSTRAINT "LeadOutcomeEvent_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
