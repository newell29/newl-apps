import {
  JobStatus,
  WebsiteGrowthBacklinkStatus,
  WebsiteGrowthContentDraftStatus,
  WebsiteGrowthContentDraftSource,
  WebsiteGrowthDataSource,
  WebsiteGrowthImportStatus,
  WebsiteGrowthOpportunityStatus,
  type WebsiteGrowthContentDraft,
  type Prisma
} from "@prisma/client";

import type { WebsiteGrowthContentDraftPayload } from "@/modules/website-growth/content-drafts";
import {
  BACKLINK_DISCOVERY_DOMAIN_LIMIT,
  BACKLINK_DISCOVERY_FETCH_LIMIT,
  BACKLINK_DISCOVERY_FINALIST_LIMIT,
  BACKLINK_DISCOVERY_PAGES_PER_DOMAIN,
  BACKLINK_DISCOVERY_PROMOTION_LIMIT,
  BACKLINK_DISCOVERY_QUERY_LIMIT,
  BACKLINK_DISCOVERY_RESULTS_PER_QUERY,
  buildWebsiteGrowthBacklinkDiscoveryQueries,
  buildWebsiteGrowthDiscoveryUrlHash,
  canonicalizeWebsiteGrowthDiscoveryUrl
} from "@/modules/website-growth/backlink-discovery";
import {
  buildWebsiteGrowthBacklinkTeamsLines,
  MAX_ACTIVE_BACKLINK_QUEUE,
  MAX_BACKLINK_PROSPECTS_PER_RUN,
  parseWebsiteGrowthBacklinkReview,
  persistWebsiteGrowthBacklinkReview,
  type WebsiteGrowthBacklinkReview
} from "@/modules/website-growth/backlinks";
import { refreshWebsiteGrowthEvidenceForTenant } from "@/modules/website-growth/evidence-refresh";
import {
  buildWebsiteGrowthKeywordAdditions,
  buildWebsiteGrowthKeywordImportReport,
  buildWebsiteGrowthPerformanceReport,
  type WebsiteGrowthSemrushTrackedKeyword,
  type WebsiteGrowthSemrushTrackingSnapshot
} from "@/modules/website-growth/keyword-tracking";
import { buildWebsiteGrowthReportDownloadLinks } from "@/modules/website-growth/report-download";
import { resolveNewlWebsiteContext } from "@/modules/website-growth/newl-website-context-scanner";
import { isWebsiteGrowthQuestionOpportunity } from "@/modules/website-growth/opportunities";
import {
  SEO_RECOVERY_PACKET_LIMIT,
  isWebsiteGrowthSeoRecoveryOpportunity,
  type WebsiteGrowthSeoRecoverySnapshot
} from "@/modules/website-growth/seo-recovery";
import {
  safeSyncWebsiteGrowthSemrushScheduledReports,
  type SemrushScheduledReportSyncResult,
  type SemrushScheduledReportType
} from "@/modules/website-growth/semrush-mail-reports";
import { createWeeklyWebsiteGrowthPlanForTenant } from "@/modules/website-growth/weekly-plan";
import { prisma } from "@/server/db";

const JOB_TYPE = "WEBSITE_GROWTH_SCOUT_WEEKLY";
const CHECK_IN_JOB_TYPE = "WEBSITE_GROWTH_SCOUT_WEEKDAY_CHECKIN";
const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_REASONING_EFFORT = "high";
const DEFAULT_MAX_CANDIDATES = 6;
const MAX_SEMRUSH_ROWS = 200;
const RUN_LOCK_MS = 3 * 60 * 60 * 1000;
const SEMRUSH_CACHE_TTL_DAYS = 8;
const SEMRUSH_CACHE_TTL_MS = SEMRUSH_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

export type WebsiteGrowthScoutResearchScope = "WEEKLY" | "MONTHLY";
export type WebsiteGrowthSemrushSource = "LIVE_MCP" | "CACHE" | "UNAVAILABLE";

export type WebsiteGrowthSemrushCache = {
  available: boolean;
  fresh: boolean;
  observedAt: string | null;
  expiresAt: string | null;
  ageDays: number | null;
  tracking: WebsiteGrowthSemrushTrackingSnapshot | null;
  reports: Array<{
    reportType: SemrushScheduledReportType;
    subject: string;
    observedAt: string;
    metrics: Record<string, number>;
    excerpt: string;
  }>;
};

export type WebsiteGrowthSemrushEvidence = {
  opportunityId: string;
  keyword: string;
  page: string | null;
  position: number | null;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  competitorDomain: string | null;
  opportunityType: string;
  note: string;
};

export type WebsiteGrowthScoutCompletion = {
  runSummary: string;
  semrush: {
    queried: boolean;
    source: WebsiteGrowthSemrushSource;
    observedAt: string;
    summary: string;
    rows: WebsiteGrowthSemrushEvidence[];
    tracking: WebsiteGrowthSemrushTrackingSnapshot;
  };
  backlinks: WebsiteGrowthBacklinkReview;
  drafts: Array<{
    opportunityId: string;
    recommendationSummary: string;
    draft: WebsiteGrowthContentDraftPayload;
  }>;
};

export function selectWebsiteGrowthScoutPacketCandidates<
  T extends {
    id: string;
    topic?: string | null;
    primaryKeyword?: string | null;
    targetPage?: string | null;
    evidence?: unknown;
  }
>(candidates: T[], maxCandidates: number) {
  const limit = Math.max(1, maxCandidates);
  const recoveryLimit = Math.min(SEO_RECOVERY_PACKET_LIMIT, limit);
  const questionLimit = Math.min(2, limit);
  const recoveryCandidates = candidates
    .filter(isWebsiteGrowthSeoRecoveryOpportunity)
    .slice(0, recoveryLimit);
  const selectedIds = new Set(recoveryCandidates.map((candidate) => candidate.id));
  const questionCandidates = candidates
    .filter((candidate) => !selectedIds.has(candidate.id) && isWebsiteGrowthQuestionOpportunity(candidate))
    .slice(0, Math.min(questionLimit, limit - recoveryCandidates.length));
  for (const candidate of questionCandidates) selectedIds.add(candidate.id);

  return [
    ...recoveryCandidates,
    ...questionCandidates,
    ...candidates.filter((candidate) => !selectedIds.has(candidate.id))
  ].slice(0, limit);
}

