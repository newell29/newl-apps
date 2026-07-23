-- CreateEnum
CREATE TYPE "ShipmentInquiryAutomationStatus" AS ENUM ('PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "ShipmentInquiryAutomationJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mailboxAddress" TEXT NOT NULL,
    "graphFolderId" TEXT NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "internetMessageId" TEXT,
    "conversationId" TEXT,
    "subject" TEXT NOT NULL,
    "senderName" TEXT,
    "senderAddress" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "bodyPreview" TEXT,
    "normalizedBodyText" TEXT,
    "status" "ShipmentInquiryAutomationStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentInquiryAutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentInquiryAutomationJob_tenantId_mailboxAddress_graphM_key" ON "ShipmentInquiryAutomationJob"("tenantId", "mailboxAddress", "graphMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentInquiryAutomationJob_tenantId_id_key" ON "ShipmentInquiryAutomationJob"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ShipmentInquiryAutomationJob_tenantId_status_discoveredAt_idx" ON "ShipmentInquiryAutomationJob"("tenantId", "status", "discoveredAt");

-- CreateIndex
CREATE INDEX "ShipmentInquiryAutomationJob_tenantId_mailboxAddress_received_idx" ON "ShipmentInquiryAutomationJob"("tenantId", "mailboxAddress", "receivedAt");

-- CreateIndex
CREATE INDEX "ShipmentInquiryAutomationJob_tenantId_conversationId_idx" ON "ShipmentInquiryAutomationJob"("tenantId", "conversationId");

-- AddForeignKey
ALTER TABLE "ShipmentInquiryAutomationJob" ADD CONSTRAINT "ShipmentInquiryAutomationJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
