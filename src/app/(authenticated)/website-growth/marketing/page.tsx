import { ModuleKey, PlatformRole } from "@prisma/client";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { requireModule, resolveRoleCanMutate } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { scoutWorkspace } from "@/modules/website-growth/scout/store";
import { proposeScoutPageAction, refreshScoutWorkAction, saveScoutMissionAction, sendScoutReplyAction } from "@/modules/website-growth/scout/actions";
import { isDue, record, type Work } from "@/modules/website-growth/scout/model";
import { ScoutReviewForm } from "@/modules/website-growth/scout/review-form";
import { prisma } from "@/server/db";
import { needsOwner } from "@/modules/website-growth/scout/lifecycle";
import { scoutCompetitorEvidence } from "@/modules/website-growth/scout/learning";
import { WorkboardRefresh } from "@/modules/website-growth/scout/workboard-refresh";
import { projectScoutWorkboard } from "@/modules/website-growth/scout/workboard-model";

export const dynamic = "force-dynamic";
const field = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const button = "rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted";
const kindLabels = { PAGE: "Page improvement", RELATIONSHIP: "Publisher conversation", MEASUREMENT: "Outcome review", RESEARCH: "New research" };

export default async function ScoutWorkPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  const workspace = await scoutWorkspace(context.tenantId);
  const recipients = await prisma.websiteGrowthBacklinkOpportunity.findMany({ where: { tenantId: context.tenantId,
    id: { in: workspace.items.filter(item => item.kind === "RELATIONSHIP").map(item => item.referenceId ?? "") } }, select: { id: true, recipientEmail: true } });
  const items = workspace.items.map(item => ({ ...item, recipientEmail: typeof item.evidence.replyRecipient === "string" ? item.evidence.replyRecipient : recipients.find(row => row.id === item.referenceId)?.recipientEmail ?? null }));
  const canReview = ([PlatformRole.ADMIN, PlatformRole.MANAGER] as PlatformRole[]).includes(context.role) && await resolveRoleCanMutate(context.tenantId, context.role);
  const competitors = await scoutCompetitorEvidence(context.tenantId);
  const outcomes = items.filter(item => item.kind === "MEASUREMENT" && item.evidence.measurement);
  const board = projectScoutWorkboard(items, workspace.mission, workspace.capacity);
  const candidates = board.due;
  const groups = new Map<string, typeof candidates>();
  for (const item of candidates) { const key = item.route ?? item.kind; groups.set(key, [...(groups.get(key) ?? []), item]); }
  const capacity = workspace.capacity;
  return <div className="space-y-6">
    <WorkboardRefresh />
    <PageHeader eyebrow="Website Growth" title="Scout marketing workboard" description="Set the direction, review finished work, and follow what Scout learns from the results." />
    <nav className="flex flex-wrap gap-3 text-sm font-semibold"><Link href="/website-growth">Effectiveness review</Link><Link href="/website-growth/pages">Page briefs and previews</Link><Link href="/website-growth/paid-campaigns">Paid campaigns</Link><Link href="/website-growth/backlinks">Publisher opportunities</Link><Link href="/website-growth/signals">Research signals</Link></nav>
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Marketing direction</h2><span className="rounded-full bg-muted px-3 py-1 text-sm">{workspace.mission.enabled ? "Research enabled" : "Research paused"}</span></div>
      <p className="mt-2 text-mutedForeground">{workspace.mission.objective}</p>
      {!workspace.configured && <p className="mt-3 text-sm text-mutedForeground">Confirm the priorities and enquiry definition below before enabling Scout. Sending and publishing keep their existing approval steps.</p>}
      {canReview && <details className="mt-4" open={!workspace.configured}><summary className="cursor-pointer text-sm font-semibold">Edit priorities and research budget</summary>
        <form action={saveScoutMissionAction} className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2">Objective<textarea name="objective" defaultValue={workspace.mission.objective} required maxLength={1500} className={field} /></label>
          <label>Priority services, markets, and audiences<textarea name="priorities" defaultValue={workspace.mission.priorities} required maxLength={2500} rows={3} className={field} /></label>
          <label>What counts as a qualified enquiry<textarea name="qualifiedLead" defaultValue={workspace.mission.qualifiedLead} required maxLength={1500} rows={3} className={field} /></label>
          <label>Research steps per rolling day<input name="dailySteps" type="number" min={1} max={20} defaultValue={workspace.mission.dailySteps} required className={field} /></label>
          <label>Maximum items being worked or awaiting review<input name="maxActive" type="number" min={1} max={10} defaultValue={workspace.mission.maxActive} required className={field} /></label>
          <label className="flex items-center gap-2"><input name="enabled" type="checkbox" defaultChecked={workspace.mission.enabled} />Enable research and draft preparation</label>
          <div><button className={button}>Save direction</button></div>
        </form>
      </details>}
    </section>
    <section className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">What happens when Scout wakes</h2><p className="mt-1 text-sm text-mutedForeground">The worker schedule is managed separately from Newl Apps. This board determines what is due; the status below shows whether Scout can run it now.</p></div>
        {canReview && <form action={refreshScoutWorkAction}><button className={button}>Check for due work</button></form>}
      </div>
      <ol className="grid gap-3 text-sm md:grid-cols-3"><li><strong>1. Reconcile sources.</strong><br />Read saved opportunities, publisher replies, published pages, and reusable research reviews.</li><li><strong>2. Choose one due item.</strong><br />A supervisor weighs the owner’s direction, earlier decisions, measured results, and available competitor evidence.</li><li><strong>3. Save the next state.</strong><br />Scout records a result, a dated reason to wait, or a concrete owner decision. Sending, building, and publishing keep their approval gates.</li></ol>
      <p role="status" className="rounded-md bg-muted/40 p-4 text-sm"><strong>If Scout woke now:</strong> {board.wakeStatus}</p>
      {capacity && <p className="text-sm text-mutedForeground">{capacity.usedSteps} of {workspace.mission.dailySteps} research steps used in the rolling 24-hour window. {capacity.active} of {workspace.mission.maxActive} active research/review slots used. An empty wake does not claim work and does not consume a research step.</p>}
      <div><h3 className="text-sm font-semibold">Where new work comes from <span className="font-normal text-mutedForeground">· open records now</span></h3><dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-5">
        <WorkSource label="Page opportunities" count={board.sourceCounts.pages}>Saved signals and pages you ask Scout to investigate.</WorkSource>
        <WorkSource label="Publisher replies" count={board.sourceCounts.replies}>Replies that need a useful, reviewed next response.</WorkSource>
        <WorkSource label="Outcome reviews" count={board.sourceCounts.measurements}>Published pages returning after their evidence window.</WorkSource>
        <WorkSource label="Open exploration" count={board.sourceCounts.exploration}>One broad brief replenished after the last one closes.</WorkSource>
        <WorkSource label="Whole-site review" count={board.sourceCounts.siteReview}>One reusable review of performance, impact, and gaps.</WorkSource>
      </dl></div>
      {canReview && <p className="text-xs text-mutedForeground">“Check for due work” only reconciles saved records. It does not run the AI worker or consume a research step.</p>}
    </section>
    {workspace.truncated && <p role="status">The work history limit has been reached. Archive reviewed history before further research.</p>}
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <WorkColumn title="Your decisions" empty="No work needs your decision." items={board.ownerActions} canReview={canReview} />
      <WorkColumn title="Working now" empty="No research step is running now. Due work below can be considered at the next scheduled wake when capacity permits." items={board.working} canReview={canReview} />
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <WorkColumn title="Scheduled reviews" empty="No work is waiting for a future evidence or follow-up date." items={board.scheduled} canReview={canReview} />
      <WorkColumn title="External systems" empty="No builds, callbacks, or other external work are pending." items={board.external} canReview={canReview} />
    </div>
    <section className="rounded-lg border border-border bg-card p-5 space-y-3"><h2 className="text-lg font-semibold">What we are learning</h2>
      <p className="text-sm">Measure enquiries and useful visits, then search clicks, impressions, click-through rate, and position. Briefs and builds show activity; measured outcomes guide the next hypothesis.</p>
      <p className="text-sm text-mutedForeground">Per-change qualified lead and revenue attribution are not connected yet. The effectiveness review separately shows current human-recorded enquiry statuses. Before/after changes show association, not proof that a page caused the change.</p>
      <p className="text-sm">{competitors.status === "AVAILABLE" ? `${competitors.reports.filter(report => report.fresh).length} recent Semrush reports available. Reports keep their own observation dates; Scout also researches public competitor pages for the selected task.` : "Competitor reports are unavailable. Scout must use dated public sources and disclose evidence gaps."}</p>
      <p className="text-xs text-mutedForeground">Initial page review: 28 days before and 28 days after publication, with reporting time allowed. Deferred reviews use a later 28-day window. A report can recommend keeping, improving, stopping, or waiting.</p>
      {outcomes.length ? <div className="grid gap-4 md:grid-cols-2">{outcomes.slice(0, 6).map(item => <WorkCard key={item.id} item={item} canReview={canReview} />)}</div> : <p className="text-sm font-medium">No page outcome has been measured yet. Published pages will return here when their reporting window is ready.</p>}
    </section>
    <details className="rounded-lg border border-border p-5"><summary className="cursor-pointer font-semibold">Due for Scout — {candidates.length} item{candidates.length === 1 ? "" : "s"} across {groups.size} pages or research areas</summary>
      <p className="mt-2 text-sm text-mutedForeground">Due means the item is ready or its review date has arrived, it needs no owner decision or external callback, no active page work conflicts, and it fits the worker’s bounded one-per-route selection set. Budget and active-slot capacity are checked separately in “If Scout woke now.” These are not tasks for you.</p>
      {board.heldCandidates.length > 0 && <p className="mt-2 text-xs text-mutedForeground">{board.heldCandidates.length} related or overflow signal{board.heldCandidates.length === 1 ? " is" : "s are"} held outside this selection set by same-route deduplication, active page work, or the bounded worker packet.</p>}
      {groups.size ? <div className="mt-4 space-y-3">{Array.from(groups, ([route, group]) => <details key={route} className="rounded border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">{route} · {group.length} candidate{group.length === 1 ? "" : "s"}</summary><div className="mt-3 grid gap-3 md:grid-cols-2">{group.map(item => <WorkCard key={item.id} item={item} canReview={canReview} />)}</div></details>)}</div> : <p className="mt-3 text-sm text-mutedForeground">Nothing is due. Future reviews and external waits remain visible above.</p>}
    </details>
    {canReview && <details className="rounded-lg border border-border bg-card p-5"><summary className="cursor-pointer font-semibold">Give Scout a page to investigate</summary>
      <form action={proposeScoutPageAction} className="mt-4 grid gap-3 md:grid-cols-2"><label>Title<input name="title" required maxLength={250} className={field} /></label><label>Website route<input name="route" required placeholder="/services/warehousing" className={field} /></label>
        <label className="md:col-span-2">Problem or hypothesis<textarea name="hypothesis" required maxLength={4000} className={field} /></label><label><input name="newPage" type="checkbox" /> Propose a new page</label><div><button className={button}>Add research</button></div></form>
    </details>}
    <details className="rounded-lg border border-border p-5"><summary className="cursor-pointer font-semibold">Decisions and learning ({workspace.items.filter(item => ["DONE", "DISMISSED"].includes(item.state)).length})</summary>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{workspace.items.filter(item => item.kind !== "MEASUREMENT" && ["DONE", "DISMISSED"].includes(item.state)).slice(0, 20).map(item => <WorkCard key={item.id} item={item} canReview={false} />)}</div>
    </details>
  </div>;
}
function WorkColumn({ title, empty, items, canReview }: { title: string; empty: string; items: Array<Work & { id: string; recipientEmail?: string | null }>; canReview: boolean }) {
  return <section className="space-y-3"><h2 className="text-lg font-semibold">{title} <span className="text-mutedForeground">{items.length}</span></h2>{items.length === 0 ? <p className="rounded-lg border border-dashed border-border p-5 text-sm text-mutedForeground">{empty}</p> : items.map(item => <WorkCard key={item.id} item={item} canReview={canReview} />)}</section>;
}
function WorkSource({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return <div className="rounded-md border border-border p-3"><dt className="font-semibold">{label} <span className="text-mutedForeground">{count}</span></dt><dd className="mt-1 text-xs text-mutedForeground">{children}</dd></div>;
}
function WorkCard({ item, canReview }: { item: Work & { id: string; recipientEmail?: string | null }; canReview: boolean }) {
  const artifact = record(item.artifact);
  const handoff = record(item.evidence.handoff), supervisor = record(item.evidence.supervisor), waitBlocker = record(item.evidence.waitBlocker);
  return <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-wide text-primary">{kindLabels[item.kind]}</p><h3 className="mt-2 font-semibold">{item.title}</h3>
    {item.route && <p className="mt-1 break-all text-xs text-mutedForeground">{item.route}</p>}<p className="mt-3 text-sm">{item.hypothesis}</p>
    <p className="mt-3 text-sm"><strong>Next:</strong> {item.nextAction}</p>
    {item.state === "WAITING" && typeof waitBlocker.type === "string" && <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs"><p className="font-semibold">Waiting for {String(waitBlocker.type).toLowerCase().replaceAll("_", " ")}</p><p className="mt-1">Evidence needed: {String(waitBlocker.evidenceNeeded ?? item.nextAction)}</p><p className="mt-1 text-mutedForeground">Resolution: {String(waitBlocker.resolutionAction ?? item.nextAction)} · {waitBlocker.resolvableByScout === true ? "Scout owns this follow-up." : "Human input is required."}</p></div>}
    {item.state === "WAITING" && !item.evidence.externalWait && <p className="mt-2 text-xs text-mutedForeground">{needsOwner(item) ? "Waiting for your decision." : isDue(item) ? "Due now for the next scheduled wake." : `Scout checks again ${new Date(item.nextReviewAt).toLocaleDateString("en-CA", { timeZone: "UTC" })}`}</p>}
    {typeof supervisor.verdict === "string" && <p className="mt-2 text-xs text-mutedForeground">Quality review: {supervisor.verdict.toLowerCase()} — {String(supervisor.reason ?? "")}</p>}
    {item.kind === "MEASUREMENT" && typeof artifact.outcome === "string" && <p className="mt-2 text-sm font-semibold">{artifact.outcome} · {String(artifact.confidence ?? "Unspecified").toLowerCase()} confidence</p>}
    {item.kind === "MEASUREMENT" && <MeasurementEvidence value={item.evidence.measurement} />}
    {item.draftId && <Link className="mt-3 inline-block text-sm font-semibold text-primary" href={`/website-growth/drafts/${encodeURIComponent(item.draftId)}`}>{handoff.draftStatus && handoff.draftStatus !== "DRAFT" ? "Open build and preview →" : "Review complete page brief →"}</Link>}
    {item.kind === "RELATIONSHIP" && typeof artifact.body === "string" && <div className="mt-4 rounded-md bg-muted/40 p-3"><p className="text-xs">To: {item.recipientEmail ?? "Recipient unavailable"}</p><p className="mt-2 text-sm font-semibold">{String(artifact.subject ?? "Proposed response")}</p><p className="mt-2 whitespace-pre-wrap text-sm">{artifact.body}</p><p className="mt-3 text-xs text-mutedForeground">{item.evidence.replySend === "ACCEPTED" ? "Microsoft 365 accepted this response." : item.evidence.replySend ? "Sending is pending or uncertain. Check progress before taking action." : "Prepared for review. Sending adds the standard business identity and opt-out footer. No response has been sent."}</p></div>}
    {item.artifact && item.kind !== "PAGE" && <details className="mt-3"><summary className="cursor-pointer text-sm">Evidence and recommendation</summary><div className="mt-2 space-y-2 text-sm">
      {[artifact.recommendation, artifact.rationale, artifact.limitations].filter(value => typeof value === "string" && value).map((value, index) => <p key={index}>{String(value)}</p>)}
      {Array.isArray(artifact.evidence) && <ul className="list-disc space-y-1 pl-5">{artifact.evidence.filter(value => typeof value === "string").map((value, index) => <li key={index}>{String(value)}</li>)}</ul>}
      {Array.isArray(artifact.prospects) && artifact.prospects.length > 0 && <Link href="/website-growth/backlinks" className="inline-block font-semibold text-primary">Review publisher opportunities →</Link>}
    </div></details>}
    <details className="mt-3"><summary className="cursor-pointer text-xs text-mutedForeground">Progress and decisions</summary><ol className="mt-2 space-y-2 text-xs">{item.history.slice(-8).map((event, index) => <li key={index}>{new Date(event.at).toLocaleDateString("en-CA")} — {event.summary}</li>)}</ol></details>
    {canReview && item.kind === "RELATIONSHIP" && item.state === "NEEDS_REVIEW" && item.recipientEmail && <form action={sendScoutReplyAction} className="mt-4 space-y-2"><input type="hidden" name="id" value={item.id} /><input type="hidden" name="revision" value={item.revision} /><label className="flex gap-2 text-xs"><input type="checkbox" name="confirmSend" required />I approve sending this response to the recipient shown above.</label><button className={button}>Approve and send response</button></form>}
    {canReview && needsOwner(item) && (!item.evidence.externalWait || Boolean(item.evidence.escalation)) && !item.evidence.replySend && <ScoutReviewForm id={item.id} revision={item.revision} hasDraft={Boolean(item.draftId)} />}
  </article>;
}

function MeasurementEvidence({ value }: { value: unknown }) {
  const measurement = record(value), windows = record(measurement.windows);
  if (!Array.isArray(measurement.sources)) return null;
  const labels: Record<string, string> = { search_console: "Search Console", ga4: "Google Analytics", enquiries: "Enquiries" };
  const metrics: Record<string, string> = { clicks: "clicks", impressions: "impressions", sessions: "sessions", engagedSessions: "engaged sessions", enquiries: "enquiries", excludedDiagnosticEnquiries: "diagnostic submissions excluded" };
  const describe = (source: string, period: string) => {
    const row = measurement.sources as unknown[];
    const result = record(row.find(item => record(item).source === source && record(item).period === period));
    if (result.status !== "AVAILABLE") return result.status === "NO_MATCHING_ROWS" ? "No matching data" : "Unavailable";
    return Object.entries(record(result.metrics)).filter(([, amount]) => typeof amount === "number")
      .map(([key, amount]) => ["ctr", "engagementRate"].includes(key) ? `${(Number(amount) * 100).toFixed(1)}% ${key === "ctr" ? "CTR" : "engagement rate"}` : `${Number(amount).toLocaleString("en-CA", { maximumFractionDigits: 1 })} ${metrics[key] ?? key}`).join("; ");
  };
  return <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Recorded measurement</summary>
    <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Source</th>{["before", "after"].map(period => <th key={period} className="p-2">{period === "before" ? "Before" : "After"}<span className="mt-1 block font-normal">{String(record(windows[period]).startDate ?? "")} – {String(record(windows[period]).endDate ?? "")}</span></th>)}</tr></thead>
      <tbody>{Object.entries(labels).map(([source, label]) => <tr key={source} className="border-t border-border"><th className="p-2 font-normal">{label}</th><td className="p-2">{describe(source, "before")}</td><td className="p-2">{describe(source, "after")}</td></tr>)}</tbody></table></div>
    <p className="mt-2 text-xs text-mutedForeground">{String(measurement.caveat ?? "Enquiries are not qualified leads. Before/after movement does not establish causation.")}</p>
  </details>;
}