export async function prepareWebsiteGrowthScoutRun({
  tenantId,
  tenantSlug,
  researchScope = "WEEKLY"
}: {
  tenantId: string;
  tenantSlug: string;
  researchScope?: WebsiteGrowthScoutResearchScope;
}) {
  const active = await prisma.automationJobRun.findFirst({
    where: {
      tenantId,
      jobType: JOB_TYPE,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      startedAt: { gte: new Date(Date.now() - RUN_LOCK_MS) }
    },
    orderBy: { startedAt: "desc" }
  });

  if (active) {
    return {
      state: "already_running" as const,
      runId: active.id,
      message: "A Website Growth Scout run is already active for this tenant."
    };
  }

  const model = process.env.WEBSITE_GROWTH_SCOUT_CODEX_MODEL?.trim() || DEFAULT_MODEL;
  const reasoningEffort = normalizeReasoningEffort(process.env.WEBSITE_GROWTH_SCOUT_CODEX_REASONING_EFFORT);
  const maxCandidates = normalizeMaxCandidates(process.env.WEBSITE_GROWTH_SCOUT_MAX_CANDIDATES);
  const job = await prisma.automationJobRun.create({
    data: {
      tenantId,
      jobType: JOB_TYPE,
      status: JobStatus.RUNNING,
      input: {
        version: 2,
        tenantSlug,
        model,
        reasoningEffort,
        maxCandidates,
        researchScope,
        semrushTransport: "official_mcp_oauth"
      }
    }
  });

  try {
    const evidenceRefresh = await refreshWebsiteGrowthEvidenceForTenant(tenantId);
    const semrushMailSync = await safeSyncWebsiteGrowthSemrushScheduledReports({ tenantId });
    const weeklyPlan = await createWeeklyWebsiteGrowthPlanForTenant(tenantId, { source: "cron" });
    const backlinkDiscovery = buildWebsiteGrowthBacklinkDiscoveryQueries();
    const [opportunityPool, opportunityStatusCounts, semrushCache] = await Promise.all([
      prisma.websiteGrowthOpportunity.findMany({
        where: {
          tenantId,
          status: WebsiteGrowthOpportunityStatus.REVIEWING,
          contentDrafts: { none: {} }
        },
        orderBy: [{ score: "desc" }, { updatedAt: "asc" }],
        take: Math.max(24, maxCandidates * 4),
        select: {
          id: true,
          action: true,
          topic: true,
          primaryKeyword: true,
          targetPage: true,
          sourcePage: true,
          score: true,
          confidence: true,
          reason: true,
          recommendation: true,
          supportingKeywords: true,
          evidence: true
        }
      }),
      prisma.websiteGrowthOpportunity.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true }
      }),
      loadWebsiteGrowthSemrushCache(tenantId)
    ]);
    const opportunities = selectWebsiteGrowthScoutPacketCandidates(
      opportunityPool,
      maxCandidates
    );
    const candidateIds = opportunities.map((opportunity) => opportunity.id);
    const questionCandidateIds = opportunities
      .filter(isWebsiteGrowthQuestionOpportunity)
      .map((opportunity) => opportunity.id);
    const recoveryCandidateIds = opportunities
      .filter(isWebsiteGrowthSeoRecoveryOpportunity)
      .map((opportunity) => opportunity.id);
    const researchInventory = Object.fromEntries(
      opportunityStatusCounts.map((row) => [row.status, row._count._all])
    );
    const [websiteContext, decisionHistory, existingBacklinkProspects] = await Promise.all([
      resolveNewlWebsiteContext(),
      prisma.websiteGrowthContentDraft.findMany({
        where: {
          tenantId,
          status: {
            in: [
              WebsiteGrowthContentDraftStatus.APPROVED,
              WebsiteGrowthContentDraftStatus.REJECTED,
              WebsiteGrowthContentDraftStatus.BUILT,
              WebsiteGrowthContentDraftStatus.PUBLISHED
            ]
          }
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          status: true,
          title: true,
          contentType: true,
          proposedPath: true,
          approvedAt: true,
          publishedAt: true,
          opportunity: {
            select: { action: true, topic: true, primaryKeyword: true, targetPage: true }
          }
        }
      }),
      prisma.websiteGrowthBacklinkOpportunity.findMany({
        where: { tenantId },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: {
          status: true,
          category: true,
          sourceDomain: true,
          sourceUrl: true,
          targetPage: true,
          qualityScore: true,
          lastSeenAt: true,
          liveUrl: true
        }
      })
    ]);
    const packet = {
      version: 2,
      runId: job.id,
      tenantSlug,
      model,
      reasoningEffort,
      semrush: {
        transport: "official_mcp_oauth",
        serverUrl: "https://mcp.semrush.com/v1/mcp",
        readOnly: true,
        maxRows: MAX_SEMRUSH_ROWS,
        researchScope,
        cache: semrushCache,
        scheduledReportSync: semrushMailSync,
        requiredChecks: [
          "Organic positions and landing pages relevant to each candidate",
          researchScope === "MONTHLY"
            ? "Monthly weak or missing keyword gaps against no more than four relevant competitors"
            : "Use the cached monthly competitor-gap evidence unless a candidate-specific check is necessary",
          "Declined or lost keywords where the data is available",
          "Search volume, keyword difficulty, intent, and ranking URL",
          "Question-style keyword variants and answer gaps relevant to each candidate, including definition, process, cost, comparison, selection, and capability questions",
          "New and lost Newl backlinks only when the optional SEMrush evidence is available; do not use SEMrush for the primary backlink discovery funnel"
        ]
      },
      answerOpportunityProgram: {
        candidateIds: questionCandidateIds,
        rules: [
          "Treat questionOpportunity evidence as a dedicated customer-question and AI-answer lane.",
          "Map each question to the best existing service, location, industry, freight, or resource page before proposing a new URL.",
          "Prefer a concise answer-first section on an authoritative existing page. Use an FAQ only when the same visible answer is useful to visitors.",
          "Recommend a dedicated guide only when the question has distinct, substantial intent that an existing page cannot satisfy without becoming unfocused.",
          "Reject thin question pages, duplicate intent, keyword-swapped pages, and unsupported FAQ or structured-data markup.",
          "Make answers easy to extract and cite with a descriptive heading, direct opening answer, supporting operational detail, relevant internal links, and a clear conversion path.",
          "Do not claim that a change guarantees an AI citation, AI Overview, ranking, lead, or referral."
        ]
      },
      seoRecoveryProgram: {
        candidateIds: recoveryCandidateIds,
        snapshot: evidenceRefresh.seoRecovery,
        rules: [
          "Treat seoRecovery evidence as a dedicated migration-recovery lane and review it before ordinary content ideas.",
          "Evaluate the combined legacy URL and destination route, not either URL in isolation.",
          "Inspect redirect handling, canonical metadata, sitemap inclusion, internal links, retained useful content, and query intent in the current website repository.",
          "Do not recreate thin legacy pages merely to recover impressions. Prefer the strongest existing commercial destination.",
          "Do not propose duplicate work when an approved, building, preview-ready, or recently published brief already covers the destination.",
          "Prioritize qualified clicks, country relevance, engagement, and leads over raw impression recovery."
        ]
      },
      backlinkProgram: {
        maxReturnedProspects: MAX_BACKLINK_PROSPECTS_PER_RUN,
        maxActiveQueue: MAX_ACTIVE_BACKLINK_QUEUE,
        existingProspects: existingBacklinkProspects,
        rules: [
          "Review broadly but return only the strongest actionable prospects; never return raw backlink rows.",
          "Deduplicate against existing prospects and domains already linking to the proposed target page.",
          "Reject link farms, automated-link schemes, irrelevant directories, high-spam-risk sites, and paid dofollow offers.",
          "Score relevance and quality from 0 to 100. Newl Apps enforces a minimum score of 60 and rejects HIGH spam risk.",
          "Paid placements are research-only. They require a separate human spending decision and must not be represented as ranking-link purchases.",
          "Prefer link reclamation, legitimate directories and associations, partners, resource pages, useful content contributions, and evidence-led digital PR."
        ]
      },
      backlinkDiscovery: {
        provider: "BRAVE",
        classifier: "QWEN_LOCAL",
        finalReviewer: "CODEX",
        rotation: backlinkDiscovery.rotation,
        queries: backlinkDiscovery.queries,
        limits: {
          queries: BACKLINK_DISCOVERY_QUERY_LIMIT,
          resultsPerQuery: BACKLINK_DISCOVERY_RESULTS_PER_QUERY,
          uniqueDomains: BACKLINK_DISCOVERY_DOMAIN_LIMIT,
          fullPageFetches: BACKLINK_DISCOVERY_FETCH_LIMIT,
          pagesPerDomain: BACKLINK_DISCOVERY_PAGES_PER_DOMAIN,
          finalistsForCodex: BACKLINK_DISCOVERY_FINALIST_LIMIT,
          promotionsToNewlApps: BACKLINK_DISCOVERY_PROMOTION_LIMIT
        },
        rules: [
          "Search results are registered in the tenant-scoped Scout job ledger before Qwen reviews them.",
          "Previously seen canonical URLs are excluded before page retrieval and cannot be re-added as new opportunities.",
          "Never crawl recursively or follow arbitrary page links.",
          "Qwen performs advisory bulk triage. Codex makes the final promotion decision.",
          "Raw results and rejected URLs remain in the automation ledger and are not shown in the normal Backlinks workspace."
        ]
      },
      evidenceRefresh,
      weeklyPlan,
      researchInventory,
      opportunities,
      decisionHistory,
      websiteContext: {
        ...websiteContext,
        siteInventory: websiteContext.siteInventory
          ? { ...websiteContext.siteInventory, repoPath: null }
          : undefined
      },
      rules: {
        noApproval: true,
        noRepositoryWrites: true,
        noPersonalData: true,
        claims: [
          "Do not create guarantees or absolute performance claims.",
          "Flag numerical, certification, affiliation, and customer-proof claims for owner confirmation.",
          "Prefer supported capability language when evidence is unavailable."
        ]
      }
    };

    await prisma.automationJobRun.update({
      where: { id: job.id },
      data: {
        input: {
          version: 2,
          tenantSlug,
          model,
          reasoningEffort,
          maxCandidates,
          researchScope,
          semrushTransport: "official_mcp_oauth",
          candidateIds,
          questionCandidateIds,
          recoveryCandidateIds,
          semrushCacheObservedAt: semrushCache.observedAt
        },
        output: {
          phase: "AWAITING_CODEX",
          evidenceRefresh,
          weeklyPlan,
          researchInventory,
          researchSignalCount: opportunityStatusCounts.reduce((sum, row) => sum + row._count._all, 0),
          candidateCount: candidateIds.length,
          questionCandidateCount: questionCandidateIds.length,
          recoveryCandidateCount: recoveryCandidateIds.length,
          semrushCache: {
            available: semrushCache.available,
            fresh: semrushCache.fresh,
            observedAt: semrushCache.observedAt,
            expiresAt: semrushCache.expiresAt,
            ageDays: semrushCache.ageDays,
            reportCount: semrushCache.reports.length
          },
          semrushMailSync,
          preparedAt: new Date().toISOString()
        }
      }
    });

    return {
      state: "ready" as const,
      runId: job.id,
      packet
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website Growth Scout preparation failed.";
    await prisma.automationJobRun.update({
      where: { id: job.id },
      data: {
        status: JobStatus.ERROR,
        finishedAt: new Date(),
        output: { phase: "PREPARE_FAILED" },
        errorMessage: message
      }
    });
    throw error;
  }
}

