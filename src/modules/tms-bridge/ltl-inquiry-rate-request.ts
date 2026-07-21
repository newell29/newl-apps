import { LTL_ACCESSORIAL_LEGEND, LTL_DIM_TYPE_OPTIONS, LTL_FREIGHT_CLASS_OPTIONS } from "@/modules/ltl-rate-portal/constants";
import type { LtlCountryCode, LtlFreightPiece, LtlQuoteRequest, LtlUom } from "@/modules/ltl-rate-portal/types";
import type { LogisticsInquiry, ParsedEmailLogisticsData } from "@/modules/tms-bridge/actions";

const UNSCHEDULED_PICKUP_DATE = "Not scheduled";

const SUPPORTED_ACCESSORIAL_CODES = new Set(LTL_ACCESSORIAL_LEGEND.map((item) => item.code));

type SupportedAccessorialCode = (typeof LTL_ACCESSORIAL_LEGEND)[number]["code"];

const ACCESSORIAL_MAPPINGS = [
  {
    code: "APO",
    patterns: [/\b(?:origin|pickup|pick\s*up)\b.*\b(?:appointment|appt)\b/i, /\b(?:appointment|appt)\b.*\b(?:origin|pickup|pick\s*up)\b/i]
  },
  {
    code: "APD",
    patterns: [/\b(?:destination|delivery|deliver)\b.*\b(?:appointment|appt)\b/i, /\b(?:appointment|appt)\b.*\b(?:destination|delivery|deliver)\b/i, /\bappointment\s+delivery\b/i]
  },
  {
    code: "CSO",
    patterns: [/\b(?:origin|pickup|pick\s*up)\b.*\bconstruction\b/i, /\bconstruction\b.*\b(?:origin|pickup|pick\s*up)\b/i]
  },
  {
    code: "CSD",
    patterns: [/\b(?:destination|delivery|deliver)\b.*\bconstruction\b/i, /\bconstruction\b.*\b(?:destination|delivery|deliver)\b/i]
  },
  {
    code: "EXO",
    patterns: [/\b(?:origin|pickup|pick\s*up)\b.*\b(?:exhibition|trade\s*show)\b/i, /\b(?:exhibition|trade\s*show)\b.*\b(?:origin|pickup|pick\s*up)\b/i]
  },
  {
    code: "EXD",
    patterns: [/\b(?:destination|delivery|deliver)\b.*\b(?:exhibition|trade\s*show)\b/i, /\b(?:exhibition|trade\s*show)\b.*\b(?:destination|delivery|deliver)\b/i]
  },
  {
    code: "INO",
    patterns: [/\b(?:origin|pickup|pick\s*up)\b.*\binside\b/i, /\binside\b.*\b(?:origin|pickup|pick\s*up)\b/i]
  },
  {
    code: "IND",
    patterns: [/\b(?:destination|delivery|deliver)\b.*\binside\b/i, /\binside\b.*\b(?:destination|delivery|deliver)\b/i]
  },
  {
    code: "LFO",
    patterns: [/\b(?:origin|pickup|pick\s*up)\b.*\b(?:lift\s*gate|liftgate|tail\s*gate|tailgate)\b/i, /\b(?:lift\s*gate|liftgate|tail\s*gate|tailgate)\b.*\b(?:origin|pickup|pick\s*up)\b/i]
  },
  {
    code: "LFD",
    patterns: [/\b(?:destination|delivery|deliver)\b.*\b(?:lift\s*gate|liftgate|tail\s*gate|tailgate)\b/i, /\b(?:lift\s*gate|liftgate|tail\s*gate|tailgate)\b.*\b(?:destination|delivery|deliver)\b/i]
  },
  {
    code: "RSO",
    patterns: [/\b(?:origin|pickup|pick\s*up)\b.*\bresidential\b/i, /\bresidential\b.*\b(?:origin|pickup|pick\s*up)\b/i]
  },
  {
    code: "RSD",
    patterns: [/\b(?:destination|delivery|deliver)\b.*\bresidential\b/i, /\bresidential\b.*\b(?:destination|delivery|deliver)\b/i]
  },
  {
    code: "SCO",
    patterns: [/\b(?:origin|pickup|pick\s*up)\b.*\bschool\b/i, /\bschool\b.*\b(?:origin|pickup|pick\s*up)\b/i]
  },
  {
    code: "SCD",
    patterns: [/\b(?:destination|delivery|deliver)\b.*\bschool\b/i, /\bschool\b.*\b(?:destination|delivery|deliver)\b/i]
  },
  {
    code: "HAZ",
    patterns: [/\bhazmat\b/i, /\bhazardous\b/i, /\bdangerous\s+goods\b/i, /\bDG\b/]
  },
  {
    code: "INB",
    patterns: [/\bin\s*bond\b/i, /\binbond\b/i]
  }
] satisfies Array<{
  code: SupportedAccessorialCode;
  patterns: RegExp[];
}>;

