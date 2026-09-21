ALTER TYPE "WebsiteInboundStatus" ADD VALUE IF NOT EXISTS 'TEST';

CREATE TYPE "WebsiteInboundAttributionChannel" AS ENUM (
  'PAID_SEARCH',
  'ORGANIC_SEARCH',
  'AI_REFERRAL',
  'DIRECT',
  'LOCAL',
  'REFERRAL',
  'OTHER',
  'UNKNOWN'
);

CREATE TYPE "WebsitePaidCampaignSignalType" AS ENUM (
  'PAID_TRACKING_ISSUE',
  'PAID_SYNC_FAILURE',
  'BUDGET_PACING',
  'WASTED_SPEND',
  'NEGATIVE_KEYWORD',
  'LANDING_PAGE_OPPORTUNITY',
  'SCALE_CANDIDATE'
);

CREATE TYPE "WebsitePaidCampaignSignalStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "WebsiteAdsOfflineConversionMilestone" AS ENUM ('QUALIFIED', 'QUOTE_SENT', 'WON');
CREATE TYPE "WebsiteAdsOfflineConversionStatus" AS ENUM ('PENDING', 'ATTEMPTED', 'UPLOADED', 'FAILED', 'SKIPPED');

ALTER TABLE "WebsiteInboundSubmission"
  ADD COLUMN "rawPayload" JSONB,
  ADD COLUMN "utmSource" TEXT,
  ADD COLUMN "utmMedium" TEXT,
  ADD COLUMN "utmCampaign" TEXT,
  ADD COLUMN "utmTerm" TEXT,
  ADD COLUMN "utmContent" TEXT,
  ADD COLUMN "gclid" TEXT,
  ADD COLUMN "gbraid" TEXT,
  ADD COLUMN "wbraid" TEXT,
  ADD COLUMN "gaClientId" TEXT,
  ADD COLUMN "campaignId" TEXT,
  ADD COLUMN "adGroupId" TEXT,
  ADD COLUMN "creativeId" TEXT,
  ADD COLUMN "matchType" TEXT,
  ADD COLUMN "network" TEXT,
  ADD COLUMN "device" TEXT,
  ADD COLUMN "landingPage" TEXT,
  ADD COLUMN "landingPath" TEXT,
  ADD COLUMN "firstReferrer" TEXT,
  ADD COLUMN "firstReferrerDomain" TEXT,
  ADD COLUMN "sessionStartedAt" TIMESTAMP(3),
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "trafficSourceGuess" TEXT,
  ADD COLUMN "attributionConfidence" TEXT,
  ADD COLUMN "attributionChannel" "WebsiteInboundAttributionChannel" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "attributionLocation" TEXT,
  ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "marketingExcludedReason" TEXT;

