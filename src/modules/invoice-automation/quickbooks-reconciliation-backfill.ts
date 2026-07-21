import { IntegrationProvider, IntegrationStatus, Prisma, type InvoiceAutomationType } from "@prisma/client";
import { getShipmentTypeFromInvoiceFileNumber } from "@/modules/invoice-automation/extraction";
import {
  QuickBooksPostingMappingError,
  readQuickBooksPostedTransactionDetail,
  type QuickBooksRef
} from "@/modules/invoice-automation/quickbooks-posting";
import { prisma } from "@/server/db";
import {
  decryptQuickBooksSecret,
  encryptQuickBooksSecret,
  getQuickBooksApiBaseUrl,
  refreshQuickBooksAccessToken
} from "@/server/integrations/quickbooks";

const QUICKBOOKS_QUERY_PAGE_SIZE = 1000;
const QUICKBOOKS_DEFAULT_MONTHS_BACK = 24;
const QUICKBOOKS_MAX_TRANSACTIONS_PER_TYPE = 2000;
const QUICKBOOKS_HOME_CURRENCY = "CAD";
const QUICKBOOKS_BACKFILL_SOURCE = "QUICKBOOKS_RECONCILIATION_BACKFILL";
const QUICKBOOKS_BACKFILL_MULTIFILE_SOURCE = "QUICKBOOKS_RECONCILIATION_BACKFILL_MULTI_FILE_SKIPPED";

type QuickBooksCredentialRecord = {
  id: string;
  tenantId: string;
  name: string;
  publicConfig: Prisma.JsonValue;
  secretRef: string | null;
};

type QuickBooksBackfillConnection = {
  credential: QuickBooksCredentialRecord;
  realmId: string;
  accessToken: string;
};

type QuickBooksBackfillEntityName = "Invoice" | "Bill";

type QuickBooksBackfillTransaction = {
  Id?: string;
  DocNumber?: string;
  TxnDate?: string;
  PrivateNote?: string;
  CustomerMemo?: {
    value?: string;
  };
  CustomerRef?: QuickBooksRef;
  VendorRef?: QuickBooksRef;
  CurrencyRef?: QuickBooksRef;
  ExchangeRate?: number | string;
  TotalAmt?: number | string;
  HomeTotalAmt?: number | string;
  TxnTaxDetail?: {
    TotalTax?: number | string;
  };
  Line?: Array<{
    Description?: string;
    Amount?: number | string;
    DetailType?: string;
  }>;
};

export type QuickBooksReconciliationBackfillSummary = {
  scanned: number;
  importedOrUpdated: number;
  skippedWithoutFileNumber: number;
  skippedMultipleFileNumbers: number;
  warnings: string[];
};

export async function backfillQuickBooksReconciliationTransactions({
  tenantId,
  monthsBack = QUICKBOOKS_DEFAULT_MONTHS_BACK,
  maxTransactionsPerType = QUICKBOOKS_MAX_TRANSACTIONS_PER_TYPE
}: {
  tenantId: string;
  monthsBack?: number;
  maxTransactionsPerType?: number;
}): Promise<QuickBooksReconciliationBackfillSummary> {
  const credentials = await getQuickBooksCredentials(tenantId);
  const sinceDate = getIsoDateMonthsBack(clampNumber(monthsBack, 1, 84));
  const transactionLimit = clampNumber(maxTransactionsPerType, 1, QUICKBOOKS_MAX_TRANSACTIONS_PER_TYPE);
  const summary: QuickBooksReconciliationBackfillSummary = {
    scanned: 0,
    importedOrUpdated: 0,
    skippedWithoutFileNumber: 0,
    skippedMultipleFileNumbers: 0,
    warnings: []
  };

  for (const credential of credentials) {
    try {
      const connection = await getQuickBooksBackfillConnection(credential);
      for (const entityName of ["Invoice", "Bill"] as const) {
        const result = await backfillQuickBooksEntityTransactions({
          tenantId,
          connection,
          entityName,
          sinceDate,
          transactionLimit
        });
        summary.scanned += result.scanned;
        summary.importedOrUpdated += result.importedOrUpdated;
        summary.skippedWithoutFileNumber += result.skippedWithoutFileNumber;
        summary.skippedMultipleFileNumbers += result.skippedMultipleFileNumbers;
      }
    } catch (error) {
      summary.warnings.push(formatQuickBooksBackfillWarning(credential, error));
    }
  }

  if (summary.scanned === 0 && summary.warnings.length > 0) {
    throw new QuickBooksPostingMappingError(summary.warnings.join(" "));
  }

  return summary;
}

