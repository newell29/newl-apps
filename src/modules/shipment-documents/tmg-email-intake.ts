import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prepareTmgEmailBatch } from "@/modules/shipment-documents/tmg-pdf-intake";
import type { TmgPreparedOrder, TmgSourcePdfAttachment } from "@/modules/shipment-documents/tmg-order-types";
import { getTmgOrderIntakeSettings } from "@/modules/shipment-documents/tmg-settings";
import {
  buildTmgTeamshipCreatePlan,
  hasExactTmgTeamshipReference,
  type TmgTeamshipCreatePlan
} from "@/modules/shipment-documents/tmg-teamship-create";
import { prisma } from "@/server/db";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import {
  fetchMicrosoftGraphMailboxMessages,
  fetchMicrosoftGraphMessageAttachmentContent,
  fetchMicrosoftGraphMessageAttachments,
  type MicrosoftGraphMailMessage
} from "@/server/integrations/microsoft-graph-mail";
import { findTeamshipShippingOrders } from "@/server/integrations/teamship";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const TMG_EMAIL_TRIGGER_MANUAL = "MANUAL";
export const TMG_EMAIL_TRIGGER_SCHEDULED = "SCHEDULED";

type PlannedPreparedOrder = {
  prepared: TmgPreparedOrder;
  plan: TmgTeamshipCreatePlan | null;
};

export async function syncTmgEmailIntake(
  context: AuthenticatedContext,
  { triggerSource = TMG_EMAIL_TRIGGER_MANUAL }: { triggerSource?: string } = {}
) {
  const settings = await getTmgOrderIntakeSettings(context.tenantId);
  if (!settings.enabled || !settings.configured || !settings.mailboxAddress || !settings.teamship) {
    throw new Error(`TMG order intake is not enabled and fully configured. ${settings.configurationIssues.join(" ")}`.trim());
  }
  const accessToken = await getMicrosoftGraphApplicationAccessToken();
  const messages = await fetchMicrosoftGraphMailboxMessages(accessToken, settings.mailboxAddress, {
    lookbackDays: settings.lookbackDays,
    maxMessagesPerMailbox: settings.maxMessagesPerScan
  });
  const candidates = messages.filter((message) => isTmgCandidateMessage(message, settings));
  const results: Array<{ batchId: string; status: string; created: boolean }> = [];
  const failures: string[] = [];

  for (const message of candidates) {
    try {
      results.push(await ingestTmgMessage({ context, accessToken, message, triggerSource }));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Unknown TMG message-ingestion failure.");
    }
  }

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId.startsWith("system:") ? null : context.userId,
      action: "TMG_EMAIL_INTAKE_SYNC_COMPLETED",
      entityType: "TmgOrderIntakeBatch",
      after: {
        triggerSource,
        scannedMessageCount: messages.length,
        candidateMessageCount: candidates.length,
        createdBatchCount: results.filter((result) => result.created).length,
        failureCount: failures.length
      }
    }
  });
  return { scannedMessageCount: messages.length, candidateMessageCount: candidates.length, results, failures };
}

export async function listTmgOrderIntakeBatches(tenantId: string, limit = 25) {
  return prisma.tmgOrderIntakeBatch.findMany({
    where: { tenantId },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(1, Math.min(100, limit)),
    include: {
      orders: { orderBy: { customerReference: "asc" }, select: tmgOrderListSelect },
      executionJob: {
        select: {
          id: true,
          status: true,
          requestHash: true,
          approvedAt: true,
          claimedAt: true,
          finishedAt: true,
          errorMessage: true
        }
      }
    }
  });
}

