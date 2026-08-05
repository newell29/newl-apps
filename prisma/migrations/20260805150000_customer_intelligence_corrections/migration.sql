-- Customer Intelligence corrections
--
-- 1. Represent open AR (native + consolidated CAD) on the materialized monthly
--    financial record so the 12-month lifecycle rule can test open AR.
-- 2. Scope QUICKBOOKS_ACCOUNT identity matches to an operating company so a
--    mapping under one operating company cannot activate another.
-- 3. Preserve accepted contact facts when a later extraction conflicts.
-- 4. Enforce at the database level that one (tenantId, kind, sourceRecordKey)
--    can be APPROVED to at most one canonical company.
-- 5. Bootstrap the Customer Intelligence module, the Newl tenant entitlement,
--    and the three Newl operating companies without depending on the broad
--    development seed. Unrelated tenants are intentionally not enabled.

-- AlterTable
ALTER TABLE "ContactEvidence" ADD COLUMN     "conflictingValue" TEXT;

-- AlterTable
ALTER TABLE "CustomerIdentityMatch" ADD COLUMN     "operatingCompanyId" TEXT;

-- AlterTable
ALTER TABLE "CustomerMonthlyFinancial" ADD COLUMN     "cadOpenAr" DECIMAL(14,2),
ADD COLUMN     "nativeOpenAr" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "CustomerIdentityMatch_tenantId_operatingCompanyId_idx" ON "CustomerIdentityMatch"("tenantId", "operatingCompanyId");

-- AddForeignKey
ALTER TABLE "CustomerIdentityMatch" ADD CONSTRAINT "CustomerIdentityMatch_tenantId_operatingCompanyId_fkey" FOREIGN KEY ("tenantId", "operatingCompanyId") REFERENCES "OperatingCompany"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- One APPROVED canonical target per (tenantId, kind, sourceRecordKey). Both
-- automatic and manual approval paths must enforce this invariant in code as
-- well; this index is the database-backed backstop and makes concurrent or
-- repeated processing unable to produce two approved canonical targets.
CREATE UNIQUE INDEX "CustomerIdentityMatch_one_approved_per_source_key"
  ON "CustomerIdentityMatch"("tenantId", "kind", "sourceRecordKey")
  WHERE "status" = 'APPROVED' AND "sourceRecordKey" IS NOT NULL;

-- Bootstrap the module catalog record.
INSERT INTO "Module" ("id", "key", "name", "description", "createdAt", "updatedAt")
VALUES (
  'module_customer_intelligence',
  'CUSTOMER_INTELLIGENCE',
  'Customer Intelligence',
  'Leadership-only customer profiles, operating-company relationships, source accounts, contacts, and identity matching',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Enable the module for the approved Newl tenant only. Unrelated tenants are
-- intentionally not enabled so Newl-specific operating-company records stay
-- scoped to Newl and a tenant admin enables the module explicitly via settings.
INSERT INTO "TenantModuleAccess" ("id", "tenantId", "moduleId", "enabled", "createdAt", "updatedAt")
SELECT
  CONCAT('tma_', MD5(CONCAT(t."id", ':customer_intelligence'))),
  t."id",
  m."id",
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN "Module" m
WHERE m."key" = 'CUSTOMER_INTELLIGENCE'
  AND t."slug" = 'newl-group'
ON CONFLICT ("tenantId", "moduleId") DO UPDATE
SET
  "enabled" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Bootstrap the three Newl operating companies for the approved Newl tenant.
-- Idempotent: existing rows (e.g. display names edited in settings) are kept.
INSERT INTO "OperatingCompany" ("id", "tenantId", "slug", "displayName", "legalName", "homeCurrency", "active", "createdAt", "updatedAt")
SELECT 'oc_newl_worldwide', t."id", 'newl-worldwide', 'Newl Worldwide', 'Newl Worldwide Logistics Ltd.', 'CAD', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE t."slug" = 'newl-group'
ON CONFLICT ("tenantId", "slug") DO NOTHING;

INSERT INTO "OperatingCompany" ("id", "tenantId", "slug", "displayName", "legalName", "homeCurrency", "active", "createdAt", "updatedAt")
SELECT 'oc_newl_usa', t."id", 'newl-usa', 'Newl USA', 'Newl USA Inc.', 'USD', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE t."slug" = 'newl-group'
ON CONFLICT ("tenantId", "slug") DO NOTHING;

INSERT INTO "OperatingCompany" ("id", "tenantId", "slug", "displayName", "legalName", "homeCurrency", "active", "createdAt", "updatedAt")
SELECT 'oc_newells_express', t."id", 'newells-express', 'Newell''s Express and Warehousing Ltd.', 'Newell''s Express and Warehousing Ltd.', 'CAD', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE t."slug" = 'newl-group'
ON CONFLICT ("tenantId", "slug") DO NOTHING;
