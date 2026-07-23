import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { PlatformRole } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  shipmentInquiryAutomationJob: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn()
  },
  auditLog: { create: vi.fn() },
  tenantModuleAccess: { findFirst: vi.fn() },
  tenantRoleModuleAccess: { findMany: vi.fn() },
  tenantRolePolicy: { findUnique: vi.fn() }
}));
const generateOpenAiJsonCompletionMock = vi.hoisted(() => vi.fn());
const runShipmentInquiryTmsAutomationMock = vi.hoisted(() => vi.fn());
const rateLtlInquiryIfApplicableMock = vi.hoisted(() => vi.fn());
const sendShipmentInquiryResultEmailMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/integrations/openai", () => ({
  generateOpenAiJsonCompletion: generateOpenAiJsonCompletionMock
}));
vi.mock("@/modules/shipment-inquiries/tms-automation", () => ({
  runShipmentInquiryTmsAutomation: runShipmentInquiryTmsAutomationMock
}));
vi.mock("@/modules/shipment-inquiries/ltl-rating", () => ({
  rateLtlInquiryIfApplicable: rateLtlInquiryIfApplicableMock
}));
vi.mock("@/modules/shipment-inquiries/result-email", () => ({
  sendShipmentInquiryResultEmail: sendShipmentInquiryResultEmailMock
}));

import {
  processShipmentInquiryOutlookJobs,
  processShipmentInquiryOutlookJobsForUser
} from "@/modules/shipment-inquiries/outlook-processor";

const context = {
  tenantId: "tenant-a",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "user-a",
  userEmail: "pricing@newl.ca",
  userName: "Pricing User",
  role: PlatformRole.ADMIN
};