async function ingestTmgMessage({
  context,
  accessToken,
  message,
  triggerSource
}: {
  context: AuthenticatedContext;
  accessToken: string;
  message: MicrosoftGraphMailMessage;
  triggerSource: string;
}) {
  const settings = await getTmgOrderIntakeSettings(context.tenantId);
  if (!settings.mailboxAddress || !settings.teamship) throw new Error("TMG settings changed during message ingestion.");
  const existing = await prisma.tmgOrderIntakeBatch.findUnique({
    where: {
      tenantId_mailboxAddress_graphMessageId: {
        tenantId: context.tenantId,
        mailboxAddress: settings.mailboxAddress,
        graphMessageId: message.id
      }
    },
    select: { id: true, status: true }
  });
  if (existing) return { batchId: existing.id, status: existing.status, created: false };

  const metadata = await fetchMicrosoftGraphMessageAttachments(accessToken, settings.mailboxAddress, message.id);
  const pdfMetadata = metadata.filter((attachment) =>
    !attachment.isInline &&
    (attachment.contentType?.toLowerCase() === "application/pdf" || attachment.name?.toLowerCase().endsWith(".pdf"))
  );
  if (pdfMetadata.length === 0) throw new Error("A candidate TMG email did not contain a PDF attachment.");
  if (pdfMetadata.length > 100) throw new Error("A TMG email contained more than 100 PDF attachments and was not processed.");

  const sourceAttachments: TmgSourcePdfAttachment[] = [];
  for (const attachment of pdfMetadata) {
    const content = await fetchMicrosoftGraphMessageAttachmentContent(
      accessToken,
      settings.mailboxAddress,
      message.id,
      attachment.id
    );
    const bytes = Buffer.from(content.contentBytes ?? "", "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
      throw new Error("A TMG PDF attachment was empty or larger than 20 MB.");
    }
    sourceAttachments.push({
      sourceId: attachment.id,
      fileName: attachment.name?.trim() || "attachment.pdf",
      contentType: attachment.contentType,
      bytes
    });
  }

  const prepared = await prepareTmgEmailBatch(sourceAttachments);
  const plannedOrders: PlannedPreparedOrder[] = [];
  for (const order of prepared.orders) {
    plannedOrders.push(await planPreparedOrder({ tenantId: context.tenantId, order, teamshipProfile: settings.teamship }));
  }
  const receivedAt = readMessageReceivedAt(message);
  const fromAddress = message.from?.emailAddress?.address?.trim().toLowerCase();
  if (!fromAddress) throw new Error("A candidate TMG email did not contain a sender address.");

  return prisma.$transaction(async (transaction) => {
    const batch = await transaction.tmgOrderIntakeBatch.create({
      data: {
        tenantId: context.tenantId,
        mailboxAddress: settings.mailboxAddress!,
        graphMessageId: message.id,
        internetMessageId: message.internetMessageId,
        conversationId: message.conversationId,
        subject: message.subject?.trim() || "TMG shipment",
        fromAddress,
        receivedAt,
        sourceWebLink: message.webLink,
        sourceBodyHash: createHash("sha256").update(message.body?.content ?? message.bodyPreview ?? "").digest("hex"),
        status: "PARSING",
        attachmentCount: sourceAttachments.length,
        duplicateAttachmentCount: prepared.duplicatePdfCount,
        orderCount: plannedOrders.length,
        createdByUserId: context.userId.startsWith("system:") ? null : context.userId
      }
    });
    const hashes = sourceAttachments.map((attachment) => createHash("sha256").update(attachment.bytes).digest("hex"));
    const firstIndexByHash = new Map<string, number>();
    sourceAttachments.forEach((attachment, index) => {
      const hash = hashes[index]!;
      if (!firstIndexByHash.has(hash)) firstIndexByHash.set(hash, index);
    });
    for (const [index, attachment] of sourceAttachments.entries()) {
      const hash = hashes[index]!;
      await transaction.tmgOrderIntakeAttachment.create({
        data: {
          tenantId: context.tenantId,
          batchId: batch.id,
          graphAttachmentId: attachment.sourceId,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: attachment.bytes.byteLength,
          contentHash: hash,
          documentRole: firstIndexByHash.get(hash) === index ? readAttachmentRole(attachment.sourceId, plannedOrders) : "DUPLICATE",
          isDuplicate: firstIndexByHash.get(hash) !== index,
          fileBytes: Buffer.from(attachment.bytes)
        }
      });
    }

    const createdOrders = [] as Array<{ id: string; planRequestHash: string | null; packetHash: string | null; status: string }>;
    for (const planned of plannedOrders) {
      const order = planned.prepared;
      const status = planned.plan && order.validationIssues.length === 0 ? "READY_FOR_APPROVAL" : "NEEDS_REVIEW";
      const created = await transaction.tmgOrderIntakeOrder.create({
        data: {
          tenantId: context.tenantId,
          batchId: batch.id,
          customerReference: order.customerReference,
          status,
          packingSlip: toJson(stripSourceText(order.packingSlip)),
          picklist: order.picklist ? toJson(order.picklist) : undefined,
          bol: order.bol ? toJson(stripSourceText(order.bol)) : undefined,
          label: order.label ? toJson(stripSourceText(order.label)) : undefined,
          warehouseInstructions: order.warehouseInstructions,
          deliveryNotesExcludedFromTeamship: true,
          validationIssues: toJson(order.validationIssues),
          combinedPdfFileName: order.combinedPdfFileName,
          combinedPdfHash: order.combinedPdfHash,
          combinedPdfBytes: order.combinedPdfBytes ? Buffer.from(order.combinedPdfBytes) : undefined,
          teamshipPlan: planned.plan ? toJson(planned.plan) : undefined,
          planRequestHash: planned.plan?.requestHash
        },
        select: { id: true, planRequestHash: true, combinedPdfHash: true, status: true }
      });
      createdOrders.push({
        id: created.id,
        planRequestHash: created.planRequestHash,
        packetHash: created.combinedPdfHash,
        status: created.status
      });
    }
    const ready = createdOrders.filter((order) => order.status === "READY_FOR_APPROVAL" && order.planRequestHash && order.packetHash);
    const requestHash = ready.length > 0 ? hashTmgBatchApproval(ready) : null;
    const status = ready.length === 0
      ? "NEEDS_REVIEW"
      : ready.length === createdOrders.length
        ? "READY_FOR_APPROVAL"
        : "PARTIALLY_READY";
    await transaction.tmgOrderIntakeBatch.update({
      where: { tenantId_id: { tenantId: context.tenantId, id: batch.id } },
      data: {
        status,
        readyOrderCount: ready.length,
        invalidOrderCount: createdOrders.length - ready.length,
        approvalRequestHash: requestHash,
        errorMessage: prepared.batchIssues.length > 0 ? prepared.batchIssues.join(" ") : null
      }
    });
    if (requestHash) {
      await transaction.tmgTeamshipExecutionJob.create({
        data: {
          tenantId: context.tenantId,
          batchId: batch.id,
          status: "PENDING_APPROVAL",
          selectedOrderIds: ready.map((order) => order.id),
          requestHash
        }
      });
    }
    await transaction.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId.startsWith("system:") ? null : context.userId,
        action: "TMG_EMAIL_BATCH_INGESTED",
        entityType: "TmgOrderIntakeBatch",
        entityId: batch.id,
        after: {
          triggerSource,
          status,
          attachmentCount: sourceAttachments.length,
          duplicateAttachmentCount: prepared.duplicatePdfCount,
          orderCount: createdOrders.length,
          readyOrderCount: ready.length,
          invalidOrderCount: createdOrders.length - ready.length
        }
      }
    });
    return { batchId: batch.id, status, created: true };
  });
}

