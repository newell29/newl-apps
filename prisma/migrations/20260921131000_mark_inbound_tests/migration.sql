-- Kept in a separate migration so PostgreSQL has committed the new enum value
-- before it is used in data, including on versions that reject same-transaction
-- use after ALTER TYPE ... ADD VALUE.
UPDATE "WebsiteInboundSubmission"
SET "status" = 'TEST'
WHERE "entryMethod" = 'WEBSITE_FORM'
  AND "isTest" = true;
