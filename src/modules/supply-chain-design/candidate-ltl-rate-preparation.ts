import { createHash } from "node:crypto";
import { SupplyChainDesignTableType } from "@prisma/client";

import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import { getSourceColumn } from "@/modules/supply-chain-design/model-01-proof";
import { calculateLtlFreightClass } from "@/modules/ltl-rate-portal/freight-class";
import type { LtlFreightPiece, LtlQuoteRequest } from "@/modules/ltl-rate-portal/types";
import { normalizeSupplyChainDesignCandidateRatingOrigins } from "@/modules/supply-chain-design/rating-origins";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";

export const SCDS_LTL_RATE_PREPARATION_RESULT_VERSION = "SCDS_CANDIDATE_LTL_RATE_PREPARATION_V2";

export type SupplyChainDesignLtlRatePreparationInput = {
  tenantId: string;
  projectId: string;
  candidateFacilities: SupplyChainDesignPreparationMappedFile;
  shipments: SupplyChainDesignPreparationMappedFile;
};

export type SupplyChainDesignPreparationMappedFile = {
  fileId: string;
  mappingId: string;
  tableType: SupplyChainDesignTableType;
  fileName: string;
  fileBytes: Buffer;
  fieldMappings: SupplyChainDesignFieldMapping[];
};

export type SupplyChainDesignLtlPreparationStatus =
  | "Ready for rating"
  | "Missing data"
  | "Excluded - not LTL";

export type SupplyChainDesignLtlPreparedRequest = {
  rateRequestKey: string;
  candidateFacilityId: string;
  candidateFacilityName: string;
  originPostalCode: string;
  originCountry: string;
  originalFacilityId: string;
  historicalShipmentRowIds: string[];
  sourceRowCount: number;
  shipmentOrderReferences: string[];
  recordType: string;
  representedShipments: number;
  currentTransportationCost: number | null;
  currentTransportationCostPerShipment: number | null;
  destinationPostalCode: string;
  destinationCountry: string;
  representativePallets: number | null;
  representativeWeight: number | null;
  weightUnit: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string | null;
  hazardousMaterials: "Yes" | "No" | null;
  calculatedFreightClass: string | null;
  preparationStatus: SupplyChainDesignLtlPreparationStatus;
  missingDataReason: string | null;
  ratingAssumptions: string[];
  normalizedRequest: LtlQuoteRequest | null;
};

export type SupplyChainDesignLtlRatePreparationResultSummary = {
  resultVersion: typeof SCDS_LTL_RATE_PREPARATION_RESULT_VERSION;
  historicalRowsReviewed: number;
  candidateWarehouseCount: number;
  readyRequestCount: number;
  missingDataRequestCount: number;
  excludedNonLtlRowCount: number;
  duplicateRequestsConsolidated: number;
  preparedRequests: SupplyChainDesignLtlPreparedRequest[];
  sourceRowOutcomes: SupplyChainDesignLtlSourceRowOutcome[];
  assumptions: string[];
};

export type SupplyChainDesignLtlSourceRowOutcome = {
  sourceRowId: string;
  shipmentOrderReference: string;
  recordType: string;
  transportationMode: string;
  representedShipments: number;
  destination: string;
  pallets: number | null;
  weight: number | null;
  weightUnit: string;
  dimensions: string;
  status: "Prepared" | "Excluded" | "Missing data";
  reason: string;
};

type MappedRows = {
  rows: string[][];
  columnIndexes: Map<string, number>;
};

type CandidateFacility = {
  candidateFacilityId: string;
  candidateFacilityName: string;
  originPostalCode: string;
  originCountry: "US" | "CA" | "MX";
};

