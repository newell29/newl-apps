import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_URL = "https://raw.githubusercontent.com/datasets/un-locode/master/data/code-list.csv";

async function main() {
  const response = await fetch(SOURCE_URL);

  if (!response.ok) {
    throw new Error(`Failed to download UN/LOCODE source: ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();
  const rows = parseCsv(csv);
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  const countries = new Map<string, SuggestionOption>();
  const ports = new Map<string, SuggestionOption>();
  const locations = new Map<string, SuggestionOption>();

  for (const row of rows) {
    const countryCode = row.Country?.trim();
    const name = row.Name?.trim() || row.NameWoDiacritics?.trim();
    const nameWoDiacritics = row.NameWoDiacritics?.trim() || name;
    const subdivision = row.SubDiv?.trim();
    const locationCode = row.Location?.trim();
    const functionCode = row.Function?.trim() ?? "";

    if (countryCode) {
      const countryName = displayNames.of(countryCode.toUpperCase());
      if (countryName) {
        const label = `${countryName} (${countryCode.toUpperCase()})`;
        countries.set(countryName.toLowerCase(), {
          value: label,
          label,
          searchText: [countryName, countryCode].filter(Boolean).join(" ")
        });
      }
    }

    if (!name) {
      continue;
    }

    const countryName = countryCode ? displayNames.of(countryCode.toUpperCase()) : undefined;
    const label = [name, subdivision].filter(Boolean).join(", ");
    const decoratedLabel = countryName ? `${label} | ${countryName}` : label;
    const searchText = [
      name,
      nameWoDiacritics,
      subdivision,
      countryName,
      countryCode,
      locationCode
    ]
      .filter(Boolean)
      .join(" ");

    if (hasTransportFunction(functionCode)) {
      locations.set(
        `${decoratedLabel.toLowerCase()}::${locationCode ?? ""}`,
        {
          value: decoratedLabel,
          label: decoratedLabel,
          searchText
        }
      );
    }

    if (hasPortFunction(functionCode)) {
      ports.set(
        `${decoratedLabel.toLowerCase()}::${locationCode ?? ""}`,
        {
          value: decoratedLabel,
          label: decoratedLabel,
          searchText
        }
      );
    }
  }

  const output = {
    metadata: {
      source: SOURCE_URL,
      generatedAt: new Date().toISOString()
    },
    countries: sortValues(countries),
    ports: sortValues(ports),
    locations: sortValues(locations)
  };

  const outputPath = path.join(process.cwd(), "src", "data", "canonical-trademining-reference.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(
    `Wrote canonical TradeMining reference to ${outputPath} (${output.countries.length} countries, ${output.ports.length} ports, ${output.locations.length} locations)`
  );
}

function hasPortFunction(functionCode: string) {
  return functionCode.charAt(0) === "1";
}

function hasTransportFunction(functionCode: string) {
  return ["1", "2", "3", "4"].some((flag, index) => functionCode.charAt(index) === flag);
}

function sortValues(values: Map<string, SuggestionOption>) {
  return [...values.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...dataRows] = rows;
  return dataRows.map((dataRow) =>
    Object.fromEntries(header.map((column, index) => [column, dataRow[index] ?? ""]))
  ) as Array<Record<string, string>>;
}

type SuggestionOption = {
  value: string;
  label: string;
  searchText: string;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
