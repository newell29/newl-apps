import { createHash } from "node:crypto";
import {
  IntegrationProvider,
  IntegrationStatus,
  Prisma,
  WebsiteInboundEmailDirection,
  WebsiteInboundEmailStatus
} from "@prisma/client";

import { prisma } from "@/server/db";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import {
  createAndSendMicrosoftGraphMailboxMessage,
  fetchMicrosoftGraphMailboxCorrespondenceMessages,
  replyToMicrosoftGraphMailboxMessage,
  type MicrosoftGraphMailMessage
} from "@/server/integrations/microsoft-graph-mail";
import {
  MICROSOFT_GRAPH_CREDENTIAL_NAME,
  parseMicrosoftGraphSettings
} from "@/server/integrations/microsoft-graph";
import {
  generateInboundEmailDraft,
  isOpenAiDraftGenerationConfigured
} from "@/server/integrations/openai";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { CLOSED_STATUSES, InboundValidationError } from "./opportunities";

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_MAX_MESSAGES_PER_MAILBOX = 300;
const MAX_STORED_BODY = 20_000;

export type WebsiteInboundMailboxConfiguration = {
  enabled: boolean;
  draftingEnabled: boolean;
  reason: string | null;
  mailboxes: string[];
  ownerMailboxes: Record<string, string>;
};

export async function getWebsiteInboundMailboxConfiguration(
  tenantId: string
): Promise<WebsiteInboundMailboxConfiguration> {
  const [credential, memberships] = await Promise.all([
    prisma.integrationCredential.findFirst({
      where: {
        tenantId,
        provider: IntegrationProvider.MICROSOFT_GRAPH,
        name: MICROSOFT_GRAPH_CREDENTIAL_NAME
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { provider: true, status: true, publicConfig: true }
    }),
    prisma.membership.findMany({
      where: { tenantId },
      select: { userId: true, user: { select: { email: true } } }
    })
  ]);
  const settings = parseMicrosoftGraphSettings(credential);
  const mailboxes = Array.from(
    new Set(settings.inboundOwnerMailboxTargets.map(normalizeEmail).filter(Boolean))
  );
  const mailboxSet = new Set(mailboxes);
  const ownerMailboxes = Object.fromEntries(
    memberships
      .map((membership) => [membership.userId, normalizeEmail(membership.user.email)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1] && mailboxSet.has(entry[1])))
  );
  const enabled =
    credential?.status === IntegrationStatus.ACTIVE &&
    settings.inboundCorrespondenceEnabled &&
    settings.mailboxAccessMode === "ADMIN_SELECTED_MAILBOXES" &&
    settings.applicationMailboxRuntimeReady &&
    mailboxes.length > 0;
  return {
    enabled,
    draftingEnabled: enabled && settings.draftingEnabled,
    reason: enabled
      ? null
      : credential?.status !== IntegrationStatus.ACTIVE
        ? "Microsoft 365 is not active for this organization."
        : !settings.inboundCorrespondenceEnabled
          ? "Inbound opportunity correspondence is disabled in Microsoft 365 settings."
        : settings.mailboxAccessMode !== "ADMIN_SELECTED_MAILBOXES"
          ? "Inbound correspondence requires selected organization mailboxes."
          : mailboxes.length === 0
            ? "Select at least one inbound opportunity owner mailbox in Microsoft 365 settings."
            : !settings.applicationMailboxRuntimeReady
              ? "Microsoft Graph application mailbox credentials are not configured in the server environment."
              : settings.runtimeNotes,
    mailboxes,
    ownerMailboxes
  };
}

