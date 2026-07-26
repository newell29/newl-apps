import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateIngestionRequest = vi.hoisted(() => vi.fn());
const prepareHunterSignalScoutRun = vi.hoisted(() => vi.fn());
const completeHunterSignalScoutRun = vi.hoisted(() => vi.fn());

vi.mock("@/server/ingestion-auth", () => ({
  authenticateIngestionRequest,
  IngestionAuthError: class IngestionAuthError extends Error {
    status = 401;
  }
}));
vi.mock("@/modules/lead-gen/hunter-signal-scout", () => ({
  prepareHunterSignalScoutRun,
  completeHunterSignalScoutRun
}));

import { POST as complete } from "@/app/api/lead-gen/hunter/signal-scout/complete/route";
import { POST as prepare } from "@/app/api/lead-gen/hunter/signal-scout/prepare/route";

describe("Hunter signal scout machine routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateIngestionRequest.mockResolvedValue({
      tenantId: "tenant-a",
      tenantSlug: "newl-group",
      tenantName: "Newl Group"
    });
  });

  it("passes only the authenticated tenant into prepare", async () => {
    prepareHunterSignalScoutRun.mockResolvedValue({ state: "ready", runId: "run-1" });
    const request = new Request("https://app.example/api/lead-gen/hunter/signal-scout/prepare", {
      method: "POST"
    });
    const response = await prepare(request);

    expect(response.status).toBe(200);
    expect(prepareHunterSignalScoutRun).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      force: false
    });
  });

  it("rejects completion without a run ID before writing classifications", async () => {
    const request = new Request("https://app.example/api/lead-gen/hunter/signal-scout/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completion: {} })
    });
    const response = await complete(request);

    expect(response.status).toBe(400);
    expect(completeHunterSignalScoutRun).not.toHaveBeenCalled();
  });
});
