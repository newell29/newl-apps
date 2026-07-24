import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus,
  WebsiteGrowthOutreachConsentBasis,
  WebsiteGrowthOutreachMessageKind
} from "@prisma/client";

import { prisma } from "@/server/db";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import {
  createAndSendMicrosoftGraphMailboxMessage,
  fetchMicrosoftGraphMailboxMessages
} from "@/server/integrations/microsoft-graph-mail";

export const WEBSITE_GROWTH_OUTREACH_DAILY_NEW_CONTACT_LIMIT = 5;
export const WEBSITE_GROWTH_OUTREACH_ROLLING_WEEK_NEW_CONTACT_LIMIT = 20;
export const WEBSITE_GROWTH_OUTREACH_DAILY_FOLLOW_UP_LIMIT = 10;
export const WEBSITE_GROWTH_OUTREACH_FIRST_FOLLOW_UP_DAYS = 5;
export const WEBSITE_GROWTH_OUTREACH_SECOND_FOLLOW_UP_DAYS = 12;
export const WEBSITE_GROWTH_OUTREACH_CLOSE_DAYS = 21;

const MAX_SUBJECT_LENGTH = 180;
const MAX_BODY_LENGTH = 4_000;
const REPLY_LOOKBACK_DAYS = 35;
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com"
]);
const PROHIBITED_OUTREACH_COPY = [
  /\b(?:our|a|the)\s+(?:customer|client)\b/i,
  /\b(?:customer|client)\s+(?:name|names|logo|logos|data|volume|volumes|account|accounts|list|lists)\b/i,
  /\bcase\s+stud(?:y|ies)\b/i,
  /\btestimonial(?:s)?\b/i,
  /\bwe\s+(?:work|worked)\s+with\b/i,
  /\b(?:guaranteed?|always|never|best|#1|number\s+one)\b/i
];

type WebsiteGrowthOutreachCountry = "CA" | "US";

export type WebsiteGrowthOutreachIdentity = {
  mailbox: string;
  senderName: string;
  publicBrandName: string;
  publicPhone: string;
  website: string;
  canadianLegalName: string;
  canadianAddress: string;
  usLegalName: string;
  usAddress: string;
};

export type WebsiteGrowthOutreachSendInput = {
  opportunityId: string;
  kind: WebsiteGrowthOutreachMessageKind;
  recipientName?: string | null;
  recipientEmail: string;
  recipientCountry: WebsiteGrowthOutreachCountry;
  contactSourceUrl: string;
  consentBasis: WebsiteGrowthOutreachConsentBasis;
  subject: string;
  body: string;
};

export function readWebsiteGrowthOutreachIdentity(
  env: NodeJS.ProcessEnv = process.env
): WebsiteGrowthOutreachIdentity {
  return {
    mailbox: readRequiredEnvironmentValue(env.WEBSITE_GROWTH_OUTREACH_MAILBOX, "WEBSITE_GROWTH_OUTREACH_MAILBOX"),
    senderName: readRequiredEnvironmentValue(env.WEBSITE_GROWTH_OUTREACH_SENDER_NAME, "WEBSITE_GROWTH_OUTREACH_SENDER_NAME"),
    publicBrandName: readRequiredEnvironmentValue(env.WEBSITE_GROWTH_OUTREACH_PUBLIC_BRAND, "WEBSITE_GROWTH_OUTREACH_PUBLIC_BRAND"),
    publicPhone: readRequiredEnvironmentValue(env.WEBSITE_GROWTH_OUTREACH_PUBLIC_PHONE, "WEBSITE_GROWTH_OUTREACH_PUBLIC_PHONE"),
    website: normalizePublicUrl(
      readRequiredEnvironmentValue(env.WEBSITE_GROWTH_OUTREACH_WEBSITE, "WEBSITE_GROWTH_OUTREACH_WEBSITE")
    ),
    canadianLegalName: readRequiredEnvironmentValue(
      env.WEBSITE_GROWTH_OUTREACH_CANADA_LEGAL_NAME,
      "WEBSITE_GROWTH_OUTREACH_CANADA_LEGAL_NAME"
    ),
    canadianAddress: readRequiredEnvironmentValue(
      env.WEBSITE_GROWTH_OUTREACH_CANADA_ADDRESS,
      "WEBSITE_GROWTH_OUTREACH_CANADA_ADDRESS"
    ),
    usLegalName: readRequiredEnvironmentValue(
      env.WEBSITE_GROWTH_OUTREACH_US_LEGAL_NAME,
      "WEBSITE_GROWTH_OUTREACH_US_LEGAL_NAME"
    ),
    usAddress: readRequiredEnvironmentValue(
      env.WEBSITE_GROWTH_OUTREACH_US_ADDRESS,
      "WEBSITE_GROWTH_OUTREACH_US_ADDRESS"
    )
  };
}

export async function sendWebsiteGrowthOutreachEmail({
  tenantId,
  input,
  now = new Date()
}: {
  tenantId: string;
  input: WebsiteGrowthOutreachSendInput;
  now?: Date;
}) {
  const identity = readWebsiteGrowthOutreachIdentity();
  const normalized = normalizeWebsiteGrowthOutreachSendInput(input);
  validateWebsiteGrowthOutreachConsent(normalized);

  const opportunity = await prisma.websiteGrowthBacklinkOpportunity.findFirst({
    where: { id: normalized.opportunityId, tenantId },
    include: {
      messages: {
        orderBy: { sentAt: "asc" }
      }
    }
  });
  if (!opportunity) {
    throw new Error("The approved backlink opportunity was not found.");
  }
  if (
    opportunity.category === WebsiteGrowthBacklinkCategory.PAID_PLACEMENT ||
    !opportunity.approvedAt ||
    !opportunity.approvedByUserId
  ) {
    throw new Error("Outreach requires a human-approved, non-paid opportunity.");
  }

  validateWebsiteGrowthContactSource({
    sourceDomain: opportunity.sourceDomain,
    sourceUrl: opportunity.sourceUrl,
    contactPage: opportunity.contactPage,
    contactSourceUrl: normalized.contactSourceUrl,
    recipientEmail: normalized.recipientEmail
  });
  assertSafeWebsiteGrowthOutreachCopy(normalized.subject);
  assertSafeWebsiteGrowthOutreachCopy(normalized.body);
  validateOutreachState(opportunity, normalized, now);
  await assertRecipientIsNotSuppressed(tenantId, normalized.recipientEmail);
  await assertWebsiteGrowthOutreachVolumeAvailable({
    tenantId,
    kind: normalized.kind,
    now
  });

  const body = buildCompliantWebsiteGrowthOutreachBody({
    body: normalized.body,
    country: normalized.recipientCountry,
    identity
  });
  const message = await prisma.websiteGrowthOutreachMessage.create({
    data: {
      tenantId,
      opportunityId: opportunity.id,
      kind: normalized.kind,
      recipientEmail: normalized.recipientEmail,
      subject: normalized.subject,
      body,
      sentAt: now
    }
  });

  try {
    const accessToken = await getMicrosoftGraphApplicationAccessToken();
    const sent = await createAndSendMicrosoftGraphMailboxMessage(
      accessToken,
      identity.mailbox,
      {
        recipientEmail: normalized.recipientEmail,
        recipientName: normalized.recipientName,
        subject: normalized.subject,
        body
      }
    );
    const followUpCount =
      normalized.kind === WebsiteGrowthOutreachMessageKind.FOLLOW_UP
        ? opportunity.followUpCount + 1
        : 0;
    const nextFollowUpAt = calculateNextFollowUpAt({
      contactedAt:
        normalized.kind === WebsiteGrowthOutreachMessageKind.INITIAL
          ? now
          : opportunity.contactedAt ?? now,
      followUpCount
    });

    await prisma.$transaction([
      prisma.websiteGrowthOutreachMessage.update({
        where: { id: message.id },
        data: {
          externalMessageId: sent.id,
          conversationId: sent.conversationId
        }
      }),
      prisma.websiteGrowthBacklinkOpportunity.update({
        where: { id: opportunity.id },
        data: {
          status: WebsiteGrowthBacklinkStatus.CONTACTED,
          contactedAt:
            normalized.kind === WebsiteGrowthOutreachMessageKind.INITIAL
              ? now
              : opportunity.contactedAt ?? now,
          recipientName: normalized.recipientName,
          recipientEmail: normalized.recipientEmail,
          recipientCountry: normalized.recipientCountry,
          contactSourceUrl: normalized.contactSourceUrl,
          consentBasis: normalized.consentBasis,
          followUpCount,
          nextFollowUpAt
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId,
          actorUserId: null,
          action: "website-growth.backlink.outreach-sent",
          entityType: "WebsiteGrowthBacklinkOpportunity",
          entityId: opportunity.id,
          after: {
            kind: normalized.kind,
            recipientDomain: normalized.recipientEmail.split("@")[1],
            recipientCountry: normalized.recipientCountry,
            consentBasis: normalized.consentBasis,
            contactSourceUrl: normalized.contactSourceUrl,
            messageId: message.id
          }
        }
      })
    ]);

    return {
      opportunityId: opportunity.id,
      messageId: message.id,
      status: WebsiteGrowthBacklinkStatus.CONTACTED,
      nextFollowUpAt
    };
  } catch (error) {
    await prisma.$transaction([
      prisma.websiteGrowthBacklinkOpportunity.updateMany({
        where: { id: opportunity.id, tenantId },
        data: {
          status: WebsiteGrowthBacklinkStatus.BLOCKED,
          notes:
            "Microsoft 365 did not confirm the outreach send. Review the mailbox before retrying to avoid a duplicate message."
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId,
          actorUserId: null,
          action: "website-growth.backlink.outreach-send-blocked",
          entityType: "WebsiteGrowthBacklinkOpportunity",
          entityId: opportunity.id,
          after: {
            messageId: message.id,
            reason: error instanceof Error ? error.message.slice(0, 500) : "Unknown Microsoft Graph failure"
          }
        }
      })
    ]);
    throw error;
  }
}

export async function getDueWebsiteGrowthOutreachFollowUps({
  tenantId,
  limit = 5,
  now = new Date()
}: {
  tenantId: string;
  limit?: number;
  now?: Date;
}) {
  await closeExpiredWebsiteGrowthOutreach({ tenantId, now });
  const opportunities = await prisma.websiteGrowthBacklinkOpportunity.findMany({
    where: {
      tenantId,
      status: WebsiteGrowthBacklinkStatus.CONTACTED,
      nextFollowUpAt: { lte: now },
      followUpCount: { lt: 2 },
      lastReplyAt: null,
      unsubscribedAt: null
    },
    include: {
      messages: {
        orderBy: { sentAt: "asc" },
        select: {
          kind: true,
          subject: true,
          body: true,
          sentAt: true
        }
      }
    },
    orderBy: [{ nextFollowUpAt: "asc" }, { qualityScore: "desc" }],
    take: Math.min(10, Math.max(1, Math.round(limit)))
  });

  return opportunities.map((opportunity) => ({
    id: opportunity.id,
    title: opportunity.title,
    sourceDomain: opportunity.sourceDomain,
    sourceUrl: opportunity.sourceUrl,
    targetPage: opportunity.targetPage,
    outreachAngle: opportunity.outreachAngle,
    recipientName: opportunity.recipientName,
    recipientEmail: opportunity.recipientEmail,
    recipientCountry: opportunity.recipientCountry,
    contactSourceUrl: opportunity.contactSourceUrl,
    consentBasis: opportunity.consentBasis,
    followUpNumber: opportunity.followUpCount + 1,
    previousMessages: opportunity.messages
  }));
}

export async function syncWebsiteGrowthOutreachReplies({
  tenantId,
  now = new Date()
}: {
  tenantId: string;
  now?: Date;
}) {
  const identity = readWebsiteGrowthOutreachIdentity();
  const tracked = await prisma.websiteGrowthBacklinkOpportunity.findMany({
    where: {
      tenantId,
      status: WebsiteGrowthBacklinkStatus.CONTACTED,
      recipientEmail: { not: null },
      contactedAt: { gte: new Date(now.getTime() - REPLY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) }
    },
    include: {
      messages: {
        where: { conversationId: { not: null } },
        select: { conversationId: true }
      }
    }
  });
  if (tracked.length === 0) {
    return { replies: 0, unsubscribes: 0 };
  }

  const accessToken = await getMicrosoftGraphApplicationAccessToken();
  const messages = await fetchMicrosoftGraphMailboxMessages(
    accessToken,
    identity.mailbox,
    {
      lookbackDays: REPLY_LOOKBACK_DAYS,
      maxMessagesPerMailbox: 250
    }
  );
  let replies = 0;
  let unsubscribes = 0;

  for (const opportunity of tracked) {
    const conversationIds = new Set(
      opportunity.messages
        .map((message) => message.conversationId)
        .filter((value): value is string => Boolean(value))
    );
    const recipientEmail = opportunity.recipientEmail?.trim().toLowerCase();
    if (!recipientEmail || conversationIds.size === 0) continue;

    const reply = messages.find((message) => {
      const sender = message.from?.emailAddress?.address?.trim().toLowerCase();
      const receivedAt = message.receivedDateTime ? new Date(message.receivedDateTime) : null;
      return (
        sender === recipientEmail &&
        Boolean(message.conversationId && conversationIds.has(message.conversationId)) &&
        Boolean(receivedAt && opportunity.contactedAt && receivedAt > opportunity.contactedAt)
      );
    });
    if (!reply) continue;

    const replyText = `${reply.subject ?? ""}\n${reply.bodyPreview ?? ""}`.trim();
    const optedOut = isWebsiteGrowthOutreachOptOut(replyText);
    const receivedAt = reply.receivedDateTime ? new Date(reply.receivedDateTime) : now;
    await prisma.$transaction(async (tx) => {
      await tx.websiteGrowthBacklinkOpportunity.update({
        where: { id: opportunity.id },
        data: {
          status: optedOut
            ? WebsiteGrowthBacklinkStatus.LOST
            : WebsiteGrowthBacklinkStatus.REPLIED,
          lastReplyAt: receivedAt,
          replySummary: replyText.slice(0, 1_000),
          nextFollowUpAt: null,
          unsubscribedAt: optedOut ? receivedAt : null
        }
      });
      if (optedOut) {
        await tx.websiteGrowthOutreachSuppression.upsert({
          where: {
            tenantId_normalizedEmail: {
              tenantId,
              normalizedEmail: recipientEmail
            }
          },
          update: {
            reason: "Recipient requested no further outreach.",
            source: `opportunity:${opportunity.id}`
          },
          create: {
            tenantId,
            normalizedEmail: recipientEmail,
            reason: "Recipient requested no further outreach.",
            source: `opportunity:${opportunity.id}`
          }
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: null,
          action: optedOut
            ? "website-growth.backlink.outreach-unsubscribed"
            : "website-growth.backlink.outreach-replied",
          entityType: "WebsiteGrowthBacklinkOpportunity",
          entityId: opportunity.id,
          after: {
            receivedAt: receivedAt.toISOString(),
            optedOut
          }
        }
      });
    });
    replies += 1;
    if (optedOut) unsubscribes += 1;
  }

  return { replies, unsubscribes };
}

export async function buildWebsiteGrowthOutreachTeamsSummary({
  tenantId,
  baseUrl,
  now = new Date()
}: {
  tenantId: string;
  baseUrl: string;
  now?: Date;
}) {
  const [counts, recentOutcomes] = await Promise.all([
    prisma.websiteGrowthBacklinkOpportunity.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true }
    }),
    prisma.websiteGrowthBacklinkOpportunity.findMany({
      where: {
        tenantId,
        updatedAt: {
          gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        },
        OR: [
          { directoryUsername: { not: null } },
          { status: WebsiteGrowthBacklinkStatus.LIVE }
        ]
      },
      select: {
        sourceDomain: true,
        status: true,
        liveUrl: true,
        directoryLoginUrl: true,
        directoryUsername: true
      },
      orderBy: { updatedAt: "desc" },
      take: 10
    })
  ]);
  const byStatus = Object.fromEntries(counts.map((row) => [row.status, row._count._all]));
  const needsReview = byStatus[WebsiteGrowthBacklinkStatus.NEEDS_REVIEW] ?? 0;
  const approved = byStatus[WebsiteGrowthBacklinkStatus.APPROVED] ?? 0;
  const contacted = byStatus[WebsiteGrowthBacklinkStatus.CONTACTED] ?? 0;
  const replied = byStatus[WebsiteGrowthBacklinkStatus.REPLIED] ?? 0;
  const submitted = byStatus[WebsiteGrowthBacklinkStatus.SUBMITTED] ?? 0;
  const live = byStatus[WebsiteGrowthBacklinkStatus.LIVE] ?? 0;
  const blocked = byStatus[WebsiteGrowthBacklinkStatus.BLOCKED] ?? 0;

  const recentLines = recentOutcomes.map((outcome) => {
    if (outcome.status === WebsiteGrowthBacklinkStatus.LIVE && outcome.liveUrl) {
      return `Verified: ${outcome.sourceDomain} — ${outcome.liveUrl}`;
    }
    return [
      `Directory account: ${outcome.sourceDomain}`,
      outcome.directoryUsername ? `username ${outcome.directoryUsername}` : null,
      outcome.directoryLoginUrl ?? null
    ].filter(Boolean).join(" — ");
  });

  return {
    needsAttention: needsReview > 0 || replied > 0 || blocked > 0,
    message: [
      "Website Growth outreach update",
      `${needsReview} prospect${needsReview === 1 ? "" : "s"} need your approval; ${approved} approved item${approved === 1 ? "" : "s"} ${approved === 1 ? "is" : "are"} ready for Scout.`,
      `${contacted} contacted; ${replied} replied; ${submitted} directory submissions; ${live} verified live; ${blocked} blocked.`,
      ...(recentLines.length > 0
        ? ["Recent directory and backlink results:", ...recentLines]
        : ["No new directory accounts or verified backlinks in the last seven days."]),
      `${baseUrl.replace(/\/+$/, "")}/website-growth/backlinks`
    ].join("\n")
  };
}

