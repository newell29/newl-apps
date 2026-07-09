INSERT INTO "Module" ("id", "key", "name", "description", "createdAt", "updatedAt")
VALUES
  (
    'module_invoice_verification',
    'INVOICE_VERIFICATION',
    'Invoice Automation',
    'Customer and vendor invoice upload, OCR staging, review, and approval workflow',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'module_quickbooks_posting',
    'QUICKBOOKS_POSTING',
    'QuickBooks Posting',
    'Approved invoice batch preparation, QuickBooks entity matching, and posting controls',
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
  CONCAT('tma_', MD5(CONCAT(t."id", ':', m."key"))),
  t."id",
  m."id",
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN "Module" m
WHERE m."key" IN ('INVOICE_VERIFICATION', 'QUICKBOOKS_POSTING')
ON CONFLICT ("tenantId", "moduleId") DO UPDATE
SET
  "enabled" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;
