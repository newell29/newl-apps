import {
  WebsiteGrowthContentDraftStatus,
  WebsiteGrowthDataSource,
  WebsiteGrowthImportStatus,
  WebsiteGrowthOpportunityStatus,
  type Prisma
} from "@prisma/client";

import {
  fetchGa4LandingPageRows,
  fetchSearchConsoleRows,
  getWebsiteGrowthIntegrationStatus
} from "@/modules/website-growth/integrations";
import { createMissingWebsiteGrowthOpportunities } from "@/modules/website-growth/opportunity-store";
import {
  buildOpportunityCandidate,
  qualifyOpportunityCandidates,
  type OpportunityCandidate
} from "@/modules/website-growth/opportunities";
import { resolveNewlWebsiteContext } from "@/modules/website-growth/newl-website-context-scanner";
import { prisma } from "@/server/db";
import {
  SEO_RECOVERY_PERIOD_DAYS,
  buildWebsiteGrowthSearchConsoleComparisonWindows,
  buildWebsiteGrowthSeoRecoveryOpportunityCandidates,
  buildWebsiteGrowthSeoRecoverySnapshot,
  type WebsiteGrowthSeoRecoverySnapshot
} from "@/modules/website-growth/seo-recovery";

export type WebsiteGrowthEvidenceSourceResult = {
  source: "search_console" | "ga4" | "website_inbound";
  status: "success" | "error";
  rowCount: number;
  message: string;
  seoRecovery?: WebsiteGrowthSeoRecoverySnapshot;
};

export async function refreshWebsiteGrowthEvidenceForTenant(tenantId: string) {
  const sources: WebsiteGrowthEvidenceSourceResult[] = [];
  let seoRecovery: WebsiteGrowthSeoRecoverySnapshot | null = null;

  for (const refresh of [
    syncSearchConsoleForTenant,
    syncGa4ForTenant,
    syncWebsiteInboundForTenant
  ]) {
    try {
      const result = await refresh(tenantId);
      sources.push(result);
      if (result.seoRecovery) seoRecovery = result.seoRecovery;
    } catch (error) {
      sources.push({
        source: sourceForRefresh(refresh),
        status: "error",
        rowCount: 0,
        message: error instanceof Error ? error.message : "Evidence refresh failed."
      });
    }
  }

  return {
    sources,
    seoRecovery,
    successfulSourceCount: sources.filter((source) => source.status === "success").length,
    failedSourceCount: sources.filter((source) => source.status === "error").length
  };
}

