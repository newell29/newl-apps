import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus
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
  assertWebsiteGrowthBacklinkReportContainsNoSecrets([
    notes,
    directoryLoginUrl,
    directoryUsername,
    acceptedTermsUrl,
    acceptedTermsSummary
  ]);
  const now = new Date();
  const current = await prisma.websiteGrowthBacklinkOpportunity.findFirst({
    where: { id: opportunityId, tenantId },
    select: {
      status: true,
      submittedAt: true
    }
  });
  if (!current) {
    throw new Error("The backlink opportunity was not found.");
  }
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
        acceptedTermsUrl: acceptedTermsUrl ? normalizePublicUrl(acceptedTermsUrl) : null
      }
    }
  });
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
