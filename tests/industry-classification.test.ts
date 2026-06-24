import { describe, expect, it } from "vitest";

import {
  classifyTradeMiningIndustry,
  classifyTradeMiningIndustryFromRecords
} from "@/modules/lead-gen/industry-classification";

describe("industry classification", () => {
  it("classifies furniture shipments from HS code and keyword signals", () => {
    expect(
      classifyTradeMiningIndustry({
        productDescription: "Wood office table and home furniture",
        hsCode: "9403.60"
      })
    ).toMatchObject({
      primaryIndustry: "Furniture & Home",
      source: "MIXED"
    });
  });

  it("identifies apparel from repeated shipment evidence", () => {
    expect(
      classifyTradeMiningIndustryFromRecords([
        { productDescription: "knit shirts", hsCode: "6109" },
        { productDescription: "textile garments", hsCode: "6204" }
      ])
    ).toMatchObject({
      primaryIndustry: "Apparel & Footwear"
    });
  });

  it("returns unknown when there is not enough signal", () => {
    expect(
      classifyTradeMiningIndustry({
        productDescription: "misc cargo",
        hsCode: null
      })
    ).toEqual({
      primaryIndustry: null,
      secondaryIndustry: null,
      confidence: 0,
      source: "UNKNOWN"
    });
  });
});
