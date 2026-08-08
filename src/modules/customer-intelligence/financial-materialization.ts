import {
  CustomerFinancialPeriodStatus,
  CustomerFxRateStatus,
  CustomerIntelligenceServiceLine,
  IntegrationProvider,
  IntegrationStatus,
  Prisma
} from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { auditEntry } from "@/modules/customer-intelligence/audit";
import {
  recordRevenueLine,
  refreshRelationshipLifecycle,
  upsertMonthlyFinancial
} from "@/modules/customer-intelligence/actions";
import {
  CAD_CONSOLIDATION_DISCLOSURE,
  CAD_CURRENCY,
  FX_SOURCE_BANK_OF_CANADA,
  fxStatusForMonthKey,
  fxSourceForMonthKey,
  monthKeyOf,
  roundCurrencyAmount,
  toCadAmount
} from "@/modules/customer-intelligence/fx";
import { requireIngestionAdmin } from "@/modules/customer-intelligence/permissions";
import {
  getUsableQuickBooksAccessToken
} from "@/modules/customer-intelligence/quickbooks-ingestion";
import { resolveServiceLine, type ServiceMappingRuleInput } from "@/modules/customer-intelligence/service-lines";
import { getQuickBooksApiBaseUrl } from "@/server/integrations/quickbooks";

/**
 * Financial materialization (CP-PHASE-02B-5).
 *
 * Materializes the owner-approved GET-only QuickBooks report sources
 * (CP-02B-5-Q1, `PNL_DETAIL_PLUS_AGING`):
 *
 * - the ProfitAndLossDetail report supplies customer revenue transaction
 *   detail over the confirmed 24-month window;
 * - the AgedReceivablesDetail report supplies open accounts receivable;
 * - source transaction identifiers are preserved in the deterministic
 *   `sourceKey` (realm/report plus stable transaction and transaction-line ids
 *   only), so mutable classifications cannot create a second identity and
 *   re-inserting the same `sourceKey` returns the existing immutable
 *   `CustomerRevenueLine` row;
 * - if the QuickBooks API cannot provide the transaction detail needed for a
 *   reliable result, the operating-company section stops and reports the
 *   limitation instead of silently substituting less accurate data.
 *
 * Service lines use the existing `service-lines.ts` precedence and the
 * tenant-scoped `QuickBooksServiceMappingRule` rows; Newell's Express defaults
 * unmapped income to LOCAL_TRUCKING and every other operating company to OTHER.
 *
 * Cost scope follows owner decision CP-02B-5-Q2 and the finance-provided
 * `reference/FINANCE_FS_GROUPINGS_REFERENCE.md`: gross profit is limited to
 * Newl Worldwide, only its documented direct-cost accounts are accepted, and
 * all customer/vendor rows sharing a file number are combined. Vendor costs
 * are associated only when every customer invoice on that file resolves to one
 * tenant- and operating-company-scoped relationship. Their authoritative
 * QuickBooks CAD home amounts remain in the vendor-bill month under the ALL
 * source-account key; they are never proportionally allocated or independently
 * converted.
 *
 * FX follows `fx.ts`: closed months use FINAL Bank of Canada monthly average
 * rates, the current month is PROVISIONAL, and CAD consolidation is labeled
 * directional management reporting. A missing, invalid, wrong-source, or
 * wrong-status stored rate never invents a
 * conversion: the row is skipped, its month is marked INCOMPLETE, and the
 * limitation is reported.
 *
 * Aggregation reuses the existing monthly unique key
 * `(tenantId, companyOperatingRelationshipId, sourceAccountKey, serviceLine,
 * currency, monthKey)` through `upsertMonthlyFinancial`. Unreconciled periods
 * remain INCOMPLETE/UNRECONCILED (never RECONCILED — reconciliation is a later
 * phase). Lifecycle refresh reuses the existing guarded
 * `refreshRelationshipLifecycle` action for every affected relationship.
 *
 * Partial or missing report rows never invent values, all shared data paths
 * carry authenticated `tenantId` filtering, the run is ADMIN-triggered
 * (`requireIngestionAdmin`), `dryRun` performs zero database writes, and no
 * QuickBooks posting or mutation is ever performed.
 */

/** Maximum rows QuickBooks returns for a single report query page. */
export const FINANCIAL_REPORT_PAGE_SIZE = 1000;

/**
 * Deterministic safety bound for report pagination. A provider that ignores
 * paging must stop as a reported limitation rather than grow memory without
 * bound.
 */
export const FINANCIAL_REPORT_MAX_PAGES = 100;

/** The confirmed initial history window: 24 months of revenue detail. */
export const FINANCIAL_WINDOW_MONTHS = 24;

/** Report source constants (CP-02B-5-Q1, PNL_DETAIL_PLUS_AGING). */
export const REPORT_SOURCE_REVENUE = "ProfitAndLossDetail";
export const REPORT_SOURCE_AGING = "AgedReceivablesDetail";

/**
 * A normalized ProfitAndLossDetail row. Every field is optional so partial or
 * completely missing evidence is stored as null and never invented.
 */
export type NormalizedRevenueDetailRow = {
  transactionId: string | null;
  transactionLineId: string | null;
  transactionType: string | null;
  transactionDate: string | null;
  customerId: string | null;
  customerName: string | null;
  accountId: string | null;
  accountNumber: string | null;
  accountName: string | null;
  accountType: string | null;
  classRef: string | null;
  departmentRef: string | null;
  itemRef: string | null;
  memo: string | null;
  memoOnStatement: string | null;
  memoDescription: string | null;
  description: string | null;
  currency: string | null;
  foreignAmount: string | null;
  exchangeRate: string | null;
  amount: string | null;
};

/**
 * A normalized AgedReceivablesDetail row. `bucketAmounts` keeps the aging
 * buckets exactly as reported (for example "1-30", "31-60", "91+"); `total` is
 * the customer's open balance when the report supplies it.
 */
export type NormalizedAgingDetailRow = {
  customerId: string | null;
  customerName: string | null;
  asOfDate: string | null;
  currency: string | null;
  bucketAmounts: Record<string, string>;
  total: string | null;
};

/** A raw QuickBooks report response with its column titles and data rows. */
export type QuickBooksReportRow = {
  type?: string;
  ColData?: Array<{ value?: string }>;
  Header?: { ColData?: Array<{ value?: string }> };
  Rows?: { Row?: QuickBooksReportRow[] };
  Summary?: { ColData?: Array<{ value?: string }> };
};

export type QuickBooksReportResponse = {
  Columns?: { Column?: Array<{ ColTitle?: string }> };
  Rows?: {
    Row?: QuickBooksReportRow[];
  };
};

const REPORT_REVENUE_COLUMN_MAP: Record<string, keyof NormalizedRevenueDetailRow> = {
  "Txn ID": "transactionId",
  "Txn Line ID": "transactionLineId",
  "Transaction Line ID": "transactionLineId",
  Type: "transactionType",
  Date: "transactionDate",
  "Customer ID": "customerId",
  Name: "customerName",
  "Account ID": "accountId",
  "Account Number": "accountNumber",
  "Account No.": "accountNumber",
  "Account #": "accountNumber",
  Account: "accountName",
  "Account Type": "accountType",
  Class: "classRef",
  Department: "departmentRef",
  Item: "itemRef",
  Memo: "memo",
  "Memo on Statement": "memoOnStatement",
  Description: "description",
  "Memo/Description": "memoDescription",
  Currency: "currency",
  "Foreign Amount": "foreignAmount",
  "Native Amount": "foreignAmount",
  "Exchange Rate": "exchangeRate",
  Amount: "amount",
  Total: "amount",
  Balance: "amount"
};

/**
 * Monetary columns supported by the owner-approved AgedReceivablesDetail
 * layout. Descriptive report fields must never be interpreted as money merely
 * because their title is unfamiliar. `Open Balance` is QuickBooks's
 * authoritative outstanding-balance title; `Total` is retained for the
 * equivalent summarized layout already supported by this importer.
 */
const AGING_OPEN_BALANCE_COLUMNS = ["Open Balance", "Total"] as const;
const AGING_BUCKET_COLUMNS = new Set([
  "Current",
  "1-30",
  "1 - 30",
  "31-60",
  "31 - 60",
  "61-90",
  "61 - 90",
  "91+",
  "91 and over"
]);
const AGING_MONETARY_COLUMNS = new Set([
  ...AGING_OPEN_BALANCE_COLUMNS,
  ...AGING_BUCKET_COLUMNS
]);

const REQUIRED_REVENUE_COLUMNS = [
  "Txn ID",
  "Type",
  "Date",
  "Customer ID",
  "Account Type",
  "Currency",
] as const;

const REQUIRED_AGING_COLUMNS = ["Customer ID", "Currency"] as const;

class ReportDetailLimitationError extends Error {}

function requireReportColumns(
  report: "revenue" | "aging",
  columns: string[],
  required: readonly string[]
) {
  const missing = required.filter((column) => !columns.includes(column));
  if (
    report === "revenue" &&
    !columns.includes("Txn Line ID") &&
    !columns.includes("Transaction Line ID")
  ) {
    missing.push("Txn Line ID");
  }
  if (
    report === "revenue" &&
    !columns.includes("Amount") &&
    !columns.includes("Total") &&
    !columns.includes("Balance")
  ) {
    missing.push("Amount");
  }
  if (
    report === "aging" &&
    !columns.some((column) => AGING_MONETARY_COLUMNS.has(column))
  ) {
    missing.push("Open Balance, Total, or a supported aging bucket");
  }
  if (missing.length > 0) {
    throw new ReportDetailLimitationError(
      `QuickBooks ${report} detail lacks stable identifiers or required classification fields.`
    );
  }
}

/**
 * Parse a QuickBooks report response into column titles and raw title->value
 * rows. Total/subtotal rows (type "Total") are excluded — only transaction
 * detail rows are materialized.
 */
export function parseQuickBooksReportRows(
  json: QuickBooksReportResponse
): { columns: string[]; rows: Array<Record<string, string>> } {
  const columns = (json.Columns?.Column ?? [])
    .map((column) => column.ColTitle?.trim() ?? "")
    .filter(Boolean);
  const rows: Array<Record<string, string>> = [];
  const visit = (reportRows: QuickBooksReportRow[], nested: boolean) => {
    for (const row of reportRows) {
      const type = row.type?.trim().toLowerCase();
      if (row.Rows !== undefined) {
        if (!Array.isArray(row.Rows.Row)) {
          throw new ReportDetailLimitationError(
            "QuickBooks report contains unsupported nested detail structure."
          );
        }
        visit(row.Rows.Row, true);
      }
      if (type === "total" || type === "section" || type === "header" || type === "summary") {
        continue;
      }
      if (row.ColData === undefined) {
        if (type === "data" || (nested && !row.Rows)) {
          throw new ReportDetailLimitationError(
            "QuickBooks report contains nested detail without readable column data."
          );
        }
        continue;
      }
      if (!Array.isArray(row.ColData)) {
        throw new ReportDetailLimitationError(
          "QuickBooks report contains unsupported detail column data."
        );
      }
      const values = row.ColData.map((cell) => cell.value?.trim() ?? "");
      const payload: Record<string, string> = {};
      columns.forEach((title, index) => {
        payload[title] = values[index] ?? "";
      });
      rows.push(payload);
    }
  };
  const rootRows = json.Rows?.Row ?? [];
  if (!Array.isArray(rootRows)) {
    throw new ReportDetailLimitationError("QuickBooks report contains unsupported row structure.");
  }
  visit(rootRows, false);
  return { columns, rows };
}

/** Normalize a parsed revenue detail row. Missing fields stay null. */
export function normalizeRevenueDetailRow(
  raw: Record<string, string>
): NormalizedRevenueDetailRow {
  // REPORT_REVENUE_COLUMN_MAP is keyed by QuickBooks column title, so resolve a
  // normalized field by scanning for the first title mapped to it. Equivalent
  // titles (Total vs Balance) resolve deterministically
  // and a missing or empty column stays null — nothing is invented.
  const field = (key: keyof NormalizedRevenueDetailRow): string | null => {
    for (const [columnTitle, normalizedKey] of Object.entries(REPORT_REVENUE_COLUMN_MAP)) {
      if (normalizedKey !== key) {
        continue;
      }
      const value = raw[columnTitle];
      if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
      }
    }
    return null;
  };
  return {
    transactionId: field("transactionId"),
    transactionLineId: field("transactionLineId"),
    transactionType: field("transactionType"),
    transactionDate: field("transactionDate"),
    customerId: field("customerId"),
    customerName: field("customerName"),
    accountId: field("accountId"),
    accountNumber: field("accountNumber"),
    accountName: field("accountName"),
    accountType: field("accountType"),
    classRef: field("classRef"),
    departmentRef: field("departmentRef"),
    itemRef: field("itemRef"),
    memo: field("memo"),
    memoOnStatement: field("memoOnStatement"),
    memoDescription: field("memoDescription"),
    description: field("description"),
    currency: field("currency"),
    foreignAmount: field("foreignAmount"),
    exchangeRate: field("exchangeRate"),
    amount: field("amount")
  };
}

