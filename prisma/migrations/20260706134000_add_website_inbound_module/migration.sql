ALTER TYPE "ModuleKey" ADD VALUE 'WEBSITE_INBOUND';

CREATE TYPE "WebsiteInboundStatus" AS ENUM (
  'NEW',
  'REVIEWED',
  'CONTACTED',
  'QUALIFIED',
  'CONVERTED',
  'CLOSED'
);

CREATE TABLE "WebsiteInboundSubmission" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "status" "WebsiteInboundStatus" NOT NULL DEFAULT 'NEW',
  "formType" TEXT NOT NULL,
  "source" TEXT,
  "pageUrl" TEXT,
  "name" TEXT,
  "email" TEXT,
  "company" TEXT,
  "phone" TEXT,
  "primaryNeed" TEXT,
  "fields" JSONB NOT NULL,

  CONSTRAINT "WebsiteInboundSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebsiteInboundSubmission_tenantId_createdAt_idx" ON "WebsiteInboundSubmission"("tenantId", "createdAt");
CREATE INDEX "WebsiteInboundSubmission_tenantId_status_idx" ON "WebsiteInboundSubmission"("tenantId", "status");
CREATE INDEX "WebsiteInboundSubmission_tenantId_formType_idx" ON "WebsiteInboundSubmission"("tenantId", "formType");

ALTER TABLE "WebsiteInboundSubmission"
  ADD CONSTRAINT "WebsiteInboundSubmission_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
