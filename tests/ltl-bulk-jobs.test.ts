import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatus } from "@prisma/client";

const findFirst = vi.fn();
const findMany = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    automationJobRun: {
      findFirst: (...args: unknown[]) => findFirst(...args)
    },
    ltlBatchQuoteLane: {
      findMany: (...args: unknown[]) => findMany(...args)
    }
  }
}));

import { exportLtlBulkQuoteJobCsv, mapBulkJobSummary } from "@/modules/ltl-rate-portal/bulk-jobs";

describe("LTL bulk job helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("zero-fills malformed summary payloads safely", () => {
    const summary = mapBulkJobSummary({
      id: "job-1",
      status: JobStatus.RUNNING,
      startedAt: new Date("2026-06-16T12:00:00.000Z"),
      finishedAt: null,
      input: {
        accountId: "account-1",
        accountName: "7L Preferred LTL"
      },
      output: {
        totalLanes: "bad",
        processedLanes: 3
      },
      errorMessage: null
    });

    expect(summary).toMatchObject({
      id: "job-1",
      accountId: "account-1",
      accountName: "7L Preferred LTL",
      totalLanes: 0,
      processedLanes: 3,
      quotedLanes: 0,
      issueLanes: 0,
      quoteCount: 0,
      errorCount: 0,
      selectedCarrierCount: 0
    });
  });

  it("exports carrier/error columns and cheapest-rate fields", async () => {
    findFirst.mockResolvedValue({
      id: "job-1",
      status: JobStatus.SUCCESS,
      startedAt: new Date("2026-06-16T12:00:00.000Z"),
      finishedAt: new Date("2026-06-16T12:10:00.000Z"),
      input: {
        accountId: "account-1",
        accountName: "7L Preferred LTL"
      },
      output: {
        totalLanes: 1,
        processedLanes: 1,
        quotedLanes: 1,
        issueLanes: 1,
        quoteCount: 1,
        errorCount: 1,
        selectedCarrierCount: 2
      },
      errorMessage: null
    });
    findMany.mockResolvedValue([
      {
        laneIndex: 0,
        customerReference: "RFQ-1",
        quoteCount: 1,
        errorCount: 1,
        requestJson: {
          customerReference: "RFQ-1",
          originCity: "CHARLOTTE",
          originState: "NC",
          originZipcode: "28273",
          originCountry: "US",
          destinationCity: "HOUSTON",
          destinationState: "TX",
          destinationZipcode: "77001",
          destinationCountry: "US",
          pickupDate: "2026-06-20",
          uom: "US",
          accessorialCodes: [],
          pieces: [
            {
              qty: 1,
              weight: 500,
              weightType: "each",
              length: 0,
              width: 0,
              height: 0,
              dimType: "PLT",
              freightClass: "125",
              hazmat: false,
              stack: false
            }
          ]
        },
        quotesJson: [
          {
            customerReference: "RFQ-1",
            originCity: "CHARLOTTE",
            originState: "NC",
            originZipcode: "28273",
            originCountry: "US",
            destinationCity: "HOUSTON",
            destinationState: "TX",
            destinationZipcode: "77001",
            destinationCountry: "US",
            pickupDate: "2026-06-20",
            uom: "US",
            accessorialCodes: [],
            pieces: [
              {
                qty: 1,
                weight: 500,
                weightType: "each",
                length: 0,
                width: 0,
                height: 0,
                dimType: "PLT",
                freightClass: "125",
                hazmat: false,
                stack: false
              }
            ],
            carrierHash: "carrier-1",
            carrierName: "Estes",
            carrierCode: "EST",
            scac: "EXLA",
            serviceLevel: "LTL",
            transitDays: 2,
            quoteNumber: "Q-1",
            total: 345.67,
            fuelCharge: 40,
            accessorialCharge: 18,
            linehaulCharge: 287.67,
            rateRemarks: [],
            mode: "live"
          }
        ],
        errorsJson: [
          {
            customerReference: "RFQ-1",
            originCity: "CHARLOTTE",
            originState: "NC",
            originZipcode: "28273",
            originCountry: "US",
            destinationCity: "HOUSTON",
            destinationState: "TX",
            destinationZipcode: "77001",
            destinationCountry: "US",
            pickupDate: "2026-06-20",
            uom: "US",
            accessorialCodes: [],
            pieces: [
              {
                qty: 1,
                weight: 500,
                weightType: "each",
                length: 0,
                width: 0,
                height: 0,
                dimType: "PLT",
                freightClass: "125",
                hazmat: false,
                stack: false
              }
            ],
            carrierHash: "carrier-2",
            carrierName: "CSA - Cross Border",
            carrierCode: "CSAUS",
            scac: "CSAP",
            errorMessage: "US to US not allowed",
            mode: "live"
          }
        ]
      }
    ]);

    const csv = await exportLtlBulkQuoteJobCsv(
      {
        tenantId: "tenant-1",
        tenantSlug: "tenant-one",
        tenantName: "Tenant One"
      },
      "job-1"
    );

    expect(csv).toContain("RFQ-1");
    expect(csv).toContain("Estes (EXLA)");
    expect(csv).toContain("CSA - Cross Border (CSAP)");
    expect(csv).toContain("345.67");
  });
});
