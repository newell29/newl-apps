import { HunterServiceLine, OutreachChannel, OutreachPlanStatus, OutreachQaStatus, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { persistOutreachPlanWithSteps } from "@/modules/lead-gen/outreach-plan-persistence";

describe("persistOutreachPlanWithSteps", () => {
  it("creates the tenant-scoped plan before inserting tenant-scoped sequence steps", async () => {
    const createPlan = vi.fn().mockResolvedValue({ id: "plan-1" });
    const createSteps = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      outreachPlan: {
        create: createPlan
      },
      outreachSequenceStep: {
        createMany: createSteps
      }
    } as unknown as Prisma.TransactionClient;

    await persistOutreachPlanWithSteps({
      transaction,
      plan: {
        tenantId: "tenant-1",
        companyId: "company-1",
        contactId: "contact-1",
        version: 1,
        status: OutreachPlanStatus.QA_PASSED,
        qaStatus: OutreachQaStatus.PASSED,
        serviceLine: HunterServiceLine.WAREHOUSING,
        opportunityType: "Regional warehousing",
        objective: "Confirm warehousing requirements.",
        triggerSummary: "Saved expansion evidence.",
        buyerHypothesis: "Director of logistics owns the decision.",
        valueProposition: "Flexible Charlotte warehousing.",
        likelyObjection: "Existing provider.",
        callToAction: "Discuss requirements.",
        channelStrategy: [],
        sequenceName: "Warehouse sequence",
        confidence: 80,
        evidence: [],
        evidenceFingerprint: "fingerprint",
        strategyModel: "strategy-model",
        draftingModel: "draft-model",
        qaModel: "qa-model",
        promptVersion: "outreach-plan-v1.0"
      },
      steps: [
        {
          tenantId: "tenant-1",
          stepNumber: 1,
          channel: OutreachChannel.EMAIL,
          delayDays: 0,
          subject: "Charlotte warehousing",
          body: "Would it be useful to compare regional warehousing options?",
          angle: "Validate fit.",
          evidenceRefs: ["company:identity"],
          qaIssues: []
        }
      ]
    });

    expect(createPlan).toHaveBeenCalledWith({
      data: expect.not.objectContaining({
        steps: expect.anything()
      })
    });
    expect(createSteps).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tenantId: "tenant-1",
          outreachPlanId: "plan-1",
          stepNumber: 1
        })
      ]
    });
    expect(createPlan.mock.invocationCallOrder[0]).toBeLessThan(createSteps.mock.invocationCallOrder[0]);
  });
});
