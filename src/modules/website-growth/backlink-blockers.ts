import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus
} from "@prisma/client";

export type WebsiteGrowthBacklinkBlockerCategory =
  | "TECHNICAL"
  | "NEEDS_OWNER_CONFIRMATION"
  | "MANUAL_SETUP"
  | "NO_CONTACT_METHOD";

export type WebsiteGrowthBacklinkBlocker = {
  category: WebsiteGrowthBacklinkBlockerCategory;
  reason: string;
  nextAction: string;
  retryGuidance: string;
  retryWillHelpNow: boolean;
};

type WebsiteGrowthBacklinkBlockerInput = {
  status: WebsiteGrowthBacklinkStatus;
  category: WebsiteGrowthBacklinkCategory;
  notes: string | null;
  submittedAt?: Date | null;
  contactedAt?: Date | null;
  directoryLoginUrl?: string | null;
};

const NO_CONTACT_METHOD_PATTERN =
  /\b(?:no|missing|unable to find|could not find|without)\b.{0,70}\b(?:public|published|business|editorial|partnership|contact|email|address|submission method)\b|\bexact public business email\b|\bno contact method\b/i;
const MANUAL_SETUP_PATTERN =
  /\b(?:captcha|mfa|multi[- ]factor|two[- ]factor|2fa|phone verification|email verification|verify (?:the )?account|account verification|password|passcode|magic link|sign[- ]?up|signup|create (?:an )?account|account creation|login|log in|credential storage)\b/i;
const OWNER_CONFIRMATION_PATTERN =
  /\b(?:owner confirmation|owner approval|payment|paid|purchase|subscription|renewal|contract|reciprocal|indemnity|unusual terms|terms review|content rights|data rights|factual uncertainty|missing business-profile|missing business profile)\b/i;

export function describeWebsiteGrowthBacklinkBlocker(
  input: WebsiteGrowthBacklinkBlockerInput
): WebsiteGrowthBacklinkBlocker | null {
  if (input.status !== WebsiteGrowthBacklinkStatus.BLOCKED) return null;

  const reason =
    input.notes?.trim().slice(0, 2_000) ||
    "Scout marked this opportunity blocked without recording a specific reason.";
  const hasExternalHistory = Boolean(
    input.submittedAt ||
    input.contactedAt
  );
  const category = classifyWebsiteGrowthBacklinkBlocker({
    reason,
    opportunityCategory: input.category
  });

  if (hasExternalHistory) {
    return {
      category,
      reason,
      nextAction:
        "Review the mailbox or submission history before taking another action so Newl does not send or submit twice.",
      retryGuidance:
        "Do not retry automatically. A prior external action is already recorded.",
      retryWillHelpNow: false
    };
  }

  if (category === "NO_CONTACT_METHOD") {
    return {
      category,
      reason,
      nextAction:
        "Find and verify an exact public business contact or publisher submission method. Archive the opportunity if none exists.",
      retryGuidance:
        "No. Retrying without new contact evidence will produce the same block.",
      retryWillHelpNow: false
    };
  }

  if (category === "MANUAL_SETUP") {
    return {
      category,
      reason,
      nextAction:
        "Complete the account, CAPTCHA, MFA, phone, email, or password setup manually, then return the item to Scout.",
      retryGuidance:
        "Not yet. Retrying will help only after the manual setup step is complete.",
      retryWillHelpNow: false
    };
  }

  if (category === "NEEDS_OWNER_CONFIRMATION") {
    return {
      category,
      reason,
      nextAction:
        "Review and record the required owner decision. Scout may retry only after the terms, facts, or spending question is resolved.",
      retryGuidance:
        "Not yet. Retrying before owner confirmation will produce the same block.",
      retryWillHelpNow: false
    };
  }

  return {
    category,
    reason,
    nextAction:
      "Fix the reported technical or permission issue, then retry the approved opportunity.",
    retryGuidance:
      "Yes, after the technical issue is fixed and nothing was sent or submitted.",
    retryWillHelpNow: true
  };
}

export function formatWebsiteGrowthBacklinkBlockerCategory(
  category: WebsiteGrowthBacklinkBlockerCategory
) {
  if (category === "TECHNICAL") return "Technical";
  if (category === "NEEDS_OWNER_CONFIRMATION") {
    return "Needs owner confirmation";
  }
  if (category === "MANUAL_SETUP") return "Manual setup";
  return "No contact method";
}

function classifyWebsiteGrowthBacklinkBlocker({
  reason,
  opportunityCategory
}: {
  reason: string;
  opportunityCategory: WebsiteGrowthBacklinkCategory;
}): WebsiteGrowthBacklinkBlockerCategory {
  if (NO_CONTACT_METHOD_PATTERN.test(reason)) return "NO_CONTACT_METHOD";
  if (MANUAL_SETUP_PATTERN.test(reason)) return "MANUAL_SETUP";
  if (OWNER_CONFIRMATION_PATTERN.test(reason)) {
    return "NEEDS_OWNER_CONFIRMATION";
  }
  if (
    opportunityCategory === WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION &&
    /\b(?:registration|register|profile setup|business listing setup)\b/i.test(reason)
  ) {
    return "MANUAL_SETUP";
  }
  return "TECHNICAL";
}
