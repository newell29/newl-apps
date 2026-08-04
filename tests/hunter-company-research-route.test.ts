import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateIngestionRequest = vi.hoisted(() => vi.fn());
const prepareHunterCompanyResearchRun = vi.hoisted(() => vi.fn());
const completeHunterCompanyResearchRun = vi.hoisted(() => vi.fn());
const runHunterResearchLunaShadowBatch = vi.hoisted(() => vi.fn());

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
vi.mock("@/modules/lead-gen/hunter-company-research-shadow", () => ({
  runHunterResearchLunaShadowBatch
}));

import { POST as complete } from "@/app/api/lead-gen/hunter/company-research/complete/route";
import { POST as prepare } from "@/app/api/lead-gen/hunter/company-research/prepare/route";
import { POST as shadow } from "@/app/api/lead-gen/hunter/company-research/shadow/route";
import { POST as synthesis } from "@/app/api/lead-gen/hunter/company-research/synthesis/route";

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
      companyKeys: ["Example Retailer"],
      recoveryOfRunId: undefined
    });
  });

  it("passes a bounded recovery reference through the authenticated tenant route", async () => {
    prepareHunterCompanyResearchRun.mockResolvedValue({ state: "ready", runId: "run-2" });
    const response = await prepare(new Request(
      "https://app.example/api/lead-gen/hunter/company-research/prepare",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recoveryOfRunId: "failed-run-1" })
      }
    ));

    expect(response.status).toBe(200);
    expect(prepareHunterCompanyResearchRun).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      force: false,
      companyKeys: undefined,
      recoveryOfRunId: "failed-run-1"
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

  it("keeps authoritative Luna synthesis batches tenant scoped", async () => {
    runHunterResearchLunaShadowBatch.mockResolvedValue({
      state: "completed",
      report: { authoritative: true, evaluatedCompanyCount: 1 }
    });
    const request = new Request(
      "https://app.example/api/lead-gen/hunter/company-research/synthesis",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId: "run-1",
          packets: [{ companyId: "company-1" }],
          finalBatch: true
        })
      }
    );
    const response = await synthesis(request);

    expect(response.status).toBe(200);
    expect(runHunterResearchLunaShadowBatch).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      runId: "run-1",
      packets: [{ companyId: "company-1" }],
      finalBatch: true
    });
  });

  it("retains the legacy shadow route during the Mac worker cutover", async () => {
    runHunterResearchLunaShadowBatch.mockResolvedValue({ state: "completed" });
    const response = await shadow(new Request(
      "https://app.example/api/lead-gen/hunter/company-research/shadow",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: "run-1", packets: [{}], finalBatch: false })
      }
    ));

    expect(response.status).toBe(200);
  });
});