export async function syncWebsiteInboundCorrespondence(
  ctx: AuthenticatedContext,
  options: { trigger: "manual" | "scheduled" } = { trigger: "manual" }
) {
  const configuration = await requireMailboxSyncConfiguration(ctx.tenantId);
  const accessToken = await getMicrosoftGraphApplicationAccessToken();
  const mailboxResults = await Promise.all(
    configuration.mailboxes.map(async (mailbox) => {
      try {
        return {
          mailbox,
          messages: await fetchMicrosoftGraphMailboxCorrespondenceMessages(
            accessToken,
            mailbox,
            {
              lookbackDays: DEFAULT_LOOKBACK_DAYS,
              maxMessagesPerMailbox: DEFAULT_MAX_MESSAGES_PER_MAILBOX
            }
          ),
          error: null
        };
      } catch (error) {
        return {
          mailbox,
          messages: [] as MicrosoftGraphMailMessage[],
          error: safeError(error)
        };
      }
    })
  );
  if (mailboxResults.every((result) => result.error)) {
    throw new InboundValidationError(
      "Microsoft 365 could not read any approved owner mailbox. Review the mailbox permissions and try again."
    );
  }

  const messages = mailboxResults.flatMap((result) =>
    result.messages.map((message) => ({ ...message, mailboxAddress: result.mailbox }))
  );
  const since = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);
  const [opportunities, existing] = await Promise.all([
    prisma.websiteInboundSubmission.findMany({
      where: {
        tenantId: ctx.tenantId,
        NOT: { formType: "account_setup" },
        email: { not: null }
      },
      select: { id: true, company: true, name: true, email: true, status: true }
    }),
    prisma.websiteInboundEmailMessage.findMany({
      where: {
        tenantId: ctx.tenantId,
        mailboxAddress: { in: configuration.mailboxes },
        messageAt: { gte: since }
      },
      select: {
        id: true,
        submissionId: true,
        mailboxAddress: true,
        graphMessageId: true,
        conversationId: true,
        status: true,
        subject: true,
        recipients: true,
        messageAt: true
      }
    })
  ]);
  const opportunitiesByEmail = new Map<string, typeof opportunities>();
  for (const opportunity of opportunities) {
    const email = normalizeEmail(opportunity.email);
    if (!email) continue;
    opportunitiesByEmail.set(email, [
      ...(opportunitiesByEmail.get(email) ?? []),
      opportunity
    ]);
  }
  const existingByGraph = new Map(
    existing
      .filter((message) => message.graphMessageId)
      .map((message) => [messageKey(message.mailboxAddress, message.graphMessageId!), message])
  );
  const submissionByConversation = new Map<string, Set<string>>();
  for (const message of existing) {
    if (!message.conversationId || !message.submissionId) continue;
    const key = messageKey(message.mailboxAddress, message.conversationId);
    const submissions = submissionByConversation.get(key) ?? new Set<string>();
    submissions.add(message.submissionId);
    submissionByConversation.set(key, submissions);
  }

  let imported = 0;
  let updated = 0;
  let ambiguous = 0;
  let ignored = 0;
  const opportunityEmailUpdates = new Map<
    string,
    { inbound?: Date; outbound?: Date; latest: Date }
  >();
  for (const message of messages.sort((left, right) => messageTime(left).getTime() - messageTime(right).getTime())) {
    const mailbox = normalizeEmail(message.mailboxAddress);
    if (!mailbox || !message.id || message.isDraft) continue;
    const classification = classifyWebsiteInboundGraphMessage(
      message,
      mailbox,
      configuration.mailboxes
    );
    if (!classification || !Number.isFinite(messageTime(message).getTime())) {
      ignored += 1;
      continue;
    }
    const graphExisting = existingByGraph.get(messageKey(mailbox, message.id));
    const threadSubmissions = message.conversationId
      ? submissionByConversation.get(messageKey(mailbox, message.conversationId))
      : undefined;
    const candidates = opportunitiesByEmail.get(classification.externalEmail) ?? [];
    const openCandidates = candidates.filter(
      (candidate) => !CLOSED_STATUSES.includes(candidate.status)
    );
    const conversationSubmissionId =
      threadSubmissions?.size === 1 ? Array.from(threadSubmissions)[0] : null;
    const submissionId = resolveWebsiteInboundOpportunityMatch({
      existingSubmissionId: graphExisting?.submissionId ?? null,
      conversationSubmissionId,
      candidates,
      openCandidates
    });
    if (!submissionId && candidates.length === 0) {
      ignored += 1;
      continue;
    }
    const candidateEvidence = submissionId
      ? Prisma.JsonNull
      : candidates.map((candidate) => ({
          id: candidate.id,
          label: candidate.company || candidate.name || candidate.email || "Inbound opportunity"
        }));
    if (!submissionId) ambiguous += 1;

    const data = providerMessageData({
      tenantId: ctx.tenantId,
      submissionId,
      mailbox,
      message,
      classification,
      candidateEvidence
    });
    if (graphExisting) {
      await prisma.websiteInboundEmailMessage.updateMany({
        where: { id: graphExisting.id, tenantId: ctx.tenantId },
        data
      });
      updated += 1;
    } else {
      const reconciled = submissionId
        ? findLocalSend(existing, {
            mailbox,
            submissionId,
            subject: data.subject,
            recipientEmail: classification.externalEmail,
            messageAt: data.messageAt
          })
        : null;
      if (reconciled) {
        await prisma.websiteInboundEmailMessage.updateMany({
          where: { id: reconciled.id, tenantId: ctx.tenantId },
          data: { ...data, status: WebsiteInboundEmailStatus.SENT }
        });
        updated += 1;
      } else {
        await prisma.websiteInboundEmailMessage.create({ data });
        imported += 1;
      }
      if (submissionId && message.conversationId) {
        const key = messageKey(mailbox, message.conversationId);
        const set = submissionByConversation.get(key) ?? new Set<string>();
        set.add(submissionId);
        submissionByConversation.set(key, set);
      }
    }
    if (submissionId) {
      const at = data.messageAt;
      const timestamps = opportunityEmailUpdates.get(submissionId) ?? { latest: at };
      timestamps.latest = at > timestamps.latest ? at : timestamps.latest;
      if (classification.direction === WebsiteInboundEmailDirection.INBOUND) {
        timestamps.inbound = !timestamps.inbound || at > timestamps.inbound ? at : timestamps.inbound;
      } else {
        timestamps.outbound = !timestamps.outbound || at > timestamps.outbound ? at : timestamps.outbound;
      }
      opportunityEmailUpdates.set(submissionId, timestamps);
    }
  }
  for (const [submissionId, timestamps] of opportunityEmailUpdates) {
    const opportunity = await prisma.websiteInboundSubmission.findFirst({
      where: { tenantId: ctx.tenantId, id: submissionId },
      select: { lastInboundEmailAt: true, lastOutboundEmailAt: true, lastActivityAt: true }
    });
    if (!opportunity) continue;
    await prisma.websiteInboundSubmission.updateMany({
      where: { tenantId: ctx.tenantId, id: submissionId },
      data: {
        lastInboundEmailAt: later(opportunity.lastInboundEmailAt, timestamps.inbound),
        lastOutboundEmailAt: later(opportunity.lastOutboundEmailAt, timestamps.outbound),
        lastActivityAt: later(opportunity.lastActivityAt, timestamps.latest) ?? timestamps.latest
      }
    });
  }
  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      entityType: "WebsiteInboundEmailMessage",
      action: "website_inbound.correspondence_synced",
      after: {
        trigger: options.trigger,
        mailboxCount: configuration.mailboxes.length,
        imported,
        updated,
        ambiguous,
        ignored,
        failures: mailboxResults.filter((result) => result.error).map((result) => result.mailbox)
      }
    }
  });
  return {
    imported,
    updated,
    ambiguous,
    ignored,
    failures: mailboxResults.filter((result) => result.error).map((result) => result.mailbox)
  };
}

