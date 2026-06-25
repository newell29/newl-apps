-- CreateEnum
CREATE TYPE "ApolloCompanyMatchClassification" AS ENUM ('DIRECT_COMPANY', 'MATCH_QUALITY_REVIEW', 'LOGISTICS_PROVIDER', 'NO_MATCH');

-- CreateTable
CREATE TABLE "ApolloCompanyMatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "apolloOrganizationId" TEXT,
    "apolloCompanyName" TEXT,
    "apolloDomain" TEXT,
    "apolloLinkedinUrl" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "classification" "ApolloCompanyMatchClassification" NOT NULL,
    "nameMatchType" TEXT,
    "domainMatch" BOOLEAN NOT NULL DEFAULT false,
    "logisticsProviderMatch" BOOLEAN NOT NULL DEFAULT false,
    "branchLocationMatch" BOOLEAN NOT NULL DEFAULT false,
    "matchReason" TEXT,
    "queryJson" JSONB,
    "rawJson" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApolloCompanyMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApolloCompanyMatch_tenantId_companyId_createdAt_idx" ON "ApolloCompanyMatch"("tenantId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ApolloCompanyMatch_tenantId_classification_idx" ON "ApolloCompanyMatch"("tenantId", "classification");

-- CreateIndex
CREATE INDEX "ApolloCompanyMatch_tenantId_apolloOrganizationId_idx" ON "ApolloCompanyMatch"("tenantId", "apolloOrganizationId");

-- AddForeignKey
ALTER TABLE "ApolloCompanyMatch" ADD CONSTRAINT "ApolloCompanyMatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApolloCompanyMatch" ADD CONSTRAINT "ApolloCompanyMatch_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
