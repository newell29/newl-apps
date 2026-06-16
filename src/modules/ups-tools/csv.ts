export function parseCsv(text: string): Array<Record<string, string>> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const rows = splitCsvRows(normalized);
  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  const headers = parseCsvLine(headerRow).map((value) => value.trim());

  return dataRows
    .map((row) => parseCsvLine(row))
    .filter((values) => values.some((value) => value.trim().length > 0))
    .map((values) =>
      headers.reduce<Record<string, string>>((record, header, index) => {
        record[header] = values[index]?.trim() ?? "";
        return record;
      }, {})
    );
}

export function toCsv(rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCsvValue(row[header]))
        .join(",")
    )
  ];

  return lines.join("\n");
}

function splitCsvRows(text: string) {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\"") {
      if (inQuotes && text[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "\n" && !inQuotes) {
      rows.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    rows.push(current);
  }

  return rows;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function escapeCsvValue(value: string | number | undefined) {
  const stringValue = String(value ?? "");
  if (!/[,"\n]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, "\"\"")}"`;
}
