import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), access: vi.fn(), prepare: vi.fn(), claim: vi.fn(), begin: vi.fn(), execute: vi.fn(), finish: vi.fn(), status: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { tenant: { findUnique: m.tenant }, tenantModuleAccess: { findFirst: m.access } } }));
vi.mock("@/server/website-growth-backlink-executor-auth", async original => ({ ...await original<object>(), authenticateWebsiteGrowthBacklinkExecutorRequest: m.auth }));
vi.mock("@/modules/website-growth/authority/store", () => ({ prepareAuthorityExecution: m.prepare, claimAuthorityAction: m.claim, beginAuthorityAction: m.begin,
  executeAuthorityAction: m.execute, finishAuthorityAction: m.finish, authorityExecutionStatus: m.status }));
import { POST } from "@/app/api/website-growth/backlinks/authority/route";
import { WebsiteGrowthBacklinkExecutorAuthError } from "@/server/website-growth-backlink-executor-auth";
beforeEach(() => { vi.resetAllMocks(); m.auth.mockReturnValue({ tenantSlug: "synthetic" }); m.tenant.mockResolvedValue({ id: "tenant-synthetic" }); m.access.mockResolvedValue({ id: "access" }); });
const request = (body: unknown) => new Request("https://app.example.com/api/website-growth/backlinks/authority", { method: "POST", body: JSON.stringify(body) });
it("derives tenant from executor credentials and ignores supplied tenant identity", async () => {
  m.claim.mockResolvedValue(null); expect((await POST(request({ action: "claim", claimId: "synthetic", tenantId: "other" }))).status).toBe(200);
  expect(m.claim).toHaveBeenCalledWith("tenant-synthetic", "synthetic");
});
it("denies bad auth and disabled module before any operation", async () => {
  m.auth.mockImplementation(() => { throw new WebsiteGrowthBacklinkExecutorAuthError("Denied", 401); });
  expect((await POST(request({ action: "prepare" }))).status).toBe(401); expect(m.prepare).not.toHaveBeenCalled();
  m.auth.mockReturnValue({ tenantSlug: "synthetic" }); m.access.mockResolvedValue(null);
  expect((await POST(request({ action: "prepare" }))).status).toBe(403); expect(m.prepare).not.toHaveBeenCalled();
});
it("rejects missing leases and oversized input; hides vendor errors", async () => {
  expect((await POST(request({ action: "execute", id: "synthetic" }))).status).toBe(422);
  expect((await POST(request({ action: "prepare", extra: "x".repeat(13000) }))).status).toBe(413);
  m.execute.mockRejectedValue(new Error("Sensitive provider diagnostic"));
  const response = await POST(request({ action: "execute", id: "synthetic", lease: "synthetic" }));
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("Sensitive");
});
