CREATE TYPE "ContactSource" AS ENUM ('MANUAL', 'APOLLO', 'IMPORT', 'UNKNOWN');

CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'REVIEWING', 'APPROVED', 'REJECTED', 'DO_NOT_CONTACT');

CREATE TYPE "ContactTier" AS ENUM ('UNRANKED', 'TIER_1', 'TIER_2', 'TIER_3');

CREATE TYPE "ApolloStatus" AS ENUM ('NOT_STARTED', 'ENRICHED', 'NOT_FOUND', 'ERROR');

CREATE TYPE "SequenceStatus" AS ENUM ('NOT_STARTED', 'READY', 'ENROLLED', 'PAUSED', 'REPLIED', 'BOUNCED', 'FINISHED');

CREATE TYPE "ReplyStatus" AS ENUM ('NO_REPLY', 'REPLIED', 'POSITIVE', 'NEGATIVE', 'MEETING_BOOKED', 'OUT_OF_OFFICE');

ALTER TABLE "Contact"
  ADD COLUMN "department" TEXT,
  ADD COLUMN "seniority" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "source" "ContactSource" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "contactStatus" "ContactStatus" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "contactScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "contactTier" "ContactTier" NOT NULL DEFAULT 'UNRANKED',
  ADD COLUMN "apolloContactId" TEXT,
  ADD COLUMN "apolloStatus" "ApolloStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "sequenceStatus" "SequenceStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "replyStatus" "ReplyStatus" NOT NULL DEFAULT 'NO_REPLY',
  ADD COLUMN "lastTouchAt" TIMESTAMP(3),
  ADD COLUMN "lastReplyAt" TIMESTAMP(3),
  ADD COLUMN "assignedRep" TEXT,
  ADD COLUMN "rawJson" JSONB;

CREATE INDEX "Contact_tenantId_apolloContactId_idx" ON "Contact"("tenantId", "apolloContactId");

CREATE INDEX "Contact_tenantId_apolloPersonId_idx" ON "Contact"("tenantId", "apolloPersonId");

CREATE UNIQUE INDEX "Contact_tenantId_companyId_id_key" ON "Contact"("tenantId", "companyId", "id");

CREATE INDEX "Contact_tenantId_companyId_contactStatus_idx" ON "Contact"("tenantId", "companyId", "contactStatus");

CREATE INDEX "Contact_tenantId_contactStatus_idx" ON "Contact"("tenantId", "contactStatus");

CREATE INDEX "Contact_tenantId_contactScore_idx" ON "Contact"("tenantId", "contactScore");

CREATE INDEX "Contact_tenantId_contactTier_idx" ON "Contact"("tenantId", "contactTier");

CREATE INDEX "Contact_tenantId_apolloStatus_idx" ON "Contact"("tenantId", "apolloStatus");

CREATE INDEX "Contact_tenantId_sequenceStatus_idx" ON "Contact"("tenantId", "sequenceStatus");

CREATE INDEX "Contact_tenantId_replyStatus_idx" ON "Contact"("tenantId", "replyStatus");

CREATE INDEX "Contact_tenantId_source_idx" ON "Contact"("tenantId", "source");

CREATE INDEX "Contact_tenantId_assignedRep_idx" ON "Contact"("tenantId", "assignedRep");

ALTER TABLE "Lead" DROP CONSTRAINT "Lead_tenantId_contactId_fkey";

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_companyId_contactId_fkey" FOREIGN KEY ("tenantId", "companyId", "contactId") REFERENCES "Contact"("tenantId", "companyId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
