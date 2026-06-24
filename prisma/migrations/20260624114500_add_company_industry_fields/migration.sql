ALTER TABLE "Company"
ADD COLUMN "primaryIndustry" TEXT,
ADD COLUMN "secondaryIndustry" TEXT,
ADD COLUMN "industryConfidence" INTEGER,
ADD COLUMN "industrySource" TEXT;

CREATE INDEX "Company_tenantId_primaryIndustry_idx" ON "Company"("tenantId", "primaryIndustry");
