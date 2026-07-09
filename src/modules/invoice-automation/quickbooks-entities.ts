import { IntegrationProvider, IntegrationStatus, type InvoiceAutomationType, type Prisma } from "@prisma/client";
import { inferCurrencyFromInvoiceEntityName, normalizeInvoiceEntityName } from "@/modules/invoice-automation/extraction";
import type {
  InvoiceAutomationEntityOption,
  InvoiceAutomationQuickBooksSyncSummary
} from "@/modules/invoice-automation/types";
import { prisma } from "@/server/db";
import {
  decryptQuickBooksSecret,
  encryptQuickBooksSecret,
  getQuickBooksApiBaseUrl,
  refreshQuickBooksAccessToken
} from "@/server/integrations/quickbooks";
import type { TenantContext } from "@/server/tenant-context";

const QUICKBOOKS_ENTITY_SYNC_STALE_MS = 10 * 60 * 1000;
const QUICKBOOKS_QUERY_PAGE_SIZE = 1000;
const QUICKBOOKS_ENTITY_UPSERT_BATCH_SIZE = 100;

type QuickBooksCredentialRecord = {
  id: string;
  tenantId: string;
  name: string;
  publicConfig: Prisma.JsonValue;
  secretRef: string | null;
};

type QuickBooksEntityPayload = {
  Id?: string;
  DisplayName?: string;
  FullyQualifiedName?: string;
  CompanyName?: string;
  Active?: boolean;
  CurrencyRef?: {
    value?: string;
    name?: string;
  };
};

export async function getInvoiceAutomationQuickBooksEntityOptions(
  tenant: TenantContext
): Promise<InvoiceAutomationEntityOption[]> {
  const entities = await prisma.invoiceAutomationQuickBooksEntity.findMany({
    where: {
      tenantId: tenant.tenantId,
      active: true
    },
    orderBy: [{ entityType: "asc" }, { displayName: "asc" }],
    select: {
      entityType: true,
      realmId: true,
      quickBooksId: true,
      displayName: true,
      normalizedName: true,
      currency: true
    }
  });
  const aliases = await prisma.invoiceAutomationEntityAlias.findMany({
    where: {
      tenantId: tenant.tenantId
    },
    orderBy: [{ invoiceType: "asc" }, { usageCount: "desc" }, { updatedAt: "desc" }],
    select: {
      invoiceType: true,
      normalizedAlias: true,
      quickBooksEntityId: true,
      quickBooksEntityDisplayName: true,
      currency: true
    }
  });

  return [
    ...entities.map((entity) => ({
      id: buildQuickBooksEntityOptionId(entity),
      displayName: entity.displayName,
      normalizedName: entity.normalizedName,
      currency: entity.currency,
      entityType: entity.entityType
    })),
    ...aliases.map((alias) => ({
      id: alias.quickBooksEntityId,
      displayName: alias.quickBooksEntityDisplayName,
      normalizedName: alias.normalizedAlias,
      currency: alias.currency,
      entityType: alias.invoiceType
    }))
  ];
}

export async function getInvoiceAutomationQuickBooksSyncSummary(
  tenant: TenantContext,
  warnings: string[] = []
): Promise<InvoiceAutomationQuickBooksSyncSummary> {
  const [connectionCount, customerCount, vendorCount, lastSyncedEntity] = await Promise.all([
    prisma.integrationCredential.count({
      where: {
        tenantId: tenant.tenantId,
        provider: IntegrationProvider.QUICKBOOKS,
        status: IntegrationStatus.ACTIVE,
        secretRef: {
          not: null
        }
      }
    }),
    prisma.invoiceAutomationQuickBooksEntity.count({
      where: {
        tenantId: tenant.tenantId,
        entityType: "CUSTOMER",
        active: true
      }
    }),
    prisma.invoiceAutomationQuickBooksEntity.count({
      where: {
        tenantId: tenant.tenantId,
        entityType: "VENDOR",
        active: true
      }
    }),
    prisma.invoiceAutomationQuickBooksEntity.findFirst({
      where: {
        tenantId: tenant.tenantId,
        active: true
      },
      orderBy: {
        syncedAt: "desc"
      },
      select: {
        syncedAt: true
      }
    })
  ]);

  return {
    connectionCount,
    customerCount,
    vendorCount,
    lastSyncedAt: lastSyncedEntity?.syncedAt.toISOString() ?? null,
    warnings
  };
}

