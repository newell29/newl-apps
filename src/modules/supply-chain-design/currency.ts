export type SupplyChainDesignCurrency = "USD" | "CAD";

export type SupplyChainDesignCurrencyContext = {
  analysisCurrency: SupplyChainDesignCurrency;
  cadToUsdRate: number | null;
};

export type SupplyChainDesignNormalizedMoney = {
  originalAmount: number;
  originalCurrency: SupplyChainDesignCurrency;
  normalizedAmount: number;
  normalizedCurrency: SupplyChainDesignCurrency;
  cadToUsdRate: number | null;
  fxApplied: boolean;
  rateDirection: "1 CAD = X USD";
};

export type SupplyChainDesignFxSnapshot = {
  analysisCurrency: SupplyChainDesignCurrency;
  cadToUsdRate: number | null;
  rateDirection: "1 CAD = X USD";
};

export function normalizeSupplyChainDesignCurrency(value: string | null | undefined): SupplyChainDesignCurrency | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (normalized === "USD" || normalized === "US") return "USD";
  if (normalized === "CAD" || normalized === "CA") return "CAD";
  return null;
}

export function parseSupplyChainDesignAnalysisCurrency(value: string | null | undefined): SupplyChainDesignCurrency {
  const normalized = normalizeSupplyChainDesignCurrency(value);
  if (normalized !== "USD" && normalized !== "CAD") {
    throw new Error("Analysis Currency must be USD or CAD.");
  }
  return normalized;
}

export function parseSupplyChainDesignCadToUsdRate(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 5) {
    throw new Error("FX rate must be greater than 0 and no more than 5, using the format 1 CAD = X USD.");
  }
  return parsed;
}

export function buildSupplyChainDesignCurrencyContext(input: {
  analysisCurrency?: string | null;
  cadToUsdRate?: string | number | null;
}): SupplyChainDesignCurrencyContext {
  return {
    analysisCurrency: parseSupplyChainDesignAnalysisCurrency(input.analysisCurrency ?? "USD"),
    cadToUsdRate: parseSupplyChainDesignCadToUsdRate(input.cadToUsdRate ?? null)
  };
}

export function supplyChainDesignFxSnapshot(
  context: SupplyChainDesignCurrencyContext
): SupplyChainDesignFxSnapshot {
  return {
    analysisCurrency: context.analysisCurrency,
    cadToUsdRate: context.cadToUsdRate,
    rateDirection: "1 CAD = X USD"
  };
}

export function normalizeSupplyChainDesignMoney(
  amount: number,
  sourceCurrency: string | null | undefined,
  context: SupplyChainDesignCurrencyContext,
  label: string
): SupplyChainDesignNormalizedMoney {
  if (!Number.isFinite(amount)) {
    throw new Error(`${label} is not a valid monetary amount.`);
  }
  const originalCurrency = normalizeSupplyChainDesignCurrency(sourceCurrency);
  if (!originalCurrency) {
    const supplied = sourceCurrency?.trim();
    throw new Error(supplied ? `${label} currency "${supplied}" is not supported. Use USD or CAD.` : `${label} currency is required.`);
  }
  if (originalCurrency === context.analysisCurrency) {
    return {
      originalAmount: amount,
      originalCurrency,
      normalizedAmount: roundSupplyChainDesignMoney(amount),
      normalizedCurrency: context.analysisCurrency,
      cadToUsdRate: context.cadToUsdRate,
      fxApplied: false,
      rateDirection: "1 CAD = X USD"
    };
  }
  if (!context.cadToUsdRate) {
    throw new Error(`${label} requires FX because ${originalCurrency} must be converted to ${context.analysisCurrency}. Enter the rate using 1 CAD = X USD.`);
  }
  const normalizedAmount =
    originalCurrency === "CAD" && context.analysisCurrency === "USD"
      ? amount * context.cadToUsdRate
      : amount / context.cadToUsdRate;
  return {
    originalAmount: amount,
    originalCurrency,
    normalizedAmount: roundSupplyChainDesignMoney(normalizedAmount),
    normalizedCurrency: context.analysisCurrency,
    cadToUsdRate: context.cadToUsdRate,
    fxApplied: true,
    rateDirection: "1 CAD = X USD"
  };
}

export function roundSupplyChainDesignMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatSupplyChainDesignMoney(value: number | null | undefined, currency: SupplyChainDesignCurrency | string | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Unavailable";
  const normalizedCurrency = normalizeSupplyChainDesignCurrency(currency ?? null);
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value)} ${normalizedCurrency ?? currency ?? ""}`.trim();
}
