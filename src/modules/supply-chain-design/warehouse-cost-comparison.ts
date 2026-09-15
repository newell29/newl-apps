import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";

export const WAREHOUSE_COST_COMPARISON_RESULT_VERSION = "WAREHOUSE_COST_COMPARISON_V1";

export type WarehouseCostComparisonFacilityType = "CURRENT" | "CANDIDATE";

export type WarehouseCostComparisonFacilityOption = {
  optionId: string;
  facilityType: WarehouseCostComparisonFacilityType;
  facilityId: string;
  facilityName: string;
  locationLabel: string;
  city: string | null;
  stateProvince: string | null;
  country: string | null;
  currency: string | null;
  annualFacilityWarehouseCost: number | null;
  annualFixedCost: number | null;
  inboundFeePerPallet: number | null;
  outboundFeePerPallet: number | null;
  storageFeePerPalletPerMonth: number | null;
  comparableAnnualWarehouseCost: number | null;
  comparableAnnualWarehouseCostSource: "annual_facility_warehouse_cost" | "annual_fixed_cost" | null;
};

export type WarehouseCostComparisonInputReference = {
  facilities: {
    fileId: string;
    fileName: string;
    mappingId: string;
    mappingUpdatedAt: string;
  };
  candidateFacilities: {
    fileId: string;
    fileName: string;
    mappingId: string;
    mappingUpdatedAt: string;
  };
  selectedFacilityOptionIds: string[];
  cadToUsdRate?: number | null;
};

export type WarehouseCostComparisonResultSummary = {
  resultVersion: typeof WAREHOUSE_COST_COMPARISON_RESULT_VERSION;
  comparisonName: string;
  selectedFacilityCount: number;
  currencyMode: "SINGLE_CURRENCY" | "CONVERTED_MIXED_CURRENCY";
  reportingCurrency: string;
  originalCurrencies: string[];
  cadToUsdRate: number | null;
  lowestFacilityOptionId: string | null;
  facilities: Array<{
    optionId: string;
    facilityType: WarehouseCostComparisonFacilityType;
    facilityId: string;
    facilityName: string;
    locationLabel: string;
    currency: string | null;
    originalComparableAnnualWarehouseCost: number | null;
    comparableAnnualWarehouseCost: number | null;
    comparableAnnualWarehouseCostSource: "annual_facility_warehouse_cost" | "annual_fixed_cost" | null;
    differenceFromLowest: number | null;
    percentDifferenceFromLowest: number | null;
  }>;
  categoryRows: Array<{
    category: string;
    values: Array<{
      optionId: string;
      value: number | null;
      currency: string | null;
    }>;
  }>;
  observations: string[];
  unavailableMessages: string[];
  disclaimer: string;
};

export function readWarehouseCostFacilityOptions(input: {
  currentFacilities: WarehouseCostMappedFile | null;
  candidateFacilities: WarehouseCostMappedFile | null;
}) {
  return [
    ...(input.currentFacilities ? readFacilities(input.currentFacilities, "CURRENT") : []),
    ...(input.candidateFacilities ? readFacilities(input.candidateFacilities, "CANDIDATE") : [])
  ].sort((left, right) => left.facilityType.localeCompare(right.facilityType) || left.facilityName.localeCompare(right.facilityName));
}

