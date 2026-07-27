"use server";

import {
  ModuleKey,
  PlatformRole,
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus,
  WebsiteGrowthDirectoryAccountState
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function reviewWebsiteGrowthBacklinkAction(formData: FormData) {
  const context = await getBacklinkReviewContext();
  const backlinkId = readBacklinkId(formData);
  const decision = parseBacklinkReviewDecision(formData.get("decision"));
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000);
  const opportunity = await prisma.websiteGrowthBacklinkOpportunity.findFirst({
    where: {
      id: backlinkId,
      tenantId: context.tenantId,
      status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW
    },
    select: { id: true, title: true }
  });
  if (!opportunity) {
    throw new Error("This backlink opportunity is no longer waiting for review.");
  }
  const now = new Date();

  const result = await prisma.websiteGrowthBacklinkOpportunity.updateMany({
    where: {
      id: opportunity.id,
      tenantId: context.tenantId,
      status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW
    },
    data: {
      status: decision,
      notes: notes || undefined,
      approvedByUserId: decision === WebsiteGrowthBacklinkStatus.APPROVED ? context.userId : undefined,
      approvedAt: decision === WebsiteGrowthBacklinkStatus.APPROVED ? now : undefined
    }
  });
  if (result.count !== 1) {
    throw new Error("This backlink opportunity is no longer waiting for review.");
  }

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: decision === WebsiteGrowthBacklinkStatus.APPROVED
        ? "website-growth.backlink.approved"
        : "website-growth.backlink.rejected",
      entityType: "WebsiteGrowthBacklinkOpportunity",
      entityId: opportunity.id,
      before: { status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW },
      after: { status: decision, notes: notes || null }
    }
  });

  revalidatePath("/website-growth/backlinks");
  redirect(buildBacklinkReviewResultHref({
    result: decision === WebsiteGrowthBacklinkStatus.APPROVED ? "approved" : "rejected",
    opportunityTitle: opportunity.title
  }));
}

export async function returnWebsiteGrowthBacklinkToReviewAction(formData: FormData) {
  const context = await getBacklinkReviewContext();
  const backlinkId = readBacklinkId(formData);
  const opportunity = await prisma.websiteGrowthBacklinkOpportunity.findFirst({
    where: {
      id: backlinkId,
      tenantId: context.tenantId,
      status: WebsiteGrowthBacklinkStatus.APPROVED
    },
    select: { id: true, title: true }
  });
  if (!opportunity) {
    throw new Error("Only approved backlink work that has not started can return to review.");
  }

  const result = await prisma.websiteGrowthBacklinkOpportunity.updateMany({
    where: {
      id: opportunity.id,
      tenantId: context.tenantId,
      status: WebsiteGrowthBacklinkStatus.APPROVED
    },
    data: {
      status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW,
      approvedByUserId: null,
      approvedAt: null
    }
  });
  if (result.count !== 1) {
    throw new Error("This backlink opportunity is no longer available to return to review.");
  }

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "website-growth.backlink.approval-reversed",
      entityType: "WebsiteGrowthBacklinkOpportunity",
      entityId: opportunity.id,
      before: { status: WebsiteGrowthBacklinkStatus.APPROVED },
      after: { status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW }
    }
  });

  revalidatePath("/website-growth/backlinks");
  redirect(buildBacklinkReviewResultHref({
    result: "returned",
    opportunityTitle: opportunity.title
  }));
}

