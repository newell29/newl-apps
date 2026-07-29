import { ReplyStatus, SequenceStatus } from "@prisma/client";

import { isHunterManagedSequenceName } from "@/modules/lead-gen/sequence-catalog";

export const HUNTER_COMPANY_REPLY_HARD_STOP_STATUSES = [
  ReplyStatus.REPLIED,
  ReplyStatus.POSITIVE,
  ReplyStatus.MEETING_BOOKED
] as const;

export function isHunterCompanyReplyHardStop(replyStatus: ReplyStatus) {
  return HUNTER_COMPANY_REPLY_HARD_STOP_STATUSES.includes(
    replyStatus as (typeof HUNTER_COMPANY_REPLY_HARD_STOP_STATUSES)[number]
  );
}

export type ApolloSequenceTransition =
  | { action: "BLOCK"; reason: string }
  | { action: "ENROLL" }
  | { action: "REMOVE_THEN_ENROLL"; previousSequenceId: string }
  | { action: "ALREADY_ENROLLED" };

export function decideApolloSequenceTransition({
  replyStatus,
  sequenceStatus,
  currentSequenceId,
  targetSequenceId
}: {
  replyStatus: ReplyStatus;
  sequenceStatus: SequenceStatus;
  currentSequenceId: string | null;
  targetSequenceId: string;
}): ApolloSequenceTransition {
  if (replyStatus !== ReplyStatus.NO_REPLY) {
    return {
      action: "BLOCK",
      reason: "This contact has replied and cannot be enrolled in a new automated cadence."
    };
  }

  if (sequenceStatus === SequenceStatus.REPLIED) {
    return {
      action: "BLOCK",
      reason: "Apollo reports a reply for this contact, so new automated outreach is blocked."
    };
  }

  if (sequenceStatus === SequenceStatus.BOUNCED) {
    return {
      action: "BLOCK",
      reason: "Apollo reports a bounced address for this contact, so new automated outreach is blocked."
    };
  }

  if (
    sequenceStatus === SequenceStatus.ENROLLED &&
    currentSequenceId === targetSequenceId
  ) {
    return { action: "ALREADY_ENROLLED" };
  }

  if (
    sequenceStatus === SequenceStatus.ENROLLED ||
    sequenceStatus === SequenceStatus.PAUSED
  ) {
    if (!currentSequenceId) {
      return {
        action: "BLOCK",
        reason:
          "Apollo reports active cadence activity but did not identify the existing cadence. Review the contact before moving it."
      };
    }

    return {
      action: "REMOVE_THEN_ENROLL",
      previousSequenceId: currentSequenceId
    };
  }

  if (
    sequenceStatus === SequenceStatus.FINISHED &&
    currentSequenceId === targetSequenceId
  ) {
    return {
      action: "REMOVE_THEN_ENROLL",
      previousSequenceId: currentSequenceId
    };
  }

  return { action: "ENROLL" };
}

export function isHunterContactSafeForReview({
  contactStatus,
  replyStatus,
  sequenceStatus,
  selectedSequenceName
}: {
  contactStatus: "REJECTED" | "DO_NOT_CONTACT" | string;
  replyStatus: ReplyStatus;
  sequenceStatus: SequenceStatus;
  selectedSequenceName?: string | null;
}) {
  return (
    contactStatus !== "REJECTED" &&
    contactStatus !== "DO_NOT_CONTACT" &&
    replyStatus === ReplyStatus.NO_REPLY &&
    sequenceStatus !== SequenceStatus.REPLIED &&
    sequenceStatus !== SequenceStatus.BOUNCED &&
    !isActiveHunterCadence({
      sequenceStatus,
      sequenceName: selectedSequenceName
    })
  );
}

export function isActiveHunterCadence({
  sequenceStatus,
  sequenceName
}: {
  sequenceStatus: SequenceStatus;
  sequenceName: string | null | undefined;
}) {
  return (
    (
      sequenceStatus === SequenceStatus.ENROLLED ||
      sequenceStatus === SequenceStatus.PAUSED
    ) &&
    isHunterManagedSequenceName(sequenceName)
  );
}

export function resolveTrackedSequenceStatus({
  existingStatus,
  incomingStatus,
  selectedSequenceId,
  incomingSequenceId
}: {
  existingStatus: SequenceStatus;
  incomingStatus: SequenceStatus;
  selectedSequenceId: string | null;
  incomingSequenceId: string | null;
}) {
  if (selectedSequenceId && incomingSequenceId === selectedSequenceId) {
    return incomingStatus;
  }

  if (incomingStatus === SequenceStatus.NOT_STARTED) {
    return existingStatus;
  }

  return sequenceStatusRank(incomingStatus) >= sequenceStatusRank(existingStatus)
    ? incomingStatus
    : existingStatus;
}

export function needsApolloBounceDeliveryReconciliation(
  existingStatus: SequenceStatus,
  incomingStatus: SequenceStatus
) {
  const unresolvedStatuses = [
    SequenceStatus.NOT_STARTED,
    SequenceStatus.READY
  ] as const;
  return (
    unresolvedStatuses.includes(
      existingStatus as (typeof unresolvedStatuses)[number]
    ) &&
    unresolvedStatuses.includes(
      incomingStatus as (typeof unresolvedStatuses)[number]
    )
  );
}

function sequenceStatusRank(status: SequenceStatus) {
  return {
    [SequenceStatus.NOT_STARTED]: 0,
    [SequenceStatus.READY]: 1,
    [SequenceStatus.ENROLLED]: 2,
    [SequenceStatus.PAUSED]: 3,
    [SequenceStatus.REPLIED]: 4,
    [SequenceStatus.BOUNCED]: 5,
    [SequenceStatus.FINISHED]: 6
  }[status];
}
