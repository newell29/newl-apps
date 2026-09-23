import { randomUUID } from "node:crypto";
import { Prisma, WebsiteGrowthOutreachConsentBasis } from "@prisma/client";
import { prisma } from "@/server/db";
import { assertSafeWebsiteGrowthOutreachCopy, buildCompliantWebsiteGrowthOutreachBody, readWebsiteGrowthOutreachIdentity, validateWebsiteGrowthOutreachConsent, fetchWebsiteGrowthPublicContactEvidence, sendWebsiteGrowthOutreachEmail,
  syncWebsiteGrowthOutreachReplies } from "../backlink-outreach";
import { record, ScoutWorkError, text } from "../scout/model";
import { ACTIVE, ACTION_JOB, assertSafeAuthorityEvidence, authorityId, CAMPAIGN_JOB, parsePlan, placementEvidence, priority, publicUrl, readAction,
  samePublisher, transition, WAKE_JOB, type Action, type Campaign, type Plan } from "./model";

import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import { createAndSendMicrosoftGraphMailboxMessage } from "@/server/integrations/microsoft-graph-mail";

type DB = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const campaignKey = (tenantId: string) => authorityId(tenantId, "pilot");
export async function authorityCampaign(tenantId: string, db: DB = prisma) {
  const job = await db.automationJobRun.findFirst({ where: { tenantId, id: campaignKey(tenantId), jobType: CAMPAIGN_JOB } });
  const input = record(job?.input);
  return input.version === 1 && typeof input.title === "string" && typeof input.targetPage === "string" ? { id: job!.id, ...input as unknown as Campaign } : null;
}
export async function rejectLegacyAuthority(tenantId: string) {
  if (await authorityCampaign(tenantId)) throw new ScoutWorkError("The previous backlink executor is retired. Use the campaign's exact approved action.", 409);
}
export async function saveAuthorityCampaign(tenantId: string, userId: string, value: unknown) {
  const p = record(value), previous = await authorityCampaign(tenantId);
  const campaign: Campaign = { version: 1, enabled: p.enabled === true,
    title: text(p.title, "Campaign title", 200), targetPage: publicUrl(p.targetPage, "Target page"),
    assetUrl: publicUrl(p.assetUrl, "Public asset"), audience: text(p.audience, "Audience", 1500),
    hypothesis: text(p.hypothesis, "Campaign hypothesis", 2000),
    startedAt: previous?.startedAt ?? new Date().toISOString(), success: text(p.success, "Success criteria", 2000) };
  await prisma.$transaction(async tx => {
    // A cutover must not race an old browser submission.
    if (!previous && await tx.websiteGrowthBacklinkOpportunity.count({ where: { tenantId, status: "IN_PROGRESS" } })) {
      throw new ScoutWorkError("Reconcile in-progress legacy submissions before retiring the previous executor.", 409);
    }
    await tx.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id: campaignKey(tenantId) } },
      create: { tenantId, id: campaignKey(tenantId), jobType: CAMPAIGN_JOB, status: "SUCCESS", input: json(campaign) }, update: { input: json(campaign) } });
    await audit(tx, tenantId, userId, "campaign-saved", campaignKey(tenantId), { enabled: campaign.enabled, legacyRetired: true });
  }, { isolationLevel: "Serializable" });
}
export async function authorityWorkspace(tenantId: string, db: DB = prisma) {
  const [campaign, jobs, wake, opportunities] = await Promise.all([
    authorityCampaign(tenantId, db),
    db.automationJobRun.findMany({ where: { tenantId, jobType: ACTION_JOB }, orderBy: { createdAt: "desc" }, take: 500 }),
    db.automationJobRun.findFirst({ where: { tenantId, jobType: WAKE_JOB }, orderBy: { startedAt: "desc" } }),
    db.websiteGrowthBacklinkOpportunity.findMany({ where: { tenantId, status: { notIn: ["ARCHIVED", "REJECTED", "LOST"] } },
      orderBy: [{ lastReplyAt: "desc" }, { qualityScore: "desc" }], take: 80,
      include: { messages: { where: { tenantId }, orderBy: { sentAt: "desc" }, take: 3 } } })
  ]);
  const actions = jobs.flatMap(j => { const a = readAction(j.output); return a ? [{ id: j.id, ...a }] : []; });
  return { campaign, actions, wake: wake ? { at: wake.startedAt, status: wake.status, output: wake.output } : null,
    opportunities, truncated: jobs.length === 500 || opportunities.length === 80 };
}
export async function authorityResearchContext(tenantId: string) {
  const workspace = await authorityWorkspace(tenantId);
  return { ...workspace, rule: "Prioritize new positive replies, due follow-ups and placement checks before discovery. Prepare at most three exact feasible actions. Do not re-propose an active or uncertain action. A reply offering a directory submission needs a submission plan, not another generic email. Return MANUAL only for a genuine owner-only step. Never invent company facts, facilities, permission, or terms. Retire no-path prospects with an explicit reason. First finish useful ungated assets through an existing PAGE proposal. Observed links, replies and enquiries are separate results; never claim causation from before/after movement.",
    capabilities: { email: "Exact individually approved copy through Microsoft 365; CA/US only with consent evidence.",
      forms: "Free guest submissions only, exact fields and terms reviewed before approval. Account creation, phone, CAPTCHA, MFA, paid/reciprocal terms and unknown legal terms require a named human step.",
      verify: "Server checks a public publisher page for an actual link to the exact target page. A blocked fetch is unavailable, not a lost link." } };
}
/** Called inside the research completion transaction; creates proposals, never execution authority. */
export async function proposeAuthorityActions(db: DB, tenantId: string, proposals: unknown, now = new Date()) {
  const campaign = await authorityCampaign(tenantId, db);
  if (!campaign?.enabled) throw new ScoutWorkError("Authority campaign is paused.", 409);
  if (!Array.isArray(proposals) || proposals.length > 3) throw new ScoutWorkError("Prepare at most three authority actions per research step.");
  const saved: string[] = [];
  for (const value of proposals) {
    const plan = parsePlan(value, now);
    const opportunity = await db.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: plan.opportunityId,
      unsubscribedAt: null, status: { notIn: ["REJECTED", "ARCHIVED", "LOST"] }, category: { not: "PAID_PLACEMENT" } } });
    if (!opportunity) throw new ScoutWorkError("The publisher is no longer eligible.", 409);
    if (!samePublisher(plan.route, opportunity.sourceDomain) || (plan.termsUrl && !samePublisher(plan.termsUrl, opportunity.sourceDomain))) {
      throw new ScoutWorkError("Use a verified route and terms on the publisher's domain. Third-party forms need human review.");
    }
    const existing = await db.automationJobRun.findMany({ where: { tenantId, jobType: ACTION_JOB,
      output: { path: ["plan", "opportunityId"], equals: plan.opportunityId } }, take: 100 });
    if (existing.some(job => ACTIVE.includes(readAction(job.output)?.state ?? ""))) continue;
    const history = existing.flatMap(job => { const a = readAction(job.output); return a ? [a] : []; });
    if (plan.method === "REPLY" && history.some(a => a.plan.method === "REPLY" && a.replyAt === opportunity.lastReplyAt?.toISOString() && a.startedAt)) {
      throw new ScoutWorkError("The latest reply already has an attempted response. Wait for a new reply or reconcile the previous action.", 409);
    }
    if (plan.method === "FORM" && (opportunity.submittedAt || history.some(a => a.plan.method === "FORM" && a.startedAt))) {
      throw new ScoutWorkError("A submission was already attempted. Verify or reconcile it instead of submitting again.", 409);
    }
    if (plan.method === "EMAIL" && opportunity.contactedAt) throw new ScoutWorkError("This publisher has already been contacted. Prepare a follow-up or submission instead.");
    if (plan.method === "FOLLOW_UP" && (opportunity.status !== "CONTACTED" || !opportunity.nextFollowUpAt || opportunity.nextFollowUpAt > now || opportunity.lastReplyAt)) {
      throw new ScoutWorkError("Follow-up is not due or the publisher has replied. Review the latest conversation.");
    }
    if (plan.method === "REPLY" && (opportunity.status !== "REPLIED" || !opportunity.lastReplyAt || plan.recipientEmail !== opportunity.recipientEmail?.toLowerCase())) throw new ScoutWorkError("Respond only to the latest recorded publisher and recipient.");
    if (["FOLLOW_UP", "REPLY"].includes(plan.method) && (plan.recipientEmail !== opportunity.recipientEmail?.toLowerCase() || plan.recipientCountry !== opportunity.recipientCountry || plan.consentBasis !== opportunity.consentBasis)) throw new ScoutWorkError("Retain the verified recipient, country and consent for an existing conversation.");
    if (plan.method === "EMAIL" || plan.method === "FOLLOW_UP" || plan.method === "REPLY") {
      if (!Object.values(WebsiteGrowthOutreachConsentBasis).includes(plan.consentBasis as WebsiteGrowthOutreachConsentBasis)) throw new ScoutWorkError("Select a supported consent basis.");
      assertSafeWebsiteGrowthOutreachCopy(plan.subject); assertSafeWebsiteGrowthOutreachCopy(plan.body);
    }
    const id = authorityId(tenantId, `action:${plan.opportunityId}:${opportunity.updatedAt.toISOString()}:${JSON.stringify(plan)}`);
    const action: Action = { version: 1, revision: 0, campaignId: campaign.id, title: opportunity.title, plan,
      sourceUpdatedAt: opportunity.updatedAt.toISOString(), replyAt: opportunity.lastReplyAt?.toISOString() ?? null, state: plan.method === "VERIFY" ? "APPROVED" : "REVIEW",
      approvedBy: null, approvedAt: null, claimId: null, lease: null, leaseUntil: null, startedAt: null,
      result: "Prepared from dated feasibility evidence.", liveUrl: null, finishedAt: null,
      history: [{ at: now.toISOString(), event: "PREPARED", detail: plan.reason }] };
    await db.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id } }, create: {
      tenantId, id, jobType: ACTION_JOB, status: "QUEUED", output: json(action) }, update: {} });
    saved.push(id);
  }
  return saved;
}
async function getAction(db: DB, tenantId: string, id: string) {
  const job = await db.automationJobRun.findFirst({ where: { tenantId, id, jobType: ACTION_JOB } });
  const action = readAction(job?.output);
  if (!action) throw new ScoutWorkError("Authority action was not found.", 404);
  return action;
}
async function replace(db: DB, tenantId: string, id: string, old: Action, next: Action) {
  const result = await db.automationJobRun.updateMany({ where: { tenantId, id, jobType: ACTION_JOB,
    output: { path: ["revision"], equals: old.revision } }, data: { output: json(next),
      status: next.state === "RUNNING" ? "RUNNING" : ["BLOCKED", "UNCERTAIN"].includes(next.state) ? "ERROR" : "SUCCESS" } });
  if (result.count !== 1) throw new ScoutWorkError("The action changed. Reload its current state.", 409);
  return next;
}
async function audit(db: DB, tenantId: string, userId: string | null, action: string, id: string, after: unknown) {
  await db.auditLog.create({ data: { tenantId, actorUserId: userId, action: `website-growth.authority.${action}`,
    entityType: "AutomationJobRun", entityId: id, after: json(after) } });
}
export async function reviewAuthorityAction(tenantId: string, userId: string, id: string, revision: number, decision: string, feedback: string) {
  return prisma.$transaction(async tx => {
    const a = await getAction(tx, tenantId, id);
    if (a.revision !== revision || !["REVIEW", "BLOCKED", "UNCERTAIN"].includes(a.state)) throw new ScoutWorkError("This review is no longer current.", 409);
    if (!["APPROVE", "CLOSE", "REVISE", "RESOLVE"].includes(decision)) throw new ScoutWorkError("Choose an authority review decision.");
    if (a.state === "UNCERTAIN" && decision !== "RESOLVE") throw new ScoutWorkError("Reconcile the mailbox or publisher receipt first. Record the evidence to resolve this hold.");
    if (decision === "RESOLVE" && a.state !== "UNCERTAIN") throw new ScoutWorkError("Only uncertain actions need reconciliation.");
    if (decision === "APPROVE") {
      if (a.state !== "REVIEW" || a.plan.method === "MANUAL") throw new ScoutWorkError("Only a fresh executable proposal can be approved.");
      parsePlan(a.plan); // stale feasibility cannot be approved
      const source = await tx.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: a.plan.opportunityId, unsubscribedAt: null } });
      if (!source || source.updatedAt.toISOString() !== a.sourceUpdatedAt) throw new ScoutWorkError("Publisher evidence changed. Send this proposal back for a fresh review.", 409);
      // Existing email guards still require explicit opportunity authority.
      const updated = await tx.websiteGrowthBacklinkOpportunity.updateMany({ where: { tenantId, id: source.id, updatedAt: source.updatedAt },
        data: { approvedAt: new Date(), approvedByUserId: userId,
          ...(a.plan.method === "EMAIL" ? { status: "APPROVED" as const } : {}) } });
      if (updated.count !== 1) throw new ScoutWorkError("The publisher changed during approval.", 409);
      const refreshed = await tx.websiteGrowthBacklinkOpportunity.findFirstOrThrow({ where: { tenantId, id: source.id } });
      a.sourceUpdatedAt = refreshed.updatedAt.toISOString();
    }
    const detail = text(feedback, "Review or reconciliation evidence", 2000);
    const next = transition(a, { state: decision === "APPROVE" ? "APPROVED" : "CLOSED",
      approvedBy: decision === "APPROVE" ? userId : a.approvedBy, approvedAt: decision === "APPROVE" ? new Date().toISOString() : a.approvedAt,
      result: detail }, decision, detail);
    await replace(tx, tenantId, id, a, next);
    await audit(tx, tenantId, userId, decision.toLowerCase(), id, { revision, detail });
    return next;
  }, { isolationLevel: "Serializable" });
}
export async function prepareAuthorityExecution(tenantId: string, now = new Date()) {
  const campaign = await authorityCampaign(tenantId);
  if (!campaign?.enabled) return { campaignEnabled: false, ready: 0, reason: "Campaign paused or not configured.", sync: "SKIPPED" };
  let sync = "OK";
  try { await syncWebsiteGrowthOutreachReplies({ tenantId, now }); } catch { sync = "UNAVAILABLE"; }
  const workspace = await authorityWorkspace(tenantId);
  for (const a of workspace.actions.filter(a => a.state === "RUNNING" && Date.parse(a.leaseUntil ?? "") <= now.getTime())) {
    const state = a.startedAt ? "UNCERTAIN" : "BLOCKED";
    const result = a.startedAt ? "Execution was interrupted after external action was reserved. Check publisher or mailbox evidence; never automatically repeat." : "Execution lease expired before external action. Request a fresh proposal.";
    await replace(prisma, tenantId, a.id, a, transition(a, { state, result }, "LEASE_EXPIRED", result, now)).catch(error => { if (!(error instanceof ScoutWorkError && error.status === 409)) throw error; });
  }
  const ready = workspace.actions.filter(a => a.state === "APPROVED").length;
  const reason = ready ? "Approved actions are ready." : "No approved action is ready. Scout continues research on its separate saved budget.";
  await prisma.automationJobRun.create({ data: { tenantId, jobType: WAKE_JOB, status: sync === "OK" ? "SUCCESS" : "ERROR",
    startedAt: now, finishedAt: new Date(), output: json({ ready, reason, sync }) } });
  return { campaignEnabled: true, ready, reason, sync };
}
export async function claimAuthorityAction(tenantId: string, claimId: string, now = new Date()) {
  text(claimId, "Claim ID", 100);
  return prisma.$transaction(async tx => {
    const campaign = await authorityCampaign(tenantId, tx);
    if (!campaign?.enabled) return null;
    const jobs = await tx.automationJobRun.findMany({ where: { tenantId, jobType: ACTION_JOB }, orderBy: { createdAt: "asc" }, take: 501 });
    if (jobs.length > 500) throw new ScoutWorkError("Archive reviewed campaign history before accepting more execution work.", 409);
    const actions = jobs.flatMap(j => { const a = readAction(j.output); return a ? [{ id: j.id, ...a }] : []; });
    const previous = actions.find(a => a.claimId === claimId);
    if (previous) {
      if (previous.state === "RUNNING" && Date.parse(previous.leaseUntil ?? "") > now.getTime()) return previous;
      throw new ScoutWorkError("This claim already finished. Prepare a fresh wake.", 409);
    }
    // One external action per tenant at a time, including a held ambiguous action.
    if (actions.some(a => a.state === "RUNNING")) return null;
    const candidate = actions.filter(a => a.state === "APPROVED").sort((a, b) => priority(a) - priority(b))[0];
    if (!candidate) return null;
    if (candidate.plan.method !== "VERIFY" && (!candidate.approvedBy || !candidate.approvedAt)) throw new ScoutWorkError("Exact human approval is missing.", 409);
    const claimed = transition(candidate, { state: "RUNNING", claimId, lease: randomUUID(), leaseUntil: new Date(now.getTime() + 15 * 60_000).toISOString() }, "CLAIMED", "One bounded execution attempt claimed.", now);
    await replace(tx, tenantId, candidate.id, candidate, claimed);
    await audit(tx, tenantId, null, "claimed", candidate.id, { claimId });
    return { id: candidate.id, ...claimed };
  }, { isolationLevel: "Serializable" });
}
async function leased(db: DB, tenantId: string, id: string, lease: string) {
  const a = await getAction(db, tenantId, id);
  if (a.state !== "RUNNING" || a.lease !== lease || Date.parse(a.leaseUntil ?? "") <= Date.now()) throw new ScoutWorkError("The execution lease is no longer valid.", 409);
  return a;
}
/** Reservation occurs once, immediately before the external action; a second begin never grants authority. */
export async function beginAuthorityAction(tenantId: string, id: string, lease: string) {
  await syncWebsiteGrowthOutreachReplies({ tenantId }); // fail closed before communication if mailbox sync is unavailable
  return prisma.$transaction(async tx => {
    if (!(await authorityCampaign(tenantId, tx))?.enabled) throw new ScoutWorkError("Campaign was paused.", 409);
    const a = await leased(tx, tenantId, id, lease);
    if (a.startedAt || !a.approvedBy || !a.approvedAt || !["EMAIL", "FOLLOW_UP", "REPLY", "FORM"].includes(a.plan.method)) throw new ScoutWorkError("External action was already reserved or is not approved.", 409);
    parsePlan(a.plan);
    const source = await tx.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: a.plan.opportunityId, unsubscribedAt: null } });
    if (!source || source.updatedAt.toISOString() !== a.sourceUpdatedAt) throw new ScoutWorkError("Conversation or publisher evidence changed. Prepare the next action again.", 409);
    if (a.plan.recipientEmail && await tx.websiteGrowthOutreachSuppression.findUnique({ where: { tenantId_normalizedEmail: { tenantId, normalizedEmail: a.plan.recipientEmail } } })) throw new ScoutWorkError("This contact opted out.", 409);
    const next = transition(a, { startedAt: new Date().toISOString() }, "EXTERNAL_RESERVED", "Exact approved action reserved. Do not repeat it.");
    await replace(tx, tenantId, id, a, next);
    await audit(tx, tenantId, null, "external-reserved", id, { approvedBy: a.approvedBy, approvedAt: a.approvedAt });
    return next;
  }, { isolationLevel: "Serializable" });
}
export async function finishAuthorityAction(tenantId: string, id: string, lease: string, value: unknown) {
  const input = record(value), detail = text(input.detail, "Execution evidence", 2000);
  assertSafeAuthorityEvidence(detail);
  if (!["SUBMITTED", "BLOCKED", "UNCERTAIN"].includes(String(input.state))) throw new ScoutWorkError("Browser reports can record submitted, blocked or uncertain; only server verification records live.");
  return prisma.$transaction(async tx => {
    const a = await getAction(tx, tenantId, id);
    if (a.lease === lease && a.finishedAt) return a; // lost acknowledgement, never repeat external action
    await leased(tx, tenantId, id, lease);
    if (input.state === "SUBMITTED" && (!a.startedAt || a.plan.method !== "FORM")) throw new ScoutWorkError("No approved form submission was reserved.", 409);
    const state = input.state === "SUBMITTED" ? "SUBMITTED" : a.startedAt ? "UNCERTAIN" : "BLOCKED";
    const next = transition(a, { state, result: detail, finishedAt: new Date().toISOString() }, "REPORTED", detail);
    await replace(tx, tenantId, id, a, next);
    if (state === "SUBMITTED") await tx.websiteGrowthBacklinkOpportunity.updateMany({ where: { tenantId, id: a.plan.opportunityId }, data: { status: "SUBMITTED", submittedAt: new Date(), notes: detail } });
    await audit(tx, tenantId, null, "reported", id, { state, detail });
    return next;
  });
}
export async function executeAuthorityAction(tenantId: string, id: string, lease: string) {
  const a = await leased(prisma, tenantId, id, lease);
  if (a.plan.method === "FORM") return { browserRequired: true, action: a };
  try {
    if (a.plan.method === "VERIFY") {
      const source = await prisma.websiteGrowthBacklinkOpportunity.findFirstOrThrow({ where: { tenantId, id: a.plan.opportunityId } });
      const target = source.targetPage.startsWith("/") ? `https://www.newlgroup.com${source.targetPage}` : source.targetPage;
      const evidence = placementEvidence(await fetchWebsiteGrowthPublicContactEvidence(a.plan.route), a.plan.route, target);
      const result = evidence ? `Verified public link: ${JSON.stringify(evidence)}` : "The fetched page contains no matching link. This does not prove removal from other publisher pages.";
      await prisma.$transaction(async tx => {
        const current = await leased(tx, tenantId, id, lease);
        await replace(tx, tenantId, id, current, transition(current, { state: evidence ? "LIVE" : "CLOSED", result,
          liveUrl: evidence ? a.plan.route : null, finishedAt: new Date().toISOString() }, "VERIFIED", result));
        if (evidence) await tx.websiteGrowthBacklinkOpportunity.updateMany({ where: { tenantId, id: a.plan.opportunityId },
          data: { status: "LIVE", liveUrl: a.plan.route, verifiedAt: source.verifiedAt ?? new Date(), lastVerifiedAt: new Date() } });
        await audit(tx, tenantId, null, "verified", id, { found: Boolean(evidence) });
      });
      return { state: evidence ? "LIVE" : "CLOSED", result };
    }
    if (a.plan.method !== "EMAIL" && a.plan.method !== "FOLLOW_UP" && a.plan.method !== "REPLY") throw new ScoutWorkError("This action requires a human.");
    await beginAuthorityAction(tenantId, id, lease);
    const plan: Plan = a.plan;
    if (plan.method === "REPLY") await sendAuthorityReply(tenantId, id, plan);
    else await sendWebsiteGrowthOutreachEmail({ tenantId, input: { opportunityId: plan.opportunityId,
      kind: plan.method === "EMAIL" ? "INITIAL" : "FOLLOW_UP", recipientEmail: plan.recipientEmail,
      recipientCountry: plan.recipientCountry as "CA" | "US", contactSourceUrl: plan.route,
      consentBasis: plan.consentBasis as WebsiteGrowthOutreachConsentBasis, subject: plan.subject, body: plan.body } });
    const current = await leased(prisma, tenantId, id, lease);
    const result = "Microsoft 365 accepted the exact approved message. Delivery, reply and placement remain separate outcomes.";
    await replace(prisma, tenantId, id, current, transition(current, { state: "SUBMITTED", result, finishedAt: new Date().toISOString() }, "EMAIL_ACCEPTED", result));
    return { state: "SUBMITTED", result };
  } catch (error) {
    // Never leak Graph/provider response bodies. Detailed operational state stays on the scoped item.
    const http = error instanceof Error ? /public contact source.*\((\d{3})\)/i.exec(error.message) : null;
    const detail = error instanceof ScoutWorkError ? error.message : http ? `Public publisher evidence is unavailable (HTTP ${http[1]}). Verify the current source URL; this is not proof that the link was removed.` : "The execution could not be confirmed. Check the source evidence and mailbox before another attempt.";
    await finishAuthorityAction(tenantId, id, lease, { state: "BLOCKED", detail });
    return { state: (await getAction(prisma, tenantId, id)).state, result: detail };
  }
}
export function authorityOutcomes(actions: Array<Action & { id: string }>) {
  const approved = actions.filter(a => a.approvedAt);
  return { prepared: actions.length, approved: approved.length, completed: actions.filter(a => a.state === "SUBMITTED").length,
    verifiedPlacements: new Set(actions.filter(a => a.state === "LIVE").map(a => a.plan.opportunityId)).size,
    blockedApproved: approved.filter(a => ["BLOCKED", "UNCERTAIN"].includes(a.state)).length,
    limitation: "Completed actions are activity. Verified placements are observed links, not proof of SEO lift. Referral/qualified-enquiry attribution is not yet available by publisher." };
}

