import {
  JobStatus,
  WebsiteGrowthContentDraftStatus,
  WebsiteGrowthOpportunityStatus,
  type Prisma
} from "@prisma/client";

import type { WebsiteGrowthBuildPackage } from "@/modules/website-growth/build-package";
import {
  dispatchWebsiteGrowthDeveloperBuild,
  getWebsiteGrowthDeveloperDispatchStatus
} from "@/modules/website-growth/developer-dispatch";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

const JOB_TYPE = "WEBSITE_GROWTH_DEVELOPER_BUILD";

export type WebsiteGrowthBuildPhase =
  | "QUEUED"
  | "DISPATCHED"
  | "RUNNING"
  | "PR_OPEN"
  | "PREVIEW_READY"
  | "FAILED"
  | "CANCELLED";

type BuildRequestInput = {
  version: 1;
  briefVersion: 1;
  contentDraftId: string;
  opportunityId: string;
  approvedByUserId: string;
  targetRepository: string;
  targetBaseBranch: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  brief: WebsiteGrowthBuildPackage;
};

export async function createAndDispatchWebsiteGrowthBuildRequest({
  context,
  contentDraftId,
  opportunityId,
  brief
}: {
  context: AuthenticatedContext;
  contentDraftId: string;
  opportunityId: string;
  brief: WebsiteGrowthBuildPackage;
}) {
  const existing = await findWebsiteGrowthBuildRequestForDraft(context.tenantId, contentDraftId);
  if (existing && existing.status !== JobStatus.ERROR && existing.status !== JobStatus.CANCELLED) return existing;

  const dispatchConfig = getWebsiteGrowthDeveloperDispatchStatus();
  const input: BuildRequestInput = {
    version: 1,
    briefVersion: 1,
    contentDraftId,
    opportunityId,
    approvedByUserId: context.userId,
    targetRepository: dispatchConfig.repository ?? brief.targetRepo,
    targetBaseBranch: dispatchConfig.baseBranch,
    model: dispatchConfig.model,
    reasoningEffort: dispatchConfig.reasoningEffort,
    brief
  };
  const job = existing
    ? await prisma.automationJobRun.update({
        where: { id: existing.id },
        data: { status: JobStatus.QUEUED, input: input as unknown as Prisma.InputJsonValue, output: { phase: "QUEUED" }, errorMessage: null, finishedAt: null }
      })
    : await prisma.$transaction(async (tx) => {
        const created = await tx.automationJobRun.create({
          data: {
            tenantId: context.tenantId,
            jobType: JOB_TYPE,
            status: JobStatus.QUEUED,
            input: input as unknown as Prisma.InputJsonValue,
            output: { phase: "QUEUED" }
          }
        });
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: "website-growth.build.queued",
            entityType: "AutomationJobRun",
            entityId: created.id,
            after: {
              contentDraftId,
              opportunityId,
              routePath: brief.routePath,
              model: input.model,
              reasoningEffort: input.reasoningEffort
            }
          }
        });
        return created;
      });

  try {
    const dispatched = await dispatchWebsiteGrowthDeveloperBuild({
      buildRequestId: job.id,
      tenantSlug: context.tenantSlug
    });
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.automationJobRun.update({
        where: { id: job.id },
        data: {
          output: {
            phase: "DISPATCHED",
            repository: dispatched.repository,
            workflowFile: dispatched.workflowFile,
            model: dispatched.model,
            reasoningEffort: dispatched.reasoningEffort,
            dispatchedAt: new Date().toISOString()
          },
          errorMessage: null
        }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "website-growth.build.dispatched",
          entityType: "AutomationJobRun",
          entityId: job.id,
          before: { phase: "QUEUED" },
          after: { phase: "DISPATCHED", repository: dispatched.repository, workflowFile: dispatched.workflowFile }
        }
      });
      return updated;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website Growth developer dispatch failed.";
    return prisma.$transaction(async (tx) => {
      const updated = await tx.automationJobRun.update({
        where: { id: job.id },
        data: {
          status: JobStatus.ERROR,
          finishedAt: new Date(),
          output: { phase: "FAILED", errorCode: "DISPATCH_FAILED" },
          errorMessage: message
        }
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: "website-growth.build.failed",
          entityType: "AutomationJobRun",
          entityId: job.id,
          before: { phase: "QUEUED" },
          after: { phase: "FAILED", errorCode: "DISPATCH_FAILED", errorMessage: message }
        }
      });
      return updated;
    });
  }
}

