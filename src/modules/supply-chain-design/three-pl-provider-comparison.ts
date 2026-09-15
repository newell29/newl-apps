import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import { getSourceColumn } from "@/modules/supply-chain-design/model-01-proof";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";

export const THREE_PL_PROVIDER_COMPARISON_RESULT_VERSION = "3PL_PROVIDER_COMPARISON_V1";

export type SupplyChainDesignProviderComparisonMappedFile = {
  fileId: string;
  fileName: string;
  mappingId: string;
  mappingUpdatedAt: string;
  fileBytes: Buffer;
  fieldMappings: SupplyChainDesignFieldMapping[];
};

export type SupplyChainDesignProviderComparisonInput = {
  studyName: string;
  demandPoints: SupplyChainDesignProviderComparisonMappedFile;
  providerOptions: SupplyChainDesignProviderComparisonMappedFile;
  shipmentProfiles: SupplyChainDesignProviderComparisonMappedFile;
  outboundRateCache: SupplyChainDesignProviderComparisonMappedFile;
  expectedProviderResults?: SupplyChainDesignProviderComparisonMappedFile | null;
};

export type SupplyChainDesignProviderComparisonResultSummary = {
  resultVersion: typeof THREE_PL_PROVIDER_COMPARISON_RESULT_VERSION;
  studyName: string;
  studyType: "COMPARE_KNOWN_WAREHOUSE_OPTIONS";
  status: "SUCCESS";
  calculationMethod: string;
  calculationSettings: {
    currency: string;
    storageInputRule: string;
    storageMethodPrecedence: string;
  };
  totalAnnualShipments: number;
  totalAnnualPallets: number;
  recommendedOption: ProviderCostResult | null;
  nextBestDifference: number | null;
  providerResults: ProviderCostResult[];
  rateMatchEvidence: RateMatchEvidence[];
  exceptions: ProviderComparisonException[];
  benchmarkControlResults: ProviderBenchmarkControlResult[];
  formulas: string[];
};

export type ProviderCostResult = {
  rank: number;
  providerOptionId: string;
  providerName: string;
  warehouseName: string;
  warehouseLocation: string;
  currency: string;
  complete: boolean;
  annualStorageCost: number;
  annualReceivingCost: number;
  annualOutboundHandlingCost: number;
  annualMinimumAdjustment: number;
  annualFixedOtherWarehouseCost: number;
  annualInboundGatewayCost: number;
  storageMethod: "RATE_BASED" | "DIRECT_ANNUAL";
  storageRatePerPalletPerMonth: number | null;
  averageStoredPallets: number | null;
  directAnnualStorageCost: number | null;
  annualOutboundTransportationCost: number;
  totalAnnualCost: number | null;
  warehouseCost: number;
  demandCovered: number;
  missingRateCount: number;
  shipmentsWithinThreeDays: number;
  threeDayCoveragePercent: number;
};

export type RateMatchEvidence = {
  providerOptionId: string;
  destinationId: string;
  shipmentProfileId: string;
  annualShipments: number;
  costPerShipment: number | null;
  annualOutboundCost: number | null;
  transitBusinessDays: number | null;
  status: "MATCHED" | "MISSING" | "AMBIGUOUS";
};

export type ProviderComparisonException = {
  type: string;
  message: string;
  providerOptionId?: string;
  destinationId?: string;
};

export type ProviderBenchmarkControlResult = {
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
};

type DemandRow = {
  destinationId: string;
  annualShipments: number;
  annualPallets: number;
  shipmentProfileId: string;
};

type ProviderOption = {
  providerOptionId: string;
  providerName: string;
  warehouseName: string;
  warehousePostalCode: string;
  warehouseCity: string;
  warehouseStateProvince: string;
  warehouseCountry: string;
  monthlyStorageCost: number | null;
  annualStorageCost: number | null;
  receivingCostPerUnit: number;
  outboundHandlingCostPerUnit: number;
  monthlyMinimum: number | null;
  annualMinimum: number | null;
  fixedAnnualCost: number;
  inboundGatewayCost: number;
  otherAnnualCost: number;
  averageStoredPallets: number | null;
  currency: string;
};

