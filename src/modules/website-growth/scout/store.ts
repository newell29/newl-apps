import { authorityCampaign, authorityResearchContext, proposeAuthorityActions } from "../authority/store";
import { reconcileAuthorityResearch, authorityResultArtifact } from "../authority/scout";
import { loadSiteReview } from "./effectiveness";
import { effectivenessPacket } from "./effectiveness-model";
import { randomUUID } from "node:crypto";
import { JobStatus, Prisma, WebsiteGrowthAction, WebsiteGrowthContentDraftSource } from "@prisma/client";
import { prisma } from "@/server/db";
import { isKnownNewlWebsiteRoute, type NewlWebsiteContext } from "@/modules/website-growth/newl-website-context";
import { resolveNewlWebsiteContext } from "@/modules/website-growth/newl-website-context-scanner";
import { parseWebsiteGrowthScoutCompletion } from "@/modules/website-growth/scout-run";
import { parseWebsiteGrowthBacklinkReview, persistWebsiteGrowthBacklinkReview } from "@/modules/website-growth/backlinks";
import { hasPostChangeEvidence, measurementWindows, measureScoutPage } from "./measurement";
import { loadScoutPageEvidence } from "./page-evidence";
import { projectPageHandoffs } from "./lifecycle";
import { projectSupervisorCorrections, scoutCompetitorEvidence, scoutOutcomes, supervisorReview } from "./learning";
import { DEFAULT_MISSION, MISSION_JOB, WORK_JOB, STEP_JOB, WAKE_JOB, LEASE_MS, DAY_MS, ScoutWorkError,
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
  const projected = await projectPageHandoffs(prisma, tenantId, jobs.flatMap(job => { const work = readWork(job.output); return work ? [{ id: job.id, ...work }] : []; }));
  const campaign = await authorityCampaign(tenantId);
  const items = projectSupervisorCorrections(projectAuthorityHandoffs(projected, campaign));
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
  await reconcileAuthorityResearch(tenantId, now);
  const authority = await authorityCampaign(tenantId);
  await reconcilePageHandoffs(tenantId);
  await reconcileRelationshipHandoffs(tenantId);
  const [pages, replies, published] = await Promise.all([
    prisma.websiteGrowthOpportunity.findMany({ where: { tenantId, status: { in: ["NEW", "REVIEWING"] }, contentDrafts: { none: {} },
      action: { notIn: ["IGNORE", "MONITOR"] } }, orderBy: [{ score: "desc" }, { updatedAt: "asc" }], take: 60 }),
    prisma.websiteGrowthBacklinkOpportunity.findMany({ where: { tenantId, status: "REPLIED", unsubscribedAt: null },
      orderBy: { lastReplyAt: "desc" }, take: 40, select: { id: true, title: true, targetPage: true, lastReplyAt: true,
        sourceDomain: true, sourceUrl: true, outreachAngle: true } }),
    prisma.websiteGrowthContentDraft.findMany({ where: { tenantId, status: "PUBLISHED", publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" }, take: 60, select: { id: true, title: true, proposedPath: true, targetPage: true, publishedAt: true, opportunity: { select: { reason: true } } } })
  ]);
  for (const page of pages) await ensureWork(tenantId, `page:${page.id}`, newWork("PAGE", page.id, page.topic,
    page.reason, safePath(page.targetPage ?? page.sourcePage), { source: "existing-opportunity", score: page.score }, now));
  for (const reply of authority ? [] : replies) await ensureWork(tenantId, `reply:${reply.id}:${reply.lastReplyAt?.toISOString()}`, newWork("RELATIONSHIP", reply.id,
    `Continue: ${reply.title}`, "A publisher replied. Review the conversation and prepare a useful next response.", safePath(reply.targetPage),
    { sourceDomain: reply.sourceDomain, sourceUrl: reply.sourceUrl, replyAt: reply.lastReplyAt?.toISOString() ?? null }, now));
  for (const draft of published) {
    const route = safePath(draft.proposedPath ?? draft.targetPage);
    if (!route || !draft.publishedAt) continue;
    const work = newWork("MEASUREMENT", draft.id, `Measure: ${draft.title}`, draft.opportunity?.reason || "Evaluate the page against its pre-publication baseline and propose the next action.", route,
      { publishedAt: draft.publishedAt.toISOString() }, now);
    work.nextReviewAt = measurementWindows(draft.publishedAt, now).readyAt;
    work.state = "WAITING";
    await ensureWork(tenantId, `measurement:${draft.id}:${draft.publishedAt.toISOString()}`, work);
  }
  // Keep one open research brief, replenished by completed work rather than a calendar quota.
  const latestResearch = await prisma.automationJobRun.findFirst({ where: { tenantId, jobType: WORK_JOB,
    output: { path: ["kind"], equals: "RESEARCH" }, id: { notIn: [stableId(tenantId, "research:site-effectiveness"), stableId(tenantId, "research:authority-campaign")] } }, orderBy: { createdAt: "desc" } });
  const previousResearch = readWork(latestResearch?.output);
  if (!previousResearch || ["DONE", "DISMISSED"].includes(previousResearch.state)) {
    await ensureWork(tenantId, `research:after:${latestResearch?.id ?? "initial"}`, newWork("RESEARCH", null, "Find the next valuable inbound opportunity",
      "Use the owner's priorities, previous decisions, customer questions, and public research to identify the next useful page or industry relationship.", null, {}, now));
  }
  // One reusable review, not a growing queue of per-page alarms or calendar-generated tasks.
  const siteReview = await loadSiteReview(tenantId).catch(() => null);
  if (siteReview) {
    const key = "research:site-effectiveness";
    await ensureWork(tenantId, key, newWork("RESEARCH", null, "Review site performance, missed opportunities and delivered work",
      "Investigate meaningful changes across the site, compare completed work with results, and select the next useful action. Missing sources do not block other research.",
      null, { source: "site-review" }, now));
    const job = await prisma.automationJobRun.findFirst({ where: { tenantId, id: stableId(tenantId, key), jobType: WORK_JOB } });
    const work = readWork(job?.output);
    if (work && work.state === "DONE" && Date.parse(work.nextReviewAt) <= now.getTime()) {
      const updated = nextWork(work, { state: "READY", attempts: 0 }, "REVIEW_DUE", "Review fresh evidence and previous findings; reuse active work.", now);
      await prisma.$transaction(tx => replace(tx, tenantId, job!.id, work, updated));
    }
  }
  return scoutWorkspace(tenantId);
}
async function ensureWork(tenantId: string, key: string, work: Work) {
  const id = stableId(tenantId, key);
  await prisma.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id } },
    create: { id, tenantId, jobType: WORK_JOB, status: JobStatus.QUEUED, output: json(work) }, update: {} });
}

