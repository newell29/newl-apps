import { LTL_FREIGHT_CLASS_OPTIONS } from "@/modules/ltl-rate-portal/constants";

export type LtlFreightClassCalculationInput = {
  totalWeight: number;
  weightUnit: string;
  quantity: number;
  length: number;
  width: number;
  height: number;
  dimensionUnit: string;
};

export type LtlFreightClassCalculationResult =
  | {
      ok: true;
      freightClass: (typeof LTL_FREIGHT_CLASS_OPTIONS)[number];
      density: number;
      totalCubeFeet: number;
      totalWeightLb: number;
    }
  | {
      ok: false;
      freightClass: null;
      density: null;
      totalCubeFeet: null;
      totalWeightLb: null;
      errors: string[];
    };

export function calculateLtlFreightClass(input: LtlFreightClassCalculationInput): LtlFreightClassCalculationResult {
  const errors: string[] = [];
  const totalWeightLb = normalizeWeightLb(input.totalWeight, input.weightUnit);
  const lengthIn = normalizeDimensionIn(input.length, input.dimensionUnit);
  const widthIn = normalizeDimensionIn(input.width, input.dimensionUnit);
  const heightIn = normalizeDimensionIn(input.height, input.dimensionUnit);

  if (!Number.isFinite(totalWeightLb) || totalWeightLb <= 0) {
    errors.push("total shipment weight must be greater than zero");
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    errors.push("quantity must be greater than zero for freight class calculation");
  }
  if (![lengthIn, widthIn, heightIn].every((value) => Number.isFinite(value) && value > 0)) {
    errors.push("length, width and height must be greater than zero for freight class calculation");
  }

  const totalCubeFeet = (lengthIn * widthIn * heightIn * input.quantity) / 1728;
  if (!Number.isFinite(totalCubeFeet) || totalCubeFeet <= 0) {
    errors.push("total cube must be greater than zero for freight class calculation");
  }

  if (errors.length > 0) {
    return { ok: false, freightClass: null, density: null, totalCubeFeet: null, totalWeightLb: null, errors };
  }

  const density = totalWeightLb / totalCubeFeet;
  return {
    ok: true,
    freightClass: freightClassForDensity(density),
    density,
    totalCubeFeet,
    totalWeightLb
  };
}

export function freightClassForDensity(density: number): (typeof LTL_FREIGHT_CLASS_OPTIONS)[number] {
  if (density >= 50) return "50";
  if (density >= 35) return "55";
  if (density >= 30) return "60";
  if (density >= 22.5) return "65";
  if (density >= 15) return "70";
  if (density >= 13.5) return "77.5";
  if (density >= 12) return "85";
  if (density >= 10.5) return "92.5";
  if (density >= 9) return "100";
  if (density >= 8) return "110";
  if (density >= 7) return "125";
  if (density >= 6) return "150";
  if (density >= 5) return "175";
  if (density >= 4) return "200";
  if (density >= 3) return "250";
  if (density >= 2) return "300";
  if (density >= 1) return "400";
  return "500";
}

export function normalizeExplicitFreightClass(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && LTL_FREIGHT_CLASS_OPTIONS.includes(normalized as (typeof LTL_FREIGHT_CLASS_OPTIONS)[number])
    ? normalized
    : null;
}

function normalizeWeightLb(weight: number, weightUnit: string) {
  return weightUnit.toLowerCase() === "kg" ? weight * 2.2046226218 : weight;
}

function normalizeDimensionIn(value: number, dimensionUnit: string) {
  return dimensionUnit.toLowerCase() === "cm" ? value / 2.54 : value;
}
