import { ModuleKey, PlatformRole } from "@prisma/client";

import { prisma } from "@/server/db";
import { ALL_MODULES, DEFAULT_ROLE_MATRIX } from "@/server/auth/role-policy";
import type { AuthenticatedContext } from "@/server/tenant-context";

type TenantRoleModuleAccessClient = typeof prisma & {
  tenantRolePolicy: {
    findUnique(args: {
      where: { tenantId_role: { tenantId: string; role: PlatformRole } };
      select: { canMutate: true };
    }): Promise<{ canMutate: boolean } | null>;
  };
  tenantRoleModuleAccess: {
    findMany(args: {
      where: { tenantId: string; role: PlatformRole };
      select: { enabled: true; module: { select: { key: true } } };
    }): Promise<Array<{ enabled: boolean; module: { key: ModuleKey } }>>;
  };
};

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
export const ROLE_MATRIX = DEFAULT_ROLE_MATRIX;

export function roleHasModuleAccess(role: PlatformRole, moduleKey: ModuleKey): boolean {
  const policy = ROLE_MATRIX[role];
  return policy.modules === "ALL" || policy.modules.includes(moduleKey);
}

export function roleCanMutate(role: PlatformRole): boolean {
  return ROLE_MATRIX[role].canMutate;
}

export async function resolveRoleCanMutate(tenantId: string, role: PlatformRole): Promise<boolean> {
  if (role === PlatformRole.ADMIN) {
    return true;
  }

  if (role === PlatformRole.READ_ONLY) {
    return false;
  }

  const roleAccessClient = prisma as TenantRoleModuleAccessClient;
  const override = await roleAccessClient.tenantRolePolicy.findUnique({
    where: {
      tenantId_role: {
        tenantId,
        role
      }
    },
    select: {
      canMutate: true
    }
  });

  return override?.canMutate ?? roleCanMutate(role);
}

/** Module keys the role can access, resolved to a concrete list. */
export function accessibleModuleKeys(role: PlatformRole): ModuleKey[] {
  const policy = ROLE_MATRIX[role];
  return policy.modules === "ALL" ? [...ALL_MODULES] : [...policy.modules];
}

export async function resolveAccessibleModuleKeys(
  tenantId: string,
  role: PlatformRole
): Promise<ModuleKey[]> {
  const roleAccessClient = prisma as TenantRoleModuleAccessClient;
  const defaults = new Set(accessibleModuleKeys(role));
  const overrides = await roleAccessClient.tenantRoleModuleAccess.findMany({
    where: {
      tenantId,
      role
    },
    select: {
      enabled: true,
      module: {
        select: {
          key: true
        }
      }
    }
  });

  if (overrides.length === 0) {
    return [...defaults];
  }

  for (const override of overrides) {
    if (override.enabled) {
      defaults.add(override.module.key);
    } else {
      defaults.delete(override.module.key);
    }
  }

  return [...defaults];
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
export async function requireMutationAccess(ctx: AuthenticatedContext): Promise<void> {
  if (!(await resolveRoleCanMutate(ctx.tenantId, ctx.role))) {
    throw new AuthorizationError("Read-only users cannot perform this action.");
  }
}

/**
 * Require that the module is enabled for the tenant AND the role may access it.
 * This is tenant-safe: the entitlement check is scoped by tenantId.
 */
export async function requireModule(ctx: AuthenticatedContext, moduleKey: ModuleKey): Promise<void> {
  const roleModules = await resolveAccessibleModuleKeys(ctx.tenantId, ctx.role);

  if (!roleModules.includes(moduleKey)) {
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
