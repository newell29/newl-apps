import { ModuleKey, PlatformRole } from "@prisma/client";
import { AuthorityBoard } from "@/modules/website-growth/authority/board";
import { authorityWorkspace } from "@/modules/website-growth/authority/store";
import { requireModule, resolveRoleCanMutate } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
export const dynamic = "force-dynamic";
export default async function WebsiteGrowthBacklinksPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  const workspace = await authorityWorkspace(context.tenantId);
  const canReview = ([PlatformRole.ADMIN, PlatformRole.MANAGER] as PlatformRole[]).includes(context.role) && await resolveRoleCanMutate(context.tenantId, context.role);
  return <AuthorityBoard workspace={workspace} canReview={canReview} />;
}
