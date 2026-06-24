-- AlterTable
ALTER TABLE "TradeMiningSearchProfile"
ADD COLUMN "allowedCompanyIdentityRoles" JSONB,
ADD COLUMN "excludedCompanyKeywords" JSONB;
