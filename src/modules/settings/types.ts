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
  contactDecisionMakerWeight: number;
  contactManagerWeight: number;
  contactLogisticsDepartmentWeight: number;
  contactWeakFunctionPenalty: number;
  contactCompanyContextWeight: number;
  contactEmailWeight: number;
  contactLinkedinWeight: number;
  contactPhoneWeight: number;
  contactPrimaryContactBoost: number;
  contactApprovedStatusBoost: number;
  contactReviewingStatusBoost: number;
  contactTier1Threshold: number;
  contactTier2Threshold: number;
  contactTier3Threshold: number;
  preferredContactTitleKeywords: string[];
  penalizedContactTitleKeywords: string[];
  preferredContactDepartments: string[];
  penalizedContactDepartments: string[];
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

export type ApolloCadenceAutomationMode = "AI_CUSTOM" | "APOLLO_AI" | "EMAIL_ONLY";

export type ApolloSequenceMappingTier = "TIER_1" | "TIER_2" | "TIER_3";

export type ApolloSequenceDirectoryEntry = {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
  description: string | null;
  lastUsedAt: string | null;
  automationMode: ApolloCadenceAutomationMode;
};

export type ApolloSequenceMappingEntry = {
  tier: ApolloSequenceMappingTier;
  label: string;
  apolloSequenceId: string | null;
  apolloSequenceName: string | null;
  automationMode: ApolloCadenceAutomationMode;
  requiresAiDraft: boolean;
  requiresRepAssignment: boolean;
  notes: string | null;
};

export type SearchProfileCadenceMappingEntry = {
  profileId: string;
  profileName: string;
  profileEnabled: boolean;
  destinationMarkets: string[];
  usesDefaultMapping: boolean;
  sequenceMapping: ApolloSequenceMappingEntry[];
};

export type TenantUserAccessEntry = {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
};

export type RoleAccessMatrixEntry = {
  role: string;
  label: string;
  description: string;
  visibilitySummary: string;
  canMutate: boolean;
  canMutateLocked: boolean;
  modules: Array<{
    key: string;
    name: string;
    enabled: boolean;
  }>;
};

export type AssistantProviderSettings = {
  provider: "OPENAI" | "LOCAL_LLM";
  liveResponsesEnabled: boolean;
  defaultModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
  endpointUrl: string | null;
  reasoningEffort: "none" | "low" | "medium" | "high" | null;
  apiKeyConfigured: boolean;
  status: IntegrationStatus;
  runtimeReady: boolean;
  runtimeNotes: string;
};

export const DEFAULT_TRADEMINING_SCORING_SETTINGS: TradeMiningScoringSettings = {
  recentWindowDays: 30,
  comparisonWindowDays: 30,
  lookbackWindowDays: 90,
  momentumWeight: 24,
  marketFitWeight: 22,
  industryFitWeight: 14,
  companySizeWeight: 15,
  roleWeight: 9,
  confidenceWeight: 8,
  workflowWeight: 4,
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
  oversizePenalty: 12,
  midMarketTeuMin: "2",
  midMarketTeuMax: "15",
  midMarketBoost: 6,
  contactDecisionMakerWeight: 20,
  contactManagerWeight: 12,
  contactLogisticsDepartmentWeight: 15,
  contactWeakFunctionPenalty: 6,
  contactCompanyContextWeight: 15,
  contactEmailWeight: 6,
  contactLinkedinWeight: 4,
  contactPhoneWeight: 2,
  contactPrimaryContactBoost: 6,
  contactApprovedStatusBoost: 3,
  contactReviewingStatusBoost: 2,
  contactTier1Threshold: 78,
  contactTier2Threshold: 58,
  contactTier3Threshold: 36,
  preferredContactTitleKeywords: [
    "owner",
    "founder",
    "chief",
    "president",
    "partner",
    "principal",
    "vp",
    "vice president",
    "head",
    "director"
  ],
  penalizedContactTitleKeywords: ["assistant", "coordinator", "analyst", "intern"],
  preferredContactDepartments: [
    "logistics",
    "supply chain",
    "transportation",
    "imports",
    "procurement",
    "purchasing",
    "warehouse",
    "distribution",
    "operations"
  ],
  penalizedContactDepartments: [
    "hr",
    "human resources",
    "legal",
    "finance",
    "accounting",
    "marketing",
    "communications",
    "it",
    "sales",
    "business development",
    "customer service"
  ],
  aiClassificationEnabled: false,
  aiModel: "gpt-5.4-mini"
};
