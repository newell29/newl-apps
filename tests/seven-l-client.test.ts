import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LtlQuoteRequest, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";

const readFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFile(...args)
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { getLtlQuotes } from "@/server/integrations/seven-l";

const liveAccount: SevenLAccountConfig = {
  id: "account-live",
  name: "7L Live Preferred Carriers",
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
      carrierHash: "carrier-hash-1",
      name: "Southeastern Freight",
      code: "SEFL",
      scac: "SEFL",
      defaulted: true,
      enabled: true
    },
    {
      carrierHash: "carrier-hash-2",
      name: "Old Dominion",
      code: "ODFL",
      scac: "ODFL",
      defaulted: false,
      enabled: false
    }
  ]
};

const dryRunAccount: SevenLAccountConfig = {
  ...liveAccount,
  id: "account-dry-run",
  name: "7L Dry Run - Core LTL",
  dryRun: true,
  secretConfigured: false
};

const lane: LtlQuoteRequest = {
  customerReference: "RFQ-7L",
  originCity: "",
  originState: "",
  originZipcode: "28273",
  originCountry: "US",
  destinationCity: "",
  destinationState: "",
  destinationZipcode: "77001",
  destinationCountry: "US",
  pickupDate: "2026-06-20",
  uom: "US",
  accessorialCodes: ["APPT", "LFTG"],
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
};

describe("7L client integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SEVEN_L_DEV_ACCOUNTS_FILE;
  });

  it("fails loudly when a dry-run account does not have runtime credentials", async () => {
    await expect(getLtlQuotes(dryRunAccount, [lane])).rejects.toThrow(
      "7L runtime credentials are not available for account 7L Dry Run - Core LTL."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails loudly when a live account does not have runtime credentials", async () => {
    await expect(getLtlQuotes(liveAccount, [lane])).rejects.toThrow(
      "7L runtime credentials are not available for account 7L Live Preferred Carriers."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs in, resolves zipcodes, and rates only the configured preferred carriers", async () => {
    process.env.SEVEN_L_DEV_ACCOUNTS_FILE = "/tmp/seven-l.json";
    readFile.mockResolvedValue(
      JSON.stringify([
        {
          name: "7L Live Preferred Carriers",
          username: "demo",
          password: "secret",
          baseUrl: "https://restapi.my7l.com"
        }
      ])
    );

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            accessToken: "token-123",
            exp: Math.floor(Date.now() / 1000) + 3600
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            results: [
              {
                Name: "Southeastern Freight",
                Code: "SEFL",
                SCAC: "SEFL",
                ServiceLevel: "Less than Truckload",
                TransitDays: 2,
                QuoteNumber: "SEFL-123",
                RateBreakdown: [{ MINIMUM: "250.00" }, { "FUEL SURCHARGE": "50.00" }],
                RateRemarks: ["Direct service"],
                Total: "320.00"
              }
            ]
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            results: [
              {
                Name: "Old Dominion",
                Code: "ODFL",
                SCAC: "ODFL",
                ServiceLevel: "Less than Truckload",
                TransitDays: 3,
                QuoteNumber: "ODFL-456",
                RateBreakdown: { MINIMUM: "255.00", "FUEL SURCHARGE": "45.00" },
                RateRemarks: ["Indirect service"],
                Total: "318.00"
              }
            ]
          }
        })
      );

    const response = await getLtlQuotes(
      liveAccount,
      [
        {
          ...lane,
          originCity: "CHARLOTTE",
          originState: "NC",
          destinationCity: "HOUSTON",
          destinationState: "TX"
        }
      ],
      ["carrier-hash-1", "carrier-hash-2"]
    );
    const quotes = response.data;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("https://restapi.my7l.com/api/v1/login");

    const firstRateUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(firstRateUrl.pathname).toBe("/api/v1/ltl/ltlrates");
    expect(firstRateUrl.searchParams.get("carrierHash")).toBe("carrier-hash-1");
    expect(firstRateUrl.searchParams.get("originCity")).toBe("CHARLOTTE");
    expect(firstRateUrl.searchParams.get("destinationState")).toBe("TX");
    expect(firstRateUrl.searchParams.getAll("accessorialsList[]")).toEqual(["APPT", "LFTG"]);
    expect(firstRateUrl.searchParams.get("strictResult")).toBe("true");
    expect(firstRateUrl.searchParams.get("harmonizedCharges")).toBe("true");

    expect(quotes).toHaveLength(2);
    expect(quotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          carrierCode: "SEFL",
          total: 320,
          linehaulCharge: 250,
          fuelCharge: 50,
          accessorialCharge: 20,
          mode: "live",
          originCity: "CHARLOTTE",
          destinationState: "TX"
        }),
        expect.objectContaining({
          carrierCode: "ODFL",
          total: 318,
          linehaulCharge: 255,
          fuelCharge: 45,
          accessorialCharge: 18,
          mode: "live"
        })
      ])
    );
    expect(response.errors).toEqual([]);
  });

  it("returns carrier-specific errors without failing the entire pull", async () => {
    process.env.SEVEN_L_DEV_ACCOUNTS_FILE = "/tmp/seven-l.json";
    readFile.mockResolvedValue(
      JSON.stringify([
        {
          name: "7L Live Preferred Carriers",
          username: "demo-errors",
          password: "secret",
          baseUrl: "https://restapi.my7l.com"
        }
      ])
    );

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            accessToken: "token-123",
            exp: Math.floor(Date.now() / 1000) + 3600
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            results: [
              {
                Name: "Southeastern Freight",
                Code: "SEFL",
                SCAC: "SEFL",
                ServiceLevel: "Less than Truckload",
                TransitDays: 2,
                QuoteNumber: "SEFL-123",
                RateBreakdown: [{ MINIMUM: "250.00" }, { "FUEL SURCHARGE": "50.00" }],
                RateRemarks: ["Direct service"],
                Total: "320.00"
              }
            ]
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            results: [
              {
                Name: "Old Dominion",
                Code: "ODFL",
                SCAC: "ODFL",
                Error: "Old Dominion lane unavailable"
              }
            ]
          }
        })
      );

    const response = await getLtlQuotes(
      liveAccount,
      [
        {
          ...lane,
          originCity: "CHARLOTTE",
          originState: "NC",
          destinationCity: "HOUSTON",
          destinationState: "TX"
        }
      ],
      ["carrier-hash-1", "carrier-hash-2"]
    );

    expect(response.data).toHaveLength(1);
    expect(response.data[0]).toEqual(
      expect.objectContaining({
        carrierCode: "SEFL"
      })
    );
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body)
  };
}
