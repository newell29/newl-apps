import { createHash } from "node:crypto";
import {
  HunterServiceLine,
  OutreachChannel,
  OutreachPlanStatus,
  OutreachQaStatus
} from "@prisma/client";

export const OUTREACH_PLAN_PROMPT_VERSION = "outreach-plan-v2.1";
export const DEFAULT_OUTREACH_STRATEGY_MODEL = "gpt-5.6-terra";
export const DEFAULT_OUTREACH_DRAFT_MODEL = "gpt-5.6-luna";
export const DEFAULT_OUTREACH_QA_MODEL = "gpt-5.6-luna";
export const DEFAULT_HUNTER_CONTACT_FIT_MODEL = "gpt-5.6-luna";
export const HUNTER_CONTACT_FIT_PROMPT_VERSION = "hunter-contact-fit-v2.1";

export type HunterContactFitDisposition = "PRIMARY" | "SECONDARY" | "REVIEW" | "REJECT";

export type HunterContactFitReview = {
  contactId: string;
  disposition: HunterContactFitDisposition;
  confidence: number;
  responsibilityHypothesis: string;
  rationale: string;
  recommendedApproach: string;
  riskFlags: string[];
};

export type OutreachEvidenceRecord = {
  id: string;
  kind: "TRADEMINING" | "HUNTER_RESEARCH" | "HUNTER_SIGNAL" | "HUNTER_DECISION" | "COMPANY";
  title: string;
  summary: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  facts: string[];
};

export type OutreachStrategy = {
  serviceLine: HunterServiceLine;
  opportunityType: string;
  objective: string;
  triggerSummary: string;
  buyerHypothesis: string;
  valueProposition: string;
  likelyObjection: string;
  callToAction: string;
  channelStrategy: string[];
  senderRecommendation: string;
  confidence: number;
  evidenceRefs: string[];
};

export type GeneratedOutreachSequenceStep = {
  stepNumber: number;
  channel: OutreachChannel;
  delayDays: number;
  subject: string | null;
  body: string;
  angle: string;
  evidenceRefs: string[];
};

export type GeneratedOutreachSequence = {
  sequenceName: string;
  steps: GeneratedOutreachSequenceStep[];
};

export type OutreachQaIssue = {
  code: string;
  severity: "ERROR" | "WARNING";
  message: string;
  stepNumber: number | null;
};

export type ModelOutreachQaResult = {
  passed: boolean;
  issues: OutreachQaIssue[];
};

const BANNED_PHRASES = [
  "i hope this email finds you well",
  "reaching out because",
  "just wanted to",
  "circle back",
  "touch base",
  "synergy",
  "game changer"
];

