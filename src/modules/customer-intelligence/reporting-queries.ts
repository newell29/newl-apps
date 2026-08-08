import {
  CustomerFinancialPeriodStatus,
  CustomerIntelligenceServiceLine
} from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";
import { requireReadAccess } from "@/modules/customer-intelligence/permissions";
import {
  CAD_CONSOLIDATION_DISCLOSURE,
  currentMonthKey,
  monthKeyOf,
  roundCurrencyAmount
} from "@/modules/customer-intelligence/fx";

/**
 * Leadership-only CAD consolidation management reporting (CP-PHASE-02B-6).
 *
 * Every exported read requires the Customer Intelligence module entitlement and
 * an ADMIN, MANAGER, or FINANCE role (`requireReadAccess`), and every database
 * read carries the authenticated `tenantId` through `tenantWhere`. The legacy
 * `Cashflow*` finance tables are never read or referenced here; the reporting
 * reads only the materialized `CustomerMonthlyFinancial` and immutable
 * `CustomerRevenueLine` evidence produced by CP-PHASE-02B-5.
 *
 * Business rules traced to `fx.ts` and the approved financial rules:
 *
 * - CAD consolidation is directional management reporting, never a statutory
 *   accounting entry (`REPORTING_CAD_DISCLOSURE`).
 * - The current month's CAD figures are PROVISIONAL (available-to-date Bank of
 *   Canada average). Because the monthly model does not persist the FX status
 *   used by its last materialization, a closed month is also conservatively
 *   labeled PROVISIONAL rather than making an unprovable FINAL claim.
 * - Completeness is atomic per operating-company/month. An incomplete company
 *   period remains visible but is excluded from headline revenue/cost/gross-
 *   profit totals without invalidating another company's complete period.
 * - Open AR is a live point-in-time balance, never a historical flow. Headline
 *   AR uses only a complete snapshot for the report's current calendar month
 *   and is never added across months. If that current snapshot is absent or
 *   incomplete, AR fails closed rather than falling back to an older snapshot.
 * - Rows with a missing CAD conversion keep their CAD value null (never
 *   invented); consolidated CAD totals expose `cadRevenuePartial` /
 *   `cadOpenArPartial` and the combined `cadValuesPartial` whenever any
 *   contributing row lacks a conversion, and the pages render those gaps.
 * - Native figures are never summed across transaction currencies: they are
 *   grouped per currency (`nativeByCurrency`) and every native amount is
 *   rendered with its actual currency code.
 * - Every displayed CAD revenue total carries an aggregate FX label. With no
 *   authoritative materialization-status field, stored non-empty totals remain
 *   conservatively PROVISIONAL; empty totals have no label.
 * - The operating-company revenue-line evidence is served in deterministic
 *   500-row pages (newest-first by transaction date with the unique `id`
 *   tiebreak). The complete tenant-scoped count is always returned alongside
 *   the page, so a truncated evidence set is disclosed and subsequent evidence
 *   is reachable through pagination.
 */

/** Directional management reporting disclosure shown on every reporting view. */
export const REPORTING_CAD_DISCLOSURE = CAD_CONSOLIDATION_DISCLOSURE;

export type ReportingCadStatus = "PROVISIONAL" | "FINAL";

/**
 * Conservative label for a stored monthly CAD consolidation. Calendar position
 * proves that current/future conversion is provisional, but it cannot prove a
 * closed monthly row was rematerialized after its provisional rate became
 * final. Until authoritative materialization status is persisted, never claim
 * FINAL for a stored value solely because the calendar advanced.
 */
export type ReportingCadFxLabel = {
  monthKey: string;
  cadStatus: ReportingCadStatus;
  fxSource: string;
  isCurrentMonth: boolean;
};

export function reportingCadFxLabel(
  monthKey: string,
  now: Date = new Date()
): ReportingCadFxLabel {
  const currentMonth = currentMonthKey(now);
  const isCurrentMonth = monthKey === currentMonth;
  return {
    monthKey,
    cadStatus: "PROVISIONAL",
    fxSource: monthKey >= currentMonth
      ? "BANK_OF_CANADA_PROVISIONAL"
      : "MATERIALIZED_FX_STATUS_UNPROVEN",
    isCurrentMonth
  };
}

export type ReportingCadTotalStatus = "FINAL" | "PROVISIONAL" | "MIXED";

/**
 * Aggregate PROVISIONAL/FINAL/MIXED label for a displayed CAD total, derived
 * from the months of materialized evidence actually included in that total.
 * A total is FINAL only when every included materialization can prove final FX.
 * The current schema cannot provide that proof, so non-empty stored totals are
 * conservatively PROVISIONAL and empty totals are null.
 */
