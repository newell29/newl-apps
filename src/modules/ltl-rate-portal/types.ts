export type SevenLCarrierConfig = {
  carrierHash: string;
  name: string;
  code: string;
  scac: string;
  defaulted: boolean;
  enabled: boolean;
};

export type SevenLAccountConfig = {
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED" | "ERROR";
  baseUrl: string;
  defaultUom: "US" | "METRIC" | "MIXED";
  strictResult: boolean;
  harmonizedCharges: boolean;
  dryRun: boolean;
  carrierMode: "TENANT_SELECTED" | "ALL_DEFAULT";
  carriers: SevenLCarrierConfig[];
  secretConfigured: boolean;
};

export type LtlCountryCode = "US" | "CA" | "MX";
export type LtlUom = "US" | "METRIC" | "MIXED";

export type LtlFreightPiece = {
  qty: number;
  weight: number;
  weightType: "each" | "total";
  length: number;
  width: number;
  height: number;
  dimType: "CTN" | "PLT" | "CRT" | "CON" | "CYL" | "DRM" | "ENV" | "BOX" | "BDL";
  freightClass: string;
  hazmat: boolean;
  unNumber?: string;
  nmfc?: string;
  stack: boolean;
  stackAmount?: number;
  commodity?: string;
};

export type LtlQuoteRequest = {
  customerReference: string;
  originCity: string;
  originState: string;
  originZipcode: string;
  originCountry: LtlCountryCode;
  destinationCity: string;
  destinationState: string;
  destinationZipcode: string;
  destinationCountry: LtlCountryCode;
  pickupDate: string;
  uom: LtlUom;
  accessorialCodes: string[];
  pieces: LtlFreightPiece[];
};

export type LtlQuoteResult = LtlQuoteRequest & {
  carrierHash: string;
  carrierName: string;
  carrierCode: string;
  scac: string;
  serviceLevel: string;
  transitDays: number;
  quoteNumber: string;
  total: number;
  fuelCharge: number;
  accessorialCharge: number;
  linehaulCharge: number;
  rateRemarks: string[];
  mode: "dry-run" | "live";
};

export type LtlCarrierErrorResult = LtlQuoteRequest & {
  carrierHash: string;
  carrierName: string;
  carrierCode: string;
  scac: string;
  errorMessage: string;
  mode: "dry-run" | "live";
};

export type LtlRateQuoteResponsePayload = {
  data: LtlQuoteResult[];
  errors: LtlCarrierErrorResult[];
};

export type LtlRateQuoteRequestPayload = {
  accountId: string;
  carrierHashes: string[];
  rows: LtlQuoteRequest[];
};

export type LtlBulkQuoteJobStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";

export type LtlBulkQuoteJobSummary = {
  id: string;
  status: LtlBulkQuoteJobStatus;
  name: string | null;
  accountId: string;
  accountName: string;
  selectedCarrierCount: number;
  totalLanes: number;
  processedLanes: number;
  quotedLanes: number;
  issueLanes: number;
  quoteCount: number;
  errorCount: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type LtlBulkQuoteLaneResult = {
  laneIndex: number;
  customerReference: string;
  request: LtlQuoteRequest;
  quotes: LtlQuoteResult[];
  errors: LtlCarrierErrorResult[];
  quoteCount: number;
  errorCount: number;
};

export type LtlBulkQuoteJobDetail = {
  job: LtlBulkQuoteJobSummary;
  lanes: LtlBulkQuoteLaneResult[];
};

export type LtlBulkQuoteCreateRequestPayload = {
  name?: string;
  accountId: string;
  carrierHashes: string[];
  rows: LtlQuoteRequest[];
};

export type LtlBulkQuoteCreateResponsePayload = {
  job: LtlBulkQuoteJobSummary;
};
