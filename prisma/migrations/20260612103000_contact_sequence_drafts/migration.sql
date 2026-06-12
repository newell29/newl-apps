CREATE TYPE "ContactOutreachDraftStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'EDITED', 'APPROVED', 'PUSHED_TO_APOLLO');

CREATE TYPE "ContactOutreachDraftSource" AS ENUM ('MOCK_AI', 'MANUAL', 'TEMPLATE', 'UNKNOWN');

ALTER TABLE "Contact"
  ADD COLUMN "recommendedSequenceName" TEXT,
  ADD COLUMN "recommendedSequenceId" TEXT,
  ADD COLUMN "selectedSequenceName" TEXT,
  ADD COLUMN "selectedSequenceId" TEXT,
  ADD COLUMN "sequenceRecommendationReason" TEXT,
  ADD COLUMN "sequenceOverrideReason" TEXT,
  ADD COLUMN "sequenceManuallyOverridden" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Lead_tenantId_companyId_id_key" ON "Lead"("tenantId", "companyId", "id");

CREATE INDEX "Contact_tenantId_selectedSequenceId_idx" ON "Contact"("tenantId", "selectedSequenceId");

CREATE INDEX "Contact_tenantId_sequenceManuallyOverridden_idx" ON "Contact"("tenantId", "sequenceManuallyOverridden");

CREATE TABLE "ContactOutreachDraft" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "leadId" TEXT,
  "sequenceName" TEXT NOT NULL,
  "sequenceId" TEXT,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "ContactOutreachDraftStatus" NOT NULL DEFAULT 'AVAILABLE',
  "source" "ContactOutreachDraftSource" NOT NULL DEFAULT 'UNKNOWN',
  "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
  "personalizationNotes" TEXT,
  "rawInputs" JSONB,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "editedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),

  CONSTRAINT "ContactOutreachDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactOutreachDraft_tenantId_contactId_sequenceName_key" ON "ContactOutreachDraft"("tenantId", "contactId", "sequenceName");

CREATE INDEX "ContactOutreachDraft_tenantId_companyId_idx" ON "ContactOutreachDraft"("tenantId", "companyId");

CREATE INDEX "ContactOutreachDraft_tenantId_contactId_idx" ON "ContactOutreachDraft"("tenantId", "contactId");

CREATE INDEX "ContactOutreachDraft_tenantId_status_idx" ON "ContactOutreachDraft"("tenantId", "status");

CREATE INDEX "ContactOutreachDraft_tenantId_source_idx" ON "ContactOutreachDraft"("tenantId", "source");

CREATE INDEX "ContactOutreachDraft_tenantId_sequenceId_idx" ON "ContactOutreachDraft"("tenantId", "sequenceId");

ALTER TABLE "ContactOutreachDraft" ADD CONSTRAINT "ContactOutreachDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactOutreachDraft" ADD CONSTRAINT "ContactOutreachDraft_tenantId_companyId_contactId_fkey" FOREIGN KEY ("tenantId", "companyId", "contactId") REFERENCES "Contact"("tenantId", "companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactOutreachDraft" ADD CONSTRAINT "ContactOutreachDraft_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactOutreachDraft" ADD CONSTRAINT "ContactOutreachDraft_tenantId_companyId_leadId_fkey" FOREIGN KEY ("tenantId", "companyId", "leadId") REFERENCES "Lead"("tenantId", "companyId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
