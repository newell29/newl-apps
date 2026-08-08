import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { requireReadAccess } from "@/modules/customer-intelligence/permissions";
import {
  getReportingSummary,
  listReportingOperatingCompanies,
  listReportingServiceLines,
  REPORTING_CAD_DISCLOSURE,
  type ReportingCadTotalFx,
  type ReportingNativeByCurrency,
  type ReportingOperatingCompanyRow,
  type ReportingServiceLineRow
} from "@/modules/customer-intelligence/reporting-queries";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Customer Intelligence financial reporting (CP-PHASE-02B-6). Leadership-only
 * (ADMIN / MANAGER / FINANCE via `requireReadAccess`) server-rendered CAD
 * consolidation management reporting over the materialized
 * CustomerMonthlyFinancial / CustomerRevenueLine evidence. Every view shows the
 * directional-reporting disclaimer, conservatively labels stored CAD totals
 * PROVISIONAL unless final materialization can be proven, renders native amounts with their transaction currencies
 * (never mixed), and never touches the legacy Cashflow tables.
 */
export default async function CustomerIntelligenceReportingPage({
  searchParams
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const context = await getAuthenticatedContext();
  await requireReadAccess(context);

  const { view } = await searchParams;
  const showServiceLines = view === "service-lines";

  const [summary, operatingCompanies, serviceLines] = await Promise.all([
    getReportingSummary(context),
    listReportingOperatingCompanies(context),
    listReportingServiceLines(context)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer Intelligence"
        title="Financial Reporting"
        description="Leadership-only management reporting over materialized monthly financials and immutable revenue evidence. CAD consolidation is directional management reporting, not a statutory accounting entry."
      />

      <ReportingDisclaimer />

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Operating companies" value={summary.companiesWithFinancials} />
        <Metric label="Months materialized" value={summary.materializedMonthCount} />
        <Metric label="Incomplete months" value={summary.incompleteMonthCount} />
        <Metric
          label={cadMetricLabel(
            "Materialized CAD revenue",
            summary.totalCadFx,
            summary.cadRevenuePartial
          )}
          value={formatMoney(summary.cadRevenue)}
        />
        <Metric label="Materialized native cost" value={formatNativeSummary(summary.nativeByCurrency, "nativeCost")} />
        <Metric label="Materialized native gross profit" value={formatNativeSummary(summary.nativeByCurrency, "nativeGrossProfit")} />
      </div>

      <div className="flex gap-2 border-b border-border">
        <Tab
          href="/customer-intelligence/reporting?view=operating-companies"
          active={!showServiceLines}
        >
          Operating companies · {operatingCompanies.length}
        </Tab>
        <Tab href="/customer-intelligence/reporting?view=service-lines" active={showServiceLines}>
          Service lines · {serviceLines.length}
        </Tab>
      </div>

      {showServiceLines ? (
        <ServiceLinesView rows={serviceLines} />
      ) : (
        <OperatingCompaniesView rows={operatingCompanies} />
      )}
    </div>
  );
}

function ReportingDisclaimer() {
  return (
    <aside className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-foreground">
      <p className="font-semibold">{REPORTING_CAD_DISCLOSURE}</p>
      <p className="mt-1 text-xs text-mutedForeground">
        Reliable current-month activity is shown month-to-date through the report
        date; applicable current-month CAD conversions are labeled <CadBadge status="PROVISIONAL" />.
        The stored monthly model does not prove which FX status produced a prior
        CAD value, so closed materializations also remain conservatively labeled
        PROVISIONAL until final rematerialization can be proven. Completeness is
        evaluated per operating company and month: one incomplete company-period
        is excluded from revenue, cost, and gross-profit headlines without
        invalidating another company&apos;s complete period. Open AR is each operating
        company&apos;s current-report-month live point-in-time snapshot and is never added across
        months; a missing or incomplete current-month snapshot makes that company&apos;s
        AR unavailable rather than substituting an older snapshot. Native
         amounts are summed in their transaction currencies (never mixed across
         currencies); CAD consolidation is the
        directional management-reporting basis.
      </p>
    </aside>
  );
}

function OperatingCompaniesView({ rows }: { rows: ReportingOperatingCompanyRow[] }) {
  if (rows.every((row) => row.monthlyRowCount === 0)) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-sm text-mutedForeground">
        No materialized monthly financials yet. Run the ADMIN-triggered
        financial materialization to populate this reporting view.
      </p>
    );
  }

  return (
    <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="min-w-[1000px] divide-y divide-border text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          <tr>
            {[
              "Operating company",
              "Months",
              "Incomplete",
              "Native revenue",
              "Native cost",
              "Native gross profit",
              "CAD revenue",
              "Native AR",
              "CAD AR"
            ].map((heading) => (
              <th key={heading} className="px-4 py-3">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.operatingCompanyId}>
              <td className="px-4 py-3">
                <Link
                  href={`/customer-intelligence/reporting/operating-companies/${row.operatingCompanyId}`}
                  className="font-semibold text-primary hover:text-primaryHover"
                >
                  {row.displayName}
                </Link>
                {!row.active ? (
                  <span className="ml-2 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-mutedForeground">
                    Inactive
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                {row.materializedMonthCount} materialized
                {row.latestCadFx ? (
                  <span className="ml-2">
                    <CadBadge status={row.latestCadFx.cadStatus} />
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                {row.incompleteMonthCount > 0 ? (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-foreground">
                    {row.incompleteMonthCount}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                <NativeAmounts byCurrency={row.nativeByCurrency} pick="nativeRevenue" />
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                <NativeAmounts byCurrency={row.nativeByCurrency} pick="nativeCost" />
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                <NativeAmounts byCurrency={row.nativeByCurrency} pick="nativeGrossProfit" />
              </td>
              <td className="px-4 py-3 text-foreground">
                {formatMoney(row.cadRevenue)}
                {row.cadRevenuePartial ? (
                  <span className="ml-1 text-xs text-mutedForeground">partial</span>
                ) : null}
                {row.totalCadFx ? (
                  <span className="ml-2">
                    <CadBadge status={row.totalCadFx.cadStatus} />
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                <OpenArNativeAmounts row={row} />
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                {row.openArAvailable ? formatMoney(row.cadOpenAr) : "Unavailable"}
                {row.openArAvailable && row.cadOpenArPartial ? (
                  <span className="ml-1 text-xs text-mutedForeground">partial</span>
                ) : null}
                {row.openArCadFx ? (
                  <span className="ml-2">
                    <CadBadge status={row.openArCadFx.cadStatus} />
                  </span>
                ) : null}
                {!row.openArAvailable && row.monthlyRowCount > 0 ? (
                  <span className="ml-1 text-xs text-mutedForeground">current snapshot unavailable</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ServiceLinesView({ rows }: { rows: ReportingServiceLineRow[] }) {
  if (rows.every((row) => row.monthlyRowCount === 0)) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-sm text-mutedForeground">
        No materialized monthly financials yet. Service-line totals appear here
        once financial materialization has written monthly evidence.
      </p>
    );
  }

  return (
    <section className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="min-w-[900px] divide-y divide-border text-sm">
        <caption className="px-4 py-3 text-left text-xs text-mutedForeground">
          Open AR is reported at operating-company level and is not attributable
          to revenue service lines.
        </caption>
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          <tr>
            {[
              "Service line",
              "Months",
              "Incomplete",
              "Native revenue",
              "Native cost",
              "Native gross profit",
              "CAD revenue"
            ].map((heading) => (
              <th key={heading} className="px-4 py-3">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.serviceLine}>
              <td className="px-4 py-3">
                <span className="font-semibold text-foreground">{formatServiceLine(row.serviceLine)}</span>
                {row.latestCadFx ? (
                  <span className="ml-2">
                    <CadBadge status={row.latestCadFx.cadStatus} />
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-mutedForeground">{row.materializedMonthCount}</td>
              <td className="px-4 py-3 text-mutedForeground">
                {row.incompleteMonthCount > 0 ? (
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-foreground">
                    {row.incompleteMonthCount}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                <NativeAmounts byCurrency={row.nativeByCurrency} pick="nativeRevenue" />
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                <NativeAmounts byCurrency={row.nativeByCurrency} pick="nativeCost" />
              </td>
              <td className="px-4 py-3 text-mutedForeground">
                <NativeAmounts byCurrency={row.nativeByCurrency} pick="nativeGrossProfit" />
              </td>
              <td className="px-4 py-3 text-foreground">
                {formatMoney(row.cadRevenue)}
                {row.cadRevenuePartial ? (
                  <span className="ml-1 text-xs text-mutedForeground">partial</span>
                ) : null}
                {row.totalCadFx ? (
                  <span className="ml-2">
                    <CadBadge status={row.totalCadFx.cadStatus} />
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CadBadge({ status }: { status: "PROVISIONAL" | "FINAL" | "MIXED" }) {
  const tone =
    status === "PROVISIONAL"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
      : status === "MIXED"
        ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-700"
        : "border-success/30 bg-success/10 text-foreground";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {status}
    </span>
  );
}

function NativeAmounts({
  byCurrency,
  pick
}: {
  byCurrency: Array<Pick<ReportingNativeByCurrency, "currency"> & Partial<ReportingNativeByCurrency>>;
  pick: "nativeRevenue" | "nativeCost" | "nativeGrossProfit" | "nativeOpenAr";
}) {
  if (byCurrency.length === 0) {
    return <span>—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {byCurrency.map((entry) => (
        <span key={entry.currency}>
          {formatMoney(entry[pick] ?? null, entry.currency)}
          <span className="ml-1 text-xs text-mutedForeground">{entry.currency}</span>
        </span>
      ))}
    </div>
  );
}

function formatNativeSummary(
  byCurrency: ReportingNativeByCurrency[],
  pick: "nativeCost" | "nativeGrossProfit"
): string {
  return byCurrency.length === 0
    ? "—"
    : byCurrency.map((entry) => `${formatMoney(entry[pick], entry.currency)} ${entry.currency}`).join(" · ");
}

function OpenArNativeAmounts({
  row
}: {
  row: ReportingOperatingCompanyRow;
}) {
  if (!row.openArAvailable) {
    return row.monthlyRowCount > 0 ? <span>Unavailable · current snapshot unavailable</span> : <span>—</span>;
  }
  return <NativeAmounts byCurrency={row.nativeByCurrency} pick="nativeOpenAr" />;
}

function formatServiceLine(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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

function Tab({
  href,
  active,
  children
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-mutedForeground hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-mutedForeground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
