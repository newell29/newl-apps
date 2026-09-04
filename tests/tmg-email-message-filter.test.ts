import { describe, expect, it } from "vitest";

import {
  isTmgCandidateMessage,
  normalizeTmgSubject,
  selectTmgCandidateMessagesForSync,
  TMG_MAX_NEW_BATCHES_PER_SYNC
} from "@/modules/shipment-documents/tmg-email-intake";
import type { MicrosoftGraphMailMessage } from "@/server/integrations/microsoft-graph-mail";

const settings = {
  allowedSenderAddresses: ["orders@customer.example"],
  requiredRecipientAddresses: ["csr@example.com"],
  subjectPrefix: "TMG synthetic shipment-"
};

describe("TMG email candidate filtering", () => {
  it("requires the exact sender, a configured To/CC recipient, attachments, and the normalized subject prefix", () => {
    expect(isTmgCandidateMessage(message(), settings)).toBe(true);
    expect(isTmgCandidateMessage(message({ subject: "RE: FW: TMG synthetic shipment-2026-08-18" }), settings)).toBe(true);
    expect(isTmgCandidateMessage(message({ toRecipients: [], ccRecipients: [recipient("csr@example.com")] }), settings)).toBe(true);

    expect(isTmgCandidateMessage(message({ from: sender("other@customer.example") }), settings)).toBe(false);
    expect(isTmgCandidateMessage(message({ toRecipients: [recipient("warehouse@example.com")] }), settings)).toBe(false);
    expect(isTmgCandidateMessage(message({ subject: "Unrelated shipment" }), settings)).toBe(false);
    expect(isTmgCandidateMessage(message({ hasAttachments: false }), settings)).toBe(false);
  });

  it("removes only standard reply and forward prefixes", () => {
    expect(normalizeTmgSubject(" RE: Fwd: TMG synthetic shipment-2026-08-18 ")).toBe(
      "tmg synthetic shipment-2026-08-18"
    );
    expect(normalizeTmgSubject("External: TMG synthetic shipment-2026-08-18")).toBe(
      "external: tmg synthetic shipment-2026-08-18"
    );
  });

  it("bounds a large mailbox backlog to the oldest unsaved candidate", () => {
    const messages = Array.from({ length: 250 }, (_, index) => message({
      id: `message-${String(index).padStart(3, "0")}`,
      receivedDateTime: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
    })).reverse();
    const existingIds = new Set(["message-000", "message-001"]);

    const result = selectTmgCandidateMessagesForSync(messages, existingIds);

    expect(TMG_MAX_NEW_BATCHES_PER_SYNC).toBe(1);
    expect(result.selectedMessages.map((candidate) => candidate.id)).toEqual(["message-002"]);
    expect(result.existingMessageCount).toBe(2);
    expect(result.deferredMessageCount).toBe(247);
  });

  it("deduplicates stable internet-message identities when Graph IDs change", () => {
    const messages = [
      message({
        id: "graph-message-new",
        internetMessageId: " <synthetic-message@example.com> ",
        receivedDateTime: "2026-09-03T17:00:00.000Z"
      }),
      message({
        id: "graph-message-other",
        internetMessageId: "<OTHER-MESSAGE@example.com>",
        receivedDateTime: "2026-09-03T18:00:00.000Z"
      })
    ];

    const result = selectTmgCandidateMessagesForSync(
      messages,
      new Set(["graph-message-old"]),
      new Set(["<SYNTHETIC-MESSAGE@example.com>"])
    );

    expect(result.selectedMessages.map((candidate) => candidate.id)).toEqual(["graph-message-other"]);
    expect(result.existingMessageCount).toBe(1);
    expect(result.deferredMessageCount).toBe(0);
  });

  it("keeps only the oldest copy when one mailbox scan returns duplicate internet messages", () => {
    const messages = [
      message({ id: "graph-message-later", internetMessageId: "<same-message@example.com>", receivedDateTime: "2026-09-03T18:00:00.000Z" }),
      message({ id: "graph-message-first", internetMessageId: "<same-message@example.com>", receivedDateTime: "2026-09-03T17:00:00.000Z" })
    ];

    const result = selectTmgCandidateMessagesForSync(messages, new Set());

    expect(result.selectedMessages.map((candidate) => candidate.id)).toEqual(["graph-message-first"]);
    expect(result.existingMessageCount).toBe(1);
    expect(result.deferredMessageCount).toBe(0);
  });
});

function message(overrides: Partial<MicrosoftGraphMailMessage> = {}): MicrosoftGraphMailMessage {
  return {
    id: "message-1",
    subject: "TMG synthetic shipment-2026-08-18",
    hasAttachments: true,
    from: sender("orders@customer.example"),
    toRecipients: [recipient("csr@example.com"), recipient("warehouse@example.com")],
    ccRecipients: [],
    ...overrides
  };
}

function sender(address: string) {
  return { emailAddress: { address } };
}

function recipient(address: string) {
  return { emailAddress: { address } };
}