const SUPPORTED_ACCESSORIAL_MAPPINGS = ACCESSORIAL_MAPPINGS.filter((mapping) => SUPPORTED_ACCESSORIAL_CODES.has(mapping.code));

const UNSUPPORTED_ACCESSORIAL_PATTERNS: Array<{ term: string; pattern: RegExp }> = [
  { term: "limited access", pattern: /\blimited\s+access\b/i },
  { term: "heated service", pattern: /\bheated\s+service\b/i },
  { term: "protect from freezing", pattern: /\bprotect(?:ion)?\s+from\s+freez(?:e|ing)\b/i }
];

export type LtlInquiryRateRequestResult = {
  canRequestRates: boolean;
  request: LtlQuoteRequest | null;
  missingRequiredFields: string[];
  appliedDefaults: string[];
  freightClassEstimates: LtlFreightClassEstimate[];
  detectedAccessorials: Array<{
    code: string;
    phrase: string;
  }>;
  unsupportedOrUnmappedTerms: string[];
  warnings: string[];
};

export type LtlFreightClassEstimate = {
  fieldPrefix: string;
  source: "density-estimated";
  density: number;
  freightClass: string;
};

type ParsedLtlInquiry = Partial<ParsedEmailLogisticsData | LogisticsInquiry> & Record<string, unknown>;

type FreightPieceInput = {
  quantity?: unknown;
  numberPieces?: unknown;
  noOfPieces?: unknown;
  number?: unknown;
  pieces?: unknown;
  packagingType?: unknown;
  length?: unknown;
  width?: unknown;
  height?: unknown;
  weight?: unknown;
  weightType?: unknown;
  freightClass?: unknown;
  nmfc?: unknown;
  unNumber?: unknown;
  commodity?: unknown;
};

export function buildLtlRateRequestFromParsedInquiry(parsed: ParsedLtlInquiry): LtlInquiryRateRequestResult {
  const missingRequiredFields: string[] = [];
  const appliedDefaults: string[] = [];
  const freightClassEstimates: LtlFreightClassEstimate[] = [];
  const warnings: string[] = [];

  const originZipcode = normalizeSevenLPostalCode(firstString(parsed.originPostalCode));
  const destinationZipcode = normalizeSevenLPostalCode(firstString(parsed.destinationPostalCode));
  const originCountry = normalizeCountry(firstString(parsed.originCountry, inferCountryFromPostalCode(originZipcode)));
  const destinationCountry = normalizeCountry(firstString(parsed.destinationCountry, inferCountryFromPostalCode(destinationZipcode)));
  const pickupDate = normalizePickupDate(firstString(parsed.pickupDate, parsed.readyDate), appliedDefaults, warnings);
  const uom = normalizeUom(parsed.weightUnit, parsed.dimensionsUnit);
  const accessorialResult = detectAccessorials(parsed);
  const pieces = buildFreightPieces(parsed, missingRequiredFields, appliedDefaults, freightClassEstimates, warnings);

  if (!originZipcode) {
    missingRequiredFields.push("originPostalCode");
  }
  if (!destinationZipcode) {
    missingRequiredFields.push("destinationPostalCode");
  }
  if (!originZipcode || !destinationZipcode) {
    warnings.push("7L rate request skipped because the current 7L integration requires origin and destination postal codes.");
  }
  if (!originCountry) {
    missingRequiredFields.push("originCountry");
  }
  if (!destinationCountry) {
    missingRequiredFields.push("destinationCountry");
  }
  if (pieces.length === 0) {
    missingRequiredFields.push("items");
  }

  const request =
    missingRequiredFields.length === 0 && originCountry && destinationCountry
      ? {
          customerReference: firstString(parsed.customer, "email-inquiry"),
          originCity: "",
          originState: "",
          originZipcode,
          originCountry,
          destinationCity: "",
          destinationState: "",
          destinationZipcode,
          destinationCountry,
          pickupDate,
          uom,
          accessorialCodes: accessorialResult.codes,
          pieces
        }
      : null;

  return {
    canRequestRates: Boolean(request),
    request,
    missingRequiredFields: uniqueStrings(missingRequiredFields),
    appliedDefaults: uniqueStrings(appliedDefaults),
    freightClassEstimates,
    detectedAccessorials: accessorialResult.detected,
    unsupportedOrUnmappedTerms: accessorialResult.unsupported,
    warnings
  };
}

