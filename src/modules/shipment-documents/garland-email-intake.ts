import { createHash } from "node:crypto";
import { IntegrationProvider, IntegrationStatus, ModuleKey, Prisma } from "@prisma/client";

import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
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
import { parseMicrosoftGraphSettings } from "@/server/integrations/microsoft-graph";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const GARLAND_EMAIL_SYNC_TRIGGER_MANUAL = "MANUAL";
export const GARLAND_EMAIL_SYNC_TRIGGER_SCHEDULED = "SCHEDULED";
export const GARLAND_EMAIL_SYNC_STATUS_SUCCESS = "SUCCESS";
export const GARLAND_EMAIL_SYNC_STATUS_FAILED = "FAILED";

export type GarlandEmailClassification =
  | "GARLAND_DOCUMENT_BATCH"
  | "GARLAND_DOCUMENT_CORRECTION"
  | "GARLAND_FOLLOW_UP"
  | "IGNORED";

export type GarlandEmailDetection = {
  classification: GarlandEmailClassification;
  reason: string;
  score: number;
  expectedOrderCount: number | null;
  expectedPageCount: number | null;
  expectedPsStart: string | null;
  expectedPsEnd: string | null;
  hasPdfAttachment: boolean;
};

type GarlandSourceEmailWithAttachments = Prisma.GarlandSourceEmailGetPayload<{
  include: {
    attachments: {
      select: {
        id: true;
        fileName: true;
        contentType: true;
        sizeBytes: true;
        contentHash: true;
        intakeStatus: true;
        pageCount: true;
        createdAt: true;
      };
    };
  };
}>;

export type GarlandEmailIntakeGroup = {
  id: string;
  batchKey: string;
  primaryEmail: GarlandSourceEmailWithAttachments;
  emails: GarlandSourceEmailWithAttachments[];
  emailCount: number;
  duplicateCount: number;
  hasPdfAttachment: boolean;
  expectedOrderCount: number | null;
  expectedPageCount: number | null;
  expectedPsStart: string | null;
  expectedPsEnd: string | null;
  classification: GarlandEmailClassification;
};

type AttachmentFetcher = (
  message: MicrosoftGraphMailMessage,
  sourceEmail: { id: string; mailboxAddress: string }
) => Promise<MicrosoftGraphMailAttachment[]>;

type PersistInput = {
  tenantId: string;
  actorUserId?: string | null;
  mailboxes: string[];
  messages: MicrosoftGraphMailMessage[];
  attachmentFetcher?: AttachmentFetcher;
};

type SyncInput = {
  tenantId: string;
  userId: string | null;
  mailboxAddress?: string | null;
  lookbackDays?: number | null;
  maxMessagesPerMailbox?: number | null;
  triggerSource?: string | null;
};

const GARLAND_DOMAIN = "garland-group.com";
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MAX_MESSAGES = 100;