export async function runWebsiteGrowthScoutWeekdayCheckIn({
  tenantId,
  reviewBaseUrl
}: {
  tenantId: string;
  reviewBaseUrl: string;
}) {
  const job = await prisma.automationJobRun.create({
    data: {
      tenantId,
      jobType: CHECK_IN_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: {
        version: 1,
        mode: "FIRST_PARTY_REFRESH_WITH_SEMRUSH_CACHE",
        semrushLiveQuery: false
      }
    }
  });

  try {
    const evidenceRefresh = await refreshWebsiteGrowthEvidenceForTenant(tenantId);
    const semrushMailSync = await safeSyncWebsiteGrowthSemrushScheduledReports({ tenantId });
    const weeklyPlan = await createWeeklyWebsiteGrowthPlanForTenant(tenantId, { source: "cron" });
    const [opportunityStatusCounts, semrushCache, backlinkCounts] = await Promise.all([
      prisma.websiteGrowthOpportunity.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true }
      }),
      loadWebsiteGrowthSemrushCache(tenantId),
      prisma.websiteGrowthBacklinkOpportunity.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true }
      })
    ]);
    const researchInventory = Object.fromEntries(
      opportunityStatusCounts.map((row) => [row.status, row._count._all])
    );
    const backlinks = Object.fromEntries(
      backlinkCounts.map((row) => [row.status, row._count._all])
    );
    const researchSignalCount = opportunityStatusCounts.reduce(
      (sum, row) => sum + row._count._all,
      0
    );
    const teamsMessage = buildWebsiteGrowthScoutWeekdayCheckInMessage({
      sourceSummary: evidenceRefresh,
      weeklyPlan,
      researchInventory,
      researchSignalCount,
      semrushCache,
      semrushMailSync,
      backlinkCounts: backlinks,
      reviewBaseUrl
    });

    await prisma.$transaction(async (tx) => {
      await tx.automationJobRun.update({
        where: { id: job.id },
        data: {
          status: JobStatus.SUCCESS,
          finishedAt: new Date(),
          output: {
            phase: "WEEKDAY_CHECK_IN_COMPLETE",
            evidenceRefresh,
            weeklyPlan,
            researchInventory,
            researchSignalCount,
            semrushCache: {
              available: semrushCache.available,
              fresh: semrushCache.fresh,
              observedAt: semrushCache.observedAt,
              expiresAt: semrushCache.expiresAt,
              ageDays: semrushCache.ageDays,
              reportCount: semrushCache.reports.length
            },
            semrushMailSync,
            backlinkCounts: backlinks,
            completedAt: new Date().toISOString()
          }
        }
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId: null,
          action: "website-growth.scout.weekday-check-in",
          entityType: "AutomationJobRun",
          entityId: job.id,
          after: {
            semrushLiveQuery: false,
            semrushCacheObservedAt: semrushCache.observedAt,
            researchSignalCount,
            selectedCount: readOptionalInteger(readRecord(weeklyPlan).selectedCount) ?? 0
          }
        }
      });
    });

    return { runId: job.id, teamsMessage, semrushCache };
  } catch (error) {
    await prisma.automationJobRun.update({
      where: { id: job.id },
      data: {
        status: JobStatus.ERROR,
        finishedAt: new Date(),
        output: { phase: "WEEKDAY_CHECK_IN_FAILED" },
        errorMessage: error instanceof Error ? error.message : "Website Growth weekday check-in failed."
      }
    });
    throw error;
  }
}