export function fingerprintOutreachEvidence(evidence: OutreachEvidenceRecord[]) {
  const stablePayload = evidence
    .map((record) => ({
      id: record.id,
      kind: record.kind,
      title: record.title,
      summary: record.summary,
      sourceUrl: record.sourceUrl,
      publishedAt: record.publishedAt,
      facts: record.facts
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return createHash("sha256").update(JSON.stringify(stablePayload)).digest("hex");
}

export function runDeterministicOutreachQa({
  evidence,
  strategy,
  sequence,
  senderFirstName,
  allowCallTask = false
}: {
  evidence: OutreachEvidenceRecord[];
  strategy: OutreachStrategy;
  sequence: GeneratedOutreachSequence;
  senderFirstName?: string;
  allowCallTask?: boolean;
}) {
  const issues: OutreachQaIssue[] = [];
  const requiredSenderFirstName = senderFirstName?.trim() ?? "";
  if (!requiredSenderFirstName) {
    issues.push({
      code: "SENDER_IDENTITY_MISSING",
      severity: "ERROR",
      message: "A routed Apollo mailbox first name is required before outbound QA.",
      stepNumber: null
    });
  }
  const evidenceIds = new Set(evidence.map((record) => record.id));
  const evidenceText = evidence
    .flatMap((record) => [record.title, record.summary, ...record.facts])
    .join(" ")
    .toLowerCase();

  const expectedStepCount = allowCallTask ? 4 : 3;
  const channelStrategyText = strategy.channelStrategy.join(" ");
  const strategyMentionsCall = /\bcall\b/i.test(channelStrategyText);
  if (allowCallTask !== strategyMentionsCall) {
    issues.push({
      code: "CHANNEL_STRATEGY_MISMATCH",
      severity: "ERROR",
      message: allowCallTask
        ? "A Hot opportunity strategy must include the separate human call task."
        : "An email-only opportunity strategy must not include a call.",
      stepNumber: null
    });
  }
  if (/\blinkedin\b/i.test(channelStrategyText)) {
    issues.push({
      code: "LINKEDIN_STRATEGY",
      severity: "ERROR",
      message: "Hunter-managed outreach does not include LinkedIn tasks.",
      stepNumber: null
    });
  }
  if (sequence.steps.length !== expectedStepCount) {
    issues.push({
      code: "STEP_COUNT",
      severity: "ERROR",
      message: `This Hunter cadence must contain exactly ${expectedStepCount} coordinated touches.`,
      stepNumber: null
    });
  }

  const orderedSteps = sequence.steps.slice().sort((left, right) => left.stepNumber - right.stepNumber);
  const expectedNumbers = orderedSteps.map((_, index) => index + 1);
  if (orderedSteps.some((step, index) => step.stepNumber !== expectedNumbers[index])) {
    issues.push({
      code: "STEP_ORDER",
      severity: "ERROR",
      message: `Sequence step numbers must be unique and contiguous from one through ${expectedStepCount}.`,
      stepNumber: null
    });
  }

  if (orderedSteps[0]?.delayDays !== 0) {
    issues.push({
      code: "FIRST_TOUCH_DELAY",
      severity: "ERROR",
      message: "The first outreach touch must start on day zero.",
      stepNumber: orderedSteps[0]?.stepNumber ?? null
    });
  }

  for (let index = 1; index < orderedSteps.length; index += 1) {
    if (orderedSteps[index].delayDays <= orderedSteps[index - 1].delayDays) {
      issues.push({
        code: "NON_INCREASING_DELAY",
        severity: "ERROR",
        message: "Every sequence touch must occur after the previous touch.",
        stepNumber: orderedSteps[index].stepNumber
      });
    }
  }

  const emailCount = orderedSteps.filter((step) => step.channel === OutreachChannel.EMAIL).length;
  const linkedinCount = orderedSteps.filter((step) => step.channel === OutreachChannel.LINKEDIN_TASK).length;
  const callCount = orderedSteps.filter((step) => step.channel === OutreachChannel.CALL_TASK).length;

  if (
    emailCount !== 3 ||
    linkedinCount !== 0 ||
    callCount !== (allowCallTask ? 1 : 0)
  ) {
    issues.push({
      code: "CHANNEL_MIX",
      severity: "ERROR",
      message: allowCallTask
        ? "A Hot Hunter opportunity must contain three emails and one call task."
        : "A Hunter email cadence must contain three emails and no LinkedIn or call tasks.",
      stepNumber: null
    });
  }

  validateEvidenceRefs(strategy.evidenceRefs, evidenceIds, issues, null);

  for (const step of orderedSteps) {
    validateEvidenceRefs(step.evidenceRefs, evidenceIds, issues, step.stepNumber);
    const combinedCopy = `${step.subject ?? ""}\n${step.body}`.trim();
    const normalizedCopy = combinedCopy.toLowerCase();

    if (step.channel === OutreachChannel.EMAIL) {
      if (!step.subject || step.subject.trim().length < 2 || step.subject.trim().length > 80) {
        issues.push({
          code: "EMAIL_SUBJECT_LENGTH",
          severity: "ERROR",
          message: "Email subject lines must contain between 2 and 80 characters.",
          stepNumber: step.stepNumber
        });
      }
      if (step.body.trim().length < 40 || step.body.trim().length > 900) {
        issues.push({
          code: "EMAIL_BODY_LENGTH",
          severity: "ERROR",
          message: "Email bodies must contain between 40 and 900 characters.",
          stepNumber: step.stepNumber
        });
      }
      const signature = step.body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      if (!requiredSenderFirstName || signature !== requiredSenderFirstName) {
        issues.push({
          code: "SENDER_SIGNATURE",
          severity: "ERROR",
          message: requiredSenderFirstName
            ? `Every email must end with ${requiredSenderFirstName} on its own final line.`
            : "Every email must end with the routed mailbox first name on its own final line.",
          stepNumber: step.stepNumber
        });
      }
    } else {
      if (step.subject) {
        issues.push({
          code: "TASK_SUBJECT",
          severity: "ERROR",
          message: "LinkedIn and call tasks must not include an email subject.",
          stepNumber: step.stepNumber
        });
      }
      if (step.body.trim().length < 20 || step.body.trim().length > 500) {
        issues.push({
          code: "TASK_BODY_LENGTH",
          severity: "ERROR",
          message: "Manual task instructions must contain between 20 and 500 characters.",
          stepNumber: step.stepNumber
        });
      }
    }

    if (
      /\bhunter\b/i.test(combinedCopy) ||
      /\b(?:hunter-research|hunter-decision|trademining:summary|company:identity)\b/i.test(
        combinedCopy
      )
    ) {
      issues.push({
        code: "INTERNAL_REFERENCE",
        severity: "ERROR",
        message: "Outbound copy must not reference Hunter, internal research, or evidence IDs.",
        stepNumber: step.stepNumber
      });
    }
    if (
      /<\s*sender(?:\s+name)?\s*>|\[\s*sender(?:\s+name)?\s*\]/i.test(
        combinedCopy
      ) ||
      (
        step.channel === OutreachChannel.EMAIL &&
        /\bnewl group\b/i.test(
          step.body
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .at(-1) ?? ""
        )
      )
    ) {
      issues.push({
        code: "SENDER_PLACEHOLDER",
        severity: "ERROR",
        message: "Replace sender placeholders or a generic company signature with the routed mailbox first name.",
        stepNumber: step.stepNumber
      });
    }

    for (const phrase of BANNED_PHRASES) {
      if (normalizedCopy.includes(phrase)) {
        issues.push({
          code: "BANNED_PHRASE",
          severity: "ERROR",
          message: `Remove generic outbound phrasing: "${phrase}".`,
          stepNumber: step.stepNumber
        });
      }
    }

    for (const url of combinedCopy.match(/https?:\/\/[^\s)]+/gi) ?? []) {
      const normalizedUrl = url.replace(/[.,;]+$/, "");
      const isSupported =
        normalizedUrl.toLowerCase().includes("newl.ca") ||
        evidence.some((record) => record.sourceUrl && normalizedUrl.startsWith(record.sourceUrl));
      if (!isSupported) {
        issues.push({
          code: "UNSUPPORTED_URL",
          severity: "ERROR",
          message: `The message contains an unsupported URL: ${normalizedUrl}`,
          stepNumber: step.stepNumber
        });
      }
    }

    for (const match of combinedCopy.matchAll(/\b(\d+(?:\.\d+)?)\s*(shipments?|teus?|stores?|facilities?|locations?|containers?)\b/gi)) {
      const claimedFact = match[0].toLowerCase();
      if (!evidenceText.includes(claimedFact)) {
        issues.push({
          code: "UNSUPPORTED_QUANTIFIED_CLAIM",
          severity: "ERROR",
          message: `The quantified claim "${match[0]}" is not present in the saved evidence ledger.`,
          stepNumber: step.stepNumber
        });
      }
    }
  }

  return {
    passed: !issues.some((issue) => issue.severity === "ERROR"),
    issues
  };
}

export function mergeOutreachQaResults(
  deterministic: ReturnType<typeof runDeterministicOutreachQa>,
  modelResult: ModelOutreachQaResult
) {
  const issues = dedupeQaIssues([...deterministic.issues, ...modelResult.issues]);
  return {
    passed:
      deterministic.passed &&
      modelResult.passed &&
      !issues.some((issue) => issue.severity === "ERROR"),
    issues
  };
}

export function getOutreachPlanApolloBlockReason(
  plan: { status: OutreachPlanStatus; qaStatus: OutreachQaStatus } | null
) {
  if (!plan) return null;
  if (plan.status !== OutreachPlanStatus.APPROVED || plan.qaStatus !== OutreachQaStatus.PASSED) {
    return "The current outreach plan must pass QA and receive human approval before Apollo push.";
  }
  return null;
}

function validateEvidenceRefs(
  refs: string[],
  evidenceIds: Set<string>,
  issues: OutreachQaIssue[],
  stepNumber: number | null
) {
  if (refs.length === 0) {
    issues.push({
      code: "MISSING_EVIDENCE",
      severity: "ERROR",
      message: "Every strategy and sequence touch must cite at least one saved evidence record.",
      stepNumber
    });
    return;
  }

  for (const ref of refs) {
    if (!evidenceIds.has(ref)) {
      issues.push({
        code: "UNKNOWN_EVIDENCE_REF",
        severity: "ERROR",
        message: `Evidence reference "${ref}" is not in the saved evidence ledger.`,
        stepNumber
      });
    }
  }
}

function dedupeQaIssues(issues: OutreachQaIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.stepNumber ?? "plan"}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
