import crypto from "node:crypto";

import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus,
  type Prisma
} from "@prisma/client";

import { prisma } from "@/server/db";

export const MAX_BACKLINK_PROSPECTS_PER_RUN = 15;
export const MAX_ACTIVE_BACKLINK_QUEUE = 50;
export const BACKLINK_REVIEW_RETENTION_DAYS = 45;
export const MIN_BACKLINK_RELEVANCE_SCORE = 60;
export const MIN_BACKLINK_QUALITY_SCORE = 60;

export type WebsiteGrowthBacklinkProspect = {
  sourceDomain: string;
  sourceUrl: string | null;
  contactPage: string | null;
  targetPage: string;
  category: WebsiteGrowthBacklinkCategory;
  title: string;
  rationale: string;
  outreachAngle: string;
  authorityScore: number | null;
  relevanceScore: number;
  qualityScore: number;
  spamRisk: "LOW" | "MEDIUM" | "HIGH";
  estimatedCostAmount: number | null;
  currency: string | null;
  requiresContent: boolean;
  evidence: string[];
};

export type WebsiteGrowthBacklinkReview = {
  queried: true;
  summary: string;
  rawProspectsReviewed: number;
  duplicatesRejected: number;
  qualityRejected: number;
  prospects: WebsiteGrowthBacklinkProspect[];
};

export type WebsiteGrowthBacklinkPersistenceSummary = {
  rawProspectsReviewed: number;
  suppliedByScout: number;
  created: number;
  refreshed: number;
  skippedByQualityGate: number;
  skippedExistingDecision: number;
  archivedAsStale: number;
  activeQueueCount: number;
};

const activeBacklinkStatuses: WebsiteGrowthBacklinkStatus[] = [
  WebsiteGrowthBacklinkStatus.NEEDS_REVIEW,
  WebsiteGrowthBacklinkStatus.APPROVED,
  WebsiteGrowthBacklinkStatus.IN_PROGRESS,
  WebsiteGrowthBacklinkStatus.SUBMITTED,
  WebsiteGrowthBacklinkStatus.CONTACTED,
  WebsiteGrowthBacklinkStatus.REPLIED,
  WebsiteGrowthBacklinkStatus.BLOCKED
];

export function parseWebsiteGrowthBacklinkReview(value: unknown): WebsiteGrowthBacklinkReview {
  const record = readRecord(value);
  const prospects = Array.isArray(record.prospects) ? record.prospects : null;
  if (record.queried !== true || !prospects) {
    throw new Error("Scout completion is missing the required backlink review.");
  }
  if (prospects.length > MAX_BACKLINK_PROSPECTS_PER_RUN) {
    throw new Error(`Scout may return at most ${MAX_BACKLINK_PROSPECTS_PER_RUN} backlink prospects.`);
  }

  return {
    queried: true,
    summary: readRequiredString(record.summary, 4000),
    rawProspectsReviewed: readNonNegativeInteger(record.rawProspectsReviewed),
    duplicatesRejected: readNonNegativeInteger(record.duplicatesRejected),
    qualityRejected: readNonNegativeInteger(record.qualityRejected),
    prospects: prospects.map(parseBacklinkProspect)
  };
}

export function buildWebsiteGrowthBacklinkDedupeKey({
  sourceDomain,
  targetPage
}: Pick<WebsiteGrowthBacklinkProspect, "sourceDomain" | "targetPage">) {
  return crypto
    .createHash("sha256")
    .update(`${normalizeSourceDomain(sourceDomain)}|${normalizeTargetPage(targetPage)}`)
    .digest("hex");
}

export function getWebsiteGrowthBacklinkQualificationFailure(
  prospect: WebsiteGrowthBacklinkProspect
) {
  const sourceDomain = normalizeSourceDomain(prospect.sourceDomain);
  if (sourceDomain === "newlgroup.com" || sourceDomain.endsWith(".newlgroup.com")) {
    return "Newl cannot be its own referring domain.";
  }
  if (prospect.relevanceScore < MIN_BACKLINK_RELEVANCE_SCORE) {
    return `Relevance must be at least ${MIN_BACKLINK_RELEVANCE_SCORE}.`;
  }
  if (prospect.qualityScore < MIN_BACKLINK_QUALITY_SCORE) {
    return `Quality must be at least ${MIN_BACKLINK_QUALITY_SCORE}.`;
  }
  if (prospect.spamRisk === "HIGH") {
    return "High-spam-risk prospects are never added to the review queue.";
  }
  return null;
}

