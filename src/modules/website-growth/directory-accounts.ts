import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP, isIPv4, isIPv6 } from "node:net";

import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus,
  WebsiteGrowthDirectoryAccountState,
  WebsiteGrowthDirectoryChallengeType
} from "@prisma/client";

import { prisma } from "@/server/db";
import {
  getMicrosoftGraphApplicationAccessToken
} from "@/server/integrations/microsoft-graph-application";
import {
  fetchMicrosoftGraphMailboxMessages,
  type MicrosoftGraphMailMessage
} from "@/server/integrations/microsoft-graph-mail";

const DIRECTORY_CREDENTIAL_VERSION = 1;
const DIRECTORY_VERIFICATION_LOOKBACK_DAYS = 14;
const DIRECTORY_VERIFICATION_FETCH_TIMEOUT_MS = 20_000;

export async function prepareWebsiteGrowthDirectoryAccount({
  tenantId,
  opportunityId,
  now = new Date(),
  env = process.env
}: {
  tenantId: string;
  opportunityId: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}) {
  const username = readDirectoryAccountUsername(env);
  const opportunity = await prisma.websiteGrowthBacklinkOpportunity.findFirst({
    where: {
      id: opportunityId,
      tenantId,
      category: WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION,
      status: WebsiteGrowthBacklinkStatus.IN_PROGRESS,
      approvedAt: { not: null },
      approvedByUserId: { not: null }
    },
    select: {
      id: true,
      sourceDomain: true,
      sourceUrl: true,
      contactPage: true,
      directoryLoginUrl: true,
      directoryCredentialRef: true,
      directoryCredentialVersion: true
    }
  });
  if (!opportunity) {
    throw new Error(
      "Directory credentials are available only for a claimed, human-approved directory opportunity."
    );
  }

  const directoryLoginUrl = normalizeDirectoryAccountUrl(
    opportunity.directoryLoginUrl ??
      opportunity.contactPage ??
      opportunity.sourceUrl ??
      `https://${opportunity.sourceDomain}`
  );
  const sourceOrigin = new URL(directoryLoginUrl).origin;
  const credentialRef =
    opportunity.directoryCredentialRef ??
    buildDirectoryCredentialRef({
      tenantId,
      opportunityId: opportunity.id,
      sourceOrigin
    });
  const version =
    opportunity.directoryCredentialVersion ?? DIRECTORY_CREDENTIAL_VERSION;
  if (version !== DIRECTORY_CREDENTIAL_VERSION) {
    throw new Error(
      "This directory account uses an unsupported credential version and requires owner review."
    );
  }

  const updated = await prisma.websiteGrowthBacklinkOpportunity.updateMany({
    where: {
      id: opportunity.id,
      tenantId,
      status: WebsiteGrowthBacklinkStatus.IN_PROGRESS,
      category: WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION
    },
    data: {
      directoryLoginUrl,
      directoryUsername: username,
      directoryCredentialRef: credentialRef,
      directoryCredentialVersion: version,
      directoryAccountState: WebsiteGrowthDirectoryAccountState.CREDENTIAL_READY,
      directoryAccountRequestedAt: now,
      directoryChallengeType: null,
      directoryChallengeDetail: null,
      directoryChallengeAt: null
    }
  });
  if (updated.count !== 1) {
    throw new Error("The approved directory opportunity changed before credential preparation.");
  }

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId: null,
      action: "website-growth.backlink.directory-credential-prepared",
      entityType: "WebsiteGrowthBacklinkOpportunity",
      entityId: opportunity.id,
      after: {
        credentialRef,
        version,
        sourceOrigin,
        username,
        passwordStored: false
      }
    }
  });

  return {
    opportunityId: opportunity.id,
    credentialRef,
    sourceOrigin,
    username,
    version: 1 as const
  };
}

export function buildDirectoryCredentialRef({
  tenantId,
  opportunityId,
  sourceOrigin
}: {
  tenantId: string;
  opportunityId: string;
  sourceOrigin: string;
}) {
  const digest = crypto
    .createHash("sha256")
    .update(
      [
        "newl-directory-credential",
        `v${DIRECTORY_CREDENTIAL_VERSION}`,
        tenantId,
        opportunityId,
        new URL(sourceOrigin).origin.toLowerCase()
      ].join("|")
    )
    .digest("hex")
    .slice(0, 32);
  return `directory:v${DIRECTORY_CREDENTIAL_VERSION}:${digest}`;
}

