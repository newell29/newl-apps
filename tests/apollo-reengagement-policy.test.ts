import {
  ContactStatus,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  decideApolloSequenceTransition,
  isHunterContactSafeForReview,
  resolveTrackedSequenceStatus
} from "@/modules/lead-gen/apollo-reengagement-policy";

describe("Apollo re-engagement policy", () => {
  it("allows finished history and moves an active prior cadence into the approved Hunter cadence", () => {
    expect(decideApolloSequenceTransition({
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceStatus: SequenceStatus.FINISHED,
      currentSequenceId: "legacy-sequence",
      targetSequenceId: "hunter-sequence"
    })).toEqual({ action: "ENROLL" });

    expect(decideApolloSequenceTransition({
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceStatus: SequenceStatus.ENROLLED,
      currentSequenceId: "legacy-sequence",
      targetSequenceId: "hunter-sequence"
    })).toEqual({
      action: "REMOVE_THEN_ENROLL",
      previousSequenceId: "legacy-sequence"
    });
    expect(decideApolloSequenceTransition({
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceStatus: SequenceStatus.PAUSED,
      currentSequenceId: "hunter-sequence",
      targetSequenceId: "hunter-sequence"
    })).toEqual({
      action: "REMOVE_THEN_ENROLL",
      previousSequenceId: "hunter-sequence"
    });
  });

  it("never treats replies or bounces as cadence-history overrides", () => {
    expect(decideApolloSequenceTransition({
      replyStatus: ReplyStatus.POSITIVE,
      sequenceStatus: SequenceStatus.FINISHED,
      currentSequenceId: "legacy-sequence",
      targetSequenceId: "hunter-sequence"
    })).toMatchObject({ action: "BLOCK" });
    expect(decideApolloSequenceTransition({
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceStatus: SequenceStatus.BOUNCED,
      currentSequenceId: "legacy-sequence",
      targetSequenceId: "hunter-sequence"
    })).toMatchObject({ action: "BLOCK" });
  });

  it("keeps prior cadence contacts in buyer review while excluding unsafe contacts", () => {
    expect(isHunterContactSafeForReview({
      contactStatus: ContactStatus.REVIEWING,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceStatus: SequenceStatus.FINISHED
    })).toBe(true);
    expect(isHunterContactSafeForReview({
      contactStatus: ContactStatus.DO_NOT_CONTACT,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceStatus: SequenceStatus.FINISHED
    })).toBe(false);
    expect(isHunterContactSafeForReview({
      contactStatus: ContactStatus.REVIEWING,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceStatus: SequenceStatus.ENROLLED,
      selectedSequenceName: "Hunter - Email Only"
    })).toBe(false);
    expect(isHunterContactSafeForReview({
      contactStatus: ContactStatus.REVIEWING,
      replyStatus: ReplyStatus.NO_REPLY,
      sequenceStatus: SequenceStatus.ENROLLED,
      selectedSequenceName: "Legacy Warehousing Cadence"
    })).toBe(true);
  });

  it("lets the selected new cadence replace stale finished status during sync", () => {
    expect(resolveTrackedSequenceStatus({
      existingStatus: SequenceStatus.FINISHED,
      incomingStatus: SequenceStatus.ENROLLED,
      selectedSequenceId: "hunter-sequence",
      incomingSequenceId: "hunter-sequence"
    })).toBe(SequenceStatus.ENROLLED);
    expect(resolveTrackedSequenceStatus({
      existingStatus: SequenceStatus.FINISHED,
      incomingStatus: SequenceStatus.ENROLLED,
      selectedSequenceId: "hunter-sequence",
      incomingSequenceId: "legacy-sequence"
    })).toBe(SequenceStatus.FINISHED);
    expect(resolveTrackedSequenceStatus({
      existingStatus: SequenceStatus.BOUNCED,
      incomingStatus: SequenceStatus.ENROLLED,
      selectedSequenceId: "hunter-sequence",
      incomingSequenceId: "hunter-sequence"
    })).toBe(SequenceStatus.BOUNCED);
  });

});