export async function createWebsiteInboundEmailDraft(
  ctx: AuthenticatedContext,
  submissionId: string
) {
  const [configuration, opportunity] = await Promise.all([
    requireMailboxSyncConfiguration(ctx.tenantId),
    prisma.websiteInboundSubmission.findFirst({
      where: { tenantId: ctx.tenantId, id: submissionId, NOT: { formType: "account_setup" } },
      include: {
        owner: { select: { userId: true, user: { select: { name: true, email: true } } } },
        correspondence: {
          where: { status: { in: [WebsiteInboundEmailStatus.RECEIVED, WebsiteInboundEmailStatus.SENT] } },
          orderBy: [{ messageAt: "desc" }, { id: "desc" }],
          take: 8
        }
      }
    })
  ]);
  if (!opportunity) throw new InboundValidationError("Opportunity not found.");
  if (!opportunity.email) throw new InboundValidationError("Add a contact email before preparing a draft.");
  if (!opportunity.ownerUserId || !opportunity.owner)
    throw new InboundValidationError("Assign the opportunity before preparing an email.");
  if (CLOSED_STATUSES.includes(opportunity.status))
    throw new InboundValidationError("Reopen the opportunity before preparing another email.");
  const ownerMailbox = configuration.ownerMailboxes[opportunity.ownerUserId];
  if (!ownerMailbox)
    throw new InboundValidationError(
      "The assigned owner is not one of the approved Microsoft 365 mailboxes."
    );
  if (
    opportunity.communicationMailbox &&
    normalizeEmail(opportunity.communicationMailbox) !== ownerMailbox
  ) {
    throw new InboundValidationError(
      "This conversation is still using the previous owner's mailbox. Complete the mailbox handoff before drafting."
    );
  }
  const senderFirstName = firstName(opportunity.owner.user.name || opportunity.owner.user.email);
  const owner = opportunity.owner;
  const contactEmail = opportunity.email;
  const recent = opportunity.correspondence.slice().reverse();
  const generated = await buildDraft({
    senderFirstName,
    opportunity: {
      company: opportunity.company,
      name: opportunity.name,
      email: contactEmail,
      primaryNeed: opportunity.primaryNeed,
      source: opportunity.source,
      status: opportunity.status,
      nextAction: opportunity.nextAction
    },
    correspondence: recent.map((message) => ({
      direction: message.direction,
      subject: message.subject,
      body: message.bodyText.slice(0, 2_000),
      at: message.messageAt.toISOString()
    }))
  });
  const latestMessage = opportunity.correspondence[0] ?? null;
  const now = new Date();
  const followUpOn = addBusinessDays(now, generated.recommendedFollowUpDays);
  return prisma.$transaction(async (tx) => {
    await tx.websiteInboundEmailMessage.updateMany({
      where: {
        tenantId: ctx.tenantId,
        submissionId,
        status: WebsiteInboundEmailStatus.DRAFT
      },
      data: { status: WebsiteInboundEmailStatus.CANCELLED }
    });
    const draft = await tx.websiteInboundEmailMessage.create({
      data: {
        tenantId: ctx.tenantId,
        submissionId,
        direction: WebsiteInboundEmailDirection.OUTBOUND,
        status: WebsiteInboundEmailStatus.DRAFT,
        mailboxAddress: ownerMailbox,
        subject: generated.subject.slice(0, 200),
        bodyText: generated.body.slice(0, 5_000),
        bodyPreview: generated.body.slice(0, 1_000),
        senderAddress: ownerMailbox,
        senderName: owner.user.name,
        recipients: [{ address: normalizeEmail(contactEmail), name: opportunity.name }],
        ccRecipients: [],
        messageAt: now,
        draftSource: generated.source,
        draftRationale: generated.rationale.slice(0, 500),
        suggestedNextAction: generated.recommendedNextAction.slice(0, 500),
        suggestedFollowUpOn: followUpOn,
        basedOnMessageId: latestMessage?.id ?? null,
        createdByUserId: ctx.userId
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        entityType: "WebsiteInboundEmailMessage",
        entityId: draft.id,
        action: "website_inbound.email_draft_created",
        after: {
          submissionId,
          source: generated.source,
          mailbox: ownerMailbox,
          basedOnMessageId: latestMessage?.id ?? null
        }
      }
    });
    return draft.id;
  });
}