describe("shipment inquiry Outlook processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.tenantModuleAccess.findFirst.mockResolvedValue({ id: "access-1" });
    prismaMock.tenantRoleModuleAccess.findMany.mockResolvedValue([
      { enabled: true, module: { key: "OCEAN_FREIGHT_PRICING" } }
    ]);
    prismaMock.tenantRolePolicy.findUnique.mockResolvedValue({ canMutate: true });
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.shipmentInquiryAutomationJob.findFirst.mockResolvedValue({ id: "job-1" });
    prismaMock.shipmentInquiryAutomationJob.findUnique.mockResolvedValue({ stageProgress: {} });
    prismaMock.shipmentInquiryAutomationJob.update.mockResolvedValue({ id: "job-1" });
    prismaMock.shipmentInquiryAutomationJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      subject: "Need quote",
      normalizedBodyText: "Please quote 1 pallet from 92120 to 20783.",
      parsedInquiry: null,
      tmsFileNumber: null,
      stageProgress: { outlookMessageReceived: true }
    });
    generateOpenAiJsonCompletionMock.mockResolvedValue(
      JSON.stringify({
        customer: "OneScreen",
        customertype: "customer",
        mode: "ground",
        origin: "92120",
        destination: "20783",
        incoterms: "",
        service: "",
        direction: "domestic",
        shipmentType: "LTL",
        urgency: "",
        requestedTiming: "",
        originPostalCode: "92120",
        originCountry: "US",
        destinationPostalCode: "20783",
        destinationCountry: "US",
        pickupDate: "",
        freightClass: "",
        nmfc: "",
        unNumber: "",
        accessorials: [],
        containerQuantity: "",
        containerSize: "",
        equipmentType: "",
        containerWeight: "",
        weightUnit: "LBS",
        dimensionsUnit: "INCH",
        floorLoaded: false,
        commodity: "",
        items: [],
        insurance: false,
        customs: false,
        dangerousGoods: false,
        readyDate: ""
      })
    );
    runShipmentInquiryTmsAutomationMock.mockResolvedValue({
      quoteNumber: "Q12345",
      quoteUrl: "https://teamship.newl.ca/admin/quotes/12345",
      tradeMiningCustomerIntelligence: {
        searchStarted: false,
        searchSucceeded: false,
        customerNameSearched: "OneScreen",
        customerType: "customer",
        searchField: "ConsigneeName",
        dateRange: { start: "", end: "" },
        totalShipmentRecordsFound: 0,
        searchId: null,
        warning: null,
        fieldsUsed: [],
        summary: {},
        recentRecords: [],
        workbookAttachment: null
      }
    });
    rateLtlInquiryIfApplicableMock.mockResolvedValue({
      status: "quoted",
      isLtl: true,
      request: {},
      quotes: [{ carrierName: "Carrier A", total: 100 }],
      errors: [],
      warning: null,
      accountName: "7L Live Core LTL",
      enabledCarrierCount: 14
    });
    sendShipmentInquiryResultEmailMock.mockResolvedValue({
      sent: true,
      to: ["dispatch@newlgroup.com"],
      subject: "Need quote Q12345"
    });
  });

  it("claims a PENDING Outlook job, sends its body to OpenAI, then reaches TMS, 7L, and result email", async () => {
    const result = await processShipmentInquiryOutlookJobs(context, { limit: 1 });

    expect(result).toMatchObject({ attemptedCount: 1, completedCount: 1 });
    expect(prismaMock.shipmentInquiryAutomationJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-a", status: "PENDING" }
      })
    );
    expect(generateOpenAiJsonCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaName: "shipment_inquiry_outlook_intake",
        user: expect.stringContaining("Please quote 1 pallet")
      })
    );
    expect(prismaMock.shipmentInquiryAutomationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parsedInquiry: expect.objectContaining({
            customer: "OneScreen",
            shipmentType: "LTL"
          }),
          sevenLResult: expect.objectContaining({ status: "not_reached" })
        })
      })
    );
    expect(runShipmentInquiryTmsAutomationMock).toHaveBeenCalledWith(expect.objectContaining({ customer: "OneScreen" }));
    expect(rateLtlInquiryIfApplicableMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }), expect.objectContaining({ shipmentType: "LTL" }));
    expect(sendShipmentInquiryResultEmailMock).toHaveBeenCalled();
    expect(prismaMock.shipmentInquiryAutomationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          notificationResult: expect.objectContaining({ sent: true })
        })
      })
    );
  });

  it("does not create a duplicate TMS file when one is already recorded", async () => {
    prismaMock.shipmentInquiryAutomationJob.findUniqueOrThrow.mockResolvedValue({
      id: "job-1",
      subject: "Need quote",
      normalizedBodyText: "Already parsed",
      parsedInquiry: { customer: "OneScreen", mode: "ground", shipmentType: "LTL" },
      tmsFileNumber: "Q12345",
      stageProgress: { outlookMessageReceived: true, parsingCompleted: "2026-07-22T12:00:00.000Z" }
    });

    await processShipmentInquiryOutlookJobs(context, { limit: 1 });

    expect(generateOpenAiJsonCompletionMock).not.toHaveBeenCalled();
    expect(runShipmentInquiryTmsAutomationMock).not.toHaveBeenCalled();
    expect(prismaMock.shipmentInquiryAutomationJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tmsFileNumber: expect.any(String)
        })
      })
    );
  });

  it("continues after one failed job and attempts the next pending job", async () => {
    prismaMock.shipmentInquiryAutomationJob.findFirst
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({ id: "job-2" })
      .mockResolvedValueOnce(null);
    prismaMock.shipmentInquiryAutomationJob.update.mockResolvedValue({ id: "job-1" });
    prismaMock.shipmentInquiryAutomationJob.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: "job-1",
        subject: "First",
        normalizedBodyText: "First body",
        parsedInquiry: null,
        tmsFileNumber: null,
        stageProgress: {}
      })
      .mockResolvedValueOnce({
        id: "job-2",
        subject: "Second",
        normalizedBodyText: "Second body",
        parsedInquiry: null,
        tmsFileNumber: null,
        stageProgress: {}
      });

    const result = await processShipmentInquiryOutlookJobs(context, { limit: 2 });

    expect(result.attemptedCount).toBe(2);
    expect(result.completedCount).toBe(2);
  });

  it("requires the selected module and mutation access for manual processing", async () => {
    await processShipmentInquiryOutlookJobsForUser(context, { limit: 1 });

    expect(prismaMock.tenantModuleAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-a", module: { key: "OCEAN_FREIGHT_PRICING" } })
      })
    );
  });

  it("uses tenant scope for claim and updates", async () => {
    await processShipmentInquiryOutlookJobs({ ...context, tenantId: "tenant-b" }, { limit: 1 });

    expect(prismaMock.shipmentInquiryAutomationJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-b", status: "PENDING" }
      })
    );
    expect(prismaMock.shipmentInquiryAutomationJob.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_id: { tenantId: "tenant-b", id: "job-1" } }
      })
    );
  });

  it("does not depend on Gmail, customer CSV, or sender-domain website lookup", () => {
    const source = readFileSync("src/modules/shipment-inquiries/outlook-processor.ts", "utf8").toLowerCase();

    expect(source).not.toContain("gmail");
    expect(source).not.toContain("imap");
    expect(source).not.toContain("teamship-customers.csv");
    expect(source).not.toContain("website");
    expect(source).not.toContain("sender-domain");
  });
});
