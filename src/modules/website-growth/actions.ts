"use server";

import {
  ModuleKey,
  WebsiteGrowthDataSource,
  WebsiteGrowthImportStatus,
  WebsiteGrowthOpportunityStatus,
  type Prisma
} from "@prisma/client";
import { revalidatePath } from "next/cache";

import { parseDelimitedRows, readNumber, readString } from "@/modules/website-growth/csv";
import { fetchSearchConsoleRows, getWebsiteGrowthIntegrationStatus } from "@/modules/website-growth/integrations";
import {
  buildCandidatesFromMetricRows,
  buildOpportunityCandidate,
  isQualifiedOpportunity,
  qualifyOpportunityCandidates,
  type OpportunityCandidate
} from "@/modules/website-growth/opportunities";
import { parseWebsiteGrowthDataSource } from "@/modules/website-growth/queries";
import { createWeeklyWebsiteGrowthPlanForTenant } from "@/modules/website-growth/weekly-plan";
import { prisma } from "@/server/db";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
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
    const opportunitySummary = await createMissingOpportunities(context.tenantId, qualification.qualified);

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

  const importRecord = await prisma.websiteGrowthDataImport.create({
    data: {
      tenantId: context.tenantId,
      source: WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_API,
      status: WebsiteGrowthImportStatus.RUNNING,
      startedAt: new Date()
    }
  });

  try {
    const status = getWebsiteGrowthIntegrationStatus();

    if (!status.googleSearchConsole.configured) {
      throw new Error(`Google Search Console is not configured. Missing: ${status.googleSearchConsole.missing.join(", ")}`);
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 28);
    const rows = await fetchSearchConsoleRows({
      startDate: formatApiDate(startDate),
      endDate: formatApiDate(endDate),
      dimensions: ["query", "page"]
    });

    const metricRows = rows.map((row) => ({
      tenantId: context.tenantId,
      source: WebsiteGrowthDataSource.GOOGLE_SEARCH_CONSOLE_API,
      query: row.keys?.[0] ?? null,
      page: row.keys?.[1] ?? null,
      clicks: Math.round(row.clicks ?? 0),
      impressions: Math.round(row.impressions ?? 0),
      ctr: row.ctr ?? null,
      position: row.position ?? null,
      dateRangeStart: startDate,
      dateRangeEnd: endDate,
      raw: row
    }));

    if (metricRows.length > 0) {
      await prisma.websiteGrowthMetric.createMany({ data: metricRows });
    }

    const candidates = rows.map((row) =>
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
      );
    const qualification = qualifyOpportunityCandidates(candidates);
    const opportunitySummary = await createMissingOpportunities(context.tenantId, qualification.qualified);

    await prisma.websiteGrowthDataImport.update({
      where: { id: importRecord.id },
      data: {
        status: WebsiteGrowthImportStatus.SUCCESS,
        rowCount: rows.length,
        completedAt: new Date(),
        summary: {
          rows: rows.length,
          dateRange: "last_28_days",
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
        errorMessage: error instanceof Error ? error.message : "Unknown Search Console sync error"
      }
    });
  }

  revalidatePath("/website-growth");
}

export async function generateWebsiteGrowthOpportunitiesAction() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);

  const importRecord = await prisma.websiteGrowthDataImport.create({
    data: {
      tenantId: context.tenantId,
      source: WebsiteGrowthDataSource.INTERNAL_APP_DATA,
      status: WebsiteGrowthImportStatus.RUNNING,
      startedAt: new Date()
    }
  });

  try {
    const [submissions, companies, contacts, leads, creditChecks] = await Promise.all([
      prisma.websiteInboundSubmission.findMany({
        where: {
          tenantId: context.tenantId,
          formType: {
            not: "account_setup"
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1000
      }),
      prisma.company.count({ where: { tenantId: context.tenantId } }),
      prisma.contact.count({ where: { tenantId: context.tenantId } }),
      prisma.lead.count({ where: { tenantId: context.tenantId } }),
      prisma.creditCheck.count({ where: { tenantId: context.tenantId } })
    ]);

    const byPage = new Map<string, number>();
    const byNeed = new Map<string, number>();

    for (const submission of submissions) {
      if (submission.pageUrl) {
        byPage.set(submission.pageUrl, (byPage.get(submission.pageUrl) ?? 0) + 1);
      }

      if (submission.primaryNeed) {
        byNeed.set(submission.primaryNeed, (byNeed.get(submission.primaryNeed) ?? 0) + 1);
      }
    }

    const candidates: OpportunityCandidate[] = [
      ...Array.from(byPage.entries()).map(([pageUrl, leadCount]) =>
        buildOpportunityCandidate({
          topic: pageUrlToTopic(pageUrl),
          targetPage: pageUrl,
          sourcePage: pageUrl,
          leadCount,
          source: "website_inbound",
          evidence: { pageUrl, leadCount }
        })
      ),
      ...Array.from(byNeed.entries()).map(([primaryNeed, leadCount]) =>
        buildOpportunityCandidate({
          topic: primaryNeed,
          primaryKeyword: primaryNeed,
          leadCount,
          source: "website_inbound_primary_need",
          evidence: { primaryNeed, leadCount }
        })
      )
    ];

    const qualification = qualifyOpportunityCandidates(candidates);
    const opportunitySummary = await createMissingOpportunities(context.tenantId, qualification.qualified);

    await prisma.websiteGrowthDataImport.update({
      where: { id: importRecord.id },
      data: {
        status: WebsiteGrowthImportStatus.SUCCESS,
        rowCount: submissions.length,
        completedAt: new Date(),
        summary: {
          inboundSubmissions: submissions.length,
          companies,
          contacts,
          pipelineRecords: leads,
          creditChecks,
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
        errorMessage: error instanceof Error ? error.message : "Unknown internal data sync error"
      }
    });
    throw error;
  }

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

async function createMissingOpportunities(tenantId: string, candidates: OpportunityCandidate[]) {
  let createdCount = 0;
  let existingCount = 0;

  for (const candidate of candidates) {
    if (!candidate.topic) {
      continue;
    }

    const existing = await prisma.websiteGrowthOpportunity.findFirst({
      where: {
        tenantId,
        topic: candidate.topic,
        targetPage: candidate.targetPage,
        action: candidate.action
      },
      select: {
        id: true
      }
    });

    if (existing) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseOpportunityStatus(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !(value in WebsiteGrowthOpportunityStatus)) {
    throw new Error("Invalid opportunity status.");
  }

  return value as WebsiteGrowthOpportunityStatus;
}

function normalizeRate(value: number | null) {
  if (value === null) {
    return null;
  }

  return value > 1 ? value / 100 : value;
}

function formatApiDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function pageUrlToTopic(pageUrl: string) {
  try {
    const parsed = new URL(pageUrl);
    const path = parsed.pathname;
    const segment = path.split("/").filter(Boolean).at(-1) ?? path;

    return segment.replaceAll("-", " ");
  } catch {
    return pageUrl.replace(/^https?:\/\//, "").replaceAll("-", " ");
  }
}
