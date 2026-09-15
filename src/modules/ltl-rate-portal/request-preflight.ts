import type { LtlQuoteRequest } from "@/modules/ltl-rate-portal/types";

export type LtlQuoteRequestPreflightResult =
  | {
      ok: true;
      request: LtlQuoteRequest;
    }
  | {
      ok: false;
      category: "REQUEST_VALIDATION";
      message: string;
      request: LtlQuoteRequest;
    };

export function preflightSevenLQuoteRequest(request: LtlQuoteRequest): LtlQuoteRequestPreflightResult {
  const normalizedRequest: LtlQuoteRequest = {
    ...request,
    originCity: normalizeOptionalLocationText(request.originCity),
    originState: normalizeOptionalLocationText(request.originState),
    originZipcode: normalizePostalCode(request.originZipcode, request.originCountry),
    originCountry: request.originCountry,
    destinationCity: normalizeOptionalLocationText(request.destinationCity),
    destinationState: normalizeOptionalLocationText(request.destinationState),
    destinationZipcode: normalizePostalCode(request.destinationZipcode, request.destinationCountry),
    destinationCountry: request.destinationCountry,
    pickupDate: request.pickupDate?.trim() || "Not scheduled",
    uom: request.uom,
    accessorialCodes: request.accessorialCodes.map((code) => code.trim()).filter(Boolean),
    pieces: request.pieces.map((piece) => ({
      ...piece,
      freightClass: piece.freightClass.trim(),
      weightType: piece.weightType,
      dimType: piece.dimType
    }))
  };

  const errors = validateSevenLQuoteRequest(normalizedRequest);
  return errors.length > 0
    ? {
        ok: false,
        category: "REQUEST_VALIDATION",
        message: errors.join("; "),
        request: normalizedRequest
      }
    : {
        ok: true,
        request: normalizedRequest
      };
}

export function normalizeSevenLPostalCode(postalCode: string, country: LtlQuoteRequest["originCountry"]) {
  return normalizePostalCode(postalCode, country);
}

function normalizePostalCode(postalCode: string, country: LtlQuoteRequest["originCountry"]) {
  const trimmed = postalCode.trim().toUpperCase();
  if (country === "CA") {
    return trimmed.replace(/[\s-]+/g, "");
  }
  return trimmed;
}

function normalizeOptionalLocationText(value: string) {
  return value.trim().toUpperCase();
}

function validateSevenLQuoteRequest(request: LtlQuoteRequest) {
  const errors: string[] = [];
  if (!request.customerReference.trim()) errors.push("Customer reference is missing");
  if (!request.originZipcode) errors.push("Origin postal code is missing");
  if (!request.destinationZipcode) errors.push("Destination postal code is missing");
  if (request.pieces.length === 0) errors.push("At least one freight piece is required");

  request.pieces.forEach((piece, index) => {
    const label = `Piece ${index + 1}`;
    if (!Number.isFinite(piece.qty) || piece.qty <= 0) errors.push(`${label} quantity must be greater than zero`);
    if (!Number.isFinite(piece.weight) || piece.weight <= 0) errors.push(`${label} weight must be greater than zero`);
    if (!Number.isFinite(piece.length) || piece.length <= 0) errors.push(`${label} length must be greater than zero`);
    if (!Number.isFinite(piece.width) || piece.width <= 0) errors.push(`${label} width must be greater than zero`);
    if (!Number.isFinite(piece.height) || piece.height <= 0) errors.push(`${label} height must be greater than zero`);
    if (!piece.freightClass) errors.push(`${label} freight class is missing`);
  });

  return errors;
}
