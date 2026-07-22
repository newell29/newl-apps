import {
  JobStatus,
  WebsiteGrowthContentDraftStatus,
  WebsiteGrowthContentDraftSource,
  WebsiteGrowthDataSource,
  WebsiteGrowthImportStatus,
  WebsiteGrowthOpportunityStatus,
  type WebsiteGrowthContentDraft,
  type Prisma
} from "@prisma/client";

import type { WebsiteGrowthContentDraftPayload } from "@/modules/website-growth/content-drafts";
import { refreshWebsiteGrowthEvidenceForTenant } from "@/modules/website-growth/evidence-refresh";
import { resolveNewlWebsiteContext } from "@/modules/website-growth/newl-website-context-scanner";
import { createWeeklyWebsiteGrowthPlanForTenant } from "@/modules/website-growth/weekly-plan";
import { prisma } from "@/server/db";

const JOB_TYPE = "WEBSITE_GROWTH_SCOUT_WEEKLY";
const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_REASONING_EFFORT = "high";
const DEFAULT_MAX_CANDIDATES = 6;
const MAX_SEMRUSH_ROWS = 200;
const RUN_LOCK_MS = 3 * 60 * 60 * 1000;

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
    summary: string;
    rows: WebsiteGrowthSemrushEvidence[];
  };
  drafts: Array<{
    opportunityId: string;
    recommendationSummary: string;
    draft: WebsiteGrowthContentDraftPayload;
  }>;
};

export async function prepareWebsiteGrowthScoutRun({
  tenantId,
  tenantSlug
}: {
  tenantId: string;
  tenantSlug: string;
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
        version: 1,
        tenantSlug,
        model,
        reasoningEffort,
        maxCandidates,
        semrushTransport: "official_mcp_oauth"
      }
    }
  });

  try {
    const evidenceRefresh = await refreshWebsiteGrowthEvidenceForTenant(tenantId);
    const weeklyPlan = await createWeeklyWebsiteGrowthPlanForTenant(tenantId, { source: "cron" });
    const opportunities = await prisma.websiteGrowthOpportunity.findMany({
      where: {
        tenantId,
        status: WebsiteGrowthOpportunityStatus.REVIEWING,
        contentDrafts: { none: {} }
      },
      orderBy: [{ score: "desc" }, { updatedAt: "asc" }],
      take: maxCandidates,
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
    });
    const candidateIds = opportunities.map((opportunity) => opportunity.id);
    const [websiteContext, decisionHistory] = await Promise.all([
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
      })
    ]);
    const packet = {
      version: 1,
      runId: job.id,
      tenantSlug,
      model,
      reasoningEffort,
      semrush: {
        transport: "official_mcp_oauth",
        serverUrl: "https://mcp.semrush.com/v1/mcp",
        readOnly: true,
        maxRows: MAX_SEMRUSH_ROWS,
        requiredChecks: [
          "Organic positions and landing pages relevant to each candidate",
          "Weak or missing keywords against no more than four relevant competitors",
          "Declined or lost keywords where the data is available",
          "Search volume, keyword difficulty, intent, and ranking URL"
        ]
      },
      evidenceRefresh,
      weeklyPlan,
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
          version: 1,
          tenantSlug,
          model,
          reasoningEffort,
          maxCandidates,
          semrushTransport: "official_mcp_oauth",
          candidateIds
        },
        output: {
          phase: candidateIds.length > 0 ? "AWAITING_CODEX" : "NO_CANDIDATES",
          evidenceRefresh,
          weeklyPlan,
          candidateCount: candidateIds.length,
          preparedAt: new Date().toISOString()
        }
      }
    });

    if (candidateIds.length === 0) {
      await prisma.automationJobRun.update({
        where: { id: job.id },
        data: { status: JobStatus.SUCCESS, finishedAt: new Date() }
      });
    }

    return {
      state: candidateIds.length > 0 ? "ready" as const : "no_candidates" as const,
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
  if (candidateIds.length === 0) throw new Error("The Scout run does not contain an approved candidate scope.");
  const allowed = new Set(candidateIds);

  for (const item of parsed.drafts) {
    if (!allowed.has(item.opportunityId)) throw new Error("Scout returned a draft outside its candidate scope.");
  }
  for (const row of parsed.semrush.rows) {
    if (!allowed.has(row.opportunityId)) throw new Error("SEMrush returned evidence outside the Scout candidate scope.");
  }

  const semrushImport = await persistSemrushEvidence(tenantId, runId, parsed.semrush, allowed);
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
            version: 1,
            runId,
            model: readRecord(job.input).model,
            reasoningEffort: readRecord(job.input).reasoningEffort,
            recommendationSummary: item.recommendationSummary,
            semrushTransport: "official_mcp_oauth"
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

  const teamsMessage = buildWebsiteGrowthScoutTeamsMessage({
    drafts: savedDrafts.map((draft) => ({ id: draft.id, title: draft.title, summary: draft.summary })),
    semrushQueried: parsed.semrush.queried,
    semrushSummary: parsed.semrush.summary,
    sourceSummary: readRecord(job.output).evidenceRefresh,
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
          semrushRowCount: parsed.semrush.rows.length,
          draftIds: savedDrafts.map((draft) => draft.id)
        }
      }
    });
  });

  return {
    runId: job.id,
    draftCount: savedDrafts.length,
    draftIds: savedDrafts.map((draft) => draft.id),
    teamsMessage
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
  const result = await prisma.automationJobRun.updateMany({
    where: { id: runId, tenantId, jobType: JOB_TYPE, status: JobStatus.RUNNING },
    data: {
      status: JobStatus.ERROR,
      finishedAt: new Date(),
      output: { phase: "CODEX_FAILED" },
      errorMessage: message.slice(0, 1000)
    }
  });
  return result.count > 0;
}

