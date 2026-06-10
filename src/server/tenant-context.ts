import { prisma } from "@/server/db";

export type TenantContext = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
};

export async function getCurrentTenantContext(): Promise<TenantContext> {
  // Development-only fallback until authenticated tenant/session resolution exists.
  // The returned tenantId is the required input for all tenant-scoped service calls.
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production tenant resolution requires authenticated membership context.");
  }

  const defaultTenantSlug = process.env.DEFAULT_TENANT_SLUG;

  if (!defaultTenantSlug) {
    throw new Error("DEFAULT_TENANT_SLUG is required for development tenant resolution.");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: defaultTenantSlug },
    select: {
      id: true,
      slug: true,
      name: true
    }
  });

  if (!tenant) {
    throw new Error("Default tenant is missing. Run `npm run prisma:seed` or update DEFAULT_TENANT_SLUG.");
  }

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name
  };
}