export async function sendWebsiteInboundEmailDraft(
  ctx: AuthenticatedContext,
  input: { draftId: string; subject: string; body: string }
) {
  const subject = cleanRequired(input.subject, 200, "email subject");
  const body = cleanRequired(input.body, 5_000, "email body");
  const [configuration, draft] = await Promise.all([
    requireMailboxSyncConfiguration(ctx.tenantId, true),
    prisma.websiteInboundEmailMessage.findFirst({
      where: { tenantId: ctx.tenantId, id: input.draftId },
      include: {
        submission: {
          include: {
            owner: { select: { userId: true, user: { select: { email: true } } } }
          }
        }
      }
    })
  ]);
  if (!draft?.submission) throw new InboundValidationError("Email draft not found.");
  if (draft.status !== WebsiteInboundEmailStatus.DRAFT)
    throw new InboundValidationError("This draft is no longer available to send.");
  const opportunity = draft.submission;
  if (opportunity.ownerUserId !== ctx.userId)
    throw new InboundValidationError("Only the assigned owner can approve and send this email.");
  if (!opportunity.email) throw new InboundValidationError("The opportunity no longer has an email address.");
  const ownerMailbox = configuration.ownerMailboxes[ctx.userId];
  if (!ownerMailbox || ownerMailbox !== normalizeEmail(draft.mailboxAddress))
    throw new InboundValidationError("The assigned owner's approved mailbox no longer matches this draft.");
  if (normalizeEmail(opportunity.email) !== draftRecipient(draft.recipients))
    throw new InboundValidationError("The contact email changed. Prepare a new draft before sending.");
  if (
    opportunity.communicationMailbox &&
    normalizeEmail(opportunity.communicationMailbox) !== ownerMailbox
  ) {
    throw new InboundValidationError("Complete the mailbox handoff before sending this draft.");
  }
  if (CLOSED_STATUSES.includes(opportunity.status))
    throw new InboundValidationError("Reopen the opportunity before sending another email.");
  const newerMessage = await prisma.websiteInboundEmailMessage.findFirst({
    where: {
      tenantId: ctx.tenantId,
      submissionId: opportunity.id,
      status: { in: [WebsiteInboundEmailStatus.RECEIVED, WebsiteInboundEmailStatus.SENT] },
      messageAt: { gt: draft.createdAt }
    },
    select: { id: true }
  });
  if (newerMessage)
    throw new InboundValidationError("New correspondence arrived after this draft. Sync and prepare a fresh reply.");

  const approvedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const reserved = await tx.websiteInboundEmailMessage.updateMany({
      where: {
        tenantId: ctx.tenantId,
        id: draft.id,
        status: WebsiteInboundEmailStatus.DRAFT
      },
      data: {
        status: WebsiteInboundEmailStatus.SENDING,
        subject,
        bodyText: body,
        bodyPreview: body.slice(0, 1_000),
        approvedByUserId: ctx.userId,
        approvedAt
      }
    });
    if (reserved.count !== 1)
      throw new InboundValidationError(
        "This draft is already being sent or was changed. Reload before continuing."
      );
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        entityType: "WebsiteInboundEmailMessage",
        entityId: draft.id,
        action: "website_inbound.email_approved",
        after: {
          submissionId: opportunity.id,
          mailbox: ownerMailbox,
          recipientDomain: normalizeEmail(opportunity.email)?.split("@")[1] ?? null,
          copyFingerprint: createHash("sha256").update(`${subject}\n${body}`).digest("hex")
        }
      }
    });
  });

  try {
    const accessToken = await getMicrosoftGraphApplicationAccessToken();
    const basedOn = draft.basedOnMessageId
      ? await prisma.websiteInboundEmailMessage.findFirst({
          where: {
            tenantId: ctx.tenantId,
            id: draft.basedOnMessageId,
            submissionId: opportunity.id,
            direction: WebsiteInboundEmailDirection.INBOUND,
            mailboxAddress: ownerMailbox,
            graphMessageId: { not: null }
          },
          select: { graphMessageId: true }
        })
      : null;
    if (basedOn?.graphMessageId) {
      await replyToMicrosoftGraphMailboxMessage(
        accessToken,
        ownerMailbox,
        basedOn.graphMessageId,
        body
      );
    } else {
      await createAndSendMicrosoftGraphMailboxMessage(accessToken, ownerMailbox, {
        recipientEmail: opportunity.email,
        recipientName: opportunity.name,
        subject,
        body
      });
    }
    const sentAt = new Date();
    await prisma.$transaction([
      prisma.websiteInboundEmailMessage.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: draft.id } },
        data: {
          status: WebsiteInboundEmailStatus.SENT,
          sentByUserId: ctx.userId,
          sentAt,
          messageAt: sentAt,
          failureReason: null
        }
      }),
      prisma.websiteInboundSubmission.update({
        where: { tenantId_id: { tenantId: ctx.tenantId, id: opportunity.id } },
        data: {
          communicationMailbox: ownerMailbox,
          lastOutboundEmailAt: sentAt,
          lastActivityAt: sentAt
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          entityType: "WebsiteInboundEmailMessage",
          entityId: draft.id,
          action: "website_inbound.email_approved_and_sent",
          after: {
            submissionId: opportunity.id,
            mailbox: ownerMailbox,
            reply: Boolean(basedOn?.graphMessageId),
            recipientDomain: normalizeEmail(opportunity.email)?.split("@")[1] ?? null
          }
        }
      })
    ]);
    return draft.id;
  } catch (error) {
    await prisma.websiteInboundEmailMessage.updateMany({
      where: { tenantId: ctx.tenantId, id: draft.id, status: WebsiteInboundEmailStatus.SENDING },
      data: {
        status: WebsiteInboundEmailStatus.SEND_FAILED,
        failureReason: safeError(error)
      }
    });
    throw new InboundValidationError(
      "Microsoft 365 did not confirm this send. Check Sent Items and sync correspondence before preparing another email."
    );
  }
}