export function normalizeGarlandEmailBodyText(value?: string | null) {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function classifyGarlandEmail(input: {
  subject?: string | null;
  bodyPreview?: string | null;
  bodyText?: string | null;
  fromAddress?: string | null;
  attachments?: Array<{ name?: string | null; contentType?: string | null }> | null;
  hasAttachments?: boolean | null;
}): GarlandEmailDetection {
  const subject = input.subject ?? "";
  const bodyText = input.bodyText ?? input.bodyPreview ?? "";
  const fromAddress = input.fromAddress?.trim().toLowerCase() ?? "";
  const attachments = input.attachments ?? [];
  const hasPdfAttachment = attachments.some(isPdfAttachment);
  const psRange = parseGarlandSubjectRange(subject);
  const lowerHaystack = `${subject}\n${input.bodyPreview ?? ""}\n${bodyText}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (fromAddress.endsWith(`@${GARLAND_DOMAIN}`)) {
    score += 40;
    reasons.push("sender is a Garland domain");
  }

  if (psRange) {
    score += 30;
    reasons.push("subject includes a PS range");
  }

  if (/\b\d+\s+orders?\b/i.test(subject) && /\b\d+\s+pages?\b/i.test(subject)) {
    score += 20;
    reasons.push("subject includes order/page counts");
  }

  if (hasPdfAttachment) {
    score += 30;
    reasons.push("PDF attachment found");
  } else if (input.hasAttachments) {
    score += 5;
    reasons.push("message has attachment(s), but no PDF metadata was found");
  }

  if (/\b(attached|pls see attached|please see attached)\b/i.test(lowerHaystack)) {
    score += 10;
    reasons.push("body references an attachment");
  }

  const looksLikeGarland = score >= 35 || Boolean(psRange);
  const isCorrection = /\b(revised|revision|corrected|correction|updated|replacement|resend|re-send)\b/i.test(
    lowerHaystack
  );
  const classification: GarlandEmailClassification =
    looksLikeGarland && hasPdfAttachment
      ? isCorrection
        ? "GARLAND_DOCUMENT_CORRECTION"
        : "GARLAND_DOCUMENT_BATCH"
      : looksLikeGarland
        ? "GARLAND_FOLLOW_UP"
        : "IGNORED";

  if (classification === "IGNORED") {
    reasons.push("not enough Garland document evidence");
  }

  return {
    classification,
    reason: reasons.join("; ") || "No Garland intake signals matched.",
    score,
    expectedOrderCount: psRange?.orderCount ?? null,
    expectedPageCount: psRange?.pageCount ?? null,
    expectedPsStart: psRange?.psStart ?? null,
    expectedPsEnd: psRange?.psEnd ?? null,
    hasPdfAttachment
  };
}

export async function syncGarlandEmailIntake(ctx: AuthenticatedContext, input: SyncInput) {
  await requireModule(ctx, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(ctx);

  const settings = await getGarlandGraphSettings(ctx.tenantId);
  if (!settings.mailSyncEnabled) {
    throw new Error("Microsoft 365 mail sync is disabled for this tenant.");
  }
  if (!settings.crossMailboxReady) {
    throw new Error(settings.runtimeNotes);
  }

  const mailboxes = resolveGarlandMailboxes(settings.adminMailboxTargets, input.mailboxAddress);
  const fetchOptions = buildFetchOptions(input, settings);
  const accessToken = await getMicrosoftGraphApplicationAccessToken();
  const run = await prisma.garlandEmailSyncRun.create({
    data: {
      tenantId: ctx.tenantId,
      mailboxAddress: mailboxes.join(", "),
      triggerSource: input.triggerSource?.trim() || GARLAND_EMAIL_SYNC_TRIGGER_MANUAL,
      status: "RUNNING",
      createdByUserId: input.userId
    }
  });

  try {
    const mailboxResults = await fetchSelectedMailboxMessages(accessToken, mailboxes, fetchOptions);
    const persistResult = await persistGarlandSourceEmails({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      mailboxes,
      messages: mailboxResults.messages,
      attachmentFetcher: async (message, sourceEmail) =>
        shouldFetchAttachmentMetadata(message)
          ? fetchMicrosoftGraphMessageAttachments(accessToken, sourceEmail.mailboxAddress, message.id)
          : []
    });
    const status =
      mailboxResults.failures.length > 0 ? GARLAND_EMAIL_SYNC_STATUS_FAILED : GARLAND_EMAIL_SYNC_STATUS_SUCCESS;
    const errorMessage =
      mailboxResults.failures.length > 0
        ? mailboxResults.failures.map((failure) => `${failure.mailbox}: ${failure.reason}`).join(" | ")
        : null;

    const updatedRun = await prisma.garlandEmailSyncRun.update({
      where: { id: run.id },
      data: {
        status,
        messageCount: persistResult.messageCount,
        candidateMessageCount: persistResult.candidateMessageCount,
        storedEmailCount: persistResult.storedCount,
        createdEmailCount: persistResult.createdCount,
        updatedEmailCount: persistResult.updatedCount,
        attachmentCount: persistResult.attachmentsFetched,
        storedAttachmentCount: persistResult.attachmentsStored,
        duplicateAttachmentCount: persistResult.duplicateAttachmentCount,
        errorMessage,
        finishedAt: new Date()
      }
    });
    await writeAudit(ctx, "garland.email-intake.synced", "GarlandEmailSyncRun", run.id, {
      ...persistResult,
      failures: mailboxResults.failures
    });

    return {
      run: updatedRun,
      ...persistResult,
      failures: mailboxResults.failures
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Garland email intake error.";
    await prisma.garlandEmailSyncRun.update({
      where: { id: run.id },
      data: { status: GARLAND_EMAIL_SYNC_STATUS_FAILED, errorMessage: message, finishedAt: new Date() }
    });
    await writeAudit(ctx, "garland.email-intake.failed", "GarlandEmailSyncRun", run.id, { error: message });
    throw error;
  }
}

export async function persistGarlandSourceEmails(input: PersistInput) {
  let storedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let candidateMessageCount = 0;
  let attachmentsFetched = 0;
  let attachmentsStored = 0;
  let duplicateAttachmentCount = 0;
  let attachmentErrors = 0;
  const attachmentErrorDetails: Array<{ sourceEmailId: string; graphMessageId: string; reason: string }> = [];
  const processedAt = new Date();

  for (const message of input.messages) {
    const mailboxAddress = (message.mailboxAddress || input.mailboxes[0] || "unknown").toLowerCase();
    const bodyText = normalizeGarlandEmailBodyText(message.body?.content ?? message.bodyPreview ?? "");
    let attachments: MicrosoftGraphMailAttachment[] = [];

    if (input.attachmentFetcher && shouldFetchAttachmentMetadata(message)) {
      try {
        attachments = await input.attachmentFetcher(message, { id: "", mailboxAddress });
        attachmentsFetched += attachments.length;
      } catch (error) {
        attachmentErrors += 1;
        attachmentErrorDetails.push({
          sourceEmailId: "",
          graphMessageId: message.id,
          reason: error instanceof Error ? error.message : "Unknown Microsoft Graph attachment error."
        });
      }
    }

    const detection = classifyGarlandEmail({
      subject: message.subject,
      bodyPreview: message.bodyPreview,
      bodyText,
      fromAddress: message.from?.emailAddress?.address,
      attachments,
      hasAttachments: message.hasAttachments
    });
    const isCandidate = detection.classification !== "IGNORED";
    if (isCandidate) {
      candidateMessageCount += 1;
    }

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
      classification: detection.classification,
      classificationReason: detection.reason,
      candidateScore: detection.score,
      hasPdfAttachment: detection.hasPdfAttachment,
      expectedOrderCount: detection.expectedOrderCount,
      expectedPageCount: detection.expectedPageCount,
      expectedPsStart: detection.expectedPsStart,
      expectedPsEnd: detection.expectedPsEnd,
      processedAt
    } satisfies Prisma.GarlandSourceEmailUncheckedCreateInput;

    const before = await prisma.garlandSourceEmail.findUnique({
      where: {
        tenantId_mailboxAddress_graphMessageId: {
          tenantId: input.tenantId,
          mailboxAddress,
          graphMessageId: message.id
        }
      },
      select: { id: true }
    });
    const sourceEmail = await prisma.garlandSourceEmail.upsert({
      where: {
        tenantId_mailboxAddress_graphMessageId: {
          tenantId: input.tenantId,
          mailboxAddress,
          graphMessageId: message.id
        }
      },
      create: data,
      update: data
    });

    storedCount += 1;
    if (before) {
      updatedCount += 1;
    } else {
      createdCount += 1;
    }

    for (const attachment of attachments) {
      const wasExisting = await upsertGarlandSourceAttachment(input.tenantId, sourceEmail.id, attachment);
      attachmentsStored += 1;
      if (wasExisting) {
        duplicateAttachmentCount += 1;
      }
    }
  }

  return {
    mailboxCount: input.mailboxes.length,
    messageCount: input.messages.length,
    candidateMessageCount,
    storedCount,
    createdCount,
    updatedCount,
    attachmentsFetched,
    attachmentsStored,
    duplicateAttachmentCount,
    attachmentErrors,
    attachmentErrorDetails
  };
}

export async function listGarlandEmailIntake(tenantId: string, options?: { search?: string | null; limit?: number | null }) {
  const search = options?.search?.trim() ?? "";
  const take = Math.min(100, Math.max(1, options?.limit ?? 25));
  const where: Prisma.GarlandSourceEmailWhereInput = {
    tenantId,
    classification: { not: "IGNORED" },
    ...(search
      ? {
          OR: [
            { subject: { contains: search, mode: "insensitive" } },
            { fromAddress: { contains: search, mode: "insensitive" } },
            { expectedPsStart: { contains: search, mode: "insensitive" } },
            { expectedPsEnd: { contains: search, mode: "insensitive" } },
            { attachments: { some: { fileName: { contains: search, mode: "insensitive" } } } }
          ]
        }
      : {})
  };

  const [emails, rawEmailCount, latestRun] = await Promise.all([
    prisma.garlandSourceEmail.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      take: Math.min(500, take * 5),
      include: {
        attachments: {
          orderBy: [{ fileName: "asc" }],
          select: {
            id: true,
            fileName: true,
            contentType: true,
            sizeBytes: true,
            contentHash: true,
            intakeStatus: true,
            pageCount: true,
            createdAt: true
          }
        }
      }
    }),
    prisma.garlandSourceEmail.count({ where }),
    prisma.garlandEmailSyncRun.findFirst({
      where: { tenantId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        mailboxAddress: true,
        status: true,
        messageCount: true,
        candidateMessageCount: true,
        storedEmailCount: true,
        createdEmailCount: true,
        updatedEmailCount: true,
        attachmentCount: true,
        storedAttachmentCount: true,
        duplicateAttachmentCount: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true
      }
    })
  ]);

  const groups = groupGarlandEmailIntake(emails).slice(0, take);

  return { emails, groups, totalCount: groups.length, rawEmailCount, latestRun };
}

export function groupGarlandEmailIntake(emails: GarlandSourceEmailWithAttachments[]): GarlandEmailIntakeGroup[] {
  const groupsByKey = new Map<string, GarlandSourceEmailWithAttachments[]>();

  for (const email of emails) {
    const key = buildGarlandEmailBatchKey(email);
    groupsByKey.set(key, [...(groupsByKey.get(key) ?? []), email]);
  }

  return Array.from(groupsByKey.entries())
    .map(([batchKey, groupEmails]) => {
      const sortedEmails = [...groupEmails].sort(compareGarlandEmailPriority);
      const primaryEmail = sortedEmails[0];
      const classification = chooseGroupClassification(sortedEmails);

      return {
        id: batchKey,
        batchKey,
        primaryEmail,
        emails: sortedEmails,
        emailCount: sortedEmails.length,
        duplicateCount: Math.max(0, sortedEmails.length - 1),
        hasPdfAttachment: sortedEmails.some((email) => email.hasPdfAttachment || email.attachments.some(isStoredPdfAttachment)),
        expectedOrderCount: primaryEmail.expectedOrderCount,
        expectedPageCount: primaryEmail.expectedPageCount,
        expectedPsStart: primaryEmail.expectedPsStart,
        expectedPsEnd: primaryEmail.expectedPsEnd,
        classification
      };
    })
    .sort((a, b) => b.primaryEmail.receivedAt.getTime() - a.primaryEmail.receivedAt.getTime());
}

async function upsertGarlandSourceAttachment(
  tenantId: string,
  sourceEmailId: string,
  attachment: MicrosoftGraphMailAttachment
) {
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
  const before = await prisma.garlandSourceAttachment.findUnique({
    where: { tenantId_sourceEmailId_graphAttachmentId: { tenantId, sourceEmailId, graphAttachmentId: attachment.id } },
    select: { id: true, intakeStatus: true }
  });
  const createData = {
    tenantId,
    sourceEmailId,
    graphAttachmentId: attachment.id,
    fileName,
    contentType,
    sizeBytes,
    contentHash,
    intakeStatus: isPdfAttachment(attachment) ? "PDF_METADATA_READY" : "METADATA_ONLY",
    parseError: null
  } satisfies Prisma.GarlandSourceAttachmentUncheckedCreateInput;
  const updateData: Prisma.GarlandSourceAttachmentUncheckedUpdateInput =
    before && ["PDF_PARSED", "PDF_DUPLICATE"].includes(before.intakeStatus)
      ? {
          fileName,
          contentType,
          sizeBytes
        }
      : createData;

  await prisma.garlandSourceAttachment.upsert({
    where: { tenantId_sourceEmailId_graphAttachmentId: { tenantId, sourceEmailId, graphAttachmentId: attachment.id } },
    create: createData,
    update: updateData
  });

  return Boolean(before);
}

export async function getGarlandGraphSettings(tenantId: string) {
  const credential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId,
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { provider: true, status: true, publicConfig: true }
  });

  return parseMicrosoftGraphSettings(credential);
}

function resolveGarlandMailboxes(configuredMailboxes: string[], requestedMailbox?: string | null) {
  const requested = requestedMailbox?.trim().toLowerCase();
  if (requested) {
    if (!configuredMailboxes.map((mailbox) => mailbox.toLowerCase()).includes(requested)) {
      throw new Error(`${requested} is not one of the tenant's configured Microsoft 365 mailbox targets.`);
    }

    return [requested];
  }

  const warehouseMailbox = configuredMailboxes.find((mailbox) => mailbox.toLowerCase() === "warehouse@newl.ca");
  return [warehouseMailbox ?? configuredMailboxes[0]].filter(Boolean).map((mailbox) => mailbox.toLowerCase());
}

