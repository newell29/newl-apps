import { describe, expect, it } from "vitest";
import { LTL_SAMPLE_CSV } from "@/modules/ltl-rate-portal/constants";
import { getLtlTemplateCsv, parseLtlCsv, parseLtlRow } from "@/modules/ltl-rate-portal/csv";

describe("LTL rate portal CSV parsing", () => {
  it("returns the sample template CSV and parses its rows", () => {
    expect(getLtlTemplateCsv()).toBe(LTL_SAMPLE_CSV);

    const rows = parseLtlCsv(LTL_SAMPLE_CSV);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      errors: [],
      request: {
        customerReference: "RFQ-1001",
        originCity: "",
        originState: "",
        originZipcode: "28273",
        destinationCity: "",
        destinationState: "",
        destinationZipcode: "77001",
        pickupDate: "2026-06-20",
        uom: "US",
        accessorialCodes: ["LFTG", "APPT"],
        pieces: [
          expect.objectContaining({
            qty: 1,
            weight: 1200,
            weightType: "each",
            length: 0,
            width: 0,
            height: 0,
            dimType: "PLT",
            freightClass: "125",
            hazmat: false,
            stack: true,
            stackAmount: 2,
            commodity: "Floor loaded paper"
          })
        ]
      }
    });
    expect(rows[1].request?.originCountry).toBe("CA");
    expect(rows[1].request?.destinationCountry).toBe("US");
    expect(rows[1].request?.pieces[0]).toMatchObject({
      qty: 1,
      weight: 450,
      length: 0,
      width: 0,
      height: 0
    });
  });

  it("parses multiple freight pieces, booleans, and optional fields from a row object", () => {
    const parsed = parseLtlRow({
      customerReference: " Batch-77 ",
      originCity: "",
      originState: "",
      originZipcode: "28273",
      originCountry: "us",
      destinationCity: "",
      destinationState: "",
      destinationZipcode: "M5H2N2",
      destinationCountry: "ca",
      pickupDate: "",
      uom: "mixed",
      accessorialCodes: "haz, appt| inside ",
      piece1Weight: "500",
      piece1WeightType: "TOTAL",
      piece1DimType: "plt",
      piece1Class: "92.5",
      piece1Hazmat: "yes",
      piece1UN: "UN1993",
      piece1NMFC: "12345",
      piece1Stack: "1",
      piece1StackAmount: "3",
      piece1Commodity: "Paint",
      piece2Weight: "275",
      piece2WeightType: "each",
      piece2DimType: "box",
      piece2Class: "125",
      piece2Hazmat: "false",
      piece2UN: "",
      piece2NMFC: "",
      piece2Stack: "",
      piece2StackAmount: "",
      piece2Commodity: "  "
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.request).toMatchObject({
      customerReference: "Batch-77",
      originCity: "",
      originState: "",
      destinationCity: "",
      destinationState: "",
      destinationCountry: "CA",
      pickupDate: "Not scheduled",
      uom: "MIXED",
      accessorialCodes: ["HAZ", "APPT", "INSIDE"],
      pieces: [
        {
          qty: 1,
          weight: 500,
          weightType: "total",
          length: 0,
          width: 0,
          height: 0,
          dimType: "PLT",
          freightClass: "92.5",
          hazmat: true,
          unNumber: "UN1993",
          nmfc: "12345",
          stack: true,
          stackAmount: 3,
          commodity: "Paint"
        },
        {
          qty: 1,
          weight: 275,
          weightType: "each",
          length: 0,
          width: 0,
          height: 0,
          dimType: "BOX",
          freightClass: "125",
          hazmat: false,
          stack: false
        }
      ]
    });
  });

  it("reports required field, enum, piece, and date validation errors", () => {
    const parsed = parseLtlRow({
      customerReference: "",
      originZipcode: "",
      originCountry: "GB",
      destinationZipcode: "",
      destinationCountry: "FR",
      pickupDate: "06/20/2026",
      uom: "imperial",
      accessorialCodes: "",
      piece1Qty: "0",
      piece1Weight: "-1",
      piece1WeightType: "gross",
      piece1Length: "-1",
      piece1Width: "abc",
      piece1Height: "-3",
      piece1DimType: "crate-ish",
      piece1Class: "",
      piece1Stack: "yes",
      piece1StackAmount: ""
    });

    expect(parsed.request).toBeNull();
    expect(parsed.errors).toEqual([
      "piece1Qty must be greater than 0.",
      "piece1Weight must be greater than 0.",
      "piece1Length must be 0 or greater.",
      "piece1Width must be 0 or greater.",
      "piece1Height must be 0 or greater.",
      "piece1WeightType must be each or total.",
      "piece1DimType is invalid.",
      "piece1StackAmount must be greater than 0 when stacking is enabled.",
      "originZipcode is required.",
      "destinationZipcode is required.",
      "originCountry must be US, CA, or MX.",
      "destinationCountry must be US, CA, or MX.",
      "uom must be US, METRIC, or MIXED.",
      "pickupDate must use YYYY-MM-DD.",
      "At least one valid freight piece is required."
    ]);
  });
});
