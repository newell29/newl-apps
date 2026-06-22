import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";
import { summarizeTradeMiningDataQuality } from "@/modules/operations/trademining-data-quality";

export async function getOperationsLogPreview(tenant: TenantContext) {
  const [jobs, auditLogs, profiles, importRecords] = await Promise.all([
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
    }),
    prisma.tradeMiningImportRecord.findMany({
      where: tenantWhere(tenant),
      include: {
        company: {
          select: {
            name: true
          }
        }
      },
      orderBy: [
        {
          createdAt: "desc"
        },
        {
          arrivalDate: "desc"
        }
      ],
      take: 50
    })
  ]);

  const successfulJobs = jobs.filter((job) => job.status === "SUCCESS");
  const failingJobs = jobs.filter((job) => job.status === "ERROR" || job.status === "CANCELLED");
  const enabledProfiles = profiles.filter((profile) => profile.enabled);
  const dataQuality = summarizeTradeMiningDataQuality(importRecords);

  return {
    summary: {
      enabledProfileCount: enabledProfiles.length,
      recentRunCount: jobs.length,
      successCount: successfulJobs.length,
      issueCount: failingJobs.length,
      lastSuccessfulRunAt: successfulJobs[0]?.finishedAt ?? successfulJobs[0]?.startedAt ?? null
    },
    dataQuality,
    jobs,
    profiles,
    auditLogs
  };
}