/** Normalize a parsed aging detail row. Missing fields stay null/empty. */
export function normalizeAgingDetailRow(raw: Record<string, string>): NormalizedAgingDetailRow {
  const bucketAmounts: Record<string, string> = {};
  for (const title of AGING_BUCKET_COLUMNS) {
    const value = raw[title];
    if (typeof value !== "string") continue;
    if (value.trim() !== "") {
      bucketAmounts[title] = value.trim();
    }
  }
  const total = AGING_OPEN_BALANCE_COLUMNS
    .map((title) => raw[title]?.trim())
    .find((value) => Boolean(value)) ?? null;
  return {
    customerId: raw["Customer ID"]?.trim() || null,
    customerName: raw["Name"]?.trim() || null,
    asOfDate: raw["Date"]?.trim() || null,
    currency: raw["Currency"]?.trim().toUpperCase() || null,
    bucketAmounts,
    total
  };
}

/**
 * Deterministic money parsing. QuickBooks report amounts arrive as strings
 * (with optional currency symbols/commas); an unparseable value is null —
 * nothing is invented.
 */
export function parseReportAmount(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Deterministic "YYYY-MM-DD" date parsing. Only ISO-style dates are accepted;
 * anything else is null (never invented).
 */
export function parseReportDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Extract a shipment file number (for example TR0121N1 or OE123456N1) from
 * QuickBooks memo/description text. The owner-approved cost scope pairs
 * customer and vendor invoices by this shared file number. The exact pattern
 * (two-letter prefix followed by at least four digits and optional suffix)
 * follows the owner-approved examples for this materialization phase.
 */
export function extractFileNumber(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const match = text.toUpperCase().match(/\b[A-Z]{2}\d{4,}[A-Z0-9]*\b/);
  return match ? match[0] : null;
}

/**
 * Resolve a file number only from the transaction-type-specific fields approved
 * in CP-02B-5-Q2: customer invoices use Description + Memo on Statement;
 * vendor bills use Description + Memo. `Memo/Description` is deliberately not
 * accepted because QuickBooks does not identify which approved source field it
 * represents. Conflicting approved fields fail closed rather than selecting the
 * first value.
 */
function revenueRowFileNumber(
  row: NormalizedRevenueDetailRow,
  kind: "CUSTOMER_REVENUE" | "VENDOR_COST"
): string | null {
  const approvedValues =
    kind === "CUSTOMER_REVENUE"
      ? [row.description, row.memoOnStatement]
      : [row.description, row.memo];
  const fileNumbers = new Set(
    approvedValues
      .map((value) => extractFileNumber(value))
      .filter((value): value is string => value !== null)
  );
  if (fileNumbers.size > 1) {
    throw new ReportDetailLimitationError(
      `QuickBooks ${kind === "CUSTOMER_REVENUE" ? "customer" : "vendor"} detail has conflicting file numbers in approved fields.`
    );
  }
  return fileNumbers.values().next().value ?? null;
}

/**
 * Deterministic immutable identity for one financial transaction-detail line.
 * The ProfitAndLossDetail source contains both customer revenue and eligible
 * vendor cost evidence. Identity is
 * only the report/realm plus stable source transaction and transaction-line
 * identifiers. Transaction type, account, class, item, and other mutable
 * evidence are intentionally excluded so changes become immutable conflicts
 * rather than duplicate rows.
 */
export function revenueLineSourceKey(
  realmId: string,
  transactionId: string,
  transactionLineId: string
): string {
  return `pnl-detail:${realmId}:${transactionId}:${transactionLineId}`;
}

/** Build the GET-only ProfitAndLossDetail query URL for one report page. */
export function buildQuickBooksPnlDetailQueryUrl({
  realmId,
  startDate,
  endDate,
  startPosition,
  maxResults
}: {
  realmId: string;
  startDate: string;
  endDate: string;
  startPosition: number;
  maxResults: number;
}): string {
  const url = new URL(`${getQuickBooksApiBaseUrl()}/v3/company/${realmId}/reports/ProfitAndLossDetail`);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("accounting_method", "Accrual");
  url.searchParams.set("start_position", String(startPosition));
  url.searchParams.set("max_results", String(maxResults));
  return url.toString();
}

/** Build the GET-only AgedReceivablesDetail query URL for one report page. */
export function buildQuickBooksAgingDetailQueryUrl({
  realmId,
  asOfDate,
  startPosition,
  maxResults
}: {
  realmId: string;
  asOfDate: string;
  startPosition: number;
  maxResults: number;
}): string {
  const url = new URL(`${getQuickBooksApiBaseUrl()}/v3/company/${realmId}/reports/AgedReceivablesDetail`);
  url.searchParams.set("as_of_date", asOfDate);
  url.searchParams.set("aging_method", "AgeByDueDate");
  url.searchParams.set("start_position", String(startPosition));
  url.searchParams.set("max_results", String(maxResults));
  return url.toString();
}

/** GET-only report page fetch. Never surfaces upstream bodies in thrown errors. */
async function fetchQuickBooksReportPage(
  url: string,
  accessToken: string
): Promise<QuickBooksReportResponse> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`QuickBooks report query failed with status ${response.status}.`);
  }
  return (await response.json()) as QuickBooksReportResponse;
}

/** Fetch every normalized revenue detail row for the window (GET pagination). */
export async function fetchQuickBooksRevenueDetail({
  realmId,
  accessToken,
  startDate,
  endDate
}: {
  realmId: string;
  accessToken: string;
  startDate: string;
  endDate: string;
}): Promise<NormalizedRevenueDetailRow[]> {
  const rows: NormalizedRevenueDetailRow[] = [];
  let startPosition = 1;
  let pagesFetched = 0;
  const fullPageFingerprints = new Set<string>();
  while (true) {
    if (pagesFetched >= FINANCIAL_REPORT_MAX_PAGES) {
      throw new ReportDetailLimitationError(
        "QuickBooks revenue detail pagination exceeded the deterministic safety limit."
      );
    }
    const url = buildQuickBooksPnlDetailQueryUrl({
      realmId,
      startDate,
      endDate,
      startPosition,
      maxResults: FINANCIAL_REPORT_PAGE_SIZE
    });
    const json = await fetchQuickBooksReportPage(url, accessToken);
    const parsed = parseQuickBooksReportRows(json);
    requireReportColumns("revenue", parsed.columns, REQUIRED_REVENUE_COLUMNS);
    pagesFetched += 1;
    if (parsed.rows.length === FINANCIAL_REPORT_PAGE_SIZE) {
      const fingerprint = JSON.stringify(parsed.rows);
      if (fullPageFingerprints.has(fingerprint)) {
        throw new ReportDetailLimitationError(
          "QuickBooks revenue detail pagination repeated a full page without progress."
        );
      }
      fullPageFingerprints.add(fingerprint);
    }
    for (const raw of parsed.rows) {
      rows.push(normalizeRevenueDetailRow(raw));
    }
    if (parsed.rows.length < FINANCIAL_REPORT_PAGE_SIZE) {
      break;
    }
    startPosition += parsed.rows.length;
  }
  return rows;
}

/** Fetch every normalized aging detail row as of the given date (GET pagination). */
export async function fetchQuickBooksAgingDetail({
  realmId,
  accessToken,
  asOfDate
}: {
  realmId: string;
  accessToken: string;
  asOfDate: string;
}): Promise<NormalizedAgingDetailRow[]> {
  const rows: NormalizedAgingDetailRow[] = [];
  let startPosition = 1;
  let pagesFetched = 0;
  const fullPageFingerprints = new Set<string>();
  while (true) {
    if (pagesFetched >= FINANCIAL_REPORT_MAX_PAGES) {
      throw new ReportDetailLimitationError(
        "QuickBooks aging detail pagination exceeded the deterministic safety limit."
      );
    }
    const url = buildQuickBooksAgingDetailQueryUrl({
      realmId,
      asOfDate,
      startPosition,
      maxResults: FINANCIAL_REPORT_PAGE_SIZE
    });
    const json = await fetchQuickBooksReportPage(url, accessToken);
    const parsed = parseQuickBooksReportRows(json);
    requireReportColumns("aging", parsed.columns, REQUIRED_AGING_COLUMNS);
    pagesFetched += 1;
    if (parsed.rows.length === FINANCIAL_REPORT_PAGE_SIZE) {
      const fingerprint = JSON.stringify(parsed.rows);
      if (fullPageFingerprints.has(fingerprint)) {
        throw new ReportDetailLimitationError(
          "QuickBooks aging detail pagination repeated a full page without progress."
        );
      }
      fullPageFingerprints.add(fingerprint);
    }
    for (const raw of parsed.rows) {
      const normalized = normalizeAgingDetailRow(raw);
      // The snapshot as-of date is a report request parameter, not a row field.
      // Stamp the requested date so every aging row carries a month key.
      rows.push({ ...normalized, asOfDate });
    }
    if (parsed.rows.length < FINANCIAL_REPORT_PAGE_SIZE) {
      break;
    }
    startPosition += parsed.rows.length;
  }
  return rows;
}

/** Per-operating-company materialization report section. */
export type OperatingCompanyMaterializationSection = {
  operatingCompanyId: string;
  slug: string;
  displayName: string;
  status: "ASSOCIATED" | "SKIPPED_UNASSOCIATED" | "ERROR" | "LIMITATION";
  reason?: string;
  fetchedRevenueRows: number;
  fetchedAgingRows: number;
  revenueMaterialized: number;
  revenuePreserved: number;
  revenueSkippedMissingIdentity: number;
  revenueSkippedUnmatched: number;
  revenueSkippedMissingRequired: number;
  revenueSkippedInvalidAmount: number;
  revenueSkippedMissingFx: number;
  reportRowsSkippedOutsideWindow: number;
  costRowsPaired: number;
  costRowsAmbiguous: number;
  agingMaterialized: number;
  agingSkippedUnmatched: number;
  agingSkippedMissingEvidence: number;
  monthlyRowsWritten: number;
  relationshipsRefreshed: number;
  fxRatesApplied: number;
  fxRatesMissing: number;
  recordErrors: number;
  incompleteMonths: number;
  warnings: string[];
};

export type FinancialMaterializationTotals = {
  fetchedRevenueRows: number;
  fetchedAgingRows: number;
  revenueMaterialized: number;
  revenuePreserved: number;
  revenueSkippedMissingIdentity: number;
  revenueSkippedUnmatched: number;
  revenueSkippedMissingRequired: number;
  revenueSkippedInvalidAmount: number;
  revenueSkippedMissingFx: number;
  reportRowsSkippedOutsideWindow: number;
  costRowsPaired: number;
  costRowsAmbiguous: number;
  agingMaterialized: number;
  agingSkippedUnmatched: number;
  agingSkippedMissingEvidence: number;
  monthlyRowsWritten: number;
  relationshipsRefreshed: number;
  fxRatesApplied: number;
  fxRatesMissing: number;
  recordErrors: number;
  incompleteMonths: number;
  unassociatedCompanies: number;
  erroredCompanies: number;
  limitationCompanies: number;
};

export type FinancialMaterializationReport = {
  tenantId: string;
  dryRun: boolean;
  cadConsolidation: string;
  startedAt: string;
  completedAt: string;
  operatingCompanies: OperatingCompanyMaterializationSection[];
  totals: FinancialMaterializationTotals;
};

/** Non-persisted source-account mapping supplied by the consolidated dry-run. */
export type FinancialMaterializationDryRunSourceAccount = {
  id: string;
  tenantId: string;
  currency: string;
  companyId: string;
  companyOperatingRelationshipId: string;
  operatingCompanyId: string;
  realmId: string;
  quickBooksCustomerId: string;
  displayName: string;
};