-- Historical rows retain the complete evidence that was available before this
-- migration. The marker prevents this compatibility envelope from being
-- mistaken for the original top-level request, which was not previously saved.
UPDATE "WebsiteInboundSubmission"
SET
  "rawPayload" = jsonb_build_object(
    '_historicalPartial', true,
    'formType', "formType",
    'source', "source",
    'pageUrl', "pageUrl",
    'fields', "fields"
  ),
  "submittedAt" = "createdAt",
  "utmSource" = NULLIF(COALESCE(
    "fields"->>'utmSource',
    "fields"->>'utm_source',
    "fields"->>'Attribution - UTM Source'
  ), ''),
  "utmMedium" = NULLIF(COALESCE(
    "fields"->>'utmMedium',
    "fields"->>'utm_medium',
    "fields"->>'Attribution - UTM Medium'
  ), ''),
  "utmCampaign" = NULLIF(COALESCE(
    "fields"->>'utmCampaign',
    "fields"->>'utm_campaign',
    "fields"->>'Attribution - UTM Campaign'
  ), ''),
  "utmTerm" = NULLIF(COALESCE(
    "fields"->>'utmTerm',
    "fields"->>'utm_term',
    "fields"->>'Attribution - UTM Term'
  ), ''),
  "utmContent" = NULLIF(COALESCE(
    "fields"->>'utmContent',
    "fields"->>'utm_content',
    "fields"->>'Attribution - UTM Content'
  ), ''),
  "gclid" = NULLIF(COALESCE("fields"->>'gclid', "fields"->>'GCLID', "fields"->>'Attribution - GCLID'), ''),
  "gbraid" = NULLIF(COALESCE("fields"->>'gbraid', "fields"->>'GBRAID', "fields"->>'Attribution - GBRAID'), ''),
  "wbraid" = NULLIF(COALESCE("fields"->>'wbraid', "fields"->>'WBRAID', "fields"->>'Attribution - WBRAID'), ''),
  "gaClientId" = NULLIF(COALESCE("fields"->>'gaClientId', "fields"->>'ga_client_id', "fields"->>'Attribution - GA Client ID'), ''),
  "campaignId" = NULLIF(COALESCE("fields"->>'campaignId', "fields"->>'campaign_id', "fields"->>'Attribution - Campaign ID'), ''),
  "adGroupId" = NULLIF(COALESCE("fields"->>'adGroupId', "fields"->>'ad_group_id', "fields"->>'Attribution - Ad Group ID'), ''),
  "creativeId" = NULLIF(COALESCE("fields"->>'creativeId', "fields"->>'creative_id', "fields"->>'Attribution - Creative ID'), ''),
  "matchType" = NULLIF(COALESCE("fields"->>'matchType', "fields"->>'match_type', "fields"->>'Attribution - Match Type'), ''),
  "network" = NULLIF(COALESCE("fields"->>'network', "fields"->>'Attribution - Network'), ''),
  "device" = NULLIF(COALESCE("fields"->>'device', "fields"->>'Attribution - Device'), ''),
  "landingPage" = NULLIF(COALESCE("fields"->>'landingPage', "fields"->>'landing_page', "fields"->>'Attribution - Landing Page'), ''),
  "landingPath" = NULLIF(COALESCE("fields"->>'landingPath', "fields"->>'landing_path', "fields"->>'Attribution - Landing Path'), ''),
  "firstReferrer" = NULLIF(COALESCE("fields"->>'firstReferrer', "fields"->>'first_referrer', "fields"->>'Attribution - First Referrer'), ''),
  "firstReferrerDomain" = NULLIF(COALESCE("fields"->>'firstReferrerDomain', "fields"->>'first_referrer_domain', "fields"->>'Attribution - First Referrer Domain'), ''),
  "trafficSourceGuess" = NULLIF(COALESCE("fields"->>'trafficSourceGuess', "fields"->>'traffic_source_guess', "fields"->>'Attribution - Traffic Source Guess'), ''),
  "attributionConfidence" = NULLIF(COALESCE("fields"->>'attributionConfidence', "fields"->>'attribution_confidence', "fields"->>'Attribution - Attribution Confidence'), ''),
  "attributionLocation" = NULLIF(COALESCE(
    "fields"->>'Location',
    "fields"->>'location',
    "fields"->>'City',
    "fields"->>'city',
    "fields"->>'Province',
    "fields"->>'province',
    "fields"->>'State',
    "fields"->>'state'
  ), '')
WHERE "entryMethod" = 'WEBSITE_FORM';

UPDATE "WebsiteInboundSubmission"
SET
  "isTest" = true,
  "marketingExcludedReason" = 'EXPLICIT_TEST'
WHERE "entryMethod" = 'WEBSITE_FORM'
  AND lower(COALESCE(
    "fields"->>'isTest',
    "fields"->>'is_test',
    "fields"->>'Attribution - Is Test',
    ''
  )) IN ('true', '1', 'yes', 'y', 'test');

UPDATE "WebsiteInboundSubmission"
SET
  "isTest" = true,
  "marketingExcludedReason" = CASE
    WHEN lower(COALESCE("formType", '')) IN ('internal', 'internal_test', 'employee', 'employee_test')
      OR lower(COALESCE("source", '')) IN ('internal', 'internal_test', 'employee', 'employee_test')
      THEN 'INTERNAL_SUBMISSION'
    ELSE 'AUTOMATED_FORM_CHECK'
  END
