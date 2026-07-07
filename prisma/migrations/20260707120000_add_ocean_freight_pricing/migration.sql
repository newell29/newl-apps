ALTER TYPE "ModuleKey" ADD VALUE 'OCEAN_FREIGHT_PRICING';

CREATE TYPE "OceanRateSourceType" AS ENUM ('EMAIL_BODY', 'ATTACHMENT', 'MANUAL_ENTRY', 'AGENT_PORTAL');
CREATE TYPE "OceanRateStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'INACTIVE', 'SUPERSEDED');
CREATE TYPE "OceanExtractionStatus" AS ENUM ('NEW', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'ERROR');
CREATE TYPE "OceanEquipmentType" AS ENUM ('TWENTY_FT', 'FORTY_FT', 'FORTY_HQ', 'FORTY_FIVE_HQ', 'LCL', 'OTHER');

CREATE TABLE "OceanFreightAgent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "website" TEXT,
  "primaryEmailDomain" TEXT,
  "countriesServed" JSONB,
  "portsServed" JSONB,
  "lanesServed" JSONB,
  "internalRating" INTEGER,
  "reliabilityNotes" TEXT,
  "serviceNotes" TEXT,
  "internalNotes" TEXT,
  "lastRateReceivedAt" TIMESTAMP(3),
  "activeRateCount" INTEGER NOT NULL DEFAULT 0,
  "historicalRateCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OceanFreightAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OceanFreightAgentContact" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "title" TEXT,
  "sourceEmailAddress" TEXT,
  "lastObservedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OceanFreightAgentContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OceanFreightSourceEmail" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "mailboxAddress" TEXT NOT NULL,
  "graphMessageId" TEXT NOT NULL,
  "internetMessageId" TEXT,
  "conversationId" TEXT,
  "subject" TEXT NOT NULL,
  "fromName" TEXT,
  "fromAddress" TEXT,
  "toRecipients" JSONB,
  "ccRecipients" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "webLink" TEXT,
  "bodyPreview" TEXT,
  "normalizedBodyText" TEXT,
  "bodyContentHash" TEXT,
  "rateDetected" BOOLEAN NOT NULL DEFAULT false,
  "detectionReason" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OceanFreightSourceEmail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OceanFreightSourceAttachment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceEmailId" TEXT NOT NULL,
  "graphAttachmentId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT,
  "sizeBytes" INTEGER,
  "contentHash" TEXT,
  "storageRef" TEXT,
  "extractedText" TEXT,
  "extractedRowsJson" JSONB,
  "parseStatus" TEXT,
  "parseError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OceanFreightSourceAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OceanFreightRateCandidate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceType" "OceanRateSourceType" NOT NULL,
  "sourceEmailId" TEXT,
  "sourceAttachmentId" TEXT,
  "agentId" TEXT,
  "agentContactId" TEXT,
  "status" "OceanExtractionStatus" NOT NULL DEFAULT 'NEW',
  "originPort" TEXT,
  "originCountry" TEXT,
  "originRegion" TEXT,
  "destinationPort" TEXT,
  "destinationCountry" TEXT,
  "destinationRegion" TEXT,
  "equipmentType" "OceanEquipmentType",
  "equipmentLabelRaw" TEXT,
  "rateAmount" DECIMAL(12,2),
  "currency" TEXT,
  "agentCompanyNameRaw" TEXT,
  "agentContactNameRaw" TEXT,
  "agentContactEmailRaw" TEXT,
  "shippingLine" TEXT,
  "validityStartDate" TIMESTAMP(3),
  "validityEndDate" TIMESTAMP(3),
  "freeTimeNotes" TEXT,
  "detentionDemurrageNotes" TEXT,
  "transitTimeDays" INTEGER,
  "transitTimeNotes" TEXT,
  "scheduleNotes" TEXT,
  "notes" TEXT,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "extractionModel" TEXT,
  "extractionPromptVersion" TEXT,
  "rawExtractionJson" JSONB,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "rejectionReason" TEXT,
  "approvedRateId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OceanFreightRateCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OceanFreightRate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "agentContactId" TEXT,
  "sourceType" "OceanRateSourceType" NOT NULL DEFAULT 'MANUAL_ENTRY',
  "sourceEmailId" TEXT,
  "sourceAttachmentId" TEXT,
  "sourceCandidateId" TEXT,
  "originPort" TEXT NOT NULL,
  "originCountry" TEXT,
  "originRegion" TEXT,
  "destinationPort" TEXT NOT NULL,
  "destinationCountry" TEXT,
  "destinationRegion" TEXT,
  "equipmentType" "OceanEquipmentType" NOT NULL,
  "equipmentLabel" TEXT NOT NULL,
  "rateAmount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "shippingLine" TEXT,
  "validityStartDate" TIMESTAMP(3),
  "validityEndDate" TIMESTAMP(3),
  "status" "OceanRateStatus" NOT NULL DEFAULT 'ACTIVE',
  "freeTimeNotes" TEXT,
  "detentionDemurrageNotes" TEXT,
  "transitTimeDays" INTEGER,
  "transitTimeNotes" TEXT,
  "scheduleNotes" TEXT,
  "notes" TEXT,
  "correctionNotes" TEXT,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "inactiveAt" TIMESTAMP(3),
  "inactiveByUserId" TEXT,
  "inactiveReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OceanFreightRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OceanFreightAgent_tenantId_normalizedName_key" ON "OceanFreightAgent"("tenantId", "normalizedName");
