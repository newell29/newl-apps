import { IntegrationProvider } from "@prisma/client";
import { prisma } from "@/server/db";
import type { SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";
import type { UpsAccountConfig } from "@/modules/ups-tools/types";
import { getLocalUpsAccountMetadata } from "@/server/integrations/ups";
import {
  buildPlaceholderQuoteSource,
  mapProviderToCarrierName,
  parseQuoteSourceDirectory,
  parseQuoteToolTargets,
  QUOTE_SOURCE_DIRECTORY_NAME
} from "@/modules/settings/quote-sources";
import type { ManagedQuoteSource, QuoteToolTarget } from "@/modules/settings/types";

type SettingsUpsAccount = UpsAccountConfig & {
  toolTargets: QuoteToolTarget[];
};

function isSevenLCarrier(
  value: SevenLAccountConfig["carriers"][number] | null
): value is SevenLAccountConfig["carriers"][number] {
  return value !== null;
}

export async function getSettingsShell(tenant: TenantContext) {
  const moduleAccess = await prisma.tenantModuleAccess.findMany({
    where: tenantWhere(tenant),
    include: {
      module: true
    },
    orderBy: {
      module: {
        name: "asc"
      }
    }
  });

  const [integrationCredentials, localUpsAccounts] = await Promise.all([
    prisma.integrationCredential.findMany({
      where: tenantWhere(tenant, {
        provider: {
          in: [IntegrationProvider.UPS, IntegrationProvider.SEVEN_L, IntegrationProvider.OPENCLAW]
        }
      }),
      orderBy: {
        name: "asc"
      }
    }),
    getLocalUpsAccountMetadata()
  ]);
  const upsAccounts = integrationCredentials
    .filter((credential) => credential.provider === IntegrationProvider.UPS)
    .map((credential) => mapUpsAccount(credential))
    .filter(isUpsAccount);
  const quoteSourceDirectory = integrationCredentials.find(
    (credential) => credential.provider === IntegrationProvider.OPENCLAW && credential.name === QUOTE_SOURCE_DIRECTORY_NAME
  );
  const managedQuoteSources = [
    ...mergeUpsAccountsForSettings(upsAccounts, localUpsAccounts).map((account) =>
      mapUpsAccountToQuoteSource(account)
    ),
    ...parseQuoteSourceDirectory(quoteSourceDirectory?.publicConfig).map((entry) => buildPlaceholderQuoteSource(entry))
  ].sort((left, right) => left.displayName.localeCompare(right.displayName));

  return {
    modules: moduleAccess.map((access) => ({
      key: access.module.key,
      name: access.module.name,
      enabled: access.enabled
    })),
    integrationProviders: Object.values(IntegrationProvider),
    quoteSources: managedQuoteSources,
    upsAccounts: mergeUpsAccountsForSettings(upsAccounts, localUpsAccounts),
    sevenLAccounts: integrationCredentials
      .filter((credential) => credential.provider === IntegrationProvider.SEVEN_L)
      .map((credential) => mapSevenLAccount(credential))
      .filter(Boolean) as SevenLAccountConfig[]
  };
}

function isUpsAccount(value: SettingsUpsAccount | null): value is SettingsUpsAccount {
  return value !== null;
}

function mapUpsAccount(credential: {
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED" | "ERROR";
  publicConfig: unknown;
  secretRef: string | null;
}): SettingsUpsAccount | null {
  if (!credential.publicConfig || typeof credential.publicConfig !== "object") {
    return null;
  }

  const config = credential.publicConfig as Record<string, unknown>;
  const countryCode = config.countryCode === "CA" ? "CA" : config.countryCode === "US" ? "US" : null;
  const shipperNumber = typeof config.shipperNumber === "string" ? config.shipperNumber : null;
  const originPostalCode = typeof config.originPostalCode === "string" ? config.originPostalCode : null;
  const originLabel = typeof config.originLabel === "string" ? config.originLabel : null;
  const originStateProvince =
    typeof config.originStateProvince === "string" ? config.originStateProvince : undefined;

  if (!countryCode || !shipperNumber || !originPostalCode || !originLabel) {
    return null;
  }

  return {
    id: credential.id,
    name: credential.name,
    status: credential.status,
    countryCode,
    shipperNumber,
    originPostalCode,
    originLabel,
    originStateProvince,
    dryRun: config.dryRun === false ? false : true,
    secretConfigured: Boolean(credential.secretRef),
    toolTargets: parseQuoteToolTargets(config.toolTargets)
  };
}

function mapSevenLAccount(credential: {
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED" | "ERROR";
  publicConfig: unknown;
  secretRef: string | null;
}): SevenLAccountConfig | null {
  if (!credential.publicConfig || typeof credential.publicConfig !== "object") {
    return null;
  }

  const config = credential.publicConfig as Record<string, unknown>;
  const carriers = Array.isArray(config.carriers) ? config.carriers : [];

  return {
    id: credential.id,
    name: credential.name,
    status: credential.status,
    baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : "https://restapi.my7l.com",
    defaultUom: config.defaultUom === "METRIC" || config.defaultUom === "MIXED" ? config.defaultUom : "US",
    strictResult: config.strictResult === true,
    harmonizedCharges: config.harmonizedCharges === false ? false : true,
    dryRun: config.dryRun === false ? false : true,
    carrierMode: config.carrierMode === "ALL_DEFAULT" ? "ALL_DEFAULT" : "TENANT_SELECTED",
    carriers: carriers
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
      .filter(isSevenLCarrier),
    secretConfigured: Boolean(credential.secretRef)
  };
}

function mergeUpsAccountsForSettings(
  dbAccounts: SettingsUpsAccount[],
  localAccounts: Awaited<ReturnType<typeof getLocalUpsAccountMetadata>>
) {
  const localByShipper = new Map(localAccounts.map((account) => [account.shipperNumber, account]));
  const merged = dbAccounts.map((account) => {
    const local = localByShipper.get(account.shipperNumber);
    if (!local) {
      return account;
    }

    localByShipper.delete(account.shipperNumber);
    return {
      ...account,
      name: local.name,
      countryCode: local.countryCode,
      originPostalCode: local.originPostalCode,
      originLabel: local.originLabel,
      originStateProvince: local.originStateProvince,
      dryRun: false,
      secretConfigured: true,
      toolTargets: account.toolTargets
    };
  });

  for (const local of localByShipper.values()) {
    merged.push({
      id: `local-${local.shipperNumber}`,
      name: local.name,
      status: "ACTIVE",
      countryCode: local.countryCode,
      shipperNumber: local.shipperNumber,
      originPostalCode: local.originPostalCode,
      originLabel: local.originLabel,
      originStateProvince: local.originStateProvince,
      dryRun: false,
      secretConfigured: true,
      toolTargets: parseQuoteToolTargets(undefined)
    });
  }

  return merged.sort((left, right) => left.name.localeCompare(right.name));
}

function mapUpsAccountToQuoteSource(account: SettingsUpsAccount): ManagedQuoteSource {
  return {
    id: account.id,
    displayName: account.name,
    carrierName: mapProviderToCarrierName(IntegrationProvider.UPS),
    carrierCode: "UPS",
    provider: IntegrationProvider.UPS,
    status: account.status,
    readiness: account.dryRun ? "planned" : "live",
    selectable: account.status === "ACTIVE",
    sourceKind: "UPS_ACCOUNT",
    toolTargets: account.toolTargets,
    shipperNumber: account.shipperNumber,
    originLabel: account.originLabel,
    originPostalCode: account.originPostalCode,
    originStateProvince: account.originStateProvince
  };
}
