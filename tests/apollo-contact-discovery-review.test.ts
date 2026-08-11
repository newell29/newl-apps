import { ApolloCompanyMatchClassification } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  allowsApolloExceptionMutation,
  APOLLO_ZERO_CONTACT_REVIEW_REASON,
  blocksApolloEmployeeLookup,
  isMappedApolloZeroEmployeeState,
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

  it("recognizes a persisted mapping with a zero-employee result as safe for a read-only employee recheck", () => {
    expect(
      isMappedApolloZeroEmployeeState({
        apolloOrganizationId: "apollo-org-yat",
        matchReason:
          `direct company; ${APOLLO_ZERO_CONTACT_REVIEW_REASON}`
      })
    ).toBe(true);
  });

  it("does not treat an ordinary unresolved match as a confirmed mapped-company recheck", () => {
    expect(
      isMappedApolloZeroEmployeeState({
        apolloOrganizationId: "apollo-org-yat",
        matchReason: "Partial name match requires review."
      })
    ).toBe(false);
    expect(
      isMappedApolloZeroEmployeeState({
        apolloOrganizationId: null,
        matchReason: APOLLO_ZERO_CONTACT_REVIEW_REASON
      })
    ).toBe(false);
  });

  it("does not let the handoff guard block the mapped zero-employee recheck shown by the UI", () => {
    expect(
      blocksApolloEmployeeLookup({
        classification:
          ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW,
        apolloOrganizationId: "apollo-org-yat",
        matchReason:
          `direct company; ${APOLLO_ZERO_CONTACT_REVIEW_REASON}`
      })
    ).toBe(false);
  });

  it("keeps ordinary unresolved matches blocked before Apollo employee lookup", () => {
    expect(
      blocksApolloEmployeeLookup({
        classification:
          ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW,
        apolloOrganizationId: "apollo-org-yat",
        matchReason: "Partial name match requires review."
      })
    ).toBe(true);
  });

  it("allows a reviewer to replace or archive a direct company mapping after zero employees", () => {
    expect(
      allowsApolloExceptionMutation({
        classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
        apolloOrganizationId: "apollo-org-celgard",
        matchReason:
          `direct company; ${APOLLO_ZERO_CONTACT_REVIEW_REASON}`
      })
    ).toBe(true);
  });

  it("does not let the exception workflow replace an ordinary resolved direct company", () => {
    expect(
      allowsApolloExceptionMutation({
        classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
        apolloOrganizationId: "apollo-org-resolved",
        matchReason: "Direct company with employees."
      })
    ).toBe(false);
  });

  it("blocks repeat employee lookup after a mapped zero-employee exception is archived", () => {
    expect(
      blocksApolloEmployeeLookup({
        classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
        apolloOrganizationId: "apollo-org-celgard",
        matchReason:
          `direct company; ${APOLLO_ZERO_CONTACT_REVIEW_REASON}`,
        reviewedAt: new Date("2026-07-30T20:00:00.000Z")
      })
    ).toBe(true);
  });
});
