import { describe, expect, it } from "vitest";
import { WebsiteInboundEmailDirection } from "@prisma/client";

import {
  classifyWebsiteInboundGraphMessage,
  resolveWebsiteInboundOpportunityMatch
} from "@/modules/website-inbound/correspondence";

describe("inbound correspondence matching", () => {
  it("classifies mail against the exact approved owner mailbox", () => {
    const inbound = classifyWebsiteInboundGraphMessage(
      {
        id: "message-in",
        from: { emailAddress: { address: "buyer@example.com" } },
        toRecipients: [{ emailAddress: { address: "alex@example.com" } }]
      },
      "alex@example.com",
      ["alex@example.com", "faisal@example.com"]
    );
    expect(inbound).toEqual({
      direction: WebsiteInboundEmailDirection.INBOUND,
      externalEmail: "buyer@example.com"
    });

    const outbound = classifyWebsiteInboundGraphMessage(
      {
        id: "message-out",
        from: { emailAddress: { address: "Faisal@Example.com" } },
        toRecipients: [{ emailAddress: { address: "buyer@example.com" } }]
      },
      "faisal@example.com",
      ["alex@example.com", "faisal@example.com"]
    );
    expect(outbound).toEqual({
      direction: WebsiteInboundEmailDirection.OUTBOUND,
      externalEmail: "buyer@example.com"
    });
  });

  it("does not import internal messages or mail that was not addressed to the scanned mailbox", () => {
    expect(
      classifyWebsiteInboundGraphMessage(
        {
          id: "internal",
          from: { emailAddress: { address: "alex@example.com" } },
          toRecipients: [{ emailAddress: { address: "faisal@example.com" } }]
        },
        "faisal@example.com",
        ["alex@example.com", "faisal@example.com"]
      )
    ).toBeNull();
    expect(
      classifyWebsiteInboundGraphMessage(
        {
          id: "other-mailbox",
          from: { emailAddress: { address: "buyer@example.com" } },
          toRecipients: [{ emailAddress: { address: "sales@example.com" } }]
        },
        "alex@example.com",
        ["alex@example.com", "faisal@example.com"]
      )
    ).toBeNull();
  });

  it("preserves a linked thread and refuses to guess between multiple open opportunities", () => {
    const candidates = [{ id: "lead-a" }, { id: "lead-b" }];
    expect(
      resolveWebsiteInboundOpportunityMatch({
        existingSubmissionId: null,
        conversationSubmissionId: "lead-b",
        candidates,
        openCandidates: candidates
      })
    ).toBe("lead-b");
    expect(
      resolveWebsiteInboundOpportunityMatch({
        existingSubmissionId: null,
        conversationSubmissionId: null,
        candidates,
        openCandidates: candidates
      })
    ).toBeNull();
    expect(
      resolveWebsiteInboundOpportunityMatch({
        existingSubmissionId: null,
        conversationSubmissionId: null,
        candidates,
        openCandidates: [{ id: "lead-a" }]
      })
    ).toBe("lead-a");
  });
});