export async function claimScoutWork(tenantId: string, id: string, reason: string, claimId: string, now = new Date()) {
  text(reason, "Selection reason", 1500);
  text(claimId, "Claim ID", 100);
  const stepId = stableId(tenantId, `step:${claimId}`);
  return prisma.$transaction(async tx => {
    const previousStep = await tx.automationJobRun.findUnique({ where: { tenantId_id: { tenantId, id: stepId } } });
    if (previousStep) {
      if (previousStep.jobType !== STEP_JOB) throw new ScoutWorkError("This claim ID has already been used.", 409);
      const previousInput = record(previousStep.input);
      if (previousInput.workId !== id || previousInput.claimId !== claimId || typeof previousInput.lease !== "string") {
        throw new ScoutWorkError("This claim ID has already been used for different work.", 409);
      }
      const previousJob = await tx.automationJobRun.findFirst({ where: { tenantId, id, jobType: WORK_JOB } });
      const previousWork = readWork(previousJob?.output);
      if (previousWork?.state === "WORKING" && previousWork.lease === previousInput.lease &&
          Date.parse(previousWork.leaseUntil ?? "") > now.getTime()) return { id, ...previousWork };
      throw new ScoutWorkError("This claim was already resolved or its lease expired. Prepare work again.", 409);
    }
    await tx.automationJobRun.updateMany({
      where: { tenantId, jobType: STEP_JOB, status: JobStatus.RUNNING, startedAt: { lte: new Date(now.getTime() - LEASE_MS) } },
      data: { status: JobStatus.ERROR, finishedAt: now, errorMessage: "The Scout research lease expired before a result was saved." }
    });
    const settings = await tx.automationJobRun.findFirst({ where: { tenantId, id: stableId(tenantId, "mission"), jobType: MISSION_JOB } });
    const mission = settings ? parseMission(settings.input) : DEFAULT_MISSION;
    if (!mission.enabled) throw new ScoutWorkError("Scout research is paused. Save and enable an owner-approved research plan first.", 409);
    const jobs = await tx.automationJobRun.findMany({ where: { tenantId, jobType: WORK_JOB }, take: 1001 });
    if (jobs.length > 1000) throw new ScoutWorkError("Scout work history needs archiving before further work.", 409);
    const campaign = await authorityCampaign(tenantId, tx);
    const works = projectSupervisorCorrections(projectAuthorityHandoffs(await projectPageHandoffs(tx, tenantId, jobs.flatMap(job => { const work = readWork(job.output); return work ? [{ id: job.id, ...work }] : []; })), campaign));
    const work = works.find(item => item.id === id);
    if (!work || !isDue(work, now)) throw new ScoutWorkError("This item is unavailable, already claimed, or not due.", 409);
    if (work.kind === "PAGE" && work.route && works.some(other => other.id !== id && other.kind === "PAGE" && other.route === work.route &&
      (other.state === "NEEDS_REVIEW" || (other.state === "WORKING" && !isDue(other, now)) || (other.state === "WAITING" && other.evidence.externalWait)))) {
      throw new ScoutWorkError("This page already has active research, a brief, or a build. Follow that work before starting another candidate.", 409);
    }
    const steps = await tx.automationJobRun.count({ where: { tenantId, jobType: STEP_JOB, startedAt: { gte: new Date(now.getTime() - DAY_MS) } } });
    if (steps >= mission.dailySteps) throw new ScoutWorkError("The rolling daily research-step budget is used.", 409);
    const active = works.filter(item => item.id !== id && (item.state === "NEEDS_REVIEW" ||
      (item.state === "WORKING" && Date.parse(item.leaseUntil ?? "") > now.getTime()))).length;
    if (active >= mission.maxActive) throw new ScoutWorkError("The active-work limit is reached. Resolve a review before starting more work.", 409);
    const updated = nextWork(work, { state: "WORKING", lease: randomUUID(), leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
      attempts: work.attempts + 1 }, "CLAIMED", reason, now);
    await replace(tx, tenantId, id, work, updated);
    await tx.automationJobRun.create({ data: { id: stepId, tenantId, jobType: STEP_JOB, status: JobStatus.RUNNING, startedAt: now,
      input: { workId: id, workTitle: work.title, workKind: work.kind, claimId, lease: updated.lease, selectionReason: reason } } });
    return { id, ...updated };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function recordScoutWake(tenantId: string, wakeId: string, input: {
  missionEnabled: boolean;
  dueCount: number;
  usedSteps: number;
  dailySteps: number;
  active: number;
  maxActive: number;
  idleReason: string | null;
}, now = new Date()) {
  text(wakeId, "Wake ID", 100);
  const id = stableId(tenantId, `wake:${wakeId}`);
  const summary = input.idleReason ?? `${input.dueCount} research item${input.dueCount === 1 ? " is" : "s are"} due for supervisor selection.`;
  await prisma.automationJobRun.upsert({
    where: { tenantId_id: { tenantId, id } },
    create: { id, tenantId, jobType: WAKE_JOB, status: JobStatus.SUCCESS, startedAt: now, finishedAt: now,
      input: { trigger: "SCHEDULED", wakeId }, output: json({ summary, ...input }) },
    update: {}
  });
}

export async function scoutWorkContext(tenantId: string, id: string, lease: string) {
  const work = await leasedWork(prisma, tenantId, id, lease);
  const learning = work.kind === "RELATIONSHIP" ? null : {
    outcomes: scoutOutcomes((await scoutWorkspace(tenantId)).items), competitors: await scoutCompetitorEvidence(tenantId),
    effectiveness: effectivenessPacket(await loadSiteReview(tenantId).catch(() => null)) };
  if (work.evidence.source === "authority-campaign") return { authority: await authorityResearchContext(tenantId), website: await resolveNewlWebsiteContext(), learning };
  if (work.kind === "PAGE") {
    const [opportunity, website, pageEvidence] = await Promise.all([
      prisma.websiteGrowthOpportunity.findFirst({ where: { tenantId, id: work.referenceId ?? "" },
        select: { action: true, topic: true, primaryKeyword: true, targetPage: true, sourcePage: true, reason: true,
          recommendation: true, supportingKeywords: true, evidence: true } }),
      resolveNewlWebsiteContext(),
      work.route ? loadScoutPageEvidence(tenantId, work.route) : Promise.resolve(null)
    ]);
    return { opportunity, learning, website, pageEvidence };
  }
  if (work.kind === "RELATIONSHIP") {
    const opportunity = await prisma.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: work.referenceId ?? "", status: "REPLIED", unsubscribedAt: null },
      select: { title: true, sourceDomain: true, sourceUrl: true, outreachAngle: true, replySummary: true, lastReplyAt: true,
        messages: { where: { tenantId }, orderBy: { sentAt: "desc" }, take: 5, select: { subject: true, body: true, sentAt: true } } } });
    return { opportunity, rule: "Prepare a response for human review. This worker cannot send messages or make commitments." };
  }
  if (work.kind === "MEASUREMENT") {
    if (work.evidence.source === "authority-placement" && work.route) {
      const placement = await prisma.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: work.referenceId ?? "", status: "LIVE" }, select: { verifiedAt: true, liveUrl: true } });
      if (!placement?.verifiedAt) throw new ScoutWorkError("The placement is no longer verified. Recheck the publisher before measuring.", 409);
      const measurement = await measureScoutPage(tenantId, work.route, placement.verifiedAt, new Date(), Number(work.evidence.window) > 28);
      const updated = nextWork(work, { evidence: { ...work.evidence, measurement } }, "MEASURED", "Collected target-page trends following a placement; association only.");
      await prisma.$transaction(tx => replace(tx, tenantId, id, work, updated));
      return { placement, measurement, learning, limitation: "No publisher-level referral or qualified-enquiry attribution. Before/after movement is not causal lift." };
    }
    const draft = await prisma.websiteGrowthContentDraft.findFirst({ where: { tenantId, id: work.referenceId ?? "", status: "PUBLISHED" },
      select: { title: true, summary: true, publishedAt: true } });
    if (!draft?.publishedAt || !work.route) throw new ScoutWorkError("Published page evidence is unavailable.", 409);
    const measurement = await measureScoutPage(tenantId, work.route, draft.publishedAt, new Date(), Boolean(work.evidence.measurement));
    // Store authoritative measurement separately from the model's interpretation.
    const previousMeasurements = Array.isArray(work.evidence.previousMeasurements) ? work.evidence.previousMeasurements : [];
    const updated = nextWork(work, { evidence: { ...work.evidence, measurement,
      previousMeasurements: [...previousMeasurements, ...(work.evidence.measurement ? [work.evidence.measurement] : [])].slice(-5) } }, "MEASURED", "Collected independent source results.");
    await prisma.$transaction(tx => replace(tx, tenantId, id, work, updated));
    return { draft, measurement, learning, pageEvidence: await loadScoutPageEvidence(tenantId, work.route) };
  }
  if (work.evidence.source === "site-review") {
    const updated = nextWork(work, { evidence: { ...work.evidence, effectiveness: learning?.effectiveness ?? null } }, "SITE_EVIDENCE", "Saved dated site evidence for this investigation.");
    await prisma.$transaction(tx => replace(tx, tenantId, id, work, updated));
  }
  return { website: await resolveNewlWebsiteContext(), learning, rule: "Research may propose new page work. Publisher opportunities must remain proposals until human approval." };
}