export function prepareSupplyChainDesignCandidateLtlRateRequests(
  input: SupplyChainDesignLtlRatePreparationInput
): SupplyChainDesignLtlRatePreparationResultSummary {
  const candidates = readCandidateFacilities(input.candidateFacilities);
  const shipments = readMappedRows(input.shipments, ["origin_facility_id"]);
  const preparedByKey = new Map<string, SupplyChainDesignLtlPreparedRequest>();
  const sourceRowOutcomes: SupplyChainDesignLtlSourceRowOutcome[] = [];
  let excludedNonLtlRowCount = 0;
  let duplicateRequestsConsolidated = 0;

  shipments.rows.forEach((row, index) => {
    const sourceRowId = `${input.shipments.fileId}:row-${index + 2}`;
    const source = readShipmentRow(row, shipments.columnIndexes, sourceRowId);

    if (!isLtlMode(source.mode)) {
      excludedNonLtlRowCount += 1;
      sourceRowOutcomes.push(toSourceRowOutcome(source, "Excluded", "Transportation Mode is not LTL."));
      return;
    }

    for (const candidate of candidates) {
      const request = prepareOneRequest({
        tenantId: input.tenantId,
        projectId: input.projectId,
        candidate,
        source
      });

      const existing = preparedByKey.get(request.rateRequestKey);
      if (existing) {
        duplicateRequestsConsolidated += 1;
        existing.historicalShipmentRowIds.push(...request.historicalShipmentRowIds);
        existing.sourceRowCount += request.sourceRowCount;
        existing.representedShipments = roundQuantity(existing.representedShipments + request.representedShipments);
        for (const reference of request.shipmentOrderReferences) {
          if (reference && !existing.shipmentOrderReferences.includes(reference)) {
            existing.shipmentOrderReferences.push(reference);
          }
        }
        continue;
      }

      preparedByKey.set(request.rateRequestKey, request);
    }

    sourceRowOutcomes.push(toSourceRowOutcome(source, "Prepared", "LTL row prepared once for each candidate warehouse."));
  });

  const preparedRequests = [...preparedByKey.values()].sort((left, right) =>
    left.rateRequestKey.localeCompare(right.rateRequestKey)
  );

  return {
    resultVersion: SCDS_LTL_RATE_PREPARATION_RESULT_VERSION,
    historicalRowsReviewed: shipments.rows.length,
    candidateWarehouseCount: candidates.length,
    readyRequestCount: preparedRequests.filter((request) => request.preparationStatus === "Ready for rating").length,
    missingDataRequestCount: preparedRequests.filter((request) => request.preparationStatus === "Missing data").length,
    excludedNonLtlRowCount,
    duplicateRequestsConsolidated,
    preparedRequests,
    sourceRowOutcomes,
    assumptions: [
      "No live 7L request was made.",
      "Historical origin is replaced by the selected candidate warehouse origin.",
      "No optional accessorials are requested in this preparation stage.",
      "Stackability is set to the integration-compatible non-stackable value internally."
    ]
  };
}

export function toSupplyChainDesignNetworkScenarioPreparedProfiles(
  preparedRequests: SupplyChainDesignLtlPreparedRequest[]
) {
  const profilesBySource = new Map<string, SupplyChainDesignLtlPreparedRequest>();
  for (const request of preparedRequests) {
    const sourceKey = networkScenarioProfileSourceKey(request);
    const existing = profilesBySource.get(sourceKey);
    if (!existing || request.rateRequestKey.localeCompare(existing.rateRequestKey) < 0) {
      profilesBySource.set(sourceKey, {
        ...request,
        rateRequestKey: buildNetworkScenarioProfileKey(request)
      });
    }
  }
  return [...profilesBySource.values()].sort((left, right) => left.rateRequestKey.localeCompare(right.rateRequestKey));
}

function networkScenarioProfileSourceKey(request: SupplyChainDesignLtlPreparedRequest) {
  return [
    request.historicalShipmentRowIds.join("|"),
    request.shipmentOrderReferences.join("|"),
    request.destinationPostalCode,
    request.destinationCountry,
    request.recordType,
    request.representedShipments
  ].join("::");
}

function buildNetworkScenarioProfileKey(request: SupplyChainDesignLtlPreparedRequest) {
  return `scenario-profile:${createHash("sha256").update(networkScenarioProfileSourceKey(request)).digest("hex").slice(0, 16)}`;
}