export async function handoffWebsiteInboundMailbox(
  ctx: AuthenticatedContext,
  submissionId: string
) {
  const configuration = await requireMailboxSyncConfiguration(ctx.tenantId);
  const mailbox = configuration.ownerMailboxes[ctx.userId];
  if (!mailbox)
    throw new InboundValidationError("Your account is not an approved inbound mailbox.");
  return prisma.$transaction(async (tx) => {
    const opportunity = await tx.websiteInboundSubmission.findFirst({
      where: { tenantId: ctx.tenantId, id: submissionId, NOT: { formType: "account_setup" } },
      select: { id: true, ownerUserId: true, communicationMailbox: true }
    });
    if (!opportunity) throw new InboundValidationError("Opportunity not found.");
    if (opportunity.ownerUserId !== ctx.userId)
      throw new InboundValidationError("Only the newly assigned owner can accept the mailbox handoff.");
    if (normalizeEmail(opportunity.communicationMailbox) === mailbox) return;
    await tx.websiteInboundSubmission.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: opportunity.id } },
      data: { communicationMailbox: mailbox, lastActivityAt: new Date() }
    });
    await tx.websiteInboundEmailMessage.updateMany({
      where: {
        tenantId: ctx.tenantId,
        submissionId,
        status: WebsiteInboundEmailStatus.DRAFT
      },
      data: { status: WebsiteInboundEmailStatus.CANCELLED }
    });
    await tx.websiteInboundActivity.create({
      data: {
        tenantId: ctx.tenantId,
        submissionId,
        type: "NOTE",
        body: `Future email was handed off to ${mailbox}. Existing correspondence remains in its original mailbox.`,
        actorUserId: ctx.userId,
        actorName: ctx.userName || ctx.userEmail
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        entityType: "WebsiteInboundSubmission",
        entityId: submissionId,
        action: "website_inbound.mailbox_handed_off",
        before: { mailbox: opportunity.communicationMailbox },
        after: { mailbox }
      }
    });
  });
}

