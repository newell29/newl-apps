import { createHash } from "node:crypto";
import { SupplyChainDesignTableType } from "@prisma/client";

import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import { getSourceColumn } from "@/modules/supply-chain-design/model-01-proof";
import type { LtlFreightPiece, LtlQuoteRequest } from "@/modules/ltl-rate-portal/types";
import { normalizeSupplyChainDesignCandidateRatingOrigins } from "@/modules/supply-chain-design/rating-origins";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";
import { normalizeSupplyChainDesignWeightUnit } from "@/modules/supply-chain-design/weight-units";
import {
  normalizeSupplyChainDesignDimensionUnit,
  normalizeSupplyChainDesignLtlPhysicalProfile
} from "@/modules/supply-chain-design/ltl-physical-normalization";
import {
  normalizeSupplyChainDesignMoney,
  type SupplyChainDesignCurrencyContext
} from "@/modules/supply-chain-design/currency";

export const SCDS_LTL_RATE_PREPARATION_RESULT_VERSION = "SCDS_CANDIDATE_LTL_RATE_PREPARATION_V5";

export type SupplyChainDesignLtlRatePreparationInput = {
  tenantId: string;
  projectId: string;
  candidateFacilities: SupplyChainDesignPreparationMappedFile;
  shipments: SupplyChainDesignPreparationMappedFile;
  currencyContext?: SupplyChainDesignCurrencyContext | null;
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
  originalOriginPostalCode: string | null;
  originalFacilityId: string;
  historicalShipmentRowIds: string[];
  sourceRowCount: number;
  shipmentOrderReferences: string[];
  recordType: "Individual Shipment" | "Aggregated Activity";
  representedShipments: number;
  currentTransportationCost: number | null;
  currentTransportationCostPerShipment: number | null;
  currentTransportationCostCurrency: string | null;
  destinationPostalCode: string;
  destinationCountry: string;
  representativePallets: number | null;
  representativeWeight: number | null;
  weightUnit: string | null;
  inventoryDwellTimeDays: number | null;
  warehouseCostSourceRows: SupplyChainDesignLtlWarehouseCostSourceRow[];
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

export type SupplyChainDesignLtlWarehouseCostSourceRow = {
  sourceRowId: string;
  shipmentReference: string;
  representedShipments: number;
  pallets: number | null;
  inventoryDwellTimeDays: number | null;
};

export type SupplyChainDesignLtlRatePreparationResultSummary = {
  resultVersion: typeof SCDS_LTL_RATE_PREPARATION_RESULT_VERSION;
  historicalRowsReviewed: number;
  totalHistoricalShipmentsRepresented: number;
  ltlShipmentsRepresented: number;
  parcelShipmentsRepresented: number;
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
  recordType: "Individual Shipment" | "Aggregated Activity";
  shipmentOrderReference: string;
  transportationMode: string;
  representedShipments: number;
  destination: string;
  pallets: number | null;
  weight: number | null;
  weightUnit: string;
  inventoryDwellTimeDays: number | null;
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
  const currencyContext = input.currencyContext ?? null;
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
      const requests = prepareRequestsForSource({
    tenantId: input.tenantId,
        projectId: input.projectId,
        candidate,
        source,
        currencyContext
      });

      for (const request of requests) {
        const existing = preparedByKey.get(request.rateRequestKey);
        if (existing) {
          duplicateRequestsConsolidated += 1;
          existing.historicalShipmentRowIds.push(...request.historicalShipmentRowIds);
          existing.sourceRowCount += request.sourceRowCount;
          existing.representedShipments = roundQuantity(existing.representedShipments + request.representedShipments);
          existing.currentTransportationCost = combineNullableSums(existing.currentTransportationCost, request.currentTransportationCost);
          existing.currentTransportationCostPerShipment =
            existing.currentTransportationCost === null
              ? null
              : roundQuantity(existing.currentTransportationCost / existing.representedShipments);
          existing.currentTransportationCostCurrency = request.currentTransportationCostCurrency;
          existing.warehouseCostSourceRows.push(...request.warehouseCostSourceRows);
          for (const reference of request.shipmentOrderReferences) {
            if (reference && !existing.shipmentOrderReferences.includes(reference)) {
              existing.shipmentOrderReferences.push(reference);
            }
          }
          continue;
        }

        preparedByKey.set(request.rateRequestKey, request);
      }
    }

    sourceRowOutcomes.push(toSourceRowOutcome(source, "Prepared", "LTL row prepared once for each candidate warehouse."));
  });

  const preparedRequests = [...preparedByKey.values()].sort((left, right) =>
    left.rateRequestKey.localeCompare(right.rateRequestKey)
  );
  const totalHistoricalShipmentsRepresented = sourceRowOutcomes.reduce(
    (sum, outcome) => sum + outcome.representedShipments,
    0
  );
  const ltlShipmentsRepresented = sourceRowOutcomes
    .filter((outcome) => isLtlMode(outcome.transportationMode))
    .reduce((sum, outcome) => sum + outcome.representedShipments, 0);
  const parcelShipmentsRepresented = sourceRowOutcomes
    .filter((outcome) => isParcelMode(outcome.transportationMode))
    .reduce((sum, outcome) => sum + outcome.representedShipments, 0);

  return {
    resultVersion: SCDS_LTL_RATE_PREPARATION_RESULT_VERSION,
    historicalRowsReviewed: shipments.rows.length,
    totalHistoricalShipmentsRepresented,
    ltlShipmentsRepresented,
    parcelShipmentsRepresented,
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
      "Historical row totals are split into deterministic whole-pallet shipment profiles for LTL rating.",
      "Parcel transportation rating is deferred to a future UPS integration.",
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
    request.representedShipments,
    request.representativePallets,
    request.representativeWeight
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
    transportationMode: source.mode,
    recordType: source.recordType,
    representedShipments: source.recordType === "Individual Shipment" ? 1 : source.shipmentQuantity ?? 0,
    destination: `${source.destinationPostalCode} ${source.destinationCountry ?? ""}`.trim(),
    pallets: source.pallets,
    weight: source.weight,
    weightUnit: source.weightUnit,
    inventoryDwellTimeDays: source.inventoryDwellTimeDays,
    dimensions:
      source.length !== null && source.width !== null && source.height !== null
        ? `${source.length} x ${source.width} x ${source.height} ${source.dimensionUnit}`.trim()
        : "",
    status,
    reason
  };
}

