"use server";

import {
  ModuleKey,
  PlatformRole,
  WebsiteGrowthContentDraftStatus,
  WebsiteGrowthImportStatus,
  WebsiteGrowthOpportunityStatus,
  type Prisma
} from "@prisma/client";
import { revalidatePath } from "next/cache";

import { parseDelimitedRows, readNumber, readString } from "@/modules/website-growth/csv";
import {
  buildWebsiteGrowthBuildPackage,
  mergeBuildPackageIntoDraftJson,
  readWebsiteGrowthBuildPackage
} from "@/modules/website-growth/build-package";
import { reviewWebsiteGrowthClaims } from "@/modules/website-growth/claims-policy";
import { createAndDispatchWebsiteGrowthBuildRequest } from "@/modules/website-growth/build-requests";
import {
  syncGa4ForTenant,
  syncSearchConsoleForTenant,
  syncWebsiteInboundForTenant
} from "@/modules/website-growth/evidence-refresh";
import { createMissingWebsiteGrowthOpportunities } from "@/modules/website-growth/opportunity-store";
import {
  buildCandidatesFromMetricRows,
  isQualifiedOpportunity,
  qualifyOpportunityCandidates
} from "@/modules/website-growth/opportunities";
import { parseWebsiteGrowthDataSource } from "@/modules/website-growth/queries";
import { produceWebsiteGrowthDraft } from "@/modules/website-growth/producer";
import { createWeeklyWebsiteGrowthPlanForTenant } from "@/modules/website-growth/weekly-plan";
import { prisma } from "@/server/db";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function importWebsiteGrowthMetricsAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);

  const source = parseWebsiteGrowthDataSource(formData.get("source"));
  const csvText = String(formData.get("csvText") ?? "").trim();
  const fileName = String(formData.get("fileName") ?? "").trim() || "Pasted import";

  if (!csvText) {
    throw new Error("Paste CSV or tab-separated rows before importing.");
  }

  const importRecord = await prisma.websiteGrowthDataImport.create({
    data: {
      tenantId: context.tenantId,
      source,
      status: WebsiteGrowthImportStatus.RUNNING,
      fileName,
      startedAt: new Date()
    }
  });

  try {
    const rows = parseDelimitedRows(csvText);
    const metricRows = rows.map((row) => ({
      tenantId: context.tenantId,
      source,
      page: readString(row, ["page", "url", "landing page", "landing_page"]),
      query: readString(row, ["query", "keyword", "search query"]),
      country: readString(row, ["country"]),
      device: readString(row, ["device"]),
      clicks: readNumber(row, ["clicks"]) ?? 0,
      impressions: readNumber(row, ["impressions", "impr"]) ?? 0,
      ctr: normalizeRate(readNumber(row, ["ctr", "click through rate"])),
      position: readNumber(row, ["position", "avg position", "average position"]),
      sessions: readNumber(row, ["sessions"]),
      engagedSessions: readNumber(row, ["engaged sessions", "engaged_sessions"]),
      engagementRate: normalizeRate(readNumber(row, ["engagement rate", "engagement_rate"])),
      eventCount: readNumber(row, ["event count", "event_count"]),
      leadCount: readNumber(row, ["leads", "generate_lead", "website_form_submit"]) ?? 0,
      raw: row
    }));

    if (metricRows.length > 0) {
      await prisma.websiteGrowthMetric.createMany({
        data: metricRows
      });
    }

    const qualification = qualifyOpportunityCandidates(buildCandidatesFromMetricRows(rows, source));
    const opportunitySummary = await createMissingWebsiteGrowthOpportunities(context.tenantId, qualification.qualified);

    await prisma.websiteGrowthDataImport.update({
      where: { id: importRecord.id },
      data: {
        status: WebsiteGrowthImportStatus.SUCCESS,
        rowCount: rows.length,
        completedAt: new Date(),
        summary: {
          rows: rows.length,
          source,
          rawCandidates: qualification.rawCount,
          clusters: qualification.clusterCount,
          qualifiedOpportunities: qualification.qualified.length,
          skippedClusters: qualification.skippedCount,
          opportunitiesCreated: opportunitySummary.createdCount,
          existingMatches: opportunitySummary.existingCount
        }
      }
    });
  } catch (error) {
    await prisma.websiteGrowthDataImport.update({
      where: { id: importRecord.id },
      data: {
        status: WebsiteGrowthImportStatus.ERROR,
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unknown import error"
      }
    });
    throw error;
  }

  revalidatePath("/website-growth");
}

export async function syncSearchConsoleAction() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);
  try {
    await syncSearchConsoleForTenant(context.tenantId);
  } catch {
    // The shared service records a tenant-scoped error import for review.
  }

  revalidatePath("/website-growth");
}