type RateRow = {
  providerOptionId: string;
  destinationId: string;
  shipmentProfileId: string;
  costPerShipment: number;
  transitBusinessDays: number | null;
  currency: string;
};

export function runSupplyChainDesignProviderComparison(
  input: SupplyChainDesignProviderComparisonInput
): SupplyChainDesignProviderComparisonResultSummary {
  const demandRows = readDemand(input.demandPoints);
  const providers = readProviders(input.providerOptions);
  readShipmentProfiles(input.shipmentProfiles, demandRows);
  const rates = readRates(input.outboundRateCache);
  const expected = input.expectedProviderResults ? readExpected(input.expectedProviderResults) : [];
  const totalAnnualShipments = sum(demandRows.map((row) => row.annualShipments));
  const totalAnnualPallets = sum(demandRows.map((row) => row.annualPallets));
  if (totalAnnualShipments <= 0) {
    throw new Error("SCDS_3PL_PROVIDER_ZERO_DEMAND: shipment-profile annual demand must be greater than zero.");
  }

  const currencies = new Set([...providers.map((row) => row.currency), ...rates.map((row) => row.currency)].filter(Boolean));
  if (currencies.size > 1) {
    throw new Error(`SCDS_3PL_PROVIDER_CURRENCY_MISMATCH: currencies found ${[...currencies].join(", ")}.`);
  }
  const currency = [...currencies][0] ?? "USD";
  const rateIndex = indexRates(rates);
  const exceptions: ProviderComparisonException[] = [];
  const rateMatchEvidence: RateMatchEvidence[] = [];
  const providerResults = providers.map((provider) =>
    calculateProvider(provider, demandRows, totalAnnualPallets, totalAnnualShipments, rateIndex, exceptions, rateMatchEvidence)
  );

  providerResults.sort(
    (left, right) =>
      Number(left.totalAnnualCost === null) - Number(right.totalAnnualCost === null) ||
      (left.totalAnnualCost ?? Number.POSITIVE_INFINITY) - (right.totalAnnualCost ?? Number.POSITIVE_INFINITY) ||
      left.providerOptionId.localeCompare(right.providerOptionId)
  );
  const ranked = providerResults.map((result, index) => ({ ...result, rank: index + 1 }));
  const recommendedOption = ranked.find((row) => row.complete) ?? null;
  const nextBest = ranked.find((row) => row.complete && row.providerOptionId !== recommendedOption?.providerOptionId) ?? null;
  const benchmarkControlResults = buildBenchmarkControls(ranked, expected);

  return {
    resultVersion: THREE_PL_PROVIDER_COMPARISON_RESULT_VERSION,
    studyName: input.studyName,
    studyType: "COMPARE_KNOWN_WAREHOUSE_OPTIONS",
    status: "SUCCESS",
    calculationMethod: "Cached benchmark outbound rates plus normalized warehouse charges; no live carrier calls.",
    calculationSettings: {
      currency,
      storageInputRule:
        "Each provider must supply either Annual Storage Cost or both Storage Rate per Pallet per Month and Average Stored Pallets.",
      storageMethodPrecedence:
        "When Annual Storage Cost is supplied, direct annual storage is used and rate-based storage is not also applied."
    },
    totalAnnualShipments,
    totalAnnualPallets,
    recommendedOption,
    nextBestDifference:
      recommendedOption && nextBest && nextBest.totalAnnualCost !== null
        ? round2(nextBest.totalAnnualCost - recommendedOption.totalAnnualCost!)
        : null,
    providerResults: ranked,
    rateMatchEvidence,
    exceptions,
    benchmarkControlResults,
    formulas: [
      "Rate-based annual storage cost = Storage Rate per Pallet per Month x Average Stored Pallets x 12.",
      "Direct annual storage cost = Annual Storage Cost when supplied; direct annual storage is not double-counted with rate-based storage.",
      "Annual receiving cost = receiving_cost_per_unit x annual inbound pallets.",
      "Annual outbound handling cost = outbound_handling_cost_per_unit x annual outbound pallets.",
      "Warehouse cost before minimum = storage + receiving + outbound handling + fixed/other annual warehouse cost.",
      "Annual minimum adjustment = max(annualized minimum - warehouse cost before minimum, 0).",
      "Outbound transportation cost = sum annual shipments by destination x cached cost per shipment.",
      "Total annual cost = outbound transportation + warehouse cost + inbound gateway/ocean/inland/other costs."
    ]
  };
}

