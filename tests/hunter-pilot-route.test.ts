import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn());
vi.mock("@/server/ingestion-auth", () => ({ authenticateIngestionRequest: auth,
  IngestionAuthError: class extends Error { status = 401; } }));
vi.mock("@/modules/lead-gen/hunter-pilot-read", () => ({ readHunterPilot: read }));
import { POST } from "@/app/api/lead-gen/hunter/pilot/read/route";
import { IngestionAuthError } from "@/server/ingestion-auth";
beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ tenantId: "tenant-a", tenantSlug: "synthetic", tenantName: "Synthetic" });
  read.mockResolvedValue({ tenantId: "tenant-a", readOnly: true });
});
const request = (body: string) => new Request("https://app.example/api/lead-gen/hunter/pilot/read", { method: "POST", body });
it("passes authenticated context separately from untrusted JSON", async () => {
  const result = await POST(request(JSON.stringify({ action: "context", tenantId: "tenant-b" })));
  expect(result.status).toBe(200);
  expect(read).toHaveBeenCalledWith({ action: "context", tenantId: "tenant-b" }, { tenantId: "tenant-a", tenantSlug: "synthetic", tenantName: "Synthetic" });
});
it("rejects failed ingestion auth before reading data", async () => {
  auth.mockRejectedValue(new IngestionAuthError("Unauthorized"));
  expect((await POST(request("{}"))).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
});
it.each(["null", "[]", "broken", "x".repeat(8001)])("rejects invalid/oversized input", async body => {
  expect((await POST(request(body))).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
it("redacts unexpected provider/database errors", async () => {
  read.mockRejectedValue(new Error("postgresql://synthetic-secret@db.invalid"));
  expect(await (await POST(request("{}"))).json()).toEqual({ error: "PILOT_READ_UNAVAILABLE" });
});
