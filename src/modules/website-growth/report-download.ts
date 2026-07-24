import { createHmac, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import {
  normalizeSpreadsheetInput,
  type SpreadsheetInput
} from "@/server/spreadsheet";

const SCOUT_JOB_TYPE = "WEBSITE_GROWTH_SCOUT_WEEKLY";
const DOWNLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type WebsiteGrowthReportName =
  | "seo-performance.xlsx"
  | "semrush-keywords.xlsx";

export class WebsiteGrowthReportDownloadError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WebsiteGrowthReportDownloadError";
    this.status = status;
  }
}

export function buildWebsiteGrowthReportDownloadLinks({
  tenantId,
  runId,
  baseUrl,
  includeKeywordImport,
  now = new Date(),
  env = process.env
}: {
  tenantId: string;
  runId: string;
  baseUrl: string;
  includeKeywordImport: boolean;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}) {
  const expires = now.getTime() + DOWNLOAD_TTL_MS;
  const secret = readDownloadSecret(env);
  const build = (reportName: WebsiteGrowthReportName) => {
    const signature = signReportDownload({ tenantId, runId, reportName, expires, secret });
    const url = new URL(
      `/api/website-growth/scout/runs/${encodeURIComponent(runId)}/reports/${reportName}`,
      normalizeBaseUrl(baseUrl)
    );
    url.searchParams.set("tenant", tenantId);
    url.searchParams.set("expires", String(expires));
    url.searchParams.set("signature", signature);
    return url.toString();
  };

  return {
    performance: build("seo-performance.xlsx"),
    keywordImport: includeKeywordImport ? build("semrush-keywords.xlsx") : null,
    expiresAt: new Date(expires).toISOString()
  };
}

export function verifyWebsiteGrowthReportDownload({
  tenantId,
  runId,
  reportName,
  expires,
  signature,
  now = new Date(),
  env = process.env
}: {
  tenantId: string;
  runId: string;
  reportName: WebsiteGrowthReportName;
  expires: number;
  signature: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}) {
  if (!Number.isSafeInteger(expires) || expires <= now.getTime()) {
    throw new WebsiteGrowthReportDownloadError("This report download link has expired.", 410);
  }
  if (expires > now.getTime() + DOWNLOAD_TTL_MS + 60_000) {
    throw new WebsiteGrowthReportDownloadError("The report download expiry is invalid.", 403);
  }

  const expected = signReportDownload({
    tenantId,
    runId,
    reportName,
    expires,
    secret: readDownloadSecret(env)
  });
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new WebsiteGrowthReportDownloadError("The report download link is invalid.", 403);
  }
}

export async function getWebsiteGrowthScoutReport({
  tenantId,
  runId,
  reportName
}: {
  tenantId: string;
  runId: string;
  reportName: WebsiteGrowthReportName;
}) {
  const job = await prisma.automationJobRun.findFirst({
    where: {
      id: runId,
      tenantId,
      jobType: SCOUT_JOB_TYPE,
      status: "SUCCESS"
    },
    select: { output: true }
  });
  if (!job) {
    throw new WebsiteGrowthReportDownloadError("The Website Growth report was not found.", 404);
  }
  return readWebsiteGrowthScoutReport(job.output, reportName);
}

export function readWebsiteGrowthScoutReport(
  output: Prisma.JsonValue | null,
  reportName: WebsiteGrowthReportName
) {
  const outputRecord = readRecord(output);
  const reports = readRecord(outputRecord.reports);
  const report = reportName === "seo-performance.xlsx"
    ? reports.performance
    : reports.keywordImport;
  if (!report) {
    throw new WebsiteGrowthReportDownloadError("The Website Growth report was not found.", 404);
  }
  return normalizeSpreadsheetInput(report as SpreadsheetInput);
}

function signReportDownload({
  tenantId,
  runId,
  reportName,
  expires,
  secret
}: {
  tenantId: string;
  runId: string;
  reportName: WebsiteGrowthReportName;
  expires: number;
  secret: string;
}) {
  return createHmac("sha256", secret)
    .update(`${tenantId}\n${runId}\n${reportName}\n${expires}`)
    .digest("base64url");
}

function readDownloadSecret(env: NodeJS.ProcessEnv) {
  const secret = (
    env.WEBSITE_GROWTH_REPORT_DOWNLOAD_SECRET ??
    env.OPENCLAW_WEBSITE_GROWTH_TOKEN
  )?.trim();
  if (!secret || secret.length < 32) {
    throw new WebsiteGrowthReportDownloadError(
      "Website Growth report downloads require WEBSITE_GROWTH_REPORT_DOWNLOAD_SECRET or OPENCLAW_WEBSITE_GROWTH_TOKEN with at least 32 characters.",
      503
    );
  }
  return secret;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