CREATE UNIQUE INDEX "OceanFreightAgent_tenantId_id_key" ON "OceanFreightAgent"("tenantId", "id");
CREATE INDEX "OceanFreightAgent_tenantId_internalRating_idx" ON "OceanFreightAgent"("tenantId", "internalRating");
CREATE INDEX "OceanFreightAgent_tenantId_lastRateReceivedAt_idx" ON "OceanFreightAgent"("tenantId", "lastRateReceivedAt");
CREATE UNIQUE INDEX "OceanFreightAgentContact_tenantId_agentId_email_key" ON "OceanFreightAgentContact"("tenantId", "agentId", "email");
CREATE UNIQUE INDEX "OceanFreightAgentContact_tenantId_id_key" ON "OceanFreightAgentContact"("tenantId", "id");
CREATE INDEX "OceanFreightAgentContact_tenantId_email_idx" ON "OceanFreightAgentContact"("tenantId", "email");
CREATE INDEX "OceanFreightAgentContact_tenantId_agentId_idx" ON "OceanFreightAgentContact"("tenantId", "agentId");
CREATE UNIQUE INDEX "OceanFreightSourceEmail_tenantId_mailboxAddress_graphMessageId_key" ON "OceanFreightSourceEmail"("tenantId", "mailboxAddress", "graphMessageId");
CREATE UNIQUE INDEX "OceanFreightSourceEmail_tenantId_id_key" ON "OceanFreightSourceEmail"("tenantId", "id");
CREATE INDEX "OceanFreightSourceEmail_tenantId_receivedAt_idx" ON "OceanFreightSourceEmail"("tenantId", "receivedAt");
CREATE INDEX "OceanFreightSourceEmail_tenantId_fromAddress_idx" ON "OceanFreightSourceEmail"("tenantId", "fromAddress");
CREATE INDEX "OceanFreightSourceEmail_tenantId_rateDetected_idx" ON "OceanFreightSourceEmail"("tenantId", "rateDetected");
CREATE UNIQUE INDEX "OceanFreightSourceAttachment_tenantId_sourceEmailId_graphAttachmentId_key" ON "OceanFreightSourceAttachment"("tenantId", "sourceEmailId", "graphAttachmentId");
CREATE UNIQUE INDEX "OceanFreightSourceAttachment_tenantId_id_key" ON "OceanFreightSourceAttachment"("tenantId", "id");
CREATE INDEX "OceanFreightSourceAttachment_tenantId_sourceEmailId_idx" ON "OceanFreightSourceAttachment"("tenantId", "sourceEmailId");
CREATE INDEX "OceanFreightSourceAttachment_tenantId_contentHash_idx" ON "OceanFreightSourceAttachment"("tenantId", "contentHash");
CREATE UNIQUE INDEX "OceanFreightRateCandidate_tenantId_id_key" ON "OceanFreightRateCandidate"("tenantId", "id");
CREATE INDEX "OceanFreightRateCandidate_tenantId_status_createdAt_idx" ON "OceanFreightRateCandidate"("tenantId", "status", "createdAt");
CREATE INDEX "OceanFreightRateCandidate_tenantId_originPort_destinationPort_idx" ON "OceanFreightRateCandidate"("tenantId", "originPort", "destinationPort");
CREATE INDEX "OceanFreightRateCandidate_tenantId_agentId_idx" ON "OceanFreightRateCandidate"("tenantId", "agentId");
CREATE INDEX "OceanFreightRateCandidate_tenantId_validityEndDate_idx" ON "OceanFreightRateCandidate"("tenantId", "validityEndDate");
CREATE UNIQUE INDEX "OceanFreightRate_tenantId_id_key" ON "OceanFreightRate"("tenantId", "id");
CREATE INDEX "OceanFreightRate_tenantId_status_validityEndDate_idx" ON "OceanFreightRate"("tenantId", "status", "validityEndDate");
CREATE INDEX "OceanFreightRate_tenantId_originPort_destinationPort_idx" ON "OceanFreightRate"("tenantId", "originPort", "destinationPort");
CREATE INDEX "OceanFreightRate_tenantId_originCountry_destinationCountry_idx" ON "OceanFreightRate"("tenantId", "originCountry", "destinationCountry");
CREATE INDEX "OceanFreightRate_tenantId_equipmentType_idx" ON "OceanFreightRate"("tenantId", "equipmentType");
CREATE INDEX "OceanFreightRate_tenantId_agentId_idx" ON "OceanFreightRate"("tenantId", "agentId");
CREATE INDEX "OceanFreightRate_tenantId_shippingLine_idx" ON "OceanFreightRate"("tenantId", "shippingLine");
CREATE INDEX "OceanFreightRate_tenantId_currency_rateAmount_idx" ON "OceanFreightRate"("tenantId", "currency", "rateAmount");
CREATE INDEX "OceanFreightRate_tenantId_createdAt_idx" ON "OceanFreightRate"("tenantId", "createdAt");
ALTER TABLE "OceanFreightAgent" ADD CONSTRAINT "OceanFreightAgent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OceanFreightAgentContact" ADD CONSTRAINT "OceanFreightAgentContact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OceanFreightAgentContact" ADD CONSTRAINT "OceanFreightAgentContact_tenantId_agentId_fkey" FOREIGN KEY ("tenantId", "agentId") REFERENCES "OceanFreightAgent"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OceanFreightSourceEmail" ADD CONSTRAINT "OceanFreightSourceEmail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OceanFreightSourceAttachment" ADD CONSTRAINT "OceanFreightSourceAttachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OceanFreightSourceAttachment" ADD CONSTRAINT "OceanFreightSourceAttachment_tenantId_sourceEmailId_fkey" FOREIGN KEY ("tenantId", "sourceEmailId") REFERENCES "OceanFreightSourceEmail"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRateCandidate" ADD CONSTRAINT "OceanFreightRateCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRateCandidate" ADD CONSTRAINT "OceanFreightRateCandidate_tenantId_sourceEmailId_fkey" FOREIGN KEY ("tenantId", "sourceEmailId") REFERENCES "OceanFreightSourceEmail"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRateCandidate" ADD CONSTRAINT "OceanFreightRateCandidate_tenantId_sourceAttachmentId_fkey" FOREIGN KEY ("tenantId", "sourceAttachmentId") REFERENCES "OceanFreightSourceAttachment"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRateCandidate" ADD CONSTRAINT "OceanFreightRateCandidate_tenantId_agentId_fkey" FOREIGN KEY ("tenantId", "agentId") REFERENCES "OceanFreightAgent"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRateCandidate" ADD CONSTRAINT "OceanFreightRateCandidate_tenantId_agentContactId_fkey" FOREIGN KEY ("tenantId", "agentContactId") REFERENCES "OceanFreightAgentContact"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRate" ADD CONSTRAINT "OceanFreightRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRate" ADD CONSTRAINT "OceanFreightRate_tenantId_agentId_fkey" FOREIGN KEY ("tenantId", "agentId") REFERENCES "OceanFreightAgent"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRate" ADD CONSTRAINT "OceanFreightRate_tenantId_agentContactId_fkey" FOREIGN KEY ("tenantId", "agentContactId") REFERENCES "OceanFreightAgentContact"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRate" ADD CONSTRAINT "OceanFreightRate_tenantId_sourceEmailId_fkey" FOREIGN KEY ("tenantId", "sourceEmailId") REFERENCES "OceanFreightSourceEmail"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "OceanFreightRate" ADD CONSTRAINT "OceanFreightRate_tenantId_sourceAttachmentId_fkey" FOREIGN KEY ("tenantId", "sourceAttachmentId") REFERENCES "OceanFreightSourceAttachment"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
