import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedContextMock = vi.hoisted(() => vi.fn());
const requireModuleMock = vi.hoisted(() => vi.fn());
const requireMutationAccessMock = vi.hoisted(() => vi.fn());
const processGarlandEmailAgentReadyAttachmentsMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  garlandSourceAttachment: {
    findMany: vi.fn()
  },
  auditLog: {
    create: vi.fn()
  }
}));

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: getAuthenticatedContextMock
}));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: requireModuleMock,
  requireMutationAccess: requireMutationAccessMock
}));
vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/modules/shipment-documents/garland-email-agent-automation", () => ({
  processGarlandEmailAgentReadyAttachments: processGarlandEmailAgentReadyAttachmentsMock
}));

import { POST } from "@/app/api/shipment-documents/teamship-review/email-intake/run-review/route";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "synthetic",
  tenantName: "Synthetic Tenant",
  userId: "user-1",
  userEmail: "user@example.com",
  userName: "Synthetic User",
  role: "ADMIN"
} as const;

const automationResult = {
  processedAttachmentCount: 1,
  parsedAttachmentCount: 1,
  duplicateAttachmentCount: 0,
  failedAttachmentCount: 0,
  deferredAllMissingAttachmentCount: 0,
  createdReviewRunIds: ["review-run-1"],
  createdUpdateJobIds: ["update-job-1"],
  approvedUpdateJobIds: ["update-job-1"],
  skippedReasons: []
};

describe("manual Garland email batch review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedContextMock.mockResolvedValue(context);
    requireModuleMock.mockResolvedValue(undefined);
    requireMutationAccessMock.mockResolvedValue(undefined);
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-1",
        sourceEmail: {
          expectedPsStart: "PS123456",
          expectedPsEnd: "PS123459"
        }
      }
    ]);
    processGarlandEmailAgentReadyAttachmentsMock.mockResolvedValue(automationResult);
  });

  it("requires the exact server-side confirmation before processing", async () => {
    const response = await callRoute({
      attachmentIds: ["attachment-1"],
      expectedPsStart: "PS123456",
      expectedPsEnd: "PS123459"
    });

    expect(response.status).toBe(400);
    expect(processGarlandEmailAgentReadyAttachmentsMock).not.toHaveBeenCalled();
  });

  it("starts only the confirmed tenant-scoped batch and audits the request and outcome", async () => {
    const response = await callRoute({
      attachmentIds: [" attachment-1 ", "attachment-1"],
      expectedPsStart: "ps123456",
      expectedPsEnd: "ps123459",
      confirmation: "RUN_GARLAND_TEAMSHIP_REVIEW"
    });

    expect(response.status).toBe(200);
    expect(requireModuleMock).toHaveBeenCalledWith(context, "SHIPMENT_DOCUMENTS");
    expect(requireMutationAccessMock).toHaveBeenCalledWith(context);
    expect(prismaMock.garlandSourceAttachment.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        id: { in: ["attachment-1"] }
      },
      select: expect.any(Object)
    });
    expect(processGarlandEmailAgentReadyAttachmentsMock).toHaveBeenCalledWith(context, {
      attachmentIds: ["attachment-1"],
      maxAttachments: 1
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.auditLog.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          actorUserId: "user-1",
          action: "garland.email-intake.manual-review-requested"
        })
      })
    );
    expect(prismaMock.auditLog.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ action: "garland.email-intake.manual-review-finished" })
      })
    );
    await expect(response.json()).resolves.toEqual({ data: automationResult });
  });

  it("rejects attachment identifiers outside the authenticated tenant", async () => {
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([]);

    const response = await callRoute({
      attachmentIds: ["attachment-other-tenant"],
      confirmation: "RUN_GARLAND_TEAMSHIP_REVIEW"
    });

    expect(response.status).toBe(404);
    expect(processGarlandEmailAgentReadyAttachmentsMock).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a stale UI selection whose saved PS range changed", async () => {
    const response = await callRoute({
      attachmentIds: ["attachment-1"],
      expectedPsStart: "PS123460",
      expectedPsEnd: "PS123461",
      confirmation: "RUN_GARLAND_TEAMSHIP_REVIEW"
    });

    expect(response.status).toBe(409);
    expect(processGarlandEmailAgentReadyAttachmentsMock).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a selection containing an attachment from a different saved PS range", async () => {
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-1",
        sourceEmail: { expectedPsStart: "PS123456", expectedPsEnd: "PS123459" }
      },
      {
        id: "attachment-2",
        sourceEmail: { expectedPsStart: "PS123460", expectedPsEnd: "PS123461" }
      }
    ]);

    const response = await callRoute({
      attachmentIds: ["attachment-1", "attachment-2"],
      expectedPsStart: "PS123456",
      expectedPsEnd: "PS123459",
      confirmation: "RUN_GARLAND_TEAMSHIP_REVIEW"
    });

    expect(response.status).toBe(409);
    expect(processGarlandEmailAgentReadyAttachmentsMock).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

function callRoute(body: Record<string, unknown>) {
  return POST(
    new Request("https://newl.test/api/shipment-documents/teamship-review/email-intake/run-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}
