import { randomUUID } from "node:crypto";
import { JobStatus, Prisma, WebsiteGrowthAction, WebsiteGrowthContentDraftSource } from "@prisma/client";
import { prisma } from "@/server/db";
import { resolveNewlWebsiteContext } from "@/modules/website-growth/newl-website-context-scanner";
import { parseWebsiteGrowthScoutCompletion } from "@/modules/website-growth/scout-run";
import { parseWebsiteGrowthBacklinkReview, persistWebsiteGrowthBacklinkReview } from "@/modules/website-growth/backlinks";
import { measurementWindows, measureScoutPage } from "./measurement";
import { DEFAULT_MISSION, MISSION_JOB, WORK_JOB, STEP_JOB, LEASE_MS, DAY_MS, ScoutWorkError,
  isDue, newWork, nextWork, parseMission, parseResult, readWork, record, routePath, stableId, text,
  type Work } from "./model";

type Client = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function scoutWorkspace(tenantId: string) {
  const [missionJob, jobs] = await Promise.all([
    prisma.automationJobRun.findFirst({ where: { tenantId, id: stableId(tenantId, "mission"), jobType: MISSION_JOB } }),
    prisma.automationJobRun.findMany({ where: { tenantId, jobType: WORK_JOB }, orderBy: { createdAt: "desc" }, take: 1000 })
  ]);
  const mission = missionJob ? parseMission(missionJob.input) : DEFAULT_MISSION;
  const items = jobs.flatMap(job => { const work = readWork(job.output); return work ? [{ id: job.id, ...work }] : []; });
  const usedSteps = await prisma.automationJobRun.count({ where: { tenantId, jobType: STEP_JOB,
    startedAt: { gte: new Date(Date.now() - DAY_MS) } } });
  const active = items.filter(item => item.state === "NEEDS_REVIEW" || (item.state === "WORKING" && Date.parse(item.leaseUntil ?? "") > Date.now())).length;
  return { mission, configured: Boolean(missionJob), items, truncated: jobs.length === 1000,
    capacity: { usedSteps, active, available: usedSteps < mission.dailySteps && active < mission.maxActive } };
}
export async function saveScoutMission(tenantId: string, userId: string, input: unknown) {
  const mission = parseMission(input);
  await prisma.$transaction(async tx => {
    await tx.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id: stableId(tenantId, "mission") } },
      create: { id: stableId(tenantId, "mission"), tenantId, jobType: MISSION_JOB, status: JobStatus.SUCCESS, input: json(mission) },
      update: { input: json(mission) } });
    await audit(tx, tenantId, userId, "mission-saved", stableId(tenantId, "mission"), { enabled: mission.enabled });
  });
}

