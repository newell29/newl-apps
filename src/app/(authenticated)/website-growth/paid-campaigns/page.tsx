import {
  ModuleKey,
  WebsiteInboundAttributionChannel,
  WebsiteInboundStatus
} from "@prisma/client";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import {
  getPaidCampaignReport,
  PAID_REPORT_STATUS_LABELS,
  parsePaidCampaignFilters
} from "@/modules/website-growth/paid-campaigns";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type PaidGroup = {
  label: string;
  formSubmissions: number;
  qualifiedLeads: number;
  quotesSent: number;
  won: number;
  lost: number;
  leadToQualifiedRate: number | null;
  leadToQuoteRate: number | null;
  leadToWinRate: number | null;
};

const field = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export default async function PaidCampaignsPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  const params = searchParams ? await searchParams : {};
  const filters = parsePaidCampaignFilters(params);
  const report = await getPaidCampaignReport(context.tenantId, filters);
  const review = record(report.latestReview?.output);
  const attributionPartial = report.rows.filter(
    (row) => row.attributionCompleteness !== "COMPLETE"
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website Growth · Paid Campaigns"
        title="Paid campaign performance"
        description="Follow first-party paid-search leads from submission through qualification, quote and outcome. Cost metrics remain hidden until verified Google Ads synchronization exists."
      />
      <GrowthNavigation />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Reporting boundary</h2>
        <p className="mt-2 text-sm text-mutedForeground">
          Test, Codex diagnostic and automated form-check records are retained for form-health auditing and excluded here. Paid-search classification uses paid UTM media, Google Ads click IDs, or campaign parameters. Attribution is first-party evidence, not proof of causation.
        </p>
        {!report.costMetrics ? (
          <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm">
            Google Ads cost data is not connected. Spend, CPL, qualified CPL, cost per quote and acquisition cost are intentionally unavailable.
          </p>
        ) : report.costMetrics.available ? (
          <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm">
            Connected spend: {money(report.costMetrics.spend, report.costMetrics.currency ?? "CAD")} · CPL {moneyOrUnavailable(report.costMetrics.costPerLead, report.costMetrics.currency ?? "CAD")} · Qualified CPL {moneyOrUnavailable(report.costMetrics.costPerQualifiedLead, report.costMetrics.currency ?? "CAD")} · Cost per quote {moneyOrUnavailable(report.costMetrics.costPerQuote, report.costMetrics.currency ?? "CAD")} · Acquisition cost {moneyOrUnavailable(report.costMetrics.customerAcquisitionCost, report.costMetrics.currency ?? "CAD")}
          </p>
        ) : (
          <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm">{report.costMetrics.reason}</p>
        )}
      </section>

      <form className="grid gap-3 rounded-lg border border-border bg-card p-5 shadow-sm md:grid-cols-3 xl:grid-cols-6">
        <label className="text-sm">From<input className={field} type="date" name="from" defaultValue={filters.from} /></label>
        <label className="text-sm">To<input className={field} type="date" name="to" defaultValue={filters.to} /></label>
        <label className="text-sm">Campaign<input className={field} name="campaign" defaultValue={filters.campaign} placeholder="Name or ID" /></label>
        <label className="text-sm">Channel<select className={field} name="channel" defaultValue={filters.channel}><option value="ALL">All paid-search</option><option value={WebsiteInboundAttributionChannel.PAID_SEARCH}>Paid search</option></select></label>
        <label className="text-sm">Location<input className={field} name="location" defaultValue={filters.location} placeholder="City, province or country" /></label>
        <label className="text-sm">Status<select className={field} name="status" defaultValue={filters.status === WebsiteInboundStatus.TEST ? "ALL" : filters.status}><option value="ALL">All genuine statuses</option>{Object.values(WebsiteInboundStatus).filter((status) => status !== WebsiteInboundStatus.TEST).map((status) => <option key={status} value={status}>{PAID_REPORT_STATUS_LABELS[status]}</option>)}</select></label>
        <div className="md:col-span-3 xl:col-span-6"><button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">Apply filters</button></div>
      </form>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Form submissions" value={report.metrics.formSubmissions} caption="Genuine paid-search forms" />
        <MetricCard label="Qualified leads" value={report.metrics.qualifiedLeads} caption="Qualified or later" />
        <MetricCard label="Quotes sent" value={report.metrics.quotesSent} caption="Quote sent or won" />
        <MetricCard label="Won" value={report.metrics.won} caption="Current outcome" />
        <MetricCard label="Lost" value={report.metrics.lost} caption="Current outcome" />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <RateCard label="Lead to qualified" value={report.metrics.leadToQualifiedRate} />
        <RateCard label="Lead to quote" value={report.metrics.leadToQuoteRate} />
        <RateCard label="Lead to win" value={report.metrics.leadToWinRate} />
      </section>

      {report.openSignals.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Newl Scout paid signals</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {report.openSignals.map((signal) => <article key={signal.id} className="rounded-md border border-border p-4"><p className="text-xs font-semibold uppercase tracking-wide text-primary">{signal.type.replaceAll("_", " ")}</p><h3 className="mt-2 font-semibold">{signal.title}</h3><p className="mt-2 text-sm text-mutedForeground">{signal.detail}</p><p className="mt-2 text-xs">Last observed {formatDateTime(signal.lastSeenAt)}</p></article>)}
          </div>
          <p className="mt-3 text-xs text-mutedForeground">Scout recommendations never change budgets, bids, keywords or Google Ads settings.</p>
        </section>
      )}

      {review.version === 1 && (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Latest weekly paid review</h2>
          <p className="mt-2 text-sm"><strong>{String(review.recommendation ?? "INVESTIGATE")}</strong> — {String(review.recommendationReason ?? "Review the saved evidence before changing spend.")}</p>
          <p className="mt-2 text-xs text-mutedForeground">Human review is required for every budget, bid or keyword decision.</p>
        </section>
      )}

      <section className="grid gap-5 xl:grid-cols-2">
        <Breakdown title="Campaign" rows={report.grouped.campaign} />
        <Breakdown title="Keyword" rows={report.grouped.keyword} />
        <Breakdown title="Landing page" rows={report.grouped.landingPage} />
        <Breakdown title="Source" rows={report.grouped.source} />
        <Breakdown title="Location" rows={report.grouped.location} />
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border p-5">
          <h2 className="text-lg font-semibold">Underlying paid leads</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            {report.totalRows} matching lead{report.totalRows === 1 ? "" : "s"}. {attributionPartial} visible row{attributionPartial === 1 ? " has" : "s have"} partial or unavailable attribution.
          </p>
          {report.truncated && <p className="mt-2 text-sm">The report reached its 5,000-row safety cap. Narrow the date or campaign filters.</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead><tr className="border-b border-border"><th className="p-3">Submitted</th><th className="p-3">Lead</th><th className="p-3">Status</th><th className="p-3">Campaign</th><th className="p-3">Keyword</th><th className="p-3">Landing page</th><th className="p-3">Source</th><th className="p-3">Location / device</th><th className="p-3">Attribution</th></tr></thead>
            <tbody>{report.rows.map((row) => <tr key={row.id} className="border-b border-border/70 align-top"><td className="p-3 whitespace-nowrap">{formatDateTime(row.submittedAt ?? row.createdAt)}</td><td className="p-3"><Link className="font-semibold text-primary" href={`/website-inbound?view=ALL&selected=${encodeURIComponent(row.id)}`}>{row.company || row.name || "Unnamed lead"}</Link></td><td className="p-3">{PAID_REPORT_STATUS_LABELS[row.status]}</td><td className="p-3">{row.campaign || "Unavailable"}{row.campaignId && row.utmCampaign ? <span className="block text-xs text-mutedForeground">ID {row.campaignId}</span> : null}</td><td className="p-3">{row.utmTerm || "Unavailable"}</td><td className="max-w-sm break-all p-3">{row.landing || "Unavailable"}</td><td className="p-3">{row.utmSource || row.source || "Unavailable"}<span className="block text-xs text-mutedForeground">{row.attributionChannel.replaceAll("_", " ")}</span></td><td className="p-3">{row.attributionLocation || "Unavailable"}<span className="block text-xs text-mutedForeground">{row.device || "Device unavailable"}</span></td><td className="p-3"><AttributionBadge value={row.attributionCompleteness} />{row.attributionConfidence && <span className="mt-1 block text-xs text-mutedForeground">Source confidence: {row.attributionConfidence}</span>}</td></tr>)}</tbody>
          </table>
        </div>
        {!report.rows.length && <p className="p-6 text-sm text-mutedForeground">No genuine paid-search leads match these filters. Test and internal records remain available in Inbound Opportunities.</p>}
        <Pagination params={params} page={filters.page} total={report.totalRows} pageSize={report.pageSize} />
      </section>
    </div>
  );
}