function buildFetchOptions(
  input: Pick<SyncInput, "lookbackDays" | "maxMessagesPerMailbox">,
  settings: { mailLookbackDays: number; maxMailMessagesPerMailbox: number }
): MicrosoftGraphMailFetchOptions {
  return {
    lookbackDays: clampInteger(input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 1, settings.mailLookbackDays || 365),
    maxMessagesPerMailbox: clampInteger(
      input.maxMessagesPerMailbox ?? DEFAULT_MAX_MESSAGES,
      1,
      settings.maxMailMessagesPerMailbox || 2_000
    )
  };
}

async function fetchSelectedMailboxMessages(
  accessToken: string,
  mailboxes: string[],
  options: MicrosoftGraphMailFetchOptions
) {
  const results = await Promise.all(
    mailboxes.map(async (mailbox) => {
      try {
        const messages = await fetchMicrosoftGraphMailboxMessages(accessToken, mailbox, options);
        return { mailbox, messages, reason: null as string | null };
      } catch (error) {
        return {
          mailbox,
          messages: [] as MicrosoftGraphMailMessage[],
          reason: error instanceof Error ? error.message : "Unknown Microsoft Graph mailbox error."
        };
      }
    })
  );
  return {
    messages: results.flatMap((result) => result.messages),
    failures: results.flatMap((result) => (result.reason ? [{ mailbox: result.mailbox, reason: result.reason }] : []))
  };
}

