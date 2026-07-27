import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateIngestionRequest = vi.hoisted(() => vi.fn());
const processNextHunterOutreachHandoff = vi.hoisted(() => vi.fn());

vi.mock("@/server/ingestion-auth", () => ({
  authenticateIngestionRequest,
  IngestionAuthError: class IngestionAuthError extends Error {
    status = 401;
  }
}));
vi.mock("@/modules/lead-gen/hunter-outreach-handoff", () => ({
  processNextHunterOutreachHandoff
}));

import { POST } from "@/app/api/lead-gen/hunter/outreach-handoff/process/route";

describe("Hunter outreach handoff machine route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateIngestionRequest.mockResolvedValue({
      tenantId: "tenant-a",
      tenantSlug: "newl-group",
      tenantName: "Newl Group"
    });
    processNextHunterOutreachHandoff.mockResolvedValue({
      state: "processed",
      runId: "handoff-1",
      processedCompanyId: "company-1"
    });
  });

  it("uses only the authenticated tenant and optional bounded job ID", async () => {
    const response = await POST(new Request(
      "https://app.example/api/lead-gen/hunter/outreach-handoff/process",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "attacker-tenant", runId: " handoff-1 " })
      }
    ));

    expect(response.status).toBe(200);
    expect(processNextHunterOutreachHandoff).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      runId: "handoff-1"
    });
  });

  it("does not process a job when machine authentication fails", async () => {
    authenticateIngestionRequest.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), { status: 401 })
    );
    const response = await POST(new Request(
      "https://app.example/api/lead-gen/hunter/outreach-handoff/process",
      { method: "POST", body: "{}" }
    ));

    expect(response.status).toBe(422);
    expect(processNextHunterOutreachHandoff).not.toHaveBeenCalled();
  });
});