/** A resolved revenue/aging customer within the authenticated tenant. */
type ResolvedCustomerTarget = {
  companyId: string;
  operatingCompanyId: string;
  relationshipId: string;
  sourceAccount: { id: string; currency: string } | null;
  sourceAccountKey: string;
};

function newSection(
  operatingCompany: {
    id: string;
    slug: string;
    displayName: string;
  }
): OperatingCompanyMaterializationSection {
  return {
    operatingCompanyId: operatingCompany.id,
    slug: operatingCompany.slug,
    displayName: operatingCompany.displayName,
    status: "ASSOCIATED",
    fetchedRevenueRows: 0,
    fetchedAgingRows: 0,
    revenueMaterialized: 0,
    revenuePreserved: 0,
    revenueSkippedMissingIdentity: 0,
    revenueSkippedUnmatched: 0,
    revenueSkippedMissingRequired: 0,
    revenueSkippedInvalidAmount: 0,
    revenueSkippedMissingFx: 0,
    reportRowsSkippedOutsideWindow: 0,
    costRowsPaired: 0,
    costRowsAmbiguous: 0,
    agingMaterialized: 0,
    agingSkippedUnmatched: 0,
    agingSkippedMissingEvidence: 0,
    monthlyRowsWritten: 0,
    relationshipsRefreshed: 0,
    fxRatesApplied: 0,
    fxRatesMissing: 0,
    recordErrors: 0,
    incompleteMonths: 0,
    warnings: []
  };
}

/**
 * Resolve a QuickBooks report customer to its canonical company, relationship,
 * and source account. Only an exact stable QuickBooks customer id persisted on
 * a source account in the same tenant, realm, and operating company is
 * authoritative. Display names are evidence for review, never identity keys.
 */
async function resolveReportCustomer(
  ctx: AuthenticatedContext,
  input: {
    customerId: string | null;
    operatingCompanyId: string;
    realmId: string;
  },
  virtualSourceAccounts: FinancialMaterializationDryRunSourceAccount[] = []
): Promise<ResolvedCustomerTarget | null> {
  const persistedSourceAccounts: Array<{
    id: string;
    currency: string;
    companyId: string;
    companyOperatingRelationshipId: string;
    operatingCompanyId: string;
    quickBooksCustomerId: string;
    displayName: string;
  }> = await prisma.customerSourceAccount.findMany({
    where: tenantWhere(ctx, {
      operatingCompanyId: input.operatingCompanyId,
      realmId: input.realmId
    })
  });

  const scopedVirtualAccounts = virtualSourceAccounts.filter(
    (account) =>
      account.tenantId === ctx.tenantId &&
      account.operatingCompanyId === input.operatingCompanyId &&
      account.realmId === input.realmId
  );
  if (virtualSourceAccounts.some((account) => account.tenantId !== ctx.tenantId)) {
    throw new Error("Virtual materialization evidence does not belong to this tenant.");
  }
  const virtualKeys = new Set(
    scopedVirtualAccounts.map(
      (account) =>
        `${account.operatingCompanyId}:${account.realmId}:${account.quickBooksCustomerId}`
    )
  );
  const sourceAccounts = [
    ...persistedSourceAccounts.filter(
      (account) =>
        !virtualKeys.has(
          `${account.operatingCompanyId}:${input.realmId}:${account.quickBooksCustomerId}`
        )
    ),
    ...scopedVirtualAccounts
  ];

  const customerId = input.customerId?.trim();
  if (!customerId) {
    return null;
  }
  const matched = sourceAccounts.filter(
    (account) =>
      account.quickBooksCustomerId === customerId
  );

  if (matched.length !== 1) {
    return null;
  }

  const account = matched[0];
  const relationship = await prisma.companyOperatingRelationship.findFirst({
    where: tenantWhere(ctx, {
      id: account.companyOperatingRelationshipId,
      companyId: account.companyId,
      operatingCompanyId: account.operatingCompanyId
    })
  });
  if (!relationship) {
    return null;
  }

  return {
    companyId: account.companyId,
    operatingCompanyId: account.operatingCompanyId,
    relationshipId: relationship.id,
    sourceAccount: { id: account.id, currency: account.currency },
    sourceAccountKey: account.id
  };
}

type FxRateLookup = { rateToCad: number; status: CustomerFxRateStatus } | null;

async function resolveFxRate(
  ctx: AuthenticatedContext,
  currency: string,
  monthKey: string,
  now: Date,
  cache: Map<string, FxRateLookup>
): Promise<FxRateLookup> {
  if (currency === CAD_CURRENCY) {
    return { rateToCad: 1, status: "FINAL" as CustomerFxRateStatus };
  }
  const key = `${currency}:${monthKey}`;
  if (!cache.has(key)) {
    const expectedStatus = fxStatusForMonthKey(monthKey, now);
    const row = await prisma.customerFxRate.findFirst({
      where: tenantWhere(ctx, {
        currency,
        monthKey,
        source: FX_SOURCE_BANK_OF_CANADA,
        status: expectedStatus
      })
    });
    const rateToCad = row ? Number(row.rateToCad) : Number.NaN;
    cache.set(
      key,
      row &&
        row.source === FX_SOURCE_BANK_OF_CANADA &&
        row.status === expectedStatus &&
        Number.isFinite(rateToCad) &&
        rateToCad > 0
        ? { rateToCad, status: row.status }
        : null
    );
  }
  return cache.get(key) ?? null;
}

/** The in-memory monthly aggregation bucket keyed by the schema unique key. */
type MonthBucket = {
  monthKey: string;
  companyId: string;
  operatingCompanyId: string;
  companyOperatingRelationshipId: string;
  sourceAccountId: string | null;
  sourceAccountKey: string;
  serviceLine: CustomerIntelligenceServiceLine;
  currency: string;
  nativeRevenue: number;
  nativeCost: number;
  nativeGrossProfit: number;
  cadRevenue: number | null;
  nativeOpenAr: number;
  cadOpenAr: number | null;
  incomplete: boolean;
  hasRevenueEvidence: boolean;
};

function bucketKey(bucket: {
  companyOperatingRelationshipId: string;
  sourceAccountKey: string;
  serviceLine: CustomerIntelligenceServiceLine;
  currency: string;
  monthKey: string;
}): string {
  return [
    bucket.companyOperatingRelationshipId,
    bucket.sourceAccountKey,
    bucket.serviceLine,
    bucket.currency,
    bucket.monthKey
  ].join("|");
}

function newBucket(
  monthKey: string,
  target: ResolvedCustomerTarget,
  serviceLine: CustomerIntelligenceServiceLine,
  currency: string
): MonthBucket {
  return {
    monthKey,
    companyId: target.companyId,
    operatingCompanyId: target.operatingCompanyId,
    companyOperatingRelationshipId: target.relationshipId,
    sourceAccountId: target.sourceAccount?.id ?? null,
    sourceAccountKey: target.sourceAccountKey,
    serviceLine,
    currency,
    nativeRevenue: 0,
    nativeCost: 0,
    nativeGrossProfit: 0,
    cadRevenue: 0,
    nativeOpenAr: 0,
    cadOpenAr: null,
    incomplete: false,
    hasRevenueEvidence: false
  };
}

type RevenueRowClassification =
  | { kind: "CUSTOMER_REVENUE"; amount: number }
  | { kind: "VENDOR_COST"; amount: number }
  | { kind: "EXCLUDED" }
  | { kind: "LIMITATION"; reason: string };

/**
 * Finance-provided Newl Worldwide Cost of Goods Sold/direct-cost accounts.
 * Source: reference/FINANCE_FS_GROUPINGS_REFERENCE.md, grouping 22.01.
 */
export const NEWL_WORLDWIDE_DIRECT_COST_ACCOUNT_CODES = new Set([
  "5014",
  "5015",
  "5020",
  "5030",
  "5115",
  "5205",
  "5300",
  "5400",
  "5401",
  "5590"
]);

export function newlWorldwideDirectCostAccountCode(
  row: Pick<NormalizedRevenueDetailRow, "accountNumber" | "accountName">
): string | null {
  // QuickBooks Account ID is an opaque entity identifier and must never be
  // interpreted as a chart-of-accounts number. Prefer an explicit report
  // account-number column; otherwise accept only a code at the beginning of
  // the verified Account display name (for example "5015 Trucking Rate").
  const explicitAccountNumber = row.accountNumber?.trim() ?? "";
  if (NEWL_WORLDWIDE_DIRECT_COST_ACCOUNT_CODES.has(explicitAccountNumber)) {
    return explicitAccountNumber;
  }
  const accountNameCode = row.accountName
    ?.trim()
    .match(/^(5014|5015|5020|5030|5115|5205|5300|5400|5401|5590)(?=\s|[-:–—]|$)/)?.[1];
  if (accountNameCode && NEWL_WORLDWIDE_DIRECT_COST_ACCOUNT_CODES.has(accountNameCode)) {
    return accountNameCode;
  }
  return null;
}

function normalizedClassification(value: string | null): string {
  return (value ?? "").trim().toUpperCase().replace(/[\s_-]+/g, " ");
}

/**
 * Classify report evidence from explicit QuickBooks transaction and account
 * fields. Amount sign is never used to decide whether a row is revenue or cost.
 */
export function classifyRevenueDetailRow(
  row: Pick<NormalizedRevenueDetailRow, "transactionType" | "accountType" | "amount"> &
    Partial<Pick<NormalizedRevenueDetailRow, "foreignAmount" | "accountNumber" | "accountName">>
): RevenueRowClassification {
  // ProfitAndLossDetail Amount is the authoritative home/report amount for
  // classification. Foreign Amount is supplemental native evidence and must
  // never override a populated home-currency Amount.
  const amount = parseReportAmount(row.amount) ?? parseReportAmount(row.foreignAmount);
  if (amount === null || amount === 0) {
    return { kind: "EXCLUDED" };
  }
  const transactionType = normalizedClassification(row.transactionType);
  const accountType = normalizedClassification(row.accountType);

  if (!transactionType) {
    return {
      kind: "LIMITATION",
      reason: "QuickBooks detail rows lack reliable transaction classification."
    };
  }

  if (transactionType === "INVOICE" || transactionType === "CREDIT MEMO") {
    if (!accountType) {
      return {
        kind: "LIMITATION",
        reason: "QuickBooks revenue rows lack reliable account classification."
      };
    }
    if (accountType !== "INCOME" && accountType !== "OTHER INCOME") {
      return { kind: "EXCLUDED" };
    }
    return {
      kind: "CUSTOMER_REVENUE",
      amount: transactionType === "CREDIT MEMO" ? -Math.abs(amount) : amount
    };
  }

  if (transactionType === "BILL" || transactionType === "VENDOR CREDIT") {
    if (!accountType) {
      return {
        kind: "LIMITATION",
        reason: "QuickBooks vendor rows lack reliable account classification."
      };
    }
    const approvedDirectCostAccount = newlWorldwideDirectCostAccountCode({
      accountNumber: row.accountNumber ?? null,
      accountName: row.accountName ?? null
    });
    if (
      !approvedDirectCostAccount ||
      (accountType !== "COST OF GOODS SOLD" &&
        accountType !== "EXPENSE" &&
        accountType !== "OTHER EXPENSE")
    ) {
      return { kind: "EXCLUDED" };
    }
    return {
      kind: "VENDOR_COST",
      amount: transactionType === "VENDOR CREDIT" ? -Math.abs(amount) : Math.abs(amount)
    };
  }

  if (accountType === "INCOME" || accountType === "OTHER INCOME") {
    return {
      kind: "LIMITATION",
      reason:
        "QuickBooks income detail contains a transaction type outside the owner-approved supported matrix."
    };
  }

  return { kind: "EXCLUDED" };
}

type TransactionMoney = {
  nativeCurrency: string;
  nativeAmount: number;
  homeAmount: number;
};

/**
 * Resolve transaction currency from report evidence, never from the mapped
 * customer account. ProfitAndLossDetail Amount is the home/report amount; a
 * foreign customer-revenue transaction must additionally carry its native
 * amount and exchange rate, whose arithmetic is validated before either value
 * is materialized. Vendor costs use `resolveVendorCostMoney` instead.
 */
