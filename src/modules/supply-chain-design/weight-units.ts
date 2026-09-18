export type SupplyChainDesignWeightUnit = "lb" | "kg";

export type SupplyChainDesignWeightUnitNormalization =
  | { ok: true; unit: SupplyChainDesignWeightUnit }
  | { ok: false; reason: "MISSING" | "UNSUPPORTED"; sourceValue: string };

const KG_TO_LB = 2.2046226218;

export function normalizeSupplyChainDesignWeightUnit(
  value: string | null | undefined
): SupplyChainDesignWeightUnitNormalization {
  const sourceValue = value?.trim() ?? "";
  const normalized = sourceValue.toLowerCase();
  if (!normalized) {
    return { ok: false, reason: "MISSING", sourceValue };
  }
  if (normalized === "lb" || normalized === "lbs" || normalized === "pound" || normalized === "pounds") {
    return { ok: true, unit: "lb" };
  }
  if (normalized === "kg" || normalized === "kgs" || normalized === "kilogram" || normalized === "kilograms") {
    return { ok: true, unit: "kg" };
  }
  return { ok: false, reason: "UNSUPPORTED", sourceValue };
}

export function convertSupplyChainDesignWeightToPounds(weight: number, unit: SupplyChainDesignWeightUnit) {
  return unit === "kg" ? weight * KG_TO_LB : weight;
}
