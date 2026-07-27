import { ModuleKey } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getHunterControlPlane } from "@/modules/lead-gen/hunter-queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const tierOrder = [
  "HOT_OPPORTUNITY",
  "QUALIFIED_CURRENT_ACCOUNT",
  "WATCHLIST",
  "BLOCKED"
] as const;

export default async function DailyOpportunitiesPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const data = await getHunterControlPlane(context);
  const researched = data.signals.filter((signal) => Boolean(researchRecord(signal.evidence)));
  const byTier = Object.fromEntries(
    tierOrder.map((tier) => [tier, researched.filter((signal) => researchTier(signal.evidence) === tier)])
  ) as Record<(typeof tierOrder)[number], typeof researched>;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Daily Opportunities"
        description="Hunter's small, researched shortlist: who is worth pursuing now, why they may talk to Newl, and which evidence supports the recommendation."
      />

      <section className="rounded-lg border border-accentBorder bg-accentSoft p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-foreground">Daily workflow</p>
            <p className="mt-1 max-w-3xl text-sm text-mutedForeground">
              Review Hot and Qualified opportunities here. Approved contacts move to Outreach Queue; a meaningful
              reply or meeting moves the account to Sales Opportunities.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-semibold">
            <Link href="/lead-gen/outreach" className="rounded-md bg-primary px-3 py-2 text-primaryForeground">Outreach Queue</Link>
            <Link href="/lead-gen/automation-settings" className="rounded-md border border-border bg-card px-3 py-2">Automation settings</Link>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TierMetric label="Hot opportunity" value={byTier.HOT_OPPORTUNITY.length} tone="hot" />
        <TierMetric label="Qualified current account" value={byTier.QUALIFIED_CURRENT_ACCOUNT.length} tone="qualified" />
        <TierMetric label="Watchlist" value={byTier.WATCHLIST.length} tone="watch" />
        <TierMetric label="Blocked" value={byTier.BLOCKED.length} tone="blocked" />
      </div>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">Automation status</h2>
            <p className="mt-1 text-sm text-mutedForeground">A compact health check for today&apos;s research, without exposing the full audit ledger.</p>
          </div>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold">
            {data.policy.killSwitch ? "Stopped" : formatEnum(data.policy.mode)}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <RunStatus
            label="Signal scout"
            status={data.latestSignalScoutRun?.status ?? "Not run"}
            date={data.latestSignalScoutRun?.startedAt}
          />
          <RunStatus
            label="Company research"
            status={data.latestCompanyResearchRun?.status ?? "Not run"}
            date={data.latestCompanyResearchRun?.startedAt}
          />
          <RunStatus
            label="Prospecting plan"
            status={data.latestRun?.status ?? "Not run"}
            date={data.latestRun?.startedAt}
          />
        </div>
      </section>

      <OpportunityGroup
        title="Hot opportunities"
        description="Verified recent demand events with strong service fit. These deserve the first human review."
        signals={byTier.HOT_OPPORTUNITY}
        empty="No Hot opportunity cleared the evidence and validation gates in the latest research."
      />
      <OpportunityGroup
        title="Qualified current accounts"
        description="Strong Newl fit without a verified time-sensitive trigger. Good candidates for deliberate outbound."
        signals={byTier.QUALIFIED_CURRENT_ACCOUNT}
        empty="No Qualified current accounts are available."
      />
      <OpportunityGroup
        title="Watchlist"
        description="Useful companies with weaker timing, accessibility, or evidence. Hunter keeps them visible without crowding active outreach."
        signals={byTier.WATCHLIST}
        empty="No Watchlist companies are available."
        collapsed
      />

      <details className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <summary className="cursor-pointer font-semibold text-foreground">
          Blocked and source-candidate audit ({byTier.BLOCKED.length} blocked · {data.latestRun?.hunterProspectingDecisions.length ?? 0} planned)
        </summary>
        <p className="mt-2 text-sm text-mutedForeground">
          This audit area is intentionally collapsed. It contains rejected research and the raw source plan used to
          create the shortlist; neither belongs in normal daily sales work.
        </p>
        <div className="mt-4 grid gap-3">
          {byTier.BLOCKED.map((signal) => <OpportunityCard key={signal.id} signal={signal} />)}
          {byTier.BLOCKED.length === 0 ? <p className="text-sm text-mutedForeground">No blocked researched companies.</p> : null}
        </div>
      </details>
    </div>
  );
}

