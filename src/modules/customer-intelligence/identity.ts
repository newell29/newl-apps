import {
  FREE_MAIL_DOMAINS,
  IDENTITY_AUTO_LINK_THRESHOLD,
  IDENTITY_SCORE_EXACT_PERSISTED_MAPPING,
  IDENTITY_SCORE_NAME_PLUS_PHONE_OR_ADDRESS,
  IDENTITY_SCORE_UNIQUE_DOMAIN_PLUS_NAME
} from "@/modules/customer-intelligence/constants";

export type IdentityEvidenceInput = {
  /** Compatible normalized company name. */
  compatibleName: boolean;
  /** Domain observed only for this candidate company. */
  uniqueDomain: boolean;
  /** Matching phone or billing/shipping address. */
  phoneOrAddressMatch: boolean;
  /** Exact realm/customer mapping already persisted for this tenant. */
  exactPersistedMapping: boolean;
  /** Previously approved stable QuickBooks ID or alias. */
  previouslyApprovedStableId: boolean;
  /** The candidate domain is a free-mail provider. */
  domainIsFreeMail: boolean;
};

export const IDENTITY_NO_AUTO_LINK_SCORE = 0;

/**
 * Deterministic identity-match score per the approved Customer Intelligence
 * plan:
 *
 * - 100: previously approved stable QuickBooks ID or alias.
 * - 100: exact persisted realm/customer mapping.
 * - 95: unique domain plus compatible normalized name.
 * - 92: compatible normalized name plus matching phone or address.
 * - below 90: human review.
 *
 * Exact normalized name alone never auto-links, and free-mail domains never
 * establish company identity.
 */
export function computeIdentityMatchScore(input: IdentityEvidenceInput): number {
  if (input.exactPersistedMapping || input.previouslyApprovedStableId) {
    return IDENTITY_SCORE_EXACT_PERSISTED_MAPPING;
  }

  const effectiveUniqueDomain = input.uniqueDomain && !input.domainIsFreeMail;

  if (effectiveUniqueDomain && input.compatibleName) {
    return IDENTITY_SCORE_UNIQUE_DOMAIN_PLUS_NAME;
  }

  if (input.compatibleName && input.phoneOrAddressMatch) {
    return IDENTITY_SCORE_NAME_PLUS_PHONE_OR_ADDRESS;
  }

  return IDENTITY_NO_AUTO_LINK_SCORE;
}

export function shouldAutoLink(score: number): boolean {
  return score >= IDENTITY_AUTO_LINK_THRESHOLD;
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase().trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function extractEmailDomain(value: string): string | null {
  const normalized = normalizeEmail(value);
  const atIndex = normalized.indexOf("@");
  if (atIndex === -1) {
    return null;
  }
  const domain = normalized.slice(atIndex + 1).trim();
  return domain.length > 0 ? domain : null;
}

export function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Company names are compatible when their normalized forms are equal or when
 * the shorter normalized form is a token-contained subset. Name-only matches
 * never auto-link (see computeIdentityMatchScore).
 */
export function companyNamesCompatible(a: string, b: string): boolean {
  const normalizedA = normalizeCompanyName(a);
  const normalizedB = normalizeCompanyName(b);
  if (normalizedA.length === 0 || normalizedB.length === 0) {
    return false;
  }
  if (normalizedA === normalizedB) {
    return true;
  }
  const tokensA = normalizedA.split(" ");
  const tokensB = normalizedB.split(" ");
  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  if (shorter.length === 0) {
    return false;
  }
  const contained = shorter.every((token) => longer.includes(token));
  return shorter.length >= 2 && contained;
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

export function phonesMatch(a: string, b: string): boolean {
  const normalizedA = normalizePhone(a);
  const normalizedB = normalizePhone(b);
  if (normalizedA.length < 7 || normalizedB.length < 7) {
    return false;
  }
  return normalizedA === normalizedB;
}
