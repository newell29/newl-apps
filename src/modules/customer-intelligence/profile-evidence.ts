/**
 * Pure helpers for the Customer Profile UI (CP-PHASE-02B-4).
 *
 * `extractPotentialContactsFromEvidence` reads only existing stored evidence
 * (the JSON `evidence` payload on a `CustomerIdentityMatch`) and never
 * fabricates values. It is used by the unmatched-company directory view so
 * potential contacts are suggestions derived from stored QuickBooks email /
 * phone evidence only — there is no Microsoft 365 or signature extraction in
 * this phase, and email bodies are never read or displayed.
 */

export type PotentialContactEvidence = {
  kind: "EMAIL" | "PHONE";
  value: string;
  source: string;
};

/**
 * Deterministically extract email/phone potential contacts from a stored
 * identity-match evidence payload. Unknown, non-string, empty, and oversized
 * values are skipped; duplicate values are de-duplicated. The returned rows are
 * suggestions only and never represent an approved contact.
 */
export function extractPotentialContactsFromEvidence(value: unknown): PotentialContactEvidence[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const raw = value as Record<string, unknown>;
  const result: PotentialContactEvidence[] = [];
  const seen = new Set<string>();

  const add = (kind: "EMAIL" | "PHONE", field: unknown) => {
    if (typeof field !== "string") {
      return;
    }
    const normalized = field.trim();
    if (!normalized || normalized.length > 240) {
      return;
    }
    const key = `${kind}:${normalized.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push({ kind, value: normalized, source: "stored identity-match evidence" });
  };

  add("EMAIL", raw.email);
  add("PHONE", raw.phone);

  return result;
}