WHERE "entryMethod" = 'WEBSITE_FORM'
  AND (
    lower(COALESCE("formType", '')) IN (
      'codex_diagnostic', 'automated_check', 'form_health_check', 'synthetic_check', 'qa_test',
      'internal', 'internal_test', 'employee', 'employee_test'
    )
    OR lower(COALESCE("source", '')) IN (
      'codex_diagnostic', 'automated_check', 'form_health_check', 'synthetic_check', 'qa_test',
      'internal', 'internal_test', 'employee', 'employee_test'
    )
  );

UPDATE "WebsiteInboundSubmission"
SET
  "isTest" = true,
  "marketingExcludedReason" = 'CODEX_DIAGNOSTIC'
WHERE "entryMethod" = 'WEBSITE_FORM'
  AND (
    COALESCE("pageUrl", '') ILIKE '%codex_weekly_diagnostic%'
    OR COALESCE("landingPage", '') ILIKE '%codex_weekly_diagnostic%'
    OR COALESCE("landingPath", '') ILIKE '%codex_weekly_diagnostic%'
  );

UPDATE "WebsiteInboundSubmission"
SET "attributionChannel" = CASE
  WHEN lower(COALESCE("utmMedium", '')) IN ('cpc', 'ppc', 'paid', 'paid_search', 'paid-search', 'sem')
    OR "gclid" IS NOT NULL OR "gbraid" IS NOT NULL OR "wbraid" IS NOT NULL
    OR "campaignId" IS NOT NULL OR "adGroupId" IS NOT NULL OR "creativeId" IS NOT NULL
    THEN 'PAID_SEARCH'::"WebsiteInboundAttributionChannel"
  WHEN lower(COALESCE("utmMedium", '')) = 'organic'
    OR lower(COALESCE("trafficSourceGuess", '')) LIKE '%organic%'
    THEN 'ORGANIC_SEARCH'::"WebsiteInboundAttributionChannel"
  WHEN lower(COALESCE("trafficSourceGuess", '')) LIKE '%ai%'
    OR lower(COALESCE("firstReferrerDomain", '')) ~ '(chatgpt|openai|perplexity|claude|copilot|gemini)'
    THEN 'AI_REFERRAL'::"WebsiteInboundAttributionChannel"
  WHEN lower(COALESCE("utmMedium", '')) IN ('local', 'local_listing')
    OR lower(COALESCE("trafficSourceGuess", '')) LIKE '%local%'
    THEN 'LOCAL'::"WebsiteInboundAttributionChannel"
  WHEN lower(COALESCE("utmMedium", '')) IN ('referral', 'affiliate')
    OR lower(COALESCE("trafficSourceGuess", '')) LIKE '%referral%'
    THEN 'REFERRAL'::"WebsiteInboundAttributionChannel"
  WHEN lower(COALESCE("utmMedium", '')) IN ('direct', '(none)', 'none')
    OR lower(COALESCE("trafficSourceGuess", '')) = 'direct'
    THEN 'DIRECT'::"WebsiteInboundAttributionChannel"
  WHEN "utmSource" IS NOT NULL OR "utmMedium" IS NOT NULL OR "firstReferrer" IS NOT NULL
    THEN 'OTHER'::"WebsiteInboundAttributionChannel"
  ELSE 'UNKNOWN'::"WebsiteInboundAttributionChannel"
END
WHERE "entryMethod" = 'WEBSITE_FORM';

CREATE INDEX "WebsiteInboundSubmission_tenantId_submittedAt_idx"
  ON "WebsiteInboundSubmission"("tenantId", "submittedAt");
CREATE INDEX "WebsiteInboundSubmission_tenantId_attributionChannel_submitted_idx"
  ON "WebsiteInboundSubmission"("tenantId", "attributionChannel", "submittedAt");
CREATE INDEX "WebsiteInboundSubmission_tenantId_campaignId_submittedAt_idx"
  ON "WebsiteInboundSubmission"("tenantId", "campaignId", "submittedAt");
