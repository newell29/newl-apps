import { describe, expect, it } from "vitest";

import { serializeFreightInfo } from "@/modules/ltl-rate-portal/engine";
import { buildLtlRateRequestFromParsedInquiry } from "@/modules/tms-bridge/ltl-inquiry-rate-request";

function baseInquiry(overrides: Record<string, unknown> = {}) {
  return {
    customer: "Example Customer",
    origin: "Charlotte NC 28273",
    originPostalCode: "28273",
    originCountry: "US",
    destination: "Toronto ON M5H 2N2",
    destinationPostalCode: "M5H 2N2",
    destinationCountry: "CA",
    pickupDate: "2026-07-20",
    weightUnit: "LBS",
    dimensionsUnit: "INCH",
    commodity: "Retail fixtures",
    dangerousGoods: false,
    accessorials: [],
    items: [
      {
        quantity: "1",
        packagingType: "pallet",
        weight: "1200",
        weightType: "total",
        length: "48",
        width: "40",
        height: "52",
        freightClass: "125"
      }
    ],
    ...overrides
  };
}

describe("LTL inquiry rate request adapter", () => {
  it("builds one valid 7L request from a typical parsed inquiry", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry());

    expect(result.canRequestRates).toBe(true);
    expect(result.missingRequiredFields).toEqual([]);
    expect(result.request).toMatchObject({
      customerReference: "Example Customer",
      originZipcode: "28273",
      originCountry: "US",
      destinationZipcode: "M5H2N2",
      destinationCountry: "CA",
      pickupDate: "2026-07-20",
      uom: "US",
      accessorialCodes: [],
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
            stack: false,
            commodity: "Retail fixtures"
          }
        ]
    });
  });

  it("preserves current behavior when both postal codes are present", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        origin: "Charlotte NC",
        originPostalCode: "28273",
        destination: "Toronto ON",
        destinationPostalCode: "M5H 2N2"
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request).toMatchObject({
      originZipcode: "28273",
      destinationZipcode: "M5H2N2"
    });
    expect(result.missingRequiredFields).not.toContain("originPostalCode");
    expect(result.missingRequiredFields).not.toContain("destinationPostalCode");
    expect(result.warnings).not.toContain(
      "7L rate request skipped because the current 7L integration requires origin and destination postal codes."
    );
  });

  it("maps destination tailgate and liftgate wording to the proven LFD accessorial code", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry({ accessorials: ["tailgate delivery required"] }));

    expect(result.request?.accessorialCodes).toEqual(["LFD"]);
    expect(result.detectedAccessorials).toEqual([{ code: "LFD", phrase: "tailgate delivery" }]);
  });

  it("keeps accessorial codes empty when no accessorials are stated", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry({ accessorials: [] }));

    expect(result.request?.accessorialCodes).toEqual([]);
    expect(result.detectedAccessorials).toEqual([]);
  });

  it("uses the existing unscheduled pickup representation when no pickup date is stated", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry({ pickupDate: "", readyDate: "" }));

    expect(result.request?.pickupDate).toBe("Not scheduled");
    expect(result.appliedDefaults).toContain("pickupDate=Not scheduled");
  });

  it("omits NMFC when no NMFC is stated", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry());

    expect(result.request?.pieces[0].nmfc).toBeUndefined();
  });

  it("defaults hazmat to false when no hazmat wording is stated", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry({ dangerousGoods: false, accessorials: [] }));

    expect(result.request?.pieces[0].hazmat).toBe(false);
  });

  it("sets stack false when the inquiry says non-stackable", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "1200",
            length: "48",
            width: "40",
            height: "52",
            freightClass: "125",
            stackable: "no"
          }
        ]
      })
    );

    expect(result.request?.pieces[0].stack).toBe(false);
  });

  it("defaults missing stack information to false with stack amount zero in the serialized 7L payload", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry({ stackable: "" }));

    expect(result.request?.pieces[0]).toMatchObject({
      stack: false
    });
    expect(result.request?.pieces[0].stackAmount).toBeUndefined();
    expect(result.appliedDefaults).toContain("stack=false");
  });

  it("does not produce stack true with a missing or zero stack amount", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        stackable: "yes",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "1200",
            length: "48",
            width: "40",
            height: "52",
            freightClass: "125",
            stackable: "yes",
            stackAmount: "0"
          }
        ]
      })
    );

    expect(result.request?.pieces[0].stack).toBe(false);
    expect(result.request?.pieces[0].stackAmount).toBeUndefined();
    expect(result.appliedDefaults).toContain("stack=false");
  });

  it("ignores legacy stack true input even when a positive stack amount is provided", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "1200",
            length: "48",
            width: "40",
            height: "52",
            freightClass: "125",
            stackable: "yes",
            stackAmount: "2"
          }
        ]
      })
    );

    expect(result.request?.pieces[0].stack).toBe(false);
    expect(result.request?.pieces[0].stackAmount).toBeUndefined();
    expect(result.request ? serializeFreightInfo(result.request.pieces) : "").toContain('"stack":false');
    expect(result.request ? serializeFreightInfo(result.request.pieces) : "").toContain('"stackAmount":0');
    expect(result.appliedDefaults).toContain("stack=false");
  });

  it("accepts a supported freight class when present", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "92.5",
        items: [
          {
            quantity: "1",
            packagingType: "box",
            weight: "450",
            length: "24",
            width: "20",
            height: "18"
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.pieces[0]).toMatchObject({
      dimType: "BOX",
      freightClass: "92.5"
    });
    expect(result.freightClassEstimates).toEqual([]);
  });

  it("does not overwrite an inquiry-provided freight class with a density estimate", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "85",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "100",
            weightType: "total",
            length: "48",
            width: "48",
            height: "48",
            freightClass: "85"
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.pieces[0].freightClass).toBe("85");
    expect(result.freightClassEstimates).toEqual([]);
  });

  it("estimates freight class from density when class is missing", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "3000",
            weightType: "total",
            length: "70",
            width: "70",
            height: "70",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.pieces[0].freightClass).toBe("70");
    expect(result.freightClassEstimates).toEqual([
      expect.objectContaining({
        fieldPrefix: "items[0]",
        source: "density-estimated",
        freightClass: "70",
        density: expect.closeTo(15.114, 3)
      })
    ]);
  });

  it.each([
    [50, "50"],
    [49.99, "55"],
    [35, "55"],
    [34.99, "60"],
    [30, "60"],
    [29.99, "65"],
    [22.5, "65"],
    [22.49, "70"],
    [15, "70"],
    [14.99, "85"],
    [12, "85"],
    [11.99, "92.5"],
    [10, "92.5"],
    [9.99, "100"],
    [8, "100"],
    [7.99, "125"],
    [6, "125"],
    [5.99, "175"],
    [4, "175"],
    [3.99, "250"],
    [2, "250"],
    [1.99, "300"],
    [1, "300"],
    [0.99, "400"]
  ])("uses the approved density boundary %s -> class %s", (density, expectedClass) => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: String(density),
            weightType: "total",
            length: "12",
            width: "12",
            height: "12",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.pieces[0].freightClass).toBe(expectedClass);
    expect(result.freightClassEstimates[0]?.density).toBeCloseTo(density, 4);
  });

  it("estimates each piece independently when multiple pieces use total weight", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "200",
            weightType: "total",
            length: "30",
            width: "30",
            height: "30",
            freightClass: ""
          },
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "500",
            weightType: "total",
            length: "50",
            width: "50",
            height: "50",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.request?.pieces.map((piece) => piece.freightClass)).toEqual(["85", "125"]);
    expect(result.freightClassEstimates.map((estimate) => estimate.freightClass)).toEqual(["85", "125"]);
  });

  it("uses per-piece weight across multiple pieces when weightType is each", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        items: [
          {
            quantity: "2",
            packagingType: "pallet",
            weight: "100",
            weightType: "each",
            length: "30",
            width: "30",
            height: "30",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.request?.pieces[0]).toMatchObject({
      qty: 2,
      weight: 100,
      weightType: "each",
      freightClass: "125"
    });
    expect(result.freightClassEstimates[0]?.density).toBeCloseTo(6.4, 1);
  });

  it("matches the approved 48 inch cube example", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "100",
            weightType: "total",
            length: "48",
            width: "48",
            height: "48",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.request?.pieces[0].freightClass).toBe("300");
    expect(result.freightClassEstimates[0]?.density).toBeCloseTo(1.5625, 4);
  });

  it("converts metric weight and dimensions before estimating class", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        weightUnit: "KG",
        dimensionsUnit: "CM",
        freightClass: "",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "453.592",
            weightType: "total",
            length: "121.92",
            width: "121.92",
            height: "121.92",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.uom).toBe("METRIC");
    expect(result.request?.pieces[0].freightClass).toBe("70");
    expect(result.freightClassEstimates[0]?.density).toBeCloseTo(15.625, 3);
  });

  it("reports freight class as missing when absent and density cannot be calculated", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "1200",
            length: "48",
            width: "40",
            height: ""
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(false);
    expect(result.request).toBeNull();
    expect(result.missingRequiredFields).toEqual(expect.arrayContaining(["items[0].height", "items[0].freightClass"]));
  });

  it("builds the OneScreen pallet request by using numeric item number and density-estimated freight class", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        customer: "OneScreen",
        origin: "92120",
        destination: "20783",
        originPostalCode: "92120",
        originCountry: "US",
        destinationPostalCode: "20783",
        destinationCountry: "US",
        pickupDate: "",
        freightClass: "",
        accessorials: ["Inside Delivery", "Liftgate Delivery", "Appointment Delivery"],
        commodity: "T7-65 Interactive Display - 65\"",
        items: [
          {
            number: 1,
            packagingType: "Pallet",
            length: 64,
            width: 9,
            height: 45,
            weight: 130,
            weightType: "each",
            freightClass: "",
            nmfc: "",
            unNumber: "",
            stackable: ""
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.missingRequiredFields).toEqual([]);
    expect(result.request?.pieces[0]).toMatchObject({
      qty: 1,
      dimType: "PLT",
      length: 64,
      width: 9,
      height: 45,
      weight: 130,
      weightType: "each",
      freightClass: "100",
      stack: false,
      commodity: "T7-65 Interactive Display - 65\""
    });
    expect(result.request?.pieces[0].stackAmount).toBeUndefined();
    expect(result.request ? serializeFreightInfo(result.request.pieces) : "").toContain('"stack":false');
    expect(result.request ? serializeFreightInfo(result.request.pieces) : "").toContain('"stackAmount":0');
    expect(result.appliedDefaults).toEqual(expect.arrayContaining(["items[0].freightClass=100 estimated from density", "stack=false"]));
    expect(result.detectedAccessorials.map((item) => item.code)).toEqual(["APD", "IND", "LFD"]);
    expect(result.unsupportedOrUnmappedTerms).not.toContain("inside pickup/delivery");
  });

  it("uses pieces as the quantity when Gemini does not return quantity", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        items: [
          {
            pieces: 1,
            packagingType: "Pallet",
            length: "48",
            width: "48",
            height: "48",
            weight: "100",
            weightType: "total",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.pieces[0].qty).toBe(1);
    expect(result.request?.pieces[0].freightClass).toBe("300");
  });

  it("uses numberPieces as quantity and ignores accessorials marked No", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        accessorials: [
          "Inside Pickup = No",
          "LiftGate Pickup = No",
          "Inside Delivery = Yes",
          "Liftgate Delivery = Yes",
          "Appointment Delivery = Yes"
        ],
        items: [
          {
            numberPieces: 1,
            packagingType: "Pallet",
            length: 64,
            width: 9,
            height: 45,
            weight: 130,
            weightType: "each",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.pieces[0].qty).toBe(1);
    expect(result.request?.accessorialCodes).toEqual(["APD", "IND", "LFD"]);
    expect(result.detectedAccessorials).toEqual([
      { code: "APD", phrase: "Appointment Delivery" },
      { code: "IND", phrase: "Inside Delivery" },
      { code: "LFD", phrase: "Liftgate Delivery" }
    ]);
    expect(result.unsupportedOrUnmappedTerms).not.toContain("inside pickup/delivery");
  });

  it("reports missing dimensions", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "1200",
            freightClass: "125"
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(false);
    expect(result.missingRequiredFields).toEqual(expect.arrayContaining(["items[0].length", "items[0].width", "items[0].height"]));
  });

  it("does not estimate class from zero inputs", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "0",
            length: "48",
            width: "40",
            height: "52",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(false);
    expect(result.request).toBeNull();
    expect(result.missingRequiredFields).toEqual(expect.arrayContaining(["items[0].weight", "items[0].freightClass"]));
    expect(result.freightClassEstimates).toEqual([]);
  });

  it("does not estimate class from negative inputs", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        freightClass: "",
        items: [
          {
            quantity: "1",
            packagingType: "pallet",
            weight: "1200",
            length: "-48",
            width: "40",
            height: "52",
            freightClass: ""
          }
        ]
      })
    );

    expect(result.canRequestRates).toBe(false);
    expect(result.request).toBeNull();
    expect(result.missingRequiredFields).toEqual(expect.arrayContaining(["items[0].length", "items[0].freightClass"]));
    expect(result.freightClassEstimates).toEqual([]);
  });

  it("reports missing destination postal code", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry({ destination: "Toronto ON", destinationPostalCode: "" }));

    expect(result.canRequestRates).toBe(false);
    expect(result.request).toBeNull();
    expect(result.missingRequiredFields).toContain("destinationPostalCode");
    expect(result.warnings).toContain(
      "7L rate request skipped because the current 7L integration requires origin and destination postal codes."
    );
  });

  it("reports missing origin postal code", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry({ origin: "Charlotte NC", originPostalCode: "" }));

    expect(result.canRequestRates).toBe(false);
    expect(result.request).toBeNull();
    expect(result.missingRequiredFields).toContain("originPostalCode");
    expect(result.missingRequiredFields).not.toContain("destinationPostalCode");
    expect(result.warnings).toContain(
      "7L rate request skipped because the current 7L integration requires origin and destination postal codes."
    );
  });

  it("reports both postal codes missing without returning a partial 7L request", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        origin: "Charlotte NC",
        originPostalCode: "",
        destination: "Toronto ON",
        destinationPostalCode: ""
      })
    );

    expect(result.canRequestRates).toBe(false);
    expect(result.request).toBeNull();
    expect(result.missingRequiredFields).toEqual(
      expect.arrayContaining(["originPostalCode", "destinationPostalCode"])
    );
    expect(result.warnings).toContain(
      "7L rate request skipped because the current 7L integration requires origin and destination postal codes."
    );
  });

  it("does not derive postal codes from city and state text", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        origin: "Charlotte, NC",
        originPostalCode: "",
        originCountry: "US",
        destination: "Toronto, ON",
        destinationPostalCode: "",
        destinationCountry: "CA"
      })
    );

    expect(result.canRequestRates).toBe(false);
    expect(result.request).toBeNull();
    expect(result.missingRequiredFields).toEqual(
      expect.arrayContaining(["originPostalCode", "destinationPostalCode"])
    );
    expect(result.missingRequiredFields).not.toContain("originCountry");
    expect(result.missingRequiredFields).not.toContain("destinationCountry");
  });

  it("handles multiple pallets with total weight", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        items: [
          {
            quantity: "3",
            packagingType: "skids",
            weight: "2400",
            weightType: "total",
            length: "48",
            width: "40",
            height: "50",
            freightClass: "100"
          }
        ]
      })
    );

    expect(result.request?.pieces[0]).toMatchObject({
      qty: 3,
      weight: 2400,
      weightType: "total",
      dimType: "PLT"
    });
  });

  it("supports Canadian and US postal code examples", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        originPostalCode: "M5H2N2",
        originCountry: "",
        destinationPostalCode: "75201",
        destinationCountry: ""
      })
    );

    expect(result.request?.originCountry).toBe("CA");
    expect(result.request?.destinationCountry).toBe("US");
  });

  it("supports a Canadian postal code when present", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        originPostalCode: "M5H2N2",
        originCountry: "",
        destinationPostalCode: "L5T 1Z3",
        destinationCountry: "CA"
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.originCountry).toBe("CA");
    expect(result.request?.originZipcode).toBe("M5H2N2");
    expect(result.request?.destinationZipcode).toBe("L5T1Z3");
  });

  it("removes spaces from Canadian postal codes before sending the 7L request", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        originPostalCode: "l7t 0c5",
        originCountry: "CA",
        destinationPostalCode: "m5h 2n2",
        destinationCountry: "CA"
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.originZipcode).toBe("l7t0c5");
    expect(result.request?.destinationZipcode).toBe("m5h2n2");
  });

  it("supports a US ZIP code when present", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({
        originPostalCode: "28273",
        originCountry: "",
        destinationPostalCode: "75201",
        destinationCountry: ""
      })
    );

    expect(result.canRequestRates).toBe(true);
    expect(result.request?.originCountry).toBe("US");
    expect(result.request?.destinationCountry).toBe("US");
  });

  it("reports unsupported accessorial wording instead of guessing a code", () => {
    const result = buildLtlRateRequestFromParsedInquiry(baseInquiry({ accessorials: ["limited access construction site"] }));

    expect(result.request?.accessorialCodes).toEqual([]);
    expect(result.unsupportedOrUnmappedTerms).toEqual(["limited access"]);
  });

  it("maps only supported directional accessorial phrases from the current repository", () => {
    const result = buildLtlRateRequestFromParsedInquiry(
      baseInquiry({ accessorials: ["appointment delivery", "inside delivery", "residential delivery"] })
    );

    expect(result.request?.accessorialCodes).toEqual(["APD", "IND", "RSD"]);
    expect(result.unsupportedOrUnmappedTerms).not.toContain("inside pickup/delivery");
  });

  it("remains compatible with the existing TMS parser output shape", () => {
    const result = buildLtlRateRequestFromParsedInquiry({
      customer: "Legacy Parsed Customer",
      origin: "Charlotte NC 28273",
      destination: "Dallas TX 75201",
      weightUnit: "LBS",
      dimensionsUnit: "INCH",
      commodity: "General freight",
      dangerousGoods: false,
      items: [
        {
          quantity: "1",
          length: "48",
          width: "40",
          height: "50",
          weight: "800"
        }
      ]
    });

    expect(result.canRequestRates).toBe(false);
    expect(result.missingRequiredFields).toContain("items[0].packagingType");
    expect(result.missingRequiredFields).not.toContain("items[0].freightClass");
  });
});
