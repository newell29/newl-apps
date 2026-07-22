import { WebsiteGrowthOpportunityStatus, type Prisma } from "@prisma/client";

import { createWebsiteGrowthContentDraftPayload } from "@/modules/website-growth/content-drafts";
import { prisma } from "@/server/db";

export async function produceWebsiteGrowthDraft({
  tenantId,
  opportunityId,
  actorUserId,
  source
}: {
  tenantId: string;
  opportunityId?: string;
  actorUserId?: string | null;
  source: "employee" | "openclaw-scout";
}) {
  const opportunity = await prisma.websiteGrowthOpportunity.findFirst({
    where: {
      tenantId,
      ...(opportunityId ? { id: opportunityId } : { status: WebsiteGrowthOpportunityStatus.REVIEWING }),
      contentDrafts: { none: {} }
    },
    orderBy: [{ score: "desc" }, { updatedAt: "asc" }]
  });
  if (!opportunity) return null;

  const payload = await createWebsiteGrowthContentDraftPayload(opportunity);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.websiteGrowthContentDraft.findFirst({
      where: { tenantId, opportunityId: opportunity.id },
      orderBy: { createdAt: "desc" }
    });
    if (existing) return existing;

    const draft = await tx.websiteGrowthContentDraft.create({
      data: {
        tenantId,
        opportunityId: opportunity.id,
        source: payload.source,
        title: payload.title,
        summary: payload.summary,
        contentType: payload.contentType,
        proposedPath: payload.proposedPath,
        targetPage: opportunity.targetPage,
        draftJson: payload as unknown as Prisma.InputJsonValue,
        rawResponse: payload.rawResponse ? payload.rawResponse as Prisma.InputJsonValue : undefined
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        action: "website-growth.draft.produced",
        entityType: "WebsiteGrowthContentDraft",
        entityId: draft.id,
        after: {
          opportunityId: opportunity.id,
          source,
          modelSource: payload.source,
          proposedPath: payload.proposedPath
        }
      }
    });
    return draft;
  });
}
