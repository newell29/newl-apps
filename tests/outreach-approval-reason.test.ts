import {
  OutreachPlanStatus,
  OutreachQaStatus,
  type Prisma
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getOutreachPlanApprovalBlockReason } from "@/modules/lead-gen/outreach-approval-reason";

describe("outreach approval reasons", () => {
  it("allows a QA-passed plan that has not already been approved", () => {
    expect(
      getOutreachPlanApprovalBlockReason({
        status: OutreachPlanStatus.QA_PASSED,
        qaStatus: OutreachQaStatus.PASSED,
        qaIssues: null
      })
    ).toBeNull();
  });

  it("distinguishes an already-approved plan from a QA failure", () => {
    expect(
      getOutreachPlanApprovalBlockReason({
        status: OutreachPlanStatus.APPROVED,
        qaStatus: OutreachQaStatus.PASSED,
        qaIssues: null
      })
    ).toContain("already approved");
  });

  it("surfaces the first concrete saved QA finding", () => {
    expect(
      getOutreachPlanApprovalBlockReason({
        status: OutreachPlanStatus.QA_FAILED,
        qaStatus: OutreachQaStatus.FAILED,
        qaIssues: [
          {
            code: "UNKNOWN_EVIDENCE",
            severity: "ERROR",
            stepNumber: 2,
            message: 'Evidence reference "tr ademining:summary" is not in the saved evidence ledger.'
          }
        ] as Prisma.JsonValue
      })
    ).toBe(
      'Grounded QA failed. Step 2: Evidence reference "tr ademining:summary" is not in the saved evidence ledger. Regenerate the plan before approval.'
    );
  });
});
