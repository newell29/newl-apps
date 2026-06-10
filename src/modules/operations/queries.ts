import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";

export async function getOperationsLogPreview(tenant: TenantContext) {
  const [jobs, auditLogs] = await Promise.all([
    prisma.automationJobRun.findMany({
      where: tenantWhere(tenant),
      orderBy: {
        startedAt: "desc"
      },
      take: 10
    }),
    prisma.auditLog.findMany({
      where: tenantWhere(tenant),
      orderBy: {
        createdAt: "desc"
      },
      take: 10
    })
  ]);

  return {
    jobs,
    auditLogs
  };
}
