import { beforeEach, describe, expect, it, vi } from "vitest";

const requireModule = vi.fn();
const getLtlRatePortalShell = vi.fn();
const getLtlQuotes = vi.fn();

vi.mock("@/server/auth/authorization", () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  requireModule: (...args: unknown[]) => requireModule(...args)
}));

vi.mock("@/modules/ltl-rate-portal/queries", () => ({
  getLtlRatePortalShell: (...args: unknown[]) => getLtlRatePortalShell(...args)
}));

vi.mock("@/server/integrations/seven-l", () => ({
  getLtlQuotes: (...args: unknown[]) => getLtlQuotes(...args)
}));

import { maybeRunAssistantRateRequest, parseAssistantRatePrompt } from "@/modules/assistant/rate-workflow";

describe("parseAssistantRatePrompt", () => {
  it("extracts an LTL shipment when the prompt includes postal codes, dims, and weight", () => {
    const parsed = parseAssistantRatePrompt(
      "Need a rate from Charlotte NC 28273 to Dallas TX 75201 40x48x50 at 500 lbs for 2 pallets."
    );

    expect(parsed).toMatchObject({
      missingFields: [],
      request: {
        originZipcode: "28273",
        destinationZipcode: "75201"
      }
    });
    expect(parsed?.request?.pieces[0]).toMatchObject({
      qty: 2,
      length: 40,
      width: 48,
      height: 50,
      weight: 500
    });
  });

  it("asks for missing postal codes when only city names are provided", () => {
    const parsed = parseAssistantRatePrompt(
      "Need a rate from Charlotte to Dallas 40x48x50 at 500 lbs."
    );

    expect(parsed?.request).toBeNull();
    expect(parsed?.missingFields).toEqual(["origin ZIP/postal code", "destination ZIP/postal code"]);
  });
});