function parseGarlandSubjectRange(subject: string) {
  const normalizedSubject = subject.replace(/\s+/g, " ").trim();
  const match = normalizedSubject.match(
    /(?:(\d+)\s+orders?\s+)?(?:(\d+)\s+pages?\s+)?[-:\s]*(PS\d{5,})\s*[-–]\s*(PS\d{5,})/i
  );

  if (!match) {
    return null;
  }

  return {
    orderCount: match[1] ? Number.parseInt(match[1], 10) : null,
    pageCount: match[2] ? Number.parseInt(match[2], 10) : null,
    psStart: normalizePsNumber(match[3]),
    psEnd: normalizePsNumber(match[4])
  };
}

function buildGarlandEmailBatchKey(email: Pick<GarlandSourceEmailWithAttachments, "expectedPsStart" | "expectedPsEnd" | "expectedOrderCount" | "expectedPageCount" | "receivedAt" | "conversationId" | "subject">) {
  const receivedDay = email.receivedAt.toISOString().slice(0, 10);
  if (email.expectedPsStart && email.expectedPsEnd) {
    return [
      "ps-range",
      receivedDay,
      email.expectedPsStart,
      email.expectedPsEnd,
      email.expectedOrderCount ?? "?",
      email.expectedPageCount ?? "?"
    ].join(":");
  }

  return [
    "conversation",
    receivedDay,
    email.conversationId || normalizeSubjectForBatchKey(email.subject)
  ].join(":");
}

