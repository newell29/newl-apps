-- Add tenant-scoped company assistant foundations.
ALTER TYPE "ModuleKey" ADD VALUE 'ASSISTANT';

ALTER TYPE "IntegrationProvider" ADD VALUE 'MICROSOFT_GRAPH';
ALTER TYPE "IntegrationProvider" ADD VALUE 'TMS';
ALTER TYPE "IntegrationProvider" ADD VALUE 'WMS';

CREATE TYPE "AssistantMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

CREATE TYPE "AssistantSourceKind" AS ENUM (
  'COMPANY',
  'CONTACT',
  'LEAD',
  'TRADEMINING_RECORD',
  'RATE_TOOL',
  'EMAIL',
  'ONEDRIVE_FILE',
  'TMS_RECORD',
  'WMS_RECORD',
  'INTEGRATION',
  'MANUAL',
  'OTHER'
);

CREATE TYPE "AssistantMemoryKind" AS ENUM (
  'CUSTOMER_PROFILE',
  'SERVICE_CAPABILITY',
  'SALES_OPPORTUNITY',
  'OPERATIONAL_RISK',
  'RATE_CONTEXT',
  'USER_PREFERENCE',
  'TENANT_FACT'
);

CREATE TABLE "AssistantChatThread" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastMessageAt" TIMESTAMP(3),
  CONSTRAINT "AssistantChatThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantChatMessage" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "role" "AssistantMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantRun" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "threadId" TEXT,
  "messageId" TEXT,
  "userId" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "status" "JobStatus" NOT NULL,
  "intent" TEXT,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "estimatedCost" DECIMAL(12,6),
  "metadata" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantRetrievedSource" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceKind" "AssistantSourceKind" NOT NULL,
  "sourceId" TEXT,
  "title" TEXT NOT NULL,
  "excerpt" TEXT,
  "score" DECIMAL(8,4),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantRetrievedSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantKnowledgeDocument" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceKind" "AssistantSourceKind" NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "externalId" TEXT,
  "title" TEXT NOT NULL,
  "canonicalUrl" TEXT,
  "contentHash" TEXT,
  "sourceUpdatedAt" TIMESTAMP(3),
  "indexedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantKnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantKnowledgeChunk" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "contentText" TEXT NOT NULL,
  "contentSummary" TEXT,
  "embeddingRef" TEXT,
  "tokenCount" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantMemory" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" "AssistantMemoryKind" NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL DEFAULT 50,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "sourceDocumentId" TEXT,
  "sourceRunId" TEXT,
  "lastObservedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantChatThread_tenantId_id_key" ON "AssistantChatThread"("tenantId", "id");
CREATE INDEX "AssistantChatThread_tenantId_userId_updatedAt_idx" ON "AssistantChatThread"("tenantId", "userId", "updatedAt");
CREATE INDEX "AssistantChatThread_tenantId_status_updatedAt_idx" ON "AssistantChatThread"("tenantId", "status", "updatedAt");

CREATE INDEX "AssistantChatMessage_tenantId_threadId_createdAt_idx" ON "AssistantChatMessage"("tenantId", "threadId", "createdAt");
CREATE INDEX "AssistantChatMessage_tenantId_role_idx" ON "AssistantChatMessage"("tenantId", "role");

CREATE UNIQUE INDEX "AssistantRun_tenantId_id_key" ON "AssistantRun"("tenantId", "id");
CREATE INDEX "AssistantRun_tenantId_status_startedAt_idx" ON "AssistantRun"("tenantId", "status", "startedAt");
CREATE INDEX "AssistantRun_tenantId_userId_startedAt_idx" ON "AssistantRun"("tenantId", "userId", "startedAt");
CREATE INDEX "AssistantRun_tenantId_threadId_startedAt_idx" ON "AssistantRun"("tenantId", "threadId", "startedAt");

CREATE INDEX "AssistantRetrievedSource_tenantId_runId_idx" ON "AssistantRetrievedSource"("tenantId", "runId");
CREATE INDEX "AssistantRetrievedSource_tenantId_sourceKind_sourceId_idx" ON "AssistantRetrievedSource"("tenantId", "sourceKind", "sourceId");

