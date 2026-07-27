import {
  ContactStatus,
  LeadPipelineStage,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  formatSalesOpportunityStage,
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
        contactStatus: ContactStatus.APPROVED,
        sequenceStatus: SequenceStatus.NOT_STARTED,
        replyStatus: ReplyStatus.NO_REPLY,
        draft: null
      })
    ).toBe(true);
    expect(
      isOutreachQueueContact({
        contactStatus: ContactStatus.REVIEWING,
        sequenceStatus: SequenceStatus.NOT_STARTED,
        replyStatus: ReplyStatus.NO_REPLY,
        draft: null,
        outreachPlan: { id: "plan-1" }
      })
    ).toBe(true);
    expect(
      isOutreachQueueContact({
        contactStatus: ContactStatus.NEW,
        sequenceStatus: SequenceStatus.NOT_STARTED,
        replyStatus: ReplyStatus.NO_REPLY,
        draft: { id: "draft-1" }
      })
    ).toBe(true);
  });

  it("removes terminal, unsafe, and sales-engaged contacts from Outreach Queue", () => {
    const base = {
      contactStatus: ContactStatus.APPROVED,
      sequenceStatus: SequenceStatus.ENROLLED,
      replyStatus: ReplyStatus.NO_REPLY,
      draft: null
    };

    expect(isOutreachQueueContact({ ...base, contactStatus: ContactStatus.DO_NOT_CONTACT })).toBe(false);
    expect(isOutreachQueueContact({ ...base, sequenceStatus: SequenceStatus.BOUNCED })).toBe(false);
    expect(isOutreachQueueContact({ ...base, replyStatus: ReplyStatus.POSITIVE })).toBe(false);
    expect(isOutreachQueueContact({ ...base, replyStatus: ReplyStatus.MEETING_BOOKED })).toBe(false);
  });
});
