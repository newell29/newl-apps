import { createHash } from "node:crypto";

import {
  WebsiteGrowthDataSource,
  WebsiteGrowthImportStatus,
  type Prisma
} from "@prisma/client";

import type { WebsiteGrowthSemrushTrackingSnapshot } from "@/modules/website-growth/keyword-tracking";
import { prisma } from "@/server/db";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import {
  fetchMicrosoftGraphMailboxFolderMessages,
  fetchMicrosoftGraphMessageAttachmentContent,
  fetchMicrosoftGraphMessageAttachments,
  type MicrosoftGraphMailAttachment,
  type MicrosoftGraphMailMessage
} from "@/server/integrations/microsoft-graph-mail";
import { extractPdfTextPagesFromBytes } from "@/server/pdf-text";

const DEFAULT_MAILBOX = "partnerships@newlgroup.com";
const DEFAULT_FOLDER = "Inbox/Semrush";
const ALLOWED_SENDER = "mail@semrush.com";
const LOOKBACK_DAYS = 21;
const MAX_MESSAGES = 50;
const MAX_ATTACHMENTS_PER_RUN = 10;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_EXCERPT_LENGTH = 6_000;
const MAX_ERROR_LENGTH = 500;

export type SemrushScheduledReportType =
  | "POSITION_TRACKING"
  | "SITE_AUDIT"
  | "BACKLINKS"
  | "ORGANIC_POSITIONS"
  | "SEO_OVERVIEW"
  | "UNKNOWN";

export type SemrushScheduledReport = {
  reportType: SemrushScheduledReportType;
  subject: string;
  observedAt: string;
  metrics: Record<string, number>;
  excerpt: string;
  snapshot: WebsiteGrowthSemrushTrackingSnapshot | null;
};

export type SemrushScheduledReportSyncResult = {
  status: "SUCCESS" | "ERROR";
  messagesSeen: number;
  eligibleMessages: number;
  attachmentsSeen: number;
  imported: number;
  duplicates: number;
  skipped: number;
  failed: number;
  latestObservedAt: string | null;
  error?: string;
};

type SemrushMailReportDependencies = {
  accessTokenProvider?: () => Promise<string>;
  messageFetcher?: (
    accessToken: string,
    mailbox: string,
    folderPath: string,
    options: { lookbackDays: number; maxMessagesPerMailbox: number }
  ) => Promise<MicrosoftGraphMailMessage[]>;
  attachmentFetcher?: (
    accessToken: string,
    mailbox: string,
    messageId: string
  ) => Promise<MicrosoftGraphMailAttachment[]>;
  contentFetcher?: (
    accessToken: string,
    mailbox: string,
    messageId: string,
    attachmentId: string
  ) => Promise<{ contentBytes?: string | null }>;
  pdfExtractor?: (
    bytes: Uint8Array
  ) => Promise<{ pageCount: number; pages: Array<{ pageNumber: number; text: string }> }>;
};

export function parseSemrushScheduledReportText({
  subject,
  fileName,
  text,
  observedAt
}: {
  subject: string | null | undefined;
  fileName: string | null | undefined;
  text: string;
  observedAt: string;
}): SemrushScheduledReport {
  const normalizedText = normalizeReportText(text);
  const safeSubject = sanitizeText(subject || fileName || "SEMrush scheduled report", 300);
  const haystack = `${safeSubject}\n${fileName ?? ""}\n${normalizedText}`.toLowerCase();
  const reportType = classifyReport(haystack);
  const metrics = parseReportMetrics(reportType, normalizedText);
  const snapshot = reportType === "POSITION_TRACKING"
    ? buildPositionTrackingSnapshot(metrics, normalizedText)
    : null;

  return {
    reportType,
    subject: safeSubject,
    observedAt: readTimestamp(observedAt),
    metrics,
    excerpt: sanitizeText(normalizedText, MAX_EXCERPT_LENGTH),
    snapshot
  };
}

