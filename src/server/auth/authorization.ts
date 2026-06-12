import { ModuleKey, PlatformRole } from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

/**
 * Thrown when an authenticated user lacks permission for an action. The status
 * helps API/route handlers translate it to an HTTP response if needed.
 */
export class AuthorizationError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

type RolePolicy = {
  /** Module keys this role may access (read). */
  modules: ModuleKey[] | "ALL";
  /** Whether the role may perform any write/mutation at all. */
  canMutate: boolean;
};

const ALL_MODULES: ModuleKey[] = Object.values(ModuleKey);

/**
 * Accepted role matrix (per the approved auth plan, Section 5).
 *
 * - ADMIN: full platform access including tenant administration.
 * - MANAGER: all modules, may mutate.
 * - SALES: lead generation module, may mutate within it.
 * - OPERATIONS: lead generation + operational tooling modules, may mutate.
 * - FINANCE: finance modules (invoice verification, QuickBooks), may mutate.
 * - READ_ONLY: may view all tenant data but may never mutate.
 *
 * Effective write access to a module requires BOTH module access AND canMutate,
 * AND that the tenant has the module enabled (see requireModule).
 */
export const ROLE_MATRIX: Record<PlatformRole, RolePolicy> = {
  [PlatformRole.ADMIN]: { modules: "ALL", canMutate: true },
  [PlatformRole.MANAGER]: { modules: "ALL", canMutate: true },
  [PlatformRole.SALES]: { modules: [ModuleKey.LEAD_GEN], canMutate: true },
  [PlatformRole.OPERATIONS]: {
    modules: [ModuleKey.LEAD_GEN, ModuleKey.UPS_TOOLS, ModuleKey.TRANSIT_LOOKUP],
    canMutate: true
  },
  [PlatformRole.FINANCE]: {
    modules: [ModuleKey.INVOICE_VERIFICATION, ModuleKey.QUICKBOOKS_POSTING],
    canMutate: true
  },
  [PlatformRole.READ_ONLY]: { modules: "ALL", canMutate: false }
};

export function roleHasModuleAccess(role: PlatformRole, moduleKey: ModuleKey): boolean {
  const policy = ROLE_MATRIX[role];
  return policy.modules === "ALL" || policy.modules.includes(moduleKey);
}

export function roleCanMutate(role: PlatformRole): boolean {
  return ROLE_MATRIX[role].canMutate;
}

/** Module keys the role can access, resolved to a concrete list. */
export function accessibleModuleKeys(role: PlatformRole): ModuleKey[] {
  const policy = ROLE_MATRIX[role];
  return policy.modules === "ALL" ? [...ALL_MODULES] : [...policy.modules];
}

/** Require the context's role to be one of the allowed roles. */
export function requireRole(ctx: AuthenticatedContext, allowed: PlatformRole[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new AuthorizationError(
      `Role ${ctx.role} is not permitted to perform this action.`
    );
  }
}

/** Require tenant administrator privileges. */
export function requireAdmin(ctx: AuthenticatedContext): void {
  requireRole(ctx, [PlatformRole.ADMIN]);
}

/** Require the role to be allowed to mutate (i.e. not READ_ONLY). */
export function requireMutationAccess(ctx: AuthenticatedContext): void {
  if (!roleCanMutate(ctx.role)) {
    throw new AuthorizationError("Read-only users cannot perform this action.");
  }
}

/**
 * Require that the module is enabled for the tenant AND the role may access it.
 * This is tenant-safe: the entitlement check is scoped by tenantId.
 */
export async function requireModule(ctx: AuthenticatedContext, moduleKey: ModuleKey): Promise<void> {
  if (!roleHasModuleAccess(ctx.role, moduleKey)) {
    throw new AuthorizationError(`Role ${ctx.role} does not have access to the ${moduleKey} module.`);
  }

  const access = await prisma.tenantModuleAccess.findFirst({
    where: {
      tenantId: ctx.tenantId,
      enabled: true,
      module: {
        key: moduleKey
      }
    },
    select: { id: true }
  });

  if (!access) {
    throw new AuthorizationError(`The ${moduleKey} module is not enabled for this tenant.`);
  }
}