export async function persistWebsiteGrowthBacklinkReview({
  tenantId,
  runId,
  review,
  now = new Date()
}: {
  tenantId: string;
  runId: string;
  review: WebsiteGrowthBacklinkReview;
  now?: Date;
}): Promise<WebsiteGrowthBacklinkPersistenceSummary> {
  const qualified = review.prospects.filter(
    (prospect) => getWebsiteGrowthBacklinkQualificationFailure(prospect) === null
  );
  let skippedByQualityGate = review.prospects.length - qualified.length;
  const dedupeKeys = qualified.map(buildWebsiteGrowthBacklinkDedupeKey);
  const existing = dedupeKeys.length > 0
    ? await prisma.websiteGrowthBacklinkOpportunity.findMany({
        where: { tenantId, dedupeKey: { in: dedupeKeys } }
      })
    : [];
  const existingByKey = new Map(existing.map((item) => [item.dedupeKey, item]));
  let activeQueueCount = await prisma.websiteGrowthBacklinkOpportunity.count({
    where: { tenantId, status: { in: activeBacklinkStatuses } }
  });
  let created = 0;
  let refreshed = 0;
  let skippedExistingDecision = 0;

  for (const prospect of qualified) {
    const dedupeKey = buildWebsiteGrowthBacklinkDedupeKey(prospect);
    const current = existingByKey.get(dedupeKey);
    const evidence = {
      transport: "official_mcp_oauth",
      runId,
      reviewedAt: now.toISOString(),
      rows: prospect.evidence
    } as Prisma.InputJsonValue;

    if (current) {
      if (
        current.status === WebsiteGrowthBacklinkStatus.REJECTED ||
        current.status === WebsiteGrowthBacklinkStatus.ARCHIVED ||
        current.status === WebsiteGrowthBacklinkStatus.LIVE
      ) {
        skippedExistingDecision += 1;
        continue;
      }
      await prisma.websiteGrowthBacklinkOpportunity.updateMany({
        where: { id: current.id, tenantId },
        data: {
          lastSeenAt: now,
          title: prospect.title,
          sourceUrl: prospect.sourceUrl,
          contactPage: prospect.contactPage,
          category: prospect.category,
          rationale: prospect.rationale,
          outreachAngle: prospect.outreachAngle,
          authorityScore: prospect.authorityScore,
          relevanceScore: prospect.relevanceScore,
          qualityScore: prospect.qualityScore,
          spamRisk: prospect.spamRisk,
          estimatedCostAmount: prospect.estimatedCostAmount,
          currency: prospect.currency,
          requiresContent: prospect.requiresContent,
          evidence
        }
      });
      refreshed += 1;
      continue;
    }

    if (activeQueueCount >= MAX_ACTIVE_BACKLINK_QUEUE) {
      skippedByQualityGate += 1;
      continue;
    }

    await prisma.websiteGrowthBacklinkOpportunity.create({
      data: {
        tenantId,
        dedupeKey,
        firstSeenAt: now,
        lastSeenAt: now,
        category: prospect.category,
        title: prospect.title,
        sourceDomain: prospect.sourceDomain,
        sourceUrl: prospect.sourceUrl,
        contactPage: prospect.contactPage,
        targetPage: prospect.targetPage,
        rationale: prospect.rationale,
        outreachAngle: prospect.outreachAngle,
        authorityScore: prospect.authorityScore,
        relevanceScore: prospect.relevanceScore,
        qualityScore: prospect.qualityScore,
        spamRisk: prospect.spamRisk,
        estimatedCostAmount: prospect.estimatedCostAmount,
        currency: prospect.currency,
        requiresContent: prospect.requiresContent,
        evidence
      }
    });
    created += 1;
    activeQueueCount += 1;
  }

  const staleBefore = new Date(now.getTime() - BACKLINK_REVIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const archived = await prisma.websiteGrowthBacklinkOpportunity.updateMany({
    where: {
      tenantId,
      status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW,
      lastSeenAt: { lt: staleBefore }
    },
    data: {
      status: WebsiteGrowthBacklinkStatus.ARCHIVED,
      archivedAt: now,
      notes: `Archived automatically after ${BACKLINK_REVIEW_RETENTION_DAYS} days without renewed Scout evidence.`
    }
  });
  activeQueueCount -= archived.count;

  return {
    rawProspectsReviewed: review.rawProspectsReviewed,
    suppliedByScout: review.prospects.length,
    created,
    refreshed,
    skippedByQualityGate,
    skippedExistingDecision,
    archivedAsStale: archived.count,
    activeQueueCount: Math.max(0, activeQueueCount)
  };
}

export async function getWebsiteGrowthBacklinkWorkspace(tenantId: string) {
  const [
    opportunities,
    latestScoutRun,
    statusCounts
  ] = await Promise.all([
    prisma.websiteGrowthBacklinkOpportunity.findMany({
      where: {
        tenantId,
        status: {
          notIn: [
            WebsiteGrowthBacklinkStatus.REJECTED,
            WebsiteGrowthBacklinkStatus.ARCHIVED
          ]
        }
      },
      orderBy: [{ qualityScore: "desc" }, { lastSeenAt: "desc" }],
      take: 100
    }),
    prisma.automationJobRun.findFirst({
      where: { tenantId, jobType: "WEBSITE_GROWTH_SCOUT_WEEKLY" },
      orderBy: { startedAt: "desc" }
    }),
    prisma.websiteGrowthBacklinkOpportunity.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true }
    })
  ]);

  return {
    opportunities,
    latestScoutRun,
    statusCounts: Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all]))
  };
}

