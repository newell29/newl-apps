import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateIngestionRequest = vi.hoisted(() => vi.fn());
const prepareHunterCompanyResearchRun = vi.hoisted(() => vi.fn());
const completeHunterCompanyResearchRun = vi.hoisted(() => vi.fn());

vi.mock("@/server/ingestion-auth", () => ({
  authenticateIngestionRequest,
  IngestionAuthError: class IngestionAuthError extends Error {
    status = 401;
  }
}));
vi.mock("@/modules/lead-gen/hunter-company-research", () => ({
  prepareHunterCompanyResearchRun,
  completeHunterCompanyResearchRun
}));

import { POST as complete } from "@/app/api/lead-gen/hunter/company-research/complete/route";
import { POST as prepare } from "@/app/api/lead-gen/hunter/company-research/prepare/route";

describe("Hunter company-research machine routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateIngestionRequest.mockResolvedValue({
      tenantId: "tenant-a",
      tenantSlug: "newl-group",
      tenantName: "Newl Group"
    });
  });

  it("passes only the authenticated tenant and bounded replay cohort into prepare", async () => {
    prepareHunterCompanyResearchRun.mockResolvedValue({ state: "ready", runId: "run-1" });
    const request = new Request("https://app.example/api/lead-gen/hunter/company-research/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true, companyKeys: ["Example Retailer"] })
    });
    const response = await prepare(request);

    expect(response.status).toBe(200);
    expect(prepareHunterCompanyResearchRun).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      force: true,
      companyKeys: ["Example Retailer"]
    });
  });

  it("rejects completion without a run ID", async () => {
    const request = new Request("https://app.example/api/lead-gen/hunter/company-research/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completion: {} })
    });
    const response = await complete(request);

    expect(response.status).toBe(400);
    expect(completeHunterCompanyResearchRun).not.toHaveBeenCalled();
  });
});