async function backfillQuickBooksEntityTransactions({
  tenantId,
  connection,
  entityName,
  sinceDate,
  transactionLimit
}: {
  tenantId: string;
  connection: QuickBooksBackfillConnection;
  entityName: QuickBooksBackfillEntityName;
  sinceDate: string;
  transactionLimit: number;
}) {
  const invoiceType: InvoiceAutomationType = entityName === "Invoice" ? "CUSTOMER" : "VENDOR";
  const result = {
    scanned: 0,
    importedOrUpdated: 0,
    skippedWithoutFileNumber: 0,
    skippedMultipleFileNumbers: 0
  };
  let startPosition = 1;

  while (result.scanned < transactionLimit) {
    const maxResults = Math.min(QUICKBOOKS_QUERY_PAGE_SIZE, transactionLimit - result.scanned);
    const query = `select * from ${entityName} where TxnDate >= '${sinceDate}' orderby TxnDate desc startposition ${startPosition} maxresults ${maxResults}`;
    const json = await queryQuickBooks({ realmId: connection.realmId, accessToken: connection.accessToken, query });
    const transactions = readQuickBooksTransactionQueryRows(json, entityName);
    if (transactions.length === 0) {
      return result;
    }

    for (const transaction of transactions) {
      result.scanned += 1;
      const fileNumbers = extractShipmentFileNumbersFromQuickBooksTransaction(transaction);
      if (fileNumbers.length === 0) {
        result.skippedWithoutFileNumber += 1;
        continue;
      }
      if (fileNumbers.length > 1) {
        result.skippedMultipleFileNumbers += 1;
        await upsertSkippedMultiFileQuickBooksTransaction({
          tenantId,
          connection,
          invoiceType,
          transaction,
          fileNumbers
        });
        continue;
      }

      const upserted = await upsertQuickBooksReconciliationTransaction({
        tenantId,
        connection,
        invoiceType,
        transaction,
        shipmentFileNumber: fileNumbers[0]
      });
      if (upserted) {
        result.importedOrUpdated += 1;
      }
    }

    if (transactions.length < maxResults) {
      return result;
    }
    startPosition += transactions.length;
  }

  return result;
}

