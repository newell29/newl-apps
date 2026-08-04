import {
  ApolloCompanyMatchClassification,
  JobStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildApolloExceptionRecoveryAliases,
  buildApolloExceptionIdentityQueries,
  decideApolloExceptionResolution,
  requiresApolloExceptionIdentityResolution,
  selectCanonicalApolloIdentityReuse,
  summarizeApolloExceptionAutopilotStatus
} from "@/modules/lead-gen/apollo-exception-autopilot";
import { APOLLO_ZERO_CONTACT_REVIEW_REASON } from "@/modules/lead-gen/apollo-contact-discovery-review";
import type { ApolloOrganizationCandidate } from "@/server/integrations/apollo";
import type { ApolloIdentityResolutionSynthesis } from "@/server/integrations/openai-apollo-identity";

describe("Apollo exception autopilot guardrails", () => {
  it("auto-resolves only a unique direct candidate matching the verified domain", () => {
    expect(
      decideApolloExceptionResolution({
        synthesis: synthesis(),
        candidate: candidate(),
        evidence: identityEvidence()
      })
    ).toMatchObject({ autoResolved: true });
  });

  it("keeps low-confidence, ambiguous, or non-domain candidates in human review", () => {
    expect(
      decideApolloExceptionResolution({
        synthesis: synthesis({ confidence: 89 }),
        candidate: candidate(),
        evidence: identityEvidence()
      })
    ).toMatchObject({ autoResolved: false, reason: expect.stringContaining("below") });
    expect(
      decideApolloExceptionResolution({
        synthesis: synthesis({ disposition: "AMBIGUOUS" }),
        candidate: candidate(),
        evidence: identityEvidence()
      })
    ).toMatchObject({ autoResolved: false, reason: expect.stringContaining("ambiguous") });
    expect(
      decideApolloExceptionResolution({
        synthesis: synthesis(),
        candidate: candidate({ domainMatch: false }),
        evidence: identityEvidence()
      })
    ).toMatchObject({ autoResolved: false, reason: expect.stringContaining("official domain") });
  });

  it("does not auto-map when the model cites only a directory for the official domain", () => {
    expect(
      decideApolloExceptionResolution({
        synthesis: synthesis(),
        candidate: candidate(),
        evidence: [{
          ...identityEvidence()[0],
          sourceDomain: "linkedin.com",
          url: "https://linkedin.com/company/example"
        }]
      })
    ).toMatchObject({
      autoResolved: false,
      reason: expect.stringContaining("did not include")
    });
  });

  it("builds a bounded, deduplicated public-research plan from identity and geography", () => {
    expect(
      buildApolloExceptionIdentityQueries({
        companyId: "company-1",
        companyName: "Example Distribution LLC",
        normalizedName: "example-distribution-llc",
        knownDomain: null,
        primaryIndustry: "Retail",
        shipmentGeography: ["Charlotte, North Carolina"],
        priorApolloCandidates: [
          {
            organizationId: "org-1",
            companyName: "Example Brand",
            domain: "example.com",
            score: 62,
            classification: "MATCH_QUALITY_REVIEW"
          }
        ]
      })
    ).toEqual([
      '"Example Distribution LLC" official company website',
      '"Example Distribution LLC" parent company subsidiary operating brand',
      '"Example Distribution LLC" "Charlotte, North Carolina" company',
      '"Example Distribution LLC" "Example Brand" company relationship'
    ]);
  });

  it("adds a broader operating-brand recovery query for a noisy legal owner name", () => {
    expect(
      buildApolloExceptionRecoveryAliases(
        "THE ASPHALT HERCULES TIRE & RUBBER COMPANY, LLC"
      )
    ).toEqual(["HERCULES TIRE RUBBER"]);

    expect(
      buildApolloExceptionIdentityQueries({
        companyId: "company-hercules",
        companyName: "THE ASPHALT HERCULES TIRE & RUBBER COMPANY, LLC",
        normalizedName: "the-asphalt-hercules-tire-rubber-company-llc",
        knownDomain: null,
        primaryIndustry: "Automotive",
        shipmentGeography: ["Huntersville, North Carolina"],
        priorApolloCandidates: []
      })
    ).toContain(
      '"HERCULES TIRE RUBBER" official company website operating brand'
    );
  });

  it("reuses one tenant canonical Apollo organization and suppresses prior outreach", () => {
    expect(
      selectCanonicalApolloIdentityReuse({
        companyId: "duplicate-hyosung",
        synthesis: synthesis({
          operatingName: "HS Hyosung USA",
          legalName: "HS Hyosung USA Inc.",
          officialDomain: "hyosungusa.com"
        }),
        evidence: [{
          ...identityEvidence()[0],
          url: "https://hyosungusa.com/about",
          sourceDomain: "hyosungusa.com"
        }],
        companies: [{
          id: "canonical-hyosung",
          name: "HYOSUNG USA, INC.",
          domain: "https://www.hyosungusa.com",
          apolloOrganizationId: "apollo-hyosung",
          hasPriorOutreach: true
        }]
      })
    ).toMatchObject({
      canonicalCompanyId: "canonical-hyosung",
      hasPriorOutreach: true,
      candidate: {
        id: "apollo-hyosung",
        domain: "hyosungusa.com",
        classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
        domainMatch: true
      }
    });
  });

  it("does not reuse a shared domain when it points to multiple Apollo organizations", () => {
    expect(
      selectCanonicalApolloIdentityReuse({
        companyId: "company-new",
        synthesis: synthesis(),
        evidence: identityEvidence(),
        companies: [
          {
            id: "company-one",
            name: "Example Brand One",
            domain: "example.com",
            apolloOrganizationId: "apollo-one",
            hasPriorOutreach: true
          },
          {
            id: "company-two",
            name: "Example Brand Two",
            domain: "example.com",
            apolloOrganizationId: "apollo-two",
            hasPriorOutreach: false
          }
        ]
      })
    ).toBeNull();
  });

  it("reopens only the low-score, domainless, zero-employee direct-shell signature", () => {
    const shell = {
      classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
      apolloOrganizationId: "apollo-empty-shell",
      companyDomain: null,
      matchDomain: null,
      score: 19,
      matchReason: APOLLO_ZERO_CONTACT_REVIEW_REASON
    };
    expect(requiresApolloExceptionIdentityResolution(shell)).toBe(true);
    expect(
      requiresApolloExceptionIdentityResolution({
        ...shell,
        companyDomain: "example.com"
      })
    ).toBe(false);
    expect(
      requiresApolloExceptionIdentityResolution({
        ...shell,
        score: 20
      })
    ).toBe(false);
  });

  it("reports resolved, ambiguous, and failed runs separately", () => {
    expect(
      summarizeApolloExceptionAutopilotStatus({
        enabled: true,
        dailyCompanyLimit: 10,
        recent: [
          { status: JobStatus.SUCCESS, output: { state: "AUTO_RESOLVED" } },
          { status: JobStatus.SUCCESS, output: { state: "HUMAN_REVIEW_REQUIRED" } },
          { status: JobStatus.ERROR, output: { state: "ERROR" } }
        ],
        queued: 2,
        running: 1
      })
    ).toEqual({
      enabled: true,
      dailyCompanyLimit: 10,
      processedLast24Hours: 3,
      autoResolvedLast24Hours: 1,
      stillAmbiguousLast24Hours: 1,
      failedLast24Hours: 1,
      queued: 2,
      running: 1
    });
  });
});

