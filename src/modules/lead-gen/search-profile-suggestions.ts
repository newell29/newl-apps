export type SearchProfileSuggestionField =
  | "destinationMarkets"
  | "destinationPorts"
  | "originPorts"
  | "shipFromPorts"
  | "originCountries";

export type SearchProfileSuggestionOption = {
  value: string;
  label: string;
  searchText?: string;
};

export const tradeMiningCanadianProvinceOptions: SearchProfileSuggestionOption[] = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon"
].map((province) => ({
  value: `${province} | Canada`,
  label: `${province} | Canada (province)`,
  searchText: `${province} Canada province`
}));

const tradeMiningCanadianProvinceValues = new Set(
  tradeMiningCanadianProvinceOptions.map((option) => option.value.toLowerCase())
);

export function isTradeMiningCanadianProvinceDestination(value: string) {
  return tradeMiningCanadianProvinceValues.has(value.trim().toLowerCase());
}

export function isCanadianDestination(value: string) {
  const [, country = ""] = value.split("|");
  return country.trim().toLowerCase() === "canada";
}

export const tradeMiningUsDestinationPortOptions: SearchProfileSuggestionOption[] = [
  {
    value: "Area Port of Jacksonville, Florida",
    label: "Area Port of Jacksonville, Florida",
    searchText: "Jacksonville Florida JAX"
  },
  {
    value: "Charleston, South Carolina",
    label: "Charleston, South Carolina",
    searchText: "Charleston South Carolina SC CHS"
  },
  {
    value: "Freeport, Texas",
    label: "Freeport, Texas",
    searchText: "Freeport Texas TX"
  },
  {
    value: "Houston, Texas",
    label: "Houston, Texas",
    searchText: "Houston Seaport Texas TX HOU"
  },
  {
    value: "Norfolk-Newport News, Virginia",
    label: "Norfolk-Newport News, Virginia",
    searchText: "Norfolk Newport News Virginia VA"
  },
  {
    value: "Savannah, Georgia",
    label: "Savannah, Georgia",
    searchText: "Savannah Georgia GA SAV"
  },
  {
    value: "Wilmington, North Carolina",
    label: "Wilmington, North Carolina",
    searchText: "Wilmington North Carolina NC ILM"
  }
];

const destinationPortAliases = new Map<string, string>(
  [
    ["area port of jacksonville florida", "Area Port of Jacksonville, Florida"],
    ["jacksonville", "Area Port of Jacksonville, Florida"],
    ["jacksonville florida", "Area Port of Jacksonville, Florida"],
    ["jacksonville fl", "Area Port of Jacksonville, Florida"],
    ["charleston", "Charleston, South Carolina"],
    ["charleston south carolina", "Charleston, South Carolina"],
    ["charleston sc", "Charleston, South Carolina"],
    ["freeport", "Freeport, Texas"],
    ["freeport texas", "Freeport, Texas"],
    ["freeport tx", "Freeport, Texas"],
    ["houston", "Houston, Texas"],
    ["houston texas", "Houston, Texas"],
    ["houston tx", "Houston, Texas"],
    ["houston seaport", "Houston, Texas"],
    ["houston seaport texas", "Houston, Texas"],
    ["norfolk", "Norfolk-Newport News, Virginia"],
    ["norfolk newport news", "Norfolk-Newport News, Virginia"],
    ["norfolk newport news virginia", "Norfolk-Newport News, Virginia"],
    ["norfolk va", "Norfolk-Newport News, Virginia"],
    ["savannah", "Savannah, Georgia"],
    ["savannah georgia", "Savannah, Georgia"],
    ["savannah ga", "Savannah, Georgia"],
    ["wilmington", "Wilmington, North Carolina"],
    ["wilmington north carolina", "Wilmington, North Carolina"],
    ["wilmington nc", "Wilmington, North Carolina"]
  ].map(([alias, canonical]) => [normalizeSuggestionSearchText(alias), canonical])
);

export function canonicalizeTradeMiningDestinationPort(value: string) {
  const undecorated = value.split("|")[0]?.trim() ?? value.trim();
  return destinationPortAliases.get(normalizeSuggestionSearchText(undecorated)) ?? null;
}

export function filterSuggestionOptions(
  options: SearchProfileSuggestionOption[],
  query: string,
  limit = 10
) {
  const normalizedQuery = normalizeSuggestionSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  return options
    .filter((option) => normalizeSuggestionSearchText(option.searchText ?? option.label).includes(normalizedQuery))
    .sort((left, right) => scoreSuggestionMatch(left, normalizedQuery) - scoreSuggestionMatch(right, normalizedQuery))
    .slice(0, limit)
    .map(({ value, label }) => ({ value, label }));
}

export function mergeSuggestionOptions(
  primary: SearchProfileSuggestionOption[],
  secondary: SearchProfileSuggestionOption[]
) {
  const seen = new Set<string>();
  const merged: SearchProfileSuggestionOption[] = [];

  for (const option of [...secondary, ...primary]) {
    const key = `${option.value.toLowerCase()}::${option.label.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(option);
  }

  return merged;
}

export function normalizeSearchProfileValueForWorker(
  field: SearchProfileSuggestionField,
  value: string
) {
  const normalized = value.trim();

  if (!normalized) {
    return normalized;
  }

  if (field === "originCountries") {
    return normalized.replace(/\s+\([A-Z]{2,3}\)$/u, "").trim();
  }

  if (field === "destinationPorts") {
    return canonicalizeTradeMiningDestinationPort(normalized) ?? normalized;
  }

  if (field === "destinationMarkets") {
    return normalized;
  }

  if (!normalized.includes("|")) {
    return normalized;
  }

  const [left] = normalized.split("|");
  return left?.trim() ?? normalized;
}

export function toTenantSuggestionOptions(values: string[]) {
  return values.map((value) => {
    const normalizedValue = value.trim();
    const isUsStateLocation =
      !normalizedValue.includes("|") && /,\s*[A-Z]{2}$/u.test(normalizedValue) && /[A-Za-z]/u.test(normalizedValue);
    const label = isUsStateLocation ? `${normalizedValue} | United States` : normalizedValue;
    const searchText = isUsStateLocation ? `${normalizedValue} United States US` : normalizedValue;

    return {
      value: normalizedValue,
      label,
      searchText
    };
  });
}

function scoreSuggestionMatch(option: SearchProfileSuggestionOption, normalizedQuery: string) {
  const normalizedLabel = normalizeSuggestionSearchText(option.label);
  const normalizedValue = normalizeSuggestionSearchText(option.value);
  const normalizedSearchText = normalizeSuggestionSearchText(option.searchText ?? option.label);

  if (normalizedLabel.startsWith(normalizedQuery) || normalizedValue.startsWith(normalizedQuery)) {
    return 0;
  }

  if (normalizedLabel.includes(` ${normalizedQuery}`) || normalizedValue.includes(` ${normalizedQuery}`)) {
    return 1;
  }

  if (normalizedSearchText.includes(normalizedQuery)) {
    return 2;
  }

  return 3;
}

function normalizeSuggestionSearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