export async function linkWebsiteInboundEmail(
  ctx: AuthenticatedContext,
  messageId: string,
  submissionId: string
) {
  return prisma.$transaction(async (tx) => {
    const [message, opportunity] = await Promise.all([
      tx.websiteInboundEmailMessage.findFirst({
        where: { tenantId: ctx.tenantId, id: messageId, submissionId: null }
      }),
      tx.websiteInboundSubmission.findFirst({
        where: { tenantId: ctx.tenantId, id: submissionId, NOT: { formType: "account_setup" } },
        select: {
          id: true,
          email: true,
          lastInboundEmailAt: true,
          lastOutboundEmailAt: true,
          lastActivityAt: true
        }
      })
    ]);
    if (!message || !opportunity) throw new InboundValidationError("The email match is no longer available.");
    const candidateIds = readCandidateIds(message.matchCandidates);
    if (!candidateIds.includes(opportunity.id))
      throw new InboundValidationError("Choose one of the exact-email opportunity matches.");
    await tx.websiteInboundEmailMessage.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: message.id } },
      data: { submissionId: opportunity.id, matchCandidates: Prisma.JsonNull }
    });
    await tx.websiteInboundSubmission.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: opportunity.id } },
      data: {
        lastInboundEmailAt:
          message.direction === WebsiteInboundEmailDirection.INBOUND
            ? later(opportunity.lastInboundEmailAt, message.messageAt)
            : undefined,
        lastOutboundEmailAt:
          message.direction === WebsiteInboundEmailDirection.OUTBOUND
            ? later(opportunity.lastOutboundEmailAt, message.messageAt)
            : undefined,
        lastActivityAt: later(opportunity.lastActivityAt, message.messageAt)
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        entityType: "WebsiteInboundEmailMessage",
        entityId: message.id,
        action: "website_inbound.email_linked",
        after: { submissionId: opportunity.id }
      }
    });
  });
}

async function requireMailboxSyncConfiguration(tenantId: string, requireDrafting = false) {
  const configuration = await getWebsiteInboundMailboxConfiguration(tenantId);
  if (!configuration.enabled)
    throw new InboundValidationError(
      configuration.reason || "Microsoft 365 inbound correspondence is not configured."
    );
  if (requireDrafting && !configuration.draftingEnabled)
    throw new InboundValidationError(
      "Microsoft 365 sending is disabled. Enable drafting and confirm Mail.Send before using approved sends."
    );
  return configuration;
}