export function runWarehouseCostComparison(input: {
  comparisonName?: string;
  facilities: WarehouseCostComparisonFacilityOption[];
  selectedFacilityOptionIds: string[];
  cadToUsdRate?: number | null;
}): WarehouseCostComparisonResultSummary {
  const selectedIds = new Set(input.selectedFacilityOptionIds);
  const selected = input.facilities.filter((facility) => selectedIds.has(facility.optionId));
  if (selected.length < 2) {
    throw new Error("Select at least two facilities to compare warehouse costs.");
  }

  const currencies = unique(selected.map((facility) => facility.currency).filter((currency): currency is string => Boolean(currency)));
  const costCurrencies = unique(selected.filter((facility) => facility.comparableAnnualWarehouseCost !== null).map((facility) => facility.currency).filter((currency): currency is string => Boolean(currency)));
  if (selected.some((facility) => facility.comparableAnnualWarehouseCost !== null && !facility.currency)) {
    throw new Error("Currency is required when a selected facility has Annual Facility / Warehouse Cost.");
  }
  const mixedUsdCad = costCurrencies.length === 2 && costCurrencies.includes("USD") && costCurrencies.includes("CAD");
  if (costCurrencies.length > 1 && !mixedUsdCad) {
    throw new Error(`Warehouse cost comparison cannot combine currencies without an approved conversion. Currencies found: ${costCurrencies.join(", ")}.`);
  }
  if (mixedUsdCad && !isValidCadToUsdRate(input.cadToUsdRate)) {
    throw new Error("Enter a CAD to USD conversion rate greater than 0 and no more than 5.");
  }

  const reportingCurrency = mixedUsdCad ? "USD" : costCurrencies[0] ?? currencies[0] ?? "USD";
  const normalized = selected.map((facility) => {
    const original = facility.comparableAnnualWarehouseCost;
    const comparable =
      original === null
        ? null
        : mixedUsdCad && facility.currency === "CAD"
          ? roundCurrency(original * (input.cadToUsdRate ?? 0))
          : original;
    return { facility, comparable };
  });
  const comparableCosts = normalized.map((item) => item.comparable).filter((value): value is number => value !== null);
  const lowest = comparableCosts.length ? Math.min(...comparableCosts) : null;
  const lowestFacility = lowest === null
    ? null
    : normalized.find((item) => item.comparable === lowest)?.facility ?? null;

  const facilities = normalized.map(({ facility, comparable }) => ({
    optionId: facility.optionId,
    facilityType: facility.facilityType,
    facilityId: facility.facilityId,
    facilityName: facility.facilityName,
    locationLabel: facility.locationLabel,
    currency: facility.currency,
    originalComparableAnnualWarehouseCost: facility.comparableAnnualWarehouseCost,
    comparableAnnualWarehouseCost: comparable,
    comparableAnnualWarehouseCostSource: facility.comparableAnnualWarehouseCostSource,
    differenceFromLowest: comparable !== null && lowest !== null ? roundCurrency(comparable - lowest) : null,
    percentDifferenceFromLowest: comparable !== null && lowest !== null && lowest > 0 ? ((comparable - lowest) / lowest) * 100 : null
  }));

  const observations = buildObservations(facilities, lowestFacility?.optionId ?? null, reportingCurrency);
  return {
    resultVersion: WAREHOUSE_COST_COMPARISON_RESULT_VERSION,
    comparisonName: input.comparisonName?.trim() || "Warehouse Cost Comparison",
    selectedFacilityCount: facilities.length,
    currencyMode: mixedUsdCad ? "CONVERTED_MIXED_CURRENCY" : "SINGLE_CURRENCY",
    reportingCurrency,
    originalCurrencies: costCurrencies,
    cadToUsdRate: mixedUsdCad ? input.cadToUsdRate ?? null : null,
    lowestFacilityOptionId: lowestFacility?.optionId ?? null,
    facilities,
    categoryRows: [
      {
        category: "Annual facility / warehouse cost",
        values: facilities.map((facility) => ({
          optionId: facility.optionId,
          value: facility.comparableAnnualWarehouseCost,
          currency: reportingCurrency
        }))
      }
    ],
    observations,
    unavailableMessages: facilities
      .filter((facility) => facility.comparableAnnualWarehouseCost === null)
      .map((facility) => `${facility.facilityName} has no comparable annual warehouse cost supplied.`),
    disclaimer:
      "This comparison evaluates warehouse operating costs only. Transportation, inventory, service levels and network-design effects are evaluated separately."
  };
}

export type WarehouseCostMappedFile = {
  fileBytes: Uint8Array;
  fieldMappings: SupplyChainDesignFieldMapping[];
};

