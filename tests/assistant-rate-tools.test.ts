import { beforeEach, describe, expect, it, vi } from "vitest";

const getLtlRatePortalShell = vi.fn();
const getUpsToolsShell = vi.fn();
const getLtlQuotes = vi.fn();
const getUpsQuote = vi.fn();

vi.mock("@/modules/ltl-rate-portal/queries", () => ({
  getLtlRatePortalShell: (...args: unknown[]) => getLtlRatePortalShell(...args)
}));

vi.mock("@/modules/ups-tools/queries", () => ({
  getUpsToolsShell: (...args: unknown[]) => getUpsToolsShell(...args)
}));

vi.mock("@/server/integrations/seven-l", () => ({
  getLtlQuotes: (...args: unknown[]) => getLtlQuotes(...args)
}));

vi.mock("@/server/integrations/ups", () => ({
  getUpsQuote: (...args: unknown[]) => getUpsQuote(...args)
}));

import { maybeRunAssistantRateRequest, parseAssistantRatePrompt } from "@/modules/assistant/rate-tools";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl",
  tenantName: "Newl",
  userId: "user-1",
  userEmail: "alex@example.com",
  userName: "Alex",
  role: "ADMIN"
} as const;

describe("parseAssistantRatePrompt", () => {
  it("parses city-based LTL prompts", () => {
    const parsed = parseAssistantRatePrompt("need a rate from Charlotte to Dallas 48x48x48 500 lbs 1 pallet");

    expect(parsed).toMatchObject({
      mode: "LTL",
      origin: {
        postalCode: "28273"
      },
      destination: {
        postalCode: "75201"
      },
      length: 48,
      width: 48,
      height: 48,
      weight: 500,
      quantity: 1,
      quantityUnit: "PALLET"
    });
  });

  it("parses UPS prompts and service names", () => {
    const parsed = parseAssistantRatePrompt("need a UPS ground quote from Toronto to Dallas 12x10x8 20 lbs 1 package");

    expect(parsed).toMatchObject({
      mode: "UPS",
      origin: {
        postalCode: "M5H2N2"
      },
      destination: {
        postalCode: "75201"
      },
      quantityUnit: "PACKAGE",
      requestedUpsServices: ["Ground"]
    });
  });

  it("parses quantity when written as qty without a package unit", () => {
    const parsed = parseAssistantRatePrompt("need a UPS rate from 28273 to 90210 15 lbs 12x4x4 qty 1");

    expect(parsed).toMatchObject({
      mode: "UPS",
      origin: {
        postalCode: "28273"
      },
      destination: {
        postalCode: "90210"
      },
      length: 12,
      width: 4,
      height: 4,
      weight: 15,
      quantity: 1
    });
  });

  it("uses prior thread prompt context to complete a quantity-only follow-up", () => {
    const parsed = parseAssistantRatePrompt(
      "Quantity is 1",
      "Need a UPS rate from 28273 to 90210 15 lbs 12x4x4"
    );

    expect(parsed).toMatchObject({
      mode: "UPS",
      origin: {
        postalCode: "28273"
      },
      destination: {
        postalCode: "90210"
      },
      length: 12,
      width: 4,
      height: 4,
      weight: 15,
      quantity: 1
    });
  });
});

describe("maybeRunAssistantRateRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes pallet requests through 7L quoting", async () => {
    getLtlRatePortalShell.mockResolvedValue({
      moduleEnabled: true,
      accounts: [
        {
          id: "7l-1",
          name: "7L Core",
          status: "ACTIVE"
        }
      ]
    });
    getLtlQuotes.mockResolvedValue({
      data: [
        {
          carrierName: "Roadrunner",
          total: 311.87,
          transitDays: 4,
          quoteNumber: "94390648"
        },
        {
          carrierName: "AAA Cooper Transportation",
          total: 362.28,
          transitDays: 4,
          quoteNumber: "0246495997"
        }
      ],
      errors: []
    });

    const response = await maybeRunAssistantRateRequest(
      context,
      "need a rate from Charlotte to Dallas 48x48x48 500 lbs 1 pallet"
    );

    expect(getLtlRatePortalShell).toHaveBeenCalled();
    expect(getLtlQuotes).toHaveBeenCalled();
    expect(response?.provider).toBe("SEVEN_L_TOOL");
    expect(response?.answer).toContain("7L returned 2 quote(s)");
    expect(response?.answer).toContain("Roadrunner");
  });

  it("routes UPS prompts through parcel quoting", async () => {
    getUpsToolsShell.mockResolvedValue({
      moduleEnabled: true,
      accounts: [
        {
          id: "ups-1",
          name: "Charlotte UPS",
          shipperNumber: "A12345",
          status: "ACTIVE"
        }
      ]
    });
    getUpsQuote
      .mockResolvedValueOnce({
        service: "Ground",
        totalWithTax: 18.5,
        transitDays: 4,
        billableWeight: 20,
        accountShipperNumber: "A12345"
      })
      .mockResolvedValueOnce({
        service: "2nd Day Air",
        totalWithTax: 31.25,
        transitDays: 2,
        billableWeight: 20,
        accountShipperNumber: "A12345"
      })
      .mockResolvedValueOnce({
        service: "Next Day Air",
        totalWithTax: 55,
        transitDays: 1,
        billableWeight: 20,
        accountShipperNumber: "A12345"
      })
      .mockResolvedValueOnce({
        service: "Next Day Air Saver",
        totalWithTax: 49,
        transitDays: 1,
        billableWeight: 20,
        accountShipperNumber: "A12345"
      })
      .mockResolvedValueOnce({
        service: "3 Day Select",
        totalWithTax: 27.4,
        transitDays: 3,
        billableWeight: 20,
        accountShipperNumber: "A12345"
      });

    const response = await maybeRunAssistantRateRequest(
      context,
      "need a UPS rate from Toronto to Dallas 12x10x8 20 lbs 1 package"
    );

    expect(getUpsToolsShell).toHaveBeenCalled();
    expect(getUpsQuote).toHaveBeenCalledTimes(5);
    expect(response?.provider).toBe("UPS_TOOL");
    expect(response?.answer).toContain("UPS returned 5 quote(s)");
    expect(response?.answer).toContain("Best rate: Ground");
  });

  it("asks for missing fields when a quote request is incomplete", async () => {
    const response = await maybeRunAssistantRateRequest(context, "need a rate from Charlotte to Dallas 48x48x48 1 pallet");

    expect(response?.messageMetadata).toMatchObject({
      needsClarification: true
    });
    expect(response?.answer).toContain("weight");
  });
});
