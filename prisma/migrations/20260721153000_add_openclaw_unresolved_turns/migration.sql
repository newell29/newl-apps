-- Keep only unresolved OpenClaw turns. A PENDING row is created when an
-- authenticated Teams message arrives, deleted after successful delivery,
-- and retained as OPEN when the model, tool, or delivery path fails.
CREATE TABLE "OpenClawUnresolvedTurn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'msteams',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureKind" TEXT,
    "promptText" TEXT NOT NULL,
    "promptFingerprint" TEXT NOT NULL,
    "responseText" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "toolName" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "externalMessageIdHash" TEXT,
    "externalConversationIdHash" TEXT,
    "sessionKeyHash" TEXT,
    "toolCallIdHash" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenClawUnresolvedTurn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpenClawUnresolvedTurn_tenantId_runId_key"
ON "OpenClawUnresolvedTurn"("tenantId", "runId");

CREATE INDEX "OpenClawUnresolvedTurn_tenantId_status_detectedAt_idx"
ON "OpenClawUnresolvedTurn"("tenantId", "status", "detectedAt");

CREATE INDEX "OpenClawUnresolvedTurn_tenantId_promptFingerprint_detectedAt_idx"
ON "OpenClawUnresolvedTurn"("tenantId", "promptFingerprint", "detectedAt");

CREATE INDEX "OpenClawUnresolvedTurn_tenantId_userId_detectedAt_idx"
ON "OpenClawUnresolvedTurn"("tenantId", "userId", "detectedAt");

ALTER TABLE "OpenClawUnresolvedTurn"
ADD CONSTRAINT "OpenClawUnresolvedTurn_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpenClawUnresolvedTurn"
ADD CONSTRAINT "OpenClawUnresolvedTurn_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
