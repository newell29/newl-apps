import { SupplyChainDesignTableType } from "@prisma/client";

import { parseCsvRows } from "@/modules/supply-chain-design/csv-intake";
import { getSourceColumn } from "@/modules/supply-chain-design/model-01-proof";
import type { LtlCountryCode } from "@/modules/ltl-rate-portal/types";
import type { SupplyChainDesignFieldMapping } from "@/modules/supply-chain-design/types";

export type SupplyChainDesignRatingOriginSourceType = "CURRENT" | "CANDIDATE";

export type SupplyChainDesignRatingOrigin = {
  sourceType: SupplyChainDesignRatingOriginSourceType;
  facilityId: string;
  facilityName: string;
  postalCode: string;
  city: string | null;
  stateProvince: string | null;
  country: LtlCountryCode;
  sourceFileId: string;
  sourceFileName: string;
  sourceMappingId: string;
  sourceTableType: SupplyChainDesignTableType;
  sourceRowNumber: number;
};

export type SupplyChainDesignRatingOriginIssue = {
  sourceType: SupplyChainDesignRatingOriginSourceType;
  facilityId: string | null;
  facilityName: string | null;
  sourceRowNumber: number;
  reason: string;
};

export type SupplyChainDesignRatingOriginNormalizationResult = {
  origins: SupplyChainDesignRatingOrigin[];
  issues: SupplyChainDesignRatingOriginIssue[];
};

export type SupplyChainDesignRatingOriginMappedFile = {
  fileId: string;
  mappingId: string;
  tableType: SupplyChainDesignTableType;
  fileName: string;
  fileBytes: Buffer;
  fieldMappings: SupplyChainDesignFieldMapping[];
};

type MappedRows = {
  rows: string[][];
  columnIndexes: Map<string, number>;
};

export function normalizeSupplyChainDesignCandidateRatingOrigins(
  file: SupplyChainDesignRatingOriginMappedFile
): SupplyChainDesignRatingOriginNormalizationResult {
  const mapped = readMappedRows(file, ["candidate_facility_id", "candidate_facility_name", "postal_code", "candidate_country"]);
  const issues: SupplyChainDesignRatingOriginIssue[] = [];
  const origins = mapped.rows
    .map((row, index) => normalizeOriginRow({
      file,
      row,
      columnIndexes: mapped.columnIndexes,
      rowNumber: index + 2,
      sourceType: "CANDIDATE",
      idField: "candidate_facility_id",
      nameField: "candidate_facility_name",
      countryField: "candidate_country"
    }, issues))
    .filter((origin): origin is SupplyChainDesignRatingOrigin => Boolean(origin));

  return { origins, issues };
}

export function normalizeSupplyChainDesignCurrentFacilityRatingOrigins(
  file: SupplyChainDesignRatingOriginMappedFile
): SupplyChainDesignRatingOriginNormalizationResult {
  const mapped = readMappedRows(file, ["facility_id", "facility_name"]);
  const issues: SupplyChainDesignRatingOriginIssue[] = [];
  const origins = mapped.rows
    .map((row, index) => normalizeOriginRow({
      file,
      row,
      columnIndexes: mapped.columnIndexes,
      rowNumber: index + 2,
      sourceType: "CURRENT",
      idField: "facility_id",
      nameField: "facility_name",
      countryField: "country"
    }, issues))
    .filter((origin): origin is SupplyChainDesignRatingOrigin => Boolean(origin));

  return { origins, issues };
}

