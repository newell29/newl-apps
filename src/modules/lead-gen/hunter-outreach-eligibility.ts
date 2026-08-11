import {
  HunterDecisionStatus,
  HunterServiceLine
} from "@prisma/client";

export const DEFAULT_HUNTER_OUTREACH_RESEARCH_MAX_AGE_DAYS = 30;

export type HunterOpportunityTier =
  | "HOT_OPPORTUNITY"
  | "QUALIFIED_CURRENT_ACCOUNT"
  | "WATCHLIST"
  | "BLOCKED";

export type HunterOutreachEligibilityStatus =
  | "ELIGIBLE"
  | "NEEDS_HUNTER_ASSESSMENT"
  | "WATCHLIST"
  | "BLOCKED"
  | "STALE_RESEARCH"
  | "NOT_SELECTED"
  | "INVALID_HANDOFF";

export type HunterOutreachDirective = {
  researchSignalId: string;
  prospectingDecisionId: string;
  opportunityTier: "HOT_OPPORTUNITY" | "QUALIFIED_CURRENT_ACCOUNT";
  requiredServiceLine: HunterServiceLine;
  opportunityType: string;
  rationale: string;
  recommendedPersona: string | null;
  recommendedSender: string | null;
  recommendedCadence: string | null;
  finalScore: number;
  finalConfidence: number;
  researchRetrievedAt: string;
};

export type HunterOutreachEligibility = {
  status: HunterOutreachEligibilityStatus;
  label: string;
  reason: string;
  opportunityTier: HunterOpportunityTier | null;
  serviceLine: HunterServiceLine | null;
  researchRetrievedAt: string | null;
  directive: HunterOutreachDirective | null;
};

type ResearchSignal = {
  id: string;
  sourceName: string | null;
  serviceLine: HunterServiceLine;
  observedAt: Date;
  evidence: unknown;
};

type ProspectingDecision = {
  id: string;
  status: HunterDecisionStatus;
  serviceLine: HunterServiceLine;
  opportunityType: string;
  rationale: string;
  recommendedPersona: string | null;
  recommendedSender: string | null;
  recommendedCadence: string | null;
  createdAt: Date;
};

export function getHunterOutreachResearchMaxAgeDays() {
  const configured = Number(process.env.HUNTER_OUTREACH_RESEARCH_MAX_AGE_DAYS);
  return Number.isInteger(configured) && configured > 0 && configured <= 365
    ? configured
    : DEFAULT_HUNTER_OUTREACH_RESEARCH_MAX_AGE_DAYS;
}

