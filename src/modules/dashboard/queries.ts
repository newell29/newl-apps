import { LeadPipelineStage } from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";

const TRADEMINING_JOB_TYPE = "trademining.ingestion";
const TRADEMINING_STALE_WINDOW_MS = 1000 * 60 * 60 * 72;

export async function getDashboardSummary(tenant: TenantContext) {
  const [companyCount, openLeadCount, contactCount, recentJobCount, modules, tradeMiningProfiles, tradeMiningJobs] =
    await Promise.all([
    prisma.company.count({ where: tenantWhere(tenant) }),
    prisma.lead.count({
      where: tenantWhere(tenant, {
        stage: {
          notIn: [LeadPipelineStage.WON, LeadPipelineStage.LOST, LeadPipelineStage.DISQUALIFIED]
        }
      })
    }),
    prisma.contact.count({ where: tenantWhere(tenant) }),
    prisma.automationJobRun.count({ where: tenantWhere(tenant) }),
    prisma.tenantModuleAccess.findMany({
      where: tenantWhere(tenant),
      include: {
        module: true
      },
      orderBy: {
        module: {
          name: "asc"
        }
      }
    }),
    prisma.tradeMiningSearchProfile.findMany({
      where: tenantWhere(tenant),
      orderBy: [
        {
          enabled: "desc"
        },
        {
          priorityWeight: "desc"
        },
        {
          name: "asc"
        }
      ]
    }),
    prisma.automationJobRun.findMany({
      where: tenantWhere(tenant, {
        jobType: TRADEMINING_JOB_TYPE
      }),
      orderBy: {
        startedAt: "desc"
      },
      take: 5
    })
  ]);

  const now = Date.now();
  const enabledProfiles = tradeMiningProfiles.filter((profile) => profile.enabled);
  const healthyStatuses = new Set(["SUCCESS", "COMPLETED", "PARTIAL", "RUNNING"]);
  const failingStatuses = new Set(["ERROR", "FAILED", "CANCELLED"]);

  const tradeMiningHealth = {
    enabledProfileCount: enabledProfiles.length,
    recentRunCount: tradeMiningJobs.length,
    healthyProfileCount: enabledProfiles.filter((profile) => {
      if (!profile.lastRunAt) {
        return false;
      }

      return (
        healthyStatuses.has(profile.lastRunStatus ?? "") &&
        now - profile.lastRunAt.getTime() <= TRADEMINING_STALE_WINDOW_MS
      );
    }).length,
    attentionProfileCount: enabledProfiles.filter((profile) => {
      if (!profile.lastRunAt) {
        return true;
      }

      return (
        failingStatuses.has(profile.lastRunStatus ?? "") ||
        now - profile.lastRunAt.getTime() > TRADEMINING_STALE_WINDOW_MS
      );
    }).length,
    lastSuccessfulRunAt:
      tradeMiningJobs.find((job) => job.status === "SUCCESS")?.finishedAt ??
      tradeMiningJobs.find((job) => job.status === "SUCCESS")?.startedAt ??
      null,
    profiles: tradeMiningProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      enabled: profile.enabled,
      scheduleFrequency: profile.scheduleFrequency,
      lastRunAt: profile.lastRunAt,
      lastRunStatus: profile.lastRunStatus ?? (profile.enabled ? "Not run yet" : "Disabled")
    })),
    recentJobs: tradeMiningJobs.map((job) => ({
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      output: job.output,
      errorMessage: job.errorMessage
    }))
  };

  return {
    companyCount,
    openLeadCount,
    contactCount,
    recentJobCount,
    tradeMiningHealth,
    modules: modules.map((access) => ({
      key: access.module.key,
      name: access.module.name,
      description: access.module.description ?? "",
      enabled: access.enabled
    }))
  };
}