CREATE UNIQUE INDEX "AssistantKnowledgeDocument_tenantId_id_key" ON "AssistantKnowledgeDocument"("tenantId", "id");
CREATE UNIQUE INDEX "AssistantKnowledgeDocument_tenantId_sourceSystem_externalId_key" ON "AssistantKnowledgeDocument"("tenantId", "sourceSystem", "externalId");
CREATE INDEX "AssistantKnowledgeDocument_tenantId_sourceKind_idx" ON "AssistantKnowledgeDocument"("tenantId", "sourceKind");
CREATE INDEX "AssistantKnowledgeDocument_tenantId_sourceSystem_idx" ON "AssistantKnowledgeDocument"("tenantId", "sourceSystem");
CREATE INDEX "AssistantKnowledgeDocument_tenantId_indexedAt_idx" ON "AssistantKnowledgeDocument"("tenantId", "indexedAt");

CREATE UNIQUE INDEX "AssistantKnowledgeChunk_tenantId_documentId_chunkIndex_key" ON "AssistantKnowledgeChunk"("tenantId", "documentId", "chunkIndex");
CREATE INDEX "AssistantKnowledgeChunk_tenantId_documentId_idx" ON "AssistantKnowledgeChunk"("tenantId", "documentId");
CREATE INDEX "AssistantKnowledgeChunk_tenantId_embeddingRef_idx" ON "AssistantKnowledgeChunk"("tenantId", "embeddingRef");

CREATE INDEX "AssistantMemory_tenantId_kind_idx" ON "AssistantMemory"("tenantId", "kind");
CREATE INDEX "AssistantMemory_tenantId_subjectType_subjectId_idx" ON "AssistantMemory"("tenantId", "subjectType", "subjectId");
CREATE INDEX "AssistantMemory_tenantId_status_updatedAt_idx" ON "AssistantMemory"("tenantId", "status", "updatedAt");

ALTER TABLE "AssistantChatThread" ADD CONSTRAINT "AssistantChatThread_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantChatThread" ADD CONSTRAINT "AssistantChatThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantChatMessage" ADD CONSTRAINT "AssistantChatMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantChatMessage" ADD CONSTRAINT "AssistantChatMessage_tenantId_threadId_fkey" FOREIGN KEY ("tenantId", "threadId") REFERENCES "AssistantChatThread"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantRun" ADD CONSTRAINT "AssistantRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantRun" ADD CONSTRAINT "AssistantRun_tenantId_threadId_fkey" FOREIGN KEY ("tenantId", "threadId") REFERENCES "AssistantChatThread"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantRun" ADD CONSTRAINT "AssistantRun_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssistantRun" ADD CONSTRAINT "AssistantRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantRetrievedSource" ADD CONSTRAINT "AssistantRetrievedSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantRetrievedSource" ADD CONSTRAINT "AssistantRetrievedSource_tenantId_runId_fkey" FOREIGN KEY ("tenantId", "runId") REFERENCES "AssistantRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantKnowledgeDocument" ADD CONSTRAINT "AssistantKnowledgeDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantKnowledgeChunk" ADD CONSTRAINT "AssistantKnowledgeChunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantKnowledgeChunk" ADD CONSTRAINT "AssistantKnowledgeChunk_tenantId_documentId_fkey" FOREIGN KEY ("tenantId", "documentId") REFERENCES "AssistantKnowledgeDocument"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantMemory" ADD CONSTRAINT "AssistantMemory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantMemory" ADD CONSTRAINT "AssistantMemory_tenantId_sourceDocumentId_fkey" FOREIGN KEY ("tenantId", "sourceDocumentId") REFERENCES "AssistantKnowledgeDocument"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "AssistantMemory" ADD CONSTRAINT "AssistantMemory_tenantId_sourceRunId_fkey" FOREIGN KEY ("tenantId", "sourceRunId") REFERENCES "AssistantRun"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
