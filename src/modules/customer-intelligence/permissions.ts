import { ModuleKey, PlatformRole } from "@prisma/client";

import {
  requireModule,
  requireMutationAccess,
  requireRole
} from "@/server/auth/authorization";
import type { AuthenticatedContext } from "@/server/tenant-context";

/** Read access for Customer Intelligence is leadership-only in v1. */
export const LEADERSHIP_ROLES = [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE];

/** Read access requires the module entitlement and a leadership role. */
export async function requireReadAccess(ctx: AuthenticatedContext): Promise<void> {
  await requireModule(ctx, ModuleKey.CUSTOMER_INTELLIGENCE);
  requireRole(ctx, LEADERSHIP_ROLES);
}

/** Match/service-rule approval is ADMIN or FINANCE. */
export async function requireMatchApproval(ctx: AuthenticatedContext): Promise<void> {
  await requireReadAccess(ctx);
  requireRole(ctx, [PlatformRole.ADMIN, PlatformRole.FINANCE]);
}

/** Operating-company, integration, mailbox, retention, and schedule settings are ADMIN. */
export async function requireAdminSettings(ctx: AuthenticatedContext): Promise<void> {
  await requireReadAccess(ctx);
  requireRole(ctx, [PlatformRole.ADMIN]);
}

/** Every mutation must also pass the tenant's mutation gate (blocks READ_ONLY and canMutate=false). */
export async function requireWrite(ctx: AuthenticatedContext): Promise<void> {
  await requireReadAccess(ctx);
  await requireMutationAccess(ctx);
}