export async function syncWebsiteGrowthDirectoryAccountVerifications({
  tenantId,
  now = new Date(),
  fetchImpl = fetch
}: {
  tenantId: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}) {
  const mailbox = readDirectoryAccountUsername(process.env);
  const opportunities =
    await prisma.websiteGrowthBacklinkOpportunity.findMany({
      where: {
        tenantId,
        status: WebsiteGrowthBacklinkStatus.SUBMITTED,
        category: WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION,
        directoryAccountState:
          WebsiteGrowthDirectoryAccountState.EMAIL_VERIFICATION_PENDING,
        directoryAccountRequestedAt: {
          gte: new Date(
            now.getTime() -
              DIRECTORY_VERIFICATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
          )
        },
        directoryUsername: { not: null }
      },
      orderBy: { directoryAccountRequestedAt: "asc" },
      take: 10
    });
  if (opportunities.length === 0) {
    return { verified: 0, needsHuman: 0, pending: 0 };
  }

  const accessToken = await getMicrosoftGraphApplicationAccessToken();
  const messages = await fetchMicrosoftGraphMailboxMessages(
    accessToken,
    mailbox,
    {
      lookbackDays: DIRECTORY_VERIFICATION_LOOKBACK_DAYS,
      maxMessagesPerMailbox: 150
    }
  );
  let verified = 0;
  let needsHuman = 0;

  for (const opportunity of opportunities) {
    if (
      !opportunity.directoryUsername ||
      !opportunity.directoryAccountRequestedAt
    ) {
      continue;
    }
    const candidate = messages
      .map((message) =>
        findWebsiteGrowthDirectoryVerificationLink({
          message,
          username: opportunity.directoryUsername!,
          sourceDomain: opportunity.sourceDomain,
          requestedAt: opportunity.directoryAccountRequestedAt!
        })
      )
      .find((value) => value !== null);
    if (!candidate) continue;

    if (candidate.verificationUrl) {
      const activated = await activateWebsiteGrowthDirectoryVerificationLink({
        verificationUrl: candidate.verificationUrl,
        sourceDomain: opportunity.sourceDomain,
        fetchImpl
      });
      if (activated) {
        await prisma.$transaction([
          prisma.websiteGrowthBacklinkOpportunity.updateMany({
            where: {
              id: opportunity.id,
              tenantId,
              status: WebsiteGrowthBacklinkStatus.SUBMITTED,
              directoryAccountState:
                WebsiteGrowthDirectoryAccountState.EMAIL_VERIFICATION_PENDING
            },
            data: {
              directoryAccountState:
                WebsiteGrowthDirectoryAccountState.ACTIVE,
              directoryAccountVerifiedAt: now,
              directoryChallengeType: null,
              directoryChallengeDetail: null,
              directoryChallengeAt: null
            }
          }),
          prisma.auditLog.create({
            data: {
              tenantId,
              actorUserId: null,
              action:
                "website-growth.backlink.directory-email-verified",
              entityType: "WebsiteGrowthBacklinkOpportunity",
              entityId: opportunity.id,
              after: {
                messageFingerprint: candidate.messageFingerprint,
                verificationHost: new URL(
                  candidate.verificationUrl
                ).hostname,
                verificationUrlStored: false
              }
            }
          })
        ]);
        verified += 1;
        continue;
      }
    }

    const detail =
      "A directory verification email arrived, but its activation could not be completed safely. Open the partnerships mailbox, complete the verification, then use “Complete next action, then retry” in Newl Apps.";
    await prisma.$transaction([
      prisma.websiteGrowthBacklinkOpportunity.updateMany({
        where: {
          id: opportunity.id,
          tenantId,
          status: WebsiteGrowthBacklinkStatus.SUBMITTED
        },
        data: {
          status: WebsiteGrowthBacklinkStatus.BLOCKED,
          directoryAccountState:
            WebsiteGrowthDirectoryAccountState.HUMAN_ACTION_REQUIRED,
          directoryChallengeType:
            WebsiteGrowthDirectoryChallengeType.EMAIL_VERIFICATION,
          directoryChallengeDetail: detail,
          directoryChallengeAt: now,
          notes: detail
        }
      }),
      prisma.auditLog.create({
        data: {
          tenantId,
          actorUserId: null,
          action:
            "website-growth.backlink.directory-email-needs-human",
          entityType: "WebsiteGrowthBacklinkOpportunity",
          entityId: opportunity.id,
          after: {
            messageFingerprint: candidate.messageFingerprint,
            reason: "SAFE_ACTIVATION_NOT_CONFIRMED",
            verificationUrlStored: false
          }
        }
      })
    ]);
    needsHuman += 1;
  }

  return {
    verified,
    needsHuman,
    pending: Math.max(0, opportunities.length - verified - needsHuman)
  };
}