/** Idempotent reconciliation creates work; it never sends, approves, or changes source decisions. */
export async function reconcileScoutWork(tenantId: string, now = new Date()) {
  await reconcilePageHandoffs(tenantId);
  await reconcileRelationshipHandoffs(tenantId);
  const [pages, replies, published] = await Promise.all([
    prisma.websiteGrowthOpportunity.findMany({ where: { tenantId, status: { in: ["NEW", "REVIEWING"] }, contentDrafts: { none: {} },
      action: { notIn: ["IGNORE", "MONITOR"] } }, orderBy: [{ score: "desc" }, { updatedAt: "asc" }], take: 60 }),
    prisma.websiteGrowthBacklinkOpportunity.findMany({ where: { tenantId, status: "REPLIED", unsubscribedAt: null },
      orderBy: { lastReplyAt: "desc" }, take: 40, select: { id: true, title: true, targetPage: true, lastReplyAt: true,
        sourceDomain: true, sourceUrl: true, outreachAngle: true } }),
    prisma.websiteGrowthContentDraft.findMany({ where: { tenantId, status: "PUBLISHED", publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" }, take: 60, select: { id: true, title: true, proposedPath: true, targetPage: true, publishedAt: true } })
  ]);
  for (const page of pages) await ensureWork(tenantId, `page:${page.id}`, newWork("PAGE", page.id, page.topic,
    page.reason, safePath(page.targetPage ?? page.sourcePage), { source: "existing-opportunity", score: page.score }, now));
  for (const reply of replies) await ensureWork(tenantId, `reply:${reply.id}:${reply.lastReplyAt?.toISOString()}`, newWork("RELATIONSHIP", reply.id,
    `Continue: ${reply.title}`, "A publisher replied. Review the conversation and prepare a useful next response.", safePath(reply.targetPage),
    { sourceDomain: reply.sourceDomain, sourceUrl: reply.sourceUrl, replyAt: reply.lastReplyAt?.toISOString() ?? null }, now));
  for (const draft of published) {
    const route = safePath(draft.proposedPath ?? draft.targetPage);
    if (!route || !draft.publishedAt) continue;
    const work = newWork("MEASUREMENT", draft.id, `Measure: ${draft.title}`, "Evaluate the page against its pre-publication baseline and propose the next action.", route,
      { publishedAt: draft.publishedAt.toISOString() }, now);
    work.nextReviewAt = measurementWindows(draft.publishedAt, now).readyAt;
    work.state = "WAITING";
    await ensureWork(tenantId, `measurement:${draft.id}:${draft.publishedAt.toISOString()}`, work);
  }
  // Keep one open research brief, replenished by completed work rather than a calendar quota.
  const latestResearch = await prisma.automationJobRun.findFirst({ where: { tenantId, jobType: WORK_JOB,
    output: { path: ["kind"], equals: "RESEARCH" } }, orderBy: { createdAt: "desc" } });
  const previousResearch = readWork(latestResearch?.output);
  if (!previousResearch || ["DONE", "DISMISSED"].includes(previousResearch.state)) {
    await ensureWork(tenantId, `research:after:${latestResearch?.id ?? "initial"}`, newWork("RESEARCH", null, "Find the next valuable inbound opportunity",
      "Use the owner's priorities, previous decisions, customer questions, and public research to identify the next useful page or industry relationship.", null, {}, now));
  }
  return scoutWorkspace(tenantId);
}
async function ensureWork(tenantId: string, key: string, work: Work) {
  const id = stableId(tenantId, key);
  await prisma.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id } },
    create: { id, tenantId, jobType: WORK_JOB, status: JobStatus.QUEUED, output: json(work) }, update: {} });
}

