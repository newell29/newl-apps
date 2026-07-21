import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";

import { normalizeMicrosoftEntraId } from "@/server/auth/microsoft-entra-identity";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export class OpenClawAssistantAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "OpenClawAssistantAuthError";
    this.status = status;
  }
}

/**
 * Resolves the trusted Teams sender to a normal Newl Apps membership. The
 * assistant token authenticates OpenClaw itself; the Entra headers identify
 * the employee. Module and mutation authorization still belongs to each route.
 */
export async function authenticateOpenClawAssistantRequest(
  request: Request
): Promise<AuthenticatedContext> {
  const expectedToken =
    process.env.OPENCLAW_ASSISTANT_TOKEN?.trim() ||
    process.env.OPENCLAW_TEAMSHIP_READ_TOKEN?.trim();
  if (!expectedToken) {
    throw new OpenClawAssistantAuthError("OpenClaw assistant authentication is not configured.", 503);
  }

  const providedToken = getBearerToken(request);
  if (!providedToken || !safeTokenEquals(providedToken, expectedToken)) {
    throw new OpenClawAssistantAuthError("Invalid OpenClaw assistant credentials.");
  }

  const actor = readActorIdentity(request);
  const tenantSlug =
    process.env.OPENCLAW_ASSISTANT_TENANT_SLUG?.trim() ||
    process.env.OPENCLAW_TEAMSHIP_TENANT_SLUG?.trim() ||
    process.env.DEFAULT_TENANT_SLUG?.trim();
  if (!tenantSlug) {
    throw new OpenClawAssistantAuthError("OpenClaw assistant tenant is not configured.", 503);
  }

  const membership = await prisma.membership.findFirst({
    where: {
      tenant: { slug: tenantSlug },
      user: actor.userWhere
    },
    select: {
      role: true,
      tenant: { select: { id: true, slug: true, name: true } },
      user: { select: { id: true, email: true, name: true } }
    }
  });
  if (!membership) {
    throw new OpenClawAssistantAuthError("The requested Newl employee membership was not found.", 403);
  }

  return {
    tenantId: membership.tenant.id,
    tenantSlug: membership.tenant.slug,
    tenantName: membership.tenant.name,
    userId: membership.user.id,
    userEmail: membership.user.email,
    userName: membership.user.name,
    role: membership.role
  };
}

function readActorIdentity(request: Request): { userWhere: Prisma.UserWhereInput } {
  const tenantId = normalizeMicrosoftEntraId(request.headers.get("x-newl-teams-tenant-id"));
  const objectId = normalizeMicrosoftEntraId(request.headers.get("x-newl-teams-aad-object-id"));
  if (!tenantId || !objectId) {
    throw new OpenClawAssistantAuthError(
      "A valid Microsoft Teams tenant and sender identity are required.",
      400
    );
  }
  return {
    userWhere: {
      microsoftEntraTenantId: tenantId,
      microsoftEntraObjectId: objectId
    }
  };
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
