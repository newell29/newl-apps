import { describe, expect, it } from "vitest";
import { getPreferredAccount, groupResults } from "@/modules/ltl-rate-portal/components/ltl-rate-portal-client";
import type { LtlCarrierErrorResult, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";

const baseCarrierError: LtlCarrierErrorResult = {
  customerReference: "Ref-Only-Errors",
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
  accessorialCodes: [],
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
      hazmat: false,
      stack: false
    }
  ],
  carrierHash: "carrier-1",
  carrierName: "Southeastern Freight",
  carrierCode: "SEFL",
  scac: "SEFL",
  errorMessage: "Carrier refused this lane",
  mode: "live"
};

describe("LTL rate portal client grouping", () => {
  it("prefers a live configured account over the seeded dry-run account", () => {
    const accounts: SevenLAccountConfig[] = [
      {
        id: "dry-run",
        name: "7L Dry Run - Core LTL",
        status: "ACTIVE",
        baseUrl: "https://restapi.my7l.com",
        defaultUom: "US",
        strictResult: false,
        harmonizedCharges: true,
        dryRun: true,
        carrierMode: "TENANT_SELECTED",
        secretConfigured: false,
        carriers: [
          {
            carrierHash: "carrier-1",
            name: "CSA - Intra Canada",
            code: "CSACAD",
            scac: "CSAP",
            defaulted: true,
            enabled: true
          }
        ]
      },
      {
        id: "live-account",
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
            carrierHash: "carrier-2",
            name: "Estes",
            code: "EST",
            scac: "EXLA",
            defaulted: true,
            enabled: true
          }
        ]
      }
    ];

    expect(getPreferredAccount(accounts)?.id).toBe("live-account");
  });

  it("keeps zero-success carrier errors visible as grouped lane results", () => {
    const grouped = groupResults([], [
      baseCarrierError,
      {
        ...baseCarrierError,
        carrierHash: "carrier-2",
        carrierName: "Old Dominion",
        carrierCode: "ODFL",
        scac: "ODFL",
        errorMessage: "Lane unavailable for requested service"
      }
    ]);

    expect(grouped).toEqual([
      {
        customerReference: "Ref-Only-Errors",
        originLabel: "Charlotte, NC 28273",
        destinationLabel: "Houston, TX 77001",
        weightLabel: "1,000 lb",
        carrierResults: {
          "Southeastern Freight (SEFL)": {
            errorMessage: "Carrier refused this lane"
          },
          "Old Dominion (ODFL)": {
            errorMessage: "Lane unavailable for requested service"
          }
        },
        cheapestCarrier: "",
        cheapestRate: null
      }
    ]);
  });
});