function buildFreightPieces(
  parsed: ParsedLtlInquiry,
  missingRequiredFields: string[],
  appliedDefaults: string[],
  freightClassEstimates: LtlFreightClassEstimate[],
  warnings: string[]
): LtlFreightPiece[] {
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems.length > 0 ? rawItems : [parsed];
  const pieces: LtlFreightPiece[] = [];

  for (const [index, item] of items.entries()) {
    const itemRecord = asRecord(item) as FreightPieceInput;
    const fieldPrefix = rawItems.length > 0 ? `items[${index}]` : "shipment";
    const qty = parsePositiveNumber(
      firstString(itemRecord.quantity, itemRecord.numberPieces, itemRecord.noOfPieces, itemRecord.number, itemRecord.pieces, parsed.pieces, parsed.containerQuantity, "1")
    );
    const weight = parsePositiveNumber(itemRecord.weight);
    const length = parsePositiveNumber(itemRecord.length);
    const width = parsePositiveNumber(itemRecord.width);
    const height = parsePositiveNumber(itemRecord.height);
    const dimType = mapPackagingToDimType(itemRecord.packagingType);
    const statedFreightClass = normalizeFreightClass(firstString(itemRecord.freightClass, parsed.freightClass));
    const weightType = normalizeWeightType(itemRecord.weightType, qty, appliedDefaults);
    const freightClassEstimate = statedFreightClass
      ? null
      : estimateFreightClass({
          qty,
          weight,
          weightType,
          length,
          width,
          height,
          weightUnit: parsed.weightUnit,
          dimensionsUnit: parsed.dimensionsUnit
        });
    const freightClass = statedFreightClass || freightClassEstimate?.freightClass || "";

    if (!qty) {
      missingRequiredFields.push(`${fieldPrefix}.quantity`);
    }
    if (!weight) {
      missingRequiredFields.push(`${fieldPrefix}.weight`);
    }
    if (!length) {
      missingRequiredFields.push(`${fieldPrefix}.length`);
    }
    if (!width) {
      missingRequiredFields.push(`${fieldPrefix}.width`);
    }
    if (!height) {
      missingRequiredFields.push(`${fieldPrefix}.height`);
    }
    if (!dimType) {
      missingRequiredFields.push(`${fieldPrefix}.packagingType`);
    }
    if (!freightClass) {
      missingRequiredFields.push(`${fieldPrefix}.freightClass`);
    }

    if (!qty || !weight || !length || !width || !height || !dimType || !freightClass) {
      continue;
    }

    appliedDefaults.push("stack=false");
    const hazmat = normalizeHazmat(parsed);
    const nmfc = firstString(itemRecord.nmfc, parsed.nmfc);
    const unNumber = firstString(itemRecord.unNumber, parsed.unNumber);
    const commodity = firstString(itemRecord.commodity, parsed.commodity);

    if (hazmat && !unNumber) {
      warnings.push(`${fieldPrefix}.unNumber is empty even though hazmat/dangerous goods was indicated.`);
    }

    pieces.push({
      qty,
      weight,
      weightType,
      length,
      width,
      height,
      dimType,
      freightClass,
      hazmat,
      unNumber: unNumber || undefined,
      nmfc: nmfc || undefined,
      stack: false,
      commodity: commodity || undefined
    });

    if (freightClassEstimate) {
      freightClassEstimates.push({
        fieldPrefix,
        source: "density-estimated",
        density: freightClassEstimate.density,
        freightClass: freightClassEstimate.freightClass
      });
      appliedDefaults.push(`${fieldPrefix}.freightClass=${freightClass} estimated from density`);
    }
  }

  return pieces;
}