export async function refreshInvoiceAutomationQuickBooksEntityCache(
  tenant: TenantContext
): Promise<InvoiceAutomationQuickBooksSyncSummary> {
  const warnings = await syncQuickBooksEntityCache(tenant, { force: true });
  return getInvoiceAutomationQuickBooksSyncSummary(tenant, warnings);
}

async function syncQuickBooksEntityCache(tenant: TenantContext, { force }: { force: boolean }) {
  const newestSync = await prisma.invoiceAutomationQuickBooksEntity.findFirst({
    where: {
      tenantId: tenant.tenantId,
      active: true
    },
    orderBy: {
      syncedAt: "desc"
    },
    select: {
      syncedAt: true
    }
  });

  if (!force && newestSync && Date.now() - newestSync.syncedAt.getTime() < QUICKBOOKS_ENTITY_SYNC_STALE_MS) {
    return [];
  }

  const credentials = await prisma.integrationCredential.findMany({
    where: {
      tenantId: tenant.tenantId,
      provider: IntegrationProvider.QUICKBOOKS,
      status: IntegrationStatus.ACTIVE,
      secretRef: {
        not: null
      }
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      publicConfig: true,
      secretRef: true
    }
  });
  const warnings: string[] = [];

  for (const credential of credentials) {
    try {
      await syncQuickBooksCredentialEntities(credential);
    } catch (error) {
      console.warn(`Unable to sync QuickBooks entities for ${credential.name}.`, error);
      warnings.push(formatQuickBooksSyncWarning(credential, error));
    }
  }

  return warnings;
}

async function syncQuickBooksCredentialEntities(credential: QuickBooksCredentialRecord) {
  const config = readQuickBooksPublicConfig(credential.publicConfig);
  if (!credential.secretRef || !config.realmId) {
    return;
  }
  const realmId = config.realmId;

  const accessToken = await getUsableQuickBooksAccessToken(credential, config);
  const [customers, vendors] = await Promise.all([
    fetchQuickBooksEntities({
      realmId,
      accessToken,
      entityName: "Customer"
    }),
    fetchQuickBooksEntities({
      realmId,
      accessToken,
      entityName: "Vendor"
    })
  ]);
  const now = new Date();
  const entities: Prisma.InvoiceAutomationQuickBooksEntityUpsertArgs[] = [
    ...customers.map((customer) => ({ entityType: "CUSTOMER" as const, payload: customer })),
    ...vendors.map((vendor) => ({ entityType: "VENDOR" as const, payload: vendor }))
  ].flatMap((entity) => {
    const quickBooksId = entity.payload.Id;
    const displayName = readQuickBooksDisplayName(entity.payload);
    if (!quickBooksId || !displayName) {
      return [];
    }

    return [
      {
        where: {
          tenantId_entityType_realmId_quickBooksId: {
            tenantId: credential.tenantId,
            entityType: entity.entityType,
            realmId,
            quickBooksId
          }
        },
        update: {
          displayName,
          normalizedName: normalizeInvoiceEntityName(displayName),
          currency: readQuickBooksCurrency(entity.payload),
          legalEntity: config.legalEntity,
          active: entity.payload.Active !== false,
          rawJson: entity.payload as Prisma.InputJsonValue,
          syncedAt: now
        },
        create: {
          tenantId: credential.tenantId,
          entityType: entity.entityType,
          quickBooksId,
          displayName,
          normalizedName: normalizeInvoiceEntityName(displayName),
          currency: readQuickBooksCurrency(entity.payload),
          legalEntity: config.legalEntity,
          realmId,
          active: entity.payload.Active !== false,
          rawJson: entity.payload as Prisma.InputJsonValue,
          syncedAt: now
        }
      }
    ];
  });

  await prisma.invoiceAutomationQuickBooksEntity.updateMany({
    where: {
      tenantId: credential.tenantId,
      realmId
    },
    data: {
      active: false,
      syncedAt: now
    }
  });

  for (let index = 0; index < entities.length; index += QUICKBOOKS_ENTITY_UPSERT_BATCH_SIZE) {
    const batch = entities.slice(index, index + QUICKBOOKS_ENTITY_UPSERT_BATCH_SIZE);
    for (const entity of batch) {
      await prisma.invoiceAutomationQuickBooksEntity.upsert(entity);
    }
  }
}

