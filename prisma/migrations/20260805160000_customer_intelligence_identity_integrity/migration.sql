-- Customer Intelligence identity integrity
--
-- 1. Tenant-scoped foreign keys for the canonical and candidate companies so a
--    match can never reference a company outside its tenant. Delete behavior is
--    ON DELETE NO ACTION (non-destructive): a Company referenced by an identity
--    match cannot be deleted while the match exists, preserving review evidence
--    instead of silently cascading. (Repository precedent for NO ACTION exists,
--    e.g. CustomerRevenueLine.sourceAccount.)
-- 2. Every APPROVED match must carry a canonical companyId.
-- 3. An APPROVED QUICKBOOKS_ACCOUNT match must carry an operatingCompanyId.
-- 4. The existing one-approved-target partial unique index
--    (CustomerIdentityMatch_one_approved_per_source_key) is preserved.

-- AddForeignKey
ALTER TABLE "CustomerIdentityMatch" ADD CONSTRAINT "CustomerIdentityMatch_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerIdentityMatch" ADD CONSTRAINT "CustomerIdentityMatch_tenantId_candidateCompanyId_fkey" FOREIGN KEY ("tenantId", "candidateCompanyId") REFERENCES "Company"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- An APPROVED match always names a canonical company.
ALTER TABLE "CustomerIdentityMatch"
ADD CONSTRAINT "CustomerIdentityMatch_approved_requires_company"
CHECK ("status" <> 'APPROVED' OR "companyId" IS NOT NULL);

-- An APPROVED QuickBooks-account match always names an operating company.
ALTER TABLE "CustomerIdentityMatch"
ADD CONSTRAINT "CustomerIdentityMatch_qb_approved_requires_operating_company"
CHECK ("status" <> 'APPROVED' OR "kind" <> 'QUICKBOOKS_ACCOUNT' OR "operatingCompanyId" IS NOT NULL);
