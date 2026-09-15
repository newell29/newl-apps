import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LtlQuoteRequest, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";

const readFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFile(...args)
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { getLtlQuotes, resetSevenLRuntimeCacheForTests } from "@/server/integrations/seven-l";

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
    delete process.env.SEVEN_L_RUNTIME_ACCOUNTS_JSON;
    delete process.env.SEVEN_L_RUNTIME_ACCOUNTS_BASE64;
    resetSevenLRuntimeCacheForTests();
  });

  it("fails loudly when a dry-run account does not have runtime credentials", async () => {
    await expect(getLtlQuotes(dryRunAccount, [lane])).rejects.toThrow(
      "7L runtime credentials are not available for account 7L Dry Run - Core LTL. Configure a matching 7L runtime account in Vercel env vars or the local runtime file before requesting rates."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails loudly when a live account does not have runtime credentials", async () => {
    await expect(getLtlQuotes(liveAccount, [lane])).rejects.toThrow(
      "7L runtime credentials are not available for account 7L Live Preferred Carriers. Configure a matching 7L runtime account in Vercel env vars or the local runtime file before requesting rates."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses Vercel-style env runtime accounts without requiring the local credentials file", async () => {
    process.env.SEVEN_L_RUNTIME_ACCOUNTS_JSON = JSON.stringify([
      {
        name: "7L Live Preferred Carriers",
        username: "env-demo",
        password: "env-secret",
        baseUrl: "https://restapi.my7l.com"
      }
    ]);

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
      ["carrier-hash-1"]
    );

    expect(readFile).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.data).toHaveLength(1);
    expect(response.errors).toEqual([]);
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

  it("limits carrier concurrency while preserving the complete carrier outcome set", async () => {
    process.env.SEVEN_L_RUNTIME_ACCOUNTS_JSON = JSON.stringify([
      {
        name: "7L Live Preferred Carriers",
        username: "parallel-demo",
        password: "secret",
        baseUrl: "https://restapi.my7l.com"
      }
    ]);
    const account = accountWithCarriers(5);
    let activeRates = 0;
    let maxActiveRates = 0;

    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.endsWith("/api/v1/login")) {
        return jsonResponse({ data: { accessToken: "token-123", exp: Math.floor(Date.now() / 1000) + 3600 } });
      }
      if (url.includes("/api/v1/ltl/ltlrates")) {
        activeRates += 1;
        maxActiveRates = Math.max(maxActiveRates, activeRates);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeRates -= 1;
        const carrierHash = new URL(url).searchParams.get("carrierHash") ?? "";
        if (carrierHash === "carrier-hash-3") {
          return jsonResponse({ data: { results: [{ Error: "Carrier unavailable" }] } });
        }
        return jsonResponse({
          data: {
            results: [
              {
                Name: carrierHash,
                Code: carrierHash,
                SCAC: carrierHash,
                ServiceLevel: "Less than Truckload",
                TransitDays: 2,
                QuoteNumber: carrierHash,
                RateBreakdown: [{ MINIMUM: "100.00" }],
                RateRemarks: [],
                Total: carrierHash === "carrier-hash-4" ? "90.00" : "100.00"
              }
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const response = await getLtlQuotes(
      account,
      [{ ...lane, originCity: "CHARLOTTE", originState: "NC", destinationCity: "HOUSTON", destinationState: "TX" }],
      account.carriers.map((carrier) => carrier.carrierHash),
      { carrierConcurrency: 3 }
    );

    expect(maxActiveRates).toBeLessThanOrEqual(3);
    expect(response.data).toHaveLength(4);
    expect(response.errors).toHaveLength(1);
    expect(response.data.map((quote) => quote.carrierHash)).toEqual([
      "carrier-hash-1",
      "carrier-hash-2",
      "carrier-hash-4",
      "carrier-hash-5"
    ]);
  });

  it("reuses shared ZIP lookups and deduplicates in-flight token login under concurrency", async () => {
    process.env.SEVEN_L_RUNTIME_ACCOUNTS_JSON = JSON.stringify([
      {
        name: "7L Live Preferred Carriers",
        username: "shared-demo",
        password: "secret",
        baseUrl: "https://restapi.my7l.com"
      }
    ]);
    const sharedLocationCache = new Map();
    let loginCalls = 0;
    let zipCalls = 0;
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.endsWith("/api/v1/login")) {
        loginCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse({ data: { accessToken: "token-123", exp: Math.floor(Date.now() / 1000) + 3600 } });
      }
      if (url.includes("/api/v1/tools/zipcodes")) {
        zipCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        const parsed = new URL(url);
        const zipcode = parsed.searchParams.get("zipcode") ?? "";
        return jsonResponse({
          data: {
            results: [
              {
                City: zipcode === "28273" ? "Charlotte" : "Houston",
                StateAbbr: zipcode === "28273" ? "NC" : "TX",
                Country: "US",
                Zipcode: zipcode
              }
            ]
          }
        });
      }
      if (url.includes("/api/v1/ltl/ltlrates")) {
        return jsonResponse({
          data: {
            results: [
              {
                Name: "Southeastern Freight",
                Code: "SEFL",
                SCAC: "SEFL",
                ServiceLevel: "Less than Truckload",
                TransitDays: 2,
                QuoteNumber: "SEFL-123",
                RateBreakdown: [{ MINIMUM: "250.00" }],
                RateRemarks: [],
                Total: "320.00"
              }
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await Promise.all([
      getLtlQuotes(liveAccount, [lane], ["carrier-hash-1"], { locationCache: sharedLocationCache }),
      getLtlQuotes(liveAccount, [lane], ["carrier-hash-1"], { locationCache: sharedLocationCache })
    ]);

    expect(loginCalls).toBe(1);
    expect(zipCalls).toBe(2);
  });

  it("converts timed-out carrier calls into safe carrier failures", async () => {
    process.env.SEVEN_L_RUNTIME_ACCOUNTS_JSON = JSON.stringify([
      {
        name: "7L Live Preferred Carriers",
        username: "timeout-demo",
        password: "secret",
        baseUrl: "https://restapi.my7l.com"
      }
    ]);
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/login")) {
        return jsonResponse({ data: { accessToken: "token-123", exp: Math.floor(Date.now() / 1000) + 3600 } });
      }
      if (url.includes("/api/v1/ltl/ltlrates")) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const response = await getLtlQuotes(
      liveAccount,
      [{ ...lane, originCity: "CHARLOTTE", originState: "NC", destinationCity: "HOUSTON", destinationState: "TX" }],
      ["carrier-hash-1"],
      { requestTimeoutMs: 5 }
    );

    expect(response.data).toEqual([]);
    expect(response.errors).toEqual([
      expect.objectContaining({
        carrierHash: "carrier-hash-1",
        errorMessage: "7L carrier request timed out after 5 ms."
      })
    ]);
  });
});

function accountWithCarriers(count: number): SevenLAccountConfig {
  return {
    ...liveAccount,
    carriers: Array.from({ length: count }, (_, index) => ({
      carrierHash: `carrier-hash-${index + 1}`,
      name: `Carrier ${index + 1}`,
      code: `C${index + 1}`,
      scac: `C${index + 1}`,
      defaulted: false,
      enabled: true
    }))
  };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body)
  };
}