function prepareRequestsForSource({
  tenantId,
  projectId,
  candidate,
  source,
  currencyContext
}: {
  tenantId: string;
  projectId: string;
  candidate: CandidateFacility;
  source: ShipmentSourceRow;
  currencyContext: SupplyChainDesignCurrencyContext | null;
}): SupplyChainDesignLtlPreparedRequest[] {
  const statusProblems: string[] = [];

  if (!isLtlMode(source.mode)) {
    return [basePreparedRequest(candidate, source, "Excluded - not LTL", "Transportation Mode is not LTL.", null, null)];
  }

  const representedShipments = resolveRepresentedShipments(source, statusProblems);
  const derivedProfiles = deriveWholeShipmentProfiles(source, representedShipments, statusProblems);
  const weightUnit = normalizeWeightUnit(source.weightUnit, source.weight, statusProblems);
  const dimensionUnit = normalizeDimensionUnit(source.dimensionUnit, source.length, source.width, source.height, statusProblems);
  const hazardousMaterials = normalizeHazmat(source.hazardousMaterials, statusProblems);
  const dimensions = normalizeDimensions(source, statusProblems);

  if (hazardousMaterials === "Yes") {
    statusProblems.push("hazardous shipment requires additional information");
  }
  if (!source.destinationPostalCode) {
    statusProblems.push("Destination ZIP / Postal Code is missing");
  }
  if (!source.destinationCountry) {
    statusProblems.push("Destination Country is missing");
  }

  if (statusProblems.length > 0) {
    return [
      basePreparedRequest(
        candidate,
        source,
        "Missing data",
        statusProblems.join("; "),
        null,
        null
      )
    ];
  }

  return derivedProfiles.map((profile) => {
    const physicalProfile = normalizeSupplyChainDesignLtlPhysicalProfile({
      pallets: profile.representativePallets,
      weight: profile.representativeWeight,
      weightUnit: weightUnit!,
      length: dimensions!.length,
      width: dimensions!.width,
      height: dimensions!.height,
      dimensionUnit: dimensionUnit!
    });
    const freightClass = physicalProfile?.freightClass ?? null;

    const requestProblems = freightClass ? [] : ["freight class could not be calculated from the supplied dimensions and weight"];
    const piece: LtlFreightPiece | null =
      requestProblems.length === 0 && physicalProfile ? physicalProfile.piece : null;

    const normalizedRequest: LtlQuoteRequest | null =
      piece && source.destinationCountry
        ? {
            customerReference: `${source.shipmentOrderReference || source.sourceRowId}:profile-${profile.profileNumber}`,
            originCity: "",
            originState: "",
            originZipcode: candidate.originPostalCode,
            originCountry: candidate.originCountry,
            destinationCity: "",
            destinationState: "",
            destinationZipcode: source.destinationPostalCode,
            destinationCountry: source.destinationCountry,
            pickupDate: "Not scheduled",
            uom: "US",
            accessorialCodes: [],
            pieces: [piece]
          }
        : null;

    const currentCostPerShipment = resolveCurrentTransportationCostPerShipment(source, representedShipments, currencyContext);
    const currentTransportationCost =
      currentCostPerShipment === null ? null : roundQuantity(currentCostPerShipment * profile.representedShipments);
    const requestKey = buildRateRequestKey({
      tenantId,
      projectId,
      candidate,
      source,
      representedShipments: profile.representedShipments,
      currentTransportationCost,
      currentTransportationCostPerShipment: currentCostPerShipment,
      currentTransportationCostCurrency: currencyContext?.analysisCurrency ?? source.transportationCostCurrency,
      representativePallets: profile.representativePallets,
      representativeWeight: physicalProfile?.weightLb ?? null,
      weightUnit: physicalProfile ? "lb" : null,
      dimensions: physicalProfile
        ? {
            length: physicalProfile.lengthIn,
            width: physicalProfile.widthIn,
            height: physicalProfile.heightIn
          }
        : null,
      dimensionUnit: physicalProfile ? "in" : null,
      hazardousMaterials,
      freightClass
    });

    return {
      ...basePreparedRequest(
        candidate,
        source,
        requestProblems.length > 0 ? "Missing data" : "Ready for rating",
        requestProblems.length > 0 ? requestProblems.join("; ") : null,
        freightClass,
        normalizedRequest
      ),
      rateRequestKey: requestKey,
      representedShipments: profile.representedShipments,
      currentTransportationCost,
      currentTransportationCostPerShipment: currentCostPerShipment,
      currentTransportationCostCurrency: currencyContext?.analysisCurrency ?? source.transportationCostCurrency,
      representativePallets: profile.representativePallets,
      representativeWeight: physicalProfile?.weightLb ?? null,
      weightUnit: physicalProfile ? "lb" : null,
      inventoryDwellTimeDays: source.inventoryDwellTimeDays,
      warehouseCostSourceRows: [{
        sourceRowId: source.sourceRowId,
        shipmentReference: source.shipmentOrderReference,
        representedShipments: profile.representedShipments,
        pallets: profile.representativePallets * profile.representedShipments,
        inventoryDwellTimeDays: source.inventoryDwellTimeDays
      }],
      length: physicalProfile?.lengthIn ?? null,
      width: physicalProfile?.widthIn ?? null,
      height: physicalProfile?.heightIn ?? null,
      dimensionUnit: physicalProfile ? "in" : null,
      hazardousMaterials,
      ratingAssumptions: [
        "7L rating uses normalized physical values in pounds, inches, and UOM US.",
        "Historical row totals are split into deterministic whole-pallet shipment profiles for LTL rating.",
        "Parcel transportation rating is deferred to a future UPS integration.",
        "No optional accessorials requested.",
        "Stackability is set internally to non-stackable."
      ]
    };
  });
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
    originalOriginPostalCode: null,
    originalFacilityId: source.originFacilityId,
    historicalShipmentRowIds: [source.sourceRowId],
    sourceRowCount: 1,
    shipmentOrderReferences: source.shipmentOrderReference ? [source.shipmentOrderReference] : [],
    recordType: source.recordType,
    representedShipments: source.recordType === "Individual Shipment" ? 1 : source.shipmentQuantity ?? 0,
    currentTransportationCost: null,
    currentTransportationCostPerShipment: null,
    currentTransportationCostCurrency: null,
    destinationPostalCode: source.destinationPostalCode,
    destinationCountry: source.destinationCountry ?? "",
    representativePallets: null,
    representativeWeight: null,
    weightUnit: null,
    inventoryDwellTimeDays: source.inventoryDwellTimeDays,
    warehouseCostSourceRows: [{
      sourceRowId: source.sourceRowId,
      shipmentReference: source.shipmentOrderReference,
      representedShipments: source.recordType === "Individual Shipment" ? 1 : source.shipmentQuantity ?? 0,
      pallets: source.pallets,
      inventoryDwellTimeDays: source.inventoryDwellTimeDays
    }],
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

function resolveCurrentTransportationCostPerShipment(
  source: ShipmentSourceRow,
  representedShipments: number,
  currencyContext: SupplyChainDesignCurrencyContext | null
) {
  if (source.transportationCost === null) {
    return null;
  }
  if (!currencyContext) return representedShipments > 0 ? source.transportationCost / representedShipments : null;
  const normalized = normalizeSupplyChainDesignMoney(
    source.transportationCost,
    source.transportationCostCurrency,
    currencyContext,
    `Historical shipment ${source.shipmentOrderReference || source.sourceRowId} transportation cost`
  );
  return representedShipments > 0 ? roundQuantity(normalized.normalizedAmount / representedShipments) : null;
}

type ShipmentSourceRow = {
  sourceRowId: string;
  recordType: "Individual Shipment" | "Aggregated Activity";
  shipmentOrderReference: string;
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
  transportationCostCurrency: string | null;
  inventoryDwellTimeDays: number | null;
};

function readShipmentRow(row: string[], columns: Map<string, number>, sourceRowId: string): ShipmentSourceRow {
  return {
    sourceRowId,
    recordType: normalizeRecordType(valueAt(row, columns, "record_type")),
    shipmentOrderReference: valueAt(row, columns, "shipment_id") || valueAt(row, columns, "shipment_reference"),
    shipmentQuantity: parseOptionalInteger(valueAt(row, columns, "shipment_quantity")),
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
    transportationCost: parseOptionalCurrencyNumber(valueAt(row, columns, "transportation_cost")),
    transportationCostCurrency: valueAt(row, columns, "transportation_cost_currency") || valueAt(row, columns, "currency") || null,
    inventoryDwellTimeDays: parseOptionalNumber(valueAt(row, columns, "inventory_dwell_time_days"))
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

function isLtlMode(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return normalized === "ltl" || normalized === "less than truckload";
}

function isParcelMode(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  // TODO: route parcel rows through a future UPS integration instead of 7L.
  return normalized === "parcel" || normalized === "small parcel";
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

function parseOptionalInteger(value: string) {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isInteger(parsed) ? parsed : null;
}

function parseOptionalCurrencyNumber(value: string) {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value.replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRecordType(value: string): ShipmentSourceRow["recordType"] {
  return value.trim().toLowerCase() === "aggregated activity" ? "Aggregated Activity" : "Individual Shipment";
}

function resolveRepresentedShipments(source: ShipmentSourceRow, problems: string[]) {
  if (source.recordType === "Individual Shipment") return 1;
  if (source.shipmentQuantity === null || source.shipmentQuantity <= 0) {
    problems.push("Shipments Represented must be a positive whole number");
    return 0;
  }
  return source.shipmentQuantity;
}

type DerivedShipmentProfile = {
  profileNumber: number;
  representedShipments: number;
  representativePallets: number;
  representativeWeight: number;
};

function deriveWholeShipmentProfiles(source: ShipmentSourceRow, representedShipments: number, problems: string[]) {
  if (source.weight === null || source.weight <= 0) {
    problems.push("Weight Total is missing or invalid");
    return [];
  }
  if (source.pallets === null) {
    problems.push("Pallets Total is missing");
    return [];
  }
  if (!Number.isInteger(source.pallets) || source.pallets <= 0) {
    problems.push("Pallets Total must be a positive whole number");
    return [];
  }
  if (representedShipments <= 0) {
    return [];
  }

  const base = Math.floor(source.pallets / representedShipments);
  const remainder = source.pallets % representedShipments;
  if (base <= 0) {
    problems.push("Pallets Total must be at least the number of Shipments Represented for LTL rating");
    return [];
  }

  const profiles: DerivedShipmentProfile[] = [];
  let allocatedWeight = 0;
  for (let index = 0; index < representedShipments; index += 1) {
    const pallets = base + (index < remainder ? 1 : 0);
    const weight =
      index === representedShipments - 1
        ? roundQuantity(source.weight - allocatedWeight)
        : roundQuantity((source.weight * pallets) / source.pallets);
    allocatedWeight = roundQuantity(allocatedWeight + weight);
    profiles.push({
      profileNumber: index + 1,
      representedShipments: 1,
      representativePallets: pallets,
      representativeWeight: weight
    });
  }

  const consolidated = new Map<string, DerivedShipmentProfile>();
  for (const profile of profiles) {
    const key = `${profile.representativePallets}:${profile.representativeWeight}`;
    const existing = consolidated.get(key);
    if (existing) {
      existing.representedShipments += 1;
      continue;
    }
    consolidated.set(key, { ...profile });
  }
  return [...consolidated.values()];
}

function normalizeWeightUnit(value: string, weight: number | null, problems: string[]) {
  const normalized = normalizeSupplyChainDesignWeightUnit(value);
  if (!normalized.ok) {
    if (normalized.reason === "UNSUPPORTED") {
      problems.push(`Weight Unit "${normalized.sourceValue}" is not supported`);
    } else if (weight !== null) {
      problems.push(
        "Weight Unit is required when Weight is supplied"
      );
    }
    return null;
  }
  return normalized.unit;
}

function normalizeDimensionUnit(value: string, length: number | null, width: number | null, height: number | null, problems: string[]) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    if ([length, width, height].some((item) => item !== null)) {
      problems.push("Dimension Unit is required when dimensions are supplied");
    }
    return null;
  }
  const unit = normalizeSupplyChainDesignDimensionUnit(normalized);
  if (unit) return unit;
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
  return normalizeSupplyChainDesignLtlPhysicalProfile({
    pallets: quantity,
    weight,
    weightUnit,
    length,
    width,
    height,
    dimensionUnit
  })?.freightClass ?? null;
}

function buildRateRequestKey(input: {
  tenantId: string;
  projectId: string;
  candidate: CandidateFacility;
  source: ShipmentSourceRow;
  representedShipments: number;
  currentTransportationCost: number | null;
  currentTransportationCostPerShipment: number | null;
  currentTransportationCostCurrency: string | null;
  representativePallets: number | null;
  representativeWeight: number | null;
  weightUnit: string | null;
  dimensions: { length: number; width: number; height: number } | null;
  dimensionUnit: string | null;
  hazardousMaterials: "Yes" | "No" | null;
  freightClass: string | null;
}) {
  const identity = {
    physicalNormalizationVersion: "POUNDS_INCHES_EACH_V1",
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

function combineNullableSums(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return null;
  }
  return roundQuantity(left + right);
}