export function buildCompliantWebsiteGrowthOutreachBody({
  body,
  country,
  identity
}: {
  body: string;
  country: WebsiteGrowthOutreachCountry;
  identity: WebsiteGrowthOutreachIdentity;
}) {
  const legalName =
    country === "CA" ? identity.canadianLegalName : identity.usLegalName;
  const address =
    country === "CA" ? identity.canadianAddress : identity.usAddress;
  return [
    body.trim(),
    "",
    "—",
    identity.senderName,
    identity.publicBrandName,
    legalName,
    address,
    identity.publicPhone,
    identity.website,
    "",
    "If you would prefer not to receive further messages from Newl Group, reply “unsubscribe” and we will stop."
  ].join("\n");
}

export function validateWebsiteGrowthOutreachConsent(
  input: Pick<
    WebsiteGrowthOutreachSendInput,
    "recipientCountry" | "consentBasis" | "contactSourceUrl"
  >
) {
  normalizePublicUrl(input.contactSourceUrl);
  if (
    input.recipientCountry === "CA" &&
    input.consentBasis === WebsiteGrowthOutreachConsentBasis.US_BUSINESS_OUTREACH
  ) {
    throw new Error("Canadian outreach requires a recorded CASL-compatible consent basis.");
  }
  if (
    input.consentBasis === WebsiteGrowthOutreachConsentBasis.CONSPICUOUSLY_PUBLISHED_BUSINESS ||
    input.consentBasis === WebsiteGrowthOutreachConsentBasis.PUBLISHER_SUBMISSION ||
    input.consentBasis === WebsiteGrowthOutreachConsentBasis.US_BUSINESS_OUTREACH
  ) {
    if (!input.contactSourceUrl) {
      throw new Error("Public-business outreach requires the exact public contact source URL.");
    }
  }
}

