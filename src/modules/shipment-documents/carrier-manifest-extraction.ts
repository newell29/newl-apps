export const MANIFEST_CROP_BOXES = [
  { label: "Header overview", x: 0, y: 0, width: 1, height: 0.18, layout: "full" },
  {
    label: "Package rows and authoritative Total: N PALLETS line",
    x: 0,
    y: 0.5,
    width: 1,
    height: 0.47,
    layout: "full"
  },
  { label: "Carrier box", x: 0.02, y: 0.105, width: 0.42, height: 0.085, layout: "half" },
  { label: "References and shipment id", x: 0.6, y: 0.065, width: 0.38, height: 0.13, layout: "half" },
  { label: "Consignee city/province", x: 0.48, y: 0.23, width: 0.48, height: 0.13, layout: "half" }
] as const;

export type ManifestSkidEvidence =
  | "TOTAL_LINE"
  | "EXPLICIT_TOTAL"
  | "PACKAGE_LINE_SUM"
  | "GENERIC"
  | "NONE";

export type ManifestSkidResolution = {
  skids: number | null;
  evidence: ManifestSkidEvidence;
};

const EVIDENCE_RANK: Record<ManifestSkidEvidence, number> = {
  NONE: 0,
  GENERIC: 1,
  PACKAGE_LINE_SUM: 2,
  EXPLICIT_TOTAL: 3,
  TOTAL_LINE: 4
};

export function resolveManifestSkids(record: Record<string, unknown>): ManifestSkidResolution {
  const totalLine = readFirstValue(record, [
    "packageTotalText",
    "palletTotalText",
    "authoritativeTotalText",
    "totalLine",
    "packageTotalLine"
  ]);
  const totalLineSkids = parseAuthoritativePalletTotal(totalLine);

  if (totalLineSkids !== null) {
    return { skids: totalLineSkids, evidence: "TOTAL_LINE" };
  }

  const explicitTotal = normalizeSkidValue(
    readFirstValue(record, ["totalPallets", "totalSkids", "packageTotal"])
  );

  if (explicitTotal !== null) {
    return { skids: explicitTotal, evidence: "EXPLICIT_TOTAL" };
  }

  const packageLineSum = sumPackageLineCounts(
    readFirstValue(record, ["packageLineCounts", "palletLineCounts", "printedPalletCounts"])
  );

  if (packageLineSum !== null) {
    return { skids: packageLineSum, evidence: "PACKAGE_LINE_SUM" };
  }

  const genericSkids = normalizeSkidValue(
    readFirstValue(record, ["skids", "pallets", "pallet", "palletCount"])
  );

  return genericSkids === null
    ? { skids: null, evidence: "NONE" }
    : { skids: genericSkids, evidence: "GENERIC" };
}

export function choosePreferredManifestSkids(
  current: ManifestSkidResolution,
  candidate: ManifestSkidResolution
) {
  return EVIDENCE_RANK[candidate.evidence] > EVIDENCE_RANK[current.evidence] ? candidate : current;
}

export function parseAuthoritativePalletTotal(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/\b(?:grand\s+)?total\s*:?\s*(\d+)\s*(?:pallets?|skids?|plt)\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function sumPackageLineCounts(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const counts = value.map(normalizeSkidValue);

  if (counts.some((count) => count === null)) {
    return null;
  }

  return (counts as number[]).reduce((total, count) => total + count, 0);
}

function normalizeSkidValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string") {
    const match = value.match(/\d+/);
    return match ? Number.parseInt(match[0], 10) : null;
  }

  return null;
}

function readFirstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}
