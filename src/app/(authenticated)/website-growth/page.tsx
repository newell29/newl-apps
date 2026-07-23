import {
  JobStatus,
  ModuleKey,
  WebsiteGrowthContentDraftStatus
} from "@prisma/client";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { getWebsiteGrowthWorkspace } from "@/modules/website-growth/queries";
import {
  getWebsiteGrowthChangeType,
  getWebsiteGrowthPrimaryChange,
  getWebsiteGrowthRoute,
  getWebsiteGrowthWorkflowStage,
  readScoutRunId,
  readScoutRunSummary,
  type WebsiteGrowthWorkflowStage
} from "@/modules/website-growth/workspace";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function WebsiteGrowthPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  const workspace = await getWebsiteGrowthWorkspace(context);
  const latestRun = workspace.latestScoutRun;
  const latestRunSummary = readScoutRunSummary(latestRun?.output);
  const latestDraftIds = new Set(latestRunSummary.draftIds);
  const groups = groupDrafts(workspace.drafts);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website Growth"
        title="Scout ideas and page builds"
        description="Review the small set of ideas Scout has selected, approve exact page briefs, and follow each build through to its website preview."
      />

      <WorkspaceNavigation signalCount={workspace.signalCount} />

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Needs your review"
          value={groups.NEEDS_REVIEW.length}
          caption="Scout briefs awaiting a decision"
        />
        <MetricCard
          label="Approved / building"
          value={groups.BUILDING.length}
          caption="With the website developer"
        />
        <MetricCard
          label="Preview ready"
          value={groups.PREVIEW_READY.length}
          caption="Ready for your visual review"
        />
        <MetricCard
          label="Completed / closed"
          value={groups.COMPLETED.length}
          caption="Published or declined ideas"
        />
      </section>

      <LatestScoutRun
        run={latestRun}
        draftCount={latestRunSummary.draftIds.length}
        semrushRowCount={latestRunSummary.semrushRowCount}
        phase={latestRunSummary.phase}
      />

      <WorkflowGuide />

      {workspace.drafts.length === 0 ? (
        <section className="rounded-lg border border-dashed border-border bg-card p-8 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Scout workspace</p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">No Scout ideas have been prepared yet.</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-mutedForeground">
            Raw analytics are safely stored under Research signals. When Scout completes a run, only its curated briefs will appear here.
          </p>
          <Link
            href="/website-growth/signals"
            className="mt-5 inline-flex rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            View research signals
          </Link>
        </section>
      ) : (
        <>
          <IdeaSection
            title="Needs your review"
            description="These are the new ideas Scout recommends. Open a brief to review the exact page, copy, layout, claims, and proposed change before approving it."
            emptyMessage="Nothing is waiting for your approval."
            drafts={groups.NEEDS_REVIEW}
            latestDraftIds={latestDraftIds}
            stage="NEEDS_REVIEW"
          />
          <IdeaSection
            title="Approved and building"
            description="You approved these briefs. Codex is creating or updating the website page and preparing a draft pull request."
            emptyMessage="No approved ideas are currently being built."
            drafts={groups.BUILDING}
            latestDraftIds={latestDraftIds}
            stage="BUILDING"
          />
          <IdeaSection
            title="Preview ready"
            description="Open the website preview, review the page visually, then make the final merge decision in GitHub."
            emptyMessage="No website previews are waiting for review."
            drafts={groups.PREVIEW_READY}
            latestDraftIds={latestDraftIds}
            stage="PREVIEW_READY"
          />
          <IdeaSection
            title="Completed and closed"
            description="A short history of ideas that were published or declined. Research signals remain available separately."
            emptyMessage="No completed ideas yet."
            drafts={groups.COMPLETED.slice(0, 12)}
            latestDraftIds={latestDraftIds}
            stage="COMPLETED"
            compact
          />
        </>
      )}
    </div>
  );
}

function WorkspaceNavigation({ signalCount }: { signalCount: number }) {
  return (
    <nav className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm" aria-label="Website Growth views">
      <Link
        href="/website-growth"
        aria-current="page"
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground"
      >
        Scout workspace
      </Link>
      <Link
        href="/website-growth/signals"
        className="rounded-md px-4 py-2 text-sm font-semibold text-mutedForeground transition-colors hover:bg-muted hover:text-foreground"
      >
        Research signals
        <span className="ml-2 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
          {signalCount.toLocaleString("en-US")}
        </span>
      </Link>
      <p className="ml-auto hidden px-3 text-xs text-mutedForeground lg:block">
        Scout ideas are curated work. Research signals are supporting evidence.
      </p>
    </nav>
  );
}