export function isWebsiteGrowthOutreachOptOut(value: string) {
  return /\b(unsubscribe|remove me|stop (?:emailing|contacting|sending)|do not (?:email|contact)|no more emails)\b/i.test(
    value
  );
}

export function assertSafeWebsiteGrowthOutreachCopy(value: string) {
  const prohibited = PROHIBITED_OUTREACH_COPY.find((pattern) => pattern.test(value));
  if (prohibited) {
    throw new Error(
      "Outreach copy cannot mention customers, case studies, testimonials, guarantees, or unbounded comparative claims."
    );
  }
}

export function validateWebsiteGrowthContactSource({
  sourceDomain,
  sourceUrl,
  contactPage,
  contactSourceUrl,
  recipientEmail
}: {
  sourceDomain: string;
  sourceUrl?: string | null;
  contactPage?: string | null;
  contactSourceUrl: string;
  recipientEmail: string;
}) {
  const sourceHost = new URL(normalizePublicUrl(contactSourceUrl)).hostname;
  const approvedHosts = [sourceDomain, sourceUrl, contactPage]
    .map(readHostname)
    .filter((value): value is string => Boolean(value));
  if (
    approvedHosts.length === 0 ||
    !approvedHosts.some((approvedHost) => domainsShareOrganization(sourceHost, approvedHost))
  ) {
    throw new Error(
      "The public contact source must belong to the human-approved referring organization."
    );
  }

  const recipientDomain = normalizeEmailAddress(recipientEmail).split("@")[1];
  if (
    PUBLIC_EMAIL_DOMAINS.has(recipientDomain) ||
    !domainsShareOrganization(sourceHost, recipientDomain)
  ) {
    throw new Error(
      "Outreach requires a public business email on the approved referring organization's domain."
    );
  }
}

