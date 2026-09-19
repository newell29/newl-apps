import { describe, expect, it } from "vitest";
import {
  buildSupplyChainDesignCurrencyContext,
  normalizeSupplyChainDesignMoney,
  supplyChainDesignFxSnapshot,
  formatSupplyChainDesignMoney
} from "@/modules/supply-chain-design/currency";
import { normalizeSupplyChainDesignWeightUnit, convertSupplyChainDesignWeightToPounds } from "@/modules/supply-chain-design/weight-units";
import { normalizeSupplyChainDesignLtlPhysicalProfile } from "@/modules/supply-chain-design/ltl-physical-normalization";

const physical = { pallets: 2, weight: 1200, weightUnit: "lb", length: 48, width: 40, height: 60, dimensionUnit: "in" };

describe("SCDS currency foundations", () => {
  it("defaults project preferences to USD with optional FX", () => {
    expect(buildSupplyChainDesignCurrencyContext({})).toEqual({ analysisCurrency: "USD", cadToUsdRate: null });
  });
  it("converts in both directions using 1 CAD = X USD and retains source evidence", () => {
    expect(normalizeSupplyChainDesignMoney(100, "CAD", { analysisCurrency: "USD", cadToUsdRate: 0.75 }, "Synthetic cost")).toMatchObject({ originalAmount: 100, originalCurrency: "CAD", normalizedAmount: 75, normalizedCurrency: "USD", fxApplied: true });
    expect(normalizeSupplyChainDesignMoney(75, "USD", { analysisCurrency: "CAD", cadToUsdRate: 0.75 }, "Synthetic cost").normalizedAmount).toBe(100);
    expect(supplyChainDesignFxSnapshot({ analysisCurrency: "CAD", cadToUsdRate: 0.75 })).toEqual({ analysisCurrency: "CAD", cadToUsdRate: 0.75, rateDirection: "1 CAD = X USD" });
  });
  it("does not require FX for matching currencies", () => {
    expect(normalizeSupplyChainDesignMoney(12.345, "USD", { analysisCurrency: "USD", cadToUsdRate: null }, "Synthetic cost")).toMatchObject({ normalizedAmount: 12.35, fxApplied: false });
  });
  it.each([undefined, "", "EUR"])("rejects missing or unsupported source currency %s", (currency) => {
    expect(() => normalizeSupplyChainDesignMoney(100, currency, { analysisCurrency: "USD", cadToUsdRate: 0.75 }, "Synthetic cost")).toThrow(/currency/);
  });
  it("rejects cross-currency money when FX evidence is missing", () => {
    expect(() => normalizeSupplyChainDesignMoney(100, "CAD", { analysisCurrency: "USD", cadToUsdRate: null }, "Synthetic cost")).toThrow(/requires FX/);
  });
  it.each(["0", "-1", "6", "invalid", "Infinity"])("rejects invalid FX %s", (rate) => {
    expect(() => buildSupplyChainDesignCurrencyContext({ cadToUsdRate: rate })).toThrow();
  });
  it("formats explicit currency and unavailable values", () => {
    expect(formatSupplyChainDesignMoney(100, "CAD")).toBe("100 CAD");
    expect(formatSupplyChainDesignMoney(null, "USD")).toBe("Unavailable");
  });
});

describe("SCDS physical normalization foundations", () => {
  it.each(["lb", "lbs", "pound", "pounds", " LB "])("accepts pound alias %s", (unit) => {
    expect(normalizeSupplyChainDesignWeightUnit(unit)).toEqual({ ok: true, unit: "lb" });
  });
  it.each(["kg", "kgs", "kilogram", "kilograms"])("accepts kilogram alias %s", (unit) => {
    expect(normalizeSupplyChainDesignWeightUnit(unit)).toEqual({ ok: true, unit: "kg" });
    expect(convertSupplyChainDesignWeightToPounds(1, "kg")).toBeCloseTo(2.2046226218);
  });
  it("uses quantity-aware class and per-piece pounds", () => {
    const profile = normalizeSupplyChainDesignLtlPhysicalProfile(physical);
    expect(profile).toMatchObject({ weightLb: 1200, providerWeightEachLb: 600, freightClass: "100", uom: "US", piece: { qty: 2, weight: 600, weightType: "each" } });
  });
  it("normalizes kg/in and lb/cm combinations independently", () => {
    expect(normalizeSupplyChainDesignLtlPhysicalProfile({ ...physical, weight: 1000, weightUnit: "kg" })?.weightLb).toBeCloseTo(2204.622622);
    expect(normalizeSupplyChainDesignLtlPhysicalProfile({ ...physical, length: 121.92, width: 101.6, height: 152.4, dimensionUnit: "cm" })).toMatchObject({ lengthIn: 48, widthIn: 40, heightIn: 60, weightLb: 1200 });
  });
  it.each([
    { weightUnit: "" }, { weightUnit: "oz" }, { dimensionUnit: "" }, { dimensionUnit: "ft" },
    { pallets: 0 }, { pallets: -1 }, { weight: NaN }, { weight: Infinity }, { length: 0 }
  ])("rejects incomplete or invalid physical evidence %j", (values) => {
    expect(normalizeSupplyChainDesignLtlPhysicalProfile({ ...physical, ...values })).toBeNull();
  });
});
