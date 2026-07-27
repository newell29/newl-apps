ALTER TYPE "ContactOutreachDraftSource" ADD VALUE 'OPENAI';

CREATE TYPE "OutreachPlanStatus" AS ENUM ('DRAFT', 'QA_FAILED', 'QA_PASSED', 'APPROVED', 'ARCHIVED');
CREATE TYPE "OutreachQaStatus" AS ENUM ('PENDING', 'FAILED', 'PASSED');
CREATE TYPE "OutreachChannel" AS ENUM ('EMAIL', 'LINKEDIN_TASK', 'CALL_TASK');

CREATE TABLE "OutreachPlan" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "OutreachPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "qaStatus" "OutreachQaStatus" NOT NULL DEFAULT 'PENDING',
  "serviceLine" "HunterServiceLine" NOT NULL,
  "opportunityType" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "triggerSummary" TEXT NOT NULL,
  "buyerHypothesis" TEXT NOT NULL,
  "valueProposition" TEXT NOT NULL,
  "likelyObjection" TEXT NOT NULL,
  "callToAction" TEXT NOT NULL,
  "channelStrategy" JSONB NOT NULL,
  "senderRecommendation" TEXT,
  "sequenceName" TEXT NOT NULL,
  "sequenceId" TEXT,
  "confidence" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "evidenceFingerprint" TEXT NOT NULL,
  "strategyModel" TEXT NOT NULL,
  "draftingModel" TEXT NOT NULL,
  "qaModel" TEXT,
  "promptVersion" TEXT NOT NULL,
  "qaIssues" JSONB,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "qaCheckedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OutreachPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachSequenceStep" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "outreachPlanId" TEXT NOT NULL,
  "stepNumber" INTEGER NOT NULL,
  "channel" "OutreachChannel" NOT NULL,
  "delayDays" INTEGER NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "angle" TEXT NOT NULL,
  "evidenceRefs" JSONB NOT NULL,
  "qaIssues" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OutreachSequenceStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachPlan_tenantId_id_key" ON "OutreachPlan"("tenantId", "id");
CREATE UNIQUE INDEX "OutreachPlan_tenantId_contactId_version_key" ON "OutreachPlan"("tenantId", "contactId", "version");
CREATE INDEX "OutreachPlan_tenantId_companyId_status_idx" ON "OutreachPlan"("tenantId", "companyId", "status");
CREATE INDEX "OutreachPlan_tenantId_contactId_createdAt_idx" ON "OutreachPlan"("tenantId", "contactId", "createdAt");
CREATE INDEX "OutreachPlan_tenantId_qaStatus_status_idx" ON "OutreachPlan"("tenantId", "qaStatus", "status");

CREATE UNIQUE INDEX "OutreachSequenceStep_tenantId_outreachPlanId_stepNumber_key"
  ON "OutreachSequenceStep"("tenantId", "outreachPlanId", "stepNumber");
CREATE INDEX "OutreachSequenceStep_tenantId_outreachPlanId_idx"
  ON "OutreachSequenceStep"("tenantId", "outreachPlanId");

ALTER TABLE "OutreachPlan"
  ADD CONSTRAINT "OutreachPlan_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutreachPlan"
  ADD CONSTRAINT "OutreachPlan_tenantId_companyId_fkey"
  FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutreachPlan"
  ADD CONSTRAINT "OutreachPlan_tenantId_companyId_contactId_fkey"
  FOREIGN KEY ("tenantId", "companyId", "contactId") REFERENCES "Contact"("tenantId", "companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutreachSequenceStep"
  ADD CONSTRAINT "OutreachSequenceStep_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutreachSequenceStep"
  ADD CONSTRAINT "OutreachSequenceStep_tenantId_outreachPlanId_fkey"
  FOREIGN KEY ("tenantId", "outreachPlanId") REFERENCES "OutreachPlan"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
