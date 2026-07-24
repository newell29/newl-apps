import { canonicalizeTradeMiningDestinationPort } from "@/modules/lead-gen/search-profile-suggestions";
import {
  isTradeMiningIndustryPackId,
  TRADEMINING_INDUSTRY_FILTER_MODES
} from "@/modules/lead-gen/industry-packs";

export const tradeMiningCompanyIdentityRoleOptions = [
  { value: "importer_name", label: "Importer" },
  { value: "consignee_name", label: "Consignee" },
  { value: "master_consignee_name", label: "Master consignee" },
  { value: "notify_party", label: "Notify party" },
  { value: "shipper_name", label: "Shipper" },
  { value: "master_shipper_name", label: "Master shipper" }
] as const;

export type TradeMiningCompanyIdentityRole = (typeof tradeMiningCompanyIdentityRoleOptions)[number]["value"];

export const defaultTradeMiningCompanyIdentityRoles: TradeMiningCompanyIdentityRole[] = [
  "importer_name",
  "consignee_name",
  "master_consignee_name"
];

export type TradeMiningSearchProfileInput = {
  name: string;
  destinationMarkets: string[];
  destinationPorts?: string[];
  originPorts?: string[];
  shipFromPorts?: string[];
  originCountries?: string[];
  productKeywords?: string[];
  hsCodes?: string[];
  industryPackIds?: string[];
  industryFilterMode?: string;
  allowedCompanyIdentityRoles?: TradeMiningCompanyIdentityRole[];
  excludedCompanyKeywords?: string[];
  lookbackWindowDays: number;
  minShipmentCount: number;
  minShipmentVolume?: number | null;
  minAggregateTeu?: number | null;
  priorityWeight: number;
};

export function validateTradeMiningSearchProfile(input: TradeMiningSearchProfileInput) {
  const errors: string[] = [];

  if (!input.name.trim()) {
    errors.push("Profile name is required.");
  }

  if (input.destinationPorts && input.destinationPorts.length > 0) {
    const unsupportedPorts = input.destinationPorts.filter(
      (port) => canonicalizeTradeMiningDestinationPort(port) === null
    );
    if (unsupportedPorts.length > 0) {
      errors.push(`Unsupported TradeMining destination ports: ${unsupportedPorts.join(", ")}.`);
    }
  }

  if (!Number.isInteger(input.lookbackWindowDays) || input.lookbackWindowDays < 1 || input.lookbackWindowDays > 365) {
    errors.push("Lookback window must be between 1 and 365 days.");
  }

  if (!Number.isInteger(input.minShipmentCount) || input.minShipmentCount < 0) {
    errors.push("Minimum shipment count must be zero or greater.");
  }

  if (input.minShipmentVolume != null && input.minShipmentVolume < 0) {
    errors.push("Minimum TEUs per BOL must be zero or greater when provided.");
  }

  if (input.minAggregateTeu != null && input.minAggregateTeu < 0) {
    errors.push("Minimum aggregate TEUs during the lookback must be zero or greater when provided.");
  }

  const industryPackIds = input.industryPackIds ?? [];
  const invalidIndustryPacks = industryPackIds.filter((value) => !isTradeMiningIndustryPackId(value));
  if (invalidIndustryPacks.length > 0) {
    errors.push(`Unsupported industry packs: ${invalidIndustryPacks.join(", ")}.`);
  }
  if (
    input.industryFilterMode &&
    !TRADEMINING_INDUSTRY_FILTER_MODES.includes(input.industryFilterMode)
  ) {
    errors.push("Industry mode must be HARD, PREFER, or EXCLUDE.");
  }
  if (
    industryPackIds.length === 0 &&
    input.industryFilterMode &&
    input.industryFilterMode !== "PREFER"
  ) {
    errors.push("Select at least one industry pack for hard or exclude mode.");
  }

  if (!Number.isInteger(input.priorityWeight) || input.priorityWeight < 0 || input.priorityWeight > 100) {
    errors.push("Priority weight must be an integer from 0 to 100.");
  }

  validateStringList("Destination markets", input.destinationMarkets, errors);
  validateStringList("Destination ports", input.destinationPorts, errors);
  validateStringList("Origin ports", input.originPorts, errors);
  validateStringList("Ship-from ports", input.shipFromPorts, errors);
  validateStringList("Origin countries", input.originCountries, errors);
  validateStringList("Product keywords", input.productKeywords, errors);
  validateStringList("HS codes", input.hsCodes, errors);
  validateStringList("Industry packs", input.industryPackIds, errors);
  validateStringList("Excluded company keywords", input.excludedCompanyKeywords, errors);

  if (!Array.isArray(input.allowedCompanyIdentityRoles) || input.allowedCompanyIdentityRoles.length === 0) {
    errors.push("Select at least one company identity role.");
  } else if (
    input.allowedCompanyIdentityRoles.some(
      (value) => !tradeMiningCompanyIdentityRoleOptions.some((option) => option.value === value)
    )
  ) {
    errors.push("One or more company identity roles are invalid.");
  }

  return errors;
}

export function assertValidTradeMiningSearchProfile(input: TradeMiningSearchProfileInput) {
  const errors = validateTradeMiningSearchProfile(input);

  if (errors.length > 0) {
    throw new Error(`Invalid TradeMining search profile: ${errors.join(" ")}`);
  }
}

function validateStringList(label: string, value: string[] | undefined, errors: string[]) {
  if (!value) {
    return;
  }

  if (!Array.isArray(value)) {
    errors.push(`${label} must be a list.`);
    return;
  }

  if (value.some((item) => !item.trim())) {
    errors.push(`${label} cannot contain blank values.`);
  }
}
