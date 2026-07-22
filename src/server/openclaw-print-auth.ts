import crypto from "node:crypto";
import { ModuleKey, type Prisma } from "@prisma/client";

import { requireModule } from "@/server/auth/authorization";
import { normalizeMicrosoftEntraId } from "@/server/auth/microsoft-entra-identity";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export class OpenClawPrintAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "OpenClawPrintAuthError";
    this.status = status;
  }
}

export async function authenticateOpenClawPrintRequest(request: Request): Promise<AuthenticatedContext> {
  const expectedToken = process.env.OPENCLAW_PRINT_TOKEN?.trim();
  if (!expectedToken) throw new OpenClawPrintAuthError("OpenClaw print authentication is not configured.", 503);
  for (const [name, candidate] of [
    ["Teamship read", process.env.OPENCLAW_TEAMSHIP_READ_TOKEN?.trim()],
    ["assistant", process.env.OPENCLAW_ASSISTANT_TOKEN?.trim()]
  ] as const) {
    if (candidate && safeTokenEquals(candidate, expectedToken)) {
      throw new OpenClawPrintAuthError(`OpenClaw print authentication must use a credential distinct from the ${name} token.`, 503);
    }
  }
  const provided = getBearerToken(request);
  if (!provided || !safeTokenEquals(provided, expectedToken)) {
    throw new OpenClawPrintAuthError("Invalid OpenClaw print credentials.");
  }

  const actor = readActorIdentity(request);
  const tenantSlug =
    process.env.OPENCLAW_PRINT_TENANT_SLUG?.trim() ||
    process.env.OPENCLAW_ASSISTANT_TENANT_SLUG?.trim() ||
    process.env.DEFAULT_TENANT_SLUG?.trim();
  if (!tenantSlug) throw new OpenClawPrintAuthError("OpenClaw print tenant is not configured.", 503);
  const membership = await prisma.membership.findFirst({
    where: { tenant: { slug: tenantSlug }, user: actor.userWhere },
    select: {
      role: true,
      tenant: { select: { id: true, slug: true, name: true } },
      user: { select: { id: true, email: true, name: true } }
    }
  });
  if (!membership) throw new OpenClawPrintAuthError("The requested Newl employee membership was not found.", 403);
  const context: AuthenticatedContext = {
    tenantId: membership.tenant.id,
    tenantSlug: membership.tenant.slug,
    tenantName: membership.tenant.name,
    userId: membership.user.id,
    userEmail: membership.user.email,
    userName: membership.user.name,
    role: membership.role
  };
  await requireModule(context, ModuleKey.ASSISTANT);
  return context;
}

function readActorIdentity(request: Request): { userWhere: Prisma.UserWhereInput } {
  const tenantId = normalizeMicrosoftEntraId(request.headers.get("x-newl-teams-tenant-id"));
  const objectId = normalizeMicrosoftEntraId(request.headers.get("x-newl-teams-aad-object-id"));
  if (!tenantId || !objectId) {
    throw new OpenClawPrintAuthError("A valid Microsoft Teams tenant and sender identity are required.", 400);
  }
  return { userWhere: { microsoftEntraTenantId: tenantId, microsoftEntraObjectId: objectId } };
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

function safeTokenEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
