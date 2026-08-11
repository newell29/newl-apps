import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  garlandSourceAttachment: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn()
  }
}));
const getGarlandGraphSettingsMock = vi.hoisted(() => vi.fn());
const requireModuleMock = vi.hoisted(() => vi.fn());
const requireMutationAccessMock = vi.hoisted(() => vi.fn());
const getMicrosoftGraphApplicationAccessTokenMock = vi.hoisted(() => vi.fn());
const fetchMicrosoftGraphMessageAttachmentContentMock = vi.hoisted(() => vi.fn());
const extractGarlandShippingOrdersFromPdfBytesMock = vi.hoisted(() => vi.fn());
const getGarlandLearnedProductDimensionRecommendationsMock = vi.hoisted(() => vi.fn());
const buildGarlandTeamshipReviewMock = vi.hoisted(() => vi.fn());
const saveTeamshipReviewRunMock = vi.hoisted(() => vi.fn());
const buildTeamshipPhase2DryRunPlanMock = vi.hoisted(() => vi.fn());
const fetchTeamshipShippingOrdersForReviewMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: requireModuleMock,
  requireMutationAccess: requireMutationAccessMock
}));
vi.mock("@/modules/shipment-documents/garland-email-intake", () => ({
  getGarlandGraphSettings: getGarlandGraphSettingsMock
}));
vi.mock("@/server/integrations/microsoft-graph-application", () => ({
  getMicrosoftGraphApplicationAccessToken: getMicrosoftGraphApplicationAccessTokenMock
}));
vi.mock("@/server/integrations/microsoft-graph-mail", () => ({
  fetchMicrosoftGraphMessageAttachmentContent: fetchMicrosoftGraphMessageAttachmentContentMock
}));
vi.mock("@/modules/shipment-documents/garland-pdf-server-extraction", () => ({
  extractGarlandShippingOrdersFromPdfBytes: extractGarlandShippingOrdersFromPdfBytesMock
}));
vi.mock("@/modules/shipment-documents/garland-product-dimension-directory", () => ({
  getGarlandLearnedProductDimensionRecommendations: getGarlandLearnedProductDimensionRecommendationsMock
}));
vi.mock("@/modules/shipment-documents/teamship-review", () => ({
  buildGarlandTeamshipReview: buildGarlandTeamshipReviewMock
}));
vi.mock("@/modules/shipment-documents/teamship-review-history", () => ({
  saveTeamshipReviewRun: saveTeamshipReviewRunMock
}));
vi.mock("@/modules/shipment-documents/teamship-phase2-dry-run", () => ({
  buildTeamshipPhase2DryRunPlan: buildTeamshipPhase2DryRunPlanMock
}));
vi.mock("@/modules/shipment-documents/teamship-update-jobs", () => ({
  approveTeamshipUpdateJob: vi.fn(),
  createTeamshipUpdateJob: vi.fn()
}));
vi.mock("@/server/integrations/teamship", () => ({
  fetchTeamshipShippingOrdersForReview: fetchTeamshipShippingOrdersForReviewMock
}));