function resolveTransactionMoney(
  row: NormalizedRevenueDetailRow,
  homeCurrency: string
): TransactionMoney | null {
  const nativeCurrency = row.currency?.trim().toUpperCase() ?? "";
  const normalizedHomeCurrency = homeCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(nativeCurrency) || !/^[A-Z]{3}$/.test(normalizedHomeCurrency)) {
    return null;
  }
  const reportHomeAmount = parseReportAmount(row.amount);
  if (reportHomeAmount === null) {
    return null;
  }
  const transactionType = normalizedClassification(row.transactionType);
  const signed = (value: number) => {
    if (transactionType === "CREDIT MEMO") return -Math.abs(value);
    if (transactionType === "BILL") return Math.abs(value);
    if (transactionType === "VENDOR CREDIT") return -Math.abs(value);
    return value;
  };
  if (nativeCurrency === normalizedHomeCurrency) {
    return {
      nativeCurrency,
      // Amount is QuickBooks's authoritative home-currency evidence. A
      // populated or inconsistent Foreign Amount must not override it.
      nativeAmount: signed(reportHomeAmount),
      homeAmount: signed(reportHomeAmount)
    };
  }
  const reportNativeAmount = parseReportAmount(row.foreignAmount);
  const exchangeRate = parseReportAmount(row.exchangeRate);
  if (reportNativeAmount === null || exchangeRate === null || exchangeRate <= 0) {
    return null;
  }
  // Validate magnitudes because credit/vendor signs are normalized separately.
  if (Math.abs(Math.abs(reportNativeAmount * exchangeRate) - Math.abs(reportHomeAmount)) > 0.02) {
    return null;
  }
  return {
    nativeCurrency,
    nativeAmount: signed(reportNativeAmount),
    homeAmount: signed(reportHomeAmount)
  };
}

/**
 * Vendor costs use QuickBooks's authoritative CAD home amount directly. A
 * foreign native amount is retained only when QuickBooks supplies it; exchange
 * rate evidence is neither required nor used to derive or validate the booked
 * CAD cost.
 */
function resolveVendorCostMoney(
  row: NormalizedRevenueDetailRow,
  homeCurrency: string
): TransactionMoney | null {
  const nativeCurrency = row.currency?.trim().toUpperCase() ?? "";
  const normalizedHomeCurrency = homeCurrency.trim().toUpperCase();
  if (
    !/^[A-Z]{3}$/.test(nativeCurrency) ||
    normalizedHomeCurrency !== CAD_CURRENCY
  ) {
    return null;
  }
  const reportHomeAmount = parseReportAmount(row.amount);
  if (reportHomeAmount === null) {
    return null;
  }
  const vendorCredit = normalizedClassification(row.transactionType) === "VENDOR CREDIT";
  const signed = (value: number) => vendorCredit ? -Math.abs(value) : Math.abs(value);
  if (nativeCurrency === normalizedHomeCurrency) {
    return {
      nativeCurrency,
      // The home-currency Amount is authoritative for both native and home
      // evidence; Foreign Amount is not an approved substitute.
      nativeAmount: signed(reportHomeAmount),
      homeAmount: signed(reportHomeAmount)
    };
  }
  const reportNativeAmount = parseReportAmount(row.foreignAmount);
  if (reportNativeAmount === null) {
    return null;
  }
  return {
    nativeCurrency,
    nativeAmount: signed(reportNativeAmount),
    homeAmount: signed(reportHomeAmount)
  };
}

function sameDate(left: Date | string, right: Date): boolean {
  return new Date(left).getTime() === right.getTime();
}

type ProposedImmutableRevenue = {
  sourceAccountId: string | null;
  companyId: string;
  operatingCompanyId: string;
  transactionDate: Date;
  transactionType: string;
  transactionNumber: string;
  accountRef: string | null;
  classRef: string | null;
  itemRef: string | null;
  fileRef: string | null;
  serviceLine: CustomerIntelligenceServiceLine;
  nativeAmount: number;
  nativeCurrency: string;
  homeAmount: number;
  homeCurrency: string;
  cadAmount: number;
  fxSource: string;
};

/**
 * CustomerRevenueLine monetary evidence is stored as Decimal(14,2). Normalize
 * every proposed immutable amount to that exact cent rule before comparing,
 * persisting, or aggregating it so a repeated higher-precision report value is
 * idempotent with the value PostgreSQL retained.
 */
function canonicalizeProposedImmutableRevenue(
  proposed: ProposedImmutableRevenue
): ProposedImmutableRevenue {
  return {
    ...proposed,
    nativeAmount: roundCurrencyAmount(proposed.nativeAmount),
    homeAmount: roundCurrencyAmount(proposed.homeAmount),
    cadAmount: roundCurrencyAmount(proposed.cadAmount)
  };
}

function immutableRevenueConflict(
  existing: Record<string, unknown>,
  proposed: ProposedImmutableRevenue
): boolean {
  // cadAmount/fxSource are derived management-conversion materialization, not
  // QuickBooks source evidence only for foreign customer revenue converted with
  // Bank of Canada rates. Permit that narrow path to drive a FINAL monthly
  // aggregate after its previously PROVISIONAL month closes, without rewriting
  // the immutable row or changing its sourceKey. Native-CAD and authoritative
  // vendor-home values remain conflict-checked.
  const bankOfCanadaConversion = (value: unknown) =>
    typeof value === "string" && /^BANK_OF_CANADA_(PROVISIONAL|FINAL)$/.test(value);
  const canRematerializeCadConversion =
    proposed.sourceAccountId !== null &&
    proposed.nativeCurrency !== CAD_CURRENCY &&
    bankOfCanadaConversion(existing.fxSource) &&
    bankOfCanadaConversion(proposed.fxSource);
  return !(
    (existing.sourceAccountId ?? null) === proposed.sourceAccountId &&
    existing.companyId === proposed.companyId &&
    existing.operatingCompanyId === proposed.operatingCompanyId &&
    existing.transactionDate != null &&
    sameDate(existing.transactionDate as Date | string, proposed.transactionDate) &&
    existing.transactionType === proposed.transactionType &&
    existing.transactionNumber === proposed.transactionNumber &&
    (existing.accountRef ?? null) === proposed.accountRef &&
    (existing.classRef ?? null) === proposed.classRef &&
    (existing.itemRef ?? null) === proposed.itemRef &&
    (existing.fileRef ?? null) === proposed.fileRef &&
    existing.serviceLine === proposed.serviceLine &&
    Number(existing.nativeAmount) === proposed.nativeAmount &&
    existing.nativeCurrency === proposed.nativeCurrency &&
    Number(existing.homeAmount) === proposed.homeAmount &&
    existing.homeCurrency === proposed.homeCurrency &&
    (canRematerializeCadConversion ||
      (Number(existing.cadAmount) === proposed.cadAmount &&
        existing.fxSource === proposed.fxSource))
  );
}

class ImmutableRevenueConflictError extends Error {}

type ImmutableEvidenceForAggregation = ProposedImmutableRevenue & { sourceKey: string };

/**
 * Rebuild revenue, cost, and gross profit from the complete immutable evidence
 * set for the approved window. Current report rows are included for dry-run and
 * mocked persistence, while persisted rows ensure that a source line omitted by
 * a later report cannot silently disappear from only part of a monthly total.
 */
async function aggregateImmutableFinancialEvidence(
  ctx: AuthenticatedContext,
  client: Prisma.TransactionClient,
  baseBuckets: Map<string, MonthBucket>,
  currentEvidence: Array<{ sourceKey: string; immutable: ProposedImmutableRevenue }>,
  operatingCompany: { id: string; slug: string },
  windowStart: Date,
  windowEnd: Date
): Promise<Map<string, MonthBucket>> {
  const buckets = new Map(
    [...baseBuckets.entries()].map(([key, bucket]) => [key, { ...bucket }])
  );
  const persisted =
    (await client.customerRevenueLine.findMany({
      where: tenantWhere(ctx, {
        operatingCompanyId: operatingCompany.id,
        transactionDate: { gte: windowStart, lte: windowEnd }
      })
    })) ?? [];

  // The rolling request window bounds only the evidence fetched by this run.
  // It is not an approved retention or retirement rule, so monthly periods
  // outside the requested interval are not queried or destructively replaced.
  const evidenceBySourceKey = new Map<string, ImmutableEvidenceForAggregation>();
  for (const line of persisted) {
    if (!line.transactionNumber || line.cadAmount === null || !line.fxSource) {
      throw new ImmutableRevenueConflictError(
        "Persisted immutable financial evidence is missing required aggregation values."
      );
    }
    evidenceBySourceKey.set(line.sourceKey, {
      sourceKey: line.sourceKey,
      sourceAccountId: line.sourceAccountId,
      companyId: line.companyId,
      operatingCompanyId: line.operatingCompanyId,
      transactionDate: line.transactionDate,
      transactionType: line.transactionType,
      transactionNumber: line.transactionNumber,
      accountRef: line.accountRef,
      classRef: line.classRef,
      itemRef: line.itemRef,
      fileRef: line.fileRef,
      serviceLine: line.serviceLine,
      nativeAmount: Number(line.nativeAmount),
      nativeCurrency: line.nativeCurrency,
      homeAmount: Number(line.homeAmount),
      homeCurrency: line.homeCurrency,
      cadAmount: Number(line.cadAmount),
      fxSource: line.fxSource
    });
  }
  for (const current of currentEvidence) {
    evidenceBySourceKey.set(current.sourceKey, {
      sourceKey: current.sourceKey,
      ...current.immutable
    });
  }

  const relationshipCache = new Map<string, ResolvedCustomerTarget>();
  const touchedKeys = new Set<string>();
  const bucketFor = async (
    line: ImmutableEvidenceForAggregation,
    sourceAccountId: string | null,
    sourceAccountKey: string,
    currency: string
  ) => {
    const relationshipCacheKey = `${line.companyId}|${sourceAccountKey}`;
    let target = relationshipCache.get(relationshipCacheKey);
    if (!target) {
      const relationship = await client.companyOperatingRelationship.findFirst({
        where: tenantWhere(ctx, {
          companyId: line.companyId,
          operatingCompanyId: operatingCompany.id
        })
      });
      if (!relationship) {
        throw new ImmutableRevenueConflictError(
          "Persisted immutable financial evidence has no tenant-scoped operating-company relationship."
        );
      }
      let sourceAccount: { id: string; currency: string } | null = null;
      if (sourceAccountId) {
        const account = await client.customerSourceAccount.findFirst({
          where: tenantWhere(ctx, {
            id: sourceAccountId,
            companyId: line.companyId,
            operatingCompanyId: operatingCompany.id,
            companyOperatingRelationshipId: relationship.id
          })
        });
        if (!account) {
          throw new ImmutableRevenueConflictError(
            "Persisted immutable revenue evidence has no tenant-scoped source account."
          );
        }
        sourceAccount = { id: account.id, currency: account.currency };
      }
      target = {
        companyId: line.companyId,
        operatingCompanyId: operatingCompany.id,
        relationshipId: relationship.id,
        sourceAccount,
        sourceAccountKey
      };
      relationshipCache.set(relationshipCacheKey, target);
    }
    const monthKey = monthKeyOf(line.transactionDate);
    const key = bucketKey({
      companyOperatingRelationshipId: target.relationshipId,
      sourceAccountKey,
      serviceLine: line.serviceLine,
      currency,
      monthKey
    });
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = newBucket(monthKey, target, line.serviceLine, currency);
      buckets.set(key, bucket);
    }
    if (!touchedKeys.has(key)) {
      bucket.nativeRevenue = 0;
      bucket.nativeCost = 0;
      bucket.nativeGrossProfit = 0;
      bucket.cadRevenue = 0;
      bucket.hasRevenueEvidence = false;
      touchedKeys.add(key);
    }
    return bucket;
  };

  for (const line of evidenceBySourceKey.values()) {
    if (
      !Number.isFinite(line.nativeAmount) ||
      !Number.isFinite(line.homeAmount) ||
      !Number.isFinite(line.cadAmount)
    ) {
      throw new ImmutableRevenueConflictError(
        "Persisted immutable financial evidence contains an invalid monetary value."
      );
    }
    if (line.operatingCompanyId !== operatingCompany.id) {
      throw new ImmutableRevenueConflictError(
        "Persisted immutable financial evidence crossed an operating-company boundary."
      );
    }
    const vendorCost =
      line.sourceAccountId === null &&
      (normalizedClassification(line.transactionType) === "BILL" ||
        normalizedClassification(line.transactionType) === "VENDOR CREDIT") &&
      line.fxSource === "QUICKBOOKS_HOME_CAD";
    if (vendorCost) {
      const bucket = await bucketFor(line, null, "ALL", CAD_CURRENCY);
      bucket.nativeCost += line.homeAmount;
      bucket.nativeGrossProfit -= line.homeAmount;
      bucket.hasRevenueEvidence = true;
      continue;
    }
    if (!line.sourceAccountId) {
      throw new ImmutableRevenueConflictError(
        "Persisted immutable revenue evidence lacks its tenant-scoped source account."
      );
    }
    const revenueBucket = await bucketFor(
      line,
      line.sourceAccountId,
      line.sourceAccountId,
      line.nativeCurrency
    );
    revenueBucket.nativeRevenue += line.nativeAmount;
    revenueBucket.cadRevenue = (revenueBucket.cadRevenue ?? 0) + line.cadAmount;
    revenueBucket.hasRevenueEvidence = true;

    if (operatingCompany.slug === "newl-worldwide") {
      const grossProfitBucket = await bucketFor(line, null, "ALL", CAD_CURRENCY);
      grossProfitBucket.nativeGrossProfit += line.homeAmount;
      grossProfitBucket.hasRevenueEvidence = true;
    }
  }
  return buckets;
}