function detectAccessorials(parsed: ParsedLtlInquiry) {
  const phrases = [
    ...readStringArray(parsed.accessorials),
    readString(parsed.service),
    readString(parsed.requestedTiming),
    readString(parsed.commodity),
    readString(parsed.origin),
    readString(parsed.destination)
  ].filter(Boolean);
  const detected: Array<{ code: string; phrase: string }> = [];
  const codes: string[] = [];

  for (const mapping of SUPPORTED_ACCESSORIAL_MAPPINGS) {
    const phrase = phrases.find((candidate) => !isNegatedAccessorialPhrase(candidate) && mapping.patterns.some((pattern) => pattern.test(candidate)));
    const match = phrase ? mapping.patterns.map((pattern) => phrase.match(pattern)?.[0]).find(Boolean) : null;
    if (!phrase || !match) {
      continue;
    }

    detected.push({ code: mapping.code, phrase: match });
    codes.push(mapping.code);
  }

  const text = phrases.filter((phrase) => !isNegatedAccessorialPhrase(phrase)).join(" | ");
  const unsupported = UNSUPPORTED_ACCESSORIAL_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.term);

  return {
    codes: uniqueStrings(codes),
    detected,
    unsupported: uniqueStrings(unsupported)
  };
}

function isNegatedAccessorialPhrase(value: string) {
  return /\b(?:no|none|not required|not needed|without|declined)\b/i.test(value) || /=\s*(?:no|false|n)\b/i.test(value);
}

