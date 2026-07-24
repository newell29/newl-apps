import {
  ModuleKey,
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus
} from "@prisma/client";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import {
  approveAllWebsiteGrowthBacklinksAction,
  reviewWebsiteGrowthBacklinkAction
} from "@/modules/website-growth/actions";
import { getWebsiteGrowthBacklinkWorkspace } from "@/modules/website-growth/backlinks";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function WebsiteGrowthBacklinksPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  const workspace = await getWebsiteGrowthBacklinkWorkspace(context.tenantId);
  const groups = groupBacklinks(workspace.opportunities);
  const latestSummary = readRecord(readRecord(workspace.latestScoutRun?.output).backlinkSummary);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website Growth · Authority"
        title="Curated backlink opportunities"
        description="Scout reviews Semrush broadly, but only strong, deduplicated and actionable prospects enter this bounded queue."
      />

      <BacklinkNavigation />

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Needs your review" value={groups.REVIEW.length} caption="Curated—not raw Semrush rows" />
        <MetricCard label="Approved / underway" value={groups.ACTIVE.length} caption="Ready for the execution worker" />
        <MetricCard label="Verified live" value={groups.LIVE.length} caption="Durable backlink wins" />
        <MetricCard label="Blocked / lost" value={groups.CLOSED.length} caption="Kept out of the active queue" />
      </section>

      <section className="rounded-lg border border-success/25 bg-success/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-success">Latest Backlink Scout run</p>
        <h2 className="mt-2 text-lg font-semibold text-foreground">
          {readNumber(latestSummary.created)} new prospects added after quality review.
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-mutedForeground">
          Scout reviewed {readNumber(latestSummary.rawProspectsReviewed).toLocaleString("en-US")} candidates,
          refreshed {readNumber(latestSummary.refreshed)} existing records, and kept the active queue at{" "}
          {readNumber(latestSummary.activeQueueCount)} items. Rejected raw links are never stored here.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-4">
          <FlowStep number="1" title="Scout discovers" body="Semrush backlink gaps, new/lost links and referring domains are reviewed weekly." />
          <FlowStep number="2" title="Codex filters" body="Duplicates, weak directories, paid dofollow offers and risky sites are removed before storage." />
          <FlowStep number="3" title="You approve" body="Approve one prospect or the complete weekly batch. Approval does not authorize payment." />
          <FlowStep number="4" title="Agent executes" body="The executor claims approved work, records outreach or submissions, and verifies live links." />
        </div>
      </section>

      <BacklinkSection
        title="Needs your review"
        description="These are the only new prospects Scout recommends. Approve the complete batch or review each one."
        emptyMessage="No backlink opportunities need your decision."
        opportunities={groups.REVIEW}
        review
      >
        {groups.REVIEW.length > 0 ? (
          <form action={approveAllWebsiteGrowthBacklinksAction}>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Approve all current recommendations
            </button>
          </form>
        ) : null}
      </BacklinkSection>

      <BacklinkSection
        title="Approved and underway"
        description="Approved free submissions and outreach are available to the executor. Paid placements remain blocked from automated spending."
        emptyMessage="No approved backlink work is underway."
        opportunities={groups.ACTIVE}
      />

      <BacklinkSection
        title="Verified backlinks"
        description="Only links confirmed live are retained as durable wins."
        emptyMessage="No verified backlink wins have been recorded yet."
        opportunities={groups.LIVE}
        compact
      />

      <BacklinkSection
        title="Blocked or lost"
        description="A short operational history. Rejected and stale research is hidden from this workspace."
        emptyMessage="No blocked or lost backlinks."
        opportunities={groups.CLOSED.slice(0, 20)}
        compact
      />
    </div>
  );
}

function BacklinkNavigation() {
  return (
    <nav className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm" aria-label="Website Growth views">
      <Link href="/website-growth" className="rounded-md px-4 py-2 text-sm font-semibold text-mutedForeground transition-colors hover:bg-muted hover:text-foreground">
        Scout workspace
      </Link>
      <Link href="/website-growth/backlinks" aria-current="page" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
        Backlink Scout
      </Link>
      <Link href="/website-growth/signals" className="rounded-md px-4 py-2 text-sm font-semibold text-mutedForeground transition-colors hover:bg-muted hover:text-foreground">
        Research signals
      </Link>
      <p className="ml-auto hidden px-3 text-xs text-mutedForeground lg:block">
        Raw backlink rows never appear in Newl Apps.
      </p>
    </nav>
  );
}

function FlowStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primaryForeground">{number}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-mutedForeground">{body}</p>
    </div>
  );
}

function BacklinkSection({
  title,
  description,
  emptyMessage,
  opportunities,
  review = false,
  compact = false,
  children
}: {
  title: string;
  description: string;
  emptyMessage: string;
  opportunities: Awaited<ReturnType<typeof getWebsiteGrowthBacklinkWorkspace>>["opportunities"];
  review?: boolean;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-semibold text-mutedForeground">{opportunities.length}</span>
          {children}
        </div>
      </div>
      {opportunities.length === 0 ? (
        <p className="p-5 text-sm text-mutedForeground">{emptyMessage}</p>
      ) : (
        <div className={compact ? "grid gap-3 p-5 xl:grid-cols-3" : "grid gap-4 p-5 xl:grid-cols-2"}>
          {opportunities.map((opportunity) => (
            <BacklinkCard key={opportunity.id} opportunity={opportunity} review={review} compact={compact} />
          ))}
        </div>
      )}
    </section>
  );
}

