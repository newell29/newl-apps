import { describe, expect, it, vi } from "vitest";
import { rateLtlInquiryIfApplicable } from "@/modules/tms-bridge/ltl-inquiry-rating";
import {
  buildCompletedInquiryEmailHtml,
  getCompletedInquiryEmailRecipient,
  getOpsRepNameForInquiry,
  type LogisticsInquiry,
  type TmsCreatedQuoteResult
} from "@/modules/tms-bridge/actions";
import type { LtlCarrierErrorResult, LtlQuoteResult, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";
import type { TradeMiningCustomerIntelligenceResult } from "@/modules/tms-bridge/trademining-customer-intelligence";

const account: SevenLAccountConfig = {
  id: "7l-1",
  name: "7L Preferred LTL",
  status: "ACTIVE",
  baseUrl: "https://restapi.my7l.com",
  defaultUom: "US",
  strictResult: true,
  harmonizedCharges: true,
  dryRun: false,
  carrierMode: "TENANT_SELECTED",
  secretConfigured: true,
  carriers: [
    {
      carrierHash: "carrier-1",
      name: "Carrier One",
      code: "ONE",
      scac: "ONE",
      defaulted: true,
      enabled: true
    },
    {
      carrierHash: "carrier-2",
      name: "Carrier Two",
      code: "TWO",
      scac: "TWO",
      defaulted: true,
      enabled: true
    },
    {
      carrierHash: "carrier-3",
      name: "Carrier Three",
      code: "THR",
      scac: "THR",
      defaulted: true,
      enabled: false
    }
  ]
};

const dryRunAccount: SevenLAccountConfig = {
  ...account,
  id: "7l-dry-run",
  name: "7L Dry Run - Core LTL",
  dryRun: true,
  secretConfigured: false
};

describe("TMS bridge LTL inquiry rating", () => {
  it("rates an LTL inquiry with a valid adapter request and successful 7L results", async () => {
    const getQuotes = vi.fn().mockResolvedValue({
      data: [quoteResult()],
      errors: []
    });

    const result = await rateLtlInquiryIfApplicable(validLtlInquiry(), dependencies({ getQuotes }));

    expect(result.status).toBe("quoted");
    expect(result.quotes).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(getQuotes).toHaveBeenCalledWith(account, [expect.objectContaining({ originZipcode: "28273", destinationZipcode: "77001" })], [
      "carrier-1",
      "carrier-2",
      "carrier-3"
    ]);
  });

  it("skips 7L when an LTL inquiry is missing a postal code", async () => {
    const getQuotes = vi.fn();
    const result = await rateLtlInquiryIfApplicable(
      validLtlInquiry({
        destinationPostalCode: ""
      }),
      dependencies({ getQuotes })
    );

    expect(result.status).toBe("skipped");
    expect(result.adapter?.request).toBeNull();
    expect(result.adapter?.missingRequiredFields).toContain("destinationPostalCode");
    expect(result.adapter?.warnings).toContain(
      "7L rate request skipped because the current 7L integration requires origin and destination postal codes."
    );
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it("skips 7L when freight class is missing and cannot be estimated", async () => {
    const getQuotes = vi.fn();
    const result = await rateLtlInquiryIfApplicable(
      validLtlInquiry({
        freightClass: "",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            length: "48",
            width: "40",
            height: "",
            weight: "1200",
            weightType: "total",
            freightClass: "",
            nmfc: "",
            unNumber: "",
            stackable: ""
          }
        ]
      }),
      dependencies({ getQuotes })
    );

    expect(result.status).toBe("skipped");
    expect(result.adapter?.missingRequiredFields).toEqual(expect.arrayContaining(["items[0].height", "items[0].freightClass"]));
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it("keeps carrier-level errors separately when another carrier succeeds", async () => {
    const getQuotes = vi.fn().mockResolvedValue({
      data: [quoteResult()],
      errors: [carrierError()]
    });

    const result = await rateLtlInquiryIfApplicable(validLtlInquiry(), dependencies({ getQuotes }));

    expect(result.status).toBe("quoted");
    expect(result.quotes).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.errorMessage).toBe("Carrier Two unavailable");
  });

  it("fails safely when only a dry-run 7L account is configured", async () => {
    const getQuotes = vi.fn();
    const getAvailableCarriers = vi.fn();

    const result = await rateLtlInquiryIfApplicable(validLtlInquiry(), {
      getTenantContext: vi.fn().mockResolvedValue({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantName: "Tenant 1"
      }),
      getShell: vi.fn().mockResolvedValue({
        moduleEnabled: true,
        accounts: [dryRunAccount],
        hasActiveAccounts: true,
        recentBulkJobs: []
      }),
      getAvailableCarriers,
      getQuotes
    });

    expect(result.status).toBe("failed");
    expect(result.accountName).toBeNull();
    expect(result.enabledCarrierCount).toBe(0);
    expect(result.warning).toBe("7L rating failed because no active live 7L account with configured runtime credentials was found for the TMS bridge tenant.");
    expect(result.quotes).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(getAvailableCarriers).not.toHaveBeenCalled();
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it("returns a safe failed result when 7L fails after the TMS quote was created", async () => {
    const getQuotes = vi.fn().mockRejectedValue(new Error("7L zipcode lookup did not return city/state for 77001."));

    const result = await rateLtlInquiryIfApplicable(validLtlInquiry(), dependencies({ getQuotes }));

    expect(result.status).toBe("failed");
    expect(result.warning).toBe("7L rating failed: 7L zipcode lookup did not return city/state for 77001.");
    expect(result.quotes).toEqual([]);
  });

  it("does not call 7L for an ocean inquiry so the existing TradeMining branch can remain responsible", async () => {
    const getQuotes = vi.fn();

    const result = await rateLtlInquiryIfApplicable(
      validLtlInquiry({
        mode: "ocean",
        shipmentType: "FCL"
      }),
      dependencies({ getQuotes })
    );

    expect(result.status).toBe("not_applicable");
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it("does not call 7L for non-LTL trucking inquiries", async () => {
    const getQuotes = vi.fn();

    const result = await rateLtlInquiryIfApplicable(validLtlInquiry({ shipmentType: "FTL" }), dependencies({ getQuotes }));

    expect(result.status).toBe("not_applicable");
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it("keeps quote number and URL in dispatch email when 7L fails", async () => {
    const ltlRating = await rateLtlInquiryIfApplicable(
      validLtlInquiry(),
      dependencies({
        getQuotes: vi.fn().mockRejectedValue(new Error("7L login failed with status 401."))
      })
    );

    const html = buildCompletedInquiryEmailHtml({
      parsedData: validLtlInquiry(),
      quote: quoteDetails(),
      tradeMining: skippedTradeMining(),
      ltlRating,
      warnings: [ltlRating.warning]
    });

    expect(html).toContain("Q12345");
    expect(html).toContain("https://teamship.newl.ca/quotes/Q12345");
    expect(html).toContain("7L rating failed after the TMS quote was created.");
    expect(html).toContain("7L login failed with status 401.");
    expect(html).toContain("7L accessorials");
    expect(html).toContain("Destination liftgate");
    expect(html).not.toContain("<td>LFD</td>");
  });

  it("routes LTL result emails only to dispatch", () => {
    expect(getCompletedInquiryEmailRecipient({ isLtl: true })).toBe("dispatch@newlgroup.com");
  });

  it("keeps non-LTL result emails routed to pricing", () => {
    expect(getCompletedInquiryEmailRecipient()).toBe("pricing@newlgroup.com");
    expect(getCompletedInquiryEmailRecipient({ isLtl: false })).toBe("pricing@newlgroup.com");
  });

  it("uses Dispatch D as the TMS ops rep for LTL inquiries", () => {
    expect(getOpsRepNameForInquiry(validLtlInquiry())).toBe("Dispatch D");
  });

  it("keeps Pricing D as the TMS ops rep for non-LTL inquiries", () => {
    expect(getOpsRepNameForInquiry(validLtlInquiry({ mode: "ocean", shipmentType: "FCL" }))).toBe("Pricing D");
  });

  it("shows only requested LTL inquiry details while keeping Teamship and 7L information", async () => {
    const ltlRating = await rateLtlInquiryIfApplicable(
      validLtlInquiry({
        accessorials: ["Inside Delivery = Yes", "Liftgate Delivery = Yes"],
        insurance: true,
        customs: true,
        dangerousGoods: false
      }),
      dependencies({
        getQuotes: vi.fn().mockResolvedValue({
          data: [quoteResult()],
          errors: []
        })
      })
    );

    const html = buildCompletedInquiryEmailHtml({
      parsedData: validLtlInquiry({
        accessorials: ["Inside Delivery = Yes", "Liftgate Delivery = Yes"],
        insurance: true,
        customs: true,
        dangerousGoods: false
      }),
      quote: quoteDetails(),
      tradeMining: {
        ...skippedTradeMining(),
        warning: "TradeMining skipped for LTL inquiry. 7L rating is used for LTL after the TMS quote is created."
      },
      ltlRating,
      warnings: [ltlRating.warning]
    });

    expect(html).toContain("Quote #");
    expect(html).toContain("Q12345");
    expect(html).toContain("Teamship Link");
    expect(html).toContain("7L LTL Rating");
    expect(html).toContain("font-family:Arial,sans-serif; font-size:11px; color:rgb(0,0,104);");
    expect(html).toContain("Carrier One");
    expect(html).toContain("Customer");
    expect(html).toContain("Shipment type");
    expect(html).toContain("Origin");
    expect(html).toContain("Destination");
    expect(html).toContain("Items");
    expect(html).toContain("Weight unit");
    expect(html).toContain("Dimension unit");
    expect(html).toContain("Commodity");
    expect(html).toContain("Dangerous goods");
    expect(html).toContain("Detected accessorials");
    expect(html).toContain("Destination inside");
    expect(html).toContain("Destination liftgate");
    expect(html).toContain("Insurance");
    expect(html).toContain("Customs");
    expect(html).not.toContain("Customer type");
    expect(html).not.toContain("Incoterms");
    expect(html).not.toContain("Container quantity");
    expect(html).not.toContain("Container size");
    expect(html).not.toContain("Equipment type");
    expect(html).not.toContain("TradeMining");
  });

  it("keeps non-LTL inquiry email content unchanged", () => {
    const html = buildCompletedInquiryEmailHtml({
      parsedData: validLtlInquiry({
        mode: "ocean",
        shipmentType: "FCL",
        containerQuantity: "1",
        containerSize: "40",
        equipmentType: "HC"
      }),
      quote: quoteDetails(),
      tradeMining: skippedTradeMining(),
      warnings: []
    });

    expect(html).toContain("Customer type");
    expect(html).toContain("Mode");
    expect(html).toContain("Incoterms");
    expect(html).toContain("Container quantity");
    expect(html).toContain("Container size");
    expect(html).toContain("Equipment type");
    expect(html).toContain("TradeMining");
    expect(html).not.toContain("7L LTL Rating");
  });

  it("shows postal codes in the dispatch email when origin and destination text are blank", () => {
    const html = buildCompletedInquiryEmailHtml({
      parsedData: validLtlInquiry({
        origin: "",
        destination: "",
        originPostalCode: "92120",
        destinationPostalCode: "20783"
      }),
      quote: quoteDetails(),
      tradeMining: skippedTradeMining(),
      ltlRating: {
        status: "skipped",
        isLtl: true,
        adapter: {
          canRequestRates: false,
          request: null,
          missingRequiredFields: ["items[0].height"],
          appliedDefaults: [],
          freightClassEstimates: [],
          detectedAccessorials: [],
          unsupportedOrUnmappedTerms: [],
          warnings: []
        },
        quotes: [],
        errors: [],
        warning: "7L rating skipped because the parsed LTL inquiry is missing required rating fields.",
        accountName: null,
        enabledCarrierCount: 0
      },
      warnings: []
    });

    expect(html).toContain("92120");
    expect(html).toContain("20783");
  });

  it("includes density-estimated freight class warning in the dispatch email", async () => {
    const inquiry = validLtlInquiry({
      freightClass: "",
      items: [
        {
          quantity: "1",
          packagingType: "pallet",
          length: "70",
          width: "70",
          height: "70",
          weight: "3000",
          weightType: "total",
          freightClass: "",
          nmfc: "",
          unNumber: "",
          stackable: ""
        }
      ]
    });
    const ltlRating = await rateLtlInquiryIfApplicable(
      inquiry,
      dependencies({
        getQuotes: vi.fn().mockResolvedValue({
          data: [quoteResult()],
          errors: []
        })
      })
    );

    const html = buildCompletedInquiryEmailHtml({
      parsedData: inquiry,
      quote: quoteDetails(),
      tradeMining: skippedTradeMining(),
      ltlRating,
      warnings: []
    });

    expect(html).toContain("Freight class was estimated from shipment density because no freight class was provided in the inquiry.");
    expect(html).toContain("The carrier may reclassify the shipment.");
    expect(html).toContain("Density 15.114 lb/ft3; estimated class 70");
  });
});

function dependencies({ getQuotes }: { getQuotes: ReturnType<typeof vi.fn> }) {
  return {
    getTenantContext: vi.fn().mockResolvedValue({
      tenantId: "tenant-1",
      tenantSlug: "tenant-1",
      tenantName: "Tenant 1"
    }),
    getShell: vi.fn().mockResolvedValue({
      moduleEnabled: true,
      accounts: [account],
      hasActiveAccounts: true,
      recentBulkJobs: []
    }),
    getAvailableCarriers: vi.fn().mockResolvedValue(account.carriers),
    getQuotes
  };
}

function validLtlInquiry(overrides: Partial<LogisticsInquiry> = {}): LogisticsInquiry {
  return {
    customer: "Example Customer",
    customertype: "customer",
    mode: "ground",
    origin: "Charlotte, NC 28273",
    destination: "Houston, TX 77001",
    incoterms: "",
    service: "",
    direction: "domestic",
    shipmentType: "LTL",
    urgency: "",
    requestedTiming: "",
    originPostalCode: "28273",
    originCountry: "US",
    destinationPostalCode: "77001",
    destinationCountry: "US",
    pickupDate: "2026-07-20",
    freightClass: "125",
    nmfc: "",
    unNumber: "",
    stackable: "",
    accessorials: ["liftgate delivery required"],
    containerQuantity: "",
    containerSize: "",
    equipmentType: "",
    containerWeight: "",
    weightUnit: "LBS",
    dimensionsUnit: "INCH",
    floorLoaded: false,
    commodity: "General freight",
    items: [
      {
        quantity: "1",
        packagingType: "pallet",
        length: "48",
        width: "40",
        height: "52",
        weight: "1200",
        weightType: "total",
        freightClass: "125",
        nmfc: "",
        unNumber: "",
        stackable: ""
      }
    ],
    insurance: false,
    customs: false,
    dangerousGoods: false,
    readyDate: "",
    ...overrides
  };
}

function quoteResult(): LtlQuoteResult {
  return {
    ...validLtlInquiry(),
    customerReference: "Example Customer",
    originCity: "CHARLOTTE",
    originState: "NC",
    originZipcode: "28273",
    originCountry: "US",
    destinationCity: "HOUSTON",
    destinationState: "TX",
    destinationZipcode: "77001",
    destinationCountry: "US",
    pickupDate: "2026-07-20",
    uom: "US",
    accessorialCodes: ["LFD"],
    pieces: [
      {
        qty: 1,
        weight: 1200,
        weightType: "total",
        length: 48,
        width: 40,
        height: 52,
        dimType: "PLT",
        freightClass: "125",
        hazmat: false,
        stack: true
      }
    ],
    carrierHash: "carrier-1",
    carrierName: "Carrier One",
    carrierCode: "ONE",
    scac: "ONE",
    serviceLevel: "LTL",
    transitDays: 3,
    quoteNumber: "7L-111",
    total: 450.25,
    fuelCharge: 55,
    accessorialCharge: 25,
    linehaulCharge: 370.25,
    rateRemarks: ["Direct service"],
    mode: "live"
  };
}

function carrierError(): LtlCarrierErrorResult {
  return {
    ...quoteResult(),
    carrierHash: "carrier-2",
    carrierName: "Carrier Two",
    carrierCode: "TWO",
    scac: "TWO",
    errorMessage: "Carrier Two unavailable"
  };
}

function quoteDetails(): TmsCreatedQuoteResult {
  return {
    quoteNumber: "Q12345",
    quoteUrl: "https://teamship.newl.ca/quotes/Q12345",
    tradeMiningCustomerIntelligence: skippedTradeMining()
  };
}

function skippedTradeMining(): TradeMiningCustomerIntelligenceResult {
  return {
    searchStarted: false,
    searchSucceeded: false,
    customerNameSearched: "Example Customer",
    customerType: "customer",
    searchField: "ConsigneeName",
    dateRange: {
      start: "",
      end: ""
    },
    totalShipmentRecordsFound: 0,
    searchId: null,
    warning: null,
    fieldsUsed: [],
    summary: {},
    recentRecords: [],
    workbookAttachment: null
  };
}
