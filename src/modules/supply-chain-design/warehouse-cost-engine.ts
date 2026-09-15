export type SupplyChainDesignWarehouseCostBasis = "ANNUAL_ALL_IN" | "VARIABLE_3PL_RATES";

export type SupplyChainDesignWarehouseCostStatus =
  | "COMPLETE"
  | "ANNUAL_ALL_IN"
  | "INCOMPLETE_VARIABLE_COST";

export type SupplyChainDesignWarehouseCostFacilitySourceType = "CURRENT" | "CANDIDATE";

export type SupplyChainDesignWarehouseCostCandidateInput = {
  facilityId: string;
  facilitySourceType: "CANDIDATE";
  currency: string | null;
  annualFacilityWarehouseCost?: number | null;
  annualFixedCost?: number | null;
  inboundFeePerPallet?: number | null;
  outboundFeePerPallet?: number | null;
  storageFeePerPalletPerMonth?: number | null;
};

export type SupplyChainDesignWarehouseCostCurrentFacilityInput = {
  facilityId: string;
  facilitySourceType: "CURRENT";
  currency: string | null;
  annualFacilityWarehouseCost?: number | null;
};

export type SupplyChainDesignWarehouseCostProfileInput = {
  profileKey: string;
  representedShipments: number;
  representativePallets: number | null;
  inventoryDwellTimeDays: number | null;
  sourceLineage: SupplyChainDesignWarehouseCostSourceLineage[];
};

export type SupplyChainDesignWarehouseCostSourceRowInput = {
  sourceRowId: string;
  shipmentReference: string;
  representedShipments: number;
  pallets: number | null;
  inventoryDwellTimeDays: number | null;
};

export type SupplyChainDesignWarehouseCostSourceLineage = {
  sourceRowId: string;
  shipmentReference: string;
  representedShipments: number;
};

export type SupplyChainDesignWarehouseCostBillingEvidence = {
  sourceRowId: string;
  shipmentReference: string;
  representedShipments: number;
  representedPallets: number | null;
  inventoryDwellTimeDays: number | null;
  billableStorageMonths: number | null;
  inboundCost: number | null;
  outboundCost: number | null;
  storageCost: number | null;
  knownSubtotal: number;
  missingInputs: string[];
};

export type SupplyChainDesignWarehouseCostResult = {
  facilityId: string;
  facilitySourceType: SupplyChainDesignWarehouseCostFacilitySourceType;
  warehouseCostBasis: SupplyChainDesignWarehouseCostBasis;
  status: SupplyChainDesignWarehouseCostStatus;
  currency: string | null;
  representedPallets: number | null;
  representedShipments: number;
  inboundCost: number | null;
  outboundCost: number | null;
  storageCost: number | null;
  knownSubtotal: number;
  completeWarehouseCost: number | null;
  annualAllInCost: number | null;
  billableStorageMonths: number | null;
  billingEvidence: SupplyChainDesignWarehouseCostBillingEvidence[];
  missingInputs: string[];
  sourceLineage: SupplyChainDesignWarehouseCostSourceLineage[];
};

export function calculateBillableStorageMonths(inventoryDwellTimeDays: number) {
  if (!Number.isFinite(inventoryDwellTimeDays) || inventoryDwellTimeDays < 0) {
    throw new Error("Inventory dwell time days must be a finite non-negative number.");
  }
  return Math.max(1, Math.ceil(inventoryDwellTimeDays / 30));
}

export function calculateCandidateWarehouseCostForPreparedProfile(input: {
  candidate: SupplyChainDesignWarehouseCostCandidateInput;
  profile: SupplyChainDesignWarehouseCostProfileInput;
}): SupplyChainDesignWarehouseCostResult {
  return calculateCandidateWarehouseCostFromSourceRows({
    candidate: input.candidate,
    sourceRows: [
      {
        sourceRowId: input.profile.profileKey,
        shipmentReference: input.profile.sourceLineage.map((lineage) => lineage.shipmentReference).filter(Boolean).join(", "),
        representedShipments: input.profile.representedShipments,
        pallets:
          input.profile.representativePallets === null
            ? null
            : input.profile.representativePallets * input.profile.representedShipments,
        inventoryDwellTimeDays: input.profile.inventoryDwellTimeDays
      }
    ],
    sourceLineage: input.profile.sourceLineage
  });
}