async function planPreparedOrder({
  tenantId,
  order,
  teamshipProfile
}: {
  tenantId: string;
  order: TmgPreparedOrder;
  teamshipProfile: NonNullable<Awaited<ReturnType<typeof getTmgOrderIntakeSettings>>["teamship"]>;
}): Promise<PlannedPreparedOrder> {
  if (!order.readyForApproval || !order.combinedPdfHash) return { prepared: order, plan: null };
  const issues = order.validationIssues;
  try {
    const existing = await findTeamshipShippingOrders({ tenantId, orderIdentifier: order.customerReference });
    if (existing.some((candidate) => hasExactTmgTeamshipReference(candidate as Record<string, unknown>, order.customerReference))) {
      issues.push({
        code: "TEAMSHIP_ORDER_EXISTS",
        message: "An exact Teamship order already exists for this customer reference."
      });
      order.readyForApproval = false;
      return { prepared: order, plan: null };
    }
    const plan = await buildTmgTeamshipCreatePlan({
      tenantId,
      profile: teamshipProfile,
      order: {
        customerReference: order.customerReference,
        orderDate: requireValue(order.packingSlip.orderDate, "packing-slip order date"),
        proNumber: requireValue(order.bol?.proNumber, "BOL PRO number"),
        packetHash: order.combinedPdfHash,
        shipTo: {
          name: requireValue(order.packingSlip.shipTo.name, "ship-to name"),
          address: requireValue(order.packingSlip.shipTo.address, "ship-to address"),
          city: requireValue(order.packingSlip.shipTo.city, "ship-to city"),
          state: requireValue(order.packingSlip.shipTo.state, "ship-to state"),
          postalCode: requireValue(order.packingSlip.shipTo.postalCode, "ship-to postal code"),
          countryCode: requireValue(order.packingSlip.shipTo.countryCode, "ship-to country"),
          phone: requireValue(order.packingSlip.shipTo.phone, "ship-to phone"),
          email: order.packingSlip.shipTo.email
        },
        items: order.packingSlip.items.map((item) => ({
          sku: item.sku,
          quantity: requireNumber(item.quantity, `quantity for ${item.sku}`)
        }))
      }
    });
    return { prepared: order, plan };
  } catch (error) {
    issues.push({
      code: "TEAMSHIP_PRODUCT_MATCH",
      message: error instanceof Error ? error.message : "Unable to build the exact Teamship product plan."
    });
    order.readyForApproval = false;
    return { prepared: order, plan: null };
  }
}

