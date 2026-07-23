import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";
import type { LtlCarrierErrorResult, LtlFreightPiece, LtlQuoteResult, LtlQuoteRequest, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";
import { fetchSevenLAvailableCarriers, getLtlQuotes } from "@/server/integrations/seven-l";
import type { TenantContext } from "@/server/tenant-context";
import { isLtlParsedInquiry, type ParsedShipmentInquiry } from "@/modules/shipment-inquiries/parser";

export type LtlInquiryRatingResult =
  | { status: "not_applicable"; isLtl: false; request: null; quotes: []; errors: []; warning: null; accountName: null; enabledCarrierCount: 0 }
  | { status: "skipped"; isLtl: true; request: null; quotes: []; errors: []; warning: string; accountName: null; enabledCarrierCount: 0; missingRequiredFields: string[] }
  | { status: "quoted"; isLtl: true; request: LtlQuoteRequest; quotes: LtlQuoteResult[]; errors: LtlCarrierErrorResult[]; warning: null; accountName: string; enabledCarrierCount: number }
  | { status: "failed"; isLtl: true; request: LtlQuoteRequest | null; quotes: []; errors: []; warning: string; accountName: string | null; enabledCarrierCount: number };

export async function rateLtlInquiryIfApplicable(ctx: TenantContext, inquiry: ParsedShipmentInquiry): Promise<LtlInquiryRatingResult> {
  if (!isLtlParsedInquiry(inquiry)) {
    return { status: "not_applicable", isLtl: false, request: null, quotes: [], errors: [], warning: null, accountName: null, enabledCarrierCount: 0 };
  }

  const adapter = buildLtlQuoteRequest(inquiry);
  if (!adapter.request) {
    return {
      status: "skipped",
      isLtl: true,
      request: null,
      quotes: [],
      errors: [],
      warning: "7L rating skipped because the parsed LTL inquiry is missing required rating fields.",
      accountName: null,
      enabledCarrierCount: 0,
      missingRequiredFields: adapter.missingRequiredFields
    };
  }

  let account: SevenLAccountConfig | null = null;
  let carrierHashes: string[] = [];
  try {
    const shell = await getLtlRatePortalShell(ctx);
    account = shell.accounts.find((candidate) => !candidate.dryRun && candidate.secretConfigured && candidate.status === "ACTIVE") ?? null;
    if (!account) {
      return { status: "failed", isLtl: true, request: adapter.request, quotes: [], errors: [], warning: "7L rating failed because no active live 7L account with configured runtime credentials was found.", accountName: null, enabledCarrierCount: 0 };
    }
    carrierHashes = (await fetchSevenLAvailableCarriers(account).catch(() => account?.carriers ?? [])).map((carrier) => carrier.carrierHash);
    if (carrierHashes.length === 0) {
      return { status: "failed", isLtl: true, request: adapter.request, quotes: [], errors: [], warning: `7L rating failed because ${account.name} has no enabled carriers.`, accountName: account.name, enabledCarrierCount: 0 };
    }
    const response = await getLtlQuotes(account, [adapter.request], carrierHashes);
    return { status: "quoted", isLtl: true, request: adapter.request, quotes: response.data, errors: response.errors, warning: null, accountName: account.name, enabledCarrierCount: carrierHashes.length };
  } catch (error) {
    return { status: "failed", isLtl: true, request: adapter.request, quotes: [], errors: [], warning: `7L rating failed: ${error instanceof Error ? error.message : "Unknown error."}`, accountName: account?.name ?? null, enabledCarrierCount: carrierHashes.length };
  }
}

function buildLtlQuoteRequest(inquiry: ParsedShipmentInquiry): { request: LtlQuoteRequest | null; missingRequiredFields: string[] } {
  const missing: string[] = [];
  const originZipcode = normalizePostal(inquiry.originPostalCode);
  const destinationZipcode = normalizePostal(inquiry.destinationPostalCode);
  const originCountry = normalizeCountry(inquiry.originCountry);
  const destinationCountry = normalizeCountry(inquiry.destinationCountry);
  if (!originZipcode) missing.push("originPostalCode");
  if (!destinationZipcode) missing.push("destinationPostalCode");
  if (!originCountry) missing.push("originCountry");
  if (!destinationCountry) missing.push("destinationCountry");

  const pieces = inquiry.items.map((item, index) => buildPiece(inquiry, item, index, missing)).filter((piece): piece is LtlFreightPiece => Boolean(piece));
  if (pieces.length === 0) missing.push("items");

  if (missing.length > 0 || !originCountry || !destinationCountry) {
    return { request: null, missingRequiredFields: [...new Set(missing)] };
  }

  return {
    missingRequiredFields: [],
    request: {
      customerReference: inquiry.customer || "outlook-inquiry",
      originCity: "",
      originState: "",
      originZipcode,
      originCountry,
      destinationCity: "",
      destinationState: "",
      destinationZipcode,
      destinationCountry,
      pickupDate: inquiry.pickupDate || inquiry.readyDate || "Not scheduled",
      uom: inquiry.weightUnit === "KG" || inquiry.dimensionsUnit === "CM" ? "METRIC" : "US",
      accessorialCodes: mapAccessorials(inquiry),
      pieces
    }
  };
}

function buildPiece(inquiry: ParsedShipmentInquiry, item: ParsedShipmentInquiry["items"][number], index: number, missing: string[]): LtlFreightPiece | null {
  const prefix = `items[${index}]`;
  const qty = positiveNumber(item.quantity);
  const weight = positiveNumber(item.weight);
  const length = positiveNumber(item.length);
  const width = positiveNumber(item.width);
  const height = positiveNumber(item.height);
  const freightClass = item.freightClass || inquiry.freightClass || estimateClass(qty, weight, item.weightType, length, width, height, inquiry.weightUnit, inquiry.dimensionsUnit);
  const dimType = mapPackaging(item.packagingType);
  if (!qty) missing.push(`${prefix}.quantity`);
  if (!weight) missing.push(`${prefix}.weight`);
  if (!length) missing.push(`${prefix}.length`);
  if (!width) missing.push(`${prefix}.width`);
  if (!height) missing.push(`${prefix}.height`);
  if (!freightClass) missing.push(`${prefix}.freightClass`);
  if (!dimType) missing.push(`${prefix}.packagingType`);
  if (!qty || !weight || !length || !width || !height || !freightClass || !dimType) return null;
  return { qty, weight, weightType: item.weightType || "each", length, width, height, dimType, freightClass, hazmat: inquiry.dangerousGoods, unNumber: item.unNumber || inquiry.unNumber || undefined, nmfc: item.nmfc || inquiry.nmfc || undefined, stack: false, stackAmount: 0, commodity: inquiry.commodity || undefined };
}

function estimateClass(qty: number | null, weight: number | null, weightType: string, length: number | null, width: number | null, height: number | null, weightUnit: string, dimensionsUnit: string) {
  if (!qty || !weight || !length || !width || !height) return "";
  const totalWeightLb = (weightUnit === "KG" ? weight * 2.2046226218 : weight) * (weightType === "each" ? qty : 1);
  const lengthIn = dimensionsUnit === "CM" ? length / 2.54 : length;
  const widthIn = dimensionsUnit === "CM" ? width / 2.54 : width;
  const heightIn = dimensionsUnit === "CM" ? height / 2.54 : height;
  const density = totalWeightLb / ((qty * lengthIn * widthIn * heightIn) / 1728);
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

function mapAccessorials(inquiry: ParsedShipmentInquiry) {
  const text = inquiry.accessorials.join(" ").toLowerCase();
  const codes = new Set<string>();
  if (/destination|delivery/.test(text) && /appointment|appt/.test(text)) codes.add("APD");
  if (/destination|delivery/.test(text) && /inside/.test(text)) codes.add("IND");
  if (/destination|delivery/.test(text) && /lift\s*gate|liftgate/.test(text)) codes.add("LFD");
  if (/origin|pickup/.test(text) && /appointment|appt/.test(text)) codes.add("APO");
  if (/origin|pickup/.test(text) && /inside/.test(text)) codes.add("INO");
  if (/origin|pickup/.test(text) && /lift\s*gate|liftgate/.test(text)) codes.add("LFO");
  if (inquiry.dangerousGoods) codes.add("HAZ");
  return [...codes];
}

function normalizePostal(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function normalizeCountry(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized === "US" || normalized === "CA" || normalized === "MX" ? normalized : "";
}

function mapPackaging(value: string): LtlFreightPiece["dimType"] | "" {
  const normalized = value.toLowerCase();
  if (/pallet|skid/.test(normalized)) return "PLT";
  if (/carton/.test(normalized)) return "CTN";
  if (/crate/.test(normalized)) return "CRT";
  if (/box/.test(normalized)) return "BOX";
  if (/drum/.test(normalized)) return "DRM";
  return "";
}

function positiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