export async function findWebsiteGrowthBuildRequestForDraft(tenantId: string, contentDraftId: string) {
  return prisma.automationJobRun.findFirst({
    where: {
      tenantId,
      jobType: JOB_TYPE,
      input: { path: ["contentDraftId"], equals: contentDraftId }
    },
    orderBy: { createdAt: "desc" }
  });
}

export function summarizeWebsiteGrowthBuildRequest(job: {
  status: JobStatus;
  input: Prisma.JsonValue | null;
  output: Prisma.JsonValue | null;
  errorMessage: string | null;
}) {
  const input = parseBuildRequestInput(job.input);
  return {
    status: job.status,
    phase: readPhase(job.output),
    model: input?.model ?? "Unknown model",
    reasoningEffort: input?.reasoningEffort ?? "unknown",
    errorMessage: job.errorMessage,
    canRetry: job.status === JobStatus.ERROR || job.status === JobStatus.CANCELLED
  };
}

export async function getWebsiteGrowthBuildRequestPackage(requestId: string, tenantSlug: string) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, slug: true } });
  if (!tenant) return null;
  const job = await prisma.automationJobRun.findFirst({
    where: { id: requestId, tenantId: tenant.id, jobType: JOB_TYPE }
  });
  if (!job) return null;
  const input = parseBuildRequestInput(job.input);
  if (!input) throw new Error("Stored Website Growth build request is invalid.");
  const phase = readPhase(job.output);
  const readableStatuses: JobStatus[] = [JobStatus.QUEUED, JobStatus.RUNNING];
  if (!readableStatuses.includes(job.status) || !["DISPATCHED", "RUNNING"].includes(phase)) {
    return null;
  }
  const approvedDraft = await prisma.websiteGrowthContentDraft.findFirst({
    where: {
      id: input.contentDraftId,
      tenantId: tenant.id,
      status: WebsiteGrowthContentDraftStatus.APPROVED
    },
    select: { id: true }
  });
  if (!approvedDraft) return null;

  return {
    id: job.id,
    tenantSlug: tenant.slug,
    status: job.status,
    phase,
    briefVersion: input.briefVersion,
    contentDraftId: input.contentDraftId,
    targetRepository: input.targetRepository,
    targetBaseBranch: input.targetBaseBranch,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    brief: input.brief
  };
}

