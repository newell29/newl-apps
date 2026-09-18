import { describe, expect, it } from "vitest";

import { groupCorrespondenceMessages } from "@/modules/website-inbound/correspondence-view";

function message(
  id: string,
  conversationId: string | null,
  messageAt: string,
  mailboxAddress = "owner@example.com"
) {
  return { id, conversationId, messageAt, mailboxAddress };
}

describe("inbound correspondence conversations", () => {
  it("groups distinct provider messages from one mailbox conversation into one chronological thread", () => {
    const groups = groupCorrespondenceMessages([
      message("third", "conversation-a", "2026-09-18T14:00:00Z"),
      message("first", "conversation-a", "2026-09-18T12:00:00Z"),
      message("second", "conversation-a", "2026-09-18T13:00:00Z")
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.messages.map(({ id }) => id)).toEqual(["first", "second", "third"]);
    expect(groups[0]?.latestMessageAt).toBe("2026-09-18T14:00:00Z");
  });

  it("keeps different mailboxes and messages without a conversation id separate", () => {
    const groups = groupCorrespondenceMessages([
      message("owner-copy", "conversation-a", "2026-09-18T14:00:00Z"),
      message("other-owner-copy", "conversation-a", "2026-09-18T14:01:00Z", "other@example.com"),
      message("standalone-a", null, "2026-09-18T15:00:00Z"),
      message("standalone-b", null, "2026-09-18T16:00:00Z")
    ]);

    expect(groups).toHaveLength(4);
    expect(groups.map((group) => group.messages[0]?.id)).toEqual([
      "standalone-b",
      "standalone-a",
      "other-owner-copy",
      "owner-copy"
    ]);
  });
});