describe("maybeRunAssistantRateRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a clarification response when the shipment is incomplete", async () => {
    const result = await maybeRunAssistantRateRequest(
      {
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantName: "Tenant 1",
        userId: "user-1",
        userEmail: "alex@newl.ca",
        userName: "Alex",
        role: "ADMIN"
      },
      "Need a rate from Charlotte to Dallas 40x48x50 at 500 lbs."
    );

    expect(result?.answer).toContain("Still needed: origin ZIP/postal code, destination ZIP/postal code.");
    expect(requireModule).not.toHaveBeenCalled();
  });

  it("routes a complete request to 7L and formats the returned quotes", async () => {
    requireModule.mockResolvedValue(undefined);
    getLtlRatePortalShell.mockResolvedValue({
      accounts: [
        {
          id: "account-1",
          name: "7L Live Preferred Carriers",
          status: "ACTIVE",
          dryRun: false,
          secretConfigured: true,
          carriers: [
            {
              carrierHash: "carrier-a",
              name: "AAA Cooper",
              code: "AAA",
              scac: "AACT",
              enabled: true
            }
          ]
        }
      ]
    });
    getLtlQuotes.mockResolvedValue({
      data: [
        {
          customerReference: "ASSIST",
          originCity: "CHARLOTTE",
          originState: "NC",
          originZipcode: "28273",
          originCountry: "US",
          destinationCity: "DALLAS",
          destinationState: "TX",
          destinationZipcode: "75201",
          destinationCountry: "US",
          pickupDate: "Not scheduled",
          uom: "US",
          accessorialCodes: [],
          pieces: [],
          carrierHash: "carrier-a",
          carrierName: "AAA Cooper",
          carrierCode: "AAA",
          scac: "AACT",
          serviceLevel: "Less than Truckload",
          transitDays: 3,
          quoteNumber: "AAA-ASSIST-1",
          total: 412.33,
          fuelCharge: 52.11,
          accessorialCharge: 0,
          linehaulCharge: 360.22,
          rateRemarks: [],
          mode: "live"
        }
      ],
      errors: []
    });

    const result = await maybeRunAssistantRateRequest(
      {
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantName: "Tenant 1",
        userId: "user-1",
        userEmail: "alex@newl.ca",
        userName: "Alex",
        role: "ADMIN"
      },
      "Need a rate from Charlotte NC 28273 to Dallas TX 75201 40x48x50 at 500 lbs."
    );

    expect(requireModule).toHaveBeenCalled();
    expect(getLtlQuotes).toHaveBeenCalledTimes(1);
    expect(result?.answer).toContain("Lowest rate: AAA Cooper at $412.33");
    expect(result?.sources[0]).toMatchObject({
      sourceKind: "RATE_TOOL",
      title: "AAA Cooper 7L quote"
    });
  });

  it("summarizes all attempted carrier errors when 7L returns no rates", async () => {
    requireModule.mockResolvedValue(undefined);
    getLtlRatePortalShell.mockResolvedValue({
      accounts: [
        {
          id: "account-1",
          name: "7L Live Preferred Carriers",
          status: "ACTIVE",
          dryRun: false,
          secretConfigured: true,
          carriers: [
            {
              carrierHash: "carrier-a",
              name: "AAA Cooper",
              code: "AAA",
              scac: "AACT",
              enabled: true
            },
            {
              carrierHash: "carrier-b",
              name: "Estes Express",
              code: "EST",
              scac: "EXLA",
              enabled: true
            }
          ]
        }
      ]
    });
    getLtlQuotes.mockResolvedValue({
      data: [],
      errors: [
        {
          carrierHash: "carrier-a",
          carrierName: "AAA Cooper",
          carrierCode: "AAA",
          scac: "AACT",
          errorMessage: "7L returned no rate results for carrier AAA Cooper.",
          mode: "live"
        },
        {
          carrierHash: "carrier-b",
          carrierName: "Estes Express",
          carrierCode: "EST",
          scac: "EXLA",
          errorMessage: "Lane not serviced.",
          mode: "live"
        }
      ]
    });

    const result = await maybeRunAssistantRateRequest(
      {
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantName: "Tenant 1",
        userId: "user-1",
        userEmail: "alex@newl.ca",
        userName: "Alex",
        role: "ADMIN"
      },
      "need a rate 28273 to 90210 48x48x48 500 lbs 1 pallet"
    );

    expect(result?.answer).toContain("7L returned no rate results");
    expect(result?.answer).toContain("Enabled carrier(s) checked: AAA Cooper, Estes Express.");
    expect(result?.answer).toContain("AAA Cooper: 7L returned no rate results for carrier AAA Cooper.");
    expect(result?.answer).toContain("Estes Express: Lane not serviced.");
    expect(result?.metadata).toMatchObject({
      quoted: false,
      enabledCarrierCount: 2,
      errorCount: 2
    });
  });

  it("returns a useful message when the 7L quote call fails before carrier results", async () => {
    requireModule.mockResolvedValue(undefined);
    getLtlRatePortalShell.mockResolvedValue({
      accounts: [
        {
          id: "account-1",
          name: "7L Live Preferred Carriers",
          status: "ACTIVE",
          dryRun: false,
          secretConfigured: true,
          carriers: [
            {
              carrierHash: "carrier-a",
              name: "AAA Cooper",
              code: "AAA",
              scac: "AACT",
              enabled: true
            }
          ]
        }
      ]
    });
    getLtlQuotes.mockRejectedValue(new Error("7L zipcode lookup did not return city/state for 90210."));

    const result = await maybeRunAssistantRateRequest(
      {
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantName: "Tenant 1",
        userId: "user-1",
        userEmail: "alex@newl.ca",
        userName: "Alex",
        role: "ADMIN"
      },
      "need a rate 28273 to 90210 48x48x48 500 lbs 1 pallet"
    );

    expect(result?.answer).toContain("I could not complete the 7L quote");
    expect(result?.answer).toContain("7L zipcode lookup did not return city/state for 90210.");
    expect(result?.metadata).toMatchObject({
      quoted: false,
      quoteBlocked: "7l-error"
    });
  });
});
