import { IntegrationProvider, IntegrationStatus, ModuleKey } from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";
import type { UpsAccountConfig } from "@/modules/ups-tools/types";
import { getLocalUpsAccountMetadata, type LocalUpsAccountMetadata } from "@/server/integrations/ups";
import {
  buildPlaceholderQuoteSource,
  parseQuoteToolTargets,
  parseQuoteSourceDirectory,
  quoteSourceSupportsTarget,
  QUOTE_SOURCE_DIRECTORY_NAME
} from "@/modules/settings/quote-sources";
import type { QuoteToolTarget } from "@/modules/settings/types";

type UpsPublicConfig = {
  countryCode?: unknown;
  shipperNumber?: unknown;
  originPostalCode?: unknown;
  originLabel?: unknown;
  originStateProvince?: unknown;
  dryRun?: unknown;
  toolTargets?: unknown;
};

type ManagedUpsAccount = UpsAccountConfig & {
  toolTargets: QuoteToolTarget[];
};

export async function getUpsToolsShell(tenant: TenantContext, target?: QuoteToolTarget) {
  const [moduleAccess, credentials, localAccounts] = await Promise.all([
    prisma.tenantModuleAccess.findFirst({
      where: {
        tenantId: tenant.tenantId,
        enabled: true,
        module: {
          key: ModuleKey.UPS_TOOLS
        }
      },
      select: { id: true }
    }),
    prisma.integrationCredential.findMany({
      where: tenantWhere(tenant, {
        provider: {
          in: [IntegrationProvider.UPS, IntegrationProvider.OPENCLAW]
        }
      }),
      orderBy: [{ status: "asc" }, { name: "asc" }]
    }),
    getLocalUpsAccountMetadata()
  ]);

  const accounts = mergeUpsAccounts(
    credentials
      .filter((credential) => credential.provider === IntegrationProvider.UPS)
      .map(mapUpsAccountConfig)
      .filter(Boolean) as ManagedUpsAccount[],
    localAccounts
  );
  const quoteSourceDirectory = credentials.find(
    (credential) => credential.provider === IntegrationProvider.OPENCLAW && credential.name === QUOTE_SOURCE_DIRECTORY_NAME
  );
  const plannedSources = parseQuoteSourceDirectory(quoteSourceDirectory?.publicConfig)
    .map((entry) => buildPlaceholderQuoteSource(entry))
    .filter((entry) => quoteSourceSupportsTarget(entry, "SHIPMENT_RATE_QUOTE") || quoteSourceSupportsTarget(entry, "PROSPECT_QUOTE"));

  return {
    moduleEnabled: Boolean(moduleAccess),
    accounts: target ? accounts.filter((account) => account.toolTargets.includes(target)) : accounts,
    hasActiveAccounts: accounts.some((account) => account.status === "ACTIVE"),
    plannedSources
  };
}

export async function seedUpsTenantDefaults(tenantId: string) {
  const defaults = [
    {
      name: "Charlotte Dry Run Account",
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        countryCode: "US",
        shipperNumber: "G460D6",
        originPostalCode: "28273",
        originLabel: "Charlotte, NC",
        originStateProvince: "NC",
        dryRun: true
      }
    },
    {
      name: "Charlotte Backup Dry Run Account",
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        countryCode: "US",
        shipperNumber: "X6767D",
        originPostalCode: "28273",
        originLabel: "Charlotte, NC",
        originStateProvince: "NC",
        dryRun: true
      }
    },
    {
      name: "Mississauga Dry Run Account",
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        countryCode: "CA",
        shipperNumber: "A5F589",
        originPostalCode: "L5T1Z3",
        originLabel: "Mississauga, ON",
        originStateProvince: "ON",
        dryRun: true
      }
    }
  ] as const;

  for (const record of defaults) {
    const existing = await prisma.integrationCredential.findFirst({
      where: {
        tenantId,
        provider: IntegrationProvider.UPS,
        name: record.name
      },
      select: {
        id: true
      }
    });

    if (existing) {
      await prisma.integrationCredential.update({
        where: {
          id: existing.id
        },
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
        provider: IntegrationProvider.UPS,
        name: record.name,
        status: record.status,
        publicConfig: record.publicConfig
      }
    });
  }
}

function mapUpsAccountConfig(credential: {
  id: string;
  name: string;
  status: IntegrationStatus;
  publicConfig: unknown;
  secretRef: string | null;
}): ManagedUpsAccount | null {
  const config = (credential.publicConfig ?? {}) as UpsPublicConfig;
  const countryCode = config.countryCode === "CA" ? "CA" : config.countryCode === "US" ? "US" : null;
  const shipperNumber = typeof config.shipperNumber === "string" ? config.shipperNumber : null;
  const originPostalCode = typeof config.originPostalCode === "string" ? config.originPostalCode : null;
  const originLabel = typeof config.originLabel === "string" ? config.originLabel : null;
  const originStateProvince =
    typeof config.originStateProvince === "string" ? config.originStateProvince : undefined;
  const dryRun = config.dryRun === false ? false : true;

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
    dryRun,
    secretConfigured: Boolean(credential.secretRef),
    toolTargets: parseQuoteToolTargets(config.toolTargets)
  };
}

function mergeUpsAccounts(dbAccounts: ManagedUpsAccount[], localAccounts: LocalUpsAccountMetadata[]) {
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
    } satisfies ManagedUpsAccount;
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