function GrowthNavigation() {
  return <nav className="flex flex-wrap gap-4 text-sm font-semibold"><Link href="/website-growth">Effectiveness review</Link><Link href="/website-growth/marketing">Marketing workboard</Link><Link href="/website-growth/pages">Page briefs and previews</Link><Link href="/website-growth/paid-campaigns" aria-current="page" className="text-primary">Paid campaigns</Link><Link href="/website-growth/backlinks">Publisher opportunities</Link><Link href="/website-growth/signals">Research signals</Link></nav>;
}

function RateCard({ label, value }: { label: string; value: number | null }) {
  return <div className="rounded-lg border border-border bg-card p-5 shadow-sm"><p className="text-sm text-mutedForeground">{label}</p><p className="mt-2 text-3xl font-semibold text-primary">{percent(value)}</p></div>;
}

function Breakdown({ title, rows }: { title: string; rows: PaidGroup[] }) {
  return <section className="rounded-lg border border-border bg-card shadow-sm"><h2 className="border-b border-border p-4 text-lg font-semibold">By {title.toLowerCase()}</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">{title}</th><th className="p-3">Leads</th><th className="p-3">Qualified</th><th className="p-3">Quotes</th><th className="p-3">Won</th></tr></thead><tbody>{rows.slice(0, 12).map((row) => <tr key={row.label} className="border-t border-border"><td className="max-w-xs break-all p-3">{row.label}</td><td className="p-3">{row.formSubmissions}</td><td className="p-3">{row.qualifiedLeads} <span className="text-xs text-mutedForeground">({percent(row.leadToQualifiedRate)})</span></td><td className="p-3">{row.quotesSent}</td><td className="p-3">{row.won}</td></tr>)}</tbody></table></div>{!rows.length && <p className="p-4 text-sm text-mutedForeground">No matching evidence.</p>}</section>;
}