export function buildWebsiteGrowthBacklinkTeamsLines({
  review,
  persisted,
  reviewBaseUrl
}: {
  review: WebsiteGrowthBacklinkReview;
  persisted: WebsiteGrowthBacklinkPersistenceSummary;
  reviewBaseUrl: string;
}) {
  const lines = [
    "",
    `Backlink Scout: ${persisted.rawProspectsReviewed} prospects reviewed; ${review.duplicatesRejected} duplicates and ${review.qualityRejected + persisted.skippedByQualityGate} weak or risky prospects removed.`,
    `${persisted.created} new curated prospect${persisted.created === 1 ? "" : "s"} need review; ${persisted.refreshed} existing prospect${persisted.refreshed === 1 ? "" : "s"} refreshed; ${persisted.activeQueueCount} active items remain in the bounded queue.`,
    review.summary,
    persisted.created > 0
      ? `${normalizeBaseUrl(reviewBaseUrl)}/website-growth/backlinks`
      : "No new backlink decision is required this week."
  ];
  return lines.join("\n");
}

function parseBacklinkProspect(value: unknown): WebsiteGrowthBacklinkProspect {
  const record = readRecord(value);
  const category = readBacklinkCategory(record.category);
  const spamRisk = readRequiredString(record.spamRisk, 20).toUpperCase();
  if (spamRisk !== "LOW" && spamRisk !== "MEDIUM" && spamRisk !== "HIGH") {
    throw new Error("Backlink spam risk must be LOW, MEDIUM, or HIGH.");
  }

  return {
    sourceDomain: normalizeSourceDomain(readRequiredString(record.sourceDomain, 300)),
    sourceUrl: readOptionalUrl(record.sourceUrl),
    contactPage: readOptionalUrl(record.contactPage),
    targetPage: normalizeTargetPage(readRequiredString(record.targetPage, 1000)),
    category,
    title: readRequiredString(record.title, 300),
    rationale: readRequiredString(record.rationale, 2000),
    outreachAngle: readRequiredString(record.outreachAngle, 2000),
    authorityScore: readOptionalScore(record.authorityScore),
    relevanceScore: readScore(record.relevanceScore),
    qualityScore: readScore(record.qualityScore),
    spamRisk,
    estimatedCostAmount: readOptionalNonNegativeNumber(record.estimatedCostAmount),
    currency: readOptionalString(record.currency, 10)?.toUpperCase() ?? null,
    requiresContent: record.requiresContent === true,
    evidence: readStringArray(record.evidence).slice(0, 10)
  };
}

function normalizeSourceDomain(value: string) {
  const candidate = value.includes("://") ? value : `https://${value}`;
  let hostname: string;
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    throw new Error("Backlink sourceDomain must be a valid hostname.");
  }
  return hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function normalizeTargetPage(value: string) {
  if (value.startsWith("/")) return value.replace(/\/+$/, "") || "/";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Backlink targetPage must be a Newl URL or route.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "newlgroup.com") {
    throw new Error("Backlink targetPage must belong to newlgroup.com.");
  }
  return parsed.pathname.replace(/\/+$/, "") || "/";
}

function readBacklinkCategory(value: unknown) {
  if (
    typeof value !== "string" ||
    !Object.values(WebsiteGrowthBacklinkCategory).includes(value as WebsiteGrowthBacklinkCategory)
  ) {
    throw new Error("Backlink prospect has an invalid category.");
  }
  return value as WebsiteGrowthBacklinkCategory;
}

function readOptionalUrl(value: unknown) {
  const text = readOptionalString(value, 1000);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
    return parsed.toString();
  } catch {
    throw new Error("Backlink URL fields must be valid HTTP or HTTPS URLs.");
  }
}

function readScore(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Backlink scores must be numbers from 0 to 100.");
  }
  return Math.round(value);
}

function readOptionalScore(value: unknown) {
  return value === null || value === undefined ? null : readScore(value);
}

function readOptionalNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Backlink cost must be a non-negative number or null.");
  }
  return Math.round(value * 100) / 100;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRequiredString(value: unknown, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Backlink review is missing a required text field.");
  }
  return value.trim().slice(0, maxLength);
}

function readOptionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function readNonNegativeInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Backlink review counts must be non-negative numbers.");
  }
  return Math.round(value);
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}