export async function completeWebsiteGrowthScoutRun({
  tenantId,
  runId,
  completion,
  reviewBaseUrl
}: {
  tenantId: string;
  runId: string;
  completion: unknown;
  reviewBaseUrl: string;
}) {
  const parsed = parseWebsiteGrowthScoutCompletion(completion);
  const job = await prisma.automationJobRun.findFirst({
    where: { id: runId, tenantId, jobType: JOB_TYPE, status: JobStatus.RUNNING }
  });
  if (!job) throw new Error("The Website Growth Scout run is not active or does not belong to this tenant.");

  const candidateIds = readStringArray(readRecord(job.input).candidateIds);
  const questionCandidateIds = new Set(
    readStringArray(readRecord(job.input).questionCandidateIds)
  );
  const recoveryCandidateIds = new Set(
    readStringArray(readRecord(job.input).recoveryCandidateIds)
  );
  const allowed = new Set(candidateIds);

  for (const item of parsed.drafts) {
    if (!allowed.has(item.opportunityId)) throw new Error("Scout returned a draft outside its candidate scope.");
  }
  for (const row of parsed.semrush.rows) {
    if (!allowed.has(row.opportunityId)) throw new Error("SEMrush returned evidence outside the Scout candidate scope.");
  }
  validateSemrushCacheUse({ parsed, jobInput: job.input, jobOutput: job.output });
  validateWebsiteGrowthWebDiscoveryReview({
    review: parsed.backlinks,
    jobOutput: job.output
  });

  const semrushImport = await persistSemrushEvidence(tenantId, runId, parsed.semrush, allowed);
  const backlinkSummary = parsed.backlinks.source === "CACHE"
    ? await summarizeCachedWebsiteGrowthBacklinks(tenantId, parsed.backlinks)
    : await persistWebsiteGrowthBacklinkReview({
        tenantId,
        runId,
        review: parsed.backlinks
      });
  const savedDrafts: WebsiteGrowthContentDraft[] = [];

  for (const item of parsed.drafts) {
    const opportunity = await prisma.websiteGrowthOpportunity.findFirst({
      where: { id: item.opportunityId, tenantId, status: WebsiteGrowthOpportunityStatus.REVIEWING },
      select: { id: true, targetPage: true }
    });
    if (!opportunity) continue;
    const existing = await prisma.websiteGrowthContentDraft.findFirst({
      where: { tenantId, opportunityId: item.opportunityId },
      orderBy: { createdAt: "desc" }
    });
    if (existing) {
      savedDrafts.push(existing);
      continue;
    }

    const saved = await prisma.websiteGrowthContentDraft.create({
      data: {
        tenantId,
        opportunityId: item.opportunityId,
        source: WebsiteGrowthContentDraftSource.AI,
        title: item.draft.title,
        summary: item.draft.summary,
        contentType: item.draft.contentType,
        proposedPath: item.draft.proposedPath,
        targetPage: opportunity.targetPage,
        draftJson: {
          ...item.draft,
          scout: {
            version: 2,
            runId,
            model: readRecord(job.input).model,
            reasoningEffort: readRecord(job.input).reasoningEffort,
            recommendationSummary: item.recommendationSummary,
            semrushTransport: "official_mcp_oauth",
            semrushSource: parsed.semrush.source,
            semrushObservedAt: parsed.semrush.observedAt
          }
        } as Prisma.InputJsonValue,
        rawResponse: {
          runSummary: parsed.runSummary,
          semrushSummary: parsed.semrush.summary
        }
      }
    });
    savedDrafts.push(saved);
  }
  const questionDraftCount = savedDrafts.filter((draft) =>
    questionCandidateIds.has(draft.opportunityId)
  ).length;
  const recoveryDraftCount = savedDrafts.filter((draft) =>
    recoveryCandidateIds.has(draft.opportunityId)
  ).length;

  const trackingDrafts = await prisma.websiteGrowthContentDraft.findMany({
    where: {
      tenantId,
      status: {
        in: [
          WebsiteGrowthContentDraftStatus.APPROVED,
          WebsiteGrowthContentDraftStatus.BUILT,
          WebsiteGrowthContentDraftStatus.PUBLISHED
        ]
      }
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      status: true,
      proposedPath: true,
      targetPage: true,
      draftJson: true,
      opportunity: {
        select: {
          action: true,
          primaryKeyword: true,
          supportingKeywords: true,
          targetPage: true,
          sourcePage: true
        }
      }
    }
  });
  const keywordAdditions = parsed.semrush.source === "UNAVAILABLE"
    ? []
    : buildWebsiteGrowthKeywordAdditions({
        drafts: trackingDrafts,
        trackedKeywords: parsed.semrush.tracking.trackedKeywords
      });
  if (parsed.semrush.source === "LIVE_MCP") {
    await persistSemrushTrackingSnapshot({
      tenantId,
      runId,
      tracking: parsed.semrush.tracking,
      keywordAdditions
    });
  }
  const generatedAt = new Date();
  const reports = {
    keywordImport: buildWebsiteGrowthKeywordImportReport(keywordAdditions, generatedAt),
    performance: buildWebsiteGrowthPerformanceReport(parsed.semrush.tracking, generatedAt)
  };
  const reportLinks = buildWebsiteGrowthReportDownloadLinks({
    tenantId,
    runId: job.id,
    baseUrl: reviewBaseUrl,
    includeKeywordImport: keywordAdditions.length > 0
  });
  const teamsMessage = buildWebsiteGrowthScoutTeamsMessage({
    drafts: savedDrafts.map((draft) => ({ id: draft.id, title: draft.title, summary: draft.summary })),
    semrushQueried: parsed.semrush.queried,
    semrushSource: parsed.semrush.source,
    semrushObservedAt: parsed.semrush.observedAt,
    semrushSummary: parsed.semrush.summary,
    sourceSummary: readRecord(job.output).evidenceRefresh,
    weeklyPlan: readRecord(job.output).weeklyPlan,
    candidateCount: readOptionalInteger(readRecord(job.output).candidateCount) ?? 0,
    questionCandidateCount: questionCandidateIds.size,
    questionDraftCount,
    recoveryCandidateCount: recoveryCandidateIds.size,
    recoveryDraftCount,
    seoRecovery: readRecord(readRecord(job.output).evidenceRefresh).seoRecovery,
    researchSignalCount: readOptionalInteger(readRecord(job.output).researchSignalCount) ?? 0,
    researchInventory: readRecord(readRecord(job.output).researchInventory),
    keywordAdditionCount: keywordAdditions.length,
    tracking: parsed.semrush.tracking,
    backlinkLines: buildWebsiteGrowthBacklinkTeamsLines({
      review: parsed.backlinks,
      persisted: backlinkSummary,
      reviewBaseUrl
    }),
    reportLinks,
    reviewBaseUrl
  });

  await prisma.$transaction(async (tx) => {
    await tx.automationJobRun.update({
      where: { id: job.id },
      data: {
        status: JobStatus.SUCCESS,
        finishedAt: new Date(),
        output: {
          ...readRecord(job.output),
          phase: "AWAITING_HUMAN_REVIEW",
          semrushImportId: semrushImport.id,
          semrushRowCount: parsed.semrush.rows.length,
          semrushTrackedKeywordCount: parsed.semrush.tracking.trackedKeywords.length,
          semrushSource: parsed.semrush.source,
          semrushObservedAt: parsed.semrush.observedAt,
          keywordAdditionCount: keywordAdditions.length,
          questionCandidateCount: questionCandidateIds.size,
          questionDraftCount,
          recoveryCandidateCount: recoveryCandidateIds.size,
          recoveryDraftCount,
          backlinkSummary,
          reports,
          draftIds: savedDrafts.map((draft) => draft.id),
          completedAt: new Date().toISOString()
        }
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: null,
        action: "website-growth.scout.completed",
        entityType: "AutomationJobRun",
        entityId: job.id,
        after: {
          model: readOptionalString(readRecord(job.input).model, 100) ?? "unknown",
          reasoningEffort: readOptionalString(readRecord(job.input).reasoningEffort, 20) ?? "unknown",
          semrushTransport: "official_mcp_oauth",
          semrushSource: parsed.semrush.source,
          semrushObservedAt: parsed.semrush.observedAt,
          semrushRowCount: parsed.semrush.rows.length,
          semrushTrackedKeywordCount: parsed.semrush.tracking.trackedKeywords.length,
          keywordAdditionCount: keywordAdditions.length,
          questionCandidateCount: questionCandidateIds.size,
          questionDraftCount,
          recoveryCandidateCount: recoveryCandidateIds.size,
          recoveryDraftCount,
          backlinkSummary,
          draftIds: savedDrafts.map((draft) => draft.id)
        }
      }
    });
  });

  return {
    runId: job.id,
    draftCount: savedDrafts.length,
    draftIds: savedDrafts.map((draft) => draft.id),
    backlinkSummary,
    teamsMessage,
    reports,
    reportLinks
  };
}

export async function failWebsiteGrowthScoutRun({
  tenantId,
  runId,
  message
}: {
  tenantId: string;
  runId: string;
  message: string;
}) {
  const active = await prisma.automationJobRun.findFirst({
    where: { id: runId, tenantId, jobType: JOB_TYPE, status: JobStatus.RUNNING },
    select: { output: true }
  });
  if (!active) return false;
  const result = await prisma.automationJobRun.updateMany({
    where: { id: runId, tenantId, jobType: JOB_TYPE, status: JobStatus.RUNNING },
    data: {
      status: JobStatus.ERROR,
      finishedAt: new Date(),
      output: {
        ...readRecord(active.output),
        phase: "CODEX_FAILED"
      },
      errorMessage: message.slice(0, 1000)
    }
  });
  return result.count > 0;
}

function validateSemrushCacheUse({
  parsed,
  jobInput,
  jobOutput
}: {
  parsed: WebsiteGrowthScoutCompletion;
  jobInput: Prisma.JsonValue | null;
  jobOutput: Prisma.JsonValue | null;
}) {
  if (parsed.semrush.source !== "CACHE" && parsed.backlinks.source !== "CACHE") return;
  const input = readRecord(jobInput);
  const cache = readRecord(readRecord(jobOutput).semrushCache);
  const expectedObservedAt = readOptionalString(input.semrushCacheObservedAt, 100);
  if (parsed.semrush.source === "CACHE" && (
    cache.available !== true ||
    cache.fresh !== true ||
    !expectedObservedAt ||
    readRequiredTimestamp(expectedObservedAt, "Cached SEMrush") !== parsed.semrush.observedAt
  )) {
    throw new Error("Scout may use cached SEMrush evidence only when the prepared packet contains the same fresh snapshot.");
  }
  if (parsed.backlinks.source === "CACHE") {
    const observedAt = Date.parse(parsed.backlinks.observedAt);
    if (
      cache.available !== true ||
      cache.fresh !== true ||
      observedAt > Date.now() ||
      observedAt < Date.now() - 14 * 24 * 60 * 60 * 1000
    ) {
      throw new Error("Scout may use cached backlink evidence only when it is no more than 14 days old.");
    }
  }
}

function validateWebsiteGrowthWebDiscoveryReview({
  review,
  jobOutput
}: {
  review: WebsiteGrowthBacklinkReview;
  jobOutput: Prisma.JsonValue | null;
}) {
  if (review.source !== "WEB_DISCOVERY") return;
  const discovery = readRecord(readRecord(jobOutput).backlinkDiscovery);
  const finalists = Array.isArray(discovery.finalists) ? discovery.finalists : [];
  const allowedHashes = new Set(
    finalists
      .map((item) => readOptionalString(readRecord(item).id, 64))
      .filter((value): value is string => Boolean(value))
  );
  if (allowedHashes.size === 0 && review.prospects.length > 0) {
    throw new Error("Scout may not promote a public-web backlink when Qwen returned no finalists.");
  }
  for (const prospect of review.prospects) {
    const canonical = prospect.sourceUrl
      ? canonicalizeWebsiteGrowthDiscoveryUrl(prospect.sourceUrl)
      : null;
    if (!canonical || !allowedHashes.has(buildWebsiteGrowthDiscoveryUrlHash(canonical))) {
      throw new Error("Scout returned a public-web backlink outside the prepared finalist scope.");
    }
  }
  const expectedRawCount = readOptionalInteger(discovery.rawResultCount);
  if (expectedRawCount !== null && review.rawProspectsReviewed !== expectedRawCount) {
    throw new Error("Scout must preserve the bounded public-web raw result count.");
  }
}

