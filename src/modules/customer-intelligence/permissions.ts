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

/**
 * The read-only QuickBooks ingestion entry point (CP-PHASE-02B-2) is
 * ADMIN-triggered and must pass the tenant mutation gate. FINANCE and MANAGER
 * cannot trigger ingestion even though they can read and maintain other
 * Customer Intelligence facts, mirroring `associateQuickBooksCredential`.
 */
export async function requireIngestionAdmin(ctx: AuthenticatedContext): Promise<void> {
  await requireAdminSettings(ctx);
  await requireWrite(ctx);
}
