import {
  ApolloCompanyMatchClassification,
  JobStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildApolloExceptionIdentityQueries,
  decideApolloExceptionResolution,
  summarizeApolloExceptionAutopilotStatus
} from "@/modules/lead-gen/apollo-exception-autopilot";
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
