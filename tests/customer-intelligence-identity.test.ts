import { describe, expect, it } from "vitest";

import {
  computeIdentityMatchScore,
  companyNamesCompatible,
  extractEmailDomain,
  isFreeMailDomain,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  phonesMatch,
  shouldAutoLink,
  type IdentityEvidenceInput
} from "@/modules/customer-intelligence/identity";
import { IDENTITY_AUTO_LINK_THRESHOLD } from "@/modules/customer-intelligence/constants";

const noEvidence: IdentityEvidenceInput = {
  compatibleName: false,
  uniqueDomain: false,
  phoneOrAddressMatch: false,
  exactPersistedMapping: false,
  previouslyApprovedStableId: false,
  domainIsFreeMail: false
};

function score(overrides: Partial<IdentityEvidenceInput> = {}): number {
  return computeIdentityMatchScore({ ...noEvidence, ...overrides });
}

describe("computeIdentityMatchScore", () => {
  it("returns 100 for a previously approved stable QuickBooks ID or alias", () => {
    expect(score({ previouslyApprovedStableId: true })).toBe(100);
  });

  it("returns 100 for an exact persisted realm/customer mapping", () => {
    expect(score({ exactPersistedMapping: true })).toBe(100);
  });

  it("returns 95 for a unique domain plus a compatible normalized name", () => {
    expect(score({ uniqueDomain: true, compatibleName: true })).toBe(95);
    expect(shouldAutoLink(95)).toBe(true);
  });

  it("returns 92 for a compatible normalized name plus a matching phone or address", () => {
    expect(score({ compatibleName: true, phoneOrAddressMatch: true })).toBe(92);
    expect(shouldAutoLink(92)).toBe(true);
  });

  it("never auto-links on exact normalized name alone", () => {
    expect(score({ compatibleName: true })).toBe(0);
    expect(shouldAutoLink(0)).toBe(false);
  });

  it("keeps a unique domain without a name in human review", () => {
    expect(score({ uniqueDomain: true })).toBe(0);
  });

  it("keeps a name plus unique domain when the domain is free-mail in human review", () => {
    expect(score({ uniqueDomain: true, compatibleName: true, domainIsFreeMail: true })).toBe(0);
  });

  it("keeps completely missing external evidence in human review", () => {
    expect(score(noEvidence)).toBe(0);
  });

  it("keeps partial evidence (phone only, no name/domain) in human review", () => {
    expect(score({ phoneOrAddressMatch: true })).toBe(0);
  });

  it("requires score >= 90 for auto-link", () => {
    expect(shouldAutoLink(89)).toBe(false);
    expect(shouldAutoLink(90)).toBe(true);
    expect(shouldAutoLink(100)).toBe(true);
    expect(IDENTITY_AUTO_LINK_THRESHOLD).toBe(90);
  });
});

describe("free-mail domain handling", () => {
  it("detects common free-mail domains", () => {
    expect(isFreeMailDomain("gmail.com")).toBe(true);
    expect(isFreeMailDomain("GMAIL.COM")).toBe(true);
    expect(isFreeMailDomain("outlook.com")).toBe(true);
    expect(isFreeMailDomain("newlgroup.example")).toBe(false);
  });
});

describe("normalization helpers", () => {
  it("normalizes emails and extracts domains", () => {
    expect(normalizeEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
    expect(extractEmailDomain("buyer@example.com")).toBe("example.com");
    expect(extractEmailDomain("no-at-sign")).toBeNull();
  });

  it("normalizes company names", () => {
    expect(normalizeCompanyName("  Acme  Global, Inc. ")).toBe("acme global inc");
  });

  it("treats normalized names as compatible when equal", () => {
    expect(companyNamesCompatible("Acme Global Inc.", "Acme Global, Inc.")).toBe(true);
  });

  it("treats token-contained names as compatible", () => {
    expect(companyNamesCompatible("Acme Global", "Acme Global Holdings LLC")).toBe(true);
  });

  it("does not treat unrelated names as compatible", () => {
    expect(companyNamesCompatible("Acme Global", "Beta Warehouse Co.")).toBe(false);
  });

  it("normalizes phones and matches 10-digit numbers with country prefixes", () => {
    expect(normalizePhone("+1 (416) 555-0134")).toBe("4165550134");
    expect(phonesMatch("(416) 555-0134", "+1 416-555-0134")).toBe(true);
    expect(phonesMatch("(416) 555-0134", "(212) 555-0199")).toBe(false);
  });
});
