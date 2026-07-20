import { describe, expect, it } from "vitest";
import { estimateLtlQuotes, serializeFreightInfo } from "@/modules/ltl-rate-portal/engine";
import type { LtlQuoteRequest, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";

const liveAccount: SevenLAccountConfig = {
  id: "7l-live-1",
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
      carrierHash: "preferred-sefl",
      name: "Southeastern Freight",
      code: "SEFL",
      scac: "SEFL",
      defaulted: true,
      enabled: true
    },
    {
      carrierHash: "preferred-odfl",
      name: "Old Dominion",
      code: "ODFL",
      scac: "ODFL",
      defaulted: false,
      enabled: true
    }
  ]
};

const request: LtlQuoteRequest = {
  customerReference: "Subset / Live #42",
  originCity: "Charlotte",
  originState: "NC",
  originZipcode: "28273",
  originCountry: "US",
  destinationCity: "Atlanta",
  destinationState: "GA",
  destinationZipcode: "30301",
  destinationCountry: "US",
  pickupDate: "2026-06-21",
  uom: "US",
  accessorialCodes: ["apd", "haz", " lfd "].map((code) => code.trim().toUpperCase()),
  pieces: [
    {
      qty: 1,
      weight: 400,
      weightType: "each",
      length: 48,
      width: 40,
      height: 55,
      dimType: "PLT",
      freightClass: "92.5",
      hazmat: true,
      unNumber: "1993",
      nmfc: "01519500",
      stack: true,
      stackAmount: 2,
      commodity: "Adhesives"
    }
  ]
};

describe("LTL live rating contract", () => {
  it("rates only the preferred carrier subset and preserves live mode for every quote", () => {
    const quotes = estimateLtlQuotes(liveAccount, request);

    expect(quotes).toHaveLength(2);
    expect(quotes.map((quote) => quote.carrierHash)).toEqual(["preferred-sefl", "preferred-odfl"]);
    expect(new Set(quotes.map((quote) => quote.mode))).toEqual(new Set(["live"]));
    expect(quotes.map((quote) => quote.quoteNumber)).toEqual(["SEFL-SUBSETLI-1", "ODFL-SUBSETLI-2"]);
  });

  it("serializes freight info in the stringified 7L query payload shape expected for ltlrates", () => {
    expect(serializeFreightInfo(request.pieces)).toBe(
      JSON.stringify([
        {
          qty: "1",
          weight: "400",
          weightType: "each",
          length: "48",
          width: "40",
          height: "55",
          dimType: "PLT",
          class: "92.5",
          hazmat: true,
          UN: "1993",
          nmfc: "01519500",
          stack: true,
          stackAmount: 2,
          commodity: "Adhesives"
        }
      ])
    );
  });

  it("matches the expected 7L query string contract for a live preferred-carrier request", () => {
    const params = new URLSearchParams();
    params.set("carrierHash", liveAccount.carriers[0].carrierHash);
    params.set("originCity", request.originCity);
    params.set("originState", request.originState);
    params.set("originZipcode", request.originZipcode);
    params.set("originCountry", request.originCountry);
    params.set("destinationCity", request.destinationCity);
    params.set("destinationState", request.destinationState);
    params.set("destinationZipcode", request.destinationZipcode);
    params.set("destinationCountry", request.destinationCountry);
    params.set("freightInfo", serializeFreightInfo(request.pieces));
    params.set("UOM", request.uom);
    params.set("strictResult", String(liveAccount.strictResult));
    params.set("harmonizedCharges", String(liveAccount.harmonizedCharges));
    params.set("pickupDate", request.pickupDate);
    for (const code of request.accessorialCodes) {
      params.append("accessorialsList[]", code);
    }

    expect(params.toString()).toContain("carrierHash=preferred-sefl");
    expect(params.toString()).toContain("pickupDate=2026-06-21");
    expect(params.get("UOM")).toBe("US");
    expect(params.get("strictResult")).toBe("true");
    expect(params.get("harmonizedCharges")).toBe("true");
    expect(params.getAll("accessorialsList[]")).toEqual(["APD", "HAZ", "LFD"]);
    expect(params.get("freightInfo")).toBe(serializeFreightInfo(request.pieces));
  });
});