function normalizeWebsiteGrowthOutreachSendInput(
  input: WebsiteGrowthOutreachSendInput
): WebsiteGrowthOutreachSendInput {
  return {
    opportunityId: readRequiredText(input.opportunityId, 100, "Opportunity ID"),
    kind: input.kind,
    recipientName: input.recipientName?.trim().slice(0, 200) || null,
    recipientEmail: normalizeEmailAddress(input.recipientEmail),
    recipientCountry: input.recipientCountry,
    contactSourceUrl: normalizePublicUrl(input.contactSourceUrl),
    consentBasis: input.consentBasis,
    subject: readRequiredText(input.subject, MAX_SUBJECT_LENGTH, "Outreach subject"),
    body: readRequiredText(input.body, MAX_BODY_LENGTH, "Outreach body")
  };
}

function validateOutreachState(
  opportunity: {
    status: WebsiteGrowthBacklinkStatus;
    contactedAt: Date | null;
    followUpCount: number;
    recipientEmail: string | null;
    nextFollowUpAt: Date | null;
    lastReplyAt: Date | null;
    messages: Array<{ kind: WebsiteGrowthOutreachMessageKind }>;
  },
  input: WebsiteGrowthOutreachSendInput,
  now: Date
) {
  if (input.kind === WebsiteGrowthOutreachMessageKind.INITIAL) {
    if (
      opportunity.status !== WebsiteGrowthBacklinkStatus.IN_PROGRESS ||
      opportunity.messages.some((message) => message.kind === WebsiteGrowthOutreachMessageKind.INITIAL)
    ) {
      throw new Error("Initial outreach is no longer available for this opportunity.");
    }
    return;
  }

  if (
    opportunity.status !== WebsiteGrowthBacklinkStatus.CONTACTED ||
    opportunity.lastReplyAt ||
    !opportunity.nextFollowUpAt ||
    opportunity.nextFollowUpAt > now ||
    opportunity.followUpCount >= 2
  ) {
    throw new Error("A follow-up is not due for this opportunity.");
  }
  if (
    !opportunity.recipientEmail ||
    normalizeEmailAddress(opportunity.recipientEmail) !== input.recipientEmail
  ) {
    throw new Error("A follow-up must use the originally approved recipient.");
  }
}

