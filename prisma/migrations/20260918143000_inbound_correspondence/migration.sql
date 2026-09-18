CREATE TYPE "WebsiteInboundEmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "WebsiteInboundEmailStatus" AS ENUM ('RECEIVED', 'DRAFT', 'SENDING', 'SENT', 'SEND_FAILED', 'CANCELLED');

ALTER TABLE "WebsiteInboundSubmission"
  ADD COLUMN "communicationMailbox" TEXT,
  ADD COLUMN "lastInboundEmailAt" TIMESTAMP(3),
  ADD COLUMN "lastOutboundEmailAt" TIMESTAMP(3);

CREATE TABLE "WebsiteInboundEmailMessage" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "submissionId" TEXT,
  "direction" "WebsiteInboundEmailDirection" NOT NULL,
  "status" "WebsiteInboundEmailStatus" NOT NULL,
  "mailboxAddress" TEXT NOT NULL,
  "graphMessageId" TEXT,
  "internetMessageId" TEXT,
  "conversationId" TEXT,
  "subject" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "bodyPreview" TEXT,
  "senderAddress" TEXT NOT NULL,
  "senderName" TEXT,
  "recipients" JSONB NOT NULL,
  "ccRecipients" JSONB,
  "webLink" TEXT,
  "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
  "messageAt" TIMESTAMP(3) NOT NULL,
  "matchCandidates" JSONB,
  "draftSource" TEXT,
  "draftRationale" TEXT,
  "suggestedNextAction" TEXT,
  "suggestedFollowUpOn" DATE,
  "basedOnMessageId" TEXT,
  "createdByUserId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "sentByUserId" TEXT,
  "sentAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebsiteInboundEmailMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteInboundEmailMessage_tenantId_mailboxAddress_graphMes_key"
  ON "WebsiteInboundEmailMessage"("tenantId", "mailboxAddress", "graphMessageId");
CREATE UNIQUE INDEX "WebsiteInboundEmailMessage_tenantId_id_key"
  ON "WebsiteInboundEmailMessage"("tenantId", "id");
CREATE INDEX "WebsiteInboundEmailMessage_tenantId_submissionId_messageAt_idx"
  ON "WebsiteInboundEmailMessage"("tenantId", "submissionId", "messageAt");
CREATE INDEX "WebsiteInboundEmailMessage_tenantId_mailboxAddress_conversa_idx"
  ON "WebsiteInboundEmailMessage"("tenantId", "mailboxAddress", "conversationId");
CREATE INDEX "WebsiteInboundEmailMessage_tenantId_status_messageAt_idx"
  ON "WebsiteInboundEmailMessage"("tenantId", "status", "messageAt");

ALTER TABLE "WebsiteInboundEmailMessage"
  ADD CONSTRAINT "WebsiteInboundEmailMessage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebsiteInboundEmailMessage"
  ADD CONSTRAINT "WebsiteInboundEmailMessage_tenantId_submissionId_fkey"
  FOREIGN KEY ("tenantId", "submissionId") REFERENCES "WebsiteInboundSubmission"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
