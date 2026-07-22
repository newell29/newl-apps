import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseEmailWithOpenAI, type ParsedEmailLogisticsData } from "@/modules/tms-bridge/actions";

describe("TMS email OpenAI parser", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the existing OpenAI API convention and preserves the inquiry JSON contract", async () => {
    const parsed: ParsedEmailLogisticsData = {
      customer: "OneScreen",
      customertype: "customer",
      mode: "ground",
      origin: "Zip : 92120",
      destination: "Zip : 20783",
      incoterms: "",
      service: "",
      direction: "domestic",
      shipmentType: "LTL",
      urgency: "",
      requestedTiming: "",
      originPostalCode: "92120",
      originCountry: "US",
      destinationPostalCode: "20783",
      destinationCountry: "US",
      pickupDate: "",
      freightClass: "",
      nmfc: "",
      unNumber: "",
      accessorials: ["Inside Delivery = Yes", "Liftgate Delivery = Yes"],
      containerQuantity: "",
      containerSize: "",
      equipmentType: "",
      containerWeight: "",
      weightUnit: "LBS",
      dimensionsUnit: "INCH",
      floorLoaded: false,
      commodity: "T7-65 Interactive Display",
      items: [
        {
          quantity: "1",
          packagingType: "Pallet",
          length: "64",
          width: "9",
          height: "45",
          weight: "130",
          weightType: "each",
          freightClass: "",
          nmfc: "",
          unNumber: ""
        }
      ],
      insurance: true,
      customs: false,
      dangerousGoods: false,
      readyDate: ""
    };

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(parsed)
            }
          }
        ]
      })
    } as unknown as Response);

    const result = JSON.parse(await parseEmailWithOpenAI("Please quote 1 pallet from 92120 to 20783.")) as ParsedEmailLogisticsData;

    expect(result).toEqual(parsed);

    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(requestBody.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "tms_email_logistics_inquiry",
        strict: true
      }
    });
    expect(JSON.stringify(requestBody)).toContain("originPostalCode");
    expect(JSON.stringify(requestBody)).toContain("destinationPostalCode");
    expect(JSON.stringify(requestBody)).toContain("Do not convert a bare domain");
  });

  it("fails without returning malformed parsed data when OpenAI parsing fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        error: {
          message: "temporary OpenAI failure"
        }
      })
    } as unknown as Response);

    await expect(parseEmailWithOpenAI("quote request")).rejects.toThrow("temporary OpenAI failure");
  });
});
