import type { QuoteToolTarget } from "@/modules/settings/types";

export type UpsAccountConfig = {
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED" | "ERROR";
  countryCode: "US" | "CA";
  shipperNumber: string;
  originPostalCode: string;
  originLabel: string;
  originStateProvince?: string;
  dryRun: boolean;
  secretConfigured: boolean;
  toolTargets: QuoteToolTarget[];
};

export type UpsServiceName =
  | "Ground"
  | "2nd Day Air"
  | "Next Day Air"
  | "Next Day Air Saver"
  | "3 Day Select";

export type QuoteRequest = {
  shipmentReference?: string;
  originPostalCode: string;
  originCountryCode: "US" | "CA";
  destinationPostalCode: string;
  destinationCountryCode: "US" | "CA";
  weight: number;
  length: number;
  width: number;
  height: number;
  service: UpsServiceName;
  isResidential: boolean;
};

export type QuoteResult = QuoteRequest & {
  dims: string;
  billableWeight: number;
  standardRate: number;
  negotiatedRate: number;
  taxAmount: number;
  totalWithTax: number;
  transitDays: number;
  destinationProvince: string;
  accountId: string;
  accountName: string;
  accountShipperNumber: string;
  mode: "dry-run" | "live";
  error?: string;
};

export type UpsQuoteIssue = QuoteRequest & {
  accountId: string;
  accountName: string;
  accountShipperNumber: string;
  mode: "dry-run" | "live";
  errorMessage: string;
};

export type ProspectItem = {
  length: number;
  width: number;
  height: number;
  weight: number;
};

export type UpsInputRow = {
  OriginZIP?: string;
  DestinationZIP?: string;
  Weight?: string;
  Length?: string;
  Width?: string;
  Height?: string;
  CustomerOrderNumber?: string;
  ShipmentID?: string;
  ShipmentReference?: string;
} & Record<string, string | undefined>;

export type UpsBulkQuoteJobSummary = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";
  name: string | null;
  accountIds: string[];
  accountNames: string[];
  services: UpsServiceName[];
  rowCount: number;
  accountCount: number;
  serviceCount: number;
  totalRequestCount: number;
  processedRequestCount: number;
  quoteCount: number;
  issueCount: number;
  chunkSize: number;
  chunkCount: number;
  requestConcurrency: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type UpsBulkQuoteJobDetail = {
  job: UpsBulkQuoteJobSummary;
  rows: UpsInputRow[];
  results: QuoteResult[];
  issues: UpsQuoteIssue[];
  isResidential: boolean;
};
