import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateHunterResearchLunaShadow,
  type HunterResearchShadowPacket,
  type HunterResearchShadowSynthesis,
  validateHunterResearchShadowResponse
} from "@/server/integrations/openai-hunter-research-shadow";

describe("OpenAI Luna Hunter research shadow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Luna with strict Responses API output and no tools", async () => {
    const packets = [packet()];
    const luna = synthesis();
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      responseWithOutput({ companies: [luna] })
    );

    const result = await generateHunterResearchLunaShadow({
      model: "gpt-5.6-luna",
      promptVersion: "hunter-company-research-v16-luna-shadow-v1",
      packets,
      safetyIdentifier: "tenant-hash"
    });

    expect(result.rows).toEqual([luna]);
    expect(result.usage).toEqual({
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 40,
      totalTokens: 160,
      durationMs: expect.any(Number)
    });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse((request as RequestInit).body as string);
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      safety_identifier: "tenant-hash",
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "hunter_company_research_shadow",
          strict: true
        }
      }
    });
    expect(body.tools).toBeUndefined();
    expect(body.input[0].content).toContain(
      "bill-of-lading record naming a separate logistics company as notify party"
    );
    expect(body.input[1].content).toContain("Do not browse, call tools, or invent facts.");
    expect(body.input[1].content).toContain('"evidenceIndex":0');
    expect(body.input[1].content).not.toContain(
      "First-party evidence identifies the operating retailer."
    );
  });

  it("rejects incomplete provider responses without trying to parse partial JSON", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: []
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(
      generateHunterResearchLunaShadow({
        model: "gpt-5.6-luna",
        promptVersion: "hunter-company-research-v16-luna-shadow-v1",
        packets: [packet()],
        safetyIdentifier: "tenant-hash"
      })
    ).rejects.toThrow("incomplete: max_output_tokens");
  });

  it("requires exactly one valid row and only available evidence indices", () => {
    const packets = [packet()];
    expect(() =>
      validateHunterResearchShadowResponse({ companies: [] }, packets)
    ).toThrow("exactly one row");
    expect(() =>
      validateHunterResearchShadowResponse({
        companies: [{ ...synthesis(), triggerEvidenceIndices: [7] }]
      }, packets)
    ).toThrow("unavailable evidence index");
  });
});

function packet(): HunterResearchShadowPacket {
  const qwenSynthesis = synthesis();
  return {
    companyId: "company-1",
    companyKey: "example-retailer",
    companyName: "Example Retailer",
    domain: "example.com",
    priorityScore: 80,
    primaryIndustry: "Retail",
    shipmentEvidence: [],
    existingSignals: [],
    publicEvidence: [{
      evidenceIndex: 0,
      pass: "FRESH_EVENTS",
      query: "Example Retailer expansion",
      title: "Example Retailer opens a distribution center",
      url: "https://example.com/news",
      sourceDomain: "example.com",
      sourceType: "FIRST_PARTY",
      publishedAt: "2026-07-20T00:00:00.000Z",
      excerpt: "Example Retailer opened a North Carolina distribution center.",
      firstParty: true
    }],
    qwenSynthesis
  };
}

function synthesis(): HunterResearchShadowSynthesis {
  return {
    companyKey: "example-retailer",
    identityDisposition: "PASS",
    identityConfidence: 92,
    identityReason: "First-party evidence identifies the operating retailer.",
    logisticsProvider: false,
    namedExternalLogisticsProvider: false,
    stableExclusiveProviderEvidence: false,
    providerDisplacementEvidence: false,
    freshness: "FRESH",
    opportunitySummary: "A new distribution center supports a current warehousing opportunity.",
    triggerEvidenceIndices: [0],
    geography: "North Carolina",
    companyCountry: "United States",
    operatingRegion: "NORTH_AMERICA",
    verifiedUsDivision: false,
    usDivisionName: null,
    usDivisionEvidenceIndices: [],
    serviceLine: "WAREHOUSING",
    signalType: "FACILITY_OPENING",
    confidence: 88,
    rationale: "The dated exact-company facility event is directly relevant.",
    missingEvidence: [],
    followUpQueries: []
  };
}

function responseWithOutput(output: unknown) {
  return new Response(JSON.stringify({
    status: "completed",
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify(output)
      }]
    }],
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 40,
      total_tokens: 160
    }
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
