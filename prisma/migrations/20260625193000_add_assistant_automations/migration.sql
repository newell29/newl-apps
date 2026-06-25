-- CreateTable
CREATE TABLE "AssistantAutomation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "scheduleType" TEXT NOT NULL,
  "scheduleTime" TEXT NOT NULL,
  "scheduleTimezone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "lastResultSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssistantAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantAutomationRun" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "JobStatus" NOT NULL,
  "promptSnapshot" TEXT NOT NULL,
  "responseText" TEXT NOT NULL,
  "sourceCount" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssistantAutomation_tenantId_id_key" ON "AssistantAutomation"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AssistantAutomation_tenantId_userId_status_updatedAt_idx" ON "AssistantAutomation"("tenantId", "userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AssistantAutomationRun_tenantId_automationId_startedAt_idx" ON "AssistantAutomationRun"("tenantId", "automationId", "startedAt");

-- CreateIndex
CREATE INDEX "AssistantAutomationRun_tenantId_userId_startedAt_idx" ON "AssistantAutomationRun"("tenantId", "userId", "startedAt");

-- AddForeignKey
ALTER TABLE "AssistantAutomation" ADD CONSTRAINT "AssistantAutomation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAutomation" ADD CONSTRAINT "AssistantAutomation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAutomationRun" ADD CONSTRAINT "AssistantAutomationRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAutomationRun" ADD CONSTRAINT "AssistantAutomationRun_tenantId_automationId_fkey" FOREIGN KEY ("tenantId", "automationId") REFERENCES "AssistantAutomation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAutomationRun" ADD CONSTRAINT "AssistantAutomationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