export function classifyWebsiteInboundGraphMessage(
  message: MicrosoftGraphMailMessage,
  mailbox: string,
  internalMailboxes: Iterable<string>
) {
  const internalMailboxSet = new Set(Array.from(internalMailboxes, normalizeEmail));
  const sender = normalizeEmail(message.from?.emailAddress?.address);
  const recipients = [...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])]
    .map((recipient) => normalizeEmail(recipient.emailAddress?.address))
    .filter((value): value is string => Boolean(value));
  if (sender === mailbox) {
    const externalEmail = recipients.find((recipient) => !internalMailboxSet.has(recipient));
    return externalEmail
      ? { direction: WebsiteInboundEmailDirection.OUTBOUND, externalEmail }
      : null;
  }
  if (!sender || internalMailboxSet.has(sender) || !recipients.includes(mailbox)) return null;
  return { direction: WebsiteInboundEmailDirection.INBOUND, externalEmail: sender };
}

export function resolveWebsiteInboundOpportunityMatch({
  existingSubmissionId,
  conversationSubmissionId,
  candidates,
  openCandidates
}: {
  existingSubmissionId: string | null;
  conversationSubmissionId: string | null;
  candidates: Array<{ id: string }>;
  openCandidates: Array<{ id: string }>;
}) {
  return (
    existingSubmissionId ??
    conversationSubmissionId ??
    (openCandidates.length === 1
      ? openCandidates[0]!.id
      : candidates.length === 1
        ? candidates[0]!.id
        : null)
  );
}

function providerMessageData({
  tenantId,
  submissionId,
  mailbox,
  message,
  classification,
  candidateEvidence
}: {
  tenantId: string;
  submissionId: string | null;
  mailbox: string;
  message: MicrosoftGraphMailMessage;
  classification: { direction: WebsiteInboundEmailDirection; externalEmail: string };
  candidateEvidence: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}) {
  const recipients = (message.toRecipients ?? []).map((recipient) => ({
    name: cleanOptional(recipient.emailAddress?.name, 200),
    address: normalizeEmail(recipient.emailAddress?.address)
  })).filter((recipient) => recipient.address);
  const ccRecipients = (message.ccRecipients ?? []).map((recipient) => ({
    name: cleanOptional(recipient.emailAddress?.name, 200),
    address: normalizeEmail(recipient.emailAddress?.address)
  })).filter((recipient) => recipient.address);
  return {
    tenantId,
    submissionId,
    direction: classification.direction,
    status:
      classification.direction === WebsiteInboundEmailDirection.INBOUND
        ? WebsiteInboundEmailStatus.RECEIVED
        : WebsiteInboundEmailStatus.SENT,
    mailboxAddress: mailbox,
    graphMessageId: message.id,
    internetMessageId: cleanOptional(message.internetMessageId, 1_000),
    conversationId: cleanOptional(message.conversationId, 1_000),
    subject: cleanOptional(message.subject, 500) || "(No subject)",
    bodyText: cleanOptional(message.body?.content, MAX_STORED_BODY) || cleanOptional(message.bodyPreview, 1_000) || "",
    bodyPreview: cleanOptional(message.bodyPreview, 1_000),
    senderAddress: normalizeEmail(message.from?.emailAddress?.address) || mailbox,
    senderName: cleanOptional(message.from?.emailAddress?.name, 200),
    recipients,
    ccRecipients,
    webLink: safeWebLink(message.webLink),
    hasAttachments: Boolean(message.hasAttachments),
    messageAt: messageTime(message),
    matchCandidates: candidateEvidence,
    sentAt:
      classification.direction === WebsiteInboundEmailDirection.OUTBOUND
        ? messageTime(message)
        : null,
    failureReason: null
  };
}

function findLocalSend(
  existing: Array<{
    id: string;
    submissionId: string | null;
    mailboxAddress: string;
    graphMessageId: string | null;
    status: WebsiteInboundEmailStatus;
    subject: string;
    recipients: Prisma.JsonValue;
    messageAt: Date;
  }>,
  candidate: {
    mailbox: string;
    submissionId: string;
    subject: string;
    recipientEmail: string;
    messageAt: Date;
  }
) {
  return existing.find(
    (message) =>
      !message.graphMessageId &&
      (message.status === WebsiteInboundEmailStatus.SENT ||
        message.status === WebsiteInboundEmailStatus.SEND_FAILED) &&
      message.submissionId === candidate.submissionId &&
      normalizeEmail(message.mailboxAddress) === candidate.mailbox &&
      normalizeSubject(message.subject) === normalizeSubject(candidate.subject) &&
      draftRecipient(message.recipients) === candidate.recipientEmail &&
      Math.abs(message.messageAt.getTime() - candidate.messageAt.getTime()) <= 15 * 60 * 1_000
  );
}

