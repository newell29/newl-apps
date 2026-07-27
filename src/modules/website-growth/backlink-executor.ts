import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus,
  WebsiteGrowthDirectoryAccountState,
  WebsiteGrowthDirectoryChallengeType
} from "@prisma/client";

import { prisma } from "@/server/db";

const CLAIM_LIMIT = 10;
const CLAIM_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export function isWebsiteGrowthBacklinkExecutorClaimable({
  status,
  category
}: {
  status: WebsiteGrowthBacklinkStatus;
  category: WebsiteGrowthBacklinkCategory;
}) {
  return status === WebsiteGrowthBacklinkStatus.APPROVED &&
    category !== WebsiteGrowthBacklinkCategory.PAID_PLACEMENT;
}

export async function claimApprovedWebsiteGrowthBacklinks({
  tenantId,
  limit = 5
}: {
  tenantId: string;
  limit?: number;
}) {
  const boundedLimit = Math.min(CLAIM_LIMIT, Math.max(1, Math.round(limit)));
  return prisma.$transaction(async (tx) => {
    await tx.websiteGrowthBacklinkOpportunity.updateMany({
      where: {
        tenantId,
        status: WebsiteGrowthBacklinkStatus.IN_PROGRESS,
        claimedAt: { lt: new Date(Date.now() - CLAIM_TIMEOUT_MS) }
      },
      data: {
        status: WebsiteGrowthBacklinkStatus.BLOCKED,
        notes: "The executor claim expired before a confirmed result. Review before retrying to avoid duplicate outreach or submission."
      }
    });
    const candidates = await tx.websiteGrowthBacklinkOpportunity.findMany({
      where: {
        tenantId,
        status: WebsiteGrowthBacklinkStatus.APPROVED,
        category: { not: WebsiteGrowthBacklinkCategory.PAID_PLACEMENT }
      },
      orderBy: [{ qualityScore: "desc" }, { approvedAt: "asc" }],
      take: boundedLimit
    });
    const claimed = [];

    for (const candidate of candidates) {
      const updated = await tx.websiteGrowthBacklinkOpportunity.updateMany({
        where: {
          id: candidate.id,
          tenantId,
          status: WebsiteGrowthBacklinkStatus.APPROVED
        },
        data: {
          status: WebsiteGrowthBacklinkStatus.IN_PROGRESS,
          claimedAt: new Date()
        }
      });
      if (updated.count === 1) claimed.push({ ...candidate, status: WebsiteGrowthBacklinkStatus.IN_PROGRESS });
    }

    if (claimed.length > 0) {
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: null,
          action: "website-growth.backlink.executor-claimed",
          entityType: "WebsiteGrowthBacklinkOpportunity",
          after: { opportunityIds: claimed.map((item) => item.id) }
        }
      });
    }

    return claimed.map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      sourceDomain: item.sourceDomain,
      sourceUrl: item.sourceUrl,
      contactPage: item.contactPage,
      targetPage: item.targetPage,
      rationale: item.rationale,
      outreachAngle: item.outreachAngle,
      requiresContent: item.requiresContent,
      estimatedCostAmount: item.estimatedCostAmount,
      currency: item.currency,
      notes: item.notes
    }));
  });
}