export function resolveHistoricalShipmentCurrentFacilityOrigins(input: {
  shipments: SupplyChainDesignRatingOriginMappedFile;
  currentFacilities: SupplyChainDesignRatingOriginMappedFile;
}) {
  const current = normalizeSupplyChainDesignCurrentFacilityRatingOrigins(input.currentFacilities);
  const originsById = new Map(current.origins.map((origin) => [origin.facilityId, origin]));
  const shipments = readMappedRows(input.shipments, ["origin_facility_id"]);
  const resolved: Array<{
    sourceRowNumber: number;
    sourceReference: string;
    originFacilityId: string;
    origin: SupplyChainDesignRatingOrigin;
  }> = [];
  const issues: Array<{
    sourceRowNumber: number;
    sourceReference: string;
    originFacilityId: string;
    reason: string;
  }> = [];

  shipments.rows.forEach((row, index) => {
    const sourceRowNumber = index + 2;
    const sourceReference = valueAt(row, shipments.columnIndexes, "shipment_id") || valueAt(row, shipments.columnIndexes, "shipment_reference") || `row-${sourceRowNumber}`;
    const originFacilityId = valueAt(row, shipments.columnIndexes, "origin_facility_id");
    const origin = originsById.get(originFacilityId);
    if (!origin) {
      issues.push({
        sourceRowNumber,
        sourceReference,
        originFacilityId,
        reason: originFacilityId
          ? `Origin Facility ID ${originFacilityId} does not match a rateable Current Facility.`
          : "Origin Facility ID is missing."
      });
      return;
    }
    resolved.push({ sourceRowNumber, sourceReference, originFacilityId, origin });
  });

  return {
    resolved,
    issues,
    originIssues: current.issues
  };
}

function normalizeOriginRow(input: {
  file: SupplyChainDesignRatingOriginMappedFile;
  row: string[];
  columnIndexes: Map<string, number>;
  rowNumber: number;
  sourceType: SupplyChainDesignRatingOriginSourceType;
  idField: string;
  nameField: string;
  countryField: string;
}, issues: SupplyChainDesignRatingOriginIssue[]) {
  const facilityId = valueAt(input.row, input.columnIndexes, input.idField);
  const facilityName = valueAt(input.row, input.columnIndexes, input.nameField);
  const postalCode = normalizePostalCode(valueAt(input.row, input.columnIndexes, "postal_code"));
  const country = normalizeCountry(valueAt(input.row, input.columnIndexes, input.countryField)) ?? inferCountryFromPostalCode(postalCode);
  const issueBase = {
    sourceType: input.sourceType,
    facilityId: facilityId || null,
    facilityName: facilityName || null,
    sourceRowNumber: input.rowNumber
  };

  if (!postalCode) {
    issues.push({ ...issueBase, reason: "ZIP / Postal Code is required for 7L origin rating." });
    return null;
  }
  if (!country) {
    issues.push({ ...issueBase, reason: "Country is required and must be US, CA or MX for 7L origin rating." });
    return null;
  }

  return {
    sourceType: input.sourceType,
    facilityId,
    facilityName,
    postalCode,
    city: optionalNormalizedText(valueAt(input.row, input.columnIndexes, "city")),
    stateProvince: optionalNormalizedText(valueAt(input.row, input.columnIndexes, "state_province")),
    country,
    sourceFileId: input.file.fileId,
    sourceFileName: input.file.fileName,
    sourceMappingId: input.file.mappingId,
    sourceTableType: input.file.tableType,
    sourceRowNumber: input.rowNumber
  };
}

function readMappedRows(file: SupplyChainDesignRatingOriginMappedFile, requiredFields: string[]): MappedRows {
  const rows = parseCsvRows(file.fileBytes.toString("utf8"));
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const columnIndexes = new Map<string, number>();

  for (const field of file.fieldMappings) {
    if (!field.sourceColumn) continue;
    const index = headers.findIndex((header) => normalizeHeader(header) === normalizeHeader(field.sourceColumn!));
    if (index >= 0) columnIndexes.set(field.standardField, index);
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

function normalizePostalCode(value: string) {
  return value.trim().toUpperCase();
}

function optionalNormalizedText(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function normalizeCountry(value: string): LtlCountryCode | null {
  const normalized = value.trim().toUpperCase();
  if (["US", "USA", "UNITED STATES"].includes(normalized)) return "US";
  if (["CA", "CAN", "CANADA"].includes(normalized)) return "CA";
  if (["MX", "MEX", "MEXICO"].includes(normalized)) return "MX";
  return null;
}

function inferCountryFromPostalCode(postalCode: string): LtlCountryCode | null {
  const normalized = postalCode.trim().toUpperCase();
  if (/^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/.test(normalized)) return "CA";
  if (/^\d{5}(?:-\d{4})?$/.test(normalized)) return "US";
  return null;
}