export function extractShipmentFileNumbersFromQuickBooksTransaction(transaction: QuickBooksBackfillTransaction) {
  const text = [
    transaction.PrivateNote,
    transaction.CustomerMemo?.value,
    ...(transaction.Line ?? []).map((line) => line.Description)
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const matches = text.matchAll(/\b(OE|OI|AE|AI|TR|DR)\s*[-#:]?\s*([0-9][0-9A-Z]*)\b/gi);
  return [...new Set([...matches].map((match) => `${match[1].toUpperCase()}${match[2].toUpperCase()}`))];
}

async function upsertQuickBooksReconciliationTransaction({
  tenantId,
  connection,
  invoiceType,
  transaction,
  shipmentFileNumber
}: {
  tenantId: string;
  connection: QuickBooksBackfillConnection;
  invoiceType: InvoiceAutomationType;
  transaction: QuickBooksBackfillTransaction;
  shipmentFileNumber: string;
}) {
  if (!transaction.Id) {
    return false;
  }
  const detail = readQuickBooksPostedTransactionDetail(transaction);
  const entityRef = readQuickBooksTransactionEntityRef(transaction, invoiceType);
  const observedAt = new Date();

  await prisma.invoiceAutomationQuickBooksTransaction.upsert({
    where: {
      tenantId_realmId_invoiceType_quickBooksTxnId: {
        tenantId,
        realmId: connection.realmId,
        invoiceType,
        quickBooksTxnId: transaction.Id
      }
    },
    create: {
      tenantId,
      invoiceAutomationInvoiceId: null,
      realmId: connection.realmId,
      invoiceType,
      quickBooksTxnId: transaction.Id,
      quickBooksTxnNumber: detail.docNumber,
      shipmentFileNumber,
      shipmentType: getShipmentTypeFromInvoiceFileNumber(shipmentFileNumber),
      entityName: entityRef?.name ?? null,
      quickBooksEntityId: entityRef?.value ?? null,
      currency: detail.currency,
      transactionDate: parseQuickBooksDate(transaction.TxnDate),
      subtotalAmount: decimalOrNull(detail.subtotalAmount),
      taxAmount: decimalOrNull(detail.taxAmount),
      totalAmount: decimalOrNull(detail.totalAmount),
      quickBooksExchangeRate: decimalOrNull(detail.exchangeRate),
      quickBooksHomeCurrency: detail.homeTotalAmount !== null ? QUICKBOOKS_HOME_CURRENCY : null,
      quickBooksSubtotalHomeAmount: decimalOrNull(detail.homeSubtotalAmount),
      quickBooksTaxHomeAmount: decimalOrNull(detail.homeTaxAmount),
      quickBooksTotalHomeAmount: decimalOrNull(detail.homeTotalAmount),
      source: QUICKBOOKS_BACKFILL_SOURCE,
      observedAt
    },
    update: {
      quickBooksTxnNumber: detail.docNumber,
      shipmentFileNumber,
      shipmentType: getShipmentTypeFromInvoiceFileNumber(shipmentFileNumber),
      entityName: entityRef?.name ?? null,
      quickBooksEntityId: entityRef?.value ?? null,
      currency: detail.currency,
      transactionDate: parseQuickBooksDate(transaction.TxnDate),
      subtotalAmount: decimalOrNull(detail.subtotalAmount),
      taxAmount: decimalOrNull(detail.taxAmount),
      totalAmount: decimalOrNull(detail.totalAmount),
      quickBooksExchangeRate: decimalOrNull(detail.exchangeRate),
      quickBooksHomeCurrency: detail.homeTotalAmount !== null ? QUICKBOOKS_HOME_CURRENCY : null,
      quickBooksSubtotalHomeAmount: decimalOrNull(detail.homeSubtotalAmount),
      quickBooksTaxHomeAmount: decimalOrNull(detail.homeTaxAmount),
      quickBooksTotalHomeAmount: decimalOrNull(detail.homeTotalAmount),
      source: QUICKBOOKS_BACKFILL_SOURCE,
      observedAt
    }
  });

  return true;
}

async function upsertSkippedMultiFileQuickBooksTransaction({
  tenantId,
  connection,
  invoiceType,
  transaction,
  fileNumbers
}: {
  tenantId: string;
  connection: QuickBooksBackfillConnection;
  invoiceType: InvoiceAutomationType;
  transaction: QuickBooksBackfillTransaction;
  fileNumbers: string[];
}) {
  if (!transaction.Id) {
    return;
  }
  const entityRef = readQuickBooksTransactionEntityRef(transaction, invoiceType);
  await prisma.invoiceAutomationQuickBooksTransaction.upsert({
    where: {
      tenantId_realmId_invoiceType_quickBooksTxnId: {
        tenantId,
        realmId: connection.realmId,
        invoiceType,
        quickBooksTxnId: transaction.Id
      }
    },
    create: {
      tenantId,
      invoiceAutomationInvoiceId: null,
      realmId: connection.realmId,
      invoiceType,
      quickBooksTxnId: transaction.Id,
      quickBooksTxnNumber: transaction.DocNumber ?? null,
      shipmentFileNumber: null,
      shipmentType: null,
      entityName: entityRef?.name ?? null,
      quickBooksEntityId: entityRef?.value ?? null,
      currency: transaction.CurrencyRef?.value?.toUpperCase() ?? null,
      transactionDate: parseQuickBooksDate(transaction.TxnDate),
      source: `${QUICKBOOKS_BACKFILL_MULTIFILE_SOURCE}:${fileNumbers.join(",")}`,
      observedAt: new Date()
    },
    update: {
      quickBooksTxnNumber: transaction.DocNumber ?? null,
      entityName: entityRef?.name ?? null,
      quickBooksEntityId: entityRef?.value ?? null,
      currency: transaction.CurrencyRef?.value?.toUpperCase() ?? null,
      transactionDate: parseQuickBooksDate(transaction.TxnDate),
      source: `${QUICKBOOKS_BACKFILL_MULTIFILE_SOURCE}:${fileNumbers.join(",")}`,
      observedAt: new Date()
    }
  });
}

async function getQuickBooksCredentials(tenantId: string) {
  const credentials = await prisma.integrationCredential.findMany({
    where: {
      tenantId,
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

  if (credentials.length === 0) {
    throw new QuickBooksPostingMappingError("No active QuickBooks connection is available for this tenant.");
  }

  return credentials;
}

async function getQuickBooksBackfillConnection(credential: QuickBooksCredentialRecord): Promise<QuickBooksBackfillConnection> {
  const config = readQuickBooksPublicConfig(credential.publicConfig);
  if (!config.realmId) {
    throw new QuickBooksPostingMappingError(`${credential.name} is missing a QuickBooks realm ID.`);
  }

  return {
    credential,
    realmId: config.realmId,
    accessToken: await getUsableQuickBooksAccessToken(credential, config)
  };
}

async function getUsableQuickBooksAccessToken(
  credential: QuickBooksCredentialRecord,
  config: ReturnType<typeof readQuickBooksPublicConfig>
) {
  if (!credential.secretRef) {
    throw new QuickBooksPostingMappingError("QuickBooks credential is missing encrypted OAuth tokens.");
  }
  if (!config.realmId) {
    throw new QuickBooksPostingMappingError("QuickBooks credential is missing a realm ID.");
  }

  const secret = decryptQuickBooksSecret(credential.secretRef);
  const expiresAt = config.accessTokenExpiresAt ? new Date(config.accessTokenExpiresAt).getTime() : 0;
  if (secret.accessToken && expiresAt - Date.now() > 120000) {
    return secret.accessToken;
  }

  if (!secret.refreshToken) {
    throw new QuickBooksPostingMappingError("QuickBooks credential is missing a refresh token.");
  }

  const refreshed = await refreshQuickBooksAccessToken({ refreshToken: secret.refreshToken });
  await prisma.integrationCredential.update({
    where: {
      id: credential.id
    },
    data: {
      publicConfig: {
        ...config.raw,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt
      },
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

async function queryQuickBooks({
  realmId,
  accessToken,
  query
}: {
  realmId: string;
  accessToken: string;
  query: string;
}) {
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
    throw new QuickBooksPostingMappingError(`QuickBooks query failed with status ${response.status}: ${text.slice(0, 500)}`);
  }

  return (await response.json()) as {
    QueryResponse?: Partial<Record<QuickBooksBackfillEntityName, QuickBooksBackfillTransaction[]>>;
  };
}

function readQuickBooksTransactionQueryRows(
  json: {
    QueryResponse?: Partial<Record<QuickBooksBackfillEntityName, QuickBooksBackfillTransaction[]>>;
  },
  entityName: QuickBooksBackfillEntityName
) {
  return json.QueryResponse?.[entityName] ?? [];
}

function readQuickBooksTransactionEntityRef(transaction: QuickBooksBackfillTransaction, invoiceType: InvoiceAutomationType) {
  return invoiceType === "CUSTOMER" ? transaction.CustomerRef : transaction.VendorRef;
}

function readQuickBooksPublicConfig(value: Prisma.JsonValue) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  return {
    raw,
    realmId: typeof raw.realmId === "string" ? raw.realmId : null,
    accessTokenExpiresAt: typeof raw.accessTokenExpiresAt === "string" ? raw.accessTokenExpiresAt : null
  };
}

function parseQuickBooksDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function decimalOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? new Prisma.Decimal(value) : null;
}

function getIsoDateMonthsBack(monthsBack: number) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - monthsBack);
  return date.toISOString().slice(0, 10);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function formatQuickBooksBackfillWarning(credential: QuickBooksCredentialRecord, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown QuickBooks error.";
  return `${credential.name}: ${message}`;
}