function compareGarlandEmailPriority(a: GarlandSourceEmailWithAttachments, b: GarlandSourceEmailWithAttachments) {
  const aHasPdf = a.hasPdfAttachment || a.attachments.some(isStoredPdfAttachment);
  const bHasPdf = b.hasPdfAttachment || b.attachments.some(isStoredPdfAttachment);
  if (aHasPdf !== bHasPdf) return aHasPdf ? -1 : 1;

  const aCorrection = a.classification === "GARLAND_DOCUMENT_CORRECTION";
  const bCorrection = b.classification === "GARLAND_DOCUMENT_CORRECTION";
  if (aCorrection !== bCorrection) return aCorrection ? -1 : 1;

  if (a.candidateScore !== b.candidateScore) return b.candidateScore - a.candidateScore;

  return b.receivedAt.getTime() - a.receivedAt.getTime();
}

function chooseGroupClassification(emails: GarlandSourceEmailWithAttachments[]): GarlandEmailClassification {
  if (emails.some((email) => email.classification === "GARLAND_DOCUMENT_CORRECTION")) {
    return "GARLAND_DOCUMENT_CORRECTION";
  }
  if (emails.some((email) => email.classification === "GARLAND_DOCUMENT_BATCH")) {
    return "GARLAND_DOCUMENT_BATCH";
  }
  if (emails.some((email) => email.classification === "GARLAND_FOLLOW_UP")) {
    return "GARLAND_FOLLOW_UP";
  }

  return "IGNORED";
}