export type ReportingCadTotalFx = {
  cadStatus: ReportingCadTotalStatus;
  finalMonthCount: number;
  provisionalMonthCount: number;
  fxSources: string[];
};

export function reportingCadTotalFx(
  monthKeys: string[],
  now: Date = new Date()
): ReportingCadTotalFx | null {
  const uniqueMonths = [...new Set(monthKeys)];
  if (uniqueMonths.length === 0) {
    return null;
  }

  let finalMonthCount = 0;
  let provisionalMonthCount = 0;
  const fxSources = new Set<string>();
  for (const monthKey of uniqueMonths) {
    const label = reportingCadFxLabel(monthKey, now);
    fxSources.add(label.fxSource);
    if (label.cadStatus === "FINAL") {
      finalMonthCount += 1;
    } else {
      provisionalMonthCount += 1;
    }
  }

  const cadStatus: ReportingCadTotalStatus =
    finalMonthCount > 0 && provisionalMonthCount > 0
      ? "MIXED"
      : finalMonthCount > 0
        ? "FINAL"
        : "PROVISIONAL";

  return {
    cadStatus,
    finalMonthCount,
    provisionalMonthCount,
    fxSources: [...fxSources].sort()
  };
}

/** Inclusive [start, end) UTC date range for one "YYYY-MM" month key. */
function monthKeyDateRange(monthKey: string): { gte: Date; lt: Date } {
  const [year, month] = monthKey.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(year, month, 1))
  };
}

/** Money evidence columns shared by every monthly-financial reporting read. */
const selectMonthlyMoney = {
  monthKey: true,
  operatingCompanyId: true,
  serviceLine: true,
  reconciliationStatus: true,
  currency: true,
  nativeRevenue: true,
  nativeCost: true,
  nativeGrossProfit: true,
  cadRevenue: true,
  nativeOpenAr: true,
  cadOpenAr: true
} as const;

type MonthlyMoneyRow = {
  monthKey: string;
  operatingCompanyId: string;
  serviceLine: CustomerIntelligenceServiceLine;
  reconciliationStatus: CustomerFinancialPeriodStatus;
  currency: string;
  nativeRevenue: number;
  nativeCost: number;
  nativeGrossProfit: number;
  cadRevenue: number | null;
  nativeOpenAr: number;
  cadOpenAr: number | null;
};

function toMoneyInput(row: MonthlyMoneyRow): ReportingMoneyInput {
  return {
    currency: row.currency,
    nativeRevenue: Number(row.nativeRevenue),
    nativeCost: Number(row.nativeCost),
    nativeGrossProfit: Number(row.nativeGrossProfit),
    cadRevenue: row.cadRevenue === null ? null : Number(row.cadRevenue),
    nativeOpenAr: Number(row.nativeOpenAr),
    cadOpenAr: row.cadOpenAr === null ? null : Number(row.cadOpenAr)
  };
}

type ReportingMoneyInput = {
  currency: string;
  nativeRevenue: number;
  nativeCost: number;
  nativeGrossProfit: number;
  cadRevenue: number | null;
  nativeOpenAr: number;
  cadOpenAr: number | null;
};

/** Per-currency native money figures; native amounts are never mixed across currencies. */
export type ReportingNativeByCurrency = {
  currency: string;
  nativeRevenue: number;
  nativeCost: number;
  nativeGrossProfit: number;
  nativeOpenAr: number;
};

type ReportingMoney = {
  nativeByCurrency: ReportingNativeByCurrency[];
  cadRevenue: number | null;
  cadRevenuePartial: boolean;
  cadOpenAr: number | null;
  cadOpenArPartial: boolean;
};

/**
 * Aggregate complete-period financial rows and, separately, one live AR
 * snapshot. Native figures are grouped by their
 * transaction currency and summed only within each currency; the CAD columns
 * are already converted and are the only cross-currency basis, so they sum
 * directly. CAD values sum the non-null values, stay null when no value
 * exists, and set the corresponding `*Partial` flag when any contributing row
 * lacks a conversion. Nothing is invented for missing conversions.
 */
