-- Add candidate review state for the Ranked Candidate Feed milestone.
-- Pipeline creation remains an explicit approval action, not an ingestion side effect.
CREATE TYPE "CandidateStatus" AS ENUM (
  'NEW',
  'REVIEWING',
  'APPROVED_FOR_PIPELINE',
  'REJECTED',
  'DISQUALIFIED'
);

ALTER TABLE "Company"
  ADD COLUMN "candidateStatus" "CandidateStatus" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "candidateStatusUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "candidateStatusReason" TEXT;

CREATE INDEX "Company_tenantId_candidateStatus_idx" ON "Company"("tenantId", "candidateStatus");
CREATE INDEX "Company_tenantId_candidateStatus_priorityScore_idx" ON "Company"("tenantId", "candidateStatus", "priorityScore");
