import { LeadPipelineStage } from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";

export async function getDashboardSummary(tenant: TenantContext) {
  const [companyCount, openLeadCount, contactCount, recentJobCount, modules] = await Promise.all([
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
    })
  ]);

  return {
    companyCount,
    openLeadCount,
    contactCount,
    recentJobCount,
    modules: modules.map((access) => ({
      key: access.module.key,
      name: access.module.name,
      description: access.module.description ?? "",
      enabled: access.enabled
    }))
  };
}
