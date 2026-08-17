import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const SOURCE_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip";
const SOURCE_ORGANIZATION = "U.S. Census Bureau";
const SOURCE_YEAR = 2025;
const GENERATED_VERSION = "CENSUS_ZCTA_2025";
const OUTPUT_PATH = resolve(
  process.cwd(),
  "src/modules/supply-chain-design/reference-data/us-zcta-centroids.generated.json"
);

type ZipEntry = {
  fileName: string;
  bytes: Buffer;
};

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Unable to download Census ZCTA Gazetteer archive: HTTP ${response.status}.`);
  }

  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.subarray(0, 4).toString("binary") !== "PK\u0003\u0004") {
    throw new Error("Downloaded Census response is not a valid ZIP archive.");
  }

  const checksum = createHash("sha256").update(archive).digest("hex");
  const entries = extractZipEntries(archive);
  const textEntry = entries.find((entry) => /gaz_zcta.*\.txt$/i.test(entry.fileName));
  if (!textEntry) {
    throw new Error("Expected Census ZCTA text file was not found in the downloaded archive.");
  }

  const records = parseGazetteer(textEntry.bytes.toString("utf8"));
  const generated = {
    metadata: {
      sourceOrganization: SOURCE_ORGANIZATION,
      sourceUrl: SOURCE_URL,
      sourceYear: SOURCE_YEAR,
      retrievedAt: new Date().toISOString(),
      recordCount: records.length,
      generatedFileVersion: GENERATED_VERSION,
      sourceArchiveSha256: checksum
    },
    records
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(generated)}\n`, "utf8");

  console.log("SCDS U.S. ZIP/ZCTA centroid reference updated.");
  console.log(`Source: ${SOURCE_URL}`);
  console.log(`Source year: ${SOURCE_YEAR}`);
  console.log(`Archive SHA-256: ${checksum}`);
  console.log(`Records imported: ${records.length}`);
  console.log(`Generated file: ${OUTPUT_PATH}`);
}

function parseGazetteer(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = lines[0].split("|").map((header) => header.replace(/^\uFEFF/, "").trim());
  const geoidIndex = headers.indexOf("GEOID");
  const latitudeIndex = headers.indexOf("INTPTLAT");
  const longitudeIndex = headers.indexOf("INTPTLONG");
  if (geoidIndex < 0 || latitudeIndex < 0 || longitudeIndex < 0) {
    throw new Error("Census ZCTA file is missing GEOID, INTPTLAT, or INTPTLONG columns.");
  }

  const seen = new Set<string>();
  const records: Array<[string, number, number]> = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split("|").map((cell) => cell.trim());
    const zipCode = cells[geoidIndex];
    const latitude = Number(cells[latitudeIndex]);
    const longitude = Number(cells[longitudeIndex]);
    if (!/^\d{5}$/.test(zipCode) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(`Malformed Census ZCTA row at data row ${index + 2}.`);
    }
    if (seen.has(zipCode)) {
      throw new Error(`Duplicate Census ZCTA code ${zipCode}.`);
    }
    seen.add(zipCode);
    records.push([zipCode, latitude, longitude]);
  }

  return records.sort((left, right) => left[0].localeCompare(right[0]));
}

function extractZipEntries(archive: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset < archive.length) {
    const signature = archive.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) {
      break;
    }
    if (signature !== 0x04034b50) {
      throw new Error("ZIP archive contains an unexpected local-file signature.");
    }

    const compressionMethod = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraFieldLength = archive.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileName = archive.subarray(fileNameStart, fileNameStart + fileNameLength).toString("utf8");
    const dataStart = fileNameStart + fileNameLength + extraFieldLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);

    if (!fileName.endsWith("/")) {
      const bytes =
        compressionMethod === 0
          ? compressed
          : compressionMethod === 8
            ? inflateRawSync(compressed)
            : (() => {
                throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${fileName}.`);
              })();
      entries.push({ fileName, bytes });
    }

    offset = dataStart + compressedSize;
  }
  return entries;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
