import {
  ModuleKey,
  WebsiteGrowthAction,
  WebsiteGrowthContentDraftSource,
  WebsiteGrowthContentDraftStatus,
  WebsiteGrowthDataSource,
  WebsiteGrowthImportStatus,
  WebsiteGrowthOpportunityStatus
} from "@prisma/client";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import {
  createWeeklyWebsiteGrowthPlanAction,
  generateWebsiteGrowthDraftAction,
  generateWebsiteGrowthOpportunitiesAction,
  importWebsiteGrowthMetricsAction,
  organizeWebsiteGrowthQueueAction,
  syncSearchConsoleAction,
  updateWebsiteGrowthDraftAction,
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
        <MetricCard label="Review queue" value={shell.metrics.reviewQueueCount} caption="Qualified items to triage" />
        <MetricCard label="Approved / active" value={shell.metrics.approvedCount} caption="Ready for execution" />
        <MetricCard label="Published" value={shell.metrics.publishedCount} caption="Marked live" />
        <MetricCard label="Inbound leads" value={shell.metrics.inboundCount} caption="Last 30 days" />
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Weekly SEO approval plan</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              Each weekly run prepares a balanced slate for approval: core commercial page work, supporting articles or glossary content, and quick optimization tasks. The planner never publishes automatically.
            </p>
          </div>
          <form action={createWeeklyWebsiteGrowthPlanAction}>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Prepare this week&apos;s approval plan
            </button>
          </form>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {shell.weeklyLaneCounts.map((lane) => (
            <div key={lane.lane} className="rounded-md border border-border bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">{lane.label}</h3>
                <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                  {lane.count} ready
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-mutedForeground">{lane.description}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                Weekly publish guide: up to {lane.publishLimit}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Prepared for approval</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              These are the weekly recommendations selected for your review. Generate a draft package to review the proposed URL, structure, SEO copy, FAQs, internal links, and build checklist before anything is posted.
            </p>
          </div>
          <Link
            href="/website-growth?status=REVIEWING"
            className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Open reviewing view
          </Link>
        </div>
        <div className="grid gap-4 p-5 xl:grid-cols-3">
          {shell.preparedOpportunities.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm leading-6 text-mutedForeground xl:col-span-3">
              No weekly approval items are waiting. Run the weekly planner to prepare core pages, support content, and quick optimizations.
            </div>
          ) : null}
          {shell.preparedOpportunities.map((opportunity) => (
            <PreparedOpportunityCard key={opportunity.id} opportunity={opportunity} />
          ))}
        </div>
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
          <form action={organizeWebsiteGrowthQueueAction} className="mt-3">
            <button className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              Organize current queue
            </button>
            <p className="mt-2 text-xs leading-5 text-mutedForeground">
              Moves weak existing signals into Monitoring without deleting raw metrics or approved work.
            </p>
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
                {entry.summary ? (
                  <RunSummary summary={entry.summary} />
                ) : null}
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
              Showing the top 200 items by score and freshness. Total stored: {shell.metrics.totalCount.toLocaleString("en-US")}; monitoring: {shell.metrics.monitoringCount.toLocaleString("en-US")}.
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

function PreparedOpportunityCard({
  opportunity
}: {
  opportunity: Awaited<ReturnType<typeof getWebsiteGrowthShell>>["preparedOpportunities"][number];
}) {
  const draft = opportunity.contentDrafts[0] ?? null;
  const draftPayload = draft ? readDraftPayload(draft.draftJson) : null;

  return (
    <article className="flex h-full flex-col rounded-md border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
          Prepared
        </span>
        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-mutedForeground">
          Score {opportunity.score}
        </span>
        {draft ? (
          <span className={draft.source === WebsiteGrowthContentDraftSource.AI ? "rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success" : "rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning"}>
            {draft.source === WebsiteGrowthContentDraftSource.AI ? "AI draft ready" : "Template draft ready"}
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 text-base font-semibold text-foreground">{opportunity.topic}</h3>
      <p className="mt-2 text-sm leading-6 text-mutedForeground">{formatStatusLike(opportunity.action)}</p>
      <div className="mt-4 space-y-2 text-sm">
        <PageReviewLink label="Target page" value={opportunity.targetPage} />
        <PageReviewLink label="Source page" value={opportunity.sourcePage} />
      </div>
      <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Approval note</p>
        <p className="mt-2 text-sm leading-6 text-foreground">{opportunity.recommendation}</p>
      </div>
      {draft ? (
        <div className="mt-4 rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Draft package</p>
              <h4 className="mt-2 text-sm font-semibold text-foreground">{draft.title}</h4>
            </div>
            <span className={contentDraftBadgeClassName(draft.status)}>
              {formatStatusLike(draft.status)}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-mutedForeground">{draft.summary}</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <SummaryRow label="Content type" value={draft.contentType} />
            <SummaryRow label="Proposed URL" value={draft.proposedPath} />
            <SummaryRow label="Target keyword" value={draftPayload?.targetKeyword} />
            <SummaryRow label="Search intent" value={draftPayload?.searchIntent} />
            <SummaryRow label="Newl pattern" value={draftPayload?.websitePageType} />
          </dl>
          <Link
            href={`/website-growth/drafts/${draft.id}`}
            className="mt-3 inline-flex text-sm font-semibold text-primary transition-colors hover:text-primaryHover"
          >
            View draft page preview
          </Link>
          {draftPayload ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-primary">Review draft details</summary>
              <div className="mt-3 space-y-3">
                <DraftList title="Sections" items={draftPayload.sections.map((section) => `${section.heading}: ${section.purpose}`)} />
                <DraftList title="FAQs" items={draftPayload.faqs.map((faq) => faq.question)} />
                <DraftList title="Internal links" items={draftPayload.internalLinks.map((link) => `${link.label} -> ${link.url}`)} />
                <DraftList title="Layout components" items={draftPayload.layoutComponents} />
                <DraftList title="Build checklist" items={draftPayload.reviewChecklist} />
              </div>
            </details>
          ) : null}
          <form action={updateWebsiteGrowthDraftAction} className="mt-4 grid gap-2 sm:grid-cols-[1fr,auto]">
            <input type="hidden" name="draftId" value={draft.id} />
            <select
              name="status"
              defaultValue={draft.status}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value={WebsiteGrowthContentDraftStatus.DRAFT}>Keep as draft</option>
              <option value={WebsiteGrowthContentDraftStatus.APPROVED}>Approve draft for build</option>
              <option value={WebsiteGrowthContentDraftStatus.REJECTED}>Reject draft</option>
              <option value={WebsiteGrowthContentDraftStatus.BUILT}>Mark built</option>
              <option value={WebsiteGrowthContentDraftStatus.PUBLISHED}>Mark published</option>
            </select>
            <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              Save draft
            </button>
          </form>
        </div>
      ) : (
        <form action={generateWebsiteGrowthDraftAction} className="mt-4">
          <input type="hidden" name="opportunityId" value={opportunity.id} />
          <button className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
            Generate review draft
          </button>
          <p className="mt-2 text-xs leading-5 text-mutedForeground">
            Creates a saved proposal for review. This does not publish or modify the website.
          </p>
        </form>
      )}
      <form action={updateWebsiteGrowthOpportunityAction} className="mt-auto pt-4">
        <input type="hidden" name="opportunityId" value={opportunity.id} />
        <input type="hidden" name="notes" value={opportunity.notes ?? ""} />
        <div className="grid gap-2 sm:grid-cols-[1fr,auto]">
          <select
            name="status"
            defaultValue={opportunity.status}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value={WebsiteGrowthOpportunityStatus.REVIEWING}>Keep reviewing</option>
            <option value={WebsiteGrowthOpportunityStatus.APPROVED}>Approve for build</option>
            <option value={WebsiteGrowthOpportunityStatus.REJECTED}>Reject</option>
            <option value={WebsiteGrowthOpportunityStatus.MONITORING}>Monitor only</option>
          </select>
          <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
            Save
          </button>
        </div>
      </form>
    </article>
  );
}

function DraftList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{title}</p>
      <ul className="mt-2 space-y-1 text-sm leading-6 text-foreground">
        {items.slice(0, 6).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function PageReviewLink({ label, value }: { label: string; value?: string | null }) {
  if (!value) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
        <p className="mt-1 text-mutedForeground">Not attached yet</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block break-all font-semibold text-primary transition-colors hover:text-primaryHover"
      >
        Review page
      </a>
      <p className="mt-1 break-all text-xs text-mutedForeground">{value}</p>
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

function readDraftPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    targetKeyword: typeof record.targetKeyword === "string" ? record.targetKeyword : null,
    searchIntent: typeof record.searchIntent === "string" ? record.searchIntent : null,
    websitePageType: typeof record.websitePageType === "string" ? record.websitePageType : null,
    sections: readDraftObjectArray(record.sections).map((section) => ({
      heading: readDraftString(section.heading),
      purpose: readDraftString(section.purpose)
    })).filter((section) => section.heading && section.purpose),
    faqs: readDraftObjectArray(record.faqs).map((faq) => ({
      question: readDraftString(faq.question)
    })).filter((faq) => faq.question),
    internalLinks: readDraftObjectArray(record.internalLinks).map((link) => ({
      label: readDraftString(link.label),
      url: readDraftString(link.url)
    })).filter((link) => link.label && link.url),
    layoutComponents: readDraftStringArray(record.layoutComponents),
    reviewChecklist: readDraftStringArray(record.reviewChecklist)
  };
}

function readDraftObjectArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function readDraftStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function readDraftString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function RunSummary({ summary }: { summary: unknown }) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return null;
  }

  const record = summary as Record<string, unknown>;
  const items = [
    ["Raw candidates", record.rawCandidates],
    ["Clusters", record.clusters],
    ["Qualified", record.qualifiedOpportunities],
    ["Created", record.opportunitiesCreated],
    ["Existing", record.existingMatches],
    ["Skipped", record.skippedClusters]
  ].filter((item): item is [string, number] => typeof item[1] === "number");

  if (items.length === 0) {
    return null;
  }

  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-border bg-background px-3 py-2">
          <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-mutedForeground">{label}</dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">{Number(value).toLocaleString("en-US")}</dd>
        </div>
      ))}
    </dl>
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

function contentDraftBadgeClassName(status: WebsiteGrowthContentDraftStatus) {
  const base = "rounded-full border px-2.5 py-1 text-xs font-semibold";

  if (
    status === WebsiteGrowthContentDraftStatus.APPROVED ||
    status === WebsiteGrowthContentDraftStatus.BUILT ||
    status === WebsiteGrowthContentDraftStatus.PUBLISHED
  ) {
    return `${base} border-success/25 bg-success/10 text-success`;
  }

  if (status === WebsiteGrowthContentDraftStatus.REJECTED) {
    return `${base} border-danger/25 bg-danger/10 text-danger`;
  }

  return `${base} border-warning/25 bg-warning/10 text-warning`;
}