function monthlyInputsFromBuckets(buckets: Map<string, MonthBucket>) {
  return [...buckets.values()].map((bucket) => ({
    monthKey: bucket.monthKey,
    companyId: bucket.companyId,
    operatingCompanyId: bucket.operatingCompanyId,
    companyOperatingRelationshipId: bucket.companyOperatingRelationshipId,
    sourceAccountId: bucket.sourceAccountId ?? undefined,
    sourceAccountKey: bucket.sourceAccountKey,
    serviceLine: bucket.serviceLine,
    currency: bucket.currency,
    nativeRevenue: round2(bucket.nativeRevenue),
    nativeCost: round2(bucket.nativeCost),
    nativeGrossProfit: round2(bucket.nativeGrossProfit),
    cadRevenue: bucket.cadRevenue === null ? undefined : round2(bucket.cadRevenue),
    nativeOpenAr: round2(bucket.nativeOpenAr),
    cadOpenAr:
      bucket.cadOpenAr === null
        ? bucket.nativeOpenAr > 0
          ? null
          : 0
        : round2(bucket.cadOpenAr),
    reconciliationStatus: bucket.incomplete
      ? CustomerFinancialPeriodStatus.INCOMPLETE
      : CustomerFinancialPeriodStatus.UNRECONCILED,
    preserveRevenue: bucket.incomplete && !bucket.hasRevenueEvidence
  }));
}