export function evaluateHunterOutreachEligibility({
  researchSignal,
  prospectingDecision,
  now = new Date(),
  maxResearchAgeDays = DEFAULT_HUNTER_OUTREACH_RESEARCH_MAX_AGE_DAYS
}: {
  researchSignal: ResearchSignal | null;
  prospectingDecision: ProspectingDecision | null;
  now?: Date;
  maxResearchAgeDays?: number;
}): HunterOutreachEligibility {
  if (!researchSignal || researchSignal.sourceName !== "Hunter company research") {
    return result(
      "NEEDS_HUNTER_ASSESSMENT",
      "Needs Hunter assessment",
      "Hunter has not completed a company research assessment for this opportunity."
    );
  }

  const research = object(object(researchSignal.evidence).research);
  const opportunityTier = readOpportunityTier(research.opportunityTier);
  const retrievedAt = readIsoDate(research.retrievedAt);
  const synthesis = object(research.synthesis);
  const scoring = object(research.scoring);
  const validation = object(research.validation);
  const deterministicGate = object(research.deterministicGate);
  const models = object(research.models);
  const synthesisModel = object(models.synthesis);
  const scoringModel = object(models.scoring);
  const synthesisServiceLine = readServiceLine(synthesis.serviceLine);
  const scoringServiceLine = readServiceLine(scoring.serviceLine);
  const finalScore = readBoundedInteger(research.finalScore);
  const finalConfidence = readBoundedInteger(research.finalConfidence);

  if (opportunityTier === "WATCHLIST") {
    return result(
      "WATCHLIST",
      "Hunter watchlist",
      "Hunter retained this company for monitoring but did not select it for outreach.",
      opportunityTier,
      scoringServiceLine,
      retrievedAt
    );
  }

  if (opportunityTier === "BLOCKED") {
    return result(
      "BLOCKED",
      "Blocked by Hunter",
      "Hunter classified this company as blocked; outreach is not permitted.",
      opportunityTier,
      scoringServiceLine,
      retrievedAt
    );
  }

  if (
    !opportunityTier ||
    !["HOT_OPPORTUNITY", "QUALIFIED_CURRENT_ACCOUNT"].includes(opportunityTier) ||
    deterministicGate.passed !== true ||
    !retrievedAt ||
    !isApprovedSynthesisModel(synthesisModel) ||
    scoringModel.provider !== "KIMI" ||
    !isRequiredModel(scoringModel.name, "kimi") ||
    synthesisServiceLine !== scoringServiceLine ||
    !scoringServiceLine ||
    scoringServiceLine !== researchSignal.serviceLine ||
    typeof scoring.opportunityType !== "string" ||
    typeof scoring.rationale !== "string" ||
    finalScore === null ||
    finalConfidence === null
  ) {
    return result(
      "INVALID_HANDOFF",
      "Hunter handoff incomplete",
      "Hunter research is missing the Luna/Kimi model handoff (or an approved legacy Qwen handoff), a valid tier, deterministic gate, score, confidence, or consistent service line.",
      opportunityTier,
      scoringServiceLine,
      retrievedAt
    );
  }

  if (
    opportunityTier === "HOT_OPPORTUNITY" &&
    (validation.status !== "VALIDATED" || validation.disposition !== "CONFIRM")
  ) {
    return result(
      "INVALID_HANDOFF",
      "Hunter validation required",
      "A hot opportunity must be confirmed by the Kimi validator before outreach.",
      opportunityTier,
      scoringServiceLine,
      retrievedAt
    );
  }

  const ageMilliseconds = now.getTime() - retrievedAt.getTime();
  if (
    ageMilliseconds < 0 ||
    ageMilliseconds > maxResearchAgeDays * 24 * 60 * 60 * 1_000
  ) {
    return result(
      "STALE_RESEARCH",
      "Refresh Hunter research",
      `Hunter research is older than the ${maxResearchAgeDays}-day outreach freshness window.`,
      opportunityTier,
      scoringServiceLine,
      retrievedAt
    );
  }

  if (
    !prospectingDecision ||
    prospectingDecision.status !== HunterDecisionStatus.WOULD_PURSUE
  ) {
    return result(
      "NOT_SELECTED",
      "Not selected by Hunter",
      "Hunter assessed this company but did not select it for the current opportunity queue.",
      opportunityTier,
      scoringServiceLine,
      retrievedAt
    );
  }

  if (
    prospectingDecision.createdAt.getTime() < researchSignal.observedAt.getTime() ||
    prospectingDecision.serviceLine !== scoringServiceLine
  ) {
    return result(
      "INVALID_HANDOFF",
      "Hunter handoff out of sync",
      "Hunter's selected decision predates the latest research or uses a different service line.",
      opportunityTier,
      scoringServiceLine,
      retrievedAt
    );
  }

  return {
    status: "ELIGIBLE",
    label: opportunityTier === "HOT_OPPORTUNITY" ? "Hunter hot opportunity" : "Hunter qualified account",
    reason: "Hunter research passed its deterministic gate and the opportunity was selected for outreach.",
    opportunityTier,
    serviceLine: scoringServiceLine,
    researchRetrievedAt: retrievedAt.toISOString(),
    directive: {
      researchSignalId: researchSignal.id,
      prospectingDecisionId: prospectingDecision.id,
      opportunityTier,
      requiredServiceLine: scoringServiceLine,
      opportunityType: prospectingDecision.opportunityType || String(scoring.opportunityType),
      rationale: prospectingDecision.rationale || String(scoring.rationale),
      recommendedPersona: prospectingDecision.recommendedPersona,
      recommendedSender: prospectingDecision.recommendedSender,
      recommendedCadence: prospectingDecision.recommendedCadence,
      finalScore,
      finalConfidence,
      researchRetrievedAt: retrievedAt.toISOString()
    }
  };
}

function isApprovedSynthesisModel(model: Record<string, unknown>) {
  return (
    (model.provider === "OPENAI" && isRequiredModel(model.name, "luna")) ||
    (model.provider === "OLLAMA" && isRequiredModel(model.name, "qwen"))
  );
}

function result(
  status: Exclude<HunterOutreachEligibilityStatus, "ELIGIBLE">,
  label: string,
  reason: string,
  opportunityTier: HunterOpportunityTier | null = null,
  serviceLine: HunterServiceLine | null = null,
  researchRetrievedAt: Date | null = null
): HunterOutreachEligibility {
  return {
    status,
    label,
    reason,
    opportunityTier,
    serviceLine,
    researchRetrievedAt: researchRetrievedAt?.toISOString() ?? null,
    directive: null
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRequiredModel(value: unknown, requiredName: string) {
  return typeof value === "string" &&
    value.toLowerCase().includes(requiredName);
}

function readOpportunityTier(value: unknown): HunterOpportunityTier | null {
  return typeof value === "string" &&
    ["HOT_OPPORTUNITY", "QUALIFIED_CURRENT_ACCOUNT", "WATCHLIST", "BLOCKED"].includes(value)
    ? (value as HunterOpportunityTier)
    : null;
}

function readServiceLine(value: unknown): HunterServiceLine | null {
  return typeof value === "string" && Object.values(HunterServiceLine).includes(value as HunterServiceLine)
    ? (value as HunterServiceLine)
    : null;
}

function readIsoDate(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readBoundedInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : null;
}
