-- Add Website Growth enum values, opportunity queue, imported metrics, and import logs.

ALTER TYPE "ModuleKey" ADD VALUE IF NOT EXISTS 'WEBSITE_GROWTH';

CREATE TYPE "WebsiteGrowthOpportunityStatus" AS ENUM (
  'NEW',
  'REVIEWING',
  'APPROVED',
  'IN_PROGRESS',
  'PUBLISHED',
  'MONITORING',
  'REJECTED'
);

CREATE TYPE "WebsiteGrowthAction" AS ENUM (
  'CREATE_PAGE',
  'IMPROVE_EXISTING_PAGE',
  'ADD_SECTION',
  'ADD_INTERNAL_LINKS',
  'CREATE_RESOURCE_ARTICLE',
  'UPDATE_REDIRECT',
  'IGNORE',
  'MONITOR'
);

CREATE TYPE "WebsiteGrowthDataSource" AS ENUM (
  'GOOGLE_SEARCH_CONSOLE_API',
  'GOOGLE_SEARCH_CONSOLE_UPLOAD',
  'GA4_API',
  'GA4_UPLOAD',
  'SEMRUSH_UPLOAD',
  'INTERNAL_APP_DATA',
  'MANUAL'
);

CREATE TYPE "WebsiteGrowthImportStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'ERROR'
);

CREATE TABLE "WebsiteGrowthOpportunity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "status" "WebsiteGrowthOpportunityStatus" NOT NULL DEFAULT 'NEW',
  "action" "WebsiteGrowthAction" NOT NULL,
  "topic" TEXT NOT NULL,
  "primaryKeyword" TEXT,
  "targetPage" TEXT,
  "sourcePage" TEXT,
  "score" INTEGER NOT NULL DEFAULT 0,
  "confidence" TEXT,
  "reason" TEXT NOT NULL,
  "recommendation" TEXT NOT NULL,
  "supportingKeywords" JSONB,
  "evidence" JSONB,
  "notes" TEXT,
  "approvedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),

  CONSTRAINT "WebsiteGrowthOpportunity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebsiteGrowthDataImport" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "source" "WebsiteGrowthDataSource" NOT NULL,
  "status" "WebsiteGrowthImportStatus" NOT NULL DEFAULT 'PENDING',
  "fileName" TEXT,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "WebsiteGrowthDataImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebsiteGrowthMetric" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "source" "WebsiteGrowthDataSource" NOT NULL,
  "page" TEXT,
  "query" TEXT,
  "country" TEXT,
  "device" TEXT,
  "dateRangeStart" TIMESTAMP(3),
  "dateRangeEnd" TIMESTAMP(3),
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "ctr" DOUBLE PRECISION,
  "position" DOUBLE PRECISION,
  "sessions" INTEGER,
  "engagedSessions" INTEGER,
  "engagementRate" DOUBLE PRECISION,
  "eventCount" INTEGER,
  "leadCount" INTEGER NOT NULL DEFAULT 0,
  "raw" JSONB,

  CONSTRAINT "WebsiteGrowthMetric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteGrowthOpportunity_tenantId_status_idx" ON "WebsiteGrowthOpportunity"("tenantId", "status");
CREATE INDEX "WebsiteGrowthOpportunity_tenantId_action_idx" ON "WebsiteGrowthOpportunity"("tenantId", "action");
CREATE INDEX "WebsiteGrowthOpportunity_tenantId_score_idx" ON "WebsiteGrowthOpportunity"("tenantId", "score");
CREATE INDEX "WebsiteGrowthOpportunity_tenantId_updatedAt_idx" ON "WebsiteGrowthOpportunity"("tenantId", "updatedAt");

CREATE INDEX "WebsiteGrowthDataImport_tenantId_source_idx" ON "WebsiteGrowthDataImport"("tenantId", "source");
CREATE INDEX "WebsiteGrowthDataImport_tenantId_status_idx" ON "WebsiteGrowthDataImport"("tenantId", "status");
CREATE INDEX "WebsiteGrowthDataImport_tenantId_createdAt_idx" ON "WebsiteGrowthDataImport"("tenantId", "createdAt");

CREATE INDEX "WebsiteGrowthMetric_tenantId_source_idx" ON "WebsiteGrowthMetric"("tenantId", "source");
CREATE INDEX "WebsiteGrowthMetric_tenantId_page_idx" ON "WebsiteGrowthMetric"("tenantId", "page");
CREATE INDEX "WebsiteGrowthMetric_tenantId_query_idx" ON "WebsiteGrowthMetric"("tenantId", "query");
CREATE INDEX "WebsiteGrowthMetric_tenantId_dateRangeStart_idx" ON "WebsiteGrowthMetric"("tenantId", "dateRangeStart");

ALTER TABLE "WebsiteGrowthOpportunity"
  ADD CONSTRAINT "WebsiteGrowthOpportunity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebsiteGrowthDataImport"
  ADD CONSTRAINT "WebsiteGrowthDataImport_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebsiteGrowthMetric"
  ADD CONSTRAINT "WebsiteGrowthMetric_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
