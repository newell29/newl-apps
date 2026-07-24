import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus
} from "@prisma/client";

import { prisma } from "@/server/db";

const CLAIM_LIMIT = 10;

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
        data: { status: WebsiteGrowthBacklinkStatus.IN_PROGRESS }
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
  liveUrl
}: {
  tenantId: string;
  opportunityId: string;
  status: WebsiteGrowthBacklinkStatus;
  notes?: string | null;
  liveUrl?: string | null;
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
  const now = new Date();
  const result = await prisma.websiteGrowthBacklinkOpportunity.updateMany({
    where: {
      id: opportunityId,
      tenantId,
      status: {
        in: [
          WebsiteGrowthBacklinkStatus.IN_PROGRESS,
          WebsiteGrowthBacklinkStatus.SUBMITTED,
          WebsiteGrowthBacklinkStatus.CONTACTED,
          WebsiteGrowthBacklinkStatus.LIVE,
          WebsiteGrowthBacklinkStatus.BLOCKED
        ]
      }
    },
    data: {
      status,
      notes: notes?.trim().slice(0, 2000) || undefined,
      submittedAt: status === WebsiteGrowthBacklinkStatus.SUBMITTED ? now : undefined,
      contactedAt: status === WebsiteGrowthBacklinkStatus.CONTACTED ? now : undefined,
      liveUrl: status === WebsiteGrowthBacklinkStatus.LIVE ? normalizePublicUrl(liveUrl) : undefined,
      verifiedAt: status === WebsiteGrowthBacklinkStatus.LIVE ? now : undefined,
      lastVerifiedAt:
        status === WebsiteGrowthBacklinkStatus.LIVE || status === WebsiteGrowthBacklinkStatus.LOST
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
        notes: notes?.trim().slice(0, 2000) || null
      }
    }
  });
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

function normalizePublicUrl(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Backlink URL must use HTTP or HTTPS.");
  }
  return parsed.toString();
}