import {
  isCompletelyMissingTeamshipBatch,
  processGarlandEmailAgentReadyAttachments
} from "@/modules/shipment-documents/garland-email-agent-automation";

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T12:30:00.000Z"));
    vi.clearAllMocks();
    getGarlandGraphSettingsMock.mockResolvedValue({
      mailSyncEnabled: true,
      crossMailboxReady: true,
      runtimeNotes: ""
    });
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([]);
    prismaMock.garlandSourceAttachment.findFirst.mockResolvedValue(null);
    prismaMock.garlandSourceAttachment.update.mockResolvedValue({});
    getMicrosoftGraphApplicationAccessTokenMock.mockResolvedValue("graph-token");
    fetchMicrosoftGraphMessageAttachmentContentMock.mockResolvedValue({ contentBytes: "cGRm" });
    extractGarlandShippingOrdersFromPdfBytesMock.mockResolvedValue(buildExtraction());
    getGarlandLearnedProductDimensionRecommendationsMock.mockResolvedValue([]);
    buildGarlandTeamshipReviewMock.mockReturnValue(buildReview({ pdfOrderCount: 4, missingTeamshipCount: 4 }));
    saveTeamshipReviewRunMock.mockResolvedValue("review-run-1");
    buildTeamshipPhase2DryRunPlanMock.mockReturnValue({ orders: [] });
    fetchTeamshipShippingOrdersForReviewMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prioritizes newly received PDFs and does not let permanent parse failures consume the bounded queue", async () => {
    await processGarlandEmailAgentReadyAttachments(context, { maxAttachments: 8 });

    expect(prismaMock.garlandSourceAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          OR: expect.arrayContaining([
            { intakeStatus: { in: ["PDF_METADATA_READY"] } },
            expect.objectContaining({
              intakeStatus: {
                in: [
                  "TEAMSHIP_BATCH_RETRY_PENDING_1",
                  "TEAMSHIP_BATCH_RETRY_PENDING_2",
                  "TEAMSHIP_BATCH_RETRY_PENDING_3"
                ]
              },
              updatedAt: { lte: new Date("2026-08-11T12:25:00.000Z") }
            })
          ])
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
          OR: expect.arrayContaining([
            { intakeStatus: { in: ["PDF_METADATA_READY", "PDF_PARSE_FAILED"] } }
          ])
        })
      })
    );
  });

  it("defers a newly received batch when every PDF order is missing from Teamship", async () => {
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([buildAttachment("PDF_METADATA_READY")]);

    const result = await processGarlandEmailAgentReadyAttachments(context, { maxAttachments: 8 });

    expect(result.deferredAllMissingAttachmentCount).toBe(1);
    expect(result.skippedReasons).toContain(
      "4 ORDERS 6 PAGES - PS123456 - PS123459.pdf: all 4 PDF orders were missing in Teamship; retry 1 of 3 is deferred for 5 minutes."
    );
    expect(saveTeamshipReviewRunMock).not.toHaveBeenCalled();
    expect(prismaMock.garlandSourceAttachment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { tenantId_id: { tenantId: "tenant-1", id: "attachment-1" } },
        data: expect.objectContaining({ intakeStatus: "TEAMSHIP_BATCH_RETRY_PENDING_1" })
      })
    );
  });

  it("finalizes a partial match immediately instead of retrying the genuinely missing rows", async () => {
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([buildAttachment("PDF_METADATA_READY")]);
    buildGarlandTeamshipReviewMock.mockReturnValue(
      buildReview({ pdfOrderCount: 4, missingTeamshipCount: 3, teamshipMatchedCount: 1 })
    );

    const result = await processGarlandEmailAgentReadyAttachments(context, { maxAttachments: 8 });

    expect(result.deferredAllMissingAttachmentCount).toBe(0);
    expect(saveTeamshipReviewRunMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.garlandSourceAttachment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ intakeStatus: "PDF_PARSED" }) })
    );
  });

  it("finalizes a completely missing batch after the third delayed retry", async () => {
    prismaMock.garlandSourceAttachment.findMany.mockResolvedValue([
      buildAttachment("TEAMSHIP_BATCH_RETRY_PENDING_3")
    ]);

    const result = await processGarlandEmailAgentReadyAttachments(context, { maxAttachments: 8 });

    expect(result.deferredAllMissingAttachmentCount).toBe(0);
    expect(saveTeamshipReviewRunMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.garlandSourceAttachment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ intakeStatus: "PDF_PARSED" }) })
    );
  });

  it("recognizes only zero-match, all-missing reviews as retry candidates", () => {
    expect(isCompletelyMissingTeamshipBatch(buildReview({ pdfOrderCount: 4, missingTeamshipCount: 4 }))).toBe(true);
    expect(
      isCompletelyMissingTeamshipBatch(
        buildReview({ pdfOrderCount: 4, missingTeamshipCount: 3, teamshipMatchedCount: 1 })
      )
    ).toBe(false);
    expect(isCompletelyMissingTeamshipBatch(buildReview({ pdfOrderCount: 0, missingTeamshipCount: 0 }))).toBe(false);
  });
});

function buildAttachment(intakeStatus: string) {
  return {
    id: "attachment-1",
    tenantId: "tenant-1",
    sourceEmailId: "email-1",
    graphAttachmentId: "graph-attachment-1",
    fileName: "4 ORDERS 6 PAGES - PS123456 - PS123459.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    contentHash: null,
    pageCount: null,
    extractedPsNumbers: null,
    extractedSrNumbers: null,
    extractionFingerprint: null,
    intakeStatus,
    duplicateOfAttachmentId: null,
    storageRef: null,
    parseError: null,
    createdAt: new Date("2026-08-11T12:30:00.000Z"),
    updatedAt: new Date("2026-08-11T12:30:00.000Z"),
    sourceEmail: {
      id: "email-1",
      mailboxAddress: "warehouse@example.com",
      graphMessageId: "message-1",
      subject: "4 ORDERS 6 PAGES - PS123456 - PS123459",
      receivedAt: new Date("2026-08-11T12:30:00.000Z")
    }
  };
}

function buildExtraction() {
  return {
    contentHash: "synthetic-hash",
    pageCount: 4,
    psNumbers: ["PS123456", "PS123457", "PS123458", "PS123459"],
    srNumbers: ["SR812345", "SR812346", "SR812347", "SR812348"],
    orders: [
      {
        psNumber: "PS123456",
        srNumber: "SR812345",
        pageNumbers: [1],
        items: []
      }
    ]
  };
}

function buildReview({
  pdfOrderCount,
  missingTeamshipCount,
  teamshipMatchedCount = 0
}: {
  pdfOrderCount: number;
  missingTeamshipCount: number;
  teamshipMatchedCount?: number;
}) {
  return {
    summary: {
      pdfOrderCount,
      teamshipMatchedCount,
      passedCount: 0,
      failedCount: 0,
      missingTeamshipCount,
      pendingTeamshipCount: 0,
      noPdfCount: 0,
      skippedAlreadyReviewedCount: 0
    },
    pdfOrders: [],
    reviews: [],
    teamshipAlerts: [],
    fetchedAt: "2026-08-11T12:35:00.000Z"
  };
}
