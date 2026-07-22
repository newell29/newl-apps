import { ContactStatus, ContactTier, ReplyStatus } from "@prisma/client";
import type { TradeMiningScoringSettings } from "@/modules/settings/types";

type ContactScoringInput = {
  fullName: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  contactStatus: ContactStatus;
  replyStatus: ReplyStatus;
  companyPriorityScore: number;
  companyLeadScore: number | null;
  isPrimaryContact: boolean;
};

type ContactScoringResult = {
  score: number;
  tier: ContactTier;
  summary: string;
};

type ContactScoringConfig = Pick<
  TradeMiningScoringSettings,
  | "contactDecisionMakerWeight"
  | "contactManagerWeight"
  | "contactLogisticsDepartmentWeight"
  | "contactWeakFunctionPenalty"
  | "contactCompanyContextWeight"
  | "contactEmailWeight"
  | "contactLinkedinWeight"
  | "contactPhoneWeight"
  | "contactPrimaryContactBoost"
  | "contactApprovedStatusBoost"
  | "contactReviewingStatusBoost"
  | "contactTier1Threshold"
  | "contactTier2Threshold"
  | "contactTier3Threshold"
  | "preferredContactTitleKeywords"
  | "penalizedContactTitleKeywords"
  | "preferredContactDepartments"
  | "penalizedContactDepartments"
>;

const MANAGER_TITLE_PATTERN = /\b(manager|lead|supervisor)\b/i;
const EXECUTION_TITLE_PATTERN = /\b(coordinator|specialist|analyst|associate|assistant)\b/i;

export function scoreContact(
  input: ContactScoringInput,
  config: ContactScoringConfig
): ContactScoringResult {
  const blockingReason = getContactScoringBlockReason(input.contactStatus);
  if (blockingReason) {
    return {
      score: 0,
      tier: ContactTier.UNRANKED,
      summary: blockingReason
    };
  }

  const role = scoreRoleFit(input.title, input.department, config);
  const seniority = scoreSeniority(input.seniority, input.title);
  const companyContext = scoreCompanyContext(input.companyPriorityScore, input.companyLeadScore, config);
  const dataQuality = scoreDataQuality(input, config);
  const workflow = scoreWorkflow(input, config);
  const rawScore = clamp(role.score + seniority.score + companyContext.score + dataQuality.score + workflow.score, 0, 100);
  const tier = classifyContactTier(rawScore, config);
  const summary = [
    role.reason,
    seniority.reason,
    companyContext.reason,
    dataQuality.reason,
    workflow.reason
  ]
    .filter(Boolean)
    .slice(0, 4)
    .join("; ");

  return {
    score: rawScore,
    tier,
    summary
  };
}

export function getContactScoringBlockReason(contactStatus: ContactStatus) {
  if (contactStatus === ContactStatus.DO_NOT_CONTACT) {
    return "do not contact; blocked from scoring and outreach";
  }

  if (contactStatus === ContactStatus.REJECTED) {
    return "rejected contact; blocked from scoring and outreach";
  }

  return null;
}

export function getContactSequencePushBlockReason(contactStatus: ContactStatus) {
  const blockingReason = getContactScoringBlockReason(contactStatus);
  if (blockingReason) {
    return blockingReason;
  }

  if (contactStatus !== ContactStatus.APPROVED) {
    return "Contact must be approved before it can be pushed to an Apollo cadence.";
  }

  return null;
}

function scoreRoleFit(title: string | null, department: string | null, config: ContactScoringConfig) {
  const roleText = `${title ?? ""} ${department ?? ""}`.trim();

  if (!roleText) {
    return {
      score: 6,
      reason: "limited role detail"
    };
  }

  const isDecisionMaker = matchesKeywordList(roleText, config.preferredContactTitleKeywords);
  const isManager = MANAGER_TITLE_PATTERN.test(roleText);
  const isLogisticsFit = matchesKeywordList(roleText, config.preferredContactDepartments);
  const isWeakFunction =
    matchesKeywordList(roleText, config.penalizedContactDepartments) ||
    matchesKeywordList(roleText, config.penalizedContactTitleKeywords);

  let score = 0;

  if (isDecisionMaker) {
    score += config.contactDecisionMakerWeight;
  } else if (isManager) {
    score += config.contactManagerWeight;
  } else {
    score += 6;
  }

  if (isLogisticsFit) {
    score += config.contactLogisticsDepartmentWeight;
  } else if (isWeakFunction) {
    score -= config.contactWeakFunctionPenalty;
  } else {
    score += 4;
  }

  return {
    score: clamp(score, 0, 35),
    reason:
      isDecisionMaker && isLogisticsFit
        ? "strong logistics decision-maker role"
        : isDecisionMaker && isWeakFunction
          ? "senior decision-maker in non-core function"
        : isDecisionMaker
          ? "senior decision-maker title"
          : isManager && isLogisticsFit
            ? "relevant logistics management role"
            : isWeakFunction
              ? "non-core function role"
              : "general business role"
  };
}

