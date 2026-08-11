import { createHash } from "node:crypto";

import { GARLAND_WORKFLOW_KEY } from "@/modules/assistant/garland-artifacts";

export type DevelopmentFeedbackCandidate = {
  id: string;
  moduleKey: string;
  workflowKey: string;
  classification: string;
  subjectType?: string | null;
  subjectId?: string | null;
  reporterStatement: string;
  expectedOutcome?: string | null;
  observedOutcome?: string | null;
};

export type DevelopmentIssueGroup = {
  issueKey: string;
  title: string;
  items: DevelopmentFeedbackCandidate[];
};

type IssueDescriptor = {
  key: string;
  title: string;
  tokens: Set<string>;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "currently",
  "did",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "should",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "was",
  "were",
  "what",
  "with",
  "you"
]);

const GARLAND_ISSUES: Array<{
  key: string;
  title: string;
  matches: (text: string) => boolean;
}> = [
  {
    key: "GARLAND_LOT_SERIAL_COMMODITY",
    title: "Garland Lot/Serial and commodity formatting",
    matches: (text) =>
      /\blot[\s/-]*serial\b/.test(text) ||
      /\bserial (?:number|reference|ref)\b/.test(text) ||
      (/\bcommodity\b/.test(text) && /\b(?:serial|sn)\b/.test(text))
  },
  {
    key: "GARLAND_SPECIAL_INSTRUCTIONS",
    title: "Garland Special Instructions extraction",
    matches: (text) =>
      /\bspecial instructions?\b/.test(text) ||
      /\bchemtrec\b/.test(text) ||
      /\b24 hour dg number\b/.test(text)
  },
  {
    key: "GARLAND_EMAIL_ORDER_PROCESSING",
    title: "Garland missed-order and email processing",
    matches: (text) =>
      /\bemail (?:notification|processing|review)\b/.test(text) ||
      /\bmiss(?:ed|ing) (?:running|run|order|email)\b/.test(text) ||
      /\bdid not receive\b.*\bemail\b/.test(text)
  },
  {
    key: "GARLAND_SHIP_TO_NAME",
    title: "Garland ship-to name comparison",
    matches: (text) =>
      /\b(?:ship[\s-]*to name|first name)\b/.test(text)
  },
  {
    key: "GARLAND_SHIP_TO_LOCATION",
    title: "Garland ship-to address and location comparison",
    matches: (text) =>
      /\bship[\s-]*to\b/.test(text) &&
      /\b(?:address|city|state|province|postal|zip)\b/.test(text)
  },
  {
    key: "GARLAND_PALLET_DIMENSIONS",
    title: "Garland pallet dimensions and weights",
    matches: (text) =>
      /\b(?:pallet|dims?|dimensions?|weight|lbs?)\b/.test(text) &&
      /\bsku\b/.test(text)
  },
  {
    key: "GARLAND_ORDER_STATUS_RESPONSE",
    title: "Garland order-status responses",
    matches: (text) =>
      /\border status\b/.test(text) ||
      /\bstatus of (?:ps|sr)\b/.test(text)
  },
  {
    key: "GARLAND_COMPARISON_FALSE_MISMATCH",
    title: "Garland comparison false mismatch",
    matches: (text) =>
      /\bcurrently displays?\b/.test(text) &&
      /\bit should display\b/.test(text) &&
      /\b(?:observed|reported)\b.*\b(?:missing|fail|pending)\b/.test(text) &&
      /\bexpected\b.*\bpass\b/.test(text)
  }
];

export function groupDevelopmentFeedback(
  candidates: DevelopmentFeedbackCandidate[]
): DevelopmentIssueGroup[] {
  const groups: Array<DevelopmentIssueGroup & { tokens: Set<string> }> = [];

  for (const item of candidates) {
    const descriptor = describeDevelopmentIssue(item);
    const exact = groups.find((group) =>
      group.issueKey === descriptor.key &&
      group.items[0]?.moduleKey === item.moduleKey &&
      group.items[0]?.workflowKey === item.workflowKey
    );
    if (exact) {
      exact.items.push(item);
      descriptor.tokens.forEach((token) => exact.tokens.add(token));
      continue;
    }

    const similar = groups.find((group) =>
      group.items[0]?.moduleKey === item.moduleKey &&
      group.items[0]?.workflowKey === item.workflowKey &&
      group.items[0]?.classification === item.classification &&
      group.issueKey.startsWith("GENERIC_") &&
      similarity(group.tokens, descriptor.tokens) >= 0.6
    );
    if (similar) {
      similar.items.push(item);
      descriptor.tokens.forEach((token) => similar.tokens.add(token));
      continue;
    }

    groups.push({
      issueKey: descriptor.key,
      title: descriptor.title,
      items: [item],
      tokens: descriptor.tokens
    });
  }

  return groups.map((group) => ({
    issueKey: group.issueKey,
    title: group.title,
    items: group.items
  }));
}

