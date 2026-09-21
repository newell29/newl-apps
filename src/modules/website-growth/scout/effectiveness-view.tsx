"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { refreshScoutEffectivenessAction } from "./actions";
import { SOURCE_NAMES, reviewPages, sourceCurrent, type SiteReview, type PageReview } from "./effectiveness-model";
import type { Mission, Work } from "./model";
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const labels = { search_console: "Search Console", ga4: "Analytics", enquiries: "Website enquiries" };
const metrics: Record<string, string> = { clicks: "Search clicks", impressions: "Impressions", ctr: "Click-through rate", position: "Average position", sessions: "Sessions", engagedSessions: "Engaged sessions", engagementRate: "Engagement rate", enquiries: "Enquiries", qualified: "Currently Qualified", quoted: "Currently Quote sent", won: "Currently Won", disqualified: "Currently Not a fit / Spam" };
const button = "rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50";
const panel = "rounded-lg border border-border bg-card p-5";
const format = (metric: string, value: number) => ["ctr", "engagementRate"].includes(metric) ? `${(value * 100).toFixed(1)}%` : value.toLocaleString("en-CA", { maximumFractionDigits: 1 });
const date = (value: string) => new Date(value).toLocaleDateString("en-CA", { timeZone: "UTC" });
type Item = Work & { id: string };

