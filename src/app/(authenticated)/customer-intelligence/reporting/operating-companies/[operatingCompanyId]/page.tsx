import { CustomerFinancialPeriodStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { requireReadAccess } from "@/modules/customer-intelligence/permissions";
import {
  getReportingOperatingCompanyDetail,
  normalizeReportingRevenueLinePage,
  REPORTING_CAD_DISCLOSURE,
  type ReportingCadTotalFx,
  type ReportingOperatingCompanyDetail
} from "@/modules/customer-intelligence/reporting-queries";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Per-operating-company CAD consolidation reporting detail (CP-PHASE-02B-6).
 * Leadership-only and tenant-scoped; unknown or cross-tenant operating-company
 * identifiers render as not found. Every monthly row carries its conservative
 * CAD materialization label and the directional-reporting disclaimer is shown
 * on the page. Every native amount is rendered in its actual transaction
 * currency (never a CAD fallback). Revenue-line evidence is paginated in
 * deterministic 500-row pages via the `page` search parameter, so a truncated
 * evidence set is disclosed and subsequent evidence is reachable.
 */
export default async function CustomerIntelligenceReportingOperatingCompanyPage({
  params,
  searchParams
}: {
  params: Promise<{ operatingCompanyId: string }>;
  searchParams?: Promise<{ page?: string }>;
}) {
  const context = await getAuthenticatedContext();
  await requireReadAccess(context);

  const { operatingCompanyId } = await params;
  const resolvedSearchParams: { page?: string } = searchParams ? await searchParams : {};
  const pageParam = resolvedSearchParams.page;
  const revenueLinePage = normalizeReportingRevenueLinePage(pageParam);
  const detail = await getReportingOperatingCompanyDetail(context, operatingCompanyId, {
    revenueLinePage
  });
  if (!detail) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer Intelligence · Financial Reporting"
        title={detail.operatingCompany.displayName}
        description={`Materialized monthly financials and immutable revenue evidence for ${detail.operatingCompany.displayName}. CAD consolidation is directional management reporting, not a statutory accounting entry.`}
      />

      <aside className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-foreground">
        <p className="font-semibold">{REPORTING_CAD_DISCLOSURE}</p>
        <p className="mt-1 text-xs text-mutedForeground">
          Reliable current-month activity is displayed month-to-date through the
          report date, with applicable CAD conversion labeled PROVISIONAL. Stored
          closed-month CAD remains conservatively PROVISIONAL because the current
          schema cannot prove that final FX was rematerialized. One incomplete row
          excludes that operating company&apos;s entire month from headline
          revenue, cost, and gross-profit totals. Open AR is the live
          point-in-time snapshot for the current reporting month and is never
          summed across months; if that snapshot is missing or incomplete,
          headline Open AR is unavailable with no fallback to an older snapshot.
          Native amounts are shown in their transaction
          currencies.
        </p>
      </aside>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Months materialized" value={detail.summary.materializedMonthCount} />
        <Metric label="Incomplete months" value={detail.summary.incompleteMonthCount} />
        <Metric
          label={cadMetricLabel(
            "Materialized CAD revenue",
            detail.summary.totalCadFx,
            detail.summary.cadRevenuePartial
          )}
          value={formatMoney(detail.summary.cadRevenue)}
        />
        <Metric
          label="Materialized native cost"
          value={formatNativeSummary(detail, "nativeCost")}
        />
        <Metric
          label="Materialized native gross profit"
          value={formatNativeSummary(detail, "nativeGrossProfit")}
        />
        <Metric
          label={openArMetricLabel(detail)}
          value={
            detail.summary.openArAvailable
              ? formatMoney(detail.summary.cadOpenAr)
              : detail.summary.monthlyRowCount > 0
                ? "Unavailable"
                : "—"
          }
        />
      </div>

      <MonthlyFinancialsSection detail={detail} />
      <RevenueLinesSection detail={detail} />
    </div>
  );
}