export async function reportWebsiteGrowthBacklinkExecution({
  tenantId,
  opportunityId,
  status,
  notes,
  liveUrl,
  directoryLoginUrl,
  directoryUsername,
  directoryAccountState,
  directoryChallengeType,
  directoryChallengeDetail,
  acceptedTermsUrl,
  acceptedTermsSummary
}: {
  tenantId: string;
  opportunityId: string;
  status: WebsiteGrowthBacklinkStatus;
  notes?: string | null;
  liveUrl?: string | null;
  directoryLoginUrl?: string | null;
  directoryUsername?: string | null;
  directoryAccountState?: WebsiteGrowthDirectoryAccountState | null;
  directoryChallengeType?: WebsiteGrowthDirectoryChallengeType | null;
  directoryChallengeDetail?: string | null;
  acceptedTermsUrl?: string | null;
  acceptedTermsSummary?: string | null;
}) {
  const allowedStatuses = new Set<WebsiteGrowthBacklinkStatus>([
    WebsiteGrowthBacklinkStatus.SUBMITTED,
    WebsiteGrowthBacklinkStatus.CONTACTED,
    WebsiteGrowthBacklinkStatus.LIVE,
    WebsiteGrowthBacklinkStatus.LOST,
    WebsiteGrowthBacklinkStatus.BLOCKED
  ]);
  if (!allowedStatuses.has(status)) {
    throw new Error("The backlink executor reported an unsupported status.");
  }
  if (status === WebsiteGrowthBacklinkStatus.LIVE && !liveUrl) {
    throw new Error("A verified live backlink must include its public URL.");
  }
  if (status === WebsiteGrowthBacklinkStatus.BLOCKED && !notes?.trim()) {
    throw new Error(
      "A blocked backlink report must include the specific blocker reason."
    );
  }
  validateDirectoryAccountReport({
    status,
    directoryAccountState,
    directoryChallengeType,
    directoryChallengeDetail
  });
  assertWebsiteGrowthBacklinkReportContainsNoSecrets([
    notes,
    directoryLoginUrl,
    directoryUsername,
    directoryChallengeDetail,
    acceptedTermsUrl,
    acceptedTermsSummary
  ]);
  const now = new Date();
  const current = await prisma.websiteGrowthBacklinkOpportunity.findFirst({
    where: { id: opportunityId, tenantId },
    select: {
      status: true,
      submittedAt: true,
      category: true
    }
  });
  if (!current) {
    throw new Error("The backlink opportunity was not found.");
  }
  const isDirectory =
    current.category === WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION;
  if (
    !isDirectory &&
    (directoryAccountState ||
      directoryChallengeType ||
      directoryChallengeDetail)
  ) {
    throw new Error(
      "Directory account fields may be reported only for a directory opportunity."
    );
  }
  const nextDirectoryAccountState = isDirectory
    ? getReportedDirectoryAccountState({
        status,
        requested: directoryAccountState
      })
    : undefined;
  const result = await prisma.websiteGrowthBacklinkOpportunity.updateMany({
    where: {
      id: opportunityId,
      tenantId,
      status: {
        in: [
          WebsiteGrowthBacklinkStatus.IN_PROGRESS,
          WebsiteGrowthBacklinkStatus.SUBMITTED,
          WebsiteGrowthBacklinkStatus.CONTACTED,
          WebsiteGrowthBacklinkStatus.REPLIED,
          WebsiteGrowthBacklinkStatus.LIVE,
          WebsiteGrowthBacklinkStatus.BLOCKED
        ]
      }
    },
    data: {
      status,
      notes: notes?.trim().slice(0, 2000) || undefined,
      submittedAt:
        status === WebsiteGrowthBacklinkStatus.SUBMITTED
          ? current.submittedAt ?? now
          : undefined,
      contactedAt: status === WebsiteGrowthBacklinkStatus.CONTACTED ? now : undefined,
      liveUrl: status === WebsiteGrowthBacklinkStatus.LIVE ? normalizePublicUrl(liveUrl) : undefined,
      directoryLoginUrl: directoryLoginUrl ? normalizePublicUrl(directoryLoginUrl) : undefined,
      directoryUsername: directoryUsername?.trim().slice(0, 320) || undefined,
      directoryAccountState: nextDirectoryAccountState,
      directoryAccountVerifiedAt:
        nextDirectoryAccountState === WebsiteGrowthDirectoryAccountState.ACTIVE
          ? now
          : undefined,
      directoryChallengeType:
        isDirectory && status === WebsiteGrowthBacklinkStatus.BLOCKED
          ? directoryChallengeType ?? WebsiteGrowthDirectoryChallengeType.OTHER
          : isDirectory
            ? null
            : undefined,
      directoryChallengeDetail:
        isDirectory && status === WebsiteGrowthBacklinkStatus.BLOCKED
          ? directoryChallengeDetail?.trim().slice(0, 1000) ||
            notes?.trim().slice(0, 1000)
          : isDirectory
            ? null
            : undefined,
      directoryChallengeAt:
        isDirectory && status === WebsiteGrowthBacklinkStatus.BLOCKED
          ? now
          : isDirectory
            ? null
            : undefined,
      acceptedTermsUrl: acceptedTermsUrl ? normalizePublicUrl(acceptedTermsUrl) : undefined,
      acceptedTermsSummary: acceptedTermsSummary?.trim().slice(0, 1000) || undefined,
      verifiedAt: status === WebsiteGrowthBacklinkStatus.LIVE ? now : undefined,
      lastVerifiedAt:
        status === WebsiteGrowthBacklinkStatus.LIVE ||
        status === WebsiteGrowthBacklinkStatus.LOST ||
        status === WebsiteGrowthBacklinkStatus.SUBMITTED
          ? now
          : undefined
    }
  });
  if (result.count !== 1) throw new Error("The backlink opportunity was not found in an executable state.");

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId: null,
      action: "website-growth.backlink.executor-reported",
      entityType: "WebsiteGrowthBacklinkOpportunity",
      entityId: opportunityId,
      after: {
        status,
        liveUrl: status === WebsiteGrowthBacklinkStatus.LIVE ? normalizePublicUrl(liveUrl) : null,
        notes: notes?.trim().slice(0, 2000) || null,
        directoryLoginUrl: directoryLoginUrl ? normalizePublicUrl(directoryLoginUrl) : null,
        directoryUsername: directoryUsername?.trim().slice(0, 320) || null,
        directoryAccountState: nextDirectoryAccountState ?? null,
        directoryChallengeType:
          isDirectory && status === WebsiteGrowthBacklinkStatus.BLOCKED
            ? directoryChallengeType ?? WebsiteGrowthDirectoryChallengeType.OTHER
            : null,
        acceptedTermsUrl: acceptedTermsUrl ? normalizePublicUrl(acceptedTermsUrl) : null
      }
    }
  });
}

