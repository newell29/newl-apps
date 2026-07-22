export type GarlandCarrierKey = "MIDLAND" | "SPEEDY" | "SURETRACK";

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
  signedCopyFileName: string | null;
  signedCopyUploadedAt: string | null;
  attachments: GarlandCarrierManifestAttachmentSummary[];
};

export type GarlandCarrierManifestHistoryResponse = {
  runs: GarlandCarrierManifestRunSummary[];
  totalCount: number;
};
