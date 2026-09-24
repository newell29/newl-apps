import { loadWebsiteGrowthSemrushCache } from "@/modules/website-growth/scout-run";
import { DAY_MS, isDue, record, type Work } from "./model";
import { hasPostChangeEvidence } from "./measurement";

type Item = Work & { id: string };
const recent = (work: Work) => Date.parse(work.history.at(-1)?.at ?? "") || 0;

/** Recover saved correction waits on reads and claims, without approving or resetting attempts. */
export function projectSupervisorCorrections<T extends Work>(items: T[]): T[] {
  return items.map(work => {
    const review = supervisorReview(work.evidence.supervisor);
    const reviewedAt = record(work.evidence.supervisor).reviewedAt;
    const blocker = record(work.evidence.waitBlocker);
    if (work.state !== "WAITING" || work.evidence.externalWait || work.evidence.escalation ||
        review?.verdict !== "REVISE" || typeof reviewedAt !== "string" || !Number.isFinite(Date.parse(reviewedAt)) ||
        !Number.isInteger(work.attempts) || work.attempts < 0 || work.attempts >= 3 ||
        !Object.keys(record(work.artifact)).length || blocker.type !== "PUBLIC_RESEARCH" || blocker.resolvableByScout !== true ||
        typeof blocker.evidenceNeeded !== "string" || !blocker.evidenceNeeded.trim() ||
        typeof blocker.resolutionAction !== "string" || !blocker.resolutionAction.trim()) return work;
    // Missing results or an unfinished measurement window are still genuine dated waits.
    if (work.kind === "MEASUREMENT" && (!hasPostChangeEvidence(work.evidence.measurement) ||
        record(record(work.evidence.measurement).windows).ready !== true)) return work;
    return { ...work, state: "READY", nextReviewAt: reviewedAt };
  });
}

/** Due measurements/revisions must not disappear behind hundreds of imported keyword candidates. */
export function scoutCandidates(items: Item[], now = new Date()) {
  const rank = (work: Work) => work.evidence.source === "authority-campaign" && work.evidence.replyKey ? -1 : work.kind === "MEASUREMENT" ? 0 : work.attempts > 0 ? 1 : work.kind === "RELATIONSHIP" ? 2 : work.kind === "RESEARCH" ? (["site-review", "authority-campaign"].includes(String(work.evidence.source)) ? 3 : 4) : 5;
  const due = items.filter(item => isDue(item, now)).sort((a, b) => rank(a) - rank(b) ||
    Number(b.evidence.score ?? 0) - Number(a.evidence.score ?? 0) || Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt));
  const routes = new Set<string>();
  return due.filter(item => {
    if (item.kind !== "PAGE" || !item.route) return true;
    if (items.some(other => other.id !== item.id && other.kind === "PAGE" && other.route === item.route &&
      (other.state === "NEEDS_REVIEW" || (other.state === "WORKING" && !isDue(other, now)) || (other.state === "WAITING" && other.evidence.externalWait)))) return false;
    if (routes.has(item.route)) return false;
    routes.add(item.route);
    return true;
  }).slice(0, 50);
}

export function scoutOutcomes(items: Item[]) {
  return items.filter(item => item.kind !== "RELATIONSHIP" && (item.evidence.measurement || ["DONE", "DISMISSED"].includes(item.state)))
    .sort((a, b) => recent(b) - recent(a)).slice(0, 20).map(item => ({ id: item.id, kind: item.kind, route: item.route,
      title: item.title.slice(0, 250), hypothesis: item.hypothesis.slice(0, 800), state: item.state,
      recordedAt: item.history.at(-1)?.at ?? null,
      measurement: item.kind === "MEASUREMENT" ? item.evidence.measurement ?? null : null,
      interpretation: ["MEASUREMENT", "RESEARCH"].includes(item.kind) ? { recommendation: String(item.artifact?.recommendation ?? "").slice(0, 1500),
        outcome: String(item.artifact?.outcome ?? ""), confidence: String(item.artifact?.confidence ?? ""),
        limitations: String(item.artifact?.limitations ?? "").slice(0, 1000),
        evidence: Array.isArray(item.artifact?.evidence) ? item.artifact.evidence.filter(value => typeof value === "string").slice(0, 8).map(value => value.slice(0, 500)) : [] } : null,
      nextAction: item.nextAction.slice(0, 800),
      decisions: item.history.filter(event => event.action === "OWNER_REVIEW").slice(-3) }));
}

export async function scoutCompetitorEvidence(tenantId: string, now = new Date()) {
  try {
    const cache = await loadWebsiteGrowthSemrushCache(tenantId, now);
    return { status: cache.reports.length || cache.tracking ? "AVAILABLE" : "UNAVAILABLE", collectedAt: now.toISOString(),
      // Reports are individually dated: a fresh position report does not make an old competitor report current.
      reports: cache.reports.slice(0, 5).map(report => ({ reportType: report.reportType, observedAt: report.observedAt,
        fresh: Date.parse(report.observedAt) <= now.getTime() && Date.parse(report.observedAt) >= now.getTime() - 8 * DAY_MS,
        metrics: report.metrics, excerpt: report.excerpt.slice(0, 1500) })),
      tracking: cache.tracking ? { observedAt: cache.observedAt, fresh: cache.fresh,
        domain: cache.tracking.domain, visibility: cache.tracking.visibility, previousVisibility: cache.tracking.previousVisibility,
        trackedKeywords: cache.tracking.trackedKeywords.slice(0, 30) } : null,
      limitation: "Cached Semrush reports may contain competitive signals; they are not a complete competitor watchlist. Verify dated public competitor pages for the current hypothesis. Stale reports are historical context only." };
  } catch {
    return { status: "UNAVAILABLE", collectedAt: now.toISOString(), reports: [], tracking: null,
      limitation: "Competitor reports could not be loaded. Use dated public evidence and state the gap; do not infer competitor performance." };
  }
}

/** Deterministic delivery gate. Supervisor review cannot grant any publishing or sending authority. */
export function supervisorReview(value: unknown) {
  const input = record(value);
  if (!["PASS", "REVISE", "WAIT"].includes(String(input.verdict)) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) return null;
  return { verdict: String(input.verdict), reason: input.reason.trim() };
}
