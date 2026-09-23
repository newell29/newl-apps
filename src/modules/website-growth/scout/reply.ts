import { rejectLegacyAuthority } from "@/modules/website-growth/authority/store";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import { createAndSendMicrosoftGraphMailboxMessage } from "@/server/integrations/microsoft-graph-mail";
import { assertSafeWebsiteGrowthOutreachCopy, buildCompliantWebsiteGrowthOutreachBody, readWebsiteGrowthOutreachIdentity,
  syncWebsiteGrowthOutreachReplies, validateWebsiteGrowthOutreachConsent } from "@/modules/website-growth/backlink-outreach";
import { DAY_MS, WORK_JOB, ScoutWorkError, nextWork, readWork, stableId, text } from "./model";

/** Called only by the authenticated Admin/Manager approval action; never exposed to the worker. */
export async function approveAndSendScoutReply(tenantId: string, userId: string, id: string, revision: number) {
  await rejectLegacyAuthority(tenantId);
  await syncWebsiteGrowthOutreachReplies({ tenantId });
  const identity = readWebsiteGrowthOutreachIdentity();
  const token = await getMicrosoftGraphApplicationAccessToken();
  const messageId = stableId(tenantId, `reply-send:${id}`);
  const reservation = await prisma.$transaction(async tx => {
    const job = await tx.automationJobRun.findFirst({ where: { tenantId, id, jobType: WORK_JOB } });
    const work = readWork(job?.output);
    if (!work || work.kind !== "RELATIONSHIP" || work.state !== "NEEDS_REVIEW" || work.revision !== revision || !work.artifact) throw new ScoutWorkError("The proposed response changed. Reload before approving.", 409);
    const opportunity = await tx.websiteGrowthBacklinkOpportunity.findFirst({ where: { tenantId, id: work.referenceId ?? "", status: "REPLIED", unsubscribedAt: null,
      approvedAt: { not: null }, approvedByUserId: { not: null }, category: { not: "PAID_PLACEMENT" } } });
    if (!opportunity || opportunity.lastReplyAt?.toISOString() !== work.evidence.replyAt || !opportunity.recipientEmail || opportunity.recipientEmail.trim().toLowerCase() !== work.evidence.replyRecipient || !opportunity.consentBasis || !opportunity.contactSourceUrl ||
      (opportunity.recipientCountry !== "CA" && opportunity.recipientCountry !== "US")) throw new ScoutWorkError("The latest conversation or approval evidence changed. Review it again.", 409);
    validateWebsiteGrowthOutreachConsent({ recipientCountry: opportunity.recipientCountry, consentBasis: opportunity.consentBasis, contactSourceUrl: opportunity.contactSourceUrl });
    const subject = text(work.artifact.subject, "Subject", 180), copy = text(work.artifact.body, "Reply", 4000);
    assertSafeWebsiteGrowthOutreachCopy(subject);
    assertSafeWebsiteGrowthOutreachCopy(copy);
    const suppressed = await tx.websiteGrowthOutreachSuppression.findUnique({ where: { tenantId_normalizedEmail: { tenantId, normalizedEmail: opportunity.recipientEmail.toLowerCase().trim() } } });
    if (suppressed) throw new ScoutWorkError("This recipient has opted out.", 409);
    const today = await tx.websiteGrowthOutreachMessage.count({ where: { tenantId, kind: "FOLLOW_UP", sentAt: { gte: new Date(Date.now() - DAY_MS) } } });
    if (today >= 10) throw new ScoutWorkError("The rolling daily follow-up and response limit is reached.", 409);
    const body = buildCompliantWebsiteGrowthOutreachBody({ body: copy, country: opportunity.recipientCountry, identity });
    // Unique message ID reserves this exact approval before any external action. An uncertain send is never replayed.
    await tx.websiteGrowthOutreachMessage.create({ data: { id: messageId, tenantId, opportunityId: opportunity.id,
      kind: "FOLLOW_UP", recipientEmail: opportunity.recipientEmail, subject, body } });
    const pending = nextWork(work, { state: "WAITING", evidence: { ...work.evidence, externalWait: true, replySend: "PENDING", approvedByUserId: userId },
      nextAction: "Wait for Microsoft 365 to confirm this response. Do not send it again." }, "REPLY_APPROVED", "Owner approved the exact saved response.");
    const changed = await tx.automationJobRun.updateMany({ where: { tenantId, id, jobType: WORK_JOB, output: { path: ["revision"], equals: revision } }, data: { output: pending as unknown as Prisma.InputJsonValue } });
    if (changed.count !== 1) throw new ScoutWorkError("The response was already claimed.", 409);
    await tx.auditLog.create({ data: { tenantId, actorUserId: userId, action: "website-growth.scout.reply-approved", entityType: "AutomationJobRun", entityId: id,
      after: { messageId, opportunityId: opportunity.id, replyAt: work.evidence.replyAt as string } } });
    return { work: pending, opportunity, subject, body };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  try {
    const sent = await createAndSendMicrosoftGraphMailboxMessage(token, identity.mailbox, { recipientEmail: reservation.opportunity.recipientEmail!,
      recipientName: reservation.opportunity.recipientName, subject: reservation.subject, body: reservation.body });
    await prisma.$transaction(async tx => {
      await tx.websiteGrowthOutreachMessage.updateMany({ where: { tenantId, id: messageId }, data: { externalMessageId: sent.id ?? `graph-sendmail-accepted:${messageId}`, conversationId: sent.conversationId } });
      const completed = nextWork(reservation.work, { state: "DONE", evidence: { ...reservation.work.evidence, replySend: "ACCEPTED" }, nextAction: "Response accepted by Microsoft 365. A new publisher reply creates a new work item." }, "REPLY_SENT", "Microsoft 365 accepted the owner-approved response.");
      await tx.automationJobRun.updateMany({ where: { tenantId, id, jobType: WORK_JOB }, data: { status: "SUCCESS", output: completed as unknown as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { tenantId, actorUserId: userId, action: "website-growth.scout.reply-sent", entityType: "AutomationJobRun", entityId: id, after: { messageId } } });
    });
  } catch {
    const uncertain = nextWork(reservation.work, { evidence: { ...reservation.work.evidence, replySend: "UNCERTAIN" }, nextAction: "Check the sent mailbox before taking further action. This response cannot be retried automatically." }, "REPLY_UNCERTAIN", "Microsoft 365 delivery could not be confirmed.");
    await prisma.automationJobRun.updateMany({ where: { tenantId, id, jobType: WORK_JOB }, data: { output: uncertain as unknown as Prisma.InputJsonValue } });
    throw new ScoutWorkError("Delivery is uncertain. Check the sent mailbox; automatic retry is blocked.", 409);
  }
}
