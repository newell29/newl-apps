import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { DAY_MS, newWork, nextWork, readWork, record, stableId, WORK_JOB } from "../scout/model";
import { authorityCampaign, authorityWorkspace } from "./store";

/** Reuse a single campaign investigation; new replies get priority without generating a research treadmill. */
export async function reconcileAuthorityResearch(tenantId: string, now = new Date()) {
  const campaign = await authorityCampaign(tenantId);
  if (!campaign?.enabled) return;
  const { actions, opportunities } = await authorityWorkspace(tenantId);
  const reply = opportunities.find(o => o.status === "REPLIED" && o.lastReplyAt &&
    !actions.some(a => a.plan.opportunityId === o.id && ["REVIEW", "APPROVED", "RUNNING", "UNCERTAIN"].includes(a.state)));
  const replyKey = reply ? `${reply.id}:${reply.lastReplyAt!.toISOString()}` : null;
  const id = stableId(tenantId, "research:authority-campaign");
  const work = newWork("RESEARCH", campaign.id, "Earn relevant placements and finish publisher conversations",
    campaign.hypothesis, new URL(campaign.targetPage).pathname, { source: "authority-campaign", replyKey }, now);
  await prisma.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id } }, create: { tenantId, id, jobType: WORK_JOB,
    status: "QUEUED", output: work as unknown as Prisma.InputJsonValue }, update: {} });
  const job = await prisma.automationJobRun.findFirst({ where: { tenantId, id, jobType: WORK_JOB } });
  const saved = readWork(job?.output);
  if (!saved) return;
  const freshReply = replyKey && saved.evidence.replyKey !== replyKey;
  if (!["WORKING", "NEEDS_REVIEW"].includes(saved.state) && ((saved.state === "DONE" && Date.parse(saved.nextReviewAt) <= now.getTime()) || freshReply)) {
    const next = nextWork(saved, { state: "READY", attempts: 0, nextReviewAt: now.toISOString(),
      evidence: { ...saved.evidence, replyKey, externalWait: false } }, "AUTHORITY_DUE", freshReply ? "A new publisher reply needs a concrete next action." : "Review campaign execution and dated results before finding more prospects.", now);
    await prisma.automationJobRun.updateMany({ where: { tenantId, id, jobType: WORK_JOB, output: { path: ["revision"], equals: saved.revision } },
      data: { output: next as unknown as Prisma.InputJsonValue } });
  }
  // Placements receive observational reviews at 28/56/90 days using existing independent analytics reads.
  for (const placement of opportunities.filter(o => o.status === "LIVE" && o.verifiedAt && o.liveUrl)) {
    const route = placement.targetPage.startsWith("/") ? placement.targetPage : new URL(placement.targetPage).pathname;
    for (const days of [28, 56, 90]) {
      const reviewId = stableId(tenantId, `authority-measure:${placement.id}:${placement.verifiedAt!.toISOString()}:${days}`);
      const measurement = newWork("MEASUREMENT", placement.id, `Placement review at ${days} days: ${placement.title}`,
        "Review target-page trends after the observed placement. Do not attribute SEO movement to this link alone; report referral and qualified-lead evidence gaps.", route,
        { source: "authority-placement", verifiedAt: placement.verifiedAt!.toISOString(), liveUrl: placement.liveUrl, window: days }, now);
      measurement.state = "WAITING";
      measurement.nextReviewAt = new Date(placement.verifiedAt!.getTime() + (days + 4) * DAY_MS).toISOString();
      await prisma.automationJobRun.upsert({ where: { tenantId_id: { tenantId, id: reviewId } }, create: { tenantId, id: reviewId,
        jobType: WORK_JOB, status: "QUEUED", output: measurement as unknown as Prisma.InputJsonValue }, update: {} });
    }
  }
}

export async function wakeAuthorityResearch(tenantId: string) {
  const id = stableId(tenantId, "research:authority-campaign");
  const job = await prisma.automationJobRun.findFirst({ where: { tenantId, id, jobType: WORK_JOB } });
  const work = readWork(job?.output);
  if (!work || work.state === "WORKING") return;
  const next = nextWork(work, { state: "READY", nextReviewAt: new Date().toISOString(), evidence: { ...work.evidence, externalWait: false } }, "OWNER_FEEDBACK", "Review the latest action feedback before further discovery.");
  await prisma.automationJobRun.updateMany({ where: { tenantId, id, jobType: WORK_JOB, output: { path: ["revision"], equals: work.revision } }, data: { output: next as unknown as Prisma.InputJsonValue } });
}

export function authorityResultArtifact(value: unknown) {
  const artifact = record(value);
  return Array.isArray(artifact.authorityActions) ? artifact.authorityActions : [];
}