function scoreSeniority(seniority: string | null, title: string | null) {
  const seniorityText = `${seniority ?? ""} ${title ?? ""}`.trim();

  if (!seniorityText) {
    return {
      score: 8,
      reason: "unknown seniority"
    };
  }

  if (/\b(owner|founder|chief|ceo|coo|president|partner|principal|vp|vice president|head|director)\b/i.test(seniorityText)) {
    return {
      score: 20,
      reason: "high buying authority"
    };
  }

  if (/\bmanager|lead|supervisor\b/i.test(seniorityText)) {
    return {
      score: 14,
      reason: "manager-level authority"
    };
  }

  if (EXECUTION_TITLE_PATTERN.test(seniorityText)) {
    return {
      score: 8,
      reason: "execution-level role"
    };
  }

  return {
    score: 10,
    reason: "mid-level authority"
  };
}

function scoreCompanyContext(
  companyPriorityScore: number,
  companyLeadScore: number | null,
  config: ContactScoringConfig
) {
  const effectiveScore = Math.max(companyPriorityScore, companyLeadScore ?? 0);
  const score = Math.round(clamp(effectiveScore / 100, 0, 1) * config.contactCompanyContextWeight);

  return {
    score,
    reason:
      effectiveScore >= 80
        ? "high-priority target account"
        : effectiveScore >= 60
          ? "solid target account"
          : "modest account priority"
  };
}

function scoreDataQuality(input: ContactScoringInput, config: ContactScoringConfig) {
  let score = 0;
  const reasons: string[] = [];

  if (input.email) {
    score += config.contactEmailWeight;
    reasons.push("email available");
  }

  if (input.linkedinUrl) {
    score += config.contactLinkedinWeight;
    reasons.push("LinkedIn profile available");
  }

  if (input.phone) {
    score += config.contactPhoneWeight;
  }

  if (input.title) {
    score += 2;
  }

  if (input.department || input.seniority) {
    score += 1;
  }

  return {
    score: clamp(score, 0, 15),
    reason: reasons.length > 0 ? reasons.join(", ") : "thin contact data"
  };
}

function scoreWorkflow(input: ContactScoringInput, config: ContactScoringConfig) {
  let score = 4;
  const reasons: string[] = [];

  if (input.isPrimaryContact) {
    score += config.contactPrimaryContactBoost;
    reasons.push("already selected as primary");
  }

  if (input.contactStatus === ContactStatus.APPROVED) {
    score += config.contactApprovedStatusBoost;
    reasons.push("contact approved");
  } else if (input.contactStatus === ContactStatus.REVIEWING) {
    score += config.contactReviewingStatusBoost;
    reasons.push("in active review");
  }

  if (input.replyStatus === ReplyStatus.POSITIVE || input.replyStatus === ReplyStatus.MEETING_BOOKED) {
    score += 2;
    reasons.push("positive engagement");
  }

  return {
    score: clamp(score, 0, 15),
    reason: reasons.join(", ") || "ready for review"
  };
}

function classifyContactTier(score: number, config: ContactScoringConfig): ContactTier {
  if (score >= config.contactTier1Threshold) {
    return ContactTier.TIER_1;
  }

  if (score >= config.contactTier2Threshold) {
    return ContactTier.TIER_2;
  }

  if (score >= config.contactTier3Threshold) {
    return ContactTier.TIER_3;
  }

  return ContactTier.UNRANKED;
}

function matchesKeywordList(value: string, keywords: string[]) {
  const normalized = normalizeKeywordText(value);
  return keywords.some((keyword) => {
    const normalizedKeyword = normalizeKeywordText(keyword);
    return normalizedKeyword.length > 0 && ` ${normalized} `.includes(` ${normalizedKeyword} `);
  });
}

function normalizeKeywordText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
