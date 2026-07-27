import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HunterServiceLine, OutreachChannel } from "@prisma/client";
import {
  generateCompleteOutreachSequence,
  generateOutreachStrategy,
  reviewHunterContactFit,
  reviewOutreachSequenceGrounding
} from "@/server/integrations/openai";

describe("OpenAI structured outreach workflow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses strict Responses API output for strategy, sequence, and QA", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(responseWithOutput({
        serviceLine: "WAREHOUSING",
        opportunityType: "Recent inbound inventory",
        objective: "Confirm whether flexible warehousing is useful.",
        triggerSummary: "Saved evidence shows Houston-bound activity.",
        buyerHypothesis: "The supply-chain director may influence capacity planning.",
        valueProposition: "Newl can review warehouse and freight handoffs.",
        likelyObjection: "Capacity may already be covered.",
        callToAction: "Ask for a short comparison.",
        channelStrategy: ["Evidence-led email", "Manual role confirmation"],
        senderRecommendation: "Operations sender",
        confidence: 82,
        evidenceRefs: ["company:identity", "trademining:summary"]
      }))
      .mockResolvedValueOnce(responseWithOutput({
        sequenceName: "Warehouse Capacity Outreach",
        steps: [
          emailStep(1, 0),
          taskStep(2, 2, "LINKEDIN_TASK"),
          emailStep(3, 4),
          taskStep(4, 7, "CALL_TASK"),
          emailStep(5, 10)
        ]
      }))
      .mockResolvedValueOnce(responseWithOutput({
        passed: true,
        issues: []
      }));

    const evidence = [
      {
        id: "company:identity",
        kind: "COMPANY" as const,
        title: "Company identity",
        summary: "Jordan Demo is Director of Supply Chain at Harbor Home.",
        sourceUrl: "https://harborhome.example",
        publishedAt: null,
        facts: ["Contact title: Director of Supply Chain"]
      },
      {
        id: "trademining:summary",
        kind: "TRADEMINING" as const,
        title: "Saved shipment activity",
        summary: "Recent Houston-bound activity.",
        sourceUrl: null,
        publishedAt: "2026-07-20T00:00:00.000Z",
        facts: ["Arrival port: Houston"]
      }
    ];
    const contact = {
      firstName: "Jordan",
      fullName: "Jordan Demo",
      title: "Director of Supply Chain",
      department: "Logistics",
      seniority: "director"
    };
    const strategyGeneration = await generateOutreachStrategy({
      model: "gpt-5.6-terra",
      companyName: "Harbor Home",
      companyDomain: "harborhome.example",
      contact,
      selectedSequenceName: "Warehouse Capacity Outreach",
      recommendedPersona: "Supply-chain leader",
      recommendedCadence: "Warehouse Capacity Outreach",
      hunterDirective: hunterDirective(),
      evidence
    });
    const sequenceGeneration = await generateCompleteOutreachSequence({
      model: "gpt-5.6-luna",
      companyName: "Harbor Home",
      contact,
      selectedSequenceName: "Warehouse Capacity Outreach",
      strategy: strategyGeneration.strategy,
      evidence
    });
    const qaReview = await reviewOutreachSequenceGrounding({
      model: "gpt-5.6-luna",
      companyName: "Harbor Home",
      contact,
      strategy: strategyGeneration.strategy,
      sequence: sequenceGeneration.sequence,
      evidence
    });

    expect(strategyGeneration.strategy.serviceLine).toBe(HunterServiceLine.WAREHOUSING);
    expect(sequenceGeneration.sequence.steps).toHaveLength(5);
    expect(sequenceGeneration.sequence.steps[1]?.channel).toBe(OutreachChannel.LINKEDIN_TASK);
    expect(qaReview.result).toEqual({ passed: true, issues: [] });
    expect(strategyGeneration.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0
    });

    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe("https://api.openai.com/v1/responses");
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body.text.format.type).toBe("json_schema");
      expect(body.text.format.strict).toBe(true);
    }
    const strategyRequest = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string
    );
    expect(strategyRequest.input[1].content).toContain(
      '"requiredServiceLine":"WAREHOUSING"'
    );
  });

  it("rejects a strategy that changes Hunter's required service line", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(responseWithOutput({
      serviceLine: "TRUCKING",
      opportunityType: "Recent inbound inventory",
      objective: "Confirm whether flexible warehousing is useful.",
      triggerSummary: "Saved evidence shows Houston-bound activity.",
      buyerHypothesis: "The supply-chain director may influence capacity planning.",
      valueProposition: "Newl can review warehouse and freight handoffs.",
      likelyObjection: "Capacity may already be covered.",
      callToAction: "Ask for a short comparison.",
      channelStrategy: ["Evidence-led email"],
      senderRecommendation: "Operations sender",
      confidence: 82,
      evidenceRefs: ["company:identity"]
    }));

    await expect(
      generateOutreachStrategy({
        model: "gpt-5.6-terra",
        companyName: "Harbor Home",
        companyDomain: "harborhome.example",
        contact: {
          firstName: "Jordan",
          fullName: "Jordan Demo",
          title: "Director of Supply Chain",
          department: "Logistics",
          seniority: "director"
        },
        selectedSequenceName: "Warehouse Capacity Outreach",
        recommendedPersona: "Supply-chain leader",
        recommendedCadence: "Warehouse Capacity Outreach",
        hunterDirective: hunterDirective(),
        evidence: [{
          id: "company:identity",
          kind: "COMPANY",
          title: "Company identity",
          summary: "Jordan Demo is Director of Supply Chain at Harbor Home.",
          sourceUrl: "https://harborhome.example",
          publishedAt: null,
          facts: ["Contact title: Director of Supply Chain"]
        }]
      })
    ).rejects.toThrow("changed Hunter's required service line");
  });

  it("uses a strict, bounded buyer-role review before drafting", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      responseWithOutput({
        reviews: [{
          contactId: "contact-1",
          disposition: "PRIMARY",
          confidence: 88,
          responsibilityHypothesis:
            "A supply-chain director likely influences external warehousing capacity.",
          rationale:
            "The title and department align directly with Hunter's saved warehousing persona.",
          recommendedApproach:
            "Lead with the verified capacity trigger and ask who owns overflow warehousing.",
          riskFlags: ["Exact budget ownership is not verified."]
        }]
      })
    );

    const result = await reviewHunterContactFit({
      model: "gpt-5.6-luna",
      company: { name: "Harbor Home", domain: "harborhome.example" },
      opportunity: {
        serviceLine: HunterServiceLine.WAREHOUSING,
        opportunityType: "Warehouse expansion",
        rationale: "Verified expansion may create temporary capacity pressure.",
        recommendedPersona: "Director of Supply Chain"
      },
      contacts: [{
        contactId: "contact-1",
        fullName: "Jordan Demo",
        title: "Director of Supply Chain",
        department: "Logistics",
        seniority: "director",
        hasEmail: true,
        hasPhone: false,
        hasLinkedin: true
      }]
    });

    expect(result.reviews).toEqual([
      expect.objectContaining({
        contactId: "contact-1",
        disposition: "PRIMARY",
        confidence: 88
      })
    ]);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string
    );
    expect(body.text.format.name).toBe("newl_hunter_contact_fit");
    expect(body.text.format.strict).toBe(true);
    expect(body.input[1].content).not.toContain("test-openai-key");
  });
});

