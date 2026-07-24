import crypto from "node:crypto";

export class WebsiteGrowthBacklinkExecutorAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "WebsiteGrowthBacklinkExecutorAuthError";
    this.status = status;
  }
}

export function authenticateWebsiteGrowthBacklinkExecutorRequest(request: Request) {
  const expectedToken = process.env.OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN?.trim();
  const tenantSlug = process.env.OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG?.trim();
  if (!expectedToken) {
    throw new WebsiteGrowthBacklinkExecutorAuthError("Backlink executor authentication is not configured.", 503);
  }
  if (!tenantSlug) {
    throw new WebsiteGrowthBacklinkExecutorAuthError("Backlink executor tenant scope is not configured.", 503);
  }
  const [scheme, token] = request.headers.get("authorization")?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token || !safeEquals(token.trim(), expectedToken)) {
    throw new WebsiteGrowthBacklinkExecutorAuthError("Invalid backlink executor credentials.");
  }
  return { tenantSlug };
}

function safeEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
