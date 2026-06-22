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

export type TradeMiningScoringSettings = {
  recentWindowDays: number;
  comparisonWindowDays: number;
  lookbackWindowDays: number;
  momentumWeight: number;
  marketFitWeight: number;
  industryFitWeight: number;
  companySizeWeight: number;
  roleWeight: number;
  confidenceWeight: number;
  workflowWeight: number;
  preferredOriginCountries: string[];
  penalizedOriginCountries: string[];
  preferredOriginPorts: string[];
  penalizedOriginPorts: string[];
  preferredDestinationMarkets: string[];
  penalizedDestinationMarkets: string[];
  preferredIndustryKeywords: string[];
  penalizedIndustryKeywords: string[];
  preferredHsCodePrefixes: string[];
  penalizedHsCodePrefixes: string[];
  oversizeTeuThreshold: string | null;
  oversizeShipmentCount30dThreshold: number | null;
  oversizePenalty: number;
  midMarketTeuMin: string | null;
  midMarketTeuMax: string | null;
  midMarketBoost: number;
  aiClassificationEnabled: boolean;
  aiModel: string | null;
};

export type ApolloRepMappingEntry = {
  id: string;
  sequenceOwnerName: string;
  apolloUserId: string | null;
  sendFromEmail: string | null;
  sendFromEmailAccountId: string | null;
  active: boolean;
};

export const DEFAULT_TRADEMINING_SCORING_SETTINGS: TradeMiningScoringSettings = {
  recentWindowDays: 30,
  comparisonWindowDays: 30,
  lookbackWindowDays: 90,
  momentumWeight: 30,
  marketFitWeight: 20,
  industryFitWeight: 15,
  companySizeWeight: 15,
  roleWeight: 10,
  confidenceWeight: 5,
  workflowWeight: 5,
  preferredOriginCountries: ["italy", "germany", "spain", "poland", "netherlands"],
  penalizedOriginCountries: ["china"],
  preferredOriginPorts: [],
  penalizedOriginPorts: [],
  preferredDestinationMarkets: [],
  penalizedDestinationMarkets: [],
  preferredIndustryKeywords: ["furniture", "fixtures", "building materials"],
  penalizedIndustryKeywords: ["customs broker", "freight forwarder", "steamship", "carrier"],
  preferredHsCodePrefixes: ["9403", "9405", "3926"],
  penalizedHsCodePrefixes: [],
  oversizeTeuThreshold: "30",
  oversizeShipmentCount30dThreshold: 18,
  oversizePenalty: 10,
  midMarketTeuMin: "2",
  midMarketTeuMax: "15",
  midMarketBoost: 6,
  aiClassificationEnabled: false,
  aiModel: "gpt-5-mini"
};
