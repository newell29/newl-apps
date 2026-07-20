import { describe, expect, it } from "vitest";
import { estimateLtlQuotes, serializeFreightInfo } from "@/modules/ltl-rate-portal/engine";
import type { LtlQuoteRequest, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";

const dryRunAccount: SevenLAccountConfig = {
  id: "7l-dry-1",
  name: "Seven L Dry Run",
  status: "ACTIVE",
  baseUrl: "https://example.invalid/7l",
  defaultUom: "US",
  strictResult: false,
  harmonizedCharges: true,
  dryRun: true,
  carrierMode: "TENANT_SELECTED",
  secretConfigured: false,
  carriers: [
    {
      carrierHash: "hash-1",
      name: "Southeastern Freight",
      code: "SEFL",
      scac: "SEFL",
      defaulted: true,
      enabled: true
    },
    {
      carrierHash: "hash-2",
      name: "Old Dominion",
      code: "ODFL",
      scac: "ODFL",
      defaulted: false,
      enabled: true
    }
  ]
};

const quoteRequest: LtlQuoteRequest = {
  customerReference: "Ref #12 / Dry Run",
  originCity: "Charlotte",
  originState: "NC",
  originZipcode: "28273",
  originCountry: "US",
  destinationCity: "Houston",
  destinationState: "TX",
  destinationZipcode: "77001",
  destinationCountry: "US",
  pickupDate: "2026-06-20",
  uom: "US",
  accessorialCodes: ["APD", "HAZ"],
  pieces: [
    {
      qty: 2,
      weight: 500,
      weightType: "each",
      length: 48,
      width: 40,
      height: 60,
      dimType: "PLT",
      freightClass: "100",
      hazmat: true,
      unNumber: "UN1993",
      nmfc: "12345",
      stack: true,
      stackAmount: 2,
      commodity: "Paint"
    },
    {
      qty: 1,
      weight: 200,
      weightType: "each",
      length: 24,
      width: 20,
      height: 20,
      dimType: "BOX",
      freightClass: "150",
      hazmat: false,
      stack: false
    }
  ]
};

describe("LTL rate portal dry-run engine", () => {
  it("serializes freight pieces in the 7L payload shape", () => {
    expect(serializeFreightInfo(quoteRequest.pieces)).toBe(
      JSON.stringify([
        {
          qty: "2",
          weight: "500",
          weightType: "each",
          length: "48",
          width: "40",
          height: "60",
          dimType: "PLT",
          class: "100",
          hazmat: true,
          UN: "UN1993",
          nmfc: "12345",
          stack: true,
          stackAmount: 2,
          commodity: "Paint"
        },
        {
          qty: "1",
          weight: "200",
          weightType: "each",
          length: "24",
          width: "20",
          height: "20",
          dimType: "BOX",
          class: "150",
          hazmat: false,
          UN: "",
          nmfc: "",
          stack: false,
          stackAmount: 0,
          commodity: ""
        }
      ])
    );
  });

  it("generates deterministic dry-run quotes for each configured carrier", () => {
    const quotes = estimateLtlQuotes(dryRunAccount, quoteRequest);

    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({
      carrierHash: "hash-1",
      carrierName: "Southeastern Freight",
      carrierCode: "SEFL",
      scac: "SEFL",
      serviceLevel: "Less than Truckload",
      transitDays: 6,
      quoteNumber: "SEFL-REF12DRY-1",
      linehaulCharge: 581.2,
      fuelCharge: 92.99,
      accessorialCharge: 82,
      total: 756.19,
      mode: "dry-run",
      rateRemarks: [
        "Dry-run estimate for Southeastern Freight.",
        "Includes APD, HAZ accessorial pricing.",
        "Hazmat surcharge simulated from 7L-style freight profile."
      ]
    });
    expect(quotes[1]).toMatchObject({
      carrierHash: "hash-2",
      carrierCode: "ODFL",
      transitDays: 7,
      quoteNumber: "ODFL-REF12DRY-2",
      linehaulCharge: 592.2,
      fuelCharge: 100.67,
      accessorialCharge: 82,
      total: 774.87,
      mode: "dry-run"
    });
  });

  it("adds cross-border remarks when origin and destination countries differ", () => {
    const quotes = estimateLtlQuotes(dryRunAccount, {
      ...quoteRequest,
      destinationCountry: "CA",
      destinationZipcode: "M5H2N2"
    });

    expect(quotes[0].rateRemarks).toContain(
      "Cross-border transit and customs timing should be confirmed before quoting."
    );
    expect(quotes[0].transitDays).toBeGreaterThanOrEqual(1);
    expect(quotes[0].transitDays).toBeLessThanOrEqual(7);
  });
});
