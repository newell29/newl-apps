import { IntegrationProvider, IntegrationStatus, OceanEquipmentType, OceanExtractionStatus } from "@prisma/client";

export type OceanFreightAutomationSettings = {
  classificationEnabled: boolean;
  extractionEnabled: boolean;
  exceptionOnlyReview: boolean;
  highConfidenceThreshold: number;
  autoPostEnabled: boolean;
  autoPostMinimumConfidence: number;
  trustedAgentOnlyAutoPost: boolean;
  requireValidityEndDate: boolean;
  classificationModel: string;
};

type SettingsCredential = {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  publicConfig: unknown;
} | null | undefined;

type CandidateForDisposition = {
  status: OceanExtractionStatus;
  confidence: number;
  agentId: string | null;
  originPort: string | null;
  destinationPort: string | null;
  equipmentType: OceanEquipmentType | null;
  rateAmount: unknown | null;
  currency: string | null;
  validityEndDate: Date | null;
  sourceEmail?: { rateDetected: boolean; fromAddress: string | null; mailboxAddress: string } | null;
};

export const DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS: OceanFreightAutomationSettings = {
  classificationEnabled: true,
  extractionEnabled: false,
  exceptionOnlyReview: true,
  highConfidenceThreshold: 80,
  autoPostEnabled: false,
  autoPostMinimumConfidence: 92,
  trustedAgentOnlyAutoPost: true,
  requireValidityEndDate: true,
  classificationModel: "gpt-5-nano"
};

export function parseOceanFreightAutomationSettings(credential?: SettingsCredential): OceanFreightAutomationSettings {
  const config = credential?.publicConfig && typeof credential.publicConfig === "object"
    ? credential.publicConfig as Record<string, unknown>
    : {};

  return {
    classificationEnabled: readBoolean(config.oceanClassificationEnabled, DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS.classificationEnabled),
    extractionEnabled: readBoolean(config.oceanExtractionEnabled, DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS.extractionEnabled),
    exceptionOnlyReview: readBoolean(config.oceanExceptionOnlyReview, DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS.exceptionOnlyReview),
    highConfidenceThreshold: readInteger(config.oceanHighConfidenceThreshold, DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS.highConfidenceThreshold, 1, 100),
    autoPostEnabled: readBoolean(config.oceanAutoPostEnabled, DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS.autoPostEnabled),
    autoPostMinimumConfidence: readInteger(config.oceanAutoPostMinimumConfidence, DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS.autoPostMinimumConfidence, 1, 100),
    trustedAgentOnlyAutoPost: readBoolean(config.oceanTrustedAgentOnlyAutoPost, DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS.trustedAgentOnlyAutoPost),
    requireValidityEndDate: readBoolean(config.oceanRequireValidityEndDate, DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS.requireValidityEndDate),
    classificationModel: readString(config.oceanClassificationModel, DEFAULT_OCEAN_FREIGHT_AUTOMATION_SETTINGS.classificationModel)
  };
}

export function buildOceanFreightAutomationConfig(settings: OceanFreightAutomationSettings) {
  return {
    oceanClassificationEnabled: settings.classificationEnabled,
    oceanExtractionEnabled: settings.extractionEnabled,
    oceanExceptionOnlyReview: settings.exceptionOnlyReview,
    oceanHighConfidenceThreshold: settings.highConfidenceThreshold,
    oceanAutoPostEnabled: settings.autoPostEnabled,
    oceanAutoPostMinimumConfidence: settings.autoPostMinimumConfidence,
    oceanTrustedAgentOnlyAutoPost: settings.trustedAgentOnlyAutoPost,
    oceanRequireValidityEndDate: settings.requireValidityEndDate,
    oceanClassificationModel: settings.classificationModel
  };
}

export function getOceanFreightReviewDisposition(candidate: CandidateForDisposition, settings: OceanFreightAutomationSettings) {
  const reasons = getCandidateExceptionReasons(candidate, settings);
  const isOpen = candidate.status === OceanExtractionStatus.NEW || candidate.status === OceanExtractionStatus.NEEDS_REVIEW;
  const isHighConfidence = candidate.confidence >= settings.highConfidenceThreshold;
  const isException = isOpen && reasons.length > 0;
  const isAutoPostEligible =
    isOpen &&
    settings.autoPostEnabled &&
    candidate.confidence >= settings.autoPostMinimumConfidence &&
    reasons.length === 0;

  return {
    isHighConfidence,
    isException,
    isAutoPostEligible,
    reasons
  };
}

function getCandidateExceptionReasons(candidate: CandidateForDisposition, settings: OceanFreightAutomationSettings) {
  const reasons: string[] = [];
  const source = candidate.sourceEmail;

  if (source?.fromAddress && source.fromAddress.toLowerCase() === source.mailboxAddress.toLowerCase()) {
    reasons.push("source is outbound from pricing mailbox");
  }
  if (!source?.rateDetected) {
    reasons.push("source was not classified as an inbound agent rate");
  }
  if (settings.trustedAgentOnlyAutoPost && !candidate.agentId) {
    reasons.push("agent is not matched");
  }
  if (!candidate.originPort) reasons.push("origin port missing");
  if (!candidate.destinationPort) reasons.push("destination port missing");
  if (!candidate.equipmentType) reasons.push("equipment missing");
  if (!candidate.rateAmount) reasons.push("rate amount missing");
  if (!candidate.currency) reasons.push("currency missing");
  if (settings.requireValidityEndDate && !candidate.validityEndDate) {
    reasons.push("validity end missing");
  }

  return reasons;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
