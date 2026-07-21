import { ModuleKey } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  requireModule: vi.fn(),
  requireMutationAccess: vi.fn(),
  createArtifact: vi.fn()
}));

vi.mock("@/server/openclaw-assistant-auth", () => ({
  OpenClawAssistantAuthError: class OpenClawAssistantAuthError extends Error {
    status: number;
    constructor(message: string, status = 401) {
      super(message);
      this.status = status;
    }
  },
  authenticateOpenClawAssistantRequest: (...args: unknown[]) => mocks.authenticate(...args)
}));

vi.mock("@/server/auth/authorization", () => ({
  AuthorizationError: class AuthorizationError extends Error {
    status: number;
    constructor(message: string, status = 403) {
      super(message);
      this.status = status;
    }
  },
  requireModule: (...args: unknown[]) => mocks.requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => mocks.requireMutationAccess(...args)
}));

vi.mock("@/modules/assistant/garland-artifacts", () => ({
  GarlandArtifactError: class GarlandArtifactError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
  createGarlandArtifact: (...args: unknown[]) => mocks.createArtifact(...args)
}));

import { POST } from "@/app/api/assistant/garland/artifacts/route";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl",
  tenantName: "Newl",
  userId: "user-1",
  userEmail: "employee@newl.ca",
  userName: "Employee",
  role: "OPERATIONS"
};

describe("Garland artifact routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(context);
    mocks.createArtifact.mockResolvedValue({ id: "artifact-1", status: "UPLOADING" });
  });

  it("binds the CSR-supplied target reference to the upload before parsing", async () => {
    const response = await POST(new Request("https://newl.test/api/assistant/garland/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "Garland orders.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        chunkCount: 1,
        contentHash: "a".repeat(64),
        targetReference: "PS210235",
        externalMessageId: "teams-message-1",
        externalConversationId: "teams-conversation-1"
      })
    }));

    expect(response.status).toBe(201);
    expect(mocks.requireModule).toHaveBeenCalledWith(context, ModuleKey.SHIPMENT_DOCUMENTS);
    expect(mocks.requireMutationAccess).toHaveBeenCalledWith(context);
    expect(mocks.createArtifact).toHaveBeenCalledWith(context, expect.objectContaining({
      sourceChannel: "TEAMS",
      targetReference: "PS210235"
    }));
  });
});