function normalizeSubjectForBatchKey(subject: string) {
  return subject
    .toLowerCase()
    .replace(/\bre\s*:\s*/g, "")
    .replace(/\bfw\s*:\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function serializeRecipients(recipients?: MicrosoftGraphMailRecipient[] | null) {
  const values = (recipients ?? [])
    .map((recipient) => ({
      name: recipient.emailAddress?.name ?? null,
      address: recipient.emailAddress?.address?.toLowerCase() ?? null
    }))
    .filter((recipient) => recipient.name || recipient.address);
  return values.length > 0 ? values : Prisma.JsonNull;
}

function shouldFetchAttachmentMetadata(message: MicrosoftGraphMailMessage) {
  const sender = message.from?.emailAddress?.address?.toLowerCase() ?? "";
  const subject = message.subject ?? "";
  return Boolean(message.hasAttachments) && (sender.endsWith(`@${GARLAND_DOMAIN}`) || /PS\d{5,}/i.test(subject));
}

function isPdfAttachment(attachment: { name?: string | null; contentType?: string | null }) {
  const name = attachment.name?.trim().toLowerCase() ?? "";
  const contentType = attachment.contentType?.trim().toLowerCase() ?? "";
  return name.endsWith(".pdf") || contentType === "application/pdf";
}

function isStoredPdfAttachment(attachment: { fileName?: string | null; contentType?: string | null }) {
  const fileName = attachment.fileName?.trim().toLowerCase() ?? "";
  const contentType = attachment.contentType?.trim().toLowerCase() ?? "";
  return fileName.endsWith(".pdf") || contentType === "application/pdf";
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePsNumber(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function writeAudit(ctx: { tenantId: string; userId?: string | null }, action: string, entityType: string, entityId: string | null, after?: unknown) {
  await prisma.auditLog.create({
    data: { tenantId: ctx.tenantId, actorUserId: ctx.userId ?? null, action, entityType, entityId, after: after as Prisma.InputJsonValue }
  });
}