export async function authorityExecutionStatus(tenantId: string, id: string, lease: string) {
  const action = await getAction(prisma, tenantId, id);
  if (action.lease !== lease) throw new ScoutWorkError("Execution identity does not match.", 409);
  return { state: action.state, result: action.result, finishedAt: action.finishedAt, startedAt: action.startedAt };
}

async function sendAuthorityReply(tenantId: string, id: string, plan: Plan) {
  const recipientCountry = plan.recipientCountry as "CA" | "US";
  validateWebsiteGrowthOutreachConsent({ recipientCountry, consentBasis: plan.consentBasis as WebsiteGrowthOutreachConsentBasis, contactSourceUrl: plan.route });
  const identity = readWebsiteGrowthOutreachIdentity();
  const body = buildCompliantWebsiteGrowthOutreachBody({ body: plan.body, country: recipientCountry, identity });
  const messageId = authorityId(tenantId, `reply:${id}`);
  await prisma.$transaction(async tx => {
    const count = await tx.websiteGrowthOutreachMessage.count({ where: { tenantId, kind: "FOLLOW_UP", sentAt: { gte: new Date(Date.now() - 86400_000) } } });
    if (count >= 10) throw new ScoutWorkError("Daily response limit reached.", 409);
    await tx.websiteGrowthOutreachMessage.create({ data: { id: messageId, tenantId, opportunityId: plan.opportunityId,
      kind: "FOLLOW_UP", recipientEmail: plan.recipientEmail, subject: plan.subject, body } });
  }, { isolationLevel: "Serializable" });
  const token = await getMicrosoftGraphApplicationAccessToken();
  const sent = await createAndSendMicrosoftGraphMailboxMessage(token, identity.mailbox, { recipientEmail: plan.recipientEmail, subject: plan.subject, body });
  await prisma.websiteGrowthOutreachMessage.updateMany({ where: { tenantId, id: messageId }, data: { externalMessageId: sent.id ?? `graph-sendmail-accepted:${messageId}`, conversationId: sent.conversationId } });
}
