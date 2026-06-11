const allowedScheduleFrequencies = new Set(["daily", "weekly", "manual"]);

export type TradeMiningSearchProfileInput = {
  name: string;
  destinationMarkets: string[];
  destinationPorts?: string[];
  originPorts?: string[];
  shipFromPorts?: string[];
  originCountries?: string[];
  productKeywords?: string[];
  hsCodes?: string[];
  lookbackWindowDays: number;
  minShipmentCount: number;
  minShipmentVolume?: number | null;
  scheduleFrequency: string;
  priorityWeight: number;
};

export function validateTradeMiningSearchProfile(input: TradeMiningSearchProfileInput) {
  const errors: string[] = [];

  if (!input.name.trim()) {
    errors.push("Profile name is required.");
  }

  if (input.destinationMarkets.length === 0) {
    errors.push("At least one destination market or port is required.");
  }

  if (!Number.isInteger(input.lookbackWindowDays) || input.lookbackWindowDays < 1 || input.lookbackWindowDays > 365) {
    errors.push("Lookback window must be between 1 and 365 days.");
  }

  if (!Number.isInteger(input.minShipmentCount) || input.minShipmentCount < 0) {
    errors.push("Minimum shipment count must be zero or greater.");
  }

  if (input.minShipmentVolume != null && input.minShipmentVolume < 0) {
    errors.push("Minimum shipment volume must be zero or greater when provided.");
  }

  if (!allowedScheduleFrequencies.has(input.scheduleFrequency)) {
    errors.push("Schedule frequency must be daily, weekly, or manual.");
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
