import {
  ContactStatus,
  LeadPipelineStage,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";

export const SALES_OPPORTUNITY_STAGES = [
  LeadPipelineStage.REPLIED,
  LeadPipelineStage.MEETING_BOOKED,
  LeadPipelineStage.QUOTED,
  LeadPipelineStage.WON,
  LeadPipelineStage.LOST
] as const;

export function isSalesOpportunityStage(stage: LeadPipelineStage) {
  return SALES_OPPORTUNITY_STAGES.some((value) => value === stage);
}

export function formatSalesOpportunityStage(stage: LeadPipelineStage) {
  switch (stage) {
    case LeadPipelineStage.REPLIED:
      return "Engaged";
    case LeadPipelineStage.MEETING_BOOKED:
      return "Discovery / Meeting";
    case LeadPipelineStage.QUOTED:
      return "Quote / Proposal";
    case LeadPipelineStage.WON:
      return "Won";
    case LeadPipelineStage.LOST:
      return "Lost";
    default:
      return stage
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

export function resolveSalesOpportunityStage(input: {
  leadStage: LeadPipelineStage;
  replyStatuses: ReplyStatus[];
}) {
  if (
    input.leadStage === LeadPipelineStage.MEETING_BOOKED ||
    input.leadStage === LeadPipelineStage.QUOTED ||
    input.leadStage === LeadPipelineStage.WON ||
    input.leadStage === LeadPipelineStage.LOST
  ) {
    return input.leadStage;
  }

  if (input.replyStatuses.includes(ReplyStatus.MEETING_BOOKED)) {
    return LeadPipelineStage.MEETING_BOOKED;
  }

  if (
    input.leadStage === LeadPipelineStage.REPLIED ||
    input.replyStatuses.includes(ReplyStatus.POSITIVE) ||
    input.replyStatuses.includes(ReplyStatus.REPLIED)
  ) {
    return LeadPipelineStage.REPLIED;
  }

  return null;
}

export function isOutreachQueueContact(contact: {
  contactStatus: ContactStatus;
  sequenceStatus: SequenceStatus;
  replyStatus: ReplyStatus;
  draft: unknown | null;
  outreachPlan?: unknown | null;
}) {
  if (
    contact.contactStatus === ContactStatus.REJECTED ||
    contact.contactStatus === ContactStatus.DO_NOT_CONTACT ||
    contact.replyStatus === ReplyStatus.POSITIVE ||
    contact.replyStatus === ReplyStatus.MEETING_BOOKED ||
    contact.replyStatus === ReplyStatus.NEGATIVE ||
    contact.sequenceStatus === SequenceStatus.BOUNCED ||
    contact.sequenceStatus === SequenceStatus.FINISHED
  ) {
    return false;
  }

  return (
    contact.contactStatus === ContactStatus.APPROVED ||
    contact.sequenceStatus === SequenceStatus.READY ||
    contact.sequenceStatus === SequenceStatus.ENROLLED ||
    contact.sequenceStatus === SequenceStatus.PAUSED ||
    contact.sequenceStatus === SequenceStatus.REPLIED ||
    Boolean(contact.draft) ||
    Boolean(contact.outreachPlan)
  );
}
