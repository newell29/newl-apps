INSERT INTO "Module" ("id", "key", "name", "description", "createdAt", "updatedAt")
VALUES (
  'module_website_inbound',
  'WEBSITE_INBOUND',
  'Website Inbound',
  'Website form submissions, account setup requests, and inbound lead review',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "TenantModuleAccess" ("id", "tenantId", "moduleId", "enabled", "createdAt", "updatedAt")
SELECT
  CONCAT('tma_', MD5(CONCAT(t."id", ':website_inbound'))),
  t."id",
  m."id",
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN "Module" m
WHERE m."key" = 'WEBSITE_INBOUND'
ON CONFLICT ("tenantId", "moduleId") DO UPDATE
SET
  "enabled" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;
