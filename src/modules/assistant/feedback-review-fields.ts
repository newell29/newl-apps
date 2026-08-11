export const GARLAND_FEEDBACK_ISSUE_TYPES = [
  {
    value: "ORDER_DECISION",
    label: "Incorrect order decision",
    description: "Nemo passed, failed, missed, or left pending the wrong order."
  },
  {
    value: "TEAMSHIP_FIELD_UPDATE",
    label: "Incorrect Teamship field update",
    description: "Nemo wrote the wrong value to a Teamship field."
  },
  {
    value: "MISSING_TEAMSHIP_UPDATE",
    label: "Missing Teamship update",
    description: "Nemo should have updated a Teamship field but did not."
  },
  {
    value: "ORDER_PROCESSING",
    label: "Order was not processed",
    description: "An expected Garland order or batch was missed or stopped."
  },
  {
    value: "NOTIFICATION_OR_RESPONSE",
    label: "Notification or Nemo response problem",
    description: "An email, Teams response, explanation, or downloadable result was missing or wrong."
  },
  {
    value: "OTHER",
    label: "Other workflow problem",
    description: "A different Garland workflow problem that needs review."
  }
] as const;

export type GarlandFeedbackIssueType = typeof GARLAND_FEEDBACK_ISSUE_TYPES[number]["value"];

export const GARLAND_FEEDBACK_AFFECTED_FIELDS = [
  "Commodity",
  "Special Instructions",
  "Ship-to name",
  "Ship-to address/location",
  "Pallet dimensions/weights",
  "Editable BOL weight cleanup",
  "Other"
] as const;

const ISSUE_TYPE_VALUES = new Set<string>(
  GARLAND_FEEDBACK_ISSUE_TYPES.map((item) => item.value)
);

const SOURCE_EVIDENCE_TYPES = new Set<GarlandFeedbackIssueType>([
  "TEAMSHIP_FIELD_UPDATE",
  "MISSING_TEAMSHIP_UPDATE"
]);

export function isGarlandFeedbackIssueType(value: unknown): value is GarlandFeedbackIssueType {
  return typeof value === "string" && ISSUE_TYPE_VALUES.has(value);
}

export function feedbackUsesOrderDecisions(value: string | null | undefined) {
  return value === "ORDER_DECISION" || value === "CHECK_RESULT";
}

export function feedbackUsesFieldValues(value: string | null | undefined) {
  return value === "TEAMSHIP_FIELD_UPDATE" || value === "MISSING_TEAMSHIP_UPDATE";
}

export function feedbackRequiresSourceEvidence(value: string | null | undefined) {
  return isGarlandFeedbackIssueType(value) && SOURCE_EVIDENCE_TYPES.has(value);
}

export function describeFeedbackIssueType(value: string | null | undefined) {
  if (value === "CHECK_RESULT") return "Legacy check result — choose a clearer issue type";
  return GARLAND_FEEDBACK_ISSUE_TYPES.find((item) => item.value === value)?.label ??
    "Unclassified feedback";
}

export type GarlandFeedbackEvidenceFields = {
  affectedField: string;
  actualValue: string;
  expectedValue: string;
};

export function readGarlandFeedbackEvidence(value: unknown): GarlandFeedbackEvidenceFields {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    affectedField: typeof record.affectedField === "string" ? record.affectedField : "",
    actualValue: typeof record.actualValue === "string" ? record.actualValue : "",
    expectedValue: typeof record.expectedValue === "string" ? record.expectedValue : ""
  };
}