function calculateProvider(
  provider: ProviderOption,
  demandRows: DemandRow[],
  totalAnnualPallets: number,
  totalAnnualShipments: number,
  rateIndex: Map<string, RateRow[]>,
  exceptions: ProviderComparisonException[],
  evidence: RateMatchEvidence[]
): ProviderCostResult {
  const storage = resolveProviderStorage(provider);
  const annualStorageCost = storage.annualStorageCost;
  const annualReceivingCost = provider.receivingCostPerUnit * totalAnnualPallets;
  const annualOutboundHandlingCost = provider.outboundHandlingCostPerUnit * totalAnnualPallets;
  const annualFixedOtherWarehouseCost = provider.fixedAnnualCost + provider.otherAnnualCost;
  const minimum = provider.annualMinimum ?? (provider.monthlyMinimum === null ? 0 : provider.monthlyMinimum * 12);
  const warehouseBeforeMinimum =
    annualStorageCost + annualReceivingCost + annualOutboundHandlingCost + annualFixedOtherWarehouseCost;
  const annualMinimumAdjustment = Math.max(0, minimum - warehouseBeforeMinimum);
  let annualOutboundTransportationCost = 0;
  let missingRateCount = 0;
  let complete = true;
  let shipmentsWithinThreeDays = 0;

  for (const demand of demandRows) {
    const matches = rateIndex.get(rateKey(provider.providerOptionId, demand.destinationId, demand.shipmentProfileId)) ?? [];
    if (matches.length === 0) {
      complete = false;
      missingRateCount += 1;
      exceptions.push({
        type: "SCDS_3PL_OUTBOUND_RATE_MISSING",
        providerOptionId: provider.providerOptionId,
        destinationId: demand.destinationId,
        message: `${provider.providerOptionId}/${demand.destinationId}/${demand.shipmentProfileId} has no cached outbound rate.`
      });
      evidence.push({
        providerOptionId: provider.providerOptionId,
        destinationId: demand.destinationId,
        shipmentProfileId: demand.shipmentProfileId,
        annualShipments: demand.annualShipments,
        costPerShipment: null,
        annualOutboundCost: null,
        transitBusinessDays: null,
        status: "MISSING"
      });
      continue;
    }
    if (matches.length > 1) {
      complete = false;
      missingRateCount += 1;
      exceptions.push({
        type: "SCDS_3PL_OUTBOUND_RATE_AMBIGUOUS",
        providerOptionId: provider.providerOptionId,
        destinationId: demand.destinationId,
        message: `${provider.providerOptionId}/${demand.destinationId}/${demand.shipmentProfileId} has multiple cached outbound rates.`
      });
      evidence.push({
        providerOptionId: provider.providerOptionId,
        destinationId: demand.destinationId,
        shipmentProfileId: demand.shipmentProfileId,
        annualShipments: demand.annualShipments,
        costPerShipment: null,
        annualOutboundCost: null,
        transitBusinessDays: null,
        status: "AMBIGUOUS"
      });
      continue;
    }
    const rate = matches[0];
    const annualOutboundCost = round2(demand.annualShipments * rate.costPerShipment);
    annualOutboundTransportationCost += annualOutboundCost;
    if (rate.transitBusinessDays !== null && rate.transitBusinessDays <= 3) {
      shipmentsWithinThreeDays += demand.annualShipments;
    }
    evidence.push({
      providerOptionId: provider.providerOptionId,
      destinationId: demand.destinationId,
      shipmentProfileId: demand.shipmentProfileId,
      annualShipments: demand.annualShipments,
      costPerShipment: rate.costPerShipment,
      annualOutboundCost,
      transitBusinessDays: rate.transitBusinessDays,
      status: "MATCHED"
    });
  }

  const warehouseCost = round2(warehouseBeforeMinimum + annualMinimumAdjustment);
  const totalAnnualCost = complete
    ? round2(annualOutboundTransportationCost + warehouseCost + provider.inboundGatewayCost)
    : null;

  return {
    rank: 0,
    providerOptionId: provider.providerOptionId,
    providerName: provider.providerName,
    warehouseName: provider.warehouseName,
    warehouseLocation: `${provider.warehouseCity}, ${provider.warehouseStateProvince} ${provider.warehousePostalCode}`,
    currency: provider.currency,
    complete,
    annualStorageCost: round2(annualStorageCost),
    annualReceivingCost: round2(annualReceivingCost),
    annualOutboundHandlingCost: round2(annualOutboundHandlingCost),
    annualMinimumAdjustment: round2(annualMinimumAdjustment),
    annualFixedOtherWarehouseCost: round2(annualFixedOtherWarehouseCost),
    annualInboundGatewayCost: round2(provider.inboundGatewayCost),
    storageMethod: storage.storageMethod,
    storageRatePerPalletPerMonth: storage.storageRatePerPalletPerMonth,
    averageStoredPallets: storage.averageStoredPallets,
    directAnnualStorageCost: storage.directAnnualStorageCost,
    annualOutboundTransportationCost: round2(annualOutboundTransportationCost),
    totalAnnualCost,
    warehouseCost,
    demandCovered: complete ? totalAnnualShipments : 0,
    missingRateCount,
    shipmentsWithinThreeDays,
    threeDayCoveragePercent: round1((shipmentsWithinThreeDays / totalAnnualShipments) * 100)
  };
}

