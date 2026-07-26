CREATE TYPE "HunterAutomationMode" AS ENUM ('OFF', 'DRY_RUN', 'ASSISTED', 'AUTOMATIC');
CREATE TYPE "HunterServiceLine" AS ENUM ('WAREHOUSING', 'OCEAN_AIR', 'TRUCKING');
CREATE TYPE "HunterSignalType" AS ENUM ('TRADEMINING', 'EXPANSION', 'FACILITY_OPENING', 'RETAIL_ROLLOUT', 'HIRING', 'LEADERSHIP_CHANGE', 'LEASE_OR_CONSTRUCTION', 'FUNDING_OR_ACQUISITION', 'NEWS', 'REFERRAL', 'MANUAL', 'OTHER');
CREATE TYPE "HunterSignalStatus" AS ENUM ('NEW', 'ACTIVE', 'DISMISSED', 'EXPIRED');
CREATE TYPE "HunterDecisionStatus" AS ENUM ('WOULD_PURSUE', 'NEEDS_RESEARCH', 'BLOCKED');
CREATE TYPE "HunterSuppressionScope" AS ENUM ('COMPANY', 'CONTACT', 'EMAIL', 'DOMAIN');

CREATE TABLE "HunterAutomationPolicy" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "mode" "HunterAutomationMode" NOT NULL DEFAULT 'DRY_RUN',
  "killSwitch" BOOLEAN NOT NULL DEFAULT false,
  "dailyCompanyLimit" INTEGER NOT NULL DEFAULT 20,
  "maxContactsPerCompany" INTEGER NOT NULL DEFAULT 2,
  "warehousingPercent" INTEGER NOT NULL DEFAULT 60,
  "oceanAirPercent" INTEGER NOT NULL DEFAULT 30,
  "truckingPercent" INTEGER NOT NULL DEFAULT 10,
  "minimumPriorityScore" INTEGER NOT NULL DEFAULT 35,
  "minimumSignalConfidence" INTEGER NOT NULL DEFAULT 50,
  "allowedJurisdictions" JSONB,
  "scheduleTimezone" TEXT NOT NULL DEFAULT 'America/Toronto',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HunterAutomationPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HunterOpportunitySignal" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT,
  "companyName" TEXT NOT NULL,
  "normalizedCompanyName" TEXT NOT NULL,
  "signalType" "HunterSignalType" NOT NULL,
  "serviceLine" "HunterServiceLine" NOT NULL,
  "status" "HunterSignalStatus" NOT NULL DEFAULT 'NEW',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "geography" TEXT,
  "sourceName" TEXT,
  "sourceUrl" TEXT,
  "sourcePublishedAt" TIMESTAMP(3),
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "confidence" INTEGER NOT NULL DEFAULT 50,
  "dedupeKey" TEXT NOT NULL,
  "evidence" JSONB,
  "rawJson" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HunterOpportunitySignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HunterProspectingDecision" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobRunId" TEXT NOT NULL,
  "companyId" TEXT,
  "companyKey" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "serviceLine" "HunterServiceLine" NOT NULL,
  "status" "HunterDecisionStatus" NOT NULL,
  "rank" INTEGER NOT NULL,
  "priorityScore" INTEGER NOT NULL,
  "confidence" INTEGER NOT NULL,
  "opportunityType" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "recommendedPersona" TEXT,
  "recommendedSender" TEXT,
  "recommendedCadence" TEXT,
  "sourceTypes" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "blockers" JSONB,
  "configSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HunterProspectingDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HunterOutreachSuppression" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT,
  "scope" "HunterSuppressionScope" NOT NULL,
  "value" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HunterOutreachSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HunterAutomationPolicy_tenantId_key" ON "HunterAutomationPolicy"("tenantId");
CREATE UNIQUE INDEX "AutomationJobRun_tenantId_id_key" ON "AutomationJobRun"("tenantId", "id");
CREATE UNIQUE INDEX "HunterOpportunitySignal_tenantId_dedupeKey_key" ON "HunterOpportunitySignal"("tenantId", "dedupeKey");
CREATE INDEX "HunterOpportunitySignal_tenantId_status_serviceLine_idx" ON "HunterOpportunitySignal"("tenantId", "status", "serviceLine");
CREATE INDEX "HunterOpportunitySignal_tenantId_normalizedCompanyName_idx" ON "HunterOpportunitySignal"("tenantId", "normalizedCompanyName");
CREATE INDEX "HunterOpportunitySignal_tenantId_observedAt_idx" ON "HunterOpportunitySignal"("tenantId", "observedAt");
CREATE UNIQUE INDEX "HunterProspectingDecision_tenantId_jobRunId_companyKey_key" ON "HunterProspectingDecision"("tenantId", "jobRunId", "companyKey");
CREATE INDEX "HunterProspectingDecision_tenantId_status_createdAt_idx" ON "HunterProspectingDecision"("tenantId", "status", "createdAt");
CREATE INDEX "HunterProspectingDecision_tenantId_serviceLine_createdAt_idx" ON "HunterProspectingDecision"("tenantId", "serviceLine", "createdAt");
CREATE INDEX "HunterProspectingDecision_tenantId_companyId_createdAt_idx" ON "HunterProspectingDecision"("tenantId", "companyId", "createdAt");
CREATE UNIQUE INDEX "HunterOutreachSuppression_tenantId_scope_value_key" ON "HunterOutreachSuppression"("tenantId", "scope", "value");
CREATE INDEX "HunterOutreachSuppression_tenantId_active_scope_idx" ON "HunterOutreachSuppression"("tenantId", "active", "scope");
CREATE INDEX "HunterOutreachSuppression_tenantId_companyId_idx" ON "HunterOutreachSuppression"("tenantId", "companyId");

ALTER TABLE "HunterAutomationPolicy" ADD CONSTRAINT "HunterAutomationPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HunterOpportunitySignal" ADD CONSTRAINT "HunterOpportunitySignal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HunterOpportunitySignal" ADD CONSTRAINT "HunterOpportunitySignal_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "HunterProspectingDecision" ADD CONSTRAINT "HunterProspectingDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HunterProspectingDecision" ADD CONSTRAINT "HunterProspectingDecision_tenantId_jobRunId_fkey" FOREIGN KEY ("tenantId", "jobRunId") REFERENCES "AutomationJobRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HunterProspectingDecision" ADD CONSTRAINT "HunterProspectingDecision_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "HunterOutreachSuppression" ADD CONSTRAINT "HunterOutreachSuppression_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HunterOutreachSuppression" ADD CONSTRAINT "HunterOutreachSuppression_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
