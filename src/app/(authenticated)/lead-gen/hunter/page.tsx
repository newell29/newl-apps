import { ModuleKey } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  getHunterControlTower,
  type HunterTowerTone
} from "@/modules/lead-gen/hunter-control-tower";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const tierOrder = [
  "HOT_OPPORTUNITY",
  "QUALIFIED_CURRENT_ACCOUNT",
  "WATCHLIST",
  "BLOCKED"
] as const;

export default async function HunterControlTowerPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const data = await getHunterControlTower(context);
  const researched = data.latestResearchSignals.filter((signal) =>
    Boolean(researchRecord(signal.evidence))
  );
  const carryForward = data.carryForwardResearchSignals.filter((signal) =>
    Boolean(researchRecord(signal.evidence))
  );
  const byTier = Object.fromEntries(
    tierOrder.map((tier) => [tier, researched.filter((signal) => researchTier(signal.evidence) === tier)])
  ) as Record<(typeof tierOrder)[number], typeof researched>;
  const carryForwardByTier = Object.fromEntries(
    tierOrder.map((tier) => [
      tier,
      carryForward.filter((signal) => researchTier(signal.evidence) === tier)
    ])
  ) as Record<(typeof tierOrder)[number], typeof carryForward>;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Hunter Control Tower"
        description="One operational view of today’s lead flow—from TradeMining and external discovery through research, outreach preparation, Apollo, replies, and meetings."
      />

      <section className="rounded-lg border border-accentBorder bg-accentSoft p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-foreground">Today’s operating picture</p>
            <p className="mt-1 max-w-3xl text-sm text-mutedForeground">
              Hunter runs the pipeline automatically. Use the attention links only when an Apollo identity,
              failed plan, delivery problem, or configuration issue genuinely needs you.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-semibold">
            <Link href="/lead-gen/outreach" className="rounded-md bg-primary px-3 py-2 text-primaryForeground">Review outreach</Link>
            <Link href="/lead-gen/apollo-review" className="rounded-md border border-border bg-card px-3 py-2">Apollo exceptions</Link>
            <Link href="/lead-gen/automation-settings" className="rounded-md border border-border bg-card px-3 py-2">Automation settings</Link>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">Pipeline stages</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              Current local-day state in {data.timeZone}. Green is complete, blue is running, amber needs attention.
            </p>
          </div>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold">
            {data.policy.killSwitch ? "Stopped" : formatEnum(data.policy.mode)}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StageCard
            label="1. TradeMining"
            tone={data.stages.tradeMining.tone}
            value={`${data.stages.tradeMining.completedProfiles}/${data.stages.tradeMining.enabledProfiles} profiles`}
            detail={`${data.stages.tradeMining.qualifyingCompanies} qualifying companies · ${data.stages.tradeMining.exports} exported records`}
            href="/lead-gen/search-profiles"
          />
          <StageCard
            label="2. External scout"
            tone={data.stages.scout.tone}
            value={data.stages.scout.status ? formatEnum(data.stages.scout.status) : "Waiting"}
            detail={`${data.stages.scout.promotedCompanies} companies promoted from ${data.stages.scout.selectedArticles} new results`}
            href="/operations/logs"
          />
          <StageCard
            label="3. Company research"
            tone={data.stages.research.tone}
            value={data.stages.research.status ? formatEnum(data.stages.research.status) : "Waiting"}
            detail={`${data.stages.research.researchedCompanies}/${data.stages.research.selectedCompanies} researched · ${data.stages.research.qualifiedCompanies} qualified`}
            href="/operations/logs"
          />
          <StageCard
            label="4. Outreach prep"
            tone={data.stages.outreach.tone}
            value={data.stages.outreach.status ? formatEnum(data.stages.outreach.status) : "Waiting"}
            detail={`${data.stages.outreach.actionablePlans} plans ready · ${data.stages.outreach.qaFailedPlans} failed QA`}
            href="/lead-gen/outreach"
          />
          <StageCard
            label="5. Apollo sync"
            tone={data.stages.apollo.tone}
            value={data.stages.apollo.lastSuccessfulSyncAt ? "Connected" : "Waiting"}
            detail={`${data.stages.apollo.reviewCounts.needsReview + data.stages.apollo.reviewCounts.mappedNoEmployees} exceptions · ${data.stages.apollo.failedSyncContacts} sync failures`}
            href="/lead-gen/apollo-review"
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="font-semibold text-foreground">Today’s production</h2>
        <p className="mt-1 text-sm text-mutedForeground">
          Only work tied to the current local day is shown here. Contacts and plans remain zero until today’s outreach handoff runs.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-8">
          <FunnelMetric label="Source matches" value={data.funnel.sourceCompanies} />
          <FunnelMetric label="Selected" value={data.funnel.selectedCompanies} />
          <FunnelMetric label="New" value={data.funnel.newCompanies} />
          <FunnelMetric label="Refreshes" value={data.funnel.refreshCompanies} />
          <FunnelMetric label="Researched" value={data.funnel.researchedCompanies} />
          <FunnelMetric label="Qualified" value={data.funnel.qualifiedCompanies} />
          <FunnelMetric label="Contacts found" value={data.funnel.contactsFound} />
          <FunnelMetric label="Plans ready" value={data.funnel.plansReady} />
        </div>
        <p className="mt-3 text-xs text-mutedForeground">
          Cohort controls suppressed {data.funnel.suppressedRepeats} companies researched in the prior 90 days and {data.funnel.suppressedActiveOutreach} companies already in active outreach.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="font-semibold text-foreground">Current workflow</h2>
        <p className="mt-1 text-sm text-mutedForeground">
          Live inventory across all run dates. These are current states, not claims about what Hunter produced today.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <FunnelMetric label="Needs attention" value={data.workflow.needsAttention} attention={data.workflow.needsAttention > 0} />
          <FunnelMetric label="Active cadences" value={data.workflow.activeCadences} />
          <FunnelMetric label="Delivery failures" value={data.workflow.deliveryFailures} attention={data.workflow.deliveryFailures > 0} />
          <FunnelMetric label="Engaged" value={data.workflow.engagedContacts} />
          <FunnelMetric label="Meetings" value={data.workflow.meetingContacts} />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <AttentionCard
          label="Outreach requiring review"
          value={data.workflow.needsAttention}
          detail={`${data.stages.outreach.qaFailedPlans} plans failed QA`}
          href="/lead-gen/outreach"
        />
        <AttentionCard
          label="Apollo identity exceptions"
          value={data.stages.apollo.reviewCounts.needsReview + data.stages.apollo.reviewCounts.mappedNoEmployees}
          detail={data.identityMetrics.autoMatchRate === null ? "Auto-match baseline pending" : `${data.identityMetrics.autoMatchRate}% auto-match rate (7d)`}
          href="/lead-gen/apollo-review"
        />
        <AttentionCard
          label="Delivery failures"
          value={data.workflow.deliveryFailures}
          detail={`${data.stages.apollo.failedSyncContacts} Apollo records need sync attention`}
          href="/lead-gen/outreach?view=delivery-failures"
        />
      </section>

      {data.stages.research.recovery.recoveryOfRunId || data.stages.research.recovery.retryScheduled ? (
        <section className="rounded-lg border border-accentBorder bg-accentSoft p-4">
          <h2 className="font-semibold text-foreground">Company-research recovery</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            {data.stages.research.recovery.recovered
              ? `Recovered successfully on attempt ${data.stages.research.recovery.attempt} using the preserved ${formatCheckpoint(data.stages.research.recovery.checkpointStage)} checkpoint.`
              : data.stages.research.recovery.retryScheduled
                ? `A bounded retry is scheduled from the preserved ${formatCheckpoint(data.stages.research.recovery.checkpointStage)} checkpoint.`
                : `Recovery attempt ${data.stages.research.recovery.attempt} is being tracked for this exact company cohort.`}
          </p>
        </section>
      ) : null}

      <details className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <summary className="cursor-pointer font-semibold text-foreground">
          Researched opportunity details ({researched.length} today · {carryForward.length} carry-forward)
        </summary>
        <p className="mt-2 text-sm text-mutedForeground">
          This replaces the old Daily Opportunities page as the primary view while preserving its evidence-rich
          research cards for audit and deeper review.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <TierMetric label="Hot opportunity" value={byTier.HOT_OPPORTUNITY.length} tone="hot" />
          <TierMetric label="Qualified current account" value={byTier.QUALIFIED_CURRENT_ACCOUNT.length} tone="qualified" />
          <TierMetric label="Watchlist" value={byTier.WATCHLIST.length} tone="watch" />
          <TierMetric label="Blocked" value={byTier.BLOCKED.length} tone="blocked" />
        </div>
        <div className="mt-5 space-y-4">
          <OpportunityGroup
            title="Hot opportunities"
            description="Verified recent demand events with strong service fit."
            signals={byTier.HOT_OPPORTUNITY}
            empty="No Hot opportunity cleared the evidence and validation gates today."
          />
          <OpportunityGroup
            title="Qualified current accounts"
            description="Strong Newl fit without a verified time-sensitive trigger."
            signals={byTier.QUALIFIED_CURRENT_ACCOUNT}
            empty="No Qualified current accounts are available today."
          />
          <OpportunityGroup
            title="Watchlist"
            description="Useful companies with weaker timing, accessibility, or evidence."
            signals={byTier.WATCHLIST}
            empty="No Watchlist companies are available."
            collapsed
          />
          <OpportunityGroup
            title="Carry-forward outreach"
            description="Still-current Hot and Qualified accounts from earlier runs."
            signals={[...carryForwardByTier.HOT_OPPORTUNITY, ...carryForwardByTier.QUALIFIED_CURRENT_ACCOUNT]}
            empty="No current carry-forward opportunities."
            collapsed
          />
          <OpportunityGroup
            title="Blocked audit"
            description="Rejected research remains available for quality review but not normal daily sales work."
            signals={byTier.BLOCKED}
            empty="No blocked researched companies."
            collapsed
          />
        </div>
      </details>
    </div>
  );
}

