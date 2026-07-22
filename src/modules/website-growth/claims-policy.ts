export type WebsiteGrowthClaimFinding = {
  category: "PERFORMANCE" | "ABSOLUTE" | "CERTIFICATION" | "CUSTOMER_PROOF";
  disposition: "OWNER_CONFIRMATION" | "BLOCKED";
  excerpt: string;
  reason: string;
};

export type WebsiteGrowthClaimReview = {
  version: 1;
  status: "CLEAR" | "OWNER_CONFIRMATION_REQUIRED" | "BLOCKED";
  findings: WebsiteGrowthClaimFinding[];
  policyNotes: string[];
};

const PERFORMANCE_PATTERN = /\b\d+(?:\.\d+)?\s*(?:%|\+|days?|hours?|years?|locations?|customers?|businesses?|orders?|shipments?)(?=\s|$|[.,;:])/i;
const ABSOLUTE_PATTERN = /\b(?:guaranteed|always|never|zero\s+(?:errors?|damage|downtime)|100\s*%|best\s+in\s+class|#\s*1|number\s+one)\b/i;
const CERTIFICATION_PATTERN = /\b(?:certified|certification|NVOCC|IATA|TSA|Amazon\s+SPN|C-TPAT|ISO\s*\d*)\b/i;
const CUSTOMER_PROOF_PATTERN = /\b(?:trusted\s+by|customer\s+(?:logo|testimonial|case\s+study)|serves?\s+more\s+than)\b/i;

export function reviewWebsiteGrowthClaims(value: unknown): WebsiteGrowthClaimReview {
  const findings: WebsiteGrowthClaimFinding[] = [];

  for (const text of collectVisitorFacingText(value)) {
    if (ABSOLUTE_PATTERN.test(text)) {
      findings.push({
        category: "ABSOLUTE",
        disposition: "BLOCKED",
        excerpt: excerpt(text),
        reason: "Absolute or guarantee language must be removed; an approval cannot make an unbounded claim safe."
      });
      continue;
    }

    if (PERFORMANCE_PATTERN.test(text)) {
      findings.push({
        category: "PERFORMANCE",
        disposition: "OWNER_CONFIRMATION",
        excerpt: excerpt(text),
        reason: "Numerical performance claims need a named source, reporting period, owner, and review date."
      });
    }

    if (CERTIFICATION_PATTERN.test(text)) {
      findings.push({
        category: "CERTIFICATION",
        disposition: "OWNER_CONFIRMATION",
        excerpt: excerpt(text),
        reason: "Certification and affiliation claims need current documentary evidence and an expiry or review date."
      });
    }

    if (CUSTOMER_PROOF_PATTERN.test(text)) {
      findings.push({
        category: "CUSTOMER_PROOF",
        disposition: "OWNER_CONFIRMATION",
        excerpt: excerpt(text),
        reason: "Customer names, logos, testimonials, and volume claims require explicit permission and evidence."
      });
    }
  }

  const unique = deduplicateFindings(findings);
  const status = unique.some((finding) => finding.disposition === "BLOCKED")
    ? "BLOCKED"
    : unique.length > 0
      ? "OWNER_CONFIRMATION_REQUIRED"
      : "CLEAR";

  return {
    version: 1,
    status,
    findings: unique,
    policyNotes: [
      "Operational capabilities may be described without invented outcomes or guarantees.",
      "New numerical claims require the metric definition, source, reporting period, sample, owner, and next review date.",
      "Certifications, customer proof, and comparative claims must be revalidated before reuse on a new page."
    ]
  };
}

function collectVisitorFacingText(value: unknown) {
  if (!isRecord(value)) return [];
  const selected = [
    value.title,
    value.summary,
    value.metaTitle,
    value.metaDescription,
    value.sections,
    value.faqs,
    value.pagePreview
  ];
  const strings: string[] = [];

  const visit = (entry: unknown) => {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed) strings.push(trimmed);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (isRecord(entry)) Object.values(entry).forEach(visit);
  };

  selected.forEach(visit);
  return strings;
}

function deduplicateFindings(findings: WebsiteGrowthClaimFinding[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.category}:${finding.disposition}:${finding.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function excerpt(value: string) {
  return value.length > 220 ? `${value.slice(0, 217)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
