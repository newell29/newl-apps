INSERT INTO "Module" ("id", "key", "name", "description", "createdAt", "updatedAt")
VALUES (
    'module_supply_chain_design',
    'SUPPLY_CHAIN_DESIGN',
    'Supply Chain Design Studio',
    'Supply Chain Design Studio project workspace and modeling proofs',
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
    'newl-group-supply-chain-design',
    t."id",
    m."id",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN "Module" m
WHERE t."slug" = 'newl-group'
  AND m."key" = 'SUPPLY_CHAIN_DESIGN'
ON CONFLICT ("tenantId", "moduleId") DO UPDATE
SET
    "enabled" = true,
    "updatedAt" = CURRENT_TIMESTAMP;