export function describeDevelopmentIssue(
  item: DevelopmentFeedbackCandidate
): IssueDescriptor {
  const normalized = normalizeIssueText([
    item.reporterStatement,
    `Observed ${item.observedOutcome ?? ""}`,
    `Expected ${item.expectedOutcome ?? ""}`,
    item.expectedOutcome,
    item.observedOutcome
  ].filter(Boolean).join(" "));
  const tokens = tokenize(normalized);

  if (item.workflowKey === GARLAND_WORKFLOW_KEY) {
    const known = GARLAND_ISSUES.find((issue) => issue.matches(normalized));
    if (known) {
      return {
        key: known.key,
        title: known.title,
        tokens
      };
    }
  }

  const signature = [...tokens].sort().slice(0, 10).join("|") || normalizeIssueText(item.classification);
  const digest = createHash("sha256").update(signature).digest("hex").slice(0, 16).toUpperCase();
  return {
    key: `GENERIC_${normalizeKeyPart(item.classification)}_${digest}`,
    title: `${humanize(item.classification)} feedback for ${humanize(item.workflowKey)}`.slice(0, 240),
    tokens
  };
}

export function isNonActionableDevelopmentFeedback(item: DevelopmentFeedbackCandidate) {
  const observed = normalizeOutcome(item.observedOutcome);
  const expected = normalizeOutcome(item.expectedOutcome);
  if (!observed || !expected || observed !== expected) return false;

  const displayValues = extractComparedDisplayValues(item.reporterStatement);
  if (!displayValues) return false;
  return normalizeComparedValue(displayValues.current) === normalizeComparedValue(displayValues.expected);
}

export function getDevelopmentContextPaths(workflowKey: string) {
  const common = [
    "AGENTS.md",
    "docs/README.md",
    "docs/architecture/overview.md",
    "docs/modules/README.md",
    "docs/modules/assistant/overview.md",
    "docs/ai/openclaw-integration.md",
    "reference/CODEX_PR_WORKFLOW.md"
  ];
  if (workflowKey === "WEBSITE_GROWTH_BACKLINK_OUTREACH") {
    return [
      ...common,
      "docs/modules/website-growth/overview.md",
      "docs/modules/website-growth/workflow.md",
      "docs/modules/website-growth/failure-modes.md",
      "docs/modules/website-growth/integrations.md",
      "docs/modules/website-growth/testing.md",
      "src/modules/website-growth/backlink-executor.ts",
      "src/modules/website-growth/backlink-outreach.ts",
      "ops/openclaw/install-website-growth-backlink-executor.sh",
      "ops/openclaw/prompts/website-growth-backlink-executor.md",
      "ops/openclaw/skills/website-growth-backlink-executor/SKILL.md"
    ];
  }
  if (
    workflowKey === "HUNTER_COMPANY_RESEARCH_QUALITY" ||
    workflowKey === "HUNTER_TRADEMINING_PROFILE_QUALITY"
  ) {
    return [
      ...common,
      "docs/modules/lead-generation/overview.md",
      "docs/modules/lead-generation/workflow.md",
      "docs/modules/lead-generation/business-rules.md",
      "docs/modules/lead-generation/permissions.md",
      "docs/modules/lead-generation/failure-modes.md",
      "docs/modules/lead-generation/testing.md",
      "reference/PRODUCT_OPERATING_BRIEF.md",
      "reference/OPENCLAW_LEAD_GEN_SPEC.md",
      "src/modules/lead-gen/hunter-company-research.ts",
      "src/modules/trademining/ingestion.ts",
      "ops/openclaw/hunter/hunter_company_research.py",
      "ops/openclaw/hunter/hunter_worker.py"
    ];
  }
  if (workflowKey !== GARLAND_WORKFLOW_KEY) return common;
  return [
    ...common,
    "docs/modules/shipment-documents/overview.md",
    "docs/modules/shipment-documents/workflow.md",
    "docs/modules/shipment-documents/business-rules.md",
    "docs/modules/shipment-documents/permissions.md",
    "docs/modules/shipment-documents/failure-modes.md",
    "docs/customers/garland/overview.md",
    "docs/customers/garland/review-workflow.md",
    "docs/customers/garland/teamship-workflow.md",
    "docs/customers/garland/email-ingestion.md",
    "docs/customers/garland/failure-examples.md",
    "docs/customers/garland/parsing-rules.md",
    "docs/customers/garland/validation-rules.md",
    "docs/customers/garland/known-edge-cases.md",
    "docs/customers/garland/open-questions.md",
    "docs/customers/garland/pallet-requirements.md",
    "docs/customers/garland/printing-rules.md",
    "docs/customers/garland/permissions.md",
    "docs/wms/teamship/nemo/orders.md",
    "docs/wms/teamship/nemo/safety.md"
  ];
}

function tokenize(value: string) {
  return new Set(
    value
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) =>
        token.length >= 3 &&
        !STOP_WORDS.has(token) &&
        !/^(?:ps|sr)?\d+$/.test(token)
      )
  );
}

function similarity(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(left.size, right.size);
}

function normalizeIssueText(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(?:ps|sr)\d+\b/g, " order-reference ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOutcome(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

function extractComparedDisplayValues(value: string) {
  const match = value.match(
    /\b(?:it\s+)?(?:is\s+)?currently displays?\s*:\s*([\s\S]+?)\s+\bit should display\s*:\s*([\s\S]+)$/i
  );
  if (!match) return null;
  return {
    current: match[1],
    expected: match[2]
  };
}

function normalizeComparedValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeKeyPart(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "GENERAL";
}

function humanize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
