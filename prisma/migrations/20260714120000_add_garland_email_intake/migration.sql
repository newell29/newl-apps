-- CreateTable
CREATE TABLE "GarlandEmailSyncRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mailboxAddress" TEXT NOT NULL,
    "triggerSource" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "candidateMessageCount" INTEGER NOT NULL DEFAULT 0,
    "storedEmailCount" INTEGER NOT NULL DEFAULT 0,
    "createdEmailCount" INTEGER NOT NULL DEFAULT 0,
    "updatedEmailCount" INTEGER NOT NULL DEFAULT 0,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "storedAttachmentCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateAttachmentCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GarlandEmailSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarlandSourceEmail" (
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
    "classification" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "classificationReason" TEXT,
    "candidateScore" INTEGER NOT NULL DEFAULT 0,
    "hasPdfAttachment" BOOLEAN NOT NULL DEFAULT false,
    "expectedOrderCount" INTEGER,
    "expectedPageCount" INTEGER,
    "expectedPsStart" TEXT,
    "expectedPsEnd" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarlandSourceEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarlandSourceAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceEmailId" TEXT NOT NULL,
    "graphAttachmentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "contentHash" TEXT,
    "pageCount" INTEGER,
    "extractedPsNumbers" JSONB,
    "extractedSrNumbers" JSONB,
    "extractionFingerprint" TEXT,
    "intakeStatus" TEXT NOT NULL DEFAULT 'METADATA_ONLY',
    "duplicateOfAttachmentId" TEXT,
    "storageRef" TEXT,
    "parseError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarlandSourceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GarlandEmailSyncRun_tenantId_mailboxAddress_startedAt_idx" ON "GarlandEmailSyncRun"("tenantId", "mailboxAddress", "startedAt");

-- CreateIndex
CREATE INDEX "GarlandEmailSyncRun_tenantId_status_idx" ON "GarlandEmailSyncRun"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GarlandSourceEmail_tenantId_mailboxAddress_graphMessageId_key" ON "GarlandSourceEmail"("tenantId", "mailboxAddress", "graphMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "GarlandSourceEmail_tenantId_id_key" ON "GarlandSourceEmail"("tenantId", "id");

-- CreateIndex
CREATE INDEX "GarlandSourceEmail_tenantId_receivedAt_idx" ON "GarlandSourceEmail"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "GarlandSourceEmail_tenantId_fromAddress_idx" ON "GarlandSourceEmail"("tenantId", "fromAddress");

-- CreateIndex
CREATE INDEX "GarlandSourceEmail_tenantId_classification_idx" ON "GarlandSourceEmail"("tenantId", "classification");

-- CreateIndex
CREATE INDEX "GarlandSourceEmail_tenantId_conversationId_idx" ON "GarlandSourceEmail"("tenantId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "GarlandSourceAttachment_tenantId_sourceEmailId_graphAttachmentId_key" ON "GarlandSourceAttachment"("tenantId", "sourceEmailId", "graphAttachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "GarlandSourceAttachment_tenantId_id_key" ON "GarlandSourceAttachment"("tenantId", "id");

-- CreateIndex
CREATE INDEX "GarlandSourceAttachment_tenantId_sourceEmailId_idx" ON "GarlandSourceAttachment"("tenantId", "sourceEmailId");

-- CreateIndex
CREATE INDEX "GarlandSourceAttachment_tenantId_contentHash_idx" ON "GarlandSourceAttachment"("tenantId", "contentHash");

-- CreateIndex
CREATE INDEX "GarlandSourceAttachment_tenantId_intakeStatus_idx" ON "GarlandSourceAttachment"("tenantId", "intakeStatus");

-- AddForeignKey
ALTER TABLE "GarlandEmailSyncRun" ADD CONSTRAINT "GarlandEmailSyncRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarlandSourceEmail" ADD CONSTRAINT "GarlandSourceEmail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarlandSourceAttachment" ADD CONSTRAINT "GarlandSourceAttachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarlandSourceAttachment" ADD CONSTRAINT "GarlandSourceAttachment_tenantId_sourceEmailId_fkey" FOREIGN KEY ("tenantId", "sourceEmailId") REFERENCES "GarlandSourceEmail"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