export async function retryBlockedWebsiteGrowthBacklinkAction(formData: FormData) {
  const context = await getBacklinkReviewContext();
  const backlinkId = readBacklinkId(formData);
  if (formData.get("confirmNoExternalAction") !== "yes") {
    throw new Error("Confirm that no email or directory submission occurred before retrying.");
  }
  const retryableWhere = {
    id: backlinkId,
    tenantId: context.tenantId,
    status: WebsiteGrowthBacklinkStatus.BLOCKED,
    approvedByUserId: { not: null },
    approvedAt: { not: null },
    submittedAt: null,
    contactedAt: null,
    messages: {
      every: {
        externalMessageId: null,
        conversationId: null
      }
    }
  } as const;
  const opportunity = await prisma.websiteGrowthBacklinkOpportunity.findFirst({
    where: retryableWhere,
    select: {
      id: true,
      title: true,
      notes: true,
      category: true,
      directoryCredentialRef: true
    }
  });
  if (!opportunity) {
    throw new Error(
      "Only previously approved blocked work with no confirmed submission or delivered outreach can be retried."
    );
  }

  const result = await prisma.websiteGrowthBacklinkOpportunity.updateMany({
    where: retryableWhere,
    data: {
      status: WebsiteGrowthBacklinkStatus.APPROVED,
      claimedAt: null,
      notes: null,
      directoryAccountState:
        opportunity.category === WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION
          ? opportunity.directoryCredentialRef
            ? WebsiteGrowthDirectoryAccountState.CREDENTIAL_READY
            : WebsiteGrowthDirectoryAccountState.NEEDS_ACCOUNT
          : WebsiteGrowthDirectoryAccountState.NOT_REQUIRED,
      directoryChallengeType: null,
      directoryChallengeDetail: null,
      directoryChallengeAt: null
    }
  });
  if (result.count !== 1) {
    throw new Error("This blocked backlink opportunity is no longer safe to retry.");
  }

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "website-growth.backlink.retry-approved",
      entityType: "WebsiteGrowthBacklinkOpportunity",
      entityId: opportunity.id,
      before: {
        status: WebsiteGrowthBacklinkStatus.BLOCKED,
        notes: opportunity.notes
      },
      after: {
        status: WebsiteGrowthBacklinkStatus.APPROVED,
        approvalRetained: true,
        externalActionPreviouslyRecorded: false
      }
    }
  });

  revalidatePath("/website-growth/backlinks");
  redirect(buildBacklinkReviewResultHref({
    result: "retried",
    opportunityTitle: opportunity.title
  }));
}

export async function approveAllWebsiteGrowthBacklinksAction() {
  const context = await getBacklinkReviewContext();
  const pending = await prisma.websiteGrowthBacklinkOpportunity.findMany({
    where: {
      tenantId: context.tenantId,
      status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW
    },
    orderBy: [{ qualityScore: "desc" }, { createdAt: "asc" }],
    take: 50,
    select: { id: true }
  });
  if (pending.length === 0) {
    revalidatePath("/website-growth/backlinks");
    return;
  }
  const ids = pending.map((item) => item.id);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.websiteGrowthBacklinkOpportunity.updateMany({
      where: {
        tenantId: context.tenantId,
        id: { in: ids },
        status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW
      },
      data: {
        status: WebsiteGrowthBacklinkStatus.APPROVED,
        approvedByUserId: context.userId,
        approvedAt: now
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "website-growth.backlink.batch-approved",
        entityType: "WebsiteGrowthBacklinkOpportunity",
        after: {
          status: WebsiteGrowthBacklinkStatus.APPROVED,
          opportunityIds: ids
        }
      }
    });
  });

  revalidatePath("/website-growth/backlinks");
}

async function getBacklinkReviewContext() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER]);
  return context;
}

function readBacklinkId(formData: FormData) {
  const backlinkId = String(formData.get("backlinkId") ?? "").trim();
  if (!backlinkId) {
    throw new Error("Missing backlink opportunity ID.");
  }
  return backlinkId;
}

function parseBacklinkReviewDecision(value: FormDataEntryValue | null) {
  if (value === WebsiteGrowthBacklinkStatus.APPROVED || value === WebsiteGrowthBacklinkStatus.REJECTED) {
    return value;
  }
  throw new Error("Backlink review decision must be approved or rejected.");
}

function buildBacklinkReviewResultHref({
  result,
  opportunityTitle
}: {
  result: "approved" | "rejected" | "returned" | "retried";
  opportunityTitle: string;
}) {
  const query = new URLSearchParams({
    reviewResult: result,
    opportunity: opportunityTitle.slice(0, 200)
  });
  const anchor =
    result === "approved" || result === "retried"
      ? "approved-backlinks"
      : "review-backlinks";
  return `/website-growth/backlinks?${query.toString()}#${anchor}`;
}
