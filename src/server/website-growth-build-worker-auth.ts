import crypto from "node:crypto";

export class WebsiteGrowthBuildWorkerAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "WebsiteGrowthBuildWorkerAuthError";
    this.status = status;
  }
}

export function authenticateWebsiteGrowthBuildWorkerRequest(request: Request) {
  const expectedToken = process.env.WEBSITE_GROWTH_BUILD_WORKER_TOKEN?.trim();
  const configuredTenantSlug = process.env.WEBSITE_GROWTH_BUILD_WORKER_TENANT_SLUG?.trim();
  if (!expectedToken) throw new WebsiteGrowthBuildWorkerAuthError("Website Growth build worker authentication is not configured.", 503);
  if (!configuredTenantSlug) throw new WebsiteGrowthBuildWorkerAuthError("Website Growth build worker tenant scope is not configured.", 503);

  const authorization = request.headers.get("authorization");
  const [scheme, token] = authorization?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token || !safeTokenEquals(token.trim(), expectedToken)) {
    throw new WebsiteGrowthBuildWorkerAuthError("Invalid Website Growth build worker credentials.");
  }

  const tenantSlug = request.headers.get("x-newl-website-growth-tenant")?.trim();
  if (!tenantSlug || tenantSlug !== configuredTenantSlug) {
    throw new WebsiteGrowthBuildWorkerAuthError("Website Growth build worker tenant scope does not match.", 403);
  }

  return { tenantSlug };
}

function safeTokenEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
