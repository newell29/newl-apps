import { createHash } from "node:crypto";
import { IntegrationProvider, JobStatus, ModuleKey, Prisma } from "@prisma/client";

import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import {
  OCEAN_FREIGHT_MICROSOFT_GRAPH_CREDENTIAL_NAME,
  parseOceanFreightMicrosoftGraphSettings
} from "@/modules/ocean-freight-pricing/microsoft-graph-settings";
import { prisma } from "@/server/db";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import {
  fetchMicrosoftGraphMailboxMessages,
  fetchMicrosoftGraphMessageAttachments,
  type MicrosoftGraphMailAttachment,
  type MicrosoftGraphMailFetchOptions,
  type MicrosoftGraphMailMessage,
  type MicrosoftGraphMailRecipient
} from "@/server/integrations/microsoft-graph-mail";
import type { AuthenticatedContext, TenantContext } from "@/server/tenant-context";

export const OCEAN_FREIGHT_EMAIL_INGESTION_JOB_TYPE = "ocean-freight-pricing.email-ingestion";


export type OceanFreightRateDetection = {
  rateDetected: boolean;
  detectionReason: string;
  matchedTerms: string[];
};

type GraphRecipient = MicrosoftGraphMailRecipient;
type GraphMailMessage = MicrosoftGraphMailMessage;
type MailFetchOptions = MicrosoftGraphMailFetchOptions;
type AttachmentFetcher = (message: GraphMailMessage, sourceEmail: { id: string; mailboxAddress: string }) => Promise<MicrosoftGraphMailAttachment[]>;

type IngestMessagesInput = {
  tenantId: string;
  actorUserId?: string | null;
  jobRunId: string;
  mailboxes: string[];
  messages: GraphMailMessage[];
  attachmentFetcher?: AttachmentFetcher;
};

const RATE_TERMS = [
  "ocean rate",
  "freight rate",
  "fcl",
  "lcl",
  "20gp",
  "40gp",
  "40hq",
  "45hq",
  "validity",
  "valid until",
  "pol",
  "pod",
  "port to port",
  "carrier",
  "shipping line",
  "free time",
  "demurrage",
  "detention",
  "promotion",
  "rate sheet"
];

