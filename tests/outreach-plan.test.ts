import { describe, expect, it } from "vitest";
import {
  ContactStatus,
  HunterServiceLine,
  OutreachChannel,
  OutreachPlanStatus,
  OutreachQaStatus,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import {
  classifyOutreachQaIssues,
  fingerprintOutreachEvidence,
  getOutreachRegenerationBlockReason,
  getOutreachPlanApolloBlockReason,
  isCurrentOutreachDraft,
  mergeOutreachQaResults,
  repairOutreachSequenceDeterministically,
  runDeterministicOutreachQa,
  VISIBLE_OUTREACH_PLAN_VERSION_WHERE,
  type GeneratedOutreachSequence,
  type OutreachEvidenceRecord,
  type OutreachStrategy
} from "@/modules/lead-gen/outreach-plan";
import {
  buildApprovedNewlCapabilityEvidence,
  buildBoundedOutreachRepairFeedback,
  normalizeHunterChannelStrategy,
  runBoundedOutreachQaRepair,
  shouldReuseExistingOutreachPlan
} from "@/modules/lead-gen/outreach-plan-generation";

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
  channelStrategy: ["Lead with evidence", "Use one manual call task", "Close with a low-friction question"],
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
        "Hi Jordan,\n\nYour team has recent inbound activity through Houston. Would it be useful to compare overflow warehousing options near the lane?\n\nAlex",
      angle: "Recent inbound activity",
      evidenceRefs: ["company:identity", "trademining:summary"]
    },
    {
      stepNumber: 2,
      channel: OutreachChannel.EMAIL,
      delayDays: 4,
      subject: "Warehousing around the Houston lane",
      body:
        "Hi Jordan,\n\nNewl can review warehousing and freight handoffs around Houston when inbound inventory needs flexibility. Is that relevant to your planning?\n\nAlex",
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
        "Hi Jordan,\n\nIf warehousing around the Houston lane is already covered, I can close the loop. If flexibility is useful, would a brief comparison help?\n\nAlex",
      angle: "Low-friction close",
      evidenceRefs: ["company:identity", "trademining:summary"]
    }
  ]
};