function resolveProviderStorage(provider: ProviderOption): {
  storageMethod: ProviderCostResult["storageMethod"];
  annualStorageCost: number;
  storageRatePerPalletPerMonth: number | null;
  averageStoredPallets: number | null;
  directAnnualStorageCost: number | null;
} {
  if (provider.annualStorageCost !== null) {
    return {
      storageMethod: "DIRECT_ANNUAL",
      annualStorageCost: provider.annualStorageCost,
      storageRatePerPalletPerMonth: null,
      averageStoredPallets: null,
      directAnnualStorageCost: provider.annualStorageCost
    };
  }

  const hasRate = provider.monthlyStorageCost !== null;
  const hasAveragePallets = provider.averageStoredPallets !== null;
  if (hasRate && hasAveragePallets) {
    return {
      storageMethod: "RATE_BASED",
      annualStorageCost: provider.monthlyStorageCost! * provider.averageStoredPallets! * 12,
      storageRatePerPalletPerMonth: provider.monthlyStorageCost,
      averageStoredPallets: provider.averageStoredPallets,
      directAnnualStorageCost: null
    };
  }

  if (hasRate) {
    throw new Error(
      `SCDS_3PL_STORAGE_AVERAGE_PALLETS_MISSING: ${provider.providerOptionId} has Storage Rate per Pallet per Month but is missing Average Stored Pallets.`
    );
  }
  if (hasAveragePallets) {
    throw new Error(
      `SCDS_3PL_STORAGE_RATE_MISSING: ${provider.providerOptionId} has Average Stored Pallets but is missing Storage Rate per Pallet per Month.`
    );
  }
  throw new Error(
    `SCDS_3PL_STORAGE_BASIS_MISSING: ${provider.providerOptionId} requires either Annual Storage Cost or both Storage Rate per Pallet per Month and Average Stored Pallets.`
  );
}

