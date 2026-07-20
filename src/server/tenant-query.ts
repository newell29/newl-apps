import type { TenantContext } from "@/server/tenant-context";

export function tenantWhere<T extends object>(tenant: Pick<TenantContext, "tenantId">, where?: T): T & { tenantId: string } {
  return {
    ...(where ?? {}),
    tenantId: tenant.tenantId
  } as T & { tenantId: string };
}
