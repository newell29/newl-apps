import type { PlatformRole } from "@prisma/client";

import { auth } from "@/server/auth";
import { prisma } from "@/server/db";

/**
 * Tenant subset of the authenticated context. This is the required input for
 * all tenant-scoped service/query calls (see `tenantWhere`).
 */
export type TenantContext = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
};

/**
 * Full authenticated context: the signed-in user plus their resolved tenant and
 * role. Resolved fresh on every call from the database session — membership is
 * always re-validated, never trusted from client input or a cached claim.
 */
export type AuthenticatedContext = TenantContext & {
  userId: string;
  userEmail: string;
  userName: string | null;
  role: PlatformRole;
};

/**
 * Thrown when there is no valid authenticated session or membership. Callers in
 * the (authenticated) layout translate this into a redirect to /login.
 */
export class UnauthenticatedError extends Error {
  constructor(message = "No authenticated session.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/**
 * Resolve the authenticated context:
 *   session -> User -> single Membership -> Tenant.
 *
 * v1 is single-tenant per user: we auto-resolve the user's single membership
 * (no tenant picker). Membership is validated against the database on every
 * call so a stale or tampered session cannot grant tenant access.
 */
export async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const session = await auth();
  const sessionUserId = session?.user?.id;
  const sessionUserEmail = session?.user?.email ?? undefined;

  if (!sessionUserId && !sessionUserEmail) {
    throw new UnauthenticatedError();
  }

  const user = await prisma.user.findFirst({
    where: sessionUserId ? { id: sessionUserId } : { email: sessionUserEmail },
    select: {
      id: true,
      email: true,
      name: true,
      memberships: {
        select: {
          role: true,
          tenant: {
            select: {
              id: true,
              slug: true,
              name: true
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!user) {
    throw new UnauthenticatedError("Authenticated user no longer exists.");
  }

  const membership = user.memberships[0];

  if (!membership) {
    throw new UnauthenticatedError("User has no tenant membership.");
  }

  return {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    role: membership.role,
    tenantId: membership.tenant.id,
    tenantSlug: membership.tenant.slug,
    tenantName: membership.tenant.name
  };
}

/**
 * Backward-compatible tenant resolver. Existing tenant-scoped callers that only
 * need the tenant subset can keep using this; it now derives the tenant from the
 * authenticated context instead of an env-based development fallback.
 */
export async function getCurrentTenantContext(): Promise<TenantContext> {
  const context = await getAuthenticatedContext();
  return {
    tenantId: context.tenantId,
    tenantSlug: context.tenantSlug,
    tenantName: context.tenantName
  };
}