async function assertWebsiteGrowthOutreachVolumeAvailable({
  tenantId,
  kind,
  now
}: {
  tenantId: string;
  kind: WebsiteGrowthOutreachMessageKind;
  now: Date;
}) {
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (kind === WebsiteGrowthOutreachMessageKind.INITIAL) {
    const [daily, weekly] = await Promise.all([
      prisma.websiteGrowthOutreachMessage.count({
        where: {
          tenantId,
          kind,
          sentAt: { gte: dayStart }
        }
      }),
      prisma.websiteGrowthOutreachMessage.count({
        where: {
          tenantId,
          kind,
          sentAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }
        }
      })
    ]);
    if (daily >= WEBSITE_GROWTH_OUTREACH_DAILY_NEW_CONTACT_LIMIT) {
      throw new Error("The five-new-contacts rolling daily limit has been reached.");
    }
    if (weekly >= WEBSITE_GROWTH_OUTREACH_ROLLING_WEEK_NEW_CONTACT_LIMIT) {
      throw new Error("The twenty-new-contacts rolling weekly limit has been reached.");
    }
    return;
  }

  const dailyFollowUps = await prisma.websiteGrowthOutreachMessage.count({
    where: {
      tenantId,
      kind,
      sentAt: { gte: dayStart }
    }
  });
  if (dailyFollowUps >= WEBSITE_GROWTH_OUTREACH_DAILY_FOLLOW_UP_LIMIT) {
    throw new Error("The daily follow-up limit has been reached.");
  }
}