async function getUsableQuickBooksAccessToken(
  credential: QuickBooksCredentialRecord,
  config: ReturnType<typeof readQuickBooksPublicConfig>
) {
  if (!credential.secretRef) {
    throw new Error("QuickBooks credential is missing encrypted OAuth tokens.");
  }
  if (!config.realmId) {
    throw new Error("QuickBooks credential is missing a realm ID.");
  }

  const secret = decryptQuickBooksSecret(credential.secretRef);
  const expiresAt = config.accessTokenExpiresAt ? new Date(config.accessTokenExpiresAt).getTime() : 0;
  if (secret.accessToken && expiresAt - Date.now() > 120000) {
    return secret.accessToken;
  }

  if (!secret.refreshToken) {
    throw new Error("QuickBooks credential is missing a refresh token.");
  }

  const refreshed = await refreshQuickBooksAccessToken({ refreshToken: secret.refreshToken });
  const nextPublicConfig = {
    ...config.raw,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
    refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt
  };
  await prisma.integrationCredential.update({
    where: {
      id: credential.id
    },
    data: {
      publicConfig: nextPublicConfig,
      secretRef: encryptQuickBooksSecret({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenType: refreshed.tokenType,
        realmId: config.realmId
      })
    }
  });

  return refreshed.accessToken;
}

async function fetchQuickBooksEntities({
  realmId,
  accessToken,
  entityName
}: {
  realmId: string;
  accessToken: string;
  entityName: "Customer" | "Vendor";
}) {
  const entities: QuickBooksEntityPayload[] = [];
  let startPosition = 1;

  while (true) {
    const page = await queryQuickBooksEntities({ realmId, accessToken, entityName, startPosition });
    entities.push(...page);
    if (page.length < QUICKBOOKS_QUERY_PAGE_SIZE) {
      return entities;
    }
    startPosition += QUICKBOOKS_QUERY_PAGE_SIZE;
  }
}

async function queryQuickBooksEntities({
  realmId,
  accessToken,
  entityName,
  startPosition
}: {
  realmId: string;
  accessToken: string;
  entityName: "Customer" | "Vendor";
  startPosition: number;
}) {
  const query = `select * from ${entityName} where Active = true startposition ${startPosition} maxresults ${QUICKBOOKS_QUERY_PAGE_SIZE}`;
  const url = new URL(`${getQuickBooksApiBaseUrl()}/v3/company/${realmId}/query`);
  url.searchParams.set("query", query);
  url.searchParams.set("minorversion", "75");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`QuickBooks ${entityName} query failed with status ${response.status}: ${text.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    QueryResponse?: {
      Customer?: QuickBooksEntityPayload[];
      Vendor?: QuickBooksEntityPayload[];
    };
  };

  return entityName === "Customer"
    ? json.QueryResponse?.Customer ?? []
    : json.QueryResponse?.Vendor ?? [];
}

function readQuickBooksPublicConfig(value: Prisma.JsonValue) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  return {
    raw,
    legalEntity: typeof raw.legalEntity === "string" ? raw.legalEntity : null,
    realmId: typeof raw.realmId === "string" ? raw.realmId : null,
    accessTokenExpiresAt: typeof raw.accessTokenExpiresAt === "string" ? raw.accessTokenExpiresAt : null
  };
}

function readQuickBooksDisplayName(entity: QuickBooksEntityPayload) {
  return entity.DisplayName ?? entity.FullyQualifiedName ?? entity.CompanyName ?? null;
}

function readQuickBooksCurrency(entity: QuickBooksEntityPayload) {
  const currency = entity.CurrencyRef?.value ?? entity.CurrencyRef?.name ?? inferCurrencyFromInvoiceEntityName(readQuickBooksDisplayName(entity));
  return currency?.toUpperCase() ?? null;
}

function buildQuickBooksEntityOptionId(entity: {
  realmId: string;
  entityType: InvoiceAutomationType;
  quickBooksId: string;
}) {
  return `quickbooks:${entity.realmId}:${entity.entityType}:${entity.quickBooksId}`;
}

function formatQuickBooksSyncWarning(credential: QuickBooksCredentialRecord, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (isQuickBooksCredentialDecryptError(error)) {
    return `${credential.name} needs to be reconnected in Settings because its saved QuickBooks token can no longer be decrypted.`;
  }

  if (/invalid_grant|refresh token/i.test(message)) {
    return `${credential.name} needs to be reconnected in Settings because QuickBooks rejected the saved refresh token.`;
  }

  return `${credential.name} could not be synced: ${message}`;
}

export function isQuickBooksCredentialDecryptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unsupported state|unable to authenticate data|secretRef is not in the expected encrypted format/i.test(message);
}