function validateDirectoryAccountReport({
  status,
  directoryAccountState,
  directoryChallengeType,
  directoryChallengeDetail
}: {
  status: WebsiteGrowthBacklinkStatus;
  directoryAccountState?: WebsiteGrowthDirectoryAccountState | null;
  directoryChallengeType?: WebsiteGrowthDirectoryChallengeType | null;
  directoryChallengeDetail?: string | null;
}) {
  if (
    directoryChallengeType &&
    status !== WebsiteGrowthBacklinkStatus.BLOCKED
  ) {
    throw new Error("Directory challenge types may be reported only with BLOCKED.");
  }
  if (
    directoryChallengeType &&
    !directoryChallengeDetail?.trim()
  ) {
    throw new Error("A directory challenge must include a sanitized detail.");
  }
  if (!directoryAccountState) return;
  const allowed =
    (status === WebsiteGrowthBacklinkStatus.SUBMITTED &&
      directoryAccountState ===
        WebsiteGrowthDirectoryAccountState.EMAIL_VERIFICATION_PENDING) ||
    (status === WebsiteGrowthBacklinkStatus.BLOCKED &&
      (directoryAccountState ===
        WebsiteGrowthDirectoryAccountState.HUMAN_ACTION_REQUIRED ||
        directoryAccountState === WebsiteGrowthDirectoryAccountState.FAILED)) ||
    (status === WebsiteGrowthBacklinkStatus.LIVE &&
      directoryAccountState === WebsiteGrowthDirectoryAccountState.ACTIVE);
  if (!allowed) {
    throw new Error(
      "The reported directory account state does not match the backlink result."
    );
  }
}