export function EffectivenessReview({ review, items, mission, canReview, workspaceAvailable, truncated, competitorSummary }: {
  review: SiteReview | null; items: Item[]; mission: Mission | null; canReview: boolean; workspaceAvailable: boolean; truncated: boolean; competitorSummary: string;
}) {
  const [area, setArea] = useState("performance"), [query, setQuery] = useState(""), [filter, setFilter] = useState("All pages");
  const [refresh, refreshAction, pending] = useActionState(async () => refreshScoutEffectivenessAction(), { error: null as string | null });
  const result = review ? reviewPages(review) : null;
  const pages = (result?.pages ?? []).filter(page => page.route.toLowerCase().includes(query.toLowerCase()) && (filter === "All pages" || page.direction === filter));
  const siteWork = items.find(item => item.evidence.source === "site-review");
  const report = record(siteWork?.artifact);
  const opportunities = items.filter(item => item.evidence.source !== "site-review" && (item.kind === "RESEARCH" || item.kind === "PAGE") && !item.draftId && !["DONE", "DISMISSED"].includes(item.state));
  return <>
    <section className={`${panel} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Direction and coverage</h2>{canReview && <form action={refreshAction}><button className={button} disabled={pending}>{pending ? "Refreshing saved evidence…" : "Refresh saved evidence"}</button></form>}</div>
      {refresh.error && <p role="alert" className="text-sm">{refresh.error}</p>}
      <p>{mission?.objective ?? "Marketing direction could not be loaded."}</p>
      {mission && <p className="text-sm text-mutedForeground">{mission.priorities} Research {mission.enabled ? "enabled" : "paused"}. <Link href="/website-growth/marketing" className="underline">Manage direction and budget</Link></p>}
      {mission && <details className="text-sm"><summary className="cursor-pointer font-semibold">Pilot success guidance and competitor watchlist</summary><div className="mt-2 grid gap-3 md:grid-cols-2"><div className="rounded-md bg-muted/40 p-3"><strong>How Scout evaluates progress</strong><p className="mt-1 whitespace-pre-wrap text-mutedForeground">{mission.successCriteria}</p></div><div className="rounded-md bg-muted/40 p-3"><strong>Who Scout compares</strong><p className="mt-1 whitespace-pre-wrap text-mutedForeground">{mission.competitorWatchlist}</p></div></div></details>}
      <p className="text-sm">{review ? `Comparing ${review.windows.after.startDate}–${review.windows.after.endDate} with ${review.windows.before.startDate}–${review.windows.before.endDate}. Last refresh attempt ${date(review.attemptedAt)}. Next eligible refresh ${date(review.nextRefreshAt)}.` : "No site review is saved yet. An enabled Scout wake collects it automatically. An owner can refresh the saved sources now without running the AI worker."}</p>
      {canReview && <p className="text-xs text-mutedForeground">Refreshing reads and stores eligible Search Console, Analytics, enquiry, and page-inventory evidence. It does not run Scout or consume a research step.</p>}
      {review && <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">{SOURCE_NAMES.map(name => <li key={name}><strong>{labels[name]}:</strong> {sourceCurrent(review.sources[name], review) ? "Current" : review.sources[name].data ? "Stale evidence retained" : "Unavailable"}{review.sources[name].observedAt ? ` · observed ${date(review.sources[name].observedAt!)}` : ""}{review.sources[name].data?.truncated ? " · capped report" : ""}</li>)}</ul>}
      <p className="text-xs text-mutedForeground">{result ? `${result.totalRoutes} routes found in available reports and inventory; ${result.pages.filter(page => page.direction === "Insufficient evidence").length} lack enough comparable traffic evidence. Inventory: ${review!.inventory.source}${review!.inventory.observedAt ? `, observed ${date(review!.inventory.observedAt)}` : ", date unavailable"}. ` : ""}Coverage is limited to available inventory and reports; no alert does not mean every page is healthy. Sources refresh at most daily, or after six hours when incomplete. Existing work continues during source outages.</p>
      {(truncated || result?.truncated) && <p role="status" className="text-sm">This view reached its coverage limit. It does not represent the complete history or every route.</p>}
      {!workspaceAvailable && <p role="status">Work history could not be loaded. Saved analytics remain available; open the workboard to retry.</p>}
    </section>
    <section className={`${panel} space-y-2`}><h2 className="text-lg font-semibold">Scout’s latest site review</h2>
      {typeof report.recommendation === "string" ? <><p className="whitespace-pre-wrap text-sm">{report.recommendation}</p><p className="text-xs text-mutedForeground">{String(report.limitations ?? "")}</p><p className="text-xs">{siteWork!.state === "DONE" ? "Recorded" : `Draft / ${siteWork!.state.toLowerCase()}`} · next review {date(siteWork!.nextReviewAt)}</p></> : <p className="text-sm text-mutedForeground">{siteWork ? siteWork.nextAction : "Scout has not completed a whole-site review yet. The saved evidence below can be inspected independently."}</p>}
      <Link href="/website-growth/marketing" className="inline-block text-sm font-semibold text-primary">Open decisions and active work →</Link>
    </section>
    <div role="group" aria-label="Review area" className="flex flex-wrap gap-2">{[["performance", "Page performance"], ["opportunities", "Opportunities"], ["work", "Work & impact"]].map(([key, label]) => <button key={key} type="button" aria-pressed={area === key} onClick={() => setArea(key)} className={`${button} ${area === key ? "border-primary bg-primary/10 text-primary" : ""}`}>{label}</button>)}</div>
    <section aria-live="polite" className="space-y-4">
      {area === "performance" && <>
        <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Find a route<input className="mt-1 block rounded border border-border bg-background p-2" value={query} onChange={event => setQuery(event.target.value)} placeholder="/services/" /></label><label className="text-sm">Show<select className="mt-1 block rounded border border-border bg-background p-2" value={filter} onChange={event => setFilter(event.target.value)}>{["All pages", "Declining", "Improving", "Mixed", "No clear change", "Insufficient evidence"].map(value => <option key={value}>{value}</option>)}</select></label></div>
        <p className="text-sm text-mutedForeground">Changes are investigation hints, not diagnoses. Check query mix, demand, seasonality, technical issues and tracking before changing a page. Low volume is not a failed page.</p>
        {pages.length ? pages.map(page => <PageEvidence key={page.route} page={page} items={items} />) : <p className={panel}>No matching pages with available coverage. This is not evidence of zero traffic or a healthy site.</p>}
      </>}
      {area === "opportunities" && <>
        <p className="text-sm">{competitorSummary}</p><p className="text-sm text-mutedForeground">Scout also investigates customer questions and topics absent from Search Console. Business relevance and evidence determine priority. A hint does not automatically create or approve a page.</p>
        {(result?.pages ?? []).filter(page => page.opportunities.length).slice(0, 12).map(page => <article key={page.route} className={panel}><h3 className="break-all font-semibold">{page.route}</h3>{page.opportunities.map(hint => <p key={hint} className="mt-2 text-sm">{hint}</p>)}<ActiveWork route={page.route} items={items} /></article>)}
        <h2 className="text-lg font-semibold">Existing research and proposals</h2>
        {opportunities.slice(0, 30).map(item => <article key={item.id} className={panel}><h3 className="font-semibold">{item.title}</h3><p className="mt-2 text-sm">{item.hypothesis}</p><p className="mt-2 text-sm">Next: {item.nextAction}</p><Link href="/website-growth/marketing" className="mt-2 inline-block text-sm text-primary">Follow existing work →</Link></article>)}
        {!opportunities.length && <p>No open proposals yet. Scout can continue exploratory research when its mission is enabled.</p>}
        <Link href="/website-growth/backlinks" className="inline-block text-sm font-semibold text-primary">Review publisher research and verified placements →</Link>
      </>}
      {area === "work" && <>
        <p className="text-sm text-mutedForeground">A prepared brief or completed build is not a published improvement. Outcome reviews retain the original hypothesis and source measurements. Before/after movement shows association, not causal lift.</p>
        <WorkImpactList items={items} />
      </>}
    </section>
    <aside className={`${panel} space-y-2 text-sm`}><strong>Business outcomes and attribution</strong><p>{mission?.qualifiedLead ?? "Define a qualified enquiry in the marketing direction."}</p><p>Enquiries are website forms grouped by the submitted page. Qualified, Quote sent and Won show separate current statuses recorded in Inbound Opportunities; these are not historical conversion stages or revenue. Diagnostic submissions are excluded when tagged; untagged tests and spam can remain.</p><p>Original landing-session attribution and revenue are not connected here. The competitor watchlist guides task-level public research; it is not an automatic continuous crawl or evidence of competitors’ private results.</p><Link href="/website-inbound" className="inline-block text-primary">Review and qualify inbound opportunities →</Link></aside>
  </>;
}
function ActiveWork({ route, items }: { route: string; items: Item[] }) {
  const active = items.find(item => item.kind === "PAGE" && item.route === route && !["DONE", "DISMISSED"].includes(item.state));
  return <p className="mt-3 text-sm">{active ? `Existing work: ${active.title}. ${active.nextAction}` : "Scout can investigate this evidence at its next review; no change has been authorized."} <Link className="text-primary underline" href="/website-growth/marketing">Workboard</Link></p>;
}
function PageEvidence({ page, items }: { page: PageReview; items: Item[] }) {
  return <details className={panel}><summary className="cursor-pointer break-all font-semibold">{page.route} <span className="font-normal text-mutedForeground">· {page.direction}</span></summary>
    <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{page.facets.map(facet => <div key={facet.key} className="rounded-md border border-border p-2"><dt className="text-xs font-semibold text-mutedForeground">{facet.label}</dt><dd className="mt-1 text-sm font-semibold">{facet.direction}</dd>{facet.metrics.length > 0 && <dd className="mt-1 text-xs text-mutedForeground">Material movement: {facet.metrics.map(metric => metrics[metric] ?? metric).join(", ")}</dd>}</div>)}</dl>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Measure</th><th className="p-2">Previous</th><th className="p-2">Latest</th><th className="p-2">Change</th></tr></thead><tbody>{page.comparisons.map(row => <tr key={`${row.source}:${row.metric}`} className="border-t border-border"><th className="p-2 font-normal">{metrics[row.metric] ?? row.metric}</th><td className="p-2">{format(row.metric, row.before)}</td><td className="p-2">{format(row.metric, row.after)}</td><td className="p-2">{(["ctr", "engagementRate"].includes(row.metric) ? `${(row.difference * 100).toFixed(1)} pp` : format(row.metric, row.difference))}{row.percentChange !== null && !["ctr", "engagementRate", "position"].includes(row.metric) ? ` (${row.percentChange.toFixed(1)}%)` : ""}</td></tr>)}</tbody></table></div>
    {page.gaps.length > 0 && <p className="mt-2 text-xs text-mutedForeground">Evidence gaps: {page.gaps.join("; ")}. Missing rows are not assumed to be zero.</p>}<ActiveWork route={page.route} items={items} /></details>;
}
export function WorkImpactList({ items }: { items: Item[] }) {
  const delivered = items.filter(item => item.kind === "MEASUREMENT" || (item.kind === "PAGE" && item.draftId));
  return delivered.length ? <>{delivered.map(item => <WorkImpact key={item.id} item={item} />)}</> : <p className={panel}>No delivered briefs or page outcome records yet. Active research proposals remain in Opportunities; dismissed research stays in the workboard history.</p>;
}
function WorkImpact({ item }: { item: Item }) {
  const handoff = record(item.evidence.handoff), measurement = record(item.evidence.measurement), artifact = record(item.artifact);
  const hasResults = Array.isArray(measurement.sources) && measurement.sources.some(value => { const source = record(value); return source.period === "after" && source.status === "AVAILABLE" && Object.values(record(source.metrics)).some(value => typeof value === "number"); });
  const state = item.kind === "MEASUREMENT" ? hasResults ? "Measured — review evidence" : "Published — awaiting measurement" : handoff.draftStatus === "PUBLISHED" ? "Published" : item.state === "DISMISSED" || handoff.draftStatus === "REJECTED" ? "Closed — not published" : ["APPROVED", "BUILT"].includes(String(handoff.draftStatus)) ? "Approved / build handoff" : "Prepared — not verified live";
  return <article className={`${panel} space-y-2`}><p className="text-xs font-semibold uppercase text-primary">{state}</p><h3 className="font-semibold">{item.title}</h3><p className="text-sm">Hypothesis: {item.hypothesis}</p>
    {typeof item.evidence.publishedAt === "string" && <p className="text-xs">Published {date(item.evidence.publishedAt)}</p>}<p className="text-sm">Next: {item.nextAction}</p>
    {typeof artifact.recommendation === "string" && <p className="text-sm">{String(artifact.outcome ?? "Recommendation")}: {artifact.recommendation} {artifact.confidence ? `(${String(artifact.confidence).toLowerCase()} confidence)` : ""}</p>}
    {Boolean(measurement.windows) && <p className="text-xs">Before: {String(record(record(measurement.windows).before).startDate ?? "")}–{String(record(record(measurement.windows).before).endDate ?? "")} · After: {String(record(record(measurement.windows).after).startDate ?? "")}–{String(record(record(measurement.windows).after).endDate ?? "")}</p>}
    {Array.isArray(measurement.changes) && <ul className="space-y-1 text-sm">{measurement.changes.map((value, index) => { const change = record(value); return <li key={index}>{metrics[String(change.metric)] ?? String(change.metric)}: {format(String(change.metric), Number(change.before))} → {format(String(change.metric), Number(change.after))}</li>; })}</ul>}
    {Array.isArray(measurement.sources) && <p className="text-xs text-mutedForeground">{measurement.sources.map(value => { const source = record(value); return `${String(source.source)} ${String(source.period)}: ${String(source.status)}`; }).join(" · ")}</p>}
    {typeof artifact.limitations === "string" && <p className="text-xs text-mutedForeground">{artifact.limitations}</p>}
    <Link className="inline-block text-sm text-primary" href={item.draftId || (item.kind === "MEASUREMENT" && item.referenceId) ? `/website-growth/drafts/${encodeURIComponent(item.draftId ?? item.referenceId!)}` : "/website-growth/marketing"}>Open evidence and delivery record →</Link>
  </article>;
}