function normalizePickupDate(value: string, appliedDefaults: string[], warnings: string[]) {
  if (!value) {
    appliedDefaults.push("pickupDate=Not scheduled");
    return UNSCHEDULED_PICKUP_DATE;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    warnings.push(`pickupDate could not be normalized from "${value}"; using Not scheduled.`);
    appliedDefaults.push("pickupDate=Not scheduled");
    return UNSCHEDULED_PICKUP_DATE;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeUom(weightUnit: unknown, dimensionsUnit: unknown): LtlUom {
  const weight = readString(weightUnit).toUpperCase();
  const dimensions = readString(dimensionsUnit).toUpperCase();

  if (weight === "KG" || dimensions === "CM") {
    return "METRIC";
  }

  return "US";
}

function normalizeWeightType(value: unknown, qty: number | null, appliedDefaults: string[]): LtlFreightPiece["weightType"] {
  const normalized = readString(value).toLowerCase();
  if (normalized === "each" || normalized === "total") {
    return normalized;
  }

  const defaultValue = (qty ?? 0) > 1 ? "total" : "each";
  appliedDefaults.push(`weightType=${defaultValue}`);
  return defaultValue;
}

function normalizeHazmat(parsed: ParsedLtlInquiry) {
  if (parsed.dangerousGoods === true) {
    return true;
  }

  const text = [readString(parsed.commodity), ...readStringArray(parsed.accessorials)].join(" ");
  return /\b(?:hazmat|hazardous|dangerous\s+goods|DG)\b/i.test(text);
}

function normalizeFreightClass(value: string) {
  const normalized = value.trim();
  return LTL_FREIGHT_CLASS_OPTIONS.includes(normalized as (typeof LTL_FREIGHT_CLASS_OPTIONS)[number])
    ? normalized
    : "";
}

function estimateFreightClass({
  qty,
  weight,
  weightType,
  length,
  width,
  height,
  weightUnit,
  dimensionsUnit
}: {
  qty: number | null;
  weight: number | null;
  weightType: LtlFreightPiece["weightType"];
  length: number | null;
  width: number | null;
  height: number | null;
  weightUnit: unknown;
  dimensionsUnit: unknown;
}): { density: number; freightClass: string } | null {
  if (!qty || !weight || !length || !width || !height) {
    return null;
  }

  const totalWeightLbs = convertWeightToPounds(weightType === "each" ? weight * qty : weight, weightUnit);
  const lengthInches = convertDimensionToInches(length, dimensionsUnit);
  const widthInches = convertDimensionToInches(width, dimensionsUnit);
  const heightInches = convertDimensionToInches(height, dimensionsUnit);
  if (!totalWeightLbs || !lengthInches || !widthInches || !heightInches) {
    return null;
  }

  const cubicFeet = (qty * lengthInches * widthInches * heightInches) / 1728;
  if (!Number.isFinite(cubicFeet) || cubicFeet <= 0) {
    return null;
  }

  const density = totalWeightLbs / cubicFeet;
  return {
    density,
    freightClass: densityToFreightClass(density)
  };
}

function densityToFreightClass(density: number) {
  if (density >= 50) return "50";
  if (density >= 35) return "55";
  if (density >= 30) return "60";
  if (density >= 22.5) return "65";
  if (density >= 15) return "70";
  if (density >= 12) return "85";
  if (density >= 10) return "92.5";
  if (density >= 8) return "100";
  if (density >= 6) return "125";
  if (density >= 4) return "175";
  if (density >= 2) return "250";
  if (density >= 1) return "300";
  return "400";
}

function convertWeightToPounds(weight: number, weightUnit: unknown) {
  const normalized = readString(weightUnit).toUpperCase();
  if (normalized === "KG") {
    return weight * 2.2046226218;
  }
  return weight;
}

function convertDimensionToInches(value: number, dimensionsUnit: unknown) {
  const normalized = readString(dimensionsUnit).toUpperCase();
  if (normalized === "CM") {
    return value / 2.54;
  }
  return value;
}

function mapPackagingToDimType(value: unknown): LtlFreightPiece["dimType"] | null {
  const normalized = readString(value).toLowerCase();
  const code = (() => {
    if (/^(?:pallet|pallets|plt|skid|skids)$/.test(normalized)) return "PLT";
    if (/^(?:carton|cartons|ctn)$/.test(normalized)) return "CTN";
    if (/^(?:box|boxes)$/.test(normalized)) return "BOX";
    if (/^(?:crate|crates|crt)$/.test(normalized)) return "CRT";
    if (/^(?:container|containers|con)$/.test(normalized)) return "CON";
    if (/^(?:cylinder|cylinders|cyl)$/.test(normalized)) return "CYL";
    if (/^(?:drum|drums|drm)$/.test(normalized)) return "DRM";
    if (/^(?:envelope|envelopes|env)$/.test(normalized)) return "ENV";
    if (/^(?:bundle|bundles|bdl)$/.test(normalized)) return "BDL";
    return normalized.toUpperCase();
  })();

  return LTL_DIM_TYPE_OPTIONS.includes(code as LtlFreightPiece["dimType"]) ? (code as LtlFreightPiece["dimType"]) : null;
}

function normalizeCountry(value: string): LtlCountryCode | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === "US" || normalized === "USA" || normalized === "UNITED STATES") return "US";
  if (normalized === "CA" || normalized === "CAN" || normalized === "CANADA") return "CA";
  if (normalized === "MX" || normalized === "MEX" || normalized === "MEXICO") return "MX";
  return null;
}

function inferCountryFromPostalCode(value: string): string {
  if (/^\d{5}(?:-\d{4})?$/.test(value.trim())) {
    return "US";
  }
  if (/^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/i.test(value.trim())) {
    return "CA";
  }
  return "";
}

function normalizeSevenLPostalCode(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(readString(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = readString(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => readString(item)).filter(Boolean) : [];
}

function readString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
