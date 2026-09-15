import generated from "@/modules/supply-chain-design/reference-data/us-zcta-centroids.generated.json";

export const CENSUS_ZCTA_2025_COORDINATE_SOURCE = "CENSUS_ZCTA_2025";

export type NewlUsZipCentroidMetadata = {
  sourceOrganization: string;
  sourceUrl: string;
  sourceYear: number;
  retrievedAt: string;
  recordCount: number;
  generatedFileVersion: string;
  sourceArchiveSha256: string;
};

export type NewlUsZipCentroid = {
  zipCode: string;
  latitude: number;
  longitude: number;
  sourceVersion: string;
};

export type UsZipNormalizationResult =
  | { ok: true; zipCode: string }
  | { ok: false; reason: "MALFORMED_ZIP"; sourceValue: string };

type GeneratedReference = {
  metadata: NewlUsZipCentroidMetadata;
  records: Array<[string, number, number]>;
};

const reference = generated as GeneratedReference;
let indexedCentroids: Map<string, NewlUsZipCentroid> | null = null;

export const NEWL_US_ZIP_CENTROID_PROOF_FIXTURE: NewlUsZipCentroid[] = [
  zip("28202", 35.2271, -80.8431),
  zip("30303", 33.7525, -84.3915),
  zip("32801", 28.541, -81.375),
  zip("37219", 36.1667, -86.7833),
  zip("60601", 41.8864, -87.6186),
  zip("75201", 32.7876, -96.7994),
  zip("77002", 29.756, -95.365),
  zip("78205", 29.4241, -98.4936),
  zip("78701", 30.2711, -97.7437),
  zip("85004", 33.451, -112.069),
  zip("90012", 34.0614, -118.239),
  zip("98101", 47.6101, -122.3344)
];

export function normalizeUsZipCode(raw: string): UsZipNormalizationResult {
  const trimmed = raw.trim();
  if (/^\d{5}$/.test(trimmed)) {
    return { ok: true, zipCode: trimmed };
  }
  const zipPlusFour = trimmed.match(/^(\d{5})-\d{4}$/);
  if (zipPlusFour) {
    return { ok: true, zipCode: zipPlusFour[1] };
  }
  return { ok: false, reason: "MALFORMED_ZIP", sourceValue: raw };
}

export function resolveUsZipCentroid(rawZipCode: string): NewlUsZipCentroid | null {
  const normalized = normalizeUsZipCode(rawZipCode);
  if (!normalized.ok) return null;
  return getIndexedCentroids().get(normalized.zipCode) ?? null;
}

export function getUsZipCentroidReferenceMetadata(): NewlUsZipCentroidMetadata {
  return reference.metadata;
}

export function getUsZipCentroidReferenceRecords(): NewlUsZipCentroid[] {
  return [...getIndexedCentroids().values()];
}

function getIndexedCentroids() {
  if (!indexedCentroids) {
    indexedCentroids = new Map(
      reference.records.map(([zipCode, latitude, longitude]) => [
        zipCode,
        {
          zipCode,
          latitude,
          longitude,
          sourceVersion: reference.metadata.generatedFileVersion
        }
      ])
    );
  }
  return indexedCentroids;
}

function zip(zipCode: string, latitude: number, longitude: number): NewlUsZipCentroid {
  return {
    zipCode,
    latitude,
    longitude,
    sourceVersion: CENSUS_ZCTA_2025_COORDINATE_SOURCE
  };
}