export function detectOceanFreightRateEmail(input: { subject?: string | null; bodyPreview?: string | null; bodyText?: string | null }): OceanFreightRateDetection {
  const haystack = `${input.subject ?? ""}\n${input.bodyPreview ?? ""}\n${input.bodyText ?? ""}`.toLowerCase();
  const matchedTerms = RATE_TERMS.filter((term) => new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i").test(haystack));
  const rateDetected = matchedTerms.length >= 2 || matchedTerms.some((term) => ["ocean rate", "freight rate", "rate sheet"].includes(term));
  return {
    rateDetected,
    matchedTerms,
    detectionReason: rateDetected
      ? `Matched ocean freight pricing term(s): ${matchedTerms.join(", ")}.`
      : matchedTerms.length > 0
        ? `Insufficient ocean pricing evidence; matched only: ${matchedTerms.join(", ")}.`
        : "No ocean freight pricing terms matched."
  };
}

export function normalizeEmailBodyText(value?: string | null) {
  return (value ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export async function triggerOceanFreightEmailIngestion(ctx: AuthenticatedContext) {
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  await requireMutationAccess(ctx);

  const job = await prisma.automationJobRun.create({
    data: {
      tenantId: ctx.tenantId,
      jobType: OCEAN_FREIGHT_EMAIL_INGESTION_JOB_TYPE,
      status: JobStatus.QUEUED,
      input: { triggeredBy: ctx.userId }
    }
  });

  return runOceanFreightEmailIngestionJob(ctx, job.id);
}

export async function runOceanFreightEmailIngestionJob(ctx: TenantContext & { userId?: string | null }, jobRunId: string) {
  const startedAt = new Date();
  await prisma.automationJobRun.update({
    where: { id: jobRunId },
    data: { status: JobStatus.RUNNING, startedAt }
  });
  await writeAudit(ctx, "ocean-freight.ingestion.started", "AutomationJobRun", jobRunId, { startedAt });

  try {
    const settings = await getOceanGraphSettings(ctx.tenantId);
    if (!settings.mailSyncEnabled) throw new Error("Microsoft 365 mail sync is disabled for this tenant.");
    if (settings.mailboxAccessMode !== "ADMIN_SELECTED_MAILBOXES" || settings.adminMailboxTargets.length === 0) {
      throw new Error("Configure one or more Microsoft 365 admin-selected mailbox targets before running ocean freight ingestion.");
    }
    if (!settings.crossMailboxReady) throw new Error(settings.runtimeNotes);

    const accessToken = await getMicrosoftGraphApplicationAccessToken();
    const mailboxResults = await fetchSelectedMailboxMessages(accessToken, settings.adminMailboxTargets, {
      lookbackDays: settings.mailLookbackDays,
      maxMessagesPerMailbox: settings.maxMailMessagesPerMailbox
    });
    const result = await persistOceanFreightSourceEmails({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      jobRunId,
      mailboxes: settings.adminMailboxTargets,
      messages: mailboxResults.messages,
      attachmentFetcher: async (message, sourceEmail) =>
        fetchMicrosoftGraphMessageAttachments(accessToken, sourceEmail.mailboxAddress, message.id)
    });
    const output = { ...result, failures: mailboxResults.failures };
    const status = mailboxResults.failures.length > 0 ? JobStatus.ERROR : JobStatus.SUCCESS;
    const errorMessage = mailboxResults.failures.length > 0 ? mailboxResults.failures.map((f) => `${f.mailbox}: ${f.reason}`).join(" | ") : null;

    await prisma.automationJobRun.update({ where: { id: jobRunId }, data: { status, finishedAt: new Date(), output, errorMessage } });
    await writeAudit(ctx, status === JobStatus.SUCCESS ? "ocean-freight.ingestion.completed" : "ocean-freight.ingestion.failed", "AutomationJobRun", jobRunId, output);
    return { jobRunId, status, ...output };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ocean freight ingestion error.";
    await prisma.automationJobRun.update({ where: { id: jobRunId }, data: { status: JobStatus.ERROR, finishedAt: new Date(), errorMessage: message, output: { error: message } } });
    await writeAudit(ctx, "ocean-freight.ingestion.failed", "AutomationJobRun", jobRunId, { error: message });
    throw error;
  }
}

export async function persistOceanFreightSourceEmails(input: IngestMessagesInput) {
  let storedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let detectedRateEmailCount = 0;
  let attachmentsFetched = 0;
  let attachmentsStored = 0;
  let attachmentErrors = 0;
  const attachmentErrorDetails: Array<{ sourceEmailId: string; graphMessageId: string; reason: string }> = [];
  const processedAt = new Date();

  for (const message of input.messages) {
    const bodyText = normalizeEmailBodyText(message.body?.content ?? message.bodyPreview ?? "");
    const detection = detectOceanFreightRateEmail({ subject: message.subject, bodyPreview: message.bodyPreview, bodyText });
    const mailboxAddress = (message.mailboxAddress || input.mailboxes[0] || "unknown").toLowerCase();
    const bodyContentHash = bodyText ? createHash("sha256").update(bodyText).digest("hex") : null;
    const data = {
      tenantId: input.tenantId,
      mailboxAddress,
      graphMessageId: message.id,
      internetMessageId: message.internetMessageId ?? null,
      conversationId: message.conversationId ?? null,
      subject: message.subject ?? "(no subject)",
      fromName: message.from?.emailAddress?.name ?? null,
      fromAddress: message.from?.emailAddress?.address?.toLowerCase() ?? null,
      toRecipients: serializeRecipients(message.toRecipients),
      ccRecipients: serializeRecipients(message.ccRecipients),
      receivedAt: parseDate(message.receivedDateTime) ?? processedAt,
      webLink: message.webLink ?? null,
      bodyPreview: message.bodyPreview ?? null,
      normalizedBodyText: bodyText || null,
      bodyContentHash,
      rateDetected: detection.rateDetected,
      detectionReason: detection.detectionReason,
      processedAt
    } satisfies Prisma.OceanFreightSourceEmailUncheckedCreateInput;

    const before = await prisma.oceanFreightSourceEmail.findUnique({ where: { tenantId_mailboxAddress_graphMessageId: { tenantId: input.tenantId, mailboxAddress, graphMessageId: message.id } }, select: { id: true } });
    const sourceEmail = await prisma.oceanFreightSourceEmail.upsert({
      where: { tenantId_mailboxAddress_graphMessageId: { tenantId: input.tenantId, mailboxAddress, graphMessageId: message.id } },
      create: data,
      update: data
    });
    storedCount += 1;
    if (before) updatedCount += 1; else createdCount += 1;
    if (detection.rateDetected) detectedRateEmailCount += 1;

    if (input.attachmentFetcher) {
      try {
        const attachments = await input.attachmentFetcher(message, { id: sourceEmail.id, mailboxAddress });
        attachmentsFetched += attachments.length;
        for (const attachment of attachments) {
          await upsertOceanFreightSourceAttachment(input.tenantId, sourceEmail.id, attachment);
          attachmentsStored += 1;
        }
      } catch (error) {
        attachmentErrors += 1;
        attachmentErrorDetails.push({
          sourceEmailId: sourceEmail.id,
          graphMessageId: message.id,
          reason: error instanceof Error ? error.message : "Unknown Microsoft Graph attachment error."
        });
      }
    }
  }

  return { mailboxCount: input.mailboxes.length, messageCount: input.messages.length, storedCount, createdCount, updatedCount, detectedRateEmailCount, attachmentsFetched, attachmentsStored, attachmentErrors, attachmentErrorDetails };
}

async function upsertOceanFreightSourceAttachment(tenantId: string, sourceEmailId: string, attachment: MicrosoftGraphMailAttachment) {
  const fileName = attachment.name?.trim() || "(unnamed attachment)";
  const contentType = attachment.contentType?.trim() || null;
  const sizeBytes = typeof attachment.size === "number" ? attachment.size : null;
  const stableHashInput = JSON.stringify({
    graphAttachmentId: attachment.id,
    fileName,
    contentType,
    sizeBytes,
    contentId: attachment.contentId ?? null,
    lastModifiedDateTime: attachment.lastModifiedDateTime ?? null
  });
  const contentHash = createHash("sha256").update(stableHashInput).digest("hex");
  const data = { tenantId, sourceEmailId, graphAttachmentId: attachment.id, fileName, contentType, sizeBytes, contentHash, parseStatus: "METADATA_ONLY", parseError: null } satisfies Prisma.OceanFreightSourceAttachmentUncheckedCreateInput;
  await prisma.oceanFreightSourceAttachment.upsert({
    where: { tenantId_sourceEmailId_graphAttachmentId: { tenantId, sourceEmailId, graphAttachmentId: attachment.id } },
    create: data,
    update: data
  });
}

async function getOceanGraphSettings(tenantId: string) {
  const credential = await prisma.integrationCredential.findFirst({
    where: { tenantId, provider: IntegrationProvider.MICROSOFT_GRAPH, name: OCEAN_FREIGHT_MICROSOFT_GRAPH_CREDENTIAL_NAME },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { provider: true, status: true, publicConfig: true }
  });
  return parseOceanFreightMicrosoftGraphSettings(credential);
}

async function fetchSelectedMailboxMessages(accessToken: string, mailboxes: string[], options: MailFetchOptions) {
  const results = await Promise.all(mailboxes.map(async (mailbox) => {
    try {
      const messages = await fetchMicrosoftGraphMailboxMessages(accessToken, mailbox, options);
      return { mailbox, messages, reason: null as string | null };
    } catch (error) {
      return { mailbox, messages: [] as GraphMailMessage[], reason: error instanceof Error ? error.message : "Unknown Microsoft Graph mailbox error." };
    }
  }));
  return { messages: results.flatMap((result) => result.messages), failures: results.flatMap((result) => result.reason ? [{ mailbox: result.mailbox, reason: result.reason }] : []) };
}

function serializeRecipients(recipients?: GraphRecipient[] | null) {
  const values = (recipients ?? []).map((recipient) => ({ name: recipient.emailAddress?.name ?? null, address: recipient.emailAddress?.address?.toLowerCase() ?? null })).filter((recipient) => recipient.name || recipient.address);
  return values.length > 0 ? values : Prisma.JsonNull;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function writeAudit(ctx: { tenantId: string; userId?: string | null }, action: string, entityType: string, entityId: string | null, after?: unknown) {
  await prisma.auditLog.create({ data: { tenantId: ctx.tenantId, actorUserId: ctx.userId ?? null, action, entityType, entityId, after: after as Prisma.InputJsonValue } });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
