ALTER TABLE "Company"
ADD COLUMN "linkedinUrl" TEXT;

CREATE INDEX "Company_tenantId_linkedinUrl_idx" ON "Company"("tenantId", "linkedinUrl");
