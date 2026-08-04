import {
  ContactStatus,
  LeadPipelineStage,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  formatSalesOpportunityStage,
  isActiveCadenceContact,
  isDeliveryFailureContact,
  isOutreachQueueContact,
  isSalesOpportunityStage,
  resolveSalesOpportunityStage,
  SALES_OPPORTUNITY_STAGES
} from "@/modules/lead-gen/automation-workflow";

describe("automated sales workflow", () => {
  it("keeps pre-engagement records out of Sales Opportunities", () => {
    expect(SALES_OPPORTUNITY_STAGES).toEqual([
      LeadPipelineStage.REPLIED,
      LeadPipelineStage.MEETING_BOOKED,
      LeadPipelineStage.QUOTED,
      LeadPipelineStage.WON,
      LeadPipelineStage.LOST
    ]);
    expect(isSalesOpportunityStage(LeadPipelineStage.NEW)).toBe(false);
    expect(isSalesOpportunityStage(LeadPipelineStage.CONTACTED)).toBe(false);
    expect(isSalesOpportunityStage(LeadPipelineStage.REPLIED)).toBe(true);
    expect(formatSalesOpportunityStage(LeadPipelineStage.MEETING_BOOKED)).toBe("Discovery / Meeting");
  });

  it("surfaces Apollo engagement even before the stored lead stage is updated", () => {
    expect(
      resolveSalesOpportunityStage({
        leadStage: LeadPipelineStage.CONTACTED,
        replyStatuses: [ReplyStatus.POSITIVE]
      })
    ).toBe(LeadPipelineStage.REPLIED);
    expect(
      resolveSalesOpportunityStage({
        leadStage: LeadPipelineStage.NEW,
        replyStatuses: [ReplyStatus.MEETING_BOOKED]
      })
    ).toBe(LeadPipelineStage.MEETING_BOOKED);
    expect(
      resolveSalesOpportunityStage({
        leadStage: LeadPipelineStage.CONTACTED,
        replyStatuses: [ReplyStatus.NO_REPLY]
      })
    ).toBeNull();
  });

  it("shows contacts that have actionable outreach work", () => {
    expect(
      isOutreachQueueContact({
        email: "buyer@example.com",
        contactStatus: ContactStatus.APPROVED,
        sequenceStatus: SequenceStatus.NOT_STARTED,
        replyStatus: ReplyStatus.NO_REPLY,
        draft: null
      })
    ).toBe(true);
    expect(
      isOutreachQueueContact({
        email: "buyer@example.com",
        contactStatus: ContactStatus.REVIEWING,
        sequenceStatus: SequenceStatus.FINISHED,
        replyStatus: ReplyStatus.NO_REPLY,
        draft: null,
        outreachPlan: { id: "current-hunter-plan" }
      })
    ).toBe(false);
    expect(
      isOutreachQueueContact({
        email: "buyer@example.com",
        contactStatus: ContactStatus.REVIEWING,
        sequenceStatus: SequenceStatus.NOT_STARTED,
        replyStatus: ReplyStatus.NO_REPLY,
        draft: null,
        outreachPlan: { id: "plan-1" }
      })
    ).toBe(true);
    expect(
      isOutreachQueueContact({
        email: "buyer@example.com",
        contactStatus: ContactStatus.NEW,
        sequenceStatus: SequenceStatus.NOT_STARTED,
        replyStatus: ReplyStatus.NO_REPLY,
        draft: { id: "draft-1" }
      })
    ).toBe(true);
  });

  it("moves enrolled contacts from Needs Attention to Active Cadences", () => {
    const enrolled = {
      email: "buyer@example.com",
      contactStatus: ContactStatus.APPROVED,
      sequenceStatus: SequenceStatus.ENROLLED,
      replyStatus: ReplyStatus.NO_REPLY,
      draft: { id: "draft-1" },
      outreachPlan: { id: "plan-1" }
    };

    expect(isOutreachQueueContact(enrolled)).toBe(false);
    expect(isActiveCadenceContact(enrolled)).toBe(true);

    const paused = {
      ...enrolled,
      sequenceStatus: SequenceStatus.PAUSED
    };
    expect(isOutreachQueueContact(paused)).toBe(true);
    expect(isActiveCadenceContact(paused)).toBe(false);

    const outOfOffice = {
      ...paused,
      replyStatus: ReplyStatus.OUT_OF_OFFICE
    };
    expect(isOutreachQueueContact(outOfOffice)).toBe(false);
    expect(isActiveCadenceContact(outOfOffice)).toBe(true);
  });

  it("removes terminal, unsafe, and sales-engaged contacts from Outreach Queue", () => {
    const base = {
      email: "buyer@example.com",
      contactStatus: ContactStatus.APPROVED,
      sequenceStatus: SequenceStatus.ENROLLED,
      replyStatus: ReplyStatus.NO_REPLY,
      draft: null
    };

    expect(isOutreachQueueContact({ ...base, contactStatus: ContactStatus.DO_NOT_CONTACT })).toBe(false);
    expect(isOutreachQueueContact({ ...base, sequenceStatus: SequenceStatus.BOUNCED })).toBe(false);
    expect(isOutreachQueueContact({
      ...base,
      sequenceStatus: SequenceStatus.FINISHED,
      contactStatus: ContactStatus.REVIEWING
    })).toBe(false);
    expect(isOutreachQueueContact({ ...base, replyStatus: ReplyStatus.POSITIVE })).toBe(false);
    expect(isOutreachQueueContact({ ...base, replyStatus: ReplyStatus.MEETING_BOOKED })).toBe(false);
    expect(isActiveCadenceContact({ ...base, replyStatus: ReplyStatus.POSITIVE })).toBe(false);
    expect(isActiveCadenceContact({ ...base, sequenceStatus: SequenceStatus.BOUNCED })).toBe(false);
    expect(isDeliveryFailureContact({ sequenceStatus: SequenceStatus.BOUNCED })).toBe(true);
    expect(isDeliveryFailureContact({ sequenceStatus: SequenceStatus.FINISHED })).toBe(false);
  });

  it("keeps contacts without a usable email out of actionable outreach views", () => {
    const base = {
      contactStatus: ContactStatus.APPROVED,
      sequenceStatus: SequenceStatus.READY,
      replyStatus: ReplyStatus.NO_REPLY,
      draft: { id: "draft-1" }
    };

    expect(isOutreachQueueContact({ ...base, email: null })).toBe(false);
    expect(isOutreachQueueContact({ ...base, email: "masked***" })).toBe(false);
    expect(
      isActiveCadenceContact({
        ...base,
        email: null,
        sequenceStatus: SequenceStatus.ENROLLED
      })
    ).toBe(false);
  });
});