export async function syncWebsiteGrowthSemrushScheduledReports({
  tenantId,
  now = new Date(),
  dependencies = {}
}: {
  tenantId: string;
  now?: Date;
  dependencies?: SemrushMailReportDependencies;
}): Promise<SemrushScheduledReportSyncResult> {
  const mailbox = process.env.WEBSITE_GROWTH_SEMRUSH_MAILBOX?.trim() || DEFAULT_MAILBOX;
  const folderPath = process.env.WEBSITE_GROWTH_SEMRUSH_MAIL_FOLDER?.trim() || DEFAULT_FOLDER;
  const accessToken = await (dependencies.accessTokenProvider ?? getMicrosoftGraphApplicationAccessToken)();
  const messages = await (dependencies.messageFetcher ?? fetchMicrosoftGraphMailboxFolderMessages)(
    accessToken,
    mailbox,
    folderPath,
    { lookbackDays: LOOKBACK_DAYS, maxMessagesPerMailbox: MAX_MESSAGES }
  );
  const eligibleMessages = messages.filter((message) =>
    message.from?.emailAddress?.address?.trim().toLowerCase() === ALLOWED_SENDER &&
    message.hasAttachments === true
  );
  const recentImports = await prisma.websiteGrowthDataImport.findMany({
    where: {
      tenantId,
      source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD,
      createdAt: { gte: new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000) }
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { summary: true }
  });
  const contentHashes = new Set(
    recentImports
      .map((item) => readString(readRecord(item.summary).contentHash))
      .filter((value): value is string => Boolean(value))
  );
  const result: SemrushScheduledReportSyncResult = {
    status: "SUCCESS",
    messagesSeen: messages.length,
    eligibleMessages: eligibleMessages.length,
    attachmentsSeen: 0,
    imported: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    latestObservedAt: null
  };

  for (const message of eligibleMessages) {
    if (result.attachmentsSeen >= MAX_ATTACHMENTS_PER_RUN) break;
    let attachments: MicrosoftGraphMailAttachment[];
    try {
      attachments = await (dependencies.attachmentFetcher ?? fetchMicrosoftGraphMessageAttachments)(
        accessToken,
        mailbox,
        message.id
      );
    } catch (error) {
      result.failed += 1;
      await recordSemrushMailImportError({
        tenantId,
        now,
        fileName: "SEMrush scheduled report attachment list",
        folderPath,
        error
      });
      continue;
    }

    for (const attachment of attachments) {
      if (result.attachmentsSeen >= MAX_ATTACHMENTS_PER_RUN) break;
      result.attachmentsSeen += 1;
      if (!isEligiblePdfAttachment(attachment)) {
        result.skipped += 1;
        continue;
      }

      let attachmentContentHash: string | null = null;
      try {
        const content = await (dependencies.contentFetcher ?? fetchMicrosoftGraphMessageAttachmentContent)(
          accessToken,
          mailbox,
          message.id,
          attachment.id
        );
        const bytes = Buffer.from(content.contentBytes ?? "", "base64");
        if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES || bytes.subarray(0, 4).toString() !== "%PDF") {
          throw new Error("The attachment was empty, too large, or not a valid PDF.");
        }
        attachmentContentHash = createHash("sha256").update(bytes).digest("hex");
        if (contentHashes.has(attachmentContentHash)) {
          result.duplicates += 1;
          continue;
        }
        const extracted = await (dependencies.pdfExtractor ?? extractPdfTextPagesFromBytes)(bytes);
        const observedAt = readTimestamp(message.receivedDateTime ?? now.toISOString());
        const report = parseSemrushScheduledReportText({
          subject: message.subject,
          fileName: attachment.name,
          text: extracted.pages.map((page) => page.text).join("\n"),
          observedAt
        });
        const summary: Prisma.InputJsonObject = {
          runType: "semrush_scheduled_email_report",
          transport: "microsoft_graph_scheduled_report",
          sender: ALLOWED_SENDER,
          mailboxFolder: folderPath,
          observedAt: report.observedAt,
          contentHash: attachmentContentHash,
          reportType: report.reportType,
          subject: report.subject,
          pageCount: extracted.pageCount,
          metrics: report.metrics,
          excerpt: report.excerpt,
          rawEmailStored: false,
          attachmentStored: false,
          ...(report.snapshot ? { snapshot: report.snapshot as unknown as Prisma.InputJsonObject } : {})
        };
        await prisma.websiteGrowthDataImport.create({
          data: {
            tenantId,
            source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD,
            status: WebsiteGrowthImportStatus.SUCCESS,
            fileName: sanitizeFileName(attachment.name),
            rowCount: Object.keys(report.metrics).length,
            summary,
            startedAt: now,
            completedAt: now
          }
        });
        contentHashes.add(attachmentContentHash);
        result.imported += 1;
        result.latestObservedAt = maxTimestamp(result.latestObservedAt, report.observedAt);
      } catch (error) {
        result.failed += 1;
        await recordSemrushMailImportError({
          tenantId,
          now,
          fileName: attachment.name,
          folderPath,
          contentHash: attachmentContentHash,
          error
        });
        if (attachmentContentHash) contentHashes.add(attachmentContentHash);
      }
    }
  }

  return result;
}