export async function syncSearchConsoleForTenant(
  tenantId: string
): Promise<WebsiteGrowthEvidenceSourceResult> {
  const importRecord = await createImport(tenantId, WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_API);

  try {
    const status = getWebsiteGrowthIntegrationStatus();
    if (!status.googleSearchConsole.configured) {
      throw new Error(`Google Search Console is not configured. Missing: ${status.googleSearchConsole.missing.join(", ")}`);
    }

    const windows = buildWebsiteGrowthSearchConsoleComparisonWindows();
    const websiteContext = await resolveNewlWebsiteContext();
    const redirects = websiteContext.siteInventory?.redirects ?? [];
    const [rows, previousRows, currentPageCountryRows, previousPageCountryRows] = await Promise.all([
      fetchSearchConsoleRows({
        ...windows.current,
        dimensions: ["query", "page"]
      }),
      fetchSearchConsoleRows({
        ...windows.previous,
        dimensions: ["query", "page"]
      }),
      fetchSearchConsoleRows({
        ...windows.current,
        dimensions: ["page", "country"]
      }),
      fetchSearchConsoleRows({
        ...windows.previous,
        dimensions: ["page", "country"]
      })
    ]);
    const metricRows = [...rows.map((row) => ({ row, period: windows.current })), ...previousRows.map((row) => ({ row, period: windows.previous }))]
      .map(({ row, period }) => ({
      tenantId,
      source: WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_API,
      query: row.keys?.[0] ?? null,
      page: row.keys?.[1] ?? null,
      clicks: Math.round(row.clicks ?? 0),
      impressions: Math.round(row.impressions ?? 0),
      ctr: row.ctr ?? null,
      position: row.position ?? null,
      dateRangeStart: new Date(`${period.startDate}T00:00:00.000Z`),
      dateRangeEnd: new Date(`${period.endDate}T00:00:00.000Z`),
      raw: row
    }));

    if (metricRows.length > 0) await prisma.websiteGrowthMetric.createMany({ data: metricRows });

    const qualification = qualifyOpportunityCandidates(rows.map((row) =>
      buildOpportunityCandidate({
        topic: row.keys?.[0] ?? row.keys?.[1] ?? "Search Console opportunity",
        primaryKeyword: row.keys?.[0] ?? null,
        targetPage: row.keys?.[1] ?? null,
        sourcePage: row.keys?.[1] ?? null,
        impressions: row.impressions ?? 0,
        clicks: row.clicks ?? 0,
        position: row.position ?? null,
        source: "google_search_console_api",
        evidence: row
      })
    ));
    const opportunities = await createMissingWebsiteGrowthOpportunities(tenantId, qualification.qualified);
    const seoRecovery = buildWebsiteGrowthSeoRecoverySnapshot({
      currentPageCountryRows,
      previousPageCountryRows,
      currentQueryPageRows: rows,
      previousQueryPageRows: previousRows,
      redirects,
      currentPeriod: windows.current,
      previousPeriod: windows.previous
    });
    const recoveryCandidates = await excludeRoutesWithActiveWebsiteWork(
      tenantId,
      buildWebsiteGrowthSeoRecoveryOpportunityCandidates(seoRecovery)
    );
    const recoveryReconciliation = await reconcileSeoRecoveryOpportunityStatuses(
      tenantId,
      recoveryCandidates
    );
    const recoveryOpportunities = await createMissingWebsiteGrowthOpportunities(tenantId, recoveryCandidates);

    await completeImport(importRecord.id, rows.length, {
      dateRange: "current_28_days_vs_previous_28_days",
      currentPeriod: windows.current,
      previousPeriod: windows.previous,
      rawCandidates: qualification.rawCount,
      clusters: qualification.clusterCount,
      qualifiedOpportunities: qualification.qualified.length,
      skippedClusters: qualification.skippedCount,
      opportunitiesCreated: opportunities.createdCount,
      existingMatches: opportunities.existingCount,
      seoRecovery: {
        counts: seoRecovery.counts,
        site: seoRecovery.site,
        candidatesCreated: recoveryOpportunities.createdCount,
        existingCandidates: recoveryOpportunities.existingCount,
        reactivatedCandidates: recoveryReconciliation.reactivatedCount,
        movedToMonitoring: recoveryReconciliation.monitoringCount,
        suppressedByActiveWork: buildWebsiteGrowthSeoRecoveryOpportunityCandidates(seoRecovery).length - recoveryCandidates.length
      }
    });

    return {
      source: "search_console",
      status: "success",
      rowCount: rows.length,
      message: `Search Console compared ${rows.length} current and ${previousRows.length} previous query/page rows.`,
      seoRecovery
    };
  } catch (error) {
    await failImport(importRecord.id, error, "Unknown Search Console sync error");
    throw error;
  }
}