export async function syncGa4Action() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);
  try {
    await syncGa4ForTenant(context.tenantId);
  } catch {
    // The shared service records a tenant-scoped error import for review.
  }

  revalidatePath("/website-growth");
}

export async function generateWebsiteGrowthOpportunitiesAction() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);
  await syncWebsiteInboundForTenant(context.tenantId);

  revalidatePath("/website-growth");
}

export async function organizeWebsiteGrowthQueueAction() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);

  const opportunities = await prisma.websiteGrowthOpportunity.findMany({
    where: {
      tenantId: context.tenantId,
      status: WebsiteGrowthOpportunityStatus.NEW
    },
    take: 10000,
    orderBy: {
      updatedAt: "desc"
    }
  });

  const lowSignalIds = opportunities
    .filter((opportunity) => !isQualifiedOpportunity({
      action: opportunity.action,
      topic: opportunity.topic,
      primaryKeyword: opportunity.primaryKeyword,
      targetPage: opportunity.targetPage,
      sourcePage: opportunity.sourcePage,
      score: opportunity.score,
      confidence: opportunity.confidence ?? "Low",
      reason: opportunity.reason,
      recommendation: opportunity.recommendation,
      supportingKeywords: Array.isArray(opportunity.supportingKeywords) ? opportunity.supportingKeywords.filter((value): value is string => typeof value === "string") : [],
      evidence: isRecord(opportunity.evidence) ? opportunity.evidence : {}
    }))
    .map((opportunity) => opportunity.id);

  if (lowSignalIds.length > 0) {
    await prisma.websiteGrowthOpportunity.updateMany({
      where: {
        tenantId: context.tenantId,
        id: {
          in: lowSignalIds
        }
      },
      data: {
        status: WebsiteGrowthOpportunityStatus.MONITORING,
        notes: "Moved to monitoring by the SEO qualification engine because the signal was low or duplicated."
      }
    });
  }

  revalidatePath("/website-growth");
}

export async function createWeeklyWebsiteGrowthPlanAction() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);

  await createWeeklyWebsiteGrowthPlanForTenant(context.tenantId, {
    createdBy: context.userId,
    source: "manual"
  });

  revalidatePath("/website-growth");
}

export async function updateWebsiteGrowthOpportunityAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);

  const opportunityId = String(formData.get("opportunityId") ?? "");
  const status = parseOpportunityStatus(formData.get("status"));
  const notes = String(formData.get("notes") ?? "").trim();

  if (!opportunityId) {
    throw new Error("Missing opportunity ID.");
  }

  await prisma.websiteGrowthOpportunity.updateMany({
    where: {
      id: opportunityId,
      tenantId: context.tenantId
    },
    data: {
      status,
      notes,
      approvedByUserId:
        status === WebsiteGrowthOpportunityStatus.APPROVED ||
        status === WebsiteGrowthOpportunityStatus.IN_PROGRESS
          ? context.userId
          : undefined,
      publishedAt: status === WebsiteGrowthOpportunityStatus.PUBLISHED ? new Date() : undefined
    }
  });

  revalidatePath("/website-growth");
}

export async function generateWebsiteGrowthDraftAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);

  const opportunityId = String(formData.get("opportunityId") ?? "");

  if (!opportunityId) {
    throw new Error("Missing opportunity ID.");
  }

  const draft = await produceWebsiteGrowthDraft({
    tenantId: context.tenantId,
    opportunityId,
    actorUserId: context.userId,
    source: "employee"
  });
  if (!draft) throw new Error("Opportunity was not found or already has a draft.");

  revalidatePath("/website-growth");
}

export async function updateWebsiteGrowthDraftAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);

  const draftId = String(formData.get("draftId") ?? "");
  const status = parseContentDraftStatus(formData.get("status"));
  const claimsConfirmed = formData.get("claimsConfirmed") === "on";

  if (
    status === WebsiteGrowthContentDraftStatus.APPROVED ||
    status === WebsiteGrowthContentDraftStatus.BUILT ||
    status === WebsiteGrowthContentDraftStatus.PUBLISHED
  ) {
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER]);
  }

  if (!draftId) {
    throw new Error("Missing draft ID.");
  }

  const currentDraft = await prisma.websiteGrowthContentDraft.findFirst({
    where: { id: draftId, tenantId: context.tenantId },
    include: { opportunity: true }
  });

  if (!currentDraft) {
    throw new Error("Draft was not found.");
  }

  validateHumanDraftTransition(currentDraft.status, status);

  if (status === WebsiteGrowthContentDraftStatus.APPROVED) {
    const claimReview = reviewWebsiteGrowthClaims(currentDraft.draftJson);
    if (claimReview.status === "BLOCKED") {
      throw new Error("This draft contains blocked guarantee or absolute claims. Edit or regenerate it before approval.");
    }
    if (claimReview.status === "OWNER_CONFIRMATION_REQUIRED" && !claimsConfirmed) {
      throw new Error("Confirm the highlighted performance, certification, or customer-proof claims before approval.");
    }
  }

  await prisma.websiteGrowthContentDraft.updateMany({
    where: {
      id: draftId,
      tenantId: context.tenantId
    },
    data: {
      status,
      approvedByUserId: status === WebsiteGrowthContentDraftStatus.APPROVED ? context.userId : undefined,
      approvedAt: status === WebsiteGrowthContentDraftStatus.APPROVED ? new Date() : undefined,
      publishedAt: status === WebsiteGrowthContentDraftStatus.PUBLISHED ? new Date() : undefined
    }
  });

  if (status === WebsiteGrowthContentDraftStatus.APPROVED) {
    const draft = currentDraft;

    if (draft) {
      const buildPackage = buildWebsiteGrowthBuildPackage(draft);

      await prisma.websiteGrowthContentDraft.updateMany({
        where: {
          id: draftId,
          tenantId: context.tenantId
        },
        data: {
          draftJson: mergeBuildPackageIntoDraftJson(draft.draftJson, buildPackage),
          pullRequestUrl: null,
          builtUrl: null
        }
      });

      await prisma.websiteGrowthOpportunity.updateMany({
        where: {
          id: draft.opportunityId,
          tenantId: context.tenantId
        },
        data: {
          status: WebsiteGrowthOpportunityStatus.APPROVED,
          approvedByUserId: context.userId
        }
      });

      await prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "website-growth.draft.approved",
          entityType: "WebsiteGrowthContentDraft",
          entityId: draft.id,
          before: { status: currentDraft.status },
          after: {
            status: WebsiteGrowthContentDraftStatus.APPROVED,
            routePath: buildPackage.routePath,
            claimReview: buildPackage.claimReview,
            claimsConfirmed
          } as Prisma.InputJsonValue
        }
      });

      await createAndDispatchWebsiteGrowthBuildRequest({
        context,
        contentDraftId: draft.id,
        opportunityId: draft.opportunityId,
        brief: buildPackage
      });
    }
  }

  revalidatePath("/website-growth");
  revalidatePath(`/website-growth/drafts/${draftId}`);
}

export async function retryWebsiteGrowthDeveloperBuildAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER]);

  const draftId = String(formData.get("draftId") ?? "");

  if (!draftId) {
    throw new Error("Missing draft ID.");
  }

  const draft = await prisma.websiteGrowthContentDraft.findFirst({
    where: { id: draftId, tenantId: context.tenantId, status: WebsiteGrowthContentDraftStatus.APPROVED },
    select: { id: true, opportunityId: true, draftJson: true }
  });
  if (!draft) throw new Error("Only an approved Website Growth draft can start a developer build.");
  const buildPackage = readWebsiteGrowthBuildPackage(draft.draftJson);
  if (!buildPackage) throw new Error("The approved draft does not contain an immutable build package.");
  await createAndDispatchWebsiteGrowthBuildRequest({
    context,
    contentDraftId: draft.id,
    opportunityId: draft.opportunityId,
    brief: buildPackage
  });

  revalidatePath("/website-growth");
  revalidatePath(`/website-growth/drafts/${draftId}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseOpportunityStatus(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !(value in WebsiteGrowthOpportunityStatus)) {
    throw new Error("Invalid opportunity status.");
  }

  return value as WebsiteGrowthOpportunityStatus;
}

function parseContentDraftStatus(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !(value in WebsiteGrowthContentDraftStatus)) {
    throw new Error("Invalid content draft status.");
  }

  return value as WebsiteGrowthContentDraftStatus;
}

function validateHumanDraftTransition(
  current: WebsiteGrowthContentDraftStatus,
  next: WebsiteGrowthContentDraftStatus
) {
  if (current === next) return;
  const allowed: WebsiteGrowthContentDraftStatus[] =
    current === WebsiteGrowthContentDraftStatus.DRAFT
      ? [WebsiteGrowthContentDraftStatus.APPROVED, WebsiteGrowthContentDraftStatus.REJECTED]
      : current === WebsiteGrowthContentDraftStatus.REJECTED
        ? [WebsiteGrowthContentDraftStatus.DRAFT]
        : [];

  if (!allowed.includes(next)) {
    throw new Error(`Draft status cannot move from ${current} to ${next} through the review form.`);
  }
}

function normalizeRate(value: number | null) {
  if (value === null) {
    return null;
  }

  return value > 1 ? value / 100 : value;
}
