-- AlterEnum
ALTER TYPE "ShipmentInquiryAutomationStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "ShipmentInquiryAutomationStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- AlterTable
ALTER TABLE "ShipmentInquiryAutomationJob"
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "approvalRecordedAt" TIMESTAMP(3),
ADD COLUMN "parsedInquiry" JSONB,
ADD COLUMN "stageProgress" JSONB,
ADD COLUMN "tmsFileNumber" TEXT,
ADD COLUMN "tmsQuoteUrl" TEXT,
ADD COLUMN "sevenLResult" JSONB,
ADD COLUMN "tradeMiningResult" JSONB,
ADD COLUMN "notificationResult" JSONB;