export function findWebsiteGrowthDirectoryVerificationLink({
  message,
  username,
  sourceDomain,
  requestedAt
}: {
  message: MicrosoftGraphMailMessage;
  username: string;
  sourceDomain: string;
  requestedAt: Date;
}) {
  const receivedAt = message.receivedDateTime
    ? new Date(message.receivedDateTime)
    : null;
  const recipients = [
    ...(message.toRecipients ?? []),
    ...(message.ccRecipients ?? [])
  ]
    .map((recipient) =>
      recipient.emailAddress?.address?.trim().toLowerCase()
    )
    .filter(Boolean);
  if (
    !receivedAt ||
    receivedAt <= requestedAt ||
    !recipients.includes(username.trim().toLowerCase())
  ) {
    return null;
  }

  const searchable = [
    message.subject,
    message.bodyPreview,
    message.body?.content
  ]
    .filter(Boolean)
    .join("\n");
  if (!/\b(?:verify|verification|confirm|activate)\b/i.test(searchable)) {
    return null;
  }
  const verificationUrl = extractSafeDirectoryVerificationUrls(searchable)
    .find((url) => {
      const parsed = new URL(url);
      return (
        domainsShareOrganization(parsed.hostname, sourceDomain) &&
        /\b(?:verify|verification|confirm|activate)\b/i.test(
          `${parsed.pathname} ${parsed.searchParams.toString()}`
        )
      );
    }) ?? null;
  const senderAddress =
    message.from?.emailAddress?.address?.trim().toLowerCase() ?? "";
  const senderDomain = senderAddress.split("@")[1] ?? "";
  if (
    !verificationUrl &&
    !domainsShareOrganization(senderDomain, sourceDomain)
  ) {
    return null;
  }

  return {
    verificationUrl,
    messageFingerprint: crypto
      .createHash("sha256")
      .update(message.id)
      .digest("hex")
      .slice(0, 24)
  };
}

async function activateWebsiteGrowthDirectoryVerificationLink({
  verificationUrl,
  sourceDomain,
  fetchImpl
}: {
  verificationUrl: string;
  sourceDomain: string;
  fetchImpl: typeof fetch;
}) {
  let current = new URL(verificationUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (
      current.protocol !== "https:" ||
      current.username ||
      current.password ||
      !domainsShareOrganization(current.hostname, sourceDomain)
    ) {
      return false;
    }
    await assertPublicDirectoryHostname(current.hostname);
    const response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(
        DIRECTORY_VERIFICATION_FETCH_TIMEOUT_MS
      ),
      headers: {
        "User-Agent": "NewlGroup-DirectoryVerification/1.0"
      }
    });
    if (response.status >= 200 && response.status < 300) return true;
    if (response.status < 300 || response.status >= 400) return false;
    const location = response.headers.get("location");
    if (!location) return false;
    current = new URL(location, current);
  }
  return false;
}

function extractSafeDirectoryVerificationUrls(value: string) {
  const normalized = value
    .replace(/&amp;/gi, "&")
    .replace(/&#x3D;/gi, "=")
    .replace(/&#61;/g, "=");
  return Array.from(
    new Set(normalized.match(/https:\/\/[^\s"'<>]+/gi) ?? [])
  ).filter((url) => {
    try {
      const parsed = new URL(url);
      return !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  });
}

function domainsShareOrganization(left: string, right: string) {
  const normalizedLeft = normalizeDomain(left);
  const normalizedRight = normalizeDomain(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`.${normalizedRight}`) ||
    normalizedRight.endsWith(`.${normalizedLeft}`)
  );
}

function normalizeDomain(value: string) {
  try {
    return new URL(
      value.includes("://") ? value : `https://${value}`
    ).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
  }
}

async function assertPublicDirectoryHostname(hostname: string) {
  if (isIP(hostname)) {
    throw new Error("Directory verification URLs must use a public hostname.");
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  ) {
    throw new Error(
      "The directory verification hostname did not resolve publicly."
    );
  }
}

function isPublicIpAddress(address: string) {
  const normalized = address.toLowerCase();
  if (isIPv4(normalized)) {
    const [first, second] = normalized.split(".").map(Number);
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }
  if (isIPv6(normalized)) {
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("2001:db8:")
    );
  }
  return false;
}

function readDirectoryAccountUsername(env: NodeJS.ProcessEnv) {
  const value = env.WEBSITE_GROWTH_OUTREACH_MAILBOX?.trim().toLowerCase();
  if (!value || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new Error(
      "WEBSITE_GROWTH_OUTREACH_MAILBOX must contain the approved directory account email."
    );
  }
  return value;
}

function normalizeDirectoryAccountUrl(value: string) {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "https:") {
    throw new Error("Directory account URLs must use HTTPS.");
  }
  parsed.hash = "";
  return parsed.toString();
}
