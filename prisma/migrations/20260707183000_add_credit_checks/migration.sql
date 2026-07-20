CREATE TYPE "CreditCheckStatus" AS ENUM ('NEW', 'IN_REVIEW', 'REFERENCES_CONTACTED', 'APPROVED', 'DECLINED', 'MORE_INFO_NEEDED');

CREATE TABLE "CreditCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "CreditCheckStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT,
    "pageUrl" TEXT,
    "legalCompanyName" TEXT,
    "operatingName" TEXT,
    "company" TEXT,
    "mainPhone" TEXT,
    "primaryContactName" TEXT,
    "primaryContactEmail" TEXT,
    "accountsPayableEmail" TEXT,
    "requestedCreditLimit" TEXT,
    "approvedCreditLimit" TEXT,
    "services" JSONB,
    "tradeReferences" JSONB,
    "fields" JSONB NOT NULL,
    "referencesContacted" BOOLEAN NOT NULL DEFAULT false,
    "referenceNotes" TEXT,
    "internalNotes" TEXT,
    "reviewedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "CreditCheck_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CreditCheck" ADD CONSTRAINT "CreditCheck_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CreditCheck_tenantId_createdAt_idx" ON "CreditCheck"("tenantId", "createdAt");
CREATE INDEX "CreditCheck_tenantId_status_idx" ON "CreditCheck"("tenantId", "status");
CREATE INDEX "CreditCheck_tenantId_company_idx" ON "CreditCheck"("tenantId", "company");