function StageCard({
  label,
  tone,
  value,
  detail,
  href
}: {
  label: string;
  tone: HunterTowerTone;
  value: string;
  detail: string;
  href: string;
}) {
  const styles: Record<HunterTowerTone, string> = {
    healthy: "border-success/30 bg-success/10",
    running: "border-primary/30 bg-accentSoft",
    attention: "border-warning/40 bg-warning/10",
    waiting: "border-border bg-muted/30"
  };
  return (
    <Link href={href} className={`rounded-md border p-3 transition hover:border-primary ${styles[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-mutedForeground">{detail}</p>
    </Link>
  );
}

function FunnelMetric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${attention ? "border-warning/40 bg-warning/10" : "border-border bg-muted/30"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function AttentionCard({ label, value, detail, href }: { label: string; value: number; detail: string; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-border bg-card p-4 shadow-sm transition hover:border-primary">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{label}</p>
          <p className="mt-1 text-sm text-mutedForeground">{detail}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${value > 0 ? "bg-warning/15 text-foreground" : "bg-success/10 text-foreground"}`}>
          {value}
        </span>
      </div>
    </Link>
  );
}

function formatCheckpoint(value: string | null) {
  if (value === "SYNTHESIS_COMPLETE") return "retrieval + synthesis";
  if (value === "RETRIEVAL_COMPLETE") return "paid retrieval";
  return "available";
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