export async function claimScoutWork(tenantId: string, id: string, reason: string, now = new Date()) {
  text(reason, "Selection reason", 1500);
  return prisma.$transaction(async tx => {
    const settings = await tx.automationJobRun.findFirst({ where: { tenantId, id: stableId(tenantId, "mission"), jobType: MISSION_JOB } });
    const mission = settings ? parseMission(settings.input) : DEFAULT_MISSION;
    if (!mission.enabled) throw new ScoutWorkError("Scout research is paused. Save and enable an owner-approved research plan first.", 409);
    const jobs = await tx.automationJobRun.findMany({ where: { tenantId, jobType: WORK_JOB }, take: 1001 });
    if (jobs.length > 1000) throw new ScoutWorkError("Scout work history needs archiving before further work.", 409);
    const works = jobs.flatMap(job => { const work = readWork(job.output); return work ? [{ id: job.id, ...work }] : []; });
    const work = works.find(item => item.id === id);
    if (!work || !isDue(work, now)) throw new ScoutWorkError("This item is unavailable, already claimed, or not due.", 409);
    const steps = await tx.automationJobRun.count({ where: { tenantId, jobType: STEP_JOB, startedAt: { gte: new Date(now.getTime() - DAY_MS) } } });
    if (steps >= mission.dailySteps) throw new ScoutWorkError("The rolling daily research-step budget is used.", 409);
    const active = works.filter(item => item.id !== id && (item.state === "NEEDS_REVIEW" ||
      (item.state === "WORKING" && Date.parse(item.leaseUntil ?? "") > now.getTime()))).length;
    if (active >= mission.maxActive) throw new ScoutWorkError("The active-work limit is reached. Resolve a review before starting more work.", 409);
    const updated = nextWork(work, { state: "WORKING", lease: randomUUID(), leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
      attempts: work.attempts + 1 }, "CLAIMED", reason, now);
    await replace(tx, tenantId, id, work, updated);
    await tx.automationJobRun.create({ data: { tenantId, jobType: STEP_JOB, status: JobStatus.SUCCESS, startedAt: now,
      finishedAt: now, input: { workId: id, lease: updated.lease } } });
    return { id, ...updated };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function scoutWorkContext(tenantId: string, id: string, lease: string) {
  const work = await leasedWork(prisma, tenantId, id, lease);
  if (work.kind === "PAGE") {
    const opportunity = await prisma.websiteGrowthOpportunity.findFirst({ where: { tenantId, id: work.referenceId ?? "" },
      select: { action: true, topic: true, primaryKeyword: true, targetPage: true, sourcePage: true, reason: true,
        recommendation: true, supportingKeywords: true, evidence: true } });
    return { opportunity, website: await resolveNewlWebsiteContext() };
  }
  if (work.kind === "RELATIONSHIP") {
    const opportunity = await prisma.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: work.referenceId ?? "", status: "REPLIED", unsubscribedAt: null },
      select: { title: true, sourceDomain: true, sourceUrl: true, outreachAngle: true, replySummary: true, lastReplyAt: true,
        messages: { where: { tenantId }, orderBy: { sentAt: "desc" }, take: 5, select: { subject: true, body: true, sentAt: true } } } });
    return { opportunity, rule: "Prepare a response for human review. This worker cannot send messages or make commitments." };
  }
  if (work.kind === "MEASUREMENT") {
    const draft = await prisma.websiteGrowthContentDraft.findFirst({ where: { tenantId, id: work.referenceId ?? "", status: "PUBLISHED" },
      select: { title: true, summary: true, publishedAt: true } });
    if (!draft?.publishedAt || !work.route) throw new ScoutWorkError("Published page evidence is unavailable.", 409);
    const measurement = await measureScoutPage(tenantId, work.route, draft.publishedAt);
    // Store authoritative measurement separately from the model's interpretation.
    const updated = nextWork(work, { evidence: { ...work.evidence, measurement } }, "MEASURED", "Collected independent source results.");
    await prisma.$transaction(tx => replace(tx, tenantId, id, work, updated));
    return { draft, measurement };
  }
  return { website: await resolveNewlWebsiteContext(), rule: "Research may propose new page work. Publisher opportunities must remain proposals until human approval." };
}

