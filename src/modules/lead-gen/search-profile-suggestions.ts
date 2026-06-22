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
