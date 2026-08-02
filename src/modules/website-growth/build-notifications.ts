import crypto from "node:crypto";

import { Prisma } from "@prisma/client";

import { WEBSITE_GROWTH_BUILD_JOB_TYPE } from "@/modules/website-growth/build-requests";
import { prisma } from "@/server/db";

const NOTIFICATION_VERSION = 1;
const CLAIM_LEASE_MS = 15 * 60 * 1000;
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

export type WebsiteGrowthBuildNotificationEvent =
  | "DISPATCHED"
  | "PREVIEW_READY"
  | "FAILED";

export type WebsiteGrowthBuildNotificationClaim = {
  requestId: string;
  event: WebsiteGrowthBuildNotificationEvent;
  claimToken: string;
  message: string;
};

export async function claimWebsiteGrowthBuildNotification({
  tenantSlug,
  reviewBaseUrl,
  workerId,
  now = new Date()
}: {
  tenantSlug: string;
  reviewBaseUrl: string;
  workerId: string;
  now?: Date;
}): Promise<WebsiteGrowthBuildNotificationClaim | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true }
  });
  if (!tenant) return null;

  const jobs = await prisma.automationJobRun.findMany({
    where: {
      tenantId: tenant.id,
      jobType: WEBSITE_GROWTH_BUILD_JOB_TYPE,
      startedAt: { gte: new Date(now.getTime() - LOOKBACK_MS) }
    },
    orderBy: { startedAt: "asc" },
    take: 100
  });

  for (const job of jobs) {
    const output = readRecord(job.output);
    if (output.notificationVersion !== NOTIFICATION_VERSION) continue;
    const input = readRecord(job.input);
    const event = selectPendingEvent({ output, errorMessage: job.errorMessage, now });
    if (!event) continue;

    const claimToken = crypto.randomUUID();
    const notifications = readRecord(output.teamsNotifications);
    const nextNotifications = {
      ...notifications,
      [event]: {
        ...readRecord(notifications[event]),
        claimedAt: now.toISOString(),
        claimedBy: workerId.slice(0, 100),
        claimToken
      }
    };

    await prisma.automationJobRun.update({
      where: { id: job.id },
      data: {
        output: {
          ...output,
          teamsNotifications: nextNotifications
        } as Prisma.InputJsonObject
      }
    });

    return {
      requestId: job.id,
      event,
      claimToken,
      message: buildNotificationMessage({
        event,
        input,
        output,
        reviewBaseUrl
      })
    };
  }

  return null;
}

export async function acknowledgeWebsiteGrowthBuildNotification({
  tenantSlug,
  requestId,
  event,
  claimToken,
  now = new Date()
}: {
  tenantSlug: string;
  requestId: string;
  event: WebsiteGrowthBuildNotificationEvent;
  claimToken: string;
  now?: Date;
}) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true }
  });
  if (!tenant) return false;
  const job = await prisma.automationJobRun.findFirst({
    where: {
      id: requestId,
      tenantId: tenant.id,
      jobType: WEBSITE_GROWTH_BUILD_JOB_TYPE
    }
  });
  if (!job) return false;

  const output = readRecord(job.output);
  const notifications = readRecord(output.teamsNotifications);
  const eventState = readRecord(notifications[event]);
  if (eventState.claimToken !== claimToken) return false;
  if (typeof eventState.sentAt === "string") return true;

  const nextOutput = {
    ...output,
    teamsNotifications: {
      ...notifications,
      [event]: {
        ...eventState,
        sentAt: now.toISOString()
      }
    }
  } as Prisma.InputJsonObject;

  await prisma.$transaction(async (tx) => {
    await tx.automationJobRun.update({
      where: { id: job.id },
      data: { output: nextOutput }
    });
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: null,
        action: "website-growth.build.teams-notified",
        entityType: "AutomationJobRun",
        entityId: job.id,
        after: { event, sentAt: now.toISOString() }
      }
    });
  });
  return true;
}

function selectPendingEvent({
  output,
  errorMessage,
  now
}: {
  output: Record<string, unknown>;
  errorMessage: string | null;
  now: Date;
}): WebsiteGrowthBuildNotificationEvent | null {
  const notifications = readRecord(output.teamsNotifications);
  const candidates: WebsiteGrowthBuildNotificationEvent[] = [];
  if (output.phase === "FAILED" || errorMessage) {
    candidates.push("FAILED");
  } else if (output.phase === "PREVIEW_READY" && typeof output.previewUrl === "string") {
    candidates.push("PREVIEW_READY");
  } else if (typeof output.dispatchedAt === "string") {
    candidates.push("DISPATCHED");
  }

  for (const event of candidates) {
    const state = readRecord(notifications[event]);
    if (typeof state.sentAt === "string") continue;
    const claimedAt = readDate(state.claimedAt);
    if (claimedAt && now.getTime() - claimedAt.getTime() < CLAIM_LEASE_MS) continue;
    return event;
  }
  return null;
}

function buildNotificationMessage({
  event,
  input,
  output,
  reviewBaseUrl
}: {
  event: WebsiteGrowthBuildNotificationEvent;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  reviewBaseUrl: string;
}) {
  const brief = readRecord(input.brief);
  const routePath = readSafeRoute(brief.routePath);
  const draftId = typeof input.contentDraftId === "string" ? input.contentDraftId : null;
  const reviewUrl = draftId
    ? `${normalizeBaseUrl(reviewBaseUrl)}/website-growth/drafts/${encodeURIComponent(draftId)}`
    : `${normalizeBaseUrl(reviewBaseUrl)}/website-growth`;

  if (event === "DISPATCHED") {
    return `Website Growth build started for ${routePath}. Codex is building the approved brief. Track it in Newl Apps: ${reviewUrl}`;
  }
  if (event === "PREVIEW_READY") {
    const previewUrl = readHttpsUrl(output.previewUrl);
    const pullRequestUrl = readHttpsUrl(output.pullRequestUrl);
    return [
      `Website Growth preview is ready for ${routePath}.`,
      previewUrl ? `Preview: ${previewUrl}` : null,
      pullRequestUrl ? `Draft PR: ${pullRequestUrl}` : null,
      `Review status: ${reviewUrl}`,
      "Nothing is live until you merge the approved PR."
    ].filter(Boolean).join("\n");
  }
  const errorCode = typeof output.errorCode === "string" && output.errorCode.trim()
    ? ` (${output.errorCode.slice(0, 80)})`
    : "";
  return `Website Growth build failed for ${routePath}${errorCode}. Review the recorded failure in Newl Apps: ${reviewUrl}`;
}

function readSafeRoute(value: unknown) {
  return typeof value === "string" && value.startsWith("/")
    ? value.slice(0, 200)
    : "the approved website change";
}

function readHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("Website Growth notification base URL must use HTTPS.");
  }
  return url.origin;
}

function readDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