export async function completeScoutWork(tenantId: string, id: string, lease: string, input: unknown, now = new Date()) {
  const result = parseResult(input, now);
  return prisma.$transaction(async tx => {
    const current = await tx.automationJobRun.findFirst({ where: { id, tenantId, jobType: WORK_JOB } });
    const previous = readWork(current?.output);
    // Lost acknowledgement: exactly the same completed lease returns its saved outcome.
    if (previous?.state !== "WORKING" && previous?.history.some(event => event.action === `COMPLETED:${lease}`)) return previous;
    const work = await leasedWork(tx, tenantId, id, lease, now);
    let draftId = work.draftId;
    let evidence = work.evidence;
    if (result.state === "NEEDS_REVIEW" && work.kind === "PAGE") {
      const opportunity = await tx.websiteGrowthOpportunity.findFirst({ where: { id: work.referenceId ?? "", tenantId,
        status: { in: ["NEW", "REVIEWING"] }, ...(work.draftId ? {} : { contentDrafts: { none: {} } }) } });
      if (!opportunity) throw new ScoutWorkError("Page work changed or already has a draft. Reconcile before proceeding.", 409);
      const draft = parsePageArtifact(result.artifact, now);
      const data = { tenantId, opportunityId: opportunity.id,
        source: WebsiteGrowthContentDraftSource.AI, title: draft.title, summary: draft.summary, contentType: draft.contentType,
        proposedPath: draft.proposedPath, targetPage: opportunity.targetPage, draftJson: json({ ...draft, scoutWorkId: id }) };
      if (work.draftId) {
        const changed = await tx.websiteGrowthContentDraft.updateMany({ where: { tenantId, id: work.draftId, opportunityId: opportunity.id, status: "DRAFT", approvedAt: null }, data });
        if (changed.count !== 1) throw new ScoutWorkError("The draft was reviewed while Scout was working. Reload before revising.", 409);
      } else {
        draftId = (await tx.websiteGrowthContentDraft.create({ data })).id;
      }
      await tx.websiteGrowthOpportunity.updateMany({ where: { tenantId, id: opportunity.id, status: { in: ["NEW", "REVIEWING"] } }, data: { status: "REVIEWING" } });
    }
    if (result.state === "NEEDS_REVIEW" && work.kind === "RELATIONSHIP") {
      text(result.artifact?.subject, "Reply subject", 180);
      text(result.artifact?.body, "Reply body", 4000);
      const source = await tx.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: work.referenceId ?? "", status: "REPLIED", unsubscribedAt: null }, select: { lastReplyAt: true, recipientEmail: true } });
      if (!source || source.lastReplyAt?.toISOString() !== work.evidence.replyAt) throw new ScoutWorkError("The conversation changed. Review the latest reply first.", 409);
      evidence = { ...evidence, replyRecipient: source.recipientEmail?.trim().toLowerCase() ?? null };
    }
    if (["RESEARCH", "MEASUREMENT"].includes(work.kind) && result.artifact?.proposedRoute && result.state !== "DISMISSED") {
      const proposal = result.artifact;
      const route = routePath(proposal.proposedRoute);
      const title = text(proposal.proposedTitle, "Proposed title", 250), hypothesis = text(proposal.hypothesis, "Proposal hypothesis");
      if (!route) throw new ScoutWorkError("A proposal needs a website route.");
      const opportunityId = stableId(tenantId, `proposal:${route}:${title.toLowerCase()}`);
      await tx.websiteGrowthOpportunity.upsert({ where: { id: opportunityId, tenantId }, create: { id: opportunityId, tenantId,
        topic: title, reason: hypothesis, recommendation: hypothesis, targetPage: route,
        action: proposal.newPage === true ? WebsiteGrowthAction.CREATE_PAGE : WebsiteGrowthAction.IMPROVE_EXISTING_PAGE, status: "REVIEWING" }, update: {} });
      const childId = stableId(tenantId, `page:${opportunityId}`);
      await tx.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id: childId } }, create: { id: childId, tenantId,
        jobType: WORK_JOB, status: JobStatus.QUEUED, output: json(newWork("PAGE", opportunityId, title, hypothesis, route, { parentWorkId: id }, now)) }, update: {} });
      result.state = "DONE";
      result.nextAction = "Scout will prepare a complete page brief from this proposal; publishing still requires owner approval.";
    }
    if (work.kind === "RESEARCH" && Array.isArray(result.artifact?.prospects) && result.artifact.prospects.length > 0) {
      const review = parseWebsiteGrowthBacklinkReview({ source: "WEB_DISCOVERY", queried: true, observedAt: now.toISOString(),
        summary: result.summary, rawProspectsReviewed: result.artifact.prospects.length, duplicatesRejected: 0, qualityRejected: 0, prospects: result.artifact.prospects });
      await persistWebsiteGrowthBacklinkReview({ tenantId, runId: id, review, database: tx });
      result.nextAction = "Review the researched publisher opportunities in Backlink Scout. No outreach has been approved or sent.";
    }
    const updated = nextWork(work, { ...result, artifact: result.artifact ?? work.artifact, evidence, draftId, lease: null, leaseUntil: null }, `COMPLETED:${lease}`, result.summary, now);
    await replace(tx, tenantId, id, work, updated);
    await audit(tx, tenantId, null, "work-completed", id, { kind: work.kind, state: updated.state, draftId });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewScoutWork(tenantId: string, userId: string, id: string, revision: number, decision: string, feedback: string) {
  if (!["REVISE", "ACCEPT", "DISMISS"].includes(decision)) throw new ScoutWorkError("Invalid review decision.");
  text(feedback, "Feedback", 2000);
  await prisma.$transaction(async tx => {
    const job = await tx.automationJobRun.findFirst({ where: { id, tenantId, jobType: WORK_JOB } });
    const work = readWork(job?.output);
    if (!work || work.revision !== revision || work.state === "WORKING") throw new ScoutWorkError("This work changed. Reload before reviewing.", 409);
    if (work.evidence.replySend) throw new ScoutWorkError("This response has an external send record. Reconcile it in the mailbox; it cannot be restarted here.", 409);
    // Page approvals and publishing stay in the established claims/build review path.
    if (work.kind === "PAGE" && work.draftId && decision === "ACCEPT") throw new ScoutWorkError("Approve this page through its complete brief.");
    const updated = nextWork(work, { state: decision === "REVISE" ? "READY" : decision === "DISMISS" ? "DISMISSED" : "DONE",
      evidence: { ...work.evidence, externalWait: false },
      nextAction: feedback, nextReviewAt: new Date().toISOString() }, "OWNER_REVIEW", feedback);
    await replace(tx, tenantId, id, work, updated);
    await audit(tx, tenantId, userId, "work-reviewed", id, { decision });
  });
}

