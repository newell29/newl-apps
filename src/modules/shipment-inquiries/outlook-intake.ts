import { IntegrationProvider, IntegrationStatus, ModuleKey, Prisma } from "@prisma/client";

import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import {
  fetchMicrosoftGraphMailboxFolderMessages,
  resolveMicrosoftGraphMailboxFolderPath,
  type MicrosoftGraphMailMessage
} from "@/server/integrations/microsoft-graph-mail";
import { parseMicrosoftGraphSettings } from "@/server/integrations/microsoft-graph";
import type { AuthenticatedContext, TenantContext } from "@/server/tenant-context";

export const SHIPMENT_INQUIRY_OUTLOOK_FOLDER_PATH = ["Inbox", "Automation"] as const;
export const SHIPMENT_INQUIRY_SYNC_TRIGGER_MANUAL = "MANUAL";
export const SHIPMENT_INQUIRY_SYNC_TRIGGER_SCHEDULED = "SCHEDULED";

type ShipmentInquirySyncInput = {
  maxMessagesPerMailbox?: number | null;
  triggerSource?: string | null;
};

type MailboxSyncResult = {
  mailbox: string;
  graphFolderId: string | null;
  messageCount: number;
  createdCount: number;
  skippedDuplicateCount: number;
  failure: string | null;
};

const DEFAULT_MAX_MESSAGES_PER_MAILBOX = 50;

export async function syncShipmentInquiryOutlookIntakeForUser(
  ctx: AuthenticatedContext,
  input: ShipmentInquirySyncInput = {}
) {
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  await requireMutationAccess(ctx);

  return syncShipmentInquiryOutlookIntake(ctx, {
    ...input,
    triggerSource: input.triggerSource ?? SHIPMENT_INQUIRY_SYNC_TRIGGER_MANUAL
  });
}

export async function syncShipmentInquiryOutlookIntake(
  ctx: TenantContext & { userId?: string | null },
  input: ShipmentInquirySyncInput = {}
) {
  const settings = await getShipmentInquiryMicrosoftGraphSettings(ctx.tenantId);
  if (!settings.mailSyncEnabled) {
    throw new Error("Microsoft 365 mail sync is disabled for this tenant.");
  }
  if (settings.mailboxAccessMode !== "ADMIN_SELECTED_MAILBOXES" || settings.adminMailboxTargets.length === 0) {
    throw new Error("Configure Pricing and Dispatch Microsoft 365 mailbox targets before running inquiry intake.");
  }
  if (!settings.crossMailboxReady) {
    throw new Error(settings.runtimeNotes);
  }

  const mailboxes = settings.adminMailboxTargets.map((mailbox) => mailbox.trim().toLowerCase()).filter(Boolean);
  const accessToken = await getMicrosoftGraphApplicationAccessToken();
  const maxMessagesPerMailbox = clampInteger(
    input.maxMessagesPerMailbox ?? DEFAULT_MAX_MESSAGES_PER_MAILBOX,
    1,
    settings.maxMailMessagesPerMailbox || 2_000
  );
  const results = await Promise.all(
    mailboxes.map((mailbox) => syncMailboxAutomationFolder(ctx.tenantId, accessToken, mailbox, maxMessagesPerMailbox))
  );
  const totals = summarizeMailboxResults(results);

  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId ?? null,
      action: "shipment-inquiry.outlook-intake.synced",
      entityType: "ShipmentInquiryAutomationJob",
      entityId: null,
      after: {
        triggerSource: input.triggerSource?.trim() || SHIPMENT_INQUIRY_SYNC_TRIGGER_SCHEDULED,
        folderPath: SHIPMENT_INQUIRY_OUTLOOK_FOLDER_PATH.join("/"),
        ...totals,
        failures: results.filter((result) => result.failure)
      } as Prisma.InputJsonObject
    }
  });

  return {
    folderPath: SHIPMENT_INQUIRY_OUTLOOK_FOLDER_PATH.join("/"),
    mailboxCount: mailboxes.length,
    ...totals,
    mailboxes: results
  };
}

async function syncMailboxAutomationFolder(
  tenantId: string,
  accessToken: string,
  mailbox: string,
  maxMessagesPerMailbox: number
): Promise<MailboxSyncResult> {
  try {
    const folder = await resolveMicrosoftGraphMailboxFolderPath(
      accessToken,
      mailbox,
      [...SHIPMENT_INQUIRY_OUTLOOK_FOLDER_PATH]
    );
    const messages = await fetchMicrosoftGraphMailboxFolderMessages(accessToken, mailbox, folder.folder.id, {
      maxMessagesPerMailbox
    });
    const persisted = await persistShipmentInquiryMessages({
      tenantId,
      mailboxAddress: mailbox,
      graphFolderId: folder.folder.id,
      messages
    });

    return {
      mailbox,
      graphFolderId: folder.folder.id,
      messageCount: messages.length,
      createdCount: persisted.createdCount,
      skippedDuplicateCount: persisted.skippedDuplicateCount,
      failure: null
    };
  } catch (error) {
    return {
      mailbox,
      graphFolderId: null,
      messageCount: 0,
      createdCount: 0,
      skippedDuplicateCount: 0,
      failure: error instanceof Error ? error.message : "Unknown Outlook folder intake error."
    };
  }
}

export async function persistShipmentInquiryMessages(input: {
  tenantId: string;
  mailboxAddress: string;
  graphFolderId: string;
  messages: MicrosoftGraphMailMessage[];
}) {
  let createdCount = 0;
  let skippedDuplicateCount = 0;
  const discoveredAt = new Date();
  const mailboxAddress = input.mailboxAddress.trim().toLowerCase();

  for (const message of input.messages) {
    const existing = await prisma.shipmentInquiryAutomationJob.findUnique({
      where: {
        tenantId_mailboxAddress_graphMessageId: {
          tenantId: input.tenantId,
          mailboxAddress,
          graphMessageId: message.id
        }
      },
      select: { id: true }
    });

    if (existing) {
      skippedDuplicateCount += 1;
      continue;
    }

    await prisma.shipmentInquiryAutomationJob.create({
      data: {
        tenantId: input.tenantId,
        mailboxAddress,
        graphFolderId: input.graphFolderId,
        graphMessageId: message.id,
        internetMessageId: message.internetMessageId ?? null,
        conversationId: message.conversationId ?? null,
        subject: message.subject?.trim() || "(no subject)",
        senderName: message.from?.emailAddress?.name ?? null,
        senderAddress: message.from?.emailAddress?.address?.toLowerCase() ?? null,
        receivedAt: parseDate(message.receivedDateTime) ?? discoveredAt,
        bodyPreview: message.bodyPreview ?? null,
        normalizedBodyText: normalizeInquiryBodyText(message.body?.content ?? message.bodyPreview ?? ""),
        status: "PENDING",
        attemptCount: 0,
        lastError: null,
        discoveredAt
      }
    });
    createdCount += 1;
  }

  return {
    messageCount: input.messages.length,
    createdCount,
    skippedDuplicateCount
  };
}

export function normalizeInquiryBodyText(value?: string | null) {
  const normalized = (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized || null;
}

async function getShipmentInquiryMicrosoftGraphSettings(tenantId: string) {
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

function summarizeMailboxResults(results: MailboxSyncResult[]) {
  return {
    messageCount: results.reduce((total, result) => total + result.messageCount, 0),
    createdCount: results.reduce((total, result) => total + result.createdCount, 0),
    skippedDuplicateCount: results.reduce((total, result) => total + result.skippedDuplicateCount, 0),
    failureCount: results.filter((result) => result.failure).length
  };
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}