async function reconcileSeoRecoveryOpportunityStatuses(
  tenantId: string,
  actionableCandidates: OpportunityCandidate[]
) {
  const actionableRoutes = new Set(
    actionableCandidates
      .map((candidate) => normalizeWebsiteRoute(candidate.targetPage))
      .filter((route): route is string => Boolean(route))
  );
  const existing = await prisma.websiteGrowthOpportunity.findMany({
    where: {
      tenantId,
      status: {
        in: [
          WebsiteGrowthOpportunityStatus.NEW,
          WebsiteGrowthOpportunityStatus.REVIEWING,
          WebsiteGrowthOpportunityStatus.MONITORING
        ]
      }
    },
    select: { id: true, status: true, targetPage: true, evidence: true },
    take: 500
  });
  let reactivatedCount = 0;
  let monitoringCount = 0;

  for (const opportunity of existing) {
    if (!isSeoRecoveryEvidence(opportunity.evidence)) continue;
    const route = normalizeWebsiteRoute(opportunity.targetPage);
    const nextStatus = resolveSeoRecoveryOpportunityStatus({
      currentStatus: opportunity.status,
      actionable: Boolean(route && actionableRoutes.has(route))
    });
    if (!nextStatus) continue;
    await prisma.websiteGrowthOpportunity.updateMany({
      where: { id: opportunity.id, tenantId },
      data: { status: nextStatus }
    });
    if (nextStatus === WebsiteGrowthOpportunityStatus.NEW) reactivatedCount += 1;
    else monitoringCount += 1;
  }

  return { reactivatedCount, monitoringCount };
}

export function resolveSeoRecoveryOpportunityStatus({
  currentStatus,
  actionable
}: {
  currentStatus: WebsiteGrowthOpportunityStatus;
  actionable: boolean;
}) {
  if (actionable && currentStatus === WebsiteGrowthOpportunityStatus.MONITORING) {
    return WebsiteGrowthOpportunityStatus.NEW;
  }
  if (!actionable && (
    currentStatus === WebsiteGrowthOpportunityStatus.NEW ||
    currentStatus === WebsiteGrowthOpportunityStatus.REVIEWING
  )) {
    return WebsiteGrowthOpportunityStatus.MONITORING;
  }
  return null;
}

function isSeoRecoveryEvidence(value: unknown) {
  return readRecord(value).seoRecovery === true;
}

async function excludeRoutesWithActiveWebsiteWork(
  tenantId: string,
  candidates: OpportunityCandidate[]
) {
  if (candidates.length === 0) return candidates;
  const recentPublishedAt = daysBefore(new Date(), SEO_RECOVERY_PERIOD_DAYS * 2);
  const drafts = await prisma.websiteGrowthContentDraft.findMany({
    where: {
      tenantId,
      OR: [
        {
          status: {
            in: [
              WebsiteGrowthContentDraftStatus.DRAFT,
              WebsiteGrowthContentDraftStatus.APPROVED,
              WebsiteGrowthContentDraftStatus.BUILT
            ]
          }
        },
        {
          status: WebsiteGrowthContentDraftStatus.PUBLISHED,
          publishedAt: { gte: recentPublishedAt }
        }
      ]
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
    select: {
      proposedPath: true,
      targetPage: true,
      opportunity: {
        select: { targetPage: true, sourcePage: true }
      }
    }
  });
  const activeRoutes = new Set(
    drafts.flatMap((draft) => [
      draft.proposedPath,
      draft.targetPage,
      draft.opportunity.targetPage,
      draft.opportunity.sourcePage
    ]).map(normalizeWebsiteRoute).filter((route): route is string => Boolean(route))
  );

  return candidates.filter((candidate) => {
    const route = normalizeWebsiteRoute(candidate.targetPage);
    return !route || !activeRoutes.has(route);
  });
}

function normalizeWebsiteRoute(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    return new URL(value).pathname.toLowerCase().replace(/\/+$/g, "") || "/";
  } catch {
    const path = value.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0] ?? value;
    return (path.startsWith("/") ? path : `/${path}`).toLowerCase().replace(/\/+$/g, "") || "/";
  }
}

