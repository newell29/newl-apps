-- CreateEnum
CREATE TYPE "WebsiteInboundEntryMethod" AS ENUM ('WEBSITE_FORM', 'MANUAL');

-- CreateEnum
CREATE TYPE "WebsiteInboundChannel" AS ENUM ('WEBSITE_FORM', 'PHONE', 'EMAIL', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "WebsiteInboundActivityType" AS ENUM ('CREATED', 'UPDATED', 'NOTE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WebsiteInboundStatus" ADD VALUE 'QUOTE_SENT';
ALTER TYPE "WebsiteInboundStatus" ADD VALUE 'WON';
ALTER TYPE "WebsiteInboundStatus" ADD VALUE 'LOST';
ALTER TYPE "WebsiteInboundStatus" ADD VALUE 'NURTURE';
ALTER TYPE "WebsiteInboundStatus" ADD VALUE 'DISQUALIFIED';

-- AlterTable
ALTER TABLE "WebsiteInboundSubmission" ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "contactChannel" "WebsiteInboundChannel" NOT NULL DEFAULT 'WEBSITE_FORM',
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "creationKey" TEXT,
ADD COLUMN     "entryMethod" "WebsiteInboundEntryMethod" NOT NULL DEFAULT 'WEBSITE_FORM',
ADD COLUMN     "followUpOn" DATE,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "phoneNormalized" TEXT,
ADD COLUMN     "receivedOn" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WebsiteInboundActivity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "type" "WebsiteInboundActivityType" NOT NULL,
    "body" TEXT,
    "changes" JSONB,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteInboundActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteInboundActivity_tenantId_submissionId_createdAt_idx" ON "WebsiteInboundActivity"("tenantId", "submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteInboundSubmission_tenantId_ownerUserId_idx" ON "WebsiteInboundSubmission"("tenantId", "ownerUserId");

-- CreateIndex
CREATE INDEX "WebsiteInboundSubmission_tenantId_followUpOn_idx" ON "WebsiteInboundSubmission"("tenantId", "followUpOn");

-- CreateIndex
CREATE INDEX "WebsiteInboundSubmission_tenantId_phoneNormalized_idx" ON "WebsiteInboundSubmission"("tenantId", "phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteInboundSubmission_tenantId_id_key" ON "WebsiteInboundSubmission"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteInboundSubmission_tenantId_creationKey_key" ON "WebsiteInboundSubmission"("tenantId", "creationKey");

-- AddForeignKey
ALTER TABLE "WebsiteInboundSubmission" ADD CONSTRAINT "WebsiteInboundSubmission_tenantId_ownerUserId_fkey" FOREIGN KEY ("tenantId", "ownerUserId") REFERENCES "Membership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteInboundActivity" ADD CONSTRAINT "WebsiteInboundActivity_tenantId_submissionId_fkey" FOREIGN KEY ("tenantId", "submissionId") REFERENCES "WebsiteInboundSubmission"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve historical dates and prepare phone matching without changing intake
-- payloads or interpreting any legacy lifecycle status. Prisma timestamps are UTC.
UPDATE "WebsiteInboundSubmission"
SET "receivedOn" = ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Toronto')::date,
    "lastActivityAt" = "updatedAt",
    "phoneNormalized" = NULLIF(regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g'), '');
