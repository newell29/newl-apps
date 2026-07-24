import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  garlandSourceAttachment: {
    findMany: vi.fn()
  }
}));
const getGarlandGraphSettingsMock = vi.hoisted(() => vi.fn());
const requireModuleMock = vi.hoisted(() => vi.fn());
const requireMutationAccessMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: requireModuleMock,
  requireMutationAccess: requireMutationAccessMock
}));
vi.mock("@/modules/shipment-documents/garland-email-intake", () => ({
  getGarlandGraphSettings: getGarlandGraphSettingsMock
}));
vi.mock("@/server/integrations/microsoft-graph-application", () => ({
  getMicrosoftGraphApplicationAccessToken: vi.fn()
}));
vi.mock("@/server/integrations/microsoft-graph-mail", () => ({
  fetchMicrosoftGraphMessageAttachmentContent: vi.fn()
}));
vi.mock("@/modules/shipment-documents/garland-pdf-server-extraction", () => ({
  extractGarlandShippingOrdersFromPdfBytes: vi.fn()
}));
vi.mock("@/modules/shipment-documents/garland-product-dimension-directory", () => ({
  getGarlandLearnedProductDimensionRecommendations: vi.fn()
}));
vi.mock("@/modules/shipment-documents/teamship-review-history", () => ({
  saveTeamshipReviewRun: vi.fn()
}));
vi.mock("@/modules/shipment-documents/teamship-update-jobs", () => ({
  approveTeamshipUpdateJob: vi.fn(),
  createTeamshipUpdateJob: vi.fn()
}));
vi.mock("@/server/integrations/teamship", () => ({
  fetchTeamshipShippingOrdersForReview: vi.fn()
}));

import { processGarlandEmailAgentReadyAttachments } from "@/modules/shipment-documents/garland-email-agent-automation";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl",
  tenantName: "Newl",
  userId: "system:garland-email-intake",
  userEmail: "garland-email-intake@newl.internal",
  userName: "Garland Email Intake Scheduler",
  role: "ADMIN"
} as const;

describe("Garland email attachment processing queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGarlandGraphSettingsMock.mockResolvedValue({
      mailSyncEnabled: true,
      crossMailboxReady: true,
      runtimeNotes: ""
    });
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([]);
  });

  it("prioritizes newly received PDFs and does not let permanent parse failures consume the bounded queue", async () => {
    await processGarlandEmailAgentReadyAttachments(context, { maxAttachments: 8 });

    expect(prismaMock.garlandSourceAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          intakeStatus: { in: ["PDF_METADATA_READY"] }
        }),
        orderBy: [{ sourceEmail: { receivedAt: "desc" } }, { createdAt: "desc" }],
        take: 8
      })
    );
  });

  it("retries failed PDFs only when an operator explicitly requests it", async () => {
    await processGarlandEmailAgentReadyAttachments(context, {
      maxAttachments: 8,
      retryFailedAttachments: true
    });

    expect(prismaMock.garlandSourceAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          intakeStatus: { in: ["PDF_METADATA_READY", "PDF_PARSE_FAILED"] }
        })
      })
    );
  });
});