export async function safeSyncWebsiteGrowthSemrushScheduledReports(input: {
  tenantId: string;
  now?: Date;
  dependencies?: SemrushMailReportDependencies;
}): Promise<SemrushScheduledReportSyncResult> {
  try {
    return await syncWebsiteGrowthSemrushScheduledReports(input);
  } catch (error) {
    const now = input.now ?? new Date();
    const folderPath = process.env.WEBSITE_GROWTH_SEMRUSH_MAIL_FOLDER?.trim() || DEFAULT_FOLDER;
    await recordSemrushMailImportError({
      tenantId: input.tenantId,
      now,
      fileName: "SEMrush scheduled report mailbox sync",
      folderPath,
      error
    }).catch(() => undefined);
    return {
      status: "ERROR",
      messagesSeen: 0,
      eligibleMessages: 0,
      attachmentsSeen: 0,
      imported: 0,
      duplicates: 0,
      skipped: 0,
      failed: 1,
      latestObservedAt: null,
      error: sanitizeError(error)
    };
  }
}

function classifyReport(haystack: string): SemrushScheduledReportType {
  if (/position tracking|visibility trend|ranking distribution/.test(haystack)) return "POSITION_TRACKING";
  if (/site audit|site health|crawlability|thematic report/.test(haystack)) return "SITE_AUDIT";
  if (/backlink|referring domain|authority score/.test(haystack)) return "BACKLINKS";
  if (/organic research|organic positions|organic search positions/.test(haystack)) return "ORGANIC_POSITIONS";
  if (/seo overview|seo dashboard|domain overview|monthly seo/.test(haystack)) return "SEO_OVERVIEW";
  return "UNKNOWN";
}

function parseReportMetrics(type: SemrushScheduledReportType, text: string) {
  const metrics: Record<string, number> = {};
  const definitions: Array<[string, RegExp]> = type === "POSITION_TRACKING"
    ? [
        ["visibility", /(?:visibility(?:\s+score)?)[^\d]{0,30}([\d,.]+)\s*%/i],
        ["top3", /(?:top\s*3)[^\d]{0,30}([\d,]+)/i],
        ["top10", /(?:top\s*10)[^\d]{0,30}([\d,]+)/i],
        ["top20", /(?:top\s*20)[^\d]{0,30}([\d,]+)/i],
        ["top100", /(?:top\s*100)[^\d]{0,30}([\d,]+)/i],
        ["improved", /(?:improved|positive impact)[^\d]{0,30}([\d,]+)/i],
        ["declined", /(?:declined|negative impact)[^\d]{0,30}([\d,]+)/i],
        ["trackedKeywordCount", /(?:tracked keywords|keywords tracked|total keywords)[^\d]{0,30}([\d,]+)/i]
      ]
    : type === "SITE_AUDIT"
      ? [
          ["siteHealth", /(?:site health)[^\d]{0,30}([\d,.]+)\s*%/i],
          ["errors", /(?:errors)[^\d]{0,30}([\d,]+)/i],
          ["warnings", /(?:warnings)[^\d]{0,30}([\d,]+)/i],
          ["notices", /(?:notices)[^\d]{0,30}([\d,]+)/i],
          ["crawledPages", /(?:crawled pages|pages crawled)[^\d]{0,30}([\d,]+)/i]
        ]
      : type === "BACKLINKS"
        ? [
            ["authorityScore", /(?:authority score)[^\d]{0,30}([\d,.]+)/i],
            ["referringDomains", /(?:referring domains)[^\d]{0,30}([\d,.kKmM]+)/i],
            ["backlinks", /(?:backlinks)[^\d]{0,30}([\d,.kKmM]+)/i],
            ["referringIps", /(?:referring ips)[^\d]{0,30}([\d,.kKmM]+)/i]
          ]
        : [
            ["organicKeywords", /(?:organic keywords|keywords)[^\d]{0,30}([\d,.kKmM]+)/i],
            ["organicTraffic", /(?:organic traffic|traffic)[^\d]{0,30}([\d,.kKmM]+)/i],
            ["trafficCost", /(?:traffic cost)[^\d$]{0,30}\$?([\d,.kKmM]+)/i]
          ];

  for (const [name, pattern] of definitions) {
    const value = parseCompactNumber(text.match(pattern)?.[1]);
    if (value !== null) metrics[name] = value;
  }
  return metrics;
}