export function parseWebsiteGrowthScoutCompletion(value: unknown): WebsiteGrowthScoutCompletion {
  const record = readRecord(value);
  const semrush = readRecord(record.semrush);
  const drafts = Array.isArray(record.drafts) ? record.drafts : null;
  const rows = Array.isArray(semrush.rows) ? semrush.rows : null;

  if (!readRequiredString(record.runSummary, 4000) || semrush.queried !== true || !rows || !drafts) {
    throw new Error("Scout completion did not match the required response structure.");
  }
  if (rows.length > MAX_SEMRUSH_ROWS) throw new Error(`Scout may return at most ${MAX_SEMRUSH_ROWS} SEMrush rows.`);

  return {
    runSummary: readRequiredString(record.runSummary, 4000),
    semrush: {
      queried: semrush.queried,
      summary: readRequiredString(semrush.summary, 4000),
      rows: rows.map(parseSemrushRow)
    },
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
  semrushSummary,
  reviewBaseUrl
}: {
  drafts: Array<{ id: string; title: string; summary: string }>;
  semrushQueried: boolean;
  semrushSummary: string;
  sourceSummary?: unknown;
  reviewBaseUrl: string;
}) {
  if (drafts.length === 0) {
    return "Website Growth Scout completed, but no ideas were promoted for approval this week.";
  }

  const lines = [
    `Website Growth Scout prepared ${drafts.length} idea${drafts.length === 1 ? "" : "s"} for your approval.`,
    `Evidence used: Search Console, GA4, first-party website forms${semrushQueried ? ", and SEMrush MCP" : ""}.`,
    semrushQueried && semrushSummary ? `SEMrush: ${semrushSummary}` : null,
    "",
    ...drafts.flatMap((draft, index) => [
      `${index + 1}. ${draft.title}`,
      draft.summary,
      `${normalizeBaseUrl(reviewBaseUrl)}/website-growth/drafts/${encodeURIComponent(draft.id)}`,
      ""
    ]),
    "Approve a brief only when its content, claims, route, and proposed layout are correct. Approval starts the developer build automatically; it does not merge or publish the page."
  ];

  return lines.filter((line): line is string => line !== null).join("\n").trim();
}

async function persistSemrushEvidence(
  tenantId: string,
  runId: string,
  semrush: WebsiteGrowthScoutCompletion["semrush"],
  allowed: Set<string>
) {
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
          raw: { ...row, transport: "official_mcp_oauth", runId }
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
