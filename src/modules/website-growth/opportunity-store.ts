import {
  WebsiteGrowthOpportunityStatus,
  type Prisma
} from "@prisma/client";

import {
  getOpportunityReviewKey,
  resolveLegacyPageRebuild
} from "@/modules/website-growth/legacy-rebuilds";
import type { OpportunityCandidate } from "@/modules/website-growth/opportunities";
import { prisma } from "@/server/db";

export async function createMissingWebsiteGrowthOpportunities(
  tenantId: string,
  candidates: OpportunityCandidate[]
) {
  let createdCount = 0;
  let existingCount = 0;

  for (const candidate of candidates) {
    if (!candidate.topic) continue;

    const legacyRebuild = resolveLegacyPageRebuild(candidate);
    const existing = legacyRebuild
      ? await findExistingLegacyRebuildOpportunity(tenantId, candidate)
      : await prisma.websiteGrowthOpportunity.findFirst({
          where: {
            tenantId,
            topic: candidate.topic,
            targetPage: candidate.targetPage,
            action: candidate.action
          },
          select: { id: true, score: true }
        });

    if (existing) {
      const refreshable = await prisma.websiteGrowthOpportunity.findFirst({
        where: {
          id: existing.id,
          tenantId,
          status: {
            in: [
              WebsiteGrowthOpportunityStatus.NEW,
              WebsiteGrowthOpportunityStatus.REVIEWING,
              WebsiteGrowthOpportunityStatus.MONITORING
            ]
          }
        },
        select: { id: true }
      });

      if (legacyRebuild || refreshable) {
        await prisma.websiteGrowthOpportunity.update({
          where: { id: existing.id },
          data: {
            action: candidate.action,
            topic: candidate.topic,
            primaryKeyword: candidate.primaryKeyword,
            targetPage: candidate.targetPage,
            sourcePage: candidate.sourcePage,
            score: Math.max(candidate.score, existing.score ?? 0),
            confidence: candidate.confidence,
            reason: candidate.reason,
            recommendation: candidate.recommendation,
            supportingKeywords: candidate.supportingKeywords,
            evidence: candidate.evidence as Prisma.InputJsonValue
          }
        });
      }
      existingCount += 1;
      continue;
    }

    await prisma.websiteGrowthOpportunity.create({
      data: {
        tenantId,
        action: candidate.action,
        topic: candidate.topic,
        primaryKeyword: candidate.primaryKeyword,
        targetPage: candidate.targetPage,
        sourcePage: candidate.sourcePage,
        score: candidate.score,
        confidence: candidate.confidence,
        reason: candidate.reason,
        recommendation: candidate.recommendation,
        supportingKeywords: candidate.supportingKeywords,
        evidence: candidate.evidence as Prisma.InputJsonValue
      }
    });
    createdCount += 1;
  }

  return { createdCount, existingCount };
}

async function findExistingLegacyRebuildOpportunity(
  tenantId: string,
  candidate: OpportunityCandidate
) {
  const reviewKey = getOpportunityReviewKey(candidate);
  const rebuild = resolveLegacyPageRebuild(candidate);

  if (!rebuild) return null;

  const candidates = await prisma.websiteGrowthOpportunity.findMany({
    where: {
      tenantId,
      OR: [
        { targetPage: candidate.targetPage },
        { sourcePage: candidate.targetPage },
        { targetPage: { contains: rebuild.legacyPath } },
        { sourcePage: { contains: rebuild.legacyPath } },
        { targetPage: { contains: rebuild.currentRedirectPath } },
        { sourcePage: { contains: rebuild.currentRedirectPath } },
        { topic: { contains: "3pl" } },
        { primaryKeyword: { contains: "3pl" } }
      ]
    },
    select: {
      id: true,
      score: true,
      action: true,
      topic: true,
      primaryKeyword: true,
      targetPage: true,
      sourcePage: true,
      evidence: true
    },
    take: 50
  });

  return candidates.find((opportunity) => getOpportunityReviewKey(opportunity) === reviewKey) ?? null;
}
