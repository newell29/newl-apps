-- CreateTable
CREATE TABLE "TmgOrderIntakeBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mailboxAddress" TEXT NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "internetMessageId" TEXT,
    "conversationId" TEXT,
    "subject" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "sourceWebLink" TEXT,
    "sourceBodyHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateAttachmentCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "readyOrderCount" INTEGER NOT NULL DEFAULT 0,
    "invalidOrderCount" INTEGER NOT NULL DEFAULT 0,
    "approvalRequestHash" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "summaryStatus" TEXT NOT NULL DEFAULT 'NOT_READY',
    "summaryResult" JSONB,
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TmgOrderIntakeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TmgOrderIntakeAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "graphAttachmentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "documentRole" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "fileBytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TmgOrderIntakeAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TmgOrderIntakeOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "customerReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "packingSlip" JSONB NOT NULL,
    "picklist" JSONB,
    "bol" JSONB,
    "label" JSONB,
    "warehouseInstructions" TEXT,
    "deliveryNotesExcludedFromTeamship" BOOLEAN NOT NULL DEFAULT true,
    "validationIssues" JSONB NOT NULL,
    "combinedPdfFileName" TEXT,
    "combinedPdfHash" TEXT,
    "combinedPdfBytes" BYTEA,
    "teamshipPlan" JSONB,
    "planRequestHash" TEXT,
    "teamshipCreateStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "teamshipOrderId" TEXT,
    "teamshipOrderNumber" TEXT,
    "teamshipUrl" TEXT,
    "teamshipCreateEvidence" JSONB,
    "documentUploadStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "documentUploadEvidence" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TmgOrderIntakeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TmgTeamshipExecutionJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL DEFAULT 'TMG_TEAMSHIP_CREATE_AND_UPLOAD_V1',
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "selectedOrderIds" JSONB NOT NULL,
    "requestHash" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TmgTeamshipExecutionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TmgOrderIntakeBatch_tenantId_mailboxAddress_graphMessageId_key" ON "TmgOrderIntakeBatch"("tenantId", "mailboxAddress", "graphMessageId");
CREATE UNIQUE INDEX "TmgOrderIntakeBatch_tenantId_id_key" ON "TmgOrderIntakeBatch"("tenantId", "id");
CREATE INDEX "TmgOrderIntakeBatch_tenantId_status_receivedAt_idx" ON "TmgOrderIntakeBatch"("tenantId", "status", "receivedAt");
CREATE INDEX "TmgOrderIntakeBatch_tenantId_conversationId_receivedAt_idx" ON "TmgOrderIntakeBatch"("tenantId", "conversationId", "receivedAt");
CREATE INDEX "TmgOrderIntakeBatch_tenantId_createdAt_idx" ON "TmgOrderIntakeBatch"("tenantId", "createdAt");
CREATE UNIQUE INDEX "TmgOrderIntakeAttachment_tenantId_batchId_graphAttachmentId_key" ON "TmgOrderIntakeAttachment"("tenantId", "batchId", "graphAttachmentId");
CREATE INDEX "TmgOrderIntakeAttachment_tenantId_batchId_documentRole_idx" ON "TmgOrderIntakeAttachment"("tenantId", "batchId", "documentRole");
CREATE INDEX "TmgOrderIntakeAttachment_tenantId_contentHash_idx" ON "TmgOrderIntakeAttachment"("tenantId", "contentHash");
CREATE UNIQUE INDEX "TmgOrderIntakeOrder_tenantId_batchId_customerReference_key" ON "TmgOrderIntakeOrder"("tenantId", "batchId", "customerReference");
CREATE UNIQUE INDEX "TmgOrderIntakeOrder_tenantId_id_key" ON "TmgOrderIntakeOrder"("tenantId", "id");
CREATE INDEX "TmgOrderIntakeOrder_tenantId_batchId_status_idx" ON "TmgOrderIntakeOrder"("tenantId", "batchId", "status");
CREATE INDEX "TmgOrderIntakeOrder_tenantId_customerReference_idx" ON "TmgOrderIntakeOrder"("tenantId", "customerReference");
CREATE INDEX "TmgOrderIntakeOrder_tenantId_teamshipOrderId_idx" ON "TmgOrderIntakeOrder"("tenantId", "teamshipOrderId");
CREATE INDEX "TmgOrderIntakeOrder_tenantId_documentUploadStatus_idx" ON "TmgOrderIntakeOrder"("tenantId", "documentUploadStatus");
CREATE UNIQUE INDEX "TmgTeamshipExecutionJob_tenantId_batchId_key" ON "TmgTeamshipExecutionJob"("tenantId", "batchId");
CREATE UNIQUE INDEX "TmgTeamshipExecutionJob_tenantId_id_key" ON "TmgTeamshipExecutionJob"("tenantId", "id");
CREATE UNIQUE INDEX "TmgTeamshipExecutionJob_tenantId_requestHash_key" ON "TmgTeamshipExecutionJob"("tenantId", "requestHash");
CREATE INDEX "TmgTeamshipExecutionJob_tenantId_status_createdAt_idx" ON "TmgTeamshipExecutionJob"("tenantId", "status", "createdAt");
CREATE INDEX "TmgTeamshipExecutionJob_tenantId_workerId_claimedAt_idx" ON "TmgTeamshipExecutionJob"("tenantId", "workerId", "claimedAt");

-- AddForeignKey
ALTER TABLE "TmgOrderIntakeBatch" ADD CONSTRAINT "TmgOrderIntakeBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TmgOrderIntakeBatch" ADD CONSTRAINT "TmgOrderIntakeBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "TmgOrderIntakeBatch" ADD CONSTRAINT "TmgOrderIntakeBatch_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "TmgOrderIntakeAttachment" ADD CONSTRAINT "TmgOrderIntakeAttachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TmgOrderIntakeAttachment" ADD CONSTRAINT "TmgOrderIntakeAttachment_tenantId_batchId_fkey" FOREIGN KEY ("tenantId", "batchId") REFERENCES "TmgOrderIntakeBatch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TmgOrderIntakeOrder" ADD CONSTRAINT "TmgOrderIntakeOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TmgOrderIntakeOrder" ADD CONSTRAINT "TmgOrderIntakeOrder_tenantId_batchId_fkey" FOREIGN KEY ("tenantId", "batchId") REFERENCES "TmgOrderIntakeBatch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TmgTeamshipExecutionJob" ADD CONSTRAINT "TmgTeamshipExecutionJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TmgTeamshipExecutionJob" ADD CONSTRAINT "TmgTeamshipExecutionJob_tenantId_batchId_fkey" FOREIGN KEY ("tenantId", "batchId") REFERENCES "TmgOrderIntakeBatch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TmgTeamshipExecutionJob" ADD CONSTRAINT "TmgTeamshipExecutionJob_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
