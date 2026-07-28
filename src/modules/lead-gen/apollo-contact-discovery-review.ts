import { ApolloCompanyMatchClassification } from "@prisma/client";

export const APOLLO_ZERO_CONTACT_REVIEW_REASON =
  "Apollo verified the company but returned zero employees. Open the company in Apollo, select its People page, and paste that Apollo company URL for manual verification.";

export function requiresApolloMatchReview(
  classification: ApolloCompanyMatchClassification
) {
  return classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY;
}

export function resolveApolloContactDiscoveryMatch({
  classification,
  matchReason,
  contactsFound
}: {
  classification: ApolloCompanyMatchClassification;
  matchReason: string | null;
  contactsFound: number;
}) {
  if (
    classification === ApolloCompanyMatchClassification.DIRECT_COMPANY &&
    contactsFound === 0
  ) {
    return {
      classification: ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW,
      matchReason: matchReason
        ? `${matchReason}; ${APOLLO_ZERO_CONTACT_REVIEW_REASON}`
        : APOLLO_ZERO_CONTACT_REVIEW_REASON
    };
  }

  return {
    classification,
    matchReason
  };
}