async function buildDraft(input: {
  senderFirstName: string;
  opportunity: {
    company: string | null;
    name: string | null;
    email: string;
    primaryNeed: string | null;
    source: string | null;
    status: string;
    nextAction: string | null;
  };
  correspondence: Array<{
    direction: WebsiteInboundEmailDirection;
    subject: string;
    body: string;
    at: string;
  }>;
}) {
  if (isOpenAiDraftGenerationConfigured()) {
    try {
      const generated = await generateInboundEmailDraft({
        model: process.env.OPENAI_INBOUND_EMAIL_MODEL?.trim() || "gpt-5.6-luna",
        senderFirstName: input.senderFirstName,
        opportunity: {
          company: input.opportunity.company,
          contactName: input.opportunity.name,
          email: input.opportunity.email,
          requirements: input.opportunity.primaryNeed,
          source: input.opportunity.source,
          status: input.opportunity.status,
          nextAction: input.opportunity.nextAction
        },
        correspondence: input.correspondence.map((message) => ({
          ...message,
          direction: message.direction === WebsiteInboundEmailDirection.INBOUND ? "INBOUND" : "OUTBOUND"
        }))
      });
      return { ...generated, source: "AI" as const };
    } catch {
      // A safe template keeps the work moving when the model is unavailable.
    }
  }
  const latestSubject = input.correspondence.at(-1)?.subject;
  const greeting = firstName(input.opportunity.name) || "there";
  const requirement = input.opportunity.primaryNeed
    ? ` about ${input.opportunity.primaryNeed.slice(0, 160)}`
    : "";
  return {
    subject: latestSubject ? replySubject(latestSubject) : "Your Newl enquiry",
    body: `Hi ${greeting},\n\nThank you for contacting Newl${requirement}. I’m reviewing your request and will follow up with the right next steps. If there is a specific deadline or location we should account for, please send it along.\n\n${input.senderFirstName}`,
    recommendedNextAction: input.opportunity.nextAction || "Review the enquiry and confirm the required scope with the contact.",
    recommendedFollowUpDays: 2,
    rationale: "Prepared from the saved enquiry using the safe fallback template because live AI drafting was unavailable.",
    source: "TEMPLATE" as const
  };
}

function draftRecipient(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return null;
  const first = value[0];
  return first && typeof first === "object" && !Array.isArray(first) && "address" in first
    ? normalizeEmail(first.address)
    : null;
}

function readCandidateIds(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) =>
    candidate && typeof candidate === "object" && !Array.isArray(candidate) && typeof candidate.id === "string"
      ? [candidate.id]
      : []
  );
}

function messageTime(message: MicrosoftGraphMailMessage) {
  return new Date(message.sentDateTime || message.receivedDateTime || Number.NaN);
}

function later(current: Date | null | undefined, candidate: Date | undefined) {
  if (!candidate) return current ?? undefined;
  return !current || candidate > current ? candidate : current;
}

function messageKey(mailbox: string, id: string) {
  return `${normalizeEmail(mailbox)}:${id}`;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 320) : "";
}

function normalizeSubject(value: string) {
  return value.trim().replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "").replace(/\s+/g, " ").toLowerCase();
}

function replySubject(value: string) {
  return `Re: ${value.replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "").trim()}`.slice(0, 200);
}

function firstName(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0]?.slice(0, 80) || "";
}

function cleanOptional(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\u0000/g, "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function cleanRequired(value: string, max: number, label: string) {
  const cleaned = cleanOptional(value, max);
  if (!cleaned) throw new InboundValidationError(`Enter an ${label}.`);
  return cleaned;
}

function safeWebLink(value: unknown) {
  const link = cleanOptional(value, 2_000);
  if (!link) return null;
  try {
    const parsed = new URL(link);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Microsoft 365 request failed.")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 1_000);
}

function addBusinessDays(from: Date, days: number) {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (![0, 6].includes(date.getUTCDay())) remaining -= 1;
  }
  return date;
}
