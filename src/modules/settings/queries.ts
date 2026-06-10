import { IntegrationProvider } from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";

export async function getSettingsShell(tenant: TenantContext) {
  const moduleAccess = await prisma.tenantModuleAccess.findMany({
    where: tenantWhere(tenant),
    include: {
      module: true
    },
    orderBy: {
      module: {
        name: "asc"
      }
    }
  });

  return {
    modules: moduleAccess.map((access) => ({
      key: access.module.key,
      name: access.module.name,
      enabled: access.enabled
    })),
    integrationProviders: Object.values(IntegrationProvider)
  };
}