function OpportunityGroup({
  title,
  description,
  signals,
  empty,
  collapsed = false
}: {
  title: string;
  description: string;
  signals: Array<{
    id: string;
    companyName: string;
    title: string;
    summary: string;
    confidence: number;
    serviceLine: string;
    signalType: string;
    geography: string | null;
    sourceUrl: string | null;
    observedAt: Date;
    evidence: unknown;
  }>;
  empty: string;
  collapsed?: boolean;
}) {
  const content = (
    <div className="mt-4 grid gap-3">
      {signals.map((signal) => <OpportunityCard key={signal.id} signal={signal} />)}
      {signals.length === 0 ? <p className="text-sm text-mutedForeground">{empty}</p> : null}
    </div>
  );

  if (collapsed) {
    return (
      <details className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <summary className="cursor-pointer font-semibold text-foreground">{title} ({signals.length})</summary>
        <p className="mt-2 text-sm text-mutedForeground">{description}</p>
        {content}
      </details>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="font-semibold text-foreground">{title} ({signals.length})</h2>
        <p className="mt-1 text-sm text-mutedForeground">{description}</p>
      </div>
      {content}
    </section>
  );
}

function OpportunityCard({
  signal
}: {
  signal: {
    companyName: string;
    title: string;
    summary: string;
    confidence: number;
    serviceLine: string;
    signalType: string;
    geography: string | null;
    sourceUrl: string | null;
    observedAt: Date;
    evidence: unknown;
  };
}) {
  const research = researchRecord(signal.evidence);
  const reasons = stringArray(research?.tierReasons);
  const scoring = objectRecord(research?.scoring);
  const evidence = Array.isArray(research?.evidence)
    ? research.evidence.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];

  return (
    <article className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{signal.companyName}</h3>
          <p className="mt-1 font-medium text-foreground">{signal.title}</p>
        </div>
        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold">
          {typeof research?.finalScore === "number" ? `${research.finalScore} score · ` : ""}
          {formatEnum(signal.serviceLine)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-mutedForeground">
        {typeof scoring?.rationale === "string" ? scoring.rationale : signal.summary}
      </p>
      {reasons.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mutedForeground">
          {reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-mutedForeground">
        <span>{signal.confidence}% signal confidence</span>
        <span>· {formatEnum(signal.signalType)}</span>
        {signal.geography ? <span>· {signal.geography}</span> : null}
        <span>· observed {signal.observedAt.toLocaleDateString("en-US")}</span>
      </div>
      <details className="mt-3 rounded-md border border-border bg-card p-3">
        <summary className="cursor-pointer text-xs font-semibold text-primary">Evidence used ({evidence.length})</summary>
        <div className="mt-3 grid gap-2">
          {evidence.map((item, index) => {
            const url = typeof item.url === "string" && item.url.startsWith("https://") ? item.url : null;
            return (
              <div key={`${url ?? "evidence"}-${index}`} className="rounded-md border border-border p-3 text-xs">
                <p className="font-semibold text-foreground">
                  {url ? <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">{String(item.title ?? url)}</a> : String(item.title ?? "Evidence")}
                </p>
                {typeof item.excerpt === "string" ? <p className="mt-1 leading-5 text-mutedForeground">{item.excerpt}</p> : null}
              </div>
            );
          })}
          {evidence.length === 0 && signal.sourceUrl ? (
            <a href={signal.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline">Open source</a>
          ) : null}
        </div>
      </details>
    </article>
  );
}

function TierMetric({ label, value, tone }: { label: string; value: number; tone: "hot" | "qualified" | "watch" | "blocked" }) {
  const styles = {
    hot: "border-success/30 bg-success/10",
    qualified: "border-accentBorder bg-accentSoft",
    watch: "border-warning/30 bg-warning/10",
    blocked: "border-border bg-muted"
  };
  return <div className={`rounded-lg border p-4 ${styles[tone]}`}><p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p><p className="mt-2 text-2xl font-semibold text-foreground">{value}</p></div>;
}

function RunStatus({ label, status, date }: { label: string; status: string; date?: Date }) {
  return <div className="rounded-md border border-border bg-muted/30 p-3"><p className="text-xs uppercase tracking-wide text-mutedForeground">{label}</p><p className="mt-1 font-semibold text-foreground">{formatEnum(status)}</p><p className="mt-1 text-xs text-mutedForeground">{date ? date.toLocaleString("en-US") : "Waiting for first run"}</p></div>;
}

function researchRecord(value: unknown): Record<string, unknown> | null {
  const record = objectRecord(value);
  if (!record) return null;
  return objectRecord(record.research) ?? (typeof record.opportunityTier === "string" ? record : null);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function researchTier(value: unknown) {
  const research = researchRecord(value);
  return typeof research?.opportunityTier === "string" ? research.opportunityTier : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatEnum(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
