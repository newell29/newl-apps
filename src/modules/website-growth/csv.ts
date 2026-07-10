export type CsvRow = Record<string, string>;

export function parseDelimitedRows(input: string): CsvRow[] {
  const text = input.trim();

  if (!text) {
    return [];
  }

  const delimiter = detectDelimiter(text);
  const records = parseRecords(text, delimiter);
  const [headerRecord, ...dataRecords] = records;

  if (!headerRecord || headerRecord.length === 0) {
    return [];
  }

  const headers = headerRecord.map(normalizeHeader);

  return dataRecords
    .filter((record) => record.some((value) => value.trim() !== ""))
    .map((record) => {
      const row: CsvRow = {};

      headers.forEach((header, index) => {
        row[header] = record[index]?.trim() ?? "";
      });

      return row;
    });
}

export function normalizeHeader(value: string) {
  return value
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function readNumber(row: CsvRow, keys: string[]): number | null {
  for (const key of keys) {
    const raw = row[normalizeHeader(key)];

    if (raw === undefined || raw === "") {
      continue;
    }

    const parsed = Number(raw.replaceAll(",", "").replace("%", ""));

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function readString(row: CsvRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[normalizeHeader(key)]?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const tabCount = (firstLine.match(/\t/g) ?? []).length;

  return tabCount > commaCount ? "\t" : ",";
}

function parseRecords(text: string, delimiter: string) {
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      currentValue += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      currentRecord.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      currentRecord.push(currentValue);
      records.push(currentRecord);
      currentRecord = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  currentRecord.push(currentValue);
  records.push(currentRecord);

  return records;
}
