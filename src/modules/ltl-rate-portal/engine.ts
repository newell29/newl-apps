import type {
  LtlFreightPiece,
  LtlQuoteRequest,
  LtlQuoteResult,
  SevenLAccountConfig,
  SevenLCarrierConfig
} from "@/modules/ltl-rate-portal/types";

const ACCESSORIAL_CHARGE_MAP: Record<string, number> = {
  APPT: 34,
  APO: 28,
  APD: 28,
  RESD: 42,
  LFTG: 55,
  HAZ: 48
};

export function estimateLtlQuotes(account: SevenLAccountConfig, request: LtlQuoteRequest): LtlQuoteResult[] {
  return account.carriers
    .filter((carrier) => carrier.enabled)
    .map((carrier, index) => estimateCarrierQuote(account, carrier, request, index));
}

export function serializeFreightInfo(pieces: LtlFreightPiece[]) {
  return JSON.stringify(
    pieces.map((piece) => ({
      qty: String(piece.qty),
      weight: String(piece.weight),
      weightType: piece.weightType,
      length: String(piece.length),
      width: String(piece.width),
      height: String(piece.height),
      dimType: piece.dimType,
      class: piece.freightClass,
      hazmat: piece.hazmat,
      UN: piece.unNumber ?? "",
      nmfc: piece.nmfc ?? "",
      stack: piece.stack,
      stackAmount: piece.stackAmount ?? 0,
      commodity: piece.commodity ?? ""
    }))
  );
}

function estimateCarrierQuote(
  account: SevenLAccountConfig,
  carrier: SevenLCarrierConfig,
  request: LtlQuoteRequest,
  carrierIndex: number
): LtlQuoteResult {
  const totalWeight = request.pieces.reduce((sum, piece) => sum + piece.weight * piece.qty, 0);
  const classAverage = averageFreightClass(request.pieces);
  const laneFactor = estimateLaneFactor(request.originZipcode, request.destinationZipcode);
  const linehaulCharge = roundCurrency(110 + totalWeight * 0.18 + classAverage * 1.12 + laneFactor * 24 + carrierIndex * 11);
  const fuelCharge = roundCurrency(linehaulCharge * (0.16 + carrierIndex * 0.01));
  const accessorialCharge = roundCurrency(
    request.accessorialCodes.reduce((sum, code) => sum + (ACCESSORIAL_CHARGE_MAP[code] ?? 18), 0)
  );
  const total = roundCurrency(linehaulCharge + fuelCharge + accessorialCharge);

  return {
    ...request,
    carrierHash: carrier.carrierHash,
    carrierName: carrier.name,
    carrierCode: carrier.code,
    scac: carrier.scac,
    serviceLevel: "Less than Truckload",
    transitDays: Math.max(1, Math.min(7, Math.round(laneFactor + carrierIndex + 1))),
    quoteNumber: `${carrier.code}-${normalizeReference(request.customerReference)}-${carrierIndex + 1}`,
    total,
    fuelCharge,
    accessorialCharge,
    linehaulCharge,
    rateRemarks: buildRemarks(request, carrier),
    mode: account.dryRun ? "dry-run" : "live"
  };
}

function averageFreightClass(pieces: LtlFreightPiece[]) {
  const total = pieces.reduce((sum, piece) => sum + Number.parseFloat(piece.freightClass || "125"), 0);
  return total / Math.max(pieces.length, 1);
}

function estimateLaneFactor(originZipcode: string, destinationZipcode: string) {
  const originSeed = normalizePostalSeed(originZipcode);
  const destinationSeed = normalizePostalSeed(destinationZipcode);
  const distance = Math.abs(originSeed - destinationSeed);

  if (distance < 20) return 1.2;
  if (distance < 80) return 1.8;
  if (distance < 180) return 2.6;
  if (distance < 320) return 3.7;
  return 4.8;
}

function buildRemarks(request: LtlQuoteRequest, carrier: SevenLCarrierConfig) {
  const remarks = [`Dry-run estimate for ${carrier.name}.`];

  if (request.accessorialCodes.length > 0) {
    remarks.push(`Includes ${request.accessorialCodes.join(", ")} accessorial pricing.`);
  }

  if (request.pieces.some((piece) => piece.hazmat)) {
    remarks.push("Hazmat surcharge simulated from 7L-style freight profile.");
  }

  if (request.originCountry !== request.destinationCountry) {
    remarks.push("Cross-border transit and customs timing should be confirmed before quoting.");
  }

  return remarks;
}

function normalizeReference(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || "QUOTE";
}

function normalizePostalSeed(value: string) {
  const trimmed = value.trim().toUpperCase();

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed.slice(0, 3), 10);
  }

  const lettersOnly = trimmed.replace(/[^A-Z0-9]/g, "");
  if (!lettersOnly) {
    return 0;
  }

  const alpha = lettersOnly.charCodeAt(0) - 64;
  const numeric = Number.parseInt(lettersOnly.slice(1, 4).replace(/[A-Z]/g, "0"), 10) || 0;
  return alpha * 100 + numeric;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