describe("outreach plan grounding", () => {
  it("keeps compatible QA-passed plans visible while hiding failed legacy plans", () => {
    expect(VISIBLE_OUTREACH_PLAN_VERSION_WHERE).toEqual({
      OR: [
        {
          promptVersion: "outreach-plan-v2.5"
        },
        {
          promptVersion: {
            in: ["outreach-plan-v2.4"]
          },
          qaStatus: OutreachQaStatus.PASSED
        }
      ]
    });
  });

  it("preserves passed v2.4 plans while upgrading only failed plans to the corrected policy", () => {
    expect(
      shouldReuseExistingOutreachPlan({
        promptVersion: "outreach-plan-v2.4",
        qaStatus: OutreachQaStatus.PASSED
      })
    ).toBe(true);
    expect(
      shouldReuseExistingOutreachPlan({
        promptVersion: "outreach-plan-v2.4",
        qaStatus: OutreachQaStatus.FAILED
      })
    ).toBe(false);
    expect(
      shouldReuseExistingOutreachPlan({
        promptVersion: "outreach-plan-v2.5",
        qaStatus: OutreachQaStatus.FAILED
      })
    ).toBe(true);
  });

  it("regenerates an unapproved plan when Hunter replaces a legacy cadence", () => {
    expect(
      shouldReuseExistingOutreachPlan({
        promptVersion: "outreach-plan-v2.5",
        qaStatus: OutreachQaStatus.PASSED,
        existingSequenceName: "Tier 1 Sequence",
        selectedSequenceName: "Hunter - Executive Referral"
      })
    ).toBe(false);

    expect(
      shouldReuseExistingOutreachPlan({
        promptVersion: "outreach-plan-v2.5",
        qaStatus: OutreachQaStatus.PASSED,
        existingSequenceName: "Hunter - Executive Referral",
        selectedSequenceName: "Hunter - Executive Referral"
      })
    ).toBe(true);
  });

  it("adds only owner-approved service-line capabilities to the grounding ledger", () => {
    const capability = buildApprovedNewlCapabilityEvidence(HunterServiceLine.WAREHOUSING);

    expect(capability).toMatchObject({
      id: "newl-capability:warehousing",
      kind: "NEWL_CAPABILITY"
    });
    expect(capability.facts).toContain(
      "Newl can provide supplemental and flexible warehousing support."
    );
    expect(capability.facts.join(" ")).not.toMatch(/guarantee|unlimited|cheapest/i);
  });

  it("normalizes the model strategy to Hunter's authoritative cadence", () => {
    expect(
      normalizeHunterChannelStrategy({
        ...strategy,
        channelStrategy: ["Email on day 3", "Email on day 6"]
      }, true).channelStrategy
    ).toEqual([
      "Email on day 0",
      "Email on day 4",
      "Separate human call task on day 7",
      "Email on day 10"
    ]);

    expect(
      normalizeHunterChannelStrategy({
        ...strategy,
        channelStrategy: ["Call after the second email"]
      }, false).channelStrategy
    ).toEqual([
      "Email on day 0",
      "Email on day 4",
      "Email on day 10"
    ]);
  });

  it("builds one bounded repair instruction from deterministic and model QA issues", () => {
    const feedback = buildBoundedOutreachRepairFeedback({
      deterministicIssues: [{
        code: "CHANNEL_MIX",
        severity: "ERROR",
        message: "The call task was labeled as an email.",
        stepNumber: 3
      }],
      modelIssues: [{
        code: "INTERNAL_REFERENCE",
        severity: "ERROR",
        message: "Customer-visible copy says saved shipment activity.",
        stepNumber: 1
      }],
      allowCallTask: true,
      senderFirstName: "Alex"
    });

    expect(feedback).toContain("Automatic bounded QA repair");
    expect(feedback).toContain("CALL_TASK on day 7");
    expect(feedback).toContain("saved activity");
    expect(feedback).toContain("Step 3: The call task was labeled as an email.");
    expect(feedback).toContain("Step 1: Customer-visible copy says saved shipment activity.");
  });

  it("does not retry when model QA itself is unavailable", () => {
    expect(buildBoundedOutreachRepairFeedback({
      deterministicIssues: [],
      modelIssues: [{
        code: "MODEL_QA_UNAVAILABLE",
        severity: "ERROR",
        message: "Timed out.",
        stepNumber: null
      }],
      allowCallTask: false,
      senderFirstName: "Alex"
    })).toBeNull();
  });

  it("repairs a deterministic sequence failure once before model QA", async () => {
    let draftCalls = 0;
    let modelQaCalls = 0;
    const result = await runBoundedOutreachQaRepair({
      generateSequence: async (repairFeedback) => {
        draftCalls += 1;
        return {
          sequence: repairFeedback
            ? sequence
            : {
                ...sequence,
                steps: sequence.steps.map((step) =>
                  step.stepNumber === 3
                    ? { ...step, channel: OutreachChannel.EMAIL }
                    : step
                )
              },
          usage: usage()
        };
      },
      runDeterministicQa: (candidateSequence) =>
        runDeterministicOutreachQa({
          evidence,
          strategy,
          sequence: candidateSequence,
          senderFirstName: "Alex",
          allowCallTask: true
        }),
      runModelQa: async () => {
        modelQaCalls += 1;
        return {
          result: { passed: true, issues: [] },
          usage: usage()
        };
      },
      allowCallTask: true,
      senderFirstName: "Alex"
    });

    expect(draftCalls).toBe(2);
    expect(modelQaCalls).toBe(1);
    expect(result.automaticRepairAttempted).toBe(true);
    expect(result.deterministicQa.passed).toBe(true);
    expect(result.modelQa.passed).toBe(true);
  });

  it("repairs a model grounding failure once and reruns both gates", async () => {
    let draftCalls = 0;
    let modelQaCalls = 0;
    const result = await runBoundedOutreachQaRepair({
      generateSequence: async () => {
        draftCalls += 1;
        return { sequence, usage: usage() };
      },
      runDeterministicQa: (candidateSequence) =>
        runDeterministicOutreachQa({
          evidence,
          strategy,
          sequence: candidateSequence,
          senderFirstName: "Alex",
          allowCallTask: true
        }),
      runModelQa: async () => {
        modelQaCalls += 1;
        return {
          result: modelQaCalls === 1
            ? {
                passed: false,
                issues: [{
                  code: "UNSUPPORTED_CLAIM",
                  severity: "ERROR",
                  message: "Customer-visible copy says saved shipment activity.",
                  stepNumber: 1
                }]
              }
            : { passed: true, issues: [] },
          usage: usage()
        };
      },
      allowCallTask: true,
      senderFirstName: "Alex"
    });

    expect(draftCalls).toBe(2);
    expect(modelQaCalls).toBe(2);
    expect(result.automaticRepairAttempted).toBe(true);
    expect(result.modelQa.passed).toBe(true);
    expect(result.draftingUsageAttempts).toHaveLength(2);
    expect(result.qaUsageAttempts).toHaveLength(2);
  });

  it("repairs whitespace-damaged evidence refs and strips ledger annotations without another draft", async () => {
    let draftCalls = 0;
    const malformed = {
      ...sequence,
      steps: sequence.steps.map((step) =>
        step.stepNumber === 1
          ? {
              ...step,
              subject: "Houston inbound [tr ademining:summary]",
              body:
                "Hi Jordan,\n\nYour Houston activity may create a warehousing need. Evidence: company:identity\n\nAlex",
              evidenceRefs: ["company:identity", "tr ademining:summary"]
            }
          : step
      )
    };
    const result = await runBoundedOutreachQaRepair({
      generateSequence: async () => {
        draftCalls += 1;
        return { sequence: malformed, usage: usage() };
      },
      repairSequence: (candidate) =>
        repairOutreachSequenceDeterministically({
          evidence,
          sequence: candidate
        }).sequence,
      runDeterministicQa: (candidate) =>
        runDeterministicOutreachQa({
          evidence,
          strategy,
          sequence: candidate,
          senderFirstName: "Alex",
          allowCallTask: true
        }),
      runModelQa: async () => ({
        result: { passed: true, issues: [] },
        usage: usage()
      }),
      allowCallTask: true,
      senderFirstName: "Alex"
    });

    expect(draftCalls).toBe(1);
    expect(result.automaticRepairAttempted).toBe(false);
    expect(result.deterministicQa.issues).toEqual([]);
    expect(result.sequence.steps[0]?.evidenceRefs).toContain("trademining:summary");
    expect(result.sequence.steps[0]?.subject).not.toMatch(/tr\s*ademining/i);
    expect(result.sequence.steps[0]?.body).not.toContain("company:identity");
  });

  it("detects arbitrary saved evidence IDs in outbound copy", () => {
    const dynamicEvidence = [
      ...evidence,
      {
        ...evidence[0],
        id: "hunter-signal:custom-987",
        title: "Custom signal"
      }
    ];
    const candidate = {
      ...sequence,
      steps: sequence.steps.map((step) =>
        step.stepNumber === 1
          ? { ...step, body: `${step.body}\n[hunter-signal:custom-987]` }
          : step
      )
    };

    expect(
      runDeterministicOutreachQa({
        evidence: dynamicEvidence,
        strategy,
        sequence: candidate,
        senderFirstName: "Alex",
        allowCallTask: true
      }).issues
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INTERNAL_REFERENCE", stepNumber: 1 })
      ])
    );
  });

  it("classifies repair work and allows regeneration after finished historical outreach", () => {
    const malformedEvidenceSequence = {
      ...sequence,
      steps: sequence.steps.map((step) =>
        step.stepNumber === 1
          ? {
              ...step,
              body: `${step.body}\n[tr ademining:summary]`,
              evidenceRefs: ["company:identity", "tr ademining:summary"]
            }
          : step
      )
    };
    expect(
      classifyOutreachQaIssues([{
        code: "INTERNAL_REFERENCE",
        severity: "ERROR",
        message: "Internal evidence ID is visible.",
        stepNumber: 1
      }], evidence, malformedEvidenceSequence)
    ).toBe("AUTOMATIC");
    expect(
      classifyOutreachQaIssues([{
        code: "UNKNOWN_EVIDENCE_REF",
        severity: "ERROR",
        message: 'Evidence reference "tr ademining:summary" is not in the saved evidence ledger.',
        stepNumber: 1
      }], evidence, malformedEvidenceSequence)
    ).toBe("AUTOMATIC");
    expect(
      classifyOutreachQaIssues([{
        code: "UNKNOWN_EVIDENCE_REF",
        severity: "ERROR",
        message: 'Evidence reference "invented:source" is not in the saved evidence ledger.',
        stepNumber: 1
      }], evidence, malformedEvidenceSequence)
    ).toBe("HUMAN_REVIEW");
    expect(
      classifyOutreachQaIssues([{
        code: "MODEL_QA_UNAVAILABLE",
        severity: "ERROR",
        message: "Our servers are currently overloaded. Please try again later.",
        stepNumber: null
      }])
    ).toBe("MODEL_QA_RETRY");
    expect(
      classifyOutreachQaIssues([{
        code: "UNSUPPORTED_CAUSAL_CLAIM",
        severity: "ERROR",
        message: "The claim is not grounded.",
        stepNumber: 1
      }])
    ).toBe("MODEL_REGENERATION");
    expect(
      getOutreachRegenerationBlockReason({
        planStatus: OutreachPlanStatus.QA_FAILED,
        contactStatus: ContactStatus.REVIEWING,
        replyStatus: ReplyStatus.NO_REPLY,
        sequenceStatus: SequenceStatus.FINISHED
      })
    ).toBeNull();
    expect(
      getOutreachRegenerationBlockReason({
        planStatus: OutreachPlanStatus.QA_FAILED,
        contactStatus: ContactStatus.REVIEWING,
        replyStatus: ReplyStatus.REPLIED,
        sequenceStatus: SequenceStatus.FINISHED
      })
    ).toContain("recorded reply");
  });

  it("tells the single repair pass to remove inference drift instead of paraphrasing it", () => {
    const feedback = buildBoundedOutreachRepairFeedback({
      deterministicIssues: [],
      modelIssues: [{
        code: "UNSUPPORTED_CAUSAL_CLAIM",
        severity: "ERROR",
        message: "A job posting was turned into added shipping capacity.",
        stepNumber: 2
      }],
      allowCallTask: false,
      senderFirstName: "Alex"
    });

    expect(feedback).toContain("Replace or remove each exact disputed clause");
    expect(feedback).toContain("job posting proves only that the listed role is being recruited");
    expect(feedback).toContain("existing or current warehouse process, network, provider");
    expect(feedback).toContain("Never promise to leave, keep, preserve, avoid replacing, or avoid disrupting");
    expect(feedback).toContain("Step 2: A job posting was turned into added shipping capacity.");
  });

  it("allows a second bounded semantic rewrite when the first rewrite repeats an unsupported incumbent assumption", async () => {
    let draftCalls = 0;
    let modelQaCalls = 0;
    const repairFeedback: Array<string | null> = [];
    const result = await runBoundedOutreachQaRepair({
      generateSequence: async (feedback) => {
        draftCalls += 1;
        repairFeedback.push(feedback);
        return { sequence, usage: usage() };
      },
      runDeterministicQa: (candidateSequence) =>
        runDeterministicOutreachQa({
          evidence,
          strategy,
          sequence: candidateSequence,
          senderFirstName: "Alex",
          allowCallTask: true
        }),
      runModelQa: async () => {
        modelQaCalls += 1;
        if (modelQaCalls === 1) {
          return {
            result: {
              passed: false,
              issues: [{
                code: "UNSUPPORTED_CLAIM",
                severity: "ERROR",
                message: "The draft assumes established warehouse processes.",
                stepNumber: 2
              }]
            },
            usage: usage()
          };
        }
        if (modelQaCalls === 2) {
          return {
            result: {
              passed: false,
              issues: [{
                code: "UNSUPPORTED_CLAIM",
                severity: "ERROR",
                message: "The draft promises to leave the current network unchanged.",
                stepNumber: 3
              }]
            },
            usage: usage()
          };
        }
        return {
          result: { passed: true, issues: [] },
          usage: usage()
        };
      },
      allowCallTask: true,
      senderFirstName: "Alex"
    });

    expect(draftCalls).toBe(3);
    expect(modelQaCalls).toBe(3);
    expect(result.modelQa.passed).toBe(true);
    expect(result.automaticRepairFeedbackAttempts).toHaveLength(2);
    expect(repairFeedback[1]).toContain("established warehouse processes");
    expect(repairFeedback[2]).toContain("current network unchanged");
  });

  it("passes a complete hot-opportunity email sequence with one call task", () => {
    const result = runDeterministicOutreachQa({
      evidence,
      strategy,
      sequence,
      senderFirstName: "Alex",
      allowCallTask: true
    });

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("blocks unknown citations, generic phrasing, and unsupported quantified claims", () => {
    const result = runDeterministicOutreachQa({
      evidence,
      strategy,
      senderFirstName: "Alex",
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
    const deterministic = runDeterministicOutreachQa({
      evidence,
      strategy,
      sequence,
      senderFirstName: "Alex",
      allowCallTask: true
    });
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

  it("blocks internal references and incorrect sender signatures", () => {
    const result = runDeterministicOutreachQa({
      evidence,
      strategy,
      senderFirstName: "Alex",
      allowCallTask: true,
      sequence: {
        ...sequence,
        steps: sequence.steps.map((step) =>
          step.stepNumber === 1
            ? {
                ...step,
                body:
                  "Hi Jordan,\n\nHunter research shows recent activity [hunter-research:signal-1:1].\n\nNewl Group"
              }
            : step
        )
      }
    });

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "INTERNAL_REFERENCE",
        "SENDER_PLACEHOLDER",
        "SENDER_SIGNATURE"
      ])
    );
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

  it("hides an AI draft whose linked Hunter plan was superseded", () => {
    expect(isCurrentOutreachDraft({
      aiGenerated: true,
      linkedPlanId: "old-plan",
      currentPlanId: "current-plan"
    })).toBe(false);
    expect(isCurrentOutreachDraft({
      aiGenerated: true,
      linkedPlanId: "current-plan",
      currentPlanId: "current-plan"
    })).toBe(true);
    expect(isCurrentOutreachDraft({
      aiGenerated: false,
      linkedPlanId: null,
      currentPlanId: null
    })).toBe(true);
  });
});

function usage() {
  return {
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 0,
    totalTokens: 15
  };
}