function getReportedDirectoryAccountState({
  status,
  requested
}: {
  status: WebsiteGrowthBacklinkStatus;
  requested?: WebsiteGrowthDirectoryAccountState | null;
}) {
  if (requested) return requested;
  if (status === WebsiteGrowthBacklinkStatus.SUBMITTED) {
    return WebsiteGrowthDirectoryAccountState.EMAIL_VERIFICATION_PENDING;
  }
  if (status === WebsiteGrowthBacklinkStatus.BLOCKED) {
    return WebsiteGrowthDirectoryAccountState.HUMAN_ACTION_REQUIRED;
  }
  if (status === WebsiteGrowthBacklinkStatus.LIVE) {
    return WebsiteGrowthDirectoryAccountState.ACTIVE;
  }
  if (status === WebsiteGrowthBacklinkStatus.LOST) {
    return WebsiteGrowthDirectoryAccountState.FAILED;
  }
  return undefined;
}

export async function getWebsiteGrowthBacklinkVerificationQueue({
  tenantId,
  limit = 5,
  now = new Date()
}: {
  tenantId: string;
  limit?: number;
  now?: Date;
}) {
  const recheckBefore = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const opportunities = await prisma.websiteGrowthBacklinkOpportunity.findMany({
    where: {
      tenantId,
      status: WebsiteGrowthBacklinkStatus.SUBMITTED,
      submittedAt: { lte: recheckBefore },
      OR: [
        { lastVerifiedAt: null },
        { lastVerifiedAt: { lte: recheckBefore } }
      ]
    },
    orderBy: [{ lastVerifiedAt: "asc" }, { qualityScore: "desc" }],
    take: Math.min(10, Math.max(1, Math.round(limit)))
  });

  return opportunities.map((opportunity) => ({
    id: opportunity.id,
    title: opportunity.title,
    sourceDomain: opportunity.sourceDomain,
    sourceUrl: opportunity.sourceUrl,
    targetPage: opportunity.targetPage,
    submittedAt: opportunity.submittedAt,
    lastVerifiedAt: opportunity.lastVerifiedAt,
    directoryLoginUrl: opportunity.directoryLoginUrl
  }));
}

export function parseWebsiteGrowthBacklinkExecutionStatus(value: unknown) {
  if (
    typeof value === "string" &&
    Object.values(WebsiteGrowthBacklinkStatus).includes(value as WebsiteGrowthBacklinkStatus)
  ) {
    return value as WebsiteGrowthBacklinkStatus;
  }
  throw new Error("Backlink execution status is invalid.");
}

export function parseWebsiteGrowthDirectoryAccountState(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !Object.values(WebsiteGrowthDirectoryAccountState).includes(
      value as WebsiteGrowthDirectoryAccountState
    )
  ) {
    throw new Error("The directory account state is invalid.");
  }
  return value as WebsiteGrowthDirectoryAccountState;
}

export function parseWebsiteGrowthDirectoryChallengeType(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !Object.values(WebsiteGrowthDirectoryChallengeType).includes(
      value as WebsiteGrowthDirectoryChallengeType
    )
  ) {
    throw new Error("The directory challenge type is invalid.");
  }
  return value as WebsiteGrowthDirectoryChallengeType;
}

export function assertWebsiteGrowthBacklinkReportContainsNoSecrets(
  values: Array<string | null | undefined>
) {
  if (
    values.some((value) =>
      value
        ? /\b(?:password|passcode|secret|access[-_\s]?token|api[-_\s]?key|recovery[-_\s]?code|mfa[-_\s]?code)\b/i.test(value)
        : false
    )
  ) {
    throw new Error(
      "Backlink execution reports cannot contain passwords, tokens, recovery codes, or other credentials."
    );
  }
}

function normalizePublicUrl(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Backlink URL must use HTTP or HTTPS.");
  }
  for (const name of parsed.searchParams.keys()) {
    if (/\b(?:token|secret|password|passcode|key|code)\b/i.test(name)) {
      throw new Error("Backlink URLs cannot contain credential-bearing query parameters.");
    }
  }
  if (parsed.hash && /\b(?:token|secret|password|passcode|key|code)\b/i.test(parsed.hash)) {
    throw new Error("Backlink URLs cannot contain credential-bearing fragments.");
  }
  return parsed.toString();
}
