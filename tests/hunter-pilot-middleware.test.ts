import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

const tenantLookup = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn());
vi.mock("@/server/db", () => ({ prisma: { tenant: { findUnique: tenantLookup } } }));
vi.mock("@/modules/lead-gen/hunter-pilot-read", () => ({ readHunterPilot: read }));

import { config, middleware } from "@/middleware";
import { POST } from "@/app/api/lead-gen/hunter/pilot/read/route";

const endpoint = "/api/lead-gen/hunter/pilot/read";
const tenant = { id: "tenant-a", slug: "synthetic", name: "Synthetic" };
const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: `https://app.example${path}` });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INGESTION_API_TOKEN", "synthetic-ingestion-key");
  vi.stubEnv("INGESTION_TENANT_SLUG", "synthetic");
  tenantLookup.mockResolvedValue(tenant);
  read.mockResolvedValue({ tenantId: "tenant-a", readOnly: true });
});

async function throughMiddleware(token?: string) {
  const request = new NextRequest(`https://app.example${endpoint}`, {
    method: "POST", body: JSON.stringify({ action: "context", tenantId: "untrusted" }),
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  return matches(endpoint) ? middleware(request) : POST(request);
}

it("lets the exact pilot endpoint reach its own ingestion authentication without a browser session", async () => {
  const response = await throughMiddleware("synthetic-ingestion-key");
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(read).toHaveBeenCalledWith({ action: "context", tenantId: "untrusted" },
    { tenantId: "tenant-a", tenantSlug: "synthetic", tenantName: "Synthetic" });
});

it.each([undefined, "incorrect-key"])("still rejects missing or invalid ingestion credentials: %s", async token => {
  const response = await throughMiddleware(token);
  expect(response.status).toBe(401);
  expect(tenantLookup).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it("preserves the disabled pilot gate after valid machine authentication", async () => {
  read.mockRejectedValue(new Error("PILOT_DISABLED"));
  const response = await throughMiddleware("synthetic-ingestion-key");
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "PILOT_DISABLED" });
});

it.each(["/api/lead-gen/hunter/pilot", "/api/lead-gen/hunter/pilot/write",
  "/api/lead-gen/hunter/pilot/read-other", "/api/lead-gen/hunter/pilot/read/extra", "/lead-gen/hunter"])(
  "does not exempt neighbouring or interactive routes: %s", path => {
    expect(matches(path)).toBe(true);
    expect(middleware(new NextRequest(`https://app.example${path}`)).status).toBe(307);
  });
