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
  email: string | null;
  contactStatus: ContactStatus;
  sequenceStatus: SequenceStatus;
  replyStatus: ReplyStatus;
  draft: unknown | null;
  outreachPlan?: unknown | null;
}) {
  if (!hasActionableEmail(contact.email)) {
    return false;
  }
  if (isTerminalOrUnsafeOutreachContact(contact)) {
    return false;
  }

  if (contact.sequenceStatus === SequenceStatus.ENROLLED) {
    return false;
  }

  if (contact.sequenceStatus === SequenceStatus.FINISHED) {
    return false;
  }

  if (
    contact.sequenceStatus === SequenceStatus.PAUSED &&
    contact.replyStatus === ReplyStatus.OUT_OF_OFFICE
  ) {
    return false;
  }

  const hasCurrentOutreachWork = Boolean(contact.draft) || Boolean(contact.outreachPlan);
  return (
    contact.contactStatus === ContactStatus.APPROVED ||
    contact.sequenceStatus === SequenceStatus.READY ||
    contact.sequenceStatus === SequenceStatus.PAUSED ||
    contact.sequenceStatus === SequenceStatus.REPLIED ||
    hasCurrentOutreachWork
  );
}

export function isActiveCadenceContact(contact: {
  email: string | null;
  contactStatus: ContactStatus;
  sequenceStatus: SequenceStatus;
  replyStatus: ReplyStatus;
}) {
  return (
    hasActionableEmail(contact.email) &&
    !isTerminalOrUnsafeOutreachContact(contact) &&
    (
      contact.sequenceStatus === SequenceStatus.ENROLLED ||
      (
        contact.sequenceStatus === SequenceStatus.PAUSED &&
        contact.replyStatus === ReplyStatus.OUT_OF_OFFICE
      )
    )
  );
}

export function isDeliveryFailureContact(contact: {
  sequenceStatus: SequenceStatus;
}) {
  return contact.sequenceStatus === SequenceStatus.BOUNCED;
}

export function hasActionableEmail(email: string | null) {
  return Boolean(
    email?.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );
}

function isTerminalOrUnsafeOutreachContact(contact: {
  contactStatus: ContactStatus;
  sequenceStatus: SequenceStatus;
  replyStatus: ReplyStatus;
}) {
  return (
    contact.contactStatus === ContactStatus.REJECTED ||
    contact.contactStatus === ContactStatus.DO_NOT_CONTACT ||
    contact.replyStatus === ReplyStatus.POSITIVE ||
    contact.replyStatus === ReplyStatus.MEETING_BOOKED ||
    contact.replyStatus === ReplyStatus.NEGATIVE ||
    contact.sequenceStatus === SequenceStatus.BOUNCED
  );
}
