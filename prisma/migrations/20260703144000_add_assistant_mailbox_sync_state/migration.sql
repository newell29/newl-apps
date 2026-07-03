CREATE TABLE "AssistantMailboxSyncState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mailboxAddress" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'MICROSOFT_GRAPH_MAIL',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastSuccessfulReceivedAt" TIMESTAMP(3),
    "lastAttemptedLookbackDays" INTEGER,
    "lastAttemptedMaxMessages" INTEGER,
    "lastMessageCount" INTEGER NOT NULL DEFAULT 0,
    "totalMessageCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantMailboxSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantMailboxSyncState_tenantId_sourceSystem_mailboxAddress_key" ON "AssistantMailboxSyncState"("tenantId", "sourceSystem", "mailboxAddress");
CREATE INDEX "AssistantMailboxSyncState_tenantId_status_updatedAt_idx" ON "AssistantMailboxSyncState"("tenantId", "status", "updatedAt");
CREATE INDEX "AssistantMailboxSyncState_tenantId_mailboxAddress_idx" ON "AssistantMailboxSyncState"("tenantId", "mailboxAddress");

ALTER TABLE "AssistantMailboxSyncState" ADD CONSTRAINT "AssistantMailboxSyncState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
