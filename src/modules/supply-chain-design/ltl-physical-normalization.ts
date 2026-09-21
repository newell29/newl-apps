import { calculateLtlFreightClass } from "@/modules/ltl-rate-portal/freight-class";
import type { LtlFreightPiece } from "@/modules/ltl-rate-portal/types";
import {
  convertSupplyChainDesignWeightToPounds,
  normalizeSupplyChainDesignWeightUnit
} from "@/modules/supply-chain-design/weight-units";

const CM_TO_IN = 1 / 2.54;

export type SupplyChainDesignLtlPhysicalProfileInput = {
  pallets: number;
  weight: number;
  weightUnit: string;
  length: number;
  width: number;
  height: number;
  dimensionUnit: string;
};

export type SupplyChainDesignLtlPhysicalProfile = {
  pallets: number;
  weightLb: number;
  providerWeightEachLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  uom: "US";
  freightClass: string | null;
  piece: LtlFreightPiece;
};

export function normalizeSupplyChainDesignLtlPhysicalProfile(
  input: SupplyChainDesignLtlPhysicalProfileInput
): SupplyChainDesignLtlPhysicalProfile | null {
  if (![input.pallets, input.weight, input.length, input.width, input.height].every(
    (value) => Number.isFinite(value) && value > 0
  )) return null;

  const normalizedWeightUnit = normalizeSupplyChainDesignWeightUnit(input.weightUnit);
  const normalizedDimensionUnit = normalizeSupplyChainDesignDimensionUnit(input.dimensionUnit);
  if (!normalizedWeightUnit.ok || !normalizedDimensionUnit) {
    return null;
  }

  const weightLb = roundPhysical(convertSupplyChainDesignWeightToPounds(input.weight, normalizedWeightUnit.unit));
  const providerWeightEachLb = roundPhysical(weightLb / input.pallets);
  const lengthIn = roundPhysical(convertSupplyChainDesignDimensionToInches(input.length, normalizedDimensionUnit));
  const widthIn = roundPhysical(convertSupplyChainDesignDimensionToInches(input.width, normalizedDimensionUnit));
  const heightIn = roundPhysical(convertSupplyChainDesignDimensionToInches(input.height, normalizedDimensionUnit));

  const freightClassResult = calculateLtlFreightClass({
    totalWeight: weightLb,
    weightUnit: "lb",
    quantity: input.pallets,
    length: lengthIn,
    width: widthIn,
    height: heightIn,
    dimensionUnit: "in"
  });
  const freightClass = freightClassResult.ok ? freightClassResult.freightClass : null;

  return {
    pallets: input.pallets,
    weightLb,
    providerWeightEachLb,
    lengthIn,
    widthIn,
    heightIn,
    uom: "US",
    freightClass,
    piece: {
      qty: input.pallets,
      weight: providerWeightEachLb,
      weightType: "each",
      length: lengthIn,
      width: widthIn,
      height: heightIn,
      dimType: "PLT",
      freightClass: freightClass ?? "",
      hazmat: false,
      stack: false
    }
  };
}

export function normalizeSupplyChainDesignDimensionUnit(value: string | null | undefined): "in" | "cm" | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (["in", "inch", "inches"].includes(normalized)) return "in";
  if (["cm", "centimeter", "centimeters"].includes(normalized)) return "cm";
  return null;
}

function convertSupplyChainDesignDimensionToInches(value: number, unit: "in" | "cm") {
  return unit === "cm" ? value * CM_TO_IN : value;
}

function roundPhysical(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