export async function syncGa4ForTenant(
  tenantId: string
): Promise<WebsiteGrowthEvidenceSourceResult> {
  const importRecord = await createImport(tenantId, WebsiteGrowthDataSource.GA4_API);

  try {
    const status = getWebsiteGrowthIntegrationStatus();
    if (!status.ga4.configured) {
      throw new Error(`GA4 is not configured. Missing: ${status.ga4.missing.join(", ")}`);
    }

    const endDate = new Date();
    const startDate = daysBefore(endDate, 28);
    const rows = await fetchGa4LandingPageRows({
      startDate: formatApiDate(startDate),
      endDate: formatApiDate(endDate)
    });

    if (rows.length > 0) {
      await prisma.websiteGrowthMetric.createMany({
        data: rows.map((row) => ({
          tenantId,
          source: WebsiteGrowthDataSource.GA4_API,
          page: row.page,
          sessions: row.sessions,
          engagedSessions: row.engagedSessions,
          engagementRate: row.engagementRate,
          eventCount: row.eventCount,
          dateRangeStart: startDate,
          dateRangeEnd: endDate,
          raw: row.raw as Prisma.InputJsonValue
        }))
      });
    }

    const ga4ByPage = new Map(rows.map((row) => [normalizePagePath(row.page), row]));
    const refreshable = await prisma.websiteGrowthOpportunity.findMany({
      where: {
        tenantId,
        status: {
          in: [
            WebsiteGrowthOpportunityStatus.NEW,
            WebsiteGrowthOpportunityStatus.REVIEWING,
            WebsiteGrowthOpportunityStatus.MONITORING
          ]
        }
      },
      select: { id: true, targetPage: true, sourcePage: true, evidence: true },
      take: 500
    });
    const updates: Array<ReturnType<typeof prisma.websiteGrowthOpportunity.update>> = [];

    for (const opportunity of refreshable) {
      const ga4 = ga4ByPage.get(normalizePagePath(opportunity.targetPage ?? opportunity.sourcePage));
      if (!ga4) continue;
      updates.push(prisma.websiteGrowthOpportunity.update({
        where: { id: opportunity.id },
        data: {
          evidence: {
            ...readRecord(opportunity.evidence),
            ga4: {
              sessions: ga4.sessions,
              engagedSessions: ga4.engagedSessions,
              engagementRate: ga4.engagementRate,
              eventCount: ga4.eventCount,
              dateRangeStart: formatApiDate(startDate),
              dateRangeEnd: formatApiDate(endDate)
            }
          } as Prisma.InputJsonValue
        }
      }));
    }
    if (updates.length > 0) await prisma.$transaction(updates);

    await completeImport(importRecord.id, rows.length, {
      dateRange: "last_28_days",
      totalSessions: rows.reduce((sum, row) => sum + row.sessions, 0),
      opportunitiesEnriched: updates.length,
      note: "GA4 supports landing-page engagement. First-party forms remain the lead-count source of truth."
    });

    return {
      source: "ga4",
      status: "success",
      rowCount: rows.length,
      message: `GA4 refreshed ${rows.length} landing-page rows.`
    };
  } catch (error) {
    await failImport(importRecord.id, error, "Unknown GA4 sync error");
    throw error;
  }
}

