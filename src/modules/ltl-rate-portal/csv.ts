import { LTL_DIM_TYPE_OPTIONS, LTL_FREIGHT_CLASS_OPTIONS, LTL_SAMPLE_CSV } from "@/modules/ltl-rate-portal/constants";
import type { LtlFreightPiece, LtlQuoteRequest } from "@/modules/ltl-rate-portal/types";
import { parseCsv, toCsv } from "@/modules/ups-tools/csv";

const MAX_PIECES = 5;

export type ParsedLtlRow = {
  errors: string[];
  request: LtlQuoteRequest | null;
};

export function getLtlTemplateCsv() {
  return LTL_SAMPLE_CSV;
}

export function parseLtlCsv(text: string): ParsedLtlRow[] {
  return parseCsv(text).map((row) => parseLtlRow(row));
}

export function exportLtlResultsCsv(
  rows: Array<Record<string, string | number>>
) {
  return toCsv(rows);
}

export function parseLtlRow(row: Record<string, string>): ParsedLtlRow {
  const errors: string[] = [];
  const originCountry = normalizeCountry(row.originCountry || "US");
  const destinationCountry = normalizeCountry(row.destinationCountry || "US");
  const uom = normalizeUom(row.uom || "US");
  const pickupDate = (row.pickupDate || "").trim();
  const pieces = collectPieces(row, errors);

  if (!(row.originZipcode || "").trim()) errors.push("originZipcode is required.");
  if (!(row.destinationZipcode || "").trim()) errors.push("destinationZipcode is required.");

  if (!originCountry) {
    errors.push("originCountry must be US, CA, or MX.");
  }

  if (!destinationCountry) {
    errors.push("destinationCountry must be US, CA, or MX.");
  }

  if (!uom) {
    errors.push("uom must be US, METRIC, or MIXED.");
  }

  if (pickupDate && !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    errors.push("pickupDate must use YYYY-MM-DD.");
  }

  if (pieces.length === 0) {
    errors.push("At least one valid freight piece is required.");
  }

  if (errors.length > 0 || !originCountry || !destinationCountry || !uom) {
    return {
      errors,
      request: null
    };
  }

  return {
    errors: [],
    request: {
      customerReference: (row.customerReference || "").trim() || "Unspecified",
      originCity: (row.originCity || "").trim(),
      originState: (row.originState || "").trim().toUpperCase(),
      originZipcode: row.originZipcode.trim(),
      originCountry,
      destinationCity: (row.destinationCity || "").trim(),
      destinationState: (row.destinationState || "").trim().toUpperCase(),
      destinationZipcode: row.destinationZipcode.trim(),
      destinationCountry,
      pickupDate: pickupDate || "Not scheduled",
      uom,
      accessorialCodes: parseAccessorialCodes(row.accessorialCodes || ""),
      pieces
    }
  };
}

function collectPieces(row: Record<string, string>, errors: string[]) {
  const pieces: LtlFreightPiece[] = [];

  for (let index = 1; index <= MAX_PIECES; index += 1) {
    const qty = row[`piece${index}Qty`]?.trim() ?? "";
    const weight = row[`piece${index}Weight`]?.trim() ?? "";
    const length = row[`piece${index}Length`]?.trim() ?? "";
    const width = row[`piece${index}Width`]?.trim() ?? "";
    const height = row[`piece${index}Height`]?.trim() ?? "";

    if (![qty, weight, length, width, height].some(Boolean)) {
      continue;
    }

    const parsedQty = qty ? Number.parseFloat(qty) : 1;
    const parsedWeight = Number.parseFloat(weight);
    const parsedLength = length ? Number.parseFloat(length) : 0;
    const parsedWidth = width ? Number.parseFloat(width) : 0;
    const parsedHeight = height ? Number.parseFloat(height) : 0;
    const weightType = normalizeWeightType(row[`piece${index}WeightType`] || "each");
    const dimType = normalizeDimType(row[`piece${index}DimType`] || "PLT");
    const freightClass = (row[`piece${index}Class`] || "125").trim();
    const stack = parseBoolean(row[`piece${index}Stack`] || "");
    const stackAmountRaw = row[`piece${index}StackAmount`]?.trim() ?? "";
    const stackAmount = stackAmountRaw ? Number.parseFloat(stackAmountRaw) : undefined;

    if (!Number.isFinite(parsedQty) || parsedQty <= 0) errors.push(`piece${index}Qty must be greater than 0.`);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) errors.push(`piece${index}Weight must be greater than 0.`);
    if (length && (!Number.isFinite(parsedLength) || parsedLength < 0)) errors.push(`piece${index}Length must be 0 or greater.`);
    if (width && (!Number.isFinite(parsedWidth) || parsedWidth < 0)) errors.push(`piece${index}Width must be 0 or greater.`);
    if (height && (!Number.isFinite(parsedHeight) || parsedHeight < 0)) errors.push(`piece${index}Height must be 0 or greater.`);
    if (!weightType) errors.push(`piece${index}WeightType must be each or total.`);
    if (!dimType) errors.push(`piece${index}DimType is invalid.`);
    if (freightClass && !LTL_FREIGHT_CLASS_OPTIONS.includes(freightClass as (typeof LTL_FREIGHT_CLASS_OPTIONS)[number])) {
      errors.push(`piece${index}Class must be a supported NMFC class.`);
    }
    if (stack && (!Number.isFinite(stackAmount) || (stackAmount ?? 0) <= 0)) {
      errors.push(`piece${index}StackAmount must be greater than 0 when stacking is enabled.`);
    }

    if (
      !Number.isFinite(parsedQty) ||
      !Number.isFinite(parsedWeight) ||
      (length && !Number.isFinite(parsedLength)) ||
      (width && !Number.isFinite(parsedWidth)) ||
      (height && !Number.isFinite(parsedHeight)) ||
      !weightType ||
      !dimType
    ) {
      continue;
    }

    pieces.push({
      qty: parsedQty,
      weight: parsedWeight,
      weightType,
      length: parsedLength,
      width: parsedWidth,
      height: parsedHeight,
      dimType,
      freightClass,
      hazmat: parseBoolean(row[`piece${index}Hazmat`] || ""),
      unNumber: normalizeOptional(row[`piece${index}UN`] || ""),
      nmfc: normalizeOptional(row[`piece${index}NMFC`] || ""),
      stack,
      stackAmount: stack ? stackAmount : undefined,
      commodity: normalizeOptional(row[`piece${index}Commodity`] || "")
    });
  }

  return pieces;
}

function normalizeCountry(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized === "US" || normalized === "CA" || normalized === "MX" ? normalized : null;
}

function normalizeUom(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized === "US" || normalized === "METRIC" || normalized === "MIXED" ? normalized : null;
}

function normalizeWeightType(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "each" || normalized === "total" ? normalized : null;
}

function normalizeDimType(value: string) {
  const normalized = value.trim().toUpperCase();
  return LTL_DIM_TYPE_OPTIONS.includes(normalized as (typeof LTL_DIM_TYPE_OPTIONS)[number])
    ? (normalized as LtlFreightPiece["dimType"])
    : null;
}

function parseAccessorialCodes(value: string) {
  return value
    .split(/[\|,]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function parseBoolean(value: string) {
  return ["true", "yes", "y", "1"].includes(value.trim().toLowerCase());
}

function normalizeOptional(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