export function isTmgCandidateMessage(
  message: MicrosoftGraphMailMessage,
  settings: Pick<
    Awaited<ReturnType<typeof getTmgOrderIntakeSettings>>,
    "allowedSenderAddresses" | "requiredRecipientAddresses" | "subjectPrefix"
  >
) {
  const sender = message.from?.emailAddress?.address?.trim().toLowerCase();
  const subject = normalizeTmgSubject(message.subject);
  const recipients = [...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])]
    .map((recipient) => recipient.emailAddress?.address?.trim().toLowerCase())
    .filter((address): address is string => Boolean(address));
  return Boolean(
    message.hasAttachments &&
    sender &&
    settings.allowedSenderAddresses.includes(sender) &&
    settings.requiredRecipientAddresses.some((address) => recipients.includes(address)) &&
    subject.startsWith(settings.subjectPrefix.toLowerCase())
  );
}

export function normalizeTmgSubject(subject: string | null | undefined) {
  let normalized = subject?.trim() ?? "";
  while (/^(?:re|fw|fwd)\s*:\s*/i.test(normalized)) {
    normalized = normalized.replace(/^(?:re|fw|fwd)\s*:\s*/i, "").trim();
  }
  return normalized.toLowerCase();
}

function readAttachmentRole(sourceId: string, orders: PlannedPreparedOrder[]) {
  if (orders.some(({ prepared }) => prepared.packingSlip.sourceAttachmentId === sourceId)) return "PACKING_SLIPS";
  if (orders.some(({ prepared }) => prepared.picklist?.sourceAttachmentId === sourceId)) return "PICKLIST";
  if (orders.some(({ prepared }) => prepared.bol?.sourceAttachmentId === sourceId)) return "BOL";
  if (orders.some(({ prepared }) => prepared.label?.sourceAttachmentId === sourceId)) return "LABEL";
  return "UNKNOWN";
}

export function hashTmgBatchApproval(orders: Array<{ id: string; planRequestHash: string | null; packetHash: string | null }>) {
  const frozen = orders
    .map((order) => ({ orderId: order.id, planRequestHash: order.planRequestHash, packetHash: order.packetHash }))
    .sort((left, right) => left.orderId.localeCompare(right.orderId));
  return createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
}

function stripSourceText<T extends { sourceText: string }>(value: T): Omit<T, "sourceText"> {
  const rest = { ...value } as Partial<T>;
  delete rest.sourceText;
  return rest as Omit<T, "sourceText">;
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readMessageReceivedAt(message: MicrosoftGraphMailMessage) {
  const date = new Date(message.receivedDateTime ?? "");
  if (Number.isNaN(date.getTime())) throw new Error("A candidate TMG email did not contain a valid received date.");
  return date;
}

function requireValue(value: string | null | undefined, label: string) {
  if (!value?.trim()) throw new Error(`Missing ${label}.`);
  return value.trim();
}

function requireNumber(value: number | null | undefined, label: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`Missing ${label}.`);
  return Number(value);
}

const tmgOrderListSelect = {
  id: true,
  customerReference: true,
  status: true,
  packingSlip: true,
  picklist: true,
  bol: true,
  warehouseInstructions: true,
  deliveryNotesExcludedFromTeamship: true,
  validationIssues: true,
  combinedPdfFileName: true,
  combinedPdfHash: true,
  planRequestHash: true,
  teamshipCreateStatus: true,
  teamshipOrderId: true,
  teamshipOrderNumber: true,
  teamshipUrl: true,
  documentUploadStatus: true,
  errorMessage: true,
  updatedAt: true
} as const;
