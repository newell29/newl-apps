-- CreateEnum
CREATE TYPE "CustomerIntelligenceServiceLine" AS ENUM ('OCEAN', 'AIR', 'TRUCKING_DRAYAGE', 'LOCAL_TRUCKING', 'WAREHOUSING_FULFILLMENT', 'CUSTOMS_BROKERAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerLifecycle" AS ENUM ('PROSPECT', 'ACTIVE_CUSTOMER', 'DORMANT_CUSTOMER', 'FORMER_CUSTOMER');

-- CreateEnum
CREATE TYPE "CompanyOperatingRelationshipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CustomerSourceAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContactPointType" AS ENUM ('EMAIL', 'PHONE', 'WEBSITE', 'ADDRESS', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactPointVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContactEvidenceSourceType" AS ENUM ('EMAIL_SIGNATURE', 'QUICKBOOKS', 'MANUAL', 'APOLLO', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactEvidenceReviewStatus" AS ENUM ('UNREVIEWED', 'ACCEPTED', 'REJECTED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "CustomerIdentityMatchKind" AS ENUM ('QUICKBOOKS_ACCOUNT', 'EMAIL_DOMAIN', 'COMPANY_ALIAS', 'CONTACT');

-- CreateEnum
CREATE TYPE "CustomerIdentityMatchStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QuickBooksServiceMappingDimension" AS ENUM ('ITEM', 'CLASS', 'DEPARTMENT', 'INCOME_ACCOUNT', 'FILE_PREFIX', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerFxRateStatus" AS ENUM ('PROVISIONAL', 'FINAL');

-- CreateEnum
CREATE TYPE "CustomerFinancialPeriodStatus" AS ENUM ('RECONCILED', 'INCOMPLETE', 'UNRECONCILED');

-- AlterEnum
ALTER TYPE "ModuleKey" ADD VALUE 'CUSTOMER_INTELLIGENCE';

-- CreateTable
CREATE TABLE "OperatingCompany" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "homeCurrency" TEXT NOT NULL DEFAULT 'CAD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "quickBooksRealmId" TEXT,
    "quickBooksCredentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyOperatingRelationship" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "operatingCompanyId" TEXT NOT NULL,
    "lifecycle" "CustomerLifecycle" NOT NULL DEFAULT 'PROSPECT',
    "status" "CompanyOperatingRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstRevenueDate" TIMESTAMP(3),
    "lastRevenueDate" TIMESTAMP(3),
    "assignedOwnerUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyOperatingRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSourceAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "quickBooksCustomerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "operatingCompanyId" TEXT NOT NULL,
    "companyOperatingRelationshipId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" "CustomerSourceAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "email" TEXT,
    "phone" TEXT,
    "billingAddress" JSONB,
    "shippingAddress" JSONB,
    "parentQuickBooksCustomerId" TEXT,
    "contactDetails" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSourceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ContactPointType" NOT NULL,
    "value" TEXT NOT NULL,
    "displayValue" TEXT,
    "label" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" "ContactPointVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" "ContactEvidenceSourceType" NOT NULL,
    "sourceRecordKey" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "parserVersion" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "reviewStatus" "ContactEvidenceReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "evidenceFragment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerIdentityMatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "CustomerIdentityMatchKind" NOT NULL,
    "companyId" TEXT,
    "sourceRecordKey" TEXT,
    "sourceLabel" TEXT,
    "candidateCompanyId" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "CustomerIdentityMatchStatus" NOT NULL DEFAULT 'PROPOSED',
    "evidence" JSONB,
    "reviewerUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerIdentityMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBooksServiceMappingRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operatingCompanyId" TEXT NOT NULL,
    "dimension" "QuickBooksServiceMappingDimension" NOT NULL,
    "matchValue" TEXT NOT NULL,
    "serviceLine" "CustomerIntelligenceServiceLine" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reviewerUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksServiceMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFxRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "rateToCad" DECIMAL(12,6) NOT NULL,
    "status" "CustomerFxRateStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "source" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRevenueLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceAccountId" TEXT,
    "companyId" TEXT NOT NULL,
    "operatingCompanyId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "transactionType" TEXT NOT NULL,
    "transactionNumber" TEXT,
    "accountRef" TEXT,
    "classRef" TEXT,
    "itemRef" TEXT,
    "fileRef" TEXT,
    "serviceLine" "CustomerIntelligenceServiceLine" NOT NULL,
    "nativeAmount" DECIMAL(14,2) NOT NULL,
    "nativeCurrency" TEXT NOT NULL,
    "homeAmount" DECIMAL(14,2) NOT NULL,
    "homeCurrency" TEXT NOT NULL,
    "cadAmount" DECIMAL(14,2),
    "fxSource" TEXT,
    "syncMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRevenueLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMonthlyFinancial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "operatingCompanyId" TEXT NOT NULL,
    "companyOperatingRelationshipId" TEXT NOT NULL,
    "sourceAccountId" TEXT,
    "sourceAccountKey" TEXT NOT NULL DEFAULT 'ALL',
    "serviceLine" "CustomerIntelligenceServiceLine" NOT NULL,
    "currency" TEXT NOT NULL,
    "nativeRevenue" DECIMAL(14,2) NOT NULL,
    "nativeCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "nativeGrossProfit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cadRevenue" DECIMAL(14,2),
    "reconciliationStatus" "CustomerFinancialPeriodStatus" NOT NULL DEFAULT 'UNRECONCILED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMonthlyFinancial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperatingCompany_tenantId_active_idx" ON "OperatingCompany"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "OperatingCompany_tenantId_id_key" ON "OperatingCompany"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OperatingCompany_tenantId_slug_key" ON "OperatingCompany"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "CompanyOperatingRelationship_tenantId_companyId_idx" ON "CompanyOperatingRelationship"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "CompanyOperatingRelationship_tenantId_operatingCompanyId_idx" ON "CompanyOperatingRelationship"("tenantId", "operatingCompanyId");

-- CreateIndex
CREATE INDEX "CompanyOperatingRelationship_tenantId_lifecycle_idx" ON "CompanyOperatingRelationship"("tenantId", "lifecycle");

-- CreateIndex
CREATE INDEX "CompanyOperatingRelationship_tenantId_status_idx" ON "CompanyOperatingRelationship"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyOperatingRelationship_tenantId_id_key" ON "CompanyOperatingRelationship"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyOperatingRelationship_tenantId_companyId_operatingCo_key" ON "CompanyOperatingRelationship"("tenantId", "companyId", "operatingCompanyId");

-- CreateIndex
CREATE INDEX "CustomerSourceAccount_tenantId_companyId_idx" ON "CustomerSourceAccount"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "CustomerSourceAccount_tenantId_operatingCompanyId_idx" ON "CustomerSourceAccount"("tenantId", "operatingCompanyId");

-- CreateIndex
CREATE INDEX "CustomerSourceAccount_tenantId_companyOperatingRelationship_idx" ON "CustomerSourceAccount"("tenantId", "companyOperatingRelationshipId");

-- CreateIndex
CREATE INDEX "CustomerSourceAccount_tenantId_active_idx" ON "CustomerSourceAccount"("tenantId", "active");

-- CreateIndex
CREATE INDEX "CustomerSourceAccount_tenantId_currency_idx" ON "CustomerSourceAccount"("tenantId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSourceAccount_tenantId_id_key" ON "CustomerSourceAccount"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSourceAccount_tenantId_realmId_quickBooksCustomerId_key" ON "CustomerSourceAccount"("tenantId", "realmId", "quickBooksCustomerId");

-- CreateIndex
CREATE INDEX "ContactPoint_tenantId_companyId_idx" ON "ContactPoint"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "ContactPoint_tenantId_contactId_idx" ON "ContactPoint"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "ContactPoint_tenantId_type_idx" ON "ContactPoint"("tenantId", "type");

-- CreateIndex
CREATE INDEX "ContactPoint_tenantId_primary_idx" ON "ContactPoint"("tenantId", "primary");

-- CreateIndex
CREATE INDEX "ContactPoint_tenantId_verificationStatus_idx" ON "ContactPoint"("tenantId", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPoint_tenantId_id_key" ON "ContactPoint"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPoint_tenantId_contactId_type_value_key" ON "ContactPoint"("tenantId", "contactId", "type", "value");

-- CreateIndex
CREATE INDEX "ContactEvidence_tenantId_contactId_idx" ON "ContactEvidence"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "ContactEvidence_tenantId_companyId_idx" ON "ContactEvidence"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "ContactEvidence_tenantId_sourceType_idx" ON "ContactEvidence"("tenantId", "sourceType");

-- CreateIndex
CREATE INDEX "ContactEvidence_tenantId_reviewStatus_idx" ON "ContactEvidence"("tenantId", "reviewStatus");

-- CreateIndex
CREATE INDEX "ContactEvidence_tenantId_observedAt_idx" ON "ContactEvidence"("tenantId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEvidence_tenantId_id_key" ON "ContactEvidence"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEvidence_tenantId_contactId_sourceRecordKey_fieldNam_key" ON "ContactEvidence"("tenantId", "contactId", "sourceRecordKey", "fieldName");

-- CreateIndex
CREATE INDEX "CustomerIdentityMatch_tenantId_status_idx" ON "CustomerIdentityMatch"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CustomerIdentityMatch_tenantId_kind_idx" ON "CustomerIdentityMatch"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "CustomerIdentityMatch_tenantId_companyId_idx" ON "CustomerIdentityMatch"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "CustomerIdentityMatch_tenantId_score_idx" ON "CustomerIdentityMatch"("tenantId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerIdentityMatch_tenantId_id_key" ON "CustomerIdentityMatch"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerIdentityMatch_tenantId_kind_companyId_sourceRecordK_key" ON "CustomerIdentityMatch"("tenantId", "kind", "companyId", "sourceRecordKey");

-- CreateIndex
CREATE INDEX "QuickBooksServiceMappingRule_tenantId_operatingCompanyId_ac_idx" ON "QuickBooksServiceMappingRule"("tenantId", "operatingCompanyId", "active");

-- CreateIndex
CREATE INDEX "QuickBooksServiceMappingRule_tenantId_serviceLine_idx" ON "QuickBooksServiceMappingRule"("tenantId", "serviceLine");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksServiceMappingRule_tenantId_id_key" ON "QuickBooksServiceMappingRule"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksServiceMappingRule_tenantId_operatingCompanyId_di_key" ON "QuickBooksServiceMappingRule"("tenantId", "operatingCompanyId", "dimension", "matchValue");

-- CreateIndex
CREATE INDEX "CustomerFxRate_tenantId_currency_idx" ON "CustomerFxRate"("tenantId", "currency");

-- CreateIndex
CREATE INDEX "CustomerFxRate_tenantId_status_idx" ON "CustomerFxRate"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFxRate_tenantId_id_key" ON "CustomerFxRate"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFxRate_tenantId_currency_monthKey_key" ON "CustomerFxRate"("tenantId", "currency", "monthKey");

-- CreateIndex
CREATE INDEX "CustomerRevenueLine_tenantId_companyId_idx" ON "CustomerRevenueLine"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "CustomerRevenueLine_tenantId_sourceAccountId_idx" ON "CustomerRevenueLine"("tenantId", "sourceAccountId");

-- CreateIndex
CREATE INDEX "CustomerRevenueLine_tenantId_operatingCompanyId_idx" ON "CustomerRevenueLine"("tenantId", "operatingCompanyId");

-- CreateIndex
CREATE INDEX "CustomerRevenueLine_tenantId_transactionDate_idx" ON "CustomerRevenueLine"("tenantId", "transactionDate");

-- CreateIndex
CREATE INDEX "CustomerRevenueLine_tenantId_serviceLine_idx" ON "CustomerRevenueLine"("tenantId", "serviceLine");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRevenueLine_tenantId_id_key" ON "CustomerRevenueLine"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRevenueLine_tenantId_sourceKey_key" ON "CustomerRevenueLine"("tenantId", "sourceKey");

-- CreateIndex
CREATE INDEX "CustomerMonthlyFinancial_tenantId_companyId_idx" ON "CustomerMonthlyFinancial"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "CustomerMonthlyFinancial_tenantId_operatingCompanyId_idx" ON "CustomerMonthlyFinancial"("tenantId", "operatingCompanyId");

-- CreateIndex
CREATE INDEX "CustomerMonthlyFinancial_tenantId_sourceAccountId_idx" ON "CustomerMonthlyFinancial"("tenantId", "sourceAccountId");

-- CreateIndex
CREATE INDEX "CustomerMonthlyFinancial_tenantId_monthKey_idx" ON "CustomerMonthlyFinancial"("tenantId", "monthKey");

-- CreateIndex
CREATE INDEX "CustomerMonthlyFinancial_tenantId_serviceLine_idx" ON "CustomerMonthlyFinancial"("tenantId", "serviceLine");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMonthlyFinancial_tenantId_id_key" ON "CustomerMonthlyFinancial"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMonthlyFinancial_tenantId_companyOperatingRelations_key" ON "CustomerMonthlyFinancial"("tenantId", "companyOperatingRelationshipId", "sourceAccountKey", "serviceLine", "currency", "monthKey");

-- AddForeignKey
ALTER TABLE "OperatingCompany" ADD CONSTRAINT "OperatingCompany_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyOperatingRelationship" ADD CONSTRAINT "CompanyOperatingRelationship_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyOperatingRelationship" ADD CONSTRAINT "CompanyOperatingRelationship_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyOperatingRelationship" ADD CONSTRAINT "CompanyOperatingRelationship_tenantId_operatingCompanyId_fkey" FOREIGN KEY ("tenantId", "operatingCompanyId") REFERENCES "OperatingCompany"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSourceAccount" ADD CONSTRAINT "CustomerSourceAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSourceAccount" ADD CONSTRAINT "CustomerSourceAccount_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSourceAccount" ADD CONSTRAINT "CustomerSourceAccount_tenantId_operatingCompanyId_fkey" FOREIGN KEY ("tenantId", "operatingCompanyId") REFERENCES "OperatingCompany"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSourceAccount" ADD CONSTRAINT "CustomerSourceAccount_tenantId_companyOperatingRelationshi_fkey" FOREIGN KEY ("tenantId", "companyOperatingRelationshipId") REFERENCES "CompanyOperatingRelationship"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_tenantId_companyId_contactId_fkey" FOREIGN KEY ("tenantId", "companyId", "contactId") REFERENCES "Contact"("tenantId", "companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_tenantId_companyId_contactId_fkey" FOREIGN KEY ("tenantId", "companyId", "contactId") REFERENCES "Contact"("tenantId", "companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerIdentityMatch" ADD CONSTRAINT "CustomerIdentityMatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksServiceMappingRule" ADD CONSTRAINT "QuickBooksServiceMappingRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBooksServiceMappingRule" ADD CONSTRAINT "QuickBooksServiceMappingRule_tenantId_operatingCompanyId_fkey" FOREIGN KEY ("tenantId", "operatingCompanyId") REFERENCES "OperatingCompany"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFxRate" ADD CONSTRAINT "CustomerFxRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRevenueLine" ADD CONSTRAINT "CustomerRevenueLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRevenueLine" ADD CONSTRAINT "CustomerRevenueLine_tenantId_sourceAccountId_fkey" FOREIGN KEY ("tenantId", "sourceAccountId") REFERENCES "CustomerSourceAccount"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRevenueLine" ADD CONSTRAINT "CustomerRevenueLine_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRevenueLine" ADD CONSTRAINT "CustomerRevenueLine_tenantId_operatingCompanyId_fkey" FOREIGN KEY ("tenantId", "operatingCompanyId") REFERENCES "OperatingCompany"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMonthlyFinancial" ADD CONSTRAINT "CustomerMonthlyFinancial_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMonthlyFinancial" ADD CONSTRAINT "CustomerMonthlyFinancial_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMonthlyFinancial" ADD CONSTRAINT "CustomerMonthlyFinancial_tenantId_operatingCompanyId_fkey" FOREIGN KEY ("tenantId", "operatingCompanyId") REFERENCES "OperatingCompany"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMonthlyFinancial" ADD CONSTRAINT "CustomerMonthlyFinancial_tenantId_companyOperatingRelation_fkey" FOREIGN KEY ("tenantId", "companyOperatingRelationshipId") REFERENCES "CompanyOperatingRelationship"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMonthlyFinancial" ADD CONSTRAINT "CustomerMonthlyFinancial_tenantId_sourceAccountId_fkey" FOREIGN KEY ("tenantId", "sourceAccountId") REFERENCES "CustomerSourceAccount"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