export async function completeScoutWork(tenantId: string, id: string, lease: string, input: unknown, now = new Date()) {
  const result = parseResult(input, now);
  const review = supervisorReview(record(input).supervisor);
  const websiteContext = await resolveNewlWebsiteContext();
  // Preserve legacy/interrupted output for the next supervised step instead of losing its artifact.
  if (result.state === "NEEDS_REVIEW" && review?.verdict !== "PASS") {
    result.state = "WAITING";
    result.nextAction = review?.reason.slice(0, 1500) ?? "Supervisor quality review is required before this work can be delivered.";
    result.nextReviewAt = new Date(now.getTime() + DAY_MS).toISOString();
  }
  return prisma.$transaction(async tx => {
    const current = await tx.automationJobRun.findFirst({ where: { id, tenantId, jobType: WORK_JOB } });
    const previous = readWork(current?.output);
    // Lost acknowledgement: exactly the same completed lease returns its saved outcome.
    if (previous?.state !== "WORKING" && previous?.history.some(event => event.action === `COMPLETED:${lease}`)) return previous;
    const work = await leasedWork(tx, tenantId, id, lease, now);
    let draftId = work.draftId;
    let evidence: Record<string, unknown> = { ...work.evidence, supervisor: review ? { ...review, reviewedAt: now.toISOString() } : null };
    if (work.kind === "MEASUREMENT" && result.artifact && record(evidence.measurement).status !== "AVAILABLE") {
      result.artifact = { ...result.artifact, confidence: "LOW" };
    }
    if (result.state === "NEEDS_REVIEW" && work.kind === "MEASUREMENT" && !hasPostChangeEvidence(evidence.measurement)) {
      result.state = "WAITING";
      result.nextAction = "Post-change measurement is unavailable. Scout will retry the sources and retain the available evidence.";
      result.nextReviewAt = new Date(now.getTime() + 7 * DAY_MS).toISOString();
    }
    const delivering = result.state === "NEEDS_REVIEW";
    if (result.state === "NEEDS_REVIEW" && work.kind === "PAGE") {
      const opportunity = await tx.websiteGrowthOpportunity.findFirst({ where: { id: work.referenceId ?? "", tenantId,
        status: { in: ["NEW", "REVIEWING"] }, ...(work.draftId ? {} : { contentDrafts: { none: {} } }) } });
      if (!opportunity) throw new ScoutWorkError("Page work changed or already has a draft. Reconcile before proceeding.", 409);
      const effectiveAction = resolveProposedPageAction(opportunity.action, work.route, websiteContext);
      const draft = normalizePageArtifact(parsePageArtifact(result.artifact, now), effectiveAction, work.route);
      const data = { tenantId, opportunityId: opportunity.id,
        source: WebsiteGrowthContentDraftSource.AI, title: draft.title, summary: draft.summary, contentType: draft.contentType,
        proposedPath: draft.proposedPath, targetPage: opportunity.targetPage, draftJson: json({ ...draft, scoutWorkId: id }) };
      if (work.draftId) {
        const changed = await tx.websiteGrowthContentDraft.updateMany({ where: { tenantId, id: work.draftId, opportunityId: opportunity.id, status: "DRAFT", approvedAt: null }, data });
        if (changed.count !== 1) throw new ScoutWorkError("The draft was reviewed while Scout was working. Reload before revising.", 409);
      } else {
        draftId = (await tx.websiteGrowthContentDraft.create({ data })).id;
      }
      await tx.websiteGrowthOpportunity.updateMany({ where: { tenantId, id: opportunity.id, status: { in: ["NEW", "REVIEWING"] } },
        data: { status: "REVIEWING", action: effectiveAction } });
    }
    if (result.state === "NEEDS_REVIEW" && work.kind === "RELATIONSHIP") {
      text(result.artifact?.subject, "Reply subject", 180);
      text(result.artifact?.body, "Reply body", 4000);
      const source = await tx.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: work.referenceId ?? "", status: "REPLIED", unsubscribedAt: null }, select: { lastReplyAt: true, recipientEmail: true } });
      if (!source || source.lastReplyAt?.toISOString() !== work.evidence.replyAt) throw new ScoutWorkError("The conversation changed. Review the latest reply first.", 409);
      evidence = { ...evidence, replyRecipient: source.recipientEmail?.trim().toLowerCase() ?? null };
    }
    if (["RESEARCH", "MEASUREMENT"].includes(work.kind) && result.artifact?.proposedRoute && delivering) {
      const proposal = result.artifact;
      const route = routePath(proposal.proposedRoute);
      const title = text(proposal.proposedTitle, "Proposed title", 250), hypothesis = text(proposal.hypothesis, "Proposal hypothesis");
      if (!route) throw new ScoutWorkError("A proposal needs a website route.");
      const existing = await tx.websiteGrowthOpportunity.findFirst({ where: { tenantId, targetPage: route,
        status: { in: ["NEW", "REVIEWING", "APPROVED", "IN_PROGRESS"] } }, select: { id: true } });
      // Reuse active work, but let a later outcome review improve a previously published page again.
      const opportunityId = existing?.id ?? stableId(tenantId, `proposal:${route}:${title.toLowerCase()}:from:${id}${work.evidence.source === "site-review" ? `:revision:${work.revision}` : ""}`);
      const action = resolveProposedPageAction(
        proposal.newPage === true ? WebsiteGrowthAction.CREATE_PAGE : WebsiteGrowthAction.IMPROVE_EXISTING_PAGE,
        route,
        websiteContext
      );
      await tx.websiteGrowthOpportunity.upsert({ where: { id: opportunityId, tenantId }, create: { id: opportunityId, tenantId,
        topic: title, reason: hypothesis, recommendation: hypothesis, targetPage: route,
        action, status: "REVIEWING", evidence: json({ routeClassification: {
          requestedNewPage: proposal.newPage === true,
          existingRouteFound: action !== WebsiteGrowthAction.CREATE_PAGE && proposal.newPage === true,
          resolvedAction: action
        } }) }, update: {} });
      const childId = stableId(tenantId, `page:${opportunityId}`);
      await tx.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id: childId } }, create: { id: childId, tenantId,
        jobType: WORK_JOB, status: JobStatus.QUEUED, output: json(newWork("PAGE", opportunityId, title, hypothesis, route, { parentWorkId: id }, now)) }, update: {} });
      result.state = "DONE";
      result.nextAction = "Scout will prepare a complete page brief from this proposal; publishing still requires owner approval.";
    }
    if (delivering && work.kind === "RESEARCH" && Array.isArray(result.artifact?.prospects) && result.artifact.prospects.length > 0) {
      const review = parseWebsiteGrowthBacklinkReview({ source: "WEB_DISCOVERY", queried: true, observedAt: now.toISOString(),
        summary: result.summary, rawProspectsReviewed: result.artifact.prospects.length, duplicatesRejected: 0, qualityRejected: 0, prospects: result.artifact.prospects });
      await persistWebsiteGrowthBacklinkReview({ tenantId, runId: id, review, database: tx });
      const authority = await authorityCampaign(tenantId, tx);
      result.state = authority ? "DONE" : "NEEDS_REVIEW";
      result.nextAction = authority ? "Publisher inventory updated. The authority campaign will prepare feasible exact actions before approval." : "Review the researched publisher opportunities in Backlink Scout. No outreach has been approved or sent.";
    }
    if (delivering && work.evidence.source === "authority-campaign") {
      const actions = await proposeAuthorityActions(tx, tenantId, authorityResultArtifact(result.artifact), now);
      result.state = "DONE";
      result.nextReviewAt = new Date(now.getTime() + DAY_MS).toISOString();
      result.nextAction = `Campaign investigation saved. ${actions.length} concrete action(s) prepared in Authority campaigns. External actions still require individual approval.`;
      evidence = { ...evidence, authorityActionIds: actions };
    }
    if (delivering && work.kind === "RESEARCH" && work.evidence.source === "site-review") {
      const previousReviews = Array.isArray(evidence.previousReviews) ? evidence.previousReviews : [];
      evidence = { ...evidence, previousReviews: [...previousReviews, { at: now.toISOString(),
        recommendation: String(result.artifact?.recommendation ?? "").slice(0, 4000),
        limitations: String(result.artifact?.limitations ?? "").slice(0, 2000), evidence: evidence.effectiveness ?? null }].slice(-5) };
      if (!Array.isArray(result.artifact?.prospects) || result.artifact.prospects.length === 0) {
        result.state = "DONE";
        if (!result.artifact?.proposedRoute) result.nextAction = "Site review recorded. Scout will revisit on the saved review date; see the recommendation and evidence.";
      }
    }
    if (delivering && work.kind === "MEASUREMENT") {
      if (!result.artifact?.proposedRoute) {
        result.state = "DONE";
        result.nextAction = "Outcome recorded for future prioritization. No owner decision is required.";
      }
    }
    if (result.state === "WAITING" && work.attempts >= 3 && ((review ? review.verdict !== "PASS" : record(input).decision === "DELIVER") ||
      (work.kind === "MEASUREMENT" && !hasPostChangeEvidence(evidence.measurement)))) {
      evidence = { ...evidence, externalWait: true, escalation: { at: now.toISOString(), reason: result.nextAction } };
      result.nextAction = `Scout needs help after repeated incomplete attempts: ${result.nextAction}`.slice(0, 1500);
    }
    if (result.state === "WAITING") {
      let waitBlocker = result.waitBlocker ?? {
        type: review?.verdict && review.verdict !== "PASS" ? "PUBLIC_RESEARCH" as const : "DATA_REFRESH" as const,
        evidenceNeeded: result.nextAction,
        resolutionAction: result.nextAction,
        resolvableByScout: true
      };
      if (evidence.externalWait && waitBlocker.resolvableByScout) {
        waitBlocker = {
          type: "OWNER_INPUT",
          evidenceNeeded: waitBlocker.evidenceNeeded,
          resolutionAction: "Review the repeated incomplete attempts and provide a narrower direction or resolve the named source issue.",
          resolvableByScout: false
        };
      }
      evidence = { ...evidence, waitBlocker: { ...waitBlocker, recordedAt: now.toISOString(), nextReviewAt: result.nextReviewAt } };
      if (waitBlocker.type === "OWNER_INPUT" && !waitBlocker.resolvableByScout) {
        evidence = { ...evidence, externalWait: true, escalation: { at: now.toISOString(), reason: waitBlocker.evidenceNeeded } };
        result.nextAction = `Owner input needed: ${waitBlocker.resolutionAction}`.slice(0, 1500);
      }
    } else if (evidence.waitBlocker) {
      const resolvedWaits = Array.isArray(evidence.resolvedWaits) ? evidence.resolvedWaits : [];
      evidence = { ...evidence, waitBlocker: null, resolvedWaits: [...resolvedWaits, evidence.waitBlocker].slice(-5) };
    }
    const resultState = { summary: result.summary, nextAction: result.nextAction,
      state: result.state, nextReviewAt: result.nextReviewAt };
    const [updated] = projectSupervisorCorrections([nextWork(work, { ...resultState, artifact: result.artifact ?? work.artifact, evidence, draftId, lease: null, leaseUntil: null }, `COMPLETED:${lease}`, result.summary, now)]);
    await replace(tx, tenantId, id, work, updated);
    await tx.automationJobRun.updateMany({ where: { tenantId, jobType: STEP_JOB, status: JobStatus.RUNNING,
      input: { path: ["lease"], equals: lease } }, data: { status: JobStatus.SUCCESS, finishedAt: now,
      output: json({ summary: result.summary, workId: id, workKind: work.kind, state: updated.state }) } });
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
    if (work.kind === "PAGE" && work.draftId) {
      const draft = await tx.websiteGrowthContentDraft.findFirst({ where: { tenantId, id: work.draftId }, select: { status: true, approvedAt: true } });
      if (!draft || draft.status !== "DRAFT" || draft.approvedAt) throw new ScoutWorkError("This page has left brief review. Open the brief for its current build or publishing decision.", 409);
    }
    // Page approvals and publishing stay in the established claims/build review path.
    if (work.kind === "PAGE" && work.draftId && decision === "ACCEPT") throw new ScoutWorkError("Approve this page through its complete brief.");
    const resolvedWaits = Array.isArray(work.evidence.resolvedWaits) ? work.evidence.resolvedWaits : [];
    const updated = nextWork(work, { state: decision === "REVISE" ? "READY" : decision === "DISMISS" ? "DISMISSED" : "DONE",
      evidence: { ...work.evidence, externalWait: false, escalation: null, waitBlocker: null,
        resolvedWaits: work.evidence.waitBlocker ? [...resolvedWaits, work.evidence.waitBlocker].slice(-5) : resolvedWaits },
      nextAction: feedback, nextReviewAt: new Date().toISOString() }, "OWNER_REVIEW", feedback);
    await replace(tx, tenantId, id, work, updated);
    await audit(tx, tenantId, userId, "work-reviewed", id, { decision });
  });
}

