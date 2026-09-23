import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { AuthorityCampaignForm, AuthorityReviewForm } from "./review-form";
import { authorityOutcomes, type authorityWorkspace } from "./store";
import { record } from "../scout/model";

const input = "mt-1 w-full rounded border border-border bg-background p-2 text-sm";
const card = "rounded-lg border border-border bg-card p-5";
export function AuthorityBoard({ workspace, canReview }: { workspace: Awaited<ReturnType<typeof authorityWorkspace>>; canReview: boolean }) {
  const { campaign, actions, opportunities, wake } = workspace, metrics = authorityOutcomes(actions);
  const groups = [
    { title: "Your decisions", states: ["REVIEW", "BLOCKED", "UNCERTAIN"], empty: "No action needs your decision." },
    { title: "Ready and working", states: ["APPROVED", "RUNNING"], empty: "No approved action is waiting. Research can continue within the marketing budget." },
    { title: "Completed actions and placements", states: ["SUBMITTED", "LIVE"], empty: "No completed campaign actions yet." }
  ];
  return <div className="space-y-6">
    <PageHeader eyebrow="Website Growth · Authority" title="Authority campaigns" description="Scout develops useful assets and publisher relationships. Newl Apps owns the plan, exact approvals, execution evidence and results." />
    <nav className="flex gap-4 text-sm"><Link href="/website-growth">Effectiveness review</Link><Link href="/website-growth/marketing">Marketing workboard</Link><Link href="/website-growth/backlinks">Authority campaigns</Link></nav>
    <section className={card}><h2 className="text-lg font-semibold">{campaign?.title ?? "Start the placement pilot"}</h2>
      <p className="mt-2 text-sm">{campaign?.hypothesis ?? "Turn relevant publisher conversations and useful public resources into verifiable placements."}</p>
      <p className="mt-3 text-sm"><strong>Research:</strong> {!campaign?.enabled ? "Campaign paused." : workspace.researchEnabled ? "Active within the existing Scout research schedule and budget." : "Paused in the marketing workboard. Enable the research mission there to start investigation."} <strong>Executor:</strong> {wake ? `Last check ${wake.at?.toISOString() ?? "unknown"}. ${String(record(wake.output).reason ?? "")}` : "No campaign executor check recorded. Runtime cutover is still required."}</p>
      {record(wake?.output).sync === "UNAVAILABLE" && <p role="alert" className="mt-2 text-sm text-danger">Mailbox sync is unavailable. External communication remains held until fresh replies can be checked.</p>}
      <p className="mt-3 text-sm text-mutedForeground">Each executor wake checks replies and claims at most one approved action. An empty queue ends immediately. A submitted email or form is not a live link; Scout separately checks the publisher page and reviews target-page trends after 28, 56 and 90 days.</p>
      {campaign && <p className="mt-3 text-sm"><a href={campaign.targetPage} target="_blank" rel="noreferrer" className="underline">Target page</a> · <a href={campaign.assetUrl} target="_blank" rel="noreferrer" className="underline">Supporting asset</a><br />{campaign.success}</p>}
      {canReview && <details className="mt-4" open={!campaign}><summary className="cursor-pointer font-semibold">Campaign settings and cutover</summary>
        <AuthorityCampaignForm>
          <label className="text-sm">Campaign title<input name="title" required className={input} defaultValue={campaign?.title ?? "Distribution expertise and relevant industry placements"} /></label>
          <label className="text-sm">Target page<input name="targetPage" type="url" required className={input} defaultValue={campaign?.targetPage ?? "https://www.newlgroup.com/resources/warehouse-distribution-strategy-playbook"} /></label>
          <label className="text-sm">Public supporting asset<input name="assetUrl" type="url" required className={input} defaultValue={campaign?.assetUrl ?? "https://www.newlgroup.com/resources/warehouse-distribution-strategy-playbook"} /></label>
          <label className="text-sm">Audience<textarea name="audience" required className={input} defaultValue={campaign?.audience ?? "Operations leaders, importers, ecommerce businesses and relevant logistics publishers in Newl's served markets."} /></label>
          <label className="text-sm">Hypothesis<textarea name="hypothesis" required className={input} defaultValue={campaign?.hypothesis ?? "A useful ungated distribution guide, supported by specific practitioner contributions, will earn relevant referrals and editorial placements. Finish existing positive conversations before prospecting."} /></label>
          <label className="text-sm">Pilot success guidance<textarea name="success" required className={input} defaultValue={campaign?.success ?? "In the first 30 days: fewer than 20% of approved actions blocked, at least two positive replies, and at least one relevant verified placement. Investigate 12–20 feasible prospects. Review observed page trends at 28/56/90 days; do not equate sends or rankings with qualified enquiries."} /></label>
          <label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked={campaign?.enabled ?? false} />Enable campaign research and approved execution</label>
          <p className="text-sm text-mutedForeground">Saving retires the previous opportunity-level approval and executor APIs for this tenant, even while paused. History is retained. Individual external actions still require approval.</p>
          <button className="rounded bg-primary px-4 py-2 text-sm text-primaryForeground">Save campaign</button>
        </AuthorityCampaignForm>
      </details>}
    </section>
    <section className="grid gap-4 md:grid-cols-4"><MetricCard label="Prepared" value={metrics.prepared} caption="Concrete actions, not raw prospects" /><MetricCard label="Completed actions" value={metrics.completed} caption="Accepted messages or submitted forms" /><MetricCard label="Verified placements" value={metrics.verifiedPlacements} caption="Public links independently checked" /><MetricCard label="Approved actions held" value={metrics.blockedApproved} caption={`${metrics.approved} individually approved actions`} /></section>
    {workspace.truncated && <p role="alert">History has reached the bounded workspace limit; archive reviewed history before expanding this pilot.</p>}
    {groups.map(group => <section className="space-y-3" key={group.title}><h2 className="text-xl font-semibold">{group.title}</h2>
      {!actions.some(a => group.states.includes(a.state)) && <p className={`${card} text-sm text-mutedForeground`}>{group.empty}</p>}
      {actions.filter(a => group.states.includes(a.state)).map(a => <article key={a.id} className={card}>
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{a.title}</h3><span className="text-sm">{a.plan.method} · {a.state.replaceAll("_", " ")}</span></div>
        <p className="mt-2 text-sm">{a.plan.reason}</p><p className="mt-2 text-sm font-medium">{a.result}</p>
        <dl className="mt-3 space-y-2 text-sm"><div><dt className="font-semibold">Exact route</dt><dd><a className="underline" href={a.plan.route} target="_blank" rel="noreferrer">{a.plan.route}</a></dd></div>
          {a.plan.recipientEmail && <div><dt className="font-semibold">Recipient and consent</dt><dd>{a.plan.recipientEmail} · {a.plan.recipientCountry} · {a.plan.consentBasis}</dd></div>}
          <div><dt className="font-semibold">Feasibility checked {a.plan.checkedAt.slice(0, 10)}</dt><dd>{a.plan.evidence}</dd></div>
          <div><dt className="font-semibold">Completion requires</dt><dd>{a.plan.completion}</dd></div>
        </dl>
        {a.plan.subject && <p className="mt-3 font-semibold">{a.plan.subject}</p>}{a.plan.body && <p className="mt-2 whitespace-pre-wrap rounded bg-muted/40 p-3 text-sm">{a.plan.body}</p>}
        {a.plan.fields.length > 0 && <dl className="mt-3 space-y-2 rounded bg-muted/40 p-3 text-sm">{a.plan.fields.map(f => <div key={f.label}><dt className="font-semibold">{f.label}</dt><dd className="whitespace-pre-wrap">{f.value}</dd></div>)}</dl>}
        {a.plan.termsUrl && <a href={a.plan.termsUrl} className="mt-2 block text-sm underline" target="_blank" rel="noreferrer">Reviewed submission terms</a>}
        {a.liveUrl && <a href={a.liveUrl} className="mt-2 block text-sm underline" target="_blank" rel="noreferrer">Verified placement</a>}
        {canReview && ["REVIEW", "BLOCKED", "UNCERTAIN"].includes(a.state) && <AuthorityReviewForm id={a.id} revision={a.revision} state={a.state} manual={a.plan.method === "MANUAL"} />}
        <details className="mt-3 text-sm"><summary className="cursor-pointer">Action history</summary>{a.history.map((event, i) => <p key={i} className="mt-2">{event.at} · {event.event}: {event.detail}</p>)}</details>
      </article>)}
    </section>)}
    <p className="text-sm text-mutedForeground">{metrics.limitation} Positive replies require interpreting the reply; a REPLIED status alone is not a positive result.</p>
    <details className={card}><summary className="cursor-pointer font-semibold">Publisher inventory and previous process history ({opportunities.length})</summary><p className="mt-2 text-sm text-mutedForeground">Previous approvals do not authorize the new executor. Scout must prepare a concrete action first.</p>
      <div className="mt-3 space-y-3">{opportunities.map(o => <div key={o.id} className="border-t border-border pt-3 text-sm"><strong>{o.title}</strong> · {o.status}<p>{o.notes ?? o.outreachAngle}</p></div>)}</div>
    </details>
    <details className={card}><summary className="cursor-pointer font-semibold">Closed campaign actions ({actions.filter(a => a.state === "CLOSED").length})</summary>{actions.filter(a => a.state === "CLOSED").map(a => <p key={a.id} className="mt-3 text-sm">{a.title}: {a.result}</p>)}</details>
  </div>;
}