function readFacilities(file: WarehouseCostMappedFile, facilityType: WarehouseCostComparisonFacilityType) {
  const [headers = [], ...rows] = parseCsvRows(Buffer.from(file.fileBytes).toString("utf8"));
  const columns = toColumnIndex(file.fieldMappings, headers);
  const idField = facilityType === "CURRENT" ? "facility_id" : "candidate_facility_id";
  const nameField = facilityType === "CURRENT" ? "facility_name" : "candidate_facility_name";
  const typePrefix = facilityType === "CURRENT" ? "CURRENT" : "CANDIDATE";
  return rows
    .map((row) => {
      const facilityId = value(row, columns, idField);
      const facilityName = value(row, columns, nameField);
      if (!facilityId || !facilityName) return null;
      const annualFacilityWarehouseCost = optionalMoney(value(row, columns, "annual_facility_warehouse_cost"));
      const annualFixedCost = optionalMoney(value(row, columns, "annual_fixed_cost"));
      const inboundFeePerPallet = optionalMoney(value(row, columns, "inbound_fee_per_pallet"));
      const outboundFeePerPallet = optionalMoney(value(row, columns, "outbound_fee_per_pallet"));
      const storageFeePerPalletPerMonth = optionalMoney(value(row, columns, "storage_fee_per_pallet_per_month"));
      const comparable = annualFacilityWarehouseCost ?? annualFixedCost;
      const city = value(row, columns, "city") || null;
      const stateProvince = value(row, columns, "state_province") || null;
      const country = (value(row, columns, "country") || value(row, columns, "candidate_country") || null)?.toUpperCase() ?? null;
      const locationLabel = [city, stateProvince, country].filter(Boolean).join(", ") || "Location not supplied";
      return {
        optionId: `${typePrefix}:${facilityId}`,
        facilityType,
        facilityId,
        facilityName,
        locationLabel,
        city,
        stateProvince,
        country,
        currency: normalizeCurrency(value(row, columns, "currency")),
        annualFacilityWarehouseCost,
        annualFixedCost,
        inboundFeePerPallet,
        outboundFeePerPallet,
        storageFeePerPalletPerMonth,
        comparableAnnualWarehouseCost: comparable,
        comparableAnnualWarehouseCostSource: annualFacilityWarehouseCost !== null ? "annual_facility_warehouse_cost" as const : annualFixedCost !== null ? "annual_fixed_cost" as const : null
      };
    })
    .filter((facility): facility is WarehouseCostComparisonFacilityOption => Boolean(facility));
}

function toColumnIndex(fieldMappings: SupplyChainDesignFieldMapping[], headers: string[]) {
  const headerMap = new Map(headers.map((header, index) => [normalize(header), index]));
  const columns = new Map<string, number>();
  for (const mapping of fieldMappings) {
    if (!mapping.sourceColumn) continue;
    const index = headerMap.get(normalize(mapping.sourceColumn));
    if (index !== undefined) columns.set(mapping.standardField, index);
  }
  return columns;
}

function value(row: string[], columns: Map<string, number>, field: string) {
  const index = columns.get(field);
  return index === undefined ? "" : (row[index] ?? "").trim();
}

function optionalMoney(raw: string) {
  if (!raw.trim()) return null;
  const parsed = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Warehouse cost value "${raw}" is not a valid number.`);
  if (parsed < 0) throw new Error("Warehouse cost cannot be negative.");
  return roundCurrency(parsed);
}

function normalizeCurrency(raw: string) {
  const value = raw.trim().toUpperCase();
  if (!value) return null;
  if (value === "US" || value === "USD") return "USD";
  if (value === "CA" || value === "CAD") return "CAD";
  return value;
}

function isValidCadToUsdRate(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 5;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function buildObservations(
  facilities: WarehouseCostComparisonResultSummary["facilities"],
  lowestFacilityOptionId: string | null,
  currency: string
) {
  const lowest = facilities.find((facility) => facility.optionId === lowestFacilityOptionId) ?? null;
  const observations = lowest ? [`${lowest.facilityName} has the lowest comparable annual warehouse cost.`] : [];
  const highestDifference = facilities
    .filter((facility) => facility.differenceFromLowest !== null && facility.optionId !== lowestFacilityOptionId)
    .sort((left, right) => (right.differenceFromLowest ?? 0) - (left.differenceFromLowest ?? 0))[0];
  if (highestDifference?.differenceFromLowest !== null && highestDifference?.differenceFromLowest !== undefined) {
    observations.push(
      `${highestDifference.facilityName} is ${formatMoney(highestDifference.differenceFromLowest, currency)} higher than the lowest-cost selected facility.`
    );
    observations.push("The largest comparable cost difference is in Annual facility / warehouse cost.");
  }
  return observations;
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(value);
}