function LatestScoutRun({
  run,
  draftCount,
  semrushRowCount,
  phase
}: {
  run: Awaited<ReturnType<typeof getWebsiteGrowthWorkspace>>["latestScoutRun"];
  draftCount: number;
  semrushRowCount: number;
  phase: string | null;
}) {
  if (!run) {
    return (
      <section className="rounded-lg border border-warning/25 bg-warning/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-warning">Scout has not run yet</p>
        <p className="mt-2 text-sm leading-6 text-foreground">
          The first scheduled run will create this summary even when it finds no suitable opportunities.
        </p>
      </section>
    );
  }

  const succeeded = run.status === JobStatus.SUCCESS;
  const isEmpty = phase === "NO_CANDIDATES" || (succeeded && draftCount === 0);

  return (
    <section className={succeeded ? "rounded-lg border border-success/25 bg-success/10 p-5" : run.status === JobStatus.ERROR ? "rounded-lg border border-danger/25 bg-danger/10 p-5" : "rounded-lg border border-warning/25 bg-warning/10 p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Latest Scout run</p>
          <h2 className="mt-2 text-xl font-semibold text-foreground">
            {isEmpty
              ? "Scout reviewed the data and found no new ideas."
              : succeeded
                ? `${draftCount} ${draftCount === 1 ? "idea is" : "ideas are"} ready from the latest run.`
                : run.status === JobStatus.ERROR
                  ? "Scout could not complete the latest run."
                  : "Scout is reviewing the latest evidence."}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">
            Search Console, GA4, website form submissions, and Semrush are evidence sources. Only the ideas selected by Scout appear in this workspace.
          </p>
          {run.errorMessage ? (
            <p className="mt-3 text-sm font-medium text-danger">{run.errorMessage}</p>
          ) : null}
        </div>
        <div className="text-right">
          <span className="inline-flex rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground">
            {formatStatus(run.status)}
          </span>
          <p className="mt-2 text-xs text-mutedForeground">{formatDateTime(run.finishedAt ?? run.startedAt)}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-mutedForeground">
        <span className="rounded-full border border-border bg-background px-3 py-1">GSC checked</span>
        <span className="rounded-full border border-border bg-background px-3 py-1">GA4 checked</span>
        <span className="rounded-full border border-border bg-background px-3 py-1">Forms checked</span>
        <span className="rounded-full border border-border bg-background px-3 py-1">
          Semrush evidence: {semrushRowCount.toLocaleString("en-US")} rows
        </span>
      </div>
    </section>
  );
}

function WorkflowGuide() {
  const steps = [
    ["1", "Scout selects ideas", "Codex reviews the evidence and removes weak or duplicate opportunities."],
    ["2", "You review the brief", "Confirm the exact existing page or new route, proposed copy, layout, and claims."],
    ["3", "Codex builds a preview", "Approval starts an isolated website branch and draft pull request."],
    ["4", "You make the merge decision", "Review the Vercel website preview. Nothing goes live until you merge."]
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">How work moves</p>
        <h2 className="mt-2 text-base font-semibold text-foreground">Four clear stages from evidence to website.</h2>
      </div>
      <ol className="mt-4 grid gap-3 lg:grid-cols-4">
        {steps.map(([number, title, description]) => (
          <li key={number} className="rounded-md border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primaryForeground">
                {number}
              </span>
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-mutedForeground">{description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function IdeaSection({
  title,
  description,
  emptyMessage,
  drafts,
  latestDraftIds,
  stage,
  compact = false
}: {
  title: string;
  description: string;
  emptyMessage: string;
  drafts: Awaited<ReturnType<typeof getWebsiteGrowthWorkspace>>["drafts"];
  latestDraftIds: Set<string>;
  stage: WebsiteGrowthWorkflowStage;
  compact?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">{description}</p>
        </div>
        <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-semibold text-mutedForeground">
          {drafts.length}
        </span>
      </div>
      {drafts.length === 0 ? (
        <p className="p-5 text-sm text-mutedForeground">{emptyMessage}</p>
      ) : (
        <div className={compact ? "grid gap-3 p-5 xl:grid-cols-3" : "grid gap-4 p-5 xl:grid-cols-2"}>
          {drafts.map((draft) => (
            <ScoutIdeaCard
              key={draft.id}
              draft={draft}
              stage={stage}
              isLatest={latestDraftIds.has(draft.id)}
              compact={compact}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ScoutIdeaCard({
  draft,
  stage,
  isLatest,
  compact
}: {
  draft: Awaited<ReturnType<typeof getWebsiteGrowthWorkspace>>["drafts"][number];
  stage: WebsiteGrowthWorkflowStage;
  isLatest: boolean;
  compact: boolean;
}) {
  const changeType = getWebsiteGrowthChangeType(draft.opportunity.action);
  const route = getWebsiteGrowthRoute(draft);
  const primaryChange = getWebsiteGrowthPrimaryChange(draft);
  const scoutRunId = readScoutRunId(draft.draftJson);

  return (
    <article className="flex h-full flex-col rounded-lg border border-border bg-background p-5">
      <div className="flex flex-wrap items-center gap-2">
        {isLatest ? (
          <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
            New from latest Scout run
          </span>
        ) : null}
        <span className={stageBadgeClassName(stage)}>{stageLabel(stage, draft.status)}</span>
      </div>

      <div className={changeType.label === "New page" ? "mt-4 rounded-md border border-accentBorder bg-accentSoft p-3" : "mt-4 rounded-md border border-warning/25 bg-warning/10 p-3"}>
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{changeType.label}</p>
        <p className="mt-1 break-all font-mono text-sm font-semibold text-foreground">{route}</p>
        <p className="mt-1 text-xs leading-5 text-mutedForeground">{changeType.description}</p>
      </div>

      <h3 className="mt-4 text-lg font-semibold text-foreground">{draft.title}</h3>
      <p className="mt-2 text-sm leading-6 text-mutedForeground">{draft.summary}</p>

      {!compact ? (
        <div className="mt-4 rounded-md border border-border bg-muted/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Primary proposed change</p>
          <p className="mt-2 text-sm leading-6 text-foreground">{primaryChange}</p>
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-5">
        <div className="text-xs leading-5 text-mutedForeground">
          <p>Updated {formatDateTime(draft.updatedAt)}</p>
          {scoutRunId ? <p>Scout run {scoutRunId.slice(-8)}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {draft.builtUrl ? (
            <a
              href={draft.builtUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover"
            >
              Open website preview
            </a>
          ) : null}
          {draft.pullRequestUrl ? (
            <a
              href={draft.pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Open PR
            </a>
          ) : null}
          <Link
            href={`/website-growth/drafts/${draft.id}`}
            className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            {stage === "NEEDS_REVIEW" ? "Review brief" : "View details"}
          </Link>
        </div>
      </div>
    </article>
  );
}

function groupDrafts(
  drafts: Awaited<ReturnType<typeof getWebsiteGrowthWorkspace>>["drafts"]
) {
  const groups: Record<
    WebsiteGrowthWorkflowStage,
    Awaited<ReturnType<typeof getWebsiteGrowthWorkspace>>["drafts"]
  > = {
    NEEDS_REVIEW: [],
    BUILDING: [],
    PREVIEW_READY: [],
    COMPLETED: []
  };

  for (const draft of drafts) {
    groups[getWebsiteGrowthWorkflowStage(draft)].push(draft);
  }

  return groups;
}

function stageLabel(
  stage: WebsiteGrowthWorkflowStage,
  draftStatus: WebsiteGrowthContentDraftStatus
) {
  if (stage === "NEEDS_REVIEW") {
    return "Needs review";
  }

  if (stage === "BUILDING") {
    return "Approved · building";
  }

  if (stage === "PREVIEW_READY") {
    return "Preview ready";
  }

  return draftStatus === WebsiteGrowthContentDraftStatus.REJECTED
    ? "Declined"
    : "Completed";
}

function stageBadgeClassName(stage: WebsiteGrowthWorkflowStage) {
  if (stage === "PREVIEW_READY") {
    return "rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success";
  }

  if (stage === "BUILDING") {
    return "rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning";
  }

  return "rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-mutedForeground";
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
