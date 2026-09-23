import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

const m = vi.hoisted(() => ({ tenant: vi.fn(), access: vi.fn(), prepare: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: {
  tenant: { findUnique: m.tenant }, tenantModuleAccess: { findFirst: m.access }
} }));
vi.mock("@/modules/website-growth/authority/store", () => ({ prepareAuthorityExecution: m.prepare }));

import { config, middleware } from "@/middleware";
import { POST } from "@/app/api/website-growth/backlinks/authority/route";

const endpoint = "/api/website-growth/backlinks/authority";
const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: `https://app.example.com${path}` });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN", "synthetic-authority-key");
  vi.stubEnv("OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG", "synthetic");
  m.tenant.mockResolvedValue({ id: "tenant-synthetic" });
  m.access.mockResolvedValue({ id: "module-synthetic" });
  m.prepare.mockResolvedValue({ campaignEnabled: false, ready: 0, sync: "SKIPPED" });
});
afterEach(() => vi.unstubAllEnvs());

async function throughMiddleware(token?: string) {
  const request = new NextRequest(`https://app.example.com${endpoint}`, {
    method: "POST", body: JSON.stringify({ action: "prepare", tenantId: "untrusted" }),
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  return matches(endpoint) ? middleware(request) : POST(request);
}

it("lets a cookie-free authority request reach real token authentication and tenant scope", async () => {
  const response = await throughMiddleware("synthetic-authority-key");
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(await response.json()).toEqual({ data: { campaignEnabled: false, ready: 0, sync: "SKIPPED" } });
  expect(m.tenant).toHaveBeenCalledWith({ where: { slug: "synthetic" }, select: { id: true } });
  expect(m.prepare).toHaveBeenCalledWith("tenant-synthetic");
});

it.each([undefined, "incorrect-key"])("rejects missing or invalid authority credentials without a login redirect: %s", async token => {
  const response = await throughMiddleware(token);
  expect(response.status).toBe(401);
  expect(response.headers.get("location")).toBeNull();
  expect(m.tenant).not.toHaveBeenCalled();
  expect(m.prepare).not.toHaveBeenCalled();
});

it("preserves the tenant module check after valid machine authentication", async () => {
  m.access.mockResolvedValue(null);
  expect((await throughMiddleware("synthetic-authority-key")).status).toBe(403);
  expect(m.prepare).not.toHaveBeenCalled();
});

it.each(["/api/website-growth/backlinks", "/api/website-growth/backlinks/authority-other",
  "/api/website-growth/backlinks/authority/extra", "/website-growth/backlinks"])(
  "keeps adjacent and interactive routes session protected: %s", path => {
    expect(matches(path)).toBe(true);
    expect(middleware(new NextRequest(`https://app.example.com${path}`)).status).toBe(307);
  }
);
