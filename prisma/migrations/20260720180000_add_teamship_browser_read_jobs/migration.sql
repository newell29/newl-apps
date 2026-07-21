-- CreateTable
CREATE TABLE "TeamshipBrowserReadJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "operation" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "scope" JSONB NOT NULL,
    "requestedBy" JSONB NOT NULL,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamshipBrowserReadJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamshipBrowserReadJob_tenantId_status_createdAt_idx" ON "TeamshipBrowserReadJob"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TeamshipBrowserReadJob_tenantId_operation_createdAt_idx" ON "TeamshipBrowserReadJob"("tenantId", "operation", "createdAt");

-- CreateIndex
CREATE INDEX "TeamshipBrowserReadJob_expiresAt_idx" ON "TeamshipBrowserReadJob"("expiresAt");

-- AddForeignKey
ALTER TABLE "TeamshipBrowserReadJob" ADD CONSTRAINT "TeamshipBrowserReadJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
