import { describe, expect, it } from "vitest";
import {
  HunterServiceLine,
  OutreachChannel,
  OutreachPlanStatus,
  OutreachQaStatus
} from "@prisma/client";
import {
  fingerprintOutreachEvidence,
  getOutreachPlanApolloBlockReason,
  mergeOutreachQaResults,
  runDeterministicOutreachQa,
  type GeneratedOutreachSequence,
  type OutreachEvidenceRecord,
  type OutreachStrategy
} from "@/modules/lead-gen/outreach-plan";

const evidence: OutreachEvidenceRecord[] = [
  {
    id: "company:identity",
    kind: "COMPANY",
    title: "Harbor Home identity",
    summary: "Jordan Demo is Director of Supply Chain at Harbor Home.",
    sourceUrl: "https://harborhome.example",
    publishedAt: null,
    facts: ["Company: Harbor Home", "Contact title: Director of Supply Chain"]
  },
  {
    id: "trademining:summary",
    kind: "TRADEMINING",
    title: "Saved shipment activity",
    summary: "4 shipments and 6 TEUs through Houston from Italy.",
    sourceUrl: null,
    publishedAt: "2026-07-20T00:00:00.000Z",
    facts: ["4 shipments", "6 TEUs", "Arrival port: Houston", "Origin country: Italy"]
  }
];

const strategy: OutreachStrategy = {
  serviceLine: HunterServiceLine.WAREHOUSING,
  opportunityType: "Recent inbound inventory activity",
  objective: "Confirm whether overflow warehousing support would be useful.",
  triggerSummary: "Saved TradeMining evidence shows recent Houston-bound activity.",
  buyerHypothesis: "The supply-chain director may influence inbound inventory and warehouse planning.",
  valueProposition: "Newl can review warehousing and freight handoff options.",
  likelyObjection: "The company may already have adequate capacity.",
  callToAction: "Ask whether a short capacity discussion is useful.",
  channelStrategy: ["Lead with evidence", "Use manual LinkedIn and call tasks", "Close with a low-friction question"],
  senderRecommendation: "Operations-led Newl sender",
  confidence: 82,
  evidenceRefs: ["company:identity", "trademining:summary"]
};

const sequence: GeneratedOutreachSequence = {
  sequenceName: "Warehouse Capacity Outreach",
  steps: [
    {
      stepNumber: 1,
      channel: OutreachChannel.EMAIL,
      delayDays: 0,
      subject: "Houston inbound capacity",
      body:
        "Hi Jordan,\n\nYour team has recent inbound activity through Houston. Would it be useful to compare overflow warehousing options near the lane?",
      angle: "Recent inbound activity",
      evidenceRefs: ["company:identity", "trademining:summary"]
    },
    {
      stepNumber: 2,
      channel: OutreachChannel.EMAIL,
      delayDays: 4,
      subject: "Warehousing around the Houston lane",
      body:
        "Hi Jordan,\n\nNewl can review warehousing and freight handoffs around Houston when inbound inventory needs flexibility. Is that relevant to your planning?",
      angle: "Operational flexibility",
      evidenceRefs: ["company:identity", "trademining:summary"]
    },
    {
      stepNumber: 3,
      channel: OutreachChannel.CALL_TASK,
      delayDays: 7,
      subject: null,
      body:
        "Call Jordan and ask whether inbound inventory planning or overflow warehousing sits with their team. Do not claim prior contact.",
      angle: "Responsibility confirmation",
      evidenceRefs: ["company:identity"]
    },
    {
      stepNumber: 4,
      channel: OutreachChannel.EMAIL,
      delayDays: 10,
      subject: "Worth comparing capacity?",
      body:
        "Hi Jordan,\n\nIf warehousing around the Houston lane is already covered, I can close the loop. If flexibility is useful, would a brief comparison help?",
      angle: "Low-friction close",
      evidenceRefs: ["company:identity", "trademining:summary"]
    }
  ]
};

describe("outreach plan grounding", () => {
  it("passes a complete hot-opportunity email sequence with one call task", () => {
    const result = runDeterministicOutreachQa({ evidence, strategy, sequence, allowCallTask: true });

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("blocks unknown citations, generic phrasing, and unsupported quantified claims", () => {
    const result = runDeterministicOutreachQa({
      evidence,
      strategy,
      allowCallTask: true,
      sequence: {
        ...sequence,
        steps: sequence.steps.map((step) =>
          step.stepNumber === 1
            ? {
                ...step,
                body:
                  "Hi Jordan,\n\nI hope this email finds you well. I noticed 100 shipments and wanted to discuss your expansion.",
                evidenceRefs: ["missing:evidence"]
              }
            : step
        )
      }
    });

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["UNKNOWN_EVIDENCE_REF", "BANNED_PHRASE", "UNSUPPORTED_QUANTIFIED_CLAIM"])
    );
  });

  it("fails closed when the model critic returns a blocking issue", () => {
    const deterministic = runDeterministicOutreachQa({ evidence, strategy, sequence, allowCallTask: true });
    const result = mergeOutreachQaResults(deterministic, {
      passed: false,
      issues: [
        {
          code: "BUYER_RESPONSIBILITY_UNSUPPORTED",
          severity: "ERROR",
          message: "The evidence does not prove that this contact owns warehouse capacity.",
          stepNumber: 2
        }
      ]
    });

    expect(result.passed).toBe(false);
    expect(result.issues[0]?.code).toBe("BUYER_RESPONSIBILITY_UNSUPPORTED");
  });

  it("creates a stable evidence fingerprint independent of input ordering", () => {
    expect(fingerprintOutreachEvidence(evidence)).toBe(
      fingerprintOutreachEvidence(evidence.slice().reverse())
    );
  });

  it("blocks Apollo until the current plan has passed QA and received human approval", () => {
    expect(
      getOutreachPlanApolloBlockReason({
        status: OutreachPlanStatus.QA_PASSED,
        qaStatus: OutreachQaStatus.PASSED
      })
    ).toContain("human approval");
    expect(
      getOutreachPlanApolloBlockReason({
        status: OutreachPlanStatus.APPROVED,
        qaStatus: OutreachQaStatus.PASSED
      })
    ).toBeNull();
  });
});
