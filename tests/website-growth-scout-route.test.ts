import { beforeEach, describe, expect, it, vi } from "vitest";
import { newWork, DEFAULT_MISSION } from "@/modules/website-growth/scout/model";
import { POST } from "@/app/api/website-growth/scout/work-items/route";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), access: vi.fn(), workspace: vi.fn(), reconcile: vi.fn(), wake: vi.fn(), claim: vi.fn(), complete: vi.fn(), context: vi.fn() }));
vi.mock("@/server/website-growth-scout-auth", () => ({ authenticateWebsiteGrowthScoutRequest: mocks.auth,
  WebsiteGrowthScoutAuthError: class extends Error { status = 401; } }));
vi.mock("@/server/db", () => ({ prisma: { tenant: { findUnique: mocks.tenant }, tenantModuleAccess: { findFirst: mocks.access } } }));
vi.mock("@/modules/website-growth/scout/store", () => ({ scoutWorkspace: mocks.workspace, reconcileScoutWork: mocks.reconcile,
  recordScoutWake: mocks.wake, claimScoutWork: mocks.claim, completeScoutWork: mocks.complete, scoutWorkContext: mocks.context }));
const effectiveness = vi.hoisted(() => ({ refresh: vi.fn(), load: vi.fn() }));
vi.mock("@/modules/website-growth/scout/effectiveness", () => ({ refreshSiteReview: effectiveness.refresh, loadSiteReview: effectiveness.load }));
const request = (body: object) => new Request("https://example.com/api/website-growth/scout/work-items", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); effectiveness.refresh.mockResolvedValue(null); effectiveness.load.mockResolvedValue(null); mocks.wake.mockResolvedValue(undefined); mocks.auth.mockReturnValue({ tenantSlug: "synthetic" }); mocks.tenant.mockResolvedValue({ id: "tenant-authenticated" }); mocks.access.mockResolvedValue({ id: "access" }); });
describe("Scout worker boundary", () => {
  it("resolves the tenant from authentication and ignores model-supplied tenant scope", async () => {
    mocks.claim.mockResolvedValue({ id: "work" });
    expect((await POST(request({ action: "claim", claimId: "claim-synthetic", id: "work", reason: "Continue useful work", tenantId: "foreign" }))).status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith("tenant-authenticated", "work", "Continue useful work", "claim-synthetic");
    expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-authenticated", enabled: true }) }));
  });
  it("keeps an older worker compatible during a staggered rollout", async () => {
    mocks.claim.mockResolvedValue({ id: "work" });
    expect((await POST(request({ action: "claim", id: "work", reason: "Continue useful work" }))).status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith("tenant-authenticated", "work", "Continue useful work", expect.any(String));
  });
  it("blocks disabled tenants before touching work", async () => {
    mocks.access.mockResolvedValue(null);
    expect((await POST(request({ action: "prepare" }))).status).toBe(403);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("never exposes another active lease and avoids model work when the budget is exhausted", async () => {
    const value = { mission: { enabled: false }, capacity: { available: false }, items: [{ id: "work", lease: "private-lease" }] };
    mocks.workspace.mockResolvedValue(value);
    const response = await POST(request({ action: "prepare" }));
    const body = await response.json();
    expect(body).toMatchObject({ data: { items: [], due: [] } });
    expect(JSON.stringify(body)).not.toContain("private-lease");
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("does not expose sending, approval, mission changes, or publishing actions", async () => {
    for (const action of ["send", "approve", "publish", "save-mission"]) {
      expect((await POST(request({ action, id: "work", lease: "lease" }))).status).toBe(422);
    }
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("returns a safe failure without leaking underlying integration details", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.claim.mockRejectedValue(new Error("private connection detail"));
    const response = await POST(request({ action: "claim", claimId: "claim-synthetic", id: "work", reason: "Continue" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(JSON.stringify(await response.json())).not.toContain("private connection detail");
    expect(logged).toHaveBeenCalledWith("Scout work-item request failed", expect.objectContaining({ action: "claim", errorType: "Error" }));
    expect(JSON.stringify(logged.mock.calls)).not.toContain("private connection detail");
    logged.mockRestore();
  });
});

it("bounds the selection packet independently of large saved artifacts", async () => {
  const workspace = { mission: { ...DEFAULT_MISSION, enabled: true }, capacity: { available: true }, items: Array.from({ length: 80 }, (_, index) => ({ ...newWork("RESEARCH", null, "Research", "Investigate", null), id: `work-${index}`, artifact: { large: "a".repeat(90_000) } })) };
  mocks.workspace.mockResolvedValue(workspace); mocks.reconcile.mockResolvedValue(workspace);
  const body = await (await POST(request({ action: "prepare" }))).json();
  expect(body.data.due).toHaveLength(50);
  expect(body.data.items[0]).not.toHaveProperty("artifact");
  expect(JSON.stringify(body).length).toBeLessThan(100_000);
  expect(mocks.wake).toHaveBeenCalledWith("tenant-authenticated", expect.any(String), expect.objectContaining({ dueCount: 50, idleReason: null }));
});

it("continues existing research when the optional site refresh and saved snapshot are unavailable", async () => {
  const item = { ...newWork("RESEARCH", null, "Investigate", "Use public evidence", null), id: "research" };
  const workspace = { mission: { ...DEFAULT_MISSION, enabled: true }, capacity: { available: true, usedSteps: 0, active: 0 }, items: [item] };
  mocks.workspace.mockResolvedValue(workspace); mocks.reconcile.mockResolvedValue(workspace);
  effectiveness.refresh.mockRejectedValue(new Error("private provider detail")); effectiveness.load.mockRejectedValue(new Error("unavailable"));
  const response = await POST(request({ action: "prepare", tenantId: "foreign" }));
  expect(response.status).toBe(200); const body = await response.json();
  expect(body.data.due).toEqual(["research"]); expect(body.data.learning.effectiveness.status).toBe("UNAVAILABLE");
  expect(effectiveness.refresh).toHaveBeenCalledWith("tenant-authenticated");
  expect(JSON.stringify(body)).not.toContain("private provider detail");
});
