import { IntegrationProvider, IntegrationStatus, ModuleKey } from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";
import type { SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";
import { getLocalSevenLAccountNames } from "@/server/integrations/seven-l";
import { getRecentLtlBulkQuoteJobs } from "@/modules/ltl-rate-portal/bulk-jobs";

type SevenLPublicConfig = {
  baseUrl?: unknown;
  defaultUom?: unknown;
  strictResult?: unknown;
  harmonizedCharges?: unknown;
  dryRun?: unknown;
  carrierMode?: unknown;
  carriers?: unknown;
};

function isCarrier(
  value: SevenLAccountConfig["carriers"][number] | null
): value is SevenLAccountConfig["carriers"][number] {
  return value !== null;
}

export async function getLtlRatePortalShell(tenant: TenantContext) {
  const [moduleAccess, credentials, localAccountNames, recentBulkJobs] = await Promise.all([
    prisma.tenantModuleAccess.findFirst({
      where: {
        tenantId: tenant.tenantId,
        enabled: true,
        module: {
          key: ModuleKey.LTL_RATE_PORTAL
        }
      },
      select: { id: true }
    }),
    prisma.integrationCredential.findMany({
      where: tenantWhere(tenant, {
        provider: IntegrationProvider.SEVEN_L
      }),
      orderBy: [{ status: "asc" }, { name: "asc" }]
    }),
    getLocalSevenLAccountNames(),
    getRecentLtlBulkQuoteJobs(tenant)
  ]);

  const accounts = credentials
    .map((credential) => mapSevenLAccount(credential, localAccountNames))
    .filter(Boolean) as SevenLAccountConfig[];

  return {
    moduleEnabled: Boolean(moduleAccess),
    accounts,
    hasActiveAccounts: accounts.some((account) => account.status === "ACTIVE"),
    recentBulkJobs
  };
}

export async function seedLtlTenantDefaults(tenantId: string) {
  const defaults = [
    {
      name: "7L Dry Run - Core LTL",
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        baseUrl: "https://restapi.my7l.com",
        defaultUom: "US",
        strictResult: false,
        harmonizedCharges: true,
        dryRun: true,
        carrierMode: "TENANT_SELECTED",
        carriers: [
          { carrierHash: "aaa-cooper-hash", name: "AAA Cooper", code: "AAA", scac: "AACT", defaulted: true, enabled: true },
          { carrierHash: "estes-hash", name: "Estes Express", code: "EST", scac: "EXLA", defaulted: true, enabled: true },
          { carrierHash: "dayton-hash", name: "Dayton Freight", code: "DAY", scac: "DYLT", defaulted: true, enabled: true }
        ]
      }
    }
  ] as const;

  for (const record of defaults) {
    const existing = await prisma.integrationCredential.findFirst({
      where: {
        tenantId,
        provider: IntegrationProvider.SEVEN_L,
        name: record.name
      },
      select: { id: true }
    });

    if (existing) {
      await prisma.integrationCredential.update({
        where: { id: existing.id },
        data: {
          status: record.status,
          publicConfig: record.publicConfig
        }
      });
      continue;
    }

    await prisma.integrationCredential.create({
      data: {
        tenantId,
        provider: IntegrationProvider.SEVEN_L,
        name: record.name,
        status: record.status,
        publicConfig: record.publicConfig
      }
    });
  }
}

function mapSevenLAccount(credential: {
  id: string;
  name: string;
  status: IntegrationStatus;
  publicConfig: unknown;
  secretRef: string | null;
}, localAccountNames: Set<string>): SevenLAccountConfig | null {
  const config = (credential.publicConfig ?? {}) as SevenLPublicConfig;
  const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl : "https://restapi.my7l.com";
  const defaultUom =
    config.defaultUom === "METRIC" || config.defaultUom === "MIXED" ? config.defaultUom : "US";
  const carrierMode = config.carrierMode === "ALL_DEFAULT" ? "ALL_DEFAULT" : "TENANT_SELECTED";
  const carriers = Array.isArray(config.carriers)
    ? config.carriers
        .map((carrier) => {
          if (!carrier || typeof carrier !== "object") {
            return null;
          }

          const item = carrier as Record<string, unknown>;
          const carrierHash = typeof item.carrierHash === "string" ? item.carrierHash : null;
          const name = typeof item.name === "string" ? item.name : null;
          const code = typeof item.code === "string" ? item.code : null;
          const scac = typeof item.scac === "string" ? item.scac : null;

          if (!carrierHash || !name || !code || !scac) {
            return null;
          }

        return {
          carrierHash,
          name,
          code,
          scac,
          defaulted: item.defaulted === false ? false : true,
          enabled: item.enabled === false ? false : true
        };
      })
      .filter(isCarrier)
    : [];

  if (carriers.length === 0) {
    return null;
  }

  return {
    id: credential.id,
    name: credential.name,
    status: credential.status,
    baseUrl,
    defaultUom,
    strictResult: config.strictResult === true,
    harmonizedCharges: config.harmonizedCharges === false ? false : true,
    dryRun: config.dryRun === false ? false : true,
    carrierMode,
    carriers,
    secretConfigured: Boolean(credential.secretRef) || localAccountNames.has(credential.name)
  };
}