function hunterDirective() {
  return {
    researchSignalId: "signal-1",
    prospectingDecisionId: "decision-1",
    opportunityTier: "HOT_OPPORTUNITY" as const,
    requiredServiceLine: HunterServiceLine.WAREHOUSING,
    opportunityType: "Recent inbound inventory",
    rationale: "Lead with flexible warehouse capacity.",
    recommendedPersona: "Supply-chain leader",
    recommendedSender: "Operations sender",
    recommendedCadence: "Warehouse Capacity Outreach",
    finalScore: 86,
    finalConfidence: 82,
    researchRetrievedAt: "2026-07-26T12:00:00.000Z"
  };
}

function responseWithOutput(payload: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      output_text: JSON.stringify(payload)
    })
  } as unknown as Response;
}

function emailStep(stepNumber: number, delayDays: number) {
  return {
    stepNumber,
    channel: "EMAIL",
    delayDays,
    subject: "Houston inbound capacity",
    body:
      "Hi Jordan,\n\nYour team has recent inbound activity through Houston. Would a quick comparison of warehousing options be useful?",
    angle: "Evidence-led question",
    evidenceRefs: ["company:identity", "trademining:summary"]
  };
}

function taskStep(stepNumber: number, delayDays: number, channel: "LINKEDIN_TASK" | "CALL_TASK") {
  return {
    stepNumber,
    channel,
    delayDays,
    subject: null,
    body: "Review the saved role evidence and ask whether inbound inventory planning sits with this contact.",
    angle: "Confirm responsibility",
    evidenceRefs: ["company:identity"]
  };
}
