import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleKey, PlatformRole } from "@prisma/client";
import type { AuthenticatedContext } from "@/server/tenant-context";
import type { LtlCarrierErrorResult, LtlQuoteResult, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";

const getAuthenticatedContext = vi.fn();
const requireModule = vi.fn();
const requireMutationAccess = vi.fn();
const getLtlRatePortalShell = vi.fn();
const getLtlQuotes = vi.fn();

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: () => getAuthenticatedContext()
}));

vi.mock("@/server/auth/authorization", () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => requireMutationAccess(...args)
}));

vi.mock("@/modules/ltl-rate-portal/queries", () => ({
  getLtlRatePortalShell: (...args: unknown[]) => getLtlRatePortalShell(...args)
}));

vi.mock("@/server/integrations/seven-l", () => ({
  getLtlQuotes: (...args: unknown[]) => getLtlQuotes(...args)
}));

import { POST } from "@/app/api/ltl-rate-portal/rate-quote/route";

const context: AuthenticatedContext = {
  userId: "user-1",
  userEmail: "user@example.com",
  userName: "User",
  role: PlatformRole.OPERATIONS,
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  tenantName: "Tenant One"
};

const account: SevenLAccountConfig = {
  id: "account-1",
  name: "7L Preferred LTL",
  status: "ACTIVE",
  baseUrl: "https://restapi.my7l.com",
  defaultUom: "US",
  strictResult: false,
  harmonizedCharges: true,
  dryRun: false,
  carrierMode: "TENANT_SELECTED",
  secretConfigured: true,
  carriers: [
    {
      carrierHash: "carrier-1",
      name: "Estes",
      code: "EST",
      scac: "EXLA",
      defaulted: true,
      enabled: true
    }
  ]
};

const liveQuote: LtlQuoteResult = {
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
  accessorialCodes: ["APD"],
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
  serviceLevel: "Less than Truckload",
  transitDays: 3,
  quoteNumber: "Q-1",
  total: 345.67,
  fuelCharge: 40,
  accessorialCharge: 18,
  linehaulCharge: 287.67,
  rateRemarks: [],
  mode: "live"
};

const liveError: LtlCarrierErrorResult = {
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
  accessorialCodes: ["APD"],
  pieces: liveQuote.pieces,
  carrierHash: "carrier-2",
  carrierName: "CSA - Cross Border",
  carrierCode: "CSAUS",
  scac: "CSAP",
  errorMessage: "CSA - Cross Border does not allow US to US shipments",
  mode: "live"
};

describe("LTL rate quote route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedContext.mockResolvedValue(context);
    requireModule.mockResolvedValue(undefined);
    requireMutationAccess.mockReturnValue(undefined);
    getLtlQuotes.mockResolvedValue({ data: [], errors: [] });
    getLtlRatePortalShell.mockResolvedValue({
      accounts: [account]
    });
  });

  it("requires mutation access in addition to module access", async () => {
    const request = new Request("https://newl.test/api/ltl-rate-portal/rate-quote", {
      method: "POST",
      body: JSON.stringify({
        accountId: account.id,
        carrierHashes: [account.carriers[0].carrierHash],
        rows: [liveQuote]
      })
    });

    await POST(request);

    expect(requireModule).toHaveBeenCalledWith(context, ModuleKey.LTL_RATE_PORTAL);
    expect(requireMutationAccess).toHaveBeenCalledWith(context);
  });

  it("returns 404 when the tenant does not have the selected account", async () => {
    const request = new Request("https://newl.test/api/ltl-rate-portal/rate-quote", {
      method: "POST",
      body: JSON.stringify({
        accountId: "missing-account",
        carrierHashes: [account.carriers[0].carrierHash],
        rows: [liveQuote]
      })
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "The selected 7L account is not available for this tenant."
    });
    expect(getLtlQuotes).not.toHaveBeenCalled();
  });

  it("returns rated quotes from the 7L server integration", async () => {
    getLtlQuotes.mockResolvedValue({
      data: [liveQuote],
      errors: [liveError]
    });

    const request = new Request("https://newl.test/api/ltl-rate-portal/rate-quote", {
      method: "POST",
      body: JSON.stringify({
        accountId: account.id,
        carrierHashes: [account.carriers[0].carrierHash],
        rows: [
          {
            customerReference: "RFQ-1",
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
            accessorialCodes: ["APD"],
            pieces: liveQuote.pieces
          }
        ]
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(getLtlQuotes).toHaveBeenCalledWith(account, [
      expect.objectContaining({
        customerReference: "RFQ-1",
        originZipcode: "28273",
        destinationZipcode: "77001"
      })
    ], [account.carriers[0].carrierHash]);
    await expect(response.json()).resolves.toEqual({
      data: [liveQuote],
      errors: [liveError]
    });
  });
});
