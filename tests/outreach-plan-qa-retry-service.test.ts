import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContactOutreachDraftStatus,
  ContactStatus,
  HunterServiceLine,
  OutreachChannel,
  OutreachPlanStatus,
  OutreachQaStatus,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";

const { prisma, reviewOutreachSequenceGrounding } = vi.hoisted(() => ({
  prisma: {
    outreachPlan: {
      findFirst: vi.fn(),
      update: vi.fn()
    },
    outreachSequenceStep: {
      update: vi.fn(),
      updateMany: vi.fn()
    },
    contactOutreachDraft: {
      updateMany: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    },
    $transaction: vi.fn()
  },
  reviewOutreachSequenceGrounding: vi.fn()
}));

vi.mock("@/server/db", () => ({ prisma }));
vi.mock("@/server/integrations/openai", () => ({
  generateCompleteOutreachSequence: vi.fn(),
  generateOutreachStrategy: vi.fn(),
  reviewOutreachSequenceGrounding
}));

import { repairFailedOutreachPlanForContact } from "@/modules/lead-gen/outreach-plan-generation";

describe("outreach plan model QA retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.outreachPlan.update.mockResolvedValue({});
    prisma.outreachSequenceStep.update.mockResolvedValue({});
    prisma.outreachSequenceStep.updateMany.mockResolvedValue({ count: 3 });
    prisma.contactOutreachDraft.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (work: unknown) => {
      if (typeof work === "function") {
        return work(prisma);
      }
      return Promise.all(work as Promise<unknown>[]);
    });
    reviewOutreachSequenceGrounding.mockResolvedValue({
      result: { passed: true, issues: [] },
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 0,
        totalTokens: 110
      }
    });
  });

  it("rechecks a saved sequence after temporary QA unavailability without regenerating copy", async () => {
    prisma.outreachPlan.findFirst.mockResolvedValue(failedPlan());

    const result = await repairFailedOutreachPlanForContact({
      tenantId: "tenant-1",
      contactId: "contact-1"
    });

    expect(result).toEqual({
      state: "qa_retried",
      message: "The saved sequence passed a fresh model QA review without regeneration."
    });
    expect(reviewOutreachSequenceGrounding).toHaveBeenCalledTimes(1);
    expect(reviewOutreachSequenceGrounding).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        companyName: "Harbor Home",
        senderFirstName: "Alex"
      })
    );
    expect(prisma.outreachPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OutreachPlanStatus.QA_PASSED,
          qaStatus: OutreachQaStatus.PASSED,
          qaIssues: []
        })
      })
    );
    expect(prisma.contactOutreachDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ContactOutreachDraftStatus.AVAILABLE,
          subject: "A warehousing contact for Harbor Home"
        })
      })
    );
  });
});

function failedPlan() {
  const evidence = [
    {
      id: "company:identity",
      kind: "COMPANY",
      title: "Company identity",
      summary: "Jordan Demo is Director of Supply Chain at Harbor Home.",
      sourceUrl: "https://harborhome.example",
      publishedAt: null,
      facts: ["Contact title: Director of Supply Chain"]
    },
    {
      id: "newl-capability:warehousing",
      kind: "NEWL_CAPABILITY",
      title: "Newl warehousing",
      summary: "Newl provides supplemental warehousing.",
      sourceUrl: null,
      publishedAt: null,
      facts: ["Newl provides supplemental warehousing."]
    }
  ];
  return {
    id: "plan-1",
    tenantId: "tenant-1",
    companyId: "company-1",
    contactId: "contact-1",
    status: OutreachPlanStatus.QA_FAILED,
    qaStatus: OutreachQaStatus.FAILED,
    qaIssues: [{
      code: "MODEL_QA_UNAVAILABLE",
      severity: "ERROR",
      message: "Our servers are currently overloaded. Please try again later.",
      stepNumber: null
    }],
    serviceLine: HunterServiceLine.WAREHOUSING,
    opportunityType: "Warehouse capacity",
    objective: "Ask for the operating owner.",
    triggerSummary: "The company has a saved warehousing opportunity.",
    buyerHypothesis: "The contact may route the request.",
    valueProposition: "Newl provides supplemental warehousing.",
    likelyObjection: "Capacity may already be covered.",
    callToAction: "Ask for the correct operating owner.",
    channelStrategy: ["Email on day 0", "Email on day 4", "Email on day 10"],
    senderRecommendation: "Alex",
    sequenceName: "Hunter - Executive Referral",
    confidence: 80,
    evidence,
    qaModel: "gpt-5.6-luna",
    contact: {
      firstName: "Jordan",
      fullName: "Jordan Demo",
      title: "Director of Supply Chain",
      department: "Logistics",
      seniority: "director",
      contactStatus: ContactStatus.REVIEWING,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceStatus: SequenceStatus.NOT_STARTED,
      company: { name: "Harbor Home" }
    },
    steps: [
      emailStep(1, 0, "A warehousing contact for Harbor Home"),
      emailStep(2, 4, "A supplemental option"),
      emailStep(3, 10, "Could you direct me?")
    ]
  };
}

function emailStep(stepNumber: number, delayDays: number, subject: string) {
  return {
    id: `step-${stepNumber}`,
    stepNumber,
    channel: OutreachChannel.EMAIL,
    delayDays,
    subject,
    body: `Hi Jordan,\n\nNewl provides supplemental warehousing. Would you point me to the right owner?\n\nAlex`,
    angle: "Referral request",
    evidenceRefs: ["company:identity", "newl-capability:warehousing"],
    qaIssues: []
  };
}
