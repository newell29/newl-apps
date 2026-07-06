INSERT INTO "Module" ("id", "key", "name", "description", "createdAt", "updatedAt")
SELECT
  'shipment-documents-module',
  'SHIPMENT_DOCUMENTS',
  'Garland Tools',
  'Garland Canada document packaging, BOL consolidation, and shipment packet workflows',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Module" WHERE "key" = 'SHIPMENT_DOCUMENTS'
);

UPDATE "Module"
SET
  "name" = 'Garland Tools',
  "description" = 'Garland Canada document packaging, BOL consolidation, and shipment packet workflows',
  "updatedAt" = NOW()
WHERE "key" = 'SHIPMENT_DOCUMENTS';

INSERT INTO "TenantModuleAccess" ("id", "tenantId", "moduleId", "enabled", "createdAt", "updatedAt")
SELECT
  CONCAT("Tenant"."id", '-shipment-documents'),
  "Tenant"."id",
  "Module"."id",
  TRUE,
  NOW(),
  NOW()
FROM "Tenant"
CROSS JOIN "Module"
WHERE "Module"."key" = 'SHIPMENT_DOCUMENTS'
  AND NOT EXISTS (
    SELECT 1
    FROM "TenantModuleAccess"
    WHERE "TenantModuleAccess"."tenantId" = "Tenant"."id"
      AND "TenantModuleAccess"."moduleId" = "Module"."id"
  );
