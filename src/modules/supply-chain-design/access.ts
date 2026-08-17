import { ModuleKey, PlatformRole } from "@prisma/client";

import { requireRole } from "@/server/auth/authorization";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { requireModule } from "@/server/auth/authorization";

export const SUPPLY_CHAIN_DESIGN_STUDIO_ALLOWED_ROLES = [PlatformRole.ADMIN, PlatformRole.MANAGER] as const;

export async function requireSupplyChainDesignStudioAccess(context: AuthenticatedContext) {
  await requireModule(context, ModuleKey.SUPPLY_CHAIN_DESIGN);
  requireRole(context, [...SUPPLY_CHAIN_DESIGN_STUDIO_ALLOWED_ROLES]);
}
