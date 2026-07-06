export type ShipmentDocumentType = "BOL" | "PICK_TICKET";

export const PS_NUMBER_PATTERN = /\bPS[-\s]?(\d{5,8})\b/i;

export function extractPsNumberFromText(text: string | null | undefined) {
  if (!text) {
    return null;
  }

  const compact = text.replace(/\s+/g, " ").trim();
  const match = compact.match(PS_NUMBER_PATTERN);

  if (!match) {
    return null;
  }

  return `PS${match[1]}`;
}

export function normalizePsNumber(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/^PS(\d{5,8})$/);

  if (!match) {
    return null;
  }

  return `PS${match[1]}`;
}

export function comparePsNumbers(a: string, b: string) {
  return readPsNumericValue(a) - readPsNumericValue(b);
}

export function readPsNumericValue(value: string) {
  const normalized = normalizePsNumber(value);
  return normalized ? Number.parseInt(normalized.slice(2), 10) : Number.POSITIVE_INFINITY;
}

export function formatHumanDateFromIso(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00`);

  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function sanitizeLabelForFilename(label: string) {
  const cleaned = label
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ");

  return cleaned.length > 0 ? cleaned : "Shipment Documents";
}
