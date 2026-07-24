CREATE TYPE "WebsiteGrowthBacklinkCategory" AS ENUM (
  'DIRECTORY_CITATION',
  'LINK_RECLAMATION',
  'PARTNER_ECOSYSTEM',
  'CONTENT_CONTRIBUTION',
  'RESOURCE_PAGE',
  'DIGITAL_PR',
  'PAID_PLACEMENT'
);

CREATE TYPE "WebsiteGrowthBacklinkStatus" AS ENUM (
  'NEEDS_REVIEW',
  'APPROVED',
  'IN_PROGRESS',
  'SUBMITTED',
  'CONTACTED',
  'LIVE',
  'LOST',
  'BLOCKED',
  'REJECTED',
  'ARCHIVED'
);

CREATE TABLE "WebsiteGrowthBacklinkOpportunity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "WebsiteGrowthBacklinkStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "category" "WebsiteGrowthBacklinkCategory" NOT NULL,
  "title" TEXT NOT NULL,
  "sourceDomain" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "contactPage" TEXT,
  "targetPage" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "outreachAngle" TEXT NOT NULL,
  "authorityScore" DOUBLE PRECISION,
  "relevanceScore" INTEGER NOT NULL,
  "qualityScore" INTEGER NOT NULL,
  "spamRisk" TEXT NOT NULL,
  "estimatedCostAmount" DOUBLE PRECISION,
  "currency" TEXT,
  "requiresContent" BOOLEAN NOT NULL DEFAULT false,
  "evidence" JSONB,
  "notes" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "contactedAt" TIMESTAMP(3),
  "liveUrl" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),

  CONSTRAINT "WebsiteGrowthBacklinkOpportunity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteGrowthBacklinkOpportunity_tenantId_dedupeKey_key"
  ON "WebsiteGrowthBacklinkOpportunity"("tenantId", "dedupeKey");
CREATE INDEX "WebsiteGrowthBacklinkOpportunity_tenantId_status_qualityScore_idx"
  ON "WebsiteGrowthBacklinkOpportunity"("tenantId", "status", "qualityScore");
CREATE INDEX "WebsiteGrowthBacklinkOpportunity_tenantId_category_status_idx"
  ON "WebsiteGrowthBacklinkOpportunity"("tenantId", "category", "status");
CREATE INDEX "WebsiteGrowthBacklinkOpportunity_tenantId_sourceDomain_idx"
  ON "WebsiteGrowthBacklinkOpportunity"("tenantId", "sourceDomain");
CREATE INDEX "WebsiteGrowthBacklinkOpportunity_tenantId_lastSeenAt_idx"
  ON "WebsiteGrowthBacklinkOpportunity"("tenantId", "lastSeenAt");

ALTER TABLE "WebsiteGrowthBacklinkOpportunity"
  ADD CONSTRAINT "WebsiteGrowthBacklinkOpportunity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
