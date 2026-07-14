-- CreateEnum
CREATE TYPE "WebsiteGrowthContentDraftStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'BUILT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "WebsiteGrowthContentDraftSource" AS ENUM ('AI', 'TEMPLATE');

-- CreateTable
CREATE TABLE "WebsiteGrowthContentDraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "WebsiteGrowthContentDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "WebsiteGrowthContentDraftSource" NOT NULL DEFAULT 'TEMPLATE',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "proposedPath" TEXT,
    "targetPage" TEXT,
    "draftJson" JSONB NOT NULL,
    "rawResponse" JSONB,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "builtUrl" TEXT,
    "pullRequestUrl" TEXT,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "WebsiteGrowthContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteGrowthContentDraft_tenantId_status_idx" ON "WebsiteGrowthContentDraft"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WebsiteGrowthContentDraft_tenantId_opportunityId_idx" ON "WebsiteGrowthContentDraft"("tenantId", "opportunityId");

-- CreateIndex
CREATE INDEX "WebsiteGrowthContentDraft_tenantId_createdAt_idx" ON "WebsiteGrowthContentDraft"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "WebsiteGrowthContentDraft" ADD CONSTRAINT "WebsiteGrowthContentDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteGrowthContentDraft" ADD CONSTRAINT "WebsiteGrowthContentDraft_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "WebsiteGrowthOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