function toSourceRowOutcome(
  source: ShipmentSourceRow,
  status: SupplyChainDesignLtlSourceRowOutcome["status"],
  reason: string
): SupplyChainDesignLtlSourceRowOutcome {
  return {
    sourceRowId: source.sourceRowId,
    shipmentOrderReference: source.shipmentOrderReference,
    recordType: source.recordType,
    transportationMode: source.mode,
    representedShipments: source.recordType === "Aggregated Activity" ? source.shipmentQuantity ?? 0 : 1,
    destination: `${source.destinationPostalCode} ${source.destinationCountry ?? ""}`.trim(),
    pallets: source.pallets,
    weight: source.weight,
    weightUnit: source.weightUnit,
    dimensions:
      source.length !== null && source.width !== null && source.height !== null
        ? `${source.length} x ${source.width} x ${source.height} ${source.dimensionUnit}`.trim()
        : "",
    status,
    reason
  };
}

function prepareOneRequest({
  tenantId,
  projectId,
  candidate,
  source
}: {
  tenantId: string;
  projectId: string;
  candidate: CandidateFacility;
  source: ShipmentSourceRow;
}): SupplyChainDesignLtlPreparedRequest {
  const statusProblems: string[] = [];

  if (!isLtlMode(source.mode)) {
    return basePreparedRequest(candidate, source, "Excluded - not LTL", "Transportation Mode is not LTL.", null, null);
  }

  const representedShipments = resolveRepresentedShipments(source, statusProblems);
  const representativeWeight = resolveRepresentativeWeight(source, representedShipments, statusProblems);
  const representativePallets = resolveRepresentativePallets(source, representedShipments, statusProblems);
  const weightUnit = normalizeWeightUnit(source.weightUnit, source.weight, statusProblems);
  const dimensionUnit = normalizeDimensionUnit(source.dimensionUnit, source.length, source.width, source.height, statusProblems);
  const hazardousMaterials = normalizeHazmat(source.hazardousMaterials, statusProblems);
  const dimensions = normalizeDimensions(source, statusProblems);

  if (hazardousMaterials === "Yes") {
    statusProblems.push("hazardous shipment requires additional information");
  }
  if (representativePallets === null || !Number.isFinite(representativePallets) || representativePallets <= 0) {
    statusProblems.push("Pallets must be greater than zero for freight class calculation");
  }

  if (!source.destinationPostalCode) {
    statusProblems.push("Destination ZIP / Postal Code is missing");
  }
  if (!source.destinationCountry) {
    statusProblems.push("Destination Country is missing");
  }

  const freightClass =
    statusProblems.length === 0 && representativeWeight !== null && dimensions
      ? calculateFreightClass({
          weight: representativeWeight,
          weightUnit: weightUnit!,
          quantity: representativePallets!,
          length: dimensions.length,
          width: dimensions.width,
          height: dimensions.height,
          dimensionUnit: dimensionUnit!
        })
      : null;

  if (statusProblems.length === 0 && !freightClass) {
    statusProblems.push("freight class could not be calculated from the supplied dimensions and weight");
  }

  const piece: LtlFreightPiece | null =
    statusProblems.length === 0 && representativeWeight !== null && dimensions && freightClass
      ? {
          qty: representativePallets!,
          weight: representativeWeight,
          weightType: "total",
          length: dimensions.length,
          width: dimensions.width,
          height: dimensions.height,
          dimType: "PLT",
          freightClass,
          hazmat: false,
          stack: false
        }
      : null;

  const normalizedRequest: LtlQuoteRequest | null =
    piece && source.destinationCountry
      ? {
          customerReference: source.shipmentOrderReference || source.sourceRowId,
          originCity: "",
          originState: "",
          originZipcode: candidate.originPostalCode,
          originCountry: candidate.originCountry,
          destinationCity: "",
          destinationState: "",
          destinationZipcode: source.destinationPostalCode,
          destinationCountry: source.destinationCountry,
          pickupDate: "Not scheduled",
          uom: weightUnit === "kg" || dimensionUnit === "cm" ? "METRIC" : "US",
          accessorialCodes: [],
          pieces: [piece]
        }
      : null;

  const requestKey = buildRateRequestKey({
    tenantId,
    projectId,
    candidate,
    source,
    representedShipments,
    currentTransportationCost: resolveCurrentTransportationCost(source, representedShipments),
    currentTransportationCostPerShipment: resolveCurrentTransportationCostPerShipment(source, representedShipments),
    representativePallets,
    representativeWeight,
    weightUnit,
    dimensions,
    dimensionUnit,
    hazardousMaterials,
    freightClass
  });

  return {
    ...basePreparedRequest(
      candidate,
      source,
      statusProblems.length > 0 ? "Missing data" : "Ready for rating",
      statusProblems.length > 0 ? statusProblems.join("; ") : null,
      freightClass,
      normalizedRequest
    ),
    rateRequestKey: requestKey,
    representedShipments,
    currentTransportationCost: resolveCurrentTransportationCost(source, representedShipments),
    currentTransportationCostPerShipment: resolveCurrentTransportationCostPerShipment(source, representedShipments),
    representativePallets,
    representativeWeight,
    weightUnit,
    length: dimensions?.length ?? null,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    dimensionUnit,
    hazardousMaterials,
    ratingAssumptions: [
      source.recordType === "Aggregated Activity"
        ? "Aggregated Activity uses representative per-shipment weight and dimensions; total shipments are retained for annualization."
        : "Individual Shipment represents one shipment.",
      "No optional accessorials requested.",
      "Stackability is set internally to non-stackable."
    ]
  };
}

