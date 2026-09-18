import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/website-inbound/actions", () => ({
  generateOpportunityEmailDraftAction: vi.fn(),
  handoffOpportunityMailboxAction: vi.fn(),
  linkOpportunityEmailAction: vi.fn(),
  sendOpportunityEmailDraftAction: vi.fn(),
  syncOpportunityCorrespondenceAction: vi.fn()
}));

import {
  CorrespondencePanel,
  type CorrespondenceMessage
} from "@/modules/website-inbound/components/correspondence-panel";

function correspondenceMessage(
  id: string,
  direction: "INBOUND" | "OUTBOUND",
  messageAt: string
): CorrespondenceMessage {
  return {
    id,
    direction,
    status: direction === "INBOUND" ? "RECEIVED" : "SENT",
    mailboxAddress: "owner@example.com",
    conversationId: "conversation-a",
    subject: direction === "INBOUND" ? "Re: Synthetic request" : "Synthetic request",
    bodyText: `${direction} synthetic message`,
    bodyPreview: null,
    senderAddress: direction === "INBOUND" ? "buyer@example.com" : "owner@example.com",
    senderName: direction === "INBOUND" ? "Synthetic Buyer" : "Synthetic Owner",
    webLink: null,
    hasAttachments: false,
    messageAt,
    draftSource: null,
    draftRationale: null,
    suggestedNextAction: null,
    suggestedFollowUpOn: null,
    basedOnMessageId: null,
    failureReason: null
  };
}

describe("inbound correspondence presentation", () => {
  it("renders one conversation summary for multiple provider messages in the same thread", () => {
    const html = renderToStaticMarkup(
      <CorrespondencePanel
        opportunity={{
          id: "lead-a",
          status: "NEW",
          email: "buyer@example.com",
          ownerUserId: "owner-a",
          communicationMailbox: "owner@example.com"
        }}
        messages={[
          correspondenceMessage("sent-a", "OUTBOUND", "2026-09-18T12:00:00Z"),
          correspondenceMessage("received-a", "INBOUND", "2026-09-18T13:00:00Z")
        ]}
        ownerMailbox="owner@example.com"
        enabled
        draftingEnabled
        canMutate
        currentUserId="owner-a"
      />
    );

    expect(html.match(/Email conversation/g)).toHaveLength(1);
    expect(html).toContain("2 messages · 1 received · 1 sent");
    expect(html).toContain("View conversation");
    expect(html).toContain("Website form alerts delivered to a different mailbox");
  });
});