export async function proposeScoutPage(tenantId: string, userId: string, input: unknown) {
  const proposal = record(input), title = text(proposal.title, "Title", 250), hypothesis = text(proposal.hypothesis, "Hypothesis", 4000);
  const route = routePath(proposal.route);
  if (!route) throw new ScoutWorkError("Provide the proposed or existing website route.");
  const opportunityId = stableId(tenantId, `proposal:${route}:${title.toLowerCase()}`);
  await prisma.$transaction(async tx => {
    await tx.websiteGrowthOpportunity.upsert({ where: { id: opportunityId, tenantId },
      create: { id: opportunityId, tenantId, topic: title, reason: hypothesis, recommendation: hypothesis, targetPage: route,
        action: proposal.newPage === true ? WebsiteGrowthAction.CREATE_PAGE : WebsiteGrowthAction.IMPROVE_EXISTING_PAGE, status: "REVIEWING" }, update: {} });
    await audit(tx, tenantId, userId, "page-proposed", opportunityId, { route });
  });
  await ensureWork(tenantId, `page:${opportunityId}`, newWork("PAGE", opportunityId, title, hypothesis, route));
}

async function leasedWork(tx: Client, tenantId: string, id: string, lease: string, now = new Date()) {
  const job = await tx.automationJobRun.findFirst({ where: { tenantId, id, jobType: WORK_JOB } });
  const work = readWork(job?.output);
  if (!work || work.state !== "WORKING" || work.lease !== lease || Date.parse(work.leaseUntil ?? "") <= now.getTime()) throw new ScoutWorkError("Research lease expired or changed; saved work has been preserved.", 409);
  return work;
}
async function replace(tx: Client, tenantId: string, id: string, previous: Work, next: Work) {
  const changed = await tx.automationJobRun.updateMany({ where: { id, tenantId, jobType: WORK_JOB,
    output: { path: ["revision"], equals: previous.revision } }, data: { output: json(next),
    status: next.state === "WORKING" ? JobStatus.RUNNING : ["DONE", "DISMISSED"].includes(next.state) ? JobStatus.SUCCESS : JobStatus.QUEUED } });
  if (changed.count !== 1) throw new ScoutWorkError("Work changed concurrently. Reload before retrying.", 409);
}
async function audit(tx: Client, tenantId: string, userId: string | null, action: string, id: string, after: object) {
  await tx.auditLog.create({ data: { tenantId, actorUserId: userId, action: `website-growth.scout.${action}`, entityType: "AutomationJobRun", entityId: id, after: json(after) } });
}
function safePath(value: unknown) { try { return routePath(value); } catch { return null; } }
async function reconcilePageHandoffs(tenantId: string) {
  const jobs = await prisma.automationJobRun.findMany({ where: { tenantId, jobType: WORK_JOB,
    output: { path: ["kind"], equals: "PAGE" } }, take: 1000 });
  for (const job of jobs) {
    const work = readWork(job.output);
    if (!work || work.state === "WORKING" || ["DONE", "DISMISSED"].includes(work.state)) continue;
    const draft = await prisma.websiteGrowthContentDraft.findFirst({ where: { tenantId, opportunityId: work.referenceId ?? "" }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
    if (!draft) continue;
    const state = draft.status === "PUBLISHED" ? "DONE" : draft.status === "REJECTED" ? "DISMISSED" : draft.status === "DRAFT" ? "NEEDS_REVIEW" : "WAITING";
    if (draft.status === "DRAFT" && work.state === "READY" && draft.id === work.draftId) continue;
    if (state === work.state && draft.id === work.draftId) continue;
    const updated = nextWork(work, { state, draftId: draft.id, evidence: { ...work.evidence, externalWait: state === "WAITING" },
      nextAction: state === "DONE" ? "Published; a separate outcome review follows the measurement window." : state === "WAITING" ? "Await the website build and owner publishing decision." : "Review the complete page brief." }, "HANDOFF", `Page brief is ${draft.status.toLowerCase()}.`);
    await prisma.$transaction(tx => replace(tx, tenantId, job.id, work, updated));
  }
}
async function reconcileRelationshipHandoffs(tenantId: string) {
  const jobs = await prisma.automationJobRun.findMany({ where: { tenantId, jobType: WORK_JOB,
    output: { path: ["kind"], equals: "RELATIONSHIP" } }, take: 1000 });
  for (const job of jobs) {
    const work = readWork(job.output);
    if (!work || work.evidence.replySend || ["DONE", "DISMISSED"].includes(work.state)) continue;
    const source = await prisma.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: work.referenceId ?? "" },
      select: { status: true, unsubscribedAt: true, lastReplyAt: true } });
    if (source?.status === "REPLIED" && !source.unsubscribedAt && source.lastReplyAt?.toISOString() === work.evidence.replyAt) continue;
    const updated = nextWork(work, { state: "DISMISSED", lease: null, leaseUntil: null,
      nextAction: "This conversation changed or was closed. Any newer eligible reply has its own work item." },
      "SUPERSEDED", "Cleared a stale response after checking the current publisher conversation.");
    await prisma.$transaction(tx => replace(tx, tenantId, job.id, work, updated));
  }
}
function parsePageArtifact(artifact: Record<string, unknown> | null, now: Date) {
  // Reuse the production Scout draft contract; provider/tracking branches are explicitly unavailable.
  const parsed = parseWebsiteGrowthScoutCompletion({ runSummary: "Autonomous Scout page review", drafts: [{ opportunityId: "scout-work", recommendationSummary: "Prepared for owner review", draft: artifact }],
    semrush: { source: "UNAVAILABLE", queried: false, observedAt: now.toISOString(), summary: "Not required for this work item.", rows: [], tracking: { campaign: null, trackedKeywords: [] } },
    backlinks: { source: "NOT_RUN", queried: false, observedAt: now.toISOString(), summary: "Separate work item.", rawProspectsReviewed: 0, duplicatesRejected: 0, qualityRejected: 0, prospects: [] } });
  const draft = parsed.drafts[0].draft;
  // Never persist model-supplied approval/build fields.
  const keys = ["title", "summary", "contentType", "proposedPath", "targetKeyword", "searchIntent", "sections", "metaTitle", "metaDescription", "faqs", "internalLinks", "implementationNotes", "reviewChecklist", "websitePageType", "websiteTemplate", "layoutComponents", "designSystemNotes", "pageChangePreview", "pagePreview"];
  return Object.fromEntries(keys.map(key => [key, record(draft)[key]])) as unknown as typeof draft;
}