function BacklinkCard({
  opportunity,
  review,
  compact
}: {
  opportunity: Awaited<ReturnType<typeof getWebsiteGrowthBacklinkWorkspace>>["opportunities"][number];
  review: boolean;
  compact: boolean;
}) {
  const paid = opportunity.category === WebsiteGrowthBacklinkCategory.PAID_PLACEMENT;
  return (
    <article className="flex h-full flex-col rounded-lg border border-border bg-background p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={statusClassName(opportunity.status)}>{formatLabel(opportunity.status)}</span>
        <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">{formatLabel(opportunity.category)}</span>
        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-mutedForeground">Quality {opportunity.qualityScore}</span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground">{opportunity.title}</h3>
      <p className="mt-1 text-sm font-semibold text-primary">{opportunity.sourceDomain}</p>
      <p className="mt-3 text-sm leading-6 text-mutedForeground">{opportunity.rationale}</p>
      {!compact ? (
        <div className="mt-4 rounded-md border border-border bg-muted/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Recommended approach</p>
          <p className="mt-2 text-sm leading-6 text-foreground">{opportunity.outreachAngle}</p>
          <dl className="mt-3 grid gap-2 text-xs text-mutedForeground sm:grid-cols-2">
            <Summary label="Target" value={opportunity.targetPage} />
            <Summary label="Relevance" value={`${opportunity.relevanceScore}/100`} />
            <Summary label="Authority" value={opportunity.authorityScore === null ? "Not available" : opportunity.authorityScore.toFixed(0)} />
            <Summary label="Spam risk" value={formatLabel(opportunity.spamRisk)} />
            {opportunity.recipientEmail ? <Summary label="Contacted" value={opportunity.recipientEmail} /> : null}
            {opportunity.nextFollowUpAt ? <Summary label="Next follow-up" value={formatDate(opportunity.nextFollowUpAt)} /> : null}
            {opportunity.replySummary ? <Summary label="Reply" value={opportunity.replySummary} /> : null}
            {opportunity.directoryUsername ? <Summary label="Directory username" value={opportunity.directoryUsername} /> : null}
            {opportunity.acceptedTermsSummary ? <Summary label="Directory terms" value={opportunity.acceptedTermsSummary} /> : null}
          </dl>
        </div>
      ) : null}
      {paid ? (
        <p className="mt-4 rounded-md border border-warning/25 bg-warning/10 p-3 text-xs leading-5 text-warning">
          Paid opportunity. Approval adds it to the plan but does not authorize payment or automated purchase.
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-5">
        <div className="flex flex-wrap gap-2">
          {opportunity.sourceUrl ? <ExternalLink href={opportunity.sourceUrl} label="View source" /> : null}
          {opportunity.contactPage ? <ExternalLink href={opportunity.contactPage} label="Contact page" /> : null}
          {opportunity.directoryLoginUrl ? <ExternalLink href={opportunity.directoryLoginUrl} label="Directory login" /> : null}
          {opportunity.acceptedTermsUrl ? <ExternalLink href={opportunity.acceptedTermsUrl} label="Accepted terms" /> : null}
          {opportunity.liveUrl ? <ExternalLink href={opportunity.liveUrl} label="Open live link" /> : null}
        </div>
        {review ? (
          <div className="flex gap-2">
            <form action={reviewWebsiteGrowthBacklinkAction}>
              <input type="hidden" name="backlinkId" value={opportunity.id} />
              <input type="hidden" name="decision" value={WebsiteGrowthBacklinkStatus.REJECTED} />
              <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">Decline</button>
            </form>
            <form action={reviewWebsiteGrowthBacklinkAction}>
              <input type="hidden" name="backlinkId" value={opportunity.id} />
              <input type="hidden" name="decision" value={WebsiteGrowthBacklinkStatus.APPROVED} />
              <button className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">Approve</button>
            </form>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline">{label}</a>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-semibold uppercase tracking-wide">{label}</dt><dd className="mt-1 break-all text-foreground">{value}</dd></div>;
}

function groupBacklinks(opportunities: Awaited<ReturnType<typeof getWebsiteGrowthBacklinkWorkspace>>["opportunities"]) {
  const groups = {
    REVIEW: [] as typeof opportunities,
    ACTIVE: [] as typeof opportunities,
    LIVE: [] as typeof opportunities,
    CLOSED: [] as typeof opportunities
  };
  for (const opportunity of opportunities) {
    if (opportunity.status === WebsiteGrowthBacklinkStatus.NEEDS_REVIEW) groups.REVIEW.push(opportunity);
    else if (opportunity.status === WebsiteGrowthBacklinkStatus.LIVE) groups.LIVE.push(opportunity);
    else if (opportunity.status === WebsiteGrowthBacklinkStatus.LOST || opportunity.status === WebsiteGrowthBacklinkStatus.BLOCKED) groups.CLOSED.push(opportunity);
    else groups.ACTIVE.push(opportunity);
  }
  return groups;
}

function statusClassName(status: WebsiteGrowthBacklinkStatus) {
  if (status === WebsiteGrowthBacklinkStatus.LIVE) return "rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success";
  if (status === WebsiteGrowthBacklinkStatus.REPLIED) return "rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success";
  if (status === WebsiteGrowthBacklinkStatus.BLOCKED || status === WebsiteGrowthBacklinkStatus.LOST) return "rounded-full border border-danger/25 bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger";
  if (status === WebsiteGrowthBacklinkStatus.APPROVED || status === WebsiteGrowthBacklinkStatus.IN_PROGRESS) return "rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning";
  return "rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-mutedForeground";
}

function formatLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeZone: "America/Toronto"
  }).format(value);
}
