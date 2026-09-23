import { createHash } from "node:crypto";
import { record, ScoutWorkError, text } from "../scout/model";

export const CAMPAIGN_JOB = "website-growth.authority.campaign.v1";
export const ACTION_JOB = "website-growth.authority.action.v1";
export const WAKE_JOB = "website-growth.authority.wake.v1";
export const METHODS = ["EMAIL", "FOLLOW_UP", "REPLY", "FORM", "VERIFY", "MANUAL"] as const;
export type Method = typeof METHODS[number];
export const ACTIVE = ["REVIEW", "APPROVED", "RUNNING", "UNCERTAIN"];
export type Campaign = {
  version: 1; enabled: boolean; title: string; targetPage: string; assetUrl: string;
  audience: string; hypothesis: string; startedAt: string; success: string;
};
export type Plan = {
  opportunityId: string; method: Method; route: string; recipientEmail: string;
  recipientCountry: "CA" | "US" | ""; consentBasis: string; subject: string; body: string;
  fields: Array<{ label: string; value: string }>; evidence: string; checkedAt: string;
  completion: string; reason: string; free: boolean; accountRequired: boolean; termsUrl: string;
};
export type Action = {
  version: 1; revision: number; campaignId: string; title: string; plan: Plan;
  state: "REVIEW" | "APPROVED" | "RUNNING" | "SUBMITTED" | "BLOCKED" | "UNCERTAIN" | "LIVE" | "CLOSED";
  sourceUpdatedAt: string; replyAt: string | null; approvedBy: string | null; approvedAt: string | null;
  claimId: string | null; lease: string | null; leaseUntil: string | null; startedAt: string | null;
  result: string; liveUrl: string | null; finishedAt: string | null;
  history: Array<{ at: string; event: string; detail: string }>;
};
export function authorityId(tenantId: string, key: string) {
  return `authority_${createHash("sha256").update(`${tenantId}:${key}`).digest("hex").slice(0, 40)}`;
}
export function publicUrl(value: unknown, name = "URL") {
  const raw = text(value, name, 1000);
  let url: URL;
  try { url = new URL(raw); } catch { throw new ScoutWorkError(`${name} must be a public HTTPS URL.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !url.hostname.includes(".") || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) ||
      /^[\d.:\[\]]+$/.test(url.hostname) || /(?:token|secret|password|code|key)=/i.test(url.search)) {
    throw new ScoutWorkError(`${name} must be a public HTTPS URL without credentials.`);
  }
  return url.href;
}
export function samePublisher(url: string, domain: string) {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  const source = domain.toLowerCase().replace(/^www\./, "");
  return hostname === source || hostname.endsWith(`.${source}`);
}
export function assertSafeAuthorityEvidence(value: string) {
  // Block credential values without rejecting useful blockers such as "phone verification required".
  if (/(?:password|passcode|secret|access[_ -]?token|api[_ -]?key)\s*[:=]\s*\S{6,}|\bBearer\s+[A-Za-z0-9._-]{12,}|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\./i.test(value)) {
    throw new ScoutWorkError("Remove credential values from the action evidence; describe the required human step only.");
  }
}
export function parsePlan(value: unknown, now = new Date()): Plan {
  const p = record(value);
  assertSafeAuthorityEvidence(JSON.stringify(p));
  const method = String(p.method) as Method;
  if (!METHODS.includes(method)) throw new ScoutWorkError("Choose a supported authority action.");
  const checked = Date.parse(String(p.checkedAt));
  if (!Number.isFinite(checked) || checked > now.getTime() + 60_000 || checked < now.getTime() - 7 * 86400_000) {
    throw new ScoutWorkError("Feasibility needs dated evidence from the last seven days.");
  }
  const optional = (key: string, max = 4000) => p[key] ? text(p[key], key, max) : "";
  const fields = Array.isArray(p.fields) ? p.fields.map(item => {
    const f = record(item);
    const label = text(f.label, "Field label", 200), value = text(f.value, "Field value", 4000);
    if (/password|secret|token|credit.card|captcha|verification.code/i.test(label)) throw new ScoutWorkError("Protected fields cannot be included in a submission plan.");
    return { label, value };
  }) : [];
  if (fields.length > 25 || new Set(fields.map(f => f.label.toLowerCase())).size !== fields.length) throw new ScoutWorkError("Use at most 25 distinct form fields.");
  const result: Plan = { opportunityId: text(p.opportunityId, "Opportunity", 100), method,
    route: publicUrl(p.route, "Submission or source URL"), recipientEmail: optional("recipientEmail", 320).toLowerCase(),
    recipientCountry: p.recipientCountry === "CA" || p.recipientCountry === "US" ? p.recipientCountry : "",
    consentBasis: optional("consentBasis", 100), subject: optional("subject", 180), body: optional("body"), fields,
    evidence: text(p.evidence, "Observed feasibility evidence", 3000), checkedAt: new Date(checked).toISOString(),
    completion: text(p.completion, "Completion evidence required", 1500), reason: text(p.reason, "Business reason", 1500),
    free: p.free === true, accountRequired: p.accountRequired === true, termsUrl: p.termsUrl ? publicUrl(p.termsUrl, "Terms URL") : "" };
  if (method === "EMAIL" || method === "FOLLOW_UP" || method === "REPLY") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.recipientEmail) || !result.recipientCountry || !result.consentBasis || !result.subject || !result.body) {
      throw new ScoutWorkError("Email needs the exact recipient, country, consent evidence, subject and copy.");
    }
  }
  if (method === "FORM" && (!fields.length || !result.termsUrl)) throw new ScoutWorkError("A form needs exact field values and reviewed terms.");
  if (method !== "MANUAL" && (!result.free || result.accountRequired)) throw new ScoutWorkError("Paid or account-dependent work belongs in the human-action lane.");
  return result;
}
export function readAction(value: unknown): Action | null {
  const a = record(value);
  return a.version === 1 && Number.isInteger(a.revision) && record(a.plan).opportunityId ? a as unknown as Action : null;
}
export function transition(action: Action, changes: Partial<Action>, event: string, detail: string, now = new Date()): Action {
  return { ...action, ...changes, revision: action.revision + 1,
    history: [...action.history, { at: now.toISOString(), event, detail }].slice(-40) };
}
export function priority(action: Action) {
  return action.plan.method === "REPLY" ? -1 : action.plan.method === "VERIFY" ? 0 : action.plan.method === "FOLLOW_UP" ? 1 : 2;
}
/** Inspect actual anchor elements; scripts, comments and plain-text URL mentions are not placements. */
export function placementEvidence(html: string, sourceUrl: string, targetPage: string) {
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const target = new URL(targetPage);
  const matches = [...clean.matchAll(/<a\b([^>]*?)>([\s\S]*?)<\/a\s*>/gi)];
  for (const match of matches) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[1]);
    if (!href) continue;
    let url: URL;
    try { url = new URL((href[1] ?? href[2]).replace(/&amp;/gi, "&"), sourceUrl); } catch { continue; }
    if (url.protocol === "https:" && url.hostname.replace(/^www\./, "") === target.hostname.replace(/^www\./, "") &&
        url.pathname.replace(/\/$/, "") === target.pathname.replace(/\/$/, "")) {
      const rel = /\brel\s*=\s*["']([^"']*)/i.exec(match[1])?.[1] ?? "";
      return { href: url.href, rel, anchor: match[2].replace(/<[^>]+>/g, " ").trim().slice(0, 300) };
    }
  }
  return null;
}
