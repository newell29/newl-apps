import crypto from "node:crypto";

export class WebsiteGrowthScoutAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "WebsiteGrowthScoutAuthError";
    this.status = status;
  }
}

export function authenticateWebsiteGrowthScoutRequest(request: Request) {
  const expectedToken = process.env.OPENCLAW_WEBSITE_GROWTH_TOKEN?.trim();
  const tenantSlug = process.env.OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG?.trim();
  if (!expectedToken) throw new WebsiteGrowthScoutAuthError("Website Growth Scout authentication is not configured.", 503);
  if (!tenantSlug) throw new WebsiteGrowthScoutAuthError("Website Growth Scout tenant scope is not configured.", 503);
  const [scheme, token] = request.headers.get("authorization")?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token || !safeEquals(token.trim(), expectedToken)) {
    throw new WebsiteGrowthScoutAuthError("Invalid Website Growth Scout credentials.");
  }
  return { tenantSlug };
}

function safeEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
