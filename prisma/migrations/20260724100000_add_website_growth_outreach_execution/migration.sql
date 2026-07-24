ALTER TYPE "WebsiteGrowthBacklinkStatus" ADD VALUE 'REPLIED';

CREATE TYPE "WebsiteGrowthOutreachConsentBasis" AS ENUM (
  'EXPRESS',
  'EXISTING_RELATIONSHIP',
  'CONSPICUOUSLY_PUBLISHED_BUSINESS',
  'PUBLISHER_SUBMISSION',
  'US_BUSINESS_OUTREACH'
);

CREATE TYPE "WebsiteGrowthOutreachMessageKind" AS ENUM ('INITIAL', 'FOLLOW_UP');

ALTER TABLE "WebsiteGrowthBacklinkOpportunity"
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "recipientName" TEXT,
  ADD COLUMN "recipientEmail" TEXT,
  ADD COLUMN "recipientCountry" TEXT,
  ADD COLUMN "contactSourceUrl" TEXT,
  ADD COLUMN "consentBasis" "WebsiteGrowthOutreachConsentBasis",
  ADD COLUMN "nextFollowUpAt" TIMESTAMP(3),
  ADD COLUMN "followUpCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReplyAt" TIMESTAMP(3),
  ADD COLUMN "replySummary" TEXT,
  ADD COLUMN "unsubscribedAt" TIMESTAMP(3),
  ADD COLUMN "directoryLoginUrl" TEXT,
  ADD COLUMN "directoryUsername" TEXT,
  ADD COLUMN "acceptedTermsUrl" TEXT,
  ADD COLUMN "acceptedTermsSummary" TEXT;

CREATE TABLE "WebsiteGrowthOutreachMessage" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind" "WebsiteGrowthOutreachMessageKind" NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "externalMessageId" TEXT,
  "conversationId" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebsiteGrowthOutreachMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebsiteGrowthOutreachSuppression" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebsiteGrowthOutreachSuppression_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteGrowthBacklinkOpportunity_tenantId_nextFollowUpAt_idx"
  ON "WebsiteGrowthBacklinkOpportunity"("tenantId", "nextFollowUpAt");

CREATE INDEX "WebsiteGrowthOutreachMessage_tenantId_opportunityId_sentAt_idx"
  ON "WebsiteGrowthOutreachMessage"("tenantId", "opportunityId", "sentAt");

CREATE INDEX "WebsiteGrowthOutreachMessage_tenantId_recipientEmail_idx"
  ON "WebsiteGrowthOutreachMessage"("tenantId", "recipientEmail");

CREATE INDEX "WebsiteGrowthOutreachMessage_tenantId_conversationId_idx"
  ON "WebsiteGrowthOutreachMessage"("tenantId", "conversationId");

CREATE UNIQUE INDEX "WebsiteGrowthOutreachSuppression_tenantId_normalizedEmail_key"
  ON "WebsiteGrowthOutreachSuppression"("tenantId", "normalizedEmail");

CREATE INDEX "WebsiteGrowthOutreachSuppression_tenantId_createdAt_idx"
  ON "WebsiteGrowthOutreachSuppression"("tenantId", "createdAt");

ALTER TABLE "WebsiteGrowthOutreachMessage"
  ADD CONSTRAINT "WebsiteGrowthOutreachMessage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebsiteGrowthOutreachMessage"
  ADD CONSTRAINT "WebsiteGrowthOutreachMessage_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "WebsiteGrowthBacklinkOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebsiteGrowthOutreachSuppression"
  ADD CONSTRAINT "WebsiteGrowthOutreachSuppression_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
