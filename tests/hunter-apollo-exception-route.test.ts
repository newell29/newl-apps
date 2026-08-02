import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateIngestionRequest = vi.hoisted(() => vi.fn());
const prepareNextApolloExceptionResolution = vi.hoisted(() => vi.fn());
const completeApolloExceptionResolution = vi.hoisted(() => vi.fn());
const failApolloExceptionResolution = vi.hoisted(() => vi.fn());

vi.mock("@/server/ingestion-auth", () => ({
  authenticateIngestionRequest,
  IngestionAuthError: class IngestionAuthError extends Error {
    status = 401;
  }
}));
vi.mock("@/modules/lead-gen/apollo-exception-autopilot", () => ({
  prepareNextApolloExceptionResolution,
  completeApolloExceptionResolution,
  failApolloExceptionResolution
}));

import { POST as complete } from "@/app/api/lead-gen/hunter/apollo-exceptions/complete/route";
import { POST as fail } from "@/app/api/lead-gen/hunter/apollo-exceptions/fail/route";
import { POST as prepare } from "@/app/api/lead-gen/hunter/apollo-exceptions/prepare/route";

describe("Hunter Apollo-exception machine routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateIngestionRequest.mockResolvedValue({ tenantId: "tenant-a" });
  });

  it("prepares work only inside the authenticated tenant", async () => {
    prepareNextApolloExceptionResolution.mockResolvedValue({
      state: "prepared",
      runId: "run-1"
    });
    const response = await prepare(new Request("https://app.example/prepare", {
      method: "POST"
    }));
    expect(response.status).toBe(200);
    expect(prepareNextApolloExceptionResolution).toHaveBeenCalledWith({
      tenantId: "tenant-a"
    });
  });

  it("passes bounded evidence into completion without accepting a tenant ID from the body", async () => {
    completeApolloExceptionResolution.mockResolvedValue({ state: "AUTO_RESOLVED" });
    const publicEvidence = [{
      query: "Example",
      title: "Official site",
      url: "https://example.com",
      excerpt: "Example legal identity"
    }];
    const response = await complete(new Request("https://app.example/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "run-1", publicEvidence, tenantId: "wrong" })
    }));
    expect(response.status).toBe(200);
    expect(completeApolloExceptionResolution).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      runId: "run-1",
      publicEvidence
    });
  });

  it("requires a run ID for completion and failure callbacks", async () => {
    const missingComplete = await complete(new Request("https://app.example/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }));
    const missingFail = await fail(new Request("https://app.example/fail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }));
    expect(missingComplete.status).toBe(400);
    expect(missingFail.status).toBe(400);
  });
});