export function calculateCandidateWarehouseCostFromSourceRows(input: {
  candidate: SupplyChainDesignWarehouseCostCandidateInput;
  sourceRows: SupplyChainDesignWarehouseCostSourceRowInput[];
  sourceLineage?: SupplyChainDesignWarehouseCostSourceLineage[];
}): SupplyChainDesignWarehouseCostResult {
  const annualAllInCost = firstFiniteNonNegative(input.candidate.annualFacilityWarehouseCost, input.candidate.annualFixedCost);
  const representedShipments = sum(input.sourceRows.map((row) => safeQuantity(row.representedShipments)));
  const representedPallets = sumNullable(input.sourceRows.map((row) => row.pallets));
  const sourceLineage = input.sourceLineage ?? input.sourceRows.map((row) => ({
    sourceRowId: row.sourceRowId,
    shipmentReference: row.shipmentReference,
    representedShipments: row.representedShipments
  }));

  if (annualAllInCost !== null) {
    return {
      facilityId: input.candidate.facilityId,
      facilitySourceType: "CANDIDATE",
      warehouseCostBasis: "ANNUAL_ALL_IN",
      status: "ANNUAL_ALL_IN",
      currency: input.candidate.currency,
      representedPallets,
      representedShipments,
      inboundCost: null,
      outboundCost: null,
      storageCost: null,
      knownSubtotal: 0,
      completeWarehouseCost: null,
      annualAllInCost,
      billableStorageMonths: null,
      billingEvidence: [],
      missingInputs: [],
      sourceLineage
    };
  }

  const billingEvidence = input.sourceRows.map((row) => calculateVariableRow(input.candidate, row));
  const missingInputs = unique(billingEvidence.flatMap((row) => row.missingInputs));
  const inboundCost = sumNullable(billingEvidence.map((row) => row.inboundCost));
  const outboundCost = sumNullable(billingEvidence.map((row) => row.outboundCost));
  const storageCost = sumNullable(billingEvidence.map((row) => row.storageCost));
  const knownSubtotal = sum(billingEvidence.map((row) => row.knownSubtotal));
  const completeWarehouseCost = missingInputs.length === 0 ? knownSubtotal : null;
  const billableStorageMonths = billingEvidence.length === 1 ? billingEvidence[0]?.billableStorageMonths ?? null : null;

  return {
    facilityId: input.candidate.facilityId,
    facilitySourceType: "CANDIDATE",
    warehouseCostBasis: "VARIABLE_3PL_RATES",
    status: missingInputs.length === 0 ? "COMPLETE" : "INCOMPLETE_VARIABLE_COST",
    currency: input.candidate.currency,
    representedPallets,
    representedShipments,
    inboundCost,
    outboundCost,
    storageCost,
    knownSubtotal,
    completeWarehouseCost,
    annualAllInCost: null,
    billableStorageMonths,
    billingEvidence,
    missingInputs,
    sourceLineage
  };
}

export function calculateCurrentFacilityWarehouseCostBasis(
  facility: SupplyChainDesignWarehouseCostCurrentFacilityInput
): SupplyChainDesignWarehouseCostResult {
  const annualAllInCost = firstFiniteNonNegative(facility.annualFacilityWarehouseCost);
  return {
    facilityId: facility.facilityId,
    facilitySourceType: "CURRENT",
    warehouseCostBasis: "ANNUAL_ALL_IN",
    status: annualAllInCost === null ? "INCOMPLETE_VARIABLE_COST" : "ANNUAL_ALL_IN",
    currency: facility.currency,
    representedPallets: null,
    representedShipments: 0,
    inboundCost: null,
    outboundCost: null,
    storageCost: null,
    knownSubtotal: 0,
    completeWarehouseCost: null,
    annualAllInCost,
    billableStorageMonths: null,
    billingEvidence: [],
    missingInputs: annualAllInCost === null ? ["annual_facility_warehouse_cost"] : [],
    sourceLineage: []
  };
}

function calculateVariableRow(
  candidate: SupplyChainDesignWarehouseCostCandidateInput,
  row: SupplyChainDesignWarehouseCostSourceRowInput
): SupplyChainDesignWarehouseCostBillingEvidence {
  const missingInputs: string[] = [];
  const pallets = validNonNegative(row.pallets) ? row.pallets : null;
  const inboundFee = validNonNegative(candidate.inboundFeePerPallet) ? candidate.inboundFeePerPallet : null;
  const outboundFee = validNonNegative(candidate.outboundFeePerPallet) ? candidate.outboundFeePerPallet : null;
  const storageFee = validNonNegative(candidate.storageFeePerPalletPerMonth) ? candidate.storageFeePerPalletPerMonth : null;
  const dwell = validNonNegative(row.inventoryDwellTimeDays) ? row.inventoryDwellTimeDays : null;

  if (pallets === null) missingInputs.push("pallets");
  if (inboundFee === null) missingInputs.push("inbound_fee_per_pallet");
  if (outboundFee === null) missingInputs.push("outbound_fee_per_pallet");
  if (storageFee === null) missingInputs.push("storage_fee_per_pallet_per_month");
  if (dwell === null) missingInputs.push("inventory_dwell_time_days");

  const billableStorageMonths = dwell === null ? null : calculateBillableStorageMonths(dwell);
  const inboundCost = pallets !== null && inboundFee !== null ? pallets * inboundFee : null;
  const outboundCost = pallets !== null && outboundFee !== null ? pallets * outboundFee : null;
  const storageCost = pallets !== null && storageFee !== null && billableStorageMonths !== null
    ? pallets * storageFee * billableStorageMonths
    : null;

  return {
    sourceRowId: row.sourceRowId,
    shipmentReference: row.shipmentReference,
    representedShipments: row.representedShipments,
    representedPallets: pallets,
    inventoryDwellTimeDays: dwell,
    billableStorageMonths,
    inboundCost,
    outboundCost,
    storageCost,
    knownSubtotal: sum([inboundCost, outboundCost, storageCost]),
    missingInputs
  };
}

function firstFiniteNonNegative(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (validNonNegative(value)) {
      return value;
    }
  }
  return null;
}

function validNonNegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeQuantity(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function sum(values: Array<number | null>) {
  return values.reduce<number>((total, value) => total + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0);
}

function sumNullable(values: Array<number | null>) {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length > 0 ? sum(finiteValues) : null;
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}
