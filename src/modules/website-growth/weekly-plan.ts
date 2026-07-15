import {
  ModuleKey,
  WebsiteGrowthImportStatus,
  WebsiteGrowthOpportunityStatus,
  type WebsiteGrowthOpportunity
} from "@prisma/client";

import { weeklyContentRecommendations, type WeeklyContentLane } from "@/modules/website-growth/opportunities";
import { prisma } from "@/server/db";

export type WeeklyWebsiteGrowthPlanResult = {
  tenantId: string;
  reviewedCount: number;
  selectedCount: number;
  laneCounts: Record<WeeklyContentLane, number>;
};

export async function createWeeklyWebsiteGrowthPlanForTenant(
  tenantId: string,
  options: {
    createdBy?: string;
    source?: "manual" | "cron";
  } = {}
): Promise<WeeklyWebsiteGrowthPlanResult> {
  const candidates = await prisma.websiteGrowthOpportunity.findMany({
    where: {
      tenantId,
      status: WebsiteGrowthOpportunityStatus.NEW,
      action: {
        in: weeklyContentRecommendations.flatMap((lane) => lane.actions)
      }
    },
    orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    take: 500
  });

  const { selected, laneCounts } = selectWeeklyWebsiteGrowthCandidates(candidates);

  for (const opportunity of selected) {
    const planNote = [
      `Weekly SEO approval plan (${getWeekStamp()})`,
      `Lane: ${opportunity.weeklyLabel}`,
      `Recommended cadence limit: ${getLaneLimit(opportunity.weeklyLane)} per week`,
      `Source: ${options.source ?? "manual"}`,
      options.createdBy ? `Prepared by: ${options.createdBy}` : null
    ]
      .filter(Boolean)
      .join(" | ");

    await prisma.websiteGrowthOpportunity.update({
      where: { id: opportunity.id },
      data: {
        status: WebsiteGrowthOpportunityStatus.REVIEWING,
        notes: opportunity.notes ? `${opportunity.notes}\n${planNote}` : planNote
      }
    });
  }

  await prisma.websiteGrowthDataImport.create({
    data: {
      tenantId,
      source: "INTERNAL_APP_DATA",
      status: WebsiteGrowthImportStatus.SUCCESS,
      rowCount: candidates.length,
      startedAt: new Date(),
      completedAt: new Date(),
      summary: {
        runType: "weekly_seo_approval_plan",
        reviewedCount: candidates.length,
        selectedCount: selected.length,
        laneCounts,
        source: options.source ?? "manual"
      }
    }
  });

  return {
    tenantId,
    reviewedCount: candidates.length,
    selectedCount: selected.length,
    laneCounts
  };
}

export function selectWeeklyWebsiteGrowthCandidates(candidates: WebsiteGrowthOpportunity[]) {
  const selected: Array<WebsiteGrowthOpportunity & { weeklyLane: WeeklyContentLane; weeklyLabel: string }> = [];
  const laneCounts = emptyLaneCounts();
  const selectedKeys = new Set<string>();

  for (const lane of weeklyContentRecommendations) {
    const laneCandidates = candidates
      .filter((candidate) => lane.actions.includes(candidate.action))
      .filter((candidate) => !selected.some((selectedCandidate) => selectedCandidate.id === candidate.id));

    for (const candidate of laneCandidates) {
      const key = getWeeklySelectionKey(candidate, lane.lane);

      if (selectedKeys.has(key)) {
        continue;
      }

      selected.push({
        ...candidate,
        weeklyLane: lane.lane,
        weeklyLabel: lane.label
      });
      selectedKeys.add(key);
      laneCounts[lane.lane] += 1;

      if (laneCounts[lane.lane] >= lane.publishLimit) {
        break;
      }
    }
  }

  return {
    selected,
    laneCounts
  };
}

export async function createWeeklyWebsiteGrowthPlansForEnabledTenants() {
  const tenantAccess = await prisma.tenantModuleAccess.findMany({
    where: {
      enabled: true,
      module: {
        key: ModuleKey.WEBSITE_GROWTH
      }
    },
    select: {
      tenantId: true
    }
  });

  const results: WeeklyWebsiteGrowthPlanResult[] = [];

  for (const access of tenantAccess) {
    results.push(await createWeeklyWebsiteGrowthPlanForTenant(access.tenantId, { source: "cron" }));
  }

  return results;
}

function getWeeklySelectionKey(candidate: WebsiteGrowthOpportunity, lane: WeeklyContentLane) {
  return `${lane}:${normalizeReviewPage(candidate.targetPage ?? candidate.sourcePage ?? candidate.topic)}`;
}

function normalizeReviewPage(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.pathname.replace(/\/+$/g, "") || "/";
  } catch {
    return value
      .toLowerCase()
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/\/+$/g, "")
      .trim();
  }
}

function emptyLaneCounts(): Record<WeeklyContentLane, number> {
  return {
    CORE_PAGE: 0,
    SUPPORTING_CONTENT: 0,
    QUICK_OPTIMIZATION: 0
  };
}

function getLaneLimit(lane: WeeklyContentLane) {
  return weeklyContentRecommendations.find((recommendation) => recommendation.lane === lane)?.publishLimit ?? 0;
}

function getWeekStamp() {
  const now = new Date();
  const firstDay = new Date(now);
  firstDay.setDate(now.getDate() - now.getDay() + 1);

  return firstDay.toISOString().slice(0, 10);
}