export async function syncWebsiteInboundForTenant(
  tenantId: string
): Promise<WebsiteGrowthEvidenceSourceResult> {
  const importRecord = await createImport(tenantId, WebsiteGrowthDataSource.INTERNAL_APP_DATA);

  try {
    const [submissions, companies, contacts, leads, creditChecks] = await Promise.all([
      prisma.websiteInboundSubmission.findMany({
        where: { tenantId, formType: { not: "account_setup" } },
        orderBy: { createdAt: "desc" },
        select: { pageUrl: true, primaryNeed: true },
        take: 1000
      }),
      prisma.company.count({ where: { tenantId } }),
      prisma.contact.count({ where: { tenantId } }),
      prisma.lead.count({ where: { tenantId } }),
      prisma.creditCheck.count({ where: { tenantId } })
    ]);
    const byPage = new Map<string, number>();
    const byNeed = new Map<string, number>();

    for (const submission of submissions) {
      if (submission.pageUrl) byPage.set(submission.pageUrl, (byPage.get(submission.pageUrl) ?? 0) + 1);
      if (submission.primaryNeed) byNeed.set(submission.primaryNeed, (byNeed.get(submission.primaryNeed) ?? 0) + 1);
    }

    const candidates: OpportunityCandidate[] = [
      ...Array.from(byPage.entries()).map(([pageUrl, leadCount]) => buildOpportunityCandidate({
        topic: pageUrlToTopic(pageUrl),
        targetPage: pageUrl,
        sourcePage: pageUrl,
        leadCount,
        source: "website_inbound",
        evidence: { pageUrl, leadCount }
      })),
      ...Array.from(byNeed.entries()).map(([primaryNeed, leadCount]) => buildOpportunityCandidate({
        topic: primaryNeed,
        primaryKeyword: primaryNeed,
        leadCount,
        source: "website_inbound_primary_need",
        evidence: { primaryNeed, leadCount }
      }))
    ];
    const qualification = qualifyOpportunityCandidates(candidates);
    const opportunities = await createMissingWebsiteGrowthOpportunities(tenantId, qualification.qualified);

    await completeImport(importRecord.id, submissions.length, {
      inboundSubmissions: submissions.length,
      companies,
      contacts,
      pipelineRecords: leads,
      creditChecks,
      rawCandidates: qualification.rawCount,
      clusters: qualification.clusterCount,
      qualifiedOpportunities: qualification.qualified.length,
      skippedClusters: qualification.skippedCount,
      opportunitiesCreated: opportunities.createdCount,
      existingMatches: opportunities.existingCount,
      privacy: "Only aggregate page and primary-need counts were used; no contact details were included."
    });

    return {
      source: "website_inbound",
      status: "success",
      rowCount: submissions.length,
      message: `Website forms refreshed ${submissions.length} sanitized submissions.`
    };
  } catch (error) {
    await failImport(importRecord.id, error, "Unknown internal data sync error");
    throw error;
  }
}

function sourceForRefresh(refresh: (tenantId: string) => Promise<WebsiteGrowthEvidenceSourceResult>) {
  if (refresh === syncSearchConsoleForTenant) return "search_console" as const;
  if (refresh === syncGa4ForTenant) return "ga4" as const;
  return "website_inbound" as const;
}

function createImport(tenantId: string, source: WebsiteGrowthDataSource) {
  return prisma.websiteGrowthDataImport.create({
    data: {
      tenantId,
      source,
      status: WebsiteGrowthImportStatus.RUNNING,
      startedAt: new Date()
    }
  });
}

function completeImport(id: string, rowCount: number, summary: Prisma.InputJsonObject) {
  return prisma.websiteGrowthDataImport.update({
    where: { id },
    data: {
      status: WebsiteGrowthImportStatus.SUCCESS,
      rowCount,
      completedAt: new Date(),
      summary
    }
  });
}

function failImport(id: string, error: unknown, fallback: string) {
  return prisma.websiteGrowthDataImport.update({
    where: { id },
    data: {
      status: WebsiteGrowthImportStatus.ERROR,
      completedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : fallback
    }
  });
}

function daysBefore(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() - days);
  return result;
}

function formatApiDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function pageUrlToTopic(pageUrl: string) {
  try {
    const parsed = new URL(pageUrl);
    const segment = parsed.pathname.split("/").filter(Boolean).at(-1) ?? parsed.pathname;
    return segment.replaceAll("-", " ");
  } catch {
    return pageUrl.replace(/^https?:\/\//, "").replaceAll("-", " ");
  }
}

function normalizePagePath(value?: string | null) {
  if (!value) return "/";
  try {
    return new URL(value, "https://www.newlgroup.com").pathname.replace(/\/$/, "") || "/";
  } catch {
    return value.split("?")[0]?.replace(/\/$/, "") || "/";
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