async function summarizeCachedWebsiteGrowthBacklinks(
  tenantId: string,
  review: WebsiteGrowthBacklinkReview
) {
  const activeQueueCount = await prisma.websiteGrowthBacklinkOpportunity.count({
    where: {
      tenantId,
      status: {
        in: [
          WebsiteGrowthBacklinkStatus.NEEDS_REVIEW,
          WebsiteGrowthBacklinkStatus.APPROVED,
          WebsiteGrowthBacklinkStatus.IN_PROGRESS,
          WebsiteGrowthBacklinkStatus.SUBMITTED,
          WebsiteGrowthBacklinkStatus.CONTACTED,
          WebsiteGrowthBacklinkStatus.REPLIED,
          WebsiteGrowthBacklinkStatus.BLOCKED
        ]
      }
    }
  });
  return {
    rawProspectsReviewed: review.rawProspectsReviewed,
    suppliedByScout: review.prospects.length,
    created: 0,
    refreshed: 0,
    skippedByQualityGate: 0,
    skippedExistingDecision: review.prospects.length,
    archivedAsStale: 0,
    activeQueueCount
  };
}

export function parseWebsiteGrowthScoutCompletion(value: unknown): WebsiteGrowthScoutCompletion {
  const record = readRecord(value);
  const semrush = readRecord(record.semrush);
  const tracking = readRecord(semrush.tracking);
  const drafts = Array.isArray(record.drafts) ? record.drafts : null;
  const rows = Array.isArray(semrush.rows) ? semrush.rows : null;
  const trackedKeywords = Array.isArray(tracking.trackedKeywords) ? tracking.trackedKeywords : null;
  const semrushSource = readRequiredSemrushSource(semrush.source);
  const semrushObservedAt = readRequiredTimestamp(semrush.observedAt, "SEMrush");

  if (
    !readRequiredString(record.runSummary, 4000) ||
    typeof semrush.queried !== "boolean" ||
    !isRecord(record.backlinks) ||
    !rows ||
    !drafts ||
    !trackedKeywords
  ) {
    throw new Error("Scout completion did not match the required response structure.");
  }
  if (rows.length > MAX_SEMRUSH_ROWS) throw new Error(`Scout may return at most ${MAX_SEMRUSH_ROWS} SEMrush rows.`);
  if (trackedKeywords.length > 500) throw new Error("Scout may return at most 500 tracked SEMrush keywords.");
  if (semrushSource === "LIVE_MCP" && semrush.queried !== true) {
    throw new Error("A live SEMrush result must query the official MCP.");
  }
  if (semrushSource === "CACHE" && semrush.queried !== false) {
    throw new Error("Cached SEMrush evidence must not claim a live query.");
  }
  if (semrushSource === "UNAVAILABLE" && semrush.queried !== false) {
    throw new Error("Unavailable SEMrush evidence must not claim a live query.");
  }
  if (semrushSource === "UNAVAILABLE" && rows.length > 0) {
    throw new Error("Unavailable SEMrush evidence cannot contain evidence rows.");
  }

  return {
    runSummary: readRequiredString(record.runSummary, 4000),
    semrush: {
      queried: semrush.queried,
      source: semrushSource,
      observedAt: semrushObservedAt,
      summary: readRequiredString(semrush.summary, 4000),
      rows: rows.map(parseSemrushRow),
      tracking: {
        projectId: readOptionalString(tracking.projectId, 100),
        campaignId: readOptionalString(tracking.campaignId, 100),
        domain: readOptionalString(tracking.domain, 300),
        database: readOptionalString(tracking.database, 50),
        device: readOptionalString(tracking.device, 50),
        visibility: readOptionalNumber(tracking.visibility),
        previousVisibility: readOptionalNumber(tracking.previousVisibility),
        top3: readOptionalInteger(tracking.top3),
        top10: readOptionalInteger(tracking.top10),
        top20: readOptionalInteger(tracking.top20),
        top100: readOptionalInteger(tracking.top100),
        improved: readOptionalInteger(tracking.improved),
        declined: readOptionalInteger(tracking.declined),
        entered: readOptionalInteger(tracking.entered),
        lost: readOptionalInteger(tracking.lost),
        trackedKeywords: trackedKeywords.map(parseTrackedKeyword)
      }
    },
    backlinks: parseWebsiteGrowthBacklinkReview(record.backlinks),
    drafts: drafts.map((entry) => {
      const item = readRecord(entry);
      const draft = readRecord(item.draft);
      validateDraft(draft);
      return {
        opportunityId: readRequiredString(item.opportunityId, 100),
        recommendationSummary: readRequiredString(item.recommendationSummary, 2000),
        draft: draft as unknown as WebsiteGrowthContentDraftPayload
      };
    })
  };
}

export function buildWebsiteGrowthScoutTeamsMessage({
  drafts,
  semrushQueried,
  semrushSource = semrushQueried ? "LIVE_MCP" : "CACHE",
  semrushObservedAt,
  semrushSummary,
  sourceSummary,
  weeklyPlan,
  candidateCount,
  questionCandidateCount,
  questionDraftCount,
  recoveryCandidateCount,
  recoveryDraftCount,
  seoRecovery,
  researchSignalCount,
  researchInventory,
  keywordAdditionCount,
  tracking,
  backlinkLines,
  reportLinks,
  reviewBaseUrl
}: {
  drafts: Array<{ id: string; title: string; summary: string }>;
  semrushQueried: boolean;
  semrushSource?: WebsiteGrowthSemrushSource;
  semrushObservedAt?: string | null;
  semrushSummary: string;
  sourceSummary?: unknown;
  weeklyPlan?: unknown;
  candidateCount?: number;
  questionCandidateCount?: number;
  questionDraftCount?: number;
  recoveryCandidateCount?: number;
  recoveryDraftCount?: number;
  seoRecovery?: WebsiteGrowthSeoRecoverySnapshot | unknown;
  researchSignalCount?: number;
  researchInventory?: Record<string, unknown>;
  keywordAdditionCount?: number;
  tracking?: WebsiteGrowthSemrushTrackingSnapshot;
  backlinkLines?: string;
  reportLinks?: {
    performance: string;
    keywordImport: string | null;
    expiresAt: string;
  };
  reviewBaseUrl: string;
}) {
  const plan = readRecord(weeklyPlan);
  const reviewedCount = readOptionalInteger(plan.reviewedCount) ?? 0;
  const selectedCount = readOptionalInteger(plan.selectedCount) ?? 0;
  const monitoringCount = readOptionalInteger(readRecord(researchInventory).MONITORING) ?? 0;
  const trackedCount = tracking?.trackedKeywords.length ?? 0;
  const evidenceRefreshLine = formatEvidenceRefresh(sourceSummary);
  const semrushEvidenceLabel =
    semrushSource === "LIVE_MCP"
      ? "live SEMrush MCP"
      : semrushSource === "CACHE"
        ? `cached SEMrush evidence${semrushObservedAt ? ` from ${formatReportDate(semrushObservedAt)}` : ""}`
        : "no SEMrush evidence (API units unavailable)";
  const recoveryLines = buildSeoRecoveryTeamsLines({
    snapshot: seoRecovery ?? readRecord(sourceSummary).seoRecovery,
    candidateCount: recoveryCandidateCount,
    draftCount: recoveryDraftCount
  });
  const lines = [
    `Website Growth Scout weekday report: ${drafts.length} idea${drafts.length === 1 ? "" : "s"} promoted for approval.`,
    `Evidence used: Search Console, GA4, first-party website forms, and ${semrushEvidenceLabel}.`,
    evidenceRefreshLine,
    `Research funnel: ${researchSignalCount ?? 0} stored signals (${monitoringCount} monitoring); ${reviewedCount} new records reviewed; ${selectedCount} shortlisted; ${candidateCount ?? 0} sent to Codex; ${drafts.length} promoted.`,
    `Question and AI-answer lane: ${questionCandidateCount ?? 0} question-led candidate${(questionCandidateCount ?? 0) === 1 ? "" : "s"} reviewed; ${questionDraftCount ?? 0} promoted.`,
    ...recoveryLines,
    "The research inventory is intentionally much larger than the approval queue because duplicate queries are clustered by page/topic, weak or branded signals are filtered, weekly lane limits are applied, and Codex promotes only evidence-backed work.",
    semrushSummary ? `SEMrush: ${semrushSummary}` : null,
    tracking
      ? `Position Tracking: ${trackedCount} keywords; visibility ${formatMetric(tracking.visibility)} (${formatSignedChange(tracking.visibility, tracking.previousVisibility)}); ${tracking.improved ?? 0} improved and ${tracking.declined ?? 0} declined.`
      : null,
    `Keyword tracking: ${keywordAdditionCount ?? 0} approved-page keyword${(keywordAdditionCount ?? 0) === 1 ? "" : "s"} are ready to add after automatic deduplication against SEMrush.`,
    backlinkLines ?? null,
    reportLinks
      ? `Excel downloads (available for 7 days):\nSEO performance: ${reportLinks.performance}${reportLinks.keywordImport ? `\nSEMrush keyword import: ${reportLinks.keywordImport}` : ""}`
      : null,
    "",
    ...(drafts.length > 0
      ? drafts.flatMap((draft, index) => [
          `${index + 1}. ${draft.title}`,
          draft.summary,
          `${normalizeBaseUrl(reviewBaseUrl)}/website-growth/drafts/${encodeURIComponent(draft.id)}`,
          ""
        ])
      : ["No new page brief needs your approval today.", ""]),
    drafts.length > 0
      ? "Approve a brief only when its content, claims, route, and proposed layout are correct. Approval starts the developer build automatically; it does not merge or publish the page."
      : "The SEO performance workbook is available from the secure download link even when no new idea is promoted."
  ];

  return lines.filter((line): line is string => line !== null).join("\n").trim();
}