function buildPositionTrackingSnapshot(
  metrics: Record<string, number>,
  text: string
): WebsiteGrowthSemrushTrackingSnapshot {
  return {
    projectId: null,
    campaignId: null,
    domain: readDomain(text),
    database: null,
    device: null,
    visibility: metrics.visibility ?? null,
    previousVisibility: null,
    top3: Math.round(metrics.top3 ?? 0),
    top10: Math.round(metrics.top10 ?? 0),
    top20: Math.round(metrics.top20 ?? 0),
    top100: Math.round(metrics.top100 ?? metrics.trackedKeywordCount ?? 0),
    improved: Math.round(metrics.improved ?? 0),
    declined: Math.round(metrics.declined ?? 0),
    entered: 0,
    lost: 0,
    trackedKeywords: []
  };
}

function isEligiblePdfAttachment(attachment: MicrosoftGraphMailAttachment) {
  return attachment.isInline !== true &&
    (attachment.contentType?.toLowerCase() === "application/pdf" || attachment.name?.toLowerCase().endsWith(".pdf")) &&
    (attachment.size ?? 0) > 0 &&
    (attachment.size ?? 0) <= MAX_ATTACHMENT_BYTES;
}

async function recordSemrushMailImportError({
  tenantId,
  now,
  fileName,
  folderPath,
  contentHash = null,
  error
}: {
  tenantId: string;
  now: Date;
  fileName?: string | null;
  folderPath: string;
  contentHash?: string | null;
  error: unknown;
}) {
  const errorMessage = sanitizeError(error);
  return prisma.websiteGrowthDataImport.create({
    data: {
      tenantId,
      source: WebsiteGrowthDataSource.SEMRUSH_UPLOAD,
      status: WebsiteGrowthImportStatus.ERROR,
      fileName: sanitizeFileName(fileName),
      rowCount: 0,
      summary: {
        runType: "semrush_scheduled_email_report",
        transport: "microsoft_graph_scheduled_report",
        sender: ALLOWED_SENDER,
        mailboxFolder: folderPath,
        ...(contentHash ? { contentHash } : {}),
        rawEmailStored: false,
        attachmentStored: false
      },
      errorMessage,
      startedAt: now,
      completedAt: now
    }
  });
}

function normalizeReportText(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeText(value: string, maxLength: number) {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email removed]")
    .replace(/https?:\/\/[^\s)]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "[link removed]";
      }
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : "SEMrush scheduled report import failed.";
  return sanitizeText(message.replace(/[A-Za-z0-9_-]{40,}/g, "[identifier removed]"), MAX_ERROR_LENGTH);
}

function sanitizeFileName(value: string | null | undefined) {
  const safe = (value ?? "SEMrush scheduled report.pdf")
    .replace(/[\\/\0]/g, "-")
    .replace(/[^A-Za-z0-9 ._()-]/g, "")
    .trim();
  return safe.slice(0, 240) || "SEMrush scheduled report.pdf";
}

function parseCompactNumber(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").trim();
  const suffix = normalized.slice(-1).toLowerCase();
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
  const numeric = Number.parseFloat(multiplier === 1 ? normalized : normalized.slice(0, -1));
  return Number.isFinite(numeric) ? numeric * multiplier : null;
}

function readDomain(text: string) {
  return text.match(/(?:domain|root domain)[^A-Za-z0-9]{0,20}((?:www\.)?[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i)?.[1]?.toLowerCase() ?? null;
}

function readTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function maxTimestamp(left: string | null, right: string) {
  if (!left) return right;
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
