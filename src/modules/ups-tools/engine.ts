import { UPS_SERVICE_CODE_MAP } from "@/modules/ups-tools/constants";
import type { QuoteRequest, QuoteResult, UpsAccountConfig } from "@/modules/ups-tools/types";

const HST_RATES: Record<string, number> = {
  ON: 0.13,
  NB: 0.15,
  NL: 0.15,
  NS: 0.14,
  PE: 0.15
};

const GST_ONLY_PROVINCES: Record<string, number> = {
  BC: 0.05,
  MB: 0.05,
  QC: 0.05,
  SK: 0.05,
  AB: 0.05
};

const SERVICE_MULTIPLIER = {
  Ground: 1,
  "2nd Day Air": 1.62,
  "Next Day Air": 2.38,
  "Next Day Air Saver": 2.08,
  "3 Day Select": 1.34
} as const;

const SERVICE_TRANSIT_DAYS = {
  Ground: { US: 4, CA: 5 },
  "2nd Day Air": { US: 2, CA: 2 },
  "Next Day Air": { US: 1, CA: 1 },
  "Next Day Air Saver": { US: 1, CA: 1 },
  "3 Day Select": { US: 3, CA: 3 }
} as const;

export function inferCountryFromPostalCode(postalCode: string): "US" | "CA" {
  return /^[A-Za-z]/.test(postalCode.trim()) ? "CA" : "US";
}

export function inferProvinceFromPostalCode(postalCode: string): string {
  const prefix = postalCode.trim().charAt(0).toUpperCase();

  return (
    {
      A: "NL",
      B: "NS",
      C: "PE",
      E: "NB",
      G: "QC",
      H: "QC",
      J: "QC",
      K: "ON",
      L: "ON",
      M: "ON",
      N: "ON",
      P: "ON",
      R: "MB",
      S: "SK",
      T: "AB",
      V: "BC",
      X: "NT",
      Y: "YT"
    }[prefix] ?? ""
  );
}

export function estimateQuote(account: UpsAccountConfig, request: QuoteRequest): QuoteResult {
  const originCountry = request.originCountryCode;
  const destinationCountry = request.destinationCountryCode;
  const destinationProvince = inferProvinceFromPostalCode(request.destinationPostalCode);
  const dimensionalWeight =
    request.length > 0 && request.width > 0 && request.height > 0
      ? (request.length * request.width * request.height) / 139
      : 0;
  const billableWeight = roundMoney(Math.max(request.weight, dimensionalWeight));
  const zoneFactor = estimateZoneFactor(request.originPostalCode, request.destinationPostalCode);
  const serviceMultiplier = SERVICE_MULTIPLIER[request.service];
  const isCrossBorder = originCountry !== destinationCountry;
  const oversizeFee = request.length + request.width + request.height > 70 ? 12 : 0;
  const residentialFee = request.isResidential ? 4.25 : 0;
  const internationalFee = isCrossBorder ? 7.5 : 0;

  const baseRate = 8 + billableWeight * 0.92 + zoneFactor * 3.8 + residentialFee + internationalFee + oversizeFee;
  const standardRate = roundMoney(baseRate * serviceMultiplier);
  const negotiatedRate = roundMoney(standardRate * 0.86);
  const taxRate = getTaxRate(destinationProvince);
  const taxAmount = roundMoney(negotiatedRate * taxRate);
  const totalWithTax = roundMoney(negotiatedRate + taxAmount);
  const transitDays = estimateTransitDays(request, zoneFactor);

  return {
    ...request,
    dims: `${request.length}x${request.width}x${request.height}`,
    billableWeight,
    standardRate,
    negotiatedRate,
    taxAmount,
    totalWithTax,
    transitDays,
    destinationProvince,
    accountId: account.id,
    accountName: account.name,
    accountShipperNumber: account.shipperNumber,
    mode: account.dryRun ? "dry-run" : "live"
  };
}

export function getServiceCode(service: QuoteRequest["service"], country: "US" | "CA") {
  return UPS_SERVICE_CODE_MAP[service][country];
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function getTaxRate(province: string) {
  if (province in HST_RATES) {
    return HST_RATES[province];
  }

  if (province in GST_ONLY_PROVINCES) {
    return GST_ONLY_PROVINCES[province];
  }

  return 0;
}

function estimateZoneFactor(originPostalCode: string, destinationPostalCode: string) {
  const origin = normalizePostalSeed(originPostalCode);
  const destination = normalizePostalSeed(destinationPostalCode);
  const distance = Math.abs(origin - destination);

  if (distance < 30) return 1;
  if (distance < 90) return 2;
  if (distance < 180) return 3;
  if (distance < 320) return 4;
  return 5;
}

function estimateTransitDays(request: QuoteRequest, zoneFactor: number) {
  const baseline = SERVICE_TRANSIT_DAYS[request.service][request.destinationCountryCode];

  if (request.service !== "Ground") {
    return baseline;
  }

  const crossBorderDays = request.originCountryCode !== request.destinationCountryCode ? 1 : 0;
  return Math.max(1, Math.min(7, baseline + zoneFactor - 2 + crossBorderDays));
}

function normalizePostalSeed(value: string) {
  const trimmed = value.trim().toUpperCase();

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed.slice(0, 3));
  }

  const lettersOnly = trimmed.replace(/[^A-Z0-9]/g, "");
  if (lettersOnly.length === 0) {
    return 0;
  }

  const alpha = lettersOnly.charCodeAt(0) - 64;
  const numeric = Number.parseInt(lettersOnly.slice(1, 3).replace(/[A-Z]/g, "0"), 10) || 0;
  return alpha * 10 + numeric;
}