function aggregateReportingMoney(
  rows: ReportingMoneyInput[],
  openArRows: ReportingMoneyInput[]
): ReportingMoney {
  const nativeByCurrency = new Map<string, ReportingNativeByCurrency>();
  let cadRevenueSum = 0;
  let cadRevenueHasNull = false;
  let cadRevenueHasValue = false;
  let cadOpenArSum = 0;
  let cadOpenArHasNull = false;
  let cadOpenArHasValue = false;

  for (const row of rows) {
    const currency = row.currency || "UNKNOWN";
    let native = nativeByCurrency.get(currency);
    if (!native) {
      native = {
        currency,
        nativeRevenue: 0,
        nativeCost: 0,
        nativeGrossProfit: 0,
        nativeOpenAr: 0
      };
      nativeByCurrency.set(currency, native);
    }
    native.nativeRevenue += row.nativeRevenue;
    native.nativeCost += row.nativeCost;
    native.nativeGrossProfit += row.nativeGrossProfit;
    if (row.cadRevenue === null || row.cadRevenue === undefined) {
      if (row.nativeRevenue === 0) {
        // A row can exist solely to carry the current Open AR snapshot. Its
        // revenue is a known zero and requires no FX evidence.
        cadRevenueHasValue = true;
      } else {
        cadRevenueHasNull = true;
      }
    } else {
      cadRevenueSum += row.cadRevenue;
      cadRevenueHasValue = true;
    }
  }

  // Open AR is a point-in-time aging snapshot. Only rows from the complete
  // current-report-month snapshot selected by `selectReportingPeriods` contribute.
  for (const row of openArRows) {
    const currency = row.currency || "UNKNOWN";
    let native = nativeByCurrency.get(currency);
    if (!native) {
      native = {
        currency,
        nativeRevenue: 0,
        nativeCost: 0,
        nativeGrossProfit: 0,
        nativeOpenAr: 0
      };
      nativeByCurrency.set(currency, native);
    }
    native.nativeOpenAr += row.nativeOpenAr;

    if (row.cadOpenAr === null || row.cadOpenAr === undefined) {
      cadOpenArHasNull = true;
    } else {
      cadOpenArSum += row.cadOpenAr;
      cadOpenArHasValue = true;
    }
  }

  return {
    nativeByCurrency: [...nativeByCurrency.values()]
      .map((native) => ({
        currency: native.currency,
        nativeRevenue: roundCurrencyAmount(native.nativeRevenue),
        nativeCost: roundCurrencyAmount(native.nativeCost),
        nativeGrossProfit: roundCurrencyAmount(native.nativeGrossProfit),
        nativeOpenAr: roundCurrencyAmount(native.nativeOpenAr)
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    cadRevenue: cadRevenueHasValue ? roundCurrencyAmount(cadRevenueSum) : null,
    cadRevenuePartial: cadRevenueHasNull,
    cadOpenAr: cadOpenArHasValue ? roundCurrencyAmount(cadOpenArSum) : null,
    cadOpenArPartial: cadOpenArHasNull
  };
}

type ReportingPeriodSelection = {
  materialized: MonthlyMoneyRow[];
  incompleteRows: MonthlyMoneyRow[];
  materializedMonths: Set<string>;
  incompleteMonths: Set<string>;
  latestMonthKey: string | null;
  openArMonthKey: string | null;
  openArAvailable: boolean;
  openArRows: MonthlyMoneyRow[];
  openArUnavailableOperatingCompanyIds: Set<string>;
};

/**
 * Select complete financial periods and the one eligible live AR snapshot.
 * One incomplete row invalidates its whole month for headline financials. The
 * report's current calendar month is the only eligible live AR snapshot; it is
 * used only when present and every row in that month is complete, with no
 * fallback to an older month.
 */
function selectReportingPeriods(
  rows: MonthlyMoneyRow[],
  reportingCurrentMonthKey: string
): ReportingPeriodSelection {
  const incompleteRows = rows.filter(
    (row) => row.reconciliationStatus === CustomerFinancialPeriodStatus.INCOMPLETE
  );
  const incompleteMonths = new Set(incompleteRows.map((row) => row.monthKey));
  const materialized = rows.filter((row) => !incompleteMonths.has(row.monthKey));
  const materializedMonths = new Set(materialized.map((row) => row.monthKey));
  const latestMonthKey = [...new Set(rows.map((row) => row.monthKey))].sort().at(-1) ?? null;
  const currentSnapshotRows = rows.filter((row) => row.monthKey === reportingCurrentMonthKey);
  const openArAvailable =
    currentSnapshotRows.length > 0 && !incompleteMonths.has(reportingCurrentMonthKey);

  return {
    materialized,
    incompleteRows,
    materializedMonths,
    incompleteMonths,
    latestMonthKey,
    openArMonthKey: openArAvailable ? reportingCurrentMonthKey : null,
    openArAvailable,
    openArRows: openArAvailable ? currentSnapshotRows : [],
    openArUnavailableOperatingCompanyIds:
      rows.length > 0 && !openArAvailable
        ? new Set(rows.map((row) => row.operatingCompanyId))
        : new Set()
  };
}

/** Apply period atomicity and live-AR selection independently per company. */
function selectReportingPeriodsByOperatingCompany(
  rows: MonthlyMoneyRow[],
  reportingCurrentMonthKey: string
): ReportingPeriodSelection {
  const companyIds = [...new Set(rows.map((row) => row.operatingCompanyId))];
  const selections = companyIds.map((operatingCompanyId) =>
    selectReportingPeriods(
      rows.filter((row) => row.operatingCompanyId === operatingCompanyId),
      reportingCurrentMonthKey
    )
  );
  const materialized = selections.flatMap((selection) => selection.materialized);
  const incompleteRows = selections.flatMap((selection) => selection.incompleteRows);
  const openArRows = selections.flatMap((selection) => selection.openArRows);
  const unavailable = new Set(
    selections.flatMap((selection) => [...selection.openArUnavailableOperatingCompanyIds])
  );
  const latestMonthKey = [...new Set(rows.map((row) => row.monthKey))].sort().at(-1) ?? null;
  const openArMonths = [...new Set(openArRows.map((row) => row.monthKey))].sort();
  return {
    materialized,
    incompleteRows,
    materializedMonths: new Set(materialized.map((row) => row.monthKey)),
    incompleteMonths: new Set(incompleteRows.map((row) => row.monthKey)),
    latestMonthKey,
    openArMonthKey: openArMonths.at(-1) ?? null,
    openArAvailable: openArRows.length > 0,
    openArRows,
    openArUnavailableOperatingCompanyIds: unavailable
  };
}

function countOperatingCompanyMonths(rows: MonthlyMoneyRow[]): number {
  return new Set(rows.map((row) => `${row.operatingCompanyId}:${row.monthKey}`)).size;
}

export type ReportingOperatingCompanyRow = {
  operatingCompanyId: string;
  slug: string;
  displayName: string;
  active: boolean;
  monthlyRowCount: number;
  materializedMonthCount: number;
  incompleteMonthCount: number;
  incompleteRowCount: number;
  nativeByCurrency: ReportingNativeByCurrency[];
  cadRevenue: number | null;
  cadRevenuePartial: boolean;
  cadValuesPartial: boolean;
  cadOpenAr: number | null;
  cadOpenArPartial: boolean;
  openArAvailable: boolean;
  openArMonthKey: string | null;
  openArCadFx: ReportingCadFxLabel | null;
  latestMonthKey: string | null;
  latestCadFx: ReportingCadFxLabel | null;
  totalCadFx: ReportingCadTotalFx | null;
};

/**
 * Per-operating-company consolidation over the tenant's materialized monthly
 * financials. Every operating company in the tenant is returned (active first);
 * a company with no materialized evidence carries a zero/empty state. Headline
 * totals exclude an entire month when any row in it is INCOMPLETE. Open AR uses
 * only a complete current-report-month live snapshot and never adds historical snapshots.
 */
export async function listReportingOperatingCompanies(
  ctx: AuthenticatedContext,
  input: { monthKey?: string; now?: Date } = {}
): Promise<ReportingOperatingCompanyRow[]> {
  await requireReadAccess(ctx);

  const now = input.now ?? new Date();

  const [operatingCompanies, financialRows] = await Promise.all([
    prisma.operatingCompany.findMany({
      where: tenantWhere(ctx),
      select: { id: true, slug: true, displayName: true, active: true },
      orderBy: [{ active: "desc" }, { displayName: "asc" }]
    }),
    prisma.customerMonthlyFinancial.findMany({
      where: tenantWhere(ctx, input.monthKey ? { monthKey: input.monthKey } : {}),
      select: selectMonthlyMoney
    })
  ]);

  const rows = financialRows as unknown as MonthlyMoneyRow[];

  return operatingCompanies.map((company) => {
    const companyRows = rows.filter((row) => row.operatingCompanyId === company.id);
    const periods = selectReportingPeriods(companyRows, currentMonthKey(now));
    const money = aggregateReportingMoney(
      periods.materialized.map(toMoneyInput),
      periods.openArRows.map(toMoneyInput)
    );
    const { materializedMonths, incompleteMonths, incompleteRows, latestMonthKey } = periods;
    const totalCadFx = reportingCadTotalFx([...materializedMonths], now);

    return {
      operatingCompanyId: company.id,
      slug: company.slug,
      displayName: company.displayName,
      active: company.active,
      monthlyRowCount: companyRows.length,
      materializedMonthCount: materializedMonths.size,
      incompleteMonthCount: incompleteMonths.size,
      incompleteRowCount: incompleteRows.length,
      nativeByCurrency: money.nativeByCurrency,
      cadRevenue: money.cadRevenue,
      cadRevenuePartial: money.cadRevenuePartial,
      cadValuesPartial: money.cadRevenuePartial || money.cadOpenArPartial,
      cadOpenAr: money.cadOpenAr,
      cadOpenArPartial: money.cadOpenArPartial,
      openArAvailable: periods.openArAvailable,
      openArMonthKey: periods.openArMonthKey,
      openArCadFx: periods.openArMonthKey
        ? reportingCadFxLabel(periods.openArMonthKey, now)
        : null,
      latestMonthKey,
      latestCadFx: latestMonthKey ? reportingCadFxLabel(latestMonthKey, now) : null,
      totalCadFx
    };
  });
}

export type ReportingServiceLineRow = {
  serviceLine: CustomerIntelligenceServiceLine;
  operatingCompanyId: string | null;
  monthlyRowCount: number;
  materializedMonthCount: number;
  incompleteMonthCount: number;
  incompleteRowCount: number;
  nativeByCurrency: Array<Omit<ReportingNativeByCurrency, "nativeOpenAr">>;
  cadRevenue: number | null;
  cadRevenuePartial: boolean;
  latestMonthKey: string | null;
  latestCadFx: ReportingCadFxLabel | null;
  totalCadFx: ReportingCadTotalFx | null;
};

/**
 * Per-service-line consolidation over the tenant's materialized monthly
 * financials. All seven service lines are always returned so an unpopulated
 * line renders an honest zero state. When `input.operatingCompanyId` is
 * supplied the read (and therefore every total) is scoped to that operating
 * company inside the authenticated tenant; a foreign identifier simply yields
 * zero rows because the tenant filter is part of the same `where`.
 */
export async function listReportingServiceLines(
  ctx: AuthenticatedContext,
  input: { monthKey?: string; operatingCompanyId?: string; now?: Date } = {}
): Promise<ReportingServiceLineRow[]> {
  await requireReadAccess(ctx);

  const now = input.now ?? new Date();

  const where = tenantWhere(
    ctx,
    input.monthKey ? { monthKey: input.monthKey } : {}
  ) as { monthKey?: string; operatingCompanyId?: string; tenantId: string };
  if (input.operatingCompanyId) {
    where.operatingCompanyId = input.operatingCompanyId;
  }

  const financialRows = (await prisma.customerMonthlyFinancial.findMany({
    where,
    select: selectMonthlyMoney
  })) as unknown as MonthlyMoneyRow[];

  // Completeness and live-snapshot selection are atomic per operating company.
  // A partial company-period cannot invalidate another company's complete data.
  const scopedPeriods = selectReportingPeriodsByOperatingCompany(
    financialRows,
    currentMonthKey(now)
  );

  return Object.values(CustomerIntelligenceServiceLine).map((serviceLine) => {
    const serviceRows = financialRows.filter((row) => row.serviceLine === serviceLine);
    const materialized = scopedPeriods.materialized.filter(
      (row) => row.serviceLine === serviceLine
    );
    const incompleteRows = serviceRows.filter(
      (row) => row.reconciliationStatus === CustomerFinancialPeriodStatus.INCOMPLETE
    );
    const materializedMonths = new Set(materialized.map((row) => row.monthKey));
    const incompleteCompanyMonths = new Set(
      serviceRows
        .filter(
          (row) =>
            !scopedPeriods.materialized.some(
              (materializedRow) =>
                materializedRow === row
            )
        )
        .map((row) => `${row.operatingCompanyId}:${row.monthKey}`)
    );
    const latestMonthKey =
      [...new Set(serviceRows.map((row) => row.monthKey))].sort().at(-1) ?? null;
    // Open AR is materialized under OTHER and is not attributable to revenue
    // service lines. Service-line reporting therefore reports activity only;
    // live AR remains available at summary and operating-company level.
    const money = aggregateReportingMoney(
      materialized.map(toMoneyInput),
      []
    );
    const totalCadFx = reportingCadTotalFx([...materializedMonths], now);

    return {
      serviceLine,
      operatingCompanyId: input.operatingCompanyId ?? null,
      monthlyRowCount: serviceRows.length,
      materializedMonthCount: countOperatingCompanyMonths(materialized),
      incompleteMonthCount: incompleteCompanyMonths.size,
      incompleteRowCount: incompleteRows.length,
      nativeByCurrency: money.nativeByCurrency.map((entry) => ({
        currency: entry.currency,
        nativeRevenue: entry.nativeRevenue,
        nativeCost: entry.nativeCost,
        nativeGrossProfit: entry.nativeGrossProfit
      })),
      cadRevenue: money.cadRevenue,
      cadRevenuePartial: money.cadRevenuePartial,
      latestMonthKey,
      latestCadFx: latestMonthKey ? reportingCadFxLabel(latestMonthKey, now) : null,
      totalCadFx
    };
  });
}

export type ReportingMonthlyRow = {
  monthlyFinancialId: string;
  monthKey: string;
  cadFx: ReportingCadFxLabel;
  companyId: string;
  companyName: string;
  relationshipId: string;
  sourceAccountKey: string;
  serviceLine: CustomerIntelligenceServiceLine;
  currency: string;
  nativeRevenue: number;
  nativeCost: number;
  nativeGrossProfit: number;
  cadRevenue: number | null;
  nativeOpenAr: number | null;
  cadOpenAr: number | null;
  openArAvailable: boolean;
  reconciliationStatus: CustomerFinancialPeriodStatus;
};

export type ReportingRevenueLineRow = {
  sourceKey: string;
  transactionDate: Date;
  monthKey: string;
  transactionNumber: string | null;
  transactionType: string;
  companyId: string;
  companyName: string;
  serviceLine: CustomerIntelligenceServiceLine;
  nativeAmount: number;
  nativeCurrency: string;
  cadAmount: number | null;
  fxSource: string | null;
};

/** Deterministic page size for the operating-company revenue-line evidence. */
export const REPORTING_REVENUE_LINE_PAGE_SIZE = 500;
/** Upper bound keeps Prisma skip arithmetic finite and within a controlled range. */
export const REPORTING_REVENUE_LINE_MAX_PAGE = 10_000;

export function normalizeReportingRevenueLinePage(value: unknown): number {
  const page = typeof value === "number" ? value : Number(value);
  return Number.isFinite(page) && Number.isInteger(page) && page >= 1 && page <= REPORTING_REVENUE_LINE_MAX_PAGE
    ? page
    : 1;
}

/**
 * Deterministic pagination state for the revenue-line evidence served by
 * `getReportingOperatingCompanyDetail`. Evidence is ordered newest-first by
 * transaction date with the unique `id` breaking ties, so every page is stable;
 * `totalCount` is the complete tenant-scoped record so a truncated page is
 * never mistaken for the full materialized set.
 */
export type ReportingRevenueLinePageInfo = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasPrevious: boolean;
  hasMore: boolean;
};

export type ReportingOperatingCompanyDetail = {
  operatingCompany: {
    id: string;
    slug: string;
    displayName: string;
    homeCurrency: string;
    active: boolean;
  };
  disclosure: string;
  monthlyRows: ReportingMonthlyRow[];
  revenueLines: ReportingRevenueLineRow[];
  revenueLinePage: ReportingRevenueLinePageInfo;
  summary: {
    monthlyRowCount: number;
    materializedMonthCount: number;
    incompleteMonthCount: number;
    incompleteRowCount: number;
    nativeByCurrency: ReportingNativeByCurrency[];
    cadRevenue: number | null;
    cadRevenuePartial: boolean;
    cadValuesPartial: boolean;
    cadOpenAr: number | null;
    cadOpenArPartial: boolean;
    openArAvailable: boolean;
    openArMonthKey: string | null;
    openArCadFx: ReportingCadFxLabel | null;
    totalCadFx: ReportingCadTotalFx | null;
    /** Complete tenant-scoped revenue-line evidence count, never just the current page. */
    revenueLineCount: number;
  };
};

/**
 * One operating company's reporting detail: its materialized monthly financial
 * rows (each carrying the deterministic PROVISIONAL/FINAL CAD label) and its
 * immutable revenue-line evidence, both tenant-scoped. Returns null for unknown
 * or cross-tenant operating-company identifiers so the detail page renders as
 * not found.
 *
 * Revenue-line evidence is served in deterministic 500-row pages ordered
 * newest-first by transaction date (unique `id` tiebreak). `input.revenueLinePage`
 * selects the page; the returned `revenueLinePage` exposes the complete
 * tenant-scoped `totalCount`, `totalPages`, and previous/next availability so a
 * truncated page is always disclosed and subsequent evidence is reachable.
 */
export async function getReportingOperatingCompanyDetail(
  ctx: AuthenticatedContext,
  operatingCompanyId: string,
  input: { monthKey?: string; now?: Date; revenueLinePage?: number } = {}
): Promise<ReportingOperatingCompanyDetail | null> {
  await requireReadAccess(ctx);

  const now = input.now ?? new Date();
  const pageSize = REPORTING_REVENUE_LINE_PAGE_SIZE;
  const requestedPage = normalizeReportingRevenueLinePage(input.revenueLinePage);

  const operatingCompany = await prisma.operatingCompany.findFirst({
    where: tenantWhere(ctx, { id: operatingCompanyId }),
    select: {
      id: true,
      slug: true,
      displayName: true,
      homeCurrency: true,
      active: true
    }
  });
  if (!operatingCompany) {
    return null;
  }

  const revenueLineWhere = tenantWhere(ctx, {
    operatingCompanyId,
    ...(input.monthKey ? { transactionDate: monthKeyDateRange(input.monthKey) } : {})
  });

  const [monthlyFinancials, revenueLineCount, revenueLines] = await Promise.all([
    prisma.customerMonthlyFinancial.findMany({
      where: tenantWhere(ctx, {
        operatingCompanyId,
        ...(input.monthKey ? { monthKey: input.monthKey } : {})
      }),
      include: {
        company: { select: { name: true } }
      },
      orderBy: [{ monthKey: "desc" }, { serviceLine: "asc" }, { currency: "asc" }]
    }),
    prisma.customerRevenueLine.count({ where: revenueLineWhere }),
    prisma.customerRevenueLine.findMany({
      where: revenueLineWhere,
      include: {
        company: { select: { name: true } }
      },
      orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
      skip: (requestedPage - 1) * pageSize,
      take: pageSize
    })
  ]);

  const periods = selectReportingPeriods(
    monthlyFinancials as unknown as MonthlyMoneyRow[],
    currentMonthKey(now)
  );

  const monthlyRows: ReportingMonthlyRow[] = monthlyFinancials.map((row) => {
    const openArAvailable =
      periods.openArAvailable && row.monthKey === periods.openArMonthKey;
    return {
    monthlyFinancialId: row.id,
    monthKey: row.monthKey,
    cadFx: reportingCadFxLabel(row.monthKey, now),
    companyId: row.companyId,
    companyName: row.company.name,
    relationshipId: row.companyOperatingRelationshipId,
    sourceAccountKey: row.sourceAccountKey,
    serviceLine: row.serviceLine,
    currency: row.currency,
    nativeRevenue: Number(row.nativeRevenue),
    nativeCost: Number(row.nativeCost),
    nativeGrossProfit: Number(row.nativeGrossProfit),
    cadRevenue: row.cadRevenue === null ? null : Number(row.cadRevenue),
    nativeOpenAr: openArAvailable ? Number(row.nativeOpenAr) : null,
    cadOpenAr:
      openArAvailable && row.cadOpenAr !== null ? Number(row.cadOpenAr) : null,
    openArAvailable,
    reconciliationStatus: row.reconciliationStatus
    };
  });

  const revenueLineRows: ReportingRevenueLineRow[] = revenueLines.map((line) => ({
    sourceKey: line.sourceKey,
    transactionDate: line.transactionDate,
    monthKey: monthKeyOf(line.transactionDate),
    transactionNumber: line.transactionNumber,
    transactionType: line.transactionType,
    companyId: line.companyId,
    companyName: line.company.name,
    serviceLine: line.serviceLine,
    nativeAmount: Number(line.nativeAmount),
    nativeCurrency: line.nativeCurrency,
    cadAmount: line.cadAmount === null ? null : Number(line.cadAmount),
    fxSource: line.fxSource
  }));

  const { materialized, incompleteRows, materializedMonths, incompleteMonths } = periods;
  const money = aggregateReportingMoney(
    materialized.map(toMoneyInput),
    periods.openArRows.map(toMoneyInput)
  );
  const totalCadFx = reportingCadTotalFx([...materializedMonths], now);

  const totalRevenueLineCount = revenueLineCount ?? 0;
  const totalRevenueLinePages = Math.max(1, Math.ceil(totalRevenueLineCount / pageSize));

  return {
    operatingCompany,
    disclosure: REPORTING_CAD_DISCLOSURE,
    monthlyRows,
    revenueLines: revenueLineRows,
    revenueLinePage: {
      page: requestedPage,
      pageSize,
      totalCount: totalRevenueLineCount,
      totalPages: totalRevenueLinePages,
      hasPrevious: requestedPage > 1 && totalRevenueLineCount > 0,
      hasMore: requestedPage * pageSize < totalRevenueLineCount
    },
    summary: {
      monthlyRowCount: monthlyFinancials.length,
      materializedMonthCount: materializedMonths.size,
      incompleteMonthCount: incompleteMonths.size,
      incompleteRowCount: incompleteRows.length,
      nativeByCurrency: money.nativeByCurrency,
      cadRevenue: money.cadRevenue,
      cadRevenuePartial: money.cadRevenuePartial,
      cadValuesPartial: money.cadRevenuePartial || money.cadOpenArPartial,
      cadOpenAr: money.cadOpenAr,
      cadOpenArPartial: money.cadOpenArPartial,
      openArAvailable: periods.openArAvailable,
      openArMonthKey: periods.openArMonthKey,
      openArCadFx: periods.openArMonthKey
        ? reportingCadFxLabel(periods.openArMonthKey, now)
        : null,
      totalCadFx,
      revenueLineCount: totalRevenueLineCount
    }
  };
}

export type ReportingSummary = {
  disclosure: string;
  operatingCompanyCount: number;
  companiesWithFinancials: number;
  monthlyRowCount: number;
  materializedMonthCount: number;
  incompleteMonthCount: number;
  incompleteRowCount: number;
  nativeByCurrency: ReportingNativeByCurrency[];
  cadRevenue: number | null;
  cadRevenuePartial: boolean;
  cadValuesPartial: boolean;
  cadOpenAr: number | null;
  cadOpenArPartial: boolean;
  openArAvailable: boolean;
  openArUnavailableOperatingCompanyCount: number;
  openArMonthKey: string | null;
  openArCadFx: ReportingCadFxLabel | null;
  totalCadFx: ReportingCadTotalFx | null;
  currentMonthKey: string;
  currentMonthCadFx: ReportingCadFxLabel;
};

/**
 * Tenant-wide reporting summary for the overview page. Materialized totals
 * exclude one operating company's entire month if any row in that company-month
 * is INCOMPLETE, without invalidating another company's complete month. Open AR
 * uses only a complete snapshot for the report's current calendar month and
 * fails closed if that snapshot is absent or incomplete. The headline CAD total carries the
 * aggregate `totalCadFx` label (FINAL / PROVISIONAL / MIXED, or null for an
 * empty total) describing the months actually included, so an all-closed or
 * empty total is never labeled PROVISIONAL merely because the current calendar
 * month is provisional. `currentMonthCadFx` continues to describe the current
 * month itself.
 */
export async function getReportingSummary(
  ctx: AuthenticatedContext,
  input: { monthKey?: string; now?: Date } = {}
): Promise<ReportingSummary> {
  await requireReadAccess(ctx);

  const now = input.now ?? new Date();

  const [operatingCompanies, financialRows] = await Promise.all([
    prisma.operatingCompany.findMany({
      where: tenantWhere(ctx),
      select: { id: true }
    }),
    prisma.customerMonthlyFinancial.findMany({
      where: tenantWhere(ctx, input.monthKey ? { monthKey: input.monthKey } : {}),
      select: selectMonthlyMoney
    })
  ]);

  const rows = financialRows as unknown as MonthlyMoneyRow[];
  const periods = selectReportingPeriodsByOperatingCompany(rows, currentMonthKey(now));
  const { materialized, incompleteRows, materializedMonths } = periods;
  const companiesWithFinancials = new Set(rows.map((row) => row.operatingCompanyId)).size;
  const money = aggregateReportingMoney(
    materialized.map(toMoneyInput),
    periods.openArRows.map(toMoneyInput)
  );
  const currentMonth = currentMonthKey(now);
  const openArAvailableOperatingCompanyIds = new Set(
    periods.openArRows.map((row) => row.operatingCompanyId)
  );
  const openArUnavailableOperatingCompanyIds = new Set(
    operatingCompanies
      .map((operatingCompany) => operatingCompany.id)
      .filter((operatingCompanyId) =>
        !openArAvailableOperatingCompanyIds.has(operatingCompanyId)
      )
  );

  return {
    disclosure: REPORTING_CAD_DISCLOSURE,
    operatingCompanyCount: operatingCompanies.length,
    companiesWithFinancials,
    monthlyRowCount: rows.length,
    materializedMonthCount: countOperatingCompanyMonths(materialized),
    incompleteMonthCount: countOperatingCompanyMonths(incompleteRows),
    incompleteRowCount: incompleteRows.length,
    nativeByCurrency: money.nativeByCurrency,
    cadRevenue: money.cadRevenue,
    cadRevenuePartial: money.cadRevenuePartial,
    cadValuesPartial:
      money.cadRevenuePartial ||
      money.cadOpenArPartial ||
      openArUnavailableOperatingCompanyIds.size > 0,
    cadOpenAr: money.cadOpenAr,
    cadOpenArPartial: money.cadOpenArPartial,
    openArAvailable: periods.openArAvailable,
    openArUnavailableOperatingCompanyCount:
      openArUnavailableOperatingCompanyIds.size,
    openArMonthKey: periods.openArMonthKey,
    openArCadFx: periods.openArMonthKey
      ? reportingCadFxLabel(periods.openArMonthKey, now)
      : null,
    totalCadFx: reportingCadTotalFx([...materializedMonths], now),
    currentMonthKey: currentMonth,
    currentMonthCadFx: reportingCadFxLabel(currentMonth, now)
  };
}