CREATE INDEX "WebsiteInboundSubmission_tenantId_isTest_submittedAt_idx"
  ON "WebsiteInboundSubmission"("tenantId", "isTest", "submittedAt");

CREATE TABLE "WebsitePaidCampaignMetric" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'GOOGLE_ADS',
  "metricDate" DATE NOT NULL,
  "campaignId" TEXT,
  "campaignName" TEXT,
  "adGroupId" TEXT,
  "adGroupName" TEXT,
  "keyword" TEXT,
  "searchTerm" TEXT,
  "matchType" TEXT,
  "network" TEXT,
  "device" TEXT,
  "location" TEXT,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "cost" DECIMAL(16,6),
  "currency" TEXT,
  "raw" JSONB,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebsitePaidCampaignMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsitePaidCampaignMetric_tenantId_sourceKey_key"
  ON "WebsitePaidCampaignMetric"("tenantId", "sourceKey");
CREATE INDEX "WebsitePaidCampaignMetric_tenantId_metricDate_idx"
  ON "WebsitePaidCampaignMetric"("tenantId", "metricDate");
CREATE INDEX "WebsitePaidCampaignMetric_tenantId_campaignId_metricDate_idx"
  ON "WebsitePaidCampaignMetric"("tenantId", "campaignId", "metricDate");
CREATE INDEX "WebsitePaidCampaignMetric_tenantId_searchTerm_metricDate_idx"
  ON "WebsitePaidCampaignMetric"("tenantId", "searchTerm", "metricDate");

CREATE TABLE "WebsitePaidCampaignSignal" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "type" "WebsitePaidCampaignSignalType" NOT NULL,
  "status" "WebsitePaidCampaignSignalStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "evidence" JSONB,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebsitePaidCampaignSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsitePaidCampaignSignal_tenantId_dedupeKey_key"
  ON "WebsitePaidCampaignSignal"("tenantId", "dedupeKey");
CREATE INDEX "WebsitePaidCampaignSignal_tenantId_status_type_idx"
  ON "WebsitePaidCampaignSignal"("tenantId", "status", "type");
CREATE INDEX "WebsitePaidCampaignSignal_tenantId_lastSeenAt_idx"
  ON "WebsitePaidCampaignSignal"("tenantId", "lastSeenAt");

CREATE TABLE "WebsiteAdsOfflineConversion" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "milestone" "WebsiteAdsOfflineConversionMilestone" NOT NULL,
  "status" "WebsiteAdsOfflineConversionStatus" NOT NULL DEFAULT 'PENDING',
  "clickIdType" TEXT,
  "clickIdValue" TEXT,
  "conversionAt" TIMESTAMP(3) NOT NULL,
  "conversionValue" DECIMAL(16,6),
  "currency" TEXT,
  "externalId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "uploadedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "providerResult" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebsiteAdsOfflineConversion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteAdsOfflineConversion_tenantId_submissionId_milestone_key"
  ON "WebsiteAdsOfflineConversion"("tenantId", "submissionId", "milestone");
CREATE INDEX "WebsiteAdsOfflineConversion_tenantId_status_conversionAt_idx"
  ON "WebsiteAdsOfflineConversion"("tenantId", "status", "conversionAt");
CREATE INDEX "WebsiteAdsOfflineConversion_tenantId_clickIdValue_idx"
  ON "WebsiteAdsOfflineConversion"("tenantId", "clickIdValue");

ALTER TABLE "WebsitePaidCampaignMetric"
  ADD CONSTRAINT "WebsitePaidCampaignMetric_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebsitePaidCampaignSignal"
  ADD CONSTRAINT "WebsitePaidCampaignSignal_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebsiteAdsOfflineConversion"
  ADD CONSTRAINT "WebsiteAdsOfflineConversion_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebsiteAdsOfflineConversion"
  ADD CONSTRAINT "WebsiteAdsOfflineConversion_tenantId_submissionId_fkey"
  FOREIGN KEY ("tenantId", "submissionId") REFERENCES "WebsiteInboundSubmission"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
