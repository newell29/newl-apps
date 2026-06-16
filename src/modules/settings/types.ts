import type { IntegrationProvider, IntegrationStatus } from "@prisma/client";

export type QuoteToolTarget = "SHIPMENT_RATE_QUOTE" | "PROSPECT_QUOTE";

export type ManagedQuoteSource = {
  id: string;
  displayName: string;
  carrierName: string;
  carrierCode: string;
  provider: IntegrationProvider | "CUSTOM";
  status: IntegrationStatus;
  readiness: "live" | "planned";
  selectable: boolean;
  sourceKind: "UPS_ACCOUNT" | "CARRIER_PLACEHOLDER";
  toolTargets: QuoteToolTarget[];
  shipperNumber?: string;
  originLabel?: string;
  originPostalCode?: string;
  originStateProvince?: string;
  notes?: string;
};

export type QuoteSourceDirectoryEntry = {
  id: string;
  displayName: string;
  carrierName: string;
  carrierCode: string;
  status: IntegrationStatus;
  readiness: "planned";
  toolTargets: QuoteToolTarget[];
  notes?: string;
};