function AttributionBadge({ value }: { value: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" }) {
  const className = value === "COMPLETE" ? "bg-success/10 text-success" : value === "PARTIAL" ? "bg-warning/10 text-warning" : "bg-muted text-mutedForeground";
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${className}`}>{value === "COMPLETE" ? "Complete" : value === "PARTIAL" ? "Partial" : "Unavailable"}</span>;
}

function Pagination({ params, page, total, pageSize }: { params: SearchParams; page: number; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (next: number) => {
    const values = new URLSearchParams();
    for (const [key, raw] of Object.entries(params)) {
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (value && key !== "page") values.set(key, value);
    }
    values.set("page", String(next));
    return `/website-growth/paid-campaigns?${values}`;
  };
  return <div className="flex items-center justify-between p-4 text-sm"><span>Page {page} of {pages}</span><div className="flex gap-2">{page > 1 && <Link className="rounded border border-border px-3 py-1" href={href(page - 1)}>Previous</Link>}{page < pages && <Link className="rounded border border-border px-3 py-1" href={href(page + 1)}>Next</Link>}</div></div>;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function percent(value: number | null) {
  return value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
}

function formatDateTime(value: Date) {
  return value.toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" });
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value);
}

function moneyOrUnavailable(value: number | null, currency: string) {
  return value === null ? "Unavailable" : money(value, currency);
}
