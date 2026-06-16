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

export type ProspectItem = {
  length: number;
  width: number;
  height: number;
  weight: number;
};
