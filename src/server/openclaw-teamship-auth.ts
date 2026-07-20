import crypto from "node:crypto";

import { hasTeamshipInternalReadAccess } from "@/modules/teamship/access-policy";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export class OpenClawTeamshipAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "OpenClawTeamshipAuthError";
    this.status = status;
  }
}

export async function authenticateOpenClawTeamshipRequest(
  request: Request
): Promise<AuthenticatedContext> {
  const expectedToken = process.env.OPENCLAW_TEAMSHIP_READ_TOKEN?.trim();
  if (!expectedToken) {
    throw new OpenClawTeamshipAuthError("OpenClaw Teamship read authentication is not configured.", 503);
  }

  const providedToken = getBearerToken(request);
  if (!providedToken || !safeTokenEquals(providedToken, expectedToken)) {
    throw new OpenClawTeamshipAuthError("Invalid OpenClaw Teamship read credentials.");
  }

  const actorEmail = request.headers.get("x-newl-user-email")?.trim().toLowerCase();
  if (!actorEmail) {
    throw new OpenClawTeamshipAuthError("x-newl-user-email is required.", 400);
  }

  const tenantSlug =
    process.env.OPENCLAW_TEAMSHIP_TENANT_SLUG?.trim() ||
    process.env.DEFAULT_TENANT_SLUG?.trim();
  if (!tenantSlug) {
    throw new OpenClawTeamshipAuthError("OpenClaw Teamship tenant is not configured.", 503);
  }

  const membership = await prisma.membership.findFirst({
    where: {
      tenant: { slug: tenantSlug },
      user: {
        email: {
          equals: actorEmail,
          mode: "insensitive"
        }
      }
    },
    select: {
      role: true,
      tenant: {
        select: { id: true, slug: true, name: true }
      },
      user: {
        select: { id: true, email: true, name: true }
      }
    }
  });
  if (!membership) {
    throw new OpenClawTeamshipAuthError("The requested Newl employee membership was not found.", 403);
  }

  const context = {
    tenantId: membership.tenant.id,
    tenantSlug: membership.tenant.slug,
    tenantName: membership.tenant.name,
    userId: membership.user.id,
    userEmail: membership.user.email,
    userName: membership.user.name,
    role: membership.role
  };
  if (!hasTeamshipInternalReadAccess(context)) {
    throw new OpenClawTeamshipAuthError("Teamship read access is not permitted for this employee.", 403);
  }

  return context;
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

function safeTokenEquals(providedToken: string, expectedToken: string) {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}
