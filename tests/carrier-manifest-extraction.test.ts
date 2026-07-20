import { describe, expect, it } from "vitest";

import {
  choosePreferredManifestSkids,
  MANIFEST_CROP_BOXES,
  parseAuthoritativePalletTotal,
  resolveManifestSkids
} from "@/modules/shipment-documents/carrier-manifest-extraction";

describe("Garland carrier manifest pallet extraction", () => {
  it("keeps the variable-position pallet total line inside the package crop", () => {
    const packageCrop = MANIFEST_CROP_BOXES.find((crop) => crop.label.includes("authoritative Total"));

    expect(packageCrop).toBeDefined();
    expect(packageCrop?.y).toBeLessThanOrEqual(0.5);
    expect((packageCrop?.y ?? 0) + (packageCrop?.height ?? 0)).toBeGreaterThanOrEqual(0.95);
  });

  it("uses SR806507's authoritative total instead of a visible 6-pallet row", () => {
    const result = resolveManifestSkids({
      srNumber: "806507",
      packageTotalText: "Total: 13 PALLETS",
      packageLineCounts: [2, 2, 2, 6, 1],
      skids: 6
    });

    expect(result).toEqual({ skids: 13, evidence: "TOTAL_LINE" });
  });

  it("sums printed pallet rows only when the total line is unavailable", () => {
    expect(
      resolveManifestSkids({
        packageTotalText: "",
        packageLineCounts: [2, 2, 2, 6, 1],
        skids: 6
      })
    ).toEqual({ skids: 13, evidence: "PACKAGE_LINE_SUM" });
  });

  it("does not treat SKU quantities or piece counts as an authoritative pallet total", () => {
    expect(parseAuthoritativePalletTotal("SKU: 1140, QTY: 6")).toBeNull();
    expect(parseAuthoritativePalletTotal("6 piece")).toBeNull();
  });

  it("prefers fallback OCR backed by a total line over a plausible generic count", () => {
    expect(
      choosePreferredManifestSkids(
        { skids: 6, evidence: "GENERIC" },
        { skids: 13, evidence: "TOTAL_LINE" }
      )
    ).toEqual({ skids: 13, evidence: "TOTAL_LINE" });
  });
});
