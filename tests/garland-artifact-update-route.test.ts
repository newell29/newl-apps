import { ModuleKey } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  requireModule: vi.fn(),
  requireMutationAccess: vi.fn(),
  approve: vi.fn()
}));

vi.mock("@/server/openclaw-assistant-auth", () => ({
  OpenClawAssistantAuthError: class OpenClawAssistantAuthError extends Error {
    status = 401;
  },
  authenticateOpenClawAssistantRequest: (...args: unknown[]) => mocks.authenticate(...args)
}));
vi.mock("@/server/auth/authorization", () => ({
  AuthorizationError: class AuthorizationError extends Error {
    status = 403;
  },
  requireModule: (...args: unknown[]) => mocks.requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => mocks.requireMutationAccess(...args)
}));
vi.mock("@/modules/assistant/garland-artifacts", () => ({
  GarlandArtifactError: class GarlandArtifactError extends Error {
    status = 400;
  },
  approveGarlandArtifactUpdate: (...args: unknown[]) => mocks.approve(...args)
}));

import { POST } from "@/app/api/assistant/garland/artifacts/[artifactId]/update/route";

describe("Garland artifact Teamship update approval route", () => {
  const context = { tenantId: "tenant-1", userId: "user-1", role: "OPERATIONS" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(context);
    mocks.approve.mockResolvedValue({ jobId: "job-1", status: "APPROVED" });
  });

  it("requires normal employee mutation authorization and binds the exact artifact proposal", async () => {
    const response = await POST(new Request("https://newl.test/api/assistant/garland/artifacts/artifact-1/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobId: "job-1",
        targetReference: "PS210235",
        confirmation: "APPROVE_TEAMSHIP_UPDATE"
      })
    }), { params: Promise.resolve({ artifactId: "artifact-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.requireModule).toHaveBeenCalledWith(context, ModuleKey.SHIPMENT_DOCUMENTS);
    expect(mocks.requireMutationAccess).toHaveBeenCalledWith(context);
    expect(mocks.approve).toHaveBeenCalledWith(context, "artifact-1", {
      jobId: "job-1",
      targetReference: "PS210235",
      confirmation: "APPROVE_TEAMSHIP_UPDATE"
    });
  });
});
