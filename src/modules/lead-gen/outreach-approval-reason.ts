import {
  OutreachPlanStatus,
  OutreachQaStatus,
  type Prisma
} from "@prisma/client";

type ApprovalPlanState = {
  status: OutreachPlanStatus;
  qaStatus: OutreachQaStatus;
  qaIssues: Prisma.JsonValue | null;
};

type SavedQaIssue = {
  message: string;
  stepNumber: number | null;
};

export function getOutreachPlanApprovalBlockReason(plan: ApprovalPlanState) {
  if (
    plan.status === OutreachPlanStatus.QA_PASSED &&
    plan.qaStatus === OutreachQaStatus.PASSED
  ) {
    return null;
  }

  if (
    plan.status === OutreachPlanStatus.APPROVED &&
    plan.qaStatus === OutreachQaStatus.PASSED
  ) {
    return (
      "This outreach plan is already approved. Use Retry approved in Apollo if it still needs enrollment, " +
      "or Sync Apollo status if Apollo already shows it in the cadence."
    );
  }

  if (
    plan.status === OutreachPlanStatus.QA_FAILED ||
    plan.qaStatus === OutreachQaStatus.FAILED
  ) {
    const issue = readFirstQaIssue(plan.qaIssues);
    const detail = issue
      ? `${issue.stepNumber ? `Step ${issue.stepNumber}: ` : ""}${issue.message}`
      : "Review the saved QA findings in the Outreach Plan.";
    return `Grounded QA failed. ${detail} Regenerate the plan before approval.`;
  }

  if (plan.qaStatus === OutreachQaStatus.PENDING) {
    return "Grounded QA has not completed for this outreach plan. Regenerate or complete QA before approval.";
  }

  return `This outreach plan is ${formatPlanStatus(plan.status)} and is not ready for approval.`;
}

function readFirstQaIssue(value: Prisma.JsonValue | null): SavedQaIssue | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const issue = entry as Record<string, unknown>;
    if (typeof issue.message !== "string" || !issue.message.trim()) {
      continue;
    }

    return {
      message: issue.message.trim(),
      stepNumber:
        typeof issue.stepNumber === "number" &&
        Number.isInteger(issue.stepNumber) &&
        issue.stepNumber > 0
          ? issue.stepNumber
          : null
    };
  }

  return null;
}

function formatPlanStatus(status: OutreachPlanStatus) {
  return status.toLowerCase().replaceAll("_", " ");
}