async function materializeForOperatingCompany(
  ctx: AuthenticatedContext,
  operatingCompany: {
    id: string;
    slug: string;
    displayName: string;
    homeCurrency: string;
    quickBooksRealmId: string | null;
    quickBooksCredentialId: string | null;
  },
  dryRun: boolean,
  virtualSourceAccounts: FinancialMaterializationDryRunSourceAccount[] = []
): Promise<OperatingCompanyMaterializationSection> {
  const section = newSection(operatingCompany);

  if (!operatingCompany.quickBooksCredentialId || !operatingCompany.quickBooksRealmId) {
    section.status = "SKIPPED_UNASSOCIATED";
    section.reason = "Operating company has no associated QuickBooks credential.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.financial-materialization.skipped-unassociated",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }

  const credential = await prisma.integrationCredential.findFirst({
    where: tenantWhere(ctx, { id: operatingCompany.quickBooksCredentialId })
  });
  if (
    !credential ||
    credential.provider !== IntegrationProvider.QUICKBOOKS ||
    credential.status !== IntegrationStatus.ACTIVE
  ) {
    section.status = "SKIPPED_UNASSOCIATED";
    section.reason =
      "Associated QuickBooks credential is missing, is not a QuickBooks credential, or is not ACTIVE.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.financial-materialization.skipped-unassociated",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }

  const realmId = operatingCompany.quickBooksRealmId;

  let accessToken: string | null;
  try {
    accessToken = await getUsableQuickBooksAccessToken({
      credential,
      tenantId: ctx.tenantId,
      expectedRealmId: realmId,
      dryRun
    });
  } catch {
    section.status = "ERROR";
    section.reason = "Unable to obtain a usable QuickBooks access token.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.financial-materialization.error",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }
  if (!accessToken) {
    section.status = "ERROR";
    section.reason =
      "Access token is expired and token refresh writes are disabled in dry-run mode.";
    return section;
  }

  const now = new Date();
  const endDate = toIsoDate(now);
  const startDate = toIsoDate(addMonthsUtc(now, -FINANCIAL_WINDOW_MONTHS));

  let revenueRows: NormalizedRevenueDetailRow[];
  try {
    revenueRows = await fetchQuickBooksRevenueDetail({ realmId, accessToken, startDate, endDate });
  } catch (error) {
    section.status = error instanceof ReportDetailLimitationError ? "LIMITATION" : "ERROR";
    section.reason =
      error instanceof ReportDetailLimitationError
        ? error.message
        : "QuickBooks revenue detail fetch failed.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action:
          section.status === "LIMITATION"
            ? "customer-intelligence.financial-materialization.limitation"
            : "customer-intelligence.financial-materialization.error",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }
  section.fetchedRevenueRows = revenueRows.length;

  // QuickBooks receives the approved inclusive window in the request, but the
  // provider response is not trusted to enforce it. Exclude every dated row
  // outside that same interval before classification, identity resolution,
  // persistence, aggregation, or lifecycle refresh. Missing dates remain in
  // the normal partial-evidence path below; nothing is invented for them.
  const windowStart = parseReportDate(startDate)!;
  const windowEnd = parseReportDate(endDate)!;
  const outsideWindowMonths = new Set<string>();
  const materializableRevenueRows = revenueRows.filter((row) => {
    const transactionDate = parseReportDate(row.transactionDate);
    if (
      transactionDate &&
      (transactionDate.getTime() < windowStart.getTime() ||
        transactionDate.getTime() > windowEnd.getTime())
    ) {
      section.reportRowsSkippedOutsideWindow += 1;
      outsideWindowMonths.add(monthKeyOf(transactionDate));
      return false;
    }
    return true;
  });
  if (section.reportRowsSkippedOutsideWindow > 0) {
    section.warnings.push(
      "QuickBooks returned report rows outside the approved inclusive 24-month window; they were skipped and their periods marked incomplete."
    );
  }

  // CP-02B-5-Q1: if the API cannot provide transaction-level detail, stop and
  // report the limitation rather than silently substituting less accurate data.
  if (
    materializableRevenueRows.length > 0 &&
    materializableRevenueRows.every((row) => !row.transactionId)
  ) {
    section.status = "LIMITATION";
    section.reason =
      "QuickBooks revenue detail did not provide transaction-level data; stopped without substituting less accurate data.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.financial-materialization.limitation",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }

  const unsupportedDetail = materializableRevenueRows
    .map(classifyRevenueDetailRow)
    .find((classification) => classification.kind === "LIMITATION");
  if (unsupportedDetail?.kind === "LIMITATION") {
    section.status = "LIMITATION";
    section.reason = unsupportedDetail.reason;
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.financial-materialization.limitation",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }

  const stableRevenueRows = materializableRevenueRows.filter((row) => {
    const classification = classifyRevenueDetailRow(row);
    return (
      classification.kind === "CUSTOMER_REVENUE" ||
      (operatingCompany.slug === "newl-worldwide" && classification.kind === "VENDOR_COST")
    );
  });
  if (
    stableRevenueRows.some(
      (row) =>
        !row.transactionId ||
        !row.transactionLineId ||
        (classifyRevenueDetailRow(row).kind === "CUSTOMER_REVENUE" && !row.customerId)
    )
  ) {
    section.status = "LIMITATION";
    section.reason =
      "QuickBooks financial detail lacks a stable transaction-line identifier, or customer revenue lacks a stable customer identifier; name-only identity is not materialized.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.financial-materialization.limitation",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }
  const fetchedSourceKeys = new Set<string>();
  for (const row of stableRevenueRows) {
    const sourceKey = revenueLineSourceKey(
      realmId,
      row.transactionId!,
      row.transactionLineId!
    );
    if (fetchedSourceKeys.has(sourceKey)) {
      section.status = "LIMITATION";
      section.reason =
        "QuickBooks financial detail returned a duplicate transaction-line identity; materialization stopped.";
      if (!dryRun) {
        await auditEntry({
          actor: ctx,
          action: "customer-intelligence.financial-materialization.limitation",
          entityType: "OperatingCompany",
          entityId: operatingCompany.id,
          after: { reason: section.reason }
        });
      }
      return section;
    }
    fetchedSourceKeys.add(sourceKey);
  }

  // File association must use only the owner-approved fields for each
  // transaction type. Detect disagreement before any aging fetch or financial
  // write so a conflicting file cannot be silently assigned by field order.
  try {
    for (const row of stableRevenueRows) {
      const classification = classifyRevenueDetailRow(row);
      if (
        classification.kind === "CUSTOMER_REVENUE" ||
        classification.kind === "VENDOR_COST"
      ) {
        revenueRowFileNumber(row, classification.kind);
      }
    }
  } catch (error) {
    if (error instanceof ReportDetailLimitationError) {
      section.status = "LIMITATION";
      section.reason = error.message;
      if (!dryRun) {
        await auditEntry({
          actor: ctx,
          action: "customer-intelligence.financial-materialization.limitation",
          entityType: "OperatingCompany",
          entityId: operatingCompany.id,
          after: { reason: section.reason }
        });
      }
      return section;
    }
    throw error;
  }

  const homeCurrency = (operatingCompany.homeCurrency || CAD_CURRENCY).trim().toUpperCase();
  const rowsRequiringMoneyEvidence = materializableRevenueRows.filter((row) => {
    const classification = classifyRevenueDetailRow(row);
    return (
      classification.kind === "CUSTOMER_REVENUE" ||
      (operatingCompany.slug === "newl-worldwide" && classification.kind === "VENDOR_COST")
    );
  });
  if (
    rowsRequiringMoneyEvidence.some((row) => {
      const classification = classifyRevenueDetailRow(row);
      return (
        classification.kind === "CUSTOMER_REVENUE"
          ? !resolveTransactionMoney(row, homeCurrency)
          : classification.kind === "VENDOR_COST"
            ? !resolveVendorCostMoney(row, homeCurrency)
            : false
      );
    })
  ) {
    section.status = "LIMITATION";
    section.reason =
      "QuickBooks transaction detail lacks authoritative native currency, native amount, or home amount evidence required for its revenue or vendor-cost path.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.financial-materialization.limitation",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }

  let agingRows: NormalizedAgingDetailRow[] = [];
  try {
    agingRows = await fetchQuickBooksAgingDetail({ realmId, accessToken, asOfDate: endDate });
  } catch (error) {
    section.status = error instanceof ReportDetailLimitationError ? "LIMITATION" : "ERROR";
    section.reason =
      error instanceof ReportDetailLimitationError
        ? error.message
        : "QuickBooks aging detail fetch failed; no financial rows were materialized.";
    if (!dryRun) {
      await auditEntry({
        actor: ctx,
        action:
          section.status === "LIMITATION"
            ? "customer-intelligence.financial-materialization.limitation"
            : "customer-intelligence.financial-materialization.error",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: { reason: section.reason }
      });
    }
    return section;
  }
  section.fetchedAgingRows = agingRows.length;

  const rules = await loadServiceMappingRules(ctx, operatingCompany.id);
  const fxCache = new Map<string, FxRateLookup>();
  const buckets = new Map<string, MonthBucket>();
  const incompleteMonths = new Set<string>();
  const incompleteResolvedPeriods = new Map<
    string,
    { relationshipId: string; monthKey: string }
  >();
  for (const monthKey of outsideWindowMonths) {
    incompleteMonths.add(monthKey);
  }
  const pendingRevenueLines: Array<{
    input: Parameters<typeof recordRevenueLine>[1];
    immutable: ProposedImmutableRevenue;
  }> = [];
  const currentImmutableEvidence: Array<{
    sourceKey: string;
    immutable: ProposedImmutableRevenue;
  }> = [];

  const incomplete = (monthKey: string | null | undefined) => {
    if (monthKey) {
      incompleteMonths.add(monthKey);
    }
  };

  for (const row of materializableRevenueRows) {
    try {
      if (!row.transactionId || !row.transactionLineId) {
        section.revenueSkippedMissingIdentity += 1;
        const rowDate = parseReportDate(row.transactionDate);
        incomplete(rowDate ? monthKeyOf(rowDate) : null);
        continue;
      }
      const parsedAmount = parseReportAmount(row.amount);
      if (parsedAmount === null || parsedAmount === 0) {
        section.revenueSkippedInvalidAmount += 1;
        const rowDate = parseReportDate(row.transactionDate);
        incomplete(rowDate ? monthKeyOf(rowDate) : null);
        continue;
      }
      const classification = classifyRevenueDetailRow(row);
      if (classification.kind !== "CUSTOMER_REVENUE") {
        continue;
      }
      const money = resolveTransactionMoney(row, homeCurrency);
      if (!money) {
        // All classified rows were validated before any write. This is a
        // defensive fail-closed branch for unexpected in-process mutation.
        section.revenueSkippedMissingRequired += 1;
        continue;
      }
      const amount = money.nativeAmount;
      const transactionDate = parseReportDate(row.transactionDate);
      if (!transactionDate) {
        section.revenueSkippedMissingRequired += 1;
        continue;
      }
      const monthKey = monthKeyOf(transactionDate);
      const target = await resolveReportCustomer(ctx, {
        customerId: row.customerId,
        operatingCompanyId: operatingCompany.id,
        realmId
      }, virtualSourceAccounts);
      if (!target) {
        section.revenueSkippedUnmatched += 1;
        incomplete(monthKey);
        continue;
      }

      const nativeCurrency = money.nativeCurrency;

      const fileRef = revenueRowFileNumber(row, "CUSTOMER_REVENUE");
      const serviceLine = resolveServiceLine(
        {
          item: row.itemRef ?? undefined,
          classRef: row.classRef ?? undefined,
          department: row.departmentRef ?? undefined,
          incomeAccount: row.accountName ?? row.accountNumber ?? row.accountId ?? undefined,
          filePrefix: fileRef ?? undefined,
          operatingCompanySlug: operatingCompany.slug
        },
        rules
      );

      // Deterministic FX: native CAD needs no rate; other currencies require a
      // stored Bank of Canada rate. A missing rate never invents a conversion.
      let cadAmount: number;
      let homeAmount: number;
      let fxSource: string;
      if (nativeCurrency === CAD_CURRENCY) {
        homeAmount = money.homeAmount;
        cadAmount = amount;
        fxSource = "NATIVE_CAD";
      } else {
        const rate = await resolveFxRate(ctx, nativeCurrency, monthKey, now, fxCache);
        if (!rate) {
          section.revenueSkippedMissingFx += 1;
          section.fxRatesMissing += 1;
          incomplete(monthKey);
          incompleteResolvedPeriods.set(`${target.relationshipId}|${monthKey}`, {
            relationshipId: target.relationshipId,
            monthKey
          });
          // The resolved relationship and monthly unique key are authoritative
          // even though the conversion is not. Keep a zero-valued placeholder
          // only to persist INCOMPLETE (or preserve the existing row through
          // upsertMonthlyFinancial); never materialize the missing revenue or a
          // CAD conversion.
          const key = bucketKey({
            companyOperatingRelationshipId: target.relationshipId,
            sourceAccountKey: target.sourceAccountKey,
            serviceLine,
            currency: nativeCurrency,
            monthKey
          });
          if (!buckets.has(key)) {
            const incompleteBucket = newBucket(monthKey, target, serviceLine, nativeCurrency);
            incompleteBucket.cadRevenue = null;
            incompleteBucket.incomplete = true;
            buckets.set(key, incompleteBucket);
          }
          continue;
        }
        section.fxRatesApplied += 1;
        // Preserve QuickBooks's authoritative home amount separately. CAD is a
        // directional management conversion from the native amount and can
        // therefore differ from the booked home amount.
        homeAmount = money.homeAmount;
        cadAmount = toCadAmount(amount, rate.rateToCad);
        fxSource = fxSourceForMonthKey(monthKey, now);
      }

      const sourceKey = revenueLineSourceKey(
        realmId,
        row.transactionId,
        row.transactionLineId
      );

      // Idempotent immutable insert: re-inserting the same sourceKey returns
      // the existing row without rewriting it.
      const proposedImmutable = canonicalizeProposedImmutableRevenue({
        sourceAccountId: target.sourceAccount?.id ?? null,
        companyId: target.companyId,
        operatingCompanyId: target.operatingCompanyId,
        transactionDate,
        transactionType: row.transactionType ?? "Invoice",
        transactionNumber: row.transactionId!,
        accountRef: row.accountName ?? row.accountNumber ?? row.accountId,
        classRef: row.classRef,
        itemRef: row.itemRef,
        fileRef,
        serviceLine,
        nativeAmount: amount,
        nativeCurrency,
        homeAmount,
        homeCurrency,
        cadAmount,
        fxSource
      });
      const existing = await prisma.customerRevenueLine.findFirst({
        where: tenantWhere(ctx, { sourceKey })
      });
      if (existing) {
        if (
          immutableRevenueConflict(
            existing as unknown as Record<string, unknown>,
            proposedImmutable
          )
        ) {
          section.status = "LIMITATION";
          section.reason =
            "QuickBooks returned conflicting evidence for an existing immutable revenue line; monthly materialization stopped.";
          if (!dryRun) {
            await auditEntry({
              actor: ctx,
              action: "customer-intelligence.financial-materialization.limitation",
              entityType: "OperatingCompany",
              entityId: operatingCompany.id,
              after: { reason: section.reason }
            });
          }
          return section;
        }
        section.revenuePreserved += 1;
      } else if (!dryRun) {
        pendingRevenueLines.push({
          immutable: proposedImmutable,
          input: {
            realmId,
            sourceKey,
            sourceAccountId: target.sourceAccount?.id ?? undefined,
            companyId: target.companyId,
            operatingCompanyId: target.operatingCompanyId,
            transactionDate,
            transactionType: proposedImmutable.transactionType,
            transactionNumber: row.transactionId,
            accountRef: row.accountName ?? row.accountNumber ?? row.accountId ?? undefined,
            classRef: row.classRef ?? undefined,
            itemRef: row.itemRef ?? undefined,
            fileRef: fileRef ?? undefined,
            serviceLine,
            nativeAmount: proposedImmutable.nativeAmount,
            nativeCurrency,
            homeAmount: proposedImmutable.homeAmount,
            homeCurrency,
            cadAmount: proposedImmutable.cadAmount,
            fxSource,
            syncMetadata: {
              report: REPORT_SOURCE_REVENUE,
              windowMonths: FINANCIAL_WINDOW_MONTHS,
              fetchedAt: now.toISOString()
            }
          }
        });
      }
      currentImmutableEvidence.push({ sourceKey, immutable: proposedImmutable });
      section.revenueMaterialized += 1;

      // Customer credits remain signed revenue in their authoritative bucket.
      if (proposedImmutable.nativeAmount !== 0) {
        const key = bucketKey({
          companyOperatingRelationshipId: target.relationshipId,
          sourceAccountKey: target.sourceAccountKey,
          serviceLine,
          currency: nativeCurrency,
          monthKey
        });
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = newBucket(monthKey, target, serviceLine, nativeCurrency);
          buckets.set(key, bucket);
        }
        bucket.nativeRevenue += proposedImmutable.nativeAmount;
        bucket.cadRevenue = (bucket.cadRevenue ?? 0) + proposedImmutable.cadAmount;
        bucket.hasRevenueEvidence = true;

        if (operatingCompany.slug === "newl-worldwide") {
          // Worldwide gross profit is materialized on one authoritative CAD
          // basis. Keep native revenue in its transaction-currency bucket, but
          // put the QuickBooks CAD home-amount contribution in the ALL/CAD
          // bucket so it can combine with eligible vendor costs without mixing
          // currencies or independently converting either side.
          const grossProfitTarget: ResolvedCustomerTarget = {
            ...target,
            sourceAccount: null,
            sourceAccountKey: "ALL"
          };
          const grossProfitKey = bucketKey({
            companyOperatingRelationshipId: target.relationshipId,
            sourceAccountKey: "ALL",
            serviceLine,
            currency: CAD_CURRENCY,
            monthKey
          });
          let grossProfitBucket = buckets.get(grossProfitKey);
          if (!grossProfitBucket) {
            grossProfitBucket = newBucket(
              monthKey,
              grossProfitTarget,
              serviceLine,
              CAD_CURRENCY
            );
            buckets.set(grossProfitKey, grossProfitBucket);
          }
          grossProfitBucket.nativeGrossProfit += proposedImmutable.homeAmount;
          grossProfitBucket.hasRevenueEvidence = true;
        }
      }
    } catch {
      section.recordErrors += 1;
      const rowDate = parseReportDate(row.transactionDate);
      incomplete(rowDate ? monthKeyOf(rowDate) : null);
      section.warnings.push("A revenue detail row failed during local processing; skipped.");
    }
  }

  if (operatingCompany.slug === "newl-worldwide") {
    const customerRowsByFile = new Map<string, NormalizedRevenueDetailRow[]>();
    for (const row of materializableRevenueRows) {
      if (classifyRevenueDetailRow(row).kind !== "CUSTOMER_REVENUE") continue;
      const fileRef = revenueRowFileNumber(row, "CUSTOMER_REVENUE");
      if (fileRef) {
        customerRowsByFile.set(fileRef, [...(customerRowsByFile.get(fileRef) ?? []), row]);
      }
    }

    for (const row of materializableRevenueRows) {
      const classification = classifyRevenueDetailRow(row);
      if (classification.kind !== "VENDOR_COST") continue;

      const transactionDate = parseReportDate(row.transactionDate);
      const monthKey = transactionDate ? monthKeyOf(transactionDate) : null;
      const fileRef = revenueRowFileNumber(row, "VENDOR_COST");
      const money = resolveVendorCostMoney(row, homeCurrency);
      const customerRows = fileRef ? customerRowsByFile.get(fileRef) ?? [] : [];
      const targets: ResolvedCustomerTarget[] = [];
      for (const customerRow of customerRows) {
        const target = await resolveReportCustomer(ctx, {
          customerId: customerRow.customerId,
          operatingCompanyId: operatingCompany.id,
          realmId
        }, virtualSourceAccounts);
        if (target) targets.push(target);
      }
      const relationshipIds = new Set(targets.map((target) => target.relationshipId));
      const unambiguous =
        customerRows.length > 0 &&
        targets.length === customerRows.length &&
        relationshipIds.size === 1;

      if (!transactionDate || !fileRef || !money || homeCurrency !== CAD_CURRENCY || !unambiguous) {
        section.costRowsAmbiguous += 1;
        incomplete(monthKey);
        section.warnings.push(
          "A vendor-cost row lacked an authoritative CAD home amount or an unambiguous file-level customer relationship; skipped."
        );
        continue;
      }

      const target = targets[0];
      const vendorMonthKey = monthKeyOf(transactionDate);
      const serviceLine = resolveServiceLine(
        {
          item: row.itemRef ?? undefined,
          classRef: row.classRef ?? undefined,
          department: row.departmentRef ?? undefined,
          incomeAccount: row.accountName ?? row.accountNumber ?? row.accountId ?? undefined,
          filePrefix: fileRef,
          operatingCompanySlug: operatingCompany.slug
        },
        rules
      );
      const sourceKey = revenueLineSourceKey(
        realmId,
        row.transactionId!,
        row.transactionLineId!
      );
      const costTarget: ResolvedCustomerTarget = {
        ...target,
        sourceAccount: null,
        sourceAccountKey: "ALL"
      };

      // CustomerRevenueLine is the approved immutable transaction-evidence
      // model for this phase. Vendor lines use the same stable report identity,
      // carry no customer source account, and preserve both the native amount
      // and QuickBooks's authoritative CAD home amount. They are compared and
      // persisted before their home amount contributes to monthly cost.
      const proposedImmutable = canonicalizeProposedImmutableRevenue({
        sourceAccountId: null,
        companyId: target.companyId,
        operatingCompanyId: target.operatingCompanyId,
        transactionDate,
        transactionType: row.transactionType ?? "Bill",
        transactionNumber: row.transactionId!,
        accountRef: row.accountName ?? row.accountNumber ?? row.accountId,
        classRef: row.classRef,
        itemRef: row.itemRef,
        fileRef,
        serviceLine,
        nativeAmount: money.nativeAmount,
        nativeCurrency: money.nativeCurrency,
        homeAmount: money.homeAmount,
        homeCurrency,
        cadAmount: money.homeAmount,
        fxSource: "QUICKBOOKS_HOME_CAD"
      });
      const existing = await prisma.customerRevenueLine.findFirst({
        where: tenantWhere(ctx, { sourceKey })
      });
      if (existing) {
        if (
          immutableRevenueConflict(
            existing as unknown as Record<string, unknown>,
            proposedImmutable
          )
        ) {
          section.status = "LIMITATION";
          section.reason =
            "QuickBooks returned conflicting evidence for an existing immutable vendor-cost line; monthly materialization stopped.";
          if (!dryRun) {
            await auditEntry({
              actor: ctx,
              action: "customer-intelligence.financial-materialization.limitation",
              entityType: "OperatingCompany",
              entityId: operatingCompany.id,
              after: { reason: section.reason }
            });
          }
          return section;
        }
        section.revenuePreserved += 1;
      } else if (!dryRun) {
        pendingRevenueLines.push({
          immutable: proposedImmutable,
          input: {
            realmId,
            sourceKey,
            companyId: target.companyId,
            operatingCompanyId: target.operatingCompanyId,
            transactionDate,
            transactionType: proposedImmutable.transactionType,
            transactionNumber: row.transactionId!,
            accountRef: proposedImmutable.accountRef ?? undefined,
            classRef: row.classRef ?? undefined,
            itemRef: row.itemRef ?? undefined,
            fileRef,
            serviceLine,
            nativeAmount: proposedImmutable.nativeAmount,
            nativeCurrency: money.nativeCurrency,
            homeAmount: proposedImmutable.homeAmount,
            homeCurrency,
            cadAmount: proposedImmutable.cadAmount,
            fxSource: "QUICKBOOKS_HOME_CAD",
            syncMetadata: {
              report: REPORT_SOURCE_REVENUE,
              evidenceKind: "VENDOR_COST",
              windowMonths: FINANCIAL_WINDOW_MONTHS,
              fetchedAt: now.toISOString()
            }
          }
        });
      }
      currentImmutableEvidence.push({ sourceKey, immutable: proposedImmutable });
      const key = bucketKey({
        companyOperatingRelationshipId: target.relationshipId,
        sourceAccountKey: "ALL",
        serviceLine,
        currency: CAD_CURRENCY,
        monthKey: vendorMonthKey
      });
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = newBucket(vendorMonthKey, costTarget, serviceLine, CAD_CURRENCY);
        buckets.set(key, bucket);
      }
      // QuickBooks Amount is the authoritative CAD home amount. Foreign vendor
      // costs are never independently converted and remain in the bill month.
      bucket.nativeCost += proposedImmutable.homeAmount;
      bucket.nativeGrossProfit -= proposedImmutable.homeAmount;
      section.costRowsPaired += 1;
    }

    // Revenue and cost are additive authoritative CAD gross-profit
    // contributions in ALL/CAD buckets. Vendor costs remain in their bill month
    // and are never reallocated across customer invoices.
  }

  // Open AR from the aging detail snapshot merges into the monthly bucket under
  // the OTHER service line (open AR is not service-line revenue). A row with
  // neither an authoritative open balance nor any supported bucket amounts has
  // no open-AR evidence at all and is skipped — an empty bucket sum would invent
  // a zero balance.
  const agingTotal = (row: NormalizedAgingDetailRow): number | null => {
    const total = parseReportAmount(row.total);
    if (total !== null) {
      return total;
    }
    if (Object.keys(row.bucketAmounts).length === 0) {
      return null;
    }
    let sum = 0;
    for (const value of Object.values(row.bucketAmounts)) {
      const parsed = parseReportAmount(value);
      if (parsed === null) {
        return null;
      }
      sum += parsed;
    }
    return sum;
  };

  const recordErrorsBeforeAging = section.recordErrors;
  let agingSnapshotIncomplete = false;
  const agingEvidenceKeys = new Set<string>();
  for (const row of agingRows) {
    try {
      const total = agingTotal(row);
      const asOfDate = parseReportDate(row.asOfDate);
      const currency = row.currency?.trim().toUpperCase() ?? "";
      if (total === null || !asOfDate || !/^[A-Z]{3}$/.test(currency)) {
        agingSnapshotIncomplete = true;
        section.agingSkippedMissingEvidence += 1;
        incomplete(monthKeyOf(parseReportDate(row.asOfDate) ?? parseReportDate(endDate)!));
        continue;
      }
      const target = await resolveReportCustomer(ctx, {
        customerId: row.customerId,
        operatingCompanyId: operatingCompany.id,
        realmId
      }, virtualSourceAccounts);
      if (!target) {
        agingSnapshotIncomplete = true;
        section.agingSkippedUnmatched += 1;
        incomplete(monthKeyOf(asOfDate));
        continue;
      }
      const monthKey = monthKeyOf(asOfDate);
      const key = bucketKey({
        companyOperatingRelationshipId: target.relationshipId,
        sourceAccountKey: target.sourceAccountKey,
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        currency,
        monthKey
      });
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = newBucket(monthKey, target, CustomerIntelligenceServiceLine.OTHER, currency);
        buckets.set(key, bucket);
      }
      agingEvidenceKeys.add(key);
      bucket.nativeOpenAr += total;
      if (currency === CAD_CURRENCY) {
        bucket.cadOpenAr = bucket.nativeOpenAr;
      } else {
        const rate = await resolveFxRate(ctx, currency, monthKey, now, fxCache);
        if (rate) {
          section.fxRatesApplied += 1;
          bucket.cadOpenAr = toCadAmount(bucket.nativeOpenAr, rate.rateToCad);
        } else {
          agingSnapshotIncomplete = true;
          section.fxRatesMissing += 1;
          incomplete(monthKey);
          bucket.cadOpenAr = null;
        }
      }
      section.agingMaterialized += 1;
    } catch {
      agingSnapshotIncomplete = true;
      section.recordErrors += 1;
      incomplete(monthKeyOf(parseReportDate(row.asOfDate) ?? parseReportDate(endDate)!));
      section.warnings.push("An aging detail row failed during local processing; skipped.");
    }
  }

  // A successfully parsed aging response is an authoritative snapshot. Replace
  // prior positive AR for accounts absent from this response with zero, scoped
  // to this tenant, operating company, and as-of month. If any row was partial,
  // unmatched, or failed processing, the snapshot is incomplete and no absent
  // balance is cleared.
  const agingMonthKey = monthKeyOf(parseReportDate(endDate)!);
  const agingSnapshotComplete =
    !agingSnapshotIncomplete &&
    section.agingSkippedMissingEvidence === 0 &&
    section.agingSkippedUnmatched === 0 &&
    section.recordErrors === recordErrorsBeforeAging;
  if (agingSnapshotComplete) {
    const priorPositiveArRows =
      (await prisma.customerMonthlyFinancial.findMany({
        where: tenantWhere(ctx, {
          operatingCompanyId: operatingCompany.id,
          monthKey: agingMonthKey,
          serviceLine: CustomerIntelligenceServiceLine.OTHER,
          nativeOpenAr: { gt: 0 }
        })
      })) ?? [];
    for (const prior of priorPositiveArRows) {
      const key = bucketKey({
        companyOperatingRelationshipId: prior.companyOperatingRelationshipId,
        sourceAccountKey: prior.sourceAccountKey,
        serviceLine: prior.serviceLine,
        currency: prior.currency,
        monthKey: prior.monthKey
      });
      if (buckets.has(key)) {
        continue;
      }
      buckets.set(key, {
        monthKey: prior.monthKey,
        companyId: prior.companyId,
        operatingCompanyId: prior.operatingCompanyId,
        companyOperatingRelationshipId: prior.companyOperatingRelationshipId,
        sourceAccountId: prior.sourceAccountId,
        sourceAccountKey: prior.sourceAccountKey,
        serviceLine: prior.serviceLine,
        currency: prior.currency,
        nativeRevenue: Number(prior.nativeRevenue),
        nativeCost: Number(prior.nativeCost),
        nativeGrossProfit: Number(prior.nativeGrossProfit),
        cadRevenue: prior.cadRevenue === null ? null : Number(prior.cadRevenue),
        nativeOpenAr: 0,
        cadOpenAr: 0,
        incomplete: false,
        hasRevenueEvidence: true
      });
    }
  } else {
    // A partial or unmatched aging response is not authoritative enough to
    // replace any existing value. Bring every tenant- and operating-company-
    // scoped row for the as-of month into this run, preserve its financial
    // values, and mark it INCOMPLETE even when the response did not otherwise
    // produce a valid bucket. Prior AR is preserved only for keys without valid
    // matched current aging evidence.
    const priorAsOfRows =
      (await prisma.customerMonthlyFinancial.findMany({
        where: tenantWhere(ctx, {
          operatingCompanyId: operatingCompany.id,
          monthKey: agingMonthKey
        })
      })) ?? [];
    for (const prior of priorAsOfRows) {
      const key = bucketKey({
        companyOperatingRelationshipId: prior.companyOperatingRelationshipId,
        sourceAccountKey: prior.sourceAccountKey,
        serviceLine: prior.serviceLine,
        currency: prior.currency,
        monthKey: prior.monthKey
      });
      const preserved: MonthBucket = {
        monthKey: prior.monthKey,
        companyId: prior.companyId,
        operatingCompanyId: prior.operatingCompanyId,
        companyOperatingRelationshipId: prior.companyOperatingRelationshipId,
        sourceAccountId: prior.sourceAccountId,
        sourceAccountKey: prior.sourceAccountKey,
        serviceLine: prior.serviceLine,
        currency: prior.currency,
        nativeRevenue: Number(prior.nativeRevenue),
        nativeCost: Number(prior.nativeCost),
        nativeGrossProfit: Number(prior.nativeGrossProfit),
        cadRevenue: prior.cadRevenue === null ? null : Number(prior.cadRevenue),
        nativeOpenAr: Number(prior.nativeOpenAr),
        cadOpenAr: prior.cadOpenAr === null ? null : Number(prior.cadOpenAr),
        incomplete: true,
        hasRevenueEvidence: false
      };
      const current = buckets.get(key);
      if (current) {
        // A partial aging snapshot cannot replace AR, but it also must not
        // replace freshly aggregated revenue/cost/gross-profit evidence under
        // the same monthly unique key. Merge only the conservatively preserved
        // AR fields into the current-run bucket.
        // A successfully parsed and matched aging row is authoritative for its
        // own native balance even when another row made the overall snapshot
        // partial, or its CAD conversion is unavailable. Preserve prior AR only
        // for keys with no current aging evidence; in particular, never retain
        // a stale CAD conversion beside newly reported native AR.
        if (!agingEvidenceKeys.has(key)) {
          current.nativeOpenAr = preserved.nativeOpenAr;
          current.cadOpenAr = preserved.cadOpenAr;
        }
        current.incomplete = true;
      } else {
        buckets.set(key, preserved);
      }
    }
  }

  // Missing-FX revenue is still authoritative evidence that the resolved
  // relationship's period is incomplete. Preserve every existing monthly key
  // for that relationship/period and mark it INCOMPLETE, including keys not
  // otherwise produced by this run. The exact evidence key already has a
  // zero-valued placeholder when no row exists, so no financial amount is
  // invented.
  for (const period of incompleteResolvedPeriods.values()) {
    const existingPeriodRows =
      (await prisma.customerMonthlyFinancial.findMany({
        where: tenantWhere(ctx, {
          operatingCompanyId: operatingCompany.id,
          companyOperatingRelationshipId: period.relationshipId,
          monthKey: period.monthKey
        })
      })) ?? [];
    for (const prior of existingPeriodRows) {
      // Keep the tenant-scoped query contract explicit even for mocked clients.
      if (
        prior.companyOperatingRelationshipId !== period.relationshipId ||
        prior.monthKey !== period.monthKey
      ) {
        continue;
      }
      const key = bucketKey({
        companyOperatingRelationshipId: prior.companyOperatingRelationshipId,
        sourceAccountKey: prior.sourceAccountKey,
        serviceLine: prior.serviceLine,
        currency: prior.currency,
        monthKey: prior.monthKey
      });
      const current = buckets.get(key);
      if (current) {
        current.incomplete = true;
        continue;
      }
      const clearAbsentAr = agingSnapshotComplete && prior.monthKey === agingMonthKey;
      buckets.set(key, {
        monthKey: prior.monthKey,
        companyId: prior.companyId,
        operatingCompanyId: prior.operatingCompanyId,
        companyOperatingRelationshipId: prior.companyOperatingRelationshipId,
        sourceAccountId: prior.sourceAccountId,
        sourceAccountKey: prior.sourceAccountKey,
        serviceLine: prior.serviceLine,
        currency: prior.currency,
        nativeRevenue: Number(prior.nativeRevenue),
        nativeCost: Number(prior.nativeCost),
        nativeGrossProfit: Number(prior.nativeGrossProfit),
        cadRevenue: prior.cadRevenue === null ? null : Number(prior.cadRevenue),
        nativeOpenAr: clearAbsentAr ? 0 : Number(prior.nativeOpenAr),
        cadOpenAr:
          clearAbsentAr ? 0 : prior.cadOpenAr === null ? null : Number(prior.cadOpenAr),
        incomplete: true,
        hasRevenueEvidence: false
      });
    }
  }

  for (const bucket of buckets.values()) {
    bucket.incomplete = bucket.incomplete || incompleteMonths.has(bucket.monthKey);
  }

  section.incompleteMonths = incompleteMonths.size;

  if (dryRun) {
    const authoritativeBuckets = await aggregateImmutableFinancialEvidence(
      ctx,
      prisma as unknown as Prisma.TransactionClient,
      buckets,
      currentImmutableEvidence,
      operatingCompany,
      windowStart,
      windowEnd
    );
    const monthlyInputs = monthlyInputsFromBuckets(authoritativeBuckets);
    const affectedRelationships = new Set(
      [...authoritativeBuckets.values()].map((bucket) => bucket.companyOperatingRelationshipId)
    );
    section.monthlyRowsWritten = monthlyInputs.length;
    section.relationshipsRefreshed = affectedRelationships.size;
    return section;
  }

  // One operating company's immutable lines, monthly replacement aggregates,
  // lifecycle refreshes, and required audit evidence commit atomically. Any
  // later line, monthly upsert, lifecycle, or audit failure rolls all of them
  // back; no partially visible financial state is recoverable by readers.
  try {
    const committed = await prisma.$transaction(async (transaction) => {
      const lockKey = [
        "customer-intelligence.financial-materialization",
        ctx.tenantId,
        operatingCompany.id
      ].join(":");
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
      );

      // The unlocked lookups above support dry-run reporting and avoid needless
      // work, but they are not authoritative for a live commit. After obtaining
      // the operating-company lock, re-read every pending source identity before
      // any immutable-line or monthly write. A queued conflicting run must roll
      // back rather than aggregate evidence that differs from the committed line.
      let revenueLinesCreated = 0;
      let revenueLinesPreserved = 0;
      for (const pending of pendingRevenueLines) {
        const existing = await transaction.customerRevenueLine.findFirst({
          where: tenantWhere(ctx, { sourceKey: pending.input.sourceKey })
        });
        if (existing) {
          if (
            immutableRevenueConflict(
              existing as unknown as Record<string, unknown>,
              pending.immutable
            )
          ) {
            throw new ImmutableRevenueConflictError(
              "Conflicting immutable revenue evidence was committed by a concurrent run."
            );
          }
          revenueLinesPreserved += 1;
          continue;
        }
        await recordRevenueLine(ctx, pending.input, { client: transaction });
        revenueLinesCreated += 1;
      }
      const authoritativeBuckets = await aggregateImmutableFinancialEvidence(
        ctx,
        transaction,
        buckets,
        currentImmutableEvidence,
        operatingCompany,
        windowStart,
        windowEnd
      );
      const monthlyInputs = monthlyInputsFromBuckets(authoritativeBuckets);
      const affectedRelationships = new Set(
        [...authoritativeBuckets.values()].map(
          (bucket) => bucket.companyOperatingRelationshipId
        )
      );
      for (const input of monthlyInputs) {
        await upsertMonthlyFinancial(ctx, input, { client: transaction });
      }
      for (const relationshipId of affectedRelationships) {
        await refreshRelationshipLifecycle(ctx, relationshipId, { client: transaction });
      }
      await auditEntry({
        actor: ctx,
        action: "customer-intelligence.financial-materialization.committed",
        entityType: "OperatingCompany",
        entityId: operatingCompany.id,
        after: {
          revenueLinesCreated,
          monthlyRowsWritten: monthlyInputs.length,
          relationshipsRefreshed: affectedRelationships.size
        },
        client: transaction
      });
      return {
        revenueLinesCreated,
        revenueLinesPreserved,
        monthlyRowsWritten: monthlyInputs.length,
        relationshipsRefreshed: affectedRelationships.size
      };
    });
    section.revenuePreserved += committed.revenueLinesPreserved;
    section.monthlyRowsWritten = committed.monthlyRowsWritten;
    section.relationshipsRefreshed = committed.relationshipsRefreshed;
  } catch (error) {
    const immutableConflict = error instanceof ImmutableRevenueConflictError;
    section.status = immutableConflict ? "LIMITATION" : "ERROR";
    if (!immutableConflict) {
      section.recordErrors += 1;
    }
    section.monthlyRowsWritten = 0;
    section.relationshipsRefreshed = 0;
    section.reason = immutableConflict
      ? "QuickBooks returned conflicting evidence for an existing immutable revenue line; monthly materialization stopped."
      : "Operating-company financial persistence failed and was rolled back without partial financial state.";
    await auditEntry({
      actor: ctx,
      action: immutableConflict
        ? "customer-intelligence.financial-materialization.limitation"
        : "customer-intelligence.financial-materialization.error",
      entityType: "OperatingCompany",
      entityId: operatingCompany.id,
      after: { reason: section.reason }
    });
  }

  return section;
}

