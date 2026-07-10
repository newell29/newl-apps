-- Seed Website Growth module after the ModuleKey enum value has been committed.

INSERT INTO "Module" ("id", "key", "name", "description", "createdAt", "updatedAt")
VALUES (
  'module_website_growth',
  'WEBSITE_GROWTH',
  'Website Growth',
  'SEO content opportunity queue, Search Console sync, analytics context, and website growth planning',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "TenantModuleAccess" ("id", "tenantId", "moduleId", "enabled", "createdAt", "updatedAt")
SELECT
  CONCAT('tma_', MD5(CONCAT(t."id", ':website_growth'))),
  t."id",
  m."id",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN "Module" m
WHERE m."key" = 'WEBSITE_GROWTH'
ON CONFLICT ("tenantId", "moduleId") DO UPDATE SET
  "enabled" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
