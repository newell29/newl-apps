import {
  ModuleKey,
  WebsiteGrowthAction,
  WebsiteGrowthDataSource,
  WebsiteGrowthImportStatus,
  WebsiteGrowthOpportunityStatus
} from "@prisma/client";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import {
  generateWebsiteGrowthOpportunitiesAction,
  importWebsiteGrowthMetricsAction,
  syncSearchConsoleAction,
  updateWebsiteGrowthOpportunityAction
} from "@/modules/website-growth/actions";
import {
  getWebsiteGrowthShell,
  type WebsiteGrowthActionFilter,
  type WebsiteGrowthStatusFilter
} from "@/modules/website-growth/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WebsiteGrowthPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  const params = searchParams ? await searchParams : {};
  const status = parseStatus(readParam(params.status));
  const action = parseAction(readParam(params.action));
  const search = readParam(params.search) ?? "";
  const shell = await getWebsiteGrowthShell(context, { status, action, search });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website Growth"
        title="Content opportunity queue"
        description="Turn Search Console, Semrush, GA4, and Newl Apps data into a prioritized queue of pages, sections, links, redirects, and resources to improve inbound opportunities."
      />

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Opportunities" value={shell.metrics.totalCount} caption="Total generated" />
        <MetricCard label="Approved / active" value={shell.metrics.approvedCount} caption="Ready for execution" />
        <MetricCard label="Published" value={shell.metrics.publishedCount} caption="Marked live" />
        <MetricCard label="Inbound leads" value={shell.metrics.inboundCount} caption="Last 30 days" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Data connections</h2>
              <p className="mt-1 text-sm leading-6 text-mutedForeground">
                API status is checked from environment variables. Manual imports remain available for Semrush and historical exports.
              </p>
            </div>
            <form action={syncSearchConsoleAction}>
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                Sync Search Console
              </button>
            </form>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <IntegrationCard
              title="Search Console"
              status={shell.integrations.googleSearchConsole.configured ? "Ready" : "Needs API"}
              caption={
                shell.integrations.googleSearchConsole.configured
                  ? `Site: ${shell.integrations.googleSearchConsole.siteUrl ?? "configured"}`
                  : `Missing ${shell.integrations.googleSearchConsole.missing.length} env values`
              }
              ready={shell.integrations.googleSearchConsole.configured}
            />
            <IntegrationCard
              title="GA4"
              status={shell.integrations.ga4.configured ? "Ready" : "Planned"}
              caption={
                shell.integrations.ga4.configured
                  ? `Property: ${shell.integrations.ga4.propertyId}`
                  : "Use manual export until GA4 API is connected"
              }
              ready={shell.integrations.ga4.configured}
            />
            <IntegrationCard
              title="Internal app data"
              status="Connected"
              caption={`${shell.metrics.companyCount} companies, ${shell.metrics.pipelineCount} pipeline records`}
              ready
            />
          </div>

          <form action={generateWebsiteGrowthOpportunitiesAction} className="mt-4">
            <button className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              Generate from Newl Apps data
            </button>
          </form>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Manual import fallback</h2>
          <p className="mt-1 text-sm leading-6 text-mutedForeground">
            Paste CSV or tab-separated rows from Search Console, GA4, or Semrush. The parser maps common columns like query, page, clicks, impressions, position, sessions, and leads.
          </p>
          <form action={importWebsiteGrowthMetricsAction} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-foreground">
                Source
                <select
                  name="source"
                  defaultValue={WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_UPLOAD}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value={WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_UPLOAD}>Search Console export</option>
                  <option value={WebsiteGrowthDataSource.SEMRUSH_UPLOAD}>Semrush export</option>
                  <option value={WebsiteGrowthDataSource.GA4_UPLOAD}>GA4 export</option>
                  <option value={WebsiteGrowthDataSource.MANUAL}>Manual rows</option>
                </select>
              </label>
              <label className="text-sm font-medium text-foreground">
                Import label
                <input
                  name="fileName"
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Semrush position tracking July"
                />
              </label>
            </div>
            <textarea
              name="csvText"
              rows={6}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="query,page,clicks,impressions,position&#10;warehouse logistics,/services/warehousing-services,10,500,8.2"
            />
            <button className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Import and generate opportunities
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Internal Newl Apps signal</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Signal label="Companies" value={shell.metrics.companyCount} />
            <Signal label="Contacts" value={shell.metrics.contactCount} />
            <Signal label="Pipeline records" value={shell.metrics.pipelineCount} />
            <Signal label="Credit checks" value={shell.metrics.creditCheckCount} />
          </dl>
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-foreground">Lead-producing pages</h3>
            <div className="mt-3 space-y-2">
              {shell.inboundLeadPages.length === 0 ? (
                <p className="text-sm text-mutedForeground">No inbound page data captured yet.</p>
              ) : null}
              {shell.inboundLeadPages.map((page) => (
                <div key={page.pageUrl} className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="break-all text-sm font-semibold text-foreground">{page.pageUrl}</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-mutedForeground">
                    {page.count} related submissions
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Recent data runs</h2>
          <div className="mt-4 space-y-3">
            {shell.recentImports.length === 0 ? (
              <p className="text-sm text-mutedForeground">No imports or sync attempts yet.</p>
            ) : null}
            {shell.recentImports.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={importBadgeClassName(entry.status)}>{formatStatusLike(entry.status)}</span>
                  <span className="text-xs text-mutedForeground">{formatDate(entry.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-foreground">{formatStatusLike(entry.source)}</p>
                <p className="mt-1 text-sm text-mutedForeground">
                  {entry.errorMessage ?? `${entry.rowCount.toLocaleString("en-US")} rows processed`}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Opportunity filters</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Review recommendations by status, action, keyword, page, or reason.
            </p>
          </div>
          <Link
            href="/website-growth"
            className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Clear filters
          </Link>
        </div>
        <form className="mt-4 grid gap-3 md:grid-cols-[1fr,1fr,1.4fr,auto]">
          <label className="text-sm font-medium text-foreground">
            Status
            <select
              name="status"
              defaultValue={status}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="ALL">All statuses</option>
              {Object.values(WebsiteGrowthOpportunityStatus).map((value) => (
                <option key={value} value={value}>
                  {formatStatusLike(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-foreground">
            Action
            <select
              name="action"
              defaultValue={action}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="ALL">All actions</option>
              {Object.values(WebsiteGrowthAction).map((value) => (
                <option key={value} value={value}>
                  {formatStatusLike(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-foreground">
            Search
            <input
              name="search"
              defaultValue={search}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Keyword, topic, page, recommendation"
            />
          </label>
          <div className="flex items-end">
            <button className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Apply
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Content opportunity queue</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Showing the top 200 items by score and freshness.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {shell.statusCounts.map((entry) => (
              <span key={entry.status} className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-mutedForeground">
                {formatStatusLike(entry.status)}: {entry.count}
              </span>
            ))}
          </div>
        </div>

        <div className="divide-y divide-border">
          {shell.opportunities.length === 0 ? (
            <div className="p-5 text-sm text-mutedForeground">
              No opportunities match this view. Run an API sync, import a report, or generate from internal app data.
            </div>
          ) : null}
          {shell.opportunities.map((opportunity) => (
            <article key={opportunity.id} className="grid gap-5 p-5 xl:grid-cols-[0.75fr,1.25fr]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={opportunityBadgeClassName(opportunity.status)}>
                    {formatStatusLike(opportunity.status)}
                  </span>
                  <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                    {formatStatusLike(opportunity.action)}
                  </span>
                  <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-mutedForeground">
                    Score {opportunity.score}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-foreground">{opportunity.topic}</h3>
                <dl className="mt-4 grid gap-2 text-sm">
                  <SummaryRow label="Keyword" value={opportunity.primaryKeyword} />
                  <SummaryRow label="Target page" value={opportunity.targetPage} />
                  <SummaryRow label="Source page" value={opportunity.sourcePage} />
                  <SummaryRow label="Confidence" value={opportunity.confidence} />
                </dl>
              </div>
              <div className="space-y-4">
                <div className="rounded-md border border-border bg-muted/30 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Why this matters</p>
                  <p className="mt-2 text-sm leading-6 text-foreground">{opportunity.reason}</p>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-mutedForeground">Recommended next step</p>
                  <p className="mt-2 text-sm leading-6 text-foreground">{opportunity.recommendation}</p>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-semibold text-primary">View evidence</summary>
                    <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-background p-3 text-xs text-mutedForeground">
                      {JSON.stringify(opportunity.evidence, null, 2)}
                    </pre>
                  </details>
                </div>
                <form action={updateWebsiteGrowthOpportunityAction} className="rounded-md border border-border bg-background p-4">
                  <input type="hidden" name="opportunityId" value={opportunity.id} />
                  <div className="grid gap-3 sm:grid-cols-[0.7fr,1.3fr,auto]">
                    <label className="text-sm font-medium text-foreground">
                      Status
                      <select
                        name="status"
                        defaultValue={opportunity.status}
                        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        {Object.values(WebsiteGrowthOpportunityStatus).map((value) => (
                          <option key={value} value={value}>
                            {formatStatusLike(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-medium text-foreground">
                      Notes
                      <input
                        name="notes"
                        defaultValue={opportunity.notes ?? ""}
                        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="Decision, owner, next action, or build note"
                      />
                    </label>
                    <div className="flex items-end">
                      <button className="w-full rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                        Save
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function IntegrationCard({
  title,
  status,
  caption,
  ready
}: {
  title: string;
  status: string;
  caption: string;
  ready: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className={ready ? "text-xs font-semibold text-success" : "text-xs font-semibold text-warning"}>
          {status}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-mutedForeground">{caption}</p>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold text-foreground">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) {
    return null;
  }

  return (
    <div className="grid gap-1 sm:grid-cols-[7rem,1fr]">
      <dt className="font-medium text-mutedForeground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | undefined): WebsiteGrowthStatusFilter {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return value in WebsiteGrowthOpportunityStatus ? (value as WebsiteGrowthOpportunityStatus) : "ALL";
}

function parseAction(value: string | undefined): WebsiteGrowthActionFilter {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return value in WebsiteGrowthAction ? (value as WebsiteGrowthAction) : "ALL";
}

function formatStatusLike(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function importBadgeClassName(status: WebsiteGrowthImportStatus) {
  const base = "rounded-full border px-2.5 py-1 text-xs font-semibold";

  if (status === WebsiteGrowthImportStatus.SUCCESS) {
    return `${base} border-success/25 bg-success/10 text-success`;
  }

  if (status === WebsiteGrowthImportStatus.ERROR) {
    return `${base} border-danger/25 bg-danger/10 text-danger`;
  }

  return `${base} border-warning/25 bg-warning/10 text-warning`;
}

function opportunityBadgeClassName(status: WebsiteGrowthOpportunityStatus) {
  const base = "rounded-full border px-2.5 py-1 text-xs font-semibold";

  if (status === WebsiteGrowthOpportunityStatus.NEW) {
    return `${base} border-warning/25 bg-warning/10 text-warning`;
  }

  if (
    status === WebsiteGrowthOpportunityStatus.APPROVED ||
    status === WebsiteGrowthOpportunityStatus.IN_PROGRESS ||
    status === WebsiteGrowthOpportunityStatus.PUBLISHED
  ) {
    return `${base} border-success/25 bg-success/10 text-success`;
  }

  if (status === WebsiteGrowthOpportunityStatus.REJECTED) {
    return `${base} border-danger/25 bg-danger/10 text-danger`;
  }

  return `${base} border-accentBorder bg-accentSoft text-primary`;
}