function readDemand(file: SupplyChainDesignProviderComparisonMappedFile) {
  const rows = readMappedRows(file);
  const result: DemandRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const destinationId = value(row, "destination_id");
    if (!destinationId || seen.has(destinationId)) continue;
    seen.add(destinationId);
    const annualShipments = requiredNumber(row, "annual_shipment_count", "DEMAND_POINTS annual_shipment_count");
    const annualPallets = numberValue(row, "annual_pallets") ?? 0;
    const shipmentProfileId = value(row, "shipment_profile_id");
    if (annualShipments <= 0) throw new Error("SCDS_3PL_PROVIDER_ZERO_DEMAND: annual shipments must be greater than zero.");
    if (!shipmentProfileId) {
      throw new Error(`SCDS_3PL_DEMAND_SHIPMENT_PROFILE_MISSING: DEMAND_POINTS row ${destinationId} is missing shipment_profile_id.`);
    }
    result.push({
      destinationId,
      annualShipments,
      annualPallets,
      shipmentProfileId
    });
  }
  return result;
}

function readProviders(file: SupplyChainDesignProviderComparisonMappedFile) {
  const seen = new Set<string>();
  return readMappedRows(file).map((row) => {
    const providerOptionId = value(row, "provider_option_id");
    if (!providerOptionId) throw new Error("PROVIDER_OPTIONS provider_option_id is required.");
    if (seen.has(providerOptionId)) throw new Error(`SCDS_3PL_DUPLICATE_PROVIDER_OPTION: ${providerOptionId} appears more than once.`);
    seen.add(providerOptionId);
    const warehousePostalCode = value(row, "warehouse_postal_code");
    if (!warehousePostalCode) throw new Error(`SCDS_3PL_PROVIDER_WAREHOUSE_ZIP_MISSING: ${providerOptionId} is missing warehouse ZIP.`);
    return {
      providerOptionId,
      providerName: value(row, "provider_name"),
      warehouseName: value(row, "warehouse_name") || value(row, "provider_name"),
      warehousePostalCode,
      warehouseCity: value(row, "warehouse_city"),
      warehouseStateProvince: value(row, "warehouse_state_province"),
      warehouseCountry: value(row, "warehouse_country"),
      monthlyStorageCost: optionalNonNegative(row, "monthly_storage_cost", providerOptionId),
      averageStoredPallets: optionalNonNegative(row, "average_stored_pallets", providerOptionId),
      annualStorageCost: optionalNonNegative(row, "annual_storage_cost", providerOptionId),
      receivingCostPerUnit: optionalNonNegative(row, "receiving_cost_per_unit", providerOptionId) ?? 0,
      outboundHandlingCostPerUnit: optionalNonNegative(row, "outbound_handling_cost_per_unit", providerOptionId) ?? 0,
      monthlyMinimum: optionalNonNegative(row, "monthly_minimum", providerOptionId),
      annualMinimum: optionalNonNegative(row, "annual_minimum", providerOptionId),
      fixedAnnualCost: optionalNonNegative(row, "fixed_annual_cost", providerOptionId) ?? 0,
      inboundGatewayCost:
        (optionalNonNegative(row, "inbound_gateway_cost", providerOptionId) ?? 0) +
        (optionalNonNegative(row, "other_annual_cost", providerOptionId) ?? 0),
      otherAnnualCost: 0,
      currency: value(row, "currency") || "USD"
    };
  });
}

function readShipmentProfiles(file: SupplyChainDesignProviderComparisonMappedFile, demandRows: DemandRow[]) {
  const profileIds = new Set(readMappedRows(file).map((row) => value(row, "shipment_profile_id")).filter(Boolean));
  for (const demand of demandRows) {
    if (!profileIds.has(demand.shipmentProfileId)) {
      throw new Error(`SHIPMENT_PROFILES is missing ${demand.shipmentProfileId}.`);
    }
  }
}

function readRates(file: SupplyChainDesignProviderComparisonMappedFile) {
  return readMappedRows(file).map((row) => ({
    providerOptionId: value(row, "provider_option_id"),
    destinationId: value(row, "destination_id"),
    shipmentProfileId: value(row, "shipment_profile_id"),
    costPerShipment: requiredNumber(row, "cost_per_shipment", "OUTBOUND_RATE_CACHE cost_per_shipment"),
    transitBusinessDays: numberValue(row, "transit_business_days"),
    currency: value(row, "currency") || "USD"
  }));
}