function basePreparedRequest(
  candidate: CandidateFacility,
  source: ShipmentSourceRow,
  preparationStatus: SupplyChainDesignLtlPreparationStatus,
  missingDataReason: string | null,
  calculatedFreightClass: string | null,
  normalizedRequest: LtlQuoteRequest | null
): SupplyChainDesignLtlPreparedRequest {
  return {
    rateRequestKey: `${candidate.candidateFacilityId}:${source.sourceRowId}:${preparationStatus}`,
    candidateFacilityId: candidate.candidateFacilityId,
    candidateFacilityName: candidate.candidateFacilityName,
    originPostalCode: candidate.originPostalCode,
    originCountry: candidate.originCountry,
    originalFacilityId: source.originFacilityId,
    historicalShipmentRowIds: [source.sourceRowId],
    sourceRowCount: 1,
    shipmentOrderReferences: source.shipmentOrderReference ? [source.shipmentOrderReference] : [],
    recordType: source.recordType,
    representedShipments: source.recordType === "Aggregated Activity" ? source.shipmentQuantity ?? 0 : 1,
    currentTransportationCost: null,
    currentTransportationCostPerShipment: null,
    destinationPostalCode: source.destinationPostalCode,
    destinationCountry: source.destinationCountry ?? "",
    representativePallets: null,
    representativeWeight: null,
    weightUnit: null,
    length: null,
    width: null,
    height: null,
    dimensionUnit: null,
    hazardousMaterials: null,
    calculatedFreightClass,
    preparationStatus,
    missingDataReason,
    ratingAssumptions: [],
    normalizedRequest
  };
}

function resolveCurrentTransportationCost(source: ShipmentSourceRow, representedShipments: number) {
  if (source.transportationCost === null) {
    return null;
  }
  return roundQuantity(source.transportationCost);
}

function resolveCurrentTransportationCostPerShipment(source: ShipmentSourceRow, representedShipments: number) {
  if (source.transportationCost === null) {
    return null;
  }
  const divisor = source.recordType === "Aggregated Activity" ? representedShipments : 1;
  return divisor > 0 ? roundQuantity(source.transportationCost / divisor) : null;
}

type ShipmentSourceRow = {
  sourceRowId: string;
  shipmentOrderReference: string;
  recordType: "Individual Shipment" | "Aggregated Activity";
  shipmentQuantity: number | null;
  originFacilityId: string;
  destinationPostalCode: string;
  destinationCountry: "US" | "CA" | "MX" | null;
  pallets: number | null;
  weight: number | null;
  weightUnit: string;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string;
  hazardousMaterials: string;
  mode: string;
  transportationCost: number | null;
};