function synthesis(
  overrides: Partial<ApolloIdentityResolutionSynthesis> = {}
): ApolloIdentityResolutionSynthesis {
  return {
    disposition: "EXACT_OPERATING_COMPANY",
    confidence: 96,
    operatingName: "Example Brand",
    legalName: "Example Distribution LLC",
    aliases: [],
    parentName: null,
    officialDomain: "example.com",
    geography: "Charlotte, North Carolina",
    evidenceIndices: [0],
    rationale: "The official site connects the legal entity to the brand.",
    ambiguityReasons: [],
    ...overrides
  };
}

function candidate(
  overrides: Partial<ApolloOrganizationCandidate> = {}
): ApolloOrganizationCandidate {
  return {
    id: "apollo-org-1",
    name: "Example Brand",
    domain: "example.com",
    linkedinUrl: null,
    score: 100,
    classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
    nameMatchType: "EXACT",
    domainMatch: true,
    strongBaseNameMatch: true,
    logisticsProviderMatch: false,
    branchLocationMatch: false,
    matchReason: "Exact verified domain match",
    query: {},
    rawPayload: {},
    ...overrides
  };
}

function identityEvidence() {
  return [{
    evidenceIndex: 0,
    query: '"Example Distribution LLC" official company website',
    title: "Example Brand",
    url: "https://example.com/about",
    sourceDomain: "example.com",
    excerpt: "Example Brand is the operating name of Example Distribution LLC."
  }];
}