function readExpected(file: SupplyChainDesignProviderComparisonMappedFile) {
  return readMappedRows(file).map((row) => ({
    rank: requiredNumber(row, "rank", "EXPECTED_PROVIDER_RESULTS rank"),
    providerOptionId: value(row, "provider_option_id"),
    providerName: value(row, "provider_name"),
    outboundCost: requiredNumber(row, "outbound_cost", "EXPECTED_PROVIDER_RESULTS outbound_cost"),
    warehouseCost: requiredNumber(row, "warehouse_cost", "EXPECTED_PROVIDER_RESULTS warehouse_cost"),
    totalAnnualCost: requiredNumber(row, "total_annual_cost", "EXPECTED_PROVIDER_RESULTS total_annual_cost")
  }));
}

function indexRates(rates: RateRow[]) {
  const index = new Map<string, RateRow[]>();
  for (const rate of rates) {
    const key = rateKey(rate.providerOptionId, rate.destinationId, rate.shipmentProfileId);
    index.set(key, [...(index.get(key) ?? []), rate]);
  }
  return index;
}

function buildBenchmarkControls(results: ProviderCostResult[], expected: ReturnType<typeof readExpected>) {
  if (expected.length === 0) return [];
  return expected.map((expectedRow) => {
    const actual = results.find((row) => row.providerOptionId === expectedRow.providerOptionId);
    const passed = actual
      ? actual.rank === expectedRow.rank &&
        actual.totalAnnualCost !== null &&
        Math.abs(actual.totalAnnualCost - expectedRow.totalAnnualCost) <= 0.01 &&
        Math.abs(actual.annualOutboundTransportationCost - expectedRow.outboundCost) <= 0.01 &&
        Math.abs(actual.warehouseCost - expectedRow.warehouseCost) <= 0.01
      : false;
    return {
      label: `${expectedRow.providerName} expected result`,
      expected: `rank ${expectedRow.rank}; total ${expectedRow.totalAnnualCost}`,
      actual: actual ? `rank ${actual.rank}; total ${actual.totalAnnualCost ?? "incomplete"}` : "missing",
      passed
    };
  });
}

function readMappedRows(file: SupplyChainDesignProviderComparisonMappedFile) {
  const rows = parseCsvRows(file.fileBytes.toString("utf8"));
  const headers = (rows[0] ?? []).map(normalizeCsvHeader);
  return rows.slice(1).map((row) => {
    const mapped: Record<string, string> = {};
    for (const field of file.fieldMappings) {
      const sourceColumn = getSourceColumn(file.fieldMappings, field.standardField);
      if (!sourceColumn) continue;
      const index = headers.indexOf(normalizeCsvHeader(sourceColumn));
      mapped[field.standardField] = index >= 0 ? (row[index] ?? "").trim() : "";
    }
    return mapped;
  });
}

function optionalNonNegative(row: Record<string, string>, field: string, providerOptionId: string) {
  const raw = value(row, field);
  if (!raw) return null;
  const parsed = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`SCDS_3PL_PROVIDER_INVALID_NUMERIC_COST: ${providerOptionId} ${field} is not numeric.`);
  if (parsed < 0) throw new Error(`SCDS_3PL_PROVIDER_NEGATIVE_COST: ${providerOptionId} ${field} cannot be negative.`);
  return parsed;
}

function requiredNumber(row: Record<string, string>, field: string, label: string) {
  const parsed = numberValue(row, field);
  if (parsed === null) throw new Error(`${label} is required and must be numeric.`);
  return parsed;
}

function numberValue(row: Record<string, string>, field: string) {
  const raw = value(row, field);
  if (!raw) return null;
  const parsed = Number(raw.replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function rateKey(providerOptionId: string, destinationId: string, shipmentProfileId: string) {
  return `${providerOptionId}|${destinationId}|${shipmentProfileId}`;
}

function value(row: Record<string, string>, field: string) {
  return (row[field] ?? "").trim();
}

function normalizeCsvHeader(header: string) {
  return header.replace(/^\uFEFF/, "").trim();
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