function readShipmentRow(row: string[], columns: Map<string, number>, sourceRowId: string): ShipmentSourceRow {
  return {
    sourceRowId,
    shipmentOrderReference: valueAt(row, columns, "shipment_id") || valueAt(row, columns, "shipment_reference"),
    recordType: normalizeRecordType(valueAt(row, columns, "record_type")),
    shipmentQuantity: parseOptionalNumber(valueAt(row, columns, "shipment_quantity")),
    originFacilityId: valueAt(row, columns, "origin_facility_id"),
    destinationPostalCode: valueAt(row, columns, "postal_or_region_code"),
    destinationCountry: normalizeCountry(valueAt(row, columns, "country")),
    pallets: parseOptionalNumber(valueAt(row, columns, "pallets")),
    weight: parseOptionalNumber(valueAt(row, columns, "weight")),
    weightUnit: valueAt(row, columns, "weight_unit"),
    length: parseOptionalNumber(valueAt(row, columns, "length")),
    width: parseOptionalNumber(valueAt(row, columns, "width")),
    height: parseOptionalNumber(valueAt(row, columns, "height")),
    dimensionUnit: valueAt(row, columns, "dimension_unit"),
    hazardousMaterials: valueAt(row, columns, "hazardous_materials"),
    mode: valueAt(row, columns, "mode"),
    transportationCost: parseOptionalCurrencyNumber(valueAt(row, columns, "transportation_cost"))
  };
}

function readCandidateFacilities(file: SupplyChainDesignPreparationMappedFile): CandidateFacility[] {
  const result = normalizeSupplyChainDesignCandidateRatingOrigins(file);
  if (result.issues.length > 0) {
    const firstIssue = result.issues[0];
    throw new Error(`Candidate Warehouses row ${firstIssue.sourceRowNumber}: ${firstIssue.reason}`);
  }
  return result.origins.map((origin) => ({
    candidateFacilityId: origin.facilityId,
    candidateFacilityName: origin.facilityName,
    originPostalCode: origin.postalCode,
    originCountry: origin.country
  }));
}

function readMappedRows(file: SupplyChainDesignPreparationMappedFile, requiredFields: string[]): MappedRows {
  const rows = parseCsvRows(file.fileBytes.toString("utf8"));
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const columnIndexes = new Map<string, number>();

  for (const field of file.fieldMappings) {
    if (!field.sourceColumn) {
      continue;
    }
    const index = headers.findIndex((header) => normalizeHeader(header) === normalizeHeader(field.sourceColumn!));
    if (index >= 0) {
      columnIndexes.set(field.standardField, index);
    }
  }

  const missing = requiredFields.filter((field) => !getSourceColumn(file.fieldMappings, field) || !columnIndexes.has(field));
  if (missing.length > 0) {
    throw new Error(`${file.tableType} mapping is missing required field(s): ${missing.join(", ")}.`);
  }

  return { rows: dataRows, columnIndexes };
}

function valueAt(row: string[], columnIndexes: Map<string, number>, standardField: string) {
  const index = columnIndexes.get(standardField);
  return typeof index === "number" ? (row[index] ?? "").trim() : "";
}

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim();
}

function normalizeRecordType(value: string): ShipmentSourceRow["recordType"] {
  return value.trim().toLowerCase() === "aggregated activity" ? "Aggregated Activity" : "Individual Shipment";
}

function isLtlMode(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return normalized === "ltl" || normalized === "less than truckload";
}