async function loadServiceMappingRules(
  ctx: AuthenticatedContext,
  operatingCompanyId: string
): Promise<ServiceMappingRuleInput[]> {
  const rules = await prisma.quickBooksServiceMappingRule.findMany({
    where: tenantWhere(ctx, { operatingCompanyId, active: true }),
    orderBy: [{ priority: "desc" }]
  });
  return rules.map((rule) => ({
    dimension: rule.dimension,
    matchValue: rule.matchValue,
    serviceLine: rule.serviceLine,
    priority: rule.priority
  }));
}

function round2(value: number): number {
  return roundCurrencyAmount(value);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Tenant-scoped, ADMIN-guarded, idempotent financial materialization entry.
 * `dryRun` reports what would be written without writing anything. The guard is
 * enforced here (defense in depth) and at the ADMIN-triggered action in
 * actions.ts.
 */
export async function materializeCustomerFinancials(
  ctx: AuthenticatedContext,
  input: {
    operatingCompanyId?: string;
    dryRun?: boolean;
    /** Internal would-be mappings supplied by the consolidated dry-run. */
    virtualSourceAccounts?: FinancialMaterializationDryRunSourceAccount[];
  } = {}
): Promise<FinancialMaterializationReport> {
  await requireIngestionAdmin(ctx);

  const dryRun = input.dryRun === true;
  const startedAt = new Date().toISOString();

  const operatingCompanies = input.operatingCompanyId
    ? [
        await prisma.operatingCompany.findFirst({
          where: tenantWhere(ctx, { id: input.operatingCompanyId })
        })
      ]
    : await prisma.operatingCompany.findMany({
        where: tenantWhere(ctx, { active: true }),
        orderBy: [{ displayName: "asc" }]
      });

  if (input.operatingCompanyId && !operatingCompanies[0]) {
    throw new Error("Operating company does not exist in this tenant.");
  }

  const sections: OperatingCompanyMaterializationSection[] = [];
  for (const operatingCompany of operatingCompanies) {
    if (!operatingCompany) {
      continue;
    }
    sections.push(
      await materializeForOperatingCompany(
        ctx,
        operatingCompany,
        dryRun,
        dryRun ? input.virtualSourceAccounts : undefined
      )
    );
  }

  const totals = sections.reduce<FinancialMaterializationTotals>(
    (acc, section) => {
      acc.fetchedRevenueRows += section.fetchedRevenueRows;
      acc.fetchedAgingRows += section.fetchedAgingRows;
      acc.revenueMaterialized += section.revenueMaterialized;
      acc.revenuePreserved += section.revenuePreserved;
      acc.revenueSkippedMissingIdentity += section.revenueSkippedMissingIdentity;
      acc.revenueSkippedUnmatched += section.revenueSkippedUnmatched;
      acc.revenueSkippedMissingRequired += section.revenueSkippedMissingRequired;
      acc.revenueSkippedInvalidAmount += section.revenueSkippedInvalidAmount;
      acc.revenueSkippedMissingFx += section.revenueSkippedMissingFx;
      acc.reportRowsSkippedOutsideWindow += section.reportRowsSkippedOutsideWindow;
      acc.costRowsPaired += section.costRowsPaired;
      acc.costRowsAmbiguous += section.costRowsAmbiguous;
      acc.agingMaterialized += section.agingMaterialized;
      acc.agingSkippedUnmatched += section.agingSkippedUnmatched;
      acc.agingSkippedMissingEvidence += section.agingSkippedMissingEvidence;
      acc.monthlyRowsWritten += section.monthlyRowsWritten;
      acc.relationshipsRefreshed += section.relationshipsRefreshed;
      acc.fxRatesApplied += section.fxRatesApplied;
      acc.fxRatesMissing += section.fxRatesMissing;
      acc.recordErrors += section.recordErrors;
      acc.incompleteMonths += section.incompleteMonths;
      if (section.status === "SKIPPED_UNASSOCIATED") {
        acc.unassociatedCompanies += 1;
      }
      if (section.status === "ERROR") {
        acc.erroredCompanies += 1;
      }
      if (section.status === "LIMITATION") {
        acc.limitationCompanies += 1;
      }
      return acc;
    },
    {
      fetchedRevenueRows: 0,
      fetchedAgingRows: 0,
      revenueMaterialized: 0,
      revenuePreserved: 0,
      revenueSkippedMissingIdentity: 0,
      revenueSkippedUnmatched: 0,
      revenueSkippedMissingRequired: 0,
      revenueSkippedInvalidAmount: 0,
      revenueSkippedMissingFx: 0,
      reportRowsSkippedOutsideWindow: 0,
      costRowsPaired: 0,
      costRowsAmbiguous: 0,
      agingMaterialized: 0,
      agingSkippedUnmatched: 0,
      agingSkippedMissingEvidence: 0,
      monthlyRowsWritten: 0,
      relationshipsRefreshed: 0,
      fxRatesApplied: 0,
      fxRatesMissing: 0,
      recordErrors: 0,
      incompleteMonths: 0,
      unassociatedCompanies: 0,
      erroredCompanies: 0,
      limitationCompanies: 0
    }
  );

  const report: FinancialMaterializationReport = {
    tenantId: ctx.tenantId,
    dryRun,
    cadConsolidation: CAD_CONSOLIDATION_DISCLOSURE,
    startedAt,
    completedAt: new Date().toISOString(),
    operatingCompanies: sections,
    totals
  };

  if (!dryRun) {
    await auditEntry({
      actor: ctx,
      action: "customer-intelligence.financial-materialization.run",
      entityType: "FinancialMaterialization",
      // The caller receives the detailed ADMIN report, but AuditLog stores
      // classifications and counts only. Never copy customer identifiers,
      // transaction identifiers, amounts, warnings, or provider content into
      // generated audit output.
      after: buildMaterializationAuditSummary(report)
    });
  }

  return report;
}

function buildMaterializationAuditSummary(report: FinancialMaterializationReport) {
  const operatingCompanyStatuses = report.operatingCompanies.reduce(
    (counts, section) => {
      if (section.status === "ASSOCIATED") counts.associated += 1;
      if (section.status === "SKIPPED_UNASSOCIATED") counts.skippedUnassociated += 1;
      if (section.status === "ERROR") counts.error += 1;
      if (section.status === "LIMITATION") counts.limitation += 1;
      return counts;
    },
    { associated: 0, skippedUnassociated: 0, error: 0, limitation: 0 }
  );

  return {
    dryRun: report.dryRun,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    operatingCompanyCount: report.operatingCompanies.length,
    operatingCompanyStatuses,
    totals: report.totals
  };
}
