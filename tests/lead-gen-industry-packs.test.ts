import { describe, expect, it } from "vitest";

import { classifyTradeMiningIndustry } from "@/modules/lead-gen/industry-classification";
import {
  matchesTradeMiningIndustryLabels,
  matchesTradeMiningIndustrySignals,
  normalizeTradeMiningIndustryFilterMode,
  normalizeTradeMiningIndustryPackIds
} from "@/modules/lead-gen/industry-packs";

describe("TradeMining industry packs", () => {
  it("normalizes selected packs and rejects unknown values", () => {
    expect(
      normalizeTradeMiningIndustryPackIds([
        "furniture-home",
        "unknown-pack",
        "furniture-home",
        "building-materials"
      ])
    ).toEqual(["furniture-home", "building-materials"]);
    expect(normalizeTradeMiningIndustryFilterMode("HARD")).toBe("HARD");
    expect(normalizeTradeMiningIndustryFilterMode("unsupported")).toBe("PREFER");
  });

  it("matches maintained HS and keyword signals without requiring users to know every code", () => {
    expect(matchesTradeMiningIndustrySignals(["furniture-home"], null, "9403.60")).toBe(true);
    expect(
      matchesTradeMiningIndustrySignals(
        ["building-materials"],
        "Engineered hardwood flooring panels",
        null
      )
    ).toBe(true);
    expect(matchesTradeMiningIndustrySignals(["food-beverage"], "Office chairs", "9401")).toBe(false);
  });

  it("uses the same labels for classification and hard/exclude qualification", () => {
    const classified = classifyTradeMiningIndustry({
      productDescription: "Upholstered sofa and dining chairs",
      hsCode: "9401"
    });

    expect(classified.primaryIndustry).toBe("Furniture & Home");
    expect(
      matchesTradeMiningIndustryLabels(
        ["furniture-home"],
        classified.primaryIndustry,
        classified.secondaryIndustry
      )
    ).toBe(true);
    expect(
      matchesTradeMiningIndustryLabels(
        ["logistics-providers"],
        classified.primaryIndustry,
        classified.secondaryIndustry
      )
    ).toBe(false);
  });
});