export async function proposeScoutPage(tenantId: string, userId: string, input: unknown) {
  const proposal = record(input), title = text(proposal.title, "Title", 250), hypothesis = text(proposal.hypothesis, "Hypothesis", 4000);
  const route = routePath(proposal.route);
  if (!route) throw new ScoutWorkError("Provide the proposed or existing website route.");
  const websiteContext = await resolveNewlWebsiteContext();
  const action = resolveProposedPageAction(
    proposal.newPage === true ? WebsiteGrowthAction.CREATE_PAGE : WebsiteGrowthAction.IMPROVE_EXISTING_PAGE,
    route,
    websiteContext
  );
  const opportunityId = stableId(tenantId, `proposal:${route}:${title.toLowerCase()}`);
  await prisma.$transaction(async tx => {
    await tx.websiteGrowthOpportunity.upsert({ where: { id: opportunityId, tenantId },
      create: { id: opportunityId, tenantId, topic: title, reason: hypothesis, recommendation: hypothesis, targetPage: route,
        action, status: "REVIEWING", evidence: json({ routeClassification: {
          requestedNewPage: proposal.newPage === true,
          existingRouteFound: action !== WebsiteGrowthAction.CREATE_PAGE && proposal.newPage === true,
          resolvedAction: action
        } }) }, update: {} });
    await audit(tx, tenantId, userId, "page-proposed", opportunityId, { route, action });
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
  const items = jobs.flatMap(job => { const work = readWork(job.output); return work ? [{ id: job.id, ...work }] : []; });
  const projected = await projectPageHandoffs(prisma, tenantId, items);
  for (const work of items) {
    const current = projected.find(item => item.id === work.id)!;
    if (JSON.stringify(current) === JSON.stringify(work)) continue;
    const updated = nextWork(work, current, "HANDOFF", current.nextAction);
    await prisma.$transaction(tx => replace(tx, tenantId, work.id, work, updated));
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

function resolveProposedPageAction(action: WebsiteGrowthAction, route: string | null, context: NewlWebsiteContext) {
  if (
    (action === WebsiteGrowthAction.CREATE_PAGE || action === WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE) &&
    isKnownNewlWebsiteRoute(route, context)
  ) {
    return WebsiteGrowthAction.IMPROVE_EXISTING_PAGE;
  }

  return action;
}

function normalizePageArtifact<T extends ReturnType<typeof parsePageArtifact>>(
  draft: T,
  action: WebsiteGrowthAction,
  route: string | null
): T {
  const existingPage = action === WebsiteGrowthAction.IMPROVE_EXISTING_PAGE ||
    action === WebsiteGrowthAction.ADD_SECTION ||
    action === WebsiteGrowthAction.ADD_INTERNAL_LINKS;

  if (!existingPage) {
    return draft;
  }

  const pagePreview = record(draft.pagePreview);
  const pageChangePreview = record(draft.pageChangePreview);
  const currentPage = record(pageChangePreview.currentPage);

  return {
    ...draft,
    contentType: "Existing page improvement",
    proposedPath: route ?? draft.proposedPath,
    pagePreview: {
      ...pagePreview,
      mode: action === WebsiteGrowthAction.ADD_INTERNAL_LINKS ? "internal_link_update" : "existing_page_update"
    },
    pageChangePreview: {
      ...pageChangePreview,
      currentPage: {
        ...currentPage,
        path: route ?? currentPage.path
      },
      approvalSummary: route
        ? `Update the existing page at ${route} using only the scoped changes in this brief. Do not create a new route.`
        : pageChangePreview.approvalSummary
    }
  } as T;
}

function projectAuthorityHandoffs<T extends Work>(items: T[], campaign: { enabled: boolean } | null): T[] {
  return items.map(item => {
    if (["DONE", "DISMISSED"].includes(item.state)) return item;
    const retiredReply = campaign && item.kind === "RELATIONSHIP";
    const pausedCampaign = item.evidence.source === "authority-campaign" && !campaign?.enabled;
    return retiredReply || pausedCampaign ? { ...item, state: "WAITING" as const, evidence: { ...item.evidence, externalWait: true },
      nextAction: retiredReply ? "This conversation is now managed in Authority campaigns. Review its exact next action there." : "Authority campaign is paused. Enable it in the campaign control centre before research resumes." } : item;
  });
}