export function buildWebsiteGrowthScoutWeekdayCheckInMessage({
  sourceSummary,
  weeklyPlan,
  researchSignalCount,
  researchInventory,
  semrushCache,
  semrushMailSync,
  backlinkCounts,
  reviewBaseUrl
}: {
  sourceSummary: unknown;
  weeklyPlan: unknown;
  researchSignalCount: number;
  researchInventory: Record<string, unknown>;
  semrushCache: WebsiteGrowthSemrushCache;
  semrushMailSync?: SemrushScheduledReportSyncResult;
  backlinkCounts: Record<string, unknown>;
  reviewBaseUrl: string;
}) {
  const plan = readRecord(weeklyPlan);
  const reviewingCount = readOptionalInteger(researchInventory.REVIEWING) ?? 0;
  const monitoringCount = readOptionalInteger(researchInventory.MONITORING) ?? 0;
  const selectedCount = readOptionalInteger(plan.selectedCount) ?? 0;
  const questionSelectedCount =
    readOptionalInteger(readRecord(plan.laneCounts).QUESTION_ANSWER) ?? 0;
  const backlinkReviewCount = readOptionalInteger(backlinkCounts.NEEDS_REVIEW) ?? 0;
  const cacheLine = semrushCache.available
    ? `SEMrush evidence cache: ${semrushCache.fresh ? "current" : "stale"}; last refreshed ${formatReportDate(semrushCache.observedAt)}; ${semrushCache.reports.length} scheduled report${semrushCache.reports.length === 1 ? "" : "s"} retained.`
    : "SEMrush evidence cache: unavailable. Scheduled mailbox reports will be checked again on the next Scout run.";
  const mailLine = semrushMailSync
    ? semrushMailSync.status === "SUCCESS"
      ? `SEMrush mailbox: ${semrushMailSync.imported} new report${semrushMailSync.imported === 1 ? "" : "s"} imported; ${semrushMailSync.duplicates} already seen; ${semrushMailSync.failed} failed.`
      : `SEMrush mailbox: unavailable this run (${semrushMailSync.error ?? "unknown error"}); Scout continued with retained evidence.`
    : null;
  const recoveryLines = buildSeoRecoveryTeamsLines({
    snapshot: readRecord(sourceSummary).seoRecovery
  });

  return [
    "Website Growth Scout weekday check-in: first-party evidence refreshed; no SEMrush API units or Codex research were used.",
    formatEvidenceRefresh(sourceSummary),
    `Research queue: ${researchSignalCount} stored signals (${monitoringCount} monitoring); ${reviewingCount} awaiting Scout research; ${selectedCount} newly shortlisted by deterministic planning.`,
    `Question and AI-answer lane: ${questionSelectedCount} question-led candidate${questionSelectedCount === 1 ? "" : "s"} newly shortlisted for the next deep Scout review.`,
    ...recoveryLines,
    cacheLine,
    mailLine,
    `Backlinks: ${backlinkReviewCount} curated prospect${backlinkReviewCount === 1 ? "" : "s"} currently need review.`,
    `Review page: ${normalizeBaseUrl(reviewBaseUrl)}/website-growth`,
    "New AI-reviewed ideas and the refreshed SEO workbook are produced by the Monday and Wednesday deep Scout runs."
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function buildSeoRecoveryTeamsLines({
  snapshot,
  candidateCount,
  draftCount
}: {
  snapshot: unknown;
  candidateCount?: number;
  draftCount?: number;
}) {
  const recovery = readRecord(snapshot);
  const currentPeriod = readRecord(recovery.currentPeriod);
  const site = readRecord(recovery.site);
  const current = readRecord(site.current);
  const previous = readRecord(site.previous);
  if (!readOptionalString(currentPeriod.endDate, 20)) {
    return ["SEO recovery monitor: unavailable this run; Scout continued with its retained opportunity queue."];
  }
  const counts = readRecord(recovery.counts);
  const needsRecovery = readOptionalInteger(counts.NEEDS_RECOVERY) ?? 0;
  const transitions = readOptionalInteger(counts.MIGRATION_TRANSITION) ?? 0;
  const improving = readOptionalInteger(counts.IMPROVING) ?? 0;
  const lines = [
    `SEO recovery monitor: ${formatCount(previous.clicks)} to ${formatCount(current.clicks)} clicks (${formatPercentChange(site.clickChangePercent)}); ${formatCount(previous.impressions)} to ${formatCount(current.impressions)} impressions (${formatPercentChange(site.impressionChangePercent)}). ${needsRecovery} route${needsRecovery === 1 ? "" : "s"} need recovery; ${transitions} migration transition${transitions === 1 ? "" : "s"}; ${improving} improving.`,
    candidateCount === undefined
      ? null
      : `SEO recovery lane: ${candidateCount} candidate${candidateCount === 1 ? "" : "s"} reviewed by Codex; ${draftCount ?? 0} promoted for approval.`
  ];
  return lines.filter((line): line is string => Boolean(line));
}

function formatCount(value: unknown) {
  return (readOptionalInteger(value) ?? 0).toLocaleString("en-US");
}

function formatPercentChange(value: unknown) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (number === null) return "new";
  const percent = Math.round(number * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

export async function loadWebsiteGrowthSemrushCache(
  tenantId: string,
  now = new Date()
): Promise<WebsiteGrowthSemrushCache> {
  const imports = await prisma.websiteGrowthDataImport.findMany({
    where: {
      tenantId,
      source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD,
      status: WebsiteGrowthImportStatus.SUCCESS
    },
    orderBy: { completedAt: "desc" },
    take: 40,
    select: {
      completedAt: true,
      createdAt: true,
      summary: true
    }
  });
  const trackingImport = imports.find(
    (item) => readOptionalString(readRecord(item.summary).runType, 100) === "semrush_keyword_tracking_report"
  );
  const scheduledImports = imports.filter(
    (item) => readOptionalString(readRecord(item.summary).runType, 100) === "semrush_scheduled_email_report"
  );
  const reports = scheduledImports.slice(0, 5).map((item) => {
    const summary = readRecord(item.summary);
    return {
      reportType: readSemrushScheduledReportType(summary.reportType),
      subject: readOptionalString(summary.subject, 300) ?? "SEMrush scheduled report",
      observedAt: readImportObservedAt(item),
      metrics: readNumberRecord(summary.metrics),
      excerpt: readOptionalString(summary.excerpt, 6_000) ?? ""
    };
  });
  const positionImport = scheduledImports.find(
    (item) => readOptionalString(readRecord(item.summary).reportType, 100) === "POSITION_TRACKING"
  );
  const positionSummary = readRecord(positionImport?.summary);
  const summary = readRecord(trackingImport?.summary);
  const runId = readOptionalString(summary.runId, 100);
  let tracking = parseCachedTrackingSnapshot(summary.snapshot);

  if (!tracking && trackingImport && runId) {
    const metrics = await prisma.websiteGrowthMetric.findMany({
      where: {
        tenantId,
        source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        query: true,
        page: true,
        position: true,
        raw: true
      }
    });
    const matching = metrics.filter(
      (metric) => readOptionalString(readRecord(metric.raw).runId, 100) === runId &&
        readRecord(metric.raw).tracking === true
    );
    const trackedKeywords = matching.map((metric) => {
      const raw = readRecord(metric.raw);
      return {
        keyword: metric.query ?? "",
        tags: readStringArray(raw.tags).slice(0, 20),
        position: metric.position,
        previousPosition: readOptionalNumber(raw.previousPosition),
        landingPage: metric.page,
        searchVolume: readOptionalInteger(raw.searchVolume)
      };
    }).filter((row) => Boolean(row.keyword));
    tracking = {
      projectId: readOptionalString(summary.projectId, 100),
      campaignId: readOptionalString(summary.campaignId, 100),
      domain: readOptionalString(summary.domain, 300),
      database: readOptionalString(summary.database, 50),
      device: readOptionalString(summary.device, 50),
      visibility: readOptionalNumber(summary.visibility),
      previousVisibility: readOptionalNumber(summary.previousVisibility),
      top3: countRankingBucket(trackedKeywords, 3),
      top10: countRankingBucket(trackedKeywords, 10),
      top20: countRankingBucket(trackedKeywords, 20),
      top100: countRankingBucket(trackedKeywords, 100),
      improved: trackedKeywords.filter(
        (row) => row.position !== null && row.previousPosition !== null && row.position < row.previousPosition
      ).length,
      declined: trackedKeywords.filter(
        (row) => row.position !== null && row.previousPosition !== null && row.position > row.previousPosition
      ).length,
      entered: trackedKeywords.filter(
        (row) => row.position !== null && row.previousPosition === null
      ).length,
      lost: trackedKeywords.filter(
        (row) => row.position === null && row.previousPosition !== null
      ).length,
      trackedKeywords
    };
  }

  const positionTracking = parseCachedTrackingSnapshot(positionSummary.snapshot);
  if (positionTracking) {
    const scheduledMetrics = readNumberRecord(positionSummary.metrics);
    tracking = {
      ...(tracking ?? positionTracking),
      projectId: tracking?.projectId ?? positionTracking.projectId,
      campaignId: tracking?.campaignId ?? positionTracking.campaignId,
      domain: positionTracking.domain ?? tracking?.domain ?? null,
      database: tracking?.database ?? positionTracking.database,
      device: tracking?.device ?? positionTracking.device,
      visibility: scheduledMetrics.visibility ?? positionTracking.visibility ?? tracking?.visibility ?? null,
      previousVisibility: tracking?.previousVisibility ?? positionTracking.previousVisibility,
      top3: Math.round(scheduledMetrics.top3 ?? tracking?.top3 ?? positionTracking.top3),
      top10: Math.round(scheduledMetrics.top10 ?? tracking?.top10 ?? positionTracking.top10),
      top20: Math.round(scheduledMetrics.top20 ?? tracking?.top20 ?? positionTracking.top20),
      top100: Math.round(scheduledMetrics.top100 ?? tracking?.top100 ?? positionTracking.top100),
      improved: Math.round(scheduledMetrics.improved ?? tracking?.improved ?? positionTracking.improved),
      declined: Math.round(scheduledMetrics.declined ?? tracking?.declined ?? positionTracking.declined),
      entered: tracking?.entered ?? positionTracking.entered,
      lost: tracking?.lost ?? positionTracking.lost,
      trackedKeywords: tracking?.trackedKeywords ?? positionTracking.trackedKeywords
    };
  }

  const newestEvidenceImport = positionImport ?? trackingImport ?? scheduledImports[0];
  if (!newestEvidenceImport) {
    return {
      available: false,
      fresh: false,
      observedAt: null,
      expiresAt: null,
      ageDays: null,
      tracking: null,
      reports: []
    };
  }
  const observedAtDate = new Date(readImportObservedAt(newestEvidenceImport));
  const expiresAtDate = new Date(observedAtDate.getTime() + SEMRUSH_CACHE_TTL_MS);

  return {
    available: Boolean(tracking),
    fresh: Boolean(tracking) && expiresAtDate.getTime() >= now.getTime(),
    observedAt: observedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
    ageDays: Math.max(0, Math.floor((now.getTime() - observedAtDate.getTime()) / (24 * 60 * 60 * 1000))),
    tracking,
    reports
  };
}

function readImportObservedAt(item: {
  completedAt: Date | null;
  createdAt: Date;
  summary: unknown;
}) {
  const observedAt = readOptionalString(readRecord(item.summary).observedAt, 100);
  const parsed = observedAt ? new Date(observedAt) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toISOString()
    : (item.completedAt ?? item.createdAt).toISOString();
}

function readSemrushScheduledReportType(value: unknown): SemrushScheduledReportType {
  return value === "POSITION_TRACKING" ||
    value === "SITE_AUDIT" ||
    value === "BACKLINKS" ||
    value === "ORGANIC_POSITIONS" ||
    value === "SEO_OVERVIEW"
    ? value
    : "UNKNOWN";
}

function readNumberRecord(value: unknown) {
  return Object.fromEntries(
    Object.entries(readRecord(value)).flatMap(([key, raw]) => {
      const numeric = readOptionalNumber(raw);
      return numeric === null ? [] : [[key, numeric]];
    })
  );
}

async function persistSemrushTrackingSnapshot({
  tenantId,
  runId,
  tracking,
  keywordAdditions
}: {
  tenantId: string;
  runId: string;
  tracking: WebsiteGrowthSemrushTrackingSnapshot;
  keywordAdditions: Array<{ keyword: string; tags: string; route: string; draftId: string }>;
}) {
  const now = new Date();
  if (tracking.trackedKeywords.length > 0) {
    await prisma.websiteGrowthMetric.createMany({
      data: tracking.trackedKeywords.map((row) => ({
        tenantId,
        source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD,
        query: row.keyword,
        page: row.landingPage,
        position: row.position,
        dateRangeStart: now,
        dateRangeEnd: now,
        raw: {
          tracking: true,
          transport: "official_mcp_oauth",
          runId,
          projectId: tracking.projectId,
          campaignId: tracking.campaignId,
          previousPosition: row.previousPosition,
          searchVolume: row.searchVolume,
          tags: row.tags
        }
      }))
    });
  }

  await prisma.websiteGrowthDataImport.create({
    data: {
      tenantId,
      source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD,
      status: WebsiteGrowthImportStatus.SUCCESS,
      fileName: "Weekly SEMrush Position Tracking report",
      rowCount: tracking.trackedKeywords.length,
      startedAt: now,
      completedAt: now,
      summary: {
        runType: "semrush_keyword_tracking_report",
        transport: "official_mcp_oauth",
        readOnly: true,
        observedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SEMRUSH_CACHE_TTL_MS).toISOString(),
        runId,
        projectId: tracking.projectId,
        campaignId: tracking.campaignId,
        domain: tracking.domain,
        database: tracking.database,
        device: tracking.device,
        visibility: tracking.visibility,
        previousVisibility: tracking.previousVisibility,
        trackedKeywordCount: tracking.trackedKeywords.length,
        keywordAdditionCount: keywordAdditions.length,
        keywordAdditions: keywordAdditions.slice(0, 500),
        snapshot: tracking
      } as Prisma.InputJsonValue
    }
  });
}

async function persistSemrushEvidence(
  tenantId: string,
  runId: string,
  semrush: WebsiteGrowthScoutCompletion["semrush"],
  allowed: Set<string>
) {
  if (semrush.source === "CACHE" || semrush.source === "UNAVAILABLE") {
    const now = new Date();
    return prisma.websiteGrowthDataImport.create({
      data: {
        tenantId,
        source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD,
        status: WebsiteGrowthImportStatus.SUCCESS,
        fileName:
          semrush.source === "CACHE"
            ? "Cached official SEMrush MCP evidence"
            : "SEMrush unavailable for this run",
        rowCount: 0,
        startedAt: now,
        completedAt: now,
        summary: {
          runType:
            semrush.source === "CACHE"
              ? "semrush_cache_reuse"
              : "semrush_unavailable",
          transport: "official_mcp_oauth",
          readOnly: true,
          queried: false,
          source: semrush.source,
          observedAt: semrush.observedAt,
          summary: semrush.summary,
          runId
        }
      }
    });
  }

  const importRecord = await prisma.websiteGrowthDataImport.create({
    data: {
      tenantId,
      source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD,
      status: WebsiteGrowthImportStatus.RUNNING,
      startedAt: new Date(),
      fileName: "Official SEMrush MCP through OAuth"
    }
  });

  try {
    const rows = semrush.rows.filter((row) => allowed.has(row.opportunityId));
    if (rows.length > 0) {
      await prisma.websiteGrowthMetric.createMany({
        data: rows.map((row) => ({
          tenantId,
          source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD,
          query: row.keyword,
          page: row.page,
          position: row.position,
          raw: {
            ...row,
            transport: "official_mcp_oauth",
            runId,
            observedAt: semrush.observedAt
          }
        }))
      });
    }

    for (const opportunityId of allowed) {
      const matching = rows.filter((row) => row.opportunityId === opportunityId);
      if (matching.length === 0) continue;
      const opportunity = await prisma.websiteGrowthOpportunity.findFirst({
        where: { id: opportunityId, tenantId },
        select: { evidence: true }
      });
      if (!opportunity) continue;
      await prisma.websiteGrowthOpportunity.update({
        where: { id: opportunityId },
        data: {
          evidence: {
            ...readRecord(opportunity.evidence),
            semrush: {
              transport: "official_mcp_oauth",
              runId,
              observedAt: semrush.observedAt,
              expiresAt: new Date(Date.parse(semrush.observedAt) + 30 * 24 * 60 * 60 * 1000).toISOString(),
              summary: semrush.summary,
              rows: matching
            }
          } as Prisma.InputJsonValue
        }
      });
    }

    return await prisma.websiteGrowthDataImport.update({
      where: { id: importRecord.id },
      data: {
        status: WebsiteGrowthImportStatus.SUCCESS,
        rowCount: rows.length,
        completedAt: new Date(),
        summary: {
          transport: "official_mcp_oauth",
          readOnly: true,
          queried: semrush.queried,
          source: semrush.source,
          observedAt: semrush.observedAt,
          summary: semrush.summary,
          runId
        }
      }
    });
  } catch (error) {
    await prisma.websiteGrowthDataImport.update({
      where: { id: importRecord.id },
      data: {
        status: WebsiteGrowthImportStatus.ERROR,
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "SEMrush MCP evidence import failed."
      }
    });
    throw error;
  }
}

function parseSemrushRow(value: unknown): WebsiteGrowthSemrushEvidence {
  const row = readRecord(value);
  return {
    opportunityId: readRequiredString(row.opportunityId, 100),
    keyword: readRequiredString(row.keyword, 300),
    page: readOptionalString(row.page, 1000),
    position: readOptionalNumber(row.position),
    searchVolume: readOptionalInteger(row.searchVolume),
    keywordDifficulty: readOptionalNumber(row.keywordDifficulty),
    intent: readOptionalString(row.intent, 100),
    competitorDomain: readOptionalString(row.competitorDomain, 300),
    opportunityType: readRequiredString(row.opportunityType, 100),
    note: readRequiredString(row.note, 1000)
  };
}

function parseTrackedKeyword(value: unknown): WebsiteGrowthSemrushTrackedKeyword {
  const row = readRecord(value);
  return {
    keyword: readRequiredString(row.keyword, 300),
    tags: readStringArray(row.tags).slice(0, 20),
    position: readOptionalNumber(row.position),
    previousPosition: readOptionalNumber(row.previousPosition),
    landingPage: readOptionalString(row.landingPage, 1000),
    searchVolume: readOptionalInteger(row.searchVolume)
  };
}

function validateDraft(draft: Record<string, unknown>) {
  for (const field of [
    "title",
    "summary",
    "contentType",
    "targetKeyword",
    "searchIntent",
    "metaTitle",
    "metaDescription",
    "websitePageType",
    "websiteTemplate"
  ]) {
    readRequiredString(draft[field], field === "summary" ? 4000 : 1000);
  }
  for (const field of [
    "sections",
    "faqs",
    "internalLinks",
    "implementationNotes",
    "reviewChecklist",
    "layoutComponents",
    "designSystemNotes"
  ]) {
    if (!Array.isArray(draft[field])) throw new Error(`Scout draft field ${field} must be an array.`);
  }
  if (!isRecord(draft.pageChangePreview) || !isRecord(readRecord(draft.pageChangePreview).currentPage)) {
    throw new Error("Scout draft must include a pageChangePreview with currentPage context.");
  }
  if (!isRecord(draft.pagePreview)) throw new Error("Scout draft must include a rendered pagePreview.");
  if (draft.proposedPath !== null && draft.proposedPath !== undefined && typeof draft.proposedPath !== "string") {
    throw new Error("Scout draft proposedPath must be a string or null.");
  }
}

function normalizeReasoningEffort(value?: string) {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : DEFAULT_REASONING_EFFORT;
}

function normalizeMaxCandidates(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(12, Math.max(1, parsed)) : DEFAULT_MAX_CANDIDATES;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function formatMetric(value: number | null) {
  return value === null ? "not available" : value.toFixed(2);
}

function formatSignedChange(current: number | null, previous: number | null) {
  if (current === null || previous === null) return "change unavailable";
  const change = current - previous;
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}`;
}

function formatEvidenceRefresh(value: unknown) {
  const sources = readRecord(value).sources;
  if (!Array.isArray(sources)) return null;

  const summaries = sources.map((value) => {
    const source = readRecord(value);
    const name = readOptionalString(source.source, 50)?.replaceAll("_", " ") ?? "source";
    const status = readOptionalString(source.status, 20) ?? "unknown";
    const rowCount = readOptionalInteger(source.rowCount) ?? 0;
    return `${name}: ${status === "success" ? `${rowCount} rows` : "failed"}`;
  });
  return summaries.length > 0 ? `Data refresh: ${summaries.join("; ")}.` : null;
}

function parseCachedTrackingSnapshot(value: unknown): WebsiteGrowthSemrushTrackingSnapshot | null {
  const record = readRecord(value);
  const trackedKeywords = Array.isArray(record.trackedKeywords)
    ? record.trackedKeywords.map((row) => parseTrackedKeyword(row))
    : null;
  if (!trackedKeywords) return null;
  return {
    projectId: readOptionalString(record.projectId, 100),
    campaignId: readOptionalString(record.campaignId, 100),
    domain: readOptionalString(record.domain, 300),
    database: readOptionalString(record.database, 50),
    device: readOptionalString(record.device, 50),
    visibility: readOptionalNumber(record.visibility),
    previousVisibility: readOptionalNumber(record.previousVisibility),
    top3: readOptionalInteger(record.top3),
    top10: readOptionalInteger(record.top10),
    top20: readOptionalInteger(record.top20),
    top100: readOptionalInteger(record.top100),
    improved: readOptionalInteger(record.improved),
    declined: readOptionalInteger(record.declined),
    entered: readOptionalInteger(record.entered),
    lost: readOptionalInteger(record.lost),
    trackedKeywords
  };
}

function countRankingBucket(
  rows: WebsiteGrowthSemrushTrackedKeyword[],
  maximumPosition: number
) {
  return rows.filter(
    (row) => row.position !== null && row.position > 0 && row.position <= maximumPosition
  ).length;
}

function formatReportDate(value: string | null | undefined) {
  if (!value) return "not available";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString("en-CA", { timeZone: "America/Toronto" })
    : "not available";
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readRequiredString(value: unknown, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Scout completion is missing a required text field.");
  return value.trim().slice(0, maxLength);
}

function readOptionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readOptionalInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function readRequiredSemrushSource(value: unknown): WebsiteGrowthSemrushSource {
  if (value === "LIVE_MCP" || value === "CACHE" || value === "UNAVAILABLE") return value;
  throw new Error("Scout completion must identify live, cached, or unavailable SEMrush evidence.");
}

function readRequiredTimestamp(value: unknown, label: string) {
  const timestamp = readRequiredString(value, 100);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new Error(`${label} observedAt must be an ISO timestamp.`);
  return new Date(parsed).toISOString();
}
