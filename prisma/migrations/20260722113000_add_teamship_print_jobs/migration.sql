-- CreateTable
CREATE TABLE "TeamshipPrintJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shippingOrderNumber" TEXT NOT NULL,
    "teamshipOrderId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "documentPlan" JSONB NOT NULL,
    "printerPlan" JSONB NOT NULL,
    "approvedPalletCount" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "activeOrderKey" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamshipPrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamshipPrintJob_tenantId_idempotencyKey_key" ON "TeamshipPrintJob"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TeamshipPrintJob_tenantId_activeOrderKey_key" ON "TeamshipPrintJob"("tenantId", "activeOrderKey");

-- CreateIndex
CREATE INDEX "TeamshipPrintJob_tenantId_status_createdAt_idx" ON "TeamshipPrintJob"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TeamshipPrintJob_tenantId_shippingOrderNumber_createdAt_idx" ON "TeamshipPrintJob"("tenantId", "shippingOrderNumber", "createdAt");

-- CreateIndex
CREATE INDEX "TeamshipPrintJob_tenantId_requestedByUserId_createdAt_idx" ON "TeamshipPrintJob"("tenantId", "requestedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamshipPrintJob_expiresAt_idx" ON "TeamshipPrintJob"("expiresAt");

-- AddForeignKey
ALTER TABLE "TeamshipPrintJob" ADD CONSTRAINT "TeamshipPrintJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipPrintJob" ADD CONSTRAINT "TeamshipPrintJob_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamshipPrintJob" ADD CONSTRAINT "TeamshipPrintJob_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
