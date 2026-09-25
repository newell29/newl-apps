import { type Prisma } from "@prisma/client";
import { getWebsiteGrowthBuildRetryState, WEBSITE_GROWTH_BUILD_JOB_TYPE } from "@/modules/website-growth/build-requests";
import { nextWork, record, type Work } from "./model";

/** Read current source records in the caller's tenant/transaction. An AI never decides whether an approval happened. */
export async function projectPageHandoffs(tx: Prisma.TransactionClient, tenantId: string, items: Array<Work & { id: string }>) {
  const pages = items.filter(item => item.kind === "PAGE" && item.referenceId);
  if (!pages.length) return items;
  const drafts = await tx.websiteGrowthContentDraft.findMany({ where: { tenantId, opportunityId: { in: pages.map(item => item.referenceId!) } },
    orderBy: { createdAt: "desc" }, select: { id: true, opportunityId: true, status: true }, take: 1000 });
  if (!drafts.length) return items;
  const builds = await tx.automationJobRun.findMany({ where: { tenantId, jobType: WEBSITE_GROWTH_BUILD_JOB_TYPE,
    OR: drafts.map(draft => ({ input: { path: ["contentDraftId"], equals: draft.id } })) }, orderBy: { createdAt: "desc" }, take: 1000 });
  return items.map(work => {
    if (work.kind !== "PAGE") return work;
    const draft = drafts.find(row => row.opportunityId === work.referenceId);
    if (!draft) return work;
    // An owner's request for a revision remains research until a new brief is delivered.
    if (draft.status === "DRAFT" && ["READY", "WORKING", "WAITING", "DISMISSED"].includes(work.state) && draft.id === work.draftId) return work;
    const build = builds.find(row => record(row.input).contentDraftId === draft.id);
    const phase = String(record(build?.output).phase ?? "");
    const retry = build ? getWebsiteGrowthBuildRetryState(build) : null;
    const state: Work["state"] = draft.status === "PUBLISHED" ? "DONE" : draft.status === "REJECTED" ? "DISMISSED" : draft.status === "DRAFT" ? "NEEDS_REVIEW" : "WAITING";
    const externalWait = state === "WAITING";
    const needsOwner = externalWait && (!build || retry?.canRetry === true || ["PR_OPEN", "PREVIEW_READY"].includes(phase));
    const nextAction = state === "DONE" ? "Published; Scout will review the measured outcome after the reporting window."
      : state === "DISMISSED" ? "The page brief was rejected."
      : state === "NEEDS_REVIEW" ? "Review the complete page brief."
      : !build ? "The brief is approved but no build is recorded. Open the brief to start or retry the build."
      : retry?.canRetry ? "The build failed or stopped reporting progress. Open the brief to review recovery and retry."
      : phase === "PREVIEW_READY" ? "The preview is ready. Review the build and decide whether to publish."
      : phase === "PR_OPEN" ? "The pull request is ready for review. Check the build and preview before publishing."
      : phase === "RUNNING" ? "The website builder is implementing your approved brief. No decision is needed yet."
      : "The approved brief is queued for the website builder. No decision is needed yet.";
    return { ...work, state, draftId: draft.id, nextAction, lease: null, leaseUntil: null,
      evidence: { ...work.evidence, externalWait, escalation: null,
        handoff: { draftStatus: draft.status, phase: externalWait ? phase || null : null, needsOwner } } };
  });
}

/** Return a persisted transition only when the authoritative handoff changed semantically. */
export function pageHandoffTransition(previousInput: Work, projectedInput: Work, now = new Date()) {
  const previous = persistedWork(previousInput);
  const projected = persistedWork(projectedInput);
  if (JSON.stringify(previous) === JSON.stringify(projected)) return null;
  return nextWork(previous, projected, "HANDOFF", projected.nextAction, now);
}

function persistedWork(work: Work): Work {
  const persisted = { ...work } as Work & { id?: string };
  delete persisted.id;
  return persisted;
}

export function needsOwner(work: Work) {
  return work.state === "NEEDS_REVIEW" || record(work.evidence.handoff).needsOwner === true || Boolean(work.evidence.escalation);
}