export async function updateWebsiteGrowthBuildRequestFromWorker({
  requestId,
  tenantSlug,
  update
}: {
  requestId: string;
  tenantSlug: string;
  update: {
    status: "RUNNING" | "PR_OPEN" | "PREVIEW_READY" | "FAILED";
    githubRunUrl?: string;
    pullRequestUrl?: string;
    pullRequestNumber?: number;
    previewUrl?: string;
    commitSha?: string;
    errorCode?: string;
    errorMessage?: string;
  };
}) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
  if (!tenant) return false;
  const job = await prisma.automationJobRun.findFirst({ where: { id: requestId, tenantId: tenant.id, jobType: JOB_TYPE } });
  if (!job) return false;
  const input = parseBuildRequestInput(job.input);
  if (!input) return false;
  validateWorkerTransition(job.status, readPhase(job.output), update.status);

  const nextStatus = update.status === "FAILED" ? JobStatus.ERROR : update.status === "PREVIEW_READY" ? JobStatus.SUCCESS : JobStatus.RUNNING;
  const output = {
    ...readRecord(job.output),
    phase: update.status,
    githubRunUrl: normalizeOptionalUrl(update.githubRunUrl),
    pullRequestUrl: normalizeOptionalUrl(update.pullRequestUrl),
    pullRequestNumber: update.pullRequestNumber,
    previewUrl: normalizeOptionalUrl(update.previewUrl),
    commitSha: update.commitSha?.slice(0, 64),
    errorCode: update.errorCode?.slice(0, 80),
    updatedAt: new Date().toISOString()
  } as Prisma.InputJsonObject;

  await prisma.$transaction(async (tx) => {
    await tx.automationJobRun.update({
      where: { id: job.id },
      data: {
        status: nextStatus,
        output,
        errorMessage: update.status === "FAILED" ? update.errorMessage?.slice(0, 1000) || "Website build failed." : null,
        finishedAt: update.status === "FAILED" || update.status === "PREVIEW_READY" ? new Date() : null
      }
    });
    if (update.status === "PR_OPEN" && update.pullRequestUrl) {
      await tx.websiteGrowthContentDraft.updateMany({
        where: { id: input.contentDraftId, tenantId: tenant.id, status: WebsiteGrowthContentDraftStatus.APPROVED },
        data: { status: WebsiteGrowthContentDraftStatus.BUILT, pullRequestUrl: update.pullRequestUrl }
      });
      await tx.websiteGrowthOpportunity.updateMany({
        where: { id: input.opportunityId, tenantId: tenant.id },
        data: { status: WebsiteGrowthOpportunityStatus.IN_PROGRESS }
      });
    }
    if (update.status === "PREVIEW_READY" && update.previewUrl) {
      await tx.websiteGrowthContentDraft.updateMany({
        where: { id: input.contentDraftId, tenantId: tenant.id },
        data: { builtUrl: update.previewUrl }
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorUserId: null,
        action: `website-growth.build.${update.status.toLowerCase()}`,
        entityType: "AutomationJobRun",
        entityId: job.id,
        before: { status: job.status, phase: readPhase(job.output) },
        after: output
      }
    });
  });
  return true;
}

function parseBuildRequestInput(value: unknown): BuildRequestInput | null {
  const input = readRecord(value);
  if (input.version !== 1 || input.briefVersion !== 1 || typeof input.contentDraftId !== "string" || typeof input.opportunityId !== "string") return null;
  if (typeof input.model !== "string" || typeof input.reasoningEffort !== "string" || typeof input.targetRepository !== "string" || typeof input.targetBaseBranch !== "string") return null;
  if (!readRecord(input.brief).routePath) return null;
  return input as BuildRequestInput;
}

function validateWorkerTransition(currentStatus: JobStatus, currentPhase: WebsiteGrowthBuildPhase, next: WebsiteGrowthBuildPhase) {
  const allowed: Record<WebsiteGrowthBuildPhase, WebsiteGrowthBuildPhase[]> = {
    QUEUED: ["RUNNING", "FAILED"],
    DISPATCHED: ["RUNNING", "FAILED"],
    RUNNING: ["PR_OPEN", "FAILED"],
    PR_OPEN: ["PREVIEW_READY", "FAILED"],
    PREVIEW_READY: [],
    FAILED: [],
    CANCELLED: []
  };
  if (currentStatus === JobStatus.SUCCESS || currentStatus === JobStatus.CANCELLED || !allowed[currentPhase].includes(next)) {
    throw new Error(`Website Growth build cannot move from ${currentPhase} to ${next}.`);
  }
}

function readPhase(value: unknown): WebsiteGrowthBuildPhase {
  const phase = readRecord(value).phase;
  return typeof phase === "string" && ["QUEUED", "DISPATCHED", "RUNNING", "PR_OPEN", "PREVIEW_READY", "FAILED", "CANCELLED"].includes(phase)
    ? phase as WebsiteGrowthBuildPhase
    : "QUEUED";
}

function normalizeOptionalUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
