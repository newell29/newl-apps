import { describe, expect, it } from "vitest";

import {
  validateApolloIdentityResolution,
  type ApolloIdentityPublicEvidence
} from "@/server/integrations/openai-apollo-identity";

const EVIDENCE: ApolloIdentityPublicEvidence[] = [{
  evidenceIndex: 0,
  query: '"Example Legal LLC" official company website',
  title: "Example Brand | Charlotte",
  url: "https://example.com/locations/charlotte",
  sourceDomain: "example.com",
  excerpt: "Example Brand operates its Charlotte facility through Example Legal LLC."
}];

describe("OpenAI Apollo identity synthesis validation", () => {
  it("accepts a cited public identity and normalizes its official domain", () => {
    expect(validateApolloIdentityResolution({
      disposition: "EXACT_OPERATING_COMPANY",
      confidence: 96,
      operatingName: "Example Brand",
      legalName: "Example Legal LLC",
      aliases: [],
      parentName: null,
      officialDomain: "https://www.example.com/about",
      geography: "Charlotte, North Carolina",
      evidenceIndices: [0],
      rationale: "The official location page names the legal entity.",
      ambiguityReasons: []
    }, EVIDENCE)).toMatchObject({ officialDomain: "example.com" });
  });

  it("rejects positive identity claims without a cited official domain", () => {
    expect(() => validateApolloIdentityResolution({
      disposition: "VERIFIED_PARENT_OR_BRAND",
      confidence: 95,
      operatingName: "Example Brand",
      legalName: null,
      aliases: [],
      parentName: "Example Parent",
      officialDomain: null,
      geography: null,
      evidenceIndices: [0],
      rationale: "Unverified parent claim.",
      ambiguityReasons: []
    }, EVIDENCE)).toThrow("official domain");
  });

  it("rejects evidence indices that were not in the frozen packet", () => {
    expect(() => validateApolloIdentityResolution({
      disposition: "EXACT_OPERATING_COMPANY",
      confidence: 95,
      operatingName: "Example Brand",
      legalName: null,
      aliases: [],
      parentName: null,
      officialDomain: "example.com",
      geography: null,
      evidenceIndices: [4],
      rationale: "Invalid citation.",
      ambiguityReasons: []
    }, EVIDENCE)).toThrow("unavailable index");
  });
});