async function assertRecipientIsNotSuppressed(
  tenantId: string,
  normalizedEmail: string
) {
  const suppression = await prisma.websiteGrowthOutreachSuppression.findUnique({
    where: {
      tenantId_normalizedEmail: {
        tenantId,
        normalizedEmail
      }
    }
  });
  if (suppression) {
    throw new Error("This recipient is on the Website Growth do-not-contact list.");
  }
}

async function closeExpiredWebsiteGrowthOutreach({
  tenantId,
  now
}: {
  tenantId: string;
  now: Date;
}) {
  const expiredBefore = new Date(
    now.getTime() - WEBSITE_GROWTH_OUTREACH_CLOSE_DAYS * 24 * 60 * 60 * 1000
  );
  return prisma.websiteGrowthBacklinkOpportunity.updateMany({
    where: {
      tenantId,
      status: WebsiteGrowthBacklinkStatus.CONTACTED,
      contactedAt: { lte: expiredBefore },
      lastReplyAt: null
    },
    data: {
      status: WebsiteGrowthBacklinkStatus.LOST,
      nextFollowUpAt: null,
      notes: `Closed after ${WEBSITE_GROWTH_OUTREACH_CLOSE_DAYS} days without a reply.`
    }
  });
}

function calculateNextFollowUpAt({
  contactedAt,
  followUpCount
}: {
  contactedAt: Date;
  followUpCount: number;
}) {
  if (followUpCount >= 2) {
    return new Date(
      contactedAt.getTime() + WEBSITE_GROWTH_OUTREACH_CLOSE_DAYS * 24 * 60 * 60 * 1000
    );
  }
  const days =
    followUpCount === 0
      ? WEBSITE_GROWTH_OUTREACH_FIRST_FOLLOW_UP_DAYS
      : WEBSITE_GROWTH_OUTREACH_SECOND_FOLLOW_UP_DAYS;
  return new Date(contactedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeEmailAddress(value: string) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ||
    normalized.endsWith("@newlgroup.com")
  ) {
    throw new Error("The outreach recipient email address is invalid.");
  }
  return normalized;
}

function normalizePublicUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Public outreach URLs must use HTTP or HTTPS.");
  }
  if (
    parsed.hostname === "localhost" ||
    parsed.hostname.endsWith(".local") ||
    parsed.hostname === "127.0.0.1"
  ) {
    throw new Error("Public outreach URLs cannot point to a local host.");
  }
  return parsed.toString();
}

function readHostname(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    return new URL(
      value.includes("://") ? value : `https://${value}`
    ).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainsShareOrganization(left: string, right: string) {
  const normalizedLeft = left.toLowerCase().replace(/^www\./, "");
  const normalizedRight = right.toLowerCase().replace(/^www\./, "");
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`.${normalizedRight}`) ||
    normalizedRight.endsWith(`.${normalizedLeft}`)
  );
}

function readRequiredText(value: string, maxLength: number, label: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized.slice(0, maxLength);
}

function readRequiredEnvironmentValue(
  value: string | undefined,
  name: string
) {
  if (!value?.trim()) {
    throw new Error(`${name} is required for Website Growth outreach.`);
  }
  return value.trim();
}
