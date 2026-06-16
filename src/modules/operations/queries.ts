import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";

export async function getOperationsLogPreview(tenant: TenantContext) {
  const [jobs, auditLogs, profiles] = await Promise.all([
    prisma.automationJobRun.findMany({
      where: tenantWhere(tenant, {
        jobType: "trademining.ingestion"
      }),
      orderBy: {
        startedAt: "desc"
      },
      take: 12
    }),
    prisma.auditLog.findMany({
      where: tenantWhere(tenant),
      orderBy: {
        createdAt: "desc"
      },
      take: 10
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
    })
  ]);

  const successfulJobs = jobs.filter((job) => job.status === "SUCCESS");
  const failingJobs = jobs.filter((job) => job.status === "ERROR" || job.status === "CANCELLED");
  const enabledProfiles = profiles.filter((profile) => profile.enabled);

  return {
    summary: {
      enabledProfileCount: enabledProfiles.length,
      recentRunCount: jobs.length,
      successCount: successfulJobs.length,
      issueCount: failingJobs.length,
      lastSuccessfulRunAt: successfulJobs[0]?.finishedAt ?? successfulJobs[0]?.startedAt ?? null
    },
    jobs,
    profiles,
    auditLogs
  };
}
