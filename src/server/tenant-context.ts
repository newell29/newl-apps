import { prisma } from "@/server/db";

export type TenantContext = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
};

const DEFAULT_TENANT_SLUG = "newl-group";

export async function getCurrentTenantContext(): Promise<TenantContext> {
  // TODO: Replace this seeded tenant fallback with authenticated membership lookup.
  // The returned tenantId is the required input for all tenant-scoped service calls.
  const tenant = await prisma.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
    select: {
      id: true,
      slug: true,
      name: true
    }
  });

  if (!tenant) {
    throw new Error("Default tenant is missing. Run `npm run prisma:seed`.");
  }

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name
  };
}
