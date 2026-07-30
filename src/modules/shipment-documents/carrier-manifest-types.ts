export const GARLAND_CARRIERS = ["MIDLAND", "SPEEDY", "SURETRACK", "CLARKE"] as const;

export type GarlandCarrierKey = (typeof GARLAND_CARRIERS)[number];

export const GARLAND_CARRIER_LABELS: Record<GarlandCarrierKey, string> = {
  MIDLAND: "Midland",
  SPEEDY: "Speedy",
  SURETRACK: "Suretrack",
  CLARKE: "Clarke"
};

export type GarlandCarrierManifestRow = {
  carrier: GarlandCarrierKey;
  pageNumber: number;
  srNumber: string;
  psNumber: string;
  cityProvince: string;
  skids: number | null;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  notes: string | null;
};

export type GarlandCarrierManifestAttachmentSummary = {
  id: string | null;
  fileName: string;
  uploadedAt: string;
  isLegacySignedCopy: boolean;
};

export type GarlandCarrierManifestRunSummary = {
  id: string;
  documentLabel: string;
  shipmentDate: string;
  sourceBolFileName: string | null;
  carrierCounts: Record<GarlandCarrierKey, number>;
  createdAt: string;
  createdByName: string | null;
  hasMidlandWorkbook: boolean;
  hasSpeedyWorkbook: boolean;
  hasSuretrackWorkbook: boolean;
  hasClarkeWorkbook: boolean;
  signedCopyFileName: string | null;
  signedCopyUploadedAt: string | null;
  attachments: GarlandCarrierManifestAttachmentSummary[];
};

export type GarlandCarrierManifestHistoryResponse = {
  runs: GarlandCarrierManifestRunSummary[];
  totalCount: number;
};

export function isGarlandCarrierKey(value: unknown): value is GarlandCarrierKey {
  return typeof value === "string" && GARLAND_CARRIERS.includes(value as GarlandCarrierKey);
}

export function normalizeGarlandCarrier(value: unknown): GarlandCarrierKey | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, "").toUpperCase();

  if (normalized.includes("MIDLAND")) {
    return "MIDLAND";
  }

  if (normalized.includes("SPEEDY")) {
    return "SPEEDY";
  }

  if (normalized.includes("SURETRACK") || normalized.includes("SURETRAK")) {
    return "SURETRACK";
  }

  if (normalized.includes("CLARKE")) {
    return "CLARKE";
  }

  return null;
}

export function buildGarlandCarrierCounts(
  rows: GarlandCarrierManifestRow[]
): Record<GarlandCarrierKey, number> {
  return GARLAND_CARRIERS.reduce(
    (counts, carrier) => {
      counts[carrier] = rows.filter((row) => row.carrier === carrier).length;
      return counts;
    },
    {} as Record<GarlandCarrierKey, number>
  );
}
