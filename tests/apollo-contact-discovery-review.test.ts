import { ApolloCompanyMatchClassification } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  APOLLO_ZERO_CONTACT_REVIEW_REASON,
  requiresApolloMatchReview,
  resolveApolloContactDiscoveryMatch
} from "@/modules/lead-gen/apollo-contact-discovery-review";

describe("Apollo contact-discovery review", () => {
  it("keeps a verified company mapped when employee discovery returns zero results", () => {
    const result = resolveApolloContactDiscoveryMatch({
      classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
      matchReason: "Exact saved Apollo organization.",
      contactsFound: 0
    });

    expect(result).toEqual({
      classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
      matchReason: `Exact saved Apollo organization.; ${APOLLO_ZERO_CONTACT_REVIEW_REASON}`
    });
    expect(requiresApolloMatchReview(result.classification)).toBe(false);
  });

  it("keeps a direct match resolved when Apollo returns employees", () => {
    const result = resolveApolloContactDiscoveryMatch({
      classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
      matchReason: "Exact saved Apollo organization.",
      contactsFound: 12
    });

    expect(result.classification).toBe(
      ApolloCompanyMatchClassification.DIRECT_COMPANY
    );
    expect(requiresApolloMatchReview(result.classification)).toBe(false);
  });

  it("preserves an existing unsafe company-match classification", () => {
    const result = resolveApolloContactDiscoveryMatch({
      classification: ApolloCompanyMatchClassification.NO_MATCH,
      matchReason: "No Apollo company matched.",
      contactsFound: 0
    });

    expect(result).toEqual({
      classification: ApolloCompanyMatchClassification.NO_MATCH,
      matchReason: "No Apollo company matched."
    });
  });
});