function MonthlyFinancialsSection({ detail }: { detail: ReportingOperatingCompanyDetail }) {
  if (detail.monthlyRows.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Monthly financials</h2>
        <p className="mt-2 text-sm text-mutedForeground">
          No materialized monthly financial rows are stored for this operating
          company yet.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <h2 className="px-4 pt-4 text-base font-semibold text-foreground">
        Monthly financials ({detail.monthlyRows.length})
      </h2>
      <table className="mt-2 min-w-[1100px] divide-y divide-border text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          <tr>
            {[
              "Month",
              "Company",
              "Service line",
              "Currency",
              "Native revenue",
              "Native cost",
              "Native gross profit",
              "CAD revenue",
              "Live native AR",
              "Live CAD AR",
              "Status"
            ].map((heading) => (
              <th key={heading} className="px-4 py-3">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {detail.monthlyRows.map((row) => (
            <tr key={row.monthlyFinancialId}>
              <td className="px-4 py-3">
                <span className="font-semibold text-foreground">{row.monthKey}</span>
                <span className="ml-2">
                  <CadBadge status={row.cadFx.cadStatus} currentMonth={row.cadFx.isCurrentMonth} />
                </span>
              </td>
              <td className="px-4 py-3 text-mutedForeground">{row.companyName}</td>
              <td className="px-4 py-3 text-mutedForeground">{formatServiceLine(row.serviceLine)}</td>
              <td className="px-4 py-3 text-mutedForeground">{row.currency}</td>
              <td className="px-4 py-3 text-mutedForeground">
                {formatMoney(row.nativeRevenue, row.currency)}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                {formatMoney(row.nativeCost, row.currency)}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                {formatMoney(row.nativeGrossProfit, row.currency)}
              </td>
              <td className="px-4 py-3 text-foreground">{formatMoney(row.cadRevenue)}</td>
              <td className="px-4 py-3 text-mutedForeground">
                {row.openArAvailable
                  ? formatMoney(row.nativeOpenAr, row.currency)
                  : "Unavailable"}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                {row.openArAvailable ? formatMoney(row.cadOpenAr) : "Unavailable"}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                {row.reconciliationStatus === CustomerFinancialPeriodStatus.INCOMPLETE ? (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-foreground">
                    INCOMPLETE
                  </span>
                ) : (
                  row.reconciliationStatus
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RevenueLinesSection({ detail }: { detail: ReportingOperatingCompanyDetail }) {
  const { page, pageSize, totalCount, totalPages, hasPrevious, hasMore } =
    detail.revenueLinePage;
  const baseHref = `/customer-intelligence/reporting/operating-companies/${detail.operatingCompany.id}`;

  if (totalCount === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Revenue-line evidence</h2>
        <p className="mt-2 text-sm text-mutedForeground">
          No immutable revenue-line evidence is stored for this operating company
          yet.
        </p>
      </section>
    );
  }

  if (detail.revenueLines.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">
          Revenue-line evidence ({totalCount} total)
        </h2>
        <p className="mt-2 text-sm text-mutedForeground">
          No revenue-line evidence on page {page}.{" "}
          <Link href={baseHref} className="font-semibold text-primary hover:text-primaryHover">
            Back to the first page
          </Link>
          .
        </p>
      </section>
    );
  }

  const firstRow = (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalCount);

  return (
    <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <h2 className="px-4 pt-4 text-base font-semibold text-foreground">
        Revenue-line evidence ({totalCount} total)
      </h2>
      <p className="px-4 pt-1 text-xs text-mutedForeground">
        Immutable QuickBooks transaction evidence; the FX source embeds the
        PROVISIONAL/FINAL classification for converted lines (NATIVE_CAD needs no
        conversion). Evidence is paginated in deterministic 500-row pages ordered
        newest-first by transaction date.
      </p>
      <table className="mt-2 min-w-[1100px] divide-y divide-border text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          <tr>
            {[
              "Date",
              "Company",
              "Service line",
              "Type",
              "Number",
              "Native amount",
              "Native currency",
              "CAD amount",
              "FX source"
            ].map((heading) => (
              <th key={heading} className="px-4 py-3">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {detail.revenueLines.map((line) => (
            <tr key={line.sourceKey}>
              <td className="px-4 py-3 text-mutedForeground">{formatDate(line.transactionDate)}</td>
              <td className="px-4 py-3 text-mutedForeground">{line.companyName}</td>
              <td className="px-4 py-3 text-mutedForeground">{formatServiceLine(line.serviceLine)}</td>
              <td className="px-4 py-3 text-mutedForeground">{line.transactionType}</td>
              <td className="px-4 py-3 text-mutedForeground">{line.transactionNumber ?? "—"}</td>
              <td className="px-4 py-3 text-mutedForeground">
                {formatMoney(line.nativeAmount, line.nativeCurrency)}
              </td>
              <td className="px-4 py-3 text-mutedForeground">{line.nativeCurrency}</td>
              <td className="px-4 py-3 text-foreground">{formatMoney(line.cadAmount)}</td>
              <td className="px-4 py-3 text-mutedForeground">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium">
                  {line.fxSource ?? "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
        <p className="text-xs text-mutedForeground">
          Showing rows {firstRow}–{lastRow} of {totalCount} (page {page} of{" "}
          {totalPages}).
        </p>
        <div className="flex items-center gap-2">
          {hasPrevious ? (
            <Link
              href={`${baseHref}?page=${page - 1}`}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-background"
            >
              Previous
            </Link>
          ) : null}
          {hasMore ? (
            <Link
              href={`${baseHref}?page=${page + 1}`}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-background"
            >
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CadBadge({
  status,
  currentMonth
}: {
  status: "PROVISIONAL" | "FINAL";
  currentMonth: boolean;
}) {
  const tone =
    status === "PROVISIONAL"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
      : "border-success/30 bg-success/10 text-foreground";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {status}
      {currentMonth ? " · current month" : ""}
    </span>
  );
}

function formatServiceLine(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatMoney(value: number | null, currency = "CAD"): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Labels a displayed CAD total with its conservative stored-materialization
 * state and any partial-conversion gap.
 */
function cadMetricLabel(
  base: string,
  totalFx: ReportingCadTotalFx | null,
  partial: boolean
): string {
  const suffix: string[] = [];
  if (totalFx) {
    suffix.push(totalFx.cadStatus);
  }
  if (partial) {
    suffix.push("partial");
  }
  return suffix.length > 0 ? `${base} · ${suffix.join(", ")}` : base;
}

function openArMetricLabel(detail: ReportingOperatingCompanyDetail): string {
  if (!detail.summary.openArAvailable) {
    return detail.summary.monthlyRowCount > 0
      ? "Live CAD Open AR · current snapshot unavailable"
      : "Live CAD Open AR";
  }
  const suffix: Array<string | undefined> = [detail.summary.openArCadFx?.cadStatus];
  if (detail.summary.cadOpenArPartial) {
    suffix.push("partial");
  }
  const populatedSuffix = suffix.filter(Boolean);
  return `Live CAD Open AR${
    populatedSuffix.length > 0 ? ` · ${populatedSuffix.join(", ")}` : ""
  }`;
}

function formatNativeSummary(
  detail: ReportingOperatingCompanyDetail,
  pick: "nativeCost" | "nativeGrossProfit"
): string {
  return detail.summary.nativeByCurrency.length === 0
    ? "—"
    : detail.summary.nativeByCurrency
        .map((entry) => `${formatMoney(entry[pick], entry.currency)} ${entry.currency}`)
        .join(" · ");
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-mutedForeground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
