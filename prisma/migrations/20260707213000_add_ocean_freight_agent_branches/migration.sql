ALTER TABLE "OceanFreightAgent" ADD COLUMN "primaryCountry" TEXT;

CREATE TABLE "OceanFreightAgentBranch" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "region" TEXT,
  "city" TEXT,
  "port" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OceanFreightAgentBranch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OceanFreightAgentBranch_tenantId_id_key" ON "OceanFreightAgentBranch"("tenantId", "id");
CREATE INDEX "OceanFreightAgent_tenantId_primaryCountry_idx" ON "OceanFreightAgent"("tenantId", "primaryCountry");
CREATE INDEX "OceanFreightAgentBranch_tenantId_agentId_idx" ON "OceanFreightAgentBranch"("tenantId", "agentId");
CREATE INDEX "OceanFreightAgentBranch_tenantId_country_idx" ON "OceanFreightAgentBranch"("tenantId", "country");
CREATE INDEX "OceanFreightAgentBranch_tenantId_city_idx" ON "OceanFreightAgentBranch"("tenantId", "city");
CREATE INDEX "OceanFreightAgentBranch_tenantId_port_idx" ON "OceanFreightAgentBranch"("tenantId", "port");

ALTER TABLE "OceanFreightAgentBranch" ADD CONSTRAINT "OceanFreightAgentBranch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OceanFreightAgentBranch" ADD CONSTRAINT "OceanFreightAgentBranch_tenantId_agentId_fkey" FOREIGN KEY ("tenantId", "agentId") REFERENCES "OceanFreightAgent"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