function normalizeCountry(value: string): "US" | "CA" | "MX" | null {
  const normalized = value.trim().toUpperCase();
  if (["US", "USA", "UNITED STATES"].includes(normalized)) return "US";
  if (["CA", "CAN", "CANADA"].includes(normalized)) return "CA";
  if (["MX", "MEX", "MEXICO"].includes(normalized)) return "MX";
  return null;
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalCurrencyNumber(value: string) {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value.replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveRepresentedShipments(source: ShipmentSourceRow, problems: string[]) {
  if (source.recordType === "Individual Shipment") {
    return 1;
  }
  if (source.shipmentQuantity === null || source.shipmentQuantity <= 0) {
    problems.push("Aggregated Activity requires Shipments greater than zero");
    return 0;
  }
  return source.shipmentQuantity;
}

function resolveRepresentativeWeight(source: ShipmentSourceRow, representedShipments: number, problems: string[]) {
  if (source.weight === null || source.weight <= 0) {
    problems.push("Weight is missing or invalid");
    return null;
  }
  if (source.recordType === "Aggregated Activity") {
    if (representedShipments <= 0) {
      return null;
    }
    return source.weight / representedShipments;
  }
  return source.weight;
}

function resolveRepresentativePallets(source: ShipmentSourceRow, representedShipments: number, problems: string[]) {
  if (source.pallets === null) {
    return null;
  }
  if (source.pallets < 0) {
    problems.push("Pallets cannot be negative");
    return null;
  }
  if (source.recordType === "Aggregated Activity") {
    if (representedShipments <= 0) {
      return null;
    }
    return source.pallets / representedShipments;
  }
  return source.pallets;
}

function normalizeWeightUnit(value: string, weight: number | null, problems: string[]) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    if (weight !== null) {
      problems.push("Weight Unit is required when Weight is supplied");
    }
    return null;
  }
  if (["lb", "lbs", "pound", "pounds"].includes(normalized)) return "lb";
  if (["kg", "kgs", "kilogram", "kilograms"].includes(normalized)) return "kg";
  problems.push(`Weight Unit "${value}" is not supported`);
  return null;
}

function normalizeDimensionUnit(value: string, length: number | null, width: number | null, height: number | null, problems: string[]) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    if ([length, width, height].some((item) => item !== null)) {
      problems.push("Dimension Unit is required when dimensions are supplied");
    }
    return null;
  }
  if (["in", "inch", "inches"].includes(normalized)) return "in";
  if (["cm", "centimeter", "centimeters"].includes(normalized)) return "cm";
  problems.push(`Dimension Unit "${value}" is not supported`);
  return null;
}

function normalizeDimensions(source: ShipmentSourceRow, problems: string[]) {
  if (source.length === null || source.width === null || source.height === null) {
    problems.push("Length, Width and Height are required");
    return null;
  }
  if (source.length <= 0 || source.width <= 0 || source.height <= 0) {
    problems.push("Length, Width and Height must be greater than zero");
    return null;
  }
  return {
    length: source.length,
    width: source.width,
    height: source.height
  };
}

function normalizeHazmat(value: string, problems: string[]): "Yes" | "No" | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    problems.push("Hazardous Materials must be Yes or No");
    return null;
  }
  if (normalized === "yes") return "Yes";
  if (normalized === "no") return "No";
  problems.push("Hazardous Materials must be Yes or No");
  return null;
}

export function calculateFreightClass({
  weight,
  weightUnit,
  quantity = 1,
  length,
  width,
  height,
  dimensionUnit
}: {
  weight: number;
  weightUnit: string;
  quantity?: number;
  length: number;
  width: number;
  height: number;
  dimensionUnit: string;
}) {
  const result = calculateLtlFreightClass({
    totalWeight: weight,
    weightUnit,
    quantity,
    length,
    width,
    height,
    dimensionUnit
  });
  return result.ok ? result.freightClass : null;
}

function buildRateRequestKey(input: {
  tenantId: string;
  projectId: string;
  candidate: CandidateFacility;
  source: ShipmentSourceRow;
  representedShipments: number;
  representativePallets: number | null;
  representativeWeight: number | null;
  weightUnit: string | null;
  dimensions: { length: number; width: number; height: number } | null;
  dimensionUnit: string | null;
  hazardousMaterials: "Yes" | "No" | null;
  freightClass: string | null;
}) {
  const identity = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    candidateFacilityId: input.candidate.candidateFacilityId,
    originPostalCode: input.candidate.originPostalCode.toUpperCase(),
    originCountry: input.candidate.originCountry,
    destinationPostalCode: input.source.destinationPostalCode.toUpperCase(),
    destinationCountry: input.source.destinationCountry,
    representativePallets: input.representativePallets,
    representativeWeight: input.representativeWeight,
    weightUnit: input.weightUnit,
    dimensions: input.dimensions,
    dimensionUnit: input.dimensionUnit,
    hazardousMaterials: input.hazardousMaterials,
    freightClass: input.freightClass
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function roundQuantity(value: number) {
  return Math.round(value * 1000000) / 1000000;
}
