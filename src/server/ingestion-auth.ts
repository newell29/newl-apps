import crypto from "node:crypto";

import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";

export class IngestionAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "IngestionAuthError";
    this.status = status;
  }
}

export async function authenticateIngestionRequest(request: Request): Promise<TenantContext> {
  const expectedToken = process.env.INGESTION_API_TOKEN;

  if (!expectedToken) {
    throw new IngestionAuthError("Ingestion API token is not configured.", 503);
  }

  const providedToken = getBearerToken(request) ?? request.headers.get("x-newl-ingestion-key");

  if (!providedToken || !safeTokenEquals(providedToken, expectedToken)) {
    throw new IngestionAuthError("Invalid ingestion credentials.");
  }

  const tenantSlug = process.env.INGESTION_TENANT_SLUG ?? process.env.DEFAULT_TENANT_SLUG;

  if (!tenantSlug) {
    throw new IngestionAuthError("Ingestion tenant is not configured.", 503);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: {
      id: true,
      slug: true,
      name: true
    }
  });

  if (!tenant) {
    throw new IngestionAuthError("Ingestion tenant was not found.", 503);
  }

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name
  };
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function safeTokenEquals(providedToken: string, expectedToken: string) {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);

  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}
